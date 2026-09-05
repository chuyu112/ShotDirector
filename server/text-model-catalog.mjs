const DEFINITIONS = Object.freeze([
  {
    id: "glm-5.3-flash",
    label: "GLM-5.3-Flash",
    hint: "默认 · 多模态",
    provider: "glm",
    transport: "chat-completions",
    compatibleKind: "glm",
    supportsImages: true,
    writingEnabled: true,
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
    writingEnabled: true,
    reviewEnabled: true,
    baseVars: ["MANJING_KIMI_BASE_URL", "MANJING_KIMI_API_URL", "KIMI_API_URL"],
    keyVars: ["MANJING_KIMI_API_KEY", "KIMI_API_KEY"],
    modelVars: ["MANJING_KIMI_MODEL", "KIMI_MODEL"],
  },
  {
    id: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    hint: "快速文字创作",
    provider: "deepseek",
    transport: "chat-completions",
    compatibleKind: "deepseek",
    supportsImages: false,
    writingEnabled: true,
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
    writingEnabled: true,
    reviewEnabled: false,
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
    writingEnabled: false,
    reviewEnabled: true,
    baseVars: ["MANJING_GLM_BASE_URL", "MANJING_GLM_API_URL", "GLM_API_URL"],
    keyVars: ["MANJING_GLM_API_KEY", "GLM_API_KEY"],
    modelVars: ["MANJING_GLM_REVIEW_MODEL", "GLM_MODEL"],
  },
  {
    id: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    hint: "复杂文字创作与严格审核",
    provider: "deepseek",
    transport: "chat-completions",
    compatibleKind: "deepseek",
    supportsImages: false,
    writingEnabled: true,
    reviewEnabled: false,
    baseVars: ["MANJING_DEEPSEEK_BASE_URL", "MANJING_DEEPSEEK_API_URL", "DEEPSEEK_API_URL"],
    keyVars: ["MANJING_DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY"],
    modelVars: ["MANJING_DEEPSEEK_PRO_MODEL", "DEEPSEEK_PRO_MODEL"],
  },
  {
    id: 'ko-gpt-5.6-luna',
    label: 'KO GPT-5.6 Luna',
    hint: 'API · 通用问答与长文创作',
    provider: 'konjac-responses',
    transport: 'responses',
    supportsImages: false,
    writingEnabled: true,
    reviewEnabled: false,
    allowedHosts: ['www.konjac.ai', 'konjac.ai'],
    defaultBaseUrl: 'https://www.konjac.ai/v1',
    defaultModel: 'gpt-5.6-luna',
    baseVars: ['MANJING_KONJAC_BASE_URL', 'KONJAC_API_URL'],
    keyVars: ['MANJING_KONJAC_API_KEY', 'KONJAC_API_KEY'],
    modelVars: ['MANJING_KONJAC_LUNA_MODEL', 'KONJAC_LUNA_MODEL'],
  },
  {
    id: "jk-gpt-5.6-sol",
    label: "JK GPT-5.6 Sol",
    hint: "API · 复杂推理与正式交付",
    provider: "jiekou-responses",
    transport: "responses",
    supportsImages: true,
    writingEnabled: true,
    reviewEnabled: true,
    allowedHosts: ["api.jiekou.ai", "api.highwayapi.ai"],
    defaultBaseUrl: "https://api.highwayapi.ai/openai/v1",
    defaultModel: "gpt-5.6-sol",
    baseVars: ["MANJING_JIEKOU_RESPONSES_BASE_URL", "JIEKOU_RESPONSES_BASE_URL"],
    keyVars: ["MANJING_JIEKOU_API_KEY", "JIEKOU_API_KEY"],
    modelVars: ["MANJING_JIEKOU_GPT_SOL_MODEL"],
  },
  {
    id: "jk-gpt-5.6-luna",
    label: "JK GPT-5.6 Luna",
    hint: "API · 通用问答与长文创作",
    provider: "jiekou-responses",
    transport: "responses",
    supportsImages: false,
    writingEnabled: true,
    reviewEnabled: false,
    allowedHosts: ["api.jiekou.ai", "api.highwayapi.ai"],
    defaultBaseUrl: "https://api.highwayapi.ai/openai/v1",
    defaultModel: "gpt-5.6-luna",
    baseVars: ["MANJING_JIEKOU_RESPONSES_BASE_URL", "JIEKOU_RESPONSES_BASE_URL"],
    keyVars: ["MANJING_JIEKOU_API_KEY", "JIEKOU_API_KEY"],
    modelVars: ["MANJING_JIEKOU_GPT_LUNA_MODEL"],
  },
  {
    id: "jk-gemini-3.8-flash",
    label: "JK Gemini 3.8 Flash",
    hint: "API · 快速推理与多模态创作",
    provider: "jiekou-chat",
    transport: "chat-completions",
    compatibleKind: "jiekou",
    supportsImages: true,
    writingEnabled: true,
    reviewEnabled: true,
    defaultBaseUrl: "https://api.highwayapi.ai/openai",
    defaultModel: "gemini-3.8-flash",
    baseVars: ["MANJING_JIEKOU_BASE_URL", "JIEKOU_BASE_URL"],
    keyVars: ["MANJING_JIEKOU_API_KEY", "JIEKOU_API_KEY"],
    modelVars: ["MANJING_JIEKOU_GEMINI_MODEL"],
  },
  {
    id: "jk-claude-opus-5",
    label: "JK Claude Opus 5",
    hint: "API · 复杂分析与高质量创作",
    provider: "jiekou-anthropic",
    transport: "anthropic-messages",
    supportsImages: false,
    writingEnabled: true,
    reviewEnabled: true,
    allowedHosts: ["api.jiekou.ai", "api.highwayapi.ai"],
    defaultBaseUrl: "https://api.highwayapi.ai/anthropic/v1",
    defaultModel: "claude-opus-5",
    baseVars: ["MANJING_JIEKOU_ANTHROPIC_BASE_URL", "JIEKOU_ANTHROPIC_BASE_URL"],
    keyVars: ["MANJING_JIEKOU_API_KEY", "JIEKOU_API_KEY"],
    modelVars: ["MANJING_JIEKOU_CLAUDE_OPUS_MODEL"],
  },
  {
    id: "jk-claude-sonnet-5",
    label: "JK Claude Sonnet 5",
    hint: "API · 通用分析与创作",
    provider: "jiekou-anthropic",
    transport: "anthropic-messages",
    supportsImages: false,
    writingEnabled: true,
    reviewEnabled: false,
    allowedHosts: ["api.jiekou.ai", "api.highwayapi.ai"],
    defaultBaseUrl: "https://api.highwayapi.ai/anthropic/v1",
    defaultModel: "claude-sonnet-5",
    baseVars: ["MANJING_JIEKOU_ANTHROPIC_BASE_URL", "JIEKOU_ANTHROPIC_BASE_URL"],
    keyVars: ["MANJING_JIEKOU_API_KEY", "JIEKOU_API_KEY"],
    modelVars: ["MANJING_JIEKOU_CLAUDE_SONNET_MODEL"],
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
  const configuredBaseUrl = firstConfigured(env, definition.baseVars);
  const apiKey = firstConfigured(env, definition.keyVars);
  const configuredModel = firstConfigured(env, definition.modelVars);
  const baseUrl = configuredBaseUrl.value
    ? configuredBaseUrl
    : { name: "default", value: String(definition.defaultBaseUrl || "") };
  const model = configuredModel.value
    ? configuredModel
    : { name: "default", value: String(definition.defaultModel || "") };
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

export function writingModelConfigs(env = process.env) {
  return textModelConfigs(env).filter((model) => model.writingEnabled !== false);
}

export const textModelCatalog = DEFINITIONS.map((definition) => ({
  id: definition.id,
  label: definition.label,
  hint: definition.hint,
  provider: definition.provider,
  transport: definition.transport,
  supportsImages: definition.supportsImages,
  writingEnabled: definition.writingEnabled !== false,
  reviewEnabled: definition.reviewEnabled,
}));
