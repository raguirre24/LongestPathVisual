
import { Task, WBSGroup, Relationship, BoundFieldState, DataQualityInfo } from "./Interfaces";
import { VisualSettings } from "../settings";
import { normalizeRelationshipType } from "../utils/RelationshipLogic";
import { normalizeLegendCategory } from "../utils/VisualState";
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

    // Legend Data
    legendDataExists: boolean;
    legendCategories: string[];
    legendColorMap: Map<string, string>;
    legendFieldName: string;

    // WBS Data
    wbsDataExists: boolean;
    wbsGroups: WBSGroup[];
    wbsGroupMap: Map<string, WBSGroup>;
    wbsRootGroups: WBSGroup[];
    wbsAvailableLevels: number[];

    // Metadata
    taskIdQueryName: string | null;
    taskIdTable: string | null;
    taskIdColumn: string | null;
    wbsLevelColumnIndices: number[];
    wbsLevelColumnNames: string[];

    // Calculation Flags
    hasTaskTotalFloat: boolean;
    hasRelationshipFreeFloat: boolean;
    dataQuality: DataQualityInfo;
}

type DataQualityContext = {
    missingPredecessorIds: string[];
    conflictingTaskRows: string[];
    relationshipCount: number;
    relationshipFreeFloatMissingCount: number;
    hasRelationshipFreeFloat: boolean;
};

type TaskRowBucket = {
    rows: any[];
    task: Task | null;
    rowIndex: number;
    relationships: Array<{
        predId: string;
        relType: string;
        lag: number | null;
        freeFloat: number | null;
    }>;
};

export class DataProcessor {
    private debug: boolean = false;

    private host: IVisualHost;
    private tooltipDebugLogged: boolean = false;

    constructor(host: IVisualHost) {
        this.host = host;
    }

    private debugLog(...args: unknown[]): void {
        if (this.debug) {
            console.log(...args);
        }
    }

    private getRoleColumnInfos(
        dataView: DataView,
        roleName: string
    ): Array<{ column: { queryName?: string; displayName?: string; roles?: { [key: string]: boolean } }; index: number }> {
        const tableColumns = dataView.table?.columns ?? [];
        const metadataColumns = dataView.metadata?.columns ?? [];

        if (tableColumns.length === 0 && metadataColumns.length === 0) {
            return [];
        }

        // Power BI can push transient dataViews where role flags drift between
        // metadata.columns and table.columns (e.g., after swapping a bound field).
        // metadata.columns reflects the field well ordering (top-to-bottom),
        // while table.columns reflects query order and may append newly-added
        // fields regardless of their field-well position. Iterate metadata
        // first for correct ordering, resolving each match to its position in
        // table.columns so row access stays valid. Fall back to table-only
        // matches for role-bound columns that metadata hasn't captured yet.
        const queryNameToTableIndex = new Map<string, number>();
        tableColumns.forEach((column, index) => {
            const key = column.queryName;
            if (key && !queryNameToTableIndex.has(key)) {
                queryNameToTableIndex.set(key, index);
            }
        });

        const seen = new Set<string>();
        const results: Array<{ column: { queryName?: string; displayName?: string; roles?: { [key: string]: boolean } }; index: number }> = [];

        metadataColumns.forEach((column, metadataIndex) => {
            if (!column.roles?.[roleName]) return;
            const queryName = column.queryName;
            const dedupeKey = queryName ?? `${roleName}-meta-${metadataIndex}`;
            if (seen.has(dedupeKey)) return;

            if (queryName && queryNameToTableIndex.has(queryName)) {
                // Column is present in table rows; use the table position so
                // row[index] returns the correct cell.
                const tableIndex = queryNameToTableIndex.get(queryName)!;
                seen.add(dedupeKey);
                results.push({ column: tableColumns[tableIndex], index: tableIndex });
                return;
            }

            if (tableColumns.length === 0) {
                // No table rows available yet; fall back to metadata index.
                seen.add(dedupeKey);
                results.push({ column, index: metadataIndex });
            }
            // Otherwise: role-bound in metadata but absent from table rows —
            // stale entry, skip to avoid reading the wrong cell.
        });

        tableColumns.forEach((column, index) => {
            if (!column.roles?.[roleName]) return;
            const dedupeKey = column.queryName ?? `${roleName}-table-${index}`;
            if (seen.has(dedupeKey)) return;
            seen.add(dedupeKey);
            results.push({ column, index });
        });

        return results;
    }

    private getRoleColumnInfo(
        dataView: DataView,
        roleName: string
    ): { column: { queryName?: string; displayName?: string; roles?: { [key: string]: boolean } }; index: number } | null {
        const matches = this.getRoleColumnInfos(dataView, roleName);
        return matches.length > 0 ? matches[0] : null;
    }

