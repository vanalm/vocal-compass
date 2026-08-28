import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  CuePlayer,
  IndexedDbTrialRepository,
  KpiCalculator,
  MemoryTrialRepository,
  MicrophoneEngine,
  Recommender,
  SyncClient,
  type TrialRepository,
} from "../core";

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
    return {
      repository,
      microphone: new MicrophoneEngine(),
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
