import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("VisualSettings", () => {
    it("keeps the look-ahead window disabled by default", () => {
        const settingsSource = readFileSync("src/settings.ts", "utf8");

        expect(settingsSource).toContain('name: string = "lookAhead"');
        expect(settingsSource).toContain('displayName: "Enable Look-Ahead Window"');
        expect(settingsSource).toContain("value: false");
        expect(settingsSource).toContain('displayName: "Display Mode"');
        expect(settingsSource).toContain('item => item.value === "filter"');
        expect(settingsSource).toContain('displayName: "Window (days)"');
        expect(settingsSource).toContain("value: 28");
        expect(settingsSource).toContain("lookAhead = new LookAheadCard()");
        expect(settingsSource).toContain("this.lookAhead");
        expect(settingsSource).toContain('lookAheadWindowDays = new NumUpDown');
    });

    it("keeps look-ahead capabilities aligned with the settings card", () => {
        const capabilities = JSON.parse(readFileSync("capabilities.json", "utf8"));
        const properties = capabilities.objects.lookAhead.properties;

        expect(Object.keys(properties)).toEqual([
            "enabled",
            "displayMode",
            "windowDays",
            "windowColor",
            "windowTransparency",
            "highlightTasks",
            "taskOutlineColor",
            "taskOutlineWidth",
            "showEndLine",
            "showLabel"
        ]);
    });

    it("exposes the finish-variance progress line format card", () => {
        const settingsSource = readFileSync("src/settings.ts", "utf8");
        const capabilities = JSON.parse(readFileSync("capabilities.json", "utf8"));
        const properties = capabilities.objects.progressLine.properties;
        const visualSource = readFileSync("src/visual.ts", "utf8");
        const headerSource = readFileSync("src/components/Header.ts", "utf8");

        expect(settingsSource).toContain('name: string = "progressLine"');
        expect(settingsSource).toContain('displayName: "Show Progress Line"');
        expect(settingsSource).toContain('value: false');
        expect(settingsSource).toContain("progressLine = new ProgressLineCard()");
        expect(settingsSource).toContain("this.progressLine");

        expect(Object.keys(properties)).toEqual([
            "show",
            "referenceFinish",
            "lineColor",
            "lineWidth",
            "lineStyle",
            "showMarkers",
            "markerSize",
            "includeWbsGroups",
            "showLabel"
        ]);
        expect(properties.referenceFinish.type.enumeration.map((item: { value: string }) => item.value)).toEqual([
            "baselineFinish",
            "previousUpdateFinish"
        ]);

        expect(visualSource).toContain("calculateFinishVarianceProgressPoint");
        expect(visualSource).toContain("getWbsProgressLineReferenceFinish");
        expect(visualSource).toContain("summaryBaselineFinishDate");
        expect(visualSource).toContain("summaryPreviousUpdateFinishDate");
        expect(visualSource).toContain("drawProgressLine(renderableTasks");
        expect(visualSource).toContain("onToggleProgressLine: () => this.toggleProgressLineDisplay()");
        expect(visualSource).toContain("onProgressLineReferenceChanged: (reference) => this.setProgressLineReference(reference)");
        expect(visualSource).toContain('properties: { referenceFinish: reference }');
        expect(headerSource).toContain("renderProgressLineMenuItem");
        expect(headerSource).toContain("onProgressLineReferenceChanged");
        expect(headerSource).toContain("progressLineBaselineAvailable");
        expect(visualSource).toContain("progressLineAvailable: progressLineBaselineAvailable || progressLinePreviousUpdateAvailable");
        expect(visualSource).toContain("if (visible && !this.hasProgressLineReferenceData(reference))");
    });

    it("keeps the progress-line header menu open while changing progress-line options", () => {
        const headerSource = readFileSync("src/components/Header.ts", "utf8");
        const progressMenuStart = headerSource.indexOf("private renderProgressLineMenuItem");
        const progressMenuEnd = headerSource.indexOf("private renderLookAheadMenuItem");
        const progressMenuSource = headerSource.slice(progressMenuStart, progressMenuEnd);

        expect(progressMenuStart).toBeGreaterThan(-1);
        expect(progressMenuEnd).toBeGreaterThan(progressMenuStart);
        expect(progressMenuSource).toContain("this.callbacks.onToggleProgressLine()");
        expect(progressMenuSource).toContain("this.callbacks.onProgressLineReferenceChanged(reference.value)");
        expect(progressMenuSource).toContain('property("disabled", disabled)');
        expect(progressMenuSource).not.toContain("this.closeControlsMenu");
    });

    it("applies the look-ahead task filter before max task limiting", () => {
        const visualSource = readFileSync("src/visual.ts", "utf8");
        const filterIndex = visualSource.indexOf("tasksToConsider = this.filterTasksToLookAhead(tasksToConsider)");
        const limitIndex = visualSource.indexOf("const limitedTasks = this.limitTasks(tasksToConsider, maxTasksToShowSetting)");

        expect(filterIndex).toBeGreaterThan(-1);
        expect(limitIndex).toBeGreaterThan(-1);
        expect(filterIndex).toBeLessThan(limitIndex);
    });

    it("exposes look-ahead as an interactive header selector with persisted state", () => {
        const capabilities = JSON.parse(readFileSync("capabilities.json", "utf8"));
        const headerSource = readFileSync("src/components/Header.ts", "utf8");
        const visualSource = readFileSync("src/visual.ts", "utf8");

        expect(capabilities.objects.persistedState.properties.lookAheadWindowDays.type.numeric).toBe(true);
        expect(headerSource).toContain("createLookAheadControl");
        expect(headerSource).toContain("onLookAheadWindowChanged");
        expect(visualSource).toContain("onLookAheadWindowChanged: (days) => this.setLookAheadWindowDays(days)");
        expect(visualSource).toContain("properties: { lookAheadWindowDays: nextDays }");
    });

    it("keeps look-ahead selector and option text compact", () => {
        const headerSource = readFileSync("src/components/Header.ts", "utf8");
        const styleSource = readFileSync("style/visual.less", "utf8");

        expect(headerSource).toContain("const LOOK_AHEAD_SELECT_FONT_SIZE = `${UI_TOKENS.fontSize.sm}px`;");
        expect(headerSource).toContain("const LOOK_AHEAD_OPTION_ROW_HEIGHT = 22;");
        expect(headerSource).toContain('"look-ahead-control-button"');
        expect(headerSource).toContain('"look-ahead-option-list"');
        expect(headerSource).toContain('.attr("role", "listbox")');
        expect(headerSource).toContain('.attr("role", "option")');
        expect(headerSource.match(/look-ahead-option-button/g)?.length).toBeGreaterThanOrEqual(3);
        expect(headerSource).toContain('"repeat(4, minmax(0, 1fr))"');
        expect(headerSource).not.toContain('append("select")');
        expect(headerSource).not.toContain('text-align-last');
        expect(styleSource).toContain(".look-ahead-option-list");
        expect(styleSource).toContain("&::-webkit-scrollbar");
        expect(styleSource).toContain("width: 5px;");
    });

    it("keeps crowded header controls available through the responsive controls menu", () => {
        const headerSource = readFileSync("src/components/Header.ts", "utf8");

        expect(readFileSync("src/utils/HeaderLayout.ts", "utf8")).toContain('export type HeaderMenuAction');
        expect(headerSource).toContain('"floatThreshold"');
        expect(headerSource).toContain('"baseline"');
        expect(headerSource).toContain('"wbsCollapse"');
        expect(headerSource).toContain('Controls and actions');
        expect(headerSource).toContain('aria-controls');
        expect(headerSource).toContain('focusFirstOverflowMenuItem');
        expect(headerSource).toContain('attachOverflowOutsideClickHandler');
        expect(headerSource).toContain('Copy HTML');
        expect(headerSource).toContain('renderLookAheadMenuItem');
        expect(headerSource).toContain('renderFloatThresholdMenuItem');
    });

    it("documents current interactive features in the help overlay", () => {
        const visualSource = readFileSync("src/visual.ts", "utf8");

        expect(visualSource).toContain("Controls and actions menu");
        expect(visualSource).toContain("Look-Ahead Review");
        expect(visualSource).toContain("Relationship Free Float Source");
        expect(visualSource).toContain("Missing Predecessor Activities");
        expect(visualSource).toContain("Collapse To Level");
        expect(visualSource).toContain("Shift + F10");
    });

    it("keeps left-pane column defaults aligned with the names-first layout", () => {
        const settingsSource = readFileSync("src/settings.ts", "utf8");
        const capabilities = JSON.parse(readFileSync("capabilities.json", "utf8"));
        const properties = capabilities.objects.columns.properties;

        expect(settingsSource).toContain('autoFitColumns = new ToggleSwitch({ name: "autoFitColumns"');
        expect(settingsSource).toContain('showStartDate = new ToggleSwitch({ name: "showStartDate", displayName: "Show Start Date", value: true })');
        expect(settingsSource).toContain('showFinishDate = new ToggleSwitch({ name: "showFinishDate", displayName: "Show Finish Date", value: true })');
        expect(settingsSource).toContain('showDuration = new ToggleSwitch({ name: "showDuration", displayName: "Show Duration", value: true })');
        expect(settingsSource).toContain('showTotalFloat = new ToggleSwitch({ name: "showTotalFloat", displayName: "Show Total Float", value: true })');
        expect(settingsSource).toContain('showBaselineDateColumns = new ToggleSwitch({ name: "showBaselineDateColumns"');
        expect(settingsSource).toContain('value: false');
        expect(settingsSource).toContain('showPreviousUpdateDateColumns = new ToggleSwitch({ name: "showPreviousUpdateDateColumns"');

        expect(properties.autoFitColumns.type.bool).toBe(true);
        expect(properties.showBaselineDateColumns.type.bool).toBe(true);
        expect(properties.showPreviousUpdateDateColumns.type.bool).toBe(true);
    });

    it("keeps task and WBS wrapped label rows anchored consistently", () => {
        const visualSource = readFileSync("src/visual.ts", "utf8").replace(/\r\n/g, "\n");

        expect(visualSource).toContain('anchorMode: "centerBlock" | "firstLineAtCenter" = "firstLineAtCenter"');
        expect(visualSource).toContain("const wbsRowBandHeight = taskHeight + taskPadding;");
        expect(visualSource).toContain("availableWidth,\n                    wbsRowBandHeight,\n                    groupNameFontSizePx");
    });

    it("shows comparison date columns when bars are on or when the keep-visible toggle is enabled", () => {
        const visualSource = readFileSync("src/visual.ts", "utf8");

        expect(visualSource).toContain("this.boundFields.baselineAvailable && (this.showBaselineInternal || cols.showBaselineDateColumns?.value)");
        expect(visualSource).toContain("this.boundFields.previousUpdateAvailable && (this.showPreviousUpdateInternal || cols.showPreviousUpdateDateColumns?.value)");
    });

    it("places copy-to-clipboard export metadata after the copied table", () => {
        const visualSource = readFileSync("src/visual.ts", "utf8");

        const tableFragmentIndex = visualSource.indexOf("private generateClipboardTableExportFragment(tableHtml: string)");
        const tableHtmlIndex = visualSource.indexOf("${tableHtml}", tableFragmentIndex);
        const metadataIndex = visualSource.indexOf("${this.generateClipboardExportMetadataFragment()}", tableFragmentIndex);

        expect(tableFragmentIndex).toBeGreaterThan(-1);
        expect(tableHtmlIndex).toBeGreaterThan(tableFragmentIndex);
        expect(metadataIndex).toBeGreaterThan(tableHtmlIndex);
        expect(visualSource).not.toContain("injectClipboardExportTimestampCell");
    });
});