    public processData(
        dataView: DataView,
        settings: VisualSettings,
        wbsExpandedState: Map<string, boolean>,
        _wbsManuallyToggledGroups: Set<string>,
        lastExpandCollapseAllState: boolean | null,
        highContrastMode: boolean,
        highContrastForeground: string
    ): ProcessedData {
        this.debugLog("DataProcessor: Transforming data...");
        // const startTime = performance.now(); // performance not available in strict mode sometimes, safe to skip or use Date

        const result: ProcessedData = {
            allTasksData: [],
            relationships: [],
            taskIdToTask: new Map(),
            predecessorIndex: new Map(),
            relationshipIndex: new Map(),
            relationshipByPredecessor: new Map(),
            dataDate: null,
            legendDataExists: false,
            legendCategories: [],
            legendColorMap: new Map(),
            legendFieldName: "",
            wbsDataExists: false,
            wbsGroups: [],
            wbsGroupMap: new Map(),
            wbsRootGroups: [],
            wbsAvailableLevels: [],
            taskIdQueryName: null,
            taskIdTable: null,
            taskIdColumn: null,
            wbsLevelColumnIndices: [],
            wbsLevelColumnNames: [],
            hasTaskTotalFloat: false,
            hasRelationshipFreeFloat: false,
            dataQuality: this.createEmptyDataQuality()
        };

        if (!dataView.table?.rows || !dataView.metadata?.columns) {
            console.error("Data transformation failed: No table data or columns found.");
            return result;
        }

        const rows = dataView.table.rows;
        // const columns = dataView.metadata.columns; // Unused variable

        // --- Metadata Extraction ---
        const idColumnInfo = this.getRoleColumnInfo(dataView, "taskId");
        if (idColumnInfo) {
            result.taskIdQueryName = idColumnInfo.column.queryName || null;
            const match = result.taskIdQueryName
                ? result.taskIdQueryName.match(/([^\[]+)\[([^\]]+)\]/)
                : null;
            if (match) {
                result.taskIdTable = match[1];
                result.taskIdColumn = match[2];
            } else if (result.taskIdQueryName) {
                const parts = result.taskIdQueryName.split(".");
                result.taskIdTable = parts.length > 1 ? parts[0] : null;
                result.taskIdColumn = parts[parts.length - 1];
            }
        } else {
            console.error("Data transformation failed: Missing Task ID column.");
            return result;
        }

        const wbsColumnInfos = this.getRoleColumnInfos(dataView, "wbsLevels");
        result.wbsLevelColumnIndices = wbsColumnInfos.map(info => info.index);
        result.wbsLevelColumnNames = wbsColumnInfos.map((info, index) => info.column.displayName || `Level ${index + 1}`);


        const predIdIdx = this.getColumnIndex(dataView, "predecessorId");
        const relTypeIdx = this.getColumnIndex(dataView, "relationshipType");
        const relLagIdx = this.getColumnIndex(dataView, "relationshipLag");
        const relFreeFloatIdx = this.getColumnIndex(dataView, "relationshipFreeFloat");
        const dataDateIdx = this.getColumnIndex(dataView, "dataDate");

        const taskDataMap = new Map<string, TaskRowBucket>();

        const allPredecessorIds = new Set<string>();
        let relationshipRowCount = 0;
        let relationshipFreeFloatMissingCount = 0;

        // --- Pass 1: Group Rows by Task ID ---
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
            const row = rows[rowIndex];
            const taskId = this.extractTaskId(row, dataView);
            if (!taskId) {
                // console.warn(`Skipping row ${rowIndex}: Invalid or missing Task ID.`);
                continue;
            }

            if (dataDateIdx !== -1 && row[dataDateIdx] != null) {
                const parsedDataDate = this.parseDate(row[dataDateIdx]);
                if (parsedDataDate) {
                    const ts = parsedDataDate.getTime();
                    if (result.dataDate === null || ts > result.dataDate.getTime()) {
                        result.dataDate = parsedDataDate;
                    }
                }
            }

            let taskData = taskDataMap.get(taskId);
            if (!taskData) {
                taskData = {
                    rows: [],
                    task: null,
                    rowIndex: rowIndex,
                    relationships: [],
                };
                taskDataMap.set(taskId, taskData);
            }

            taskData.rows.push(row);

            if (predIdIdx !== -1 && row[predIdIdx] != null) {
                const predId = this.extractPredecessorId(row, dataView);
                if (predId && predId !== taskId) {
                    relationshipRowCount++;

                    allPredecessorIds.add(predId);

                    const relType = normalizeRelationshipType(
                        relTypeIdx !== -1 && row[relTypeIdx] != null
                            ? String(row[relTypeIdx])
                            : null
                    );

                    let relLag: number | null = null;
                    if (relLagIdx !== -1 && row[relLagIdx] != null) {
                        const parsedLag = Number(row[relLagIdx]);
                        if (!isNaN(parsedLag) && isFinite(parsedLag)) {
                            relLag = parsedLag;
                        }
                    }

                    let relFreeFloat: number | null = null;
                    if (relFreeFloatIdx !== -1 && row[relFreeFloatIdx] != null) {
                        const parsedFreeFloat = Number(row[relFreeFloatIdx]);
                        if (!isNaN(parsedFreeFloat) && isFinite(parsedFreeFloat)) {
                            relFreeFloat = parsedFreeFloat;
                        }
                    }

                    if (relFreeFloat !== null && relFreeFloat !== undefined) {
                        result.hasRelationshipFreeFloat = true;
                    } else {
                        relationshipFreeFloatMissingCount++;
                    }

                    const existingRel = taskData.relationships.find(
                        (r) => r.predId === predId &&
                            r.relType === relType &&
                            r.lag === relLag &&
                            r.freeFloat === relFreeFloat
                    );
                    if (!existingRel) {
                        taskData.relationships.push({
                            predId: predId,
                            relType: relType,
                            lag: relLag,
                            freeFloat: relFreeFloat,
                        });
                    }
                }
            }
        }

        const missingPredecessorIds: string[] = [];
        let syntheticTaskCount = 0;
        for (const predId of allPredecessorIds) {
            if (!taskDataMap.has(predId)) {
                syntheticTaskCount++;
                missingPredecessorIds.push(predId);
            }
        }

        result.allTasksData = new Array(taskDataMap.size + syntheticTaskCount);
        // result.relationships is already []

        const successorMap = new Map<string, Task[]>();
        let taskIndex = 0;

        // --- Pass 2: Create Task Objects ---
        for (const [taskId, taskData] of taskDataMap) {

            if (taskData.rows.length > 0 && !taskData.task) {
                taskData.task = this.createTaskFromRow(taskData.rows[0], taskData.rowIndex, result.wbsLevelColumnIndices, dataView);
            }
            if (!taskData.task) continue;

            const task = taskData.task;

            if (task.userProvidedTotalFloat !== undefined && !result.hasTaskTotalFloat) {
                result.hasTaskTotalFloat = true;
            }

            if (!result.predecessorIndex.has(taskId)) {
                result.predecessorIndex.set(taskId, new Set());
            }

            for (const rel of taskData.relationships) {
                const predecessorAlreadyLinked = task.predecessorIds.includes(rel.predId);
                if (!predecessorAlreadyLinked) {
                    task.predecessorIds.push(rel.predId);
                    task.relationshipTypes[rel.predId] = rel.relType;
                    task.relationshipLags[rel.predId] = rel.lag;

                    if (!result.predecessorIndex.has(rel.predId)) {
                        result.predecessorIndex.set(rel.predId, new Set());
                    }
                    result.predecessorIndex.get(rel.predId)!.add(taskId);

                    if (!successorMap.has(rel.predId)) {
                        successorMap.set(rel.predId, []);
                    }
                    successorMap.get(rel.predId)!.push(task);
                }

                const relationship: Relationship = {
                    predecessorId: rel.predId,
                    successorId: taskId,
                    type: rel.relType,
                    freeFloat: rel.freeFloat,
                    lag: rel.lag,
                    isCritical: false,
                };
                result.relationships.push(relationship);

                if (!result.relationshipIndex.has(taskId)) {
                    result.relationshipIndex.set(taskId, []);
                }
                result.relationshipIndex.get(taskId)!.push(relationship);

                if (!result.relationshipByPredecessor.has(rel.predId)) {
                    result.relationshipByPredecessor.set(rel.predId, []);
                }
                result.relationshipByPredecessor.get(rel.predId)!.push(relationship);
            }

            result.allTasksData[taskIndex++] = task;
            result.taskIdToTask.set(taskId, task);
        }

