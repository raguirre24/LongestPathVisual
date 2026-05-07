import { afterEach, describe, expect, it, vi } from "vitest";
import powerbi from "powerbi-visuals-api";
import DataView = powerbi.DataView;

import { DataProcessor } from "../../src/data/DataProcessor";
import type { Relationship, Task } from "../../src/data/Interfaces";
import { exportToClipboard } from "../../src/utils/ClipboardExporter";
import {
    buildDrivingEventGraph,
    calculateLongestDrivingPaths,
    expandBestDrivingPaths,
    getTaskEventNodeId,
    getTaskIdFromEventNodeId,
    getTiedLatestFinishTaskIds,
    selectBestSinkNodeIds,
    type ScheduleRelationshipLike,
    type ScheduleTaskLike
} from "../../src/utils/DrivingPathScoring";
import { markMinimumFloatDrivingRelationships } from "../../src/utils/RelationshipLogic";

const TOLERANCE_DAYS = 1e-9;
const STRESS_TASK_COUNT = 1200;
const LONGEST_PATH_TASK_TYPES = new Set(["TT_Task", "TT_Mile", "TT_FinMile"]);

interface ColumnDef {
    displayName: string;
    queryName: string;
    roles: { [role: string]: boolean };
    type?: any;
}

interface GeneratedTask {
    id: string;
    name: string;
    type: string;
    duration: number;
    startDate: Date;
    finishDate: Date;
    manualStartDate: Date;
    manualFinishDate: Date;
    baselineStartDate: Date;
    baselineFinishDate: Date;
    previousUpdateStartDate: Date;
    previousUpdateFinishDate: Date;
    dataDate: Date;
    totalFloat: number;
    freeFloat: number;
    legend: string;
    wbs1: string;
    wbs2: string;
    wbs3: string;
}

type StressRelationship = ScheduleRelationshipLike & {
    relationshipFloat: number | null;
    isDriving?: boolean;
};

