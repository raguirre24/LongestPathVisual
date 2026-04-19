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

type TestTask = ScheduleTaskLike & {
    internalId: string;
    startDate: Date;
    finishDate: Date;
};

type TestRelationship = ScheduleRelationshipLike & {
    predecessorId: string;
    successorId: string;
    type: string;
};

const TOLERANCE_DAYS = 1e-9;

function atDay(dayOffset: number): Date {
    return new Date(Date.UTC(2025, 0, 1 + dayOffset));
}

function buildTask(internalId: string, startDay: number, finishDay: number): TestTask {
    return {
        internalId,
        startDate: atDay(startDay),
        finishDate: atDay(finishDay)
    };
}

function relationship(
    predecessorId: string,
    successorId: string,
    type: "FS" | "SS" | "FF" | "SF",
    lag?: number
): TestRelationship {
    return {
        predecessorId,
        successorId,
        type,
        lag
    };
}

function computePaths(
    tasks: TestTask[],
    relationships: TestRelationship[],
    sinkTaskIds: string[],
    sourceTaskIds?: string[],
    limits: { maxPaths: number; maxExpansions: number } = { maxPaths: 50, maxExpansions: 1000 }
) {
    const tasksById = new Map(tasks.map(task => [task.internalId, task]));
    const graph = buildDrivingEventGraph(tasksById, tasks.map(task => task.internalId), relationships);
    const sourceNodeIds = (sourceTaskIds ?? graph.rootStartNodeIds.map(getTaskIdFromEventNodeId))
        .map(taskId => getTaskEventNodeId(taskId, "start"))
        .filter(nodeId => graph.nodeIndex.has(nodeId));
    const sinkNodeIds = sinkTaskIds
        .map(taskId => getTaskEventNodeId(taskId, "finish"))
        .filter(nodeId => graph.nodeIndex.has(nodeId));
    const calculation = calculateLongestDrivingPaths(graph, sourceNodeIds, TOLERANCE_DAYS);
    const bestSinkNodeIds = selectBestSinkNodeIds(calculation.distances, sinkNodeIds, TOLERANCE_DAYS);

    return {
        graph,
        calculation,
        bestSinkNodeIds,
        expanded: expandBestDrivingPaths(
            graph,
            calculation.bestIncoming,
            calculation.distances,
            bestSinkNodeIds,
            limits
        )
    };
}

