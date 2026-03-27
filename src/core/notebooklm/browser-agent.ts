import { access } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { chromium, type Browser, type BrowserContext, type ElementHandle, type Page } from "playwright";
import type { ChromeAttachTarget, ChromeProfileAttachTarget } from "../../schemas/attach.js";
import type { CitationReference, PlannedQuestion } from "../../schemas/run.js";
import {
  NOTEBOOKLM_DEFAULT_URL,
  NOTEBOOKLM_QUERY_INPUT_SELECTORS,
  NOTEBOOKLM_RESPONSE_SELECTORS,
  NOTEBOOKLM_SUBMIT_SELECTORS,
  NOTEBOOKLM_THINKING_SELECTOR
} from "./config.js";

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

export interface NotebookBrowserSession {
  preflight(notebookUrl: string): Promise<void>;
  askQuestion(question: PlannedQuestion): Promise<{ answer: string; citations: CitationReference[] }>;
  close(): Promise<void>;
}

export interface NotebookBrowserSessionFactory {
  createSession(input: { target: ChromeAttachTarget; showBrowser?: boolean }): Promise<NotebookBrowserSession>;
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
}): Promise<NotebookBrowserSession> {
  const state = await connectToAttachedChrome(input.target, input.showBrowser ?? false);
  const context = getDefaultContext(state.browser);
  const page = await context.newPage();

  return {
    async preflight(notebookUrl: string): Promise<void> {
      await openNotebookPage(page, notebookUrl);
      await ensureNotebookAccessible(page);
    },
    async askQuestion(question: PlannedQuestion): Promise<{ answer: string; citations: CitationReference[] }> {
      const inputSelector = await waitForFirstVisibleSelector(page, NOTEBOOKLM_QUERY_INPUT_SELECTORS);
      const previousAnswer = await snapshotLatestResponse(page);
      await clearQueryInput(page, inputSelector);
      await setQueryInputText(page, inputSelector, question.prompt);
      await submitQuery(page, inputSelector);

      const latestElement = await waitForStableLatestResponse(page, previousAnswer);
      const answer = (await latestElement.innerText()).trim();
      if (!answer) {
        throw new Error(`NotebookLM returned an empty answer for question ${question.id}`);
      }

      return {
        answer,
        citations: await extractCitationReferences(latestElement)
      };
    },
    async close(): Promise<void> {
      const spawnedProcess = state.spawnedProcess;
      const killSpawnedProcess = spawnedProcess
        ? () => {
            spawnedProcess.kill("SIGTERM");
          }
        : undefined;
      await disposeNotebookBrowserSessionResources({
        closePage: () => page.close(),
        closeBrowserConnection: () => state.browser.close(),
        ownsBrowserProcess: state.ownsBrowser,
        ...(killSpawnedProcess ? { killSpawnedProcess } : {})
      });
    }
  };
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
): Promise<{ browser: Browser; spawnedProcess: ChildProcess; ownsBrowser: boolean }> {
  const executablePath = await resolveChromeExecutablePath(target.chromeExecutablePath);
  const port = target.remoteDebuggingPort ?? (await allocateFreePort());
  const endpoint = `http://127.0.0.1:${port}`;
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

async function resolveChromeExecutablePath(customPath?: string): Promise<string> {
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

async function allocateFreePort(): Promise<number> {
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

async function waitForRemoteDebuggingEndpoint(endpoint: string, timeoutMs: number): Promise<void> {
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

  try {
    await waitForFirstVisibleSelector(page, NOTEBOOKLM_QUERY_INPUT_SELECTORS, 10_000);
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

async function looksLikeSignInPage(page: Page): Promise<boolean> {
  const text = (await page.textContent("body").catch(() => null))?.toLowerCase() ?? "";
  return text.includes("sign in") || text.includes("로그인") || text.includes("continue to");
}

async function waitForFirstVisibleSelector(page: Page, selectors: readonly string[], timeout = 10_000): Promise<string> {
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

  throw new Error("Could not find a visible NotebookLM query input.");
}

async function snapshotLatestResponse(page: Page): Promise<string | null> {
  for (const selector of NOTEBOOKLM_RESPONSE_SELECTORS) {
    const elements = await page.$$(selector);
    if (elements.length > 0) {
      const text = (await elements[elements.length - 1]?.innerText())?.trim();
      if (text) {
        return text;
      }
    }
  }
  return null;
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

      const candidateText = (await candidate.innerText()).trim();
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

async function extractCitationReferences(element: ElementHandle): Promise<CitationReference[]> {
  const links = await element.$$("a[href]");
  const citations: CitationReference[] = [];

  for (const link of links) {
    const href = await link.getAttribute("href");
    const label = (await link.innerText()).trim() || href || "citation";
    if (!href && !label) {
      continue;
    }
    citations.push({
      label,
      ...(href ? { href } : {})
    });
  }

  if (citations.length > 0) {
    return citations;
  }

  return [{ label: "NotebookLM UI citation not captured", note: "No visible citation links were extracted from the latest answer." }];
}

async function clearQueryInput(page: Page, selector: string): Promise<void> {
  await page.click(selector);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.press("Backspace");
}

async function setQueryInputText(page: Page, selector: string, text: string): Promise<void> {
  const input = page.locator(selector).first();
  await input.click();

  try {
    await input.fill(text);
    return;
  } catch {}

  await page.locator(selector).evaluate(
    (element, value) => {
      const candidate = element as { tagName?: string; value?: string; dispatchEvent?: (event: Event) => boolean };
      if (candidate.tagName?.toLowerCase() !== "textarea" || typeof candidate.value !== "string" || !candidate.dispatchEvent) {
        throw new Error("NotebookLM query input is not a textarea.");
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

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