const STRESS_COLUMNS: ColumnDef[] = [
    { displayName: "Task ID", queryName: "Stress[TaskID]", roles: { taskId: true } },
    { displayName: "Task Name", queryName: "Stress[TaskName]", roles: { taskName: true } },
    { displayName: "Task Type", queryName: "Stress[TaskType]", roles: { taskType: true } },
    { displayName: "Duration", queryName: "Stress[Duration]", roles: { duration: true } },
    { displayName: "Total Float", queryName: "Stress[TotalFloat]", roles: { taskTotalFloat: true } },
    { displayName: "Free Float", queryName: "Stress[FreeFloat]", roles: { taskFreeFloat: true } },
    { displayName: "Early Start", queryName: "Stress[EarlyStart]", roles: { startDate: true } },
    { displayName: "Early Finish", queryName: "Stress[EarlyFinish]", roles: { finishDate: true } },
    { displayName: "Start Date", queryName: "Stress[ManualStart]", roles: { manualStartDate: true } },
    { displayName: "Finish Date", queryName: "Stress[ManualFinish]", roles: { manualFinishDate: true } },
    { displayName: "Baseline Start", queryName: "Stress[BaselineStart]", roles: { baselineStartDate: true } },
    { displayName: "Baseline Finish", queryName: "Stress[BaselineFinish]", roles: { baselineFinishDate: true } },
    { displayName: "Previous Start", queryName: "Stress[PreviousStart]", roles: { previousUpdateStartDate: true } },
    { displayName: "Previous Finish", queryName: "Stress[PreviousFinish]", roles: { previousUpdateFinishDate: true } },
    { displayName: "Data Date", queryName: "Stress[DataDate]", roles: { dataDate: true } },
    { displayName: "Predecessor", queryName: "Stress[Predecessor]", roles: { predecessorId: true } },
    { displayName: "Relationship Type", queryName: "Stress[RelationshipType]", roles: { relationshipType: true } },
    { displayName: "Lag", queryName: "Stress[Lag]", roles: { relationshipLag: true } },
    { displayName: "Relationship Free Float", queryName: "Stress[RelationshipFreeFloat]", roles: { relationshipFreeFloat: true } },
    { displayName: "Legend", queryName: "Stress[Legend]", roles: { legend: true } },
    { displayName: "WBS Level 1", queryName: "Stress[WBS1]", roles: { wbsLevels: true } },
    { displayName: "WBS Level 2", queryName: "Stress[WBS2]", roles: { wbsLevels: true } },
    { displayName: "WBS Level 3", queryName: "Stress[WBS3]", roles: { wbsLevels: true } },
    { displayName: "Tooltip", queryName: "Stress[Tooltip]", roles: { tooltip: true } }
];

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("visual stress coverage", () => {
    it("processes a large P6-shaped table with repeated relationship rows and rich optional fields", () => {
        const generated = buildStressDataView(STRESS_TASK_COUNT);
        const result = processStressDataView(generated.dataView);

        expect(result.allTasksData).toHaveLength(STRESS_TASK_COUNT);
        expect(result.taskIdToTask.size).toBe(STRESS_TASK_COUNT);
        expect(result.relationships).toHaveLength(generated.expectedUniqueRelationshipCount);
        expect(result.dataQuality.relationshipCount).toBe(generated.relationshipRowCount);
        expect(result.dataQuality.conflictingTaskRows).toEqual([]);
        expect(result.dataQuality.circularPaths).toEqual([]);
        expect(result.dataQuality.invalidRawDateRangeTaskIds).toEqual([]);
        expect(result.dataQuality.cpmSafe).toBe(true);
        expect(result.hasRelationshipFreeFloat).toBe(true);
        expect(result.legendDataExists).toBe(true);
        expect(result.wbsDataExists).toBe(true);
        expect(result.wbsGroups.length).toBeGreaterThan(0);
        expect(result.relationships.some(relationship => relationship.type === "SS")).toBe(true);
        expect(result.relationships.some(relationship => relationship.type === "FF")).toBe(true);
        expect(result.relationships.some(relationship => relationship.type === "SF")).toBe(true);
        expect(result.allTasksData.some(task => task.type === "TT_Task" && task.duration === 0)).toBe(true);
        expect(result.allTasksData.some(task => task.type === "TT_Mile")).toBe(true);
        expect(result.allTasksData.some(task => task.type === "TT_FinMile")).toBe(true);
    });

    it("scores a large generated driving chain while ignoring higher-float alternate relationships", () => {
        const generated = buildStressDataView(STRESS_TASK_COUNT);
        const result = processStressDataView(generated.dataView);
        const tasksById = new Map(
            result.allTasksData
                .filter(task => LONGEST_PATH_TASK_TYPES.has(task.type))
                .map(task => [task.internalId, task])
        );
        const taskOrder = result.allTasksData
            .filter(task => tasksById.has(task.internalId))
            .map(task => task.internalId);
        const drivingRelationships = selectMinimumFloatRelationships(result.relationships, tasksById);
        const graph = buildDrivingEventGraph(tasksById, taskOrder, drivingRelationships);
        const sourceNodeIds = graph.rootStartNodeIds
            .map(getTaskIdFromEventNodeId)
            .map(taskId => getTaskEventNodeId(taskId, "start"));
        const terminalTaskIds = graph.terminalFinishNodeIds.map(getTaskIdFromEventNodeId);
        const tiedLatestFinishTaskIds = getTiedLatestFinishTaskIds(tasksById, terminalTaskIds, TOLERANCE_DAYS);
        const sinkNodeIds = tiedLatestFinishTaskIds.map(taskId => getTaskEventNodeId(taskId, "finish"));
        const longestPaths = calculateLongestDrivingPaths(graph, sourceNodeIds, TOLERANCE_DAYS);
        const bestSinkNodeIds = selectBestSinkNodeIds(longestPaths.distances, sinkNodeIds, TOLERANCE_DAYS);
        const expanded = expandBestDrivingPaths(
            graph,
            longestPaths.bestIncoming,
            longestPaths.distances,
            bestSinkNodeIds,
            { maxPaths: 5, maxExpansions: STRESS_TASK_COUNT * 4 }
        );
        const path = expanded.paths[0];

        expect(drivingRelationships).toHaveLength(STRESS_TASK_COUNT - 1);
        expect(tiedLatestFinishTaskIds).toEqual([generated.terminalTaskId]);
        expect(bestSinkNodeIds).toEqual([getTaskEventNodeId(generated.terminalTaskId, "finish")]);
        expect(expanded.truncated).toBe(false);
        expect(expanded.paths).toHaveLength(1);
        expect(path.taskIds).toHaveLength(STRESS_TASK_COUNT);
        expect(path.taskIds[0]).toBe("T0000");
        expect(path.taskIds[path.taskIds.length - 1]).toBe(generated.terminalTaskId);
        expect(path.relationships.every(relationship => relationship.relationshipFloat === 0)).toBe(true);
        expect(path.spanDays).toBeCloseTo(
            daysBetween(generated.tasks[0].startDate, generated.tasks[generated.tasks.length - 1].finishDate),
            9
        );
    });

    it("caps expansion for many tied driving paths instead of enumerating every combination", () => {
        const { tasksById, taskOrder, relationships } = buildWideTiedPathGraph(8, 4);
        const graph = buildDrivingEventGraph(tasksById, taskOrder, relationships);
        const sourceNodeIds = [getTaskEventNodeId("R", "start")];
        const sinkNodeIds = [getTaskEventNodeId("Z", "finish")];
        const longestPaths = calculateLongestDrivingPaths(graph, sourceNodeIds, TOLERANCE_DAYS);
        const bestSinkNodeIds = selectBestSinkNodeIds(longestPaths.distances, sinkNodeIds, TOLERANCE_DAYS);
        const expanded = expandBestDrivingPaths(
            graph,
            longestPaths.bestIncoming,
            longestPaths.distances,
            bestSinkNodeIds,
            { maxPaths: 20, maxExpansions: 10000 }
        );

        expect(bestSinkNodeIds).toEqual(sinkNodeIds);
        expect(expanded.paths).toHaveLength(20);
        expect(expanded.truncated).toBe(true);
        expect(expanded.truncatedByPathLimit).toBe(true);
        expect(expanded.truncatedByExpansionLimit).toBe(false);
        expect(expanded.paths.every(path => path.taskIds[0] === "R")).toBe(true);
        expect(expanded.paths.every(path => path.taskIds[path.taskIds.length - 1] === "Z")).toBe(true);
    });

    it("keeps zero-duration tasks as activities in copy-to-Excel output when task type is bound", async () => {
        class ClipboardItemMock {
            public readonly items: Record<string, Blob>;

            constructor(items: Record<string, Blob>) {
                this.items = items;
            }
        }

        let capturedClipboardItems: ClipboardItemMock[] | null = null;
        const write = vi.fn(async (items: ClipboardItemMock[]) => {
            capturedClipboardItems = items;
        });

        vi.stubGlobal("navigator", { clipboard: { write } });
        vi.stubGlobal("ClipboardItem", ClipboardItemMock);

        const zeroDurationActivity = buildExportTask("A0", "Zero duration activity", "TT_Task", 0);
        const finishMilestone = buildExportTask("M0", "Finish milestone", "TT_FinMile", 0);
        const tasks = [
            zeroDurationActivity,
            finishMilestone,
            ...Array.from({ length: 250 }, (_value, index) =>
                buildExportTask(`T${index}`, `Bulk task ${index}`, "TT_Task", (index % 5) + 1)
            )
        ];

        await exportToClipboard({
            tasks,
            showWbs: false,
            showBaseline: false,
            showPreviousUpdate: false,
            onSuccess: count => expect(count).toBe(tasks.length)
        });

        expect(write).toHaveBeenCalledTimes(1);
        expect(capturedClipboardItems).not.toBeNull();
        if (!capturedClipboardItems?.[0]) {
            throw new Error("Clipboard write payload was not captured");
        }
        const clipboardItem = capturedClipboardItems[0];
        const tsvContent = await clipboardItem.items["text/plain"].text();
        const htmlContent = await clipboardItem.items["text/html"].text();
        const tsvRows = tsvContent.split("\n");
        const taskTypeIndex = tsvRows[0].split("\t").indexOf("Task Type");
        const zeroDurationActivityRow = tsvRows.find(row => row.includes("Zero duration activity"))?.split("\t");
        const finishMilestoneRow = tsvRows.find(row => row.includes("Finish milestone"))?.split("\t");

        expect(tsvRows).toHaveLength(tasks.length + 1);
        expect(zeroDurationActivityRow?.[taskTypeIndex]).toBe("Activity");
        expect(finishMilestoneRow?.[taskTypeIndex]).toBe("Milestone");
        expect(htmlContent).toMatch(/Zero duration activity<\/td><td[^>]*>Activity<\/td>/);
        expect(htmlContent).toMatch(/Finish milestone<\/td><td[^>]*>Milestone<\/td>/);
    });
});

