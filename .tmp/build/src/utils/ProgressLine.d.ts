export type ProgressLineReference = "baselineFinish" | "previousUpdateFinish";
export type ProgressLineDateMode = "finish" | "start" | "both";
export type ProgressLinePointKind = "start" | "finish";
export type ProgressLineBandTone = "recovery" | "slippage" | "neutral";
export type DateVarianceProgressPoint = {
    progressDate: Date;
    varianceDays: number;
};
export declare function isValidProgressDate(value: Date | null | undefined): value is Date;
export declare function getEffectiveProgressLineDate(manualDate: Date | null | undefined, scheduledDate: Date | null | undefined): Date | null;
export declare function calculateDateVarianceProgressPoint(dataDate: Date | null | undefined, currentDate: Date | null | undefined, referenceDate: Date | null | undefined): DateVarianceProgressPoint | null;
export declare function calculateFinishVarianceProgressPoint(dataDate: Date | null | undefined, finishDate: Date | null | undefined, referenceFinishDate: Date | null | undefined): DateVarianceProgressPoint | null;
export declare function getProgressLineReferenceLabel(reference: ProgressLineReference): string;
export declare function getProgressLineReferenceDateLabel(reference: ProgressLineReference, pointKind: ProgressLinePointKind): string;
export declare function getProgressLineDateModeLabel(dateMode: ProgressLineDateMode): string;
export declare function getProgressLinePointKinds(dateMode: ProgressLineDateMode): ProgressLinePointKind[];
export declare function getProgressLineBandTone(startLineX: number, finishLineX: number, neutralTolerancePx?: number): ProgressLineBandTone;
