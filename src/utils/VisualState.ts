import { Task } from "../data/Interfaces";

const MILESTONE_TASK_TYPES = new Set(["TT_Mile", "TT_FinMile"]);

export function parsePersistedLegendSelection(value: string | null | undefined): string[] {
    if (!value || value.trim().length === 0) {
        return [];
    }

    const trimmed = value.trim();
    try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) {
            return parsed
                .filter((entry): entry is string => typeof entry === "string")
                .map(entry => entry.trim())
                .filter(entry => entry.length > 0);
        }
    } catch {
        // Fall back to the legacy comma-separated format below.
    }

    return trimmed
        .split(",")
        .map(entry => entry.trim())
        .filter(entry => entry.length > 0);
}

export function serializeLegendSelection(categories: Iterable<string>): string {
    return JSON.stringify(
        Array.from(categories)
            .map(category => category.trim())
            .filter(category => category.length > 0)
    );
}

export function sanitizeExportTextField(value: unknown): string {
    return String(value ?? "")
        .replace(/[\t\r\n]+/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
}

export function getExportTaskType(task: Pick<Task, "type">): string {
    return MILESTONE_TASK_TYPES.has(task.type) ? "Milestone" : "Activity";
}

export function getExportFloatText(task: Pick<Task, "userProvidedTotalFloat">, fallback: string = ""): string {
    return Number.isFinite(task.userProvidedTotalFloat) ? String(task.userProvidedTotalFloat) : fallback;
}
