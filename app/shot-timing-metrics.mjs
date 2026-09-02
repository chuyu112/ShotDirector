export function dialogueMetrics(text) {
  const spoken = String(text || "").split(/｜\s*中文备注[：:]/)[0]
    .replace(/（[^）]*仅制作备注[^）]*）/g, "").trim();
  if (/^(?:无|无对白|无台词|无旁白|静默|沉默|none|silent)[。.]?$/i.test(spoken)
    || /原作画格，剧情与构图以裁图为准|待(?:逐格|识别|确认|核对)|尚未识别/.test(spoken)) {
    return { characters: 0, words: 0, seconds: 0 };
  }
  const visible = spoken.replace(/[\p{P}\p{Z}\s]/gu, "");
  const characters = [...visible].length;
  const words = (spoken.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) || []).length;
  const seconds = /[ぁ-んァ-ヶー]/.test(visible) ? characters / 7
    : /\p{Script=Han}/u.test(visible) ? characters / 4
      : words / 2.5;
  return { characters, words, seconds };
}

/** Planning heuristic, not a measured performance: show its basis in the UI. */
export function visualTimingMetrics(panelCount, segmentCount = 0, speakerChanges = 0) {
  const count = Math.max(1, Math.trunc(segmentCount || panelCount || 1));
  const visualSeconds = 2 + Math.max(0, count - 1) * 2;
  const actionReactionSeconds = 0.8 + Math.max(0, count - 1) * 0.35 + speakerChanges * 0.25;
  return { segmentCount: count, estimatedFromPanels: !segmentCount, visualSeconds, actionReactionSeconds };
}
