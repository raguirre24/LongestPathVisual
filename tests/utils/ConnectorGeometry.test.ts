import { describe, expect, it } from "vitest";

import type { Relationship, Task } from "../../src/data/Interfaces";
import { getConnectorRenderGeometry } from "../../src/utils/ConnectorGeometry";

function utcDate(day: number): Date {
    return new Date(Date.UTC(2026, 4, day));
}

function xScale(date: Date): number {
    return date.getUTCDate() * 10;
}

function task(id: string, overrides: Partial<Task> = {}): Task {
    return {
        id,
        internalId: id,
        name: id,
        type: "TT_Task",
        duration: 5,
        predecessorIds: [],
        relationshipTypes: {},
        relationshipLags: {},
        successors: [],
        predecessors: [],
        earlyStart: 0,
        earlyFinish: 0,
        lateStart: 0,
        lateFinish: 0,
        totalFloat: 0,
        isCritical: false,
        startDate: utcDate(10),
        finishDate: utcDate(15),
        manualStartDate: utcDate(1),
        manualFinishDate: utcDate(8),
        baselineStartDate: null,
        baselineFinishDate: null,
        previousUpdateStartDate: null,
        previousUpdateFinishDate: null,
        ...overrides
    };
}

function relationship(type: string): Relationship {
    return {
        predecessorId: "P",
        successorId: "S",
        type,
        lag: null,
        freeFloat: null,
        isCritical: false
    };
}

function geometry(
    type: string,
    predecessor: Task,
    successor: Task,
    mode: "startFinishOverride" | "hybridActualEarly" = "startFinishOverride",
    predecessorY = 10,
    successorY = 50,
    treatZeroDurationAsMilestone = false
) {
    return getConnectorRenderGeometry({
        relationship: relationship(type),
        predecessor,
        successor,
        predecessorY,
        successorY,
        xScale,
        currentBarDateMode: mode,
        dataDate: utcDate(5),
        treatZeroDurationAsMilestone,
        taskHeight: 20,
        milestoneSize: 10,
        elbowOffset: 15,
        arrowHeadSize: 6,
        chartWidth: 500
    });
}

