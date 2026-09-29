import type { Exercise } from "../exercises/Exercise";
import { KpiCalculator } from "../kpi/KpiCalculator";
import { checkinBlocks } from "../measurement/checkins";
import type { TrialRecord } from "../types";
export interface Recommendation {exercise:Exercise;reason:string;}
/** A question to practice, not a diagnosis derived from mixed historical scores. */
export class Recommender{
 constructor(_kpi:KpiCalculator=new KpiCalculator()){}
 recommend(trials:TrialRecord[],available:Exercise[]):Recommendation{
  if(!available.length)throw new Error("No exercises available");
  const block=checkinBlocks(trials).filter(b=>b.complete).at(-1);
  if(!block)return {exercise:available[0],reason:"Establish a versioned check-in baseline first; these mixed practice records cannot identify your bottleneck."};
  const candidates=block.moduleRates.filter(m=>m.rate.n>=3&&available.some(e=>e.id===m.id)).sort((a,b)=>a.rate.value!-b.rate.value!);
  const selected=candidates[0],exercise=available.find(e=>e.id===selected?.id)??available[0];
  return {exercise,reason:selected?`“${exercise.title}” had the lowest first-note hit rate in your latest complete check-in (${selected.rate.hits}/${selected.rate.n}). With only three attempts, this is a practice question—not a reliable deficit ranking.`:"Try immediate matching while you gather more scorable check-in data."};
 }
}
