export const projectSaveTimeoutMs = 20_000;

// One deadline covers the event handler, request bodies and all save steps.
// Abort the pending request too; never report a late response as a new success.
export function requestProjectSave(target, eventName, { timeoutMs = projectSaveTimeoutMs, onProgress = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    const finish = (error, message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error instanceof Error ? error : new Error(String(error)));
      else resolve(message || "项目已保存");
    };
    const timer = setTimeout(() => {
      const error = new Error("保存超时，尚未确认全部写入。当前页面内容保留，请检查连接后重试；不要重复生成素材。");
      finish(error);
      controller.abort(error);
    }, timeoutMs);
    const detail = {
      handled: false,
      signal: controller.signal,
      onProgress: (message) => { if (!settled) onProgress(message); },
      resolve: (message) => finish(null, message),
      reject: (message) => finish(message),
    };
    try {
      target.dispatchEvent(new CustomEvent(eventName, { detail }));
      if (!detail.handled) finish(new Error("项目工作区尚未准备好"));
    } catch (error) { finish(error); }
  });
}

// Snapshot is an immutable save input, never state to reapply on completion.
// AI results and user edits may arrive while these requests are in flight.
export async function persistProjectSnapshot({ fetcher, apiBase, snapshot, scopeId, storageKey, appliedAgentRevision, pairingToken, materialDraftMode, workspaceScope, serverProjectId, signal, onProgress = () => {} }) {
  async function post(path, body, stage) {
    signal?.throwIfAborted();
    onProgress(stage);
    const response = await fetcher(`${apiBase}${path}`, {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", "X-Manjing-Token": pairingToken },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    signal?.throwIfAborted();
    if (!response.ok || result.status === "agent-revision-required") {
      throw new Error(result.error || `${stage}失败，请检查连接或加载最新版本后重试。`);
    }
    return result;
  }
  await post("/draft-state", { scopeId, storageKey, state: snapshot, appliedAgentRevision }, "正在保存项目内容…");
  if (!materialDraftMode) {
    await post("/source-global-settings", { projectTitle: snapshot.projectTitle, workspaceScope, settings: snapshot.globalSettings }, "正在保存项目设定…");
  }
  let savedProjectName = snapshot.projectTitle;
  if (serverProjectId) {
    const result = await post("/projects/rename", {
      projectId: serverProjectId,
      name: snapshot.projectTitle,
      appendDate: true,
    }, "正在保存项目名称…");
    savedProjectName = result?.project?.name || savedProjectName;
  }
  return `项目《${savedProjectName}》已保存${serverProjectId ? "到服务器" : "到本地"}`;
}
