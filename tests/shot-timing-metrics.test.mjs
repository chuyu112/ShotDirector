import test from "node:test";
import assert from "node:assert/strict";
import { dialogueMetrics, visualTimingMetrics } from "../app/shot-timing-metrics.mjs";

test("counts spoken Japanese only, without punctuation or Chinese production notes", () => {
  assert.deepEqual(dialogueMetrics("「ありがとう」、ありがとう！｜中文备注：谢谢（仅制作备注）"),
    { characters: 10, words: 0, seconds: 10 / 7 });
  assert.equal(dialogueMetrics("一二三四五六七八").seconds, 2);
  assert.equal(dialogueMetrics("无对白。").seconds, 0);
  assert.equal(dialogueMetrics("原作画格，剧情与构图以裁图为准。").characters, 0);
});

test("English timing preserves word boundaries", () => {
  const short = dialogueMetrics("Hello, how are you?");
  assert.equal(short.words, 4);
  assert.equal(short.seconds, 1.6);
  assert.ok(dialogueMetrics("Hello, how are you? I am waiting here for you.").seconds > short.seconds);
});

test("visual timing is based on planned subshots, or explicitly on panel count when unknown", () => {
  const planned = visualTimingMetrics(23, 8);
  assert.equal(planned.segmentCount, 8);
  assert.equal(planned.estimatedFromPanels, false);
  const fallback = visualTimingMetrics(23);
  assert.equal(fallback.estimatedFromPanels, true);
  assert.ok(fallback.visualSeconds + fallback.actionReactionSeconds > 30);
  assert.ok(visualTimingMetrics(12, 6).visualSeconds > visualTimingMetrics(12, 2).visualSeconds);
});
