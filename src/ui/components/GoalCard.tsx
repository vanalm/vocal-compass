import { useState } from "react";
const KEY="vocal-compass.personal-goal.v1";
function readGoal():string {try{return localStorage.getItem(KEY)||"Sing a chosen phrase with a clear next note and less effort.";}catch{return "Sing a chosen phrase with a clear next note and less effort.";}}
/** Personal wording stays on this device; never embedded in source or silently synced. */
export function GoalCard(){
 const [goal,setGoal]=useState(readGoal),[draft,setDraft]=useState(goal),[editing,setEditing]=useState(false),[error,setError]=useState<string|null>(null);
 const save=()=>{const value=draft.trim().slice(0,300);if(!value){setError("Write a short goal first.");return;}try{localStorage.setItem(KEY,value);setGoal(value);setEditing(false);setError(null);}catch{setError("This browser could not save the goal. Your draft is still here.");}};
 return <section className="vc-card vc-goal-card"><div><span className="vc-eyebrow">Your musical goal</span>{!editing?<><h3>{goal}</h3><p className="vc-small">Judge success in music: more dependable notes, less help, and comfortable repeatability. Your personal wording is stored only on this device.</p></>:<><label htmlFor="personal-goal">A phrase or skill you want to use</label><textarea id="personal-goal" maxLength={300} value={draft} onChange={e=>setDraft(e.target.value)}/><p className="vc-small">Example: sing a chorus comfortably with lyrics, then while playing guitar. A higher note is a separate technique goal.</p></>}{error&&<p role="alert">{error}</p>}</div><button className="vc-button ghost" onClick={()=>editing?save():(setDraft(goal),setEditing(true))}>{editing?"Save goal":"Edit goal"}</button></section>;
}
