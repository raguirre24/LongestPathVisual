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
export declare function normalizeCriticalBarStyle(value: unknown): CriticalBarStyle;
export declare function getCriticalTaskStatus(task: CriticalTaskLike): CriticalTaskStatus | null;
export declare function shouldUseCriticalOutline(style: CriticalBarStyle, task: CriticalTaskLike): boolean;
export declare function getSemanticTaskFillColorForStyle(task: CriticalTaskLike, style: CriticalBarStyle, legendDataExists: boolean, fallbackColor: string, criticalColor: string, nearCriticalColor: string): string;
export declare function getCriticalStatusMarkerDescriptor(options: {
    task: CriticalTaskLike;
    style: CriticalBarStyle;
    criticalColor: string;
    nearCriticalColor: string;
    criticalThickness: number;
    nearCriticalThickness: number;
    isMilestone: boolean;
}): CriticalStatusMarkerDescriptor | null;
