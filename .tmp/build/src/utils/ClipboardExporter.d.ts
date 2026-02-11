/**
 * ClipboardExporter - Handles exporting task data to clipboard in TSV and HTML formats
 * Supports both flat (WBS OFF) and hierarchical (WBS ON) export modes
 * Also supports WBS-only export when tasks are not visible
 */
import { Task, WBSGroup } from '../data/Interfaces';
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
    /** Map of WBS Group ID to summary dates */
    wbsGroupDates?: Map<string, {
        start: Date | null;
        finish: Date | null;
        baselineStart?: Date | null;
        baselineFinish?: Date | null;
        previousUpdateStart?: Date | null;
        previousUpdateFinish?: Date | null;
    }>;
    /** Visible WBS groups when no tasks are shown (WBS-only export mode) */
    visibleWbsGroups?: WBSGroup[];
    /** Whether any tasks are currently visible on screen */
    areTasksVisible?: boolean;
    /** Callback when copy succeeds */
    onSuccess?: (count: number) => void;
    /** Callback when copy fails */
    onError?: (error: Error) => void;
}
/**
 * Exports task data to clipboard in both TSV (for plain text) and HTML (for rich paste) formats
 */
/**
 * Exports task data to clipboard in both TSV (for plain text) and HTML (for rich paste) formats
 */
export declare function exportToClipboard(config: ClipboardExportConfig): Promise<void>;
