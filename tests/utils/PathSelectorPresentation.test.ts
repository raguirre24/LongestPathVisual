import { describe, expect, it } from "vitest";
import {
    formatPathSpanDays,
    getPathSelectorVisibleLabel
} from "../../src/utils/PathSelectorPresentation";

describe("PathSelectorPresentation", () => {
    it("formats whole and fractional calendar spans without false precision", () => {
        expect(formatPathSpanDays(30)).toEqual({
            compact: "30d",
            spoken: "30 calendar days"
        });
        expect(formatPathSpanDays(1.46)).toEqual({
            compact: "1.5d",
            spoken: "1.5 calendar days"
        });
        expect(formatPathSpanDays(1)).toEqual({
            compact: "1d",
            spoken: "1 calendar day"
        });
    });

    it("uses responsive labels that preserve the path counter", () => {
        const metrics = {
            pathNumber: 2,
            totalPaths: 5,
            spanDays: 30,
            activityCount: 12
        };

        expect(getPathSelectorVisibleLabel("wide", metrics))
            .toBe("LP 2/5 · 30d span · 12 act.");
        expect(getPathSelectorVisibleLabel("medium", metrics))
            .toBe("LP 2/5 · 30d span");
        expect(getPathSelectorVisibleLabel("narrow", metrics)).toBe("LP 2/5");
        expect(getPathSelectorVisibleLabel("compact", metrics)).toBe("LP 2/5");
        expect(getPathSelectorVisibleLabel("very-narrow", metrics)).toBe("LP 2/5");
    });

    it("normalises invalid or negative spans for display", () => {
        expect(formatPathSpanDays(Number.NaN).compact).toBe("0d");
        expect(formatPathSpanDays(-4).compact).toBe("0d");
    });
});
