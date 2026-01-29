/**
 * Toast notification utility for displaying non-blocking feedback messages.
 * Replaces alert() dialogs with a modern, accessible notification system.
 */
export type ToastType = 'info' | 'success' | 'warning' | 'error';
interface ToastOptions {
    type?: ToastType;
    duration?: number;
    dismissible?: boolean;
}
/**
 * Shows a toast notification message.
 *
 * @param container - The HTML element to append the toast to
 * @param message - The message to display
 * @param options - Configuration options for the toast
 */
export declare function showToast(container: HTMLElement, message: string, options?: ToastOptions): void;
/**
 * Convenience methods for different toast types
 */
export declare const toast: {
    info: (container: HTMLElement, message: string, duration?: number) => void;
    success: (container: HTMLElement, message: string, duration?: number) => void;
    warning: (container: HTMLElement, message: string, duration?: number) => void;
    error: (container: HTMLElement, message: string, duration?: number) => void;
};
export {};