function processStressDataView(dataView: DataView) {
    const processor = new DataProcessor(createMockHost());
    return processor.processData(dataView, createMockSettings(), new Map(), new Set(), null, false, "#000000");
}

function buildStressDataView(taskCount: number): {
    dataView: DataView;
    tasks: GeneratedTask[];
    expectedUniqueRelationshipCount: number;
    relationshipRowCount: number;
    terminalTaskId: string;
} {
    const tasks = buildGeneratedTasks(taskCount);
    const rows: any[][] = [];
    let expectedUniqueRelationshipCount = 0;
    let relationshipRowCount = 0;

    for (let index = 0; index < tasks.length; index++) {
        const task = tasks[index];
        if (index === 0) {
            rows.push(buildStressRow(task, null));
            continue;
        }

        const baseRelationship = {
            predecessorId: tasks[index - 1].id,
            type: "PR_FS",
            lag: index % 9 === 0 ? -1 : index % 7 === 0 ? 2 : 0,
            freeFloat: 0
        };
        rows.push(buildStressRow(task, baseRelationship));
        expectedUniqueRelationshipCount++;
        relationshipRowCount++;

        if (index % 211 === 0) {
            rows.push(buildStressRow(task, baseRelationship));
            relationshipRowCount++;
        }

        if (index > 1 && index % 4 === 0) {
            rows.push(buildStressRow(task, {
                predecessorId: tasks[index - 2].id,
                type: getAlternateRelationshipType(index),
                lag: index % 3,
                freeFloat: 4
            }));
            expectedUniqueRelationshipCount++;
            relationshipRowCount++;
        }
    }

    return {
        dataView: buildDataView(STRESS_COLUMNS, rows),
        tasks,
        expectedUniqueRelationshipCount,
        relationshipRowCount,
        terminalTaskId: tasks[tasks.length - 1].id
    };
}

