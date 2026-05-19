import type { TaskBarGeometry, TaskBarSegment } from "./TaskBarGeometry";
export type WbsSummaryDateExtent = {
    start: Date | null;
    finish: Date | null;
};
export declare function getTaskBarSegmentExtent(segments: TaskBarSegment[]): WbsSummaryDateExtent;
export declare function getCriticalFormattingExtentFromTaskBarGeometry(geometry: TaskBarGeometry): WbsSummaryDateExtent;
