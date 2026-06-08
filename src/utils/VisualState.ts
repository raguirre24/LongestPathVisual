import { Task } from "../data/Interfaces";

const MILESTONE_TASK_TYPES = new Set(["TT_Mile", "TT_FinMile"]);

export function normalizeLegendCategory(value: unknown): string | null {
    if (value == null) {
        return null;
    }

    const rawValue = String(value);
    return rawValue.trim().length > 0 ? rawValue : null;
}

export function parsePersistedLegendSelection(value: string | null | undefined): string[] {
    if (!value || value.trim().length === 0) {
        return [];
    }

    const trimmed = value.trim();
    try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) {
            return parsed
                .map(entry => normalizeLegendCategory(entry))
                .filter((entry): entry is string => entry !== null);
        }
    } catch {
        // Fall back to the legacy comma-separated format below.
    }

    return trimmed
        .split(",")
        .map(entry => {
            const legacyValue = entry.trim();
            return legacyValue.length > 0 ? legacyValue : null;
        })
        .filter((entry): entry is string => entry !== null);
}

export function serializeLegendSelection(categories: Iterable<string>): string {
    return JSON.stringify(
        Array.from(categories)
            .map(category => normalizeLegendCategory(category))
            .filter((category): category is string => category !== null)
    );
}

export type LegendSortOrder = "none" | "ascending" | "descending";

function uniqueLegendCategories(categories: Iterable<string>): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const category of categories) {
        const normalized = normalizeLegendCategory(category);
        if (normalized === null || seen.has(normalized)) {
            continue;
        }

        seen.add(normalized);
        result.push(normalized);
    }

    return result;
}

export function buildStableLegendCategoryOrder(
    currentCategories: Iterable<string>,
    previousCategories: Iterable<string>,
    sortOrder: LegendSortOrder = "none"
): string[] {
    const merged = uniqueLegendCategories([
        ...uniqueLegendCategories(previousCategories),
        ...uniqueLegendCategories(currentCategories)
    ]);

    if (sortOrder === "ascending") {
        return [...merged].sort((a, b) => a.localeCompare(b));
    }

    if (sortOrder === "descending") {
        return [...merged].sort((a, b) => b.localeCompare(a));
    }

    return merged;
}

export function sanitizeExportTextField(value: unknown): string {
    return String(value ?? "")
        .replace(/[\t\r\n]+/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
}

export function getExportTaskType(task: Partial<Pick<Task, "type" | "duration">>): string {
    const taskType = typeof task.type === "string" ? task.type.trim() : "";
    if (taskType.length > 0) {
        return MILESTONE_TASK_TYPES.has(taskType) ? "Milestone" : "Activity";
    }

    return task.duration === 0 ? "Milestone" : "Activity";
}

export function getExportFloatText(task: Pick<Task, "userProvidedTotalFloat">, fallback: string = ""): string {
    return Number.isFinite(task.userProvidedTotalFloat) ? String(task.userProvidedTotalFloat) : fallback;
}
