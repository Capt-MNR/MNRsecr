import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { once } from "node:events";

const apiFixtureCwd = new URL("../../api-server/", import.meta.url).pathname;
const mobileCwd = new URL("../", import.meta.url).pathname;
const chromiumPath = "/repl/tools/bin/chromium";

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

function spawnProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.output = () => ({ stdout, stderr });
  return child;
}

async function waitForHttp(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message ?? "unknown error"}`);
}

async function waitForFixture(child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let output = "";
  const onData = (chunk) => {
    output += chunk;
  };
  child.stdout.on("data", onData);
  try {
    while (Date.now() < deadline) {
      const line = output.split("\n").find((candidate) => candidate.includes("approval-fixture-ready"));
      if (line) return JSON.parse(line);
      if (child.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    child.stdout.off("data", onData);
  }
  const { stderr } = child.output();
  throw new Error(`Fixture did not start.\n${output}\n${stderr}`);
}

async function closeProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "close"),
    new Promise((resolve) => setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolve();
    }, 3_000)),
  ]);
}

function startApiProxy(apiBaseUrl, mobileBaseUrl, counts) {
  return http.createServer(async (request, response) => {
    try {
      const requestPath = request.url ?? "/";
      const targetBase = requestPath.startsWith("/api/") ? apiBaseUrl : mobileBaseUrl;
      const target = new URL(requestPath, targetBase);
      if (request.method === "POST" && target.pathname === "/api/turns") counts.turns += 1;
      if (request.method === "POST" && target.pathname.startsWith("/api/approvals/")) counts.approvals += 1;

      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const headers = Object.fromEntries(
        Object.entries(request.headers).filter(([name]) => name !== "host" && name !== "content-length"),
      );
      const upstream = await fetch(target, {
        method: request.method,
        headers,
        body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
      });
      const responseHeaders = Object.fromEntries(
        [...upstream.headers].filter(([name]) => ![
          "connection",
          "content-encoding",
          "content-length",
          "keep-alive",
          "transfer-encoding",
        ].includes(name)),
      );
      response.writeHead(upstream.status, responseHeaders);
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      response.statusCode = 502;
      response.end(String(error));
    }
  });
}

class DevToolsPage {
  constructor(webSocketUrl) {
    this.socket = new WebSocket(webSocketUrl);
    this.nextId = 0;
    this.pending = new Map();
    this.exceptions = [];
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.method === "Runtime.exceptionThrown") {
        this.exceptions.push(message.params?.exceptionDetails ?? message.params);
        return;
      }
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "Browser evaluation failed");
    return result.result?.value;
  }

  close() {
    this.socket.close();
  }
}

async function startChromium(url) {
  const debugPort = await freePort();
  const profile = `/tmp/personal-secretary-mobile-browser-${process.pid}-${debugPort}`;
  const child = spawnProcess(chromiumPath, [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    url,
  ]);
  try {
    await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`);
    const deadline = Date.now() + 30_000;
    let target;
    while (Date.now() < deadline && !target) {
      const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
      target = targets.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
      if (!target) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!target) throw new Error("Chromium did not expose a page target.");
    const page = new DevToolsPage(target.webSocketDebuggerUrl);
    await page.send("Runtime.enable");
    return { child, page, profile };
  } catch (error) {
    await closeProcess(child);
    rmSync(profile, { recursive: true, force: true });
    throw error;
  }
}

async function waitForBrowserValue(page, expression, description, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await page.evaluate(expression);
    if (lastValue) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const browserState = await page.evaluate(`JSON.stringify({
    url: location.href,
    body: document.body?.innerText?.slice(0, 1000) ?? "",
    apiRequests: performance.getEntriesByType("resource")
      .filter((entry) => entry.name.includes("/api/"))
      .map((entry) => ({
        name: entry.name,
        duration: Math.round(entry.duration),
        status: entry.responseStatus ?? null,
      }))
      .slice(-20),
  })`);
  const fixtureOutput = fixture.output();
  throw new Error(`Timed out waiting for ${description}. Last value: ${JSON.stringify(lastValue)}. Browser: ${browserState}. Exceptions: ${JSON.stringify(page.exceptions)}. Fixture: ${fixtureOutput.stderr.slice(-2000)}`);
}

