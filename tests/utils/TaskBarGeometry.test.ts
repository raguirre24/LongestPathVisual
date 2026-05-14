import { describe, expect, it } from "vitest";

import type { Task } from "../../src/data/Interfaces";
import { getCurrentTaskBarGeometry } from "../../src/utils/TaskBarGeometry";

function utcDate(day: number): Date {
    return new Date(Date.UTC(2026, 4, day));
}

function utcDateParts(year: number, month: number, day: number): Date {
    return new Date(Date.UTC(year, month - 1, day));
}

function task(overrides: Partial<Task> = {}): Task {
    return {
        id: overrides.id ?? "A1000",
        internalId: overrides.internalId ?? "A1000",
        name: overrides.name ?? "Task",
        type: overrides.type ?? "TT_Task",
        duration: overrides.duration ?? 5,
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

describe("TaskBarGeometry", () => {
    it("preserves Start/Finish override geometry in the default mode", () => {
        const geometry = getCurrentTaskBarGeometry(task(), "startFinishOverride", utcDate(5));

        expect(geometry.segments.map(segment => segment.kind)).toEqual(["current"]);
        expect(geometry.extentStart?.toISOString()).toBe("2026-05-01T00:00:00.000Z");
        expect(geometry.extentFinish?.toISOString()).toBe("2026-05-08T00:00:00.000Z");
        expect(geometry.labelStartDate?.toISOString()).toBe("2026-05-01T00:00:00.000Z");
        expect(geometry.labelFinishDate?.toISOString()).toBe("2026-05-08T00:00:00.000Z");
    });

    it("creates a P6-style started segment, gap, and scheduled segment in hybrid mode", () => {
        const geometry = getCurrentTaskBarGeometry(task(), "hybridActualEarly", utcDate(5));

        expect(geometry.hasSplit).toBe(true);
        expect(geometry.segments.map(segment => segment.kind)).toEqual(["started", "scheduled"]);
        expect(geometry.segments[0].start.toISOString()).toBe("2026-05-01T00:00:00.000Z");
        expect(geometry.segments[0].finish.toISOString()).toBe("2026-05-05T00:00:00.000Z");
        expect(geometry.segments[1].start.toISOString()).toBe("2026-05-10T00:00:00.000Z");
        expect(geometry.segments[1].finish.toISOString()).toBe("2026-05-15T00:00:00.000Z");
        expect(geometry.extentStart?.toISOString()).toBe("2026-05-01T00:00:00.000Z");
        expect(geometry.extentFinish?.toISOString()).toBe("2026-05-15T00:00:00.000Z");
        expect(geometry.labelStartDate?.toISOString()).toBe("2026-05-01T00:00:00.000Z");
        expect(geometry.labelFinishDate?.toISOString()).toBe("2026-05-15T00:00:00.000Z");
        expect(geometry.sortDate?.toISOString()).toBe("2026-05-10T00:00:00.000Z");
    });

    it("keeps the started segment when the data date matches early start in hybrid mode", () => {
        const earlyStart = utcDateParts(2026, 5, 1);
        const geometry = getCurrentTaskBarGeometry(
            task({
                startDate: earlyStart,
                finishDate: utcDateParts(2026, 7, 23),
                manualStartDate: utcDateParts(2026, 3, 23),
                manualFinishDate: utcDateParts(2026, 7, 23)
            }),
            "hybridActualEarly",
            earlyStart
        );

        expect(geometry.hasSplit).toBe(true);
        expect(geometry.segments.map(segment => segment.kind)).toEqual(["started", "scheduled"]);
        expect(geometry.segments[0].start.toISOString()).toBe("2026-03-23T00:00:00.000Z");
        expect(geometry.segments[0].finish.toISOString()).toBe("2026-05-01T00:00:00.000Z");
        expect(geometry.segments[1].start.toISOString()).toBe("2026-05-01T00:00:00.000Z");
        expect(geometry.segments[1].finish.toISOString()).toBe("2026-07-23T00:00:00.000Z");
        expect(geometry.extentStart?.toISOString()).toBe("2026-03-23T00:00:00.000Z");
        expect(geometry.extentFinish?.toISOString()).toBe("2026-07-23T00:00:00.000Z");
        expect(geometry.labelStartDate?.toISOString()).toBe("2026-03-23T00:00:00.000Z");
        expect(geometry.labelFinishDate?.toISOString()).toBe("2026-07-23T00:00:00.000Z");
        expect(geometry.sortDate?.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    });

    it("falls back to the scheduled segment when no valid started gap can be drawn", () => {
        const geometry = getCurrentTaskBarGeometry(task({ manualStartDate: null }), "hybridActualEarly", utcDate(5));

        expect(geometry.hasSplit).toBe(false);
        expect(geometry.segments.map(segment => segment.kind)).toEqual(["scheduled"]);
        expect(geometry.extentStart?.toISOString()).toBe("2026-05-10T00:00:00.000Z");
        expect(geometry.extentFinish?.toISOString()).toBe("2026-05-15T00:00:00.000Z");
        expect(geometry.labelStartDate?.toISOString()).toBe("2026-05-10T00:00:00.000Z");
        expect(geometry.labelFinishDate?.toISOString()).toBe("2026-05-15T00:00:00.000Z");
    });

    it("plots hybrid milestones on their early date", () => {
        const startMilestone = getCurrentTaskBarGeometry(
            task({ type: "TT_Mile", manualStartDate: utcDate(1), startDate: utcDate(10), finishDate: utcDate(10) }),
            "hybridActualEarly",
            utcDate(5)
        );
        const finishMilestone = getCurrentTaskBarGeometry(
            task({ type: "TT_FinMile", manualStartDate: utcDate(1), startDate: utcDate(10), finishDate: utcDate(15) }),
            "hybridActualEarly",
            utcDate(5)
        );

        expect(startMilestone.milestoneDate?.toISOString()).toBe("2026-05-10T00:00:00.000Z");
        expect(finishMilestone.milestoneDate?.toISOString()).toBe("2026-05-15T00:00:00.000Z");
    });
});
