
import powerbi from "powerbi-visuals-api";
import PrimitiveValue = powerbi.PrimitiveValue;

export interface Task {
    id: string | number;
    internalId: string;
    name: string;
    type: string;
    duration: number;
    userProvidedTotalFloat?: number;
    taskFreeFloat?: number;
    predecessorIds: string[];
    relationshipTypes: { [predId: string]: string; };
    relationshipLags: { [predId: string]: number | null; };
    successors: Task[];
    predecessors: Task[];
    earlyStart: number;
    earlyFinish: number;
    lateStart: number;
    lateFinish: number;
    totalFloat: number;
    isCritical: boolean;
    isCriticalByFloat?: boolean;
    isCriticalByRel?: boolean;
    isNearCritical?: boolean;
    startDate?: Date | null;
    finishDate?: Date | null;
    baselineStartDate?: Date | null;
    baselineFinishDate?: Date | null;
    previousUpdateStartDate?: Date | null;
    previousUpdateFinishDate?: Date | null;
    yOrder?: number;
    tooltipData?: Array<{ key: string, value: PrimitiveValue }>;
    selectionId?: powerbi.visuals.ISelectionId;
    legendValue?: string;
    legendColor?: string;

    wbsLevels?: string[];
    wbsGroupId?: string;
    wbsIndentLevel?: number;
}

export interface WBSGroup {
    id: string;
    level: number;
    name: string;
    fullPath: string;
    parentId: string | null;
    children: WBSGroup[];
    tasks: Task[];
    allTasks: Task[];
    isExpanded: boolean;
    yOrder?: number;
    visibleTaskCount: number;

    summaryStartDate?: Date | null;
    summaryFinishDate?: Date | null;
    hasCriticalTasks: boolean;
    hasNearCriticalTasks?: boolean;
    taskCount: number;

    criticalStartDate?: Date | null;
    criticalFinishDate?: Date | null;
    nearCriticalStartDate?: Date | null;
    nearCriticalFinishDate?: Date | null;
    summaryBaselineStartDate?: Date | null;
    summaryBaselineFinishDate?: Date | null;
    summaryPreviousUpdateStartDate?: Date | null;
    summaryPreviousUpdateFinishDate?: Date | null;
}

export interface Relationship {
    predecessorId: string;
    successorId: string;
    type: string;
    freeFloat: number | null;
    isCritical: boolean;
    lag: number | null;
    relationshipFloat?: number;
    isDriving?: boolean;
}

export interface DropdownItem {
    id: string;
    type: "clear" | "task" | "empty" | "overflow";
    label: string;
    task?: Task;
    focusable: boolean;
}

export enum UpdateType {
    Full = "Full",
    DataOnly = "DataOnly",
    ViewportOnly = "ViewportOnly",
    SettingsOnly = "SettingsOnly",
    DataAndSettings = 'DataAndSettings'
}
