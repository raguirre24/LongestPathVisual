/**
 * ClipboardExporter - Handles exporting task data to clipboard in TSV and HTML formats
 * Supports both flat (WBS OFF) and hierarchical (WBS ON) export modes
 * Also supports WBS-only export when tasks are not visible
 */

import { Task, WBSGroup } from '../data/Interfaces';
import * as d3 from 'd3';

/** Set to true to enable debug logging for clipboard operations */
const DEBUG = false;

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

/** Colors for WBS level group headers */
const WBS_COLORS = ['#d0f0c0', '#fffacd', '#e0ffff', '#ffcccb', '#d3d3d3']; // Green, Yellow, Cyan, Red, Gray

/**
 * Exports task data to clipboard in both TSV (for plain text) and HTML (for rich paste) formats
 */
/**
 * Exports task data to clipboard in both TSV (for plain text) and HTML (for rich paste) formats
 */
export async function exportToClipboard(config: ClipboardExportConfig): Promise<void> {
    const { tasks, showWbs, showBaseline, showPreviousUpdate, wbsGroupDates, visibleWbsGroups, areTasksVisible, onSuccess, onError } = config;

    try {
        // Format as DD-Mon-YY (e.g., "16-Jun-26") for consistent display
        const dateFormatter = d3.timeFormat("%d-%b-%y");

        // WBS-only export mode: When WBS is enabled but no tasks are visible
        if (showWbs && areTasksVisible === false && visibleWbsGroups && visibleWbsGroups.length > 0) {
            if (DEBUG) console.log("[ClipboardExporter] WBS-only mode: Exporting visible WBS groups without tasks");

            const { tsvContent, htmlContent } = generateWbsOnlyContent(visibleWbsGroups, dateFormatter);
            await copyToClipboard(tsvContent, htmlContent, visibleWbsGroups.length, onSuccess, onError);
            return;
        }

        // Standard export mode: Export tasks
        if (!tasks || tasks.length === 0) {
            console.warn("[ClipboardExporter] No tasks to export.");
            return;
        }

        // Calculate max WBS depth
        const maxWbsDepth = tasks.reduce((max, task) => Math.max(max, task.wbsLevels?.length || 0), 0);

        // Generate TSV content (always flat)
        const tsvContent = generateTsvContent(tasks, maxWbsDepth, showBaseline, showPreviousUpdate, dateFormatter);

        // Generate HTML content (hierarchical if WBS on, flat otherwise)
        const htmlContent = generateHtmlContent(tasks, maxWbsDepth, showWbs, showBaseline, showPreviousUpdate, dateFormatter, wbsGroupDates);

        // Copy to clipboard
        await copyToClipboard(tsvContent, htmlContent, tasks.length, onSuccess, onError);

    } catch (error) {
        console.error('[ClipboardExporter] Error exporting data:', error);
        onError?.(error as Error);
    }
}

// ... (keep generateTsvContent and generateHtmlContent as is, they are pure functions) ...

/**
 * Generates TSV content for plain text clipboard (always flat format)
 */
function generateTsvContent(
    tasks: Task[],
    maxWbsDepth: number,
    showBaseline: boolean,
    showPreviousUpdate: boolean,
    dateFormatter: (date: Date) => string
): string {
    // Build headers
    const headers = ["Index", "Task ID", "Task Name", "Task Type"];
    if (showBaseline) headers.push("Baseline Start", "Baseline Finish");
    if (showPreviousUpdate) headers.push("Previous Start", "Previous Finish");
    headers.push("Start Date", "Finish Date", "Duration", "Total Float", "Is Critical");
    for (let i = 0; i < maxWbsDepth; i++) headers.push(`WBS Level ${i + 1}`);

    // Build rows
    const rows = tasks.map((task, index) => {
        const taskType = (task.duration === 0) ? "Milestone" : "Activity";
        const row = [
            (index + 1).toString(),
            task.id?.toString() || "",
            task.name?.replace(/\t/g, " ") || "",
            taskType
        ];

        if (showBaseline) {
            row.push(
                task.baselineStartDate ? dateFormatter(task.baselineStartDate) : "",
                task.baselineFinishDate ? dateFormatter(task.baselineFinishDate) : ""
            );
        }
        if (showPreviousUpdate) {
            row.push(
                task.previousUpdateStartDate ? dateFormatter(task.previousUpdateStartDate) : "",
                task.previousUpdateFinishDate ? dateFormatter(task.previousUpdateFinishDate) : ""
            );
        }

        // Use user-provided float if available
        const totalFloat = task.userProvidedTotalFloat !== undefined && !isNaN(task.userProvidedTotalFloat)
            ? task.userProvidedTotalFloat
            : task.totalFloat;
        const isCritical = task.userProvidedTotalFloat !== undefined && !isNaN(task.userProvidedTotalFloat)
            ? task.userProvidedTotalFloat <= 0
            : task.isCritical;

        row.push(
            task.startDate ? dateFormatter(task.startDate) : "",
            task.finishDate ? dateFormatter(task.finishDate) : "",
            task.duration?.toString() || "0",
            totalFloat?.toString() || "0",
            isCritical ? "Yes" : "No"
        );

        // Add WBS levels
        for (let i = 0; i < maxWbsDepth; i++) {
            row.push(task.wbsLevels?.[i] || "");
        }

        return row;
    });

    return [headers, ...rows].map(row => row.join('\t')).join('\n');
}

