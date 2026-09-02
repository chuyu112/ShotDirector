import assert from "node:assert/strict";
import test from "node:test";

import { isGlobalSettings } from "../scripts/project-global-settings.mjs";

const partialProjectSettings = {
  storyBackground: "",
  characters: [],
  props: [],
  locations: [],
  timeline: [],
  continuity: [],
  finalVideoStyle: "昭和62年（1987年）东京新宿背景的写实日本真人都市犯罪动作电影。",
  storyboardImageStyle: "",
  modelRules: [],
  negative: [],
};

test("project global settings remain persistable while some sections are still empty", () => {
  assert.equal(isGlobalSettings(partialProjectSettings), true);
});

test("project global settings reject malformed array values", () => {
  assert.equal(isGlobalSettings({
    ...partialProjectSettings,
    characters: ["冴羽獠", 1987],
  }), false);
});
