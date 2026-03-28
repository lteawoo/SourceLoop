import { access } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { chromium, type Browser, type BrowserContext, type ElementHandle, type Page } from "playwright";
import type { ChromeAttachTarget, ChromeProfileAttachTarget } from "../../schemas/attach.js";
import type { ManagedNotebookImportStatus } from "../../schemas/managed-notebook.js";
import type { CitationReference, PlannedQuestion } from "../../schemas/run.js";
import {
  NOTEBOOKLM_ADD_SOURCE_SELECTORS,
  NOTEBOOKLM_ANSWER_BODY_SELECTORS,
  NOTEBOOKLM_CITATION_SELECTORS,
  NOTEBOOKLM_CITATION_OVERFLOW_SELECTORS,
  NOTEBOOKLM_CITATION_POPOVER_SELECTORS,
  NOTEBOOKLM_CREATE_NOTEBOOK_SELECTORS,
  NOTEBOOKLM_DEFAULT_URL,
  NOTEBOOKLM_IMPORT_ERROR_SELECTORS,
  NOTEBOOKLM_IMPORT_FILE_INPUT_SELECTORS,
  NOTEBOOKLM_IMPORT_FILE_OPTION_SELECTORS,
  NOTEBOOKLM_INITIAL_SOURCE_INTAKE_SELECTORS,
  NOTEBOOKLM_IMPORT_SUCCESS_CANDIDATE_SELECTORS,
  NOTEBOOKLM_IMPORT_SUBMIT_SELECTORS,
  NOTEBOOKLM_IMPORT_URL_INPUT_SELECTORS,
  NOTEBOOKLM_IMPORT_URL_OPTION_SELECTORS,
  NOTEBOOKLM_NOTEBOOK_TITLE_INPUT_SELECTORS,
  NOTEBOOKLM_QUERY_INPUT_SELECTORS,
  NOTEBOOKLM_RESPONSE_SELECTORS,
  NOTEBOOKLM_SUBMIT_SELECTORS,
  NOTEBOOKLM_THINKING_SELECTOR
} from "./config.js";
import {
  extractCitationReferencesFromSnapshot,
  extractNormalizedAnswerFromSnapshot,
  type NotebookLMResponseSnapshot
} from "./response-extraction.js";

export type NotebookLMCitationOverflowCandidate = {
  overflowId: string;
  text?: string | null;
  ariaLabel?: string | null;
  title?: string | null;
  className?: string | null;
  dataTestId?: string | null;
  selector?: string | null;
  citationAdjacent?: boolean;
};

const NOTEBOOKLM_CITATION_OVERFLOW_PATTERNS = [
  /^\.{3,}$/,
  /^…$/,
  /^more_horiz$/i,
  /\bshow more\b/i,
  /\bmore citations?\b/i,
  /\bexpand\b/i,
  /더보기/,
  /펼치기/,
  /추가/
] as const;

const NOTEBOOKLM_NON_OVERFLOW_CONTROL_PATTERNS = [
  /\bcopy\b/i,
  /\bshare\b/i,
  /\bretry\b/i,
  /\brefresh\b/i,
  /\bthumb/i,
  /좋아요/,
  /싫어요/,
  /복사/,
  /공유/
] as const;

export function isLikelyCitationOverflowControl(candidate: {
  text?: string | null;
  ariaLabel?: string | null;
  title?: string | null;
  className?: string | null;
  dataTestId?: string | null;
  selector?: string | null;
}): boolean {
  const values = [
    candidate.text,
    candidate.ariaLabel,
    candidate.title,
    candidate.className,
    candidate.dataTestId
  ]
    .map((value) => normalizeControlText(value))
    .filter(Boolean);

  if (values.length === 0) {
    return false;
  }

  const combined = values.join(" | ");
  if (NOTEBOOKLM_NON_OVERFLOW_CONTROL_PATTERNS.some((pattern) => pattern.test(combined))) {
    return false;
  }

  return NOTEBOOKLM_CITATION_OVERFLOW_PATTERNS.some((pattern) => values.some((value) => pattern.test(value)));
}

export function shouldExpandCitationOverflowControl(candidate: NotebookLMCitationOverflowCandidate): boolean {
  return Boolean(candidate.citationAdjacent) && isLikelyCitationOverflowControl(candidate);
}

export type ChromeAttachValidationCode =
  | "chrome_unreachable"
  | "notebooklm_sign_in_required"
  | "notebooklm_preflight_failed";

export class ChromeAttachValidationError extends Error {
  constructor(
    readonly code: ChromeAttachValidationCode,
    message: string
  ) {
    super(message);
    this.name = "ChromeAttachValidationError";
  }
}

export type ManagedNotebookBrowserCreateResult = {
  notebookUrl: string;
};

export type ManagedNotebookBrowserImportInput = ({
      notebookUrl?: string;
    } & ({
      importKind: "file_upload";
      title: string;
      sourceUri: string;
      filePath: string;
    }
  | {
      importKind: "youtube_url" | "web_url";
      title: string;
      sourceUri: string;
      url: string;
    }));

export type ManagedNotebookBrowserImportResult = {
  status: ManagedNotebookImportStatus;
  failureReason?: string;
};

export type NotebookLMImportSuccessCandidate = {
  signature: string;
  text: string;
};

export interface NotebookBrowserSession {
  preflight(notebookUrl: string): Promise<void>;
  askQuestion(question: PlannedQuestion): Promise<{ answer: string; citations: CitationReference[] }>;
  captureLatestAnswer(): Promise<{ answer: string; citations: CitationReference[] }>;
  createNotebook(title: string): Promise<ManagedNotebookBrowserCreateResult>;
  importSource(input: ManagedNotebookBrowserImportInput): Promise<ManagedNotebookBrowserImportResult>;
  close(): Promise<void>;
}

export interface NotebookBrowserSessionFactory {
  createSession(input: {
    target: ChromeAttachTarget;
    showBrowser?: boolean;
    reuseExistingNotebookPage?: boolean;
  }): Promise<NotebookBrowserSession>;
}

export async function disposeNotebookBrowserSessionResources(input: {
  closePage: () => Promise<unknown>;
  closeBrowserConnection: () => Promise<unknown>;
  ownsBrowserProcess: boolean;
  killSpawnedProcess?: () => void;
}): Promise<void> {
  await input.closePage().catch(() => undefined);
  await input.closeBrowserConnection().catch(() => undefined);

  if (input.ownsBrowserProcess) {
    input.killSpawnedProcess?.();
  }
}

export async function validateChromeAttachTarget(input: {
  target: ChromeAttachTarget;
  notebookUrl?: string;
  showBrowser?: boolean;
  sessionFactory?: NotebookBrowserSessionFactory;
}): Promise<{ ok: true } | { ok: false; code: ChromeAttachValidationCode; message: string }> {
  const sessionFactory = input.sessionFactory ?? defaultNotebookBrowserSessionFactory;
  const session = await sessionFactory.createSession({
    target: input.target,
    ...(input.showBrowser !== undefined ? { showBrowser: input.showBrowser } : {})
  });

  try {
    await session.preflight(input.notebookUrl ?? NOTEBOOKLM_DEFAULT_URL);
    return { ok: true };
  } catch (error) {
    if (error instanceof ChromeAttachValidationError) {
      return {
        ok: false,
        code: error.code,
        message: error.message
      };
    }

    throw error;
  } finally {
    await session.close();
  }
}

export const defaultNotebookBrowserSessionFactory: NotebookBrowserSessionFactory = {
  async createSession(input) {
    return createPlaywrightNotebookBrowserSession(input);
  }
};

