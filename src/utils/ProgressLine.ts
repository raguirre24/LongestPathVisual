const DAY_IN_MS = 86400000;

export type ProgressLineReference = "baselineFinish" | "previousUpdateFinish";

export type FinishVarianceProgressPoint = {
    progressDate: Date;
    varianceDays: number;
};

export function isValidProgressDate(value: Date | null | undefined): value is Date {
    return value instanceof Date && Number.isFinite(value.getTime());
}

export function calculateFinishVarianceProgressPoint(
    dataDate: Date | null | undefined,
    finishDate: Date | null | undefined,
    referenceFinishDate: Date | null | undefined
): FinishVarianceProgressPoint | null {
    if (!isValidProgressDate(dataDate) ||
        !isValidProgressDate(finishDate)) {
        return null;
    }

    const effectiveReferenceFinishDate = isValidProgressDate(referenceFinishDate)
        ? referenceFinishDate
        : finishDate;
    const varianceMs = finishDate.getTime() - effectiveReferenceFinishDate.getTime();
    return {
        progressDate: new Date(dataDate.getTime() - varianceMs),
        varianceDays: varianceMs / DAY_IN_MS
    };
}

export function getProgressLineReferenceLabel(reference: ProgressLineReference): string {
    return reference === "previousUpdateFinish"
        ? "Previous Update Finish"
        : "Baseline Finish";
}
