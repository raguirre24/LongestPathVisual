export type PathSelectorLayoutMode = "wide" | "medium" | "narrow" | "compact" | "very-narrow";

export interface PathSelectorMetrics {
    pathNumber: number;
    totalPaths: number;
    spanDays: number;
    activityCount: number;
}

export function formatPathSpanDays(spanDays: number): { compact: string; spoken: string } {
    const safeSpan = Number.isFinite(spanDays) ? Math.max(0, spanDays) : 0;
    const roundedSpan = Math.round(safeSpan * 10) / 10;
    const numericText = Number.isInteger(roundedSpan)
        ? roundedSpan.toFixed(0)
        : roundedSpan.toFixed(1);

    return {
        compact: `${numericText}d`,
        spoken: `${numericText} ${roundedSpan === 1 ? "calendar day" : "calendar days"}`
    };
}

export function getPathSelectorVisibleLabel(
    mode: PathSelectorLayoutMode,
    metrics: PathSelectorMetrics
): string {
    const baseLabel = `LP ${metrics.pathNumber}/${metrics.totalPaths}`;
    if (mode !== "wide" && mode !== "medium") {
        return baseLabel;
    }

    const span = formatPathSpanDays(metrics.spanDays).compact;
    if (mode === "medium") {
        return `${baseLabel} · ${span} span`;
    }

    return `${baseLabel} · ${span} span · ${metrics.activityCount} act.`;
}
