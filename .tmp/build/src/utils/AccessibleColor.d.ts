export interface RgbColor {
    r: number;
    g: number;
    b: number;
}
export declare function parseHexColor(value: string | null | undefined): RgbColor | null;
export declare function formatHexColor(color: RgbColor): string;
export declare function getRelativeLuminance(color: RgbColor): number;
export declare function getColorContrastRatio(foreground: string | RgbColor, background: string | RgbColor): number | null;
export declare function mixHexColors(baseColor: string, overlayColor: string, overlayAmount: number): string;
export declare function ensureColorContrast(preferredColor: string | null | undefined, backgroundColor: string, fallbackColor: string, minimumContrastRatio?: number): string;
