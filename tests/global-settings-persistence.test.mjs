import assert from "node:assert/strict";
import test from "node:test";

import { isGlobalSettings } from "../scripts/project-global-settings.mjs";

const partialProjectSettings = {
  storyBackground: "",
  adaptationFocus: "保留原作因果和日语对白。",
  characterProfiles: [],
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

test("project global settings persist structured character biographies", () => {
  assert.equal(isGlobalSettings({
    ...partialProjectSettings,
    characterProfiles: [{
      id: "ryo",
      name: "冴羽獠",
      japaneseName: "冴羽 獠",
      biography: "新宿地下清道夫。",
      identity: "槇村秀幸的搭档。",
      appearance: "黑发，肩宽。",
      wardrobe: "1987年日本男装。",
      performanceBoundary: "平时轻松，危险时冷静。",
      faceRestriction: "可露脸，不得与其他角色共用脸。",
    }],
  }), true);
  assert.equal(isGlobalSettings({
    ...partialProjectSettings,
    characterProfiles: [{ id: "broken", name: "缺少字段" }],
  }), false);
});