async function createPlaywrightNotebookBrowserSession(input: {
  target: ChromeAttachTarget;
  showBrowser?: boolean;
  reuseExistingNotebookPage?: boolean;
}): Promise<NotebookBrowserSession> {
  const state = await connectToAttachedChrome(input.target, input.showBrowser ?? false);
  const context = getDefaultContext(state.browser);
  let page: Page | undefined;
  let ownsPage = false;

  const ensurePage = async (notebookUrl?: string): Promise<Page> => {
    if (page) {
      return page;
    }

    if (input.reuseExistingNotebookPage && notebookUrl) {
      const existingPage = await findReusableNotebookPage(context, notebookUrl);
      if (existingPage) {
        page = existingPage;
        ownsPage = false;
        return page;
      }
    }

    page = await context.newPage();
    ownsPage = true;
    return page;
  };

  return {
    async preflight(notebookUrl: string): Promise<void> {
      const activePage = await ensurePage(notebookUrl);
      if (input.reuseExistingNotebookPage && isNotebookPageMatch(activePage.url(), notebookUrl)) {
        await activePage.bringToFront().catch(() => undefined);
      } else {
        await openNotebookPage(activePage, notebookUrl);
      }
      await ensureNotebookAccessible(activePage);
      await waitForNotebookSettled(activePage);
    },
    async askQuestion(question: PlannedQuestion): Promise<{ answer: string; citations: CitationReference[] }> {
      const activePage = await ensurePage();
      const inputSelector = await waitForFirstVisibleSelector(
        activePage,
        NOTEBOOKLM_QUERY_INPUT_SELECTORS,
        10_000,
        "Could not find a visible NotebookLM query input."
      );
      await waitForNotebookSettled(activePage, inputSelector);
      const previousAnswer = await snapshotLatestResponse(activePage);
      await clearQueryInput(activePage, inputSelector);
      await setQueryInputText(activePage, inputSelector, question.prompt);
      await submitQuery(activePage, inputSelector);

      const latestElement = await waitForStableLatestResponse(activePage, previousAnswer);
      const responseSnapshot = await collectResponseSnapshot(activePage, latestElement);
      const answer = extractNormalizedAnswerFromSnapshot(responseSnapshot);
      if (!answer) {
        throw new Error(`NotebookLM returned an empty answer for question ${question.id}`);
      }

      return {
        answer,
        citations: extractCitationReferencesFromSnapshot(responseSnapshot.citationCandidates)
      };
    },
    async captureLatestAnswer(): Promise<{ answer: string; citations: CitationReference[] }> {
      const activePage = await ensurePage();
      await waitForNotebookSettled(activePage);
      const latestElement = await waitForLatestVisibleResponse(activePage, 30_000);
      if (!latestElement) {
        throw new Error("Could not find a latest NotebookLM response to import.");
      }

      const responseSnapshot = await collectResponseSnapshot(activePage, latestElement);
      const answer = extractNormalizedAnswerFromSnapshot(responseSnapshot);
      if (!answer) {
        throw new Error("NotebookLM did not expose a readable latest answer.");
      }

      return {
        answer,
        citations: extractCitationReferencesFromSnapshot(responseSnapshot.citationCandidates)
      };
    },
    async createNotebook(title: string): Promise<ManagedNotebookBrowserCreateResult> {
      const activePage = await ensurePage();
      await openNotebookPage(activePage, NOTEBOOKLM_DEFAULT_URL);
      await ensureNotebookHomeAccessible(activePage);
      await clickFirstVisibleLocator(activePage, NOTEBOOKLM_CREATE_NOTEBOOK_SELECTORS, "Could not find a NotebookLM create notebook control.");
      await waitForNotebookUrl(activePage, 30_000);
      await waitForNotebookSettled(activePage).catch(() => undefined);
      await bestEffortFillNotebookTitle(activePage, title);

      return {
        notebookUrl: canonicalizeNotebookUrl(activePage.url())
      };
    },
    async importSource(input: ManagedNotebookBrowserImportInput): Promise<ManagedNotebookBrowserImportResult> {
      const activePage = await ensurePage(input.notebookUrl);
      if (input.notebookUrl) {
        if (isNotebookPageMatch(activePage.url(), input.notebookUrl)) {
          await activePage.bringToFront().catch(() => undefined);
        } else {
          await openNotebookPage(activePage, input.notebookUrl);
        }
      }
      await ensureNotebookPageAccessible(activePage);
      if (input.notebookUrl) {
        ensureNotebookTargetMatch(activePage.url(), input.notebookUrl);
      }
      const importSurface = await waitForNotebookImportSurface(activePage);
      const baselineCandidates = await captureImportSuccessCandidates(activePage).catch(() => []);
      const baselineSourceCount = await captureVisibleSourceCount(activePage).catch(() => undefined);

      try {
        if (importSurface === "add_source") {
          const clickedAddSource = await bestEffortClickAny(activePage, NOTEBOOKLM_ADD_SOURCE_SELECTORS);
          if (!clickedAddSource && !(await hasVisibleSelector(activePage, NOTEBOOKLM_INITIAL_SOURCE_INTAKE_SELECTORS))) {
            throw new Error("Could not find a NotebookLM add source control.");
          }
          await waitForImportChoiceSurface(activePage, 5_000);
        }

        if (input.importKind === "file_upload") {
          if (!(await hasVisibleSelector(activePage, NOTEBOOKLM_IMPORT_FILE_INPUT_SELECTORS))) {
            await bestEffortClickAny(activePage, NOTEBOOKLM_IMPORT_FILE_OPTION_SELECTORS);
          }
          const fileSelector = await waitForFirstExistingSelector(activePage, NOTEBOOKLM_IMPORT_FILE_INPUT_SELECTORS, 10_000);
          await activePage.locator(fileSelector).first().setInputFiles(input.filePath);
        } else {
          if (!(await hasVisibleSelector(activePage, NOTEBOOKLM_IMPORT_URL_INPUT_SELECTORS))) {
            await bestEffortClickAny(activePage, NOTEBOOKLM_IMPORT_URL_OPTION_SELECTORS);
          }
          const urlSelector = await waitForFirstVisibleSelector(
            activePage,
            NOTEBOOKLM_IMPORT_URL_INPUT_SELECTORS,
            10_000,
            "Could not find a visible NotebookLM URL input control."
          );
          await clearInputLike(activePage, urlSelector);
          await fillInputLike(activePage, urlSelector, input.url);
          await clickFirstVisibleLocator(activePage, NOTEBOOKLM_IMPORT_SUBMIT_SELECTORS, "Could not find a NotebookLM import submit control.");
        }

        return await waitForImportOutcome(
          activePage,
          baselineCandidates,
          baselineSourceCount,
          input,
          importSurface,
          12_000
        );
      } catch (error) {
        return {
          status: "failed",
          failureReason: formatError(error)
        };
      }
    },
    async close(): Promise<void> {
      const spawnedProcess = state.spawnedProcess;
      const killSpawnedProcess = spawnedProcess
        ? () => {
            spawnedProcess.kill("SIGTERM");
          }
        : undefined;
      await disposeNotebookBrowserSessionResources({
        closePage: () => (page && ownsPage ? page.close() : Promise.resolve()),
        closeBrowserConnection: () => state.browser.close(),
        ownsBrowserProcess: state.ownsBrowser,
        ...(killSpawnedProcess ? { killSpawnedProcess } : {})
      });
    }
  };
}

