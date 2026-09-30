import { describe,expect,it } from "vitest";
import { vocalFunctionExercises,rangeChangeVerdict,MEANINGFUL_RANGE_CHANGE_ST,MEASUREMENT_DRIFT_ST } from "../src/core/protocol/rangePlan";
describe("Optional exploration, not substituted VFE",()=>{
 const plan=vocalFunctionExercises();
 it("has a separate versioned identity from previously prescribed VFE",()=>{expect(plan.id).toBe("gentle-exploration-v2");expect(plan.title).toMatch(/optional/i);});
 it("has instructions, rationale and a limitation for each step",()=>{for(const s of plan.steps){expect(s.what.length).toBeGreaterThan(25);expect(s.why.length).toBeGreaterThan(20);expect(s.evidence.length).toBeGreaterThan(30);}});
 it("does not prescribe a dose or promise time to effect",()=>{expect(plan.timesPerDay).toBe(0);expect(plan.weeksToEffect).toBe(0);});
 it("includes rest and brief rather than maximum phonation",()=>{expect(plan.steps.some(s=>!s.sovt)).toBe(true);expect(plan.steps.filter(s=>s.sovt).every(s=>s.maxSeconds<=5)).toBe(true);});
 it("does not train the highest possible note",()=>{expect(plan.steps.find(s=>s.id==="stretch")!.what).toMatch(/Do not aim for your highest note/);});
});
describe("Observed range movement",()=>{
 it.each([1.4,3,5,-1,-4])("does not certify %s semitones as real change",delta=>{const v=rangeChangeVerdict(20,20+delta);expect(v.deltaSemitones).toBeCloseTo(delta);expect(v.meaningful).toBe(false);expect(v.label).toMatch(/observed/i);expect(v.label).toMatch(/no individual meaningful-change threshold/i);});
 it("preserves direction",()=>{expect(rangeChangeVerdict(20,22).direction).toBe("up");expect(rangeChangeVerdict(20,18).direction).toBe("down");expect(rangeChangeVerdict(20,20).direction).toBe("flat");});
 it("does not convert group retest bias into an individual cutoff",()=>{expect(MEASUREMENT_DRIFT_ST).toBe(1.4);expect(MEANINGFUL_RANGE_CHANGE_ST).toBeNull();});
});
