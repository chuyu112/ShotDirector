/** Move existing panels only; append as a block without reordering either block. */
export function planPanelDrop(panelGroups, requestedIds, target) {
  const originalOrder = panelGroups.flat();
  const requested = new Set(requestedIds);
  const draggedIds = originalOrder.filter((id) => requested.has(id));
  const creating = target.createShotAt !== undefined;
  if (!draggedIds.length || (creating
    ? !Number.isInteger(target.createShotAt) || target.createShotAt < 0 || target.createShotAt > panelGroups.length
    : !panelGroups[target.reviewIndex])) return null;

  const dragged = new Set(draggedIds);
  const withinGroup = !creating && draggedIds.every((id) => panelGroups[target.reviewIndex].includes(id));
  if (withinGroup) return null;
  let groups = panelGroups.map((ids, originIndex) => ({
    originIndex,
    panelIds: ids.filter((id) => !dragged.has(id)),
  }));
  let destination;
  if (creating) {
    groups = groups.filter((group) => group.panelIds.length);
    const index = groups.filter((group) => group.originIndex < target.createShotAt).length;
    destination = { originIndex: -1, panelIds: draggedIds };
    groups.splice(index, 0, destination);
  } else {
    destination = groups[target.reviewIndex];
    // A selection may include destination cards. Keep those in place, append only newcomers.
    destination.panelIds = [
      ...panelGroups[target.reviewIndex],
      ...draggedIds.filter((id) => !panelGroups[target.reviewIndex].includes(id)),
    ];
    groups = groups.filter((group) => group.panelIds.length);
  }
  if (JSON.stringify(groups.map((group) => group.panelIds)) === JSON.stringify(panelGroups)) return null;
  return { groups, targetIndex: groups.indexOf(destination), draggedIds, creating };
}
