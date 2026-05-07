import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

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
import { normalizeRelationshipType } from "../../src/utils/RelationshipLogic";

const CSV_PATH = resolve(process.cwd(), "06_XER_PREDECESSOR.csv");
const OPEN_STATUS_CODES = new Set(["TK_NotStart", "TK_Active"]);
const LONGEST_PATH_TASK_TYPES = new Set(["TT_Task", "TT_Mile", "TT_FinMile"]);
const TOLERANCE_DAYS = 1e-9;
const EXPECTED_SINK_TASK_ID = "2604-EBA_PAA_8.0 (draft).xer.1617823";

type CsvRow = Record<string, string>;

type CsvTask = ScheduleTaskLike & {
    internalId: string;
    startDate: Date;
    finishDate: Date;
    taskType: string;
};

type CsvRelationship = ScheduleRelationshipLike & {
    predecessorId: string;
    successorId: string;
    type: string;
    lag: number | null;
    relationshipFloat: number | null;
    isDriving?: boolean;
};

type CsvModel = {
    rawRows: CsvRow[];
    openRows: CsvRow[];
    filteredRows: CsvRow[];
    excludedOpenRows: CsvRow[];
    tasksById: Map<string, CsvTask>;
    taskOrder: string[];
    relationships: CsvRelationship[];
    drivingRelationships: CsvRelationship[];
};

const describeIfCsvExists = existsSync(CSV_PATH) ? describe : describe.skip;

describeIfCsvExists("06_XER_PREDECESSOR.csv integration", () => {
    it("derives the expected open task/milestone longest path from relationship free float", () => {
        const model = buildCsvModel(readFileSync(CSV_PATH, "utf8"));
        const topoOrder = getDrivingTopologicalOrder(
            model.tasksById,
            model.taskOrder,
            model.drivingRelationships
        );
        expect(topoOrder).not.toBeNull();
        const graph = buildDrivingEventGraph(
            model.tasksById,
            topoOrder!,
            model.drivingRelationships
        );
        const sourceNodeIds = graph.rootStartNodeIds
            .map(getTaskIdFromEventNodeId)
            .map(taskId => getTaskEventNodeId(taskId, "start"))
            .filter(nodeId => graph.nodeIndex.has(nodeId));
        const terminalTaskIds = graph.terminalFinishNodeIds.map(getTaskIdFromEventNodeId);
        const tiedSinkTaskIds = getTiedLatestFinishTaskIds(
            model.tasksById,
            terminalTaskIds,
            TOLERANCE_DAYS
        );
        const sinkNodeIds = tiedSinkTaskIds.map(taskId => getTaskEventNodeId(taskId, "finish"));
        const calculation = calculateLongestDrivingPaths(graph, sourceNodeIds, TOLERANCE_DAYS);
        const bestSinkNodeIds = selectBestSinkNodeIds(
            calculation.distances,
            sinkNodeIds,
            TOLERANCE_DAYS
        );
        const expanded = expandBestDrivingPaths(
            graph,
            calculation.bestIncoming,
            calculation.distances,
            bestSinkNodeIds,
            { maxPaths: 20, maxExpansions: 20000 }
        );
        const expectedPath = expanded.paths.find(path =>
            path.taskIds[path.taskIds.length - 1] === EXPECTED_SINK_TASK_ID
        );

        expect(model.rawRows).toHaveLength(16148);
        expect(model.openRows).toHaveLength(4247);
        expect(model.filteredRows).toHaveLength(3884);
        expect(model.excludedOpenRows).toHaveLength(363);
        expect(model.relationships).toHaveLength(3884);
        expect(model.drivingRelationships).toHaveLength(1779);
        expect(model.tasksById.size).toBe(2438);
        expect(countCycleNodes(model.relationships)).toBe(0);
        expect(countCycleNodes(model.drivingRelationships)).toBe(0);
        expect(tiedSinkTaskIds).toEqual([EXPECTED_SINK_TASK_ID]);
        expect(bestSinkNodeIds).toEqual([getTaskEventNodeId(EXPECTED_SINK_TASK_ID, "finish")]);
        expect(expectedPath).toBeDefined();
        expect(expectedPath!.taskIds).toHaveLength(32);
        expect(expectedPath!.spanDays).toBeCloseTo(562.375, 6);
        expect(expectedPath!.taskIds.every(taskId =>
            LONGEST_PATH_TASK_TYPES.has(model.tasksById.get(taskId)?.taskType ?? "")
        )).toBe(true);
        expect(expectedPath!.taskIds.some(taskId =>
            ["TT_LOE", "TT_WBS"].includes(model.tasksById.get(taskId)?.taskType ?? "")
        )).toBe(false);
    });
});

