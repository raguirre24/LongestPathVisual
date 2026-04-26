import { describe, expect, it } from "vitest";

import {
    buildLabelColumnLayout,
    DEFAULT_LABEL_COLUMN_PADDING,
    DEFAULT_MIN_TIMELINE_WIDTH,
    LabelColumnSpec,
    MIN_WBS_TASK_NAME_WIDTH,
    packLabelColumns
} from "../../src/utils/ColumnLayout";

const coreColumns: LabelColumnSpec[] = [
    { id: "totalFloat", text: "Total Float", headerCandidates: ["Total Float", "Float", "TF"], width: 58 },
    { id: "duration", text: "Rem Dur", headerCandidates: ["Rem Dur", "Dur"], width: 58 },
    { id: "finish", text: "Finish", headerCandidates: ["Finish", "Fin"], width: 72 },
    { id: "start", text: "Start", headerCandidates: ["Start", "St"], width: 72 }
];

const comparisonColumns: LabelColumnSpec[] = [
    ...coreColumns,
    { id: "previousFinish", text: "Prev Finish", headerCandidates: ["Prev Finish", "Prev Fin", "PF"], width: 72 },
    { id: "previousStart", text: "Prev Start", headerCandidates: ["Prev Start", "Prev St", "PS"], width: 72 },
    { id: "baselineFinish", text: "BL Finish", headerCandidates: ["BL Finish", "BL Fin", "BF"], width: 72 },
    { id: "baselineStart", text: "BL Start", headerCandidates: ["BL Start", "BL St", "BS"], width: 72 }
];

describe("ColumnLayout", () => {
    it("treats the configured left margin as the readable task name lane", () => {
        const packed = packLabelColumns({
            preferredNameLaneWidth: 300,
            minimumNameLaneWidth: 180,
            autoFitColumns: true,
            columns: coreColumns
        });

        expect(packed.nameLaneWidth).toBe(300);
        expect(packed.occupiedWidth).toBe(DEFAULT_LABEL_COLUMN_PADDING + 58 + 58 + 72 + 72);
        expect(packed.totalLeftPaneWidth).toBe(580);
        expect(packed.columns.map(column => column.id)).toEqual(["totalFloat", "duration", "finish", "start"]);
    });

    it("preserves the WBS minimum task name lane even when the configured margin is smaller", () => {
        const packed = packLabelColumns({
            preferredNameLaneWidth: 160,
            minimumNameLaneWidth: MIN_WBS_TASK_NAME_WIDTH,
            autoFitColumns: true,
            columns: coreColumns
        });

        expect(packed.nameLaneWidth).toBe(220);
    });

    it("auto-hides lower priority columns first when viewport space is tight", () => {
        const nameLaneWidth = 300;
        const rightMargin = 100;
        const columnBudget = DEFAULT_LABEL_COLUMN_PADDING + 58 + 72;
        const viewportWidth = nameLaneWidth + rightMargin + DEFAULT_MIN_TIMELINE_WIDTH + columnBudget;

        const packed = packLabelColumns({
            preferredNameLaneWidth: nameLaneWidth,
            minimumNameLaneWidth: 180,
            viewportWidth,
            rightMargin,
            autoFitColumns: true,
            columns: comparisonColumns
        });

        expect(packed.columns.map(column => column.id)).toEqual(["totalFloat", "finish"]);
        expect(packed.hiddenColumnIds).toEqual([
            "previousStart",
            "previousFinish",
            "baselineStart",
            "baselineFinish",
            "duration",
            "start"
        ]);
    });

    it("keeps all requested columns when auto-fit is disabled", () => {
        const packed = packLabelColumns({
            preferredNameLaneWidth: 300,
            minimumNameLaneWidth: 180,
            viewportWidth: 500,
            rightMargin: 100,
            autoFitColumns: false,
            columns: comparisonColumns
        });

        expect(packed.columns.map(column => column.id)).toEqual(comparisonColumns.map(column => column.id));
        expect(packed.hiddenColumnIds).toEqual([]);
    });

    it("builds the divider and remaining name width from the packed columns", () => {
        const layout = buildLabelColumnLayout({
            leftPaneWidth: 580,
            columns: coreColumns
        });

        expect(layout.occupiedWidth).toBe(280);
        expect(layout.remainingWidth).toBe(300);
        expect(layout.taskNameDividerX).toBe(300);
        expect(layout.items[0]).toMatchObject({ id: "totalFloat", offset: 20, lineX: 502 });
    });
});
