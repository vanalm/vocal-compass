import { practiceDays } from "../kpi/practiceTime";
import type { ExerciseSession, RangeMeasurement, TrialRecord } from "../types";

export type Lane = "test" | "range-exercise" | "pitch" | "range-probe";

export interface LaneStatus {
  lane: Lane;
  title: string;
  /** Button label. */
  cta: string;
  due: boolean;
  /** Whole days past the cadence; 0 = due today but not late. */
  daysOverdue: number;
  detail: string;
}

/** Cadences, each traceable to the protocol docs rather than invented here. */
const PROBE_EVERY_DAYS = 7; // weekly probe; re-probing more often mostly measures practice drift
const PITCH_GRACE_DAYS = 2; // 4 sessions/week ≈ never more than 2 quiet days
const BASELINE_TRIALS = 15;

/**
 * "Where do I pick up?" — one status per training lane, most urgent first.
 * The baseline test outranks everything until it exists, because every other
 * number is meaningless without it.
 */
export function nextActions(
  now: Date,
  trials: TrialRecord[],
  ranges: RangeMeasurement[],
  sessions: ExerciseSession[],
): LaneStatus[] {
  const lanes: LaneStatus[] = [];
  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const today = dayKey(now);
  const daysSince = (iso: string) => {
    const then = new Date(iso);
    then.setHours(0, 0, 0, 0);
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return Math.round((start.getTime() - then.getTime()) / 86_400_000);
  };
  const latest = <T extends { createdAt: string }>(rows: T[]) =>
    rows.length ? rows.reduce((a, b) => (a.createdAt > b.createdAt ? a : b)) : null;

  if (trials.length < BASELINE_TRIALS) {
    lanes.push({
      lane: "test",
      title: "Baseline test",
      cta: "Take the test",
      due: true,
      daysOverdue: 0,
      detail: "Every other number is relative to this — 15 guided trials, ~10 minutes.",
    });
  }

  const lastSession = latest(sessions);
  const sessionToday = lastSession != null && dayKey(new Date(lastSession.createdAt)) === today;
  const sessionGap = lastSession ? daysSince(lastSession.createdAt) : null;
  lanes.push({
    lane: "range-exercise",
    title: "Range exercises (VFE)",
    cta: lastSession ? "Do today's exercises" : "Start the exercises",
    due: !sessionToday,
    daysOverdue: sessionGap == null ? 0 : Math.max(0, sessionGap - 1),
    detail:
      sessionGap == null
        ? "Daily program, ~8 minutes; gains show at 4 weeks in the trials."
        : sessionToday
          ? "Done today — twice daily is the studied dose."
          : `Last done ${sessionGap} day${sessionGap === 1 ? "" : "s"} ago; the cadence is daily.`,
  });

  const lastTrial = latest(trials);
  const trialToday = lastTrial != null && dayKey(new Date(lastTrial.createdAt)) === today;
  const weekDays = practiceDays(trials.map((t) => t.createdAt)).filter(
    (d) => daysSince(`${d.date}T12:00:00`) < 7,
  ).length;
  const trialGap = lastTrial ? daysSince(lastTrial.createdAt) : null;
  lanes.push({
    lane: "pitch",
    title: "Pitch practice",
    cta: "Practice in the Lab",
    due: !trialToday && weekDays < 4,
    daysOverdue: trialGap == null ? 0 : Math.max(0, trialGap - PITCH_GRACE_DAYS),
    detail: `${weekDays}/4 pitch-practice days this week.`,
  });

  const lastRange = latest(ranges);
  const rangeGap = lastRange ? daysSince(lastRange.createdAt) : null;
  lanes.push({
    lane: "range-probe",
    title: "Range measurement",
    cta: "Measure range",
    due: rangeGap == null || rangeGap >= PROBE_EVERY_DAYS,
    daysOverdue: rangeGap == null ? 0 : Math.max(0, rangeGap - PROBE_EVERY_DAYS),
    detail:
      rangeGap == null
        ? "No baseline measurement yet — a 45-second siren."
        : `Last measured ${rangeGap} day${rangeGap === 1 ? "" : "s"} ago; weekly keeps the trend honest.`,
  });

  return lanes.sort((a, b) => {
    if (a.lane === "test" && a.due) return -1;
    if (b.lane === "test" && b.due) return 1;
    if (a.due !== b.due) return a.due ? -1 : 1;
    return b.daysOverdue - a.daysOverdue;
  });
}
