/**
 * ClipboardExporter - Handles exporting task data to clipboard in TSV and HTML formats
 * Supports both flat (WBS OFF) and hierarchical (WBS ON) export modes
 */
import { Task } from '../data/Interfaces';
/**
 * Configuration for clipboard export
 */
export interface ClipboardExportConfig {
    /** Tasks to export (should be pre-filtered and ordered) */
    tasks: Task[];
    /** Whether WBS hierarchical mode is enabled */
    showWbs: boolean;
    /** Whether to include baseline date columns */
    showBaseline: boolean;
    /** Whether to include previous update date columns */
    showPreviousUpdate: boolean;
    /** Callback when copy succeeds */
    onSuccess?: (count: number) => void;
    /** Callback when copy fails */
    onError?: (error: Error) => void;
}
/**
 * Exports task data to clipboard in both TSV (for plain text) and HTML (for rich paste) formats
 */
export declare function exportToClipboard(config: ClipboardExportConfig): void;
