"use client";

import { createContext, FormEvent, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

type AuthUser = {
  id: string;
  email: string;
  displayName?: string;
  role?: "user" | "superadmin";
};

type AuthProject = {
  id: string;
  name: string;
  isDefault?: boolean;
};

type SessionPayload = {
  authenticated?: boolean;
  user?: AuthUser;
  projects?: AuthProject[];
  activeProject?: AuthProject;
  serverMode?: boolean;
  error?: string;
  message?: string;
};

type GateState =
  | { status: "checking" }
  | { status: "local" }
  | { status: "guest" }
  | { status: "authenticated"; user: AuthUser; projects: AuthProject[]; activeProject: AuthProject }
  | { status: "unavailable"; message: string };

type AuthMode = "login" | "register";

export type ManjingWorkspaceScope = {
  mode: "local" | "server";
  storageScope: string;
  userId: string;
  projectId: string;
  role?: "user" | "superadmin";
};

type AuthSignal = {
  id: string;
  type: "logout" | "session-changed";
  at: number;
};

const authChannelName = "manjing-auth-session-v1";
const authStorageSignalKey = "manjing-auth-signal-v1";
export const MANJING_SESSION_INVALID_EVENT = "manjing-session-invalid";
const ManjingWorkspaceScopeContext = createContext<ManjingWorkspaceScope | null>(null);

function safeScopePart(value: string) {
  return encodeURIComponent(value.trim());
}

function serverWorkspaceScope(userId: string, projectId: string, role?: "user" | "superadmin"): ManjingWorkspaceScope {
  return {
    mode: "server",
    storageScope: `server:${safeScopePart(userId)}:project:${safeScopePart(projectId)}`,
    userId,
    projectId,
    role,
  };
}

const localWorkspaceScope: ManjingWorkspaceScope = {
  mode: "local",
  storageScope: "local",
  userId: "local",
  projectId: "local",
};

export function useManjingWorkspaceScope() {
  const scope = useContext(ManjingWorkspaceScopeContext);
  if (!scope) throw new Error("漫镜工作区租户尚未确认");
  return scope;
}

export function manjingScopedBrowserStorage(scope: ManjingWorkspaceScope) {
  if (typeof window === "undefined") throw new Error("浏览器存储尚未可用");
  if (scope.mode === "local") return window.localStorage;
  if (!scope.userId || !scope.projectId || !scope.storageScope) throw new Error("服务器租户作用域尚未确认");

  const storage = window.sessionStorage;
  const prefix = `manjing:${scope.storageScope}:`;
  return {
    getItem(key: string) {
      return storage.getItem(`${prefix}${key}`);
    },
    setItem(key: string, value: string) {
      storage.setItem(`${prefix}${key}`, value);
    },
    removeItem(key: string) {
      storage.removeItem(`${prefix}${key}`);
    },
    clear() {
      const keys: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith(prefix)) keys.push(key);
      }
      keys.forEach((key) => storage.removeItem(key));
    },
  };
}

export async function manjingSessionFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const response = await globalThis.fetch(input, { ...init, credentials: "include" });
  if (response.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new Event(MANJING_SESSION_INVALID_EVENT));
  }
  return response;
}

function responseMessage(payload: SessionPayload | undefined, fallback: string) {
  return payload?.error || payload?.message || fallback;
}

