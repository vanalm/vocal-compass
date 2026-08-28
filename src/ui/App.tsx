import { useState } from "react";
import { ServicesProvider } from "./services";
import { useTrials } from "./hooks/useTrials";
import { TodayScreen } from "./screens/TodayScreen";
import { LabScreen } from "./screens/LabScreen";
import { ProgressScreen } from "./screens/ProgressScreen";
import { ProtocolScreen } from "./screens/ProtocolScreen";

type Screen = "today" | "lab" | "progress" | "protocol";

function Shell() {
  const [screen, setScreen] = useState<Screen>("today");
  const [labExerciseId, setLabExerciseId] = useState<string | undefined>();
  const { trials, ranges, save, saveRange, clear, exportJson, refresh } = useTrials();

  const openLab = (exerciseId: string) => {
    setLabExerciseId(exerciseId);
    setScreen("lab");
  };

  return (
    <div className="vc-app">
      <div className="vc-shell">
        <header className="vc-topbar">
          <div className="vc-brand">
            <div className="vc-mark">◈</div>
            <div>
              <h1>Vocal Compass</h1>
              <p>Melodic navigation trainer — local-first, optional sync</p>
            </div>
          </div>
        </header>

        {screen === "today" && <TodayScreen trials={trials} onStart={openLab} />}
        {screen === "lab" && (
          <LabScreen key={labExerciseId ?? "lab"} save={save} initialExerciseId={labExerciseId} />
        )}
        {screen === "progress" && (
          <ProgressScreen
            trials={trials}
            ranges={ranges}
            onSaveRange={saveRange}
            onSynced={refresh}
            onExport={() => void exportJson()}
            onClear={() => void clear()}
          />
        )}
        {screen === "protocol" && <ProtocolScreen />}
      </div>

      <nav className="vc-nav" aria-label="Primary">
        {(["today", "lab", "progress", "protocol"] as Screen[]).map((s) => (
          <button key={s} aria-current={screen === s ? "page" : undefined} onClick={() => setScreen(s)}>
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <ServicesProvider>
      <Shell />
    </ServicesProvider>
  );
}