function buildGeneratedTasks(taskCount: number): GeneratedTask[] {
    const tasks: GeneratedTask[] = [];
    let startDay = 0;

    for (let index = 0; index < taskCount; index++) {
        const taskType = getGeneratedTaskType(index);
        const duration = getGeneratedDuration(index, taskType);
        const finishDay = startDay + duration;
        const startDate = atDay(startDay);
        const finishDate = atDay(finishDay);

        tasks.push({
            id: `T${index.toString().padStart(4, "0")}`,
            name: `Stress task ${index}`,
            type: taskType,
            duration,
            startDate,
            finishDate,
            manualStartDate: startDate,
            manualFinishDate: finishDate,
            baselineStartDate: atDay(startDay - 3),
            baselineFinishDate: atDay(finishDay - 3),
            previousUpdateStartDate: atDay(startDay - 1),
            previousUpdateFinishDate: atDay(finishDay - 1),
            dataDate: atDay(0),
            totalFloat: index % 17,
            freeFloat: index % 13,
            legend: `Zone ${index % 5}`,
            wbs1: `Project ${index % 3}`,
            wbs2: `Area ${index % 9}`,
            wbs3: `Discipline ${index % 11}`
        });

        startDay = finishDay + 1;
    }

    return tasks;
}

function getGeneratedTaskType(index: number): string {
    if (index > 0 && index % 337 === 0) {
        return "TT_FinMile";
    }
    if (index > 0 && index % 157 === 0) {
        return "TT_Mile";
    }
    return "TT_Task";
}

