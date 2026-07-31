export const DEFAULT_SYSTEM_FONT_STACK =
    "'Segoe UI', wf_segoe-ui_normal, -apple-system, BlinkMacSystemFont, Arial, sans-serif";

export const DIN_SYSTEM_FONT_STACK =
    "'DIN', 'DIN Next', 'Segoe UI', sans-serif";

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

const DEFAULT_FONT_FAMILIES = new Set([
    "segoe ui",
    "wf_segoe-ui_normal",
    "-apple-system",
    "blinkmacsystemfont",
    "system-ui",
    "sans-serif"
]);

const DIN_FONT_FAMILIES = new Set([
    "din",
    "din next"
]);

function getFirstFontFamily(value: string): string {
    let quote: "'" | '"' | null = null;

    for (let index = 0; index < value.length; index++) {
        const character = value[index];
        if (quote) {
            if (character === quote && value[index - 1] !== "\\") {
                quote = null;
            }
        } else if (character === "'" || character === '"') {
            quote = character;
        } else if (character === ",") {
            return value.slice(0, index);
        }
    }

    return value;
}

function removeSurroundingQuotes(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length >= 2) {
        const first = trimmed[0];
        const last = trimmed[trimmed.length - 1];
        if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
            return trimmed.slice(1, -1).trim();
        }
    }
    return trimmed;
}

function quoteFontFamily(value: string): string {
    const escaped = value
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'");
    return `'${escaped}'`;
}

function normalisePositiveFinite(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : 1;
}

function normaliseCanvasDimension(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function hasFiniteViewport(viewport: ViewportDimensions | null | undefined): viewport is ViewportDimensions {
    return Boolean(
        viewport
        && Number.isFinite(viewport.width)
        && Number.isFinite(viewport.height)
        && viewport.width >= 0
        && viewport.height >= 0
    );
}

/**
 * Resolves formatting-pane and legacy font values to a cross-platform fallback
 * stack. Existing comma-separated fallback lists are deliberately normalised
 * from their primary family so every result has the same dependable tail.
 */
export function resolveFontFamilyStack(value: unknown): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        return DEFAULT_SYSTEM_FONT_STACK;
    }

    const primaryFamily = removeSurroundingQuotes(getFirstFontFamily(value));
    if (!primaryFamily) {
        return DEFAULT_SYSTEM_FONT_STACK;
    }

    const normalisedPrimary = primaryFamily.toLocaleLowerCase("en-US").replace(/\s+/g, " ");
    if (DIN_FONT_FAMILIES.has(normalisedPrimary)) {
        return DIN_SYSTEM_FONT_STACK;
    }
    if (DEFAULT_FONT_FAMILIES.has(normalisedPrimary)) {
        return DEFAULT_SYSTEM_FONT_STACK;
    }

    return `${quoteFontFamily(primaryFamily)}, ${DEFAULT_SYSTEM_FONT_STACK}`;
}

export function snapTextCoordinate(value: number): number {
    return Math.round(value);
}

/**
 * Snaps a logical canvas coordinate to the nearest physical pixel while
 * retaining the logical coordinate system used after the context is scaled.
 */
export function snapCanvasTextCoordinate(value: number, physicalScale: number): number {
    const scale = normalisePositiveFinite(physicalScale);
    return Math.round(value * scale) / scale;
}

/**
 * Returns physical pixels per logical canvas pixel. CSS transforms can add
 * physical scale beyond window.devicePixelRatio, so both values participate.
 */
export function getEffectiveCanvasPixelRatio(devicePixelRatio: number, cssScale: number): number {
    const ratio = normalisePositiveFinite(devicePixelRatio) * normalisePositiveFinite(cssScale);
    return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

/**
 * Calculates integer CSS and backing-buffer sizes plus the exact scale that
 * maps the rounded CSS dimensions onto the rounded backing dimensions.
 */
export function getHiDpiCanvasSize(
    displayWidth: number,
    displayHeight: number,
    ratio: number
): HiDpiCanvasSize {
    const safeWidth = normaliseCanvasDimension(displayWidth);
    const safeHeight = normaliseCanvasDimension(displayHeight);
    const safeRatio = normalisePositiveFinite(ratio);
    const cssWidth = Math.round(safeWidth);
    const cssHeight = Math.round(safeHeight);
    const backingWidth = Math.round(safeWidth * safeRatio);
    const backingHeight = Math.round(safeHeight * safeRatio);

    return {
        cssWidth,
        cssHeight,
        backingWidth,
        backingHeight,
        scaleX: cssWidth > 0 ? backingWidth / cssWidth : safeRatio,
        scaleY: cssHeight > 0 ? backingHeight / cssHeight : safeRatio
    };
}

/**
 * Canvas textRendering is not present in every host's TypeScript DOM surface
 * or runtime. Only assign it when the runtime exposes the property.
 */
export function applyCanvasTextRendering(
    context: CanvasRenderingContext2D | null | undefined
): void {
    if (!context) {
        return;
    }

    try {
        const contextWithTextRendering = context as CanvasRenderingContext2D & {
            textRendering?: string;
        };
        if ("textRendering" in contextWithTextRendering) {
            contextWithTextRendering.textRendering = "optimizeLegibility";
        }
    } catch {
        // Some embedded hosts expose read-only or throwing experimental fields.
    }
}

export function snapSvgCoordinateAttribute(value: number): number;
export function snapSvgCoordinateAttribute(value: string | null): string | null;
export function snapSvgCoordinateAttribute(value: undefined): undefined;
export function snapSvgCoordinateAttribute(value: SvgCoordinateAttribute): SvgCoordinateAttribute;
export function snapSvgCoordinateAttribute(value: SvgCoordinateAttribute): SvgCoordinateAttribute {
    if (typeof value === "number") {
        return Math.round(value);
    }
    if (typeof value !== "string") {
        return value;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return value;
    }

    const numericValue = Number(trimmed);
    return Number.isFinite(numericValue) ? String(Math.round(numericValue)) : value;
}

export function isSignificantViewportResize(
    previous: ViewportDimensions | null | undefined,
    next: ViewportDimensions | null | undefined,
    threshold = 0.10
): boolean {
    if (!hasFiniteViewport(previous) || !hasFiniteViewport(next)) {
        return false;
    }

    const safeThreshold = Number.isFinite(threshold) && threshold >= 0 ? threshold : 0.10;
    const isDimensionSignificant = (before: number, after: number): boolean => {
        if (before === 0) {
            return after !== 0;
        }

        const delta = Math.abs(after - before);
        const boundary = Math.abs(before) * safeThreshold;
        const epsilon = Number.EPSILON * Math.max(1, delta, boundary) * 8;
        return delta > boundary + epsilon;
    };

    return isDimensionSignificant(previous.width, next.width)
        || isDimensionSignificant(previous.height, next.height);
}

export function areViewportsStable(
    first: ViewportDimensions | null | undefined,
    next: ViewportDimensions | null | undefined,
    tolerancePx = 1
): boolean {
    if (!hasFiniteViewport(first) || !hasFiniteViewport(next)) {
        return false;
    }

    const safeTolerance = Number.isFinite(tolerancePx) && tolerancePx >= 0 ? tolerancePx : 1;
    return Math.abs(next.width - first.width) <= safeTolerance
        && Math.abs(next.height - first.height) <= safeTolerance;
}
