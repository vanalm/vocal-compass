import { describe, expect, it } from "vitest";
import { EVIDENCE, DECISIONS, EXERCISE_REASON } from "../src/core/science/evidence";
import { exercises } from "../src/core/exercises/registry";
import { checkinBlocks } from "../src/core/measurement/checkins";
import { fixtureBlock } from "./auditFixtures";

describe("Claim-level evidence contract",()=>{
 it("keeps stable unique citations and explicit limits, access and review dates",()=>{
  expect(new Set(EVIDENCE.map(e=>e.id)).size).toBe(EVIDENCE.length);
  for(const e of EVIDENCE){
   expect(new URL(e.url).protocol).toBe("https:");
   for(const field of [e.title,e.citation,e.design,e.population,e.finding,e.limit,e.decision,e.access])expect(field.length).toBeGreaterThan(12);
   expect(e.reviewed).toBe("2026-09-29");
   if(e.doi)expect(e.doi).toMatch(/^10\.\d{4,9}\//);
   if(e.pmid)expect(e.pmid).toMatch(/^\d+$/);
  }
 });
 it("gives every exercise a tentative rationale and linked, limited evidence",()=>{
  for(const e of exercises.all()){
   expect(EXERCISE_REASON[e.id]).toBeTruthy();
   expect(e.guide.science.length).toBeGreaterThan(0);
   for(const source of e.guide.science){expect(source.source).toContain("https:");expect(source.point).toContain("Limits:");}
  }
 });
 it("keeps every design alternative tied to real source IDs",()=>{
  expect(DECISIONS.length).toBeGreaterThanOrEqual(4);
  for(const d of DECISIONS)for(const id of d.refs)expect(EVIDENCE.some(e=>e.id===id)).toBe(true);
 });
 it.each([undefined,NaN,3000,1600])("does not compare a silent interval with invalid timing %s",value=>{
  const rows=fixtureBlock();rows[9].actualSilentMs=value;
  expect(checkinBlocks(rows)[0].complete).toBe(false);
 });
});
