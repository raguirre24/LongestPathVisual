export declare const DEFAULT_SYSTEM_FONT_STACK = "'Segoe UI', wf_segoe-ui_normal, -apple-system, BlinkMacSystemFont, Arial, sans-serif";
export declare const DIN_SYSTEM_FONT_STACK = "'DIN', 'DIN Next', 'Segoe UI', sans-serif";
export interface HiDpiCanvasSize {
    cssWidth: number;
    cssHeight: number;
    backingWidth: number;
    backingHeight: number;
    scaleX: number;
    scaleY: number;
}
export interface ViewportDimensions {
    width: number;
    height: number;
}
export type SvgCoordinateAttribute = number | string | null | undefined;
/**
 * Resolves formatting-pane and legacy font values to a cross-platform fallback
 * stack. Existing comma-separated fallback lists are deliberately normalised
 * from their primary family so every result has the same dependable tail.
 */
export declare function resolveFontFamilyStack(value: unknown): string;
export declare function snapTextCoordinate(value: number): number;
/**
 * Snaps a logical canvas coordinate to the nearest physical pixel while
 * retaining the logical coordinate system used after the context is scaled.
 */
export declare function snapCanvasTextCoordinate(value: number, physicalScale: number): number;
/**
 * Returns the smallest local-coordinate offset that moves an already measured
 * physical origin onto the nearest physical-pixel boundary. This keeps a
 * scrolling SVG/canvas surface on a stable raster phase without changing its
 * native scroll offset.
 */
export declare function getPhysicalPixelAlignmentOffset(physicalOrigin: number, effectivePhysicalScale: number): number;
/**
 * Returns physical pixels per logical canvas pixel. CSS transforms can add
 * physical scale beyond window.devicePixelRatio, so both values participate.
 */
export declare function getEffectiveCanvasPixelRatio(devicePixelRatio: number, cssScale: number): number;
/**
 * Calculates integer CSS and backing-buffer sizes plus the exact scale that
 * maps the rounded CSS dimensions onto the rounded backing dimensions.
 */
export declare function getHiDpiCanvasSize(displayWidth: number, displayHeight: number, ratio: number): HiDpiCanvasSize;
/**
 * Canvas textRendering is not present in every host's TypeScript DOM surface
 * or runtime. Only assign it when the runtime exposes the property.
 */
export declare function applyCanvasTextRendering(context: CanvasRenderingContext2D | null | undefined): void;
export declare function snapSvgCoordinateAttribute(value: number): number;
export declare function snapSvgCoordinateAttribute(value: string | null): string | null;
export declare function snapSvgCoordinateAttribute(value: undefined): undefined;
export declare function snapSvgCoordinateAttribute(value: SvgCoordinateAttribute): SvgCoordinateAttribute;
export declare function isSignificantViewportResize(previous: ViewportDimensions | null | undefined, next: ViewportDimensions | null | undefined, threshold?: number): boolean;
export declare function areViewportsStable(first: ViewportDimensions | null | undefined, next: ViewportDimensions | null | undefined, tolerancePx?: number): boolean;
