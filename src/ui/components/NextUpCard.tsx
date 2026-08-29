import type { Lane, LaneStatus } from "../../core";

/**
 * "Where do I pick up?" — the primary due lane as one big action with its
 * overdue count, the rest as small chips. The planner does the thinking;
 * this only renders its verdict.
 */
export function NextUpCard({
  lanes,
  onGo,
}: {
  lanes: LaneStatus[];
  onGo: (lane: Lane) => void;
}) {
  const [primary, ...rest] = lanes;
  if (!primary) return null;

  return (
    <div className="vc-nextup">
      <div className={`vc-nextup-main ${primary.due ? "" : "done"}`}>
        <div>
          <span className="vc-nextup-title">
            {primary.due ? "Next up" : "All caught up"} — {primary.title}
            {primary.daysOverdue > 0 && (
              <em className="vc-overdue">
                {primary.daysOverdue} day{primary.daysOverdue === 1 ? "" : "s"} overdue
              </em>
            )}
          </span>
          <p className="vc-small">{primary.detail}</p>
        </div>
        <button className="vc-button primary" onClick={() => onGo(primary.lane)}>
          {primary.cta}
        </button>
      </div>
      <div className="vc-nextup-rest">
        {rest.map((lane) => (
          <button
            key={lane.lane}
            className={`vc-chip ${lane.due ? "due" : ""}`}
            onClick={() => onGo(lane.lane)}
            title={lane.detail}
          >
            {lane.title}
            {lane.daysOverdue > 0 ? ` · ${lane.daysOverdue}d late` : lane.due ? " · due" : " ✓"}
          </button>
        ))}
      </div>
    </div>
  );
}
