import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  LibtvServerWorker,
  LibtvWorkerError,
  parseLibtvStdout,
} from "../server/libtv-worker.mjs";

function createChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  return child;
}

function finish(child, { stdout = "", stderr = "", code = 0, signal = null } = {}) {
  if (stdout) child.stdout.write(stdout);
  if (stderr) child.stderr.write(stderr);
  child.stdout.end();
  child.stderr.end();
  child.emit("close", code, signal);
}

async function waitUntil(predicate, message = "condition was not reached") {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return;
    await new Promise((resolveWait) => setImmediate(resolveWait));
  }
  assert.fail(message);
}

function immediateSpawn(calls, responseForCall = () => ({ stdout: "{}\n" })) {
  return (executable, args, options) => {
    const child = createChild();
    const call = { executable, args, options, child };
    calls.push(call);
    queueMicrotask(() => finish(child, responseForCall(call, calls.length - 1)));
    return child;
  };
}

test("account info uses an explicit Linux CLI path, private persistent config and an environment allowlist", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "manjing-libtv-worker-"));
  const calls = [];
  const progress = [];
  const worker = new LibtvServerWorker({
    cliPath: "/opt/libtv/bin/libtv",
    stateRoot,
    baseEnv: {
      PATH: "/usr/local/bin:/usr/bin",
      LANG: "zh_CN.UTF-8",
      HOME: "/should/not/leak",
      OPENAI_API_KEY: "server-secret",
      LIBTV_CONFIG_DIR: "/attacker/override",
    },
    spawnImpl: immediateSpawn(calls, () => ({
      stdout: '{"user":{"uuid":"u1"},"activeAccount":{"accountId":"9"}}\n',
      stderr: "[run] checking account\n",
    })),
  });

  const account = await worker.getAccountInfo({
    tenantId: "tenant-a",
    accountId: "operator-1",
    onProgress: (event) => progress.push(event),
  });

  assert.equal(account.user.uuid, "u1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, "/opt/libtv/bin/libtv");
  assert.deepEqual(calls[0].args, ["account", "info"]);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.detached, false);
  assert.match(calls[0].options.cwd, new RegExp(`${sep}tenants${sep}tenant-a${sep}accounts${sep}operator-1${sep}projects${sep}account$`));
  assert.match(calls[0].options.env.LIBTV_CONFIG_DIR, new RegExp(`${sep}tenants${sep}tenant-a${sep}accounts${sep}operator-1${sep}config$`));
  assert.equal(calls[0].options.env.PATH, "/usr/local/bin:/usr/bin");
  assert.equal(calls[0].options.env.LANG, "zh_CN.UTF-8");
  assert.equal(calls[0].options.env.HOME, undefined);
  assert.equal(calls[0].options.env.OPENAI_API_KEY, undefined);
  assert.notEqual(calls[0].options.env.LIBTV_CONFIG_DIR, "/attacker/override");
  assert.deepEqual(progress.map((event) => event.line), ["[run] checking account"]);

  await worker.getAccountInfo({ tenantId: "tenant-a", accountId: "operator-2" });
  assert.notEqual(calls[0].options.env.LIBTV_CONFIG_DIR, calls[1].options.env.LIBTV_CONFIG_DIR);
});

test("phone login is a headless two-step flow and redacts credentials from progress", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "manjing-libtv-phone-"));
  const calls = [];
  const progress = [];
  const captcha = { ticket: "captcha-secret", randstr: "rand-secret" };
  const worker = new LibtvServerWorker({
    stateRoot,
    spawnImpl: immediateSpawn(calls, (call) => ({
      stdout: `${call.options.env.LIBTV_CONFIG_DIR}/credentials.json\n`,
      stderr: `phone=13800138000 code=123456 captcha=${JSON.stringify(captcha)}\n`,
    })),
  });

  assert.deepEqual(await worker.requestPhoneCode({
    tenantId: "tenant-phone",
    accountId: "account-1",
    phone: "13800138000",
    captcha,
    onProgress: (event) => progress.push(event.line),
  }), { ok: true, stage: "code_sent" });
  assert.deepEqual(calls[0].args, [
    "login", "phone", "-p", "13800138000",
    "--captcha", JSON.stringify(captcha),
  ]);

  assert.deepEqual(await worker.completePhoneLogin({
    tenantId: "tenant-phone",
    accountId: "account-1",
    phone: "13800138000",
    code: "123456",
    onProgress: (event) => progress.push(event.line),
  }), { ok: true, stage: "authenticated" });
  assert.deepEqual(calls[1].args, ["login", "phone", "-p", "13800138000", "-c", "123456"]);
  assert.doesNotMatch(progress.join("\n"), /13800138000|123456|captcha-secret|rand-secret/);
  assert.match(progress.join("\n"), /REDACTED/);
});

