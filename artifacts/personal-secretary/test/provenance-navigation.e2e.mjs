import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
  if (child.exitCode !== null) return;
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