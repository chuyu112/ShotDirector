// Keep editing text separate from the normalized list persisted in the project.
// In particular, a trailing newline is not an empty entity to store or delete.
export function editLineListDraft(text) {
  const items = text.split(/\r\n?|\n/).map(item => item.trim()).filter(Boolean);
  return { text, source: items.join('\n'), items };
}

export function reconcileLineListDraft(draft, items) {
  const source = items.join('\n');
  return draft?.source === source ? draft : { source, text: source, items };
}
