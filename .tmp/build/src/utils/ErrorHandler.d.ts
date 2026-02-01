/**
 * Comprehensive error handling utilities
 * Provides structured error reporting and user-friendly messages
 */
export declare enum ErrorSeverity {
    Warning = "warning",
    Error = "error",
    Critical = "critical"
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
export declare class ErrorHandler {
    private errors;
    private readonly maxErrors;
    private readonly logToConsole;
    private readonly onError?;
    private readonly onCriticalError?;
    constructor(options?: ErrorHandlerOptions);
    /**
     * Handle an error with structured reporting
     * @param error - The error to handle
     * @param code - Error code for categorization
     * @param context - Additional context
     * @returns The structured VisualError object
     */
    handle(error: unknown, code: string, context?: Record<string, unknown>): VisualError;
    /**
     * Log a warning (non-blocking issue)
     */
    warn(code: string, message: string, context?: Record<string, unknown>): VisualError;
    /**
     * Extract a message from various error types
     */
    private extractMessage;
    /**
     * Determine error severity based on error code
     */
    private determineSeverity;
    /**
     * Log error to console with appropriate level
     */
    private logError;
    /**
     * Get user-friendly message for an error
     */
    getUserFriendlyMessage(error: VisualError): string;
    /**
     * Get recent errors for debugging
     */
    getRecentErrors(count?: number): VisualError[];
    /**
     * Get all errors of a specific severity
     */
    getErrorsBySeverity(severity: ErrorSeverity): VisualError[];
    /**
     * Check if there are any critical errors
     */
    hasCriticalErrors(): boolean;
    /**
     * Mark an error as reported to the user
     */
    markAsReported(error: VisualError): void;
    /**
     * Clear all errors
     */
    clear(): void;
    /**
     * Get error count by severity
     */
    getErrorCounts(): Record<ErrorSeverity, number>;
    /**
     * Create a debug report for support purposes
     */
    createDebugReport(): string;
}
export declare function getGlobalErrorHandler(): ErrorHandler;
export declare function setGlobalErrorHandler(handler: ErrorHandler): void;
