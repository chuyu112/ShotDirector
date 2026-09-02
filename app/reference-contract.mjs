const kindPriority = { scene: 0, character: 1, prop: 2, extra: 3 };

/** @typedef {"scene" | "character" | "prop" | "extra"} ReferenceKind */

function hashText(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function chineseNumber(value) {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (value < 10) return digits[value];
  if (value < 20) return `十${value === 10 ? "" : digits[value - 10]}`;
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return `${digits[tens]}十${ones ? digits[ones] : ""}`;
}

/** @returns {ReferenceKind} */
function classifyReference(label) {
  if (/场景空间|空间与结构|场景参考/.test(label)) return "scene";
  if (/角色身份|人物外观|角色参考/.test(label)) return "character";
  if (/关键道具|道具外观|道具参考/.test(label)) return "prop";
  return "extra";
}

export function buildOmniReferenceBindings(references, options = {}) {
  const limit = Number.isFinite(options.limit) ? Math.max(0, options.limit) : 50;
  const deduplicated = [...new Set((Array.isArray(references) ? references : []).map((item) => String(item || "").trim()).filter(Boolean))];
  return deduplicated
    .map((label, originalIndex) => ({ id: `ref-${hashText(label)}`, label, kind: classifyReference(label), originalIndex }))
    .sort((left, right) => kindPriority[left.kind] - kindPriority[right.kind] || left.originalIndex - right.originalIndex)
    .slice(0, limit)
    .map((item, index) => ({
      id: item.id,
      label: item.label,
      kind: item.kind,
      imageIndex: index + 1,
      token: `@图片${chineseNumber(index + 1)}`,
    }));
}

export function referenceSignature(bindings) {
  return `refs-${hashText((bindings || []).map((item) => `${item.id}:${item.imageIndex}`).join("|"))}`;
}

export function validatePromptReferenceCoverage(prompt, bindings) {
  const text = String(prompt || "");
  const expected = new Set((bindings || []).map((item) => item.token));
  const mentioned = new Set(text.match(/@图片(?:[一二三四五六七八九十]+|\d+)/g) || []);
  return {
    missing: [...expected].filter((token) => !mentioned.has(token)),
    unknown: [...mentioned].filter((token) => !expected.has(token)),
    valid: [...expected].every((token) => mentioned.has(token)) && [...mentioned].every((token) => expected.has(token)),
  };
}

export function remapPromptReferenceTokens(prompt, previousBindings, nextBindings) {
  const placeholders = new Map();
  let output = String(prompt || "");
  for (const binding of previousBindings || []) {
    const placeholder = `__SHOTDIRECTOR_REF_${hashText(binding.id)}__`;
    placeholders.set(placeholder, binding.id);
    output = output.split(binding.token).join(placeholder);
  }
  const nextById = new Map((nextBindings || []).map((item) => [item.id, item.token]));
  const unresolved = [];
  for (const [placeholder, id] of placeholders) {
    const token = nextById.get(id);
    if (token) output = output.split(placeholder).join(token);
    else {
      unresolved.push(id);
      output = output.split(placeholder).join("[参考图已移除]");
    }
  }
  return { prompt: output, unresolved };
}
