import workflowRules from "../config/workflow-rules.json";

export type GlobalSettings = {
  storyBackground: string;
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

/**
 * Generic application defaults only. Story, characters, locations and final
 * art direction belong to a project template or an imported script.
 */
export const globalSettings: GlobalSettings = {
  storyBackground: "",
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