function buildCsvModel(csvText: string): CsvModel {
    const rawRows = parseCsvRecords(csvText);
    const openRows = rawRows.filter(row => OPEN_STATUS_CODES.has(row.status_code));
    const filteredRows = openRows.filter(row =>
        LONGEST_PATH_TASK_TYPES.has(row.task_type) &&
        LONGEST_PATH_TASK_TYPES.has(row.predecessor_task_type)
    );
    const excludedOpenRows = openRows.filter(row => !filteredRows.includes(row));
    const tasksById = new Map<string, CsvTask>();
    const taskOrder: string[] = [];
    const relationshipsBySuccessor = new Map<string, CsvRelationship[]>();
    const relationships: CsvRelationship[] = [];

    for (const row of filteredRows) {
        const successorId = row.task_id_key.trim();
        const predecessorId = row.pred_task_id_key.trim();
        if (!successorId || !predecessorId) {
            continue;
        }

        upsertTask(
            tasksById,
            taskOrder,
            successorId,
            row.task_type,
            parseCsvDate(row.Start),
            parseCsvDate(row.Finish)
        );
        upsertTask(
            tasksById,
            taskOrder,
            predecessorId,
            row.predecessor_task_type,
            parseCsvDate(row.predecessor_start),
            parseCsvDate(row.predecessor_finish)
        );

        const relationship: CsvRelationship = {
            predecessorId,
            successorId,
            type: normalizeRelationshipType(row.pred_type),
            lag: parseFiniteNumber(row.lag),
            relationshipFloat: parseFiniteNumber(row.free_float)
        };

        relationships.push(relationship);
        if (!relationshipsBySuccessor.has(successorId)) {
            relationshipsBySuccessor.set(successorId, []);
        }
        relationshipsBySuccessor.get(successorId)!.push(relationship);
    }

    const drivingRelationships: CsvRelationship[] = [];
    for (const successorRelationships of relationshipsBySuccessor.values()) {
        let minimumFloat = Infinity;
        for (const relationship of successorRelationships) {
            const relationshipFloat = relationship.relationshipFloat;
            if (
                typeof relationshipFloat === "number" &&
                Number.isFinite(relationshipFloat) &&
                relationshipFloat < minimumFloat
            ) {
                minimumFloat = relationshipFloat;
            }
        }

        for (const relationship of successorRelationships) {
            const relationshipFloat = relationship.relationshipFloat;
            relationship.isDriving = typeof relationshipFloat === "number" &&
                Number.isFinite(relationshipFloat) &&
                Math.abs(relationshipFloat - minimumFloat) <= TOLERANCE_DAYS;

            if (relationship.isDriving) {
                drivingRelationships.push(relationship);
            }
        }
    }

    return {
        rawRows,
        openRows,
        filteredRows,
        excludedOpenRows,
        tasksById,
        taskOrder,
        relationships,
        drivingRelationships
    };
}

function parseCsvRecords(csvText: string): CsvRow[] {
    const rows = parseCsvRows(csvText);
    const [header, ...dataRows] = rows;

    return dataRows.map(row => Object.fromEntries(
        header.map((columnName, index) => [columnName, row[index] ?? ""])
    ));
}

function parseCsvRows(csvText: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let value = "";
    let inQuotes = false;

    for (let index = 0; index < csvText.length; index++) {
        const char = csvText[index];

        if (inQuotes) {
            if (char === "\"") {
                if (csvText[index + 1] === "\"") {
                    value += "\"";
                    index++;
                } else {
                    inQuotes = false;
                }
            } else {
                value += char;
            }
            continue;
        }

        if (char === "\"") {
            inQuotes = true;
        } else if (char === ",") {
            row.push(value);
            value = "";
        } else if (char === "\n") {
            row.push(value);
            rows.push(row);
            row = [];
            value = "";
        } else if (char !== "\r") {
            value += char;
        }
    }

    if (value.length > 0 || row.length > 0) {
        row.push(value);
        rows.push(row);
    }

    return rows.filter(parsedRow => parsedRow.length > 1 || parsedRow[0] !== "");
}

function upsertTask(
    tasksById: Map<string, CsvTask>,
    taskOrder: string[],
    taskId: string,
    taskType: string,
    startDate: Date | null,
    finishDate: Date | null
): void {
    if (
        !taskId ||
        !LONGEST_PATH_TASK_TYPES.has(taskType) ||
        !startDate ||
        !finishDate ||
        finishDate.getTime() < startDate.getTime()
    ) {
        return;
    }

    if (!tasksById.has(taskId)) {
        taskOrder.push(taskId);
    }

    tasksById.set(taskId, {
        internalId: taskId,
        taskType,
        startDate,
        finishDate
    });
}

