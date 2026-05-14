const DAY_IN_MS = 86400000;

export type ProgressLineReference = "baselineFinish" | "previousUpdateFinish";
export type ProgressLineDateMode = "finish" | "start" | "both";
export type ProgressLinePointKind = "start" | "finish";
export type ProgressLineBandTone = "recovery" | "slippage" | "neutral";

export type DateVarianceProgressPoint = {
    progressDate: Date;
    varianceDays: number;
};

export function isValidProgressDate(value: Date | null | undefined): value is Date {
    return value instanceof Date && Number.isFinite(value.getTime());
}

export function getEffectiveProgressLineDate(
    manualDate: Date | null | undefined,
    scheduledDate: Date | null | undefined
): Date | null {
    if (isValidProgressDate(manualDate)) {
        return manualDate;
    }

    return isValidProgressDate(scheduledDate) ? scheduledDate : null;
}

export function calculateDateVarianceProgressPoint(
    dataDate: Date | null | undefined,
    currentDate: Date | null | undefined,
    referenceDate: Date | null | undefined
): DateVarianceProgressPoint | null {
    if (!isValidProgressDate(dataDate) ||
        !isValidProgressDate(currentDate)) {
        return null;
    }

    const effectiveReferenceDate = isValidProgressDate(referenceDate)
        ? referenceDate
        : currentDate;
    const varianceMs = currentDate.getTime() - effectiveReferenceDate.getTime();
    return {
        progressDate: new Date(dataDate.getTime() - varianceMs),
        varianceDays: varianceMs / DAY_IN_MS
    };
}

export function calculateFinishVarianceProgressPoint(
    dataDate: Date | null | undefined,
    finishDate: Date | null | undefined,
    referenceFinishDate: Date | null | undefined
): DateVarianceProgressPoint | null {
    return calculateDateVarianceProgressPoint(dataDate, finishDate, referenceFinishDate);
}

export function getProgressLineReferenceLabel(reference: ProgressLineReference): string {
    return reference === "previousUpdateFinish"
        ? "Previous Update"
        : "Baseline";
}

export function getProgressLineReferenceDateLabel(
    reference: ProgressLineReference,
    pointKind: ProgressLinePointKind
): string {
    return `${getProgressLineReferenceLabel(reference)} ${pointKind === "start" ? "Start" : "Finish"}`;
}

export function getProgressLineDateModeLabel(dateMode: ProgressLineDateMode): string {
    switch (dateMode) {
        case "start":
            return "Start";
        case "both":
            return "Start + Finish";
        default:
            return "Finish";
    }
}

export function getProgressLinePointKinds(dateMode: ProgressLineDateMode): ProgressLinePointKind[] {
    switch (dateMode) {
        case "start":
            return ["start"];
        case "both":
            return ["start", "finish"];
        default:
            return ["finish"];
    }
}

export function getProgressLineBandTone(
    startLineX: number,
    finishLineX: number,
    neutralTolerancePx: number = 0.5
): ProgressLineBandTone {
    if (!Number.isFinite(startLineX) || !Number.isFinite(finishLineX)) {
        return "neutral";
    }

    const delta = finishLineX - startLineX;
    if (Math.abs(delta) <= neutralTolerancePx) {
        return "neutral";
    }

    return delta > 0 ? "recovery" : "slippage";
}