function getGeneratedDuration(index: number, taskType: string): number {
    if (taskType === "TT_Mile" || taskType === "TT_FinMile" || (index > 0 && index % 113 === 0)) {
        return 0;
    }
    return (index % 5) + 1;
}

function buildStressRow(
    task: GeneratedTask,
    relationship: { predecessorId: string; type: string; lag: number; freeFloat: number } | null
): any[] {
    return [
        task.id,
        task.name,
        task.type,
        task.duration,
        task.totalFloat,
        task.freeFloat,
        task.startDate,
        task.finishDate,
        task.manualStartDate,
        task.manualFinishDate,
        task.baselineStartDate,
        task.baselineFinishDate,
        task.previousUpdateStartDate,
        task.previousUpdateFinishDate,
        task.dataDate,
        relationship?.predecessorId ?? null,
        relationship?.type ?? null,
        relationship?.lag ?? null,
        relationship?.freeFloat ?? null,
        task.legend,
        task.wbs1,
        task.wbs2,
        task.wbs3,
        `Tooltip for ${task.id}`
    ];
}

function getAlternateRelationshipType(index: number): string {
    const types = ["PR_SS", "PR_FF", "PR_SF"];
    return types[index % types.length];
}

function selectMinimumFloatRelationships(
    relationships: Relationship[],
    tasksById: ReadonlyMap<string, ScheduleTaskLike>
): StressRelationship[] {
    const relationshipsBySuccessor = new Map<string, StressRelationship[]>();

    for (const relationship of relationships) {
        if (!tasksById.has(relationship.predecessorId) || !tasksById.has(relationship.successorId)) {
            continue;
        }

        const stressRelationship: StressRelationship = {
            predecessorId: relationship.predecessorId,
            successorId: relationship.successorId,
            type: relationship.type,
            lag: relationship.lag,
            relationshipFloat: relationship.freeFloat
        };
        if (!relationshipsBySuccessor.has(stressRelationship.successorId)) {
            relationshipsBySuccessor.set(stressRelationship.successorId, []);
        }
        relationshipsBySuccessor.get(stressRelationship.successorId)!.push(stressRelationship);
    }

    const drivingRelationships: StressRelationship[] = [];
    for (const successorRelationships of relationshipsBySuccessor.values()) {
        markMinimumFloatDrivingRelationships(successorRelationships, TOLERANCE_DAYS);
        drivingRelationships.push(...successorRelationships.filter(relationship => relationship.isDriving));
    }

    return drivingRelationships;
}

function buildWideTiedPathGraph(layerCount: number, layerWidth: number): {
    tasksById: Map<string, ScheduleTaskLike>;
    taskOrder: string[];
    relationships: ScheduleRelationshipLike[];
} {
    const tasks: ScheduleTaskLike[] = [
        { internalId: "R", startDate: atDay(0), finishDate: atDay(1) }
    ];
    const taskOrder = ["R"];
    const relationships: ScheduleRelationshipLike[] = [];
    let previousLayerIds = ["R"];

    for (let layerIndex = 0; layerIndex < layerCount; layerIndex++) {
        const currentLayerIds: string[] = [];
        for (let widthIndex = 0; widthIndex < layerWidth; widthIndex++) {
            const taskId = `L${layerIndex}_${widthIndex}`;
            tasks.push({
                internalId: taskId,
                startDate: atDay(layerIndex + 1),
                finishDate: atDay(layerIndex + 2)
            });
            taskOrder.push(taskId);
            currentLayerIds.push(taskId);
        }

        for (const predecessorId of previousLayerIds) {
            for (const successorId of currentLayerIds) {
                relationships.push({ predecessorId, successorId, type: "FS", lag: 0 });
            }
        }

        previousLayerIds = currentLayerIds;
    }

    tasks.push({
        internalId: "Z",
        startDate: atDay(layerCount + 1),
        finishDate: atDay(layerCount + 2)
    });
    taskOrder.push("Z");
    for (const predecessorId of previousLayerIds) {
        relationships.push({ predecessorId, successorId: "Z", type: "FS", lag: 0 });
    }

    return {
        tasksById: new Map(tasks.map(task => [task.internalId, task])),
        taskOrder,
        relationships
    };
}

