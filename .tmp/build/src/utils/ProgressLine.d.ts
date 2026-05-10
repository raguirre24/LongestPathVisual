export type ProgressLineReference = "baselineFinish" | "previousUpdateFinish";
export type FinishVarianceProgressPoint = {
    progressDate: Date;
    varianceDays: number;
};
export declare function isValidProgressDate(value: Date | null | undefined): value is Date;
export declare function calculateFinishVarianceProgressPoint(dataDate: Date | null | undefined, finishDate: Date | null | undefined, referenceFinishDate: Date | null | undefined): FinishVarianceProgressPoint | null;
export declare function getProgressLineReferenceLabel(reference: ProgressLineReference): string;
