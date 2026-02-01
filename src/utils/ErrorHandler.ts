/**
 * Comprehensive error handling utilities
 * Provides structured error reporting and user-friendly messages
 */

import { ERROR_CODES } from '../constants';

// ============================================================================
// Types and Interfaces
// ============================================================================

export enum ErrorSeverity {
    Warning = 'warning',
    Error = 'error',
    Critical = 'critical'
}

export interface VisualError {
    /** Error code for categorization */
    code: string;
    /** Human-readable error message */
    message: string;
    /** Error severity level */
    severity: ErrorSeverity;
    /** Additional context about the error */
    context?: Record<string, unknown>;
    /** When the error occurred */
    timestamp: Date;
    /** Stack trace if available */
    stack?: string;
    /** Whether the error has been reported to the user */
    reported?: boolean;
}

export interface ErrorHandlerOptions {
    /** Maximum number of errors to keep in history */
    maxErrors?: number;
    /** Whether to log errors to console */
    logToConsole?: boolean;
    /** Callback when an error is captured */
    onError?: (error: VisualError) => void;
    /** Callback when a critical error occurs */
    onCriticalError?: (error: VisualError) => void;
}

// ============================================================================
// Error Handler Class
// ============================================================================

export class ErrorHandler {
    private errors: VisualError[] = [];
    private readonly maxErrors: number;
    private readonly logToConsole: boolean;
    private readonly onError?: (error: VisualError) => void;
    private readonly onCriticalError?: (error: VisualError) => void;

    constructor(options: ErrorHandlerOptions = {}) {
        this.maxErrors = options.maxErrors ?? 100;
        this.logToConsole = options.logToConsole ?? true;
        this.onError = options.onError;
        this.onCriticalError = options.onCriticalError;
    }

    /**
     * Handle an error with structured reporting
     * @param error - The error to handle
     * @param code - Error code for categorization
     * @param context - Additional context
     * @returns The structured VisualError object
     */
    handle(
        error: unknown,
        code: string,
        context?: Record<string, unknown>
    ): VisualError {
        const visualError: VisualError = {
            code,
            message: this.extractMessage(error),
            severity: this.determineSeverity(code),
            context,
            timestamp: new Date(),
            stack: error instanceof Error ? error.stack : undefined,
            reported: false
        };

        // Add to error history
        this.errors.push(visualError);
        if (this.errors.length > this.maxErrors) {
            this.errors.shift();
        }

        // Log to console if enabled
        if (this.logToConsole) {
            this.logError(visualError);
        }

        // Trigger callbacks
        this.onError?.(visualError);
        if (visualError.severity === ErrorSeverity.Critical) {
            this.onCriticalError?.(visualError);
        }

        return visualError;
    }

    /**
     * Log a warning (non-blocking issue)
     */
    warn(code: string, message: string, context?: Record<string, unknown>): VisualError {
        return this.handle(new Error(message), code.startsWith('WARN_') ? code : `WARN_${code}`, context);
    }

    /**
     * Extract a message from various error types
     */
    private extractMessage(error: unknown): string {
        if (error instanceof Error) return error.message;
        if (typeof error === 'string') return error;
        if (error && typeof error === 'object' && 'message' in error) {
            return String((error as { message: unknown }).message);
        }
        return 'An unknown error occurred';
    }

    /**
     * Determine error severity based on error code
     */
    private determineSeverity(code: string): ErrorSeverity {
        if (code.startsWith('CRITICAL_')) return ErrorSeverity.Critical;
        if (code.startsWith('WARN_')) return ErrorSeverity.Warning;
        return ErrorSeverity.Error;
    }

    /**
     * Log error to console with appropriate level
     */
    private logError(error: VisualError): void {
        const prefix = `[${error.code}]`;
        const contextStr = error.context ? JSON.stringify(error.context) : '';

        switch (error.severity) {
            case ErrorSeverity.Critical:
                console.error(`🚨 ${prefix} CRITICAL: ${error.message}`, contextStr);
                break;
            case ErrorSeverity.Warning:
                console.warn(`⚠️ ${prefix} ${error.message}`, contextStr);
                break;
            default:
                console.error(`❌ ${prefix} ${error.message}`, contextStr);
        }
    }