/**
 * Generates HTML table content for rich clipboard paste
 * When showWbs is true, creates hierarchical layout with colored group headers
 */
function generateHtmlContent(
    tasks: Task[],
    maxWbsDepth: number,
    showWbs: boolean,
    showBaseline: boolean,
    showPreviousUpdate: boolean,
    dateFormatter: (date: Date) => string,
    wbsGroupDates?: Map<string, {
        start: Date | null;
        finish: Date | null;
        baselineStart?: Date | null;
        baselineFinish?: Date | null;
        previousUpdateStart?: Date | null;
        previousUpdateFinish?: Date | null;
    }>
): string {
    // Build headers
    const headers = ["Index", "Task ID", "Task Name", "Task Type"];
    if (showBaseline) headers.push("Baseline Start", "Baseline Finish");
    if (showPreviousUpdate) headers.push("Previous Start", "Previous Finish");
    headers.push("Start Date", "Finish Date", "Duration", "Total Float", "Is Critical");

    // Add WBS columns only if toggle is OFF (flat mode)
    if (!showWbs) {
        for (let i = 0; i < maxWbsDepth; i++) headers.push(`WBS Level ${i + 1}`);
    }

    // Start table
    let html = `<table border="1" style="border-collapse: collapse; width: 100%; font-family: 'Segoe UI', sans-serif; font-size: 11px; white-space: nowrap;">`;
    html += `<tr style="background-color: #f0f0f0; font-weight: bold; text-align: center;">${headers.map(h => `<th style="padding: 4px; white-space: nowrap;">${h}</th>`).join("")}</tr>`;

    let previousLevels: string[] = [];

    // Calculate column indices for data injection
    // Base indices: Index(0), ID(1), Name(2), Type(3)
    let colIndex = 4;
    // Skip optional columns
    if (showBaseline) colIndex += 2;
    if (showPreviousUpdate) colIndex += 2;
    // Start Date is at colIndex, Finish Date is at colIndex + 1
    // The group name spans from column 2 (Name) up to start date column
    // Columns to cover: Name, Type, + optionals
    // Count = (startDateIndex) - 2
    const nameColSpan = colIndex - 2;

    // Remaining columns after finish date: Duration, Float, Critical
    // Total cols = headers.length
    // Start/Finish take 2 cols
    // Remaining = Total - (colIndex + 2)
    const trailColSpan = headers.length - (colIndex + 2);

    // Generate rows
    tasks.forEach((task, index) => {
        const currentLevels = task.wbsLevels || [];

        // When WBS is on, insert group header rows when hierarchy changes
        if (showWbs) {
            // Find where hierarchy diverges from previous task
            let divergenceIndex = 0;
            while (divergenceIndex < previousLevels.length &&
                divergenceIndex < currentLevels.length &&
                previousLevels[divergenceIndex] === currentLevels[divergenceIndex]) {
                divergenceIndex++;
            }

            // Render group headers for new WBS levels
            for (let i = divergenceIndex; i < currentLevels.length; i++) {
                const indent = i * 15;
                const color = WBS_COLORS[i % WBS_COLORS.length];
                const groupName = currentLevels[i];

                // Reconstruct the WBS Path ID used in DataProcessor
                // Format: L1:Name|L2:Name...
                const pathParts: string[] = [];
                for (let j = 0; j <= i; j++) {
                    pathParts.push(`L${j + 1}:${currentLevels[j]}`);
                }
                const pathId = pathParts.join('|');

                let startText = "";
                let finishText = "";
                let baselineStartText = "";
                let baselineFinishText = "";
                let previousStartText = "";
                let previousFinishText = "";

                if (wbsGroupDates && wbsGroupDates.has(pathId)) {
                    const dates = wbsGroupDates.get(pathId);
                    if (dates) {
                        startText = dates.start ? dateFormatter(dates.start) : "";
                        finishText = dates.finish ? dateFormatter(dates.finish) : "";
                        baselineStartText = dates.baselineStart ? dateFormatter(dates.baselineStart) : "";
                        baselineFinishText = dates.baselineFinish ? dateFormatter(dates.baselineFinish) : "";
                        previousStartText = dates.previousUpdateStart ? dateFormatter(dates.previousUpdateStart) : "";
                        previousFinishText = dates.previousUpdateFinish ? dateFormatter(dates.previousUpdateFinish) : "";
                    }
                }

                html += `<tr style="background-color: ${color}; font-weight: bold;">`;
                html += `<td></td><td></td>`; // Skip Index and ID

                // Group Name Span: Just Name and Type (2 cols)
                // We do NOT span over Baseline/Previous columns if they are present, because we want to show data there.
                // However, if we are NOT showing them, we might want to span?
                // Actually, the structure assumes columns are present.
                // Typically WBS headers span Name + Type.
                html += `<td colspan="2" style="padding-left: ${indent}px; white-space: nowrap;">${groupName}</td>`;

                if (showBaseline) {
                    html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${baselineStartText}</td>`;
                    html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${baselineFinishText}</td>`;
                }
                if (showPreviousUpdate) {
                    html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${previousStartText}</td>`;
                    html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${previousFinishText}</td>`;
                }

                // Start Date
                html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${startText}</td>`;

                // Finish Date
                html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${finishText}</td>`;

                // Trailing columns (Duration, Float, Critical) - currently empty for groups
                if (trailColSpan > 0) {
                    html += `<td colspan="${trailColSpan}"></td>`;
                }

                html += `</tr>`;
            }
            previousLevels = currentLevels;
        }

        // Render task row
        const taskType = (task.duration === 0) ? "Milestone" : "Activity";
        const indent = showWbs ? currentLevels.length * 15 : 0;

        html += `<tr>`;
        html += `<td style="text-align: right; padding: 2px; white-space: nowrap;">${index + 1}</td>`;
        html += `<td style="padding: 2px; white-space: nowrap;">${task.id || ""}</td>`;
        html += `<td style="padding: 2px; padding-left: ${indent}px; white-space: nowrap;">${task.name || ""}</td>`;
        html += `<td style="padding: 2px; white-space: nowrap;">${taskType}</td>`;

        if (showBaseline) {
            html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${task.baselineStartDate ? dateFormatter(task.baselineStartDate) : ""}</td>`;
            html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${task.baselineFinishDate ? dateFormatter(task.baselineFinishDate) : ""}</td>`;
        }
        if (showPreviousUpdate) {
            html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${task.previousUpdateStartDate ? dateFormatter(task.previousUpdateStartDate) : ""}</td>`;
            html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${task.previousUpdateFinishDate ? dateFormatter(task.previousUpdateFinishDate) : ""}</td>`;
        }

        // Use user-provided float if available
        const totalFloat = task.userProvidedTotalFloat !== undefined && !isNaN(task.userProvidedTotalFloat)
            ? task.userProvidedTotalFloat
            : task.totalFloat;
        const isCritical = task.userProvidedTotalFloat !== undefined && !isNaN(task.userProvidedTotalFloat)
            ? task.userProvidedTotalFloat <= 0
            : task.isCritical;

        html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${task.startDate ? dateFormatter(task.startDate) : ""}</td>`;
        html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${task.finishDate ? dateFormatter(task.finishDate) : ""}</td>`;
        html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${task.duration?.toString() || "0"}</td>`;
        html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${totalFloat?.toString() || "0"}</td>`;
        html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${isCritical ? "Yes" : "No"}</td>`;

        // Add WBS columns only if toggle is OFF (flat mode)
        if (!showWbs) {
            for (let i = 0; i < maxWbsDepth; i++) {
                html += `<td style="padding: 2px; white-space: nowrap;">${currentLevels[i] || ""}</td>`;
            }
        }

        html += `</tr>`;
    });

    html += `</table>`;
    return html;
}

/**
 * Generates TSV and HTML content for WBS-only export mode
 * Used when WBS is enabled but no tasks are visible (groups are collapsed)
 */
function generateWbsOnlyContent(
    visibleWbsGroups: WBSGroup[],
    dateFormatter: (date: Date) => string
): { tsvContent: string; htmlContent: string } {
    // Sort groups by yOrder to maintain visual display order
    const sortedGroups = [...visibleWbsGroups].sort((a, b) => (a.yOrder ?? 0) - (b.yOrder ?? 0));

    // Determine if we have baseline/previous data in any group to justify showing columns?
    // Actually, checking if any group has it is one way, but visual usually passes flags.
    // The visual uses showBaseline/showPreviousUpdate flags in standard export.
    // But here 'generateWbsOnlyContent' doesn't receive them. We should probably infer or modify signature.
    // However, to keep it simple and safe for now without refactoring everything:
    // We can check if *any* group has these dates.
    const hasBaseline = sortedGroups.some(g => g.summaryBaselineStartDate || g.summaryBaselineFinishDate);
    const hasPrevious = sortedGroups.some(g => g.summaryPreviousUpdateStartDate || g.summaryPreviousUpdateFinishDate);

    // TSV Headers
    const tsvHeaders = ["Index", "WBS Name"];
    if (hasBaseline) tsvHeaders.push("Baseline Start", "Baseline Finish");
    if (hasPrevious) tsvHeaders.push("Previous Start", "Previous Finish");
    tsvHeaders.push("Start Date", "Finish Date");

    const tsvRows: string[][] = [];

    // HTML Headers
    let html = `<table border="1" style="border-collapse: collapse; width: 100%; font-family: 'Segoe UI', sans-serif; font-size: 11px; white-space: nowrap;">`;
    html += `<tr style="background-color: #f0f0f0; font-weight: bold; text-align: center;">`;
    html += `<th style="padding: 4px; white-space: nowrap;">Index</th>`;
    html += `<th style="padding: 4px; white-space: nowrap;">WBS Name</th>`;
    if (hasBaseline) {
        html += `<th style="padding: 4px; white-space: nowrap;">Baseline Start</th>`;
        html += `<th style="padding: 4px; white-space: nowrap;">Baseline Finish</th>`;
    }
    if (hasPrevious) {
        html += `<th style="padding: 4px; white-space: nowrap;">Previous Start</th>`;
        html += `<th style="padding: 4px; white-space: nowrap;">Previous Finish</th>`;
    }
    html += `<th style="padding: 4px; white-space: nowrap;">Start Date</th>`;
    html += `<th style="padding: 4px; white-space: nowrap;">Finish Date</th>`;
    html += `</tr>`;

    sortedGroups.forEach((group, index) => {
        const indent = (group.level - 1) * 15;
        const color = WBS_COLORS[(group.level - 1) % WBS_COLORS.length];
        const startText = group.summaryStartDate ? dateFormatter(group.summaryStartDate) : "";
        const finishText = group.summaryFinishDate ? dateFormatter(group.summaryFinishDate) : "";

        const baselineStartText = group.summaryBaselineStartDate ? dateFormatter(group.summaryBaselineStartDate) : "";
        const baselineFinishText = group.summaryBaselineFinishDate ? dateFormatter(group.summaryBaselineFinishDate) : "";
        const previousStartText = group.summaryPreviousUpdateStartDate ? dateFormatter(group.summaryPreviousUpdateStartDate) : "";
        const previousFinishText = group.summaryPreviousUpdateFinishDate ? dateFormatter(group.summaryPreviousUpdateFinishDate) : "";

        // TSV row
        const row = [
            (index + 1).toString(),
            group.name
        ];
        if (hasBaseline) row.push(baselineStartText, baselineFinishText);
        if (hasPrevious) row.push(previousStartText, previousFinishText);
        row.push(startText, finishText);

        tsvRows.push(row);

        // HTML row
        html += `<tr style="background-color: ${color}; font-weight: bold;">`;
        html += `<td style="text-align: right; padding: 2px; white-space: nowrap;">${index + 1}</td>`;
        html += `<td style="padding: 2px; padding-left: ${indent}px; white-space: nowrap;">${group.name}</td>`;

        if (hasBaseline) {
            html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${baselineStartText}</td>`;
            html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${baselineFinishText}</td>`;
        }
        if (hasPrevious) {
            html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${previousStartText}</td>`;
            html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${previousFinishText}</td>`;
        }

        html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${startText}</td>`;
        html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${finishText}</td>`;
        html += `</tr>`;
    });

    html += `</table>`;

    const tsvContent = [tsvHeaders, ...tsvRows].map(row => row.join('\t')).join('\n');
    return { tsvContent, htmlContent: html };
}

/**
 * Copies content to clipboard using standard Async Clipboard API
 * Falls back to legacy execCommand for older environments (like some PBID)
 */
async function copyToClipboard(
    tsvContent: string,
    htmlContent: string,
    taskCount: number,
    onSuccess?: (count: number) => void,
    onError?: (error: Error) => void
): Promise<void> {

    // 1. Try Modern Async Clipboard API (for rich HTML + Text)
    if (navigator.clipboard && navigator.clipboard.write) {
        try {
            if (DEBUG) console.log("[ClipboardExporter] Using modern Async Clipboard API");

            // ClipboardItem requires Blob
            const textBlob = new Blob([tsvContent], { type: 'text/plain' });
            const htmlBlob = new Blob([htmlContent], { type: 'text/html' });

            const data = [new ClipboardItem({
                'text/plain': textBlob,
                'text/html': htmlBlob
            })];

            await navigator.clipboard.write(data);
            onSuccess?.(taskCount);
            return;

        } catch (err) {
            console.warn("[ClipboardExporter] Async copy failed (permission denied or unsupported type). Falling back to legacy.", err);
            // Fall through to legacy method
        }
    } else {
        if (DEBUG) console.log("[ClipboardExporter] Async Clipboard API not available. Using legacy fallback.");
    }

    // 2. Legacy Fallback: execCommand('copy')
    // Note: execCommand can only handle one format heavily dependent on context (usually text/plain in textarea, or formatted in contentEditable)
    // To support rich text fallback, we must use a contentEditable div.

    // Fallback A: Try HTML copy via 'copy' event interception (avoids innerHTML security warning)
    try {
        const handler = (e: ClipboardEvent) => {
            e.preventDefault();
            if (e.clipboardData) {
                e.clipboardData.setData('text/html', htmlContent);
                e.clipboardData.setData('text/plain', tsvContent); // Fallback text in same payload
            }
        };

        document.addEventListener('copy', handler);
        const successful = document.execCommand('copy');
        document.removeEventListener('copy', handler);

        if (successful) {
            if (DEBUG) console.log("[ClipboardExporter] Legacy copy via event listener successful");
            onSuccess?.(taskCount);
            return;
        } else {
            console.warn("[ClipboardExporter] Legacy copy event returned false");
        }
    } catch (e) {
        console.warn("[ClipboardExporter] Legacy copy method failed:", e);
    }

    // Fallback B: Try Plain Text copy via textarea (most robust last resort)
    let textArea: HTMLTextAreaElement | null = null;
    try {
        textArea = document.createElement("textarea");
        textArea.value = tsvContent;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        textArea.style.top = "0";
        document.body.appendChild(textArea);

        textArea.focus();
        textArea.select();

        const successful = document.execCommand('copy');
        if (successful) {
            if (DEBUG) console.log("[ClipboardExporter] Legacy Text copy successful");
            onSuccess?.(taskCount);
        } else {
            console.error("[ClipboardExporter] All clipbord copy methods failed.");
            onError?.(new Error("Clipboard copy failed"));
        }
    } catch (err) {
        console.error('[ClipboardExporter] Final fallback copy failed:', err);
        onError?.(err as Error);
    } finally {
        if (textArea && document.body.contains(textArea)) {
            document.body.removeChild(textArea);
        }
    }
}
