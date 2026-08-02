export interface RgbColor {
    r: number;
    g: number;
    b: number;
}

const HEX_COLOR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function clampChannel(value: number): number {
    return Math.max(0, Math.min(255, Math.round(value)));
}

export function parseHexColor(value: string | null | undefined): RgbColor | null {
    const normalized = value?.trim();
    if (!normalized || !HEX_COLOR_PATTERN.test(normalized)) {
        return null;
    }

    const hex = normalized.slice(1);
    const expanded = hex.length === 3
        ? hex.split("").map(character => `${character}${character}`).join("")
        : hex;

    return {
        r: Number.parseInt(expanded.slice(0, 2), 16),
        g: Number.parseInt(expanded.slice(2, 4), 16),
        b: Number.parseInt(expanded.slice(4, 6), 16)
    };
}

export function formatHexColor(color: RgbColor): string {
    const channel = (value: number) => clampChannel(value).toString(16).padStart(2, "0").toUpperCase();
    return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

function linearizeChannel(value: number): number {
    const channel = clampChannel(value) / 255;
    return channel <= 0.04045
        ? channel / 12.92
        : Math.pow((channel + 0.055) / 1.055, 2.4);
}

export function getRelativeLuminance(color: RgbColor): number {
    return (0.2126 * linearizeChannel(color.r))
        + (0.7152 * linearizeChannel(color.g))
        + (0.0722 * linearizeChannel(color.b));
}

export function getColorContrastRatio(
    foreground: string | RgbColor,
    background: string | RgbColor
): number | null {
    const foregroundColor = typeof foreground === "string" ? parseHexColor(foreground) : foreground;
    const backgroundColor = typeof background === "string" ? parseHexColor(background) : background;
    if (!foregroundColor || !backgroundColor) {
        return null;
    }

    const foregroundLuminance = getRelativeLuminance(foregroundColor);
    const backgroundLuminance = getRelativeLuminance(backgroundColor);
    const lighter = Math.max(foregroundLuminance, backgroundLuminance);
    const darker = Math.min(foregroundLuminance, backgroundLuminance);
    return (lighter + 0.05) / (darker + 0.05);
}

export function mixHexColors(
    baseColor: string,
    overlayColor: string,
    overlayAmount: number
): string {
    const base = parseHexColor(baseColor);
    const overlay = parseHexColor(overlayColor);
    if (!base || !overlay) {
        return base ? formatHexColor(base) : baseColor;
    }

    const amount = Math.max(0, Math.min(1, overlayAmount));
    return formatHexColor({
        r: base.r + ((overlay.r - base.r) * amount),
        g: base.g + ((overlay.g - base.g) * amount),
        b: base.b + ((overlay.b - base.b) * amount)
    });
}

function findMinimumContrastMix(
    preferred: RgbColor,
    background: RgbColor,
    target: RgbColor,
    minimumContrastRatio: number
): { color: RgbColor; amount: number } | null {
    const targetContrast = getColorContrastRatio(target, background);
    if (targetContrast === null || targetContrast < minimumContrastRatio) {
        return null;
    }

    let low = 0;
    let high = 1;
    let candidate = target;

    for (let iteration = 0; iteration < 24; iteration++) {
        const amount = (low + high) / 2;
        const mixed = {
            r: preferred.r + ((target.r - preferred.r) * amount),
            g: preferred.g + ((target.g - preferred.g) * amount),
            b: preferred.b + ((target.b - preferred.b) * amount)
        };
        const contrast = getColorContrastRatio(mixed, background) ?? 0;
        if (contrast >= minimumContrastRatio) {
            candidate = mixed;
            high = amount;
        } else {
            low = amount;
        }
    }

    return { color: candidate, amount: high };
}

export function ensureColorContrast(
    preferredColor: string | null | undefined,
    backgroundColor: string,
    fallbackColor: string,
    minimumContrastRatio: number = 3
): string {
    const background = parseHexColor(backgroundColor);
    const fallback = parseHexColor(fallbackColor);
    const preferred = parseHexColor(preferredColor) ?? fallback;

    if (!background) {
        return preferred ? formatHexColor(preferred) : fallbackColor;
    }

    if (!preferred) {
        const black = { r: 0, g: 0, b: 0 };
        const white = { r: 255, g: 255, b: 255 };
        const blackContrast = getColorContrastRatio(black, background) ?? 0;
        const whiteContrast = getColorContrastRatio(white, background) ?? 0;
        return formatHexColor(whiteContrast >= blackContrast ? white : black);
    }

    const currentContrast = getColorContrastRatio(preferred, background) ?? 0;
    if (currentContrast >= minimumContrastRatio) {
        return formatHexColor(preferred);
    }

    const whiteMix = findMinimumContrastMix(
        preferred,
        background,
        { r: 255, g: 255, b: 255 },
        minimumContrastRatio
    );
    const blackMix = findMinimumContrastMix(
        preferred,
        background,
        { r: 0, g: 0, b: 0 },
        minimumContrastRatio
    );

    if (whiteMix && blackMix) {
        return formatHexColor(whiteMix.amount <= blackMix.amount ? whiteMix.color : blackMix.color);
    }
    if (whiteMix) {
        return formatHexColor(whiteMix.color);
    }
    if (blackMix) {
        return formatHexColor(blackMix.color);
    }

    return formatHexColor(preferred);
}
