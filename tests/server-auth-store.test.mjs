import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  AuthAuthenticationError,
  AuthAuthorizationError,
  AuthConflictError,
  AuthStoreError,
  ManjingAuthStore,
  clearSessionCookie,
  createAuthApiAdapter,
  readSessionToken,
  serializeSessionCookie,
} from "../server/auth-store.mjs";

function createFixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "manjing-auth-"));
  const filename = join(directory, "auth.sqlite");
  const store = new ManjingAuthStore({ filename, ...options });
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { store, filename };
}

async function register(store, suffix = "one") {
  return store.registerUser({
    email: `${suffix}@example.com`,
    displayName: `用户 ${suffix}`,
    password: "correct-horse-42",
  });
}

test("initializes SQLite with WAL, foreign keys and tenant tables", (t) => {
  const { store, filename } = createFixture(t);
  assert.deepEqual(store.inspectHealth(), {
    journalMode: "wal",
    foreignKeysEnabled: true,
    schemaVersion: 4,
  });

  const inspection = new DatabaseSync(filename);
  t.after(() => inspection.close());
  const tables = inspection
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => row.name);
  assert.ok(tables.includes("users"));
  assert.ok(tables.includes("projects"));
  assert.ok(tables.includes("sessions"));
  assert.ok(tables.includes("resource_owners"));
  assert.ok(tables.includes("usage_counters"));
  assert.ok(tables.includes("global_usage_counters"));
  assert.equal(statSync(filename).mode & 0o777, 0o600);
  assert.equal(statSync(dirname(filename)).mode & 0o777, 0o700);
  for (const sidecar of [`${filename}-wal`, `${filename}-shm`]) {
    if (existsSync(sidecar)) assert.equal(statSync(sidecar).mode & 0o777, 0o600);
  }
});

