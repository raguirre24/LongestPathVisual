export type PathSelectorLayoutMode = "wide" | "medium" | "narrow" | "compact" | "very-narrow";
export interface PathSelectorMetrics {
    pathNumber: number;
    totalPaths: number;
    spanDays: number;
    activityCount: number;
}
export declare function formatPathSpanDays(spanDays: number): {
    compact: string;
    spoken: string;
};
export declare function getPathSelectorVisibleLabel(mode: PathSelectorLayoutMode, metrics: PathSelectorMetrics): string;
