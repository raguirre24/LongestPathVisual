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

    it("keeps crowded header controls available through the responsive controls menu", () => {
        const headerSource = readFileSync("src/components/Header.ts", "utf8");

        expect(headerSource).toContain('type HeaderMenuAction');
        expect(headerSource).toContain('"floatThreshold"');
        expect(headerSource).toContain('"baseline"');
        expect(headerSource).toContain('"wbsCollapse"');
        expect(headerSource).toContain('Controls and actions');
        expect(headerSource).toContain('A single menu button is the fallback');
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

    it("shows comparison date columns when bars are on or when the keep-visible toggle is enabled", () => {
        const visualSource = readFileSync("src/visual.ts", "utf8");

        expect(visualSource).toContain("this.boundFields.baselineAvailable && (this.showBaselineInternal || cols.showBaselineDateColumns?.value)");
        expect(visualSource).toContain("this.boundFields.previousUpdateAvailable && (this.showPreviousUpdateInternal || cols.showPreviousUpdateDateColumns?.value)");
    });
});
