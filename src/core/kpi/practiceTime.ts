export interface PracticeDay {
  /** Local date, YYYY-MM-DD. */
  date: string;
  minutes: number;
  /** Records (trials + range probes) that landed in this day. */
  items: number;
}

export interface PracticeTimeOptions {
  /** Records further apart than this belong to separate practice clusters. */
  gapMs: number;
  /** Setup/lead-in credited to every cluster (a lone trial still took time). */
  leadMs: number;
}

const DEFAULTS: PracticeTimeOptions = { gapMs: 30 * 60_000, leadMs: 60_000 };

/**
 * Practice time derived from record timestamps — no session bookkeeping to
 * forget. Records cluster while gaps stay under gapMs; a cluster's minutes
 * are its span plus a lead-in; clusters aggregate per local calendar day.
 * Works retroactively on all existing data.
 */
export function practiceDays(
  timestamps: string[],
  opts: PracticeTimeOptions = DEFAULTS,
): PracticeDay[] {
  const times = timestamps.map((t) => new Date(t).getTime()).sort((a, b) => a - b);
  const byDate = new Map<string, PracticeDay>();

  let start = 0;
  for (let i = 0; i <= times.length; i += 1) {
    const clusterEnds = i === times.length || (i > start && times[i] - times[i - 1] > opts.gapMs);
    if (!clusterEnds) continue;
    if (i > start) {
      const first = times[start];
      const last = times[i - 1];
      const date = localDateKey(first);
      const entry = byDate.get(date) ?? { date, minutes: 0, items: 0 };
      entry.minutes += Math.round((last - first + opts.leadMs) / 60_000);
      entry.items += i - start;
      byDate.set(date, entry);
    }
    start = i;
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function localDateKey(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
