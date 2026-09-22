import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { once } from "node:events";

const apiFixtureCwd = new URL("../../api-server/", import.meta.url).pathname;
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

async function waitForHttp(url, timeoutMs = 30_000) {
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
  child.stdout.setEncoding("utf8");
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

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: "Bearer dev-user",
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const body = await response.text();
  assert.ok(response.ok, `${options.method ?? "GET"} ${url} failed: ${response.status} ${body}`);
  return body ? JSON.parse(body) : null;
}

async function renderWithChromium(url) {
  const child = spawnProcess(chromiumPath, [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--virtual-time-budget=6000",
    "--dump-dom",
    url,
  ]);
  const [exitCode] = await once(child, "close");
  const { stdout, stderr } = child.output();
  assert.equal(exitCode, 0, `Chromium failed for ${url}:\n${stderr}`);
  return stdout;
}

class DevToolsPage {
  constructor(webSocketUrl) {
    this.socket = new WebSocket(webSocketUrl);
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
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
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? "Browser evaluation failed");
    }
    return result.result?.value;
  }

  close() {
    this.socket.close();
  }
}

async function startInteractiveChromium(url) {
  const debugPort = await freePort();
  const profile = `/tmp/personal-secretary-browser-${process.pid}-${debugPort}`;
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
    await page.send("Network.enable");
    return { child, page, profile };
  } catch (error) {
    await closeProcess(child);
    rmSync(profile, { recursive: true, force: true });
    throw error;
  }
}

async function waitForBrowserValue(page, expression, description, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await page.evaluate(expression);
    if (lastValue) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${description}. Last value: ${JSON.stringify(lastValue)}`);
}

async function exerciseFirstApprovalInBrowser(appBaseUrl, apiBaseUrl, message) {
  const browser = await startInteractiveChromium(`${appBaseUrl}/`);
  let turnPosts = 0;
  const approvalSnapshotExpression = `(() => {
    const form = document.querySelector('[data-testid^="approval-form-"]');
    if (!form) return null;
    const formId = form.getAttribute("data-testid") ?? "";
    const operationId = formId.slice("approval-form-".length);
    const card = form.closest('[data-testid^="approval-"]');
    return {
      operationId,
      cardText: card?.textContent ?? "",
      userMessages: document.querySelectorAll('[data-testid^="message-user-"]').length,
    };
  })()`;
  browser.page.on("Network.requestWillBeSent", (event) => {
    if (event.request.method === "POST" && new URL(event.request.url).pathname.endsWith("/api/turns")) {
      turnPosts += 1;
    }
  });

  try {
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="input-message"]') !== null`,
      "Home conversation composer",
    );
    const send = async () => {
      await browser.page.evaluate(`(() => {
        const input = document.querySelector('[data-testid="input-message"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
        setter.call(input, ${JSON.stringify(message)});
        input.dispatchEvent(new Event("input", { bubbles: true }));
        document.querySelector('[data-testid="button-send-message"]').click();
        return true;
      })()`);
    };
    await send();
    const firstApproval = await waitForBrowserValue(
      browser.page,
      approvalSnapshotExpression,
      "pending approval after the first request",
    );
    assert.equal(turnPosts, 1, "the first approval must be rendered without repeating /turns");
    assert.equal(firstApproval.userMessages, 1, "the first request should create one user message");

    const canonical = await jsonRequest(`${apiBaseUrl}/approvals/${firstApproval.operationId}`, {
      headers: { Authorization: "Bearer dev-user" },
    });
    assert.equal(canonical.status, "pending");
    assert.deepEqual(canonical.display.details, [
      "القيمة: ٥٠٠ EGP",
      "الوصف: دفعة إلى محمد اختبار على السكرتير",
      "الشخص: محمد اختبار",
      "المشروع: السكرتير",
    ]);
    for (const detail of canonical.display.details) assert.match(firstApproval.cardText, new RegExp(detail));
    assert.match(firstApproval.cardText, /التفاصيل المعتمدة من الخادم/);

    await waitForBrowserValue(
      browser.page,
      `(() => {
        const button = document.querySelector('[data-testid="button-confirm-approval-${firstApproval.operationId}"]');
        return Boolean(button && !button.disabled);
      })()`,
      "authoritative approval details",
    );
    await browser.page.evaluate(`document.querySelector('[data-testid="button-confirm-approval-${firstApproval.operationId}"]').click()`);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="approval-status-${firstApproval.operationId}-completed"]') !== null`,
      "completed approval status",
    );
    assert.equal(turnPosts, 1, "confirming an approval must not resend the conversational request");
    assert.match(
      await browser.page.evaluate(`document.querySelector('[data-testid="approval-status-${firstApproval.operationId}-completed"]')?.textContent ?? ""`),
      /اكتملت العملية/,
    );

    await browser.page.evaluate(`document.querySelector('[data-testid="button-new-conversation"]').click()`);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="input-message"]')?.value === ""`,
      "new conversation composer",
    );
    await send();
    const secondApproval = await waitForBrowserValue(
      browser.page,
      approvalSnapshotExpression,
      "pending approval in the second conversation",
    );
    assert.notEqual(secondApproval.operationId, firstApproval.operationId);
    assert.equal(turnPosts, 2, "the second approval should require exactly one additional request");

    await browser.page.evaluate(`document.querySelector('[data-testid="button-reject-approval-${secondApproval.operationId}"]').click()`);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="approval-status-${secondApproval.operationId}-rejected"]') !== null`,
      "rejected approval status",
    );
    assert.equal(turnPosts, 2, "rejecting an approval must not resend the conversational request");
    assert.match(
      await browser.page.evaluate(`document.querySelector('[data-testid="approval-status-${secondApproval.operationId}-rejected"]')?.textContent ?? ""`),
      /تم رفض العملية/,
    );
  } finally {
    browser.page.close();
    await closeProcess(browser.child);
    rmSync(browser.profile, { recursive: true, force: true });
  }
}

