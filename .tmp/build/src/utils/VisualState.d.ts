import { Task } from "../data/Interfaces";
export declare function normalizeLegendCategory(value: unknown): string | null;
export declare function parsePersistedLegendSelection(value: string | null | undefined): string[];
export declare function serializeLegendSelection(categories: Iterable<string>): string;
export declare function sanitizeExportTextField(value: unknown): string;
export declare function getExportTaskType(task: Partial<Pick<Task, "type" | "duration">>): string;
export declare function getExportFloatText(task: Pick<Task, "userProvidedTotalFloat">, fallback?: string): string;