function localFallbackAllowed(serverConfigured: boolean) {
  if (serverConfigured || typeof window === "undefined") return false;
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

async function readPayload(response: Response) {
  try {
    return await response.json() as SessionPayload;
  } catch {
    return undefined;
  }
}

export function ManjingAuthGate({
  apiBase,
  serverConfigured,
  children,
}: {
  apiBase: string;
  serverConfigured: boolean;
  children: ReactNode;
}) {
  const [gate, setGate] = useState<GateState>({ status: "checking" });
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [formError, setFormError] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [projectBusy, setProjectBusy] = useState(false);
  const requestSequence = useRef(0);
  const activeSessionRequest = useRef<number | null>(null);
  const authChannel = useRef<BroadcastChannel | null>(null);
  const lastAuthSignalId = useRef("");

  const publishAuthSignal = useCallback((type: AuthSignal["type"]) => {
    const signal: AuthSignal = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type,
      at: Date.now(),
    };
    lastAuthSignalId.current = signal.id;
    authChannel.current?.postMessage(signal);
    try {
      window.localStorage.setItem(authStorageSignalKey, JSON.stringify(signal));
    } catch {
      // BroadcastChannel remains the primary cross-tab path when storage is unavailable.
    }
  }, []);

  const loadSession = useCallback(async ({
    background = false,
    force = false,
  }: { background?: boolean; force?: boolean } = {}) => {
    if (activeSessionRequest.current !== null && !force) return;
    const requestId = ++requestSequence.current;
    activeSessionRequest.current = requestId;
    if (!background) setGate({ status: "checking" });
    setFormError("");

    try {
      const response = await globalThis.fetch(`${apiBase}/auth/me`, {
        cache: "no-store",
        credentials: "include",
      });
      if (requestId !== requestSequence.current) return;

      // A local/legacy Bridge intentionally has no auth routes. Keep the
      // original single-user director desk available in that environment.
      if (response.status === 404) {
        setGate(localFallbackAllowed(serverConfigured)
          ? { status: "local" }
          : { status: "unavailable", message: "服务器尚未启用账户接口，请联系管理员。" });
        return;
      }

      const payload = await readPayload(response);
      if (requestId !== requestSequence.current) return;
      if (!response.ok) {
        if (response.status === 401) {
          setGate({ status: "guest" });
          publishAuthSignal("logout");
          return;
        }
        setGate({ status: "unavailable", message: responseMessage(payload, "暂时无法验证登录状态。") });
        return;
      }

      if (payload?.serverMode === false) {
        setGate({ status: "local" });
      } else if (payload?.authenticated && payload.user?.id && payload.user.email && payload.activeProject?.id) {
        const projects = Array.isArray(payload.projects) && payload.projects.length
          ? payload.projects
          : [payload.activeProject];
        setGate({ status: "authenticated", user: payload.user, projects, activeProject: payload.activeProject });
      } else {
        setGate({ status: "guest" });
      }
    } catch {
      if (requestId !== requestSequence.current) return;
      // Default localhost remains an offline-capable workstation. An explicit
      // server URL, however, must fail closed when its auth service is down.
      setGate(localFallbackAllowed(serverConfigured)
        ? { status: "local" }
        : { status: "unavailable", message: "无法连接漫镜服务器，请检查网络后重试。" });
    } finally {
      if (activeSessionRequest.current === requestId) activeSessionRequest.current = null;
    }
  }, [apiBase, publishAuthSignal, serverConfigured]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { void loadSession(); });
    return () => {
      window.cancelAnimationFrame(frame);
      requestSequence.current += 1;
      activeSessionRequest.current = null;
    };
  }, [loadSession]);

  useEffect(() => {
    const refresh = () => { void loadSession({ background: true }); };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadSession]);

  useEffect(() => {
    const applySignal = (signal: AuthSignal) => {
      if (!signal?.id || signal.id === lastAuthSignalId.current) return;
      if (signal.type !== "logout" && signal.type !== "session-changed") return;
      lastAuthSignalId.current = signal.id;
      if (signal.type === "logout") {
        requestSequence.current += 1;
        activeSessionRequest.current = null;
        setGate({ status: "guest" });
      } else {
        void loadSession({ force: true });
      }
    };

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(authChannelName);
      authChannel.current = channel;
      channel.addEventListener("message", (event: MessageEvent<AuthSignal>) => applySignal(event.data));
    }

    const receiveStorageSignal = (event: StorageEvent) => {
      if (event.key !== authStorageSignalKey || !event.newValue) return;
      try {
        applySignal(JSON.parse(event.newValue) as AuthSignal);
      } catch {
        // Ignore damaged or unrelated browser-storage events.
      }
    };
    const invalidateSession = () => { void loadSession({ force: true }); };
    window.addEventListener("storage", receiveStorageSignal);
    window.addEventListener(MANJING_SESSION_INVALID_EVENT, invalidateSession);
    return () => {
      window.removeEventListener("storage", receiveStorageSignal);
      window.removeEventListener(MANJING_SESSION_INVALID_EVENT, invalidateSession);
      if (authChannel.current === channel) authChannel.current = null;
      channel?.close();
    };
  }, [loadSession]);

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setFormError("");
    setPassword("");
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedName = displayName.trim();

    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setFormError("请输入有效的邮箱地址。");
      return;
    }
    if (password.length < 8) {
      setFormError("密码至少需要 8 位。");
      return;
    }
    if (mode === "register" && normalizedName.length < 2) {
      setFormError("显示名称至少需要 2 个字符。");
      return;
    }

    setSubmitting(true);
    setFormError("");
    try {
      const response = await globalThis.fetch(`${apiBase}/auth/${mode}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "register"
          ? { email: normalizedEmail, password, displayName: normalizedName }
          : { email: normalizedEmail, password }),
      });
      const payload = await readPayload(response);
      if (!response.ok) {
        setFormError(responseMessage(payload, mode === "register" ? "注册失败，请稍后重试。" : "邮箱或密码不正确。"));
        return;
      }

      setPassword("");
      publishAuthSignal("session-changed");
      window.location.reload();
    } catch {
      setFormError("无法连接漫镜服务器，请检查网络后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    setLoggingOut(true);
    setSessionError("");
    try {
      const response = await globalThis.fetch(`${apiBase}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
      const payload = await readPayload(response);
      if (!response.ok) throw new Error(responseMessage(payload, "退出失败，请重试。"));
      publishAuthSignal("logout");
      setGate({ status: "guest" });
      setMode("login");
      setEmail("");
      setPassword("");
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "退出失败，请重试。");
    } finally {
      setLoggingOut(false);
    }
  }

  async function activateProject(projectId: string) {
    setProjectBusy(true);
    setSessionError("");
    try {
      const response = await globalThis.fetch(`${apiBase}/projects/select`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const payload = await readPayload(response);
      if (!response.ok) throw new Error(responseMessage(payload, "切换项目失败，请重试。"));
      publishAuthSignal("session-changed");
      window.location.reload();
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "切换项目失败，请重试。");
      setProjectBusy(false);
    }
  }

  async function createProject() {
    const name = window.prompt("请输入新项目名称")?.trim();
    if (!name) return;
    setProjectBusy(true);
    setSessionError("");
    try {
      const response = await globalThis.fetch(`${apiBase}/projects`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = await response.json().catch(() => undefined) as { project?: AuthProject; error?: string } | undefined;
      if (!response.ok || !payload?.project?.id) throw new Error(payload?.error || "新建项目失败，请重试。");
      await activateProject(payload.project.id);
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : "新建项目失败，请重试。");
      setProjectBusy(false);
    }
  }

  if (gate.status === "local") {
    return (
      <ManjingWorkspaceScopeContext.Provider value={localWorkspaceScope}>
        {children}
      </ManjingWorkspaceScopeContext.Provider>
    );
  }

  if (gate.status === "authenticated") {
    const accountName = gate.user.displayName?.trim() || gate.user.email;
    const workspaceScope = serverWorkspaceScope(gate.user.id, gate.activeProject.id, gate.user.role);
    return (
      <ManjingWorkspaceScopeContext.Provider key={workspaceScope.storageScope} value={workspaceScope}>
        <div className="manjing-server-shell">
          <section className="manjing-server-session" aria-label="当前服务器账户">
            <div className="manjing-server-project">
              <label>
                <span>当前项目</span>
                <select
                  aria-label="切换项目"
                  value={gate.activeProject.id}
                  disabled={projectBusy}
                  onChange={(event) => void activateProject(event.target.value)}
                >
                  {gate.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </label>
              <button type="button" disabled={projectBusy} onClick={() => void createProject()}>
                {projectBusy ? "处理中…" : "新建项目"}
              </button>
            </div>
            <div className="manjing-server-account">
              <span className={gate.user.role === "superadmin" ? "superadmin-badge" : undefined}>
                {gate.user.role === "superadmin" ? "SUPER ADMIN" : "SERVER ACCOUNT"}
              </span>
              <strong>{accountName}</strong>
              {gate.user.displayName ? <small>{gate.user.email}</small> : null}
            </div>
            {sessionError ? <p role="alert">{sessionError}</p> : null}
            <button type="button" disabled={loggingOut} onClick={() => void logout()}>
              {loggingOut ? "正在退出…" : "退出登录"}
            </button>
          </section>
          {children}
        </div>
      </ManjingWorkspaceScopeContext.Provider>
    );
  }

  return (
    <main className="manjing-auth-page">
      <section className="manjing-auth-brand" aria-label="漫镜服务器版介绍">
        <div className="manjing-auth-mark" aria-hidden="true">漫镜</div>
        <p>MANJING · SERVER DIRECTOR DESK</p>
        <h1>从漫画素材，到可执行镜头。</h1>
        <p>拆图、画面分析、脚本生成、站位调度与提示词审核，都保存在你的服务器工作区。</p>
        <ol>
          <li><b>01</b><span>上传漫画与素材</span></li>
          <li><b>02</b><span>Agent 分析与拆镜</span></li>
          <li><b>03</b><span>导演审核并交付</span></li>
        </ol>
      </section>

      <section className="manjing-auth-panel" aria-live="polite">
        {gate.status === "checking" ? (
          <div className="manjing-auth-state" role="status">
            <i aria-hidden="true" />
            <span>正在连接漫镜服务器</span>
            <small>检查登录状态与工作区权限…</small>
          </div>
        ) : gate.status === "unavailable" ? (
          <div className="manjing-auth-state is-error" role="alert">
            <span>暂时无法进入工作台</span>
            <small>{gate.message}</small>
            <button type="button" onClick={() => void loadSession()}>重新连接</button>
          </div>
        ) : (
          <>
            <div className="manjing-auth-heading">
              <span>{mode === "login" ? "WELCOME BACK" : "CREATE ACCOUNT"}</span>
              <h2>{mode === "login" ? "登录漫镜" : "注册漫镜账户"}</h2>
              <p>{mode === "login" ? "继续进入你的导演项目与任务记录。" : "创建独立工作区，项目数据与任务记录按账户隔离。"}</p>
            </div>

            <div className="manjing-auth-tabs" role="tablist" aria-label="登录或注册">
              <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => switchMode("login")}>登录</button>
              <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => switchMode("register")}>注册</button>
            </div>

            <form className="manjing-auth-form" onSubmit={submitAuth}>
              {mode === "register" ? (
                <label>
                  <span>显示名称</span>
                  <input
                    name="displayName"
                    type="text"
                    autoComplete="name"
                    minLength={2}
                    maxLength={60}
                    required
                    value={displayName}
                    placeholder="导演或团队名称"
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                </label>
              ) : null}
              <label>
                <span>邮箱</span>
                <input
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  value={email}
                  placeholder="name@example.com"
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label>
                <span>密码</span>
                <input
                  name="password"
                  type="password"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  minLength={8}
                  required
                  value={password}
                  placeholder="至少 8 位"
                  onChange={(event) => setPassword(event.target.value)}
                />
                <small>至少 8 位；建议同时使用字母、数字与符号。</small>
              </label>
              {formError ? <p className="manjing-auth-error" role="alert">{formError}</p> : null}
              <button className="manjing-auth-submit" type="submit" disabled={submitting}>
                {submitting ? "正在提交…" : mode === "login" ? "登录并进入工作台" : "注册并创建工作区"}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
