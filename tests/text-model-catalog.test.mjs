import assert from "node:assert/strict";
import test from "node:test";
import {
  reviewModelConfigs,
  textModelConfig,
  textModelConfigs,
  writingModelConfigs,
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
  JIEKOU_API_KEY: "jk-test-key",
  JIEKOU_BASE_URL: "https://api.highwayapi.ai/openai",
  JIEKOU_RESPONSES_BASE_URL: "https://api.highwayapi.ai/openai/v1",
};

test("model catalog resolves provider values only from the supplied Cuiyi env", () => {
  const sol = textModelConfig("jk-gpt-5.6-sol", cuiyiEnv);
  assert.equal(sol.baseUrl, cuiyiEnv.JIEKOU_RESPONSES_BASE_URL);
  assert.equal(sol.apiKey, cuiyiEnv.JIEKOU_API_KEY);
  assert.equal(sol.model, "gpt-5.6-sol");
  assert.equal(sol.resolvedFrom.model, "default");
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
    "glm-5.3-flash",
    "kimi-k3",
    "deepseek-v4-flash",
    "seed-2.1-pro",
    "glm-5.3",
    "deepseek-v4-pro",
    'ko-gpt-5.6-luna',
    "jk-gpt-5.6-sol",
    "jk-gpt-5.6-luna",
    "jk-gemini-3.8-flash",
    "jk-claude-opus-5",
    "jk-claude-sonnet-5",
  ]);
  assert.deepEqual(writingModelConfigs(cuiyiEnv).map(({ id }) => id), [
    "glm-5.3-flash",
    "kimi-k3",
    "deepseek-v4-flash",
    "seed-2.1-pro",
    "deepseek-v4-pro",
    'ko-gpt-5.6-luna',
    "jk-gpt-5.6-sol",
    "jk-gpt-5.6-luna",
    "jk-gemini-3.8-flash",
    "jk-claude-opus-5",
    "jk-claude-sonnet-5",
  ]);
  assert.deepEqual(reviewModelConfigs(cuiyiEnv).map(({ id }) => id), [
    "kimi-k3",
    "glm-5.3",
    "jk-gpt-5.6-sol",
    "jk-gemini-3.8-flash",
    "jk-claude-opus-5",
  ]);
});

test("an empty env never fabricates an available provider", () => {
  assert.equal(textModelConfigs({}).some(({ configured }) => configured), false);
});

test("Claude never inherits OpenAI base URL, and dedicated alias is respected", () => {
  for (const id of ["jk-claude-opus-5", "jk-claude-sonnet-5"]) {
    const defaults = textModelConfig(id, cuiyiEnv);
    assert.equal(defaults.baseUrl, "https://api.highwayapi.ai/anthropic/v1");
    assert.equal(defaults.resolvedFrom.baseUrl, "default");
    const dedicated = textModelConfig(id, { ...cuiyiEnv, JIEKOU_ANTHROPIC_BASE_URL: "https://api.jiekou.ai/anthropic/v1" });
    assert.equal(dedicated.baseUrl, "https://api.jiekou.ai/anthropic/v1");
  }
});

test('KO uses dedicated credentials and GLM 5.3 never selects Responses transport', () => {
  const absent = textModelConfig('ko-gpt-5.6-luna', cuiyiEnv);
  assert.equal(absent.configured, false, 'old MY and JK keys cannot enable KO');
  assert.equal(absent.apiKey, '');
  const ko = textModelConfig('ko-gpt-5.6-luna', { ...cuiyiEnv, KONJAC_API_KEY: 'ko-secret' });
  assert.equal(ko.apiKey, 'ko-secret');
  assert.equal(ko.baseUrl, 'https://www.konjac.ai/v1');
  assert.equal(ko.transport, 'responses');
  assert.equal(ko.model, 'gpt-5.6-luna');
  for (const id of ['glm-5.3', 'glm-5.3-flash']) {
    const glm = textModelConfig(id, cuiyiEnv);
    assert.equal(glm.transport, 'chat-completions');
    assert.equal(glm.compatibleKind, 'glm');
  }
});

test("JK models stay unavailable without a server-side API key", () => {
  const sol = textModelConfig("jk-gpt-5.6-sol", {});
  assert.equal(sol.configured, false);
  assert.match(sol.reason, /JIEKOU_API_KEY/);
  assert.equal(sol.baseUrl, "https://api.highwayapi.ai/openai/v1");
  assert.equal(sol.model, "gpt-5.6-sol");
});
