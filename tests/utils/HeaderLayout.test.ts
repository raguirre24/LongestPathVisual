import { describe, expect, it } from "vitest";

import {
    computeHeaderButtonLayout,
    computeSecondRowLayout,
    getActiveHiddenHeaderControlCount,
    getLookAheadOptions,
    HeaderDesiredControls
} from "../../src/utils/HeaderLayout";

const allDesiredControls: HeaderDesiredControls = {
    lookAhead: true,
    floatThreshold: true,
    baseline: true,
    previousUpdate: true,
    progressLine: true,
    connectorLines: true,
    columns: true,
    wbsEnable: true,
    wbsExpand: true,
    wbsCollapse: true,
    copyButton: true,
    htmlExportButton: true,
    exportButton: true,
    helpButton: true
};

function layoutAt(width: number, overrides: Partial<Parameters<typeof computeHeaderButtonLayout>[0]> = {}) {
    return computeHeaderButtonLayout({
        viewportWidth: width,
        currentMode: "floatBased",
        showNearCritical: true,
        showPathInfoChip: false,
        lookAheadActive: false,
        desiredControls: allDesiredControls,
        ...overrides
    });
}

describe("HeaderLayout", () => {
    it.each([320, 480, 650, 850, 1240])("keeps core header controls available at %ipx", (width) => {
        const layout = layoutAt(width);

        expect(layout.showAllCritical.visible).toBe(true);
        expect(layout.modeToggle.visible).toBe(true);
        expect(layout.actionOverflowButton.visible).toBe(true);
        expect(layout.actionOverflowButton.hiddenActions.length).toBeGreaterThan(0);
    });

    it("keeps active look-ahead inline on compact widths when the core controls fit", () => {
        const layout = layoutAt(480, { lookAheadActive: true });

        expect(layout.lookAhead.visible).toBe(true);
        expect(layout.actionOverflowButton.hiddenActions).not.toContain("lookAhead");
    });

    it("keeps inline look-ahead sized like a compact header control", () => {
        expect(layoutAt(850, { lookAheadActive: true }).lookAhead.width).toBe(88);
        expect(layoutAt(650, { lookAheadActive: true }).lookAhead.width).toBe(82);
        expect(layoutAt(500, { lookAheadActive: true }).lookAhead.width).toBe(74);
        expect(layoutAt(480, { lookAheadActive: true }).lookAhead.width).toBe(66);
    });

    it("keeps top-row controls compact and non-overlapping inside the command shell", () => {
        const layout = layoutAt(1240, { lookAheadActive: true });
        const visibleControls = [
            layout.showAllCritical,
            layout.modeToggle,
            layout.lookAhead,
            layout.baseline,
            layout.previousUpdate,
            layout.connectorLines,
            layout.colToggle,
            layout.wbsEnable,
            layout.copyButton,
            layout.actionOverflowButton
        ].filter(control => control.visible);

        expect(layout.showAllCritical.x).toBeGreaterThanOrEqual(16);
        expect(layout.gap).toBe(8);

        for (let index = 1; index < visibleControls.length; index++) {
            const previous = visibleControls[index - 1];
            const current = visibleControls[index];
            const previousRight = previous.x + (previous.width ?? previous.size ?? 0);

            expect(current.x - previousRight).toBeGreaterThanOrEqual(layout.gap);
        }
    });

    it("keeps copy-to-Excel inline and out of the controls menu", () => {
        const layout = layoutAt(320);

        expect(layout.copyButton.visible).toBe(true);
        expect(layout.actionOverflowButton.hiddenActions).not.toContain("copy");
    });

    it("moves timeline, WBS, and non-copy action controls into the menu before core controls", () => {
        const layout = layoutAt(650);

        expect(layout.showAllCritical.visible).toBe(true);
        expect(layout.modeToggle.visible).toBe(true);
        expect(layout.copyButton.visible).toBe(true);
        expect(layout.actionOverflowButton.hiddenActions).toEqual(expect.arrayContaining([
            "progressLine",
            "connectorLines",
            "columns",
            "wbsExpand",
            "wbsCollapse",
            "html",
            "pdf",
            "help"
        ]));
        expect(layout.actionOverflowButton.hiddenActions).not.toContain("copy");
    });

    it("counts active hidden controls for the overflow badge", () => {
        const count = getActiveHiddenHeaderControlCount(
            ["lookAhead", "floatThreshold", "baseline", "previousUpdate", "progressLine", "connectorLines", "columns", "wbsEnable"],
            {
                lookAheadWindowDays: 84,
                showBaseline: true,
                showPreviousUpdate: false,
                showProgressLine: true,
                showConnectorLines: true,
                showExtraColumns: true,
                wbsEnabled: false
            }
        );

        expect(count).toBe(6);
    });

    it("keeps custom look-ahead options available without duplicating the standard list", () => {
        expect(getLookAheadOptions(84).map(option => option.label)).toEqual(["Off", "2W", "3W", "4W", "6W", "8W", "12W"]);
        expect(getLookAheadOptions(35)).toContainEqual({ value: 35, label: "35d" });
    });

    it("reserves trace controls before clamping the selected-task search width", () => {
        const layout = computeSecondRowLayout({
            viewportWidth: 320,
            mode: "narrow",
            configuredDropdownWidth: 420,
            dropdownPosition: "left",
            traceVisible: true
        });

        const traceRight = layout.traceModeToggle.left + layout.traceModeToggle.width;

        expect(layout.dropdown.width).toBeLessThan(420);
        expect(traceRight).toBeLessThanOrEqual(310);
        expect(layout.traceModeToggle.left).toBeGreaterThan(layout.dropdown.left + layout.dropdown.width);
    });

    it("allows a wider search box when trace controls are not visible", () => {
        const withoutTrace = computeSecondRowLayout({
            viewportWidth: 320,
            mode: "narrow",
            configuredDropdownWidth: 420,
            dropdownPosition: "left",
            traceVisible: false
        });
        const withTrace = computeSecondRowLayout({
            viewportWidth: 320,
            mode: "narrow",
            configuredDropdownWidth: 420,
            dropdownPosition: "left",
            traceVisible: true
        });

        expect(withoutTrace.dropdown.width).toBeGreaterThan(withTrace.dropdown.width);
    });
});
