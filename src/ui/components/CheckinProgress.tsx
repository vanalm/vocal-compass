import { useState } from "react";
import { checkinBlocks, comparableCheckins, residual, type Rate } from "../../core/measurement/checkins";
import type { TrialRecord } from "../../core";
const pct=(v:number|null)=>v==null?"—":`${Math.round(v*100)}%`;
export function RateReadout({rate}:{rate:Rate}){return <><strong>{pct(rate.value)}</strong><p>{rate.hits}/{rate.n} scorable attempts</p>{rate.n>0&&<p className="vc-small">Descriptive 95% interval: {pct(rate.low)}–{pct(rate.high)}</p>}</>;}
export function CheckinProgress({trials}:{trials:TrialRecord[]}){
 const blocks=checkinBlocks(trials),comparison=comparableCheckins(trials);
 const complete=blocks.filter(b=>b.complete),latest=complete.at(-1);
 const [expanded,setExpanded]=useState(false);
 const matching=latest?complete.filter(b=>b.signature===latest.signature):[];
 const date=(d:string)=>new Date(d).toLocaleDateString([], {month:"short",day:"numeric",year:"numeric"});
 return <>
  <section className="vc-card vc-card-pad"><span className="vc-eyebrow">Comparable check-ins</span><h3>{comparison?"An observed change—not yet an explanation.":"Build a repeatable starting point."}</h3>
   {!comparison?<p>Complete the same check-in on two different days. Keep form, home note, microphone and filter unchanged. Older or incomplete trials cannot establish this comparison.</p>:<>
    <div className="vc-two-up vc-score-comparison"><div><span>First · {date(comparison.first.date)}</span><RateReadout rate={comparison.first.score}/><p className="vc-small">{comparison.first.attempted-comparison.first.score.n} unscored</p></div><div><span>Latest · {date(comparison.latest.date)}</span><RateReadout rate={comparison.latest.score}/><p className="vc-small">{comparison.latest.attempted-comparison.latest.score.n} unscored</p></div></div>
    <p className="vc-notice">{comparison.first.score.value!=null&&comparison.latest.score.value!=null?`Observed difference: ${Math.round((comparison.latest.score.value-comparison.first.score.value)*100)} percentage points. `:"Not enough scorable input for a difference. "}Small samples, familiar items and day-to-day variation limit interpretation. This is not a significance test or evidence that the app caused a change.</p>
    <p className="vc-small">Median absolute cents on matched notes: {residual(comparison.first.rows)?.toFixed(0)??"—"} → {residual(comparison.latest.rows)?.toFixed(0)??"—"}. Missing matches are not zero-cent error.</p>
   </>}
   {matching.length>1&&<><svg role="img" aria-labelledby="checkin-chart-title" className="vc-history-chart" viewBox="0 0 640 230"><title id="checkin-chart-title">First-note hit rates by check-in date. Values and capture counts are in the table below.</title>{[0,0.5,1].map(y=><g key={y}><line x1="45" x2="615" y1={195-y*165} y2={195-y*165} stroke="currentColor" opacity=".15"/><text x="5" y={199-y*165} fill="currentColor" fontSize="12">{Math.round(y*100)}%</text></g>)}{matching.map((b,i)=>{const x=55+i*550/(matching.length-1),v=b.score.value;return v==null?null:<g key={b.id}><line x1={x} x2={x} y1={195-b.score.low!*165} y2={195-b.score.high!*165} stroke="currentColor" opacity=".5"/><circle cx={x} cy={195-v*165} r="5" fill="currentColor"/><text x={x} y="220" textAnchor="middle" fill="currentColor" fontSize="11">{i===0||i===matching.length-1?new Date(b.date).toLocaleDateString([], {month:"short",day:"numeric"}):""}</text></g>;})}</svg><p className="vc-small">Each point is one comparable block, spaced by check-in sequence. Bars show descriptive uncertainty, not calibrated measurement noise.</p></>}
   <button className="vc-button ghost" onClick={()=>setExpanded(v=>!v)} aria-expanded={expanded}>{expanded?"Hide":"Show"} check-in history ({blocks.length})</button>
   {expanded&&<div className="vc-table-wrap"><table className="vc-table"><caption>All check-in blocks, including incomplete or mismatched ones</caption><thead><tr><th>Date</th><th>Saved</th><th>First-note hits</th><th>Capture coverage</th><th>Comparison status</th></tr></thead><tbody>{blocks.map(b=><tr key={b.id}><td>{date(b.date)}</td><td>{b.attempted}/15</td><td>{b.score.hits}/{b.score.n}</td><td>{b.score.n}/{b.attempted}</td><td>{b.complete?"Complete; compare like conditions":b.issues.join("; ")}</td></tr>)}</tbody></table>{!blocks.length&&<p>No check-in blocks saved yet.</p>}</div>}
  </section>
 </>;
}
