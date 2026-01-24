
import * as d3 from "d3";
import { Selection } from "d3-selection";
import { VisualSettings } from "../settings";
import { UI_TOKENS, LAYOUT_BREAKPOINTS } from "../utils/Theme";

export interface HeaderCallbacks {
    onToggleCriticalPath: () => void;
    onToggleBaseline: () => void;
    onTogglePreviousUpdate: () => void;
    onToggleConnectorLines: () => void;
    onToggleWbsExpand: () => void;
    onToggleWbsCollapse: () => void;
    onToggleMode: () => void;
    onToggleColumns: () => void;
    onToggleWbsEnable: () => void;
    onFloatThresholdChanged: (value: number) => void;
    onHelp: () => void;
    onExport: () => void;
    onCopy: () => void;
    onZoomIn?: () => void;
    onZoomOut?: () => void;
}

export interface HeaderState {
    showAllTasks: boolean;
    showBaseline: boolean;
    baselineAvailable: boolean;
    showPreviousUpdate: boolean;
    previousUpdateAvailable: boolean;
    showConnectorLines: boolean;
    wbsExpanded: boolean;
    wbsDataExists: boolean;
    wbsAvailableLevels: number[];
    wbsExpandToLevel?: number;
    wbsManualExpansionOverride: boolean;
    currentMode: string;
    floatThreshold: number;
    showNearCritical: boolean;
    showExtraColumns: boolean;
    wbsEnabled: boolean;
}

export class Header {
    private container: Selection<HTMLDivElement, unknown, null, undefined>;
    private svg!: Selection<SVGSVGElement, unknown, null, undefined>;
    private callbacks: HeaderCallbacks;

    // Button Selections
    private toggleButtonGroup!: Selection<SVGGElement, unknown, null, undefined>;
    private baselineToggleButtonGroup!: Selection<HTMLButtonElement, unknown, null, undefined>;
    private previousUpdateToggleButtonGroup!: Selection<HTMLButtonElement, unknown, null, undefined>;

    // Temporary storage for render cycle
    private currentSettings!: VisualSettings;
    private currentState!: HeaderState;
    private currentViewportWidth!: number;

    constructor(container: Selection<HTMLDivElement, unknown, null, undefined>, callbacks: HeaderCallbacks) {
        this.container = container;
        this.callbacks = callbacks;
        this.initialize();
    }

    private initialize() {
        // SVG Container for buttons that use SVG
        this.svg = this.container.append("svg")
            .attr("width", "100%")
            .attr("height", "100%")
            .style("position", "absolute")
            .style("top", "0")
            .style("left", "0")
            .style("pointer-events", "none"); // Allow clicks to pass through to buttons underneath if any

        // Main group
        this.toggleButtonGroup = this.svg.append("g")
            .attr("class", "toggle-button-group");
    }

    public render(viewportWidth: number, settings: VisualSettings, state: HeaderState) {
        this.currentViewportWidth = viewportWidth;
        this.currentSettings = settings;
        this.currentState = state;

        this.renderButtons();
    }

    private renderButtons() {
        this.createOrUpdateToggleButton();
        this.createModeToggleButton();
        this.createColumnDisplayToggleButton();
        this.createOrUpdateBaselineToggleButton();
        this.createOrUpdatePreviousUpdateToggleButton();
        this.createConnectorLinesToggleButton();
        this.createWbsEnableToggleButton();
        this.createWbsExpandCycleToggleButton();
        this.createWbsCollapseCycleToggleButton();
        this.createCopyButton();
        this.createExportButton();
        this.createHelpButton();
        this.createFloatThresholdControl();
    }

    /**
     * Shows visual feedback on the copy button when copy succeeds.
     * Turns the button border green for 2 seconds.
     */
    public showCopySuccess(): void {
        const btn = this.container.select('.copy-data-button-group');
        if (!btn.empty()) {
            // Store original styles
            const originalBorder = btn.style('border');
            const originalBg = btn.style('background-color');

            // Apply success styles
            btn.style('border', `2px solid ${UI_TOKENS.color.success.default}`)
                .style('background-color', UI_TOKENS.color.success.light);

            // Revert after 2 seconds
            setTimeout(() => {
                btn.style('border', originalBorder)
                    .style('background-color', originalBg);
            }, 2000);
        }
    }


    private lightenColor(color: string, factor: number): string {
        const hex = color.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);

        const newR = Math.round(r + (255 - r) * factor);
        const newG = Math.round(g + (255 - g) * factor);
        const newB = Math.round(b + (255 - b) * factor);

