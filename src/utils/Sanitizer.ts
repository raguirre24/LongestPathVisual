/**
 * Sanitization utilities for user-provided data
 * Provides defense-in-depth against XSS and injection attacks
 */

export class Sanitizer {
    private static readonly DANGEROUS_CHARS = /[<>"'&]/g;
    private static readonly ESCAPE_MAP: Record<string, string> = {
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        '&': '&amp;'
    };

    /**
     * Escapes HTML special characters to prevent XSS
     * @param unsafe - The potentially unsafe string to escape
     * @returns Safe string with HTML entities escaped
     */
    static escapeHtml(unsafe: string | number | null | undefined): string {
        if (unsafe == null) return '';
        return String(unsafe).replace(
            this.DANGEROUS_CHARS,
            (char) => this.ESCAPE_MAP[char] || char
        );
    }

    /**
     * Sanitizes text for use in SVG text elements
     * While SVG text doesn't parse HTML, we sanitize for consistency
     * and to prevent issues if context changes
     * @param text - Text to sanitize
     * @returns Sanitized text
     */
    static sanitizeForSvgText(text: string | null | undefined): string {
        if (text == null) return '';
        // Remove control characters and trim
        return String(text)
            .replace(/[\x00-\x1F\x7F]/g, '')
            .trim();
    }

    /**
     * Sanitizes a URL to prevent javascript: and data: injection
     * Only allows HTTPS protocol for security
     * @param url - URL to sanitize
     * @returns Safe URL or empty string if invalid/dangerous
     */
    static sanitizeUrl(url: string | null | undefined): string {
        if (url == null) return '';

        try {
            const parsed = new URL(url);
            // Only allow HTTPS protocol for security
            if (parsed.protocol !== 'https:') {
                return '';
            }
            return parsed.href;
        } catch {
            // If URL parsing fails, it's not a valid URL
            return '';
        }
    }

    /**
     * Sanitizes a filename for safe use in downloads
     * @param filename - Filename to sanitize
     * @returns Safe filename
     */
    static sanitizeFilename(filename: string | null | undefined): string {
        if (filename == null) return 'export';

        // Remove path separators and dangerous characters
        return String(filename)
            .replace(/[/\\:*?"<>|]/g, '_')
            .replace(/\s+/g, '_')
            .substring(0, 200) // Limit length
            .trim() || 'export';
    }

    /**
     * Sanitizes tooltip display name
     * @param displayName - The display name to sanitize
     * @returns Safe display name
     */
    static sanitizeTooltipDisplayName(displayName: string | null | undefined): string {
        if (displayName == null) return '';
        return this.escapeHtml(this.sanitizeForSvgText(displayName));
    }

    /**
     * Sanitizes tooltip value, handling different types
     * @param value - The value to sanitize
     * @returns Safe string representation
     */
    static sanitizeTooltipValue(value: unknown): string {
        if (value == null) return '';

        if (value instanceof Date) {
            return value.toLocaleDateString();
        }

        if (typeof value === 'number') {
            return isFinite(value) ? value.toLocaleString() : '';
        }

        if (typeof value === 'boolean') {
            return value ? 'Yes' : 'No';
        }

        return this.escapeHtml(String(value));
    }

    /**
     * Sanitizes CSS color value to prevent injection
     * @param color - Color string to validate
     * @param fallback - Fallback color if invalid
     * @returns Safe color value
     */
    static sanitizeColor(color: string | null | undefined, fallback: string = '#000000'): string {
        if (color == null) return fallback;

        const colorStr = String(color).trim();

        // Hex color
        if (/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(colorStr)) {
            return colorStr;
        }

        // RGB/RGBA
        if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[\d.]+\s*)?\)$/i.test(colorStr)) {
            return colorStr;
        }

        // HSL/HSLA
        if (/^hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*(,\s*[\d.]+\s*)?\)$/i.test(colorStr)) {
            return colorStr;
        }

        // Named colors (basic set)
        const namedColors = [
            'black', 'white', 'red', 'green', 'blue', 'yellow', 'orange', 'purple',
            'pink', 'gray', 'grey', 'brown', 'transparent', 'inherit', 'currentColor'
        ];
        if (namedColors.includes(colorStr.toLowerCase())) {
            return colorStr;
        }

        return fallback;
    }

    /**
     * Truncates text with ellipsis for display
     * @param text - Text to truncate
     * @param maxLength - Maximum length before truncation
     * @returns Truncated text with ellipsis if needed
     */
    static truncateWithEllipsis(text: string | null | undefined, maxLength: number): string {
        if (text == null) return '';
        const str = String(text);
        if (str.length <= maxLength) return str;
        return str.substring(0, maxLength - 1) + '…';
    }
}
