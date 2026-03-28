import { access, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { slugify } from "../../lib/slugify.js";
import { writeJsonFile } from "../../lib/write-json.js";
import { makeAliases, makeTags, normalizeObsidianText } from "../../lib/obsidian.js";
import { toFrontmatterMarkdown } from "../ingest/frontmatter.js";
import { loadChromeAttachTarget } from "../attach/manage-targets.js";
import {
  defaultNotebookBrowserSessionFactory,
  extractNotebookResourceId,
  type ManagedNotebookBrowserImportInput,
  type ManagedNotebookBrowserImportResult,
  type NotebookBrowserSessionFactory
} from "../notebooklm/browser-agent.js";
import { bindNotebook } from "./bind-notebook.js";
import { loadNotebookBinding } from "../runs/load-artifacts.js";
import { loadTopic, refreshTopicArtifacts } from "../topics/manage-topics.js";
import { loadWorkspace } from "../workspace/load-workspace.js";
import { getVaultPaths } from "../vault/paths.js";
import {
  getChromeTargetNote,
  getManagedNotebookImportNote,
  getManagedNotebookSetupNote,
  getNotebookNote,
  getSourceNote,
  getTopicIndexNote,
  toWikiLink
} from "../vault/notes.js";
import {
  managedNotebookImportSchema,
  managedNotebookSetupSchema,
  type ManagedNotebookImport,
  type ManagedNotebookImportStatus,
  type ManagedNotebookSetup
} from "../../schemas/managed-notebook.js";
import { notebookSourceKindSchema } from "../../schemas/notebook-source.js";
import { sourceDocumentSchema, type SourceDocument } from "../../schemas/source.js";

export type CreateManagedNotebookInput = {
  topicId: string;
  name: string;
  attachTargetId: string;
  accessMode?: "owner" | "shared" | "chat-only";
  description?: string;
  topics?: string[];
  force?: boolean;
  cwd?: string;
  showBrowser?: boolean;
  sessionFactory?: NotebookBrowserSessionFactory;
  writeSetupJson?: (filePath: string, setup: ManagedNotebookSetup) => Promise<void>;
  writeSetupMarkdown?: (filePath: string, markdown: string) => Promise<void>;
};

export type CreateManagedNotebookResult = {
  setup: ManagedNotebookSetup;
  binding: Awaited<ReturnType<typeof bindNotebook>>["binding"];
  setupMarkdownPath: string;
  setupJsonPath: string;
  bindingMarkdownPath: string;
  bindingJsonPath: string;
};

export type ImportIntoManagedNotebookInput =
  | {
      notebookBindingId: string;
      sourceId: string;
      title?: string;
      force?: boolean;
      cwd?: string;
      showBrowser?: boolean;
      sessionFactory?: NotebookBrowserSessionFactory;
    }
  | {
      notebookBindingId: string;
      url: string;
      title?: string;
      force?: boolean;
      cwd?: string;
      showBrowser?: boolean;
      sessionFactory?: NotebookBrowserSessionFactory;
    };

export type ImportIntoManagedNotebookResult = {
  managedImport: ManagedNotebookImport;
  markdownPath: string;
  jsonPath: string;
};

export async function createManagedNotebook(input: CreateManagedNotebookInput): Promise<CreateManagedNotebookResult> {
  const workspace = await loadWorkspace(input.cwd);
  const vault = getVaultPaths(workspace);
  await mkdir(vault.notebookSetupsDir, { recursive: true });

  const [{ topic }, { target }] = await Promise.all([
    loadTopic(input.topicId, input.cwd),
    loadChromeAttachTarget(input.attachTargetId, input.cwd)
  ]);

  const sessionFactory = input.sessionFactory ?? defaultNotebookBrowserSessionFactory;
  const writeSetupJson = input.writeSetupJson ?? ((filePath: string, setup: ManagedNotebookSetup) => writeJsonFile(filePath, setup));
  const writeSetupMarkdown = input.writeSetupMarkdown ?? ((filePath: string, markdown: string) => writeFile(filePath, markdown, "utf8"));
  const session = await sessionFactory.createSession({
    target,
    ...(input.showBrowser !== undefined ? { showBrowser: input.showBrowser } : {})
  });

  try {
    const createdNotebook = await session.createNotebook(normalizeObsidianText(input.name));
    const remoteNotebookId = extractNotebookResourceId(createdNotebook.notebookUrl);
    if (!remoteNotebookId) {
      throw new Error(`Could not derive a NotebookLM notebook id from ${createdNotebook.notebookUrl}`);
    }
    const bindingId = `notebook-${remoteNotebookId}`;
    const setupId = `managed-notebook-setup-${remoteNotebookId}`;
    const setupJsonPath = path.join(vault.notebookSetupsDir, `${setupId}.json`);
    if (!input.force && (await fileExists(setupJsonPath))) {
      throw new Error(`Managed notebook setup ${setupId} already exists. Re-run with --force to overwrite it.`);
    }
    const bindingResult = await bindNotebook({
      cwd: workspace.rootDir,
      id: bindingId,
      name: normalizeObsidianText(input.name),
      topic: topic.name,
      topicId: topic.id,
      notebookUrl: createdNotebook.notebookUrl,
      accessMode: input.accessMode ?? "owner",
      ...(input.description ? { description: input.description } : {}),
      ...(input.topics ? { topics: input.topics } : {}),
      attachTargetId: target.id,
      ...(input.force !== undefined ? { force: input.force } : {})
    });
    let setupNotePath = "";
    try {
      const now = new Date().toISOString();
      const setup = managedNotebookSetupSchema.parse({
        id: setupId,
        type: "managed_notebook_setup",
        topicId: topic.id,
        notebookBindingId: bindingResult.binding.id,
        remoteNotebookId,
        name: bindingResult.binding.name,
        attachTargetId: target.id,
        createdAt: now,
        updatedAt: now
      });

      const note = getManagedNotebookSetupNote(workspace, setup);
      setupNotePath = note.absolutePath;
      await writeSetupJson(setupJsonPath, setup);
      await writeSetupMarkdown(
        note.absolutePath,
        buildManagedNotebookSetupMarkdown(workspace, setup, topic, bindingResult.binding, target)
      );
      await refreshTopicArtifacts(topic.id, workspace.rootDir);

      return {
        setup,
        binding: bindingResult.binding,
        setupMarkdownPath: note.absolutePath,
        setupJsonPath,
        bindingMarkdownPath: bindingResult.markdownPath,
        bindingJsonPath: bindingResult.jsonPath
      };
    } catch (error) {
      await cleanupManagedNotebookCreationFailure({
        topicId: topic.id,
        setupJsonPath,
        setupMarkdownPath: setupNotePath,
        bindingJsonPath: bindingResult.jsonPath,
        bindingMarkdownPath: bindingResult.markdownPath,
        cwd: workspace.rootDir
      });
      throw error;
    }
  } finally {
    await session.close();
  }
}

export async function importIntoManagedNotebook(
  input: ImportIntoManagedNotebookInput
): Promise<ImportIntoManagedNotebookResult> {
  const workspace = await loadWorkspace(input.cwd);
  const vault = getVaultPaths(workspace);
  await mkdir(vault.notebookImportsDir, { recursive: true });

  const { binding } = await loadNotebookBinding(input.notebookBindingId, input.cwd);
  if (!binding.topicId) {
    throw new Error(`Notebook binding ${binding.id} is not attached to a topic-first workflow.`);
  }
  const { topic } = await loadTopic(binding.topicId, input.cwd);
  const setup = await loadManagedNotebookSetupByBindingId(binding.id, input.cwd);
  const { target } = await loadChromeAttachTarget(setup.setup.attachTargetId, input.cwd);

  const resolvedSource = "sourceId" in input ? await loadSourceDocument(input.sourceId, input.cwd) : undefined;
  const resolvedTitle = normalizeObsidianText(
    input.title ??
      resolvedSource?.title ??
      deriveTitleFromUrl("url" in input ? input.url : resolvedSource?.sourceUri ?? "")
  );
  const sourceUri = "url" in input ? input.url : resolvedSource!.sourceUri;
  const importKind = deriveManagedImportKind(sourceUri, resolvedSource);
  const importId = `managed-import-${slugify(`${binding.id}-${resolvedTitle}-${sourceUri}`)}`;
  const jsonPath = path.join(vault.notebookImportsDir, `${importId}.json`);

  if (!input.force && (await fileExists(jsonPath))) {
    throw new Error(`Managed notebook import ${importId} already exists. Re-run with --force to overwrite it.`);
  }

  const browserImportInput = buildBrowserImportInput({
    importKind,
    sourceUri,
    title: resolvedTitle,
    notebookUrl: binding.notebookUrl,
    ...(resolvedSource ? { source: resolvedSource } : {})
  });

  const sessionFactory = input.sessionFactory ?? defaultNotebookBrowserSessionFactory;
  const session = await sessionFactory.createSession({
    target,
    reuseExistingNotebookPage: true,
    ...(input.showBrowser !== undefined ? { showBrowser: input.showBrowser } : {})
  });

  let browserResult: ManagedNotebookBrowserImportResult;
  try {
    browserResult = await session.importSource(browserImportInput);
  } finally {
    await session.close();
  }

  const now = new Date().toISOString();
  const managedImport = managedNotebookImportSchema.parse({
    id: importId,
    type: "managed_notebook_import",
    topicId: topic.id,
    notebookBindingId: binding.id,
    managedNotebookSetupId: setup.setup.id,
    originType: resolvedSource ? "source_artifact" : "remote_url",
    ...(resolvedSource ? { sourceId: resolvedSource.id } : {}),
    sourceUri,
    title: resolvedTitle,
    importKind,
    status: browserResult.status,
    ...(browserResult.failureReason ? { failureReason: browserResult.failureReason } : {}),
    createdAt: now,
    updatedAt: now
  });

  const note = getManagedNotebookImportNote(workspace, managedImport);
  await writeJsonFile(jsonPath, managedImport);
  await writeFile(
    note.absolutePath,
    buildManagedNotebookImportMarkdown(workspace, managedImport, topic, binding, setup.setup, resolvedSource),
    "utf8"
  );
  await refreshTopicArtifacts(topic.id, workspace.rootDir);

  return {
    managedImport,
    markdownPath: note.absolutePath,
    jsonPath
  };
}

export async function loadManagedNotebookSetup(
  setupId: string,
  cwd?: string
): Promise<{ workspace: Awaited<ReturnType<typeof loadWorkspace>>; setup: ManagedNotebookSetup; path: string }> {
  const workspace = await loadWorkspace(cwd);
  const vault = getVaultPaths(workspace);
  const setupPath = path.join(vault.notebookSetupsDir, `${setupId}.json`);
  const raw = await readFile(setupPath, "utf8");
  const setup = await normalizeManagedNotebookSetup(managedNotebookSetupSchema.parse(JSON.parse(raw)), cwd);
  return {
    workspace,
    setup,
    path: setupPath
  };
}

export async function loadManagedNotebookSetupByBindingId(
  notebookBindingId: string,
  cwd?: string
): Promise<{ workspace: Awaited<ReturnType<typeof loadWorkspace>>; setup: ManagedNotebookSetup; path: string }> {
  const setups = await listManagedNotebookSetups(cwd);
  const directMatch = setups.find((candidate) => candidate.notebookBindingId === notebookBindingId);
  if (directMatch) {
    const workspace = await loadWorkspace(cwd);
    const binding = await tryLoadNotebookBinding(notebookBindingId, cwd);
    const repairedSetup = binding ? await persistManagedNotebookSetupRepair(directMatch, binding, cwd) : directMatch;
    return {
      workspace,
      setup: repairedSetup,
      path: path.join(getVaultPaths(workspace).notebookSetupsDir, `${repairedSetup.id}.json`)
    };
  }

  const binding = await tryLoadNotebookBinding(notebookBindingId, cwd);
  const bindingRemoteNotebookId =
    binding?.remoteNotebookId ?? (binding ? extractNotebookResourceId(binding.notebookUrl) : undefined);
  const compatibleMatch = bindingRemoteNotebookId
    ? await findManagedNotebookSetupByRemoteNotebookId(setups, bindingRemoteNotebookId, cwd)
    : undefined;
  if (!compatibleMatch) {
    throw new Error(`Notebook binding ${notebookBindingId} is not managed by SourceLoop.`);
  }
  const workspace = await loadWorkspace(cwd);
  const repairedSetup = binding ? await persistManagedNotebookSetupRepair(compatibleMatch, binding, cwd) : compatibleMatch;
  return {
    workspace,
    setup: repairedSetup,
    path: path.join(getVaultPaths(workspace).notebookSetupsDir, `${repairedSetup.id}.json`)
  };
}

export async function listManagedNotebookSetups(cwd?: string): Promise<ManagedNotebookSetup[]> {
  const workspace = await loadWorkspace(cwd);
  const vault = getVaultPaths(workspace);
  const setups = await readManagedArtifacts(vault.notebookSetupsDir, managedNotebookSetupSchema);
  return Promise.all(setups.map((setup) => normalizeManagedNotebookSetup(setup, cwd)));
}

export async function loadManagedNotebookImport(
  importId: string,
  cwd?: string
): Promise<{ workspace: Awaited<ReturnType<typeof loadWorkspace>>; managedImport: ManagedNotebookImport; path: string }> {
  const workspace = await loadWorkspace(cwd);
  const vault = getVaultPaths(workspace);
  const importPath = path.join(vault.notebookImportsDir, `${importId}.json`);
  const raw = await readFile(importPath, "utf8");
  return {
    workspace,
    managedImport: managedNotebookImportSchema.parse(JSON.parse(raw)),
    path: importPath
  };
}

export async function listManagedNotebookImports(cwd?: string): Promise<ManagedNotebookImport[]> {
  const workspace = await loadWorkspace(cwd);
  const vault = getVaultPaths(workspace);
  return readManagedArtifacts(vault.notebookImportsDir, managedNotebookImportSchema);
}

function buildManagedNotebookSetupMarkdown(
  workspace: Awaited<ReturnType<typeof loadWorkspace>>,
  setup: ManagedNotebookSetup,
  topic: Awaited<ReturnType<typeof loadTopic>>["topic"],
  binding: Awaited<ReturnType<typeof bindNotebook>>["binding"],
  attachTarget: Awaited<ReturnType<typeof loadChromeAttachTarget>>["target"]
): string {
  const displayName = setup.name ?? binding.name;
  const title = normalizeObsidianText(`Managed ${displayName}`, setup.id);
  return toFrontmatterMarkdown(
    {
      type: "managed-notebook-setup",
      title,
      aliases: makeAliases(setup.id),
      tags: makeTags("sourceloop", "managed", "notebook-setup"),
      topic: normalizeObsidianText(topic.name, topic.id),
      notebook: normalizeObsidianText(displayName, binding.id),
      created: setup.createdAt,
      updated: setup.updatedAt
    },
    `# ${title}

## Topic
- ${toWikiLink(workspace, getTopicIndexNote(workspace, topic).absolutePath, normalizeObsidianText(topic.name, topic.id))}

## Managed Notebook
- ${toWikiLink(workspace, getNotebookNote(workspace, binding).absolutePath, normalizeObsidianText(displayName, binding.id))}

## Attach Target
- ${toWikiLink(workspace, getChromeTargetNote(workspace, attachTarget).absolutePath, normalizeObsidianText(attachTarget.name, attachTarget.id))}
`
  );
}

function buildManagedNotebookImportMarkdown(
  workspace: Awaited<ReturnType<typeof loadWorkspace>>,
  managedImport: ManagedNotebookImport,
  topic: Awaited<ReturnType<typeof loadTopic>>["topic"],
  binding: Awaited<ReturnType<typeof loadNotebookBinding>>["binding"],
  setup: ManagedNotebookSetup,
  source?: SourceDocument
): string {
  const title = normalizeObsidianText(managedImport.title, managedImport.id);
  const setupDisplayName = setup.name ?? binding.name;
  const sourceLink = source
    ? toWikiLink(workspace, getSourceNote(workspace, source).absolutePath, normalizeObsidianText(source.title, source.id))
    : managedImport.sourceUri;

  return toFrontmatterMarkdown(
    {
      type: "managed-notebook-import",
      title,
      aliases: makeAliases(managedImport.id),
      tags: makeTags("sourceloop", "managed", "notebook-import", managedImport.status, managedImport.importKind),
      topic: normalizeObsidianText(topic.name, topic.id),
      notebook: normalizeObsidianText(binding.name, binding.id),
      status: managedImport.status,
      origin: managedImport.originType,
      created: managedImport.createdAt,
      updated: managedImport.updatedAt
    },
    `# ${title}

## Topic
- ${toWikiLink(workspace, getTopicIndexNote(workspace, topic).absolutePath, normalizeObsidianText(topic.name, topic.id))}

## Notebook
- ${toWikiLink(workspace, getNotebookNote(workspace, binding).absolutePath, normalizeObsidianText(binding.name, binding.id))}

## Managed Setup
- ${toWikiLink(workspace, getManagedNotebookSetupNote(workspace, setup).absolutePath, normalizeObsidianText(`Managed ${setupDisplayName}`, setup.id))}

## Source
- ${sourceLink}

## Import
- Status: ${managedImport.status}
- Kind: ${managedImport.importKind}
- Origin: ${managedImport.originType}
${managedImport.failureReason ? `- Failure Reason: ${managedImport.failureReason}` : ""}
`
  );
}

async function loadSourceDocument(
  sourceId: string,
  cwd?: string
): Promise<SourceDocument> {
  const workspace = await loadWorkspace(cwd);
  const vault = getVaultPaths(workspace);
  const sourcePath = path.join(vault.sourcesDir, `${sourceId}.json`);
  const raw = await readFile(sourcePath, "utf8");
  return sourceDocumentSchema.parse(JSON.parse(raw));
}

async function normalizeManagedNotebookSetup(
  setup: ManagedNotebookSetup,
  cwd?: string
): Promise<ManagedNotebookSetup> {
  if (setup.remoteNotebookId && setup.name) {
    return setup;
  }

  const binding = await tryLoadNotebookBinding(setup.notebookBindingId, cwd);
  return managedNotebookSetupSchema.parse({
    ...setup,
    ...(setup.remoteNotebookId || !binding
      ? {}
      : { remoteNotebookId: binding.remoteNotebookId ?? extractNotebookResourceId(binding.notebookUrl) }),
    ...(setup.name || !binding ? {} : { name: binding.name })
  });
}

async function persistManagedNotebookSetupRepair(
  setup: ManagedNotebookSetup,
  binding: Awaited<ReturnType<typeof loadNotebookBinding>>["binding"],
  cwd?: string
): Promise<ManagedNotebookSetup> {
  const repairedSetup = managedNotebookSetupSchema.parse({
    ...setup,
    notebookBindingId: binding.id,
    remoteNotebookId: binding.remoteNotebookId ?? extractNotebookResourceId(binding.notebookUrl),
    name: binding.name
  });

  if (JSON.stringify(repairedSetup) === JSON.stringify(setup)) {
    return repairedSetup;
  }

  const workspace = await loadWorkspace(cwd);
  const vault = getVaultPaths(workspace);
  const setupJsonPath = path.join(vault.notebookSetupsDir, `${setup.id}.json`);
  await writeJsonFile(setupJsonPath, repairedSetup);

  const note = getManagedNotebookSetupNote(workspace, repairedSetup);
  const attachTarget = await loadChromeAttachTarget(repairedSetup.attachTargetId, cwd);
  if (binding.topicId) {
    const { topic } = await loadTopic(binding.topicId, cwd);
    await writeFile(
      note.absolutePath,
      buildManagedNotebookSetupMarkdown(workspace, repairedSetup, topic, binding, attachTarget.target),
      "utf8"
    );
    await refreshTopicArtifacts(binding.topicId, workspace.rootDir).catch(() => undefined);
  }

  return repairedSetup;
}

async function findManagedNotebookSetupByRemoteNotebookId(
  setups: ManagedNotebookSetup[],
  remoteNotebookId: string,
  cwd?: string
): Promise<ManagedNotebookSetup | undefined> {
  for (const candidate of setups) {
    const normalizedCandidate = await normalizeManagedNotebookSetup(candidate, cwd);
    if (normalizedCandidate.remoteNotebookId === remoteNotebookId) {
      return normalizedCandidate;
    }
  }

  return undefined;
}

async function tryLoadNotebookBinding(bindingId: string, cwd?: string) {
  try {
    const { binding } = await loadNotebookBinding(bindingId, cwd);
    return binding;
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
}

function buildBrowserImportInput(input: {
  importKind: ManagedNotebookImport["importKind"];
  sourceUri: string;
  title: string;
  notebookUrl: string;
  source?: SourceDocument;
}): ManagedNotebookBrowserImportInput {
  if (input.importKind === "file_upload") {
    return {
      importKind: "file_upload",
      title: input.title,
      sourceUri: input.sourceUri,
      notebookUrl: input.notebookUrl,
      filePath: input.source?.sourceUri ?? input.sourceUri
    };
  }

  return {
    importKind: input.importKind,
    title: input.title,
    sourceUri: input.sourceUri,
    notebookUrl: input.notebookUrl,
    url: input.sourceUri
  };
}

function deriveManagedImportKind(
  sourceUri: string,
  source?: SourceDocument
): ManagedNotebookImport["importKind"] {
  if (source && source.type !== "url") {
    return "file_upload";
  }

  try {
    const url = new URL(sourceUri);
    if (url.hostname.includes("youtube.com") || url.hostname.includes("youtu.be")) {
      return "youtube_url";
    }
  } catch {}

  return "web_url";
}

function deriveTitleFromUrl(urlLike: string): string {
  try {
    const parsed = new URL(urlLike);
    if (parsed.hostname.includes("youtube.com")) {
      const videoId = parsed.searchParams.get("v");
      if (videoId) {
        return normalizeObsidianText(videoId, "managed-import");
      }
    }
    if (parsed.hostname.includes("youtu.be")) {
      const shortId = parsed.pathname.split("/").filter(Boolean).at(-1);
      if (shortId) {
        return normalizeObsidianText(shortId, "managed-import");
      }
    }
    const leaf = parsed.pathname.split("/").filter(Boolean).at(-1);
    return normalizeObsidianText(leaf ?? parsed.hostname, "managed-import");
  } catch {
    return "Managed notebook import";
  }
}

async function readManagedArtifacts<T>(
  directory: string,
  schema: { parse(value: unknown): T }
): Promise<T[]> {
  try {
    const entries = await readdir(directory);
    const jsonFiles = entries.filter((entry) => entry.endsWith(".json"));
    const raw = await Promise.all(jsonFiles.map((entry) => readFile(path.join(directory, entry), "utf8")));
    return raw.map((value) => schema.parse(JSON.parse(value)));
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return [];
    }
    throw error;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isMissingDirectoryError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

export function isNotebookImportSuccessful(status: ManagedNotebookImportStatus): boolean {
  return status === "imported";
}

export function toManagedNotebookSourceKind(sourceUri: string): ReturnType<typeof notebookSourceKindSchema.parse> {
  try {
    const url = new URL(sourceUri);
    if (url.hostname.includes("youtube.com") || url.hostname.includes("youtu.be")) {
      return notebookSourceKindSchema.parse("youtube-playlist");
    }
  } catch {}

  return notebookSourceKindSchema.parse("document-set");
}

async function cleanupManagedNotebookCreationFailure(input: {
  topicId: string;
  setupJsonPath: string;
  setupMarkdownPath: string;
  bindingJsonPath: string;
  bindingMarkdownPath: string;
  cwd: string;
}): Promise<void> {
  await Promise.all([
    unlinkIfExists(input.setupJsonPath),
    unlinkIfExists(input.setupMarkdownPath),
    unlinkIfExists(input.bindingJsonPath),
    unlinkIfExists(input.bindingMarkdownPath)
  ]);
  await refreshTopicArtifacts(input.topicId, input.cwd).catch(() => undefined);
}

async function unlinkIfExists(filePath: string): Promise<void> {
  if (!filePath) {
    return;
  }
  try {
    await unlink(filePath);
  } catch (error) {
    if (!isMissingDirectoryError(error)) {
      throw error;
    }
  }
}
