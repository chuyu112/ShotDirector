const DEFINITIONS = Object.freeze([
  {
    id: "codex-gpt-5.6-sol",
    label: "Codex · GPT-5.6 Sol",
    hint: "超级管理员专用 · 多模态",
    provider: "codex",
    transport: "codex-cli",
    supportsImages: true,
    supportsWebSearch: true,
    reviewEnabled: true,
    restrictedToSuperadmin: true,
    commandVars: ["MANJING_CODEX_BIN"],
    homeVars: ["MANJING_CODEX_HOME"],
    modelVars: ["MANJING_CODEX_MODEL"],
  },
  {
    id: "glm-5.3-flash",
    label: "GLM-5.3-Flash",
    hint: "默认 · 多模态",
    provider: "glm",
    transport: "chat-completions",
    compatibleKind: "glm",
    supportsImages: true,
    reviewEnabled: false,
    baseVars: ["MANJING_GLM_BASE_URL", "MANJING_GLM_API_URL", "GLM_API_URL"],
    keyVars: ["MANJING_GLM_API_KEY", "GLM_API_KEY"],
    modelVars: ["MANJING_GLM_FLASH_MODEL", "GLM_FLASH_MODEL", "MANJING_GLM_MODEL"],
  },
  {
    id: "kimi-k3",
    label: "Kimi K3",
    hint: "聊天与创作 · 多模态",
    provider: "kimi",
    transport: "chat-completions",
    compatibleKind: "kimi",
    supportsImages: true,
    reviewEnabled: true,
    baseVars: ["MANJING_KIMI_BASE_URL", "MANJING_KIMI_API_URL", "KIMI_API_URL"],
    keyVars: ["MANJING_KIMI_API_KEY", "KIMI_API_KEY"],
    modelVars: ["MANJING_KIMI_MODEL", "KIMI_MODEL"],
  },
  {
    id: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    hint: "稳定长文",
    provider: "openai-compatible-responses",
    transport: "responses",
    supportsImages: false,
    reviewEnabled: false,
    baseVars: ["MANJING_OPENAI_API_URL", "MANJING_OPENAI_BASE_URL", "OPENAI_API_URL", "OPENAI_BASE_URL"],
    keyVars: ["MANJING_OPENAI_API_KEY", "OPENAI_API_KEY"],
    modelVars: ["MANJING_OPENAI_MODEL", "OPENAI_MODEL"],
  },
  {
    id: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    hint: "快速文字创作",
    provider: "deepseek",
    transport: "chat-completions",
    compatibleKind: "deepseek",
    supportsImages: false,
    reviewEnabled: false,
    baseVars: ["MANJING_DEEPSEEK_BASE_URL", "MANJING_DEEPSEEK_API_URL", "DEEPSEEK_API_URL"],
    keyVars: ["MANJING_DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY"],
    modelVars: ["MANJING_DEEPSEEK_MODEL", "DEEPSEEK_MODEL"],
  },
  {
    id: "seed-2.1-pro",
    label: "Seed 2.1 Pro",
    hint: "长篇文字与创意写作",
    provider: "doubao-responses",
    transport: "doubao-responses",
    supportsImages: false,
    reviewEnabled: true,
    baseVars: ["MANJING_DOUBAO_BASE_URL", "MANJING_DOUBAO_API_URL", "DOUBAO_API_URL"],
    keyVars: ["MANJING_DOUBAO_API_KEY", "DOUBAO_API_KEY"],
    modelVars: ["MANJING_DOUBAO_MODEL", "DOUBAO_MODEL"],
  },
  {
    id: "glm-5.3",
    label: "GLM 5.3",
    hint: "严格审核 · 文字推理",
    provider: "glm",
    transport: "chat-completions",
    compatibleKind: "glm",
    supportsImages: false,
    reviewEnabled: true,
    baseVars: ["MANJING_GLM_BASE_URL", "MANJING_GLM_API_URL", "GLM_API_URL"],
    keyVars: ["MANJING_GLM_API_KEY", "GLM_API_KEY"],
    modelVars: ["MANJING_GLM_REVIEW_MODEL", "GLM_MODEL"],
  },
  {
    id: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    hint: "复杂写作与严格审核",
    provider: "openai-compatible-responses",
    transport: "responses",
    supportsImages: true,
    reviewEnabled: true,
    baseVars: ["MANJING_OPENAI_API_URL", "MANJING_OPENAI_BASE_URL", "OPENAI_API_URL", "OPENAI_BASE_URL"],
    keyVars: ["MANJING_OPENAI_API_KEY", "OPENAI_API_KEY"],
    modelVars: ["MANJING_OPENAI_SOL_MODEL", "OPENAI_SOL_MODEL"],
    enabledVar: "MANJING_OPENAI_SOL_ENABLED",
    disabledReason: "当前代理账号尚未开通 GPT-5.6 Sol",
  },
  {
    id: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    hint: "复杂文字创作与严格审核",
    provider: "deepseek",
    transport: "chat-completions",
    compatibleKind: "deepseek",
    supportsImages: false,
    reviewEnabled: true,
    baseVars: ["MANJING_DEEPSEEK_BASE_URL", "MANJING_DEEPSEEK_API_URL", "DEEPSEEK_API_URL"],
    keyVars: ["MANJING_DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY"],
    modelVars: ["MANJING_DEEPSEEK_PRO_MODEL", "DEEPSEEK_PRO_MODEL"],
  },
]);

