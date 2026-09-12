import { useState } from "react";
import { ServicesProvider } from "./services";
import { useTrials } from "./hooks/useTrials";
import { TodayScreen } from "./screens/TodayScreen";
import { LabScreen } from "./screens/LabScreen";
import { ProgressScreen } from "./screens/ProgressScreen";
import { TestScreen } from "./screens/TestScreen";
import { ProtocolScreen } from "./screens/ProtocolScreen";
import { RangeScreen } from "./screens/RangeScreen";
import { QuestScreen } from "./screens/QuestScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import type { Lane } from "../core";

type Screen = "today" | "test" | "quest" | "lab" | "range" | "progress" | "protocol" | "settings";

function Shell() {
  const [screen, setScreen] = useState<Screen>("today");

  const {
    trials,
    ranges,
    sessions,
    phrases,
    save,
    saveRange,
    saveSession,
    savePhrase,
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

  return (
    <div className="vc-app">
      <div className="vc-shell">
        <header className="vc-topbar">
          <div className="vc-brand">
            <div className="vc-mark">◈</div>
            <div>
              <h1>Vocal Compass</h1>
              <p>Measure your singing, train with feedback, verify the change — methods from the research, data stays yours</p>
            </div>
          </div>
          <button
            className="vc-settings-link"
            aria-current={screen === "settings" ? "page" : undefined}
            onClick={() => setScreen("settings")}
          >
            Settings
          </button>
        </header>

        {screen === "today" && (
          <TodayScreen trials={trials} ranges={ranges} sessions={sessions} phraseRecords={phrases} onGo={goToLane} />
        )}
        {screen === "test" && <TestScreen save={save} onFinished={() => setScreen("progress")} />}
        {screen === "quest" && <QuestScreen phrases={phrases} ranges={ranges} onSave={savePhrase} />}
        {screen === "lab" && (
          <LabScreen save={save} />
        )}
        {screen === "progress" && (
          <ProgressScreen
            trials={trials}
            ranges={ranges}
            sessions={sessions}
            phraseRecords={phrases}
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
        {screen === "settings" && <SettingsScreen />}
      </div>

      <nav className="vc-nav" aria-label="Primary">
        {(["today", "test", "quest", "lab", "range", "progress", "protocol"] as Screen[]).map((s) => (
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
