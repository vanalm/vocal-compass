import type { RangeMeasurement,TrialRecord } from "../../core";
import { CheckinProgress } from "./CheckinProgress";
/** Legacy component name; all new comparisons use the check-in instrument. */
export function ImprovementCard({trials}:{trials:TrialRecord[];ranges:RangeMeasurement[]}){return <CheckinProgress trials={trials}/>;}
