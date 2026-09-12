import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  CuePlayer,
  DEFAULT_LOW_CUT,
  IndexedDbTrialRepository,
  KpiCalculator,
  LOW_CUT_OPTIONS,
  MemoryTrialRepository,
  MicrophoneEngine,
  Recommender,
  SyncClient,
  type TrialRepository,
} from "../core";
import { loadChoice } from "./hooks/persistentChoice";

/** Where the microphone low-cut preference is saved, and its valid values. */
export const MIC_LOW_CUT_KEY = "vc-mic-low-cut";
export const MIC_LOW_CUT_IDS = LOW_CUT_OPTIONS.map((o) => o.id);

const SYNC_URL =
  (import.meta.env?.VITE_SYNC_URL as string | undefined) ?? "http://localhost:8799";

/**
 * Composition root: every service is constructed once here and injected
 * through context, so screens depend on interfaces, not constructors.
 */
export interface AppServices {
  repository: TrialRepository;
  microphone: MicrophoneEngine;
  cues: CuePlayer;
  kpi: KpiCalculator;
  recommender: Recommender;
  sync: SyncClient;
}

const ServicesContext = createContext<AppServices | null>(null);

export function ServicesProvider({ children }: { children: ReactNode }) {
  const services = useMemo<AppServices>(() => {
    const repository: TrialRepository = IndexedDbTrialRepository.isSupported()
      ? new IndexedDbTrialRepository()
      : new MemoryTrialRepository();
    const microphone = new MicrophoneEngine();
    microphone.setLowCut(loadChoice(MIC_LOW_CUT_KEY, MIC_LOW_CUT_IDS, DEFAULT_LOW_CUT));
    return {
      repository,
      microphone,
      cues: new CuePlayer(),
      kpi: new KpiCalculator(),
      recommender: new Recommender(),
      sync: new SyncClient(SYNC_URL),
    };
  }, []);
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): AppServices {
  const services = useContext(ServicesContext);
  if (!services) throw new Error("useServices must be used inside ServicesProvider.");
  return services;
}
