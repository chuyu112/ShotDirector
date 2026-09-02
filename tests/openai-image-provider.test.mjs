import assert from "node:assert/strict";
import test from "node:test";
import { OpenAIImageProvider, openAIImageInternals } from "../server/openai-image-provider.mjs";

test("image provider generates two server-side images with GPT Image 2", async () => {
  let captured;
  const provider = new OpenAIImageProvider({
    apiKey: "server-secret",
    fetchImpl: async (url, options) => {
      captured = { url, headers: options.headers, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({
        data: [{ b64_json: Buffer.from("image-one").toString("base64") }, { b64_json: Buffer.from("image-two").toString("base64") }],
        usage: { total_tokens: 100 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  const result = await provider.generate({ prompt: "cinematic character portrait", ratio: "16:9", count: 2 });
  assert.equal(result.images.length, 2);
  assert.equal(result.images[0].toString(), "image-one");
  assert.equal(captured.url, "https://api.openai.com/v1/images/generations");
  assert.equal(captured.body.model, "gpt-image-2");
  assert.equal(captured.body.size, "1536x1024");
  assert.equal(captured.body.n, 2);
  assert.equal(captured.headers.Authorization, "Bearer server-secret");
  assert.doesNotMatch(JSON.stringify(captured.body), /server-secret/);
});

test("image ratio mapping is deterministic", () => {
  assert.equal(openAIImageInternals.sizeForRatio("1:1"), "1024x1024");
  assert.equal(openAIImageInternals.sizeForRatio("9:16"), "1024x1536");
  assert.equal(openAIImageInternals.sizeForRatio("4:3"), "1536x1024");
});

