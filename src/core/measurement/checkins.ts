import { exercises } from "../exercises/registry";
import { median, noteName } from "../music/theory";
import { PROTOCOL_VERSION, SCORING_VERSION } from "../science/evidence";
import type { TrialDefinition, TrialRecord } from "../types";

export const CHECKIN_SIZE = 15;
const MODULES = ["echo", "route", "tonal", "silent", "missing"];
/** Fixed seeds, not Math.random: repeatable item order. Familiarity remains a limitation. */
export function checkinItems(anchorMidi = 48, form = "A"): TrialDefinition[] {
 if (!Number.isInteger(anchorMidi) || anchorMidi < 36 || anchorMidi > 60) throw new Error("Choose a home note from C2 to C4.");
 if (!["A", "B"].includes(form)) throw new Error("Unknown check-in form.");
 return Array.from({length: CHECKIN_SIZE}, (_, i) => {
  const id = MODULES[Math.floor(i / 3)];
  let seed = (form === "A" ? 20260929 : 20261001) + i * 171;
  const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
  const t = exercises.get(id).createTrial({difficulty: "steps", delayMs: id === "silent" ? 2000 : 0, random});
  const shift = anchorMidi - t.tonicMidi;
  return {...t, id:`${PROTOCOL_VERSION}-${form}-${anchorMidi}-${i}`, keyName: `${noteName(anchorMidi).replace(/\d+$/, "")} major`, tonicMidi:anchorMidi,
   startMidi:t.startMidi+shift, targetMidi:t.targetMidi+shift, phraseMidis:t.phraseMidis.map(m=>m+shift)};
 });
}
export interface Rate { hits: number; n: number; value: number | null; low: number | null; high: number | null; }
/** Descriptive Wilson interval; not a test of learning or a device-error calibration. */
export function rate(hits: number, n: number): Rate {
 if (!Number.isInteger(hits) || !Number.isInteger(n) || n<0 || hits<0 || hits>n) throw new Error("Invalid count.");
 if (!n) return {hits,n,value:null,low:null,high:null};
 const p=hits/n,z=1.959963984540054,z2=z*z,d=1+z2/n;
 const center=(p+z2/(2*n))/d,half=z*Math.sqrt(p*(1-p)/n+z2/(4*n*n))/d;
 return {hits,n,value:p,low:Math.max(0,center-half),high:Math.min(1,center+half)};
}
export function observedRate(rows: TrialRecord[]): Rate {
 const scored=rows.filter(t=>t.scored);
 return rate(scored.filter(t=>t.destinationMatch).length,scored.length);
}
export function residual(rows: TrialRecord[]): number | null {
 return median(rows.filter(t=>t.scored&&t.destinationMatch&&t.targetErrorCents!=null&&Number.isFinite(t.targetErrorCents)).map(t=>Math.abs(t.targetErrorCents!)));
}
export interface CheckinBlock {
 id:string; rows:TrialRecord[]; date:string; complete:boolean; issues:string[]; signature:string;
 score:Rate; attempted:number; moduleRates:Array<{id:string;rate:Rate}>;
}
export function checkinBlocks(trials:TrialRecord[]):CheckinBlock[] {
 const groups=new Map<string,TrialRecord[]>();
 for(const t of trials) if(t.measurement?.purpose==="checkin"&&t.measurement.blockId){
  const rows=groups.get(t.measurement.blockId)??[];rows.push(t);groups.set(t.measurement.blockId,rows);
 }
 return [...groups].map(([id,rows])=>{
  rows.sort((a,b)=>(a.measurement!.itemIndex??-1)-(b.measurement!.itemIndex??-1));
  const issues:string[]=[];
  const context=rows[0].measurement!;
  const expected=checkinItemsSafe(context.anchorMidi,context.formId);
  const ordinalSet=new Set(rows.map(t=>t.measurement!.itemIndex));
  if(rows.length!==CHECKIN_SIZE||ordinalSet.size!==CHECKIN_SIZE||![...ordinalSet].every(i=>i!=null&&i>=0&&i<CHECKIN_SIZE)) issues.push("Incomplete or duplicated item sequence");
  for(const t of rows){
   const m=t.measurement!, item=m.itemIndex==null?null:expected[m.itemIndex];
   if(m.protocolVersion!==PROTOCOL_VERSION||m.scoringVersion!==SCORING_VERSION) issues.push("Different protocol or scoring version");
   if(m.itemCount!==CHECKIN_SIZE||!m.firstTake||t.feedbackMode!=="blind"||t.hintLevel!==0||t.cueReplayCount!==0) issues.push("Support or first-take provenance differs");
   if(m.formId!==context.formId||m.anchorMidi!==context.anchorMidi||!item||itemKey(t.definition)!==itemKey(item)) issues.push("Item conditions differ");
   if(t.definition.exerciseId==="silent"&&(t.actualSilentMs==null||!Number.isFinite(t.actualSilentMs)||Math.abs(t.actualSilentMs-t.definition.delayMs)>250)) issues.push("Silent interval missing or outside timing tolerance");
   if(!t.micInput||t.micLowCut===undefined) issues.push("Microphone context unavailable");
   if(t.micInput!==rows[0].micInput||t.micLowCut!==rows[0].micLowCut) issues.push("Microphone changed within block");
  }
  const signature=JSON.stringify([context.protocolVersion,context.scoringVersion,context.formId,context.anchorMidi,rows[0].micInput,rows[0].micLowCut,rows.map(t=>itemKey(t.definition))]);
  return {id,rows,date:rows.map(t=>t.createdAt).sort().at(-1)!,complete:issues.length===0,issues:[...new Set(issues)],signature,score:observedRate(rows),attempted:rows.length,moduleRates:MODULES.map(id=>({id,rate:observedRate(rows.filter(t=>t.definition.exerciseId===id))}))};
 }).sort((a,b)=>a.date.localeCompare(b.date));
}
function itemKey(t:TrialDefinition):string { return JSON.stringify([t.exerciseId,t.tonicMidi,t.startMidi,t.targetMidi,t.startDegree,t.targetDegree,t.phraseMidis,t.delayMs,t.load]); }
function checkinItemsSafe(anchor:number|undefined,form:string|undefined){try{return anchor!=null&&form?checkinItems(anchor,form):[];}catch{return [];}}
export function comparableCheckins(trials:TrialRecord[]):{first:CheckinBlock;latest:CheckinBlock}|null {
 const blocks=checkinBlocks(trials).filter(b=>b.complete),latest=blocks.at(-1);
 if(!latest)return null;
 // Local calendar day, not UTC midnight: no same-day "learning" claim.
 const day=(iso:string)=>new Date(iso).toDateString();
 const first=blocks.find(b=>b.id!==latest.id&&b.signature===latest.signature&&day(b.date)!==day(latest.date));
 return first?{first,latest}:null;
}
