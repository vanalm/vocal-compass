import { useCallback, useEffect, useState } from "react";
import type { ExerciseSession, PhraseRecord, RangeMeasurement, TrialRecord } from "../../core";
import { saveJsonFile } from "../download";
import { useServices } from "../services";

/**
 * Loads all persisted trials + range measurements and exposes save/export.
 * `onChange` hears about every local write, which is how sync learns there is something to send.
 * Clearing is the account's (`clearLocalData`), since it must not race a sync.
 */
export function useTrials(onChange: () => void) {
  const { repository } = useServices();
  const [trials, setTrials] = useState<TrialRecord[]>([]);
  const [ranges, setRanges] = useState<RangeMeasurement[]>([]);
  const [sessions, setSessions] = useState<ExerciseSession[]>([]);
  const [phrases, setPhrases] = useState<PhraseRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
    setTrials(await repository.all());
    setRanges(await repository.ranges());
    setSessions(await repository.sessions());
    setPhrases(await repository.phrases());
    setLoaded(true); setLoadError(null);
    } catch (error) { setLoadError("Saved records could not be loaded. This may be a browser storage restriction; do not assume this empty view means your history is gone."); throw error; }
  }, [repository]);

  useEffect(() => {
    void refresh().catch(() => { /* Persistent, visible error is rendered by the shell. */ });
  }, [refresh]);

  const written = useCallback(async () => {
    onChange();
    await refresh();
  }, [onChange, refresh]);

  const save = useCallback(
    async (record: TrialRecord) => {
      await repository.save(record);
      await written();
    },
    [repository, written],
  );

  const saveRange = useCallback(
    async (measurement: RangeMeasurement) => {
      await repository.saveRange(measurement);
      await written();
    },
    [repository, written],
  );

  const saveSession = useCallback(
    async (session: ExerciseSession) => {
      await repository.saveSession(session);
      await written();
    },
    [repository, written],
  );

  const savePhrase = useCallback(
    async (record: PhraseRecord) => {
      await repository.savePhrase(record);
      await written();
    },
    [repository, written],
  );

  const deleteTrial = useCallback(
    async (id: string) => {
      await repository.deleteTrial(id);
      await written();
    },
    [repository, written],
  );

  const exportJson = useCallback(async () => {
    saveJsonFile(await repository.exportJson(), "vocal-compass");
  }, [repository]);

  return { trials, ranges, sessions, phrases, loaded, loadError, save, saveRange, saveSession, savePhrase, deleteTrial, exportJson, refresh };
}