test("successful SMS sends are rate limited per tenant and project without blocking CAPTCHA retry failures", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "manjing-libtv-sms-limit-"));
  const calls = [];
  let now = 1_000;
  const worker = new LibtvServerWorker({
    stateRoot,
    now: () => now,
    smsCooldownMs: 60_000,
    smsWindowMs: 180_000,
    smsMaxPerWindow: 2,
    spawnImpl: immediateSpawn(calls, () => ({ stdout: "credentials.json\n" })),
  });
  const base = { tenantId: "tenant-sms", accountId: "account-sms", phone: "13800138000" };

  await worker.requestPhoneCode({ ...base, projectId: "project-a" });
  await assert.rejects(
    () => worker.requestPhoneCode({ ...base, projectId: "project-a" }),
    (error) => {
      assert.equal(error.code, "LIBTV_SMS_RATE_LIMITED");
      assert.equal(error.statusCode, 429);
      assert.equal(error.retryAfterSeconds, 60);
      assert.match(error.message, /60 秒后重试/);
      return true;
    },
  );
  assert.equal(calls.length, 1, "a rejected request must not spawn the CLI");

  await worker.requestPhoneCode({ ...base, projectId: "project-b" });
  assert.equal(calls.length, 2, "another project has an independent SMS limit");
  now += 60_000;
  await worker.requestPhoneCode({ ...base, projectId: "project-a" });
  now += 60_000;
  await assert.rejects(
    () => worker.requestPhoneCode({ ...base, projectId: "project-a" }),
    (error) => error.code === "LIBTV_SMS_RATE_LIMITED" && error.retryAfterSeconds === 60,
  );
  now += 60_001;
  await worker.requestPhoneCode({ ...base, projectId: "project-a" });

  const captchaCalls = [];
  const captchaWorker = new LibtvServerWorker({
    stateRoot,
    now: () => now,
    smsCooldownMs: 60_000,
    spawnImpl: immediateSpawn(captchaCalls, (_call, index) => index === 0
      ? { stderr: "需要人机验证 captcha\n", code: 1 }
      : { stdout: "credentials.json\n" }),
  });
  await assert.rejects(() => captchaWorker.requestPhoneCode({ ...base, projectId: "project-c" }));
  await captchaWorker.requestPhoneCode({
    ...base,
    projectId: "project-c",
    captcha: { ticket: "captcha-ticket", randstr: "captcha-rand" },
  });
  assert.equal(captchaCalls.length, 2, "an unsuccessful CAPTCHA challenge must not consume a successful-send slot");
});

test("raw command output and CLI version do not require JSON parsing", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "manjing-libtv-raw-"));
  const calls = [];
  const worker = new LibtvServerWorker({
    stateRoot,
    spawnImpl: immediateSpawn(calls, (call) => ({
      stdout: call.args[0] === "--version" ? "1.1.3\n" : "plain-text-result\n",
    })),
  });

  assert.equal(await worker.getVersion({
    tenantId: "tenant-raw", accountId: "account-raw", projectId: "project-raw",
  }), "1.1.3");
  const raw = await worker.runCommand({
    tenantId: "tenant-raw",
    accountId: "account-raw",
    projectId: "project-raw",
    args: ["node", "list"],
    parseJson: false,
  });
  assert.equal(raw.stdout, "plain-text-result");
  assert.equal(raw.json, null);
  assert.deepEqual(calls.map((call) => call.args), [["--version"], ["node", "list"]]);
});

test("commands are serialized by tenant and project while another project can run concurrently", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "manjing-libtv-queue-"));
  const calls = [];
  const worker = new LibtvServerWorker({
    stateRoot,
    spawnImpl: (executable, args, options) => {
      const child = createChild();
      calls.push({ executable, args, options, child });
      return child;
    },
  });
  const base = { tenantId: "tenant-q", accountId: "account-q" };
  const first = worker.runCommand({ ...base, projectId: "project-a", args: ["node", "first"] });
  const second = worker.runCommand({ ...base, projectId: "project-a", args: ["node", "second"] });
  const parallel = worker.runCommand({ ...base, projectId: "project-b", args: ["node", "parallel"] });

  await waitUntil(() => calls.length === 2, "first and parallel commands should spawn");
  assert.deepEqual(new Set(calls.map((call) => call.args[1])), new Set(["first", "parallel"]));
  assert.equal(calls.some((call) => call.args[1] === "second"), false);

  for (const call of [...calls]) finish(call.child, { stdout: `{"node":"${call.args[1]}"}\n` });
  await waitUntil(() => calls.length === 3, "second command should spawn after first closes");
  assert.equal(calls[2].args[1], "second");
  finish(calls[2].child, { stdout: '{"node":"second"}\n' });

  const [firstResult, secondResult, parallelResult] = await Promise.all([first, second, parallel]);
  assert.equal(firstResult.json.node, "first");
  assert.equal(secondResult.json.node, "second");
  assert.equal(parallelResult.json.node, "parallel");
});

