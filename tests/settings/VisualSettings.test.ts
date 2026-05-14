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

    it("exposes header and legend colour settings", () => {
        const settingsSource = readFileSync("src/settings.ts", "utf8");
        const capabilities = JSON.parse(readFileSync("capabilities.json", "utf8"));
        const visualSource = readFileSync("src/visual.ts", "utf8");
        const headerSource = readFileSync("src/components/Header.ts", "utf8");

        expect(capabilities.objects.generalSettings.properties.headerLegendBackgroundColor.type.fill.solid.color).toBe(true);
        expect(capabilities.objects.generalSettings.properties.headerLegendControlBackgroundColor.type.fill.solid.color).toBe(true);
        expect(capabilities.objects.generalSettings.properties.headerLegendTextColor.type.fill.solid.color).toBe(true);
        expect(capabilities.objects.generalSettings.properties.headerLegendBorderColor.type.fill.solid.color).toBe(true);
        expect(settingsSource).toContain('name: "headerLegendBackgroundColor"');
        expect(settingsSource).toContain('name: "headerLegendControlBackgroundColor"');
        expect(settingsSource).toContain('name: "headerLegendTextColor"');
        expect(settingsSource).toContain('name: "headerLegendBorderColor"');
        expect(settingsSource).toContain('displayName: "Header and Legend Background Color"');
        expect(settingsSource).toContain('displayName: "Header and Legend Control Background Color"');
        expect(settingsSource).toContain('displayName: "Header and Legend Text Color"');
        expect(settingsSource).toContain('displayName: "Header and Legend Border Color"');
        expect(visualSource).toContain("getHeaderLegendBackgroundColor");
        expect(visualSource).toContain("getHeaderLegendControlBackgroundColor");
        expect(visualSource).toContain("getHeaderLegendTextColor");
        expect(visualSource).toContain("getHeaderLegendBorderColor");
        expect(visualSource).toContain("headerLegendBackgroundColor?.value?.value");
        expect(visualSource).toContain("headerLegendControlBackgroundColor?.value?.value");
        expect(visualSource).toContain("headerLegendTextColor?.value?.value");
        expect(visualSource).toContain("headerLegendBorderColor?.value?.value");
        expect(headerSource).toContain("usesCustomColours");
        expect(headerSource).toContain("getHeaderControlBackground");
        expect(headerSource).toContain("getHeaderControlTextColor");
        expect(headerSource).toContain("getHeaderInputBackground");
        expect(headerSource).toContain("getHeaderBorderColor");
        expect(headerSource).toContain("getHeaderInputBorderColor");
        expect(headerSource).toContain("getHeaderMenuBorderColor");
        expect(headerSource).toContain("getHeaderMenuBackground");
        expect(headerSource).toContain("getHeaderControlHoverBackground");
    });

    it("exposes the current bar date mode under Task Bars", () => {
        const settingsSource = readFileSync("src/settings.ts", "utf8");
        const capabilities = JSON.parse(readFileSync("capabilities.json", "utf8"));
        const properties = capabilities.objects.taskBars.properties;

        expect(settingsSource).toContain('name: "currentBarDateMode"');
        expect(settingsSource).toContain('displayName: "Current Bar Date Mode"');
        expect(settingsSource).toContain('item => item.value === "startFinishOverride"');
        expect(properties.currentBarDateMode.type.enumeration.map((item: { value: string }) => item.value)).toEqual([
            "startFinishOverride",
            "hybridActualEarly"
        ]);
    });

    it("exposes critical bar style with Status Stripe as the default", () => {
        const settingsSource = readFileSync("src/settings.ts", "utf8");
        const capabilities = JSON.parse(readFileSync("capabilities.json", "utf8"));
        const visualSource = readFileSync("src/visual.ts", "utf8");
        const properties = capabilities.objects.criticalPath.properties;

        expect(settingsSource).toContain('name: "criticalBarStyle"');
        expect(settingsSource).toContain('displayName: "Critical Bar Style"');
        expect(settingsSource).toContain('item => item.value === "statusStripe"');
        expect(properties.criticalBarStyle.type.enumeration.map((item: { value: string }) => item.value)).toEqual([
            "statusStripe",
            "fullFill",
            "outline"
        ]);
        expect(visualSource).toContain("private getCriticalBarStyle(): CriticalBarStyle");
        expect(visualSource).toContain("normalizeCriticalBarStyle(this.settings?.criticalPath?.criticalBarStyle?.value?.value)");
    });

    it("keeps timeline label colour under General header and legend colours", () => {
        const settingsSource = readFileSync("src/settings.ts", "utf8");
        const capabilities = JSON.parse(readFileSync("capabilities.json", "utf8"));
        const visualSource = readFileSync("src/visual.ts", "utf8");
        const headerSource = readFileSync("src/components/Header.ts", "utf8");
        const gridLinesStart = settingsSource.indexOf("class GridLinesCard extends Card");
        const gridLinesEnd = settingsSource.indexOf("class ProjectFinishLineCard extends Card");
        const gridLinesSource = settingsSource.slice(gridLinesStart, gridLinesEnd);
        const gridSlicesStart = gridLinesSource.indexOf("slices: Slice[] = [");
        const gridSlicesEnd = gridLinesSource.indexOf("];", gridSlicesStart);
        const gridSlicesSource = gridLinesSource.slice(gridSlicesStart, gridSlicesEnd);
        const drawGridLinesStart = visualSource.indexOf("private drawgridLines(");
        const drawGridLinesEnd = visualSource.indexOf("// Calculate the visible time range", drawGridLinesStart);
        const drawGridLinesSource = visualSource.slice(drawGridLinesStart, drawGridLinesEnd);
        const modeToggleStart = headerSource.indexOf("private createModeToggleButton()");
        const modeToggleEnd = headerSource.indexOf("private attachLookAheadOutsideClickHandler()", modeToggleStart);
        const modeToggleSource = headerSource.slice(modeToggleStart, modeToggleEnd);
        const lookAheadStart = headerSource.indexOf("private createLookAheadControl()");
        const lookAheadEnd = headerSource.indexOf("private createColumnDisplayToggleButton()", lookAheadStart);
        const lookAheadSource = headerSource.slice(lookAheadStart, lookAheadEnd);

        expect(capabilities.objects.gridLines.properties.timelineLabelColor.type.fill.solid.color).toBe(true);
        expect(gridLinesSource).toContain('name: "timelineLabelColor"');
        expect(gridSlicesSource).not.toContain("this.timelineLabelColor");
        expect(drawGridLinesSource).toContain("const labelColor = this.getHeaderLegendTextColor();");
        expect(drawGridLinesSource).not.toContain("settings.timelineLabelColor.value.value");
        expect(modeToggleSource).toContain("this.getHeaderControlBackground()");
        expect(modeToggleSource).toContain("this.getHeaderControlTextColor()");
        expect(modeToggleSource).toContain("const inactiveTextColor = this.getHeaderControlTextColor();");
        expect(modeToggleSource).not.toContain("HEADER_DOCK_TOKENS.buttonBg");
        expect(modeToggleSource).not.toContain("HEADER_DOCK_TOKENS.buttonText");
        expect(modeToggleSource).not.toContain("HEADER_DOCK_TOKENS.buttonMuted");
        expect(lookAheadSource).toContain("this.getHeaderInputBackground()");
        expect(lookAheadSource).toContain("this.getHeaderControlHoverBackground()");
        expect(lookAheadSource).not.toContain("HEADER_DOCK_TOKENS.inputBg");
        expect(lookAheadSource).not.toContain("HEADER_DOCK_TOKENS.buttonHoverBg");
    });

    it("keeps active header and legend controls on General control backgrounds", () => {
        const headerSource = readFileSync("src/components/Header.ts", "utf8");
        const visualSource = readFileSync("src/visual.ts", "utf8");
        const slice = (source: string, startMarker: string, endMarker: string) => {
            const start = source.indexOf(startMarker);
            const end = source.indexOf(endMarker, start);
            expect(start).toBeGreaterThan(-1);
            expect(end).toBeGreaterThan(start);
            return source.slice(start, end);
        };

        const showCriticalSource = slice(headerSource, "private createOrUpdateToggleButton()", "private createOrUpdateBaselineToggleButton()");
        expect(showCriticalSource).toContain("const activeColor = this.getHeaderDangerColor();");
        expect(showCriticalSource).toContain("const buttonFill = this.getHeaderControlBackground();");
        expect(showCriticalSource).not.toContain("HEADER_DOCK_TOKENS.dangerBg");

        const baselineSource = slice(headerSource, "private createOrUpdateBaselineToggleButton()", "private createOrUpdatePreviousUpdateToggleButton()");
        const previousUpdateSource = slice(headerSource, "private createOrUpdatePreviousUpdateToggleButton()", "private getExtendedLayoutMode");
        expect(baselineSource).toContain("const inactiveColor = this.getHeaderControlTextColor();");
        expect(previousUpdateSource).toContain("const inactiveColor = this.getHeaderControlTextColor();");
        expect(baselineSource).not.toContain("UI_TOKENS.color.neutral.grey60");
        expect(previousUpdateSource).not.toContain("UI_TOKENS.color.neutral.grey60");

        const modeSource = slice(headerSource, "private createModeToggleButton()", "private attachLookAheadOutsideClickHandler()");
        expect(modeSource).toContain("const bgColor = this.getHeaderControlBackground();");
        expect(modeSource).toContain('.style("fill", "transparent")');
        expect(modeSource).not.toContain("HEADER_DOCK_TOKENS.primaryBg");
        expect(modeSource).not.toContain("HEADER_DOCK_TOKENS.warningBg");

        const lookAheadSource = slice(headerSource, "private createLookAheadControl()", "private createColumnDisplayToggleButton()");
        expect(lookAheadSource).toContain("const activeColor = this.getHeaderPrimaryColor();");
        expect(lookAheadSource).toContain("const backgroundColor = this.getHeaderControlBackground();");
        expect(lookAheadSource).toContain("const selectedFill = inputBackground;");
        expect(lookAheadSource).not.toContain("HEADER_DOCK_TOKENS.primaryBg");

        const columnsSource = slice(headerSource, "private createColumnDisplayToggleButton()", "private createWbsEnableToggleButton()");
        const wbsEnableSource = slice(headerSource, "private createWbsEnableToggleButton()", "private createCopyButton()");
        const exportSource = slice(headerSource, "private createExportButton()", "private createExportHtmlButton()");
        expect(columnsSource).toContain("const activeTextColor = this.getHeaderPrimaryColor();");
        expect(wbsEnableSource).toContain("const activeTextColor = this.getHeaderPrimaryColor();");
        expect(exportSource).toContain("const buttonFill = this.getHeaderControlBackground();");
        expect(columnsSource).not.toContain("HEADER_DOCK_TOKENS.primaryBg");
        expect(wbsEnableSource).not.toContain("HEADER_DOCK_TOKENS.primaryBg");
        expect(exportSource).not.toContain("HEADER_DOCK_TOKENS.primaryBg");

        const progressMenuSource = slice(headerSource, "private renderProgressLineMenuItem", "private renderLookAheadMenuItem");
        const lookAheadMenuSource = slice(headerSource, "private renderLookAheadMenuItem", "private renderFloatThresholdMenuItem");
        expect(progressMenuSource).toContain("const toggleFill = inputBackground;");
        expect(progressMenuSource).toContain("const selectedFill = inputBackground;");
        expect(lookAheadMenuSource).toContain("const selectedFill = inputBackground;");
        expect(progressMenuSource).not.toContain("HEADER_DOCK_TOKENS.primaryBg");
        expect(lookAheadMenuSource).not.toContain("HEADER_DOCK_TOKENS.primaryBg");

        const traceModeSource = slice(visualSource, "private createTraceModeToggle()", "private populateTaskDropdown()");
        const taskDropdownSource = slice(visualSource, "private renderTaskDropdown(searchText: string)", "private openDropdown()");
        const legendSource = slice(visualSource, "private renderLegend(viewportWidth: number)", "private hexToRgb");
        expect(traceModeSource).toContain("const activeColor = this.getHeaderLegendActiveColor();");
        expect(traceModeSource).toContain('.style("background-color", "transparent")');
        expect(traceModeSource).toContain("const borderColor = this.getHeaderLegendBorderColor();");
        expect(traceModeSource).toContain('.style("border", `1px solid ${isActive ? activeColor : borderColor}`)');
        expect(traceModeSource).not.toContain("HEADER_DOCK_TOKENS.primaryBg");
        expect(taskDropdownSource).toContain("const activeColor = this.getHeaderLegendActiveColor();");
        expect(taskDropdownSource).toContain("const defaultBg = menuBackground;");
        expect(taskDropdownSource).not.toContain("HEADER_DOCK_TOKENS.menuActive");
        expect(legendSource).toContain('const selectedBackground = this.highContrastMode ? "transparent" : controlBackground;');
        expect(legendSource).toContain('const unselectedBackground = this.highContrastMode ? "transparent" : controlBackground;');
    });

    it("routes header and legend chrome borders through the General border colour", () => {
        const headerSource = readFileSync("src/components/Header.ts", "utf8");
        const visualSource = readFileSync("src/visual.ts", "utf8");
        const styleSource = readFileSync("style/visual.less", "utf8");
        const slice = (source: string, startMarker: string, endMarker: string) => {
            const start = source.indexOf(startMarker);
            const end = source.indexOf(endMarker, start);
            expect(start).toBeGreaterThan(-1);
            expect(end).toBeGreaterThan(start);
            return source.slice(start, end);
        };

        const resolvedPaletteSource = slice(visualSource, "private getResolvedHeaderPalette()", "private updateHeaderElements");
        expect(resolvedPaletteSource).toContain("const borderColor = this.getHeaderLegendBorderColor();");
        expect(resolvedPaletteSource).toContain("commandStroke: borderColor");
        expect(resolvedPaletteSource).toContain("contextStroke: borderColor");
        expect(resolvedPaletteSource).toContain("groupStroke: borderColor");
        expect(resolvedPaletteSource).toContain("buttonStroke: borderColor");
        expect(resolvedPaletteSource).toContain("buttonHoverStroke: borderColor");
        expect(resolvedPaletteSource).toContain("chipStroke: borderColor");
        expect(resolvedPaletteSource).toContain("inputStroke: borderColor");
        expect(resolvedPaletteSource).toContain("inputFocus: borderColor");
        expect(resolvedPaletteSource).toContain("menuStroke: borderColor");
        expect(headerSource).toContain("private getHeaderBorderColor()");
        expect(headerSource).toContain("private getHeaderInputBorderColor()");
        expect(headerSource).toContain("private getHeaderMenuBorderColor()");
        expect(headerSource).not.toMatch(/HEADER_DOCK_TOKENS\.(commandStroke|contextStroke|groupStroke|buttonStroke|buttonHoverStroke|chipStroke|inputStroke|inputFocus|menuStroke)/);

        const taskDropdownChromeSource = slice(visualSource, "private createpathSelectionDropdown(): void", "private createTraceModeToggle(): void");
        const taskDropdownRowsSource = slice(visualSource, "private renderTaskDropdown(searchText: string)", "private openDropdown()");
        const wbsMenuSource = slice(visualSource, "private getWbsHeaderContextMenu()", "private hideWbsHeaderContextMenu()");
        const legendSource = slice(visualSource, "private renderLegend(viewportWidth: number)", "private hexToRgb");
        expect(taskDropdownChromeSource).toContain("const headerLegendBorder = this.getHeaderLegendBorderColor();");
        expect(taskDropdownChromeSource).toContain('.style("border", `1px solid ${headerLegendBorder}`)');
        expect(taskDropdownRowsSource).toContain("const borderColor = this.getHeaderLegendBorderColor();");
        expect(taskDropdownRowsSource).toContain('.style("border-bottom", `1px solid ${borderColor}`)');
        expect(wbsMenuSource).toContain("this.getHeaderLegendBorderColor()");
        expect(legendSource).toContain("const borderColor = this.getHeaderLegendBorderColor();");
        expect(legendSource).toContain("const buttonBorder = this.highContrastMode ? this.getForegroundColor() : borderColor;");
        expect(styleSource).toContain("var(--lpv-header-legend-border-color, #4D5A6E)");
    });

    it("keeps path, task dropdown, look-ahead, and float threshold controls free of drop shadows", () => {
        const headerSource = readFileSync("src/components/Header.ts", "utf8");
        const visualSource = readFileSync("src/visual.ts", "utf8");
        const styleSource = readFileSync("style/visual.less", "utf8");
        const slice = (source: string, startMarker: string, endMarker: string) => {
            const start = source.indexOf(startMarker);
            const end = source.indexOf(endMarker, start);
            expect(start).toBeGreaterThan(-1);
            expect(end).toBeGreaterThan(start);
            return source.slice(start, end);
        };

        const constructorChromeSource = slice(visualSource, 'this.selectedTaskLabel = this.stickyHeaderContainer.append("div")', 'this.scrollableContainer = this.visualWrapper.append("div")');
        const taskDropdownSource = slice(visualSource, "private createpathSelectionDropdown(): void", "private createTraceModeToggle(): void");
        const lookAheadWrapperSource = slice(headerSource, '.upsertDiv("look-ahead-control-wrapper")', "if (!isCompact)");
        const floatThresholdSource = slice(headerSource, "private createFloatThresholdControl(): void", "private createModeToggleButton(): void");
        const taskSelectionListStyle = slice(styleSource, ".task-selection-list {", ".selected-task-label {");

        expect(constructorChromeSource).toContain('.style("box-shadow", "none")');
        expect(constructorChromeSource).not.toContain("HEADER_DOCK_TOKENS.shadow");
        expect(taskDropdownSource).toContain('.style("box-shadow", "none")');
        expect(taskDropdownSource).not.toContain("HEADER_DOCK_TOKENS.shadow");
        expect(taskDropdownSource).not.toContain("HEADER_DOCK_TOKENS.primaryBg");
        expect(lookAheadWrapperSource).toContain('.style("box-shadow", "none")');
        expect(lookAheadWrapperSource).not.toContain("this.getHeaderShadow()");
        expect(floatThresholdSource).toContain('.style("box-shadow", "none")');
        expect(floatThresholdSource).not.toContain("this.getHeaderShadow()");
        expect(floatThresholdSource).not.toContain("HEADER_DOCK_TOKENS.primaryBg");
        expect(taskSelectionListStyle).toContain("box-shadow: none;");
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
        expect(headerSource).toContain('"look-ahead-control-caret"');
        expect(headerSource).toContain('.style("position", "relative")');
        expect(headerSource).toContain('.style("overflow", "hidden")');
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

    it("keeps the table timeline divider below header menus", () => {
        const visualSource = readFileSync("src/visual.ts", "utf8");
        const resizerStart = visualSource.indexOf("private createMarginResizer()");
        const resizerEnd = visualSource.indexOf("private updateMarginResizerPosition()", resizerStart);
        const resizerSource = visualSource.slice(resizerStart, resizerEnd);
        const dividerStart = visualSource.indexOf('colHeaderLayer.selectAll<SVGLineElement, number>(".table-timeline-header-divider")');
        const dividerEnd = visualSource.indexOf("private drawLabelColumnSeparators(", dividerStart);
        const dividerSource = visualSource.slice(dividerStart, dividerEnd);

        expect(resizerStart).toBeGreaterThan(-1);
        expect(resizerEnd).toBeGreaterThan(resizerStart);
        expect(dividerStart).toBeGreaterThan(-1);
        expect(dividerEnd).toBeGreaterThan(dividerStart);
        expect(resizerSource).toContain('.style("z-index", "60")');
        expect(dividerSource).toContain('enter => enter.append("line").attr("class", "table-timeline-header-divider")');
        expect(dividerSource).toContain(".attr(\"y1\", this.snapLineCoord(bandMetrics.top))");
        expect(dividerSource).toContain(".attr(\"y2\", this.snapLineCoord(bandMetrics.top + bandMetrics.height))");
        expect(dividerSource).toContain('.style("pointer-events", "none")');
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

    it("orders the WBS header context menu from collapse through levels to expand", () => {
        const visualSource = readFileSync("src/visual.ts", "utf8");
        const start = visualSource.indexOf("const actions: WbsHeaderContextMenuAction[] = [");
        const end = visualSource.indexOf("const items = menu", start);
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);

        const actionsSource = visualSource.slice(start, end);
        const collapseIndex = actionsSource.indexOf('id: "collapse-all"');
        const levelsIndex = actionsSource.indexOf("...showThroughLevelActions");
        const expandIndex = actionsSource.indexOf('id: "expand-all"');

        expect(collapseIndex).toBeGreaterThan(-1);
        expect(levelsIndex).toBeGreaterThan(collapseIndex);
        expect(expandIndex).toBeGreaterThan(levelsIndex);
        expect(visualSource).toContain("to collapse all, show the hierarchy through any available WBS level, or expand all.");
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
        expect(visualSource).toContain(".paddingOuter(taskPadding / (taskHeight + taskPadding) / 2)\n            .align(0);");
        expect(visualSource).toContain("WBS top-row anchor restoration");
        expect(visualSource).toContain("availableWidth,\n                    wbsRowBandHeight,\n                    groupNameFontSizePx");
    });

    it("uses one WBS text colour setting with restrained level accents", () => {
        const settingsSource = readFileSync("src/settings.ts", "utf8");
        const capabilities = JSON.parse(readFileSync("capabilities.json", "utf8"));
        const visualSource = readFileSync("src/visual.ts", "utf8");
        const slice = (source: string, startMarker: string, endMarker: string) => {
            const start = source.indexOf(startMarker);
            const end = source.indexOf(endMarker, start);
            expect(start).toBeGreaterThan(-1);
            expect(end).toBeGreaterThan(start);
            return source.slice(start, end);
        };

        expect(capabilities.objects.wbsGrouping.properties.groupNameColor.type.fill.solid.color).toBe(true);
        expect(settingsSource).toContain('groupNameColor = new ColorPicker({ name: "groupNameColor", displayName: "WBS Text Color"');
        expect(visualSource).toContain("private readonly WBS_LEVEL_ACCENT_WIDTH = 5;");

        const wbsLevelStylesSource = slice(settingsSource, "class WbsLevelStylesCard extends Card", "class LegendCard extends Card");
        const wbsLevelStyleSlices = slice(wbsLevelStylesSource, "slices: Slice[] = [", "];");
        const restrainedAccentDefaults = [
            "#4E7FA8", "#5B9AA0", "#6F8FAE", "#6B9A8C", "#8494A6",
            "#7BAFC1", "#6F829E", "#7A9FAD", "#80989B", "#9AA5B1"
        ];
        restrainedAccentDefaults.forEach(color => {
            expect(wbsLevelStylesSource).toContain(`value: { value: "${color}" }`);
        });
        expect(wbsLevelStylesSource).not.toContain("#DE786F");
        for (let level = 1; level <= 10; level++) {
            expect(capabilities.objects.wbsLevelStyles.properties[`level${level}Text`].type.fill.solid.color).toBe(true);
            expect(wbsLevelStylesSource).toContain(`level${level}Text = new ColorPicker`);
            expect(wbsLevelStyleSlices).toContain(`level${level}Background`);
            expect(wbsLevelStyleSlices).not.toContain(`level${level}Text`);
        }

        const formattingModelSource = slice(visualSource, "if (this.settings?.wbsLevelStyles) {", "// Hide formatting pane cards");
        expect(formattingModelSource).toContain("backgroundSlice");
        expect(formattingModelSource).not.toContain("textSlice");
        expect(formattingModelSource).not.toContain("Text`");

        const wbsTextColorSource = slice(visualSource, "private getWbsTextColor(", "private getWbsLevelStyle(");
        expect(wbsTextColorSource).toContain("groupNameColor?.value?.value");

        const wbsLevelStyleSource = slice(visualSource, "private getWbsLevelStyle(", "private getLocalizedString(");
        expect(wbsLevelStyleSource).toContain("level${safeLevel}Background");
        expect(wbsLevelStyleSource).not.toContain("Text");
        expect(wbsLevelStyleSource).not.toContain("textValue");

        const drawWbsSource = slice(visualSource, "private drawWbsGroupHeaders(", "private refreshDateFormatters()");
        expect(drawWbsSource).toContain('const wbsTextColor = this.resolveColor(this.getWbsTextColor("#333333"), "foreground");');
        expect(drawWbsSource).toContain("const groupNameColor = wbsTextColor;");
        expect(drawWbsSource).toContain("const badgeTextColor = wbsTextColor;");
        expect(drawWbsSource).toContain("fill: string = summaryTextColor");
        expect(drawWbsSource).toContain("const summaryFillColor = self.blendColors(groupSummaryColor, accentColor, 0.9);");
        expect(drawWbsSource).toContain("taskHeight * (isCollapsed ? 0.42 : 0.18)");
        expect(drawWbsSource).toContain("const baseOpacity = self.highContrastMode ? 1 : (isCollapsed ? 0.66 : 0.18);");
        expect(drawWbsSource).toContain("const summarySemanticOpacity = self.highContrastMode");
        expect(drawWbsSource).toContain(".style('stroke-width', isCollapsed ? 1 : 0.7)");
        expect(drawWbsSource).not.toContain("mutedTextColor");

        const wbsExportStyleSource = slice(visualSource, "private getWbsExportRowBackgroundColor(", "private getExportTableTasks()");
        expect(wbsExportStyleSource).toContain("this.getWbsLevelStyle(level, fallbackBackground)");
        expect(wbsExportStyleSource).toContain("this.getReadableTextColor(preferredTextColor, backgroundColor)");
        expect(wbsExportStyleSource).toContain("background-color: ${backgroundColor}; color: ${textColor};");

        const readableTextSource = slice(visualSource, "private getColorContrastRatio(", "private getDurationTextColor(");
        expect(readableTextSource).toContain("const minimumContrastRatio = 4.5;");
        expect(readableTextSource).toContain('this.getColorContrastRatio("#FFFFFF", backgroundColor)');
        expect(readableTextSource).toContain('return whiteContrast >= blackContrast ? "#FFFFFF" : "#000000";');

        const visibleWbsExportSource = slice(visualSource, "private generateVisibleWbsOnlyExportTableHtml(", "private generateVisibleWbsOnlyExportTableText(");
        expect(visibleWbsExportSource).toContain('const textColor = this.getWbsExportRowTextColor(rowBgColor, "#333333");');
        expect(visibleWbsExportSource).toContain("this.getWbsExportCellStyle(rowBgColor, textColor");
        expect(visibleWbsExportSource).toContain("const rowBgColor = this.getWbsExportRowBackgroundColor(group.level");
        expect(visibleWbsExportSource).not.toContain("levelStyle.text");
        expect(visibleWbsExportSource).not.toContain("border-left: 4px solid");

        const hierarchicalWbsExportSource = slice(visualSource, "private generateWbsHierarchicalHtml(", "private async copyVisibleDataToClipboard()");
        expect(hierarchicalWbsExportSource).toContain('const defaultGroupNameColor = this.getWbsTextColor("#333333");');
        expect(hierarchicalWbsExportSource).toContain("const rowBgColor = this.getWbsExportRowBackgroundColor(groupLevel");
        expect(hierarchicalWbsExportSource).toContain("const textColor = this.getWbsExportRowTextColor(rowBgColor, defaultGroupNameColor);");
        expect(hierarchicalWbsExportSource).toContain("this.getWbsExportCellStyle(rowBgColor, textColor");
        expect(hierarchicalWbsExportSource).not.toContain("levelStyle.text");
        expect(hierarchicalWbsExportSource).not.toContain("border-left: 4px solid");
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

    it("uses task bar label dates for flat and hierarchical task exports", () => {
        const visualSource = readFileSync("src/visual.ts", "utf8");
        const slice = (source: string, startMarker: string, endMarker: string) => {
            const start = source.indexOf(startMarker);
            const end = source.indexOf(endMarker, start);
            expect(start).toBeGreaterThan(-1);
            expect(end).toBeGreaterThan(start);
            return source.slice(start, end);
        };

        const flatHtmlExportSource = slice(visualSource, "private generateFlatExportTableHtml(", "private generateFlatExportTableText(");
        const flatTextExportSource = slice(visualSource, "private generateFlatExportTableText(", "private generateVisibleWbsOnlyExportTableHtml(");
        const hierarchicalWbsExportSource = slice(visualSource, "private generateWbsHierarchicalHtml(", "private async copyVisibleDataToClipboard()");
        const clipboardSource = slice(visualSource, "private async copyVisibleDataToClipboard()", "private showCopySuccess");

        expect(flatHtmlExportSource).toContain("const visualStartDate = this.getTaskBarLabelStart(task);");
        expect(flatTextExportSource).toContain("const visualStartDate = this.getTaskBarLabelStart(task);");
        expect(hierarchicalWbsExportSource).toContain("const visualStartDate = this.getTaskBarLabelStart(task);");
        expect(clipboardSource).toContain("const tableHtml = this.generateVisibleExportTableHtml();");
        expect(clipboardSource).toContain("const plainText = this.generateVisibleExportTableText();");
    });

    it("draws critical status markers after task overlays in SVG and canvas render paths", () => {
        const visualSource = readFileSync("src/visual.ts", "utf8");
        const slice = (source: string, startMarker: string, endMarker: string) => {
            const start = source.indexOf(startMarker);
            const end = source.indexOf(endMarker, start);
            expect(start).toBeGreaterThan(-1);
            expect(end).toBeGreaterThan(start);
            return source.slice(start, end);
        };

        const svgTaskSource = slice(visualSource, "private drawTasks(", "private drawTasksCanvas(");
        const svgOverlayIndex = svgTaskSource.indexOf("const overlay = self.getBeforeDataDateOverlay");
        const svgMarkerIndex = svgTaskSource.indexOf("const markerStyle = self.getCriticalStatusMarkerStyle(d, criticalColor, nearCriticalColor, false, applyCriticalFormat)");
        const svgMilestoneRingIndex = svgTaskSource.indexOf("critical-status-ring", svgMarkerIndex);

        expect(svgOverlayIndex).toBeGreaterThan(-1);
        expect(svgMarkerIndex).toBeGreaterThan(svgOverlayIndex);
        expect(svgMilestoneRingIndex).toBeGreaterThan(svgMarkerIndex);
        expect(svgTaskSource).toContain("critical-status-marker");
        expect(svgTaskSource).toContain("const applyCriticalFormat = self.shouldApplyCriticalFormatToSegment(segment);");
        expect(svgTaskSource).toContain("const baseFillColor = getTaskFillColor(d, taskColor, applyCriticalFormat);");

        const canvasTaskSource = slice(visualSource, "private drawTasksCanvas(", "// Draw duration text on task bars");
        const canvasOverlayIndex = canvasTaskSource.indexOf("beforeDataDateDividerBatches.forEach");
        const canvasMarkerIndex = canvasTaskSource.indexOf("statusMarkerBatches.forEach");
        const canvasMilestoneIndex = canvasTaskSource.indexOf("milestoneBatches.forEach");
        const canvasMilestoneMarkerIndex = canvasTaskSource.indexOf("milestoneStatusMarkerBatches.forEach");

        expect(canvasMarkerIndex).toBeGreaterThan(canvasOverlayIndex);
        expect(canvasMilestoneMarkerIndex).toBeGreaterThan(canvasMilestoneIndex);
        expect(visualSource).toContain("private shouldApplyCriticalFormatToSegment(segment: TaskBarSegment): boolean");
        expect(visualSource).toContain("return segment.kind !== \"started\";");
        expect(canvasTaskSource).toContain("const applyCriticalFormat = this.shouldApplyCriticalFormatToSegment(segment);");
        expect(canvasTaskSource).toContain("const semanticFill = this.getSemanticTaskFillColor(task, taskColor, criticalColor, nearCriticalColor, applyCriticalFormat);");
        expect(canvasTaskSource).toContain("const markerStyle = this.getCriticalStatusMarkerStyle(task, criticalColor, nearCriticalColor, false, applyCriticalFormat)");
        expect(canvasTaskSource).toContain("const markerStyle = this.getCriticalStatusMarkerStyle(task, criticalColor, nearCriticalColor, true)");
    });
});
