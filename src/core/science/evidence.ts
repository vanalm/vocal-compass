/** Curated claim-level evidence, not a systematic review. See docs/science-audit.md. */
export interface Evidence {
 id: string; title: string; citation: string; doi?: string; pmid?: string; url: string;
 design: string; population: string; finding: string; limit: string; decision: string;
 access: string; reviewed: string; tags: string[];
}
export const EVIDENCE: Evidence[] = [
  {
    "id": "feedback-short",
    "title": "Visual and auditory feedback for pitch remediation",
    "citation": "Berglin, Pfordresher & Demorest (2022). Psychology of Music.",
    "doi": "10.1177/03057356211026730",
    "design": "Randomized, single-session training study",
    "population": "Adults identified as inaccurate singers; 20-minute intervention.",
    "finding": "The visual-plus-auditory training condition improved accuracy, especially on four-note melodies. The auditory-only and control conditions did not show the same significant training effect.",
    "limit": "The combined condition does not isolate the visual display. One session does not establish lasting learning, a percentage-point gain, or efficacy of this app.",
    "decision": "Offer visual coaching in practice, but measure performance without the display.",
    "access": "Publisher abstract reviewed",
    "tags": [
      "echo",
      "route",
      "feedback"
    ],
    "url": "https://doi.org/10.1177/03057356211026730",
    "reviewed": "2026-09-29"
  },
  {
    "id": "feedback-long",
    "title": "Concurrent visual feedback over ten weeks",
    "citation": "Paney & Tharp (2021; online 2019). Psychology of Music.",
    "doi": "10.1177/0305735619854534",
    "design": "Ten-week comparison of adult singing practice conditions",
    "population": "Adult singers practicing with or without concurrent visual feedback.",
    "finding": "Both groups improved. Concurrent visual feedback did not produce significantly greater accuracy than the comparison practice.",
    "limit": "A nonsignificant difference is not proof of equivalence or proof of feedback dependence. The result does not establish our feedback-fading schedule.",
    "decision": "Treat feedback as an optional aid, not the active ingredient proven to improve every singer.",
    "access": "Publisher abstract reviewed",
    "tags": [
      "echo",
      "route",
      "feedback"
    ],
    "url": "https://doi.org/10.1177/0305735619854534",
    "reviewed": "2026-09-29"
  },
  {
    "id": "imagery",
    "title": "Imagery and pitch imitation",
    "citation": "Pfordresher & Halpern (2013). Psychonomic Bulletin & Review.",
    "doi": "10.3758/s13423-013-0401-8",
    "pmid": "23413013",
    "design": "Individual-differences study",
    "population": "Participants completing vocal imitation, perception and imagery measures.",
    "finding": "Self-rated auditory-imagery vividness was associated with vocal imitation accuracy.",
    "limit": "Association does not show that imagery exercises cause improvement or identify an individual singer’s bottleneck.",
    "decision": "Use hear–imagine–sing as a testable practice strategy, and compare immediate with delayed matching.",
    "access": "PubMed abstract reviewed",
    "tags": [
      "silent",
      "missing",
      "route"
    ],
    "url": "https://doi.org/10.3758/s13423-013-0401-8",
    "reviewed": "2026-09-29"
  },
  {
    "id": "interference",
    "title": "Vocal interference during an imagined melody",
    "citation": "Greenspon, Pruitt, Halpern & Pfordresher (2025). Attention, Perception, & Psychophysics.",
    "doi": "10.3758/s13414-025-03073-y",
    "pmid": "40325328",
    "design": "Experimental interference study",
    "population": "Participants imagining and then imitating four-note melodies.",
    "finding": "Phonatory interference during the imagery period disrupted subsequent pitch imitation.",
    "limit": "Disrupting a process is not the same as showing that a specific training program improves it. Long-term training benefit was not the question tested.",
    "decision": "Keep initial silent-rehearsal exercises quiet and simple. Do not sell them as a validated memory treatment.",
    "access": "Publisher abstract reviewed",
    "tags": [
      "silent",
      "missing",
      "route"
    ],
    "url": "https://doi.org/10.3758/s13414-025-03073-y",
    "reviewed": "2026-09-29"
  },
  {
    "id": "context",
    "title": "Familiar tonal context and interval perception",
    "citation": "Graves & Oxenham (2017). Frontiers in Psychology.",
    "doi": "10.3389/fpsyg.2017.01753",
    "url": "https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2017.01753/full",
    "design": "Two pitch-perception experiments",
    "population": "Listeners judging intervals in familiar tonal contexts.",
    "finding": "Benefits depended on the kind of context; harmonic context improved interval judgments in the second experiment.",
    "limit": "Perceptual judgments are not vocal production. Familiar tonal conventions do not generalize automatically to all musical traditions.",
    "decision": "Use a home chord as optional scaffolding in Tonal North, not as proof of better singing.",
    "access": "Open-access article reviewed",
    "tags": [
      "tonal"
    ],
    "reviewed": "2026-09-29"
  },
  {
    "id": "lyrics",
    "title": "Syllables versus lyrics",
    "citation": "Berkowska & Dalla Bella (2009). Annals of the New York Academy of Sciences.",
    "doi": "10.1111/j.1749-6632.2009.04774.x",
    "pmid": "19673763",
    "design": "Within-participant singing task comparison",
    "population": "39 occasional singers; three familiar melodies.",
    "finding": "Reducing linguistic information improved singing proficiency in the tested tasks.",
    "limit": "An immediate task difference does not prove lasting transfer or tell us whether memory, articulation or divided attention explains a particular miss.",
    "decision": "Compare the same phrase on a comfortable syllable and with lyrics. Guitar and accompaniment comparisons remain separate questions.",
    "access": "PubMed abstract reviewed",
    "tags": [
      "missing",
      "song"
    ],
    "url": "https://doi.org/10.1111/j.1749-6632.2009.04774.x",
    "reviewed": "2026-09-29"
  },
  {
    "id": "pitch-range",
    "title": "Wider pitch-matching practice",
    "citation": "Pfordresher & Greenspon (2025; online 2024). Musicae Scientiae.",
    "doi": "10.1177/10298649241289542",
    "design": "Three-group, single-session training experiment",
    "population": "Singers trained over an octave, a perfect fifth, or a visual-imagery control task.",
    "finding": "Only the octave-training group showed significant improvement on single-pitch matching; four-note melodies did not show that benefit.",
    "limit": "This concerns pitch-matching accuracy, not physiological range expansion, register technique or higher belting. The support was partial and task-specific.",
    "decision": "Vary pitches within an already comfortable range. Do not push the upper limit to pursue a score.",
    "access": "Publisher abstract reviewed",
    "tags": [
      "echo",
      "range"
    ],
    "url": "https://doi.org/10.1177/10298649241289542",
    "reviewed": "2026-09-29"
  },
  {
    "id": "vfe",
    "title": "The original Vocal Function Exercises trial",
    "citation": "Stemple, Lee, D’Amico & Pickup (1994). Journal of Voice.",
    "doi": "10.1016/S0892-1997(05)80299-1",
    "pmid": "7987430",
    "design": "Randomized exercise, placebo and control groups; four weeks",
    "population": "35 adult women with normal voices.",
    "finding": "The exercise group improved several voice-production measures, including frequency range.",
    "limit": "This supports the studied protocol in that population, not an all-trill adaptation, a guaranteed gain, or a male singer’s higher belt.",
    "decision": "Distinguish clinician/teacher-delivered VFE from this app’s optional gentle exploration. The latter has not been validated.",
    "access": "PubMed abstract reviewed",
    "tags": [
      "range"
    ],
    "url": "https://doi.org/10.1016/S0892-1997(05)80299-1",
    "reviewed": "2026-09-29"
  },
  {
    "id": "dose",
    "title": "VFE dosage: repetitions are not frequency",
    "citation": "Bane et al. (2019; online 2017). International Journal of Speech-Language Pathology.",
    "doi": "10.1080/17549507.2017.1373858",
    "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC6207485/",
    "design": "Randomized dosage comparison over six weeks",
    "population": "Young adults with normal voices; maximum phonation time was a central outcome.",
    "finding": "All groups practiced twice daily. The manipulated dose was one, two or four repetitions per exercise.",
    "limit": "This does not compare once-daily with twice-daily practice. It cannot establish this app’s optimal dose or a safe range-expansion prescription.",
    "decision": "Remove the old claim that once daily was insufficient. Choose a manageable practice cadence and reassess comfort and results.",
    "access": "Article record and author’s study abstract reviewed",
    "tags": [
      "range"
    ],
    "reviewed": "2026-09-29"
  },
  {
    "id": "repeatability",
    "title": "Voice-range measurements change on retest",
    "citation": "Printz et al. (2018). Journal of Voice.",
    "doi": "10.1016/j.jvoice.2017.03.019",
    "design": "Test–retest measurement study",
    "population": "37 healthy adults using a dual-microphone voice-range profile; retest after 6–37 days.",
    "finding": "The mean measured frequency span rose about 1.4 semitones on retest.",
    "limit": "A group mean retest shift is not an individual minimum detectable change. A coached laboratory protocol does not calibrate a browser microphone.",
    "decision": "Show observed range changes with method caveats; repeat them across days. Do not call three semitones a validated threshold.",
    "access": "Publisher article record reviewed",
    "tags": [
      "range",
      "measurement"
    ],
    "url": "https://doi.org/10.1016/j.jvoice.2017.03.019",
    "reviewed": "2026-09-29"
  },
  {
    "id": "voice-care",
    "title": "Taking care of your voice",
    "citation": "National Institute on Deafness and Other Communication Disorders (NIDCD).",
    "url": "https://www.nidcd.nih.gov/health/taking-care-your-voice",
    "design": "Public-health guidance, not a training trial",
    "population": "People using their voice, including singers.",
    "finding": "Avoid singing when the voice is hoarse or tired, rest during illness, and avoid extremes. Losing previously available high notes is a warning sign.",
    "limit": "The app cannot diagnose vocal health, hear strain reliably, or certify that an exercise is safe for a particular person.",
    "decision": "Check readiness before singing; stop for pain or strain. Discuss persistent or concerning voice changes with a qualified clinician.",
    "access": "Agency guidance reviewed",
    "tags": [
      "range",
      "safety"
    ],
    "reviewed": "2026-09-29"
  }
];
export function evidenceFor(id: string): Evidence[] {
 return EVIDENCE.filter(s => s.tags.includes(id));
}
export const PROTOCOL_VERSION = "vc-checkin-2";
export const SCORING_VERSION = "stable-center-2";
export const REVIEW_DATE = "2026-09-29";
export const EXERCISE_REASON: Record<string, string> = {
 echo: "Check how closely you reproduce a freshly heard note. A useful comparison for the memory tasks—not a diagnosis of vocal technique.",
 route: "Practice returning to a learned destination from its starting note. This is our training hypothesis, not a proven explanation of your misses.",
 silent: "Compare matching after silence with immediate matching. Keep delay, range and feedback constant when comparing sessions.",
 tonal: "Use the home chord to orient within a familiar key. This adds musical context, so it is a different task from isolated note matching.",
 missing: "Continue a major-scale run using its direction and step size. This constrained task is not recall of a modeled song or proof that you can predict an arbitrary melody.",
};
export const DECISIONS = [
 { title: "Navigation first, not a universal singing score", chosen: "Track the first stable observed note, cents around it, support used and your own explanation separately.", why: "Different observations suggest different practice questions. Pitch alone cannot tell whether you intended a different note.", alternatives: "A tuner is useful for pitch control; a teacher can examine technique and intent. Neither is dismissed as inferior.", revisit: "If direct echo is also difficult, prioritize supported matching and teacher feedback rather than assuming a memory bottleneck.", refs: ["imagery", "feedback-short"] },
 { title: "Practice with help; check in without it", chosen: "Use live coaching when helpful. Check-ins hide pitch and results until the block ends and keep every completed first attempt.", why: "This separates aided performance from the result obtained without online pitch guidance. Evidence on extra benefit from a display is mixed.", alternatives: "Always-live practice and delayed feedback are both available. Blind practice is not claimed to be superior for every learner.", revisit: "Keep the practice method only if comparable check-ins and musical performance improve without extra effort.", refs: ["feedback-short", "feedback-long"] },
 { title: "An eight-week experiment, not a promise", chosen: "Baseline first, then a manageable pattern of short sessions, weekly check-ins and a review at week eight. Four sessions of up to 15 minutes is a planning suggestion.", why: "A bounded experiment gives enough opportunities to inspect progress without committing to an unproven prescription.", alternatives: "Shorter sessions, teacher-led lessons, choir, solfège and deliberate song practice can complement or replace the app.", revisit: "At week four, review adherence, comfort and comparable results. At week eight, continue, change methods or seek teaching based on the evidence—not a promised percentage gain.", refs: ["feedback-long", "lyrics"] },
 { title: "Range is a separate goal", chosen: "Record comfortably available notes. Keep range exploration optional, and do not equate a higher detected pitch with an easy or repeatable belt.", why: "Pitch-matching studies and clinical voice protocols do not validate high-belt training in this app.", alternatives: "Transpose the song; use a different vocal strategy with a teacher; omit range work while developing navigation.", revisit: "Stop for pain, hoarseness or strain. Assess persistent changes with a clinician, rather than chasing a range number.", refs: ["pitch-range", "vfe", "voice-care"] },
];
