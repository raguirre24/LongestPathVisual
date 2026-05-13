import type { Task } from "../data/Interfaces";
export type CurrentBarDateMode = "startFinishOverride" | "hybridActualEarly";
export type TaskBarSegmentKind = "current" | "started" | "scheduled";
export type TaskBarSegment = {
    kind: TaskBarSegmentKind;
    start: Date;
    finish: Date;
};
export type TaskBarGeometry = {
    isMilestone: boolean;
    milestoneDate: Date | null;
    segments: TaskBarSegment[];
    extentStart: Date | null;
    extentFinish: Date | null;
    labelStartDate: Date | null;
    labelFinishDate: Date | null;
    sortDate: Date | null;
    hasSplit: boolean;
};
export declare const currentBarDateModeItems: readonly [{
    readonly value: "startFinishOverride";
    readonly displayName: "Start/Finish Override";
}, {
    readonly value: "hybridActualEarly";
    readonly displayName: "Hybrid Start + Early";
}];
export declare function normalizeCurrentBarDateMode(value: unknown): CurrentBarDateMode;
export declare function isTaskMilestone(task: Pick<Task, "type">): boolean;
export declare function isValidTaskDate(value: Date | null | undefined): value is Date;
export declare function getScheduleStart(task: Pick<Task, "startDate">): Date | null;
export declare function getScheduleFinish(task: Pick<Task, "finishDate">): Date | null;
export declare function getCurrentTaskBarGeometry(task: Task, mode: CurrentBarDateMode, dataDate: Date | null | undefined): TaskBarGeometry;
