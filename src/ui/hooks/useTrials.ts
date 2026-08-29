import { useCallback, useEffect, useState } from "react";
import type { ExerciseSession, RangeMeasurement, TrialRecord } from "../../core";
import { useServices } from "../services";

/** Loads all persisted trials + range measurements and exposes save/clear/export. */
export function useTrials() {
  const { repository } = useServices();
  const [trials, setTrials] = useState<TrialRecord[]>([]);
  const [ranges, setRanges] = useState<RangeMeasurement[]>([]);
  const [sessions, setSessions] = useState<ExerciseSession[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    setTrials(await repository.all());
    setRanges(await repository.ranges());
    setSessions(await repository.sessions());
    setLoaded(true);
  }, [repository]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (record: TrialRecord) => {
      await repository.save(record);
      await refresh();
    },
    [repository, refresh],
  );

  const saveRange = useCallback(
    async (measurement: RangeMeasurement) => {
      await repository.saveRange(measurement);
      await refresh();
    },
    [repository, refresh],
  );

  const saveSession = useCallback(
    async (session: ExerciseSession) => {
      await repository.saveSession(session);
      await refresh();
    },
    [repository, refresh],
  );

  const deleteTrial = useCallback(
    async (id: string) => {
      await repository.deleteTrial(id);
      await refresh();
    },
    [repository, refresh],
  );

  const clear = useCallback(async () => {
    await repository.clear();
    await refresh();
  }, [repository, refresh]);

  const exportJson = useCallback(async () => {
    const json = await repository.exportJson();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `vocal-compass-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [repository]);

  return { trials, ranges, sessions, loaded, save, saveRange, saveSession, deleteTrial, clear, exportJson, refresh };
}
