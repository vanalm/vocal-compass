import { describe,expect,it } from "vitest";
import { improvementSummary } from "../src/core/kpi/improvement";
import { fixtureBlock } from "./auditFixtures";
describe("Matched observed change, never a significance claim",()=>{
 it("returns no comparison without two complete blocks",()=>expect(improvementSummary(fixtureBlock(),[])).toBeNull());
 it("does not compare first-ten and last-ten legacy practice",()=>{const rows=[...fixtureBlock(),...fixtureBlock("b","2026-09-02T12:00:00Z",15)].map(({measurement,...t})=>t);expect(improvementSummary(rows,[])).toBeNull();});
 it("reports signed percentage-point change on comparable tasks",()=>{const s=improvementSummary([...fixtureBlock("a",undefined,3),...fixtureBlock("b","2026-09-02T12:00:00Z",12)],[])!;expect(s.destinationAccuracy.deltaPts).toBe(60);expect(s.windowSize).toBe(15);});
 it("reports declines instead of hiding them",()=>{const s=improvementSummary([...fixtureBlock("a",undefined,12),...fixtureBlock("b","2026-09-02T12:00:00Z",3)],[])!;expect(s.destinationAccuracy.deltaPts).toBe(-60);expect(s.destinationAccuracy.rose).toBe(false);});
 it("keeps missing residuals null",()=>{const s=improvementSummary([...fixtureBlock("a",undefined,0),...fixtureBlock("b","2026-09-02T12:00:00Z",12)],[])!;expect(s.residualCents).toBeNull();});
 it("scales cents independently of percentages",()=>{const a=fixtureBlock(),b=fixtureBlock("b","2026-09-02T12:00:00Z");a.forEach(t=>t.targetErrorCents=40);b.forEach(t=>t.targetErrorCents=10);const s=improvementSummary([...a,...b],[])!;expect(s.residualCents!.deltaPts).toBe(-30);});
 it("does not pool range gains into pitch learning",()=>{const s=improvementSummary([...fixtureBlock(),...fixtureBlock("b","2026-09-02T12:00:00Z")],[{id:"r",createdAt:"2026-09-01",lowMidi:30,highMidi:80}])!;expect(s.range).toBeNull();});
 it("refuses comparisons with no scorable input",()=>{const rows=[...fixtureBlock(),...fixtureBlock("b","2026-09-02T12:00:00Z")].map(t=>({...t,scored:false}));expect(improvementSummary(rows,[])).toBeNull();});
});
