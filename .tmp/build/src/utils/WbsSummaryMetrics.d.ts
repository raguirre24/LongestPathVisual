import type { Task, WbsSummaryMilestoneMarker } from "../data/Interfaces";
import type { TaskBarGeometry, TaskBarSegment } from "./TaskBarGeometry";
export type WbsSummaryDateExtent = {
    start: Date | null;
    finish: Date | null;
};
export declare function getTaskBarSegmentExtent(segments: TaskBarSegment[]): WbsSummaryDateExtent;
export declare function getTaskBarGeometryExtent(geometry: TaskBarGeometry): WbsSummaryDateExtent;
export declare function getCriticalFormattingExtentFromTaskBarGeometry(geometry: TaskBarGeometry): WbsSummaryDateExtent;
export declare function createWbsSummaryMilestoneMarker(task: Pick<Task, "internalId" | "name">, date: Date | null | undefined): WbsSummaryMilestoneMarker | null;
export declare function sortWbsSummaryMilestoneMarkers(markers: WbsSummaryMilestoneMarker[]): WbsSummaryMilestoneMarker[];