async function findReusableNotebookPage(context: BrowserContext, notebookUrl: string): Promise<Page | undefined> {
  const targetPath = normalizeNotebookPath(notebookUrl);
  if (!targetPath) {
    return undefined;
  }

  return context.pages().find((candidatePage) => isNotebookPageMatch(candidatePage.url(), notebookUrl));
}

export function isNotebookPageMatch(currentUrl: string, notebookUrl: string): boolean {
  return normalizeNotebookPath(currentUrl) === normalizeNotebookPath(notebookUrl);
}

export function canonicalizeNotebookUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("addSource");
    parsed.hash = "";
    const search = parsed.searchParams.toString();
    return `${parsed.origin}${parsed.pathname}${search ? `?${search}` : ""}`.replace(/\/+$/, "");
  } catch {
    return url;
  }
}

export function extractNotebookResourceId(url: string): string | undefined {
  try {
    const parsed = new URL(canonicalizeNotebookUrl(url));
    const segments = parsed.pathname.split("/").filter(Boolean);
    const notebookIndex = segments.findIndex((segment) => segment === "notebook");
    if (notebookIndex === -1) {
      return undefined;
    }
    const resourceId = segments[notebookIndex + 1];
    return resourceId?.trim() ? resourceId : undefined;
  } catch {
    return undefined;
  }
}

function normalizeNotebookPath(url: string): string | undefined {
  try {
    return canonicalizeNotebookUrl(url).replace(/\?.*$/, "");
  } catch {
    return undefined;
  }
}

export function ensureNotebookTargetMatch(currentUrl: string, notebookUrl: string): void {
  if (isNotebookPageMatch(currentUrl, notebookUrl)) {
    return;
  }

  throw new Error(
    `NotebookLM did not open the requested notebook. Expected ${canonicalizeNotebookUrl(notebookUrl)}, but landed on ${canonicalizeNotebookUrl(currentUrl)}.`
  );
}

async function connectToAttachedChrome(target: ChromeAttachTarget, showBrowser: boolean): Promise<{
  browser: Browser;
  spawnedProcess?: ChildProcess;
  ownsBrowser: boolean;
}> {
  if (target.targetType === "remote_debugging_endpoint") {
    try {
      const browser = await chromium.connectOverCDP(target.endpoint);
      return { browser, ownsBrowser: false };
    } catch (error) {
      throw new ChromeAttachValidationError(
        "chrome_unreachable",
        `Could not reach Chrome remote debugging endpoint ${target.endpoint}: ${formatError(error)}`
      );
    }
  }

  return launchProfileChrome(target, showBrowser);
}

async function launchProfileChrome(
  target: ChromeProfileAttachTarget,
  showBrowser: boolean
): Promise<{ browser: Browser; spawnedProcess?: ChildProcess; ownsBrowser: boolean }> {
  const port = target.remoteDebuggingPort ?? (await allocateFreePort());
  const endpoint = `http://127.0.0.1:${port}`;

  try {
    const browser = await chromium.connectOverCDP(endpoint);
    return { browser, ownsBrowser: false };
  } catch {
    // no running endpoint for this profile target; fall back to launching Chrome
  }

  const executablePath = await resolveChromeExecutablePath(target.chromeExecutablePath);
  const launchArgs = [
    `--user-data-dir=${target.profileDirPath}`,
    `--remote-debugging-port=${port}`,
    "--no-first-run",
    "--no-default-browser-check",
    ...(showBrowser ? [] : ["--headless=new"]),
    ...target.launchArgs,
    NOTEBOOKLM_DEFAULT_URL
  ];

  const spawnedProcess = spawn(executablePath, launchArgs, {
    stdio: "ignore"
  });

  try {
    await waitForRemoteDebuggingEndpoint(endpoint, 15_000);
    const browser = await chromium.connectOverCDP(endpoint);
    return { browser, spawnedProcess, ownsBrowser: true };
  } catch (error) {
    spawnedProcess.kill("SIGTERM");
    throw new ChromeAttachValidationError(
      "chrome_unreachable",
      `Could not launch Chrome from profile ${target.profileDirPath}: ${formatError(error)}`
    );
  }
}

export async function resolveChromeExecutablePath(customPath?: string): Promise<string> {
  const candidates = customPath
    ? [customPath]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : process.platform === "win32"
        ? [
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
          ]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser", "/usr/bin/chromium"];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }

  throw new Error("Could not resolve a Google Chrome executable path. Provide --chrome-path when registering the attach target.");
}

export async function allocateFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate a free TCP port."));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

