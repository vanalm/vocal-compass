import { comparableCheckins, residual } from "../measurement/checkins";
import type { RangeMeasurement,TrialRecord } from "../types";
/** Compatibility field `improved` indicates favorable direction only, never significance. */
export interface Movement {first:number;latest:number;deltaPts:number;rose:boolean;improved:boolean;}
export interface RangeMovement {first:number;latest:number;deltaSemitones:number;improved:boolean;}
export interface ImprovementSummary {destinationAccuracy:Movement;independentAccuracy:Movement;residualCents:Movement|null;hintRate:Movement;range:RangeMovement|null;accuracySparkline:number[];anyImprovement:boolean;windowSize:number;}
/** Versioned, complete, like-condition check-ins on different days only. */
export function improvementSummary(trials:TrialRecord[],_ranges:RangeMeasurement[]):ImprovementSummary|null{
 const pair=comparableCheckins(trials);if(!pair||pair.first.score.value==null||pair.latest.score.value==null)return null;
 const move=(first:number,latest:number,scale:number,up=true):Movement=>({first,latest,deltaPts:Math.round((latest-first)*scale*10)/10,rose:latest>first,improved:up?latest>first:latest<first});
 const a=move(pair.first.score.value,pair.latest.score.value,100),ra=residual(pair.first.rows),rb=residual(pair.latest.rows);
 const r=ra!=null&&rb!=null?move(ra,rb,1,false):null;
 return {destinationAccuracy:a,independentAccuracy:a,residualCents:r,hintRate:move(0,0,100,false),range:null,accuracySparkline:[a.first,a.latest],anyImprovement:a.improved||Boolean(r?.improved),windowSize:pair.first.rows.length};
}
