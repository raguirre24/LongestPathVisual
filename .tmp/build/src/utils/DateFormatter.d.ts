/**
 * DateFormatter utility for locale-aware date formatting.
 * Provides consistent date formatting throughout the application.
 */
export declare class DateFormatter {
    private locale;
    private columnFormatter;
    private shortFormatter;
    private isoFormatter;
    constructor(locale?: string);
    /**
     * Updates the locale and recreates formatters
     */
    setLocale(locale: string): void;
    /**
     * Gets the current locale
     */
    getLocale(): string;
    private updateFormatters;
    /**
     * Validates if a date is valid for formatting
     */
    private isValidDate;
    /**
     * Format date for column display (locale-aware)
     * Examples: "01/28/2026" (en-US) or "28/01/2026" (en-GB)
     */
    formatForColumn(date: Date | null | undefined): string;
    /**
     * Format date for export (ISO 8601 format: YYYY-MM-DD)
     * This ensures consistent format regardless of locale
     */
    formatForExport(date: Date | null | undefined): string;
    /**
     * Format date for short display (e.g., "Jan 28")
     */
    formatShort(date: Date | null | undefined): string;
    /**
     * Format date for display in tooltips and labels
     * Uses a more readable format
     */
    formatForDisplay(date: Date | null | undefined): string;
    /**
     * Format date with time for detailed displays
     */
    formatWithTime(date: Date | null | undefined): string;
    /**
     * Format a date range
     */
    formatRange(startDate: Date | null | undefined, endDate: Date | null | undefined): string;
}
export declare const dateFormatter: DateFormatter;
