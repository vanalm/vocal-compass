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

  const refresh = useCallback(async () => {
    setTrials(await repository.all());
    setRanges(await repository.ranges());
    setSessions(await repository.sessions());
    setPhrases(await repository.phrases());
    setLoaded(true);
  }, [repository]);

  useEffect(() => {
    void refresh();
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

  return { trials, ranges, sessions, phrases, loaded, save, saveRange, saveSession, savePhrase, deleteTrial, exportJson, refresh };
}
