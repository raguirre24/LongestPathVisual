import type { Task, WBSGroup } from "../data/Interfaces";
export type WbsDisplayMode = "through" | "only";
export interface WbsDisplaySelection {
    mode: WbsDisplayMode;
    level: number | null;
}
export type WbsDisplayRow = {
    kind: "group";
    group: WBSGroup;
    indentLevel: number;
    displayName: string;
} | {
    kind: "task";
    task: Task;
    ownerGroupId: string;
    indentLevel: number;
};
export interface WbsDisplayProjection {
    rows: WbsDisplayRow[];
    tasks: Task[];
    groups: WBSGroup[];
    taskIndentLevels: Map<string, number>;
    groupIndentLevels: Map<string, number>;
    groupDisplayNames: Map<string, string>;
}
export interface BuildWbsDisplayProjectionOptions {
    mode: WbsDisplayMode;
    onlyLevel: number | null;
    rootGroups: WBSGroup[];
    visibleTasks: Task[];
    hideEmptyGroups: boolean;
    sortTasks: (tasks: Task[]) => Task[];
    fallbackGroup?: WBSGroup;
}
export declare function normalizeWbsDisplaySelection(mode: unknown, level: unknown): WbsDisplaySelection;
export declare function wbsDisplaySelectionsEqual(left: WbsDisplaySelection, right: WbsDisplaySelection): boolean;
export declare function reconcileWbsDisplaySelection(persisted: WbsDisplaySelection, pending: WbsDisplaySelection | null): {
    selection: WbsDisplaySelection;
    pending: WbsDisplaySelection | null;
};
export declare function buildWbsDisplayProjection(options: BuildWbsDisplayProjectionOptions): WbsDisplayProjection;
