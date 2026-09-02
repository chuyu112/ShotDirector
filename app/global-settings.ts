import workflowRules from "../config/workflow-rules.json";

export type GlobalSettings = {
  storyBackground: string;
  adaptationFocus: string;
  characterProfiles: CharacterProfile[];
  characters: string[];
  props: string[];
  locations: string[];
  timeline: string[];
  continuity: string[];
  finalVideoStyle: string;
  storyboardImageStyle: string;
  modelRules: string[];
  negative: string[];
};

export type CharacterProfile = {
  id: string;
  name: string;
  japaneseName: string;
  biography: string;
  identity: string;
  appearance: string;
  wardrobe: string;
  performanceBoundary: string;
  faceRestriction: string;
};

/**
 * Generic application defaults only. Story, characters, locations and final
 * art direction belong to a project template or an imported script.
 */
export const globalSettings: GlobalSettings = {
  storyBackground: "",
  adaptationFocus: "",
  characterProfiles: [],
  characters: [],
  props: [],
  locations: [],
  timeline: [],
  continuity: [...workflowRules.continuity],
  finalVideoStyle: "",
  storyboardImageStyle: workflowRules.storyboardImageStyle,
  modelRules: [...workflowRules.modelRules],
  negative: [...workflowRules.negative],
};
