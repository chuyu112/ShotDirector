import test from "node:test";
import assert from "node:assert/strict";
import { buildOmniReferenceBindings, referenceSignature, remapPromptReferenceTokens, validatePromptReferenceCoverage } from "../app/reference-contract.mjs";

test("reference bindings use one canonical scene-character-prop order", () => {
  const bindings = buildOmniReferenceBindings([
    "BMW（关键道具外观与比例参考）",
    "冴羽獠（角色身份与外观参考）",
    "新宿街道（场景空间与结构参考）",
  ]);
  assert.deepEqual(bindings.map((item) => item.kind), ["scene", "character", "prop"]);
  assert.deepEqual(bindings.map((item) => item.token), ["@图片一", "@图片二", "@图片三"]);
  assert.match(referenceSignature(bindings), /^refs-/);
});

test("prompt tokens follow assets when canonical order changes", () => {
  const previous = buildOmniReferenceBindings(["冴羽獠（角色身份与外观参考）", "BMW（关键道具外观与比例参考）"]);
  const next = buildOmniReferenceBindings(["新宿街道（场景空间与结构参考）", "冴羽獠（角色身份与外观参考）", "BMW（关键道具外观与比例参考）"]);
  const remapped = remapPromptReferenceTokens("保持 @图片一 的人物，驾驶 @图片二。", previous, next);
  assert.equal(remapped.prompt, "保持 @图片二 的人物，驾驶 @图片三。");
  assert.deepEqual(remapped.unresolved, []);
  assert.equal(validatePromptReferenceCoverage(`${next.map((item) => item.token).join(" ")}`, next).valid, true);
});

test("removed references are explicit instead of silently pointing at a new image", () => {
  const previous = buildOmniReferenceBindings(["人物A（角色身份与外观参考）", "道具B（关键道具外观与比例参考）"]);
  const next = buildOmniReferenceBindings(["人物A（角色身份与外观参考）"]);
  const remapped = remapPromptReferenceTokens("@图片二 必须出现", previous, next);
  assert.match(remapped.prompt, /参考图已移除/);
  assert.equal(remapped.unresolved.length, 1);
});
