import { describe, expect, it } from "vitest";

import type { Task, WBSGroup } from "../../src/data/Interfaces";
import {
    buildWbsDisplayProjection,
    normalizeWbsDisplaySelection,
    reconcileWbsDisplaySelection
} from "../../src/utils/WbsDisplayProjection";

function task(id: string, day: number, wbsLevels: string[]): Task {
    return {
        id,
        internalId: id,
        name: `Task ${id}`,
        type: "TT_Task",
        duration: 1,
        predecessorIds: [],
        relationshipTypes: {},
        relationshipLags: {},
        successors: [],
        predecessors: [],
        earlyStart: 0,
        earlyFinish: 0,
        lateStart: 0,
        lateFinish: 0,
        totalFloat: 0,
        isCritical: false,
        isLongestPath: false,
        startDate: new Date(Date.UTC(2026, 0, day)),
        finishDate: new Date(Date.UTC(2026, 0, day + 1)),
        wbsLevels,
        wbsIndentLevel: Math.max(0, wbsLevels.length - 1)
    };
}

function group(id: string, level: number, name: string, parentId: string | null = null): WBSGroup {
    return {
        id,
        level,
        name,
        fullPath: id,
        parentId,
        children: [],
        tasks: [],
        allTasks: [],
        isExpanded: false,
        visibleTaskCount: 0,
        hasCriticalTasks: false,
        taskCount: 0
    };
}

function attach(parent: WBSGroup, child: WBSGroup): void {
    parent.children.push(child);
}

function updateCounts(groupValue: WBSGroup): number {
    const childCount = groupValue.children.reduce((sum, child) => sum + updateCounts(child), 0);
    groupValue.taskCount = groupValue.tasks.length + childCount;
    groupValue.visibleTaskCount = groupValue.taskCount;
    return groupValue.taskCount;
}

function sortTasks(tasks: Task[]): Task[] {
    return [...tasks].sort((left, right) =>
        (left.startDate?.getTime() ?? 0) - (right.startDate?.getTime() ?? 0)
    );
}

