import { describe,expect,it } from "vitest";
import { checkinBlocks,checkinItems,comparableCheckins,observedRate,rate,residual } from "../src/core/measurement/checkins";
import { fixtureBlock } from "./auditFixtures";
describe("Versioned check-in instrument",()=>{
 it("uses deterministic, balanced item definitions",()=>{const a=checkinItems(),b=checkinItems();expect(a.map(t=>[t.id,t.targetMidi,t.phraseMidis])).toEqual(b.map(t=>[t.id,t.targetMidi,t.phraseMidis]));expect(a).toHaveLength(15);for(const id of ["echo","route","tonal","silent","missing"])expect(a.filter(t=>t.exerciseId===id)).toHaveLength(3);});
 it("transposes relationships without changing interval sizes",()=>{const a=checkinItems(48),b=checkinItems(53);a.forEach((t,i)=>{expect(b[i].targetMidi-t.targetMidi).toBe(5);expect(b[i].startMidi-t.startMidi).toBe(5);});});
 it("has alternative forms without claiming their equivalence",()=>{expect(checkinItems(48,"A").map(t=>t.targetMidi)).not.toEqual(checkinItems(48,"B").map(t=>t.targetMidi));});
 it("rejects invalid form and anchor inputs",()=>{for(const m of [NaN,35,61,48.5])expect(()=>checkinItems(m)).toThrow();expect(()=>checkinItems(48,"bad")).toThrow();});
 it("recognizes only a complete first-attempt block",()=>{const rows=fixtureBlock();expect(checkinBlocks(rows)[0].complete).toBe(true);expect(checkinBlocks(rows.slice(0,14))[0].complete).toBe(false);});
 it("never promotes legacy practice into a baseline",()=>{const rows=fixtureBlock().map(({measurement,...rest})=>rest);expect(checkinBlocks(rows)).toEqual([]);expect(comparableCheckins(rows)).toBeNull();});
 it.each(["hint","replay","live","retry","version","scoring","device","filter","ordinal","item","count"])("rejects %s contamination",kind=>{
  const rows=fixtureBlock();const t=rows[7];
  if(kind==="hint")t.hintLevel=1;if(kind==="replay")t.cueReplayCount=1;if(kind==="live")t.feedbackMode="live";if(kind==="retry")t.measurement!.firstTake=false;
  if(kind==="version")t.measurement!.protocolVersion="old";if(kind==="scoring")t.measurement!.scoringVersion="old";
  if(kind==="device")t.micInput="different microphone";if(kind==="filter")t.micLowCut="100";if(kind==="ordinal")t.measurement!.itemIndex=1;if(kind==="item")t.definition.targetMidi+=1;if(kind==="count")t.measurement!.itemCount=12;
  expect(checkinBlocks(rows)[0].complete).toBe(false);
 });
 it("missing device context is not silently comparable",()=>{const rows=fixtureBlock();rows.forEach(t=>t.micInput=null);expect(checkinBlocks(rows)[0].complete).toBe(false);});
 it("keeps unscored captures and shows the denominator",()=>{const rows=fixtureBlock();rows[0].scored=false;const b=checkinBlocks(rows)[0];expect(b.complete).toBe(true);expect(b.attempted).toBe(15);expect(b.score.n).toBe(14);expect(b.score.hits).toBe(7);});
 it("all unscored is not zero accuracy or perfect cents",()=>{const rows=fixtureBlock().map(t=>({...t,scored:false}));expect(observedRate(rows).value).toBeNull();expect(residual(rows)).toBeNull();});
 it("missing matched notes is not zero cents",()=>{expect(residual(fixtureBlock("a",undefined,0))).toBeNull();});
 it("compares complete blocks on different days with matching conditions",()=>{const rows=[...fixtureBlock(),...fixtureBlock("b","2026-09-02T12:00:00Z",12)];const p=comparableCheckins(rows)!;expect(p.first.id).toBe("a");expect(p.latest.id).toBe("b");expect(p.first.score.hits).toBe(8);expect(p.latest.score.hits).toBe(12);});
 it("does not treat immediate same-day retries as a longitudinal contrast",()=>{expect(comparableCheckins([...fixtureBlock(),...fixtureBlock("b","2026-09-01T15:00:00Z")])).toBeNull();});
 it.each(["form","anchor","mic","filter"])("does not compare different %s conditions",kind=>{const a=fixtureBlock(),b=fixtureBlock("b","2026-09-02T12:00:00Z",10,kind==="anchor"?50:48,kind==="form"?"B":"A");if(kind==="mic")b.forEach(t=>t.micInput="other");if(kind==="filter")b.forEach(t=>t.micLowCut="100");expect(comparableCheckins([...a,...b])).toBeNull();});
 it("deleted items invalidate complete-block comparisons",()=>{const a=fixtureBlock(),b=fixtureBlock("b","2026-09-02T12:00:00Z");expect(comparableCheckins([...a.slice(1),...b])).toBeNull();});
 it("sorting input cannot change block accuracy",()=>{const a=fixtureBlock();expect(checkinBlocks([...a].reverse())[0].score).toEqual(checkinBlocks(a)[0].score);});
});
describe("Descriptive uncertainty",()=>{
 it("no denominator is an empty estimate",()=>{expect(rate(0,0)).toEqual({hits:0,n:0,value:null,low:null,high:null});});
 it("retains uncertainty at zero and perfect observed performance",()=>{expect(rate(0,3).high).toBeGreaterThan(.5);expect(rate(3,3).low).toBeLessThan(.5);});
 it("matches the Wilson interval for 8 of 10",()=>{const r=rate(8,10);expect(r.low).toBeCloseTo(.4902,3);expect(r.high).toBeCloseTo(.9433,3);});
 it.each([[4,3],[-1,3],[1,-1],[1.2,3],[0,NaN]])("rejects invalid counts %s/%s",(h,n)=>expect(()=>rate(h,n)).toThrow());
});
