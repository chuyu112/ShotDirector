/**
 * Compatibility boundary for media-analysis results.
 *
 * Historical draft-specific repairs were intentionally removed when the old
 * manga project was deleted. New imports must be correct by construction and
 * must never be rewritten according to another project's request id.
 */
export function repairKnownMangaPanelCoverage(result) {
  return {
    result,
    repairedPanelIds: [],
    changed: false,
    changedShotIds: [],
    shotIdMap: {},
  };
}
