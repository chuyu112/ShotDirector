export const activeShotWorkStatuses = Object.freeze(["queued", "running"]);
export const terminalShotWorkStatuses = Object.freeze(["completed", "failed", "aborted", "interrupted"]);

export function matchesShotWorkJob(job, { projectUid = "", shotUid = "", shotId = "" } = {}) {
  if (!job) return false;
  if (projectUid && job.projectUid && job.projectUid !== projectUid) return false;
  if (shotUid && job.shotUid) return job.shotUid === shotUid;
  return Boolean(shotId) && job.shotId === shotId;
}

export function activeShotWorkJob(jobs, identity, type = "", predicate = () => true) {
  return (Array.isArray(jobs) ? jobs : []).find((job) => (
    activeShotWorkStatuses.includes(job?.status)
    && (!type || job?.type === type)
    && matchesShotWorkJob(job, identity)
    && predicate(job)
  ));
}

export function latestTerminalShotWorkJob(jobs, identity, type = "", predicate = () => true) {
  return (Array.isArray(jobs) ? jobs : [])
    .filter((job) => terminalShotWorkStatuses.includes(job?.status)
      && (!type || job?.type === type)
      && matchesShotWorkJob(job, identity)
      && predicate(job))
    .sort((left, right) => String(right.finishedAt || right.updatedAt || "").localeCompare(String(left.finishedAt || left.updatedAt || "")))[0];
}
