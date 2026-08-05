import { describe, expect, it } from "vitest";

import {
    DEFAULT_SYSTEM_FONT_STACK,
    DIN_SYSTEM_FONT_STACK,
    applyCanvasTextRendering,
    areViewportsStable,
    getEffectiveCanvasPixelRatio,
    getHiDpiCanvasSize,
    getPhysicalPixelAlignmentOffset,
    isSignificantViewportResize,
    resolveFontFamilyStack,
    snapCanvasTextCoordinate,
    snapSvgCoordinateAttribute,
    snapTextCoordinate
} from "../../src/utils/RenderingSharpness";

describe("RenderingSharpness", () => {
    describe("font-family resolution", () => {
        it("exports the complete canonical stacks", () => {
            expect(DEFAULT_SYSTEM_FONT_STACK).toBe(
                "'Segoe UI', wf_segoe-ui_normal, -apple-system, BlinkMacSystemFont, Arial, sans-serif"
            );
            expect(DIN_SYSTEM_FONT_STACK).toBe(
                "'DIN', 'DIN Next', 'Segoe UI', sans-serif"
            );
        });

        it("uses the default stack for absent, generic, and Segoe UI values", () => {
            expect(resolveFontFamilyStack(undefined)).toBe(DEFAULT_SYSTEM_FONT_STACK);
            expect(resolveFontFamilyStack("")).toBe(DEFAULT_SYSTEM_FONT_STACK);
            expect(resolveFontFamilyStack("sans-serif")).toBe(DEFAULT_SYSTEM_FONT_STACK);
            expect(resolveFontFamilyStack('"Segoe UI", Arial, sans-serif')).toBe(DEFAULT_SYSTEM_FONT_STACK);
            expect(resolveFontFamilyStack(DEFAULT_SYSTEM_FONT_STACK)).toBe(DEFAULT_SYSTEM_FONT_STACK);
        });

        it("normalises DIN and DIN Next legacy stacks", () => {
            expect(resolveFontFamilyStack("DIN")).toBe(DIN_SYSTEM_FONT_STACK);
            expect(resolveFontFamilyStack('"DIN Next", Segoe UI, sans-serif')).toBe(DIN_SYSTEM_FONT_STACK);
            expect(resolveFontFamilyStack(DIN_SYSTEM_FONT_STACK)).toBe(DIN_SYSTEM_FONT_STACK);
        });

        it("keeps a custom primary family and supplies the complete default tail", () => {
            const expected = `'Calibri', ${DEFAULT_SYSTEM_FONT_STACK}`;
            expect(resolveFontFamilyStack("Calibri")).toBe(expected);
            expect(resolveFontFamilyStack("Calibri, Arial, sans-serif")).toBe(expected);
            expect(resolveFontFamilyStack("Arial")).toBe(`'Arial', ${DEFAULT_SYSTEM_FONT_STACK}`);
            expect(resolveFontFamilyStack("Verdana")).toBe(`'Verdana', ${DEFAULT_SYSTEM_FONT_STACK}`);
        });
    });

    describe("coordinate snapping", () => {
        it("snaps SVG text coordinates to integer logical pixels", () => {
            expect(snapTextCoordinate(114.33)).toBe(114);
            expect(snapTextCoordinate(114.5)).toBe(115);
            expect(snapTextCoordinate(-1.5)).toBe(-1);
        });

        it("snaps canvas coordinates to the physical-pixel grid", () => {
            expect(snapCanvasTextCoordinate(10.3, 2)).toBe(10.5);
            expect(snapCanvasTextCoordinate(10.2, 1.25)).toBe(10.4);
            expect(snapCanvasTextCoordinate(10.4, 0)).toBe(10);
            expect(snapCanvasTextCoordinate(10.4, Number.NaN)).toBe(10);
        });

        it.each([1, 1.25, 1.5, 2])(
            "aligns fractional scrolling origins at an effective scale of %s",
            (effectiveScale) => {
                const physicalOrigins = [0, 0.2, 10.5, 123.75, -42.4];

                physicalOrigins.forEach((physicalOrigin) => {
                    const offset = getPhysicalPixelAlignmentOffset(physicalOrigin, effectiveScale);
                    const alignedOrigin = physicalOrigin + (offset * effectiveScale);

                    expect(alignedOrigin).toBeCloseTo(Math.round(physicalOrigin), 12);
                    expect(Math.abs(offset)).toBeLessThanOrEqual((0.5 / effectiveScale) + 1e-12);
                    expect(getPhysicalPixelAlignmentOffset(alignedOrigin, effectiveScale)).toBe(0);
                });
            }
        );

        it("normalises invalid physical alignment inputs without producing non-finite output", () => {
            expect(getPhysicalPixelAlignmentOffset(Number.NaN, 1.25)).toBe(0);
            expect(getPhysicalPixelAlignmentOffset(Number.POSITIVE_INFINITY, 1.25)).toBe(0);
            expect(getPhysicalPixelAlignmentOffset(Number.NEGATIVE_INFINITY, 1.25)).toBe(0);
            expect(getPhysicalPixelAlignmentOffset(10.25, 0)).toBe(-0.25);
            expect(getPhysicalPixelAlignmentOffset(10.25, -1.25)).toBe(-0.25);
            expect(getPhysicalPixelAlignmentOffset(10.25, Number.NaN)).toBe(-0.25);
            expect(getPhysicalPixelAlignmentOffset(10.25, Number.POSITIVE_INFINITY)).toBe(-0.25);
            expect(getPhysicalPixelAlignmentOffset(10.25, Number.NEGATIVE_INFINITY)).toBe(-0.25);
        });

        it("snaps numeric SVG attributes but preserves percentages and CSS values", () => {
            expect(snapSvgCoordinateAttribute(114.6)).toBe(115);
            expect(snapSvgCoordinateAttribute("114.6")).toBe("115");
            expect(snapSvgCoordinateAttribute(" 114.4 ")).toBe("114");
            expect(snapSvgCoordinateAttribute("50%")).toBe("50%");
            expect(snapSvgCoordinateAttribute("12px")).toBe("12px");
            expect(snapSvgCoordinateAttribute("auto")).toBe("auto");
            expect(snapSvgCoordinateAttribute("")).toBe("");
            expect(snapSvgCoordinateAttribute(null)).toBeNull();
            expect(snapSvgCoordinateAttribute(undefined)).toBeUndefined();
        });
    });

    describe("HiDPI canvas sizing", () => {
        it.each([
            [1, 200, 100],
            [1.25, 250, 125],
            [1.5, 300, 150],
            [2, 400, 200]
        ])("uses DPR %s without an arbitrary cap", (ratio, backingWidth, backingHeight) => {
            expect(getHiDpiCanvasSize(200, 100, ratio)).toEqual({
                cssWidth: 200,
                cssHeight: 100,
                backingWidth,
                backingHeight,
                scaleX: ratio,
                scaleY: ratio
            });
        });

        it("reports actual scale after CSS and backing dimensions are rounded", () => {
            const result = getHiDpiCanvasSize(100.6, 50.6, 1.25);

            expect(result).toEqual({
                cssWidth: 101,
                cssHeight: 51,
                backingWidth: 126,
                backingHeight: 63,
                scaleX: 126 / 101,
                scaleY: 63 / 51
            });
        });

        it("combines valid DPR and CSS scale and independently normalises invalid inputs", () => {
            expect(getEffectiveCanvasPixelRatio(2, 1.25)).toBe(2.5);
            expect(getEffectiveCanvasPixelRatio(1.5, 1)).toBe(1.5);
            expect(getEffectiveCanvasPixelRatio(0, 1.25)).toBe(1.25);
            expect(getEffectiveCanvasPixelRatio(2, Number.NaN)).toBe(2);
            expect(getEffectiveCanvasPixelRatio(Number.POSITIVE_INFINITY, -1)).toBe(1);
            expect(getEffectiveCanvasPixelRatio(4, 2)).toBe(8);
        });

        it("enables canvas legibility optimisation only when supported", () => {
            const supported = { textRendering: "" } as unknown as CanvasRenderingContext2D;
            const unsupported = {} as CanvasRenderingContext2D;

            applyCanvasTextRendering(supported);
            applyCanvasTextRendering(unsupported);
            applyCanvasTextRendering(null);

            expect((supported as unknown as { textRendering: string }).textRendering)
                .toBe("optimizeLegibility");
            expect("textRendering" in unsupported).toBe(false);
        });
    });

    describe("viewport transition detection", () => {
        it("triggers only when either dimension changes by more than ten per cent", () => {
            const previous = { width: 100, height: 200 };

            expect(isSignificantViewportResize(previous, { width: 110, height: 180 })).toBe(false);
            expect(isSignificantViewportResize(previous, { width: 110.001, height: 200 })).toBe(true);
            expect(isSignificantViewportResize(previous, { width: 100, height: 220.001 })).toBe(true);
        });

        it("supports custom thresholds and zero-sized starting viewports", () => {
            expect(isSignificantViewportResize(
                { width: 100, height: 100 },
                { width: 105.1, height: 100 },
                0.05
            )).toBe(true);
            expect(isSignificantViewportResize(
                { width: 0, height: 0 },
                { width: 1, height: 0 }
            )).toBe(true);
            expect(isSignificantViewportResize(undefined, { width: 100, height: 100 })).toBe(false);
        });

        it("treats viewports within the inclusive tolerance as settled", () => {
            const first = { width: 100, height: 200 };

            expect(areViewportsStable(first, { width: 100.8, height: 199.2 })).toBe(true);
            expect(areViewportsStable(first, { width: 101, height: 199 })).toBe(true);
            expect(areViewportsStable(first, { width: 101.01, height: 200 })).toBe(false);
            expect(areViewportsStable(first, { width: 100.4, height: 200 }, 0.5)).toBe(true);
            expect(areViewportsStable(first, { width: 100.6, height: 200 }, 0.5)).toBe(false);
            expect(areViewportsStable(null, first)).toBe(false);
        });
    });
});