describe("ConnectorGeometry", () => {
    it("anchors Start/Finish mode connectors to the visible override segment", () => {
        const result = geometry(
            "FS",
            task("P", { manualStartDate: utcDate(1), manualFinishDate: utcDate(8), startDate: utcDate(10), finishDate: utcDate(15) }),
            task("S", { manualStartDate: utcDate(20), manualFinishDate: utcDate(24), startDate: utcDate(30), finishDate: utcDate(35) })
        );

        expect(result).not.toBeNull();
        expect(result?.sourceAnchor.date.toISOString()).toBe("2026-05-08T00:00:00.000Z");
        expect(result?.targetAnchor.date.toISOString()).toBe("2026-05-20T00:00:00.000Z");
        expect(result?.startX).toBe(80);
        expect(result?.endX).toBe(197);
    });

    it("anchors Hybrid mode connectors to the scheduled segment instead of the started segment", () => {
        const result = geometry(
            "FS",
            task("P", { manualStartDate: utcDate(1), manualFinishDate: utcDate(8), startDate: utcDate(10), finishDate: utcDate(15) }),
            task("S", { manualStartDate: utcDate(1), manualFinishDate: utcDate(8), startDate: utcDate(20), finishDate: utcDate(24) }),
            "hybridActualEarly"
        );

        expect(result).not.toBeNull();
        expect(result?.sourceAnchor.date.toISOString()).toBe("2026-05-15T00:00:00.000Z");
        expect(result?.targetAnchor.date.toISOString()).toBe("2026-05-20T00:00:00.000Z");
        expect(result?.startX).toBe(150);
        expect(result?.endX).toBe(197);
    });

    it("uses the correct source and target sides for all P6 relationship types", () => {
        const predecessor = task("P", { manualStartDate: utcDate(5), manualFinishDate: utcDate(10) });
        const successor = task("S", { manualStartDate: utcDate(20), manualFinishDate: utcDate(25) });

        expect(geometry("FS", predecessor, successor)).toMatchObject({
            sourceAnchor: { side: "finish" },
            targetAnchor: { side: "start" },
            arrowDirectionX: 1
        });
        expect(geometry("SS", predecessor, successor)).toMatchObject({
            sourceAnchor: { side: "start" },
            targetAnchor: { side: "start" },
            arrowDirectionX: 1
        });
        expect(geometry("FF", predecessor, successor)).toMatchObject({
            sourceAnchor: { side: "finish" },
            targetAnchor: { side: "finish" },
            arrowDirectionX: -1
        });
        expect(geometry("SF", predecessor, successor)).toMatchObject({
            sourceAnchor: { side: "start" },
            targetAnchor: { side: "finish" },
            arrowDirectionX: -1
        });
    });

    it("wraps same-row overlapping links through an outside lane", () => {
        const result = geometry(
            "FS",
            task("P", { manualStartDate: utcDate(10), manualFinishDate: utcDate(30) }),
            task("S", { manualStartDate: utcDate(20), manualFinishDate: utcDate(40) }),
            "startFinishOverride",
            50,
            50
        );

        expect(result).not.toBeNull();
        expect(result!.points.length).toBeGreaterThan(2);
        expect(result!.points.some(point => point.y !== 50)).toBe(true);
        expect(result!.arrowDirectionX).toBe(1);
    });

    it("routes overlapping cross-row links around the source and target bar sides", () => {
        const result = geometry(
            "FS",
            task("P", { manualStartDate: utcDate(10), manualFinishDate: utcDate(30) }),
            task("S", { manualStartDate: utcDate(20), manualFinishDate: utcDate(40) })
        );

        expect(result).not.toBeNull();
        expect(result!.points.map(point => ({ x: point.x, y: point.y }))).toEqual([
            { x: 300, y: 10 },
            { x: 315, y: 10 },
            { x: 315, y: 30 },
            { x: 182, y: 30 },
            { x: 182, y: 50 },
            { x: 197, y: 50 }
        ]);
    });

    it("adds milestone clearance for task-to-milestone and milestone-to-task endpoints", () => {
        const milestoneSuccessor = geometry(
            "FF",
            task("P", { manualStartDate: utcDate(1), manualFinishDate: utcDate(8) }),
            task("S", { type: "TT_FinMile", manualStartDate: utcDate(20), manualFinishDate: utcDate(20), startDate: utcDate(20), finishDate: utcDate(20) })
        );
        const milestonePredecessor = geometry(
            "FS",
            task("P", { type: "TT_Mile", manualStartDate: utcDate(5), manualFinishDate: utcDate(5), startDate: utcDate(5), finishDate: utcDate(5) }),
            task("S", { manualStartDate: utcDate(20), manualFinishDate: utcDate(24) })
        );

        expect(milestoneSuccessor?.targetAnchor.isMilestone).toBe(true);
        expect(milestoneSuccessor?.targetAnchor.baseX).toBe(200);
        expect(milestoneSuccessor?.endX).toBe(208);
        expect(milestonePredecessor?.sourceAnchor.isMilestone).toBe(true);
        expect(milestonePredecessor?.sourceAnchor.baseX).toBe(50);
        expect(milestonePredecessor?.startX).toBe(55);
    });

    it("uses milestone anchors for zero-duration visualiser tasks", () => {
        const result = geometry(
            "FS",
            task("P", { duration: 0, manualStartDate: null, manualFinishDate: null, startDate: utcDate(5), finishDate: utcDate(5) }),
            task("S", { manualStartDate: utcDate(20), manualFinishDate: utcDate(24) }),
            "startFinishOverride",
            10,
            50,
            true
        );

        expect(result?.sourceAnchor.isMilestone).toBe(true);
        expect(result?.sourceAnchor.baseX).toBe(50);
        expect(result?.startX).toBe(55);
    });
});