async function clickAndWaitForDetail(page, testId, returnTestId) {
  await waitForBrowserValue(
    page,
    `document.querySelector('[data-testid="${testId}"]') !== null`,
    `${testId} to be visible`,
  );
  await page.evaluate(`document.querySelector('[data-testid="${testId}"]').click()`);
  await waitForBrowserValue(
    page,
    `document.querySelector('[data-testid="record-detail-back"]') !== null`,
    `${testId} to open Record Detail View`,
  );
  await page.evaluate(`document.querySelector('[data-testid="record-detail-back"]').click()`);
  await waitForBrowserValue(
    page,
    `document.querySelector('[data-testid="${returnTestId}"]') !== null`,
    `${testId} to return to ${returnTestId}`,
  );
}

const fixture = spawnProcess(
  "../../scripts/node_modules/.bin/tsx",
  ["test/approval-fixture-harness.ts"],
  {
    cwd: apiFixtureCwd,
    env: { FIXTURE_PORT: "0", AI_PROVIDER: "development" },
  },
);

let expo;
let proxy;
let browser;
try {
  const fixtureInfo = await waitForFixture(fixture);
  const expoPort = await freePort();
  expo = spawnProcess(
    "pnpm",
    ["exec", "expo", "start", "--web", "--localhost", "--port", String(expoPort)],
    {
      cwd: mobileCwd,
    env: {
      PORT: String(expoPort),
      EXPO_PUBLIC_DOMAIN: "",
      EXPO_PUBLIC_MOBILE_AUTH_MODE: "development",
    },
    },
  );
  const expoBaseUrl = `http://127.0.0.1:${expoPort}`;
  await waitForHttp(expoBaseUrl);

  const counts = { turns: 0, approvals: 0 };
  proxy = startApiProxy(fixtureInfo.apiBaseUrl, expoBaseUrl, counts);
  await new Promise((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(0, "127.0.0.1", resolve);
  });
  const proxyAddress = proxy.address();
  assert.ok(proxyAddress && typeof proxyAddress !== "string");
  const appBaseUrl = `http://127.0.0.1:${proxyAddress.port}`;
  browser = await startChromium(`${appBaseUrl}/`);

  try {
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="quick-message-input"]') !== null`,
      "Quick Chat",
    );
    await browser.page.evaluate(`document.querySelector('[data-testid="quick-open-main"]').click()`);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="main-office-home"]') !== null`,
      "Main Office",
    );
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="office-feed"]') !== null`,
      "Main Office activity feed",
    );
    const newestFirstRecordIds = [
      `office-focus-reminder-${fixtureInfo.ids.reminder}`,
      `office-focus-task-${fixtureInfo.ids.task}`,
      `office-focus-expense-${fixtureInfo.ids.expense}`,
    ];
    await waitForBrowserValue(
      browser.page,
      `(() => {
        const feed = document.querySelector('[data-testid="office-feed"]');
        const ids = ${JSON.stringify(newestFirstRecordIds)};
        const nodes = Array.from(feed?.querySelectorAll('[data-testid]') ?? []);
        return ids.every((id) => nodes.some((node) => node.getAttribute('data-testid') === id));
      })()`,
      "real feed records",
    );
    const feedCardTops = await browser.page.evaluate(`(() => {
      const feed = document.querySelector('[data-testid="office-feed"]');
      const ids = ${JSON.stringify(newestFirstRecordIds)};
      const nodes = Array.from(feed?.querySelectorAll('[data-testid]') ?? []);
      return ids.map((id) => nodes.find((node) => node.getAttribute('data-testid') === id)?.getBoundingClientRect().top ?? null);
    })()`);
    assert.ok(
      feedCardTops.every((top, index) => typeof top === "number" && (index === 0 || top > feedCardTops[index - 1])),
      `Main feed should sort saved records newest first: ${JSON.stringify(feedCardTops)}`,
    );
    await browser.page.evaluate(`document.querySelector('[data-testid="office-feed-open-chat"]').click()`);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="main-message-input"]') !== null`,
      "Main Office message input",
    );
    await browser.page.evaluate(`document.querySelector('[data-testid="main-quick-bubble"]').click()`);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="quick-message-input"]') !== null`,
      "Quick Chat after returning from Main",
    );
    await browser.page.evaluate(`document.querySelector('[data-testid="quick-open-main"]').click()`);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="main-office-home"]') !== null`,
      "Main Office after reopening from Quick",
    );
    await browser.page.send("Emulation.setDeviceMetricsOverride", {
      width: 402,
      height: 874,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="office-feed"]') !== null`,
      "newest-first Main activity feed",
    );
    if (process.env.CAPTURE_MAIN_OFFICE_SNAPSHOTS === "1") {
      for (const [width, height] of [[360, 780], [402, 874]]) {
        await browser.page.send("Emulation.setDeviceMetricsOverride", {
          width,
          height,
          deviceScaleFactor: 1,
          mobile: true,
        });
        const screenshot = await browser.page.send("Page.captureScreenshot", {
          format: "jpeg",
          quality: 92,
        });
        writeFileSync(
          `/tmp/personal-secretary-main-office-${width}.jpg`,
          Buffer.from(screenshot.data, "base64"),
        );
      }
    }
    await browser.page.evaluate(`document.querySelector('[data-testid="office-feed-open-chat"]').click()`);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="main-message-input"]') !== null`,
      "Main conversation before keyboard viewport",
    );
    await browser.page.send("Emulation.setDeviceMetricsOverride", {
      width: 402,
      height: 550,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="main-message-input"]') !== null && document.querySelector('[data-testid="office-feed"]') === null`,
      "Main conversation in the keyboard viewport",
    );
    const compactComposerFit = await browser.page.evaluate(`(() => {
      const input = document.querySelector('[data-testid="main-message-input"]');
      const navigation = document.querySelector('[data-testid="main-bottom-records"]');
      if (!input || !navigation) return false;
      return input.getBoundingClientRect().bottom <= navigation.getBoundingClientRect().top;
    })()`);
    assert.equal(compactComposerFit, true, "the chat composer should stay above bottom navigation in a keyboard-reduced viewport");
    await browser.page.send("Emulation.setDeviceMetricsOverride", {
      width: 402,
      height: 874,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="main-message-input"]') !== null`,
      "Main conversation restored after the compact viewport",
    );
    await browser.page.evaluate(`document.querySelector('[data-testid="office-chat-close"]').click()`);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="office-feed"]') !== null`,
      "Main feed after closing the conversation",
    );
    await clickAndWaitForDetail(
      browser.page,
      `office-focus-task-${fixtureInfo.ids.task}`,
      "main-office-home",
    );
    assert.deepEqual(
      browser.page.exceptions,
      [],
      `opening Main from Quick must not throw a browser exception: ${JSON.stringify(browser.page.exceptions)}`,
    );

    const message = fixtureInfo.firstApprovalMessage;
    await browser.page.evaluate(`document.querySelector('[data-testid="office-feed-open-chat"]').click()`);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="main-message-input"]') !== null`,
      "Main conversation before sending",
    );
    await browser.page.evaluate(`(() => {
      const input = document.querySelector('[data-testid="main-message-input"]');
      if (!input) throw new Error("Main Office message input is missing");
      const prototype = input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (!setter) throw new Error("Could not set the Main Office message input");
      setter.call(input, ${JSON.stringify(message)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      document.querySelector('[data-testid="main-send-message"]')?.click();
    })()`);

    const approval = await waitForBrowserValue(
      browser.page,
      `(() => {
        const editor = document.querySelector('[data-testid^="approval-edit-confirm-"]');
        const simple = document.querySelector('[data-testid^="approve-"]');
        const button = editor ?? simple;
        return button?.getAttribute("data-testid") ?? null;
      })()`,
      "Main Office approval",
    );
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid^="office-focus-approval-"]') !== null`,
      "adaptive focus for pending approval",
    );
    assert.equal(counts.turns, 1, "sending from Main Office must create one turn");

    await browser.page.evaluate(`document.querySelector('[data-testid="${approval}"]')?.click()`);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid^="open-record-expense-"]') !== null`,
      "approved turn record detail link",
    );
    assert.equal(counts.turns, 1, "approval must not resend the Main Office turn");
    assert.equal(counts.approvals, 1, "approval must execute exactly once");

    const recordLink = await browser.page.evaluate(`(() => {
      const element = document.querySelector('[data-testid^="open-record-expense-"]');
      return element?.getAttribute("data-testid") ?? null;
    })()`);
    assert.ok(recordLink, "the approved turn should expose an expense detail link");
    await clickAndWaitForDetail(browser.page, recordLink, "main-office-home");

    await browser.page.evaluate(`document.querySelector('[data-testid="pearl-sheet-handle"]').click()`);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="pearl-sheet-record-expense-${fixtureInfo.ids.expense}"]') !== null`,
      "Main Office recent activity records",
    );
    for (const [label, testId] of [
      ["recent activity expense", `pearl-sheet-record-expense-${fixtureInfo.ids.expense}`],
      ["task row", `pearl-sheet-record-task-${fixtureInfo.ids.task}`],
      ["reminder row", `pearl-sheet-record-reminder-${fixtureInfo.ids.reminder}`],
    ]) {
      await clickAndWaitForDetail(browser.page, testId, "main-office-home");
      assert.ok(label, `${label} should remain covered by this drill-down`);
      await browser.page.evaluate(`document.querySelector('[data-testid="pearl-sheet-handle"]').click()`);
    }

    await browser.page.evaluate(`document.querySelector('[data-testid="pearl-sheet-tab-context"]').click()`);
    for (const [label, testId] of [
      ["person hub", `pearl-sheet-person-${fixtureInfo.ids.person}`],
      ["project hub", `pearl-sheet-project-${fixtureInfo.ids.project}`],
    ]) {
      await clickAndWaitForDetail(browser.page, testId, "main-office-home");
      assert.ok(label, `${label} should remain covered by this drill-down`);
      await browser.page.evaluate(`document.querySelector('[data-testid="pearl-sheet-handle"]').click(); document.querySelector('[data-testid="pearl-sheet-tab-context"]').click()`);
    }

    await browser.page.evaluate(`document.querySelector('[data-testid="main-bottom-records"]').click()`);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="records-back-to-office"]') !== null`,
      "Records surface",
    );
    await clickAndWaitForDetail(
      browser.page,
      `record-expense-${fixtureInfo.ids.expense}`,
      "records-back-to-office",
    );
    await browser.page.evaluate(`document.querySelector('[data-testid="records-back-to-office"]').click()`);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="main-office-home"]') !== null`,
      "Office after leaving the Records surface",
    );

    await browser.page.evaluate(`document.querySelector('[data-testid="office-feed-open-chat"]').click()`);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="main-message-input"]') !== null`,
      "Main conversation before opening approval provenance",
    );
    await browser.page.evaluate(`document.querySelector('[data-testid="${recordLink}"]')?.click()`);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="record-detail-back"]') !== null`,
      "approved expense details before provenance",
    );
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="open-original-conversation"]') !== null`,
      "origin conversation action on the approved expense",
    );
    await browser.page.evaluate(`document.querySelector('[data-testid="open-original-conversation"]').click()`);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="main-office-home"]') !== null`,
      "Main Office after opening the origin conversation",
    );
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="main-chat-transcript"]')?.textContent?.includes(${JSON.stringify(message)})`,
      "the originating conversation turn",
    );
    assert.equal(counts.turns, 1, "opening provenance must not create another turn");
    assert.equal(counts.approvals, 1, "opening provenance must not re-approve the operation");

    const mainBackgroundsScript = `(() => {
      let node = document.querySelector('[data-testid="main-office-home"]');
      if (!node) return null;
      const backgrounds = [];
      while (node && node !== document.documentElement) {
        backgrounds.push(getComputedStyle(node).backgroundColor);
        node = node.parentElement;
      }
      return backgrounds;
    })()`;
    const lightMainBackgrounds = await browser.page.evaluate(mainBackgroundsScript);
    assert.ok(lightMainBackgrounds?.length, "Main should expose a measurable light-theme surface");

    await browser.page.evaluate(`document.querySelector('[data-testid="open-main-drawer"]').click()`);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="drawer-open-settings"]') !== null`,
      "Main settings entry",
    );
    await browser.page.evaluate(`document.querySelector('[data-testid="drawer-open-settings"]').click()`);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="theme-dark"]') !== null && document.querySelector('[data-testid="language-en"]') !== null`,
      "dedicated appearance and language settings",
    );
    await browser.page.evaluate(`document.querySelector('[data-testid="open-personal-information"]').click()`);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="profile-save-profile.preferred_name"]') !== null && document.querySelector('[data-testid="open-memory-library"]') !== null`,
      "personal information profile",
    );
    await browser.page.evaluate(`document.querySelector('[data-testid="open-memory-library"]').click()`);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="memory-add-toggle"]') !== null`,
      "memory library",
    );
    await browser.page.evaluate(`document.querySelector('[data-testid="memory-add-toggle"]').click()`);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="memory-create-key"]') !== null && document.querySelector('[data-testid="memory-create-value"]') !== null`,
      "manual memory entry form",
    );
    await browser.page.evaluate(`document.querySelector('[data-testid="memory-sheet-close"]').click()`);
    await browser.page.evaluate(`document.querySelector('[data-testid="personal-information-back"]').click()`);
    await browser.page.evaluate(`document.querySelector('[data-testid="theme-dark"]').click()`);
    await browser.page.evaluate(`document.querySelector('[data-testid="settings-back"]').click()`);
    const darkMainBackgrounds = await waitForBrowserValue(
      browser.page,
      `(() => {
        const home = document.querySelector('[data-testid="main-office-home"]');
        if (!home) return null;
        const backgrounds = [];
        let node = home;
        while (node && node !== document.documentElement) {
          backgrounds.push(getComputedStyle(node).backgroundColor);
          node = node.parentElement;
        }
        return JSON.stringify(backgrounds) !== ${JSON.stringify(JSON.stringify(lightMainBackgrounds))}
          ? backgrounds
          : null;
      })()`,
      "Main dark theme colors",
    );
    assert.notDeepEqual(
      darkMainBackgrounds,
      lightMainBackgrounds,
      "dark mode should change Main's rendered palette",
    );

    await browser.page.evaluate(`document.querySelector('[data-testid="open-main-drawer"]').click()`);
    await browser.page.evaluate(`document.querySelector('[data-testid="drawer-open-settings"]').click()`);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="language-en"]') !== null`,
      "English language control on Settings",
    );
    await browser.page.evaluate(`document.querySelector('[data-testid="language-en"]').click()`);
    await browser.page.evaluate(`document.querySelector('[data-testid="settings-back"]').click()`);
    await waitForBrowserValue(
      browser.page,
      `(() => {
        const menu = document.querySelector('[data-testid="open-main-drawer"]');
        const home = document.querySelector('[data-testid="main-office-home"]');
        return menu?.getAttribute("aria-label") === "Open workspace menu"
          && home
          && getComputedStyle(home).direction === "ltr";
      })()`,
      "Main English LTR layout",
    );
    await browser.page.evaluate(`document.querySelector('[data-testid="main-quick-bubble"]').click()`);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="quick-message-input"]') !== null`,
      "Quick with shared English and dark preferences",
    );
    await waitForBrowserValue(
      browser.page,
      `(() => {
        const input = document.querySelector('[data-testid="quick-message-input"]');
        return input?.getAttribute("placeholder")?.includes("Write a quick request")
          && getComputedStyle(input).direction === "ltr";
      })()`,
      "Quick English LTR layout",
    );
    const quickInputColor = await browser.page.evaluate(
      `getComputedStyle(document.querySelector('[data-testid="quick-message-input"]')).color`,
    );
    await browser.page.evaluate(`document.querySelector('[data-testid="quick-open-main"]').click()`);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="main-office-home"]') !== null`,
      "Main after returning from Quick in dark mode",
    );
    const returnedMainBackgrounds = await browser.page.evaluate(mainBackgroundsScript);
    assert.deepEqual(
      returnedMainBackgrounds,
      darkMainBackgrounds,
      "the shared dark preference should still apply after switching back from Quick",
    );
    const mainBrandColor = await browser.page.evaluate(`(() => {
      const brand = document.querySelector('[data-testid="open-main-drawer-from-brand"]');
      const title = [...(brand?.querySelectorAll('*') ?? [])]
        .find((element) => element.textContent?.trim() === "Personal Secretary");
      return title ? getComputedStyle(title).color : null;
    })()`);
    assert.ok(mainBrandColor, "Main should render an English brand label with a readable foreground color");
    assert.equal(
      quickInputColor,
      mainBrandColor,
      "Quick and Main should use the same shared foreground color in dark mode",
    );
    assert.notEqual(
      mainBrandColor,
      darkMainBackgrounds.find((color) => color !== "rgba(0, 0, 0, 0)" && color !== "transparent"),
      "dark-mode text should remain distinct from the Main surface",
    );
    await browser.page.evaluate(`document.querySelector('[data-testid="open-main-drawer"]').click()`);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="drawer-logout"]') !== null`,
      "workspace drawer before logout",
    );
    await browser.page.evaluate(`document.querySelector('[data-testid="drawer-logout"]').click()`);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="auth-login-screen"]') !== null`,
      "login screen after the session is cleared",
    );
    assert.equal(
      await browser.page.evaluate("location.pathname"),
      "/auth",
      "clearing the session must remove Quick and Main from navigation",
    );
  } finally {
    browser.page.close();
    await closeProcess(browser.child);
    rmSync(browser.profile, { recursive: true, force: true });
    browser = null;
  }

  console.log(JSON.stringify({
    ok: true,
    turnPosts: counts.turns,
    approvalPosts: counts.approvals,
    covered: ["expense", "task", "reminder", "person", "project", "provenance", "language-theme"],
  }));
} finally {
  if (proxy) {
    proxy.closeAllConnections?.();
    proxy.close();
    proxy.unref();
  }
  await closeProcess(expo);
  await closeProcess(fixture);
}