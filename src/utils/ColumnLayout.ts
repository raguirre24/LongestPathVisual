export type LabelColumnId =
    | "totalFloat"
    | "duration"
    | "finish"
    | "start"
    | "previousFinish"
    | "previousStart"
    | "baselineFinish"
    | "baselineStart";

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

export const DEFAULT_LABEL_COLUMN_PADDING = 20;
export const DEFAULT_MIN_TIMELINE_WIDTH = 160;
export const MIN_TASK_NAME_WIDTH = 180;
export const MIN_WBS_TASK_NAME_WIDTH = 220;

export const COLUMN_HIDE_PRIORITY: LabelColumnId[] = [
    "previousStart",
    "previousFinish",
    "baselineStart",
    "baselineFinish",
    "duration",
    "start",
    "finish",
    "totalFloat"
];

function getOccupiedWidth(columns: LabelColumnSpec[], columnPadding: number): number {
    if (columns.length === 0) {
        return 0;
    }
    return columnPadding + columns.reduce((total, column) => total + Math.max(0, column.width), 0);
}

export function packLabelColumns(input: {
    preferredNameLaneWidth: number;
    minimumNameLaneWidth: number;
    viewportWidth?: number | null;
    rightMargin?: number;
    minTimelineWidth?: number;
    autoFitColumns: boolean;
    columnPadding?: number;
    columns: LabelColumnSpec[];
}): PackedLabelColumns {
    const columnPadding = input.columnPadding ?? DEFAULT_LABEL_COLUMN_PADDING;
    const minTimelineWidth = input.minTimelineWidth ?? DEFAULT_MIN_TIMELINE_WIDTH;
    const rightMargin = Math.max(0, input.rightMargin ?? 0);
    const preferredNameLaneWidth = Number.isFinite(input.preferredNameLaneWidth)
        ? Math.max(0, input.preferredNameLaneWidth)
        : 0;
    const minimumNameLaneWidth = Number.isFinite(input.minimumNameLaneWidth)
        ? Math.max(0, input.minimumNameLaneWidth)
        : 0;
    const nameLaneWidth = Math.max(preferredNameLaneWidth, minimumNameLaneWidth);
    let columns = input.columns.filter(column => column.width > 0);
    const requestedIds = new Set(columns.map(column => column.id));

    const viewportWidth = input.viewportWidth ?? null;
    const hasViewport = typeof viewportWidth === "number" && isFinite(viewportWidth) && viewportWidth > 0;
    const maxLeftPaneWidth = hasViewport
        ? Math.max(0, viewportWidth - rightMargin - minTimelineWidth)
        : Number.POSITIVE_INFINITY;

    if (input.autoFitColumns && isFinite(maxLeftPaneWidth)) {
        const columnBudget = Math.max(0, maxLeftPaneWidth - nameLaneWidth);
        for (const id of COLUMN_HIDE_PRIORITY) {
            if (getOccupiedWidth(columns, columnPadding) <= columnBudget) {
                break;
            }
            columns = columns.filter(column => column.id !== id);
        }
    }

    const visibleIds = new Set(columns.map(column => column.id));
    const hiddenColumnIds = COLUMN_HIDE_PRIORITY.filter(id => requestedIds.has(id) && !visibleIds.has(id));
    for (const column of input.columns) {
        if (!requestedIds.has(column.id) || visibleIds.has(column.id) || hiddenColumnIds.includes(column.id)) {
            continue;
        }
        hiddenColumnIds.push(column.id);
    }

    const occupiedWidth = getOccupiedWidth(columns, columnPadding);
    return {
        nameLaneWidth,
        occupiedWidth,
        totalLeftPaneWidth: nameLaneWidth + occupiedWidth,
        columns,
        hiddenColumnIds
    };
}

export function buildLabelColumnLayout(input: {
    leftPaneWidth: number;
    columns: LabelColumnSpec[];
    columnPadding?: number;
    snapText?: (value: number) => number;
    snapLine?: (value: number) => number;
}): LabelColumnLayout {
    const columnPadding = input.columnPadding ?? DEFAULT_LABEL_COLUMN_PADDING;
    const snapText = input.snapText ?? ((value: number) => value);
    const snapLine = input.snapLine ?? ((value: number) => value);
    const items: LabelColumnLayoutItem[] = [];
    let occupiedWidth = input.columns.length > 0 ? columnPadding : 0;

    for (const column of input.columns) {
        const offset = occupiedWidth;
        occupiedWidth += column.width;
        items.push({
            ...column,
            offset,
            centerX: snapText(input.leftPaneWidth - offset - (column.width / 2)),
            lineX: snapLine(input.leftPaneWidth - offset - column.width)
        });
    }

    const remainingWidth = Math.max(0, input.leftPaneWidth - occupiedWidth);
    return {
        items,
        occupiedWidth,
        taskNameDividerX: snapLine(input.leftPaneWidth - occupiedWidth),
        taskNameCenterX: snapText(remainingWidth / 2),
        showExtra: input.columns.length > 0,
        remainingWidth
    };
}
