import { type ExerciseSession,type Lane,type PhraseRecord,type RangeMeasurement,type TrialRecord } from "../../core";
import { checkinBlocks, comparableCheckins } from "../../core/measurement/checkins";
import { nextActions } from "../../core/protocol/nextActions";
import { GoalCard } from "../components/GoalCard";
export function TodayScreen({trials,ranges,sessions,phraseRecords,onGo}:{trials:TrialRecord[];ranges:RangeMeasurement[];sessions:ExerciseSession[];phraseRecords:PhraseRecord[];onGo:(lane:Lane)=>void}){
 const blocks=checkinBlocks(trials),complete=blocks.filter(b=>b.complete),last=complete.at(-1),comparison=comparableCheckins(trials);
 const next=nextActions(new Date(),trials,ranges,sessions)[0];
 const score=last?.score;
 return <div className="vc-home">
  <header className="vc-page-heading vc-home-heading"><span className="vc-eyebrow">A practice you can understand</span><h2>Know the note.<br/><span>Then make it yours.</span></h2><p>Find your next note, practice it with less help, and see what holds up on another day.</p></header>
  <GoalCard/>
  <section className="vc-card vc-next-session"><div><span className="vc-eyebrow">Start here</span><h3>{next.title}</h3><p>{next.detail}</p><p className="vc-small">Keep it brief · comfortable voice only · headphones for microphone work</p></div><button className="vc-button primary" onClick={()=>onGo(next.lane)}>{next.cta}<span aria-hidden="true"> →</span></button></section>
  <section className="vc-home-stats" aria-label="Your current evidence"><div><span>Latest complete check-in</span><strong>{score?.value!=null?`${score.hits}/${score.n}`:"Not established"}</strong><p>{score?`${last!.attempted-score.n} unscored captures · first stable note`:`${complete.length} complete blocks; older practice is kept separately.`}</p></div><div><span>Across different days</span><strong>{comparison?"Ready to compare":"More evidence needed"}</strong><p>{comparison?"See the observed change and uncertainty in Progress.":"Repeat the same conditions on another day; one session is not a trend."}</p></div><div><span>Musical application</span><strong>{phraseRecords.length?`${phraseRecords.length} phrase attempts`:"Bring it to a phrase"}</strong><p>Use Quest for modeled phrases; then test your own music outside the app.</p></div></section>
  <section className="vc-card vc-card-pad"><h3>What would count as progress?</h3><div className="vc-three-up"><div><h4>A more reliable first note</h4><p>More correct first stable notes under the same check-in conditions, with enough scorable captures.</p></div><div><h4>Less support</h4><p>A route still works without a replay or live display. A supported practice score is not the same result.</p></div><div><h4>Comfortable music</h4><p>The same phrase feels easier on different days, then holds together with words or guitar.</p></div></div><a className="vc-link" href="#guide">See the method, research and other paths →</a></section>
 </div>;
}
