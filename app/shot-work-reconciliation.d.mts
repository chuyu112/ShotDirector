export type ShotWorkIdentity = { projectUid?: string; shotUid?: string; shotId?: string };
export type ShotWorkJob = ShotWorkIdentity & { type?: string; status?: string; finishedAt?: string; updatedAt?: string };
export const activeShotWorkStatuses: readonly string[];
export const terminalShotWorkStatuses: readonly string[];
export function matchesShotWorkJob(job: ShotWorkJob | undefined, identity?: ShotWorkIdentity): boolean;
export function activeShotWorkJob<T extends ShotWorkJob>(jobs: T[] | undefined, identity: ShotWorkIdentity, type?: string, predicate?: (job: T) => boolean): T | undefined;
export function latestTerminalShotWorkJob<T extends ShotWorkJob>(jobs: T[] | undefined, identity: ShotWorkIdentity, type?: string, predicate?: (job: T) => boolean): T | undefined;