        return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
    }

    public setExporting(isExporting: boolean): void {
        const btn = this.container.select('.export-button-group');
        if (btn.empty()) return;

        const iconPaths = btn.selectAll('.export-icon-path');
        const spinner = btn.select('.export-spinner');

        if (isExporting) {
            iconPaths.style('display', 'none');
            spinner.style('display', 'block');
            btn.classed('is-exporting', true)
                .style('cursor', 'wait')
                .style('background-color', UI_TOKENS.color.neutral.grey20);
        } else {
            iconPaths.style('display', 'block');
            spinner.style('display', 'none');
            btn.classed('is-exporting', false)
                .style('cursor', 'pointer')
                .style('background-color', UI_TOKENS.color.neutral.white);
        }
    }

    private createOrUpdateToggleButton(): void {
        this.container.selectAll(".toggle-button-group").remove();

        const layout = this.getHeaderButtonLayout(this.currentViewportWidth, this.currentSettings, this.currentState);
        const buttonWidth = layout.showAllCritical.width;
        const buttonHeight = UI_TOKENS.height.standard;
        const buttonX = layout.showAllCritical.x;
        const buttonY = UI_TOKENS.spacing.sm;

        const isShowingCritical = !this.currentState.showAllTasks;

        const btn = this.container.append("button")
            .attr("class", "toggle-button-group")
            .attr("type", "button")
            .attr("aria-label", isShowingCritical ? "Show critical path only" : "Show all tasks")
            .attr("aria-pressed", (!isShowingCritical).toString())
            .classed("header-toggle-button", true)
            .style("position", "absolute")
            .style("left", `${buttonX}px`)
            .style("top", `${buttonY}px`)
            .style("width", `${buttonWidth}px`)
            .style("height", `${buttonHeight}px`)
            .style("padding", "0")
            .style("display", "flex")
            .style("align-items", "center")
            .style("border", `1.5px solid ${UI_TOKENS.color.neutral.grey60}`)
            .style("background-color", UI_TOKENS.color.neutral.white)
            .style("border-radius", `${UI_TOKENS.radius.medium}px`)
            .on("click", (event) => {
                event.stopPropagation();
                this.callbacks.onToggleCriticalPath();
            });

        const iconPadding = UI_TOKENS.spacing.lg;
        const iconColor = isShowingCritical
            ? UI_TOKENS.color.danger.default
            : UI_TOKENS.color.success.default;

        // SVG Icon
        const svg = btn.append("svg")
            .attr("width", buttonWidth)
            .attr("height", buttonHeight)
            .style("position", "absolute")
            .style("top", "0")
            .style("left", "0")
            .style("pointer-events", "none");

        svg.append("circle")
            .attr("cx", iconPadding)
            .attr("cy", buttonHeight / 2)
            .attr("r", 10)
            .style("fill", isShowingCritical ? UI_TOKENS.color.danger.subtle : UI_TOKENS.color.success.subtle);

        svg.append("path")
            .attr("d", isShowingCritical
                ? "M2.5,-1.5 L5,-3.5 L7.5,-1.5 L7.5,0 L5,2 L2.5,0 Z"
                : "M1.5,-3 L8,-3 M1.5,0 L8.5,0 M1.5,3 L8,3")
            .attr("transform", `translate(${iconPadding}, ${buttonHeight / 2})`)
            .attr("stroke", iconColor)
            .attr("stroke-width", 2.25)
            .attr("fill", isShowingCritical ? iconColor : "none")
            .attr("stroke-linecap", "round")
            .attr("stroke-linejoin", "round");

        // Text
        const buttonText = isShowingCritical
            ? (buttonWidth >= 160 ? "Critical Path Only" : "Critical Only")
            : (buttonWidth >= 160 ? "All Tasks" : "All Tasks");

        const textX = iconPadding + 24;

        if (buttonWidth > 50) {
            svg.append("text")
                .attr("x", textX)
                .attr("y", buttonHeight / 2)
                .attr("dominant-baseline", "central")
                .style("font-family", "Segoe UI, sans-serif")
                .style("font-size", `${UI_TOKENS.fontSize.md}px`)
                .style("fill", UI_TOKENS.color.neutral.grey160)
                .style("font-weight", UI_TOKENS.fontWeight.semibold.toString())
                .style("letter-spacing", "0.2px")
                .text(buttonText);
        }

        // Hover effects
        btn.on("mouseover", function () {
            d3.select(this)
                .style("background-color", UI_TOKENS.color.neutral.grey10)
                .style("border-color", UI_TOKENS.color.neutral.grey90)
                .style("border-width", "2px")
                .style("box-shadow", UI_TOKENS.shadow[8]);
        })
            .on("mouseout", function () {
                d3.select(this)
                    .style("background-color", UI_TOKENS.color.neutral.white)
                    .style("border-color", UI_TOKENS.color.neutral.grey60)
                    .style("border-width", "1.5px")
                    .style("box-shadow", UI_TOKENS.shadow[2]);
            })
            .on("mousedown", function () {
                d3.select(this)
                    .style("transform", "scale(0.96)")
                    .style("box-shadow", UI_TOKENS.shadow[4]);
            })
            .on("mouseup", function () {
                d3.select(this)
                    .style("transform", "scale(1)")
                    .style("box-shadow", UI_TOKENS.shadow[8]);
            });
    }

    private createOrUpdateBaselineToggleButton(): void {
        this.container.selectAll(".baseline-toggle-group").remove();

        const layout = this.getHeaderButtonLayout(this.currentViewportWidth, this.currentSettings, this.currentState);
        const { x: buttonX, width: buttonWidth, iconOnly, visible } = layout.baseline;

        if (!visible) return;

        const isAvailable = this.currentState.baselineAvailable;
        const showBaseline = this.currentState.showBaseline;

        const baselineColor = this.currentSettings.comparisonBars.baselineColor.value.value;
        const lightBaselineColor = this.lightenColor(baselineColor, 0.93);
        const hoverBaselineColor = this.lightenColor(baselineColor, 0.85);
        const previousUpdateColor = this.currentSettings.comparisonBars.previousUpdateColor.value.value;

        const buttonHeight = UI_TOKENS.height.standard;
        const buttonY = UI_TOKENS.spacing.sm;

        const btn = this.container.append("button")
            .attr("class", "baseline-toggle-group")
            .attr("type", "button")
            .attr("aria-label", `${showBaseline ? 'Hide' : 'Show'} baseline task bars`)
            .attr("aria-pressed", showBaseline.toString())
            .attr("aria-disabled", (!isAvailable).toString())
            .property("disabled", !isAvailable)
            .classed("header-toggle-button", true)
            .classed("is-disabled", !isAvailable)
            .style("position", "absolute")
            .style("left", `${buttonX}px`)
            .style("top", `${buttonY}px`)
            .style("width", `${buttonWidth}px`)
            .style("height", `${buttonHeight}px`)
            .style("padding", "0")
            .style("display", "flex")
            .style("align-items", "center")
            .style("border", `1.5px solid ${baselineColor}`)
            .style("border-width", showBaseline ? "2px" : "1.5px")
            .style("background-color", showBaseline ? lightBaselineColor : UI_TOKENS.color.neutral.white)
            .style("border-radius", `${UI_TOKENS.radius.medium}px`)
            .on("click", (event) => {
                event.stopPropagation();
                if (isAvailable) {
                    this.callbacks.onToggleBaseline();
                }
            });

        // Icon SVG
        const svg = btn.append("svg")
            .attr("width", buttonWidth)
            .attr("height", buttonHeight)
            .style("position", "absolute")
            .style("top", "0")
            .style("left", "0")
            .style("pointer-events", "none");

        const iconX = iconOnly ? (buttonWidth / 2 - 8) : (UI_TOKENS.spacing.lg + 2);
        const iconY = buttonHeight / 2;

        const iconG = svg.append("g")
            .attr("transform", `translate(${iconX}, ${iconY})`);

        iconG.append("rect")
            .attr("x", 0)
            .attr("y", -8)
            .attr("width", 16)
            .attr("height", 4.5)
            .attr("rx", 2)
            .attr("ry", 2)
            .attr("fill", showBaseline ? UI_TOKENS.color.primary.default : UI_TOKENS.color.neutral.grey90);

        iconG.append("rect")
            .attr("x", 0)
            .attr("y", -1.5)
            .attr("width", 16)
            .attr("height", 3.5)
            .attr("rx", 1.5)
            .attr("ry", 1.5)
            .attr("fill", showBaseline ? previousUpdateColor : UI_TOKENS.color.neutral.grey60)
            .style("opacity", showBaseline ? "1" : "0.6");

        iconG.append("rect")
            .attr("x", 0)
            .attr("y", 4)
            .attr("width", 16)
            .attr("height", 3.5)
            .attr("rx", 1.5)
            .attr("ry", 1.5)
            .attr("fill", showBaseline ? baselineColor : UI_TOKENS.color.neutral.grey60)
            .style("opacity", showBaseline ? "1" : "0.6");

        if (!iconOnly) {
            svg.append("text")
                .attr("class", "toggle-text")
                .attr("x", iconX + 26)
                .attr("y", buttonHeight / 2)
                .attr("dominant-baseline", "central")
                .style("font-family", "Segoe UI, sans-serif")
                .style("font-size", `${UI_TOKENS.fontSize.md}px`)
                .style("fill", UI_TOKENS.color.neutral.grey160)
                .style("font-weight", showBaseline ? UI_TOKENS.fontWeight.semibold.toString() : UI_TOKENS.fontWeight.medium.toString())
                .text("Baseline");
        }

        btn.append("title")
            .text(isAvailable
                ? (showBaseline ? "Hide baseline task bars" : "Show baseline task bars")
                : "Requires Baseline Start Date and Baseline Finish Date fields to be mapped");

        if (isAvailable) {
            btn.on("mouseover", function () {
                d3.select(this)
                    .style("background-color", showBaseline ? hoverBaselineColor : UI_TOKENS.color.neutral.grey20)
                    .style("border-width", "2.5px")
                    .style("box-shadow", UI_TOKENS.shadow[8]);
            })
                .on("mouseout", function () {
                    d3.select(this)
                        .style("background-color", showBaseline ? lightBaselineColor : UI_TOKENS.color.neutral.white)
                        .style("border-width", showBaseline ? "2px" : "1.5px")
                        .style("box-shadow", UI_TOKENS.shadow[2]);
                })
                .on("mousedown", function () {
                    d3.select(this)
                        .style("transform", "scale(0.98)")
                        .style("box-shadow", UI_TOKENS.shadow[4]);
                })
                .on("mouseup", function () {
                    d3.select(this)
                        .style("transform", "scale(1)")
                        .style("box-shadow", UI_TOKENS.shadow[8]);
                });
        }
    }

    private createOrUpdatePreviousUpdateToggleButton(): void {
        this.container.selectAll(".previous-update-toggle-group").remove();

        const layout = this.getHeaderButtonLayout(this.currentViewportWidth, this.currentSettings, this.currentState);
        const { x: buttonX, width: buttonWidth, iconOnly, visible } = layout.previousUpdate;

        if (!visible) return;

        const isAvailable = this.currentState.previousUpdateAvailable;
        const showPreviousUpdate = this.currentState.showPreviousUpdate;

        const previousUpdateColor = this.currentSettings.comparisonBars.previousUpdateColor.value.value;
        const lightPreviousUpdateColor = this.lightenColor(previousUpdateColor, 0.90);
        const hoverPreviousUpdateColor = this.lightenColor(previousUpdateColor, 0.80);
        const baselineColor = this.currentSettings.comparisonBars.baselineColor.value.value;

        const buttonHeight = UI_TOKENS.height.standard;
        const buttonY = UI_TOKENS.spacing.sm;

        const btn = this.container.append("button")
            .attr("class", "previous-update-toggle-group")
            .attr("type", "button")
            .attr("aria-label", `${showPreviousUpdate ? 'Hide' : 'Show'} previous update task bars`)
            .attr("aria-pressed", showPreviousUpdate.toString())
            .attr("aria-disabled", (!isAvailable).toString())
            .property("disabled", !isAvailable)
            .classed("header-toggle-button", true)
            .classed("is-disabled", !isAvailable)
            .style("position", "absolute")
            .style("left", `${buttonX}px`)
            .style("top", `${buttonY}px`)
            .style("width", `${buttonWidth}px`)
            .style("height", `${buttonHeight}px`)
            .style("padding", "0")
            .style("display", "flex")
            .style("align-items", "center")
            .style("border", `1.5px solid ${previousUpdateColor}`)
            .style("border-width", showPreviousUpdate ? "2px" : "1.5px")
            .style("background-color", showPreviousUpdate ? lightPreviousUpdateColor : UI_TOKENS.color.neutral.white)
            .style("border-radius", `${UI_TOKENS.radius.medium}px`)
            .on("click", (event) => {
                event.stopPropagation();
                if (isAvailable) {
                    this.callbacks.onTogglePreviousUpdate();
                }
            });

        // Icon SVG
        const svg = btn.append("svg")
            .attr("width", buttonWidth)
            .attr("height", buttonHeight)
            .style("position", "absolute")
            .style("top", "0")
            .style("left", "0")
            .style("pointer-events", "none");

        const iconX = iconOnly ? (buttonWidth / 2 - 8) : (UI_TOKENS.spacing.lg + 2);
        const iconY = buttonHeight / 2;

        const iconG = svg.append("g")
            .attr("transform", `translate(${iconX}, ${iconY})`);

        iconG.append("rect")
            .attr("x", 0)
            .attr("y", -8)
            .attr("width", 16)
            .attr("height", 4.5)
            .attr("rx", 2)
            .attr("ry", 2)
            .attr("fill", showPreviousUpdate ? UI_TOKENS.color.primary.default : UI_TOKENS.color.neutral.grey90);

        iconG.append("rect")
            .attr("x", 0)
            .attr("y", -1.5)
            .attr("width", 16)
            .attr("height", 3.5)
            .attr("rx", 1.5)
            .attr("ry", 1.5)
            .attr("fill", showPreviousUpdate ? previousUpdateColor : UI_TOKENS.color.neutral.grey60)
            .style("opacity", showPreviousUpdate ? "1" : "0.6");

        iconG.append("rect")
            .attr("x", 0)
            .attr("y", 4)
            .attr("width", 16)
            .attr("height", 3.5)
            .attr("rx", 1.5)
            .attr("ry", 1.5)
            .attr("fill", showPreviousUpdate ? baselineColor : UI_TOKENS.color.neutral.grey60)
            .style("opacity", showPreviousUpdate ? "1" : "0.6");

        if (!iconOnly) {
            svg.append("text")
                .attr("class", "toggle-text")
                .attr("x", iconX + 26)
                .attr("y", buttonHeight / 2)
                .attr("dominant-baseline", "central")
                .style("font-family", "Segoe UI, sans-serif")
                .style("font-size", `${UI_TOKENS.fontSize.md}px`)
                .style("fill", UI_TOKENS.color.neutral.grey160)
                .style("font-weight", showPreviousUpdate ? UI_TOKENS.fontWeight.semibold.toString() : UI_TOKENS.fontWeight.medium.toString())
                .text("Prev. Update");
        }

        btn.append("title")
            .text(isAvailable
                ? (showPreviousUpdate ? "Hide previous update task bars" : "Show previous update task bars")
                : "Requires Previous Update Start and Finish Date fields to be mapped");

        if (isAvailable) {
            btn.on("mouseover", function () {
                d3.select(this)
                    .style("background-color", showPreviousUpdate ? hoverPreviousUpdateColor : UI_TOKENS.color.neutral.grey20)
                    .style("border-width", "2.5px")
                    .style("box-shadow", UI_TOKENS.shadow[8]);
            })
                .on("mouseout", function () {
                    d3.select(this)
                        .style("background-color", showPreviousUpdate ? lightPreviousUpdateColor : UI_TOKENS.color.neutral.white)
                        .style("border-width", showPreviousUpdate ? "2px" : "1.5px")
                        .style("box-shadow", UI_TOKENS.shadow[2]);
                })
                .on("mousedown", function () {
                    d3.select(this)
                        .style("transform", "scale(0.98)")
                        .style("box-shadow", UI_TOKENS.shadow[4]);
                })
                .on("mouseup", function () {
                    d3.select(this)
                        .style("transform", "scale(1)")
                        .style("box-shadow", UI_TOKENS.shadow[8]);
                });
        }
    }

    /**
     * Extended layout mode determination 
     */
    private getExtendedLayoutMode(viewportWidth: number): 'wide' | 'medium' | 'narrow' | 'compact' | 'very-narrow' {
        if (viewportWidth >= LAYOUT_BREAKPOINTS.wide) return 'wide';
        if (viewportWidth >= LAYOUT_BREAKPOINTS.medium) return 'medium';
        if (viewportWidth >= 500) return 'narrow';
        if (viewportWidth >= 350) return 'compact';
        return 'very-narrow';
    }

    /**
     * Returns button dimensions and positions based on current layout mode
     */
    private getHeaderButtonLayout(viewportWidth: number, settings: VisualSettings, state: HeaderState) {
        // Extended layout modes for better responsiveness
        const mode = this.getExtendedLayoutMode(viewportWidth);

        // Reserve space for right-side controls
        const rightReserved = mode === 'very-narrow' ? 60 : (mode === 'compact' ? 100 : (mode === 'narrow' ? 150 : 260));
        const availableWidth = viewportWidth - rightReserved;

        // Gap between buttons based on mode
        const gap = mode === 'wide' ? 12 : (mode === 'medium' ? 8 : (mode === 'narrow' ? 6 : 4));
        // Using UI_TOKENS for sizes would be ideal but logic uses hardcoded numbers in visual.ts mostly
        // We can map them:
        const iconButtonSize = mode === 'very-narrow' ? 28 : (mode === 'compact' ? 30 : 36);
        const smallIconSize = mode === 'very-narrow' ? 24 : 28;

        // Calculate dimensions for each button type based on mode
        const showAllWidth = mode === 'wide' ? 140 : (mode === 'medium' ? 120 : (mode === 'narrow' ? 100 : (mode === 'compact' ? 80 : 70)));
        const modeWidth = mode === 'wide' ? 150 : (mode === 'medium' ? 130 : (mode === 'narrow' ? 110 : (mode === 'compact' ? 90 : 80)));
        const baselineWidth = (mode === 'wide' || mode === 'medium') ? (mode === 'wide' ? 125 : 105) : iconButtonSize;
        const prevWidth = (mode === 'wide' || mode === 'medium') ? (mode === 'wide' ? 125 : 105) : iconButtonSize;
        const wbsEnableWidth = mode === 'wide' ? 70 : (mode === 'medium' ? 65 : 60);

        // Calculate total width needed for all buttons
        const allButtonWidths = [
            showAllWidth,
            modeWidth,
            baselineWidth,
            prevWidth,
            iconButtonSize, // connector lines
            iconButtonSize, // column toggle
            wbsEnableWidth,
            iconButtonSize, // wbs expand
            iconButtonSize, // wbs collapse
            smallIconSize,  // copy
            smallIconSize,  // export
            smallIconSize   // help
        ];

        const numButtons = allButtonWidths.length;
        // const totalNeeded = allButtonWidths.reduce((a, b) => a + b, 0) + (numButtons - 1) * gap;

        let visibleButtons = {
            showAll: true,
            modeToggle: true,
            baseline: true,
            previousUpdate: true,
            connectorLines: settings.connectorLines?.showConnectorToggle?.value ?? false,
            colToggle: settings.columns?.showColumnToggleButton?.value ?? true,
            wbsEnable: state.wbsDataExists && (settings.wbsGrouping?.showWbsToggle?.value ?? true),
            wbsExpand: state.wbsDataExists && (settings.wbsGrouping?.enableWbsGrouping?.value ?? true),
            wbsCollapse: state.wbsDataExists && (settings.wbsGrouping?.enableWbsGrouping?.value ?? true),
            copyButton: true,
            exportButton: settings.generalSettings?.showExportButton?.value ?? true,
            helpButton: true
        };

        // Progressive hiding based on available width
        const calculateVisibleWidth = () => {
            let width = 0;
            let count = 0;
            if (visibleButtons.showAll) { width += showAllWidth; count++; }
            if (visibleButtons.modeToggle) { width += modeWidth; count++; }
            if (visibleButtons.baseline) { width += baselineWidth; count++; }
            if (visibleButtons.previousUpdate) { width += prevWidth; count++; }
            if (visibleButtons.connectorLines) { width += iconButtonSize; count++; }
            if (visibleButtons.colToggle) { width += iconButtonSize; count++; }
            if (visibleButtons.wbsEnable) { width += wbsEnableWidth; count++; }
            if (visibleButtons.wbsExpand) { width += iconButtonSize; count++; }
            if (visibleButtons.wbsCollapse) { width += iconButtonSize; count++; }
            if (visibleButtons.copyButton) { width += smallIconSize; count++; }
            if (visibleButtons.exportButton) { width += smallIconSize; count++; }
            if (visibleButtons.helpButton) { width += smallIconSize; count++; }
            return width + Math.max(0, count - 1) * gap;
        };

        // Progressively hide buttons if needed (in order of decreasing priority)
        let visibleWidth = calculateVisibleWidth();

        // Hide WBS collapse button first
        if (visibleWidth > availableWidth && visibleButtons.wbsCollapse) {
            visibleButtons.wbsCollapse = false;
            visibleWidth = calculateVisibleWidth();
        }

        // Hide WBS expand button
        if (visibleWidth > availableWidth && visibleButtons.wbsExpand) {
            visibleButtons.wbsExpand = false;
            visibleWidth = calculateVisibleWidth();
        }

        // Hide WBS enable button
        if (visibleWidth > availableWidth && visibleButtons.wbsEnable) {
            visibleButtons.wbsEnable = false;
            visibleWidth = calculateVisibleWidth();
        }

        // Hide column toggle
        if (visibleWidth > availableWidth && visibleButtons.colToggle) {
            visibleButtons.colToggle = false;
            visibleWidth = calculateVisibleWidth();
        }

        // Hide connector lines toggle
        if (visibleWidth > availableWidth && visibleButtons.connectorLines) {
            visibleButtons.connectorLines = false;
            visibleWidth = calculateVisibleWidth();
        }

        // Hide export button
        if (visibleWidth > availableWidth && visibleButtons.exportButton) {
            visibleButtons.exportButton = false;
            visibleWidth = calculateVisibleWidth();
        }

        // Hide copy button
        if (visibleWidth > availableWidth && visibleButtons.copyButton) {
            visibleButtons.copyButton = false;
            visibleWidth = calculateVisibleWidth();
        }

        // Hide previous update
        if (visibleWidth > availableWidth && visibleButtons.previousUpdate) {
            visibleButtons.previousUpdate = false;
            visibleWidth = calculateVisibleWidth();
        }

        // Hide baseline
        if (visibleWidth > availableWidth && visibleButtons.baseline) {
            visibleButtons.baseline = false;
            visibleWidth = calculateVisibleWidth();
        }

        // Now calculate positions for visible buttons
        let x = 10;

        const showAllCritical = {
            x,
            width: showAllWidth,
            showText: mode !== 'very-narrow',
            visible: visibleButtons.showAll
        };
        if (visibleButtons.showAll) x += showAllWidth + gap;

        const modeToggle = {
            x,
            width: modeWidth,
            showFullLabels: mode === 'wide',
            visible: visibleButtons.modeToggle
        };
        if (visibleButtons.modeToggle) x += modeWidth + gap;

        const baseline = {
            x,
            width: baselineWidth,
            iconOnly: mode !== 'wide' && mode !== 'medium',
            visible: visibleButtons.baseline
        };
        if (visibleButtons.baseline) x += baselineWidth + gap;

        const previousUpdate = {
            x,
            width: prevWidth,
            iconOnly: mode !== 'wide' && mode !== 'medium',
            visible: visibleButtons.previousUpdate
        };
        if (visibleButtons.previousUpdate) x += prevWidth + gap;

        const connectorLines = {
            x,
            size: iconButtonSize,
            visible: visibleButtons.connectorLines
        };
        if (visibleButtons.connectorLines) x += iconButtonSize + gap;

        const colToggle = {
            x,
            size: iconButtonSize,
            visible: visibleButtons.colToggle
        };
        if (visibleButtons.colToggle) x += iconButtonSize + gap;

        const wbsEnable = {
            x,
            width: wbsEnableWidth,
            visible: visibleButtons.wbsEnable
        };
        if (visibleButtons.wbsEnable) x += wbsEnableWidth + gap;

        const wbsExpandToggle = {
            x,
            size: iconButtonSize,
            visible: visibleButtons.wbsExpand
        };
        if (visibleButtons.wbsExpand) x += iconButtonSize + gap;

        const wbsCollapseToggle = {
            x,
            size: iconButtonSize,
            visible: visibleButtons.wbsCollapse
        };
        if (visibleButtons.wbsCollapse) x += iconButtonSize + gap;

        const copyButton = {
            x,
            size: smallIconSize,
            visible: visibleButtons.copyButton
        };
        if (visibleButtons.copyButton) x += smallIconSize + gap;

        const exportButton = {
            x,
            size: smallIconSize,
            visible: visibleButtons.exportButton
        };
        if (visibleButtons.exportButton) x += smallIconSize + gap;

        const helpButton = {
            x,
            size: smallIconSize,
            visible: visibleButtons.helpButton
        };
        if (visibleButtons.helpButton) x += smallIconSize;

        return {
            mode,
            showAllCritical,
            modeToggle,
            colToggle,
            baseline,
            previousUpdate,
            connectorLines,
            wbsEnable,
            wbsExpandToggle,
            wbsCollapseToggle,
            copyButton,
            exportButton,
            helpButton,
            gap,
            totalWidth: x
        };
    }

    private createConnectorLinesToggleButton(): void {
        this.container.selectAll(".connector-toggle-group").remove();

        const showConnectorToggle = this.currentSettings?.connectorLines?.showConnectorToggle?.value ?? false;
        if (!showConnectorToggle) return;

        const layout = this.getHeaderButtonLayout(this.currentViewportWidth, this.currentSettings, this.currentState);
        const { x: buttonX, size: buttonSize, visible } = layout.connectorLines;

        if (!visible) return;

        const buttonY = UI_TOKENS.spacing.sm;
        const showConnectorLines = this.currentState.showConnectorLines;

        const btn = this.container.append("button")
            .attr("class", "connector-toggle-group")
            .attr("type", "button")
            .attr("aria-label", `${showConnectorLines ? 'Hide' : 'Show'} connector lines between tasks`)
            .attr("aria-pressed", showConnectorLines.toString())
            .classed("header-toggle-button", true)
            .style("position", "absolute")
            .style("left", `${buttonX}px`)
            .style("top", `${buttonY}px`)
            .style("width", `${buttonSize}px`) // Square button
            .style("height", `${buttonSize}px`)
            .style("padding", "0")
            .style("display", "flex")
            .style("align-items", "center")
            .style("justify-content", "center")
            .style("border", `1.5px solid ${showConnectorLines ? UI_TOKENS.color.success.default : UI_TOKENS.color.neutral.grey60}`)
            .style("border-width", showConnectorLines ? "2px" : "1.5px")
            .style("background-color", showConnectorLines ? UI_TOKENS.color.success.light : UI_TOKENS.color.neutral.white)
            .style("border-radius", `${UI_TOKENS.radius.medium}px`)
            .on("click", (event) => {
                event.stopPropagation();
                this.callbacks.onToggleConnectorLines();
            });

        const svg = btn.append("svg")
            .attr("width", buttonSize)
            .attr("height", buttonSize)
            .style("pointer-events", "none");

        const iconCenter = (buttonSize / 2) - 2;
        const iconG = svg.append("g")
            .attr("transform", `translate(${iconCenter}, ${iconCenter})`);

        iconG.append("path")
            .attr("d", "M-6,-3 L0,3 L6,-3")
            .attr("stroke", showConnectorLines ? UI_TOKENS.color.success.default : UI_TOKENS.color.neutral.grey130)
            .attr("stroke-width", 2)
            .attr("fill", "none")
            .attr("stroke-linecap", "round")
            .attr("stroke-linejoin", "round")
            .attr("stroke-dasharray", showConnectorLines ? "none" : "3,2")
            .style("transition", `all ${UI_TOKENS.motion.duration.normal}ms ${UI_TOKENS.motion.easing.smooth}`);

        if (showConnectorLines) {
            iconG.append("circle")
                .attr("cx", -6).attr("cy", -3).attr("r", 1.5)
                .attr("fill", UI_TOKENS.color.success.default);

            iconG.append("circle")
                .attr("cx", 6).attr("cy", -3).attr("r", 1.5)
                .attr("fill", UI_TOKENS.color.success.default);
        }

        btn.append("title")
            .text(showConnectorLines
                ? "Click to hide connector lines between dependent tasks"
                : "Click to show connector lines between dependent tasks");

        const self = this;
        btn.on("mouseover", function () {
            d3.select(this)
                .style("background-color", showConnectorLines ? UI_TOKENS.color.success.default : UI_TOKENS.color.neutral.grey20)
                .style("box-shadow", UI_TOKENS.shadow[8]);

            if (showConnectorLines) {
                d3.select(this).select("path").attr("stroke", UI_TOKENS.color.neutral.white);
                d3.select(this).selectAll("circle").attr("fill", UI_TOKENS.color.neutral.white);
            }
        })
            .on("mouseout", function () {
                d3.select(this)
                    .style("background-color", showConnectorLines ? UI_TOKENS.color.success.light : UI_TOKENS.color.neutral.white)
                    .style("box-shadow", UI_TOKENS.shadow[2]);

                if (showConnectorLines) {
                    d3.select(this).select("path").attr("stroke", UI_TOKENS.color.success.default);
                    d3.select(this).selectAll("circle").attr("fill", UI_TOKENS.color.success.default);
                }
            })
            .on("mousedown", function () {
                d3.select(this).style("transform", "scale(0.95)");
            })
            .on("mouseup", function () {
                d3.select(this).style("transform", "scale(1)");
            });
    }

    private createWbsExpandCycleToggleButton(): void {
        this.container.selectAll(".wbs-expand-toggle-group").remove();

        const wbsEnabled = this.currentState.wbsDataExists && this.currentSettings?.wbsGrouping?.enableWbsGrouping?.value;
        const showWbsToggle = this.currentSettings?.wbsGrouping?.showWbsToggle?.value ?? true;
        if (!wbsEnabled || !showWbsToggle) return;

        const layout = this.getHeaderButtonLayout(this.currentViewportWidth, this.currentSettings, this.currentState);
        const { x: buttonX, size: buttonSize, visible } = layout.wbsExpandToggle;

        if (!visible) return;

        const isCustom = this.currentState.wbsManualExpansionOverride;
        const currentLevel = this.currentState.wbsExpandToLevel ?? 0;
        const wbsExpanded = this.currentState.wbsExpanded;

        const buttonY = UI_TOKENS.spacing.sm;

        const btn = this.container.append("button")
            .attr("class", "wbs-expand-toggle-group")
            .attr("type", "button")
            .attr("aria-label", isCustom
                ? "Custom (manual overrides). Click to expand and clear overrides"
                : `Level ${currentLevel} (click to expand)`)
            .attr("aria-pressed", wbsExpanded.toString())
            .classed("header-toggle-button", true)
            .style("position", "absolute")
            .style("left", `${buttonX}px`)
            .style("top", `${buttonY}px`)
            .style("width", `${buttonSize}px`)
            .style("height", `${buttonSize}px`)
            .style("padding", "0")
            .style("display", "flex")
            .style("align-items", "center")
            .style("justify-content", "center")
            .style("border", `1.5px solid ${wbsExpanded ? UI_TOKENS.color.primary.default : UI_TOKENS.color.neutral.grey60}`)
            .style("border-width", wbsExpanded ? "2px" : "1.5px")
            .style("background-color", wbsExpanded ? UI_TOKENS.color.primary.light : UI_TOKENS.color.neutral.white)
            .style("border-radius", `${UI_TOKENS.radius.medium}px`)
            .on("click", (event) => {
                event.stopPropagation();
                this.callbacks.onToggleWbsExpand();
            });

        const svg = btn.append("svg")
            .attr("width", buttonSize)
            .attr("height", buttonSize)
            .style("pointer-events", "none");

        const iconCenterX = buttonSize / 2;
        const iconCenterY = (buttonSize / 2) - 4;
        const iconG = svg.append("g")
            .attr("transform", `translate(${iconCenterX}, ${iconCenterY})`);

        const iconColor = wbsExpanded
            ? UI_TOKENS.color.primary.default
            : UI_TOKENS.color.neutral.grey130;

        iconG.append("path")
            .attr("d", "M-4,0 L4,0 M0,-4 L0,4")
            .attr("stroke", iconColor)
            .attr("stroke-width", 2.2)
            .attr("fill", "none")
            .attr("stroke-linecap", "round");

        iconG.append("path")
            .attr("d", "M-4,5 L0,8 L4,5")
            .attr("stroke", iconColor)
            .attr("stroke-width", 1.8)
            .attr("fill", "none")
            .attr("stroke-linecap", "round")
            .attr("stroke-linejoin", "round");

        const badgeText = isCustom ? "C" : `L${currentLevel}`;

        svg.append("text")
            .attr("class", "toggle-text")
            .attr("x", buttonSize / 2)
            .attr("y", buttonSize - 10)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", `${UI_TOKENS.fontSize.sm}px`)
            .style("font-weight", UI_TOKENS.fontWeight.semibold)
            .style("fill", iconColor)
            .text(badgeText);

        const self = this;
        btn.on("mouseover", function () {
            d3.select(this)
                .style("background-color", wbsExpanded ? UI_TOKENS.color.primary.default : UI_TOKENS.color.neutral.grey20)
                .style("box-shadow", UI_TOKENS.shadow[8]);

            if (wbsExpanded) {
                d3.select(this).selectAll("path").attr("stroke", UI_TOKENS.color.neutral.white);
                d3.select(this).selectAll(".toggle-text").style("fill", UI_TOKENS.color.neutral.white);
            }
        }).on("mouseout", function () {
            d3.select(this)
                .style("background-color", wbsExpanded ? UI_TOKENS.color.primary.light : UI_TOKENS.color.neutral.white)
                .style("box-shadow", UI_TOKENS.shadow[2]);

            if (wbsExpanded) {
                d3.select(this).selectAll("path").attr("stroke", UI_TOKENS.color.primary.default);
                d3.select(this).selectAll(".toggle-text").style("fill", iconColor);
            }
        });
    }

    private createWbsCollapseCycleToggleButton(): void {
        this.container.selectAll(".wbs-collapse-toggle-group").remove();

        const wbsEnabled = this.currentState.wbsDataExists && this.currentSettings?.wbsGrouping?.enableWbsGrouping?.value;
        const showWbsToggle = this.currentSettings?.wbsGrouping?.showWbsToggle?.value ?? true;
        if (!wbsEnabled || !showWbsToggle) return;

        const layout = this.getHeaderButtonLayout(this.currentViewportWidth, this.currentSettings, this.currentState);
        const { x: buttonX, size: buttonSize, visible } = layout.wbsCollapseToggle;

        if (!visible) return;

        const isCustom = this.currentState.wbsManualExpansionOverride;
        const currentLevel = this.currentState.wbsExpandToLevel ?? 0;
        const isCollapsed = currentLevel === 0 || !this.currentState.wbsExpanded; // Logic approx

        const buttonY = UI_TOKENS.spacing.sm;

        const btn = this.container.append("button")
            .attr("class", "wbs-collapse-toggle-group")
            .attr("type", "button")
            .attr("aria-label", isCustom
                ? "Custom (manual overrides). Click to collapse and clear overrides"
                : `Level ${currentLevel} (click to collapse)`)
            .attr("aria-pressed", isCollapsed.toString())
            .classed("header-toggle-button", true)
            .style("position", "absolute")
            .style("left", `${buttonX}px`)
            .style("top", `${buttonY}px`)
            .style("width", `${buttonSize}px`)
            .style("height", `${buttonSize}px`)
            .style("padding", "0")
            .style("display", "flex")
            .style("align-items", "center")
            .style("justify-content", "center")
            .style("border", `1.5px solid ${isCollapsed ? UI_TOKENS.color.primary.default : UI_TOKENS.color.neutral.grey60}`)
            .style("border-width", isCollapsed ? "2px" : "1.5px")
            .style("background-color", isCollapsed ? UI_TOKENS.color.primary.light : UI_TOKENS.color.neutral.white)
            .style("border-radius", `${UI_TOKENS.radius.medium}px`)
            .on("click", (event) => {
                event.stopPropagation();
                this.callbacks.onToggleWbsCollapse();
            });

        const svg = btn.append("svg")
            .attr("width", buttonSize)
            .attr("height", buttonSize)
            .style("pointer-events", "none");

        const iconCenterX = buttonSize / 2;
        const iconCenterY = (buttonSize / 2) - 4;
        const iconG = svg.append("g")
            .attr("transform", `translate(${iconCenterX}, ${iconCenterY})`);

        const iconColor = isCollapsed
            ? UI_TOKENS.color.primary.default
            : UI_TOKENS.color.neutral.grey130;

        iconG.append("path")
            .attr("d", "M-5,0 L5,0")
            .attr("stroke", iconColor)
            .attr("stroke-width", 2.2)
            .attr("fill", "none")
            .attr("stroke-linecap", "round");

        iconG.append("path")
            .attr("d", "M-4,-3 L0,-7 L4,-3")
            .attr("stroke", iconColor)
            .attr("stroke-width", 1.8)
            .attr("fill", "none")
            .attr("stroke-linecap", "round")
            .attr("stroke-linejoin", "round");

        const badgeText = isCustom ? "C" : `L${currentLevel}`;

        svg.append("text")
            .attr("class", "toggle-text")
            .attr("x", buttonSize / 2)
            .attr("y", buttonSize - 10)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", `${UI_TOKENS.fontSize.sm}px`)
            .style("font-weight", UI_TOKENS.fontWeight.semibold)
            .style("fill", iconColor)
            .text(badgeText);

        const self = this;
        btn.on("mouseover", function () {
            d3.select(this)
                .style("background-color", isCollapsed ? UI_TOKENS.color.primary.default : UI_TOKENS.color.neutral.grey20)
                .style("box-shadow", UI_TOKENS.shadow[8]);

            if (isCollapsed) {
                d3.select(this).selectAll("path").attr("stroke", UI_TOKENS.color.neutral.white);
                d3.select(this).selectAll(".toggle-text").style("fill", UI_TOKENS.color.neutral.white);
            }
        }).on("mouseout", function () {
            d3.select(this)
                .style("background-color", isCollapsed ? UI_TOKENS.color.primary.light : UI_TOKENS.color.neutral.white)
                .style("box-shadow", UI_TOKENS.shadow[2]);

            if (isCollapsed) {
                d3.select(this).selectAll("path").attr("stroke", UI_TOKENS.color.primary.default);
                d3.select(this).selectAll(".toggle-text").style("fill", iconColor);
            }
        });
    }

    private createFloatThresholdControl(): void {
        this.container.selectAll(".float-threshold-wrapper").remove();

        const currentMode = this.currentSettings?.criticalPath?.calculationMode?.value?.value || 'longestPath';
        const isFloatBased = currentMode === 'floatBased';

        if (!this.currentState.showNearCritical || !isFloatBased) {
            return;
        }

        const effectiveWidth = this.currentViewportWidth;
        const layoutMode = this.getExtendedLayoutMode(effectiveWidth);
        const isCompact = layoutMode === 'narrow' || layoutMode === 'compact' || layoutMode === 'very-narrow';
        const isMedium = layoutMode === 'medium';
        const maxWidth = isCompact ? 210 : (isMedium ? 240 : 280);

        const controlContainer = this.container.append("div")
            .attr("class", "float-threshold-wrapper")
            .attr("role", "group")
            .attr("aria-label", "Near-critical threshold setting")
            .style("position", "absolute")
            .style("right", "10px")
            .style("top", "6px")
            .style("display", "flex")
            .style("align-items", "center")
            .style("gap", isCompact ? `${UI_TOKENS.spacing.xs}px` : `${UI_TOKENS.spacing.sm}px`)
            .style("height", `${UI_TOKENS.height.standard}px`)
            .style("padding", `0 ${UI_TOKENS.spacing.sm}px`)
            .style("max-width", `${maxWidth}px`)
            .style("background-color", UI_TOKENS.color.neutral.white)
            .style("border", `1.5px solid ${UI_TOKENS.color.warning.default}`)
            .style("border-radius", `${UI_TOKENS.radius.pill}px`)
            .style("box-shadow", UI_TOKENS.shadow[2])
            .style("transition", `all ${UI_TOKENS.motion.duration.normal}ms ${UI_TOKENS.motion.easing.smooth}`);

        const labelContainer = controlContainer.append("div")
            .style("display", "flex")
            .style("align-items", "center")
            .style("gap", `${UI_TOKENS.spacing.xs}px`);

        const iconSize = 12;
        const iconSvg = labelContainer.append("svg")
            .attr("width", iconSize)
            .attr("height", iconSize)
            .attr("viewBox", `0 0 ${iconSize} ${iconSize}`)
            .style("flex-shrink", "0");

        iconSvg.append("circle")
            .attr("cx", iconSize / 2)
            .attr("cy", iconSize / 2)
            .attr("r", iconSize / 2)
            .attr("fill", UI_TOKENS.color.warning.default);

        const labelText = isCompact ? "Near-Critical ≤" : (isMedium ? "Near-Critical ≤" : "Near-Critical ≤");
        labelContainer.append("span")
            .style("font-size", `${UI_TOKENS.fontSize.sm}px`)
            .style("letter-spacing", "0.1px")
            .style("color", UI_TOKENS.color.neutral.grey160)
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-weight", UI_TOKENS.fontWeight.medium)
            .style("white-space", "nowrap")
            .text(labelText);

        const inputWidth = isCompact ? 42 : (isMedium ? 50 : 54);

        controlContainer.append("input")
            .attr("type", "number")
            .attr("min", "0")
            .attr("step", "1")
            .attr("value", this.currentState.floatThreshold)
            .attr("aria-label", "Near-critical threshold in days")
            .style("width", `${inputWidth}px`)
            .style("height", "24px")
            .style("padding", `${UI_TOKENS.spacing.xs}px ${UI_TOKENS.spacing.sm}px`)
            .style("border", `1.5px solid ${UI_TOKENS.color.neutral.grey60}`)
            .style("border-radius", `${UI_TOKENS.radius.small}px`)
            .style("font-size", `${UI_TOKENS.fontSize.md}px`)
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-weight", UI_TOKENS.fontWeight.semibold)
            .style("text-align", "center")
            .style("outline", "none")
            .on("change", (event) => {
                const val = parseInt((event.target as HTMLInputElement).value, 10);
                if (!isNaN(val) && val >= 0) {
                    this.callbacks.onFloatThresholdChanged(val);
                }
            });

        // Add 'days' text
        controlContainer.append("span")
            .style("font-size", `${UI_TOKENS.fontSize.sm}px`)
            .style("color", UI_TOKENS.color.neutral.grey130)
            .style("font-family", "Segoe UI, sans-serif")
            .text("days");

        // Add help icon with tooltip
        const helpContainer = controlContainer.append("div")
            .style("display", "flex")
            .style("align-items", "center")
            .style("cursor", "help")
            .attr("title", "Tasks with Total Float less than or equal to this value will be highlighted as Near-Critical.");

        const helpIconSize = 14;
        const helpSvg = helpContainer.append("svg")
            .attr("width", helpIconSize)
            .attr("height", helpIconSize)
            .attr("viewBox", "0 0 16 16")
            .style("fill", UI_TOKENS.color.neutral.grey130);

        helpSvg.append("path")
            .attr("d", "M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm.93 11v1H6.93v-1h2zm-2.97-2.65c0-1.4.67-1.85 1.54-2.28.6-.3.83-.53.83-.97 0-.48-.44-.87-1.42-.87-.82 0-1.28.32-1.57.57l-.87-1.05c.5-.5 1.34-1.02 2.76-1.02 1.93 0 2.9 1.15 2.9 2.22 0 1.25-.66 1.7-1.48 2.12-.66.33-.87.6-.87 1.15v.13h-1.81z");

    }

    private createModeToggleButton(): void {
        this.container.selectAll(".mode-toggle-group").remove();

        const currentMode = this.currentState.currentMode;
        const isFloatBased = currentMode === 'floatBased';

        const layout = this.getHeaderButtonLayout(this.currentViewportWidth, this.currentSettings, this.currentState);
        const { x: buttonX, width: buttonWidth, visible } = layout.modeToggle;

        if (!visible) return;

        const buttonHeight = UI_TOKENS.height.standard;
        const buttonY = UI_TOKENS.spacing.sm;

        const bgColor = isFloatBased ? UI_TOKENS.color.warning.subtle : UI_TOKENS.color.primary.subtle;
        const borderColor = isFloatBased ? UI_TOKENS.color.warning.default : UI_TOKENS.color.primary.default;

        const btn = this.container.append("button")
            .attr("class", "mode-toggle-group")
            .attr("type", "button")
            .attr("aria-label", `Switch calculation mode. Currently: ${isFloatBased ? 'Float-Based' : 'Longest Path'}`)
            .attr("aria-pressed", isFloatBased.toString())
            .classed("header-toggle-button", true)
            .style("position", "absolute")
            .style("left", `${buttonX}px`)
            .style("top", `${buttonY}px`)
            .style("width", `${buttonWidth}px`)
            .style("height", `${buttonHeight}px`)
            .style("padding", "0")
            .style("display", "flex")
            .style("align-items", "center")
            .style("border", `1.5px solid ${borderColor}`)
            .style("background-color", bgColor)
            .style("border-radius", `${UI_TOKENS.radius.pill}px`)
            .on("click", (event) => {
                event.stopPropagation();
                this.callbacks.onToggleMode();
            });

        // SVG content
        const svg = btn.append("svg")
            .attr("width", buttonWidth)
            .attr("height", buttonHeight)
            .style("pointer-events", "none");

        const pillWidth = Math.min(106, buttonWidth - 20);
        const pillHeight = 22;
        const pillG = svg.append("g")
            .attr("transform", `translate(${(buttonWidth - pillWidth) / 2}, ${buttonHeight / 2})`);

        const pillX = isFloatBased ? pillWidth / 2 : 0;

        pillG.append("rect")
            .attr("x", 0)
            .attr("y", -pillHeight / 2)
            .attr("width", pillWidth)
            .attr("height", pillHeight)
            .attr("rx", UI_TOKENS.radius.large)
            .attr("ry", UI_TOKENS.radius.large)
            .style("fill", UI_TOKENS.color.neutral.grey20)
            .style("opacity", 0.8);

        pillG.append("rect")
            .attr("x", pillX)
            .attr("y", -pillHeight / 2)
            .attr("width", pillWidth / 2)
            .attr("height", pillHeight)
            .attr("rx", UI_TOKENS.radius.large)
            .attr("ry", UI_TOKENS.radius.large)
            .style("fill", borderColor)
            .style("transition", `all ${UI_TOKENS.motion.duration.slow}ms ${UI_TOKENS.motion.easing.smooth}`);

        pillG.append("text")
            .attr("x", pillWidth / 4)
            .attr("y", 0)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", `${UI_TOKENS.fontSize.md}px`)
            .style("font-weight", isFloatBased ? UI_TOKENS.fontWeight.medium : UI_TOKENS.fontWeight.bold)
            .style("fill", isFloatBased ? UI_TOKENS.color.neutral.grey130 : UI_TOKENS.color.neutral.white)
            .style("pointer-events", "none")
            .text("LP");

        pillG.append("text")
            .attr("x", 3 * pillWidth / 4)
            .attr("y", 0)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", `${UI_TOKENS.fontSize.md}px`)
            .style("font-weight", isFloatBased ? UI_TOKENS.fontWeight.bold : UI_TOKENS.fontWeight.medium)
            .style("fill", isFloatBased ? UI_TOKENS.color.neutral.white : UI_TOKENS.color.neutral.grey130)
            .style("pointer-events", "none")
            .text("Float");

        // Hover effects
        btn.on("mouseover", function () {
            d3.select(this).style("box-shadow", UI_TOKENS.shadow[8]);
        })
            .on("mouseout", function () {
                d3.select(this).style("box-shadow", "none");
            });
    }

    private createColumnDisplayToggleButton(): void {
        this.container.selectAll(".column-toggle-group").remove();

        const layout = this.getHeaderButtonLayout(this.currentViewportWidth, this.currentSettings, this.currentState);
        const { x: buttonX, size: buttonSize, visible } = layout.colToggle;

        if (!visible) return;

        const showColumns = this.currentState.showExtraColumns;
        const buttonY = UI_TOKENS.spacing.sm;

        const btn = this.container.append("button")
            .attr("class", "column-toggle-group")
            .attr("type", "button")
            .attr("aria-label", showColumns ? "Hide data columns" : "Show data columns")
            .attr("aria-pressed", showColumns.toString())
            .classed("header-toggle-button", true)
            .style("position", "absolute")
            .style("left", `${buttonX}px`)
            .style("top", `${buttonY}px`)
            .style("width", `${buttonSize}px`)
            .style("height", `${buttonSize}px`)
            .style("padding", "0")
            .style("display", "flex")
            .style("align-items", "center")
            .style("justify-content", "center")
            .style("border", `1.5px solid ${showColumns ? UI_TOKENS.color.primary.default : UI_TOKENS.color.neutral.grey60}`)
            .style("border-width", showColumns ? "2px" : "1.5px")
            .style("background-color", showColumns ? UI_TOKENS.color.primary.light : UI_TOKENS.color.neutral.white)
            .style("border-radius", `${UI_TOKENS.radius.medium}px`)
            .on("click", (event) => {
                event.stopPropagation();
                this.callbacks.onToggleColumns();
            });

        const svg = btn.append("svg")
            .attr("width", buttonSize)
            .attr("height", buttonSize)
            .style("pointer-events", "none");

        const iconG = svg.append("g")
            .attr("transform", `translate(${buttonSize / 2}, ${buttonSize / 2})`);

        const iconColor = showColumns ? UI_TOKENS.color.primary.default : UI_TOKENS.color.neutral.grey130;

        if (showColumns) {
            iconG.append("path")
                .attr("d", "M 2,-4 L -2,0 L 2,4")
                .attr("stroke", iconColor)
                .attr("stroke-width", 2)
                .attr("fill", "none")
                .attr("stroke-linecap", "round")
                .attr("stroke-linejoin", "round");
        } else {
            iconG.append("path")
                .attr("d", "M -2,-4 L 2,0 L -2,4")
                .attr("stroke", iconColor)
                .attr("stroke-width", 2)
                .attr("fill", "none")
                .attr("stroke-linecap", "round")
                .attr("stroke-linejoin", "round");
        }

        btn.on("mouseover", function () {
            d3.select(this)
                .style("background-color", showColumns ? UI_TOKENS.color.primary.default : UI_TOKENS.color.neutral.grey20)
                .style("box-shadow", UI_TOKENS.shadow[8]);
            if (!showColumns) {
                d3.select(this).select("path").attr("stroke", UI_TOKENS.color.neutral.grey160);
            } else {
                d3.select(this).select("path").attr("stroke", UI_TOKENS.color.neutral.white);
            }
        })
            .on("mouseout", function () {
                d3.select(this)
                    .style("background-color", showColumns ? UI_TOKENS.color.primary.light : UI_TOKENS.color.neutral.white)
                    .style("box-shadow", "none");
                if (!showColumns) {
                    d3.select(this).select("path").attr("stroke", iconColor);
                } else {
                    d3.select(this).select("path").attr("stroke", iconColor);
                }
            });
    }

    private createWbsEnableToggleButton(): void {
        this.container.selectAll(".wbs-enable-toggle-group").remove();

        if (!this.currentState.wbsDataExists) return;

        const isEnabled = this.currentState.wbsEnabled;
        const layout = this.getHeaderButtonLayout(this.currentViewportWidth, this.currentSettings, this.currentState);
        const { x: buttonX, width: buttonWidth, visible } = layout.wbsEnable;

        if (!visible) return;

        const buttonHeight = UI_TOKENS.height.standard;
        const buttonY = UI_TOKENS.spacing.sm;

        const fill = isEnabled ? UI_TOKENS.color.primary.light : UI_TOKENS.color.neutral.white;
        const stroke = isEnabled ? UI_TOKENS.color.primary.default : UI_TOKENS.color.neutral.grey60;
        const textColor = isEnabled ? UI_TOKENS.color.primary.default : UI_TOKENS.color.neutral.grey130;

        const btn = this.container.append("button")
            .attr("class", "wbs-enable-toggle-group")
            .attr("type", "button")
            .attr("role", "button")
            .classed("header-toggle-button", true)
            .style("position", "absolute")
            .style("left", `${buttonX}px`)
            .style("top", `${buttonY}px`)
            .style("width", `${buttonWidth}px`)
            .style("height", `${buttonHeight}px`)
            .style("padding", "0")
            .style("display", "flex")
            .style("align-items", "center")
            .style("border", `1.5px solid ${stroke}`)
            .style("border-width", isEnabled ? "2px" : "1.5px")
            .style("background-color", fill)
            .style("border-radius", `${UI_TOKENS.radius.medium}px`)
            .style("cursor", "pointer")
            .on("click", (event) => {
                event.stopPropagation();
                this.callbacks.onToggleWbsEnable();
            });

        const svg = btn.append("svg")
            .attr("width", buttonWidth)
            .attr("height", buttonHeight)
            .style("pointer-events", "none");

        svg.append("circle")
            .attr("cx", 10)
            .attr("cy", buttonHeight / 2)
            .attr("r", 4)
            .style("fill", isEnabled ? UI_TOKENS.color.primary.default : UI_TOKENS.color.neutral.grey60);

        svg.append("text")
            .attr("x", buttonWidth / 2 + 6)
            .attr("y", buttonHeight / 2)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", `${UI_TOKENS.fontSize.md}px`)
            .style("font-weight", UI_TOKENS.fontWeight.semibold)
            .style("fill", textColor)
            .text("WBS");

        btn.on("mouseover", function () {
            d3.select(this).style("box-shadow", UI_TOKENS.shadow[8]);
        })
            .on("mouseout", function () {
                d3.select(this).style("box-shadow", "none");
            });
    }

    private createCopyButton(): void {
        this.container.selectAll('.copy-data-button-group').remove();

        const layout = this.getHeaderButtonLayout(this.currentViewportWidth, this.currentSettings, this.currentState);
        const { x: buttonX, size: buttonSize, visible } = layout.copyButton;

        if (!visible) return;

        const buttonY = UI_TOKENS.spacing.sm;

        const btn = this.container.append("button")
            .attr("class", "copy-data-button-group")
            .attr("type", "button")
            .classed("header-toggle-button", true)
            .style("position", "absolute")
            .style("left", `${buttonX}px`)
            .style("top", `${buttonY}px`)
            .style("width", `${buttonSize}px`)
            .style("height", `${buttonSize}px`)
            .style("padding", "0")
            .style("display", "flex")
            .style("align-items", "center")
            .style("justify-content", "center")
            .style("border", `1.5px solid ${UI_TOKENS.color.neutral.grey60}`)
            .style("background-color", UI_TOKENS.color.neutral.white)
            .style("border-radius", `${UI_TOKENS.radius.medium}px`)
            .style("cursor", "pointer")
            .on("click", (event) => {
                event.stopPropagation();
                this.callbacks.onCopy();
            });

        const svg = btn.append("svg")
            .attr("width", buttonSize)
            .attr("height", buttonSize)
            .style("pointer-events", "none");

        const iconG = svg.append('g')
            .attr('transform', `translate(${buttonSize / 2}, ${buttonSize / 2})`);

        iconG.append('path')
            .attr('d', 'M-4,1 L-4,5 L4,5 L4,-3 L0,-3 M0,-7 L6,-7 L6,1 L0,1 L0,-7 Z')
            .attr('fill', 'none')
            .attr('stroke', UI_TOKENS.color.neutral.grey130)
            .attr('stroke-width', 1.5)
            .attr('stroke-linecap', 'round')
            .attr('stroke-linejoin', 'round');

        btn.on("mouseover", function () {
            d3.select(this).style("box-shadow", UI_TOKENS.shadow[8]);
        })
            .on("mouseout", function () {
                d3.select(this).style("box-shadow", "none");
            });
    }

    private createExportButton(): void {
        this.container.selectAll('.export-button-group').remove();

        const layout = this.getHeaderButtonLayout(this.currentViewportWidth, this.currentSettings, this.currentState);
        const { x: buttonX, size: buttonSize, visible } = layout.exportButton;

        if (!visible) return;

        const buttonY = UI_TOKENS.spacing.sm;

        const btn = this.container.append("button")
            .attr("class", "export-button-group")
            .attr("type", "button")
            .classed("header-toggle-button", true)
            .style("position", "absolute")
            .style("left", `${buttonX}px`)
            .style("top", `${buttonY}px`)
            .style("width", `${buttonSize}px`)
            .style("height", `${buttonSize}px`)
            .style("padding", "0")
            .style("display", "flex")
            .style("align-items", "center")
            .style("justify-content", "center")
            .style("border", `1.5px solid ${UI_TOKENS.color.neutral.grey60}`)
            .style("background-color", UI_TOKENS.color.neutral.white)
            .style("border-radius", `${UI_TOKENS.radius.medium}px`)
            .style("cursor", "pointer")
            .on("click", (event) => {
                event.stopPropagation();
                this.callbacks.onExport();
            });

        const svg = btn.append("svg")
            .attr("class", "export-icon-svg")
            .attr("width", buttonSize)
            .attr("height", buttonSize)
            .style("pointer-events", "none");

        const iconG = svg.append('g')
            .attr('class', 'export-icon-g')
            .attr('transform', `translate(${buttonSize / 2}, ${buttonSize / 2})`);

        iconG.append('path')
            .attr('class', 'export-icon-path')
            .attr('d', 'M-5,-7 L-5,7 L5,7 L5,-3 L1,-7 Z')
            .attr('fill', 'none')
            .attr('stroke', UI_TOKENS.color.neutral.grey130)
            .attr('stroke-width', 1.5)
            .attr('stroke-linecap', 'round')
            .attr('stroke-linejoin', 'round');

        const spinner = iconG.append('g')
            .attr('class', 'export-spinner')
            .style('display', 'none');

        spinner.append('circle')
            .attr('r', 6)
            .attr('fill', 'none')
            .attr('stroke', UI_TOKENS.color.primary.default)
            .attr('stroke-width', 2)
            .attr('stroke-dasharray', '20 10')
            .attr('stroke-linecap', 'round');

        btn.on("mouseover", function () {
            d3.select(this).style("box-shadow", UI_TOKENS.shadow[8]);
        })
            .on("mouseout", function () {
                d3.select(this).style("box-shadow", "none");
            });
    }

    private createHelpButton(): void {
        this.container.selectAll('.help-button-group').remove();

        const layout = this.getHeaderButtonLayout(this.currentViewportWidth, this.currentSettings, this.currentState);
        const { x: buttonX, size: buttonSize, visible } = layout.helpButton;

        if (!visible) return;

        const buttonY = UI_TOKENS.spacing.sm;

        const btn = this.container.append("button")
            .attr("class", "help-button-group")
            .attr("type", "button")
            .classed("header-toggle-button", true)
            .style("position", "absolute")
            .style("left", `${buttonX}px`)
            .style("top", `${buttonY}px`)
            .style("width", `${buttonSize}px`)
            .style("height", `${buttonSize}px`)
            .style("padding", "0")
            .style("display", "flex")
            .style("align-items", "center")
            .style("justify-content", "center")
            .style("border", "none")
            .style("background-color", "transparent")
            .style("cursor", "pointer")
            .on("click", (event) => {
                event.stopPropagation();
                this.callbacks.onHelp();
            });

        const svg = btn.append("svg")
            .attr("width", buttonSize)
            .attr("height", buttonSize)
            .style("pointer-events", "none");

        svg.append('circle')
            .attr('cx', buttonSize / 2)
            .attr('cy', buttonSize / 2)
            .attr('r', buttonSize / 2 - 2)
            .style('fill', UI_TOKENS.color.neutral.white)
            .style('stroke', UI_TOKENS.color.neutral.grey60)
            .style('stroke-width', 1.5);

        svg.append('text')
            .attr('x', buttonSize / 2)
            .attr('y', buttonSize / 2 + 1)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', "central")
            .style('font-family', "Segoe UI, sans-serif")
            .style('font-size', `${UI_TOKENS.fontSize.md}px`)
            .style('font-weight', UI_TOKENS.fontWeight.bold)
            .style('fill', UI_TOKENS.color.neutral.grey130)
            .text("?");

        btn.on("mouseover", function () {
            d3.select(this).select("circle").style("stroke", UI_TOKENS.color.neutral.grey90);
        })
            .on("mouseout", function () {
                d3.select(this).select("circle").style("stroke", UI_TOKENS.color.neutral.grey60);
            });
    }
}