describe("WbsDisplayProjection", () => {
    it("preserves normal hierarchical ordering and direct-task placement", () => {
        const root = group("L1:Project", 1, "Project");
        const area = group("L1:Project|L2:Area", 2, "Area", root.id);
        const trade = group("L1:Project|L2:Area|L3:Trade", 3, "Trade", area.id);
        attach(root, area);
        attach(area, trade);
        root.isExpanded = true;
        area.isExpanded = true;
        root.tasks = [task("ROOT", 3, ["Project"])];
        area.tasks = [task("AREA", 2, ["Project", "Area"])];
        trade.tasks = [task("TRADE", 1, ["Project", "Area", "Trade"])];
        updateCounts(root);

        const projection = buildWbsDisplayProjection({
            mode: "through",
            onlyLevel: null,
            rootGroups: [root],
            visibleTasks: [...root.tasks, ...area.tasks, ...trade.tasks],
            hideEmptyGroups: true,
            sortTasks
        });

        expect(projection.rows.map(row => row.kind === "group" ? row.group.name : row.task.internalId))
            .toEqual(["Project", "ROOT", "Area", "AREA", "Trade"]);
        expect(projection.taskIndentLevels.get("AREA")).toBe(1);
    });

    it("shows exactly the selected level and starts with summary rows only", () => {
        const root = group("R", 1, "Project");
        const area = group("R|A", 2, "Area", root.id);
        const trade = group("R|A|T", 3, "Trade", area.id);
        attach(root, area);
        attach(area, trade);
        trade.tasks = [task("T1", 1, ["Project", "Area", "Trade"])];
        updateCounts(root);

        const projection = buildWbsDisplayProjection({
            mode: "only",
            onlyLevel: 2,
            rootGroups: [root],
            visibleTasks: trade.tasks,
            hideEmptyGroups: true,
            sortTasks
        });

        expect(projection.groups.map(item => item.level)).toEqual([2]);
        expect(projection.groups.map(item => item.name)).toEqual(["Area"]);
        expect(projection.tasks).toEqual([]);
        expect(projection.groupIndentLevels.get(area.id)).toBe(0);
    });

    it("projects Level 1, a middle level, and the deepest level without ancestor or child headers", () => {
        const root = group("R", 1, "Project");
        const area = group("R|A", 2, "Area", root.id);
        const trade = group("R|A|T", 3, "Trade", area.id);
        attach(root, area);
        attach(area, trade);
        trade.tasks = [task("T1", 1, ["Project", "Area", "Trade"])];
        updateCounts(root);

        const expectedNames = new Map<number, string>([
            [1, "Project"],
            [2, "Area"],
            [3, "Trade"]
        ]);

        for (const selectedLevel of [1, 2, 3]) {
            const projection = buildWbsDisplayProjection({
                mode: "only",
                onlyLevel: selectedLevel,
                rootGroups: [root],
                visibleTasks: trade.tasks,
                hideEmptyGroups: true,
                sortTasks
            });

            expect(projection.groups.map(item => item.level)).toEqual([selectedLevel]);
            expect(projection.groups.map(item => item.name)).toEqual([expectedNames.get(selectedLevel)]);
            expect(projection.rows.every(row => row.kind === "group")).toBe(true);
        }
    });

    it("hides target groups emptied by filtering only when hide-empty is enabled", () => {
        const root = group("R", 1, "Project");
        const visibleArea = group("R|VISIBLE", 2, "Visible Area", root.id);
        const filteredArea = group("R|FILTERED", 2, "Filtered Area", root.id);
        attach(root, visibleArea);
        attach(root, filteredArea);
        visibleArea.tasks = [task("VISIBLE", 1, ["Project", "Visible Area"])];
        filteredArea.tasks = [task("FILTERED", 2, ["Project", "Filtered Area"])];
        updateCounts(root);
        filteredArea.visibleTaskCount = 0;

        const buildProjection = (hideEmptyGroups: boolean) => buildWbsDisplayProjection({
            mode: "only",
            onlyLevel: 2,
            rootGroups: [root],
            visibleTasks: visibleArea.tasks,
            hideEmptyGroups,
            sortTasks
        });

        expect(buildProjection(true).groups.map(item => item.name)).toEqual(["Visible Area"]);
        expect(buildProjection(false).groups.map(item => item.name)).toEqual(["Visible Area", "Filtered Area"]);
    });

    it("flattens and stably sorts all descendant activities under an expanded target group", () => {
        const root = group("R", 1, "Project");
        const area = group("R|A", 2, "Area", root.id);
        const trade = group("R|A|T", 3, "Trade", area.id);
        attach(root, area);
        attach(area, trade);
        area.isExpanded = true;
        area.tasks = [task("DIRECT", 4, ["Project", "Area"])];
        trade.tasks = [task("LATE", 7, ["Project", "Area", "Trade"]), task("EARLY", 2, ["Project", "Area", "Trade"])];
        updateCounts(root);

        const projection = buildWbsDisplayProjection({
            mode: "only",
            onlyLevel: 2,
            rootGroups: [root],
            visibleTasks: [...area.tasks, ...trade.tasks, trade.tasks[0]],
            hideEmptyGroups: true,
            sortTasks
        });

        expect(projection.tasks.map(item => item.internalId)).toEqual(["EARLY", "DIRECT", "LATE"]);
        expect(projection.tasks.every(item => projection.taskIndentLevels.get(item.internalId) === 1)).toBe(true);
        expect(projection.groups.map(item => item.level)).toEqual([2]);
    });

    it("adds ancestor breadcrumbs only for duplicate visible names", () => {
        const projectA = group("A", 1, "Project A");
        const projectB = group("B", 1, "Project B");
        const areaA = group("A|AREA", 2, "Shared Area", projectA.id);
        const areaB = group("B|AREA", 2, "Shared Area", projectB.id);
        attach(projectA, areaA);
        attach(projectB, areaB);
        areaA.tasks = [task("A1", 1, ["Project A", "Shared Area"])];
        areaB.tasks = [task("B1", 2, ["Project B", "Shared Area"])];
        updateCounts(projectA);
        updateCounts(projectB);

        const projection = buildWbsDisplayProjection({
            mode: "only",
            onlyLevel: 2,
            rootGroups: [projectA, projectB],
            visibleTasks: [...areaA.tasks, ...areaB.tasks],
            hideEmptyGroups: true,
            sortTasks
        });

        expect(projection.groups.map(item => projection.groupDisplayNames.get(item.id))).toEqual([
            "Project A › Shared Area",
            "Project B › Shared Area"
        ]);
    });

    it("places the target-level fallback last and expands its activities without duplication", () => {
        const root = group("R", 1, "Project");
        const area = group("R|A", 2, "Area", root.id);
        attach(root, area);
        area.tasks = [task("ASSIGNED", 4, ["Project", "Area"])];
        updateCounts(root);
        const shallow = task("SHALLOW", 2, ["Project"]);
        const unassigned = task("NONE", 1, []);
        const fallback = group("__FALLBACK_2__", 2, "No Level 2 WBS");
        fallback.isWbsLevelFallbackGroup = true;
        fallback.isExpanded = true;
        fallback.tasks = [shallow, unassigned];
        updateCounts(fallback);

        const projection = buildWbsDisplayProjection({
            mode: "only",
            onlyLevel: 2,
            rootGroups: [root, fallback],
            visibleTasks: [area.tasks[0], shallow, unassigned],
            hideEmptyGroups: true,
            sortTasks,
            fallbackGroup: fallback
        });

        expect(projection.groups.map(item => item.name)).toEqual(["Area", "No Level 2 WBS"]);
        expect(projection.tasks.map(item => item.internalId)).toEqual(["NONE", "SHALLOW"]);
    });

    it("keeps a pending host selection authoritative until persisted metadata acknowledges it", () => {
        const pending = normalizeWbsDisplaySelection("only", 3);
        const stale = reconcileWbsDisplaySelection(
            normalizeWbsDisplaySelection("through", 0),
            pending
        );
        const acknowledged = reconcileWbsDisplaySelection(
            normalizeWbsDisplaySelection("only", 3),
            stale.pending
        );

        expect(stale.selection).toEqual({ mode: "only", level: 3 });
        expect(stale.pending).toEqual(pending);
        expect(acknowledged.selection).toEqual(pending);
        expect(acknowledged.pending).toBeNull();
        expect(normalizeWbsDisplaySelection("only", 0)).toEqual({ mode: "through", level: null });
    });
});
