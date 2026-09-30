import { describe,expect,it } from "vitest";
import { nextActions } from "../src/core/protocol/nextActions";
import { fixtureBlock } from "./auditFixtures";
const now=new Date("2026-09-03T12:00:00Z");
describe("Next actions, not manufactured urgency",()=>{
 it("starts with a versioned check-in",()=>{expect(nextActions(now,[],[],[])[0].lane).toBe("test");});
 it("legacy practice cannot satisfy the check-in requirement",()=>{const rows=fixtureBlock().map(({measurement,...t})=>t);expect(nextActions(now,rows,[],[])[0].lane).toBe("test");});
 it("incomplete blocks do not satisfy it",()=>expect(nextActions(now,fixtureBlock().slice(0,14),[],[])[0].lane).toBe("test"));
 it("offers practice after a recent complete block",()=>expect(nextActions(now,fixtureBlock(),[],[])[0].lane).toBe("pitch"));
 it("offers a repeat after the suggested weekly interval",()=>expect(nextActions(new Date("2026-09-10T12:00:00Z"),fixtureBlock(),[],[])[0].lane).toBe("test"));
 it("never makes optional range exercise overdue",()=>{for(const l of nextActions(now,[],[],[])){expect(l.lane).not.toBe("range-exercise");expect(l.daysOverdue).toBe(0);}});
 it("every action explains its purpose",()=>{for(const l of nextActions(now,[],[],[])){expect(l.title.length).toBeGreaterThan(3);expect(l.cta.length).toBeGreaterThan(3);expect(l.detail.length).toBeGreaterThan(30);}});
});
