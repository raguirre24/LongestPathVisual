export type LabelColumnId = "totalFloat" | "duration" | "finish" | "start" | "previousFinish" | "previousStart" | "baselineFinish" | "baselineStart";
export type LabelColumnSpec = {
    id: LabelColumnId;
    text: string;
    headerCandidates: string[];
    width: number;
};
export type PackedLabelColumns = {
    nameLaneWidth: number;
    occupiedWidth: number;
    totalLeftPaneWidth: number;
    columns: LabelColumnSpec[];
    hiddenColumnIds: LabelColumnId[];
};
export type LabelColumnLayoutItem = LabelColumnSpec & {
    offset: number;
    centerX: number;
    lineX: number;
};
export type LabelColumnLayout = {
    items: LabelColumnLayoutItem[];
    occupiedWidth: number;
    taskNameDividerX: number;
    taskNameCenterX: number;
    showExtra: boolean;
    remainingWidth: number;
};
export declare const DEFAULT_LABEL_COLUMN_PADDING = 20;
export declare const DEFAULT_MIN_TIMELINE_WIDTH = 160;
export declare const MIN_TASK_NAME_WIDTH = 180;
export declare const MIN_WBS_TASK_NAME_WIDTH = 220;
export declare const COLUMN_HIDE_PRIORITY: LabelColumnId[];
export declare function packLabelColumns(input: {
    preferredNameLaneWidth: number;
    minimumNameLaneWidth: number;
    viewportWidth?: number | null;
    rightMargin?: number;
    minTimelineWidth?: number;
    autoFitColumns: boolean;
    columnPadding?: number;
    columns: LabelColumnSpec[];
}): PackedLabelColumns;
export declare function buildLabelColumnLayout(input: {
    leftPaneWidth: number;
    columns: LabelColumnSpec[];
    columnPadding?: number;
    snapText?: (value: number) => number;
    snapLine?: (value: number) => number;
}): LabelColumnLayout;
