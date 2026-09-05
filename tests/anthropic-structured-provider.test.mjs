import assert from "node:assert/strict";
import test from "node:test";
import { textModelConfig } from "../server/text-model-catalog.mjs";
import {
  AnthropicStructuredProvider,
  anthropicStructuredInternals,
} from "../server/anthropic-structured-provider.mjs";

const schema = {
  type: "object",
  additionalProperties: false,
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
};

test("Opus and Sonnet use independent Anthropic config and wire protocol", async () => {
  for (const id of ["jk-claude-opus-5", "jk-claude-sonnet-5"]) {
    const config = textModelConfig(id, {
      MANJING_JIEKOU_API_KEY: "test-key",
      MANJING_JIEKOU_BASE_URL: "https://api.highwayapi.ai/openai",
      MANJING_JIEKOU_RESPONSES_BASE_URL: "https://api.highwayapi.ai/openai/v1",
      MANJING_JIEKOU_ANTHROPIC_BASE_URL: "https://api.jiekou.ai/anthropic/v1",
    });
    assert.equal(config.transport, "anthropic-messages");
    assert.equal(config.resolvedFrom.baseUrl, "MANJING_JIEKOU_ANTHROPIC_BASE_URL");
    const provider = new AnthropicStructuredProvider({ ...config, fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.jiekou.ai/anthropic/v1/messages");
      const body = JSON.parse(options.body);
      assert.equal(body.model, config.model);
      assert.equal(options.headers["anthropic-version"], "2023-06-01");
      assert.ok(body.messages);
      assert.equal(typeof body.system, "string");
      assert.deepEqual(body.thinking, { type: "adaptive" });
      assert.deepEqual(body.output_config, { effort: "max" });
      for (const field of ["input", "response_format", "reasoning_effort", "max_completion_tokens"]) assert.equal(body[field], undefined);
      return new Response(JSON.stringify({ model: config.model, stop_reason: "end_turn", content: [{ type: "text", text: '{"ok":true}' }] }), { headers: { "Content-Type": "application/json" } });
    } });
    assert.equal((await provider.generate({ prompt: "test", schema })).reportedModel, config.model);
  }
});

test("Claude endpoint accepts only explicit Anthropic paths without hidden rewrites", () => {
  for (const path of ["/anthropic", "/anthropic/v1/", "/anthropic/v1/messages"]) {
    assert.equal(new AnthropicStructuredProvider({ baseUrl: `https://api.highwayapi.ai${path}` }).baseUrl, "https://api.highwayapi.ai/anthropic/v1/messages");
  }
  for (const path of ["/openai", "/openai/v1", "/v1/responses", "/v1/chat/completions", "/", "/anthropic/v1?key=x", "/anthropic/v1#x"]) {
    assert.throws(() => new AnthropicStructuredProvider({ baseUrl: `https://api.highwayapi.ai${path}` }), /Anthropic|查询参数/);
  }
});

test("JK Claude sends streaming adaptive MAX and a compatible schema tool", async () => {
  let captured;
  const provider = new AnthropicStructuredProvider({
    apiKey: "jk-test-secret",
    model: "claude-opus-5",
    label: "JK Claude Opus 5",
    fetchImpl: async (url, options) => {
      captured = { url: String(url), headers: options.headers, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({
        id: "msg_test",
        model: "claude-opus-5",
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tool_1", name: "shot_result", input: { ok: true } }],
        usage: { input_tokens: 10, output_tokens: 4 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  const result = await provider.generate({
    prompt: "审核该 Shot",
    instructions: "你是只读审核 Agent。",
    schema,
    schemaName: "shot result",
    maxOutputTokens: 4_096,
  });

  assert.equal(captured.url, "https://api.highwayapi.ai/anthropic/v1/messages");
  assert.equal(captured.headers.Authorization, "Bearer jk-test-secret");
  assert.equal(captured.headers["anthropic-version"], "2023-06-01");
  assert.equal(captured.body.model, "claude-opus-5");
  assert.match(captured.body.system, /^你是只读审核 Agent。/);
  assert.match(captured.body.system, /不可信任务资料/);
  assert.equal(captured.body.max_tokens, 4_096);
  assert.deepEqual(captured.body.tool_choice, { type: "auto", disable_parallel_tool_use: true });
  assert.deepEqual(captured.body.thinking, { type: 'adaptive' });
  assert.deepEqual(captured.body.output_config, { effort: 'max' });
  assert.equal(captured.body.stream, true);
  assert.deepEqual(captured.body.tools[0].input_schema, schema);
  assert.deepEqual(result, {
    text: '{"ok":true}',
    responseId: "msg_test",
    reportedModel: 'claude-opus-5',
    model: "claude-opus-5",
    usage: { input_tokens: 10, output_tokens: 4 },
    provider: "jiekou-anthropic",
  });
});

test("JK Claude rejects untrusted hosts, images and truncated results", async () => {
  assert.throws(() => new AnthropicStructuredProvider({
    apiKey: "x",
    baseUrl: "https://api.highwayapi.ai.evil.example/openai",
  }), /受信域名/);

  const imageProvider = new AnthropicStructuredProvider({
    apiKey: "x",
    baseUrl: "http://127.0.0.1:1234/anthropic/v1",
    fetchImpl: async () => assert.fail("image rejection must happen before fetch"),
  });
  await assert.rejects(imageProvider.generate({ prompt: "x", schema, imagePaths: ["panel.png"] }), /未声明图片/);

  const truncatedProvider = new AnthropicStructuredProvider({
    apiKey: "x",
    baseUrl: "http://127.0.0.1:1234/anthropic/v1",
    fetchImpl: async () => new Response(JSON.stringify({
      stop_reason: "max_tokens",
      content: [{ type: "text", text: '{"ok":true}' }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
  });
  await assert.rejects(truncatedProvider.generate({ prompt: "x", schema }), /Token 上限/);
});

test("JK Claude text fallback accepts one JSON object", () => {
  assert.equal(anthropicStructuredInternals.structuredResult({
    content: [{ type: "text", text: "```json\n{\"ok\":true}\n```" }],
  }, "result"), '{"ok":true}');
});
