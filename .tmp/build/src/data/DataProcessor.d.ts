import { Task, WBSGroup, Relationship, BoundFieldState, DataQualityInfo } from "./Interfaces";
import { VisualSettings } from "../settings";
import powerbi from "powerbi-visuals-api";
import DataView = powerbi.DataView;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import PrimitiveValue = powerbi.PrimitiveValue;
export interface ProcessedData {
    allTasksData: Task[];
    relationships: Relationship[];
    taskIdToTask: Map<string, Task>;
    predecessorIndex: Map<string, Set<string>>;
    relationshipIndex: Map<string, Relationship[]>;
    relationshipByPredecessor: Map<string, Relationship[]>;
    dataDate: Date | null;
    legendDataExists: boolean;
    legendCategories: string[];
    legendColorMap: Map<string, string>;
    legendFieldName: string;
    wbsDataExists: boolean;
    wbsGroups: WBSGroup[];
    wbsGroupMap: Map<string, WBSGroup>;
    wbsRootGroups: WBSGroup[];
    wbsAvailableLevels: number[];
    taskIdQueryName: string | null;
    taskIdTable: string | null;
    taskIdColumn: string | null;
    wbsLevelColumnIndices: number[];
    wbsLevelColumnNames: string[];
    hasTaskTotalFloat: boolean;
    hasRelationshipFreeFloat: boolean;
    dataQuality: DataQualityInfo;
}
export declare class DataProcessor {
    private debug;
    private lastUpdateOptions;
    private host;
    private tooltipDebugLogged;
    constructor(host: IVisualHost);
    private debugLog;
    private getRoleColumnInfos;
    private getRoleColumnInfo;
    processData(dataView: DataView, settings: VisualSettings, wbsExpandedState: Map<string, boolean>, wbsManuallyToggledGroups: Set<string>, lastExpandCollapseAllState: boolean | null, highContrastMode: boolean, highContrastForeground: string): ProcessedData;
    private extractTaskId;
    private extractPredecessorId;
    private createTaskFromRow;
    private extractTooltipData;
    private processLegendData;
    private processWBSData;
    private createEmptyDataQuality;
    private getRawStart;
    private getRawFinish;
    private getVisualStart;
    private getVisualFinish;
    private isEarlier;
    private detectConflictingTaskRows;
    private normalizeQualityValue;
    private validateDataQuality;
    private detectCircularDependencies;
    hasDataRole(dataView: DataView, roleName: string): boolean;
    getColumnIndex(dataView: DataView, roleName: string): number;
    getRoleColumnLayout(dataView: DataView, roleName: string): {
        indices: number[];
        names: string[];
    };
    validateDataView(dataView: DataView, settings: VisualSettings): boolean;
    parseDate(dateValue: PrimitiveValue): Date | null;
    mightBeDate(value: PrimitiveValue): boolean;
    /**
     * Detects which optional date-pair fields are actually bound in the field wells
     * AND contain at least one non-null value across the processed tasks.
     * This enables the visual to conditionally hide columns, bars, and toggle buttons.
     */
    detectBoundFields(dataView: DataView, tasks: Task[]): BoundFieldState;
}
