import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OpenAIResponsesProvider, openAIResponsesInternals } from "../server/openai-responses-provider.mjs";

test("Responses provider sends server-side structured image input without leaking the key", async () => {
  const root = await mkdtemp(join(tmpdir(), "manjing-openai-"));
  const imagePath = join(root, "panel.png");
  await writeFile(imagePath, Buffer.from("89504e470d0a1a0a", "hex"));
  let captured;
  const provider = new OpenAIResponsesProvider({
    apiKey: "test-secret-key",
    allowedRoots: [root],
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({
        id: "resp_test",
        status: "completed",
        model: "gpt-5.6-sol",
        output: [{ type: "message", content: [{ type: "output_text", text: '{"ok":true}' }] }],
        usage: { input_tokens: 10, output_tokens: 4 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  const result = await provider.generate({
    prompt: "检查画格",
    model: "gpt-5.6-sol",
    schemaName: "panel-result",
    schema: { type: "object", additionalProperties: false, properties: { ok: { type: "boolean" } }, required: ["ok"] },
    imagePaths: [imagePath],
    safetyIdentifier: "user@example.com",
  });

  assert.equal(result.text, '{"ok":true}');
  assert.equal(captured.url, "https://api.openai.com/v1/responses");
  assert.equal(captured.options.headers.Authorization, "Bearer test-secret-key");
  assert.equal(captured.body.text.format.type, "json_schema");
  assert.equal(captured.body.input[0].content[1].type, "input_image");
  assert.match(captured.body.input[0].content[1].image_url, /^data:image\/png;base64,/);
  assert.doesNotMatch(JSON.stringify(captured.body), /test-secret-key/);
});

test("Responses provider rejects images outside the tenant roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "manjing-openai-root-"));
  const outside = await mkdtemp(join(tmpdir(), "manjing-openai-outside-"));
  const imagePath = join(outside, "panel.png");
  await writeFile(imagePath, Buffer.from("89504e470d0a1a0a", "hex"));
  const provider = new OpenAIResponsesProvider({ apiKey: "test", allowedRoots: [root], fetchImpl: async () => assert.fail("must not fetch") });
  await assert.rejects(() => provider.generate({
    prompt: "x",
    schema: { type: "object" },
    imagePaths: [imagePath],
  }), /不属于当前用户工作区/);
});

test("response parser supports output_text convenience and hashes safety identifiers", () => {
  assert.equal(openAIResponsesInternals.responseOutputText({ output_text: " ok " }), "ok");
  assert.match(openAIResponsesInternals.stableSafetyIdentifier("user-1"), /^[a-f0-9]{64}$/);
  assert.equal(openAIResponsesInternals.safeSchemaName("镜头 result!"), "result");
});
