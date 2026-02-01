/**
 * Sanitization utilities for user-provided data
 * Provides defense-in-depth against XSS and injection attacks
 */
export declare class Sanitizer {
    private static readonly DANGEROUS_CHARS;
    private static readonly ESCAPE_MAP;
    /**
     * Escapes HTML special characters to prevent XSS
     * @param unsafe - The potentially unsafe string to escape
     * @returns Safe string with HTML entities escaped
     */
    static escapeHtml(unsafe: string | number | null | undefined): string;
    /**
     * Sanitizes text for use in SVG text elements
     * While SVG text doesn't parse HTML, we sanitize for consistency
     * and to prevent issues if context changes
     * @param text - Text to sanitize
     * @returns Sanitized text
     */
    static sanitizeForSvgText(text: string | null | undefined): string;
    /**
     * Sanitizes a URL to prevent javascript: and data: injection
     * Only allows HTTPS protocol for security
     * @param url - URL to sanitize
     * @returns Safe URL or empty string if invalid/dangerous
     */
    static sanitizeUrl(url: string | null | undefined): string;
    /**
     * Sanitizes a filename for safe use in downloads
     * @param filename - Filename to sanitize
     * @returns Safe filename
     */
    static sanitizeFilename(filename: string | null | undefined): string;
    /**
     * Sanitizes tooltip display name
     * @param displayName - The display name to sanitize
     * @returns Safe display name
     */
    static sanitizeTooltipDisplayName(displayName: string | null | undefined): string;
    /**
     * Sanitizes tooltip value, handling different types
     * @param value - The value to sanitize
     * @returns Safe string representation
     */
    static sanitizeTooltipValue(value: unknown): string;
    /**
     * Sanitizes CSS color value to prevent injection
     * @param color - Color string to validate
     * @param fallback - Fallback color if invalid
     * @returns Safe color value
     */
    static sanitizeColor(color: string | null | undefined, fallback?: string): string;
    /**
     * Truncates text with ellipsis for display
     * @param text - Text to truncate
     * @param maxLength - Maximum length before truncation
     * @returns Truncated text with ellipsis if needed
     */
    static truncateWithEllipsis(text: string | null | undefined, maxLength: number): string;
}
