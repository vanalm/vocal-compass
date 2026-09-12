import { useCallback } from "react";
import { DEFAULT_LOW_CUT, type LowCutSetting } from "../../core";
import { MIC_LOW_CUT_IDS, MIC_LOW_CUT_KEY, useServices } from "../services";
import { usePersistentChoice } from "./persistentChoice";

/** The saved low-cut choice; changing it also retunes the live microphone. */
export function useMicLowCut(): [LowCutSetting, (setting: LowCutSetting) => void] {
  const { microphone } = useServices();
  const [setting, save] = usePersistentChoice(MIC_LOW_CUT_KEY, MIC_LOW_CUT_IDS, DEFAULT_LOW_CUT);
  const update = useCallback(
    (next: LowCutSetting) => {
      save(next);
      microphone.setLowCut(next);
    },
    [save, microphone],
  );
  return [setting, update];
}
