/**
 * Split a pitch trace into contiguous voiced segments. Consecutive points
 * further apart than maxGapMs are silence, not a glissando — renderers draw
 * one path per segment instead of bridging the gap with a diagonal.
 */
export function segmentTrace<T extends { t: number }>(trace: T[], maxGapMs = 150): T[][] {
  const segments: T[][] = [];
  let current: T[] = [];
  for (const point of trace) {
    if (current.length > 0 && point.t - current[current.length - 1].t > maxGapMs) {
      segments.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length > 0) segments.push(current);
  return segments;
}
