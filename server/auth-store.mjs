import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";

const scrypt = promisify(nodeScrypt);

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 30 * DAY_MS;
const MAX_SESSION_TTL_MS = 365 * DAY_MS;
const SESSION_TOKEN_BYTES = 32;
const PASSWORD_KEY_BYTES = 64;
const PASSWORD_SALT_BYTES = 16;
const DEFAULT_SCRYPT_PARAMS = Object.freeze({ N: 16_384, r: 8, p: 1 });
const DUMMY_PASSWORD_SALT = Buffer.from(
  "d987c2a96d693d18e76f25de18199d96",
  "hex",
);
const DUMMY_PASSWORD_HASH = Buffer.alloc(PASSWORD_KEY_BYTES, 0xa5);
const DEFAULT_COOKIE_NAME = "manjing_session";
const DEFAULT_MAX_ACTIVE_SESSIONS = 8;
const USER_ROLES = new Set(["user", "superadmin"]);
const PROJECT_SAVE_TIME_ZONE = "Asia/Shanghai";
const PROJECT_SAVE_SUFFIX_RE = /\s+\d{4}-\d{2}-\d{2}(?:\s+\(\d+\))?$/u;

export class AuthStoreError extends Error {
  constructor(message, { code = "AUTH_STORE_ERROR", status = 500, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = this.constructor.name;
    this.code = code;
    this.status = status;
  }
}

export class AuthValidationError extends AuthStoreError {
  constructor(message, options = {}) {
    super(message, { code: "AUTH_VALIDATION_ERROR", status: 400, ...options });
  }
}

export class AuthConflictError extends AuthStoreError {
  constructor(message, options = {}) {
    super(message, { code: "AUTH_CONFLICT", status: 409, ...options });
  }
}

export class AuthAuthenticationError extends AuthStoreError {
  constructor(message = "邮箱或密码不正确", options = {}) {
    super(message, { code: "AUTH_INVALID_CREDENTIALS", status: 401, ...options });
  }
}

export class AuthAuthorizationError extends AuthStoreError {
  constructor(message = "无权访问该资源", options = {}) {
    super(message, { code: "AUTH_FORBIDDEN", status: 403, ...options });
  }
}

export class AuthNotFoundError extends AuthStoreError {
  constructor(message, options = {}) {
    super(message, { code: "AUTH_NOT_FOUND", status: 404, ...options });
  }
}

export function normalizeEmail(value) {
  if (typeof value !== "string") {
    throw new AuthValidationError("邮箱必须是字符串");
  }
  const email = value.normalize("NFKC").trim().toLowerCase();
  if (
    email.length < 3 ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)
  ) {
    throw new AuthValidationError("邮箱格式不正确");
  }
  return email;
}

export function normalizeDisplayName(value) {
  if (typeof value !== "string") {
    throw new AuthValidationError("显示名必须是字符串");
  }
  const displayName = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (displayName.length < 1 || displayName.length > 80) {
    throw new AuthValidationError("显示名长度必须在 1–80 个字符之间");
  }
  return displayName;
}

function validatePassword(password) {
  if (typeof password !== "string" || password.length < 8) {
    throw new AuthValidationError("密码至少需要 8 个字符");
  }
  if (Buffer.byteLength(password, "utf8") > 1024) {
    throw new AuthValidationError("密码过长");
  }
  return password;
}

function normalizeProjectName(value) {
  if (typeof value !== "string") {
    throw new AuthValidationError("项目名必须是字符串");
  }
  const name = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (name.length < 1 || name.length > 120) {
    throw new AuthValidationError("项目名长度必须在 1–120 个字符之间");
  }
  return name;
}

function projectSaveDate(timestamp) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PROJECT_SAVE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function fitProjectName(baseName, suffix) {
  const suffixLength = Array.from(suffix).length;
  const maximumBaseLength = Math.max(1, 120 - suffixLength);
  const base = Array.from(baseName).slice(0, maximumBaseLength).join("").trimEnd();
  return `${base}${suffix}`;
}

function normalizeResourceKey(value, label) {
  if (typeof value !== "string") {
    throw new AuthValidationError(`${label}必须是字符串`);
  }
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > 160 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new AuthValidationError(`${label}不合法`);
  }
  return normalized;
}

function normalizeId(value, label) {
  if (typeof value !== "string" || !value.trim() || value.length > 160) {
    throw new AuthValidationError(`${label}不合法`);
  }
  return value.trim();
}

function normalizeUserRole(value) {
  const role = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!USER_ROLES.has(role)) {
    throw new AuthValidationError("用户角色不合法");
  }
  return role;
}

function asTimestamp(value, label) {
  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new AuthValidationError(`${label}不合法`);
  }
  return timestamp;
}

function timestampToIso(value) {
  return value == null ? null : new Date(Number(value)).toISOString();
}

function makeId(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

async function derivePasswordKey(password, salt, params = DEFAULT_SCRYPT_PARAMS) {
  const maxmem = Math.max(64 * 1024 * 1024, 128 * params.N * params.r + 1024);
  const key = await scrypt(password, salt, PASSWORD_KEY_BYTES, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem,
  });
  return Buffer.from(key);
}

