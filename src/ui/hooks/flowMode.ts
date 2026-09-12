import { useCallback, useState } from "react";

/** click = you confirm each step (spacebar works); auto = moves on after each success. */
export type FlowMode = "click" | "auto";

const FLOW_MODE_KEY = "vc-flow-mode";

export function loadFlowMode(): FlowMode {
  try {
    return window.localStorage.getItem(FLOW_MODE_KEY) === "auto" ? "auto" : "click";
  } catch {
    return "click";
  }
}

export function saveFlowMode(mode: FlowMode): void {
  try {
    window.localStorage.setItem(FLOW_MODE_KEY, mode);
  } catch {
    /* private mode: the preference just doesn't persist */
  }
}

/** One persisted pacing preference, shared by every guided surface. */
export function useFlowMode(): [FlowMode, (mode: FlowMode) => void] {
  const [mode, setMode] = useState<FlowMode>(loadFlowMode);
  const update = useCallback((next: FlowMode) => {
    saveFlowMode(next);
    setMode(next);
  }, []);
  return [mode, update];
}
