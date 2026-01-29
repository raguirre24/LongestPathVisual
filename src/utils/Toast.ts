/**
 * Toast notification utility for displaying non-blocking feedback messages.
 * Replaces alert() dialogs with a modern, accessible notification system.
 */

import * as d3 from 'd3';
import { UI_TOKENS } from './Theme';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

interface ToastOptions {
    type?: ToastType;
    duration?: number;
    dismissible?: boolean;
}

const TOAST_COLORS: Record<ToastType, { bg: string; border: string; text: string }> = {
    info: {
        bg: UI_TOKENS.color.primary.light,
        border: UI_TOKENS.color.primary.default,
        text: UI_TOKENS.color.neutral.grey160
    },
    success: {
        bg: UI_TOKENS.color.success.light,
        border: UI_TOKENS.color.success.default,
        text: UI_TOKENS.color.neutral.grey160
    },
    warning: {
        bg: UI_TOKENS.color.warning.light,
        border: UI_TOKENS.color.warning.default,
        text: UI_TOKENS.color.neutral.grey160
    },
    error: {
        bg: UI_TOKENS.color.danger.light,
        border: UI_TOKENS.color.danger.default,
        text: UI_TOKENS.color.neutral.grey160
    }
};

const TOAST_ICONS: Record<ToastType, string> = {
    info: 'M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm.93 11v1H6.93v-1h2zm-2.97-2.65c0-1.4.67-1.85 1.54-2.28.6-.3.83-.53.83-.97 0-.48-.44-.87-1.42-.87-.82 0-1.28.32-1.57.57l-.87-1.05c.5-.5 1.34-1.02 2.76-1.02 1.93 0 2.9 1.15 2.9 2.22 0 1.25-.66 1.7-1.48 2.12-.66.33-.87.6-.87 1.15v.13h-1.81z',
    success: 'M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm3.97 5.03L7.5 10.97l-2.47-2.5.94-.94 1.53 1.56 3.53-3.59.94.53z',
    warning: 'M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm-.5 3h1v6h-1V3zm.5 8a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5z',
    error: 'M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm3.54 10.46l-1.08 1.08L8 9.08l-2.46 2.46-1.08-1.08L6.92 8 4.46 5.54l1.08-1.08L8 6.92l2.46-2.46 1.08 1.08L9.08 8l2.46 2.46z'
};

/**
 * Shows a toast notification message.
 *
 * @param container - The HTML element to append the toast to
 * @param message - The message to display
 * @param options - Configuration options for the toast
 */
export function showToast(
    container: HTMLElement,
    message: string,
    options: ToastOptions = {}
): void {
    const {
        type = 'info',
        duration = 5000,
        dismissible = true
    } = options;

    // Remove any existing toast
    const existingToast = d3.select(container).select('.cpm-toast');
    if (!existingToast.empty()) {
        existingToast.remove();
    }

    const colors = TOAST_COLORS[type];
    const iconPath = TOAST_ICONS[type];

    const toast = d3.select(container)
        .append('div')
        .attr('class', 'cpm-toast')
        .attr('role', 'alert')
        .attr('aria-live', 'polite')
        .attr('aria-atomic', 'true')
        .style('position', 'absolute')
        .style('bottom', '20px')
        .style('left', '50%')
        .style('transform', 'translateX(-50%) translateY(20px)')
        .style('display', 'flex')
        .style('align-items', 'center')
        .style('gap', `${UI_TOKENS.spacing.sm}px`)
        .style('padding', `${UI_TOKENS.spacing.md}px ${UI_TOKENS.spacing.lg}px`)
        .style('background', colors.bg)
        .style('border', `1px solid ${colors.border}`)
        .style('border-left', `4px solid ${colors.border}`)
        .style('border-radius', `${UI_TOKENS.radius.medium}px`)
        .style('box-shadow', UI_TOKENS.shadow[16])
        .style('font-family', 'Segoe UI, sans-serif')
        .style('font-size', `${UI_TOKENS.fontSize.md}px`)
        .style('color', colors.text)
        .style('max-width', '80%')
        .style('z-index', '10000')
        .style('opacity', '0')
        .style('transition', `opacity ${UI_TOKENS.motion.duration.normal}ms ${UI_TOKENS.motion.easing.smooth}, transform ${UI_TOKENS.motion.duration.normal}ms ${UI_TOKENS.motion.easing.smooth}`);

    // Add icon
    const iconSvg = toast.append('svg')
        .attr('width', '16')
        .attr('height', '16')
        .attr('viewBox', '0 0 16 16')
        .attr('aria-hidden', 'true')
        .style('flex-shrink', '0');

    iconSvg.append('path')
        .attr('d', iconPath)
        .attr('fill', colors.border);

    // Add message
    toast.append('span')
        .style('flex', '1')
        .style('line-height', '1.4')
        .text(message);

    // Add dismiss button if dismissible
    if (dismissible) {
        const closeBtn = toast.append('button')
            .attr('type', 'button')
            .attr('aria-label', 'Dismiss notification')
            .style('background', 'none')
            .style('border', 'none')
            .style('cursor', 'pointer')
            .style('padding', '4px')
            .style('margin', '-4px')
            .style('margin-left', `${UI_TOKENS.spacing.sm}px`)
            .style('display', 'flex')
            .style('align-items', 'center')
            .style('justify-content', 'center')
            .style('border-radius', `${UI_TOKENS.radius.small}px`)
            .style('opacity', '0.7')
            .style('transition', `opacity ${UI_TOKENS.motion.duration.fast}ms`)
            .on('click', () => dismissToast(toast))
            .on('mouseover', function() { d3.select(this).style('opacity', '1'); })
            .on('mouseout', function() { d3.select(this).style('opacity', '0.7'); });

        closeBtn.append('svg')
            .attr('width', '12')
            .attr('height', '12')
            .attr('viewBox', '0 0 12 12')
            .append('path')
            .attr('d', 'M10.5 1.5l-9 9m0-9l9 9')
            .attr('stroke', colors.text)
            .attr('stroke-width', '1.5')
            .attr('stroke-linecap', 'round');
    }

    // Animate in
    requestAnimationFrame(() => {
        toast
            .style('opacity', '1')
            .style('transform', 'translateX(-50%) translateY(0)');
    });

    // Auto dismiss
    if (duration > 0) {
        setTimeout(() => dismissToast(toast), duration);
    }
}

function dismissToast(toast: d3.Selection<HTMLDivElement, unknown, null, undefined>): void {
    toast
        .style('opacity', '0')
        .style('transform', 'translateX(-50%) translateY(20px)');

    setTimeout(() => toast.remove(), UI_TOKENS.motion.duration.normal);
}

/**
 * Convenience methods for different toast types
 */
export const toast = {
    info: (container: HTMLElement, message: string, duration?: number) =>
        showToast(container, message, { type: 'info', duration }),

    success: (container: HTMLElement, message: string, duration?: number) =>
        showToast(container, message, { type: 'success', duration }),

    warning: (container: HTMLElement, message: string, duration?: number) =>
        showToast(container, message, { type: 'warning', duration }),

    error: (container: HTMLElement, message: string, duration?: number) =>
        showToast(container, message, { type: 'error', duration: duration ?? 8000 })
};
