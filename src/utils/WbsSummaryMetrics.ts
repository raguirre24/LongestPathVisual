import type { TaskBarGeometry, TaskBarSegment } from "./TaskBarGeometry";
import { isValidTaskDate, shouldApplyCriticalFormatToTaskBarSegment } from "./TaskBarGeometry";

export type WbsSummaryDateExtent = {
    start: Date | null;
    finish: Date | null;
};

export function getTaskBarSegmentExtent(segments: TaskBarSegment[]): WbsSummaryDateExtent {
    let start: Date | null = null;
    let finish: Date | null = null;

    for (const segment of segments) {
        if (!isValidTaskDate(segment.start) || !isValidTaskDate(segment.finish)) {
            continue;
        }

        if (!start || segment.start < start) {
            start = segment.start;
        }

        if (!finish || segment.finish > finish) {
            finish = segment.finish;
        }
    }

    return { start, finish };
}

export function getCriticalFormattingExtentFromTaskBarGeometry(geometry: TaskBarGeometry): WbsSummaryDateExtent {
    if (geometry.isMilestone) {
        const milestoneDate = isValidTaskDate(geometry.milestoneDate) ? geometry.milestoneDate : null;
        return { start: milestoneDate, finish: milestoneDate };
    }

    return getTaskBarSegmentExtent(
        geometry.segments.filter(segment => shouldApplyCriticalFormatToTaskBarSegment(segment))
    );
}
