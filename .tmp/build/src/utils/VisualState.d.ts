import { Task } from "../data/Interfaces";
export declare function parsePersistedLegendSelection(value: string | null | undefined): string[];
export declare function serializeLegendSelection(categories: Iterable<string>): string;
export declare function sanitizeExportTextField(value: unknown): string;
export declare function getExportTaskType(task: Pick<Task, "type">): string;
export declare function getExportFloatText(task: Pick<Task, "userProvidedTotalFloat">, fallback?: string): string;
