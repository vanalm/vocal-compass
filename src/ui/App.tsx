import { useState } from "react";
import { ServicesProvider } from "./services";
import { useTrials } from "./hooks/useTrials";
import { TodayScreen } from "./screens/TodayScreen";
import { LabScreen } from "./screens/LabScreen";
import { ProgressScreen } from "./screens/ProgressScreen";
import { TestScreen } from "./screens/TestScreen";
import { ProtocolScreen } from "./screens/ProtocolScreen";
import { RangeScreen } from "./screens/RangeScreen";
import type { Lane } from "../core";

type Screen = "today" | "test" | "lab" | "range" | "progress" | "protocol";

function Shell() {
  const [screen, setScreen] = useState<Screen>("today");
  const [labExerciseId, setLabExerciseId] = useState<string | undefined>();
  const {
    trials,
    ranges,
    sessions,
    save,
    saveRange,
    saveSession,
    deleteTrial,
    clear,
    exportJson,
    refresh,
  } = useTrials();

  const goToLane = (lane: Lane) => {
    const target: Record<Lane, Screen> = {
      test: "test",
      pitch: "lab",
      "range-exercise": "range",
      "range-probe": "range",
    };
    setScreen(target[lane]);
  };

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
        {screen === "test" && <TestScreen save={save} onFinished={() => setScreen("progress")} />}
        {screen === "lab" && (
          <LabScreen key={labExerciseId ?? "lab"} save={save} initialExerciseId={labExerciseId} />
        )}
        {screen === "progress" && (
          <ProgressScreen
            trials={trials}
            ranges={ranges}
            sessions={sessions}
            onGo={goToLane}
            onDeleteTrial={deleteTrial}
            onSynced={refresh}
            onExport={() => void exportJson()}
            onClear={() => void clear()}
          />
        )}
        {screen === "range" && (
          <RangeScreen ranges={ranges} onSaveRange={saveRange} onSaveSession={saveSession} />
        )}
        {screen === "protocol" && <ProtocolScreen />}
      </div>

      <nav className="vc-nav" aria-label="Primary">
        {(["today", "test", "lab", "range", "progress", "protocol"] as Screen[]).map((s) => (
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
