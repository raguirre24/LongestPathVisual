import type { Task, WBSGroup } from "../data/Interfaces";

export type WbsDisplayMode = "through" | "only";

export interface WbsDisplaySelection {
    mode: WbsDisplayMode;
    level: number | null;
}

export type WbsDisplayRow =
    | { kind: "group"; group: WBSGroup; indentLevel: number; displayName: string }
    | { kind: "task"; task: Task; ownerGroupId: string; indentLevel: number };

export interface WbsDisplayProjection {
    rows: WbsDisplayRow[];
    tasks: Task[];
    groups: WBSGroup[];
    taskIndentLevels: Map<string, number>;
    groupIndentLevels: Map<string, number>;
    groupDisplayNames: Map<string, string>;
}

export interface BuildWbsDisplayProjectionOptions {
    mode: WbsDisplayMode;
    onlyLevel: number | null;
    rootGroups: WBSGroup[];
    visibleTasks: Task[];
    hideEmptyGroups: boolean;
    sortTasks: (tasks: Task[]) => Task[];
    fallbackGroup?: WBSGroup;
}

export function normalizeWbsDisplaySelection(mode: unknown, level: unknown): WbsDisplaySelection {
    const numericLevel = Number(level);
    if (mode === "only" && Number.isFinite(numericLevel) && numericLevel >= 1) {
        return { mode: "only", level: Math.floor(numericLevel) };
    }
    return { mode: "through", level: null };
}

export function wbsDisplaySelectionsEqual(
    left: WbsDisplaySelection,
    right: WbsDisplaySelection
): boolean {
    return left.mode === right.mode && left.level === right.level;
}

export function reconcileWbsDisplaySelection(
    persisted: WbsDisplaySelection,
    pending: WbsDisplaySelection | null
): { selection: WbsDisplaySelection; pending: WbsDisplaySelection | null } {
    if (!pending) {
        return { selection: persisted, pending: null };
    }
    return {
        selection: pending,
        pending: wbsDisplaySelectionsEqual(persisted, pending) ? null : pending
    };
}

function collectGroupMap(rootGroups: WBSGroup[]): Map<string, WBSGroup> {
    const groups = new Map<string, WBSGroup>();
    const visit = (group: WBSGroup): void => {
        groups.set(group.id, group);
        group.children.forEach(visit);
    };
    rootGroups.forEach(visit);
    return groups;
}

function getGroupBreadcrumb(group: WBSGroup, groupMap: Map<string, WBSGroup>): string {
    const names: string[] = [];
    const visited = new Set<string>();
    let current: WBSGroup | undefined = group;
    while (current && !visited.has(current.id)) {
        visited.add(current.id);
        names.push(current.name);
        current = current.parentId ? groupMap.get(current.parentId) : undefined;
    }
    return names.reverse().join(" › ");
}

function isGroupEligible(group: WBSGroup, hideEmptyGroups: boolean): boolean {
    if (group.taskCount === 0) return false;
    return !hideEmptyGroups || group.visibleTaskCount > 0;
}

function collectVisibleDescendantTasks(
    group: WBSGroup,
    visibleTaskIds: Set<string>,
    collected: Map<string, Task>
): void {
    for (const task of group.tasks) {
        if (visibleTaskIds.has(task.internalId)) {
            collected.set(task.internalId, task);
        }
    }
    group.children.forEach(child => collectVisibleDescendantTasks(child, visibleTaskIds, collected));
}

export function buildWbsDisplayProjection(
    options: BuildWbsDisplayProjectionOptions
): WbsDisplayProjection {
    const rows: WbsDisplayRow[] = [];
    const tasks: Task[] = [];
    const groups: WBSGroup[] = [];
    const taskIndentLevels = new Map<string, number>();
    const groupIndentLevels = new Map<string, number>();
    const groupDisplayNames = new Map<string, string>();
    const visibleTaskIds = new Set(options.visibleTasks.map(task => task.internalId));

    const appendTask = (task: Task, ownerGroupId: string, indentLevel: number): void => {
        rows.push({ kind: "task", task, ownerGroupId, indentLevel });
        tasks.push(task);
        taskIndentLevels.set(task.internalId, indentLevel);
    };
    const appendGroup = (group: WBSGroup, indentLevel: number, displayName: string): void => {
        rows.push({ kind: "group", group, indentLevel, displayName });
        groups.push(group);
        groupIndentLevels.set(group.id, indentLevel);
        groupDisplayNames.set(group.id, displayName);
    };

    if (options.mode === "through" || options.onlyLevel === null) {
        const visit = (group: WBSGroup): void => {
            if (!isGroupEligible(group, options.hideEmptyGroups)) return;

            appendGroup(group, Math.max(0, group.level - 1), group.name);
            if (!group.isExpanded) return;

            const directTasks = options.sortTasks(
                group.tasks.filter(task => visibleTaskIds.has(task.internalId))
            );
            directTasks.forEach(task => appendTask(
                task,
                group.id,
                Math.max(0, task.wbsIndentLevel ?? (task.wbsLevels?.length ?? 1) - 1)
            ));
            group.children.forEach(visit);
        };

        options.rootGroups.forEach(visit);
        return { rows, tasks, groups, taskIndentLevels, groupIndentLevels, groupDisplayNames };
    }

    const targetGroups: WBSGroup[] = [];
    const collectTargetGroups = (group: WBSGroup): void => {
        if (group.isWbsLevelFallbackGroup) return;
        if (group.level === options.onlyLevel) {
            if (isGroupEligible(group, options.hideEmptyGroups)) {
                targetGroups.push(group);
            }
            return;
        }
        group.children.forEach(collectTargetGroups);
    };
    options.rootGroups.forEach(collectTargetGroups);

    const nameCounts = new Map<string, number>();
    targetGroups.forEach(group => {
        const key = group.name.trim().toLocaleLowerCase();
        nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    });
    const groupMap = collectGroupMap(options.rootGroups);

    const appendOnlyLevelGroup = (group: WBSGroup, displayName: string): void => {
        appendGroup(group, 0, displayName);
        if (!group.isExpanded) return;

        const collected = new Map<string, Task>();
        collectVisibleDescendantTasks(group, visibleTaskIds, collected);
        options.sortTasks(Array.from(collected.values()))
            .forEach(task => appendTask(task, group.id, 1));
    };

    targetGroups.forEach(group => {
        const key = group.name.trim().toLocaleLowerCase();
        const displayName = (nameCounts.get(key) ?? 0) > 1
            ? getGroupBreadcrumb(group, groupMap)
            : group.name;
        appendOnlyLevelGroup(group, displayName);
    });

    if (options.fallbackGroup && isGroupEligible(options.fallbackGroup, options.hideEmptyGroups)) {
        appendOnlyLevelGroup(options.fallbackGroup, options.fallbackGroup.name);
    }

    return { rows, tasks, groups, taskIndentLevels, groupIndentLevels, groupDisplayNames };
}