function hashSessionToken(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function safeHashEquals(candidate, expected) {
  const expectedBuffer = Buffer.from(expected ?? DUMMY_PASSWORD_HASH);
  const comparableExpected =
    expectedBuffer.length === PASSWORD_KEY_BYTES
      ? expectedBuffer
      : DUMMY_PASSWORD_HASH;
  return timingSafeEqual(candidate, comparableExpected);
}

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: USER_ROLES.has(row.role) ? row.role : "user",
    createdAt: timestampToIso(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapProject(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    isDefault: Boolean(row.is_default),
    createdAt: timestampToIso(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
}

function mapGlobalFile(row, { includePayload = false } = {}) {
  if (!row) return null;
  const result = {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    createdAt: timestampToIso(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  };
  if (includePayload) result.payload = JSON.parse(row.payload_json);
  return result;
}

function mapSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: timestampToIso(row.created_at),
    expiresAt: timestampToIso(row.expires_at),
    lastSeenAt: timestampToIso(row.last_seen_at),
    revokedAt: timestampToIso(row.revoked_at),
  };
}

function mapResourceOwner(row) {
  if (!row) return null;
  return {
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    projectId: row.project_id,
    ownerUserId: row.owner_user_id,
    createdAt: timestampToIso(row.created_at),
  };
}

function isUniqueConstraintError(error) {
  return (
    error?.code === "ERR_SQLITE_ERROR" &&
    /UNIQUE constraint failed|PRIMARY KEY constraint failed/iu.test(error.message)
  );
}

function pathIsWithin(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (
    !isAbsolute(pathFromRoot) &&
    pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${sep}`)
  );
}

function tightenDatabasePermissions(filename, canonicalDataRoot) {
  if (!filename) return;
  for (const path of [filename, `${filename}-wal`, `${filename}-shm`]) {
    if (!existsSync(path)) continue;
    const metadata = lstatSync(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new AuthStoreError("认证数据库文件不能是符号链接");
    }
    if (canonicalDataRoot && !pathIsWithin(canonicalDataRoot, realpathSync(path))) {
      throw new AuthStoreError("认证数据库文件超出受信任数据目录");
    }
    chmodSync(path, 0o600);
  }
}

function positiveSafeInteger(value, fallback, label) {
  const parsed = value === undefined || value === null || value === ""
    ? fallback
    : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new AuthValidationError(`${label}必须是正整数`);
  }
  return parsed;
}

function ensureDatabaseLocation(filename, dataRoot) {
  if (filename === ":memory:" || filename.startsWith("file:")) return null;
  const absolute = resolve(filename);
  const root = resolve(dataRoot || dirname(absolute));
  const parent = dirname(absolute);
  if (!pathIsWithin(root, absolute)) {
    throw new AuthStoreError("认证数据库路径超出受信任数据目录");
  }

  // Ancestors above the configured data root may legitimately be platform
  // aliases (for example macOS /tmp -> /private/tmp). The configured root
  // itself and every descendant remain a strict no-symlink boundary.
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const rootMetadata = lstatSync(root);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new AuthStoreError("认证数据目录不能是符号链接");
  }
  chmodSync(root, 0o700);
  const canonicalRoot = realpathSync(root);

  const relativeParent = relative(root, parent);
  let current = root;
  for (const component of relativeParent.split(sep).filter(Boolean)) {
    current = join(current, component);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 });
    const metadata = lstatSync(current);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new AuthStoreError("认证数据目录内不能使用符号链接");
    }
    chmodSync(current, 0o700);
  }
  if (!pathIsWithin(canonicalRoot, realpathSync(parent))) {
    throw new AuthStoreError("认证数据库路径超出受信任数据目录");
  }
  tightenDatabasePermissions(absolute, canonicalRoot);
  return { absolute, canonicalRoot };
}

export class ManjingAuthStore {
  constructor({
    filename = process.env.MANJING_AUTH_DB_PATH ||
      resolve(process.cwd(), "work", "manjing-server", "auth.sqlite"),
    dataRoot = filename === ":memory:" || filename.startsWith("file:")
      ? null
      : dirname(resolve(filename)),
    now = Date.now,
    sessionTtlMs = DEFAULT_SESSION_TTL_MS,
    maxActiveSessionsPerUser = process.env.MANJING_MAX_ACTIVE_SESSIONS_PER_USER,
    defaultProjectName = "我的项目",
  } = {}) {
    if (typeof now !== "function") {
      throw new TypeError("now 必须是函数");
    }
    this.now = now;
    this.sessionTtlMs = this.#validateSessionTtl(sessionTtlMs);
    this.maxActiveSessionsPerUser = positiveSafeInteger(
      maxActiveSessionsPerUser,
      DEFAULT_MAX_ACTIVE_SESSIONS,
      "每用户活跃会话上限",
    );
    this.defaultProjectName = normalizeProjectName(defaultProjectName);
    this.closed = false;
    const databaseLocation = ensureDatabaseLocation(filename, dataRoot);
    this.databasePath = databaseLocation?.absolute ?? null;
    this.canonicalDataRoot = databaseLocation?.canonicalRoot ?? null;
    this.database = new DatabaseSync(filename);
    this.database.exec("PRAGMA foreign_keys = ON;");
    this.database.exec("PRAGMA busy_timeout = 5000;");
    this.database.exec("PRAGMA journal_mode = WAL;");
    this.database.exec("PRAGMA synchronous = NORMAL;");
    this.#migrate();
    tightenDatabasePermissions(this.databasePath, this.canonicalDataRoot);
  }

  #migrate() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE CHECK (email = lower(trim(email))),
        display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'superadmin')),
        password_hash BLOB NOT NULL,
        password_salt BLOB NOT NULL,
        password_scrypt_n INTEGER NOT NULL,
        password_scrypt_r INTEGER NOT NULL,
        password_scrypt_p INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
        is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (id, owner_user_id),
        FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_one_default_per_user
        ON projects(owner_user_id)
        WHERE is_default = 1;
      CREATE INDEX IF NOT EXISTS idx_projects_owner
        ON projects(owner_user_id, created_at);

      CREATE TABLE IF NOT EXISTS global_files (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (owner_user_id, name),
        FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_global_files_owner
        ON global_files(owner_user_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT NOT NULL UNIQUE,
        token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        revoked_at INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_sessions_user
        ON sessions(user_id, expires_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_expiry
        ON sessions(expires_at, revoked_at);

      CREATE TABLE IF NOT EXISTS resource_owners (
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (resource_type, resource_id),
        FOREIGN KEY (project_id, owner_user_id)
          REFERENCES projects(id, owner_user_id)
          ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_resource_owners_project
        ON resource_owners(project_id, resource_type);

      CREATE TABLE IF NOT EXISTS usage_counters (
        owner_user_id TEXT NOT NULL,
        window_key TEXT NOT NULL,
        counter_type TEXT NOT NULL,
        amount INTEGER NOT NULL CHECK (amount >= 0),
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (owner_user_id, window_key, counter_type),
        FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_usage_counters_window
        ON usage_counters(window_key, counter_type);

      CREATE TABLE IF NOT EXISTS global_usage_counters (
        window_key TEXT NOT NULL,
        counter_type TEXT NOT NULL,
        amount INTEGER NOT NULL CHECK (amount >= 0),
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (window_key, counter_type)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_global_usage_counters_window
        ON global_usage_counters(window_key, counter_type);

    `);

    const userColumns = this.database
      .prepare("PRAGMA table_info(users)")
      .all()
      .map((column) => column.name);
    if (!userColumns.includes("role")) {
      this.database.exec(`
        ALTER TABLE users
        ADD COLUMN role TEXT NOT NULL DEFAULT 'user'
          CHECK (role IN ('user', 'superadmin'));
      `);
    }
    this.database.exec("PRAGMA user_version = 4;");
  }

  #assertOpen() {
    if (this.closed) throw new AuthStoreError("认证数据库已关闭");
  }

  #timestamp() {
    return asTimestamp(this.now(), "当前时间");
  }

  #validateSessionTtl(value) {
    const ttl = Number(value);
    if (!Number.isSafeInteger(ttl) || ttl < 1_000 || ttl > MAX_SESSION_TTL_MS) {
      throw new AuthValidationError(
        `会话有效期必须在 1 秒至 ${MAX_SESSION_TTL_MS} 毫秒之间`,
      );
    }
    return ttl;
  }

  #transaction(work) {
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const value = work();
      this.database.exec("COMMIT;");
      return value;
    } catch (error) {
      try {
        this.database.exec("ROLLBACK;");
      } catch {
        // Preserve the original error if SQLite already rolled back.
      }
      throw error;
    }
  }

  inspectHealth() {
    this.#assertOpen();
    const journalMode = this.database.prepare("PRAGMA journal_mode;").get()?.journal_mode;
    const foreignKeys = this.database.prepare("PRAGMA foreign_keys;").get()?.foreign_keys;
    const schemaVersion = this.database.prepare("PRAGMA user_version;").get()?.user_version;
    return {
      journalMode: String(journalMode ?? "").toLowerCase(),
      foreignKeysEnabled: Number(foreignKeys) === 1,
      schemaVersion: Number(schemaVersion),
    };
  }

  async registerUser({ email, displayName, password, defaultProjectName } = {}) {
    this.#assertOpen();
    const normalizedEmail = normalizeEmail(email);
    const normalizedDisplayName = normalizeDisplayName(displayName);
    const validatedPassword = validatePassword(password);
    const projectName = normalizeProjectName(
      defaultProjectName ?? this.defaultProjectName,
    );
    const salt = randomBytes(PASSWORD_SALT_BYTES);
    const passwordHash = await derivePasswordKey(validatedPassword, salt);
    const now = this.#timestamp();
    const userId = makeId("usr");
    const projectId = makeId("prj");

    try {
      this.#transaction(() => {
        const existing = this.database
          .prepare("SELECT id FROM users WHERE email = ?")
          .get(normalizedEmail);
        if (existing) {
          throw new AuthConflictError("该邮箱已注册");
        }

        this.database.prepare(`
          INSERT INTO users (
            id, email, display_name, password_hash, password_salt,
            password_scrypt_n, password_scrypt_r, password_scrypt_p,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          userId,
          normalizedEmail,
          normalizedDisplayName,
          passwordHash,
          salt,
          DEFAULT_SCRYPT_PARAMS.N,
          DEFAULT_SCRYPT_PARAMS.r,
          DEFAULT_SCRYPT_PARAMS.p,
          now,
          now,
        );

        this.database.prepare(`
          INSERT INTO projects (
            id, owner_user_id, name, is_default, created_at, updated_at
          ) VALUES (?, ?, ?, 1, ?, ?)
        `).run(projectId, userId, projectName, now, now);
      });
    } catch (error) {
      if (error instanceof AuthStoreError) throw error;
      if (isUniqueConstraintError(error)) {
        throw new AuthConflictError("该邮箱已注册", { cause: error });
      }
      throw error;
    }

    return {
      user: this.getUserById(userId),
      defaultProject: this.getProjectById(projectId, { userId }),
    };
  }

  async authenticateUser({ email, password } = {}) {
    this.#assertOpen();
    const normalizedEmail = normalizeEmail(email);
    if (typeof password !== "string") {
      throw new AuthValidationError("密码必须是字符串");
    }

    const row = this.database.prepare(`
      SELECT * FROM users WHERE email = ?
    `).get(normalizedEmail);
    const salt = row ? Buffer.from(row.password_salt) : DUMMY_PASSWORD_SALT;
    const params = row
      ? {
          N: Number(row.password_scrypt_n),
          r: Number(row.password_scrypt_r),
          p: Number(row.password_scrypt_p),
        }
      : DEFAULT_SCRYPT_PARAMS;
    const candidate = await derivePasswordKey(password, salt, params);
    const valid = safeHashEquals(candidate, row?.password_hash);
    return row && valid ? mapUser(row) : null;
  }

  getUserById(userId) {
    this.#assertOpen();
    const id = normalizeId(userId, "用户 ID");
    return mapUser(
      this.database.prepare("SELECT * FROM users WHERE id = ?").get(id),
    );
  }

  getUserByEmail(email) {
    this.#assertOpen();
    return mapUser(
      this.database
        .prepare("SELECT * FROM users WHERE email = ?")
        .get(normalizeEmail(email)),
    );
  }

  setUserRole(userId, role) {
    this.#assertOpen();
    const id = normalizeId(userId, "用户 ID");
    const normalizedRole = normalizeUserRole(role);
    const result = this.database.prepare(`
      UPDATE users
      SET role = ?, updated_at = ?
      WHERE id = ?
    `).run(normalizedRole, this.#timestamp(), id);
    if (Number(result.changes) !== 1) throw new AuthNotFoundError("用户不存在");
    return this.getUserById(id);
  }

  createProject({ userId, name, maxProjects } = {}) {
    this.#assertOpen();
    const ownerUserId = normalizeId(userId, "用户 ID");
    const projectName = normalizeProjectName(name);
    const maximum = maxProjects === undefined
      ? null
      : positiveSafeInteger(maxProjects, null, "项目数量上限");
    if (!this.getUserById(ownerUserId)) {
      throw new AuthNotFoundError("用户不存在");
    }
    const now = this.#timestamp();
    const projectId = makeId("prj");
    this.#transaction(() => {
      if (maximum !== null) {
        const count = Number(this.database.prepare(
          "SELECT count(*) AS count FROM projects WHERE owner_user_id = ?",
        ).get(ownerUserId)?.count || 0);
        if (count >= maximum) {
          throw new AuthConflictError(`每个账户最多可创建 ${maximum} 个项目`, {
            code: "PROJECT_LIMIT_REACHED",
          });
        }
      }
      this.database.prepare(`
        INSERT INTO projects (
          id, owner_user_id, name, is_default, created_at, updated_at
        ) VALUES (?, ?, ?, 0, ?, ?)
      `).run(projectId, ownerUserId, projectName, now, now);
    });
    return this.getProjectById(projectId, { userId: ownerUserId });
  }

  renameProject({ userId, projectId, name } = {}) {
    this.#assertOpen();
    const ownerUserId = normalizeId(userId, "用户 ID");
    const id = normalizeId(projectId, "项目 ID");
    const projectName = normalizeProjectName(name);
    const result = this.database.prepare(`
      UPDATE projects
      SET name = ?, updated_at = ?
      WHERE id = ? AND owner_user_id = ?
    `).run(projectName, this.#timestamp(), id, ownerUserId);
    if (Number(result.changes) !== 1) throw new AuthNotFoundError("项目不存在");
    return this.getProjectById(id, { userId: ownerUserId });
  }

  saveProjectName({ userId, projectId, name } = {}) {
    this.#assertOpen();
    const ownerUserId = normalizeId(userId, "用户 ID");
    const id = normalizeId(projectId, "项目 ID");
    const requestedName = normalizeProjectName(name);
    const baseName = requestedName.replace(PROJECT_SAVE_SUFFIX_RE, "").trim() || requestedName;
    const now = this.#timestamp();
    const date = projectSaveDate(now);

    return this.#transaction(() => {
      const current = this.database.prepare(`
        SELECT * FROM projects
        WHERE id = ? AND owner_user_id = ?
      `).get(id, ownerUserId);
      if (!current) throw new AuthNotFoundError("项目不存在");

      const occupiedNames = new Set(this.database.prepare(`
        SELECT name FROM projects
        WHERE owner_user_id = ? AND id <> ?
      `).all(ownerUserId, id).map((row) => row.name));
      let sequence = 1;
      let suffix = ` ${date}`;
      let projectName = fitProjectName(baseName, suffix);
      while (occupiedNames.has(projectName)) {
        sequence += 1;
        suffix = ` ${date} (${sequence})`;
        projectName = fitProjectName(baseName, suffix);
      }

      this.database.prepare(`
        UPDATE projects
        SET name = ?, updated_at = ?
        WHERE id = ? AND owner_user_id = ?
      `).run(projectName, now, id, ownerUserId);
      return mapProject(this.database.prepare(`
        SELECT * FROM projects
        WHERE id = ? AND owner_user_id = ?
      `).get(id, ownerUserId));
    });
  }

  listGlobalFiles(userId) {
    this.#assertOpen();
    const ownerUserId = normalizeId(userId, "用户 ID");
    return this.database.prepare(`
      SELECT * FROM global_files
      WHERE owner_user_id = ?
      ORDER BY updated_at DESC, created_at ASC, id ASC
    `).all(ownerUserId).map((row) => mapGlobalFile(row));
  }

  getGlobalFile(globalFileId, { userId } = {}) {
    this.#assertOpen();
    const id = normalizeId(globalFileId, "全局文件 ID");
    const row = this.database.prepare(`
      SELECT * FROM global_files
      WHERE id = ? AND owner_user_id = ?
    `).get(id, normalizeId(userId, "用户 ID"));
    return mapGlobalFile(row, { includePayload: true });
  }

  saveGlobalFile({ userId, globalFileId, name, payload } = {}) {
    this.#assertOpen();
    const ownerUserId = normalizeId(userId, "用户 ID");
    const globalName = normalizeProjectName(name);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new AuthValidationError("全局文件内容必须是对象");
    }
    const payloadJson = JSON.stringify(payload);
    if (Buffer.byteLength(payloadJson, "utf8") > 1024 * 1024) {
      throw new AuthValidationError("全局文件超过 1MB 上限");
    }
    const now = this.#timestamp();
    const id = globalFileId ? normalizeId(globalFileId, "全局文件 ID") : makeId("gbl");
    if (globalFileId) {
      const result = this.database.prepare(`
        UPDATE global_files
        SET name = ?, payload_json = ?, updated_at = ?
        WHERE id = ? AND owner_user_id = ?
      `).run(globalName, payloadJson, now, id, ownerUserId);
      if (Number(result.changes) !== 1) throw new AuthNotFoundError("全局文件不存在");
    } else {
      this.database.prepare(`
        INSERT INTO global_files (id, owner_user_id, name, payload_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, ownerUserId, globalName, payloadJson, now, now);
    }
    return this.getGlobalFile(id, { userId: ownerUserId });
  }

  getProjectById(projectId, { userId } = {}) {
    this.#assertOpen();
    const id = normalizeId(projectId, "项目 ID");
    const row = userId
      ? this.database
          .prepare("SELECT * FROM projects WHERE id = ? AND owner_user_id = ?")
          .get(id, normalizeId(userId, "用户 ID"))
      : this.database.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    return mapProject(row);
  }

  getDefaultProject(userId) {
    this.#assertOpen();
    const ownerUserId = normalizeId(userId, "用户 ID");
    return mapProject(
      this.database
        .prepare(
          "SELECT * FROM projects WHERE owner_user_id = ? AND is_default = 1",
        )
        .get(ownerUserId),
    );
  }

  listProjects(userId) {
    this.#assertOpen();
    const ownerUserId = normalizeId(userId, "用户 ID");
    return this.database
      .prepare(`
        SELECT * FROM projects
        WHERE owner_user_id = ?
        ORDER BY is_default DESC, created_at ASC, id ASC
      `)
      .all(ownerUserId)
      .map(mapProject);
  }

  createSession({ userId, ttlMs = this.sessionTtlMs } = {}) {
    this.#assertOpen();
    const normalizedUserId = normalizeId(userId, "用户 ID");
    const ttl = this.#validateSessionTtl(ttlMs);
    const user = this.getUserById(normalizedUserId);
    if (!user) throw new AuthNotFoundError("用户不存在");

    const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
    const tokenHash = hashSessionToken(token);
    const now = this.#timestamp();
    const expiresAt = now + ttl;
    const sessionId = makeId("ses");
    this.#transaction(() => {
      this.database.prepare(`
        DELETE FROM sessions
        WHERE user_id = ?
          AND (expires_at <= ? OR revoked_at IS NOT NULL)
      `).run(normalizedUserId, now);
      const active = this.database.prepare(`
        SELECT token_hash FROM sessions
        WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
        ORDER BY last_seen_at ASC, created_at ASC, id ASC
      `).all(normalizedUserId, now);
      const revokeCount = Math.max(
        0,
        active.length - this.maxActiveSessionsPerUser + 1,
      );
      const revoke = this.database.prepare(`
        UPDATE sessions SET revoked_at = ?
        WHERE token_hash = ? AND revoked_at IS NULL
      `);
      for (const session of active.slice(0, revokeCount)) {
        revoke.run(now, session.token_hash);
      }
      this.database.prepare(`
        INSERT INTO sessions (
          id, token_hash, user_id, created_at, expires_at, last_seen_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL)
      `).run(sessionId, tokenHash, normalizedUserId, now, expiresAt, now);
    });

    const session = mapSession(
      this.database.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId),
    );
    return { token, session, user };
  }

  countActiveSessions(userId, { at = this.#timestamp() } = {}) {
    this.#assertOpen();
    return Number(this.database.prepare(`
      SELECT count(*) AS count FROM sessions
      WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
    `).get(
      normalizeId(userId, "用户 ID"),
      asTimestamp(at, "会话统计时间"),
    )?.count || 0);
  }

  authenticateSession(token, { touch = true } = {}) {
    this.#assertOpen();
    if (typeof token !== "string" || token.length < 20 || token.length > 512) {
      return null;
    }
    const tokenHash = hashSessionToken(token);
    const now = this.#timestamp();
    const row = this.database.prepare(`
      SELECT
        s.id AS session_id,
        s.user_id AS session_user_id,
        s.created_at AS session_created_at,
        s.expires_at AS session_expires_at,
        s.last_seen_at AS session_last_seen_at,
        s.revoked_at AS session_revoked_at,
        u.*
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
        AND s.revoked_at IS NULL
        AND s.expires_at > ?
    `).get(tokenHash, now);
    if (!row) return null;

    if (touch) {
      this.database
        .prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?")
        .run(now, tokenHash);
    }
    return {
      session: {
        id: row.session_id,
        userId: row.session_user_id,
        createdAt: timestampToIso(row.session_created_at),
        expiresAt: timestampToIso(row.session_expires_at),
        lastSeenAt: timestampToIso(touch ? now : row.session_last_seen_at),
        revokedAt: timestampToIso(row.session_revoked_at),
      },
      user: mapUser(row),
    };
  }

  revokeSession(token) {
    this.#assertOpen();
    if (typeof token !== "string" || !token) return false;
    const result = this.database.prepare(`
      UPDATE sessions
      SET revoked_at = COALESCE(revoked_at, ?)
      WHERE token_hash = ? AND revoked_at IS NULL
    `).run(this.#timestamp(), hashSessionToken(token));
    return Number(result.changes) > 0;
  }

  revokeSessionById(sessionId, { userId } = {}) {
    this.#assertOpen();
    const id = normalizeId(sessionId, "会话 ID");
    const now = this.#timestamp();
    const result = userId
      ? this.database.prepare(`
          UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?)
          WHERE id = ? AND user_id = ? AND revoked_at IS NULL
        `).run(now, id, normalizeId(userId, "用户 ID"))
      : this.database.prepare(`
          UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?)
          WHERE id = ? AND revoked_at IS NULL
        `).run(now, id);
    return Number(result.changes) > 0;
  }

  revokeAllSessions(userId) {
    this.#assertOpen();
    const result = this.database.prepare(`
      UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?)
      WHERE user_id = ? AND revoked_at IS NULL
    `).run(this.#timestamp(), normalizeId(userId, "用户 ID"));
    return Number(result.changes);
  }

  cleanupExpiredSessions({ before = this.#timestamp() } = {}) {
    this.#assertOpen();
    const result = this.database.prepare(`
      DELETE FROM sessions
      WHERE expires_at <= ? OR (revoked_at IS NOT NULL AND revoked_at <= ?)
    `).run(asTimestamp(before, "清理时间"), asTimestamp(before, "清理时间"));
    return Number(result.changes);
  }

  consumeUsage({
    userId,
    windowKey,
    counterType,
    amount = 1,
    limit,
    globalLimit,
  } = {}) {
    const batch = this.consumeUsageBatch({
      userId,
      windowKey,
      entries: [{ counterType, amount, limit, globalLimit }],
    });
    return batch.allowed ? batch.results[0].quota : batch.quota;
  }

  consumeUsageBatch({ userId, windowKey, entries } = {}) {
    this.#assertOpen();
    const ownerUserId = normalizeId(userId, "用户 ID");
    const normalizedWindow = normalizeResourceKey(windowKey, "用量窗口");
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > 16) {
      throw new AuthValidationError("用量计数条目不合法");
    }
    const normalizedEntries = entries.map((entry) => {
      const normalizedType = normalizeResourceKey(entry?.counterType, "用量类型");
      const increment = Number(entry?.amount ?? 1);
      const maximum = Number(entry?.limit);
      const globalMaximum = entry?.globalLimit === undefined || entry?.globalLimit === null
        ? null
        : Number(entry.globalLimit);
      if (!Number.isSafeInteger(increment) || increment < 1) throw new AuthValidationError("用量增量不合法");
      if (!Number.isSafeInteger(maximum) || maximum < 1) throw new AuthValidationError("用量上限不合法");
      if (globalMaximum !== null && (!Number.isSafeInteger(globalMaximum) || globalMaximum < 1)) {
        throw new AuthValidationError("全局用量上限不合法");
      }
      return { counterType: normalizedType, increment, maximum, globalMaximum };
    });
    if (new Set(normalizedEntries.map((entry) => entry.counterType)).size !== normalizedEntries.length) {
      throw new AuthValidationError("同一用量类型不能在一次原子计数中重复");
    }
    if (!this.getUserById(ownerUserId)) throw new AuthNotFoundError("用户不存在");

    return this.#transaction(() => {
      const evaluated = normalizedEntries.map((entry) => {
        const current = Number(this.database.prepare(`
          SELECT amount FROM usage_counters
          WHERE owner_user_id = ? AND window_key = ? AND counter_type = ?
        `).get(ownerUserId, normalizedWindow, entry.counterType)?.amount || 0);
        const globalCurrent = entry.globalMaximum === null
          ? null
          : Number(this.database.prepare(`
              SELECT amount FROM global_usage_counters
              WHERE window_key = ? AND counter_type = ?
            `).get(normalizedWindow, entry.counterType)?.amount || 0);
        return { ...entry, current, globalCurrent };
      });

      for (const entry of evaluated) {
        if (entry.current + entry.increment > entry.maximum) {
          const quota = {
            allowed: false,
            ...(entry.globalMaximum === null ? {} : { scope: "user" }),
            used: entry.current,
            remaining: Math.max(0, entry.maximum - entry.current),
            limit: entry.maximum,
            ...(entry.globalMaximum === null ? {} : {
              global: {
                used: entry.globalCurrent,
                remaining: Math.max(0, entry.globalMaximum - entry.globalCurrent),
                limit: entry.globalMaximum,
              },
            }),
          };
          return { allowed: false, counterType: entry.counterType, quota };
        }
        if (entry.globalMaximum !== null && entry.globalCurrent + entry.increment > entry.globalMaximum) {
          return {
            allowed: false,
            counterType: entry.counterType,
            quota: {
              allowed: false,
              scope: "global",
              used: entry.globalCurrent,
              remaining: Math.max(0, entry.globalMaximum - entry.globalCurrent),
              limit: entry.globalMaximum,
              user: {
                used: entry.current,
                remaining: Math.max(0, entry.maximum - entry.current),
                limit: entry.maximum,
              },
            },
          };
        }
      }

      const timestamp = this.#timestamp();
      const results = [];
      for (const entry of evaluated) {
        const next = entry.current + entry.increment;
        this.database.prepare(`
          INSERT INTO usage_counters (owner_user_id, window_key, counter_type, amount, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(owner_user_id, window_key, counter_type)
          DO UPDATE SET amount = excluded.amount, updated_at = excluded.updated_at
        `).run(ownerUserId, normalizedWindow, entry.counterType, next, timestamp);
        let quota = { allowed: true, used: next, remaining: entry.maximum - next, limit: entry.maximum };
        if (entry.globalMaximum !== null) {
          const globalNext = entry.globalCurrent + entry.increment;
          this.database.prepare(`
            INSERT INTO global_usage_counters (window_key, counter_type, amount, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(window_key, counter_type)
            DO UPDATE SET amount = excluded.amount, updated_at = excluded.updated_at
          `).run(normalizedWindow, entry.counterType, globalNext, timestamp);
          quota = {
            ...quota,
            scope: "user",
            global: {
              used: globalNext,
              remaining: entry.globalMaximum - globalNext,
              limit: entry.globalMaximum,
            },
          };
        }
        results.push({ counterType: entry.counterType, quota });
      }
      return { allowed: true, results };
    });
  }

  cleanupUsageCounters({ beforeWindowKey } = {}) {
    this.#assertOpen();
    const boundary = normalizeResourceKey(beforeWindowKey, "用量清理窗口");
    return this.#transaction(() => Number(
      this.database.prepare("DELETE FROM usage_counters WHERE window_key < ?").run(boundary).changes,
    ) + Number(
      this.database.prepare("DELETE FROM global_usage_counters WHERE window_key < ?").run(boundary).changes,
    ));
  }

  claimResource({ userId, projectId, resourceType, resourceId } = {}) {
    this.#assertOpen();
    const ownerUserId = normalizeId(userId, "用户 ID");
    const normalizedProjectId = normalizeId(projectId, "项目 ID");
    const normalizedType = normalizeResourceKey(resourceType, "资源类型");
    const normalizedResourceId = normalizeResourceKey(resourceId, "资源 ID");
    if (!this.getProjectById(normalizedProjectId, { userId: ownerUserId })) {
      throw new AuthAuthorizationError("项目不属于当前用户");
    }

    const existing = this.getResourceOwner({
      resourceType: normalizedType,
      resourceId: normalizedResourceId,
    });
    if (existing) {
      if (
        existing.ownerUserId === ownerUserId &&
        existing.projectId === normalizedProjectId
      ) {
        return existing;
      }
      throw new AuthConflictError("资源已归属其他用户或项目");
    }

    try {
      this.database.prepare(`
        INSERT INTO resource_owners (
          resource_type, resource_id, project_id, owner_user_id, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        normalizedType,
        normalizedResourceId,
        normalizedProjectId,
        ownerUserId,
        this.#timestamp(),
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AuthConflictError("资源已归属其他用户或项目", {
          cause: error,
        });
      }
      throw error;
    }
    return this.getResourceOwner({
      resourceType: normalizedType,
      resourceId: normalizedResourceId,
    });
  }

  getResourceOwner({ resourceType, resourceId } = {}) {
    this.#assertOpen();
    const type = normalizeResourceKey(resourceType, "资源类型");
    const id = normalizeResourceKey(resourceId, "资源 ID");
    return mapResourceOwner(
      this.database.prepare(`
        SELECT * FROM resource_owners
        WHERE resource_type = ? AND resource_id = ?
      `).get(type, id),
    );
  }

  canAccessResource({ userId, projectId, resourceType, resourceId } = {}) {
    this.#assertOpen();
    const owner = this.getResourceOwner({ resourceType, resourceId });
    if (!owner) return false;
    if (owner.ownerUserId !== normalizeId(userId, "用户 ID")) return false;
    return projectId
      ? owner.projectId === normalizeId(projectId, "项目 ID")
      : true;
  }

  assertResourceOwnership(input) {
    if (!this.canAccessResource(input)) {
      throw new AuthAuthorizationError();
    }
    return this.getResourceOwner(input);
  }

  close() {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }
}

function validateCookieName(name) {
  if (typeof name !== "string" || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u.test(name)) {
    throw new AuthValidationError("Cookie 名不合法");
  }
  return name;
}

function validateCookieAttribute(value, label) {
  if (
    typeof value !== "string" ||
    !value ||
    /[;\r\n\u0000]/u.test(value)
  ) {
    throw new AuthValidationError(`${label}不合法`);
  }
  return value;
}

function normalizeSameSite(value) {
  const sameSite = String(value ?? "Lax").toLowerCase();
  if (sameSite === "lax") return "Lax";
  if (sameSite === "strict") return "Strict";
  if (sameSite === "none") return "None";
  throw new AuthValidationError("SameSite 必须是 Lax、Strict 或 None");
}

export function serializeSessionCookie(
  token,
  {
    name = DEFAULT_COOKIE_NAME,
    path = "/",
    domain,
    maxAge = Math.floor(DEFAULT_SESSION_TTL_MS / 1000),
    expires,
    secure = true,
    sameSite = "Lax",
  } = {},
) {
  if (typeof token !== "string" || !token || /[;\r\n\u0000]/u.test(token)) {
    throw new AuthValidationError("会话 Token 不合法");
  }
  const cookieName = validateCookieName(name);
  const normalizedSameSite = normalizeSameSite(sameSite);
  if (normalizedSameSite === "None" && !secure) {
    throw new AuthValidationError("SameSite=None 必须搭配 Secure");
  }
  const seconds = Number(maxAge);
  if (!Number.isSafeInteger(seconds) || seconds < 0) {
    throw new AuthValidationError("Cookie Max-Age 不合法");
  }

  const attributes = [
    `${cookieName}=${encodeURIComponent(token)}`,
    `Path=${validateCookieAttribute(path, "Cookie Path")}`,
    "HttpOnly",
    `SameSite=${normalizedSameSite}`,
    `Max-Age=${seconds}`,
  ];
  if (secure) attributes.push("Secure");
  if (domain) {
    attributes.push(`Domain=${validateCookieAttribute(domain, "Cookie Domain")}`);
  }
  if (expires) {
    const expiresDate = expires instanceof Date ? expires : new Date(expires);
    if (Number.isNaN(expiresDate.getTime())) {
      throw new AuthValidationError("Cookie Expires 不合法");
    }
    attributes.push(`Expires=${expiresDate.toUTCString()}`);
  }
  return attributes.join("; ");
}

export function clearSessionCookie(options = {}) {
  return serializeSessionCookie("deleted", {
    ...options,
    maxAge: 0,
    expires: new Date(0),
  });
}

export function readSessionToken(cookieHeader, { name = DEFAULT_COOKIE_NAME } = {}) {
  const cookieName = validateCookieName(name);
  if (typeof cookieHeader !== "string" || !cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== cookieName) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function cookieHeaderFromRequest(requestOrHeaders) {
  if (!requestOrHeaders) return null;
  const headers = requestOrHeaders.headers ?? requestOrHeaders;
  if (typeof headers.get === "function") return headers.get("cookie");
  if (typeof headers.cookie === "string") return headers.cookie;
  if (typeof headers.Cookie === "string") return headers.Cookie;
  return null;
}

export function createAuthApiAdapter(
  store,
  { cookie = {}, sessionTtlMs = store?.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS } = {},
) {
  if (!store || typeof store.authenticateSession !== "function") {
    throw new TypeError("store 必须是 ManjingAuthStore 实例");
  }
  const cookieMaxAge = Math.floor(Number(sessionTtlMs) / 1000);
  const issueSession = (userId) => {
    const { token, session, user } = store.createSession({ userId, ttlMs: sessionTtlMs });
    return {
      user,
      session,
      setCookie: serializeSessionCookie(token, {
        ...cookie,
        maxAge: cookieMaxAge,
        expires: new Date(session.expiresAt),
      }),
    };
  };

  return Object.freeze({
    async register(credentials) {
      const { user, defaultProject } = await store.registerUser(credentials);
      return { ...issueSession(user.id), defaultProject };
    },

    async login(credentials) {
      const user = await store.authenticateUser(credentials);
      if (!user) throw new AuthAuthenticationError();
      return issueSession(user.id);
    },

    authenticate(requestOrHeaders) {
      const token = readSessionToken(cookieHeaderFromRequest(requestOrHeaders), cookie);
      return token ? store.authenticateSession(token) : null;
    },

    logout(requestOrHeaders) {
      const token = readSessionToken(cookieHeaderFromRequest(requestOrHeaders), cookie);
      const revoked = token ? store.revokeSession(token) : false;
      return { revoked, setCookie: clearSessionCookie(cookie) };
    },
  });
}

export const authStoreDefaults = Object.freeze({
  cookieName: DEFAULT_COOKIE_NAME,
  sessionTtlMs: DEFAULT_SESSION_TTL_MS,
});
