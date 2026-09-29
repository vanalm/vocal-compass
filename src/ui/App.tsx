import { useEffect, useRef, useState } from "react";
import { ServicesProvider, useServices } from "./services";
import { useAccount } from "./hooks/useAccount";
import { useTrials } from "./hooks/useTrials";
import { AccountChip } from "./components/AccountChip";
import { MicCheckDialog } from "./components/MicCheck";
import { TodayScreen } from "./screens/TodayScreen";
import { LabScreen } from "./screens/LabScreen";
import { ProgressScreen } from "./screens/ProgressScreen";
import { TestScreen } from "./screens/TestScreen";
import { ProtocolScreen } from "./screens/ProtocolScreen";
import { RangeScreen } from "./screens/RangeScreen";
import { QuestScreen } from "./screens/QuestScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { MemoryTrialRepository, type Lane, type VoiceState } from "../core";

type Screen="today"|"test"|"quest"|"lab"|"range"|"progress"|"guide"|"settings";
const SCREENS:Screen[]=["today","test","quest","lab","range","progress","guide","settings"];
const PRACTICE:Screen[]=["test","lab","quest","range"];
function currentScreen():Screen {const id=window.location.hash.slice(1).split("/")[0];return id==="protocol"?"guide":id==="practice"?"lab":SCREENS.includes(id as Screen)?id as Screen:"today";}
function Shell(){
 const {repository}=useServices();
 const account=useAccount({onPulled:()=>refresh()});
 const [screen,setScreen]=useState<Screen>(account.returningFromSignIn?"settings":currentScreen);
 const [checkingMic,setCheckingMic]=useState(false),[voice,setVoice]=useState<VoiceState|"unchecked">("unchecked"),[error,setError]=useState<string|null>(null);
 const content=useRef<HTMLElement>(null);
 const {trials,ranges,sessions,phrases,save,saveRange,saveSession,savePhrase,deleteTrial,exportJson,refresh,loadError}=useTrials(account.scheduleSync);
 useEffect(()=>{const update=()=>{setScreen(currentScreen());setError(null);};window.addEventListener("hashchange",update);return()=>window.removeEventListener("hashchange",update);},[]);
 useEffect(()=>{content.current?.focus();window.scrollTo(0,0);},[screen]);
 const go=(s:Screen)=>{if(currentScreen()===s)setScreen(s);else window.location.hash=s;};
 const onGo=(lane:Lane)=>go(({test:"test",pitch:"lab","range-exercise":"range","range-probe":"range"} as Record<Lane,Screen>)[lane]);
 const practice=PRACTICE.includes(screen),canSing=voice==="normal";
 const act=async(fn:()=>Promise<unknown>)=>{try{await fn();}catch{setError("That action could not be completed. Your existing data has not been intentionally removed. Check storage or connection and retry.");}};
 return <div className="vc-app"><a className="vc-skip" href="#main-content" onClick={e=>{e.preventDefault();content.current?.focus();}}>Skip to content</a><div className="vc-shell">
  <header className="vc-topbar"><a href="#today" className="vc-brand" aria-label="Vocal Compass home"><div className="vc-mark" aria-hidden="true">◈</div><div><h1>Vocal Compass</h1><p>Find your next note.</p></div></a><div className="vc-topbar-end"><AccountChip account={account} onOpen={()=>go("settings")}/><button className="vc-settings-link" aria-current={screen==="settings"?"page":undefined} onClick={()=>go("settings")}>Settings</button></div></header>
  <main id="main-content" ref={content} tabIndex={-1}>
   {repository instanceof MemoryTrialRepository&&<p className="vc-notice" role="status">Temporary storage only: this browser cannot persist records. Export before closing this page; reloading loses unsynced work.</p>}
   {(error||loadError)&&<p className="vc-notice" role="alert">{error??loadError}</p>}
   {practice&&<>
    <nav className="vc-tabs vc-practice-tabs" aria-label="Practice type">{[["test","Check-in"],["lab","Pitch"],["quest","Phrases"],["range","Range"]].map(([id,label])=><button key={id} aria-current={screen===id?"page":undefined} className={screen===id?"active":""} onClick={()=>go(id as Screen)}>{label}</button>)}</nav>
    <section className="vc-readiness" aria-label="Voice readiness"><label htmlFor="voice-state">How does your voice feel?</label><select id="voice-state" value={voice} onChange={e=>{setCheckingMic(false);setVoice(e.target.value as VoiceState|"unchecked");}}><option value="unchecked">Choose before singing</option><option value="normal">Normal and comfortable</option><option value="tired">Tired</option><option value="hoarse">Hoarse</option><option value="sore">Sore or painful</option><option value="recovering">Recovering from illness</option></select>{canSing&&<button className="vc-button ghost" onClick={()=>setVoice("tired")}>Stop: voice needs rest</button>}</section>
    {!canSing&&<section className="vc-card vc-card-pad"><h2>{voice==="unchecked"?"Start with comfort.":"Give your voice a break."}</h2><p>{voice==="unchecked"?"Choose your current voice state above. No microphone is active. You can read the Guide without singing.":"Singing is paused. Do not push through pain, hoarseness or fatigue. Read the method instead; concerning or persistent changes deserve a qualified clinician’s advice."}</p><button className="vc-button" onClick={()=>go("guide")}>Read the guide</button></section>}
   </>}
   {screen==="today"&&<TodayScreen trials={trials} ranges={ranges} sessions={sessions} phraseRecords={phrases} onGo={onGo}/>}
   {screen==="test"&&canSing&&<TestScreen save={save} onFinished={()=>go("progress")}/>}
   {screen==="lab"&&canSing&&<LabScreen save={save}/>}
   {screen==="quest"&&canSing&&<QuestScreen phrases={phrases} ranges={ranges} onSave={savePhrase}/>}
   {screen==="range"&&canSing&&<RangeScreen ranges={ranges} onSaveRange={saveRange} onSaveSession={saveSession}/>}
   {screen==="progress"&&<ProgressScreen trials={trials} ranges={ranges} sessions={sessions} phraseRecords={phrases} onGo={onGo} onDeleteTrial={deleteTrial} onOpenAccount={()=>go("settings")} onExport={()=>void act(exportJson)} signedIn={account.user!==null} onClear={()=>void act(account.clearLocalData)}/>}
   {screen==="guide"&&<ProtocolScreen/>}
   {screen==="settings"&&<SettingsScreen account={account} onCheckMic={()=>canSing?setCheckingMic(true):go("lab")}/>}
  </main><footer className="vc-footer">Evidence-informed practice · Not a clinical assessment · <a href="#guide">Methods & limitations</a></footer>
 </div><nav className="vc-nav" aria-label="Primary">{[["today","Today"],["lab","Practice"],["progress","Progress"],["guide","Guide"]].map(([id,label])=><button key={id} aria-current={(screen===id||(id==="lab"&&practice))?"page":undefined} onClick={()=>go(id as Screen)}>{label}</button>)}</nav>{checkingMic&&<MicCheckDialog onClose={()=>setCheckingMic(false)}/>}</div>;
}
export default function App(){return <ServicesProvider><Shell/></ServicesProvider>;}