        // --- Pass 3: Create Synthetic Tasks ---
        for (const predId of allPredecessorIds) {
            if (result.taskIdToTask.has(predId)) {
                continue;
            }

            const syntheticTask: Task = {
                id: predId,
                internalId: predId,
                name: String(predId),
                type: "Synthetic",
                duration: 0,
                userProvidedTotalFloat: undefined,
                taskFreeFloat: undefined,
                predecessorIds: [],
                predecessors: [],
                successors: [],
                relationshipTypes: {},
                relationshipLags: {},
                earlyStart: 0,
                earlyFinish: 0,
                lateStart: Infinity,
                lateFinish: Infinity,
                totalFloat: Infinity,
                isCritical: false,
                isCriticalByFloat: false,
                isCriticalByRel: false,
                startDate: null,
                finishDate: null,
                baselineStartDate: null,
                baselineFinishDate: null,
                previousUpdateStartDate: null,
                previousUpdateFinishDate: null,
                tooltipData: undefined,
                legendValue: undefined,
            };

            result.allTasksData[taskIndex++] = syntheticTask;
            result.taskIdToTask.set(predId, syntheticTask);
        }

        if (taskIndex < result.allTasksData.length) {
            result.allTasksData.length = taskIndex;
        }

        // --- Link References ---
        for (const task of result.allTasksData) {
            task.successors = successorMap.get(task.internalId) || [];
            task.predecessors = task.predecessorIds
                .map((id) => result.taskIdToTask.get(id))
                .filter((t) => t !== undefined) as Task[];
        }

        // --- Helper Pass Processing ---
        this.processLegendData(dataView, settings, highContrastMode, highContrastForeground, result);
        this.processWBSData(result, settings, wbsExpandedState, lastExpandCollapseAllState);
        result.dataQuality = this.validateDataQuality(rows.length, result.allTasksData, result.taskIdToTask, {
            missingPredecessorIds: missingPredecessorIds.sort((a, b) => a.localeCompare(b)),
            conflictingTaskRows: this.detectConflictingTaskRows(taskDataMap, dataView),
            relationshipCount: relationshipRowCount,
            relationshipFreeFloatMissingCount,
            hasRelationshipFreeFloat: result.hasRelationshipFreeFloat
        });

        this.debugLog(`DataProcessor: Transformation complete. ${result.allTasksData.length} tasks.`);

