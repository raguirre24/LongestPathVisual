import { describe, expect, it } from "vitest";

import powerbi from "powerbi-visuals-api";
import DataView = powerbi.DataView;

import { buildDataSignature } from "../../src/utils/DataSignature";

interface ColumnDef {
    displayName: string;
    queryName: string;
    roles: { [role: string]: boolean };
    index?: number;
}

function buildDataView(columns: ColumnDef[], rows: unknown[][]): DataView {
    return {
        metadata: {
            columns: columns.map((column, index) => ({
                displayName: column.displayName,
                queryName: column.queryName,
                roles: column.roles,
                index: column.index ?? index,
                type: {}
            }))
        },
        table: {
            columns: columns.map((column, index) => ({
                displayName: column.displayName,
                queryName: column.queryName,
                roles: column.roles,
                index: column.index ?? index,
                type: {}
            })),
            rows
        }
    } as DataView;
}

describe("buildDataSignature", () => {
    it("changes when WBS roles are rebound across the same bound column set", () => {
        const rows = [
            [1, "Phase A", "Area 01"],
            [2, "Phase B", "Area 02"]
        ];

        const before = buildDataView([
            { displayName: "Task ID", queryName: "Table[TaskID]", roles: { taskId: true } },
            { displayName: "Phase", queryName: "Table[Phase]", roles: { wbsLevels: true } },
            { displayName: "Area", queryName: "Table[Area]", roles: { tooltip: true } }
        ], rows);

        const after = buildDataView([
            { displayName: "Task ID", queryName: "Table[TaskID]", roles: { taskId: true } },
            { displayName: "Phase", queryName: "Table[Phase]", roles: { tooltip: true } },
            { displayName: "Area", queryName: "Table[Area]", roles: { wbsLevels: true } }
        ], rows);

        expect(buildDataSignature(before)).not.toBe(buildDataSignature(after));
    });

    it("changes when row values change without a column layout change", () => {
        const columns = [
            { displayName: "Task ID", queryName: "Table[TaskID]", roles: { taskId: true } },
            { displayName: "WBS", queryName: "Table[WBS]", roles: { wbsLevels: true } }
        ];

        const first = buildDataView(columns, [[1, "Phase A"]]);
        const second = buildDataView(columns, [[1, "Phase B"]]);

        expect(buildDataSignature(first)).not.toBe(buildDataSignature(second));
    });
});
