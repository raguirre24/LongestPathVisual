import { describe, expect, it } from "vitest";
import {
    ensureColorContrast,
    formatHexColor,
    getColorContrastRatio,
    mixHexColors,
    parseHexColor
} from "../../src/utils/AccessibleColor";
import { HEADER_DOCK_TOKENS } from "../../src/utils/Theme";

describe("AccessibleColor", () => {
    it("parses short and long hex colours and rejects unsupported values", () => {
        expect(parseHexColor("#abc")).toEqual({ r: 170, g: 187, b: 204 });
        expect(parseHexColor("#A1B2C3")).toEqual({ r: 161, g: 178, b: 195 });
        expect(parseHexColor("rgb(1, 2, 3)")).toBeNull();
        expect(parseHexColor("not-a-colour")).toBeNull();
    });

    it("formats clamped RGB channels as canonical uppercase hex", () => {
        expect(formatHexColor({ r: -5, g: 127.6, b: 300 })).toBe("#0080FF");
    });

    it("keeps every default header icon colour above 3:1 contrast", () => {
        const background = HEADER_DOCK_TOKENS.buttonBg;
        const iconColours = [
            HEADER_DOCK_TOKENS.buttonSubtle,
            HEADER_DOCK_TOKENS.primary,
            HEADER_DOCK_TOKENS.success,
            HEADER_DOCK_TOKENS.danger,
            "#D8CCB8",
            "#C6A3F6"
        ];

        for (const colour of iconColours) {
            expect(getColorContrastRatio(colour, background)).toBeGreaterThanOrEqual(3);
        }
    });

    it("uses distinct vivid defaults for enabled and critical toggle states", () => {
        expect(HEADER_DOCK_TOKENS.success).toBe("#88D58C");
        expect(HEADER_DOCK_TOKENS.danger).toBe("#FF5C5C");
    });

    it("adjusts a low-contrast preferred colour while retaining a valid result", () => {
        const background = "#2D3745";
        const adjusted = ensureColorContrast("#394557", background, "#7CABFF", 3);

        expect(adjusted).not.toBe("#394557");
        expect(getColorContrastRatio(adjusted, background)).toBeGreaterThanOrEqual(3);
    });

    it("uses and, when necessary, adjusts the fallback for invalid preferred colours", () => {
        const adjusted = ensureColorContrast("invalid", "#F8F8F8", "#7CABFF", 3);

        expect(parseHexColor(adjusted)).not.toBeNull();
        expect(getColorContrastRatio(adjusted, "#F8F8F8")).toBeGreaterThanOrEqual(3);
    });

    it("returns deterministic output when the background cannot be parsed", () => {
        expect(ensureColorContrast("#abc", "Canvas", "#000000", 3)).toBe("#AABBCC");
        expect(ensureColorContrast("invalid", "Canvas", "#fff", 3)).toBe("#FFFFFF");
    });

    it("derives a subtle hover colour without mutating the endpoints", () => {
        expect(mixHexColors("#000000", "#FFFFFF", 0)).toBe("#000000");
        expect(mixHexColors("#000000", "#FFFFFF", 1)).toBe("#FFFFFF");
        expect(mixHexColors("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    });
});
