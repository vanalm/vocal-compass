import { loadChoice, saveChoice, usePersistentChoice } from "./persistentChoice";

/** click = you confirm each step (spacebar works); auto = moves on after each success. */
export type FlowMode = "click" | "auto";

const FLOW_MODE_KEY = "vc-flow-mode";
const FLOW_MODES: readonly FlowMode[] = ["click", "auto"];

export function loadFlowMode(): FlowMode {
  return loadChoice(FLOW_MODE_KEY, FLOW_MODES, "click");
}

export function saveFlowMode(mode: FlowMode): void {
  saveChoice(FLOW_MODE_KEY, mode);
}

/** One persisted pacing preference, shared by every guided surface. */
export function useFlowMode(): [FlowMode, (mode: FlowMode) => void] {
  return usePersistentChoice(FLOW_MODE_KEY, FLOW_MODES, "click");
}
