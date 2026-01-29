/**
 * DateFormatter utility for locale-aware date formatting.
 * Provides consistent date formatting throughout the application.
 */

export class DateFormatter {
    private locale: string;
    private columnFormatter: Intl.DateTimeFormat | null = null;
    private shortFormatter: Intl.DateTimeFormat | null = null;
    private isoFormatter: Intl.DateTimeFormat | null = null;

    constructor(locale?: string) {
        this.locale = locale || 'en-US';
        this.updateFormatters();
    }

    /**
     * Updates the locale and recreates formatters
     */
    setLocale(locale: string): void {
        if (this.locale !== locale) {
            this.locale = locale;
            this.updateFormatters();
        }
    }

    /**
     * Gets the current locale
     */
    getLocale(): string {
        return this.locale;
    }

    private updateFormatters(): void {
        try {
            // Standard column format - respects user's locale
            this.columnFormatter = new Intl.DateTimeFormat(this.locale, {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });

            // Short format for compact displays
            this.shortFormatter = new Intl.DateTimeFormat(this.locale, {
                day: 'numeric',
                month: 'short'
            });

            // ISO format for exports (YYYY-MM-DD) - uses en-CA which produces this format
            this.isoFormatter = new Intl.DateTimeFormat('en-CA', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            });
        } catch (error) {
            console.warn('DateFormatter: Failed to create formatters for locale', this.locale, error);
            // Fallback to en-US if locale is invalid
            this.locale = 'en-US';
            this.updateFormatters();
        }
    }

    /**
     * Validates if a date is valid for formatting
     */
    private isValidDate(date: Date | null | undefined): date is Date {
        return date instanceof Date && !isNaN(date.getTime());
    }

    /**
     * Format date for column display (locale-aware)
     * Examples: "01/28/2026" (en-US) or "28/01/2026" (en-GB)
     */
    formatForColumn(date: Date | null | undefined): string {
        if (!this.isValidDate(date)) return "";
        try {
            return this.columnFormatter?.format(date) ?? "";
        } catch {
            return "";
        }
    }

    /**
     * Format date for export (ISO 8601 format: YYYY-MM-DD)
     * This ensures consistent format regardless of locale
     */
    formatForExport(date: Date | null | undefined): string {
        if (!this.isValidDate(date)) return "";
        try {
            return this.isoFormatter?.format(date) ?? "";
        } catch {
            return "";
        }
    }

    /**
     * Format date for short display (e.g., "Jan 28")
     */
    formatShort(date: Date | null | undefined): string {
        if (!this.isValidDate(date)) return "";
        try {
            return this.shortFormatter?.format(date) ?? "";
        } catch {
            return "";
        }
    }

    /**
     * Format date for display in tooltips and labels
     * Uses a more readable format
     */
    formatForDisplay(date: Date | null | undefined): string {
        if (!this.isValidDate(date)) return "";
        try {
            const formatter = new Intl.DateTimeFormat(this.locale, {
                day: 'numeric',
                month: 'short',
                year: 'numeric'
            });
            return formatter.format(date);
        } catch {
            return "";
        }
    }

    /**
     * Format date with time for detailed displays
     */
    formatWithTime(date: Date | null | undefined): string {
        if (!this.isValidDate(date)) return "";
        try {
            const formatter = new Intl.DateTimeFormat(this.locale, {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            return formatter.format(date);
        } catch {
            return "";
        }
    }

    /**
     * Format a date range
     */
    formatRange(startDate: Date | null | undefined, endDate: Date | null | undefined): string {
        const start = this.formatForColumn(startDate);
        const end = this.formatForColumn(endDate);

        if (!start && !end) return "";
        if (!start) return `→ ${end}`;
        if (!end) return `${start} →`;
        return `${start} - ${end}`;
    }
}

// Export singleton instance for convenience
export const dateFormatter = new DateFormatter();
