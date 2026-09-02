import assert from "node:assert/strict";
import test from "node:test";
import { DoubaoResponsesProvider } from "../server/doubao-responses-provider.mjs";

test("Seed 2.1 Pro uses the env base, model and Responses request shape", async () => {
  let captured;
  const provider = new DoubaoResponsesProvider({
    apiKey: "seed-test-key",
    baseUrl: "http://127.0.0.1:9911/api/v3",
    model: "doubao-seed-2-1-pro-260628",
    fetchImpl: async (url, init) => {
      captured = { url, init, body: JSON.parse(init.body) };
      return Response.json({
        id: "resp_seed_test",
        model: "doubao-seed-2-1-pro-260628",
        output_text: '{"status":"completed"}',
        usage: { total_tokens: 9 },
      });
    },
  });

  const result = await provider.generate({
    prompt: "只返回结构化结果",
    instructions: "系统规则",
    schemaName: "seed_test",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["status"],
      properties: { status: { type: "string", const: "completed" } },
    },
  });

  assert.equal(captured.url, "http://127.0.0.1:9911/api/v3/responses");
  assert.equal(captured.body.model, "doubao-seed-2-1-pro-260628");
  assert.equal(captured.body.store, false);
  assert.deepEqual(captured.body.thinking, { type: "enabled" });
  assert.match(captured.body.input, /required_json_schema/);
  assert.equal(captured.init.headers.Authorization, "Bearer seed-test-key");
  assert.equal(result.text, '{"status":"completed"}');
  assert.equal(result.usage.total_tokens, 9);
});

test("Seed 2.1 Pro rejects a non-Ark public host", () => {
  assert.throws(() => new DoubaoResponsesProvider({
    apiKey: "test",
    baseUrl: "https://example.com/api/v3",
    model: "doubao-seed-2-1-pro-260628",
  }), /ark\.cn-beijing\.volces\.com/);
});
