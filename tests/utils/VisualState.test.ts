import { describe, expect, it } from "vitest";

import {
    getExportFloatText,
    getExportTaskType,
    parsePersistedLegendSelection,
    sanitizeExportTextField,
    serializeLegendSelection
} from "../../src/utils/VisualState";

describe("VisualState helpers", () => {
    it("round-trips legend selections as JSON so commas are preserved", () => {
        const serialized = serializeLegendSelection(["North, Region", "South"]);
        const restored = parsePersistedLegendSelection(serialized);

        expect(serialized).toBe('["North, Region","South"]');
        expect(restored).toEqual(["North, Region", "South"]);
    });

    it("restores legacy comma-separated legend selections", () => {
        const restored = parsePersistedLegendSelection(" Alpha , Beta,Gamma ");
        expect(restored).toEqual(["Alpha", "Beta", "Gamma"]);
    });

    it("normalizes tabs and line breaks for export-safe text", () => {
        expect(sanitizeExportTextField("Line 1\tLine 2\r\nLine 3")).toBe("Line 1 Line 2 Line 3");
    });

    it("classifies milestones by task type instead of duration", () => {
        expect(getExportTaskType({ type: "TT_Mile" } as any)).toBe("Milestone");
        expect(getExportTaskType({ type: "TT_Task" } as any)).toBe("Activity");
    });

    it("suppresses non-finite float values in exports", () => {
        expect(getExportFloatText({ userProvidedTotalFloat: 3 } as any)).toBe("3");
        expect(getExportFloatText({ userProvidedTotalFloat: Number.POSITIVE_INFINITY } as any)).toBe("");
        expect(getExportFloatText({ userProvidedTotalFloat: Number.NaN } as any)).toBe("");
    });
});
