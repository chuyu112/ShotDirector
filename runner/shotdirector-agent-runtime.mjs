// Compatibility entry point for older bridge imports. New code should import
// from manjing-agent-runtime.mjs directly.
export {
  runManjingAgentTurn,
  runManjingAgentTurn as runShotDirectorAgentTurn,
  manjingAgentPolicies,
  manjingAgentPolicies as shotDirectorAgentPolicies,
} from "./manjing-agent-runtime.mjs";