test("accepts platform temp aliases but rejects symlinks and escapes inside the auth data root", () => {
  const directory = mkdtempSync(join(tmpdir(), "manjing-auth-path-"));
  try {
    const dataRoot = join(directory, "private-auth");
    const outside = join(directory, "outside");
    mkdirSync(dataRoot, { mode: 0o700 });
    mkdirSync(outside, { mode: 0o700 });
    symlinkSync(outside, join(dataRoot, "linked"), "dir");

    assert.throws(
      () => new ManjingAuthStore({
        filename: join(dataRoot, "linked", "auth.sqlite"),
        dataRoot,
      }),
      AuthStoreError,
    );
    assert.throws(
      () => new ManjingAuthStore({
        filename: join(dataRoot, "..", "outside", "auth.sqlite"),
        dataRoot,
      }),
      AuthStoreError,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migrates schema v3 users to the default user role without losing the account", () => {
  const directory = mkdtempSync(join(tmpdir(), "manjing-auth-role-migration-"));
  const filename = join(directory, "auth.sqlite");
  try {
    const legacy = new DatabaseSync(filename);
    legacy.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE CHECK (email = lower(trim(email))),
        display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
        password_hash BLOB NOT NULL,
        password_salt BLOB NOT NULL,
        password_scrypt_n INTEGER NOT NULL,
        password_scrypt_r INTEGER NOT NULL,
        password_scrypt_p INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;
      PRAGMA user_version = 3;
    `);
    legacy.prepare(`
      INSERT INTO users (
        id, email, display_name, password_hash, password_salt,
        password_scrypt_n, password_scrypt_r, password_scrypt_p,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "usr_legacy",
      "legacy@example.com",
      "Legacy",
      Buffer.alloc(64),
      Buffer.alloc(16),
      16_384,
      8,
      1,
      1,
      1,
    );
    legacy.close();

    const migrated = new ManjingAuthStore({ filename, dataRoot: directory });
    assert.equal(migrated.inspectHealth().schemaVersion, 4);
    assert.equal(migrated.getUserById("usr_legacy").role, "user");
    migrated.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("atomically enforces persistent per-user usage counters", async (t) => {
  const { store } = createFixture(t);
  const { user } = await register(store, "quota");
  const input = { userId: user.id, windowKey: "2026-08-28", counterType: "ai-request", limit: 2 };
  assert.deepEqual(store.consumeUsage(input), { allowed: true, used: 1, remaining: 1, limit: 2 });
  assert.deepEqual(store.consumeUsage(input), { allowed: true, used: 2, remaining: 0, limit: 2 });
  assert.deepEqual(store.consumeUsage(input), { allowed: false, used: 2, remaining: 0, limit: 2 });
  assert.equal(store.consumeUsage({ ...input, windowKey: "2026-08-29" }).allowed, true);
  assert.equal(store.cleanupUsageCounters({ beforeWindowKey: "2026-08-29" }), 1);
});

test("atomically enforces global usage and rolls back every counter when a batch is denied", async (t) => {
  const { store } = createFixture(t);
  const alice = await register(store, "quota-alice");
  const bob = await register(store, "quota-bob");
  const base = {
    windowKey: "2026-08-29",
    counterType: "ai-request",
    limit: 5,
    globalLimit: 2,
  };
  assert.equal(store.consumeUsage({ ...base, userId: alice.user.id }).allowed, true);
  assert.equal(store.consumeUsage({ ...base, userId: bob.user.id }).allowed, true);
  const deniedGlobal = store.consumeUsage({ ...base, userId: alice.user.id });
  assert.equal(deniedGlobal.allowed, false);
  assert.equal(deniedGlobal.scope, "global");
  const afterDenied = store.consumeUsage({
    ...base,
    userId: alice.user.id,
    globalLimit: 3,
  });
  assert.equal(afterDenied.used, 2);
  assert.equal(afterDenied.global.used, 3);

  const deniedBatch = store.consumeUsageBatch({
    userId: alice.user.id,
    windowKey: "2026-08-30",
    entries: [
      { counterType: "upload-count", amount: 1, limit: 10 },
      { counterType: "upload-bytes", amount: 6, limit: 5 },
    ],
  });
  assert.equal(deniedBatch.allowed, false);
  assert.equal(deniedBatch.counterType, "upload-bytes");
  assert.deepEqual(
    store.consumeUsage({
      userId: alice.user.id,
      windowKey: "2026-08-30",
      counterType: "upload-count",
      limit: 10,
    }),
    { allowed: true, used: 1, remaining: 9, limit: 10 },
  );
});

test("registers normalized users, hashes passwords and creates one default project", async (t) => {
  const { store, filename } = createFixture(t);
  const registration = await store.registerUser({
    email: "  O'Hara@Example.COM ",
    displayName: "  漫  画导演  ",
    password: "never-store-this-password",
  });

  assert.equal(registration.user.email, "o'hara@example.com");
  assert.equal(registration.user.displayName, "漫 画导演");
  assert.equal(registration.user.role, "user");
  assert.equal(registration.defaultProject.name, "我的项目");
  assert.equal(registration.defaultProject.isDefault, true);
  assert.deepEqual(store.listProjects(registration.user.id), [registration.defaultProject]);

  const inspection = new DatabaseSync(filename);
  t.after(() => inspection.close());
  const secretRow = inspection
    .prepare("SELECT password_hash, password_salt FROM users WHERE id = ?")
    .get(registration.user.id);
  assert.equal(Buffer.from(secretRow.password_hash).length, 64);
  assert.equal(Buffer.from(secretRow.password_salt).length, 16);
  assert.notEqual(
    Buffer.from(secretRow.password_hash).toString("utf8"),
    "never-store-this-password",
  );

  await assert.rejects(
    store.registerUser({
      email: "o'hara@EXAMPLE.com",
      displayName: "另一个人",
      password: "another-secure-password",
    }),
    AuthConflictError,
  );
});

test("persists a server-only superadmin role across sessions", async (t) => {
  const { store, filename } = createFixture(t);
  const registration = await register(store, "owner");
  const promoted = store.setUserRole(registration.user.id, "superadmin");
  assert.equal(promoted.role, "superadmin");
  assert.equal(store.getUserById(registration.user.id).role, "superadmin");

  const session = store.createSession({ userId: registration.user.id });
  assert.equal(session.user.role, "superadmin");
  assert.equal(store.authenticateSession(session.token, { touch: false }).user.role, "superadmin");
  assert.throws(() => store.setUserRole(registration.user.id, "owner"), AuthStoreError);

  const inspection = new DatabaseSync(filename, { readOnly: true });
  t.after(() => inspection.close());
  assert.equal(inspection.prepare("SELECT role FROM users WHERE id = ?").get(registration.user.id).role, "superadmin");
});

test("authenticates correct passwords and rejects incorrect or missing users", async (t) => {
  const { store } = createFixture(t);
  const { user } = await register(store, "login");

  assert.deepEqual(
    await store.authenticateUser({
      email: " LOGIN@EXAMPLE.COM ",
      password: "correct-horse-42",
    }),
    user,
  );
  assert.equal(
    await store.authenticateUser({
      email: "login@example.com",
      password: "wrong-password",
    }),
    null,
  );
  assert.equal(
    await store.authenticateUser({
      email: "missing@example.com",
      password: "wrong-password",
    }),
    null,
  );
});

test("stores only SHA-256 session hashes and supports secure cookie authentication", async (t) => {
  const { store, filename } = createFixture(t);
  const { user } = await register(store, "session");
  const issued = store.createSession({ userId: user.id, ttlMs: 60_000 });

  const inspection = new DatabaseSync(filename);
  t.after(() => inspection.close());
  const persisted = inspection
    .prepare("SELECT token_hash FROM sessions WHERE id = ?")
    .get(issued.session.id);
  assert.equal(
    persisted.token_hash,
    createHash("sha256").update(issued.token, "utf8").digest("hex"),
  );
  assert.notEqual(persisted.token_hash, issued.token);
  assert.equal(JSON.stringify(persisted).includes(issued.token), false);

  const cookie = serializeSessionCookie(issued.token, {
    maxAge: 60,
    expires: issued.session.expiresAt,
  });
  assert.match(cookie, /^manjing_session=/);
  assert.match(cookie, /; HttpOnly(?:;|$)/);
  assert.match(cookie, /; SameSite=Lax(?:;|$)/);
  assert.match(cookie, /; Secure(?:;|$)/);
  assert.equal(readSessionToken(cookie), issued.token);
  assert.equal(store.authenticateSession(readSessionToken(cookie)).user.id, user.id);

  const cleared = clearSessionCookie();
  assert.match(cleared, /Max-Age=0/);
  assert.match(cleared, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
});

test("expires, revokes and cleans up sessions", async (t) => {
  let now = Date.UTC(2026, 7, 28, 0, 0, 0);
  const { store } = createFixture(t, { now: () => now });
  const { user } = await register(store, "expiry");

  const expiring = store.createSession({ userId: user.id, ttlMs: 1_000 });
  assert.ok(store.authenticateSession(expiring.token));
  now += 1_000;
  assert.equal(store.authenticateSession(expiring.token), null);
  assert.equal(store.cleanupExpiredSessions(), 1);

  const revoked = store.createSession({ userId: user.id, ttlMs: 5_000 });
  assert.equal(store.revokeSession(revoked.token), true);
  assert.equal(store.revokeSession(revoked.token), false);
  assert.equal(store.authenticateSession(revoked.token), null);

  const first = store.createSession({ userId: user.id, ttlMs: 5_000 });
  const second = store.createSession({ userId: user.id, ttlMs: 5_000 });
  assert.equal(store.revokeAllSessions(user.id), 2);
  assert.equal(store.authenticateSession(first.token), null);
  assert.equal(store.authenticateSession(second.token), null);
});

test("caps active sessions and atomically enforces the project count", async (t) => {
  let now = Date.UTC(2026, 7, 29, 0, 0, 0);
  const { store } = createFixture(t, {
    now: () => now,
    maxActiveSessionsPerUser: 2,
  });
  const { user } = await register(store, "limits");
  const first = store.createSession({ userId: user.id, ttlMs: 60_000 });
  now += 1;
  const second = store.createSession({ userId: user.id, ttlMs: 60_000 });
  now += 1;
  const third = store.createSession({ userId: user.id, ttlMs: 60_000 });
  assert.equal(store.countActiveSessions(user.id), 2);
  assert.equal(store.authenticateSession(first.token), null);
  assert.ok(store.authenticateSession(second.token));
  assert.ok(store.authenticateSession(third.token));

  store.createProject({ userId: user.id, name: "第二项目", maxProjects: 2 });
  assert.throws(
    () => store.createProject({ userId: user.id, name: "第三项目", maxProjects: 2 }),
    (error) => error instanceof AuthConflictError && error.code === "PROJECT_LIMIT_REACHED",
  );
  assert.equal(store.listProjects(user.id).length, 2);
});

test("enforces project-scoped resource ownership across tenants", async (t) => {
  const { store } = createFixture(t);
  const alice = await register(store, "alice");
  const bob = await register(store, "bob");
  const alternate = store.createProject({
    userId: alice.user.id,
    name: "第二部漫画",
  });

  const owner = store.claimResource({
    userId: alice.user.id,
    projectId: alternate.id,
    resourceType: "shot",
    resourceId: "shot-'quoted-01",
  });
  assert.equal(owner.ownerUserId, alice.user.id);
  assert.equal(owner.projectId, alternate.id);
  assert.equal(
    store.canAccessResource({
      userId: alice.user.id,
      projectId: alternate.id,
      resourceType: "shot",
      resourceId: "shot-'quoted-01",
    }),
    true,
  );
  assert.equal(
    store.canAccessResource({
      userId: bob.user.id,
      projectId: bob.defaultProject.id,
      resourceType: "shot",
      resourceId: "shot-'quoted-01",
    }),
    false,
  );
  assert.throws(
    () =>
      store.assertResourceOwnership({
        userId: bob.user.id,
        resourceType: "shot",
        resourceId: "shot-'quoted-01",
      }),
    AuthAuthorizationError,
  );
  assert.throws(
    () =>
      store.claimResource({
        userId: bob.user.id,
        projectId: alternate.id,
        resourceType: "panel",
        resourceId: "panel-01",
      }),
    AuthAuthorizationError,
  );
  assert.throws(
    () =>
      store.claimResource({
        userId: bob.user.id,
        projectId: bob.defaultProject.id,
        resourceType: "shot",
        resourceId: "shot-'quoted-01",
      }),
    AuthConflictError,
  );
});

test("API adapter registers, logs in, authenticates and logs out via HttpOnly cookie", async (t) => {
  const { store } = createFixture(t);
  const api = createAuthApiAdapter(store, {
    cookie: { secure: false, sameSite: "Lax" },
    sessionTtlMs: 60_000,
  });
  const registered = await api.register({
    email: "web@example.com",
    displayName: "Web 用户",
    password: "browser-password",
  });
  assert.equal(Object.hasOwn(registered, "token"), false);
  assert.match(registered.setCookie, /HttpOnly/);
  assert.doesNotMatch(registered.setCookie, /; Secure(?:;|$)/);

  const cookieHeader = registered.setCookie.split(";", 1)[0];
  assert.equal(api.authenticate({ headers: { cookie: cookieHeader } }).user.id, registered.user.id);
  const logout = api.logout({ headers: new Headers({ cookie: cookieHeader }) });
  assert.equal(logout.revoked, true);
  assert.match(logout.setCookie, /Max-Age=0/);
  assert.equal(api.authenticate({ headers: { cookie: cookieHeader } }), null);

  await assert.rejects(
    api.login({ email: "web@example.com", password: "bad-password" }),
    AuthAuthenticationError,
  );
  const login = await api.login({
    email: "web@example.com",
    password: "browser-password",
  });
  assert.equal(login.user.id, registered.user.id);
});