describe("DrivingPathScoring", () => {
    it("scores a simple FS chain by elapsed schedule span", () => {
        const tasks = [
            buildTask("A", 0, 5),
            buildTask("B", 5, 8)
        ];
        const result = computePaths(tasks, [relationship("A", "B", "FS")], ["B"]);

        expect(result.expanded.paths).toHaveLength(1);
        expect(result.expanded.paths[0].taskIds).toEqual(["A", "B"]);
        expect(result.expanded.paths[0].spanDays).toBe(8);
    });

    it("handles an SS overlap without summing durations", () => {
        const tasks = [
            buildTask("A", 0, 10),
            buildTask("B", 2, 6)
        ];
        const result = computePaths(tasks, [relationship("A", "B", "SS")], ["B"]);

        expect(result.expanded.paths).toHaveLength(1);
        expect(result.expanded.paths[0].taskIds).toEqual(["A", "B"]);
        expect(result.expanded.paths[0].spanDays).toBe(6);
    });

    it("handles an FF chain using finish events", () => {
        const tasks = [
            buildTask("A", 0, 10),
            buildTask("B", 7, 10)
        ];
        const result = computePaths(tasks, [relationship("A", "B", "FF")], ["B"]);

        expect(result.expanded.paths).toHaveLength(1);
        expect(result.expanded.paths[0].taskIds).toEqual(["A", "B"]);
        expect(result.expanded.paths[0].spanDays).toBe(10);
    });

    it("handles an SF chain using predecessor start and successor finish events", () => {
        const tasks = [
            buildTask("A", 0, 10),
            buildTask("B", 3, 4)
        ];
        const result = computePaths(tasks, [relationship("A", "B", "SF")], ["B"]);

        expect(result.expanded.paths).toHaveLength(1);
        expect(result.expanded.paths[0].taskIds).toEqual(["A", "B"]);
        expect(result.expanded.paths[0].spanDays).toBe(4);
    });

    it("captures positive lag as part of the elapsed span", () => {
        const tasks = [
            buildTask("A", 0, 5),
            buildTask("B", 7, 10)
        ];
        const result = computePaths(tasks, [relationship("A", "B", "FS", 2)], ["B"]);

        expect(result.expanded.paths[0].spanDays).toBe(10);
    });

    it("captures negative lag without inflating the span by duration sum", () => {
        const tasks = [
            buildTask("A", 0, 10),
            buildTask("B", 7, 12)
        ];
        const result = computePaths(tasks, [relationship("A", "B", "FS", -3)], ["B"]);

        expect(result.expanded.paths[0].spanDays).toBe(12);
    });

    it("returns two equal valid paths deterministically", () => {
        const tasks = [
            buildTask("A", 0, 5),
            buildTask("B", 0, 5),
            buildTask("C", 5, 10)
        ];
        const result = computePaths(
            tasks,
            [
                relationship("A", "C", "FS"),
                relationship("B", "C", "FS")
            ],
            ["C"]
        );

        expect(result.expanded.paths.map(path => path.taskIds)).toEqual([
            ["A", "C"],
            ["B", "C"]
        ]);
        expect(result.expanded.paths.every(path => path.spanDays === 10)).toBe(true);
    });

    it("uses elapsed schedule span when overlapping durations would otherwise be misleading", () => {
        const tasks = [
            buildTask("A", 0, 10),
            buildTask("B", 2, 13),
            buildTask("C", 13, 14)
        ];
        const result = computePaths(
            tasks,
            [
                relationship("A", "B", "SS"),
                relationship("B", "C", "FS")
            ],
            ["C"]
        );

        expect(result.expanded.paths).toHaveLength(1);
        expect(result.expanded.paths[0].taskIds).toEqual(["A", "B", "C"]);
        expect(result.expanded.paths[0].spanDays).toBe(14);
    });

    it("supports tied latest-finish terminal sinks", () => {
        const tasks = [
            buildTask("A", 0, 5),
            buildTask("B", 5, 10),
            buildTask("C", 0, 6),
            buildTask("D", 6, 10)
        ];
        const relationships = [
            relationship("A", "B", "FS"),
            relationship("C", "D", "FS")
        ];
        const tasksById = new Map(tasks.map(task => [task.internalId, task]));
        const graph = buildDrivingEventGraph(tasksById, tasks.map(task => task.internalId), relationships);
        const terminalTaskIds = graph.terminalFinishNodeIds.map(getTaskIdFromEventNodeId);
        const tiedSinkTaskIds = getTiedLatestFinishTaskIds(tasksById, terminalTaskIds, TOLERANCE_DAYS);
        const result = computePaths(tasks, relationships, tiedSinkTaskIds);

        expect(tiedSinkTaskIds).toEqual(["B", "D"]);
        expect(result.bestSinkNodeIds).toEqual([
            getTaskEventNodeId("B", "finish"),
            getTaskEventNodeId("D", "finish")
        ]);
        expect(result.expanded.paths.map(path => path.taskIds)).toEqual([
            ["A", "B"],
            ["C", "D"]
        ]);
    });

    it("truncates when the emitted path limit is reached", () => {
        const tasks = [
            buildTask("R", 0, 1),
            buildTask("A1", 1, 2),
            buildTask("A2", 1, 2),
            buildTask("A3", 1, 2),
            buildTask("B1", 2, 3),
            buildTask("B2", 2, 3),
            buildTask("B3", 2, 3),
            buildTask("C", 3, 4)
        ];
        const relationships: TestRelationship[] = [
            relationship("R", "A1", "FS"),
            relationship("R", "A2", "FS"),
            relationship("R", "A3", "FS"),
            relationship("A1", "B1", "FS"),
            relationship("A1", "B2", "FS"),
            relationship("A1", "B3", "FS"),
            relationship("A2", "B1", "FS"),
            relationship("A2", "B2", "FS"),
            relationship("A2", "B3", "FS"),
            relationship("A3", "B1", "FS"),
            relationship("A3", "B2", "FS"),
            relationship("A3", "B3", "FS"),
            relationship("B1", "C", "FS"),
            relationship("B2", "C", "FS"),
            relationship("B3", "C", "FS")
        ];
        const result = computePaths(tasks, relationships, ["C"], ["R"], { maxPaths: 3, maxExpansions: 1000 });

        expect(result.expanded.truncated).toBe(true);
        expect(result.expanded.truncatedByPathLimit).toBe(true);
        expect(result.expanded.paths).toHaveLength(3);
    });

    it("truncates when the recursive expansion limit is reached", () => {
        const tasks = [
            buildTask("R", 0, 1),
            buildTask("A1", 1, 2),
            buildTask("A2", 1, 2),
            buildTask("A3", 1, 2),
            buildTask("B1", 2, 3),
            buildTask("B2", 2, 3),
            buildTask("B3", 2, 3),
            buildTask("C", 3, 4)
        ];
        const relationships: TestRelationship[] = [
            relationship("R", "A1", "FS"),
            relationship("R", "A2", "FS"),
            relationship("R", "A3", "FS"),
            relationship("A1", "B1", "FS"),
            relationship("A1", "B2", "FS"),
            relationship("A1", "B3", "FS"),
            relationship("A2", "B1", "FS"),
            relationship("A2", "B2", "FS"),
            relationship("A2", "B3", "FS"),
            relationship("A3", "B1", "FS"),
            relationship("A3", "B2", "FS"),
            relationship("A3", "B3", "FS"),
            relationship("B1", "C", "FS"),
            relationship("B2", "C", "FS"),
            relationship("B3", "C", "FS")
        ];
        const result = computePaths(tasks, relationships, ["C"], ["R"], { maxPaths: 50, maxExpansions: 5 });

        expect(result.expanded.truncated).toBe(true);
        expect(result.expanded.truncatedByExpansionLimit).toBe(true);
        expect(result.expanded.paths.length).toBeLessThan(9);
    });
});
