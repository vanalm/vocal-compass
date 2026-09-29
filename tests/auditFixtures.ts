/** Synthetic records for measurement regression tests. Never user performance data. */
import { checkinItems } from "../src/core/measurement/checkins";
import { PROTOCOL_VERSION,SCORING_VERSION } from "../src/core/science/evidence";
import { noteName } from "../src/core/music/theory";
import type { TrialRecord } from "../src/core/types";
export function fixtureBlock(id="a",date="2026-09-01T12:00:00Z",hits=8,anchor=48,form="A"):TrialRecord[]{
 return checkinItems(anchor,form).map((definition,i)=>({
 id:`${id}-${i}`,definition,scored:true,selectedMidi:definition.targetMidi+(i<hits?0:1),selectedNote:noteName(definition.targetMidi+(i<hits?0:1)),targetNote:noteName(definition.targetMidi),targetErrorCents:i<hits?20:100,residualToSelectedCents:i<hits?20:0,destinationMatch:i<hits,cleanLandingOnSelected:true,wrongDirection:false,octaveDisplacement:false,searchTransitions:0,pitchPathSemitones:0,stabilityCents:5,detectorConfidence:.9,acousticErrorKind:i<hits?"success":"selection",explanation:"Synthetic fixture",feedbackMode:"blind",hintLevel:0,lostEvent:false,intent:null,finalErrorKind:i<hits?"success":"selection",selectionLatencyMs:500,recoveryTimeMs:null,confidenceBefore:3,effort:2,register:"unknown",trace:[],createdAt:new Date(new Date(date).getTime()+i*30000).toISOString(),micInput:"Synthetic USB microphone",micLowCut:"60",cueReplayCount:0,actualSilentMs:definition.exerciseId==="silent"?2000:900,
 measurement:{purpose:"checkin",protocolVersion:PROTOCOL_VERSION,scoringVersion:SCORING_VERSION,blockId:id,itemIndex:i,itemCount:15,formId:form,anchorMidi:anchor,firstTake:true,selfReportsCollected:false}
 }));
}