test("paid --run waits for the CLI terminal close event and never adds a timeout", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "manjing-libtv-paid-"));
  const calls = [];
  const worker = new LibtvServerWorker({
    stateRoot,
    spawnImpl: (executable, args, options) => {
      const child = createChild();
      calls.push({ executable, args, options, child });
      return child;
    },
  });

  let settled = false;
  const paid = worker.runPaidCommand({
    tenantId: "tenant-paid",
    accountId: "account-paid",
    projectId: "project-paid",
    args: ["node", "shot-01", "--run"],
  }).then((result) => {
    settled = true;
    return result;
  });
  await waitUntil(() => calls.length === 1);
  assert.equal(worker.status().pendingProjectQueues, 1);
  let idle = false;
  const drained = worker.whenIdle().then(() => { idle = true; });
  calls[0].child.stderr.write("[run] task=task_123 progress=50%\n");
  calls[0].child.stdout.write('{"status":"completed","taskId":"task_123"}\n');
  await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.equal(settled, false, "stdout alone is not a terminal signal");
  assert.equal(idle, false, "drain must wait for the CLI terminal close event");
  assert.equal(calls[0].options.timeout, undefined);
  assert.equal(calls[0].options.detached, false);
  finish(calls[0].child);
  assert.equal((await paid).json.status, "completed");
  await drained;
  assert.equal(worker.status().pendingProjectQueues, 0);

  await assert.rejects(() => worker.runPaidCommand({
    tenantId: "tenant-paid", accountId: "account-paid", projectId: "project-paid", args: ["node", "shot-02"],
  }), /paid 命令必须/);
  await assert.rejects(() => worker.runCommand({
    tenantId: "tenant-paid", accountId: "account-paid", projectId: "project-paid", args: ["node", "shot-02", "-r"],
  }), /runPaidCommand/);
});

test("NDJSON parsing, paid failures and unsafe paths are handled without secret leakage", async () => {
  assert.deepEqual(parseLibtvStdout('{"nodeKey":"a"}\n{"nodeKey":"b"}\n'), [
    { nodeKey: "a" },
    { nodeKey: "b" },
  ]);

  const stateRoot = await mkdtemp(join(tmpdir(), "manjing-libtv-failure-"));
  const calls = [];
  const worker = new LibtvServerWorker({
    stateRoot,
    spawnImpl: immediateSpawn(calls, () => ({
      stderr: "[run] task=task_paid_9 accepted\n504 Gateway Timeout token=super-secret phone=13800138000\n",
      code: 1,
    })),
  });

  await assert.rejects(
    () => worker.runPaidCommand({
      tenantId: "tenant-safe",
      accountId: "account-safe",
      projectId: "project-safe",
      args: ["node", "shot-9", "--run"],
    }),
    (error) => {
      assert.ok(error instanceof LibtvWorkerError);
      assert.equal(error.code, "LIBTV_PAID_TASK_CREATED");
      assert.equal(error.taskId, "task_paid_9");
      assert.equal(error.retrySafe, false);
      assert.doesNotMatch(`${error.message}\n${error.details}`, /super-secret|13800138000/);
      return true;
    },
  );

  const earlyTaskWorker = new LibtvServerWorker({
    stateRoot,
    stderrLimit: 1024,
    spawnImpl: immediateSpawn([], () => ({
      stderr: `[run] task=task_early accepted\n${"progress ".repeat(300)}\nvalidation failed\n`,
      code: 1,
    })),
  });
  await assert.rejects(
    () => earlyTaskWorker.runPaidCommand({
      tenantId: "tenant-safe", accountId: "account-safe", projectId: "project-safe", args: ["node", "shot-10", "--run"],
    }),
    (error) => error.code === "LIBTV_PAID_TASK_CREATED" && error.taskId === "task_early" && error.retrySafe === false,
  );

  const loginRequiredWorker = new LibtvServerWorker({
    stateRoot,
    spawnImpl: immediateSpawn([], () => ({ stderr: "401 unauthorized: 尚未登录\n", code: 1 })),
  });
  await assert.rejects(
    () => loginRequiredWorker.getAccountInfo({ tenantId: "tenant-safe", accountId: "account-safe" }),
    (error) => error.code === "LIBTV_LOGIN_REQUIRED",
  );

  await assert.rejects(() => worker.runCommand({
    tenantId: "../escape",
    accountId: "account-safe",
    projectId: "project-safe",
    args: ["node", "list"],
  }), /tenantId/);
  await assert.rejects(() => worker.runCommand({
    tenantId: "tenant-safe",
    accountId: "account-safe",
    projectId: "../../escape",
    args: ["node", "list"],
  }), /projectId/);
  await assert.rejects(() => worker.runCommand({
    tenantId: "tenant-safe",
    accountId: "account-safe",
    projectId: "project-safe",
    args: ["login", "web", "--open"],
  }), /不允许启动浏览器登录/);

  const spawnFailureWorker = new LibtvServerWorker({
    stateRoot,
    spawnImpl: () => {
      throw new Error("spawn failed for 13800138000 code=123456");
    },
  });
  await assert.rejects(
    () => spawnFailureWorker.completePhoneLogin({
      tenantId: "tenant-safe",
      accountId: "account-safe",
      phone: "13800138000",
      code: "123456",
    }),
    (error) => {
      assert.equal(error.code, "LIBTV_SPAWN_FAILED");
      assert.equal(error.cause, undefined);
      assert.doesNotMatch(`${error.message}\n${error.details}`, /13800138000|123456/);
      return true;
    },
  );
});
