import assert from "node:assert/strict";
import test from "node:test";
import {
  reviewModelConfigs,
  textModelConfig,
  textModelConfigs,
} from "../server/text-model-catalog.mjs";

const cuiyiEnv = {
  KIMI_API_URL: "https://api.kimi.com/coding/v1",
  KIMI_API_KEY: "kimi-test-key",
  KIMI_MODEL: "k3",
  GLM_API_URL: "https://open.bigmodel.cn/api/paas/v4",
  GLM_API_KEY: "",
  GLM_MODEL: "glm-5.3",
  GLM_FLASH_MODEL: "glm-5.3-flash",
  OPENAI_API_URL: "https://www.moyu.info/v1",
  OPENAI_API_KEY: "openai-compatible-test-key",
  OPENAI_MODEL: "gpt-5.6-luna",
  OPENAI_SOL_MODEL: "gpt-5.6-sol",
  DEEPSEEK_API_URL: "https://api.deepseek.com",
  DEEPSEEK_API_KEY: "",
  DEEPSEEK_MODEL: "deepseek-v4-flash",
  DEEPSEEK_PRO_MODEL: "deepseek-v4-pro",
  DOUBAO_API_URL: "https://ark.cn-beijing.volces.com/api/v3",
  DOUBAO_API_KEY: "doubao-test-key",
  DOUBAO_MODEL: "doubao-seed-2-1-pro-260628",
};

test("model catalog resolves provider values only from the supplied Cuiyi env", () => {
  const sol = textModelConfig("gpt-5.6-sol", cuiyiEnv);
  assert.equal(sol.baseUrl, cuiyiEnv.OPENAI_API_URL);
  assert.equal(sol.apiKey, cuiyiEnv.OPENAI_API_KEY);
  assert.equal(sol.model, cuiyiEnv.OPENAI_SOL_MODEL);
  assert.equal(sol.resolvedFrom.model, "OPENAI_SOL_MODEL");
  assert.equal(sol.configured, true);

  const seed = textModelConfig("seed-2.1-pro", cuiyiEnv);
  assert.equal(seed.baseUrl, cuiyiEnv.DOUBAO_API_URL);
  assert.equal(seed.model, "doubao-seed-2-1-pro-260628");
  assert.equal(seed.configured, true);
});

test("missing GLM and DeepSeek keys stay visibly unavailable", () => {
  const glm = textModelConfig("glm-5.3", cuiyiEnv);
  const deepseek = textModelConfig("deepseek-v4-pro", cuiyiEnv);
  assert.equal(glm.configured, false);
  assert.match(glm.reason, /GLM_API_KEY/);
  assert.equal(deepseek.configured, false);
  assert.match(deepseek.reason, /DEEPSEEK_API_KEY/);
});

test("public and strict-review catalogs include every requested model", () => {
  assert.deepEqual(textModelConfigs(cuiyiEnv).map(({ id }) => id), [
    "codex-gpt-5.6-sol",
    "glm-5.3-flash",
    "kimi-k3",
    "gpt-5.6-luna",
    "deepseek-v4-flash",
    "seed-2.1-pro",
    "glm-5.3",
    "gpt-5.6-sol",
    "deepseek-v4-pro",
  ]);
  assert.deepEqual(reviewModelConfigs(cuiyiEnv).map(({ id }) => id), [
    "codex-gpt-5.6-sol",
    "kimi-k3",
    "seed-2.1-pro",
    "glm-5.3",
    "gpt-5.6-sol",
    "deepseek-v4-pro",
  ]);
});

test("Codex CLI is configured only for an explicitly allowed tenant", () => {
  const shared = {
    MANJING_CODEX_ENABLED: "true",
    MANJING_CODEX_BIN: "/usr/local/bin/codex",
    MANJING_CODEX_HOME: "/var/lib/manjing/codex-superadmin",
    MANJING_CODEX_MODEL: "gpt-5.6-sol",
    MANJING_CODEX_ALLOWED_TENANT_IDS: "superadmin-id",
  };
  const allowed = textModelConfig("codex-gpt-5.6-sol", {
    ...shared,
    MANJING_TENANT_ID: "superadmin-id",
    MANJING_TENANT_ROLE: "superadmin",
  });
  assert.equal(allowed.configured, true);
  assert.equal(allowed.restrictedToSuperadmin, true);
  assert.equal(allowed.model, "gpt-5.6-sol");

  const deniedById = textModelConfig("codex-gpt-5.6-sol", {
    ...shared,
    MANJING_TENANT_ID: "ordinary-user-id",
    MANJING_TENANT_ROLE: "superadmin",
  });
  assert.equal(deniedById.configured, false);
  assert.match(deniedById.reason, /仅超级管理员/);

  const deniedByRole = textModelConfig("codex-gpt-5.6-sol", {
    ...shared,
    MANJING_TENANT_ID: "superadmin-id",
    MANJING_TENANT_ROLE: "user",
  });
  assert.equal(deniedByRole.configured, false);
  assert.match(deniedByRole.reason, /仅超级管理员/);
});

test("an empty env never fabricates an available provider", () => {
  assert.equal(textModelConfigs({}).some(({ configured }) => configured), false);
});

test("GPT Sol stays visible but unavailable when the proxy account gate is disabled", () => {
  const sol = textModelConfig("gpt-5.6-sol", {
    ...cuiyiEnv,
    MANJING_OPENAI_SOL_ENABLED: "false",
  });
  assert.equal(sol.configured, false);
  assert.match(sol.reason, /账号尚未开通/);
});