    /**
     * Get user-friendly message for an error
     */
    getUserFriendlyMessage(error: VisualError): string {
        const messages: Record<string, string> = {
            // Data errors
            [ERROR_CODES.ERR_DATA_MISSING]: 'Required data is missing. Please check that all required fields are mapped.',
            [ERROR_CODES.ERR_DATA_PROCESSING]: 'Error processing data. Please verify your data format is correct.',
            [ERROR_CODES.ERR_DATA_VALIDATION]: 'Data validation failed. Some values may be invalid or out of range.',
            [ERROR_CODES.ERR_CIRCULAR_DEPENDENCY]: 'Circular dependency detected in task relationships.',

            // Rendering errors
            [ERROR_CODES.ERR_RENDER_FAILED]: 'Visualization could not be rendered. Try refreshing the page.',
            [ERROR_CODES.ERR_CANVAS_CONTEXT]: 'Unable to initialize canvas rendering. Your browser may not support this feature.',
            [ERROR_CODES.ERR_SVG_CREATION]: 'Unable to create SVG elements. Try refreshing the page.',
            [ERROR_CODES.ERR_SCALE_CREATION]: 'Unable to create time scale. Check that dates are valid.',

            // Export errors
            [ERROR_CODES.ERR_PDF_EXPORT]: 'Unable to export PDF. Try using Power BI Service instead of Desktop.',
            [ERROR_CODES.ERR_CLIPBOARD_EXPORT]: 'Unable to copy to clipboard. Your browser may have blocked this action.',

            // Critical errors
            [ERROR_CODES.CRITICAL_NO_MEMORY]: 'Not enough memory to display this data. Try reducing the dataset size.',
            [ERROR_CODES.CRITICAL_BROWSER_COMPAT]: 'Your browser does not support required features. Please use a modern browser.',

            // Warnings
            [ERROR_CODES.WARN_TRUNCATED_DATA]: 'Data has been truncated due to Power BI limits. Some tasks may not be shown.',
            [ERROR_CODES.WARN_MISSING_DATES]: 'Some tasks are missing dates and cannot be displayed.',
            [ERROR_CODES.WARN_INVALID_RELATIONSHIP]: 'Some task relationships are invalid and have been skipped.'
        };

        return messages[error.code] || error.message;
    }

    /**
     * Get recent errors for debugging
     */
    getRecentErrors(count: number = 10): VisualError[] {
        return this.errors.slice(-count);
    }

    /**
     * Get all errors of a specific severity
     */
    getErrorsBySeverity(severity: ErrorSeverity): VisualError[] {
        return this.errors.filter(e => e.severity === severity);
    }

    /**
     * Check if there are any critical errors
     */
    hasCriticalErrors(): boolean {
        return this.errors.some(e => e.severity === ErrorSeverity.Critical && !e.reported);
    }

    /**
     * Mark an error as reported to the user
     */
    markAsReported(error: VisualError): void {
        error.reported = true;
    }

    /**
     * Clear all errors
     */
    clear(): void {
        this.errors = [];
    }

    /**
     * Get error count by severity
     */
    getErrorCounts(): Record<ErrorSeverity, number> {
        return {
            [ErrorSeverity.Warning]: this.errors.filter(e => e.severity === ErrorSeverity.Warning).length,
            [ErrorSeverity.Error]: this.errors.filter(e => e.severity === ErrorSeverity.Error).length,
            [ErrorSeverity.Critical]: this.errors.filter(e => e.severity === ErrorSeverity.Critical).length
        };
    }

    /**
     * Create a debug report for support purposes
     */
    createDebugReport(): string {
        const counts = this.getErrorCounts();
        const recentErrors = this.getRecentErrors(20);

        return [
            '=== LongestPathVisual Error Report ===',
            `Generated: ${new Date().toISOString()}`,
            '',
            `Error Summary:`,
            `  Warnings: ${counts[ErrorSeverity.Warning]}`,
            `  Errors: ${counts[ErrorSeverity.Error]}`,
            `  Critical: ${counts[ErrorSeverity.Critical]}`,
            '',
            'Recent Errors:',
            ...recentErrors.map(e =>
                `  [${e.timestamp.toISOString()}] ${e.code}: ${e.message}`
            ),
            '',
            '=== End Report ==='
        ].join('\n');
    }
}

// ============================================================================
// Singleton Instance (optional, for global access)
// ============================================================================

let globalErrorHandler: ErrorHandler | null = null;

export function getGlobalErrorHandler(): ErrorHandler {
    if (!globalErrorHandler) {
        globalErrorHandler = new ErrorHandler();
    }
    return globalErrorHandler;
}

export function setGlobalErrorHandler(handler: ErrorHandler): void {
    globalErrorHandler = handler;
}