export async function waitForRemoteDebuggingEndpoint(endpoint: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${endpoint}/json/version`);
      if (response.ok) {
        return;
      }
    } catch {}
    await sleep(250);
  }

  throw new Error(`Timed out waiting for Chrome remote debugging endpoint at ${endpoint}`);
}

function getDefaultContext(browser: Browser): BrowserContext {
  const [defaultContext] = browser.contexts();
  if (!defaultContext) {
    throw new ChromeAttachValidationError(
      "chrome_unreachable",
      "Chrome attached successfully but did not expose a default browser context."
    );
  }

  return defaultContext;
}

async function openNotebookPage(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("ERR_INVALID_ARGUMENT")) {
      throw error;
    }

    await page.goto(url, { waitUntil: "domcontentloaded" });
  }
}

async function ensureNotebookAccessible(page: Page): Promise<void> {
  await ensureNotebookPageAccessible(page);

  try {
    await waitForFirstVisibleSelector(
      page,
      NOTEBOOKLM_QUERY_INPUT_SELECTORS,
      10_000,
      "Could not find a visible NotebookLM query input."
    );
  } catch (error) {
    if (await looksLikeSignInPage(page)) {
      throw new ChromeAttachValidationError(
        "notebooklm_sign_in_required",
        "Chrome is reachable, but NotebookLM is not ready because the session is not signed in."
      );
    }

    throw new ChromeAttachValidationError(
      "notebooklm_preflight_failed",
      `Chrome is reachable, but NotebookLM is not usable yet: ${formatError(error)}`
    );
  }
}

async function ensureNotebookHomeAccessible(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await sleep(750);

  const currentUrl = page.url();
  if (!currentUrl.startsWith("https://notebooklm.google.com/")) {
    if (currentUrl.includes("accounts.google.com")) {
      throw new ChromeAttachValidationError(
        "notebooklm_sign_in_required",
        "Chrome is reachable, but NotebookLM redirected to Google sign-in. Sign in to NotebookLM in this Chrome target first."
      );
    }

    throw new ChromeAttachValidationError(
      "notebooklm_preflight_failed",
      `Chrome is reachable, but NotebookLM home did not open successfully: ${currentUrl}`
    );
  }
}

async function ensureNotebookPageAccessible(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await sleep(750);

  const currentUrl = page.url();
  if (!currentUrl.startsWith("https://notebooklm.google.com/")) {
    if (currentUrl.includes("accounts.google.com")) {
      throw new ChromeAttachValidationError(
        "notebooklm_sign_in_required",
        "Chrome is reachable, but NotebookLM redirected to Google sign-in. Sign in to NotebookLM in this Chrome target first."
      );
    }

    throw new ChromeAttachValidationError(
      "notebooklm_preflight_failed",
      `Chrome is reachable, but NotebookLM did not open successfully: ${currentUrl}`
    );
  }
}

async function waitForNotebookSettled(page: Page, knownInputSelector?: string): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);

  const inputSelector = knownInputSelector ??
    (await waitForFirstVisibleSelector(
      page,
      NOTEBOOKLM_QUERY_INPUT_SELECTORS,
      10_000,
      "Could not find a visible NotebookLM query input."
    ));
  await waitForUsableQueryInput(page, inputSelector, 10_000);
  await scrollNotebookToLatest(page);
  await sleep(1_000);
}

async function looksLikeSignInPage(page: Page): Promise<boolean> {
  const text = (await page.textContent("body").catch(() => null))?.toLowerCase() ?? "";
  return text.includes("sign in") || text.includes("로그인") || text.includes("continue to");
}

async function waitForFirstVisibleSelector(
  page: Page,
  selectors: readonly string[],
  timeout = 10_000,
  errorMessage = "Could not find a visible NotebookLM control."
): Promise<string> {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    for (const selector of selectors) {
      try {
        const element = await page.$(selector);
        if (element && (await element.isVisible())) {
          return selector;
        }
      } catch {}
    }

    await sleep(250);
  }

  throw new Error(errorMessage);
}

type NotebookImportSurface = "add_source" | "initial_source_intake";

async function waitForNotebookImportSurface(page: Page, timeout = 10_000): Promise<NotebookImportSurface> {
  const deadline = Date.now() + timeout;
  const initialIntakeAssumptionThreshold = Date.now() + 2_000;

  while (Date.now() < deadline) {
    if (await looksLikeNotebookHomePage(page)) {
      throw new Error("NotebookLM rendered the home notebook list instead of the requested notebook detail view.");
    }

    if (
      page.url().includes("addSource=true") ||
      (await hasVisibleSelector(page, NOTEBOOKLM_INITIAL_SOURCE_INTAKE_SELECTORS))
    ) {
      return "initial_source_intake";
    }

    if (await hasVisibleSelector(page, NOTEBOOKLM_ADD_SOURCE_SELECTORS)) {
      return "add_source";
    }

    if (
      Date.now() >= initialIntakeAssumptionThreshold &&
      (await looksLikeEmptyNotebookDetail(page))
    ) {
      return "initial_source_intake";
    }

    if (await looksLikeSignInPage(page)) {
      throw new ChromeAttachValidationError(
        "notebooklm_sign_in_required",
        "Chrome is reachable, but NotebookLM is not ready because the session is not signed in."
      );
    }

    await sleep(250);
  }

  throw new Error("Could not find a NotebookLM source import control.");
}

async function waitForImportChoiceSurface(page: Page, timeout = 5_000): Promise<void> {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    if (
      (await hasVisibleSelector(page, NOTEBOOKLM_IMPORT_URL_OPTION_SELECTORS)) ||
      (await hasVisibleSelector(page, NOTEBOOKLM_IMPORT_URL_INPUT_SELECTORS)) ||
      (await hasVisibleSelector(page, NOTEBOOKLM_IMPORT_FILE_OPTION_SELECTORS)) ||
      (await hasVisibleSelector(page, NOTEBOOKLM_IMPORT_FILE_INPUT_SELECTORS))
    ) {
      return;
    }

    await sleep(100);
  }
}

async function looksLikeNotebookHomePage(page: Page): Promise<boolean> {
  const normalizedPath = normalizeNotebookPath(page.url()) ?? "";
  if (normalizedPath.includes("/notebook/")) {
    return false;
  }

  return hasVisibleSelector(page, NOTEBOOKLM_CREATE_NOTEBOOK_SELECTORS);
}

async function looksLikeEmptyNotebookDetail(page: Page): Promise<boolean> {
  const normalizedPath = normalizeNotebookPath(page.url()) ?? "";
  if (!normalizedPath.includes("/notebook/")) {
    return false;
  }

  if (await hasVisibleSelector(page, NOTEBOOKLM_QUERY_INPUT_SELECTORS)) {
    return false;
  }

  if (await hasVisibleSelector(page, NOTEBOOKLM_ADD_SOURCE_SELECTORS)) {
    return false;
  }

  return true;
}

async function hasVisibleSelector(page: Page, selectors: readonly string[]): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if ((await locator.count()) > 0 && (await locator.isVisible())) {
        return true;
      }
    } catch {}
  }

  return false;
}

async function clickFirstVisibleLocator(page: Page, selectors: readonly string[], errorMessage: string): Promise<void> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if ((await locator.count()) > 0 && (await locator.isVisible()) && (await isActionableLocator(locator))) {
        await locator.click();
        return;
      }
    } catch {}
  }

  throw new Error(errorMessage);
}

async function waitForFirstExistingSelector(page: Page, selectors: readonly string[], timeout = 10_000): Promise<string> {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    for (const selector of selectors) {
      try {
        if ((await page.locator(selector).count()) > 0) {
          return selector;
        }
      } catch {}
    }
    await sleep(250);
  }

  throw new Error("Could not find a matching NotebookLM control.");
}

async function bestEffortClickAny(page: Page, selectors: readonly string[]): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if ((await locator.count()) > 0 && (await locator.isVisible()) && (await isActionableLocator(locator))) {
        await locator.click();
        return true;
      }
    } catch {}
  }

  return false;
}

async function isActionableLocator(locator: ReturnType<Page["locator"]>): Promise<boolean> {
  try {
    return await locator.evaluate((element) => {
      const candidate = element as {
        disabled?: boolean;
        getAttribute(name: string): string | null;
      };
      if (candidate.disabled) {
        return false;
      }
      const ariaDisabled = candidate.getAttribute("aria-disabled");
      return ariaDisabled !== "true";
    });
  } catch {
    return false;
  }
}

async function waitForUsableQueryInput(page: Page, selector: string, timeout = 10_000): Promise<void> {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    try {
      const handle = await page.$(selector);
      if (handle && (await handle.isVisible())) {
        const isUsable = await handle.evaluate((node) => {
          const textarea = node as { disabled?: boolean; readOnly?: boolean };
          return !textarea.disabled && !textarea.readOnly;
        });

        if (isUsable) {
          return;
        }
      }
    } catch {}

    await sleep(250);
  }

  throw new Error("NotebookLM query input did not become usable in time.");
}

async function waitForNotebookUrl(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const currentUrl = page.url();
    if (normalizeNotebookPath(currentUrl)?.includes("/notebook/")) {
      return;
    }
    await sleep(250);
  }

  throw new Error("Timed out waiting for NotebookLM to open a notebook page.");
}

async function bestEffortFillNotebookTitle(page: Page, title: string): Promise<void> {
  for (const selector of NOTEBOOKLM_NOTEBOOK_TITLE_INPUT_SELECTORS) {
    const locator = page.locator(selector).first();
    try {
      if ((await locator.count()) > 0 && (await locator.isVisible())) {
        await clearInputLike(page, selector);
        await fillInputLike(page, selector, title);
        await page.keyboard.press("Enter").catch(() => undefined);
        return;
      }
    } catch {}
  }
}

async function snapshotLatestResponse(page: Page): Promise<string | null> {
  const latestElement = await getLatestResponseElement(page);
  if (latestElement) {
    const text = extractNormalizedAnswerFromSnapshot(await collectResponseTextSnapshot(latestElement));
    if (text) {
      return text;
    }
  }
  return null;
}

async function getLatestResponseElement(page: Page): Promise<ElementHandle | null> {
  for (const selector of NOTEBOOKLM_RESPONSE_SELECTORS) {
    const elements = await page.$$(selector);
    const latestElement = elements[elements.length - 1];
    if (latestElement) {
      return latestElement;
    }
  }
  return null;
}

async function waitForLatestVisibleResponse(page: Page, timeout: number): Promise<ElementHandle | null> {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    await scrollNotebookToLatest(page);
    const latestElement = await getLatestResponseElement(page);
    if (latestElement) {
      try {
        if (await latestElement.isVisible()) {
          const text = extractNormalizedAnswerFromSnapshot(await collectResponseTextSnapshot(latestElement));
          if (text) {
            return latestElement;
          }
        }
      } catch {}
    }

    await sleep(250);
  }

  return null;
}

async function scrollNotebookToLatest(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      const g = globalThis as unknown as {
        document: {
          body: { scrollHeight: number; scrollTo?: (options: { top: number; behavior: string }) => void };
          documentElement?: { scrollHeight: number; scrollTo?: (options: { top: number; behavior: string }) => void };
          scrollingElement?: { scrollHeight: number; scrollTo?: (options: { top: number; behavior: string }) => void };
        };
        scrollTo: (options: { top: number; behavior: string }) => void;
      };
      const scrollingElement = g.document.scrollingElement ?? g.document.documentElement ?? g.document.body;
      scrollingElement.scrollTo?.({ top: scrollingElement.scrollHeight, behavior: "instant" });
      g.scrollTo({ top: g.document.body.scrollHeight, behavior: "instant" });
    })
    .catch(() => undefined);
}

async function waitForStableLatestResponse(page: Page, previousAnswer: string | null): Promise<ElementHandle> {
  const deadline = Date.now() + 120_000;
  let stableCount = 0;
  let latestText: string | null = null;
  let latestElement: ElementHandle | null = null;

  while (Date.now() < deadline) {
    const thinkingElement = await page.$(NOTEBOOKLM_THINKING_SELECTOR);
    if (thinkingElement && (await thinkingElement.isVisible())) {
      await sleep(500);
      continue;
    }

    for (const selector of NOTEBOOKLM_RESPONSE_SELECTORS) {
      const elements = await page.$$(selector);
      const candidate = elements[elements.length - 1];
      if (!candidate) {
        continue;
      }

      const candidateText = extractNormalizedAnswerFromSnapshot(await collectResponseTextSnapshot(candidate));
      if (!candidateText || candidateText === previousAnswer) {
        continue;
      }

      if (candidateText === latestText) {
        stableCount += 1;
      } else {
        latestText = candidateText;
        latestElement = candidate;
        stableCount = 1;
      }

      if (stableCount >= 3 && latestElement) {
        return latestElement;
      }
    }

    await sleep(500);
  }

  throw new Error("Timed out waiting for NotebookLM to return a stable answer.");
}

async function collectResponseTextSnapshot(element: ElementHandle): Promise<NotebookLMResponseSnapshot> {
  return element.evaluate(
    (root, selectors) => {
      const normalize = (value: string | null | undefined): string => (value ?? "").replace(/\u00a0/g, " ").trim();
      type QueryableNode = {
        textContent?: string | null;
        innerText?: string;
        childNodes?: Iterable<unknown>;
        nodeType?: number;
        getAttribute?: (name: string) => string | null;
        matches?: (selector: string) => boolean;
        querySelectorAll?: (selector: string) => Iterable<unknown>;
      };
      const dedupe = <T>(items: T[], key: (item: T) => string): T[] => {
        const seen = new Set<string>();
        return items.filter((item) => {
          const itemKey = key(item);
          if (!itemKey || seen.has(itemKey)) {
            return false;
          }
          seen.add(itemKey);
          return true;
        });
      };
      const queryAll = (scope: QueryableNode, selector: string): unknown[] =>
        scope.querySelectorAll ? [...scope.querySelectorAll(selector)] : [];
      const extractMarkerLabels = (scope: QueryableNode): string[] => {
        const markerNodes = queryAll(scope, ".citation-marker, .citation-marker [aria-label]");
        const labels = markerNodes
          .map((node) => {
            const elementNode = node as QueryableNode;
            const ariaLabel = normalize(elementNode.getAttribute?.("aria-label"));
            const text = normalize(elementNode.innerText || elementNode.textContent || "");
            const numbered = ariaLabel.match(/^(\d+)\s*:/);
            if (numbered?.[1]) {
              return numbered[1];
            }
            if (/^\d+$/.test(text)) {
              return text;
            }
            return "";
          })
          .filter((value, index, array) => value && array.indexOf(value) === index);

        return labels;
      };
      const extractMarkerLabel = (scope: QueryableNode): string => {
        const ariaLabel = normalize(scope.getAttribute?.("aria-label"));
        const text = normalize(scope.innerText || scope.textContent || "");
        const numbered = ariaLabel.match(/^(\d+)\s*:/);
        if (numbered?.[1]) {
          return numbered[1];
        }
        if (/^\d+$/.test(text)) {
          return text;
        }
        return "";
      };
      const serializeBodyNode = (scope: QueryableNode): string => {
        if (scope.nodeType === 3) {
          return scope.textContent ?? "";
        }

        if (scope.matches?.(".citation-marker, .citation-marker [aria-label]")) {
          const label = extractMarkerLabel(scope);
          return label ? `[${label}]` : "";
        }

        const childNodes = scope.childNodes ? [...scope.childNodes] : [];
        if (childNodes.length === 0) {
          return scope.textContent ?? "";
        }

        return childNodes.map((child) => serializeBodyNode(child as QueryableNode)).join("");
      };

      const bodyTexts = dedupe(
        selectors.answerBodySelectors.flatMap((selector) =>
          queryAll(root as QueryableNode, selector).map((node) => {
            const elementNode = node as QueryableNode;
            const text = normalize(serializeBodyNode(elementNode));
            if (!text) {
              return "";
            }
            return text;
          })
        ),
        (item) => item
      );

      const rootNode = root as QueryableNode;
      return {
        responseText: normalize(rootNode.innerText || rootNode.textContent || ""),
        bodyTexts,
        citationCandidates: []
      };
    },
    {
      answerBodySelectors: NOTEBOOKLM_ANSWER_BODY_SELECTORS
    }
  );
}

async function collectResponseSnapshot(page: Page, element: ElementHandle): Promise<NotebookLMResponseSnapshot> {
  const markerAttribute = "data-sourceloop-citation-marker";
  const overflowAttribute = "data-sourceloop-citation-overflow";
  await expandCitationOverflowControls(page, element, overflowAttribute);
  const snapshotElement = (await getLatestResponseElement(page)) ?? element;
  const snapshot = await snapshotElement.evaluate(
    (root, selectors) => {
      const normalize = (value: string | null | undefined): string => (value ?? "").replace(/\u00a0/g, " ").trim();
      type QueryableNode = {
        textContent?: string | null;
        innerText?: string;
        childNodes?: Iterable<unknown>;
        nodeType?: number;
        className?: string;
        href?: string;
        title?: string;
        parentElement?: QueryableNode | null;
        dataset?: { testid?: string };
        getAttribute?: (name: string) => string | null;
        setAttribute?: (name: string, value: string) => void;
        matches?: (selector: string) => boolean;
        closest?: (selector: string) => QueryableNode | null;
        querySelectorAll?: (selector: string) => Iterable<unknown>;
      };
      const dedupe = <T>(items: T[], key: (item: T) => string): T[] => {
        const seen = new Set<string>();
        return items.filter((item) => {
          const itemKey = key(item);
          if (!itemKey || seen.has(itemKey)) {
            return false;
          }
          seen.add(itemKey);
          return true;
        });
      };
      const queryAll = (scope: QueryableNode, selector: string): unknown[] =>
        scope.querySelectorAll ? [...scope.querySelectorAll(selector)] : [];
      const extractMarkerLabels = (scope: QueryableNode): string[] => {
        const markerNodes = queryAll(scope, ".citation-marker, .citation-marker [aria-label]");
        const labels = markerNodes
          .map((node) => {
            const elementNode = node as QueryableNode;
            const ariaLabel = normalize(elementNode.getAttribute?.("aria-label"));
            const text = normalize(elementNode.innerText || elementNode.textContent || "");
            const numbered = ariaLabel.match(/^(\d+)\s*:/);
            if (numbered?.[1]) {
              return numbered[1];
            }
            if (/^\d+$/.test(text)) {
              return text;
            }
            return "";
          })
          .filter((value, index, array) => value && array.indexOf(value) === index);

        return labels;
      };
      const extractMarkerLabel = (scope: QueryableNode): string => {
        const ariaLabel = normalize(scope.getAttribute?.("aria-label"));
        const text = normalize(scope.innerText || scope.textContent || "");
        const numbered = ariaLabel.match(/^(\d+)\s*:/);
        if (numbered?.[1]) {
          return numbered[1];
        }
        if (/^\d+$/.test(text)) {
          return text;
        }
        return "";
      };
      const serializeBodyNode = (scope: QueryableNode): string => {
        if (scope.nodeType === 3) {
          return scope.textContent ?? "";
        }

        if (scope.matches?.(".citation-marker, .citation-marker [aria-label]")) {
          const label = extractMarkerLabel(scope);
          return label ? `[${label}]` : "";
        }

        const childNodes = scope.childNodes ? [...scope.childNodes] : [];
        if (childNodes.length === 0) {
          return scope.textContent ?? "";
        }

        return childNodes.map((child) => serializeBodyNode(child as QueryableNode)).join("");
      };
      const collectCitationScopes = (start: QueryableNode): QueryableNode[] => {
        const scopes: QueryableNode[] = [start];
        let current = start.parentElement ?? null;
        let depth = 0;

        while (current && depth < 3) {
          scopes.push(current);
          current = current.parentElement ?? null;
          depth += 1;
        }

        return scopes;
      };

      const bodyTexts = dedupe(
        selectors.answerBodySelectors.flatMap((selector) =>
          queryAll(root as QueryableNode, selector).map((node) => {
            const elementNode = node as QueryableNode;
            const text = normalize(serializeBodyNode(elementNode));
            if (!text) {
              return "";
            }
            return text;
          })
        ),
        (item) => item
      );

      const citationScopes = collectCitationScopes(root as QueryableNode);
      let markerCounter = 0;
      const citationCandidates = dedupe(
        citationScopes.flatMap((scope) =>
          selectors.citationSelectors.flatMap((selector) =>
            queryAll(scope, selector).map((node) => {
              const elementNode = node as QueryableNode;
              const markerNode = elementNode.closest?.(".citation-marker") ?? elementNode;
              let markerId = normalize(markerNode.getAttribute?.(selectors.markerAttribute));
              if (!markerId) {
                markerCounter += 1;
                markerId = `marker-${markerCounter}`;
                markerNode.setAttribute?.(selectors.markerAttribute, markerId);
              }
              return {
                text: normalize(elementNode.innerText || elementNode.textContent || ""),
                ariaLabel: normalize(elementNode.getAttribute?.("aria-label")),
                title: normalize(elementNode.getAttribute?.("title") ?? elementNode.title),
                href: normalize(elementNode.getAttribute?.("href") ?? elementNode.href),
                markerId,
                selector,
                dialogLabel: normalize(elementNode.getAttribute?.("dialoglabel")),
                triggerDescription: normalize(elementNode.getAttribute?.("triggerdescription")),
                dataTestId: normalize(elementNode.dataset?.testid),
                role: normalize(elementNode.getAttribute?.("role")),
                className: normalize(elementNode.className)
              };
            })
          )
        ),
        (item) => JSON.stringify(item)
      );

      const rootNode = root as QueryableNode;
      return {
        responseText: normalize(rootNode.innerText || rootNode.textContent || ""),
        bodyTexts,
        citationCandidates
      };
    },
    {
      answerBodySelectors: NOTEBOOKLM_ANSWER_BODY_SELECTORS,
      citationSelectors: NOTEBOOKLM_CITATION_SELECTORS,
      markerAttribute
    }
  );

  try {
    const popoverTextsByMarkerId = await collectCitationPopoverTexts(page, snapshot.citationCandidates, markerAttribute);
    return {
      ...snapshot,
      citationCandidates: snapshot.citationCandidates.map((candidate) => {
        const popoverText = candidate.markerId ? popoverTextsByMarkerId.get(candidate.markerId) : undefined;
        return popoverText
          ? {
              ...candidate,
              popoverText
            }
          : candidate;
      })
    };
  } finally {
    await clearTemporaryCitationMarkers(page, markerAttribute);
    await clearTemporaryCitationMarkers(page, overflowAttribute);
  }
}

async function expandCitationOverflowControls(page: Page, element: ElementHandle, overflowAttribute: string): Promise<void> {
  const candidates = await element.evaluate(
    (root, selectors) => {
      const normalize = (value: string | null | undefined): string => (value ?? "").replace(/\u00a0/g, " ").trim();
      type QueryableNode = {
        textContent?: string | null;
        innerText?: string;
        className?: string;
        title?: string;
        parentElement?: QueryableNode | null;
        dataset?: { testid?: string };
        getAttribute?: (name: string) => string | null;
        setAttribute?: (name: string, value: string) => void;
        closest?: (selector: string) => QueryableNode | null;
        querySelectorAll?: (selector: string) => Iterable<unknown>;
      };
      const queryAll = (scope: QueryableNode, selector: string): unknown[] =>
        scope.querySelectorAll ? [...scope.querySelectorAll(selector)] : [];
      const collectScopes = (start: QueryableNode): QueryableNode[] => {
        const scopes: QueryableNode[] = [start];
        let current = start.parentElement ?? null;
        let depth = 0;

        while (current && depth < 3) {
          scopes.push(current);
          current = current.parentElement ?? null;
          depth += 1;
        }

        return scopes;
      };

      const isCitationAdjacent = (node: QueryableNode): boolean => {
        if (node.closest?.(".citation-marker")) {
          return true;
        }

        let current = node.parentElement ?? null;
        let depth = 0;
        while (current && depth < 3) {
          const nearbyMarkers = queryAll(current, ".citation-marker");
          if (nearbyMarkers.length > 0) {
            return true;
          }
          current = current.parentElement ?? null;
          depth += 1;
        }

        return false;
      };

      const scopes = collectScopes(root as QueryableNode);
      let counter = 0;
      const seen = new Set<string>();
      const results: NotebookLMCitationOverflowCandidate[] = [];

      for (const scope of scopes) {
        for (const selector of selectors.overflowSelectors) {
          for (const node of queryAll(scope, selector)) {
            const elementNode = node as QueryableNode;
            const overflowId = `overflow-${++counter}`;
            elementNode.setAttribute?.(selectors.overflowAttribute, overflowId);

            const candidate = {
              overflowId,
              text: normalize(elementNode.innerText || elementNode.textContent || ""),
              ariaLabel: normalize(elementNode.getAttribute?.("aria-label")),
              title: normalize(elementNode.getAttribute?.("title") ?? elementNode.title),
              className: normalize(elementNode.className),
              dataTestId: normalize(elementNode.dataset?.testid),
              selector,
              citationAdjacent: isCitationAdjacent(elementNode)
            };

            const key = JSON.stringify(candidate);
            if (seen.has(key)) {
              continue;
            }
            seen.add(key);
            results.push(candidate);
          }
        }
      }

      return results;
    },
    {
      overflowSelectors: NOTEBOOKLM_CITATION_OVERFLOW_SELECTORS,
      overflowAttribute
    }
  );

  for (const candidate of candidates.filter((item) => shouldExpandCitationOverflowControl(item))) {
    const locator = page.locator(`[${overflowAttribute}="${escapeAttributeValue(candidate.overflowId)}"]`).first();
    try {
      if ((await locator.count()) === 0 || !(await locator.isVisible())) {
        continue;
      }
      await locator.click({ timeout: 1_000 });
      await sleep(250);
    } catch {}
  }
}

async function collectCitationPopoverTexts(
  page: Page,
  candidates: NotebookLMResponseSnapshot["citationCandidates"],
  markerAttribute: string
): Promise<Map<string, string>> {
  const markerIds = [...new Set(candidates.map((candidate) => candidate.markerId).filter((value): value is string => Boolean(value)))];
  const popoverTextsByMarkerId = new Map<string, string>();

  for (const markerId of markerIds) {
    const markerLocator = page.locator(`[${markerAttribute}="${escapeAttributeValue(markerId)}"]`).first();
    if ((await markerLocator.count()) === 0) {
      continue;
    }

    const previousPopoverTexts = await captureVisibleCitationPopoverTexts(page);

    try {
      await markerLocator.hover();
      const popoverText = await waitForCitationPopoverText(page, previousPopoverTexts, 2_000);
      if (popoverText) {
        popoverTextsByMarkerId.set(markerId, popoverText);
      }
    } catch {}
  }

  return popoverTextsByMarkerId;
}

async function captureVisibleCitationPopoverTexts(page: Page): Promise<string[]> {
  return page.evaluate((selectors) => {
    const g = globalThis as unknown as {
      document: { querySelectorAll: (selector: string) => Iterable<unknown> };
      getComputedStyle: (element: { getBoundingClientRect: () => { width: number; height: number } }) => {
        visibility: string;
        display: string;
      };
    };
    const normalize = (value: string | null | undefined): string => (value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    const values = selectors.flatMap((selector) =>
      [...g.document.querySelectorAll(selector)].map((node) => {
        const element = node as {
          innerText?: string;
          textContent?: string | null;
          getBoundingClientRect: () => { width: number; height: number };
        };
        const style = g.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        if (style.visibility === "hidden" || style.display === "none" || rect.width === 0 || rect.height === 0) {
          return "";
        }

        return normalize(element.innerText || element.textContent || "");
      })
    );

    return [...new Set(values.filter((value) => value && value !== "인용 세부정보"))];
  }, NOTEBOOKLM_CITATION_POPOVER_SELECTORS);
}

async function waitForCitationPopoverText(page: Page, previousTexts: string[], timeoutMs: number): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs;
  const previous = new Set(previousTexts);

  while (Date.now() < deadline) {
    const currentTexts = await captureVisibleCitationPopoverTexts(page);
    const next = currentTexts.find((text) => !previous.has(text));
    if (next) {
      return next;
    }

    const stable = currentTexts.find((text) => text.length > 0 && text !== "인용 세부정보");
    if (stable && currentTexts.length === 1 && previousTexts.length === 0) {
      return stable;
    }

    await sleep(150);
  }

  return undefined;
}

async function clearTemporaryCitationMarkers(page: Page, markerAttribute: string): Promise<void> {
  await page
    .evaluate((attributeName) => {
      const g = globalThis as unknown as { document: { querySelectorAll: (selector: string) => Iterable<unknown> } };
      for (const node of g.document.querySelectorAll(`[${attributeName}]`)) {
        (node as { removeAttribute: (name: string) => void }).removeAttribute(attributeName);
      }
    }, markerAttribute)
    .catch(() => undefined);
}

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function normalizeControlText(value?: string | null): string {
  return (value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

async function clearQueryInput(page: Page, selector: string): Promise<void> {
  await clearInputLike(page, selector);
}

async function clearInputLike(page: Page, selector: string): Promise<void> {
  await page.click(selector);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.press("Backspace");
}

async function setQueryInputText(page: Page, selector: string, text: string): Promise<void> {
  await fillInputLike(page, selector, text);
}

async function fillInputLike(page: Page, selector: string, text: string): Promise<void> {
  const input = page.locator(selector).first();
  await input.click();

  try {
    await input.fill(text);
    return;
  } catch {}

  await page.locator(selector).evaluate(
    (element, value) => {
      const candidate = element as { tagName?: string; value?: string; dispatchEvent?: (event: Event) => boolean };
      if (
        (candidate.tagName?.toLowerCase() !== "textarea" && candidate.tagName?.toLowerCase() !== "input") ||
        typeof candidate.value !== "string" ||
        !candidate.dispatchEvent
      ) {
        throw new Error("NotebookLM input is not a text field.");
      }
      candidate.value = value;
      candidate.dispatchEvent(new Event("input", { bubbles: true }));
      candidate.dispatchEvent(new Event("change", { bubbles: true }));
    },
    text
  );
}

async function submitQuery(page: Page, inputSelector: string): Promise<void> {
  if (await clickSubmitButton(page, inputSelector)) {
    return;
  }

  await page.click(inputSelector);
  await page.keyboard.press("Enter");
  await sleep(250);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
}

async function clickSubmitButton(page: Page, inputSelector: string): Promise<boolean> {
  for (const selector of NOTEBOOKLM_SUBMIT_SELECTORS) {
    const button = page.locator(selector).first();
    if ((await button.count()) === 0) {
      continue;
    }

    try {
      if (await button.isVisible()) {
        await button.click();
        return true;
      }
    } catch {}
  }

  const input = page.locator(inputSelector).first();
  const submitHandle = await input.evaluateHandle((element) => {
    let current = element as {
      parentElement: unknown;
      querySelectorAll?: (selector: string) => unknown[];
    } | null;

    while (current) {
      const buttons = current.querySelectorAll ? [...current.querySelectorAll("button")] : [];
      const candidate = buttons.find((button) => {
        const candidateButton = button as {
          hasAttribute?: (name: string) => boolean;
          getAttribute?: (name: string) => string | null;
          offsetParent?: unknown;
        };
        const disabled =
          candidateButton.hasAttribute?.("disabled") ||
          candidateButton.getAttribute?.("aria-disabled") === "true";
        const visible = candidateButton.offsetParent !== null && candidateButton.offsetParent !== undefined;
        return !disabled && visible;
      });
      if (candidate) {
        return candidate;
      }
      current = (current.parentElement as typeof current) ?? null;
    }

    return null;
  });

  const submitButton = submitHandle.asElement();
  if (!submitButton) {
    await submitHandle.dispose();
    return false;
  }

  try {
    await submitButton.click();
    return true;
  } catch {
    return false;
  } finally {
    await submitHandle.dispose();
  }
}

async function waitForImportFailure(page: Page, timeoutMs: number): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const selector of NOTEBOOKLM_IMPORT_ERROR_SELECTORS) {
      const locator = page.locator(selector).first();
      try {
        if ((await locator.count()) > 0 && (await locator.isVisible())) {
          const text = normalizeControlText(await locator.innerText());
          if (text) {
            return text;
          }
        }
      } catch {}
    }
    await sleep(200);
  }

  return undefined;
}

async function waitForImportOutcome(
  page: Page,
  baselineCandidates: NotebookLMImportSuccessCandidate[],
  baselineSourceCount: number | undefined,
  input: ManagedNotebookBrowserImportInput,
  importSurface: NotebookImportSurface,
  timeoutMs: number
): Promise<ManagedNotebookBrowserImportResult> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const failureReason = await waitForImportFailure(page, 200);
    if (failureReason) {
      return {
        status: "failed",
        failureReason
      };
    }

    try {
      const currentCandidates = await captureImportSuccessCandidates(page);
      const currentSourceCount = await captureVisibleSourceCount(page).catch(() => undefined);
      if (
        didImportProduceNewMatchingCandidate(baselineCandidates, currentCandidates, input) &&
        (await hasImportSurfaceSettled(page, importSurface))
      ) {
        return {
          status: "imported"
        };
      }

      if (
        didImportProduceNewSourceCandidate(baselineCandidates, currentCandidates) &&
        (await hasImportSurfaceSettled(page, importSurface))
      ) {
        return {
          status: "imported"
        };
      }

      if (
        didImportIncreaseVisibleSourceCount(baselineSourceCount, currentSourceCount) &&
        (await hasImportSurfaceSettled(page, importSurface))
      ) {
        return {
          status: "imported"
        };
      }
    } catch {}

    await sleep(150);
  }

  return {
    status: "queued"
  };
}

async function waitForImportSuccess(
  page: Page,
  baselineCandidates: NotebookLMImportSuccessCandidate[],
  input: ManagedNotebookBrowserImportInput,
  importSurface: NotebookImportSurface,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const currentCandidates = await captureImportSuccessCandidates(page);
      if (
        didImportProduceNewMatchingCandidate(baselineCandidates, currentCandidates, input) &&
        (await hasImportSurfaceSettled(page, importSurface))
      ) {
        return true;
      }
    } catch {}

    await sleep(400);
  }

  return false;
}

async function hasImportSurfaceSettled(page: Page, importSurface: NotebookImportSurface): Promise<boolean> {
  if (importSurface === "initial_source_intake") {
    if (page.url().includes("addSource=true")) {
      return false;
    }

    if (await hasVisibleSelector(page, NOTEBOOKLM_INITIAL_SOURCE_INTAKE_SELECTORS)) {
      return false;
    }

    return true;
  }

  return !(await hasVisibleImportDialog(page));
}

async function hasVisibleImportDialog(page: Page): Promise<boolean> {
  return page.evaluate(
    ({ urlSelectors, fileSelectors }) => {
      const g = globalThis as unknown as {
        document: {
          querySelectorAll(selector: string): Iterable<unknown>;
        };
        getComputedStyle(element: { offsetParent: unknown }): {
          display?: string;
          visibility?: string;
        };
      };

      const selectors = [...urlSelectors, ...fileSelectors];
      const elements = selectors.flatMap((selector) => Array.from(g.document.querySelectorAll(selector)));
      return elements.some((element) => {
        const candidate = element as {
          offsetParent: unknown;
          closest(selector: string): unknown;
        };
        const style = g.getComputedStyle(candidate);
        const visible = style.display !== "none" && style.visibility !== "hidden" && candidate.offsetParent !== null;
        const insideModal = Boolean(candidate.closest('[role="dialog"], dialog, [aria-modal="true"], .cdk-overlay-pane'));
        return visible && insideModal;
      });
    },
    {
      urlSelectors: NOTEBOOKLM_IMPORT_URL_INPUT_SELECTORS,
      fileSelectors: NOTEBOOKLM_IMPORT_FILE_INPUT_SELECTORS
    }
  );
}

async function captureImportSuccessCandidates(
  page: Page
): Promise<NotebookLMImportSuccessCandidate[]> {
  return page.evaluate(
    ({ selectors }) => {
      const g = globalThis as unknown as {
        document: {
          querySelectorAll(selector: string): Iterable<unknown>;
        };
        getComputedStyle(element: { offsetParent: unknown }): {
          display?: string;
          visibility?: string;
        };
      };

      const normalize = (value: string | null | undefined): string =>
        (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

      const isVisible = (element: {
        offsetParent: unknown;
      }): boolean => {
        const style = g.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && element.offsetParent !== null;
      };

      const isInsideModal = (element: {
        closest(selector: string): unknown;
      }): boolean => Boolean(element.closest('[role="dialog"], dialog, [aria-modal="true"], .cdk-overlay-pane'));

      const unique = new Map<string, NotebookLMImportSuccessCandidate>();
      const elements = Array.from(g.document.querySelectorAll(selectors.join(","))) as Array<{
        innerText?: string;
        textContent?: string | null;
        getAttribute(name: string): string | null;
        tagName: string;
        offsetParent: unknown;
        closest(selector: string): unknown;
      }>;

      for (const element of elements) {
        if (!isVisible(element) || isInsideModal(element)) {
          continue;
        }

        const text = normalize(
          [
            element.innerText,
            element.textContent,
            element.getAttribute("aria-label"),
            element.getAttribute("title")
          ]
            .filter(Boolean)
            .join(" ")
        );
        if (!text) {
          continue;
        }

        const signature = [
          normalize(element.getAttribute("data-testid")),
          normalize(element.getAttribute("data-test-id")),
          normalize(element.getAttribute("aria-label")),
          element.tagName.toLowerCase(),
          text
        ].join("|");

        if (!unique.has(signature)) {
          unique.set(signature, {
            signature,
            text
          });
        }
      }

      return Array.from(unique.values());
    },
    {
      selectors: [...NOTEBOOKLM_IMPORT_SUCCESS_CANDIDATE_SELECTORS]
    }
  );
}

async function captureVisibleSourceCount(page: Page): Promise<number | undefined> {
  const bodyText = await page.locator("body").innerText().catch(() => "");
  return parseNotebookSourceCount(bodyText);
}

function didImportProduceNewSourceCandidate(
  baselineCandidates: NotebookLMImportSuccessCandidate[],
  currentCandidates: NotebookLMImportSuccessCandidate[]
): boolean {
  const baselineSignatures = new Set(baselineCandidates.map((candidate) => candidate.signature));
  return currentCandidates.some((candidate) => !baselineSignatures.has(candidate.signature));
}

export function parseNotebookSourceCount(text: string): number | undefined {
  const normalized = normalizeControlText(text);
  if (!normalized) {
    return undefined;
  }

  const patterns = [
    /\bsources?\s*(\d+)\b/i,
    /\b(\d+)\s+sources?\b/i,
    /소스\s*(\d+)\s*개/,
    /(\d+)\s*개\s*소스/
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      const parsed = Number.parseInt(match[1], 10);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
}

export function didImportIncreaseVisibleSourceCount(
  baselineSourceCount: number | undefined,
  currentSourceCount: number | undefined
): boolean {
  if (baselineSourceCount === undefined || currentSourceCount === undefined) {
    return false;
  }

  return currentSourceCount > baselineSourceCount;
}

export function getManagedImportSuccessNeedles(input: ManagedNotebookBrowserImportInput): string[] {
  const values = [input.title, input.sourceUri, input.importKind === "file_upload" ? input.filePath : input.url]
    .map((value) => normalizeControlText(value).toLowerCase())
    .filter((value): value is string => Boolean(value));
  return Array.from(new Set(values));
}

export function didImportProduceNewMatchingCandidate(
  baselineCandidates: NotebookLMImportSuccessCandidate[],
  currentCandidates: NotebookLMImportSuccessCandidate[],
  input: ManagedNotebookBrowserImportInput
): boolean {
  const baselineSignatures = new Set(baselineCandidates.map((candidate) => candidate.signature));
  const needles = getManagedImportSuccessNeedles(input);

  return currentCandidates.some((candidate) => {
    if (baselineSignatures.has(candidate.signature)) {
      return false;
    }

    const normalizedText = normalizeControlText(candidate.text);
    return Boolean(normalizedText) && needles.some((needle) => normalizedText.includes(needle));
  });
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