function parseCsvDate(value: string): Date | null {
    const trimmed = value.trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(trimmed);
    if (!match) {
        return null;
    }

    const [, year, month, day, hour = "0", minute = "0", second = "0"] = match;
    const date = new Date(Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second)
    ));

    return Number.isFinite(date.getTime()) ? date : null;
}

function parseFiniteNumber(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    const numberValue = Number(trimmed);
    return Number.isFinite(numberValue) ? numberValue : null;
}

function countCycleNodes(relationships: CsvRelationship[]): number {
    const nodes = new Set<string>();
    const outgoing = new Map<string, string[]>();
    const indegree = new Map<string, number>();

    for (const relationship of relationships) {
        nodes.add(relationship.predecessorId);
        nodes.add(relationship.successorId);
        if (!outgoing.has(relationship.predecessorId)) {
            outgoing.set(relationship.predecessorId, []);
        }
        outgoing.get(relationship.predecessorId)!.push(relationship.successorId);
        indegree.set(relationship.successorId, (indegree.get(relationship.successorId) ?? 0) + 1);
        if (!indegree.has(relationship.predecessorId)) {
            indegree.set(relationship.predecessorId, 0);
        }
    }

    const queue = Array.from(nodes).filter(node => (indegree.get(node) ?? 0) === 0);
    let visitedCount = 0;

    for (let index = 0; index < queue.length; index++) {
        const node = queue[index];
        visitedCount++;

        for (const successor of outgoing.get(node) ?? []) {
            const nextIndegree = (indegree.get(successor) ?? 0) - 1;
            indegree.set(successor, nextIndegree);
            if (nextIndegree === 0) {
                queue.push(successor);
            }
        }
    }

    return nodes.size - visitedCount;
}

function getDrivingTopologicalOrder(
    tasksById: ReadonlyMap<string, CsvTask>,
    taskOrder: string[],
    relationships: CsvRelationship[]
): string[] | null {
    const nodeIds = new Set(taskOrder);
    const outgoing = new Map<string, CsvRelationship[]>();
    const indegree = new Map<string, number>();

    for (const taskId of nodeIds) {
        indegree.set(taskId, 0);
    }

    for (const relationship of relationships) {
        if (!nodeIds.has(relationship.predecessorId) || !nodeIds.has(relationship.successorId)) {
            continue;
        }

        if (!outgoing.has(relationship.predecessorId)) {
            outgoing.set(relationship.predecessorId, []);
        }
        outgoing.get(relationship.predecessorId)!.push(relationship);
        indegree.set(relationship.successorId, (indegree.get(relationship.successorId) ?? 0) + 1);
    }

    const queue = Array.from(nodeIds)
        .filter(taskId => (indegree.get(taskId) ?? 0) === 0)
        .sort((a, b) => compareTasksForTopo(tasksById, a, b));
    const order: string[] = [];

    while (queue.length > 0) {
        const currentId = queue.shift()!;
        order.push(currentId);

        const relationshipsFromCurrent = [...(outgoing.get(currentId) ?? [])].sort((a, b) =>
            compareTasksForTopo(tasksById, a.successorId, b.successorId)
        );

        for (const relationship of relationshipsFromCurrent) {
            const nextIndegree = (indegree.get(relationship.successorId) ?? 0) - 1;
            indegree.set(relationship.successorId, nextIndegree);
            if (nextIndegree === 0) {
                insertIntoSortedTopoQueue(queue, relationship.successorId, tasksById);
            }
        }
    }

    return order.length === nodeIds.size ? order : null;
}

function insertIntoSortedTopoQueue(
    queue: string[],
    taskId: string,
    tasksById: ReadonlyMap<string, CsvTask>
): void {
    let low = 0;
    let high = queue.length;

    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (compareTasksForTopo(tasksById, taskId, queue[mid]) < 0) {
            high = mid;
        } else {
            low = mid + 1;
        }
    }

    queue.splice(low, 0, taskId);
}

function compareTasksForTopo(
    tasksById: ReadonlyMap<string, CsvTask>,
    aId: string,
    bId: string
): number {
    const aTask = tasksById.get(aId);
    const bTask = tasksById.get(bId);
    const aStart = aTask?.startDate.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bStart = bTask?.startDate.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (aStart !== bStart) {
        return aStart - bStart;
    }

    const aFinish = aTask?.finishDate.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bFinish = bTask?.finishDate.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (aFinish !== bFinish) {
        return aFinish - bFinish;
    }

    return aId.localeCompare(bId);
}
