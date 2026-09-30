import { median } from "../music/theory";
import type { KpiSummary, TrialRecord } from "../types";
/** Descriptive measurements. No inference about mental intent or treatment efficacy. */
export class KpiCalculator {
 summarize(trials:TrialRecord[]):KpiSummary {
  const scored=trials.filter(t=>t.scored), correct=scored.filter(t=>t.destinationMatch);
  const independent=correct.filter(t=>t.feedbackMode==="blind"&&t.hintLevel===0&&t.cueReplayCount===0);
  return {total:trials.length,scored:scored.length,destinationAccuracy:ratio(correct.length,scored.length),
   independentAccuracy:ratio(independent.length,scored.length),
   // Retained for schema compatibility. Absence of a loss report is not availability.
   availabilityRate:0,
   medianLatencyMs:median(scored.map(t=>t.selectionLatencyMs).filter(finite)),
   hintRate:ratio(trials.filter(t=>t.hintLevel>0||(t.cueReplayCount??0)>0).length,trials.length),
   mapLossRate:ratio(trials.filter(t=>t.lostEvent||t.intent==="no-target"||t.finalErrorKind==="no-target").length,trials.length),
   // Older recovery fields measured onset, not a correct restart. Do not aggregate them.
   medianRecoveryMs:null,
   correctTargetMedianResidual:median(correct.map(t=>t.targetErrorCents).filter(finite).map(Math.abs))};
 }
 byExercise(trials:TrialRecord[]):Map<string,KpiSummary>{const groups=new Map<string,TrialRecord[]>();for(const t of trials){const a=groups.get(t.definition.exerciseId)??[];a.push(t);groups.set(t.definition.exerciseId,a);}return new Map([...groups].map(([id,ts])=>[id,this.summarize(ts)]));}
 /** Only Silent Map, blind, without replay or hints. Other conditions need separate contrasts. */
 byDelay(trials:TrialRecord[]):Array<{delayMs:number;accuracy:number;n:number}>{
  const groups=new Map<number,TrialRecord[]>();
  for(const t of trials.filter(t=>t.scored&&t.definition.exerciseId==="silent"&&t.feedbackMode==="blind"&&t.hintLevel===0&&t.cueReplayCount===0)){
   const a=groups.get(t.definition.delayMs)??[];a.push(t);groups.set(t.definition.delayMs,a);
  }
  return [...groups].map(([delayMs,ts])=>({delayMs,accuracy:ratio(ts.filter(t=>t.destinationMatch).length,ts.length),n:ts.length})).sort((a,b)=>a.delayMs-b.delayMs);
 }
 /** Descriptive nonoverlapping buckets. Never used as a matched progress comparison. */
 trend(trials:TrialRecord[],bucketSize=10):Array<{index:number;accuracy:number}>{
  if(!Number.isInteger(bucketSize)||bucketSize<1)throw new Error("Invalid bucket size");
  const ts=trials.filter(t=>t.scored).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  const out=[];for(let i=0;i<ts.length;i+=bucketSize){const a=ts.slice(i,i+bucketSize);out.push({index:out.length,accuracy:ratio(a.filter(t=>t.destinationMatch).length,a.length)});}return out;
 }
}
function ratio(n:number,d:number){return d?n/d:0;}
function finite(v:number|null|undefined):v is number{return v!=null&&Number.isFinite(v);}
