import { describe, expect, it } from "vitest";

import {
    calculateDateVarianceProgressPoint,
    calculateFinishVarianceProgressPoint,
    getEffectiveProgressLineDate,
    getProgressLineBandTone,
    getProgressLineDateModeLabel,
    getProgressLinePointKinds,
    getProgressLineReferenceDateLabel,
    getProgressLineReferenceLabel
} from "../../src/utils/ProgressLine";

function utcDate(year: number, monthIndex: number, day: number): Date {
    return new Date(Date.UTC(year, monthIndex, day));
}

describe("ProgressLine", () => {
    it("bends left of the data date when the current finish is later than the reference finish", () => {
        const result = calculateFinishVarianceProgressPoint(
            utcDate(2026, 4, 10),
            utcDate(2026, 4, 25),
            utcDate(2026, 4, 20)
        );

        expect(result?.varianceDays).toBe(5);
        expect(result?.progressDate.toISOString()).toBe("2026-05-05T00:00:00.000Z");
    });

    it("bends right of the data date when the current finish is earlier than the reference finish", () => {
        const result = calculateFinishVarianceProgressPoint(
            utcDate(2026, 4, 10),
            utcDate(2026, 4, 18),
            utcDate(2026, 4, 20)
        );

        expect(result?.varianceDays).toBe(-2);
        expect(result?.progressDate.toISOString()).toBe("2026-05-12T00:00:00.000Z");
    });

    it("stays on the data date when current and reference finish dates match", () => {
        const result = calculateFinishVarianceProgressPoint(
            utcDate(2026, 4, 10),
            utcDate(2026, 4, 20),
            utcDate(2026, 4, 20)
        );

        expect(result?.varianceDays).toBe(0);
        expect(result?.progressDate.toISOString()).toBe("2026-05-10T00:00:00.000Z");
    });

    it("treats a missing row-level reference finish as no variance", () => {
        const result = calculateFinishVarianceProgressPoint(
            utcDate(2026, 4, 10),
            utcDate(2026, 4, 20),
            null
        );

        expect(result?.varianceDays).toBe(0);
        expect(result?.progressDate.toISOString()).toBe("2026-05-10T00:00:00.000Z");
    });

    it("uses the same variance calculation for start dates", () => {
        const result = calculateDateVarianceProgressPoint(
            utcDate(2026, 4, 10),
            utcDate(2026, 4, 12),
            utcDate(2026, 4, 8)
        );

        expect(result?.varianceDays).toBe(4);
        expect(result?.progressDate.toISOString()).toBe("2026-05-06T00:00:00.000Z");
    });

    it("uses valid manual dates before scheduled dates", () => {
        const scheduledDate = utcDate(2026, 4, 20);
        const manualDate = utcDate(2026, 4, 18);

        expect(getEffectiveProgressLineDate(manualDate, scheduledDate)).toBe(manualDate);
        expect(getEffectiveProgressLineDate(null, scheduledDate)).toBe(scheduledDate);
        expect(getEffectiveProgressLineDate(new Date(Number.NaN), scheduledDate)).toBe(scheduledDate);
    });

    it("applies manual finish dates to finish variance", () => {
        const result = calculateDateVarianceProgressPoint(
            utcDate(2026, 4, 10),
            getEffectiveProgressLineDate(utcDate(2026, 4, 24), utcDate(2026, 4, 20)),
            utcDate(2026, 4, 20)
        );

        expect(result?.varianceDays).toBe(4);
        expect(result?.progressDate.toISOString()).toBe("2026-05-06T00:00:00.000Z");
    });

    it("expands both mode into start and finish point series", () => {
        expect(getProgressLinePointKinds("start")).toEqual(["start"]);
        expect(getProgressLinePointKinds("finish")).toEqual(["finish"]);
        expect(getProgressLinePointKinds("both")).toEqual(["start", "finish"]);
    });

    it("classifies both-line band direction from progress-line positions", () => {
        expect(getProgressLineBandTone(100, 112)).toBe("recovery");
        expect(getProgressLineBandTone(112, 100)).toBe("slippage");
        expect(getProgressLineBandTone(100, 100.25)).toBe("neutral");
        expect(getProgressLineBandTone(Number.NaN, 100)).toBe("neutral");
    });

    it("returns null when a required date is missing", () => {
        expect(calculateFinishVarianceProgressPoint(
            utcDate(2026, 4, 10),
            null,
            utcDate(2026, 4, 20)
        )).toBeNull();
    });

    it("labels supported reference and date-mode sources", () => {
        expect(getProgressLineReferenceLabel("baselineFinish")).toBe("Baseline");
        expect(getProgressLineReferenceLabel("previousUpdateFinish")).toBe("Previous Update");
        expect(getProgressLineReferenceDateLabel("baselineFinish", "start")).toBe("Baseline Start");
        expect(getProgressLineReferenceDateLabel("previousUpdateFinish", "finish")).toBe("Previous Update Finish");
        expect(getProgressLineDateModeLabel("both")).toBe("Start + Finish");
    });
});
