import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("VisualSettings", () => {
    it("requests the maximum standard row window for segmented table loading", () => {
        const capabilities = JSON.parse(readFileSync("capabilities.json", "utf8"));
        const rows = capabilities.dataViewMappings[0].table.rows;

        expect(rows.dataReductionAlgorithm).toEqual({
            window: {
                count: 30000
            }
        });
    });

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
        const themeSource = readFileSync("src/utils/Theme.ts", "utf8");
        const headerBackgroundSettingSource = settingsSource.slice(
            settingsSource.indexOf("headerLegendBackgroundColor = new ColorPicker"),
            settingsSource.indexOf("headerLegendControlBackgroundColor = new ColorPicker")
        );

        expect(capabilities.objects.generalSettings.properties.headerLegendBackgroundColor.type.fill.solid.color).toBe(true);
        expect(capabilities.objects.generalSettings.properties.headerLegendControlBackgroundColor.type.fill.solid.color).toBe(true);
        expect(capabilities.objects.generalSettings.properties.headerLegendTextColor.type.fill.solid.color).toBe(true);
        expect(capabilities.objects.generalSettings.properties.headerLegendBorderColor.type.fill.solid.color).toBe(true);
        expect(capabilities.objects.generalSettings.properties.headerLegendActiveColor.type.fill.solid.color).toBe(true);
        expect(settingsSource).toContain('name: "headerLegendBackgroundColor"');
        expect(settingsSource).toContain('name: "headerLegendControlBackgroundColor"');
        expect(settingsSource).toContain('name: "headerLegendTextColor"');
        expect(settingsSource).toContain('name: "headerLegendBorderColor"');
        expect(settingsSource).toContain('name: "headerLegendActiveColor"');
        expect(settingsSource).toContain('displayName: "Header and Legend Background Color"');
        expect(settingsSource).toContain('displayName: "Header and Legend Control Background Color"');
        expect(settingsSource).toContain('displayName: "Header and Legend Text Color"');
        expect(settingsSource).toContain('displayName: "Header and Legend Border Color"');
        expect(settingsSource).toContain('displayName: "Header and Legend Active Color"');
        expect(headerBackgroundSettingSource).toContain('value: { value: "#FFFFFF" }');
        expect(themeSource).toContain("shell: '#FFFFFF'");
        expect(visualSource).toContain("getHeaderLegendBackgroundColor");
        expect(visualSource).toContain("getHeaderLegendControlBackgroundColor");
        expect(visualSource).toContain("getHeaderLegendTextColor");
        expect(visualSource).toContain("getHeaderLegendBorderColor");
        expect(visualSource).toContain("getHeaderLegendActiveColor");
        expect(visualSource).toContain("headerLegendBackgroundColor?.value?.value");
        expect(visualSource).toContain("headerLegendControlBackgroundColor?.value?.value");
        expect(visualSource).toContain("headerLegendTextColor?.value?.value");
        expect(visualSource).toContain("headerLegendBorderColor?.value?.value");
        expect(visualSource).toContain("headerLegendActiveColor?.value?.value");
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

    it("persists stable legend category order for data colour slots", () => {
        const settingsSource = readFileSync("src/settings.ts", "utf8");
        const capabilities = JSON.parse(readFileSync("capabilities.json", "utf8"));
        const visualSource = readFileSync("src/visual.ts", "utf8");

        expect(capabilities.objects.persistedState.properties.legendCategoryOrder.type.text).toBe(true);
        expect(settingsSource).toContain('legendCategoryOrder = new TextInput');
        expect(settingsSource).toContain("this.legendCategoryOrder");
        expect(visualSource).toContain("properties: { legendCategoryOrder: categoryOrder }");
        expect(visualSource).toContain("buildStableLegendCategoryOrder");
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

    it("exposes No Calculation visualiser mode without changing the default mode", () => {
        const settingsSource = readFileSync("src/settings.ts", "utf8");
        const capabilities = JSON.parse(readFileSync("capabilities.json", "utf8"));
        const visualSource = readFileSync("src/visual.ts", "utf8");
        const headerSource = readFileSync("src/components/Header.ts", "utf8");
        const headerLayoutSource = readFileSync("src/utils/HeaderLayout.ts", "utf8");
        const dataProcessorSource = readFileSync("src/data/DataProcessor.ts", "utf8");
        const taskBarGeometrySource = readFileSync("src/utils/TaskBarGeometry.ts", "utf8");
        const calculationModeValues = capabilities.objects.criticalPath.properties.calculationMode.type.enumeration.map((item: { value: string }) => item.value);

        expect(calculationModeValues).toEqual(["longestPath", "floatBased", "none"]);
        expect(settingsSource).toContain('{ value: "none", displayName: "No Calculation (Visualiser)" }');
        expect(settingsSource).toContain('value: { value: "floatBased", displayName: "Float-Based" }');
        expect(dataProcessorSource).toContain("if (mode === 'none')");
        expect(dataProcessorSource).toContain("calculateElapsedCalendarDuration");
        expect(visualSource).toContain("private isNoCalculationMode(): boolean");
        expect(visualSource).toContain("const noCalculationMode = mode === 'none';");
        expect(visualSource).toContain("this.clearCriticalPathState();");
        expect(visualSource).toContain("successorTaskSet = this.identifySuccessorTasksFloatBased(this.selectedTaskId);");
        expect(visualSource).toContain("predecessorTaskSet = this.identifyPredecessorTasksFloatBased(this.selectedTaskId);");
        expect(visualSource).toContain("if (noCalculationMode || longestPathUnavailable || this.showAllTasksInternal)");
        expect(visualSource).toContain("tasksToConsider = relevantPlottableTasks.length > 0 ? relevantPlottableTasks : [];");
        expect(visualSource).toContain('this.getLocalizedString("tooltip.mode.visualiser", "Visualiser")');
        expect(visualSource).toContain('this.getLocalizedString("tooltip.status.inSelectedPath", "In selected path")');
        expect(visualSource).toContain("private getTaskVisibleExportColumnText(columnId: LabelColumnId, task: Task, exportDateFormatter: (date: Date) => string): string");
        expect(visualSource).toContain('case "finish": {');
        expect(visualSource).toContain("const date = this.getTaskBarLabelFinish(task);");
        expect(visualSource).toContain("if (cols.showTotalFloat.value && !this.isNoCalculationMode())");
        expect(headerSource).toContain('if (currentMode === "none")');
        expect(headerSource).toContain('if (this.currentState.currentMode === "none")');
        expect(headerLayoutSource).toContain('const isNoCalculationMode = input.currentMode === "none";');
        expect(headerLayoutSource).toContain("showAll: !isNoCalculationMode");
        expect(headerLayoutSource).toContain("modeToggle: !isNoCalculationMode");
        expect(taskBarGeometrySource).toContain("treatZeroDurationAsMilestone && task.duration === 0");
    });

    it("treats full-network cycles as advisories and blocks only affected driving scopes", () => {
        const visualSource = readFileSync("src/visual.ts", "utf8");
        const dataProcessorSource = readFileSync("src/data/DataProcessor.ts", "utf8");
        const slice = (source: string, startMarker: string, endMarker: string) => {
            const start = source.indexOf(startMarker);
            const end = source.indexOf(endMarker, start);
            expect(start).toBeGreaterThan(-1);
            expect(end).toBeGreaterThan(start);
            return source.slice(start, end);
        };

        const cpmSafeSource = slice(dataProcessorSource, "const cpmSafe =", "const dataQuality");
        const pathBuilderSource = slice(visualSource, "private buildBestDrivingChains(", "private buildBestDrivingChainsToTarget(");
        const toTargetSource = slice(visualSource, "private buildBestDrivingChainsToTarget(", "private buildBestDrivingChainsFromSource(");
        const fromSourceSource = slice(visualSource, "private buildBestDrivingChainsFromSource(", "private sortAndStoreDrivingChains(");
        const wholePathSource = slice(visualSource, "private identifyLongestPathFromP6()", "private identifyDrivingRelationships()");
        const authoritativeSource = slice(visualSource, "private calculateAuthoritativeLongestPathState()", "private ensureAuthoritativeLongestPathState()");
        const selectedTargetSource = slice(visualSource, "private calculateCPMToTask(", "private calculateCPMFromTask(");
        const selectedSourceSource = slice(visualSource, "private calculateCPMFromTask(", "private identifyPredecessorTasksFloatBased(");
        const modeStatusSource = slice(
            visualSource,
            "private getDrivingLogicStatusMessage()",
            "private getModeWarningMessage()"
        );
        const modeWarningSource = slice(
            visualSource,
            "private getModeWarningMessage()",
            "private ensureTaskSortCache("
        );

        expect(cpmSafeSource).not.toContain("circularPaths.length === 0");
        expect(dataProcessorSource).toContain("Circular dependencies detected");
        expect(dataProcessorSource).toContain('longestPathAdvisories.push(');
        expect(dataProcessorSource).toContain('circular relationship path(s) detected; affected driving scopes remain blocked');
        expect(dataProcessorSource).not.toContain('longestPathBlockers.push(`circular relationship paths');
        expect(dataProcessorSource).toContain("const longestPathSafe = longestPathBlockers.length === 0;");
        expect(wholePathSource).toContain("if (!this.isCpmSafe())");
        expect(authoritativeSource).toContain("this.getDrivingTopologicalOrder(membership.taskIds) === null");
        expect(authoritativeSource).toContain("this.setScopedCycleWarningMessage();");
        expect(modeStatusSource).toContain("return null;");
        expect(modeWarningSource).toContain("return null;");
        expect(modeStatusSource).not.toContain("longestPathAdvisories");
        expect(modeWarningSource).not.toContain("longestPathBlockers");
        expect(modeWarningSource).not.toContain("scopedCycleWarningMessage");
        expect(visualSource).toContain("type DrivingChainBuildResult = {");
        expect(visualSource).toContain("blockedByCycle: boolean;");
        expect(pathBuilderSource).toContain("return this.createDrivingChainBuildResult([], true);");
        expect(wholePathSource).toContain("if (drivingChains.blockedByCycle)");
        expect(wholePathSource).toContain("this.setScopedCycleWarningMessage();");
        expect(toTargetSource).toContain("if (result.blockedByCycle || result.chains.length > 0)");
        expect(fromSourceSource).toContain("if (result.blockedByCycle || result.chains.length > 0)");
        expect(selectedTargetSource).toContain("if (chains.blockedByCycle)");
        expect(selectedTargetSource).toContain("return;");
        expect(selectedSourceSource).toContain("if (chains.blockedByCycle)");
        expect(selectedSourceSource).toContain("return;");
    });

    it("presents up to 10 deterministically ranked Longest Paths with navigation", () => {
        const visualSource = readFileSync("src/visual.ts", "utf8");
        const settingsSource = readFileSync("src/settings.ts", "utf8");
        const capabilitiesSource = readFileSync("capabilities.json", "utf8");
        const architectureSource = readFileSync("VISUAL_ARCHITECTURE.md", "utf8");
        const resourcesSource = readFileSync("stringResources/en-US/resources.resjson", "utf8");
        const slice = (source: string, startMarker: string, endMarker: string) => {
            const start = source.indexOf(startMarker);
            const end = source.indexOf(endMarker, start);
            expect(start).toBeGreaterThan(-1);
            expect(end).toBeGreaterThan(start);
            return source.slice(start, end);
        };

        const globalPathSource = slice(
            visualSource,
            "private identifyLongestPathFromP6()",
            "private identifyDrivingRelationships()"
        );
        const authoritativeSource = slice(
            visualSource,
            "private calculateAuthoritativeLongestPathState()",
            "private ensureAuthoritativeLongestPathState()"
        );
        const backwardTraceSource = slice(
            visualSource,
            "private calculateCPMToTask(",
            "private calculateCPMFromTask("
        );
        const forwardTraceSource = slice(
            visualSource,
            "private calculateCPMFromTask(",
            "private identifyPredecessorTasksFloatBased("
        );
        const pathInfoSource = slice(
            visualSource,
            "private updatePathInfoLabel(",
            "private identifyNearCriticalTasks()"
        );
        const pathSettingsSource = slice(
            settingsSource,
            "class PathSelectionCard extends Card",
            "class WBSGroupingCard extends Card"
        );

        expect(globalPathSource).toContain("const selectedChain = this.getSelectedDrivingChain();");
        expect(globalPathSource).toContain("this.applyDrivingPresentation(selectedChain.tasks, selectedChain.relationships);");
        expect(authoritativeSource).toContain("task.isLongestPath = membership.taskIds.has(task.internalId);");
        expect(backwardTraceSource).toContain('collectDrivingTraceMembership(');
        expect(backwardTraceSource).toContain("this.applyDrivingPresentation(selectedChain.tasks, selectedChain.relationships);");
        expect(forwardTraceSource).toContain('collectDrivingTraceMembership(');
        expect(forwardTraceSource).toContain("this.applyDrivingPresentation(selectedChain.tasks, selectedChain.relationships);");
        expect(visualSource).toContain("DRIVING_PATH_DURATION_TOLERANCE_DAYS");
        expect(visualSource).toContain("private static readonly DRIVING_PATH_SELECTOR_MAX_PATHS: number = 10;");
        expect(visualSource).toContain("selectRankedDrivingPaths(");
        expect(visualSource).toContain("private pendingSelectedPathIndex: number | null = null;");
        expect(visualSource).toContain("resolveDrivingPathSelectionIndex(");
        expect(visualSource).toContain("this.pendingSelectedPathIndex = this.selectedPathIndex;");
        expect(visualSource).toContain("private reconcilePendingPathSelection()");
        expect((visualSource.match(/this\.reconcilePendingPathSelection\(\);/g) ?? []).length).toBeGreaterThanOrEqual(3);
        expect(pathInfoSource).toContain("const visibleLabel = getPathSelectorVisibleLabel(layoutMode");
        expect(pathInfoSource).toContain("Calendar span ${span.spoken}");
        expect(pathInfoSource).toContain("Early Start ${startText}. Early Finish ${finishText}.");
        expect(pathInfoSource).toContain(".text(visibleLabel)");
        expect(pathInfoSource).toContain('"Longest Path criteria: latest Finish Date; lowest signed finite incoming "');
        expect(pathInfoSource).not.toContain("Primary Longest Path");
        expect(pathInfoSource).not.toContain("additional exact-duration driving");
        expect(pathInfoSource).toContain('appendNavigationButton("previous"');
        expect(pathInfoSource).toContain('appendNavigationButton("next"');
        expect(pathInfoSource).toContain("private navigateDrivingPath(offset: -1 | 1)");
        expect(pathInfoSource).toContain("private persistPathSelection()");
        expect(pathInfoSource).not.toContain("showPathNavigationFeedback");
        expect(pathInfoSource).toContain('.append<HTMLButtonElement>("button")');
        expect(pathInfoSource).toContain('.attr("role", "group")');
        expect(pathInfoSource).not.toContain('.attr("role", "status")');
        expect(pathSettingsSource).not.toContain("this.enableMultiPathToggle,");
        expect(pathSettingsSource).not.toContain("enableMultiPathToggle");
        expect(capabilitiesSource).not.toContain('"enableMultiPathToggle"');
        expect(pathSettingsSource).not.toContain("this.selectedPathIndex,");
        expect(pathSettingsSource).toContain("maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 10 }");
        expect(capabilitiesSource).toContain('"displayName": "Selected Path"');
        expect(architectureSource).toContain("the presented set is capped at 10");
        expect(visualSource).toContain('"tooltip.status.primaryLongestPath",');
        expect(visualSource).toContain('"On Longest Path"');
        expect(visualSource).not.toContain('"On Primary Longest Path"');
        expect(resourcesSource).toContain('"tooltip.status.primaryLongestPath": "On Longest Path"');
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
        expect(showCriticalSource).toContain("const activeColor = this.getHeaderActiveIconColor(this.getHeaderDangerColor());");
        expect(showCriticalSource).toContain("const buttonFill = this.getHeaderControlBackground();");
        expect(showCriticalSource).not.toContain("HEADER_DOCK_TOKENS.dangerBg");

        const baselineSource = slice(headerSource, "private createOrUpdateBaselineToggleButton()", "private createOrUpdatePreviousUpdateToggleButton()");
        const previousUpdateSource = slice(headerSource, "private createOrUpdatePreviousUpdateToggleButton()", "private getExtendedLayoutMode");
        expect(baselineSource).toContain("const inactiveColor = this.getHeaderInactiveIconColor();");
        expect(previousUpdateSource).toContain("const inactiveColor = this.getHeaderInactiveIconColor();");
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
        const connectorSource = slice(headerSource, "private createConnectorLinesToggleButton()", "private createWbsExpandCycleToggleButton()");
        const overflowActiveColourSource = slice(headerSource, "private getHeaderMenuItemActiveColor", "private renderActionOverflowMenu");
        const exportSource = slice(headerSource, "private createExportButton()", "private createExportHtmlButton()");
        expect(connectorSource).toContain("const activeTextColor = this.getHeaderActiveIconColor(this.getHeaderSuccessColor());");
        expect(columnsSource).toContain("const activeTextColor = this.getHeaderActiveIconColor(this.getHeaderSuccessColor());");
        expect(wbsEnableSource).toContain("const activeTextColor = this.getHeaderActiveIconColor(this.getHeaderSuccessColor());");
        expect(overflowActiveColourSource).toContain("const enabledColor = this.getHeaderActiveIconColor(this.getHeaderSuccessColor());");
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
        expect(traceModeSource).toContain('const labelBackward = isCompact ? "Back" : "Backward";');
        expect(traceModeSource).toContain('const labelForward = isCompact ? "Fwd" : "Forward";');
        expect(traceModeSource).toContain("const activeBackground = this.highContrastMode ? \"transparent\" : this.toRgba(activeColor, 0.14);");
        expect(traceModeSource).toContain("const borderColor = this.getHeaderLegendBorderColor();");
        expect(traceModeSource).toContain('.style("box-shadow", "none")');
        expect(traceModeSource).toContain('.style("background-color", isActive ? activeBackground : "transparent")');
        expect(traceModeSource).toContain('.style("border", "none")');
        expect(traceModeSource).toContain('.style("border-left", option.value === "forward" ? `1px solid ${borderColor}` : "none")');
        expect(traceModeSource).not.toContain("HEADER_DOCK_TOKENS.primaryBg");
        expect(traceModeSource).not.toContain("HEADER_DOCK_TOKENS.shadow");
        expect(taskDropdownSource).toContain("const activeColor = this.getHeaderLegendActiveColor();");
        expect(taskDropdownSource).toContain("const defaultBg = menuBackground;");
        expect(taskDropdownSource).not.toContain("HEADER_DOCK_TOKENS.menuActive");
        expect(legendSource).toContain('const selectedBackground = this.highContrastMode ? "transparent" : controlBackground;');
        expect(legendSource).toContain('const unselectedBackground = this.highContrastMode ? "transparent" : controlBackground;');
        expect(legendSource).toContain("const visibleChipReservedWidth = Math.ceil");
        expect(legendSource).toContain('.style("width", `${visibleChipReservedWidth}px`)');
        expect(legendSource).toContain("const hiddenChipReservedWidth = Math.ceil");
        expect(legendSource).toContain('.style("visibility", isFiltered ? "visible" : "hidden")');
        expect(legendSource).toContain('.style("width", `${hiddenChipReservedWidth}px`)');
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
        expect(resolvedPaletteSource).toContain("const activeColor = this.getHeaderLegendActiveColor();");
        expect(resolvedPaletteSource).toContain("commandStroke: borderColor");
        expect(resolvedPaletteSource).toContain("contextStroke: borderColor");
        expect(resolvedPaletteSource).toContain("groupStroke: borderColor");
        expect(resolvedPaletteSource).toContain("buttonStroke: borderColor");
        expect(resolvedPaletteSource).toContain("buttonHoverStroke: borderColor");
        expect(resolvedPaletteSource).toContain("chipStroke: borderColor");
        expect(resolvedPaletteSource).toContain("inputStroke: borderColor");
        expect(resolvedPaletteSource).toContain("inputFocus: activeColor");
        expect(resolvedPaletteSource).toContain("menuStroke: borderColor");
        expect(resolvedPaletteSource).toContain("primary: activeColor");
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
        expect(styleSource).toContain("var(--lpv-header-legend-active-color, #7CABFF)");
    });

    it("uses a text-free initial-load indicator with configured header colours", () => {
        const visualSource = readFileSync("src/visual.ts", "utf8");
        const styleSource = readFileSync("style/visual.less", "utf8");
        const slice = (source: string, startMarker: string, endMarker: string) => {
            const start = source.indexOf(startMarker);
            const end = source.indexOf(endMarker, start);
            expect(start).toBeGreaterThan(-1);
            expect(end).toBeGreaterThan(start);
            return source.slice(start, end);
        };

        const loadingConstructorSource = slice(visualSource, 'this.loadingOverlay = this.scrollableContainer.append("div")', 'this.mainSvg = this.scrollableContainer.append("svg")');
        const initialLoadHelpersSource = slice(visualSource, "private applyInitialLoadChromeColors()", "public update(options: VisualUpdateOptions)");
        const indicatorGateSource = slice(visualSource, "private shouldShowInitialLoadIndicator(", "private showInitialLoadIndicator()");
        const updateSource = slice(visualSource, "private async updateInternal(options: VisualUpdateOptions)", "private handleViewportOnlyUpdate(");
        const loadingStyleSource = slice(styleSource, ".loading-overlay {", "}");

        expect(visualSource).toContain("private hasCompletedInitialDataRender: boolean = false;");
        expect(loadingConstructorSource).toContain('attr("class", "initial-load-progress-line")');
        expect(loadingConstructorSource).toContain('.style("height", "2px")');
        expect(loadingConstructorSource).toContain("this.getVisualBackgroundColor()");
        expect(loadingConstructorSource).toContain("this.getHeaderLegendActiveColor()");
        expect(initialLoadHelpersSource).toContain("const visualBackground = this.getVisualBackgroundColor();");
        expect(initialLoadHelpersSource).toContain("const headerBackground = this.getHeaderLegendBackgroundColor();");
        expect(initialLoadHelpersSource).toContain("const activeColor = this.getHeaderLegendActiveColor();");
        expect(initialLoadHelpersSource).toContain('this.stickyHeaderContainer?.style("background-color", headerBackground)');
        expect(initialLoadHelpersSource).toContain('this.loadingAccent?.style("background", activeColor)');
        expect(initialLoadHelpersSource).toContain('this.loadingOverlay.style("display", "block")');
        expect(indicatorGateSource).toContain("!this.hasCompletedInitialDataRender");
        expect(indicatorGateSource).toContain("const hasRenderedTaskData = this.allTasksData.length > 0;");
        expect(indicatorGateSource).toContain("const includesDataUpdate = (options.type & VisualUpdateType.Data) !== 0;");
        expect(indicatorGateSource).toContain("!!dataView");
        expect(indicatorGateSource).toContain("updateType !== UpdateType.SettingsOnly");
        expect(indicatorGateSource).toContain("updateType !== UpdateType.ViewportOnly");
        expect(updateSource).toContain("const shouldShowInitialLoadIndicator = this.shouldShowInitialLoadIndicator(updateType, options, dataView);");
        expect(updateSource).toContain("await this.yieldInitialLoadFrame();");
        expect(updateSource).toContain("this.completeInitialDataRender();");

        const settingsIndex = updateSource.indexOf("this.settings = this.formattingSettingsService.populateFormattingSettingsModel(VisualSettings, dataView);");
        const colourIndex = updateSource.indexOf("this.applyInitialLoadChromeColors();", settingsIndex);
        const yieldIndex = updateSource.indexOf("await this.yieldInitialLoadFrame();", colourIndex);
        const signatureIndex = updateSource.indexOf("const dataSignature = this.getDataSignature(dataView);");
        const processIndex = updateSource.indexOf("const processedData = this.dataProcessor.processData(");
        expect(settingsIndex).toBeGreaterThan(-1);
        expect(colourIndex).toBeGreaterThan(settingsIndex);
        expect(yieldIndex).toBeGreaterThan(colourIndex);
        expect(signatureIndex).toBeGreaterThan(yieldIndex);
        expect(processIndex).toBeGreaterThan(signatureIndex);

        const noDataViewSource = slice(updateSource, "if (!options || !options.dataViews || !options.dataViews[0] || !options.viewport)", "const dataView = options.dataViews[0];");
        expect(noDataViewSource).toContain("this.hideInitialLoadIndicator();");
        expect(noDataViewSource).not.toContain("this.completeInitialDataRender();");

        expect(visualSource).not.toContain("loadingText");
        expect(visualSource).not.toContain("loadingRowsText");
        expect(visualSource).not.toContain("loadingProgressText");
        expect(visualSource).not.toContain("setLoadingOverlayVisible");
        expect(loadingConstructorSource).not.toContain("overlayContent");
        expect(loadingConstructorSource).not.toContain("Loading data");
        expect(loadingConstructorSource).not.toContain("Initializing");
        expect(loadingStyleSource).not.toContain("backdrop-filter");
        expect(loadingStyleSource).not.toContain("justify-content: center");
        expect(loadingStyleSource).not.toContain("box-shadow");
    });

    it("keeps transient invalid dataViews out of the renderable update cache", () => {
        const visualSource = readFileSync("src/visual.ts", "utf8");
        const slice = (source: string, startMarker: string, endMarker: string) => {
            const start = source.indexOf(startMarker);
            const end = source.indexOf(endMarker, start);
            expect(start).toBeGreaterThan(-1);
            expect(end).toBeGreaterThan(start);
            return source.slice(start, end);
        };

        const updateSource = slice(visualSource, "private async updateInternal(options: VisualUpdateOptions)", "private handleViewportOnlyUpdate(");
        const beforeValidationSource = slice(updateSource, "const updateType = this.determineUpdateType(options);", "if (!this.dataProcessor.validateDataView(dataView, this.settings))");
        const validationFailureSource = slice(updateSource, "if (!this.dataProcessor.validateDataView(dataView, this.settings))", "this.debugLog(\"Data roles validated.\");");
        const renderableCacheSource = slice(updateSource, "this.debugLog(\"Data roles validated.\");", "const shouldShowInitialLoadIndicator");
        const requestUpdateSource = slice(visualSource, "private requestUpdate(forceFullUpdate: boolean = false, viewport?: IViewport): void", "private applyPublishModeOptimizations()");
        const updateTypeSource = slice(visualSource, "private determineUpdateType(options: VisualUpdateOptions): UpdateType", "public destroy(): void");

        expect(visualSource).toContain("private lastHostUpdateOptions: VisualUpdateOptions | null = null;");
        expect(visualSource).toContain("private preserveRenderedVisualForTransientInvalidUpdate(reason: string, viewport?: IViewport): boolean");
        expect(beforeValidationSource).toContain("this.lastHostUpdateOptions = options;");
        expect(beforeValidationSource).not.toContain("this.lastUpdateOptions = options;");
        expect(beforeValidationSource).not.toContain("this.lastUpdateOptions = { ...options, viewport: renderedViewport };");
        expect(validationFailureSource).toContain('this.preserveRenderedVisualForTransientInvalidUpdate("invalid dataView", renderedViewport)');
        expect(validationFailureSource).not.toContain("this.completeInitialDataRender();");
        expect(renderableCacheSource).toContain("this.lastUpdateOptions = renderedOptions;");
        expect(requestUpdateSource).toContain("this.lastUpdateOptions");
        expect(requestUpdateSource).not.toContain("this.lastHostUpdateOptions");
        expect(updateTypeSource).toContain("const previousOptions = this.lastHostUpdateOptions ?? this.lastUpdateOptions;");
    });

    it("defers rendering while Power BI provides additional data segments", () => {
        const visualSource = readFileSync("src/visual.ts", "utf8");
        const dataProcessorSource = readFileSync("src/data/DataProcessor.ts", "utf8");
        const interfacesSource = readFileSync("src/data/Interfaces.ts", "utf8");
        const slice = (source: string, startMarker: string, endMarker: string) => {
            const start = source.indexOf(startMarker);
            const end = source.indexOf(endMarker, start);
            expect(start).toBeGreaterThan(-1);
            expect(end).toBeGreaterThan(start);
            return source.slice(start, end);
        };

        const updateSource = slice(visualSource, "private async updateInternal(options: VisualUpdateOptions)", "private handleViewportOnlyUpdate(");
        const segmentSource = slice(visualSource, "private dataViewHasMoreSegments(dataView: DataView): boolean", "private applyInitialLoadChromeColors()");
        const loadingStatusSource = slice(visualSource, "private showDataSegmentLoadingStatus(message: string): void", "private completeInitialDataRender(): void");
        const processDataCallSource = slice(updateSource, "const processedData = this.dataProcessor.processData(", ");");
        const dataQualitySource = slice(dataProcessorSource, "private validateDataQuality(", "private detectCircularDependencies(");

        expect(visualSource).toContain("private isFetchingDataSegments: boolean = false;");
        expect(visualSource).toContain("private loadedSegmentRowCount: number = 0;");
        expect(visualSource).toContain("private hasMoreDataSegments: boolean = false;");
        expect(visualSource).toContain("private dataFetchLimitReached: boolean = false;");
        expect(visualSource).toContain('private dataSegmentStatusMessage: string = "";');
        expect(segmentSource).toContain("return !!dataView.metadata?.segment;");
        expect(segmentSource).toContain("this.host.fetchMoreData(true)");
        expect(segmentSource).toContain("this.showDataSegmentLoadingStatus(loadingMessage);");
        expect(segmentSource).toContain("Power BI data limit reached; results may be incomplete");
        expect(updateSource.indexOf("if (this.deferForPendingDataSegments(dataView))")).toBeGreaterThan(-1);
        expect(updateSource.indexOf("this.lastUpdateOptions = renderedOptions;")).toBeGreaterThan(
            updateSource.indexOf("if (this.deferForPendingDataSegments(dataView))")
        );
        expect(processDataCallSource).toContain("this.dataFetchLimitReached");
        expect(loadingStatusSource).toContain(".data-segment-status");
        expect(loadingStatusSource).toContain('attr("aria-live", "polite")');
        expect(dataProcessorSource).toContain("dataFetchLimitReached: boolean = false");
        expect(interfacesSource).toContain("dataFetchLimitReached: boolean;");
        expect(dataQualitySource).toContain("const possibleTruncation = dataFetchLimitReached;");
        expect(dataQualitySource).not.toContain("rowCount >= 30000");
    });

    it("preserves rendered content for missing transient dataViews and still shows true landing state", () => {
        const visualSource = readFileSync("src/visual.ts", "utf8");
        const slice = (source: string, startMarker: string, endMarker: string) => {
            const start = source.indexOf(startMarker);
            const end = source.indexOf(endMarker, start);
            expect(start).toBeGreaterThan(-1);
            expect(end).toBeGreaterThan(start);
            return source.slice(start, end);
        };

        const updateSource = slice(visualSource, "private async updateInternal(options: VisualUpdateOptions)", "private handleViewportOnlyUpdate(");
        const noDataViewSource = slice(updateSource, "if (!options || !options.dataViews || !options.dataViews[0] || !options.viewport)", "const dataView = options.dataViews[0];");
        const validationFailureSource = slice(updateSource, "if (!this.dataProcessor.validateDataView(dataView, this.settings))", "this.debugLog(\"Data roles validated.\");");
        const preserveSource = slice(visualSource, "private preserveRenderedVisualForTransientInvalidUpdate", "private queueSettledResizeUpdate");
        const landingResetSource = slice(visualSource, "private resetLandingPageSurface()", "private getRoleDisplayName(");
        const displayLandingSource = slice(visualSource, "private displayLandingPage(missingRoles: string[] = [])", "// ============================================================================");

        expect(noDataViewSource).toContain('this.preserveRenderedVisualForTransientInvalidUpdate("missing dataView", options?.viewport)');
        expect(noDataViewSource).toContain("this.displayLandingPage();");
        expect(validationFailureSource).toContain("this.displayLandingPage(missingRoles);");
        expect(preserveSource).toContain("if (!this.lastUpdateOptions || this.allTasksData.length === 0)");
        expect(preserveSource).toContain("this.hideInitialLoadIndicator();");
        expect(preserveSource).toContain("this.clearLandingPage();");
        expect(preserveSource).toContain("this.handleViewportOnlyUpdate(replayOptions);");
        expect(landingResetSource).toContain("containerNode.scrollTop = 0;");
        expect(landingResetSource).toContain("this.syncSvgPixelSize(this.mainSvg, width, height);");
        expect(landingResetSource).toContain("this.syncSvgPixelSize(this.headerSvg, width, this.headerHeight);");
        expect(displayLandingSource).toContain("this.resetLandingPageSurface();");
        expect(displayLandingSource).toContain('.style("position", "absolute")');
        expect(displayLandingSource).toContain('.style("top", "0")');
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
        const traceModeSource = slice(visualSource, "private createTraceModeToggle(): void", "private populateTaskDropdown(): void");
        const lookAheadWrapperSource = slice(headerSource, '.upsertDiv("look-ahead-control-wrapper")', "if (!isCompact)");
        const floatThresholdSource = slice(headerSource, "private createFloatThresholdControl(): void", "private createModeToggleButton(): void");
        const taskSelectionListStyle = slice(styleSource, ".task-selection-list {", ".selected-task-label {");

        expect(constructorChromeSource).toContain('.style("box-shadow", "none")');
        expect(constructorChromeSource).not.toContain("HEADER_DOCK_TOKENS.shadow");
        expect(taskDropdownSource).toContain('.style("box-shadow", "none")');
        expect(taskDropdownSource).not.toContain("HEADER_DOCK_TOKENS.shadow");
        expect(taskDropdownSource).not.toContain("HEADER_DOCK_TOKENS.primaryBg");
        expect(traceModeSource).toContain('.style("box-shadow", "none")');
        expect(traceModeSource).not.toContain("HEADER_DOCK_TOKENS.shadow");
        expect(lookAheadWrapperSource).toContain('.style("box-shadow", "none")');
        expect(lookAheadWrapperSource).not.toContain("this.getHeaderShadow()");
        expect(floatThresholdSource).toContain('.style("box-shadow", "none")');
        expect(floatThresholdSource).not.toContain("this.getHeaderShadow()");
        expect(floatThresholdSource).not.toContain("HEADER_DOCK_TOKENS.primaryBg");
        expect(taskSelectionListStyle).toContain("box-shadow: none;");
    });

    it("does not render a visible copyright watermark inside the visual", () => {
        const visualSource = readFileSync("src/visual.ts", "utf8");

        expect(visualSource).not.toContain("visual-watermark");
        expect(visualSource).not.toContain("watermarkOverlay");
        expect(visualSource).not.toMatch(/\u00a9\s+Ricardo Aguirre/);
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

    it("exposes the start/finish progress line format card", () => {
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
            "dateMode",
            "referenceFinish",
            "lineColor",
            "startLineColor",
            "lineWidth",
            "lineStyle",
            "showMarkers",
            "markerSize",
            "bandColor",
            "recoveryBandColor",
            "slippageBandColor",
            "bandTransparency",
            "includeWbsGroups",
            "showLabel",
            "showAnalysisLegend",
            "showVarianceLabels",
            "showVarianceTooltips"
        ]);
        expect(properties.dateMode.type.enumeration.map((item: { value: string }) => item.value)).toEqual([
            "finish",
            "start",
            "both"
        ]);
        expect(properties.referenceFinish.type.enumeration.map((item: { value: string }) => item.value)).toEqual([
            "baselineFinish",
            "previousUpdateFinish"
        ]);

        expect(visualSource).toContain("calculateDateVarianceProgressPoint");
        expect(visualSource).toContain("getEffectiveProgressLineDate");
        expect(visualSource).toContain("getProgressLineBandSegmentsBetweenPairs");
        expect(visualSource).toContain("interpolateProgressLinePoint");
        expect(visualSource).toContain("getWbsProgressLineReferenceDate");
        expect(visualSource).toContain("summaryBaselineStartDate");
        expect(visualSource).toContain("summaryBaselineFinishDate");
        expect(visualSource).toContain("summaryPreviousUpdateStartDate");
        expect(visualSource).toContain("summaryPreviousUpdateFinishDate");
        expect(visualSource).toContain("progress-line-band");
        expect(visualSource).toContain("progress-line-band-${segment.tone}");
        expect(visualSource).toContain("progress-line-analysis-legend-group");
        expect(visualSource).toContain("progress-line-variance-label");
        expect(visualSource).toContain("showProgressLineTooltip");
        expect(visualSource).toContain("progress-line-tooltip-target");
        expect(visualSource).toContain("getProgressLineTooltipHitRadius");
        expect(visualSource).toContain("getProgressLineBandSegmentPolygon");
        expect(visualSource).toContain("isPointInsidePolygon");
        expect(visualSource).toContain("return !!(this.settings?.progressLine?.showVarianceTooltips?.value ?? true)");
        expect(visualSource).not.toContain("showMarkers && showVarianceTooltips");
        expect(visualSource).toContain("prioritySlippageCount");
        expect(settingsSource).toContain('name: "showAnalysisLegend"');
        expect(settingsSource).toContain('name: "showVarianceLabels"');
        expect(settingsSource).toContain('name: "showVarianceTooltips"');
        expect(visualSource).toContain("recoveryBandColor");
        expect(visualSource).toContain("slippageBandColor");
        expect(visualSource).toContain("drawProgressLine(renderableTasks");
        expect(visualSource).toContain("onToggleProgressLine: () => this.toggleProgressLineDisplay()");
        expect(visualSource).toContain("onProgressLineReferenceChanged: (reference) => this.setProgressLineReference(reference)");
        expect(visualSource).toContain("onProgressLineDateModeChanged: (dateMode) => this.setProgressLineDateMode(dateMode)");
        expect(visualSource).toContain("onToggleProgressLineVarianceLabels: () => this.toggleProgressLineVarianceLabels()");
        expect(visualSource).toContain("properties: {");
        expect(visualSource).toContain("referenceFinish: reference");
        expect(visualSource).toContain("dateMode");
        expect(visualSource).toContain("showVarianceLabels: nextVisible");
        expect(headerSource).toContain("renderProgressLineMenuItem");
        expect(headerSource).toContain("onProgressLineReferenceChanged");
        expect(headerSource).toContain("onProgressLineDateModeChanged");
        expect(headerSource).toContain("onToggleProgressLineVarianceLabels");
        expect(headerSource).toContain("progressLineVarianceLabelsVisible");
        expect(headerSource).toContain("progress-line-variance-labels-toggle-button");
        expect(headerSource).toContain("progressLineBaselineAvailable");
        expect(headerSource).toContain("progressLineStartAvailable");
        expect(headerSource).toContain("progressLineFinishAvailable");
        expect(headerSource).toContain("progressLineBothAvailable");
        expect(visualSource).toContain("progressLineAvailable: progressLineStartAvailable || progressLineFinishAvailable || progressLineBothAvailable");
        expect(visualSource).toContain("const resolvedConfig = this.resolveProgressLineConfig(reference, dateMode)");
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
        expect(progressMenuSource).toContain("this.callbacks.onProgressLineDateModeChanged(dateMode.value)");
        expect(progressMenuSource).toContain("this.callbacks.onToggleProgressLineVarianceLabels()");
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
        expect(visualSource).toContain("Longest Path Selector");
        expect(visualSource).toContain("Path 1 is the highest-ranked route.");
        expect(visualSource).toContain("Medium and wide layouts show the elapsed calendar span");
        expect(visualSource).not.toContain("Warnings & Data Quality");
        expect(visualSource).not.toContain("Missing Predecessor Activities");
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
        expect(settingsSource).toContain('taskNameHeader = new TextInput({ name: "taskNameHeader", displayName: "Task Name Header"');
        expect(settingsSource).toContain('showStartDate = new ToggleSwitch({ name: "showStartDate", displayName: "Show Start Date", value: true })');
        expect(settingsSource).toContain('startDateHeader = new TextInput({ name: "startDateHeader", displayName: "Start Date Header"');
        expect(settingsSource).toContain('showFinishDate = new ToggleSwitch({ name: "showFinishDate", displayName: "Show Finish Date", value: true })');
        expect(settingsSource).toContain('finishDateHeader = new TextInput({ name: "finishDateHeader", displayName: "Finish Date Header"');
        expect(settingsSource).toContain('showDuration = new ToggleSwitch({ name: "showDuration", displayName: "Show Duration", value: true })');
        expect(settingsSource).toContain('durationHeader = new TextInput({ name: "durationHeader", displayName: "Duration Header"');
        expect(settingsSource).toContain('showTotalFloat = new ToggleSwitch({ name: "showTotalFloat", displayName: "Show Total Float", value: true })');
        expect(settingsSource).toContain('totalFloatHeader = new TextInput({ name: "totalFloatHeader", displayName: "Total Float Header"');
        expect(settingsSource).toContain('showBaselineDateColumns = new ToggleSwitch({ name: "showBaselineDateColumns"');
        expect(settingsSource).toContain('value: false');
        expect(settingsSource).toContain('showPreviousUpdateDateColumns = new ToggleSwitch({ name: "showPreviousUpdateDateColumns"');

        expect(properties.autoFitColumns.type.bool).toBe(true);
        expect(properties.taskNameHeader.type.text).toBe(true);
        expect(properties.startDateHeader.type.text).toBe(true);
        expect(properties.finishDateHeader.type.text).toBe(true);
        expect(properties.durationHeader.type.text).toBe(true);
        expect(properties.totalFloatHeader.type.text).toBe(true);
        expect(properties.baselineStartDateHeader.type.text).toBe(true);
        expect(properties.baselineFinishDateHeader.type.text).toBe(true);
        expect(properties.previousUpdateStartDateHeader.type.text).toBe(true);
        expect(properties.previousUpdateFinishDateHeader.type.text).toBe(true);
        expect(properties.showBaselineDateColumns.type.bool).toBe(true);
        expect(properties.showPreviousUpdateDateColumns.type.bool).toBe(true);
    });

    it("uses manual column header text for rendered and exported headers", () => {
        const visualSource = readFileSync("src/visual.ts", "utf8");

        expect(visualSource).toContain("private getColumnHeaderText(value: string | null | undefined, fallback: string): string");
        expect(visualSource).toContain("private getColumnHeaderCandidates(value: string | null | undefined, fallbackCandidates: string[]): string[]");
        expect(visualSource).toContain('this.getColumnHeaderText(cols.startDateHeader.value, "Start")');
        expect(visualSource).toContain('this.getColumnHeaderText(cols.finishDateHeader.value, "Finish")');
        expect(visualSource).toContain('this.getColumnHeaderText(cols.durationHeader.value, "Rem Dur")');
        expect(visualSource).toContain('this.getColumnHeaderText(cols.totalFloatHeader.value, "Total Float")');
        expect(visualSource).toContain("this.settings?.columns?.taskNameHeader?.value");
        expect(visualSource).toContain("private getExportTaskNameHeader(): string");
        expect(visualSource).toContain("private getVisibleExportColumns(tasks: Task[], includeWbsLevelColumns: boolean): VisibleExportColumn[]");
        expect(visualSource).toContain("this.settings?.columns?.taskNameHeader?.value");
        expect(visualSource).toContain("header: column.text");
        expect(visualSource).toContain("const maxHeaderLines = bandMetrics.height >= fontSizePx * 2.35 ? 2 : 1;");
        expect(visualSource).toContain("this.renderWrappedSvgText(");
        expect(visualSource).toContain('"centerBlock"');
    });

    it("hides the Start column for finish-only visualiser data", () => {
        const visualSource = readFileSync("src/visual.ts", "utf8");

        expect(visualSource).toContain("private hasCurrentStartDateData(): boolean");
        expect(visualSource).toContain("return this.allTasksData.some(task => getScheduleStart(task) !== null);");
        expect(visualSource).toContain("private isFinishOnlyVisualiserMode(): boolean");
        expect(visualSource).toContain("return this.isNoCalculationMode() && !this.hasCurrentStartDateData();");
        expect(visualSource).toContain("private shouldShowStartDateColumn(): boolean");
        expect(visualSource).toContain("if (this.shouldShowStartDateColumn())");
    });

    it("keeps a small gutter between the table divider and timeline marks", () => {
        const visualSource = readFileSync("src/visual.ts", "utf8");

        expect(visualSource).toContain("private readonly TIMELINE_LEFT_GUTTER_PX = 12;");
        expect(visualSource).toContain("private getTimelineLeftGutter(chartWidth: number): number");
        expect(visualSource).toContain("return Math.min(this.TIMELINE_LEFT_GUTTER_PX, Math.max(0, chartWidth * 0.2));");
        expect(visualSource).toContain("private setTimelineScaleRange(xScale: ScaleTime<number, number>, chartWidth: number): void");
        expect(visualSource).toContain("xScale.range([this.getTimelineLeftGutter(width), width]);");
        expect(visualSource).toContain("this.setTimelineScaleRange(xScale, chartWidth);");
        expect(visualSource).toContain("this.setTimelineScaleRange(this.xScale, chartWidth);");
        expect(visualSource).not.toContain(".range([0, chartWidth])");
        expect(visualSource).not.toContain("this.xScale.range([0, chartWidth])");
    });

    it("renders finish-only visualiser WBS summaries as descendant milestone dot rows", () => {
        const visualSource = readFileSync("src/visual.ts", "utf8").replace(/\r\n/g, "\n");
        const interfacesSource = readFileSync("src/data/Interfaces.ts", "utf8");
        const slice = (source: string, startMarker: string, endMarker: string) => {
            const start = source.indexOf(startMarker);
            const end = source.indexOf(endMarker, start);
            expect(start).toBeGreaterThanOrEqual(0);
            expect(end).toBeGreaterThan(start);
            return source.slice(start, end);
        };
        const drawWbsSource = slice(visualSource, "private drawWbsGroupHeaders(", "private refreshDateFormatters()");
        const filteredSummarySource = slice(visualSource, "private updateWbsFilteredCounts(", "private assignWbsYOrder(");

        expect(interfacesSource).toContain("export interface WbsSummaryMilestoneMarker");
        expect(interfacesSource).toContain("summaryMilestoneMarkers?: WbsSummaryMilestoneMarker[];");
        expect(visualSource).toContain("private shouldRenderWbsSummaryMilestoneRows(): boolean");
        expect(visualSource).toContain('return this.isFinishOnlyVisualiserMode() && this.getWbsSummaryDisplayMode() === "milestoneDots";');
        expect(drawWbsSource).toContain("const renderWbsSummaryMilestoneRows = this.shouldRenderWbsSummaryMilestoneRows();");
        expect(drawWbsSource).toContain("if (renderWbsSummaryMilestoneRows)");
        expect(drawWbsSource).toContain("const autoMarkerDiameter = Math.max(4, Math.min(8, taskHeight * 0.32));");
        expect(drawWbsSource).toContain("const markerDiameter = configuredSummaryMilestoneSize > 0");
        expect(drawWbsSource).toContain("const markerRadius = markerDiameter / 2;");
        expect(drawWbsSource).toContain("wbs-summary-milestone-current");
        expect(drawWbsSource).toContain("wbs-summary-milestone-previous-update");
        expect(drawWbsSource).toContain("wbs-summary-milestone-baseline");
        expect(drawWbsSource).toContain("} else if (group.summaryStartDate && group.summaryFinishDate) {");
        expect(filteredSummarySource).toContain("const summaryMilestoneMarkers: WbsSummaryMilestoneMarker[] = [];");
        expect(filteredSummarySource).toContain("summaryMilestoneMarkers.push(...(child.summaryMilestoneMarkers ?? []));");
        expect(filteredSummarySource).toContain("summaryBaselineMilestoneMarkers.push(...(child.summaryBaselineMilestoneMarkers ?? []));");
        expect(filteredSummarySource).toContain("summaryPreviousUpdateMilestoneMarkers.push(...(child.summaryPreviousUpdateMilestoneMarkers ?? []));");
    });

    it("exposes a finish-only WBS summary style selector", () => {
        const settingsSource = readFileSync("src/settings.ts", "utf8");
        const capabilities = JSON.parse(readFileSync("capabilities.json", "utf8"));
        const visualSource = readFileSync("src/visual.ts", "utf8");
        const summaryDisplayMode = capabilities.objects.wbsGrouping.properties.summaryDisplayMode;

        expect(summaryDisplayMode.displayName).toBe("Finish-Only Summary Style");
        expect(summaryDisplayMode.type.enumeration.map((item: { value: string }) => item.value)).toEqual([
            "milestoneDots",
            "summaryBar"
        ]);
        expect(settingsSource).toContain("const wbsSummaryDisplayModeItems: powerbi.IEnumMember[] = [");
        expect(settingsSource).toContain('{ value: "milestoneDots", displayName: "Milestone Dots" }');
        expect(settingsSource).toContain('{ value: "summaryBar", displayName: "Summary Bar" }');
        expect(settingsSource).toContain('summaryDisplayMode = new ItemDropdown({');
        expect(settingsSource).toContain('displayName: "Finish-Only Summary Style"');
        expect(settingsSource).toContain('value: wbsSummaryDisplayModeItems.find(item => item.value === "milestoneDots")');
        expect(settingsSource).toContain("this.summaryDisplayMode");
        expect(visualSource).toContain('private getWbsSummaryDisplayMode(): "milestoneDots" | "summaryBar"');
        expect(visualSource).toContain('return rawValue === "summaryBar" ? "summaryBar" : "milestoneDots";');
    });

    it("keeps task and WBS wrapped label rows anchored consistently", () => {
        const visualSource = readFileSync("src/visual.ts", "utf8").replace(/\r\n/g, "\n");

        expect(visualSource).toContain('anchorMode: "centerBlock" | "compactBlock" | "firstLineAtCenter" = "firstLineAtCenter"');
        expect(visualSource).toContain("const wbsRowBandHeight = taskHeight + taskPadding;");
        expect(visualSource).toContain("const lineAdvancePx = Math.max(fontSizePx * 1.02, fontSizePx + 0.5);");
        expect(visualSource).toContain("centerY - ((lines.length - 1) * lineAdvancePx * 0.28)");
        expect(visualSource).toContain('maxLines > 1 ? "compactBlock" : "firstLineAtCenter"');
        expect(visualSource).toContain("const toggleY = maxLines > 1");
        expect(visualSource).toContain("const badgeCenterY = Math.round(bgY + bgHeight / 2);");
        expect(visualSource).toContain("const badgeY = Math.round(badgeCenterY - badgeHeight / 2);");
        expect(visualSource).toContain(".attr('y', badgeCenterY)");
        expect(visualSource).toContain(".paddingOuter(taskPadding / (taskHeight + taskPadding) / 2)\n            .align(0);");
        expect(visualSource).toContain("WBS top-row anchor restoration");
        expect(visualSource).toContain("availableWidth,\n                    wbsRowBandHeight,\n                    groupNameFontSizePx");
    });

    it("scopes WBS finish lines and groups tasks without WBS at the bottom", () => {
        const visualSource = readFileSync("src/visual.ts", "utf8").replace(/\r\n/g, "\n");
        const interfacesSource = readFileSync("src/data/Interfaces.ts", "utf8");
        const slice = (source: string, startMarker: string, endMarker: string) => {
            const start = source.indexOf(startMarker);
            const end = source.indexOf(endMarker, start);
            expect(start).toBeGreaterThan(-1);
            expect(end).toBeGreaterThan(start);
            return source.slice(start, end);
        };

        expect(interfacesSource).toContain("isUnassignedWbsGroup?: boolean;");
        expect(visualSource).toContain('private readonly UNASSIGNED_WBS_GROUP_ID = "__UNASSIGNED_WBS__";');
        expect(visualSource).toContain('private readonly UNASSIGNED_WBS_GROUP_NAME = "Unassigned WBS";');
        expect(visualSource).toContain("this.syncUnassignedWbsGroup(tasksAfterLegendFilter);");

        const finishLineSource = slice(visualSource, "private getTasksForFinishLines(): Task[]", "private getLatestFinishDate(");
        expect(finishLineSource).toContain("this._lastFilteredTasksForFinishLines");
        expect(finishLineSource).toContain("this.getWbsScopedFinishLineTasks(tasks)");
        expect(finishLineSource).toContain("const realWbsTasks = sourceTasks.filter(task => this.isTaskInRealWbsGroup(task));");
        expect(finishLineSource).toContain("return realWbsTasks.length > 0 ? realWbsTasks : sourceTasks;");

        const orderingSource = slice(visualSource, "private applyWbsOrdering(tasks: Task[]): Task[]", "private updateWbsFilteredCounts(filteredTasks: Task[]): void");
        expect(orderingSource).toContain("if (rootGroup.isUnassignedWbsGroup) continue;");
        expect(orderingSource).toContain("const unassignedGroup = this.getUnassignedWbsGroup();");
        expect(orderingSource).toContain("name: this.UNASSIGNED_WBS_GROUP_NAME");
        expect(orderingSource).not.toContain("tasksWithoutWbs");
        const orderedDirectTaskLoopIndex = orderingSource.indexOf("for (const task of this.getSortedVisibleWbsGroupTasks(group, taskSet))");
        const orderedChildGroupLoopIndex = orderingSource.indexOf("for (const child of group.children)");
        const orderedRealRootLoopIndex = orderingSource.indexOf("for (const rootGroup of this.wbsRootGroups)");
        const orderedUnassignedGroupIndex = orderingSource.indexOf("const unassignedGroup = this.getUnassignedWbsGroup();");
        expect(orderedDirectTaskLoopIndex).toBeGreaterThan(-1);
        expect(orderedChildGroupLoopIndex).toBeGreaterThan(-1);
        expect(orderedDirectTaskLoopIndex).toBeLessThan(orderedChildGroupLoopIndex);
        expect(orderedUnassignedGroupIndex).toBeGreaterThan(orderedRealRootLoopIndex);

        const yOrderSource = slice(visualSource, "private assignWbsYOrder(tasksToShow: Task[]): void", "private drawWbsGroupHeaders(");
        expect(yOrderSource).toContain("if (rootGroup.isUnassignedWbsGroup) continue;");
        expect(yOrderSource).toContain("const unassignedGroup = this.getUnassignedWbsGroup();");
        expect(yOrderSource).not.toContain("tasksWithoutWbs");
        const yOrderDirectTaskLoopIndex = yOrderSource.indexOf("for (const task of this.getSortedVisibleWbsGroupTasks(group, visibleTaskIds))");
        const yOrderChildGroupLoopIndex = yOrderSource.indexOf("for (const child of group.children)");
        const yOrderRealRootLoopIndex = yOrderSource.indexOf("for (const rootGroup of this.wbsRootGroups)");
        const yOrderUnassignedGroupIndex = yOrderSource.indexOf("const unassignedGroup = this.getUnassignedWbsGroup();");
        expect(yOrderDirectTaskLoopIndex).toBeGreaterThan(-1);
        expect(yOrderChildGroupLoopIndex).toBeGreaterThan(-1);
        expect(yOrderDirectTaskLoopIndex).toBeLessThan(yOrderChildGroupLoopIndex);
        expect(yOrderUnassignedGroupIndex).toBeGreaterThan(yOrderRealRootLoopIndex);

        const exportRowsSource = slice(visualSource, "private getVisibleWbsExportRows(", "private getExportTableHeaderHtml(");
        expect(exportRowsSource).toContain("visibleWbsGroups.forEach(group =>");
        expect(exportRowsSource).toContain("tasks.forEach(task =>");
        expect(exportRowsSource).toContain("rows.sort((a, b) => a.yOrder - b.yOrder);");
        expect(exportRowsSource).toContain("return tasks.map((task, index) => ({ kind: \"task\", yOrder: index, task }));");
        const exportTableSource = slice(visualSource, "private generateVisibleExportTableHtml(): string", "private generateVisibleExportTableText(): string");
        const exportTasksIndex = exportTableSource.indexOf("const tasks = this.getExportTableTasks();");
        const exportHierarchicalIndex = exportTableSource.indexOf("return this.generateWbsVisibleExportTableHtml(exportDateFormatter, tasks, visibleWbsGroups);");
        expect(exportTasksIndex).toBeGreaterThan(-1);
        expect(exportHierarchicalIndex).toBeGreaterThan(-1);
        expect(exportTasksIndex).toBeLessThan(exportHierarchicalIndex);
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
        expect(capabilities.objects.wbsGrouping.properties.summaryDisplayMode.type.enumeration.map((item: { value: string }) => item.value)).toEqual([
            "milestoneDots",
            "summaryBar"
        ]);
        expect(capabilities.objects.wbsGrouping.properties.summaryBarHeight.type.numeric).toBe(true);
        expect(capabilities.objects.wbsGrouping.properties.summaryMilestoneSize.type.numeric).toBe(true);
        expect(settingsSource).toContain('groupNameColor = new ColorPicker({ name: "groupNameColor", displayName: "WBS Text Color"');
        expect(settingsSource).toContain('summaryDisplayMode = new ItemDropdown({');
        expect(settingsSource).toContain('summaryBarHeight = new NumUpDown({ name: "summaryBarHeight", displayName: "Summary Bar Height (0 = Auto)", value: 0');
        expect(settingsSource).toContain('summaryMilestoneSize = new NumUpDown({ name: "summaryMilestoneSize", displayName: "Summary Milestone Size (0 = Auto)", value: 0');
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
        expect(drawWbsSource).toContain("const configuredSummaryBarHeight = Math.max(0, Number(this.settings.wbsGrouping.summaryBarHeight?.value ?? 0));");
        expect(drawWbsSource).toContain("const configuredSummaryMilestoneSize = Math.max(0, Number(this.settings.wbsGrouping.summaryMilestoneSize?.value ?? 0));");
        expect(drawWbsSource).toContain("const collapsedBarHeight = Math.max(2, taskHeight * 0.42);");
        expect(drawWbsSource).toContain("const expandedBarHeight = Math.max(3, Math.min(4, taskBarHeight * 0.3));");
        expect(drawWbsSource).toContain("const configuredBarHeight = configuredSummaryBarHeight > 0");
        expect(drawWbsSource).toContain("const barHeight = configuredBarHeight ?? (isCollapsed ? collapsedBarHeight : expandedBarHeight);");
        expect(drawWbsSource).toContain("const expandedSummaryLineColor = self.highContrastMode");
        expect(drawWbsSource).toContain("const mainSummaryFillColor = isCollapsed ? summaryFillColor : expandedSummaryLineColor;");
        expect(drawWbsSource).toContain("const baseOpacity = self.highContrastMode ? 1 : (isCollapsed ? 0.66 : 0.94);");
        expect(drawWbsSource).toContain("const comparisonBarOpacity = self.highContrastMode");
        expect(drawWbsSource).toContain("const summarySemanticOpacity = self.highContrastMode");
        expect(drawWbsSource).toContain("const semanticBarHeight = isCollapsed ? barHeight : Math.max(1.5, Math.min(2, barHeight * 0.52));");
        expect(drawWbsSource).toContain("const summaryOverlayHeight = isCollapsed ? barHeight : Math.max(1, Math.min(2, barHeight * 0.5));");
        expect(drawWbsSource).toContain(".style('fill', mainSummaryFillColor).style('opacity', barOpacity)");
        expect(drawWbsSource).toContain(".style('stroke', mainSummaryStrokeColor).style('stroke-width', mainSummaryStrokeWidth);");
        expect(drawWbsSource).toContain("wbs-summary-cap-start");
        expect(drawWbsSource).toContain("wbs-summary-bracket-start");
        expect(drawWbsSource).toContain("wbs-summary-bracket-end");
        expect(drawWbsSource).toContain(".style('stroke-linecap', 'square')");
        expect(drawWbsSource).toContain(".attr('x', criticalStartX).attr('y', semanticBarY).attr('width', criticalWidth).attr('height', semanticBarHeight)");
        expect(drawWbsSource).toContain(".attr('x', nearStartX).attr('y', semanticBarY).attr('width', nearWidth).attr('height', semanticBarHeight)");
        expect(drawWbsSource).not.toContain("mutedTextColor");

        const wbsExportStyleSource = slice(visualSource, "private getWbsExportRowBackgroundColor(", "private getExportTableTasks()");
        expect(wbsExportStyleSource).toContain("this.getWbsLevelStyle(level, fallbackBackground)");
        expect(wbsExportStyleSource).toContain("this.getReadableTextColor(preferredTextColor, backgroundColor)");
        expect(wbsExportStyleSource).toContain("background-color: ${backgroundColor}; color: ${textColor};");

        const readableTextSource = slice(visualSource, "private getColorContrastRatio(", "private getDurationTextColor(");
        expect(readableTextSource).toContain("const minimumContrastRatio = 4.5;");
        expect(readableTextSource).toContain('this.getColorContrastRatio("#FFFFFF", backgroundColor)');
        expect(readableTextSource).toContain('return whiteContrast >= blackContrast ? "#FFFFFF" : "#000000";');

        const visibleWbsExportSource = slice(visualSource, "private generateWbsVisibleExportTableHtml(", "private generateWbsVisibleExportTableText(");
        expect(visibleWbsExportSource).toContain('const fallbackGroupTextColor = this.getWbsTextColor("#333333");');
        expect(visibleWbsExportSource).toContain("const textColor = this.getWbsExportRowTextColor(rowBgColor, fallbackGroupTextColor);");
        expect(visibleWbsExportSource).toContain("this.getWbsExportCellStyle(rowBgColor, textColor");
        expect(visibleWbsExportSource).toContain("const rowBgColor = this.getWbsExportRowBackgroundColor(group.level");
        expect(visibleWbsExportSource).not.toContain("levelStyle.text");
        expect(visibleWbsExportSource).not.toContain("border-left: 4px solid");
    });

    it("shows comparison date columns when bars are on or when the keep-visible toggle is enabled", () => {
        const visualSource = readFileSync("src/visual.ts", "utf8");

        expect(visualSource).toContain("this.boundFields.baselineAvailable && (this.showBaselineInternal || cols.showBaselineDateColumns?.value)");
        expect(visualSource).toContain("this.boundFields.previousUpdateAvailable && (this.showPreviousUpdateInternal || cols.showPreviousUpdateDateColumns?.value)");
        expect(visualSource).toContain("private shouldShowBaselineStartDateColumn(): boolean");
        expect(visualSource).toContain("private shouldShowPreviousUpdateStartDateColumn(): boolean");
        expect(visualSource).toContain("if (this.shouldShowBaselineStartDateColumn())");
        expect(visualSource).toContain("if (this.shouldShowPreviousUpdateStartDateColumn())");
        expect(visualSource).toContain("this.dataProcessor.detectBoundFields(dataView, this.allTasksData || [], this.settings)");
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

    it("uses the visible-column model for HTML and plain-text exports", () => {
        const visualSource = readFileSync("src/visual.ts", "utf8");
        const slice = (source: string, startMarker: string, endMarker: string) => {
            const start = source.indexOf(startMarker);
            const end = source.indexOf(endMarker, start);
            expect(start).toBeGreaterThan(-1);
            expect(end).toBeGreaterThan(start);
            return source.slice(start, end);
        };

        const visibleExportSource = slice(visualSource, "private getVisibleExportColumns(", "private getClipboardExportTimestamp()");
        const exportColumnSource = slice(visualSource, "private getVisibleExportColumns(", "private formatExportExtraColumnValue(");
        const taskColumnSource = slice(visualSource, "private getTaskVisibleExportColumnText(", "private getWbsSummaryDurationLabel(");
        const flatHtmlExportSource = slice(visualSource, "private generateFlatExportTableHtml(", "private generateFlatExportTableText(");
        const flatTextExportSource = slice(visualSource, "private generateFlatExportTableText(", "private generateWbsVisibleExportTableHtml(");
        const wbsHtmlExportSource = slice(visualSource, "private generateWbsVisibleExportTableHtml(", "private generateWbsVisibleExportTableText(");
        const visibleHtmlExportSource = slice(visualSource, "private generateVisibleExportTableHtml(): string", "private generateVisibleExportTableText(): string");
        const visibleTextExportSource = slice(visualSource, "private generateVisibleExportTableText(): string", "private getClipboardExportTimestamp()");
        const clipboardSource = slice(visualSource, "private async copyVisibleDataToClipboard()", "private showCopySuccess");

        expect(exportColumnSource).toContain("const visibleLabelColumns = this.getLabelColumnLayout(this.getEffectiveLeftMargin()).items;");
        expect(exportColumnSource).toContain("if (includeWbsLevelColumns)");
        expect(taskColumnSource).toContain("const date = this.getTaskBarLabelStart(task);");
        expect(taskColumnSource).toContain("const date = this.getTaskBarLabelFinish(task);");
        expect(flatHtmlExportSource).toContain("const columns = this.getVisibleExportColumns(tasks, true);");
        expect(flatTextExportSource).toContain("const columns = this.getVisibleExportColumns(tasks, true);");
        expect(wbsHtmlExportSource).toContain("const columns = this.getVisibleExportColumns(tasks, false);");
        expect(wbsHtmlExportSource).toContain("const rows = this.getVisibleWbsExportRows(tasks, visibleWbsGroups);");
        expect(visibleHtmlExportSource).toContain("return this.generateWbsVisibleExportTableHtml(exportDateFormatter, tasks, visibleWbsGroups);");
        expect(visibleTextExportSource).toContain("return this.generateWbsVisibleExportTableText(exportDateFormatter, tasks, visibleWbsGroups);");
        expect(clipboardSource).toContain("const tableHtml = this.generateVisibleExportTableHtml();");
        expect(clipboardSource).toContain("const plainText = this.generateVisibleExportTableText();");
        expect(visibleExportSource).not.toContain('"Task ID"');
        expect(visibleExportSource).not.toContain('"Task Type"');
        expect(visibleExportSource).not.toContain('"Is Critical"');
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
        expect(visualSource).toContain("return shouldApplyCriticalFormatToTaskBarSegment(segment);");
        expect(readFileSync("src/utils/TaskBarGeometry.ts", "utf8")).toContain("return segment.kind !== \"started\";");
        expect(canvasTaskSource).toContain("const applyCriticalFormat = this.shouldApplyCriticalFormatToSegment(segment);");
        expect(canvasTaskSource).toContain("const semanticFill = this.getSemanticTaskFillColor(task, taskColor, criticalColor, nearCriticalColor, applyCriticalFormat);");
        expect(canvasTaskSource).toContain("const markerStyle = this.getCriticalStatusMarkerStyle(task, criticalColor, nearCriticalColor, false, applyCriticalFormat)");
        expect(canvasTaskSource).toContain("const markerStyle = this.getCriticalStatusMarkerStyle(task, criticalColor, nearCriticalColor, true)");
    });

    it("uses shared bar-date-aware connector geometry for SVG and canvas render paths", () => {
        const visualSource = readFileSync("src/visual.ts", "utf8");
        const connectorGeometrySource = readFileSync("src/utils/ConnectorGeometry.ts", "utf8");
        const slice = (source: string, startMarker: string, endMarker: string) => {
            const start = source.indexOf(startMarker);
            const end = source.indexOf(endMarker, start);
            expect(start).toBeGreaterThan(-1);
            expect(end).toBeGreaterThan(start);
            return source.slice(start, end);
        };

        const renderBranchSource = slice(visualSource, "if (this.useCanvasRendering) {", "            // SVG Rendering");
        const canvasArrowIndex = renderBranchSource.indexOf("this.drawArrowsCanvas(");
        const canvasTaskIndex = renderBranchSource.indexOf("this.drawTasksCanvas(");
        expect(canvasArrowIndex).toBeGreaterThan(-1);
        expect(canvasTaskIndex).toBeGreaterThan(canvasArrowIndex);

        const canvasArrowSource = slice(visualSource, "private drawArrowsCanvas(", "private positionTooltip(");
        const svgArrowSource = slice(visualSource, "private drawArrows(", "private getLineDashArray(");

        expect(visualSource).toContain('import { getConnectorRenderGeometry } from "./utils/ConnectorGeometry";');
        expect(canvasArrowSource).toContain("const relationshipGeometries = this.getVisibleRelationshipGeometries(");
        expect(svgArrowSource).toContain("const relationshipGeometries = this.getVisibleRelationshipGeometries(");
        expect(canvasArrowSource).toContain("geometry.points.forEach((point, index) => {");
        expect(canvasArrowSource).toContain("const arrowBaseX = geometry.endX - geometry.arrowDirectionX * arrowSize;");
        expect(canvasArrowSource).toContain("ctx.lineCap = 'butt';");
        expect(canvasArrowSource).toContain("ctx.lineJoin = 'miter';");
        expect(svgArrowSource).toContain('.attr("d", d => d.geometry.pathData)');
        expect(svgArrowSource).toContain('.attr("stroke-linecap", "butt")');
        expect(svgArrowSource).toContain('.attr("stroke-linejoin", "miter")');
        expect(svgArrowSource).toContain("const getRelationshipOpacity = (rel: Relationship): number => {");
        expect(svgArrowSource).toContain('.attr("marker-end", null)');
        expect(svgArrowSource).toContain('".relationship-arrowhead"');
        expect(svgArrowSource).toContain('.attr("fill-opacity", d => getRelationshipOpacity(d.relationship))');
        expect(visualSource).toContain('.relationship-arrowhead, .connection-dot-start, .connection-dot-end');
        expect(visualSource).toContain('this.arrowLayer.selectAll<SVGPathElement, { relationship: Relationship }>(".relationship-arrowhead")');
        expect(visualSource).toContain('.style("fill-opacity", d => getOpacity(d.relationship));');
        expect(connectorGeometrySource).toContain("getCurrentTaskBarGeometry(");
        expect(connectorGeometrySource).toContain("input.treatZeroDurationAsMilestone");
        expect(connectorGeometrySource).toContain('if (mode === "hybridActualEarly")');
        expect(connectorGeometrySource).toContain('segments.find(segment => segment.kind === "scheduled")');
        expect(connectorGeometrySource).toContain("clearance: SOURCE_ENDPOINT_CLEARANCE");
        expect(connectorGeometrySource).toContain("const targetClearance = getConnectorTargetEndpointClearance(options.arrowHeadSize);");
    });
});
