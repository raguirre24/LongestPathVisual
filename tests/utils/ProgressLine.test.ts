import { describe, expect, it } from "vitest";

import { calculateFinishVarianceProgressPoint, getProgressLineReferenceLabel } from "../../src/utils/ProgressLine";

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

    it("returns null when a required date is missing", () => {
        expect(calculateFinishVarianceProgressPoint(
            utcDate(2026, 4, 10),
            null,
            utcDate(2026, 4, 20)
        )).toBeNull();
    });

    it("labels supported reference finish sources", () => {
        expect(getProgressLineReferenceLabel("baselineFinish")).toBe("Baseline Finish");
        expect(getProgressLineReferenceLabel("previousUpdateFinish")).toBe("Previous Update Finish");
    });
});