        return result;
    }

    // --- Helper Methods ---

    private extractTaskId(row: any[], dataView: DataView): string | null {
        const idIdx = this.getColumnIndex(dataView, 'taskId');
        if (idIdx === -1) return null;

        const rawTaskId = row[idIdx];
        if (rawTaskId == null || (typeof rawTaskId !== 'string' && typeof rawTaskId !== 'number')) {
            return null;
        }

        const taskIdStr = String(rawTaskId).trim();
        return taskIdStr === '' ? null : taskIdStr;
    }

    private extractPredecessorId(row: any[], dataView: DataView): string | null {
        const predIdIdx = this.getColumnIndex(dataView, 'predecessorId');
        if (predIdIdx === -1) return null;

        const rawPredId = row[predIdIdx];
        if (rawPredId == null || (typeof rawPredId !== 'string' && typeof rawPredId !== 'number')) {
            return null;
        }

        const predIdStr = String(rawPredId).trim();
        return predIdStr === '' ? null : predIdStr;
    }

    private createTaskFromRow(row: any[], rowIndex: number, wbsLevelColumnIndices: number[], dataView: DataView): Task | null {
        if (!dataView) return null;

        const taskId = this.extractTaskId(row, dataView);
        if (!taskId) return null;

        const nameIdx = this.getColumnIndex(dataView, 'taskName');
        const typeIdx = this.getColumnIndex(dataView, 'taskType');
        const durationIdx = this.getColumnIndex(dataView, 'duration');
        const startDateIdx = this.getColumnIndex(dataView, 'startDate');
        const finishDateIdx = this.getColumnIndex(dataView, 'finishDate');
        const totalFloatIdx = this.getColumnIndex(dataView, 'taskTotalFloat');
        const taskFreeFloatIdx = this.getColumnIndex(dataView, 'taskFreeFloat');
        const baselineStartDateIdx = this.getColumnIndex(dataView, 'baselineStartDate');
        const baselineFinishDateIdx = this.getColumnIndex(dataView, 'baselineFinishDate');
        const previousUpdateStartDateIdx = this.getColumnIndex(dataView, 'previousUpdateStartDate');
        const previousUpdateFinishDateIdx = this.getColumnIndex(dataView, 'previousUpdateFinishDate');
        const manualStartDateIdx = this.getColumnIndex(dataView, 'manualStartDate');
        const manualFinishDateIdx = this.getColumnIndex(dataView, 'manualFinishDate');

        const taskName = (nameIdx !== -1 && row[nameIdx] != null)
            ? String(row[nameIdx]).trim()
            : `Task ${taskId}`;

        const taskType = (typeIdx !== -1 && row[typeIdx] != null)
            ? String(row[typeIdx]).trim()
            : 'TT_Task';

        let duration = 0;
        if (durationIdx !== -1 && row[durationIdx] != null) {
            const parsedDuration = Number(row[durationIdx]);
            if (!isNaN(parsedDuration) && isFinite(parsedDuration)) {
                duration = parsedDuration;
            }
        }
        if (taskType === 'TT_Mile' || taskType === 'TT_FinMile') {
            duration = 0;
        }
        duration = Math.max(0, duration);

        let userProvidedTotalFloat: number | undefined = undefined;
        if (totalFloatIdx !== -1 && row[totalFloatIdx] != null) {
            const parsedFloat = Number(row[totalFloatIdx]);
            if (!isNaN(parsedFloat) && isFinite(parsedFloat)) {
                userProvidedTotalFloat = parsedFloat;
            }
        }

        let taskFreeFloat: number | undefined = undefined;
        if (taskFreeFloatIdx !== -1 && row[taskFreeFloatIdx] != null) {
            const parsedFloat = Number(row[taskFreeFloatIdx]);
            if (!isNaN(parsedFloat) && isFinite(parsedFloat)) {
                taskFreeFloat = parsedFloat;
            }
        }

        const startDate = (startDateIdx !== -1 && row[startDateIdx] != null)
            ? this.parseDate(row[startDateIdx])
            : null;
        const finishDate = (finishDateIdx !== -1 && row[finishDateIdx] != null)
            ? this.parseDate(row[finishDateIdx])
            : null;

        const baselineStartDate = (baselineStartDateIdx !== -1 && row[baselineStartDateIdx] != null)
            ? this.parseDate(row[baselineStartDateIdx])
            : null;
        const baselineFinishDate = (baselineFinishDateIdx !== -1 && row[baselineFinishDateIdx] != null)
            ? this.parseDate(row[baselineFinishDateIdx])
            : null;

        const previousUpdateStartDate = (previousUpdateStartDateIdx !== -1 && row[previousUpdateStartDateIdx] != null)
            ? this.parseDate(row[previousUpdateStartDateIdx])
            : null;
        const previousUpdateFinishDate = (previousUpdateFinishDateIdx !== -1 && row[previousUpdateFinishDateIdx] != null)
            ? this.parseDate(row[previousUpdateFinishDateIdx])
            : null;


        const manualStartDate = (manualStartDateIdx !== -1 && row[manualStartDateIdx] != null)
            ? this.parseDate(row[manualStartDateIdx])
            : null;
        const manualFinishDate = (manualFinishDateIdx !== -1 && row[manualFinishDateIdx] != null)
            ? this.parseDate(row[manualFinishDateIdx])
            : null;

        if (rowIndex < 5) {
            this.debugLog(`[DEBUG] Task ${taskId} - manualStartIdx: ${manualStartDateIdx}, manualFinishIdx: ${manualFinishDateIdx}`);
            this.debugLog(`[DEBUG] Task ${taskId} - manualStartVal: ${row[manualStartDateIdx]}, manualFinishVal: ${row[manualFinishDateIdx]}`);
            this.debugLog(`[DEBUG] Task ${taskId} - parsedStart: ${manualStartDate}, parsedFinish: ${manualFinishDate}`);
        }


        const legendIdx = this.getColumnIndex(dataView, 'legend');
        const normalizedLegendValue = legendIdx !== -1
            ? normalizeLegendCategory(row[legendIdx])
            : null;
        const legendValue = normalizedLegendValue !== null
            ? normalizedLegendValue.trim()
            : undefined;

        const wbsLevels: string[] = [];
        for (const colIdx of wbsLevelColumnIndices) {
            if (colIdx !== -1 && row[colIdx] != null) {
                const value = String(row[colIdx]).trim();
                if (value) {
                    wbsLevels.push(value);
                }
            }
        }

        const tooltipData = this.extractTooltipData(row, dataView);

        const safeRowIndex = rowIndex >= 0 ? rowIndex : 0;
        const selectionId = dataView.table
            ? this.host.createSelectionIdBuilder().withTable(dataView.table, safeRowIndex).createSelectionId()
            : undefined;

        const task: Task = {
            id: row[this.getColumnIndex(dataView, 'taskId')],
            internalId: taskId,
            name: taskName,
            type: taskType,
            duration: duration,
            userProvidedTotalFloat: userProvidedTotalFloat,
            taskFreeFloat: taskFreeFloat,
            predecessorIds: [],
            predecessors: [],
            successors: [],
            relationshipTypes: {},
            relationshipLags: {},
            earlyStart: 0,
            earlyFinish: duration,
            lateStart: Infinity,
            lateFinish: Infinity,
            totalFloat: Infinity,
            isCritical: false,
            isCriticalByFloat: false,
            isCriticalByRel: false,
            startDate: startDate,
            finishDate: finishDate,
            baselineStartDate: baselineStartDate,
            baselineFinishDate: baselineFinishDate,
            previousUpdateStartDate: previousUpdateStartDate,
            previousUpdateFinishDate: previousUpdateFinishDate,
            manualStartDate: manualStartDate,
            manualFinishDate: manualFinishDate,
            tooltipData: tooltipData,
            selectionId: selectionId,
            legendValue: legendValue,
            wbsLevels: wbsLevels.length > 0 ? wbsLevels : undefined
        };

        return task;
    }

    private extractTooltipData(row: any[], dataView: DataView): Array<{ key: string, value: PrimitiveValue }> | undefined {
        const columns = dataView.table?.columns ?? dataView.metadata?.columns;
        if (!columns) return undefined;

        const tooltipColumns: Array<{ column: any, rowIndex: number }> = [];

        columns.forEach((column, index) => {
            if (column.roles?.tooltip) {
                if (index === 0 || !this.tooltipDebugLogged) {
                    this.debugLog(`Tooltip column: ${column.displayName}, index: ${column.index}, queryName: ${column.queryName}`);
                }
                tooltipColumns.push({
                    column: column,
                    rowIndex: index
                });
            }
        });

        this.tooltipDebugLogged = true;

        tooltipColumns.sort((a, b) => {
            const aQuery = a.column.queryName || '';
            const bQuery = b.column.queryName || '';

            const aMatch = aQuery.match(/\.tooltip\.(\d+)$/);
            const bMatch = bQuery.match(/\.tooltip\.(\d+)$/);

            if (aMatch && bMatch) {
                return parseInt(aMatch[1]) - parseInt(bMatch[1]);
            }

            if (a.column.index !== undefined && b.column.index !== undefined) {
                return a.column.index - b.column.index;
            }

            return a.rowIndex - b.rowIndex;
        });

        const tooltipData: Array<{ key: string, value: PrimitiveValue }> = [];

        for (const item of tooltipColumns) {
            const value = row[item.rowIndex];
            if (value !== null && value !== undefined) {

                if (item.column.type?.dateTime || this.mightBeDate(value)) {
                    const parsedDate = this.parseDate(value);
                    if (parsedDate) {
                        tooltipData.push({
                            key: item.column.displayName || `Field ${item.rowIndex}`,
                            value: parsedDate
                        });
                        continue;
                    }
                }

                tooltipData.push({
                    key: item.column.displayName || `Field ${item.rowIndex}`,
                    value: value
                });
            }
        }

        return tooltipData.length > 0 ? tooltipData : undefined;
    }

    private processLegendData(
        dataView: DataView,
        settings: VisualSettings,
        highContrastMode: boolean,
        highContrastForeground: string,
        data: ProcessedData
    ): void {
        data.legendDataExists = false;
        data.legendColorMap.clear();
        data.legendCategories = [];
        data.legendFieldName = "";

        const legendColumnInfo = this.getRoleColumnInfo(dataView, "legend");
        if (!legendColumnInfo) {
            for (const task of data.allTasksData) {
                task.legendColor = undefined;
            }
            return;
        }

        data.legendFieldName = legendColumnInfo.column.displayName || "Legend";
        // data.legendDataExists = true; // Moved after checking categories

        const legendValueSet = new Set<string>();
        for (const task of data.allTasksData) {
            if (task.legendValue) {
                legendValueSet.add(task.legendValue);
            }
        }

        data.legendCategories = Array.from(legendValueSet);
        data.legendDataExists = data.legendCategories.length > 0;

        const sortOrder = settings?.legend?.sortOrder?.value?.value || "none";
        if (sortOrder === "ascending") {
            data.legendCategories.sort((a, b) => a.localeCompare(b));
        } else if (sortOrder === "descending") {
            data.legendCategories.sort((a, b) => b.localeCompare(a));
        }

        const legendColorsObjects = dataView.metadata?.objects?.legendColors;

        for (let i = 0; i < data.legendCategories.length && i < 20; i++) {
            const category = data.legendCategories[i];
            const colorKey = `color${i + 1}`;

            if (highContrastMode) {
                data.legendColorMap.set(category, highContrastForeground);
                continue;
            }

            const persistedColor = legendColorsObjects?.[colorKey];

            if (persistedColor && typeof persistedColor === 'object' && 'solid' in persistedColor) {
                data.legendColorMap.set(category, (persistedColor as any).solid.color);
            } else {
                const defaultColor = this.host.colorPalette.getColor(category).value;
                data.legendColorMap.set(category, defaultColor);
            }
        }

        for (const task of data.allTasksData) {
            if (task.legendValue) {
                task.legendColor = data.legendColorMap.get(task.legendValue);
            } else {
                task.legendColor = undefined;
            }
        }
    }

    private processWBSData(
        data: ProcessedData,
        settings: VisualSettings,
        wbsExpandedState: Map<string, boolean>,
        lastExpandCollapseAllState: boolean | null
    ): void {
        data.wbsDataExists = false;
        data.wbsGroups = [];
        data.wbsGroupMap.clear();
        data.wbsRootGroups = [];
        data.wbsAvailableLevels = [];

        const hasWbsData = data.allTasksData.some(task =>
            task.wbsLevels && task.wbsLevels.length > 0
        );

        if (!hasWbsData) {
            for (const task of data.allTasksData) {
                task.wbsGroupId = undefined;
                task.wbsIndentLevel = 0;
            }
            return;
        }

        data.wbsDataExists = true;
        const expandCollapseAll = settings?.wbsGrouping?.expandCollapseAll?.value ?? true;

        const expandCollapseAllChanged = lastExpandCollapseAllState !== null &&
            lastExpandCollapseAllState !== expandCollapseAll;
        if (expandCollapseAllChanged) {
            wbsExpandedState.clear();
        }

        // Build WBS groups...
        for (const task of data.allTasksData) {
            const pathParts: string[] = [];

            if (task.wbsLevels && task.wbsLevels.length > 0) {
                for (let i = 0; i < task.wbsLevels.length; i++) {
                    const level = i + 1;
                    pathParts.push(`L${level}:${task.wbsLevels[i]}`);
                }
            }

            if (pathParts.length > 0) {
                task.wbsGroupId = pathParts.join('|');
                task.wbsIndentLevel = pathParts.length - 1;
            } else {
                task.wbsGroupId = undefined;
                task.wbsIndentLevel = 0;
            }
        }

        const groupPaths = new Set<string>();
        for (const task of data.allTasksData) {
            if (!task.wbsGroupId) continue;
            const parts = task.wbsGroupId.split('|');
            let currentPath = '';
            for (const part of parts) {
                currentPath = currentPath ? `${currentPath}|${part}` : part;
                groupPaths.add(currentPath);
            }
        }

        for (const path of groupPaths) {
            const parts = path.split('|');
            const lastPart = parts[parts.length - 1];
            const levelMatch = lastPart.match(/^L(\d+):(.+)$/);

            if (!levelMatch) continue;

            const level = parseInt(levelMatch[1], 10);
            const name = levelMatch[2];
            const parentPath = parts.length > 1 ? parts.slice(0, -1).join('|') : null;

            const isExpanded = wbsExpandedState.has(path)
                ? wbsExpandedState.get(path)!
                : expandCollapseAll;

            const group: WBSGroup = {
                id: path,
                level: level,
                name: name,
                fullPath: path,
                parentId: parentPath,
                children: [],
                tasks: [],
                allTasks: [],
                isExpanded: isExpanded,
                yOrder: undefined,
                visibleTaskCount: 0,
                summaryStartDate: null,
                summaryFinishDate: null,
                hasCriticalTasks: false,
                taskCount: 0,
                criticalStartDate: null,
                criticalFinishDate: null,
                hasNearCriticalTasks: false,
                nearCriticalStartDate: null,
                nearCriticalFinishDate: null,
                summaryBaselineStartDate: null,
                summaryBaselineFinishDate: null,
                summaryPreviousUpdateStartDate: null,
                summaryPreviousUpdateFinishDate: null,
                summaryTotalFloat: null
            };

            data.wbsGroups.push(group);
            data.wbsGroupMap.set(path, group);
        }

        for (const group of data.wbsGroups) {
            if (group.parentId) {
                const parent = data.wbsGroupMap.get(group.parentId);
                if (parent) {
                    parent.children.push(group);
                }
            } else {
                data.wbsRootGroups.push(group);
            }
        }

        for (const task of data.allTasksData) {
            if (task.wbsGroupId) {
                const group = data.wbsGroupMap.get(task.wbsGroupId);
                if (group) {
                    group.tasks.push(task);
                }
            }
        }

        // Calculate group metrics
        const calculateGroupMetrics = (group: WBSGroup): void => {
            // 1. Process children first (Post-order traversal)
            for (const child of group.children) {
                calculateGroupMetrics(child);
            }

            // 2. Initialize metrics with current group's direct tasks
            let minStart: Date | null = null;
            let maxFinish: Date | null = null;
            let minEarlyStart: Date | null = null;
            let maxEarlyFinish: Date | null = null;
            let nearCriticalMinStart: Date | null = null;
            let nearCriticalMaxFinish: Date | null = null;
            let baselineMinStart: Date | null = null;
            let baselineMaxFinish: Date | null = null;
            let prevUpdateMinStart: Date | null = null;
            let prevUpdateMaxFinish: Date | null = null;
            let minTotalFloat: number | null = null;

            let hasCritical = false;
            let hasNearCritical = false;

            // Process direct tasks
            for (const task of group.tasks) {
                if (task.isCritical) hasCritical = true;
                if (task.isNearCritical) hasNearCritical = true;

                const visualStart = task.manualStartDate ?? task.startDate;
                const visualFinish = task.manualFinishDate ?? task.finishDate;

                if (visualStart) {
                    if (!minStart || visualStart < minStart) minStart = visualStart;
                }
                if (visualFinish) {
                    if (!maxFinish || visualFinish > maxFinish) maxFinish = visualFinish;
                }
                if (task.startDate) {
                    if (!minEarlyStart || task.startDate < minEarlyStart) minEarlyStart = task.startDate;
                }
                if (task.finishDate) {
                    if (!maxEarlyFinish || task.finishDate > maxEarlyFinish) maxEarlyFinish = task.finishDate;
                }

                if (task.baselineStartDate) {
                    if (!baselineMinStart || task.baselineStartDate < baselineMinStart) baselineMinStart = task.baselineStartDate;
                }
                if (task.baselineFinishDate) {
                    if (!baselineMaxFinish || task.baselineFinishDate > baselineMaxFinish) baselineMaxFinish = task.baselineFinishDate;
                }
                if (task.previousUpdateStartDate) {
                    if (!prevUpdateMinStart || task.previousUpdateStartDate < prevUpdateMinStart) prevUpdateMinStart = task.previousUpdateStartDate;
                }
                if (task.previousUpdateFinishDate) {
                    if (!prevUpdateMaxFinish || task.previousUpdateFinishDate > prevUpdateMaxFinish) prevUpdateMaxFinish = task.previousUpdateFinishDate;
                }
                if (task.isNearCritical) {
                    if (visualStart && (!nearCriticalMinStart || visualStart < nearCriticalMinStart)) nearCriticalMinStart = visualStart;
                    if (visualFinish && (!nearCriticalMaxFinish || visualFinish > nearCriticalMaxFinish)) nearCriticalMaxFinish = visualFinish;
                }

                const taskFloat = task.userProvidedTotalFloat ?? task.totalFloat;
                if (isFinite(taskFloat)) {
                    minTotalFloat = minTotalFloat === null
                        ? taskFloat
                        : Math.min(minTotalFloat, taskFloat);
                }
            }

            // 3. Aggregate with Children's Metrics
            let childTaskCount = 0;

            for (const child of group.children) {
                childTaskCount += child.taskCount;
                if (child.hasCriticalTasks) hasCritical = true;
                if (child.hasNearCriticalTasks) hasNearCritical = true;

                // Aggregate Dates
                if (child.summaryStartDate) {
                    if (!minStart || child.summaryStartDate < minStart) minStart = child.summaryStartDate;
                }
                if (child.summaryFinishDate) {
                    if (!maxFinish || child.summaryFinishDate > maxFinish) maxFinish = child.summaryFinishDate;
                }
                if (child.summaryEarlyStartDate) {
                    if (!minEarlyStart || child.summaryEarlyStartDate < minEarlyStart) minEarlyStart = child.summaryEarlyStartDate;
                }
                if (child.summaryEarlyFinishDate) {
                    if (!maxEarlyFinish || child.summaryEarlyFinishDate > maxEarlyFinish) maxEarlyFinish = child.summaryEarlyFinishDate;
                }

                if (child.summaryBaselineStartDate) {
                    if (!baselineMinStart || child.summaryBaselineStartDate < baselineMinStart) baselineMinStart = child.summaryBaselineStartDate;
                }
                if (child.summaryBaselineFinishDate) {
                    if (!baselineMaxFinish || child.summaryBaselineFinishDate > baselineMaxFinish) baselineMaxFinish = child.summaryBaselineFinishDate;
                }
                if (child.summaryPreviousUpdateStartDate) {
                    if (!prevUpdateMinStart || child.summaryPreviousUpdateStartDate < prevUpdateMinStart) prevUpdateMinStart = child.summaryPreviousUpdateStartDate;
                }
                if (child.summaryPreviousUpdateFinishDate) {
                    if (!prevUpdateMaxFinish || child.summaryPreviousUpdateFinishDate > prevUpdateMaxFinish) prevUpdateMaxFinish = child.summaryPreviousUpdateFinishDate;
                }
                if (child.nearCriticalStartDate) {
                    if (!nearCriticalMinStart || child.nearCriticalStartDate < nearCriticalMinStart) nearCriticalMinStart = child.nearCriticalStartDate;
                }
                if (child.nearCriticalFinishDate) {
                    if (!nearCriticalMaxFinish || child.nearCriticalFinishDate > nearCriticalMaxFinish) nearCriticalMaxFinish = child.nearCriticalFinishDate;
                }

                if (typeof child.summaryTotalFloat === "number" && isFinite(child.summaryTotalFloat)) {
                    minTotalFloat = minTotalFloat === null
                        ? child.summaryTotalFloat
                        : Math.min(minTotalFloat, child.summaryTotalFloat);
                }
            }

            // 4. Set Result
            group.taskCount = group.tasks.length + childTaskCount;
            group.hasCriticalTasks = hasCritical;
            group.hasNearCriticalTasks = hasNearCritical;

            group.summaryStartDate = minStart;
            group.summaryFinishDate = maxFinish;
            group.summaryEarlyStartDate = minEarlyStart;
            group.summaryEarlyFinishDate = maxEarlyFinish;
            group.nearCriticalStartDate = nearCriticalMinStart;
            group.nearCriticalFinishDate = nearCriticalMaxFinish;
            group.summaryBaselineStartDate = baselineMinStart;
            group.summaryBaselineFinishDate = baselineMaxFinish;
            group.summaryPreviousUpdateStartDate = prevUpdateMinStart;
            group.summaryPreviousUpdateFinishDate = prevUpdateMaxFinish;
            group.summaryTotalFloat = minTotalFloat;
        };

        for (const rootGroup of data.wbsRootGroups) {
            calculateGroupMetrics(rootGroup);
        }

        const sortByStartDate = (a: WBSGroup, b: WBSGroup): number => {
            const aStart = a.summaryStartDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
            const bStart = b.summaryStartDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
            if (aStart !== bStart) return aStart - bStart;
            return a.fullPath.localeCompare(b.fullPath);
        };

        data.wbsGroups.sort(sortByStartDate);
        data.wbsRootGroups.sort(sortByStartDate);
        for (const group of data.wbsGroups) {
            group.children.sort(sortByStartDate);
        }

        // Refresh available levels
        const levelSet = new Set<number>();
        for (const group of data.wbsGroups) {
            levelSet.add(group.level);
        }
        data.wbsAvailableLevels = Array.from(levelSet).sort((a, b) => a - b);
    }

    private createEmptyDataQuality(): DataQualityInfo {
        return {
            rowCount: 0,
            possibleTruncation: false,
            duplicateTaskIds: [],
            conflictingTaskRows: [],
            missingPredecessorIds: [],
            relationshipCount: 0,
            relationshipFreeFloatMissingCount: 0,
            hasRelationshipFreeFloat: false,
            circularPaths: [],
            invalidRawDateRangeTaskIds: [],
            invalidVisualDateRangeTaskIds: [],
            warnings: [],
            cpmSafe: true
        };
    }

    private getRawStart(task: Task): Date | null {
        return task.startDate ?? null;
    }

    private getRawFinish(task: Task): Date | null {
        return task.finishDate ?? null;
    }

    private getVisualStart(task: Task): Date | null {
        return task.manualStartDate ?? task.startDate ?? null;
    }

    private getVisualFinish(task: Task): Date | null {
        return task.manualFinishDate ?? task.finishDate ?? null;
    }

    private isEarlier(endDate: Date | null, startDate: Date | null): boolean {
        return endDate instanceof Date &&
            startDate instanceof Date &&
            !isNaN(endDate.getTime()) &&
            !isNaN(startDate.getTime()) &&
            endDate < startDate;
    }

    private detectConflictingTaskRows(taskDataMap: Map<string, TaskRowBucket>, dataView: DataView): string[] {
        const rolesToCompare = [
            "taskName",
            "duration",
            "taskTotalFloat",
            "taskFreeFloat",
            "startDate",
            "finishDate",
            "manualStartDate",
            "manualFinishDate",
            "baselineStartDate",
            "baselineFinishDate",
            "previousUpdateStartDate",
            "previousUpdateFinishDate",
            "dataDate",
            "taskType",
            "legend"
        ];

        const roleColumns = rolesToCompare
            .map(role => ({
                role,
                column: this.getRoleColumnInfo(dataView, role)
            }))
            .filter((entry): entry is { role: string; column: { column: { displayName?: string }; index: number } } => entry.column !== null);

        if (roleColumns.length === 0) {
            return [];
        }

        const conflicts: string[] = [];

        for (const [taskId, taskData] of taskDataMap) {
            if (taskData.rows.length <= 1) {
                continue;
            }

            const conflictingFields: string[] = [];
            for (const { column } of roleColumns) {
                const firstValue = this.normalizeQualityValue(taskData.rows[0][column.index]);
                const hasConflict = taskData.rows.some(row => this.normalizeQualityValue(row[column.index]) !== firstValue);
                if (hasConflict) {
                    conflictingFields.push(column.column.displayName || `Column ${column.index + 1}`);
                }
            }

            if (conflictingFields.length > 0) {
                conflicts.push(`${taskId}: ${conflictingFields.slice(0, 4).join(", ")}${conflictingFields.length > 4 ? ` +${conflictingFields.length - 4} more` : ""}`);
            }
        }

        return conflicts;
    }

    private normalizeQualityValue(value: unknown): string {
        if (value === null || value === undefined) {
            return "";
        }

        if (value instanceof Date) {
            return Number.isNaN(value.getTime()) ? "" : `date:${value.getTime()}`;
        }

        if (typeof value === "number") {
            if (Number.isNaN(value)) {
                return "";
            }
            return Number.isFinite(value) ? value.toString() : "";
        }

        return String(value).trim();
    }

    private validateDataQuality(rowCount: number, allTasksData: Task[], taskIdToTask: Map<string, Task>, context: DataQualityContext): DataQualityInfo {
        const seenIds = new Map<string, number>();
        for (const task of allTasksData) {
            const count = seenIds.get(task.id as string) || 0;
            seenIds.set(task.id as string, count + 1);
        }

        const duplicates = Array.from(seenIds.entries())
            .filter(([_id, count]) => count > 1)
            .map(([id, count]) => `${id} (${count}x)`);

        const possibleTruncation = rowCount >= 30000;
        const circularPaths = this.detectCircularDependencies(allTasksData, taskIdToTask);
        const invalidRawDateRangeTaskIds = allTasksData
            .filter(task => this.isEarlier(this.getRawFinish(task), this.getRawStart(task)))
            .map(task => String(task.id ?? task.internalId));
        const invalidVisualDateRangeTaskIds = allTasksData
            .filter(task => this.isEarlier(this.getVisualFinish(task), this.getVisualStart(task)))
            .map(task => String(task.id ?? task.internalId));

        const warnings: string[] = [];
        if (possibleTruncation) {
            warnings.push("Critical path disabled: dataset may be truncated at 30,000 rows.");
        }
        if (duplicates.length > 0) {
            warnings.push(`Duplicate Task IDs found: ${duplicates.slice(0, 5).join(', ')}${duplicates.length > 5 ? ` and ${duplicates.length - 5} more` : ''}`);
        }
        if (circularPaths.length > 0) {
            warnings.push(`Critical path disabled: circular dependencies detected (${circularPaths.length}).`);
        }
        if (invalidRawDateRangeTaskIds.length > 0) {
            warnings.push(`Critical path disabled: invalid raw start/finish ranges found (${invalidRawDateRangeTaskIds.length}).`);
        }
        if (invalidVisualDateRangeTaskIds.length > 0) {
            warnings.push(`Visual date warnings: invalid plotted start/finish ranges found (${invalidVisualDateRangeTaskIds.length}).`);
        }
        if (context.relationshipCount > 0 && !context.hasRelationshipFreeFloat) {
            warnings.push("Relationship Free Float is not provided; driving logic is approximated from scheduled dates, relationship type, and lag.");
        }

        const cpmSafe = !possibleTruncation &&
            circularPaths.length === 0 &&
            invalidRawDateRangeTaskIds.length === 0;

        const dataQuality: DataQualityInfo = {
            rowCount,
            possibleTruncation,
            duplicateTaskIds: duplicates,
            conflictingTaskRows: context.conflictingTaskRows,
            missingPredecessorIds: context.missingPredecessorIds,
            relationshipCount: context.relationshipCount,
            relationshipFreeFloatMissingCount: context.relationshipFreeFloatMissingCount,
            hasRelationshipFreeFloat: context.hasRelationshipFreeFloat,
            circularPaths,
            invalidRawDateRangeTaskIds,
            invalidVisualDateRangeTaskIds,
            warnings,
            cpmSafe
        };

        if (warnings.length > 0) {
            this.debugLog("Data quality issues detected:", dataQuality);
            warnings.forEach((warning, index) => console.warn(`Data quality ${index + 1}: ${warning}`));
        }

        return dataQuality;
    }




    private detectCircularDependencies(allTasksData: Task[], taskIdToTask: Map<string, Task>): string[] {
        const circularPaths: string[] = [];
        const seenCycles = new Set<string>();
        const visitState = new Map<string, 0 | 1 | 2>();
        const parent = new Map<string, string | null>();

        type StackFrame = { id: string; preds: string[]; index: number };
        const stack: StackFrame[] = [];

        const pushNode = (taskId: string, parentId: string | null) => {
            visitState.set(taskId, 1);
            parent.set(taskId, parentId);
            const preds = taskIdToTask.get(taskId)?.predecessorIds ?? [];
            stack.push({ id: taskId, preds, index: 0 });
        };

        for (const task of allTasksData) {
            const startId = task.internalId;
            if (visitState.get(startId)) {
                continue;
            }

            pushNode(startId, null);

            while (stack.length > 0) {
                const frame = stack[stack.length - 1];

                if (frame.index >= frame.preds.length) {
                    visitState.set(frame.id, 2);
                    stack.pop();
                    continue;
                }

                const predId = frame.preds[frame.index++];
                if (!taskIdToTask.has(predId)) {
                    continue;
                }

                const state = visitState.get(predId) ?? 0;
                if (state === 0) {
                    pushNode(predId, frame.id);
                } else if (state === 1) {
                    const cycle: string[] = [predId];
                    let current: string | null = frame.id;

                    while (current && current !== predId) {
                        cycle.push(current);
                        current = parent.get(current) ?? null;
                    }

                    cycle.push(predId);
                    cycle.reverse();

                    const key = cycle.join('->');
                    if (!seenCycles.has(key)) {
                        seenCycles.add(key);
                        circularPaths.push(cycle.join(' -> '));
                    }
                }
            }
        }

        return circularPaths;
    }

    // --- Utilities ---

    public hasDataRole(dataView: DataView, roleName: string): boolean {
        return this.getRoleColumnInfos(dataView, roleName).length > 0;
    }

    public getColumnIndex(dataView: DataView, roleName: string): number {
        const columnInfo = this.getRoleColumnInfo(dataView, roleName);
        return columnInfo ? columnInfo.index : -1;
    }

    public getRoleColumnLayout(dataView: DataView, roleName: string): { indices: number[]; names: string[] } {
        const infos = this.getRoleColumnInfos(dataView, roleName);
        return {
            indices: infos.map(info => info.index),
            names: infos.map((info, i) => info.column.displayName || `Level ${i + 1}`)
        };
    }

    public validateDataView(dataView: DataView, settings: VisualSettings): boolean {
        if (!dataView?.table?.rows || !dataView.metadata?.columns) {
            return false;
        }

        const hasId = this.hasDataRole(dataView, 'taskId');
        const hasStartDate = this.hasDataRole(dataView, 'startDate');
        const hasFinishDate = this.hasDataRole(dataView, 'finishDate');

        const mode = settings?.criticalPath?.calculationMode?.value?.value || 'longestPath';
        const hasDuration = this.hasDataRole(dataView, 'duration');
        const hasTotalFloat = this.hasDataRole(dataView, 'taskTotalFloat');

        let isValid = true;
        if (!hasId) isValid = false;
        if (mode === 'floatBased') {
            if (!hasTotalFloat) isValid = false;
        } else {
            if (!hasDuration) isValid = false;
        }
        if (!hasStartDate || !hasFinishDate) isValid = false;

        return isValid;
    }

    public parseDate(dateValue: PrimitiveValue): Date | null {
        if (dateValue == null) return null;
        let date: Date | null = null;

        try {
            if (dateValue instanceof Date) {
                if (!isNaN(dateValue.getTime())) date = dateValue;
            }
            else if (typeof dateValue === 'string') {
                let dateStrToParse = dateValue.trim();
                if (dateStrToParse) {
                    const parsedTimestamp = Date.parse(dateStrToParse);
                    if (!isNaN(parsedTimestamp)) date = new Date(parsedTimestamp);
                    if (!date) {
                        date = new Date(dateStrToParse);
                        if (isNaN(date.getTime())) date = null;
                    }
                }
            }
            else if (typeof dateValue === 'number') {
                const num = dateValue;
                if (!isNaN(num) && isFinite(num)) {
                    if (num >= 61 && num < 2958466) {
                        date = new Date(Math.round((num - 25569) * 86400 * 1000));
                    }
                    else if (num > 631152000000 && num < Date.now() + 3153600000000 * 20) {
                        date = new Date(num);
                    }
                    else if (num > 631152000 && num < (Date.now() / 1000) + 31536000 * 20) {
                        date = new Date(num * 1000);
                    }
                    if (date && isNaN(date.getTime())) date = null;
                }
            }
        } catch (e) {
            date = null;
        }
        return date;
    }

    public mightBeDate(value: PrimitiveValue): boolean {
        if (value instanceof Date) return true;
        if (typeof value === 'string') {
            return /^\d{4}-\d{1,2}-\d{1,2}|^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}/.test(value);
        }
        if (typeof value === 'number') {
            return value > 946684800000;
        }
        return false;
    }

    /**
     * Detects which optional date-pair fields are actually bound in the field wells
     * AND contain at least one non-null value across the processed tasks.
     * This enables the visual to conditionally hide columns, bars, and toggle buttons.
     */
    public detectBoundFields(dataView: DataView, tasks: Task[]): BoundFieldState {
        const baselineStartBound = this.hasDataRole(dataView, 'baselineStartDate');
        const baselineFinishBound = this.hasDataRole(dataView, 'baselineFinishDate');
        const previousUpdateStartBound = this.hasDataRole(dataView, 'previousUpdateStartDate');
        const previousUpdateFinishBound = this.hasDataRole(dataView, 'previousUpdateFinishDate');

        // Both roles must be bound AND at least one task must have a non-null value
        let baselineHasData = false;
        let previousUpdateHasData = false;

        if ((baselineStartBound && baselineFinishBound) || (previousUpdateStartBound && previousUpdateFinishBound)) {
            for (const task of tasks) {
                if (!baselineHasData && baselineStartBound && baselineFinishBound) {
                    if (task.baselineStartDate instanceof Date && !isNaN(task.baselineStartDate.getTime()) ||
                        task.baselineFinishDate instanceof Date && !isNaN(task.baselineFinishDate.getTime())) {
                        baselineHasData = true;
                    }
                }
                if (!previousUpdateHasData && previousUpdateStartBound && previousUpdateFinishBound) {
                    if (task.previousUpdateStartDate instanceof Date && !isNaN(task.previousUpdateStartDate.getTime()) ||
                        task.previousUpdateFinishDate instanceof Date && !isNaN(task.previousUpdateFinishDate.getTime())) {
                        previousUpdateHasData = true;
                    }
                }
                // Early exit if both are found
                if (baselineHasData && previousUpdateHasData) break;
            }
        }

        return {
            baselineStartBound,
            baselineFinishBound,
            previousUpdateStartBound,
            previousUpdateFinishBound,
            baselineAvailable: baselineStartBound && baselineFinishBound && baselineHasData,
            previousUpdateAvailable: previousUpdateStartBound && previousUpdateFinishBound && previousUpdateHasData
        };
    }
}

