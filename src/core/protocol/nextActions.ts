import { checkinBlocks } from "../measurement/checkins";
import type { ExerciseSession, RangeMeasurement, TrialRecord } from "../types";
export type Lane="test"|"range-exercise"|"pitch"|"range-probe";
export interface LaneStatus {lane:Lane;title:string;cta:string;due:boolean;daysOverdue:number;detail:string;}
/** Cadences are planning defaults, not validated prescriptions. Range is never compulsory. */
export function nextActions(now:Date,trials:TrialRecord[],_ranges:RangeMeasurement[],_sessions:ExerciseSession[]):LaneStatus[]{
 const last=checkinBlocks(trials).filter(b=>b.complete).at(-1);
 const needsCheckin=!last||(now.getTime()-new Date(last.date).getTime())>=7*86400000;
 const checkin:LaneStatus={lane:"test",title:last?"A comparable check-in":"Your starting snapshot",cta:last?"Repeat check-in":"Take a first check-in",due:needsCheckin,daysOverdue:0,detail:last?"Repeat the same form, home note, microphone and filter. Weekly is a suggested review cadence, not an obligation.":"15 first attempts, no online pitch guidance. This is a preliminary snapshot—not a diagnosis."};
 const practice:LaneStatus={lane:"pitch",title:"One practice question",cta:"Open pitch practice",due:true,daysOverdue:0,detail:"Choose immediate matching, a learned route or a silent delay. Keep the range easy; stop before effort builds."};
 return needsCheckin?[checkin,practice]:[practice,checkin];
}
