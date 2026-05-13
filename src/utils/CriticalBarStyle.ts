export type CriticalBarStyle = "statusStripe" | "fullFill" | "outline";

export type CriticalTaskStatus = "critical" | "nearCritical";

export type CriticalTaskLike = {
    isCritical?: boolean;
    isNearCritical?: boolean;
    legendColor?: string | null;
};

export type CriticalStatusMarkerDescriptor = {
    status: CriticalTaskStatus;
    color: string;
    thickness: number;
    dashed: boolean;
    dashPattern: number[];
    dashArray: string;
    target: "stripe" | "ring";
};

export function normalizeCriticalBarStyle(value: unknown): CriticalBarStyle {
    if (value === "fullFill" || value === "outline") {
        return value;
    }

    return "statusStripe";
}

export function getCriticalTaskStatus(task: CriticalTaskLike): CriticalTaskStatus | null {
    if (task.isCritical) {
        return "critical";
    }

    return task.isNearCritical ? "nearCritical" : null;
}

export function shouldUseCriticalOutline(style: CriticalBarStyle, task: CriticalTaskLike): boolean {
    return style === "outline" && getCriticalTaskStatus(task) !== null;
}

export function getSemanticTaskFillColorForStyle(
    task: CriticalTaskLike,
    style: CriticalBarStyle,
    legendDataExists: boolean,
    fallbackColor: string,
    criticalColor: string,
    nearCriticalColor: string
): string {
    const status = getCriticalTaskStatus(task);

    if (style === "fullFill" && status) {
        return status === "critical" ? criticalColor : nearCriticalColor;
    }

    if (style === "outline" && !legendDataExists && status) {
        return status === "critical" ? criticalColor : nearCriticalColor;
    }

    if (legendDataExists && task.legendColor) {
        return task.legendColor;
    }

    return fallbackColor;
}

export function getCriticalStatusMarkerDescriptor(options: {
    task: CriticalTaskLike;
    style: CriticalBarStyle;
    criticalColor: string;
    nearCriticalColor: string;
    criticalThickness: number;
    nearCriticalThickness: number;
    isMilestone: boolean;
}): CriticalStatusMarkerDescriptor | null {
    const status = getCriticalTaskStatus(options.task);
    if (options.style !== "statusStripe" || !status) {
        return null;
    }

    const rawThickness = status === "critical"
        ? options.criticalThickness
        : options.nearCriticalThickness;
    const fallbackThickness = status === "critical" ? 2.5 : 2;
    const baseThickness = Number.isFinite(rawThickness) ? rawThickness : fallbackThickness;
    const minimumThickness = options.isMilestone ? 1.25 : 1;
    const maximumThickness = options.isMilestone ? 4 : 6;
    const thickness = Math.max(minimumThickness, Math.min(maximumThickness, baseThickness));
    const dashed = false;
    const dashPattern: number[] = [];

    return {
        status,
        color: status === "critical" ? options.criticalColor : options.nearCriticalColor,
        thickness,
        dashed,
        dashPattern,
        dashArray: dashPattern.join(" "),
        target: options.isMilestone ? "ring" : "stripe"
    };
}