function firstConfigured(env, names) {
  for (const name of names) {
    const value = String(env?.[name] || "").trim();
    if (value) return { name, value };
  }
  return { name: names[0], value: "" };
}

export function textModelDefinition(modelId) {
  return DEFINITIONS.find((item) => item.id === modelId) || null;
}

export function textModelConfig(modelId, env = process.env) {
  const definition = textModelDefinition(modelId);
  if (!definition) return null;
  if (definition.transport === "codex-cli") {
    const command = firstConfigured(env, definition.commandVars);
    const codexHome = firstConfigured(env, definition.homeVars);
    const model = firstConfigured(env, definition.modelVars);
    const enabled = /^(?:1|true|yes|on)$/i.test(String(env?.MANJING_CODEX_ENABLED || "").trim());
    const tenantId = String(env?.MANJING_TENANT_ID || "").trim();
    const tenantRole = String(env?.MANJING_TENANT_ROLE || "").trim().toLowerCase();
    const allowedTenantIds = new Set(String(env?.MANJING_CODEX_ALLOWED_TENANT_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean));
    const tenantAllowed = Boolean(tenantRole === "superadmin" && tenantId && allowedTenantIds.has(tenantId));
    const missing = [
      ...(!command.value ? [definition.commandVars.join(" / ")] : []),
      ...(!codexHome.value ? [definition.homeVars.join(" / ")] : []),
      ...(!model.value ? [definition.modelVars.join(" / ")] : []),
    ];
    return {
      ...definition,
      command: command.value,
      codexHome: codexHome.value,
      model: model.value,
      configured: enabled && tenantAllowed && missing.length === 0,
      reason: !enabled
        ? "服务器 Codex 尚未启用"
        : !tenantAllowed
          ? "仅超级管理员可使用"
          : missing.length ? `未配置 ${missing.join("、")}` : undefined,
      resolvedFrom: {
        command: command.name,
        codexHome: codexHome.name,
        model: model.name,
        enabled: "MANJING_CODEX_ENABLED",
        tenantRole: "MANJING_TENANT_ROLE",
        allowedTenantIds: "MANJING_CODEX_ALLOWED_TENANT_IDS",
      },
    };
  }
  const baseUrl = firstConfigured(env, definition.baseVars);
  const apiKey = firstConfigured(env, definition.keyVars);
  const model = firstConfigured(env, definition.modelVars);
  const explicitlyDisabled = definition.enabledVar
    ? /^(?:0|false|no|off)$/i.test(String(env?.[definition.enabledVar] || "").trim())
    : false;
  const missing = [
    ...(!baseUrl.value ? [definition.baseVars.join(" / ")] : []),
    ...(!apiKey.value ? [definition.keyVars.join(" / ")] : []),
    ...(!model.value ? [definition.modelVars.join(" / ")] : []),
  ];
  return {
    ...definition,
    baseUrl: baseUrl.value,
    apiKey: apiKey.value,
    model: model.value,
    configured: missing.length === 0 && !explicitlyDisabled,
    reason: explicitlyDisabled
      ? definition.disabledReason
      : missing.length ? `未配置 ${missing.join("、")}` : undefined,
    resolvedFrom: {
      baseUrl: baseUrl.name,
      apiKey: apiKey.name,
      model: model.name,
      ...(definition.enabledVar ? { enabled: definition.enabledVar } : {}),
    },
  };
}

export function textModelConfigs(env = process.env) {
  return DEFINITIONS.map((definition) => textModelConfig(definition.id, env));
}

export function reviewModelConfigs(env = process.env) {
  return textModelConfigs(env).filter((model) => model.reviewEnabled);
}

export const textModelCatalog = DEFINITIONS.map((definition) => ({
  id: definition.id,
  label: definition.label,
  hint: definition.hint,
  provider: definition.provider,
  transport: definition.transport,
  supportsImages: definition.supportsImages,
  reviewEnabled: definition.reviewEnabled,
}));
