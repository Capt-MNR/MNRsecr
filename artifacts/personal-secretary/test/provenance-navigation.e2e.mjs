import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

async function exerciseFirstApprovalInBrowser(appBaseUrl, apiBaseUrl, message, proxyControls) {
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
    const send = async (value = message) => {
      await browser.page.evaluate(`(() => {
        const input = document.querySelector('[data-testid="input-message"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
        setter.call(input, ${JSON.stringify(value)});
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
    assert.match(firstApproval.cardText, /محتاج موافقتك/, "the real pending approval card should be visible");

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
      `document.querySelector('[data-testid="approval-${firstApproval.operationId}"] [data-testid="operation-status-completed"]') !== null`,
      "completed approval status",
    );
    assert.equal(turnPosts, 1, "confirming an approval must not resend the conversational request");
    assert.match(
      await browser.page.evaluate(`document.querySelector('[data-testid="approval-${firstApproval.operationId}"] [data-testid="operation-status-completed"]')?.textContent ?? ""`),
      /نتيجة مكتملة/,
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
      `document.querySelector('[data-testid="approval-${secondApproval.operationId}"] [data-testid="operation-status-rejected"]') !== null`,
      "rejected approval status",
    );
    assert.equal(turnPosts, 2, "rejecting an approval must not resend the conversational request");
    assert.match(
      await browser.page.evaluate(`document.querySelector('[data-testid="approval-${secondApproval.operationId}"] [data-testid="operation-status-rejected"]')?.textContent ?? ""`),
      /تم رفض العملية/,
    );

    const startUiScenario = async (scenario) => {
      await browser.page.evaluate(`document.querySelector('[data-testid="button-new-conversation"]').click()`);
      await waitForBrowserValue(
        browser.page,
        `document.querySelector('[data-testid="input-message"]')?.value === ""`,
        `${scenario} scenario composer`,
      );
      await send(`approval-ui:${scenario}`);
      return waitForBrowserValue(
        browser.page,
        approvalSnapshotExpression,
        `${scenario} scenario approval`,
      );
    };

    const executingApproval = await startUiScenario("executing");
    await browser.page.evaluate(`document.querySelector('[data-testid="button-confirm-approval-${executingApproval.operationId}"]').click()`);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="operation-status-executing"]') !== null`,
      "executing approval status",
    );
    assert.equal(proxyControls.approvalCount(executingApproval.operationId), 1);
    proxyControls.completeExecution(executingApproval.operationId);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="operation-status-completed"]') !== null`,
      "completed result after execution",
    );

    const expiredApproval = await startUiScenario("expired");
    await browser.page.evaluate(`document.querySelector('[data-testid="button-confirm-approval-${expiredApproval.operationId}"]').click()`);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="operation-status-expired"]') !== null`,
      "expired approval result",
    );

    const failedApproval = await startUiScenario("failed");
    await browser.page.evaluate(`document.querySelector('[data-testid="button-confirm-approval-${failedApproval.operationId}"]').click()`);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="operation-status-failed"]') !== null`,
      "failed approval result",
    );

    const unknownApproval = await startUiScenario("unknown");
    await browser.page.evaluate(`document.querySelector('[data-testid="button-confirm-approval-${unknownApproval.operationId}"]').click()`);
    await waitForBrowserValue(
      browser.page,
      `document.querySelector('[data-testid="operation-status-unknown_result"]') !== null`,
      "unknown approval result",
    );
    assert.match(
      await browser.page.evaluate(`document.querySelector('[data-testid="operation-status-unknown_result"]')?.textContent ?? ""`),
      /لن أعيد التنفيذ تلقائيًا/,
    );
    const unknownApprovalCount = proxyControls.approvalCount(unknownApproval.operationId);
    const unknownGetCount = proxyControls.operationReadCount(unknownApproval.operationId);
    const unknownTurnCount = turnPosts;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    assert.equal(proxyControls.approvalCount(unknownApproval.operationId), unknownApprovalCount, "unknown outcomes must not retry the approval automatically");
    assert.equal(proxyControls.operationReadCount(unknownApproval.operationId), unknownGetCount, "unknown outcomes must not poll the executing operation automatically");
    assert.equal(turnPosts, unknownTurnCount, "unknown outcomes must not resend the conversation automatically");
  } finally {
    browser.page.close();
    await closeProcess(browser.child);
    rmSync(browser.profile, { recursive: true, force: true });
  }
}

function sendJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function startApiProxy(apiBaseUrl, viteBaseUrl, fixtureInfo) {
  const approvals = new Map();
  const controls = {
    approvalCount: (operationId) => approvals.get(operationId)?.approvalPosts ?? 0,
    operationReadCount: (operationId) => approvals.get(operationId)?.operationReads ?? 0,
    completeExecution: (operationId) => {
      const approval = approvals.get(operationId);
      assert.ok(approval, `missing browser approval fixture ${operationId}`);
      approval.status = "completed";
    },
  };
  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const pathname = requestUrl.pathname;
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks);

      // This local proxy is the test-only signed-in session; the production
      // auth routes and middleware are never modified or bypassed.
      if (request.method === "GET" && pathname === "/api/auth/me") {
        sendJson(response, 200, {
          user: {
            userId: fixtureInfo.userId,
            tenantId: fixtureInfo.tenantId,
            email: "approval-fixture@example.test",
          },
        });
        return;
      }

      if (request.method === "POST" && pathname === "/api/turns") {
        const input = body.length ? JSON.parse(body.toString("utf8")) : {};
        if (typeof input.message === "string" && input.message.startsWith("approval-ui:")) {
          const scenario = input.message.slice("approval-ui:".length);
          assert.ok(["executing", "expired", "failed", "unknown"].includes(scenario), `unexpected browser approval scenario: ${scenario}`);
          const operationId = randomUUID();
          const args = {
            amountMinor: 12_500,
            currency: "EGP",
            description: `مصروف تحقق ${scenario}`,
            personId: null,
            projectId: null,
          };
          const display = {
            title: "تأكيد مصروف الاختبار",
            details: ["القيمة: ١٢٥ EGP", `الوصف: ${args.description}`],
          };
          approvals.set(operationId, {
            scenario,
            status: "pending",
            args,
            display,
            approvalPosts: 0,
            operationReads: 0,
          });
          sendJson(response, 200, {
            conversationId: `approval-ui-${scenario}`,
            turnId: `approval-ui-turn-${scenario}`,
            assistantMessage: "راجع تفاصيل العملية قبل الموافقة.",
            response: { kind: "answer", message: "راجع تفاصيل العملية قبل الموافقة." },
            action: {
              type: "approval_required",
              operationId,
              toolName: "record_expense",
              args,
              display,
              status: "pending",
            },
            provider: "test-fixture",
            model: "deterministic",
          });
          return;
        }
      }

      const approvalMatch = pathname.match(/^\/api\/approvals\/([^/]+)(?:\/(approve|reject))?$/);
      const approval = approvalMatch ? approvals.get(approvalMatch[1]) : undefined;
      if (approvalMatch && approval) {
        const operationId = approvalMatch[1];
        const action = approvalMatch[2];
        if (request.method === "GET" && !action) {
          approval.operationReads += 1;
          sendJson(response, 200, {
            operationId,
            conversationId: `approval-ui-${approval.scenario}`,
            toolName: "record_expense",
            args: approval.args,
            display: approval.display,
            status: approval.status,
            updatedAt: new Date().toISOString(),
          });
          return;
        }
        if (request.method === "POST" && action) {
          if (action === "approve") approval.approvalPosts += 1;
          approval.status = action === "reject" ? "rejected"
            : approval.scenario === "executing" || approval.scenario === "unknown" ? "executing"
              : approval.scenario;
          if (approval.scenario === "unknown" && action === "approve") {
            sendJson(response, 504, {
              error: "Approval response timed out.",
              code: "APPROVAL_RESULT_UNKNOWN",
              category: "timeout",
              retryable: true,
            });
            return;
          }
          const status = approval.status;
          sendJson(response, 200, {
            operationId,
            conversationId: `approval-ui-${approval.scenario}`,
            turnId: `approval-ui-result-${approval.scenario}`,
            status,
            assistantMessage: status === "executing"
              ? "العملية قيد التنفيذ. لا ترسل تأكيدًا آخر."
              : status === "expired"
                ? "انتهت صلاحية طلب التأكيد، ولم يتم تنفيذ أي تغيير."
                : status === "failed"
                  ? "تعذر تنفيذ العملية. لن أعيد تشغيلها تلقائيًا."
                  : status === "rejected"
                    ? "تم إلغاء العملية، ولن يتم تنفيذ أي تغيير."
                    : "اكتملت العملية.",
            action: {
              type: `approval_${status}`,
              operationId,
              status,
              toolName: "record_expense",
            },
            provider: "test-fixture",
            model: "deterministic",
          });
          return;
        }
      }

      const targetBase = request.url?.startsWith("/api/") ? apiBaseUrl : viteBaseUrl;
      const target = new URL(request.url ?? "/", targetBase);
      const headers = Object.fromEntries(
        Object.entries(request.headers).filter(([name]) => name !== "host"),
      );
      if (pathname.startsWith("/api/") && !headers.authorization) {
        // The fixture server accepts this development identity only in its
        // explicitly development-mode process and scoped fixture tenant.
        headers.authorization = fixtureInfo.authHeader;
      }
      const upstream = await fetch(target, {
        method: request.method,
        headers,
        body: body.length > 0 ? body : undefined,
        duplex: "half",
      });
      response.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      response.statusCode = 502;
      response.end(String(error));
    }
  });
  return { server, controls };
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
    env: { FIXTURE_PORT: "0", AI_PROVIDER: "development", NODE_ENV: "development" },
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

  const apiProxy = startApiProxy(apiBaseUrl, viteBaseUrl, fixtureInfo);
  proxy = apiProxy.server;
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
    apiProxy.controls,
  );

  const recordsBrowser = await startInteractiveChromium(`${appBaseUrl}/records?tab=expenses`);
  try {
    const originLinkTestId = `link-record-origin-${createdExpense.id}`;
    await waitForBrowserValue(
      recordsBrowser.page,
      `document.querySelector('[data-testid="${originLinkTestId}"]') !== null`,
      "origin conversation action on the linked record",
    );
    const originAction = await recordsBrowser.page.evaluate(`(() => {
      const action = document.querySelector('[data-testid="${originLinkTestId}"]');
      const manualCard = [...document.querySelectorAll('article')]
        .find((card) => card.textContent?.includes(${JSON.stringify("مصروف الاختبار")}));
      return {
        actionText: action?.textContent ?? "",
        manualHasUnlinkedState: Boolean(manualCard?.textContent?.includes("أضيف يدويًا أو قبل تفعيل ربط المحادثات")),
        manualHasOriginAction: Boolean(manualCard?.querySelector('[data-testid^="link-record-origin-"]')),
      };
    })()`);
    assert.match(originAction.actionText, /فتح المحادثة الأصلية/);
    assert.equal(originAction.manualHasUnlinkedState, true);
    assert.equal(originAction.manualHasOriginAction, false);

    await recordsBrowser.page.evaluate(`document.querySelector('[data-testid="${originLinkTestId}"]').click()`);
    const expectedConversationQuery = `conversationId=${encodeURIComponent(fixtureInfo.ids.conversation)}&turnId=1`;
    await waitForBrowserValue(
      recordsBrowser.page,
      `window.location.pathname === "/" && window.location.search.includes(${JSON.stringify(expectedConversationQuery)})`,
      "navigation to the originating conversation and turn",
    );
    const highlightedTurn = await waitForBrowserValue(
      recordsBrowser.page,
      `(() => {
        const message = document.querySelector('[data-highlighted="true"]');
        return message?.getAttribute("data-turn-id") === "1"
          && message.textContent?.includes("دفعت لمحمد اختبار 500 جنيه في مشروع السكرتير")
          && message.textContent?.includes("السياق المرتبط");
      })()`,
      "highlighted originating conversation turn",
    );
    assert.equal(highlightedTurn, true);
  } finally {
    recordsBrowser.page.close();
    await closeProcess(recordsBrowser.child);
    rmSync(recordsBrowser.profile, { recursive: true, force: true });
  }

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