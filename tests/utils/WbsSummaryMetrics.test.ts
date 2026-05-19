import { describe, expect, it } from "vitest";

import type { Task } from "../../src/data/Interfaces";
import { getCurrentTaskBarGeometry } from "../../src/utils/TaskBarGeometry";
import { getCriticalFormattingExtentFromTaskBarGeometry } from "../../src/utils/WbsSummaryMetrics";

function utcDate(day: number): Date {
    return new Date(Date.UTC(2026, 4, day));
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

describe("WbsSummaryMetrics", () => {
    it("excludes hybrid started segments from WBS critical summary extents", () => {
        const geometry = getCurrentTaskBarGeometry(task({ isCritical: true }), "hybridActualEarly", utcDate(5));
        const extent = getCriticalFormattingExtentFromTaskBarGeometry(geometry);

        expect(geometry.segments.map(segment => segment.kind)).toEqual(["started", "scheduled"]);
        expect(extent.start?.toISOString()).toBe("2026-05-10T00:00:00.000Z");
        expect(extent.finish?.toISOString()).toBe("2026-05-15T00:00:00.000Z");
    });

    it("uses the same scheduled-only extent for WBS near-critical summaries", () => {
        const geometry = getCurrentTaskBarGeometry(task({ isNearCritical: true }), "hybridActualEarly", utcDate(5));
        const extent = getCriticalFormattingExtentFromTaskBarGeometry(geometry);

        expect(geometry.segments.map(segment => segment.kind)).toEqual(["started", "scheduled"]);
        expect(extent.start?.toISOString()).toBe("2026-05-10T00:00:00.000Z");
        expect(extent.finish?.toISOString()).toBe("2026-05-15T00:00:00.000Z");
    });

    it("keeps the full current segment in default current-bar mode", () => {
        const geometry = getCurrentTaskBarGeometry(task({ isCritical: true }), "startFinishOverride", utcDate(5));
        const extent = getCriticalFormattingExtentFromTaskBarGeometry(geometry);

        expect(geometry.segments.map(segment => segment.kind)).toEqual(["current"]);
        expect(extent.start?.toISOString()).toBe("2026-05-01T00:00:00.000Z");
        expect(extent.finish?.toISOString()).toBe("2026-05-08T00:00:00.000Z");
    });
});