function startApiProxy(apiBaseUrl, viteBaseUrl) {
  const server = http.createServer(async (request, response) => {
    try {
      const targetBase = request.url?.startsWith("/api/") ? apiBaseUrl : viteBaseUrl;
      const target = new URL(request.url ?? "/", targetBase);
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const upstream = await fetch(target, {
        method: request.method,
        headers: Object.fromEntries(
          Object.entries(request.headers).filter(([name]) => name !== "host"),
        ),
        body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
        duplex: "half",
      });
      response.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      response.statusCode = 502;
      response.end(String(error));
    }
  });
  return server;
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

const fixture = spawnProcess(
  "../../scripts/node_modules/.bin/tsx",
  ["test/approval-fixture-harness.ts"],
  {
    cwd: apiFixtureCwd,
    env: { FIXTURE_PORT: "0", AI_PROVIDER: "development" },
  },
);

let vite;
let proxy;
try {
  const fixtureInfo = await waitForFixture(fixture);
  const apiBaseUrl = fixtureInfo.apiBaseUrl;
  const authHeaders = { Authorization: "Bearer dev-user" };

  const firstTurn = await jsonRequest(`${apiBaseUrl}/turns`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      message: fixtureInfo.firstApprovalMessage,
      conversationId: fixtureInfo.ids.conversation,
      idempotencyKey: fixtureInfo.firstApprovalRequest.body.idempotencyKey,
      channel: "main",
    }),
  });
  const operationId = firstTurn.action?.operationId;
  assert.equal(firstTurn.action?.type, "approval_required");
  assert.equal(typeof operationId, "string");

  await jsonRequest(`${apiBaseUrl}/approvals/${operationId}/approve`, {
    method: "POST",
    headers: authHeaders,
    body: "{}",
  });

  const records = await jsonRequest(`${apiBaseUrl}/records`, { headers: authHeaders });
  const createdExpense = records.expenses.find(
    (expense) => expense.description === "دفعة إلى محمد اختبار على السكرتير",
  );
  assert.ok(createdExpense, "approved fixture expense was not returned");
  assert.deepEqual(createdExpense.origin, {
    conversationId: fixtureInfo.ids.conversation,
    turnId: "1",
    operationId,
  });

  const vitePort = await freePort();
  vite = spawnProcess("pnpm", ["run", "dev"], {
    cwd: new URL("../", import.meta.url).pathname,
    env: { PORT: String(vitePort), BASE_PATH: "/", NODE_ENV: "development" },
  });
  const viteBaseUrl = `http://127.0.0.1:${vitePort}`;
  await waitForHttp(viteBaseUrl);

  proxy = startApiProxy(apiBaseUrl, viteBaseUrl);
  await new Promise((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(0, "127.0.0.1", resolve);
  });
  const proxyAddress = proxy.address();
  assert.ok(proxyAddress && typeof proxyAddress !== "string");
  const appBaseUrl = `http://127.0.0.1:${proxyAddress.port}`;

  await exerciseFirstApprovalInBrowser(
    appBaseUrl,
    apiBaseUrl,
    fixtureInfo.firstApprovalMessage,
  );

  const linkedConversationDom = await renderWithChromium(
    `${appBaseUrl}/?conversationId=${encodeURIComponent(fixtureInfo.ids.conversation)}&turnId=1`,
  );
  assert.match(linkedConversationDom, /data-highlighted="true"/);
  assert.match(linkedConversationDom, /السياق المرتبط/);

  const recordsDom = await renderWithChromium(`${appBaseUrl}/records?tab=expenses`);
  assert.match(recordsDom, new RegExp(`data-testid="link-record-origin-${createdExpense.id}"`));
  assert.match(recordsDom, /data-testid="link-record-origin-[^"]+"/);
  assert.match(recordsDom, /أضيف يدويًا أو قبل تفعيل ربط المحادثات/);
  assert.doesNotMatch(
    recordsDom,
    new RegExp(`data-testid="link-record-origin-${fixtureInfo.ids.expense}"`),
  );

  console.log(JSON.stringify({
    ok: true,
    conversationId: fixtureInfo.ids.conversation,
    turnId: createdExpense.origin.turnId,
    expenseId: createdExpense.id,
    manualExpenseHasOriginLink: false,
  }));
} finally {
  if (proxy) {
    proxy.closeAllConnections?.();
    proxy.close();
    proxy.unref();
  }
  await closeProcess(vite);
  await closeProcess(fixture);
}

process.exit(0);