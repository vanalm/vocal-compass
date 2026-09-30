import { useEffect, useMemo, useRef, useState } from "react";
import { exercises, noteName, type TrialRecord } from "../../core";
import { CHECKIN_SIZE, checkinItems } from "../../core/measurement/checkins";
import { PROTOCOL_VERSION, SCORING_VERSION } from "../../core/science/evidence";
import { useTrialRunner } from "../hooks/useTrialRunner";
import { CueIndicator, MicMeter } from "../components/TrialStage";
import { EvidenceCards } from "../components/EvidenceCards";

/** All first attempts remain in the block; no score-based retry or online pitch feedback. */
export function TestScreen({save,onFinished}:{save:(record:TrialRecord)=>Promise<void>;onFinished:()=>void}) {
 const [anchor,setAnchor]=useState(48),[form,setForm]=useState("A");
 const [completed,setCompleted]=useState(0),[started,setStarted]=useState(false),[saving,setSaving]=useState(false);
 const [error,setError]=useState<string|null>(null),[comfortable,setComfortable]=useState(false);
 const blockId=useRef(crypto.randomUUID()),saveLock=useRef(false);
 const items=useMemo(()=>checkinItems(anchor,form),[anchor,form]);
 const runner=useTrialRunner(async record=>{await save(record);setCompleted(n=>n+1);},{flow:"auto"});
 const trial=items[Math.min(completed,CHECKIN_SIZE-1)],exercise=exercises.get(trial.exerciseId);
 const allNotes=items.flatMap(t=>[t.startMidi,t.targetMidi,...t.phraseMidis]);
 const begin=async()=>{
  setStarted(true);setError(null);
  await runner.start({exerciseId:trial.exerciseId,difficulty:"steps",delayMs:trial.delayMs,feedbackMode:"blind",definition:trial,
   measurement:{purpose:"checkin",protocolVersion:PROTOCOL_VERSION,scoringVersion:SCORING_VERSION,blockId:blockId.current,itemIndex:completed,itemCount:CHECKIN_SIZE,formId:form,anchorMidi:anchor,firstTake:true,selfReportsCollected:false}},3);
 };
 const keep=async()=>{
  if(saveLock.current)return;saveLock.current=true;setSaving(true);setError(null);
  try {await runner.complete({intent:null,effort:2,register:"unknown"});}
  catch {setError("This attempt is not saved yet. Retry saving; leaving now would make the block incomplete.");}
  finally {saveLock.current=false;setSaving(false);}
 };
 // Save every captured first attempt automatically, before another item can begin.
 useEffect(()=>{if(runner.phase==="review")void keep();},[runner.phase]);
 if(completed===CHECKIN_SIZE)return <section className="vc-card vc-card-pad"><span className="vc-eyebrow">Check-in complete</span><h2>A snapshot, not a verdict.</h2><p>All {CHECKIN_SIZE} attempts were saved, including any captures the detector could not score. Progress shows the counts and which blocks are comparable.</p><p>Three attempts per module are preliminary. Repeat on a different day with the same form, key, microphone and filter before interpreting a pattern.</p><button className="vc-button primary" onClick={onFinished}>See my check-in</button></section>;
 return <div className="vc-test-page">
  <header className="vc-page-heading"><span className="vc-eyebrow">Personal check-in · {completed}/{CHECKIN_SIZE}</span><h2>How is the next note today?</h2><p>One fixed set. No live pitch display. Results wait until the end.</p></header>
  <div className="vc-testbar" role="progressbar" aria-label="Saved check-in attempts" aria-valuenow={completed} aria-valuemin={0} aria-valuemax={CHECKIN_SIZE}><i style={{width:`${completed/CHECKIN_SIZE*100}%`}}/></div>
  {!started&&<section className="vc-card vc-card-pad"><h3>Set a comfortable starting point</h3><div className="vc-two-up"><label>Home note<select value={anchor} onChange={e=>{setAnchor(Number(e.target.value));setComfortable(false);}}>{Array.from({length:25},(_,i)=>i+36).map(m=><option key={m} value={m}>{noteName(m)}</option>)}</select></label><label>Item set<select value={form} onChange={e=>{setForm(e.target.value);setComfortable(false);}}><option value="A">A · standard</option><option value="B">B · alternative set</option></select></label></div><p>This set uses {noteName(Math.min(...allNotes))}–{noteName(Math.max(...allNotes))}. Use a quieter, easier key rather than reaching. Changing the key or set begins a separate comparison.</p><label className="vc-check"><input type="checkbox" checked={comfortable} onChange={e=>setComfortable(e.target.checked)}/>These notes feel comfortable today; I am using headphones in a quiet space.</label><p className="vc-small">The microphone starts only when you begin. Allow its permission before the first cue. No maximum-range test is needed.</p></section>}
  <section className="vc-card vc-stage"><span className="vc-label">Attempt {completed+1} of {CHECKIN_SIZE} · {exercise.title}</span>
   {(runner.phase==="idle"||runner.phase==="listen")&&<><h3>{runner.micStatus==="requesting"?"Allow microphone access":"Listen, then sing one note"}</h3><p>{exercise.guide.task}</p></>}
   {runner.phase==="idle"&&<button className="vc-button primary" disabled={!comfortable} onClick={()=>void begin()}>{completed?"Begin next attempt":"Begin check-in"}</button>}
   <CueIndicator playing={runner.cuePlaying} label={runner.cueLabel??"Listen"}/>
   {runner.phase==="imagine"&&<div className="vc-phase-block"><h3>{runner.remainingDelayMs>0?"Hold it silently":"Get ready"}</h3><p>{runner.prompt}</p>{runner.remainingDelayMs>0&&<p>{(runner.remainingDelayMs/1000).toFixed(1)} seconds</p>}</div>}
   {runner.phase==="sing"&&<div className="vc-phase-block"><h3 className="vc-sing-now">Sing now</h3><p>{runner.prompt}</p><MicMeter level={runner.inputLevel} threshold={runner.noiseThreshold} sample={null}/><p className="vc-small">Hold one easy note. Capture ends automatically; no pitch answer is displayed.</p></div>}
   {runner.phase==="review"&&<div className="vc-phase-block"><h3>Attempt captured</h3><p>No score yet. This first attempt is being saved automatically, including any capture the detector could not score.</p><button className="vc-button primary" disabled={saving} onClick={()=>void keep()}>{saving?"Saving…":"Retry saving"}</button></div>}
   {(error||runner.micError)&&<p className="vc-notice" role="alert">{error??runner.micError}</p>}
   <p className="vc-small">Microphone: {runner.micStatus}. You may leave at any time; a partial block is kept but is not a completed comparison.</p>
  </section>
  <details className="vc-card vc-card-pad"><summary>Why the score waits</summary><p>We want the result without online pitch guidance or choosing only the best attempts. This controls one source of bias, not every source of measurement error.</p><EvidenceCards ids={["feedback-short","feedback-long"]}/></details>
 </div>;
}
