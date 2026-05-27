import { describe, expect, it } from "vitest";

import type { Task } from "../../src/data/Interfaces";
import { getCurrentTaskBarGeometry } from "../../src/utils/TaskBarGeometry";
import {
    createWbsSummaryMilestoneMarker,
    getCriticalFormattingExtentFromTaskBarGeometry,
    getTaskBarGeometryExtent,
    sortWbsSummaryMilestoneMarkers
} from "../../src/utils/WbsSummaryMetrics";

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

    it("supports WBS summary ranges from finish-only visualiser milestones", () => {
        const first = getTaskBarGeometryExtent(getCurrentTaskBarGeometry(
            task({ duration: 0, startDate: null, finishDate: utcDate(11), manualStartDate: null, manualFinishDate: null }),
            "startFinishOverride",
            utcDate(5),
            true
        ));
        const second = getTaskBarGeometryExtent(getCurrentTaskBarGeometry(
            task({ duration: 0, startDate: null, finishDate: utcDate(18), manualStartDate: null, manualFinishDate: null }),
            "startFinishOverride",
            utcDate(5),
            true
        ));

        const summaryStart = [first.start, second.start]
            .filter((date): date is Date => date instanceof Date)
            .reduce((earliest, date) => date < earliest ? date : earliest);
        const summaryFinish = [first.finish, second.finish]
            .filter((date): date is Date => date instanceof Date)
            .reduce((latest, date) => date > latest ? date : latest);

        expect(summaryStart.toISOString()).toBe("2026-05-11T00:00:00.000Z");
        expect(summaryFinish.toISOString()).toBe("2026-05-18T00:00:00.000Z");
    });

    it("creates and sorts WBS summary milestone markers by date, name, and identity", () => {
        const first = createWbsSummaryMilestoneMarker(
            task({ internalId: "M2", name: "Beta" }),
            utcDate(12)
        );
        const second = createWbsSummaryMilestoneMarker(
            task({ internalId: "M1", name: "Alpha" }),
            utcDate(12)
        );
        const third = createWbsSummaryMilestoneMarker(
            task({ internalId: "M3", name: "Gamma" }),
            utcDate(10)
        );

        const sorted = sortWbsSummaryMilestoneMarkers([first!, second!, third!]);

        expect(createWbsSummaryMilestoneMarker(task(), new Date("invalid"))).toBeNull();
        expect(sorted.map(marker => marker.taskInternalId)).toEqual(["M3", "M1", "M2"]);
        expect(sorted.map(marker => marker.date.toISOString())).toEqual([
            "2026-05-10T00:00:00.000Z",
            "2026-05-12T00:00:00.000Z",
            "2026-05-12T00:00:00.000Z"
        ]);
    });
});