function buildExportTask(id: string, name: string, type: string, duration: number): Task {
    const startDate = atDay(0);
    const finishDate = atDay(duration);
    return {
        id,
        internalId: id,
        name,
        type,
        duration,
        userProvidedTotalFloat: 0,
        taskFreeFloat: 0,
        predecessorIds: [],
        relationshipTypes: {},
        relationshipLags: {},
        successors: [],
        predecessors: [],
        earlyStart: 0,
        earlyFinish: duration,
        lateStart: 0,
        lateFinish: duration,
        totalFloat: 0,
        isCritical: true,
        isCriticalByFloat: true,
        isCriticalByRel: true,
        startDate,
        finishDate,
        manualStartDate: startDate,
        manualFinishDate: finishDate,
        baselineStartDate: null,
        baselineFinishDate: null,
        previousUpdateStartDate: null,
        previousUpdateFinishDate: null,
        wbsLevels: ["Stress", "Export"]
    };
}

function buildDataView(columns: ColumnDef[], rows: any[][]): DataView {
    const dataViewColumns = columns.map((column, index) => ({
        displayName: column.displayName,
        queryName: column.queryName,
        roles: column.roles,
        type: column.type || {},
        index
    }));

    return {
        metadata: {
            columns: dataViewColumns
        },
        table: {
            columns: dataViewColumns,
            rows
        }
    } as any;
}

function createMockSettings(): any {
    return {
        criticalPath: {
            calculationMode: { value: { value: "longestPath" } }
        },
        legend: {
            sortOrder: { value: { value: "none" } }
        },
        wbsGrouping: {
            expandCollapseAll: { value: true }
        }
    };
}

function createMockHost(): powerbi.extensibility.visual.IVisualHost {
    return {
        createSelectionIdBuilder: () => ({
            withTable: () => ({
                createSelectionId: () => ({ getKey: () => "stress-selection" } as any)
            }),
            withCategory: () => ({ createSelectionId: () => ({} as any) }),
            withMeasure: () => ({ createSelectionId: () => ({} as any) }),
            withMatrixNode: () => ({ createSelectionId: () => ({} as any) }),
            withSeries: () => ({ createSelectionId: () => ({} as any) }),
            createSelectionId: () => ({} as any)
        } as any),
        colorPalette: {
            getColor: (_value: string) => ({ value: "#cccccc" })
        } as any,
        createSelectionManager: () => ({} as any),
        hostCapabilities: {} as any,
        locale: "en-US",
        allowInteractions: true,
        applyJsonFilter: () => { },
        persistProperties: () => { },
        tooltipService: {} as any,
        telemetry: {} as any,
        authenticationService: {} as any,
        storageService: {} as any,
        eventService: {} as any,
        displayWarningIcon: () => { },
        downloadService: {} as any,
        licenseManager: {} as any,
        storageV2Service: {} as any,
        switchFocusModeState: () => { },
        hostEnv: {} as any,
        drill: () => { },
        launchUrl: () => { },
        fetchMoreData: () => false,
        refreshHostData: () => { },
        createLocalizationManager: () => ({} as any),
        webAccessService: {} as any,
        acquireAADTokenService: {} as any,
        subSelectionService: {} as any,
        openModalDialog: () => ({} as any)
    } as any;
}

function atDay(dayOffset: number): Date {
    return new Date(Date.UTC(2026, 0, 1 + dayOffset));
}

function daysBetween(startDate: Date, finishDate: Date): number {
    return (finishDate.getTime() - startDate.getTime()) / 86400000;
}
