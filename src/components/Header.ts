
import { select, Selection } from "d3-selection";
import { VisualSettings } from "../settings";
import { UI_TOKENS, LAYOUT_BREAKPOINTS, HEADER_DOCK_TOKENS } from "../utils/Theme";
import { BoundFieldState } from "../data/Interfaces";
import {
    computeHeaderButtonLayout,
    getActiveHiddenHeaderControlCount,
    getLookAheadOptions,
    HeaderButtonLayout,
    HeaderDesiredControls,
    HeaderMenuAction,
    shouldInlineHeaderFloatThreshold
} from "../utils/HeaderLayout";

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
    onExportHtml: () => void;
    onCopy: () => void;
    onLookAheadWindowChanged: (days: number) => void;
    onZoomIn?: () => void;
    onZoomOut?: () => void;
}

export interface HeaderState {
    showAllTasks: boolean;
    showBaseline: boolean;
    baselineAvailable: boolean;
    showPreviousUpdate: boolean;
    previousUpdateAvailable: boolean;
    boundFields: BoundFieldState;
    showConnectorLines: boolean;
    wbsExpanded: boolean;
    wbsDataExists: boolean;
    wbsAvailableLevels: number[];
    wbsExpandToLevel?: number;
    wbsManualExpansionOverride: boolean;
    currentMode: string;
    modeStatusMessage?: string | null;
    modeWarningMessage?: string | null;
    showPathInfoChip?: boolean;
    floatThreshold: number;
    showNearCritical: boolean;
    showExtraColumns: boolean;
    wbsEnabled: boolean;
    lookAheadAvailable: boolean;
    lookAheadWindowDays: number;
    lookAheadDisplayMode: "filter" | "highlight";
}

type HeaderMenuSection = "Analysis" | "Timeline Layers" | "WBS" | "Actions";

interface HeaderMenuItem {
    id: HeaderMenuAction;
    section: HeaderMenuSection;
    label: string;
    status?: string;
    title?: string;
    disabled?: boolean;
    kind?: "button" | "select" | "number";
    callback?: () => void;
}

export type HeaderPalette = Partial<typeof HEADER_DOCK_TOKENS> & { isHighContrast?: boolean };

const LOOK_AHEAD_SELECT_FONT_SIZE = `${UI_TOKENS.fontSize.sm}px`;
const LOOK_AHEAD_OPTION_LINE_HEIGHT = "1.2";

export class Header {
    private static nextMenuOrdinal: number = 0;
    private container: Selection<HTMLDivElement, unknown, null, undefined>;
    private svg!: Selection<SVGSVGElement, unknown, null, undefined>;
    private callbacks: HeaderCallbacks;
    private exportButtonLoading: boolean = false;
    private copySuccessTimeout: number | null = null;
    private controlsMenuOpen: boolean = false;
    private currentLayout: HeaderButtonLayout | null = null;
    private currentPalette: HeaderPalette = {};
    private readonly overflowMenuId: string;
    private overflowDocumentPointerDownHandler: ((event: PointerEvent) => void) | null = null;

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
        this.overflowMenuId = `header-controls-menu-${Header.nextMenuOrdinal++}`;
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
            .attr("class", "header-svg-root");
    }

    private renderDockChrome(): void {
        const layout = this.getCurrentLayout();
        const controlY = UI_TOKENS.spacing.sm;
        const controlHeight = UI_TOKENS.height.standard;
        const shellPaddingY = 4;
        const groupPaddingY = 2;
        const rowY = Math.max(0, controlY - shellPaddingY);
        const rowHeight = controlHeight + shellPaddingY * 2;
        const groupY = Math.max(0, controlY - groupPaddingY);
        const groupHeight = controlHeight + groupPaddingY * 2;
        const rowX = 8;
        const rowWidth = Math.max(1, this.currentViewportWidth - 16);

        type GroupRect = { key: string; x: number; width: number };
        const groups: Array<{ key: string; items: Array<{ x: number; width?: number; size?: number; visible: boolean }> }> = [
            { key: "analysis", items: [layout.showAllCritical, layout.modeToggle, layout.lookAhead] },
            { key: "layers", items: [layout.baseline, layout.previousUpdate, layout.connectorLines, layout.colToggle] },
            { key: "wbs", items: [layout.wbsEnable, layout.wbsExpandToggle, layout.wbsCollapseToggle] },
            { key: "actions", items: [layout.copyButton, layout.htmlExportButton, layout.exportButton, layout.helpButton, layout.actionOverflowButton] }
        ];

        const visibleGroups: GroupRect[] = groups.map(group => {
            const visibleItems = group.items.filter(item => item.visible);
            if (visibleItems.length === 0) {
                return null;
            }

            const left = Math.max(12, Math.min(...visibleItems.map(item => item.x)) - 6);
            const right = Math.min(
                this.currentViewportWidth - 12,
                Math.max(...visibleItems.map(item => item.x + (item.width ?? item.size ?? UI_TOKENS.height.standard))) + 6
            );

            return {
                key: group.key,
                x: left,
                width: Math.max(24, right - left)
            };
        }).filter((group): group is GroupRect => group !== null);

        const shell = this.toggleButtonGroup.selectAll<SVGRectElement, number>(".header-command-shell")
            .data([rowWidth]);

        shell.join(
            enter => enter.append("rect").attr("class", "header-command-shell"),
            update => update,
            exit => exit.remove()
        )
            .attr("x", rowX)
            .attr("y", rowY)
            .attr("width", d => d)
            .attr("height", rowHeight)
            .attr("rx", UI_TOKENS.radius.medium)
            .attr("ry", UI_TOKENS.radius.medium)
            .attr("fill", this.getPaletteToken("shell"))
            .attr("stroke", this.getPaletteToken("commandStroke"))
            .attr("stroke-width", 1)
            .attr("stroke-opacity", 0.85);

        this.toggleButtonGroup.selectAll<SVGRectElement, GroupRect>(".header-command-group")
            .data(visibleGroups, d => d.key)
            .join(
                enter => enter.append("rect").attr("class", "header-command-group"),
                update => update,
                exit => exit.remove()
            )
            .attr("x", d => d.x)
            .attr("y", groupY)
            .attr("width", d => d.width)
            .attr("height", groupHeight)
            .attr("rx", UI_TOKENS.radius.medium)
            .attr("ry", UI_TOKENS.radius.medium)
            .attr("fill", this.getPaletteToken("shell"))
            .attr("stroke", this.getPaletteToken("groupStroke"))
            .attr("stroke-width", 1)
            .attr("stroke-opacity", 0.7);
    }

    private upsertButton(className: string): Selection<HTMLButtonElement, unknown, null, undefined> {
        let button = this.container.select<HTMLButtonElement>(`button.${className}`);
        if (button.empty()) {
            button = this.container.append("button")
                .attr("class", className);
        }

        button
            .attr("class", className)
            .style("display", "flex")
            .style("transform", null);

        button.selectAll("*").remove();
        return button;
    }

    private upsertDiv(className: string): Selection<HTMLDivElement, unknown, null, undefined> {
        let element = this.container.select<HTMLDivElement>(`div.${className}`);
        if (element.empty()) {
            element = this.container.append("div")
                .attr("class", className);
        }

        element
            .attr("class", className)
            .style("display", "block");

        element.selectAll("*").remove();
        return element;
    }

    private hideControl(className: string): void {
        const normalized = className.startsWith(".") ? className.slice(1) : className;
        this.container.select<HTMLElement>(`button.${normalized}`).style("display", "none");
        this.container.select<HTMLElement>(`div.${normalized}`).style("display", "none");
    }

    public render(viewportWidth: number, settings: VisualSettings, state: HeaderState, palette: HeaderPalette = {}) {
        this.currentViewportWidth = viewportWidth;
        this.currentSettings = settings;
        this.currentState = state;
        this.currentPalette = palette;
        this.currentLayout = null;
        this.currentLayout = this.getHeaderButtonLayout(viewportWidth, settings, state);

        this.renderButtons();
        this.applyHeaderPaletteOverrides();
    }

    public destroy(): void {
        this.detachOverflowOutsideClickHandler();

        if (this.copySuccessTimeout !== null) {
            clearTimeout(this.copySuccessTimeout);
            this.copySuccessTimeout = null;
        }
    }

    private getCurrentLayout(): HeaderButtonLayout {
        if (!this.currentLayout) {
            this.currentLayout = this.getHeaderButtonLayout(this.currentViewportWidth, this.currentSettings, this.currentState);
        }

        return this.currentLayout;
    }

    private getPaletteToken<K extends keyof typeof HEADER_DOCK_TOKENS>(key: K): (typeof HEADER_DOCK_TOKENS)[K] {
        return this.currentPalette[key] ?? HEADER_DOCK_TOKENS[key];
    }

    private applyHeaderPaletteOverrides(): void {
        if (!this.currentPalette.isHighContrast) {
            return;
        }

        const foreground = this.getPaletteToken("buttonText");
        const background = this.getPaletteToken("shell");
        const border = this.getPaletteToken("buttonStroke");
        const inputBackground = this.getPaletteToken("inputBg");

        this.toggleButtonGroup
            .selectAll<SVGRectElement, unknown>(".header-command-shell, .header-command-group")
            .attr("fill", background)
            .attr("stroke", border)
            .attr("stroke-width", 1.5);

        this.container
            .selectAll<HTMLButtonElement, unknown>("button.header-toggle-button")
            .style("background-color", "transparent")
            .style("color", foreground);

        this.container
            .selectAll<SVGRectElement, unknown>("button.header-toggle-button svg rect")
            .attr("fill", background)
            .attr("stroke", border)
            .style("fill", background)
            .style("stroke", border);

        this.container
            .selectAll<SVGPathElement | SVGLineElement, unknown>("button.header-toggle-button svg path, button.header-toggle-button svg line")
            .attr("stroke", foreground)
            .style("stroke", foreground);

        this.container
            .selectAll<SVGCircleElement, unknown>("button.header-toggle-button svg circle")
            .attr("stroke", foreground)
            .attr("fill", background)
            .style("stroke", foreground)
            .style("fill", background);

        this.container
            .selectAll<SVGTextElement, unknown>("button.header-toggle-button svg text")
            .style("fill", foreground);

        this.container
            .selectAll<HTMLDivElement, unknown>("div.look-ahead-control-wrapper, div.float-threshold-wrapper")
            .style("background-color", background)
            .style("border", `1.5px solid ${border}`)
            .style("box-shadow", "none")
            .style("color", foreground);

        this.container
            .selectAll<HTMLSelectElement | HTMLInputElement, unknown>("div.look-ahead-control-wrapper select, div.float-threshold-wrapper input, div.action-overflow-menu select, div.action-overflow-menu input")
            .style("color", foreground)
            .style("background-color", inputBackground)
            .style("border", `1.5px solid ${border}`);

        this.container
            .selectAll<HTMLDivElement, unknown>("div.action-overflow-menu")
            .style("background-color", background)
            .style("border", `1.5px solid ${border}`)
            .style("box-shadow", "none")
            .style("color", foreground);

        this.container
            .selectAll<HTMLElement, unknown>("div.action-overflow-menu button, div.action-overflow-menu span, div.action-overflow-menu div")
            .style("color", foreground);
    }

    private renderButtons() {
        this.renderDockChrome();
        this.createOrUpdateToggleButton();
        this.createModeToggleButton();
        this.createLookAheadControl();
        this.createColumnDisplayToggleButton();
        this.createOrUpdateBaselineToggleButton();
        this.createOrUpdatePreviousUpdateToggleButton();
        this.createConnectorLinesToggleButton();
        this.createWbsEnableToggleButton();
        this.createWbsExpandCycleToggleButton();
        this.createWbsCollapseCycleToggleButton();
        this.createCopyButton();
        this.createExportHtmlButton();
        this.createExportButton();
        this.createHelpButton();
        this.createActionOverflowButton();
        this.createFloatThresholdControl();
    }

    /**
     * Shows visual feedback on the copy button when copy succeeds.
     * Turns the button border green for 2 seconds.
     */
    public showCopySuccess(): void {
        const btn = this.container.select<HTMLButtonElement>('button.copy-data-button-group');
        const bgRect = btn.select<SVGRectElement>('.copy-button-bg');
        if (!btn.empty()) {
            bgRect
                .attr('fill', HEADER_DOCK_TOKENS.successBg)
                .attr('stroke', HEADER_DOCK_TOKENS.success)
                .attr('stroke-width', 1.5);

            if (this.copySuccessTimeout !== null) {
                clearTimeout(this.copySuccessTimeout);
            }

            this.copySuccessTimeout = window.setTimeout(() => {
                const liveRect = this.container.select<HTMLButtonElement>('button.copy-data-button-group')
                    .select<SVGRectElement>('.copy-button-bg');
                liveRect
                    .attr('fill', HEADER_DOCK_TOKENS.buttonBg)
                    .attr('stroke', HEADER_DOCK_TOKENS.buttonStroke)
                    .attr('stroke-width', 1);
                this.copySuccessTimeout = null;
            }, 2000);
        }

        // Centered Toast Notification
        // Remove any existing notification first to avoid duplicates
        this.container.selectAll(".copy-notification-overlay").remove();

        const overlay = this.container.append("div")
            .attr("class", "copy-notification-overlay")
            .style("position", "fixed") // Use fixed to center relative to viewport/iframe
            .style("top", "50%")
            .style("left", "50%")
            .style("transform", "translate(-50%, -50%)")
            .style("background-color", HEADER_DOCK_TOKENS.chipBg)
            .style("padding", "16px 24px")
            .style("border-radius", "8px")
            .style("box-shadow", HEADER_DOCK_TOKENS.shadow)
            .style("border", `1px solid ${HEADER_DOCK_TOKENS.chipStroke}`)
            .style("z-index", "10000")
            .style("display", "flex")
            .style("align-items", "center")
            .style("gap", "12px")
            .style("opacity", "0")
            .style("transition", "opacity 0.2s ease-in-out");

        // Icon
        const iconSvg = overlay.append("svg")
            .attr("width", "24")
            .attr("height", "24")
            .attr("viewBox", "0 0 24 24")
            .style("flex-shrink", "0");

        iconSvg.append("path")
            .attr("d", "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z")
            .attr("fill", UI_TOKENS.color.success.default);

        // Text
        overlay.append("div")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", "14px")
            .style("font-weight", "600")
            .style("color", HEADER_DOCK_TOKENS.chipText)
            .text("Data copied to clipboard");

        // Animate in
        requestAnimationFrame(() => {
            overlay.style("opacity", "1");
        });

        // Remove after delay
        setTimeout(() => {
            overlay.style("opacity", "0");
            setTimeout(() => {
                overlay.remove();
            }, 200);
        }, 2000);
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

    private tintGlyph(iconG: Selection<SVGGElement, unknown, null, undefined>, color: string): void {
        iconG.selectAll<SVGElement, unknown>(".glyph-fill").attr("fill", color);
        iconG.selectAll<SVGElement, unknown>(".glyph-stroke").attr("stroke", color);
    }

    private drawConnectorDependencyGlyph(
        iconG: Selection<SVGGElement, unknown, null, undefined>,
        color: string,
        isActive: boolean
    ): void {
        [
            { x: -8, y: -7, width: 7, height: 4 },
            { x: 1, y: 4, width: 7, height: 4 }
        ].forEach(bar => {
            iconG.append("rect")
                .attr("class", "glyph-fill")
                .attr("x", bar.x)
                .attr("y", bar.y)
                .attr("width", bar.width)
                .attr("height", bar.height)
                .attr("rx", 1.6)
                .attr("ry", 1.6)
                .attr("fill", color)
                .attr("fill-opacity", isActive ? 1 : 0.85);
        });

        iconG.append("path")
            .attr("class", "glyph-stroke")
            .attr("d", "M-1,-5 H3 V6 H1")
            .attr("stroke", color)
            .attr("stroke-width", 1.8)
            .attr("fill", "none")
            .attr("stroke-linecap", "round")
            .attr("stroke-linejoin", "round")
            .attr("stroke-dasharray", isActive ? null : "2.4,2.4");

        if (isActive) {
            iconG.append("path")
                .attr("class", "glyph-stroke")
                .attr("d", "M-1,4 L1,6 L-1,8")
                .attr("stroke", color)
                .attr("stroke-width", 1.8)
                .attr("fill", "none")
                .attr("stroke-linecap", "round")
                .attr("stroke-linejoin", "round");
        }
    }

    private drawWbsHierarchyGlyph(
        iconG: Selection<SVGGElement, unknown, null, undefined>,
        color: string,
        mode: "tree" | "flat",
        control?: "plus" | "minus"
    ): void {
        const rows = mode === "tree"
            ? [
                { bulletX: -7.2, barX: -2.8, barWidth: 6.8, y: -6 },
                { bulletX: -4.2, barX: 0.2, barWidth: 5.8, y: 0 },
                { bulletX: -1.2, barX: 3.2, barWidth: 4.8, y: 6 }
            ]
            : [
                { bulletX: -7.2, barX: -2.8, barWidth: 8.8, y: -6 },
                { bulletX: -7.2, barX: -2.8, barWidth: 8.8, y: 0 },
                { bulletX: -7.2, barX: -2.8, barWidth: 8.8, y: 6 }
            ];

        if (mode === "tree") {
            iconG.append("path")
                .attr("class", "glyph-stroke")
                .attr("d", "M-5.4,-4.2 V7.8 M-5.4,-4.2 H-2.8 M-5.4,1.8 H0.2 M-5.4,7.8 H3.2")
                .attr("stroke", color)
                .attr("stroke-width", 1.4)
                .attr("fill", "none")
                .attr("stroke-linecap", "round")
                .attr("stroke-linejoin", "round");
        }

        rows.forEach(row => {
            iconG.append("rect")
                .attr("class", "glyph-fill")
                .attr("x", row.bulletX)
                .attr("y", row.y - 1.8)
                .attr("width", 3.6)
                .attr("height", 3.6)
                .attr("rx", 1)
                .attr("ry", 1)
                .attr("fill", color);

            iconG.append("rect")
                .attr("class", "glyph-fill")
                .attr("x", row.barX)
                .attr("y", row.y - 1.6)
                .attr("width", row.barWidth)
                .attr("height", 3.2)
                .attr("rx", 1.6)
                .attr("ry", 1.6)
                .attr("fill", color);
        });

        if (control) {
            iconG.append("circle")
                .attr("class", "glyph-stroke")
                .attr("cx", 6.5)
                .attr("cy", -6.5)
                .attr("r", 3.2)
                .attr("stroke", color)
                .attr("stroke-width", 1.4)
                .attr("fill", "none");

            iconG.append("path")
                .attr("class", "glyph-stroke")
                .attr("d", control === "plus"
                    ? "M4.9,-6.5 H8.1 M6.5,-8.1 V-4.9"
                    : "M4.9,-6.5 H8.1")
                .attr("stroke", color)
                .attr("stroke-width", 1.6)
                .attr("fill", "none")
                .attr("stroke-linecap", "round");
        }
    }

    private drawColumnVisibilityGlyph(
        iconG: Selection<SVGGElement, unknown, null, undefined>,
        color: string,
        isVisible: boolean
    ): void {
        iconG.append("rect")
            .attr("class", "glyph-stroke")
            .attr("x", -6.5)
            .attr("y", -6)
            .attr("width", 13)
            .attr("height", 12)
            .attr("rx", 1.8)
            .attr("ry", 1.8)
            .attr("stroke", color)
            .attr("stroke-width", 1.4)
            .attr("fill", "none");

        if (isVisible) {
            [-2, 2].forEach(x => {
                iconG.append("line")
                    .attr("class", "glyph-stroke")
                    .attr("x1", x)
                    .attr("x2", x)
                    .attr("y1", -6)
                    .attr("y2", 6)
                    .attr("stroke", color)
                    .attr("stroke-width", 1.4)
                    .attr("stroke-linecap", "round");
            });

            iconG.append("rect")
                .attr("class", "glyph-fill")
                .attr("x", 2.7)
                .attr("y", -5)
                .attr("width", 2.6)
                .attr("height", 10)
                .attr("rx", 1.1)
                .attr("ry", 1.1)
                .attr("fill", color)
                .attr("fill-opacity", 0.9);
            return;
        }

        iconG.append("rect")
            .attr("class", "glyph-fill")
            .attr("x", -5.2)
            .attr("y", -5)
            .attr("width", 6.7)
            .attr("height", 10)
            .attr("rx", 1.1)
            .attr("ry", 1.1)
            .attr("fill", color)
            .attr("fill-opacity", 0.88);

        iconG.append("path")
            .attr("class", "glyph-stroke")
            .attr("d", "M3.2,-3.5 L6,0 L3.2,3.5")
            .attr("stroke", color)
            .attr("stroke-width", 1.8)
            .attr("fill", "none")
            .attr("stroke-linecap", "round")
            .attr("stroke-linejoin", "round");
    }

    public setExporting(isExporting: boolean): void {
        this.exportButtonLoading = isExporting;

        const btn = this.container.select<HTMLButtonElement>('button.export-button-group');
        if (btn.empty()) return;

        const iconPaths = btn.selectAll('.export-icon-path');
        const spinner = btn.select('.export-spinner');
        const bgRect = btn.select<SVGRectElement>('.export-button-bg');

        if (isExporting) {
            iconPaths.style('display', 'none');
            spinner.style('display', 'block');
            btn.classed('is-exporting', true)
                .attr('aria-busy', 'true')
                .property('disabled', true)
                .style('cursor', 'wait')
                .style('background-color', 'transparent');
            bgRect
                .attr('fill', HEADER_DOCK_TOKENS.primaryBg)
                .attr('stroke', HEADER_DOCK_TOKENS.primary);
        } else {
            iconPaths.style('display', 'block');
            spinner.style('display', 'none');
            btn.classed('is-exporting', false)
                .attr('aria-busy', 'false')
                .property('disabled', false)
                .style('cursor', 'pointer')
                .style('background-color', 'transparent');
            bgRect
                .attr('fill', HEADER_DOCK_TOKENS.buttonBg)
                .attr('stroke', HEADER_DOCK_TOKENS.buttonStroke);
        }
    }

    private createOrUpdateToggleButton(): void {
        const layout = this.getHeaderButtonLayout(this.currentViewportWidth, this.currentSettings, this.currentState);
        const buttonWidth = layout.showAllCritical.width;
        const buttonHeight = UI_TOKENS.height.standard;
        const buttonX = layout.showAllCritical.x;
        const buttonY = UI_TOKENS.spacing.sm;

        if (!layout.showAllCritical.visible) {
            this.hideControl("toggle-button-group");
            return;
        }

        const isShowingCritical = !this.currentState.showAllTasks;

        const btn = this.upsertButton("toggle-button-group")
            .attr("type", "button")
            .attr("aria-label", isShowingCritical ? "Show all tasks" : "Show critical path only")
            .attr("title", isShowingCritical ? "Show all tasks" : "Show critical path only")
            .attr("aria-pressed", isShowingCritical.toString())
            .classed("header-toggle-button", true)
            .style("position", "absolute")
            .style("left", `${buttonX}px`)
            .style("top", `${buttonY}px`)
            .style("width", `${buttonWidth}px`)
            .style("height", `${buttonHeight}px`)
            .style("padding", "0")
            .style("box-sizing", "border-box")
            .style("display", "flex")
            .style("align-items", "center")
            .style("border", "none")
            .style("background-color", "transparent")
            .style("border-radius", `${UI_TOKENS.radius.medium}px`)
            .on("click", (event) => {
                event.stopPropagation();
                this.callbacks.onToggleCriticalPath();
            });

        const isActive = isShowingCritical;
        const buttonFill = isActive ? HEADER_DOCK_TOKENS.dangerBg : HEADER_DOCK_TOKENS.buttonBg;
        const buttonStroke = isActive ? HEADER_DOCK_TOKENS.danger : HEADER_DOCK_TOKENS.buttonStroke;
        const hoverFill = isActive ? this.lightenColor(HEADER_DOCK_TOKENS.dangerBg, 0.12) : HEADER_DOCK_TOKENS.buttonHoverBg;
        const hoverStroke = isActive ? HEADER_DOCK_TOKENS.danger : HEADER_DOCK_TOKENS.buttonHoverStroke;
        const iconColor = isActive ? HEADER_DOCK_TOKENS.buttonText : HEADER_DOCK_TOKENS.buttonMuted;

        // SVG Icon
        const svg = btn.append("svg")
            .attr("width", buttonWidth)
            .attr("height", buttonHeight)
            .style("position", "absolute")
            .style("top", "0")
            .style("left", "0")
            .style("pointer-events", "none");

        // Background Rect (acting as button body)
        const bgRect = svg.append("rect")
            .attr("x", 0.5)
            .attr("y", 0.5)
            .attr("width", buttonWidth - 1)
            .attr("height", buttonHeight - 1)
            .attr("rx", UI_TOKENS.radius.medium)
            .attr("ry", UI_TOKENS.radius.medium)
            .attr("fill", buttonFill)
            .attr("stroke", buttonStroke)
            .attr("stroke-width", 1);

        const iconCenterX = buttonWidth / 2;
        const iconCenterY = buttonHeight / 2;

        if (!isShowingCritical) {
            svg.append("rect")
                .attr("x", iconCenterX - 6)
                .attr("y", iconCenterY - 6)
                .attr("width", 12)
                .attr("height", 2)
                .attr("rx", 1)
                .attr("fill", iconColor);
            svg.append("rect")
                .attr("x", iconCenterX - 6)
                .attr("y", iconCenterY - 1)
                .attr("width", 12)
                .attr("height", 2)
                .attr("rx", 1)
                .attr("fill", iconColor);
            svg.append("rect")
                .attr("x", iconCenterX - 6)
                .attr("y", iconCenterY + 4)
                .attr("width", 8)
                .attr("height", 2)
                .attr("rx", 1)
                .attr("fill", iconColor);
        } else {
            const iconG = svg.append("g")
                .attr("transform", `translate(${iconCenterX}, ${iconCenterY})`);

            iconG.append("path")
                .attr("d", "M-7,-7 H7 L2,0 V6 L-2,7 V0 Z")
                .attr("fill", "none")
                .attr("stroke", iconColor)
                .attr("stroke-width", 1.8)
                .attr("stroke-linejoin", "round")
                .attr("stroke-linecap", "round");

            iconG.append("rect")
                .attr("x", -6)
                .attr("y", -3.3)
                .attr("width", 7.2)
                .attr("height", 1.7)
                .attr("rx", 0.85)
                .attr("fill", iconColor);

            iconG.append("rect")
                .attr("x", -6)
                .attr("y", 1.3)
                .attr("width", 4.8)
                .attr("height", 1.7)
                .attr("rx", 0.85)
                .attr("fill", iconColor);

            iconG.append("circle")
                .attr("cx", 5.4)
                .attr("cy", -5.3)
                .attr("r", 1.8)
                .attr("fill", HEADER_DOCK_TOKENS.danger);
        }

        btn.append("title")
            .text(isShowingCritical ? "Show All Tasks" : "Show Critical Path Only");

        // Hover effects
        btn.on("mouseover", function () {
            bgRect.attr("fill", hoverFill)
                .attr("stroke", hoverStroke);
        })
            .on("mouseout", function () {
                bgRect.attr("fill", buttonFill)
                    .attr("stroke", buttonStroke);
            })
            .on("mousedown", function () {
                select(this).style("transform", "scale(0.96)");
            })
            .on("mouseup", function () {
                select(this).style("transform", "scale(1)");
            });
    }

    private createOrUpdateBaselineToggleButton(): void {
        const layout = this.getHeaderButtonLayout(this.currentViewportWidth, this.currentSettings, this.currentState);
        const { x: buttonX, width: buttonWidth, iconOnly, visible } = layout.baseline;

        if (!visible) {
            this.hideControl("baseline-toggle-group");
            return;
        }

        const isAvailable = this.currentState.baselineAvailable;
        const showBaseline = this.currentState.showBaseline;

        const baselineColor = this.currentSettings.comparisonBars.baselineColor.value.value;
        const buttonFill = HEADER_DOCK_TOKENS.buttonBg;
        const buttonStroke = showBaseline ? baselineColor : HEADER_DOCK_TOKENS.buttonStroke;
        const hoverFill = HEADER_DOCK_TOKENS.buttonHoverBg;
        const hoverStroke = showBaseline ? baselineColor : HEADER_DOCK_TOKENS.buttonHoverStroke;
        const labelFill = showBaseline ? HEADER_DOCK_TOKENS.buttonText : HEADER_DOCK_TOKENS.buttonMuted;

        const buttonHeight = UI_TOKENS.height.standard;
        const buttonY = UI_TOKENS.spacing.sm;

        let tooltipText = showBaseline ? 'Hide baseline task bars' : 'Show baseline task bars';
        if (!isAvailable) {
            const hasRoles = this.currentState.boundFields.baselineStartBound && this.currentState.boundFields.baselineFinishBound;
            tooltipText = hasRoles 
                ? "All Baseline data values are empty" 
                : "Add Baseline Start Date and Baseline Finish Date data to enable";
        }

        const btn = this.upsertButton("baseline-toggle-group")
            .attr("type", "button")
            .attr("aria-label", `${showBaseline ? 'Hide' : 'Show'} baseline task bars`)
            .attr("title", tooltipText)
            .attr("aria-pressed", showBaseline.toString())
            .attr("aria-disabled", (!isAvailable).toString())
            .property("disabled", !isAvailable)
            .classed("header-toggle-button", true)
            .classed("is-disabled", !isAvailable)
            .style("opacity", isAvailable ? "1" : "0.45")
            .style("position", "absolute")
            .style("left", `${buttonX}px`)
            .style("top", `${buttonY}px`)
            .style("width", `${buttonWidth}px`)
            .style("height", `${buttonHeight}px`)
            .style("padding", "0")
            .style("box-sizing", "border-box")
            .style("display", "flex")
            .style("align-items", "center")
            .style("border", "none")
            .style("background-color", "transparent")
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

        // Background Rect
        const bgRect = svg.append("rect")
            .attr("x", 0.5)
            .attr("y", 0.5)
            .attr("width", buttonWidth - 1)
            .attr("height", buttonHeight - 1)
            .attr("rx", UI_TOKENS.radius.medium)
            .attr("ry", UI_TOKENS.radius.medium)
            .attr("fill", buttonFill)
            .attr("stroke", buttonStroke)
            .attr("stroke-width", showBaseline ? 1.5 : 1);

        const iconX = iconOnly ? (buttonWidth / 2) : (UI_TOKENS.spacing.lg + 2);
        const iconY = buttonHeight / 2;

        const iconG = svg.append("g")
            .attr("transform", `translate(${iconX}, ${iconY})`);

        iconG.append("line")
            .attr("x1", -8)
            .attr("x2", 8)
            .attr("y1", 6)
            .attr("y2", 6)
            .attr("stroke", showBaseline ? baselineColor : UI_TOKENS.color.neutral.grey60)
            .attr("stroke-width", 2)
            .attr("stroke-linecap", "round");

        iconG.append("rect")
            .attr("x", -7)
            .attr("y", -1)
            .attr("width", 14)
            .attr("height", 4)
            .attr("rx", 1.8)
            .attr("ry", 1.8)
            .attr("fill", showBaseline ? baselineColor : UI_TOKENS.color.neutral.grey60)
            .style("opacity", showBaseline ? "1" : "0.7");

        iconG.append("text")
            .attr("x", 0)
            .attr("y", -5.8)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", "7px")
            .style("font-weight", "800")
            .style("fill", showBaseline ? HEADER_DOCK_TOKENS.buttonText : UI_TOKENS.color.neutral.grey60)
            .text("BL");

        if (!iconOnly) {
            svg.append("text")
                .attr("class", "toggle-text")
                .attr("x", iconX + 18)
                .attr("y", buttonHeight / 2)
                .attr("dominant-baseline", "central")
                .style("font-family", "Segoe UI, sans-serif")
                .style("font-size", `${UI_TOKENS.fontSize.md}px`)
                .style("fill", labelFill)
                .style("font-weight", showBaseline ? UI_TOKENS.fontWeight.semibold.toString() : UI_TOKENS.fontWeight.medium.toString())
                .text("Baseline");
        }



        let tooltipTextSvg = showBaseline ? "Hide baseline task bars" : "Show baseline task bars";
        if (!isAvailable) {
            const hasRoles = this.currentState.boundFields.baselineStartBound && this.currentState.boundFields.baselineFinishBound;
            tooltipTextSvg = hasRoles 
                ? "All Baseline data values are empty" 
                : "Add Baseline Start Date and Baseline Finish Date data to enable";
        }

        btn.append("title")
            .text(tooltipTextSvg);

        if (isAvailable) {
            btn.on("mouseover", function () {
                bgRect.attr("fill", hoverFill)
                    .attr("stroke", hoverStroke)
                    .attr("stroke-width", 2);
            })
                .on("mouseout", function () {
                    bgRect.attr("fill", buttonFill)
                        .attr("stroke", buttonStroke)
                        .attr("stroke-width", showBaseline ? 1.5 : 1);
                })
                .on("mousedown", function () {
                    select(this).style("transform", "scale(0.98)");
                })
                .on("mouseup", function () {
                    select(this).style("transform", "scale(1)");
                });
        }
    }

    private createOrUpdatePreviousUpdateToggleButton(): void {
        const layout = this.getHeaderButtonLayout(this.currentViewportWidth, this.currentSettings, this.currentState);
        const { x: buttonX, width: buttonWidth, iconOnly, visible } = layout.previousUpdate;

        if (!visible) {
            this.hideControl("previous-update-toggle-group");
            return;
        }

        const isAvailable = this.currentState.previousUpdateAvailable;
        const showPreviousUpdate = this.currentState.showPreviousUpdate;

        const previousUpdateColor = this.currentSettings.comparisonBars.previousUpdateColor.value.value;
        const buttonFill = HEADER_DOCK_TOKENS.buttonBg;
        const buttonStroke = showPreviousUpdate ? previousUpdateColor : HEADER_DOCK_TOKENS.buttonStroke;
        const hoverFill = HEADER_DOCK_TOKENS.buttonHoverBg;
        const hoverStroke = showPreviousUpdate ? previousUpdateColor : HEADER_DOCK_TOKENS.buttonHoverStroke;
        const labelFill = showPreviousUpdate ? HEADER_DOCK_TOKENS.buttonText : HEADER_DOCK_TOKENS.buttonMuted;

        const buttonHeight = UI_TOKENS.height.standard;
        const buttonY = UI_TOKENS.spacing.sm;

        let tooltipText = showPreviousUpdate ? 'Hide previous update task bars' : 'Show previous update task bars';
        if (!isAvailable) {
            const hasRoles = this.currentState.boundFields.previousUpdateStartBound && this.currentState.boundFields.previousUpdateFinishBound;
            tooltipText = hasRoles 
                ? "All Previous Update data values are empty" 
                : "Add Previous Update Start and Finish Date data to enable";
        }

        const btn = this.upsertButton("previous-update-toggle-group")
            .attr("type", "button")
            .attr("aria-label", `${showPreviousUpdate ? 'Hide' : 'Show'} previous update task bars`)
            .attr("title", tooltipText)
            .attr("aria-pressed", showPreviousUpdate.toString())
            .attr("aria-disabled", (!isAvailable).toString())
            .property("disabled", !isAvailable)
            .classed("header-toggle-button", true)
            .classed("is-disabled", !isAvailable)
            .style("opacity", isAvailable ? "1" : "0.45")
            .style("position", "absolute")
            .style("left", `${buttonX}px`)
            .style("top", `${buttonY}px`)
            .style("width", `${buttonWidth}px`)
            .style("height", `${buttonHeight}px`)
            .style("padding", "0")
            .style("box-sizing", "border-box")
            .style("display", "flex")
            .style("align-items", "center")
            .style("border", "none")
            .style("background-color", "transparent")
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

        // Background Rect
        const bgRect = svg.append("rect")
            .attr("x", 0.5)
            .attr("y", 0.5)
            .attr("width", buttonWidth - 1)
            .attr("height", buttonHeight - 1)
            .attr("rx", UI_TOKENS.radius.medium)
            .attr("ry", UI_TOKENS.radius.medium)
            .attr("fill", buttonFill)
            .attr("stroke", buttonStroke)
            .attr("stroke-width", showPreviousUpdate ? 1.5 : 1);

        const iconX = iconOnly ? (buttonWidth / 2) : (UI_TOKENS.spacing.lg + 2);
        const iconY = buttonHeight / 2;

        const iconG = svg.append("g")
            .attr("transform", `translate(${iconX}, ${iconY})`);

        iconG.append("path")
            .attr("d", "M-8,5.5 H6 M3,2.8 L6,5.5 L3,8.2")
            .attr("fill", "none")
            .attr("stroke", showPreviousUpdate ? previousUpdateColor : UI_TOKENS.color.neutral.grey60)
            .attr("stroke-width", 1.8)
            .attr("stroke-linecap", "round")
            .attr("stroke-linejoin", "round");

        iconG.append("rect")
            .attr("x", -7)
            .attr("y", -1)
            .attr("width", 14)
            .attr("height", 4)
            .attr("rx", 1.8)
            .attr("ry", 1.8)
            .attr("fill", showPreviousUpdate ? previousUpdateColor : UI_TOKENS.color.neutral.grey60)
            .style("opacity", showPreviousUpdate ? "1" : "0.7");

        iconG.append("text")
            .attr("x", 0)
            .attr("y", -5.8)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", "7px")
            .style("font-weight", "800")
            .style("fill", showPreviousUpdate ? HEADER_DOCK_TOKENS.buttonText : UI_TOKENS.color.neutral.grey60)
            .text("PV");

        if (!iconOnly) {
            svg.append("text")
                .attr("class", "toggle-text")
                .attr("x", iconX + 18)
                .attr("y", buttonHeight / 2)
                .attr("dominant-baseline", "central")
                .style("font-family", "Segoe UI, sans-serif")
                .style("font-size", `${UI_TOKENS.fontSize.md}px`)
                .style("fill", labelFill)
                .style("font-weight", showPreviousUpdate ? UI_TOKENS.fontWeight.semibold.toString() : UI_TOKENS.fontWeight.medium.toString())
                .text("Prev. Update");
        }



        let tooltipTextSvg = showPreviousUpdate ? "Hide previous update task bars" : "Show previous update task bars";
        if (!isAvailable) {
            const hasRoles = this.currentState.boundFields.previousUpdateStartBound && this.currentState.boundFields.previousUpdateFinishBound;
            tooltipTextSvg = hasRoles 
                ? "All Previous Update data values are empty" 
                : "Add Previous Update Start and Finish Date data to enable";
        }

        btn.append("title")
            .text(tooltipTextSvg);

        if (isAvailable) {
            btn.on("mouseover", function () {
                bgRect.attr("fill", hoverFill)
                    .attr("stroke", hoverStroke)
                    .attr("stroke-width", 2);
            })
                .on("mouseout", function () {
                    bgRect.attr("fill", buttonFill)
                        .attr("stroke", buttonStroke)
                        .attr("stroke-width", showPreviousUpdate ? 1.5 : 1);
                })
                .on("mousedown", function () {
                    select(this).style("transform", "scale(0.98)");
                })
                .on("mouseup", function () {
                    select(this).style("transform", "scale(1)");
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

    private getBaseRightReserved(mode: 'wide' | 'medium' | 'narrow' | 'compact' | 'very-narrow'): number {
        if (mode === 'very-narrow') return 60;
        if (mode === 'compact') return 100;
        if (mode === 'narrow') return 150;
        return 260;
    }

    private shouldInlineFloatThreshold(viewportWidth: number, state: HeaderState): boolean {
        return shouldInlineHeaderFloatThreshold(viewportWidth, state.currentMode, state.showNearCritical);
    }

    private getTopRightControlWidthBudget(
        viewportWidth: number,
        state: HeaderState
    ): { maxWidth: number; mode: 'wide' | 'medium' | 'narrow' | 'compact' | 'very-narrow' } {
        const mode = this.getExtendedLayoutMode(viewportWidth);

        if (this.shouldInlineFloatThreshold(viewportWidth, state)) {
            const maxWidth = mode === 'very-narrow'
                ? 118
                : mode === 'compact'
                    ? 126
                    : mode === 'narrow'
                        ? 144
                        : mode === 'medium'
                            ? 156
                            : 170;

            return { maxWidth, mode };
        }

        if (state.showPathInfoChip) {
            const maxWidth = mode === 'very-narrow'
                ? 136
                : mode === 'compact'
                    ? 150
                    : mode === 'narrow'
                        ? 176
                        : mode === 'medium'
                            ? 210
                            : 232;

            return { maxWidth, mode };
        }

        return { maxWidth: this.getBaseRightReserved(mode), mode };
    }

    /**
     * Returns button dimensions and positions based on current layout mode
     */
    private getHeaderButtonLayout(viewportWidth: number, settings: VisualSettings, state: HeaderState): HeaderButtonLayout {
        if (
            this.currentLayout &&
            viewportWidth === this.currentViewportWidth &&
            settings === this.currentSettings &&
            state === this.currentState
        ) {
            return this.currentLayout;
        }

        const desiredControls: HeaderDesiredControls = {
            lookAhead: true,
            floatThreshold: state.currentMode === "floatBased" && state.showNearCritical,
            baseline: true,
            previousUpdate: true,
            connectorLines: settings.connectorLines?.showConnectorToggle?.value ?? false,
            columns: settings.columns?.showColumnToggleButton?.value ?? true,
            wbsEnable: state.wbsDataExists && (settings.wbsGrouping?.showWbsToggle?.value ?? true),
            wbsExpand: state.wbsDataExists && state.wbsEnabled,
            wbsCollapse: state.wbsDataExists && state.wbsEnabled,
            copyButton: true,
            htmlExportButton: settings.generalSettings?.showExportButton?.value ?? true,
            exportButton: settings.generalSettings?.showExportButton?.value ?? true,
            helpButton: true
        };

        return computeHeaderButtonLayout({
            viewportWidth,
            currentMode: state.currentMode,
            showNearCritical: state.showNearCritical,
            showPathInfoChip: state.showPathInfoChip,
            lookAheadActive: Math.max(0, Math.round(state.lookAheadWindowDays || 0)) > 0,
            desiredControls
        });
    }

    private createConnectorLinesToggleButton(): void {
        const showConnectorToggle = this.currentSettings?.connectorLines?.showConnectorToggle?.value ?? false;
        if (!showConnectorToggle) {
            this.hideControl("connector-toggle-group");
            return;
        }

        const layout = this.getHeaderButtonLayout(this.currentViewportWidth, this.currentSettings, this.currentState);
        const { x: buttonX, size: buttonSize, visible } = layout.connectorLines;

        if (!visible) {
            this.hideControl("connector-toggle-group");
            return;
        }

        const buttonY = UI_TOKENS.spacing.sm;
        const showConnectorLines = this.currentState.showConnectorLines;
        const buttonFill = showConnectorLines ? HEADER_DOCK_TOKENS.successBg : HEADER_DOCK_TOKENS.buttonBg;
        const buttonStroke = showConnectorLines ? HEADER_DOCK_TOKENS.success : HEADER_DOCK_TOKENS.buttonStroke;
        const hoverFill = showConnectorLines ? this.lightenColor(HEADER_DOCK_TOKENS.successBg, 0.12) : HEADER_DOCK_TOKENS.buttonHoverBg;
        const hoverStroke = showConnectorLines ? HEADER_DOCK_TOKENS.success : HEADER_DOCK_TOKENS.buttonHoverStroke;

        const btn = this.upsertButton("connector-toggle-group")
            .attr("type", "button")
            .attr("aria-label", `${showConnectorLines ? 'Hide' : 'Show'} connector lines between tasks`)
            .attr("title", showConnectorLines ? "Click to hide connector lines between dependent tasks" : "Click to show connector lines between dependent tasks")
            .attr("aria-pressed", showConnectorLines.toString())
            .classed("header-toggle-button", true)
            .style("position", "absolute")
            .style("left", `${buttonX}px`)
            .style("top", `${buttonY}px`)
            .style("width", `${buttonSize}px`) // Square button
            .style("height", `${buttonSize}px`)
            .style("padding", "0")
            .style("box-sizing", "border-box")
            .style("display", "flex")
            .style("align-items", "center")
            .style("justify-content", "center")
            .style("border", "none")
            .style("background-color", "transparent")
            .style("border-radius", `${UI_TOKENS.radius.medium}px`)
            .on("click", (event) => {
                event.stopPropagation();
                this.callbacks.onToggleConnectorLines();
            });

        const svg = btn.append("svg")
            .attr("width", buttonSize)
            .attr("height", buttonSize)
            .style("pointer-events", "none")
            .style("position", "absolute")
            .style("top", "0")
            .style("left", "0");

        // Background Rect
        const bgRect = svg.append("rect")
            .attr("class", "copy-button-bg")
            .attr("x", 0.5)
            .attr("y", 0.5)
            .attr("width", buttonSize - 1)
            .attr("height", buttonSize - 1)
            .attr("rx", UI_TOKENS.radius.medium)
            .attr("ry", UI_TOKENS.radius.medium)
            .attr("fill", buttonFill)
            .attr("stroke", buttonStroke)
            .attr("stroke-width", showConnectorLines ? 1.5 : 1);

        const iconColor = showConnectorLines ? HEADER_DOCK_TOKENS.buttonText : HEADER_DOCK_TOKENS.buttonMuted;
        const iconG = svg.append("g")
            .attr("transform", `translate(${buttonSize / 2}, ${buttonSize / 2})`);

        this.drawConnectorDependencyGlyph(iconG, iconColor, showConnectorLines);

        btn.append("title")
            .text(showConnectorLines
                ? "Click to hide connector lines between dependent tasks"
                : "Click to show connector lines between dependent tasks");

        btn.on("mouseover", function () {
            bgRect.attr("fill", hoverFill)
                .attr("stroke", hoverStroke)
                .attr("stroke-width", 2);
            iconG.selectAll<SVGElement, unknown>(".glyph-fill").attr("fill", HEADER_DOCK_TOKENS.buttonText);
            iconG.selectAll<SVGElement, unknown>(".glyph-stroke").attr("stroke", HEADER_DOCK_TOKENS.buttonText);
        })
            .on("mouseout", function () {
                bgRect.attr("fill", buttonFill)
                    .attr("stroke", buttonStroke)
                    .attr("stroke-width", showConnectorLines ? 1.5 : 1);
                iconG.selectAll<SVGElement, unknown>(".glyph-fill").attr("fill", iconColor);
                iconG.selectAll<SVGElement, unknown>(".glyph-stroke").attr("stroke", iconColor);
            })
            .on("mousedown", function () {
                select(this).style("transform", "scale(0.95)");
            })
            .on("mouseup", function () {
                select(this).style("transform", "scale(1)");
            });
    }

    private createWbsExpandCycleToggleButton(): void {
        const wbsEnabled = this.currentState.wbsDataExists && this.currentSettings?.wbsGrouping?.enableWbsGrouping?.value;
        const showWbsToggle = this.currentSettings?.wbsGrouping?.showWbsToggle?.value ?? true;
        if (!wbsEnabled || !showWbsToggle) {
            this.hideControl("wbs-expand-toggle-group");
            return;
        }

        const layout = this.getHeaderButtonLayout(this.currentViewportWidth, this.currentSettings, this.currentState);
        const { x: buttonX, size: buttonSize, visible } = layout.wbsExpandToggle;

        if (!visible) {
            this.hideControl("wbs-expand-toggle-group");
            return;
        }

        const isCustom = this.currentState.wbsManualExpansionOverride;
        const currentLevel = this.currentState.wbsExpandToLevel ?? 0;
        const wbsExpanded = this.currentState.wbsExpanded;

        const buttonY = UI_TOKENS.spacing.sm;
        const buttonFill = wbsExpanded ? HEADER_DOCK_TOKENS.primaryBg : HEADER_DOCK_TOKENS.buttonBg;
        const buttonStroke = wbsExpanded ? HEADER_DOCK_TOKENS.primary : HEADER_DOCK_TOKENS.buttonStroke;
        const hoverFill = wbsExpanded ? this.lightenColor(HEADER_DOCK_TOKENS.primaryBg, 0.12) : HEADER_DOCK_TOKENS.buttonHoverBg;
        const hoverStroke = wbsExpanded ? HEADER_DOCK_TOKENS.primary : HEADER_DOCK_TOKENS.buttonHoverStroke;
        const iconColor = wbsExpanded ? HEADER_DOCK_TOKENS.buttonText : HEADER_DOCK_TOKENS.buttonMuted;

        const btn = this.upsertButton("wbs-expand-toggle-group")
            .attr("type", "button")
            .attr("aria-label", isCustom
                ? "Custom (manual overrides). Click to expand and clear overrides"
                : `Level ${currentLevel} (click to expand)`)
            .attr("title", isCustom
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
            .style("box-sizing", "border-box")
            .style("display", "flex")
            .style("align-items", "center")
            .style("justify-content", "center")
            .style("border", "none")
            .style("background-color", "transparent")
            .style("border-radius", `${UI_TOKENS.radius.medium}px`)
            .on("click", (event) => {
                event.stopPropagation();
                this.callbacks.onToggleWbsExpand();
            });

        const svg = btn.append("svg")
            .attr("width", buttonSize)
            .attr("height", buttonSize)
            .style("pointer-events", "none")
            .style("position", "absolute")
            .style("top", "0")
            .style("left", "0");

        // Background Rect
        const bgRect = svg.append("rect")
            .attr("x", 0.5)
            .attr("y", 0.5)
            .attr("width", buttonSize - 1)
            .attr("height", buttonSize - 1)
            .attr("rx", UI_TOKENS.radius.medium)
            .attr("ry", UI_TOKENS.radius.medium)
            .attr("fill", buttonFill)
            .attr("stroke", buttonStroke)
            .attr("stroke-width", wbsExpanded ? 1.5 : 1);

        const iconG = svg.append("g")
            .attr("transform", `translate(${buttonSize / 2}, ${(buttonSize / 2) - 4})`);

        this.drawWbsHierarchyGlyph(iconG, iconColor, "tree", "plus");

        const badgeText = isCustom ? "C" : `L${currentLevel}`;

        const textEl = svg.append("text")
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

        btn.on("mouseover", function () {
            bgRect.attr("fill", hoverFill)
                .attr("stroke", hoverStroke)
                .attr("stroke-width", 2);
            iconG.selectAll<SVGElement, unknown>(".glyph-fill").attr("fill", HEADER_DOCK_TOKENS.buttonText);
            iconG.selectAll<SVGElement, unknown>(".glyph-stroke").attr("stroke", HEADER_DOCK_TOKENS.buttonText);
            textEl.style("fill", HEADER_DOCK_TOKENS.buttonText);
        }).on("mouseout", function () {
            bgRect.attr("fill", buttonFill)
                .attr("stroke", buttonStroke)
                .attr("stroke-width", wbsExpanded ? 1.5 : 1);
            iconG.selectAll<SVGElement, unknown>(".glyph-fill").attr("fill", iconColor);
            iconG.selectAll<SVGElement, unknown>(".glyph-stroke").attr("stroke", iconColor);
            textEl.style("fill", iconColor);
        });
    }

    private createWbsCollapseCycleToggleButton(): void {
        const wbsEnabled = this.currentState.wbsDataExists && this.currentSettings?.wbsGrouping?.enableWbsGrouping?.value;
        const showWbsToggle = this.currentSettings?.wbsGrouping?.showWbsToggle?.value ?? true;
        if (!wbsEnabled || !showWbsToggle) {
            this.hideControl("wbs-collapse-toggle-group");
            return;
        }

        const layout = this.getHeaderButtonLayout(this.currentViewportWidth, this.currentSettings, this.currentState);
        const { x: buttonX, size: buttonSize, visible } = layout.wbsCollapseToggle;

        if (!visible) {
            this.hideControl("wbs-collapse-toggle-group");
            return;
        }

        const isCustom = this.currentState.wbsManualExpansionOverride;
        const currentLevel = this.currentState.wbsExpandToLevel ?? 0;
        const isCollapsed = currentLevel === 0 || !this.currentState.wbsExpanded; // Logic approx

        const buttonY = UI_TOKENS.spacing.sm;
        const buttonFill = isCollapsed ? HEADER_DOCK_TOKENS.primaryBg : HEADER_DOCK_TOKENS.buttonBg;
        const buttonStroke = isCollapsed ? HEADER_DOCK_TOKENS.primary : HEADER_DOCK_TOKENS.buttonStroke;
        const hoverFill = isCollapsed ? this.lightenColor(HEADER_DOCK_TOKENS.primaryBg, 0.12) : HEADER_DOCK_TOKENS.buttonHoverBg;
        const hoverStroke = isCollapsed ? HEADER_DOCK_TOKENS.primary : HEADER_DOCK_TOKENS.buttonHoverStroke;
        const iconColor = isCollapsed ? HEADER_DOCK_TOKENS.buttonText : HEADER_DOCK_TOKENS.buttonMuted;

        const btn = this.upsertButton("wbs-collapse-toggle-group")
            .attr("type", "button")
            .attr("aria-label", isCustom
                ? "Custom (manual overrides). Click to collapse and clear overrides"
                : `Level ${currentLevel} (click to collapse)`)
            .attr("title", isCustom
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
            .style("box-sizing", "border-box")
            .style("display", "flex")
            .style("align-items", "center")
            .style("justify-content", "center")
            .style("border", "none")
            .style("background-color", "transparent")
            .style("border-radius", `${UI_TOKENS.radius.medium}px`)
            .on("click", (event) => {
                event.stopPropagation();
                this.callbacks.onToggleWbsCollapse();
            });

        const svg = btn.append("svg")
            .attr("width", buttonSize)
            .attr("height", buttonSize)
            .style("pointer-events", "none")
            .style("position", "absolute")
            .style("top", "0")
            .style("left", "0");

        // Background Rect
        const bgRect = svg.append("rect")
            .attr("x", 0.5)
            .attr("y", 0.5)
            .attr("width", buttonSize - 1)
            .attr("height", buttonSize - 1)
            .attr("rx", UI_TOKENS.radius.medium)
            .attr("ry", UI_TOKENS.radius.medium)
            .attr("fill", buttonFill)
            .attr("stroke", buttonStroke)
            .attr("stroke-width", isCollapsed ? 1.5 : 1);

        const iconG = svg.append("g")
            .attr("transform", `translate(${buttonSize / 2}, ${(buttonSize / 2) - 4})`);

        this.drawWbsHierarchyGlyph(iconG, iconColor, "tree", "minus");

        const badgeText = isCustom ? "C" : `L${currentLevel}`;

        const textEl = svg.append("text")
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

        btn.on("mouseover", function () {
            bgRect.attr("fill", hoverFill)
                .attr("stroke", hoverStroke)
                .attr("stroke-width", 2);
            iconG.selectAll<SVGElement, unknown>(".glyph-fill").attr("fill", HEADER_DOCK_TOKENS.buttonText);
            iconG.selectAll<SVGElement, unknown>(".glyph-stroke").attr("stroke", HEADER_DOCK_TOKENS.buttonText);
            textEl.style("fill", HEADER_DOCK_TOKENS.buttonText);
        }).on("mouseout", function () {
            bgRect.attr("fill", buttonFill)
                .attr("stroke", buttonStroke)
                .attr("stroke-width", isCollapsed ? 1.5 : 1);
            iconG.selectAll<SVGElement, unknown>(".glyph-fill").attr("fill", iconColor);
            iconG.selectAll<SVGElement, unknown>(".glyph-stroke").attr("stroke", iconColor);
            textEl.style("fill", iconColor);
        });
    }

    private createFloatThresholdControl(): void {
        const currentMode = this.currentSettings?.criticalPath?.calculationMode?.value?.value || 'longestPath';
        const isFloatBased = currentMode === 'floatBased';

        if (!this.currentState.showNearCritical || !isFloatBased || !this.shouldInlineFloatThreshold(this.currentViewportWidth, this.currentState)) {
            this.hideControl("float-threshold-wrapper");
            return;
        }

        const effectiveWidth = this.currentViewportWidth;
        const { maxWidth, mode: layoutMode } = this.getTopRightControlWidthBudget(effectiveWidth, this.currentState);
        const isCompact = layoutMode === 'narrow' || layoutMode === 'compact' || layoutMode === 'very-narrow';
        const isMedium = layoutMode === 'medium';
        const isVeryCompact = layoutMode === 'compact' || layoutMode === 'very-narrow';
        const isCompressed = maxWidth <= 144 || isCompact || effectiveWidth < 780;
        const labelText = isVeryCompact ? "Near ≤" : "Near-Crit ≤";
        const inputWidth = isVeryCompact ? 34 : (isCompressed ? 38 : (isMedium ? 42 : 44));
        const showDaysText = !isVeryCompact && !isCompressed;
        const showHelpIcon = layoutMode === 'wide' && maxWidth >= 170;
        const iconSize = isVeryCompact ? 10 : 12;

        const controlContainer = this.upsertDiv("float-threshold-wrapper")
            .attr("role", "group")
            .attr("aria-label", "Near-critical threshold setting")
            .attr("title", "Tasks with Total Float less than or equal to this value will be highlighted as Near-Critical.")
            .style("position", "absolute")
            .style("right", "10px")
            .style("top", "6px")
            .style("display", "flex")
            .style("align-items", "center")
            .style("gap", isCompressed ? "3px" : "4px")
            .style("height", "24px")
            .style("padding", isVeryCompact ? "0 6px" : "0 8px")
            .style("max-width", `${maxWidth}px`)
            .style("background-color", HEADER_DOCK_TOKENS.chipBg)
            .style("border", `1px solid ${HEADER_DOCK_TOKENS.warning}`)
            .style("border-radius", "12px")
            .style("box-shadow", HEADER_DOCK_TOKENS.shadow)
            .style("transition", `all ${UI_TOKENS.motion.duration.normal}ms ${UI_TOKENS.motion.easing.smooth}`);

        const labelContainer = controlContainer.append("div")
            .style("display", "flex")
            .style("align-items", "center")
            .style("gap", `${UI_TOKENS.spacing.xs}px`);

        const iconSvg = labelContainer.append("svg")
            .attr("width", iconSize)
            .attr("height", iconSize)
            .attr("viewBox", `0 0 ${iconSize} ${iconSize}`)
            .style("flex-shrink", "0");

        iconSvg.append("circle")
            .attr("cx", iconSize / 2)
            .attr("cy", iconSize / 2)
            .attr("r", iconSize / 2)
            .attr("fill", HEADER_DOCK_TOKENS.warning);

        labelContainer.append("span")
            .style("font-size", "11px")
            .style("letter-spacing", "0.1px")
            .style("color", HEADER_DOCK_TOKENS.chipText)
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-weight", UI_TOKENS.fontWeight.medium)
            .style("white-space", "nowrap")
            .text(labelText);

        controlContainer.append("input")
            .attr("type", "number")
            .attr("min", "0")
            .attr("step", "1")
            .attr("value", this.currentState.floatThreshold)
            .attr("aria-label", "Near-critical threshold in days")
            .attr("title", "Tasks with Total Float less than or equal to this value will be highlighted as Near-Critical.")
            .style("width", `${inputWidth}px`)
            .style("height", "18px")
            .style("padding", "0 4px")
            .style("border", `1px solid ${HEADER_DOCK_TOKENS.inputStroke}`)
            .style("border-radius", "4px")
            .style("font-size", "11px")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-weight", UI_TOKENS.fontWeight.semibold)
            .style("text-align", "center")
            .style("color", HEADER_DOCK_TOKENS.chipText)
            .style("background-color", HEADER_DOCK_TOKENS.inputBg)
            .style("outline", "none")
            .on("focus", function () {
                select(this)
                    .style("border", `1px solid ${HEADER_DOCK_TOKENS.inputFocus}`)
                    .style("box-shadow", `0 0 0 2px ${HEADER_DOCK_TOKENS.primaryBg}`);
            })
            .on("blur", function () {
                select(this)
                    .style("border", `1px solid ${HEADER_DOCK_TOKENS.inputStroke}`)
                    .style("box-shadow", "none");
            })
            .on("change", (event) => {
                const val = parseInt((event.target as HTMLInputElement).value, 10);
                if (!isNaN(val) && val >= 0) {
                    this.callbacks.onFloatThresholdChanged(val);
                }
            });

        if (showDaysText) {
            controlContainer.append("span")
                .style("font-size", "11px")
                .style("color", HEADER_DOCK_TOKENS.chipMuted)
                .style("font-family", "Segoe UI, sans-serif")
                .text("days");
        }

        if (showHelpIcon) {
            const helpContainer = controlContainer.append("div")
                .style("display", "flex")
                .style("align-items", "center")
                .style("cursor", "help")
                .attr("role", "img")
                .attr("aria-label", "Help: Tasks with Total Float less than or equal to this value will be highlighted as Near-Critical.")
                .attr("title", "Tasks with Total Float less than or equal to this value will be highlighted as Near-Critical.");

            const helpIconSize = 14;
            const helpSvg = helpContainer.append("svg")
                .attr("width", helpIconSize)
                .attr("height", helpIconSize)
                .attr("viewBox", "0 0 16 16")
                .style("fill", HEADER_DOCK_TOKENS.chipMuted);

            helpSvg.append("path")
                .attr("d", "M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm.93 11v1H6.93v-1h2zm-2.97-2.65c0-1.4.67-1.85 1.54-2.28.6-.3.83-.53.83-.97 0-.48-.44-.87-1.42-.87-.82 0-1.28.32-1.57.57l-.87-1.05c.5-.5 1.34-1.02 2.76-1.02 1.93 0 2.9 1.15 2.9 2.22 0 1.25-.66 1.7-1.48 2.12-.66.33-.87.6-.87 1.15v.13h-1.81z");
        }

    }

    private createModeToggleButton(): void {
        const currentMode = this.currentState.currentMode;
        const isFloatBased = currentMode === 'floatBased';
        const modeStatusMessage = this.currentState.modeStatusMessage?.trim() || "";
        const modeWarningMessage = this.currentState.modeWarningMessage?.trim() || "";
        const hasModeWarning = modeWarningMessage.length > 0;

        const layout = this.getHeaderButtonLayout(this.currentViewportWidth, this.currentSettings, this.currentState);
        const { x: buttonX, width: buttonWidth, visible } = layout.modeToggle;

        if (!visible) {
            this.hideControl("mode-toggle-group");
            return;
        }

        const buttonHeight = UI_TOKENS.height.standard;
        const buttonY = UI_TOKENS.spacing.sm;

        const bgColor = HEADER_DOCK_TOKENS.buttonBg;
        const borderColor = hasModeWarning
            ? HEADER_DOCK_TOKENS.warning
            : (isFloatBased ? HEADER_DOCK_TOKENS.warning : HEADER_DOCK_TOKENS.primary);
        const activeFill = isFloatBased ? HEADER_DOCK_TOKENS.warning : HEADER_DOCK_TOKENS.primary;
        const modeDetails = [modeStatusMessage, modeWarningMessage].filter(Boolean).join(" ");
        const modeTitle = `Switch calculation mode. Currently: ${isFloatBased ? 'Float-Based' : 'Longest Path'}${modeDetails ? `. ${modeDetails}` : ""}`;

        const btn = this.upsertButton("mode-toggle-group")
            .attr("type", "button")
            .attr("aria-label", modeTitle)
            .attr("title", modeTitle)
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
            .style("box-sizing", "border-box")
            .style("border", "none")
            .style("background-color", "transparent")
            .style("border-radius", `${UI_TOKENS.radius.pill}px`)
            .on("click", (event) => {
                event.stopPropagation();
                this.callbacks.onToggleMode();
            });

        // SVG content
        const svg = btn.append("svg")
            .attr("width", buttonWidth)
            .attr("height", buttonHeight)
            .style("pointer-events", "none")
            .style("position", "absolute")
            .style("top", "0")
            .style("left", "0");

        if (buttonWidth < 80) {
            // Compact Mode: Show simple icon/text
            const iconG = svg.append("g")
                .attr("transform", `translate(${buttonWidth / 2}, ${buttonHeight / 2})`);

            // Background circle/rounded rect for state indication
            const bgCompact = iconG.append("rect")
                .attr("x", -12)
                .attr("y", -10)
                .attr("width", 24)
                .attr("height", 20)
                .attr("rx", 6)
                .attr("fill", activeFill)
                .attr("stroke", "none");

            // Text code (LP or FL)
            iconG.append("text")
                .attr("text-anchor", "middle")
                .attr("dominant-baseline", "central")
                .attr("y", 1)
                .style("font-family", "Segoe UI, sans-serif")
                .style("font-size", "10px")
                .style("font-weight", "bold")
                .style("fill", UI_TOKENS.color.neutral.white)
                .text(isFloatBased ? "FL" : "LP");

            // Hover effects
            btn.on("mouseover", function () {
                bgCompact.attr("opacity", 0.9); // Slight dim on hover
            })
                .on("mouseout", function () {
                    bgCompact.attr("opacity", 1);
                });

        } else {
            // Wide/Medium Mode: Pill Toggle using SVG
            // Outer Border/Background Rect
            const bgRect = svg.append("rect")
                .attr("x", 0.5)
                .attr("y", 0.5)
                .attr("width", buttonWidth - 1)
                .attr("height", buttonHeight - 1)
                .attr("rx", UI_TOKENS.radius.pill)
                .attr("ry", UI_TOKENS.radius.pill)
                .attr("fill", bgColor)
                .attr("stroke", borderColor)
                .attr("stroke-width", hasModeWarning ? 1.5 : 1);

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
                .style("fill", HEADER_DOCK_TOKENS.groupBg)
                .style("opacity", 0.8);

            pillG.append("rect")
                .attr("x", pillX)
                .attr("y", -pillHeight / 2)
                .attr("width", pillWidth / 2)
                .attr("height", pillHeight)
                .attr("rx", UI_TOKENS.radius.large)
                .attr("ry", UI_TOKENS.radius.large)
                .style("fill", activeFill)
                .style("transition", `all ${UI_TOKENS.motion.duration.slow}ms ${UI_TOKENS.motion.easing.smooth}`);

            pillG.append("text")
                .attr("x", pillWidth / 4)
                .attr("y", 0)
                .attr("text-anchor", "middle")
                .attr("dominant-baseline", "central")
                .style("font-family", "Segoe UI, sans-serif")
                .style("font-size", `${UI_TOKENS.fontSize.md}px`)
                .style("font-weight", isFloatBased ? UI_TOKENS.fontWeight.medium : UI_TOKENS.fontWeight.bold)
                .style("fill", isFloatBased ? HEADER_DOCK_TOKENS.buttonMuted : HEADER_DOCK_TOKENS.buttonText)
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
                .style("fill", isFloatBased ? HEADER_DOCK_TOKENS.buttonText : HEADER_DOCK_TOKENS.buttonMuted)
                .style("pointer-events", "none")
                .text("Float");

            // Hover effects
            btn.on("mouseover", function () {
                bgRect.attr("stroke-width", 2);
            })
                .on("mouseout", function () {
                    bgRect.attr("stroke-width", hasModeWarning ? 1.5 : 1);
                });
        }

        if (hasModeWarning) {
            const badgeRadius = buttonWidth < 80 ? 5.5 : 6.5;
            const badgeCx = buttonWidth - (buttonWidth < 80 ? 8 : 10);
            const badgeCy = buttonWidth < 80 ? 8 : 9;
            const badge = svg.append("g")
                .attr("transform", `translate(${badgeCx}, ${badgeCy})`);

            badge.append("circle")
                .attr("r", badgeRadius)
                .attr("fill", HEADER_DOCK_TOKENS.warning)
                .attr("stroke", HEADER_DOCK_TOKENS.shell)
                .attr("stroke-width", 1.2);

            badge.append("text")
                .attr("text-anchor", "middle")
                .attr("dominant-baseline", "central")
                .attr("y", 0.6)
                .style("font-family", "Segoe UI, sans-serif")
                .style("font-size", buttonWidth < 80 ? "8px" : "9px")
                .style("font-weight", "800")
                .style("fill", UI_TOKENS.color.neutral.white)
                .style("pointer-events", "none")
                .text("!");
        }
    }

    private createLookAheadControl(): void {
        const layout = this.getHeaderButtonLayout(this.currentViewportWidth, this.currentSettings, this.currentState);
        const { x: controlX, width: controlWidth, visible } = layout.lookAhead;

        if (!visible) {
            this.hideControl("look-ahead-control-wrapper");
            return;
        }

        const controlHeight = UI_TOKENS.height.standard;
        const controlY = UI_TOKENS.spacing.sm;
        const activeDays = Math.max(0, Math.round(this.currentState.lookAheadWindowDays || 0));
        const isActive = activeDays > 0;
        const isAvailable = this.currentState.lookAheadAvailable;
        const displayModeText = this.currentState.lookAheadDisplayMode === "highlight" ? "highlight" : "filter";
        const title = isAvailable
            ? `Look-ahead ${displayModeText}. Select a window from the data date.`
            : "Look-ahead requires a Data Date.";
        const borderColor = isActive ? HEADER_DOCK_TOKENS.primary : HEADER_DOCK_TOKENS.buttonStroke;
        const backgroundColor = isActive ? HEADER_DOCK_TOKENS.primaryBg : HEADER_DOCK_TOKENS.buttonBg;
        const labelColor = isActive ? HEADER_DOCK_TOKENS.buttonText : HEADER_DOCK_TOKENS.buttonMuted;
        const isCompact = controlWidth < 76;
        const selectWidth = isCompact ? Math.max(42, controlWidth - 10) : Math.max(46, controlWidth - 33);

        const options = getLookAheadOptions(activeDays);

        const wrapper = this.upsertDiv("look-ahead-control-wrapper")
            .attr("role", "group")
            .attr("aria-label", `Look-ahead ${displayModeText} window: ${activeDays > 0 ? `${activeDays} days` : "Off"}`)
            .attr("title", title)
            .style("position", "absolute")
            .style("left", `${controlX}px`)
            .style("top", `${controlY}px`)
            .style("width", `${controlWidth}px`)
            .style("height", `${controlHeight}px`)
            .style("display", "flex")
            .style("align-items", "center")
            .style("gap", isCompact ? "2px" : "4px")
            .style("box-sizing", "border-box")
            .style("padding", isCompact ? "0 4px" : "0 5px")
            .style("background-color", backgroundColor)
            .style("border", `1px solid ${borderColor}`)
            .style("border-radius", `${UI_TOKENS.radius.medium}px`)
            .style("opacity", isAvailable ? "1" : "0.5")
            .style("box-shadow", isActive ? HEADER_DOCK_TOKENS.shadow : "none");

        if (!isCompact) {
            wrapper.append("span")
                .style("font-family", "Segoe UI, sans-serif")
                .style("font-size", `${UI_TOKENS.fontSize.sm}px`)
                .style("font-weight", UI_TOKENS.fontWeight.semibold)
                .style("color", labelColor)
                .style("white-space", "nowrap")
                .style("line-height", "1")
                .text("LA");
        }

        const selectEl = wrapper.append("select")
            .attr("aria-label", "Look-ahead window")
            .attr("title", title)
            .property("disabled", !isAvailable)
            .style("width", `${selectWidth}px`)
            .style("height", "22px")
            .style("min-width", "0")
            .style("border", "none")
            .style("outline", "none")
            .style("border-radius", "4px")
            .style("padding", isCompact ? "0 14px 0 2px" : "0 16px 0 3px")
            .style("appearance", "none")
            .style("-webkit-appearance", "none")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", LOOK_AHEAD_SELECT_FONT_SIZE)
            .style("font-weight", UI_TOKENS.fontWeight.semibold)
            .style("line-height", "1")
            .style("text-align-last", "left")
            .style("color", HEADER_DOCK_TOKENS.buttonText)
            .style("background-color", isActive ? HEADER_DOCK_TOKENS.primaryBg : HEADER_DOCK_TOKENS.inputBg)
            .style("cursor", isAvailable ? "pointer" : "not-allowed")
            .on("click", event => event.stopPropagation())
            .on("change", (event) => {
                event.stopPropagation();
                const value = parseInt((event.target as HTMLSelectElement).value, 10);
                this.callbacks.onLookAheadWindowChanged(Number.isFinite(value) ? value : 0);
            });

        wrapper.append("span")
            .attr("aria-hidden", "true")
            .style("position", "absolute")
            .style("right", isCompact ? "7px" : "8px")
            .style("top", "50%")
            .style("transform", "translateY(-52%)")
            .style("width", "0")
            .style("height", "0")
            .style("border-left", "4px solid transparent")
            .style("border-right", "4px solid transparent")
            .style("border-top", `5px solid ${isAvailable ? HEADER_DOCK_TOKENS.buttonText : HEADER_DOCK_TOKENS.buttonMuted}`)
            .style("pointer-events", "none");

        selectEl.selectAll("option")
            .data(options)
            .enter()
            .append("option")
            .attr("value", option => String(option.value))
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", LOOK_AHEAD_SELECT_FONT_SIZE)
            .style("font-weight", UI_TOKENS.fontWeight.semibold)
            .style("line-height", LOOK_AHEAD_OPTION_LINE_HEIGHT)
            .text(option => option.label);

        selectEl.property("value", String(activeDays));
    }

    private createColumnDisplayToggleButton(): void {
        const layout = this.getHeaderButtonLayout(this.currentViewportWidth, this.currentSettings, this.currentState);
        const { x: buttonX, size: buttonSize, visible } = layout.colToggle;

        if (!visible) {
            this.hideControl("column-toggle-group");
            return;
        }

        const showColumns = this.currentState.showExtraColumns;
        const buttonY = UI_TOKENS.spacing.sm;
        const buttonFill = showColumns ? HEADER_DOCK_TOKENS.primaryBg : HEADER_DOCK_TOKENS.buttonBg;
        const buttonStroke = showColumns ? HEADER_DOCK_TOKENS.primary : HEADER_DOCK_TOKENS.buttonStroke;
        const hoverFill = showColumns ? this.lightenColor(HEADER_DOCK_TOKENS.primaryBg, 0.12) : HEADER_DOCK_TOKENS.buttonHoverBg;
        const hoverStroke = showColumns ? HEADER_DOCK_TOKENS.primary : HEADER_DOCK_TOKENS.buttonHoverStroke;
        const iconColor = showColumns ? HEADER_DOCK_TOKENS.buttonText : HEADER_DOCK_TOKENS.buttonMuted;

        const btn = this.upsertButton("column-toggle-group")
            .attr("type", "button")
            .attr("aria-label", showColumns ? "Hide data columns" : "Show data columns")
            .attr("title", showColumns ? "Hide data columns" : "Show data columns")
            .attr("aria-pressed", showColumns.toString())
            .classed("header-toggle-button", true)
            .style("position", "absolute")
            .style("left", `${buttonX}px`)
            .style("top", `${buttonY}px`)
            .style("width", `${buttonSize}px`)
            .style("height", `${buttonSize}px`)
            .style("padding", "0")
            .style("box-sizing", "border-box")
            .style("display", "flex")
            .style("align-items", "center")
            .style("justify-content", "center")
            .style("border", "none")
            .style("background-color", "transparent")
            .style("border-radius", `${UI_TOKENS.radius.medium}px`)
            .on("click", (event) => {
                event.stopPropagation();
                this.callbacks.onToggleColumns();
            });

        const svg = btn.append("svg")
            .attr("width", buttonSize)
            .attr("height", buttonSize)
            .style("pointer-events", "none")
            .style("position", "absolute")
            .style("top", "0")
            .style("left", "0");

        // Background Rect
        const bgRect = svg.append("rect")
            .attr("x", 0.5)
            .attr("y", 0.5)
            .attr("width", buttonSize - 1)
            .attr("height", buttonSize - 1)
            .attr("rx", UI_TOKENS.radius.medium)
            .attr("ry", UI_TOKENS.radius.medium)
            .attr("fill", buttonFill)
            .attr("stroke", buttonStroke)
            .attr("stroke-width", showColumns ? 1.5 : 1);

        const iconG = svg.append("g")
            .attr("transform", `translate(${buttonSize / 2}, ${buttonSize / 2})`);

        this.drawColumnVisibilityGlyph(iconG, iconColor, showColumns);

        btn.on("mouseover", function () {
            bgRect.attr("fill", hoverFill)
                .attr("stroke", hoverStroke)
                .attr("stroke-width", 2);
            iconG.selectAll<SVGElement, unknown>(".glyph-fill").attr("fill", HEADER_DOCK_TOKENS.buttonText);
            iconG.selectAll<SVGElement, unknown>(".glyph-stroke").attr("stroke", HEADER_DOCK_TOKENS.buttonText);
        })
            .on("mouseout", function () {
                bgRect.attr("fill", buttonFill)
                    .attr("stroke", buttonStroke)
                    .attr("stroke-width", showColumns ? 1.5 : 1);
                iconG.selectAll<SVGElement, unknown>(".glyph-fill").attr("fill", iconColor);
                iconG.selectAll<SVGElement, unknown>(".glyph-stroke").attr("stroke", iconColor);
            });
    }

    private createWbsEnableToggleButton(): void {
        if (!this.currentState.wbsDataExists) {
            this.hideControl("wbs-enable-toggle-group");
            return;
        }

        const isEnabled = this.currentState.wbsEnabled;
        const layout = this.getHeaderButtonLayout(this.currentViewportWidth, this.currentSettings, this.currentState);
        const { x: buttonX, width: buttonWidth, visible } = layout.wbsEnable;

        if (!visible) {
            this.hideControl("wbs-enable-toggle-group");
            return;
        }

        const buttonHeight = UI_TOKENS.height.standard;
        const buttonY = UI_TOKENS.spacing.sm;
        const buttonFill = isEnabled ? HEADER_DOCK_TOKENS.primaryBg : HEADER_DOCK_TOKENS.buttonBg;
        const buttonStroke = isEnabled ? HEADER_DOCK_TOKENS.primary : HEADER_DOCK_TOKENS.buttonStroke;
        const hoverFill = isEnabled ? this.lightenColor(HEADER_DOCK_TOKENS.primaryBg, 0.12) : HEADER_DOCK_TOKENS.buttonHoverBg;
        const hoverStroke = isEnabled ? HEADER_DOCK_TOKENS.primary : HEADER_DOCK_TOKENS.buttonHoverStroke;
        const wbsColor = isEnabled ? HEADER_DOCK_TOKENS.buttonText : HEADER_DOCK_TOKENS.buttonMuted;

        const btn = this.upsertButton("wbs-enable-toggle-group")
            .attr("type", "button")
            .attr("aria-label", isEnabled ? "Disable WBS Grouping" : "Enable WBS Grouping")
            .attr("title", isEnabled ? "Disable WBS Grouping" : "Enable WBS Grouping")
            .attr("aria-pressed", isEnabled.toString())
            .classed("header-toggle-button", true)
            .style("position", "absolute")
            .style("left", `${buttonX}px`)
            .style("top", `${buttonY}px`)
            .style("width", `${buttonWidth}px`)
            .style("height", `${buttonHeight}px`)
            .style("padding", "0")
            .style("box-sizing", "border-box")
            .style("display", "flex")
            .style("align-items", "center")
            .style("justify-content", "center")
            .style("border", "none")
            .style("background-color", "transparent")
            .style("border-radius", `${UI_TOKENS.radius.medium}px`)
            .style("cursor", "pointer")
            .on("click", (event) => {
                event.stopPropagation();
                this.callbacks.onToggleWbsEnable();
            });

        const svg = btn.append("svg")
            .attr("width", buttonWidth)
            .attr("height", buttonHeight)
            .style("pointer-events", "none")
            .style("position", "absolute")
            .style("top", "0")
            .style("left", "0");

        // Background Rect
        const bgRect = svg.append("rect")
            .attr("x", 0.5)
            .attr("y", 0.5)
            .attr("width", buttonWidth - 1)
            .attr("height", buttonHeight - 1)
            .attr("rx", UI_TOKENS.radius.medium)
            .attr("ry", UI_TOKENS.radius.medium)
            .attr("fill", buttonFill)
            .attr("stroke", buttonStroke)
            .attr("stroke-width", isEnabled ? 1.5 : 1);

        const iconG = svg.append("g")
            .attr("transform", `translate(${buttonWidth / 2}, ${buttonHeight / 2})`);

        this.drawWbsHierarchyGlyph(iconG, wbsColor, isEnabled ? "tree" : "flat");

        btn.append("title")
            .text(isEnabled ? "Disable WBS Grouping" : "Enable WBS Grouping");

        btn.on("mouseover", function () {
            bgRect.attr("fill", hoverFill)
                .attr("stroke", hoverStroke)
                .attr("stroke-width", 2);
            iconG.selectAll<SVGElement, unknown>(".glyph-fill").attr("fill", HEADER_DOCK_TOKENS.buttonText);
            iconG.selectAll<SVGElement, unknown>(".glyph-stroke").attr("stroke", HEADER_DOCK_TOKENS.buttonText);
        })
            .on("mouseout", function () {
                bgRect.attr("fill", buttonFill)
                    .attr("stroke", buttonStroke)
                    .attr("stroke-width", isEnabled ? 1.5 : 1);
                iconG.selectAll<SVGElement, unknown>(".glyph-fill").attr("fill", wbsColor);
                iconG.selectAll<SVGElement, unknown>(".glyph-stroke").attr("stroke", wbsColor);
            });
    }

    private createCopyButton(): void {
        const layout = this.getHeaderButtonLayout(this.currentViewportWidth, this.currentSettings, this.currentState);
        const { x: buttonX, size: buttonSize, visible } = layout.copyButton;

        if (!visible) {
            this.hideControl("copy-data-button-group");
            return;
        }

        const buttonY = UI_TOKENS.spacing.sm;
        const buttonFill = HEADER_DOCK_TOKENS.buttonBg;
        const buttonStroke = HEADER_DOCK_TOKENS.buttonStroke;
        const hoverFill = HEADER_DOCK_TOKENS.buttonHoverBg;
        const hoverStroke = HEADER_DOCK_TOKENS.buttonHoverStroke;

        const btn = this.upsertButton("copy-data-button-group")
            .attr("type", "button")
            .attr("aria-label", "Copy data to clipboard")
            .attr("title", "Copy data to clipboard")
            .classed("header-toggle-button", true)
            .style("position", "absolute")
            .style("left", `${buttonX}px`)
            .style("top", `${buttonY}px`)
            .style("width", `${buttonSize}px`)
            .style("height", `${buttonSize}px`)
            .style("padding", "0")
            .style("box-sizing", "border-box")
            .style("display", "flex")
            .style("align-items", "center")
            .style("justify-content", "center")
            .style("border", "none")
            .style("background-color", "transparent")
            .style("border-radius", `${UI_TOKENS.radius.medium}px`)
            .style("cursor", "pointer")
            .on("click", (event) => {
                event.stopPropagation();
                this.callbacks.onCopy();
            });

        const svg = btn.append("svg")
            .attr("width", buttonSize)
            .attr("height", buttonSize)
            .style("pointer-events", "none")
            .style("position", "absolute")
            .style("top", "0")
            .style("left", "0");

        // Background Rect
        const bgRect = svg.append("rect")
            .attr("x", 0.5)
            .attr("y", 0.5)
            .attr("width", buttonSize - 1)
            .attr("height", buttonSize - 1)
            .attr("rx", UI_TOKENS.radius.medium)
            .attr("ry", UI_TOKENS.radius.medium)
            .attr("fill", buttonFill)
            .attr("stroke", buttonStroke)
            .attr("stroke-width", 1);

        const iconG = svg.append('g')
            .attr('transform', `translate(${buttonSize / 2}, ${buttonSize / 2})`);

        iconG.append('path')
            .attr('d', 'M-4,1 L-4,5 L4,5 L4,-3 L0,-3 M0,-7 L6,-7 L6,1 L0,1 L0,-7 Z')
            .attr('fill', 'none')
            .attr('stroke', HEADER_DOCK_TOKENS.buttonMuted)
            .attr('stroke-width', 1.5)
            .attr('stroke-linecap', 'round')
            .attr('stroke-linejoin', 'round');

        btn.on("mouseover", function () {
            bgRect.attr("fill", hoverFill)
                .attr("stroke", hoverStroke);
            iconG.select("path").attr("stroke", HEADER_DOCK_TOKENS.buttonText);
        })
            .on("mouseout", function () {
                bgRect.attr("fill", buttonFill)
                    .attr("stroke", buttonStroke);
                iconG.select("path").attr("stroke", HEADER_DOCK_TOKENS.buttonMuted);
            });
    }

    private createExportButton(): void {
        const layout = this.getHeaderButtonLayout(this.currentViewportWidth, this.currentSettings, this.currentState);
        const { x: buttonX, size: buttonSize, visible } = layout.exportButton;

        if (!visible) {
            this.hideControl("export-button-group");
            return;
        }

        const buttonY = UI_TOKENS.spacing.sm;
        const buttonFill = this.exportButtonLoading ? HEADER_DOCK_TOKENS.primaryBg : HEADER_DOCK_TOKENS.buttonBg;
        const buttonStroke = this.exportButtonLoading ? HEADER_DOCK_TOKENS.primary : HEADER_DOCK_TOKENS.buttonStroke;
        const hoverFill = HEADER_DOCK_TOKENS.buttonHoverBg;
        const hoverStroke = HEADER_DOCK_TOKENS.buttonHoverStroke;

        const btn = this.upsertButton("export-button-group")
            .attr("type", "button")
            .attr("aria-label", "Export visual as PDF")
            .attr("title", "Export visual as PDF")
            .attr("aria-busy", this.exportButtonLoading ? "true" : "false")
            .classed("header-toggle-button", true)
            .style("position", "absolute")
            .style("left", `${buttonX}px`)
            .style("top", `${buttonY}px`)
            .style("width", `${buttonSize}px`)
            .style("height", `${buttonSize}px`)
            .style("padding", "0")
            .style("box-sizing", "border-box")
            .style("display", "flex")
            .style("align-items", "center")
            .style("justify-content", "center")
            .style("border", "none")
            .style("background-color", "transparent")
            .style("border-radius", `${UI_TOKENS.radius.medium}px`)
            .style("cursor", this.exportButtonLoading ? "wait" : "pointer")
            .property("disabled", this.exportButtonLoading)
            .on("click", (event) => {
                event.stopPropagation();
                if (this.exportButtonLoading) {
                    return;
                }
                this.callbacks.onExport();
            });

        const svg = btn.append("svg")
            .attr("class", "export-icon-svg")
            .attr("width", buttonSize)
            .attr("height", buttonSize)
            .style("pointer-events", "none")
            .style("position", "absolute")
            .style("top", "0")
            .style("left", "0");

        // Background Rect
        const bgRect = svg.append("rect")
            .attr("class", "export-button-bg")
            .attr("x", 0.5)
            .attr("y", 0.5)
            .attr("width", buttonSize - 1)
            .attr("height", buttonSize - 1)
            .attr("rx", UI_TOKENS.radius.medium)
            .attr("ry", UI_TOKENS.radius.medium)
            .attr("fill", buttonFill)
            .attr("stroke", buttonStroke)
            .attr("stroke-width", 1);

        const iconG = svg.append('g')
            .attr('class', 'export-icon-g')
            .attr('transform', `translate(${buttonSize / 2}, ${buttonSize / 2})`);

        iconG.append('path')
            .attr('class', 'export-icon-path')
            .attr('d', 'M-5,-7 L-5,7 L5,7 L5,-3 L1,-7 Z')
            .attr('fill', 'none')
            .attr('stroke', HEADER_DOCK_TOKENS.buttonMuted)
            .attr('stroke-width', 1.5)
            .attr('stroke-linecap', 'round')
            .attr('stroke-linejoin', 'round')
            .style('display', this.exportButtonLoading ? 'none' : 'block');

        const spinner = iconG.append('g')
            .attr('class', 'export-spinner')
            .style('display', this.exportButtonLoading ? 'block' : 'none');

        spinner.append('circle')
            .attr('r', 6)
            .attr('fill', 'none')
            .attr('stroke', HEADER_DOCK_TOKENS.buttonText)
            .attr('stroke-width', 2)
            .attr('stroke-dasharray', '20 10')
            .attr('stroke-linecap', 'round');

        btn.on("mouseover", () => {
            if (this.exportButtonLoading) {
                return;
            }
            bgRect.attr("fill", hoverFill)
                .attr("stroke", hoverStroke);
            iconG.select<SVGPathElement>(".export-icon-path")
                .attr("stroke", HEADER_DOCK_TOKENS.buttonText);
        })
            .on("mouseout", () => {
                bgRect.attr("fill", buttonFill)
                    .attr("stroke", buttonStroke);
                iconG.select<SVGPathElement>(".export-icon-path")
                    .attr("stroke", HEADER_DOCK_TOKENS.buttonMuted);
            });
    }

    private createExportHtmlButton(): void {
        const layout = this.getHeaderButtonLayout(this.currentViewportWidth, this.currentSettings, this.currentState);
        const { x: buttonX, size: buttonSize, visible } = layout.htmlExportButton;

        if (!visible) {
            this.hideControl("export-html-button-group");
            return;
        }

        const buttonY = UI_TOKENS.spacing.sm;
        const buttonFill = HEADER_DOCK_TOKENS.buttonBg;
        const buttonStroke = HEADER_DOCK_TOKENS.buttonStroke;
        const hoverFill = HEADER_DOCK_TOKENS.buttonHoverBg;
        const hoverStroke = HEADER_DOCK_TOKENS.buttonHoverStroke;

        const btn = this.upsertButton("export-html-button-group")
            .attr("type", "button")
            .attr("aria-label", "Copy HTML export to clipboard")
            .attr("title", "Copy HTML export to clipboard")
            .classed("header-toggle-button", true)
            .style("position", "absolute")
            .style("left", `${buttonX}px`)
            .style("top", `${buttonY}px`)
            .style("width", `${buttonSize}px`)
            .style("height", `${buttonSize}px`)
            .style("padding", "0")
            .style("box-sizing", "border-box")
            .style("display", "flex")
            .style("align-items", "center")
            .style("justify-content", "center")
            .style("border", "none")
            .style("background-color", "transparent")
            .style("border-radius", `${UI_TOKENS.radius.medium}px`)
            .style("cursor", "pointer")
            .on("click", (event) => {
                event.stopPropagation();
                this.callbacks.onExportHtml();
            });

        const svg = btn.append("svg")
            .attr("width", buttonSize)
            .attr("height", buttonSize)
            .style("pointer-events", "none")
            .style("position", "absolute")
            .style("top", "0")
            .style("left", "0");

        const bgRect = svg.append("rect")
            .attr("class", "copy-button-bg")
            .attr("x", 0.5)
            .attr("y", 0.5)
            .attr("width", buttonSize - 1)
            .attr("height", buttonSize - 1)
            .attr("rx", UI_TOKENS.radius.medium)
            .attr("ry", UI_TOKENS.radius.medium)
            .attr("fill", buttonFill)
            .attr("stroke", buttonStroke)
            .attr("stroke-width", 1);

        const iconG = svg.append('g')
            .attr('transform', `translate(${buttonSize / 2}, ${buttonSize / 2})`);

        iconG.append('path')
            .attr('d', 'M-6,-7 L2,-7 L6,-3 L6,7 L-6,7 Z M2,-7 L2,-3 L6,-3')
            .attr('fill', 'none')
            .attr('stroke', HEADER_DOCK_TOKENS.buttonMuted)
            .attr('stroke-width', 1.2)
            .attr('stroke-linecap', 'round')
            .attr('stroke-linejoin', 'round');

        iconG.append('text')
            .attr('x', 0)
            .attr('y', 2)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .style('font-family', 'Segoe UI, sans-serif')
            .style('font-size', '7px')
            .style('font-weight', '700')
            .style('fill', HEADER_DOCK_TOKENS.buttonMuted)
            .text('HTML');

        btn.on("mouseover", function () {
            bgRect.attr("fill", hoverFill)
                .attr("stroke", hoverStroke);
            iconG.select("path").attr("stroke", HEADER_DOCK_TOKENS.buttonText);
            iconG.select("text").style("fill", HEADER_DOCK_TOKENS.buttonText);
        })
            .on("mouseout", function () {
                bgRect.attr("fill", buttonFill)
                    .attr("stroke", buttonStroke);
                iconG.select("path").attr("stroke", HEADER_DOCK_TOKENS.buttonMuted);
                iconG.select("text").style("fill", HEADER_DOCK_TOKENS.buttonMuted);
            });
    }

    private createHelpButton(): void {
        const layout = this.getHeaderButtonLayout(this.currentViewportWidth, this.currentSettings, this.currentState);
        const { x: buttonX, size: buttonSize, visible } = layout.helpButton;

        if (!visible) {
            this.hideControl("help-button-group");
            return;
        }

        const buttonY = UI_TOKENS.spacing.sm;
        const buttonFill = HEADER_DOCK_TOKENS.buttonBg;
        const buttonStroke = HEADER_DOCK_TOKENS.buttonStroke;
        const hoverFill = HEADER_DOCK_TOKENS.buttonHoverBg;
        const hoverStroke = HEADER_DOCK_TOKENS.buttonHoverStroke;

        const btn = this.upsertButton("help-button-group")
            .attr("type", "button")
            .attr("aria-label", "Show help information")
            .attr("title", "Show help information")
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
            .style("pointer-events", "none")
            .style("position", "absolute")
            .style("top", "0")
            .style("left", "0");

        svg.append("rect")
            .attr("class", "help-button-bg")
            .attr("x", 0.5)
            .attr("y", 0.5)
            .attr("width", buttonSize - 1)
            .attr("height", buttonSize - 1)
            .attr("rx", UI_TOKENS.radius.medium)
            .attr("ry", UI_TOKENS.radius.medium)
            .style("fill", buttonFill)
            .style("stroke", buttonStroke)
            .style("stroke-width", 1.5);

        svg.append('text')
            .attr('x', buttonSize / 2)
            .attr('y', buttonSize / 2 + 1)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', "central")
            .style('font-family', "Segoe UI, sans-serif")
            .style('font-size', `${UI_TOKENS.fontSize.md}px`)
            .style('font-weight', UI_TOKENS.fontWeight.bold)
            .style('fill', HEADER_DOCK_TOKENS.buttonMuted)
            .text("?");

        btn.on("mouseover", function () {
            select(this).select<SVGRectElement>(".help-button-bg")
                .style("fill", hoverFill)
                .style("stroke", hoverStroke);
            select(this).select("text")
                .style("fill", HEADER_DOCK_TOKENS.buttonText);
        })
            .on("mouseout", function () {
                select(this).select<SVGRectElement>(".help-button-bg")
                    .style("fill", buttonFill)
                    .style("stroke", buttonStroke);
                select(this).select("text")
                    .style("fill", HEADER_DOCK_TOKENS.buttonMuted);
            });
    }

    private attachOverflowOutsideClickHandler(): void {
        if (this.overflowDocumentPointerDownHandler) {
            return;
        }

        this.overflowDocumentPointerDownHandler = (event: PointerEvent) => {
            const target = event.target as Node | null;
            const menuNode = this.container.select<HTMLDivElement>(`#${this.overflowMenuId}`).node();
            const buttonNode = this.container.select<HTMLButtonElement>("button.action-overflow-button-group").node();

            if (!target || menuNode?.contains(target) || buttonNode?.contains(target)) {
                return;
            }

            this.closeControlsMenu(false);
        };

        document.addEventListener("pointerdown", this.overflowDocumentPointerDownHandler, true);
    }

    private detachOverflowOutsideClickHandler(): void {
        if (!this.overflowDocumentPointerDownHandler) {
            return;
        }

        document.removeEventListener("pointerdown", this.overflowDocumentPointerDownHandler, true);
        this.overflowDocumentPointerDownHandler = null;
    }

    private closeControlsMenu(returnFocus: boolean = true): void {
        this.controlsMenuOpen = false;
        this.detachOverflowOutsideClickHandler();

        this.container.select<HTMLDivElement>("div.action-overflow-menu")
            .style("display", "none");

        const button = this.container.select<HTMLButtonElement>("button.action-overflow-button-group")
            .attr("aria-expanded", "false");

        if (returnFocus) {
            button.node()?.focus();
        }
    }

    private focusFirstOverflowMenuItem(): void {
        this.getOverflowFocusableItems()[0]?.focus();
    }

    private focusOverflowMenuItem(direction: 1 | -1): void {
        const items = this.getOverflowFocusableItems();
        if (items.length === 0) {
            return;
        }

        const activeElement = document.activeElement as HTMLElement | null;
        const currentIndex = activeElement ? items.indexOf(activeElement) : -1;
        const nextIndex = currentIndex === -1
            ? (direction > 0 ? 0 : items.length - 1)
            : (currentIndex + direction + items.length) % items.length;

        items[nextIndex]?.focus();
    }

    private getOverflowFocusableItems(): HTMLElement[] {
        const menuNode = this.container.select<HTMLDivElement>(`#${this.overflowMenuId}`).node();
        if (!menuNode) {
            return [];
        }

        return Array.from(menuNode.querySelectorAll<HTMLElement>(
            "button:not([disabled]), select:not([disabled]), input:not([disabled])"
        )).filter(item => item.getAttribute("aria-hidden") !== "true");
    }

    private handleOverflowMenuKeydown(event: KeyboardEvent): void {
        if (event.key === "Escape") {
            event.preventDefault();
            this.closeControlsMenu(true);
            return;
        }

        const tagName = (event.target as HTMLElement | null)?.tagName?.toLowerCase();
        if (tagName === "select" || tagName === "input" || tagName === "textarea") {
            return;
        }

        if (event.key === "ArrowDown") {
            event.preventDefault();
            this.focusOverflowMenuItem(1);
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            this.focusOverflowMenuItem(-1);
        }
    }

    private createActionOverflowButton(): void {
        const layout = this.getHeaderButtonLayout(this.currentViewportWidth, this.currentSettings, this.currentState);
        const { x: buttonX, size: buttonSize, visible, hiddenActions } = layout.actionOverflowButton;

        if (!visible || hiddenActions.length === 0) {
            this.hideControl("action-overflow-button-group");
            this.closeControlsMenu(false);
            return;
        }

        const buttonY = UI_TOKENS.spacing.sm;
        const buttonFill = HEADER_DOCK_TOKENS.buttonBg;
        const buttonStroke = HEADER_DOCK_TOKENS.buttonStroke;
        const hoverFill = HEADER_DOCK_TOKENS.buttonHoverBg;
        const hoverStroke = HEADER_DOCK_TOKENS.buttonHoverStroke;
        const activeHiddenCount = this.getActiveHiddenControlCount(hiddenActions);
        const title = `Controls and actions: ${this.getHeaderMenuItems(hiddenActions).map(item => item.label).join(", ")}`;

        const btn = this.upsertButton("action-overflow-button-group")
            .attr("type", "button")
            .attr("aria-label", title)
            .attr("title", title)
            .attr("aria-haspopup", "dialog")
            .attr("aria-expanded", String(this.controlsMenuOpen))
            .attr("aria-controls", this.overflowMenuId)
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
            .style("z-index", "45")
            .on("click", (event) => {
                event.stopPropagation();
                if (this.controlsMenuOpen) {
                    this.closeControlsMenu(true);
                    return;
                }

                this.controlsMenuOpen = true;
                this.renderActionOverflowMenu(buttonX, buttonSize, hiddenActions, true);
                this.attachOverflowOutsideClickHandler();
                this.applyHeaderPaletteOverrides();
                btn.attr("aria-expanded", "true");
            });

        const svg = btn.append("svg")
            .attr("width", buttonSize)
            .attr("height", buttonSize)
            .style("pointer-events", "none")
            .style("position", "absolute")
            .style("top", "0")
            .style("left", "0");

        svg.append("rect")
            .attr("class", "action-overflow-button-bg")
            .attr("x", 0.5)
            .attr("y", 0.5)
            .attr("width", buttonSize - 1)
            .attr("height", buttonSize - 1)
            .attr("rx", UI_TOKENS.radius.medium)
            .attr("ry", UI_TOKENS.radius.medium)
            .style("fill", buttonFill)
            .style("stroke", buttonStroke)
            .style("stroke-width", 1.5);

        const iconG = svg.append("g")
            .attr("class", "action-overflow-icon")
            .attr("transform", `translate(${buttonSize / 2}, ${buttonSize / 2})`);

        [-5, 0, 5].forEach((y, index) => {
            const knobX = index === 0 ? -3.5 : index === 1 ? 3.5 : -0.5;
            iconG.append("line")
                .attr("class", "action-overflow-line")
                .attr("x1", -7)
                .attr("x2", 7)
                .attr("y1", y)
                .attr("y2", y)
                .attr("stroke", HEADER_DOCK_TOKENS.buttonMuted)
                .attr("stroke-width", 1.4)
                .attr("stroke-linecap", "round");

            iconG.append("circle")
                .attr("class", "action-overflow-dot")
                .attr("cx", knobX)
                .attr("cy", y)
                .attr("r", 2)
                .style("fill", HEADER_DOCK_TOKENS.buttonMuted);
        });

        if (activeHiddenCount > 0) {
            svg.append("circle")
                .attr("class", "action-overflow-badge")
                .attr("cx", buttonSize - 7)
                .attr("cy", 7)
                .attr("r", 6)
                .attr("fill", HEADER_DOCK_TOKENS.warning)
                .attr("stroke", HEADER_DOCK_TOKENS.shell)
                .attr("stroke-width", 1);

            svg.append("text")
                .attr("class", "action-overflow-badge-text")
                .attr("x", buttonSize - 7)
                .attr("y", 7.6)
                .attr("text-anchor", "middle")
                .attr("dominant-baseline", "central")
                .style("font-family", "Segoe UI, sans-serif")
                .style("font-size", "8px")
                .style("font-weight", UI_TOKENS.fontWeight.bold)
                .style("fill", UI_TOKENS.color.neutral.white)
                .text(String(Math.min(activeHiddenCount, 9)));
        }

        btn.on("mouseover", function () {
            select(this).select<SVGRectElement>(".action-overflow-button-bg")
                .style("fill", hoverFill)
                .style("stroke", hoverStroke);
            select(this).selectAll<SVGCircleElement, unknown>(".action-overflow-dot")
                .style("fill", HEADER_DOCK_TOKENS.buttonText);
            select(this).selectAll<SVGLineElement, unknown>(".action-overflow-line")
                .style("stroke", HEADER_DOCK_TOKENS.buttonText);
        })
            .on("mouseout", function () {
                select(this).select<SVGRectElement>(".action-overflow-button-bg")
                    .style("fill", buttonFill)
                    .style("stroke", buttonStroke);
                select(this).selectAll<SVGCircleElement, unknown>(".action-overflow-dot")
                    .style("fill", HEADER_DOCK_TOKENS.buttonMuted);
                select(this).selectAll<SVGLineElement, unknown>(".action-overflow-line")
                    .style("stroke", HEADER_DOCK_TOKENS.buttonMuted);
            });

        this.renderActionOverflowMenu(buttonX, buttonSize, hiddenActions);
    }

    private getHeaderMenuItems(actions: HeaderMenuAction[]): HeaderMenuItem[] {
        const state = this.currentState;
        const allItems: Record<HeaderMenuAction, HeaderMenuItem> = {
            lookAhead: {
                id: "lookAhead",
                section: "Analysis",
                label: "Look-ahead",
                status: state.lookAheadWindowDays > 0 ? `${state.lookAheadWindowDays}d ${state.lookAheadDisplayMode}` : "Off",
                title: state.lookAheadAvailable ? "Choose the look-ahead window from the Data Date." : "Look-ahead requires a Data Date.",
                disabled: !state.lookAheadAvailable,
                kind: "select"
            },
            floatThreshold: {
                id: "floatThreshold",
                section: "Analysis",
                label: "Near-critical threshold",
                status: `${state.floatThreshold} days`,
                title: "Tasks with Total Float less than or equal to this value are near-critical.",
                kind: "number"
            },
            baseline: {
                id: "baseline",
                section: "Timeline Layers",
                label: "Baseline",
                status: state.showBaseline ? "On" : "Off",
                title: state.baselineAvailable ? "Show or hide baseline comparison bars." : "Baseline Start and Finish are not available.",
                disabled: !state.baselineAvailable,
                callback: this.callbacks.onToggleBaseline
            },
            previousUpdate: {
                id: "previousUpdate",
                section: "Timeline Layers",
                label: "Previous update",
                status: state.showPreviousUpdate ? "On" : "Off",
                title: state.previousUpdateAvailable ? "Show or hide previous update comparison bars." : "Previous Update Start and Finish are not available.",
                disabled: !state.previousUpdateAvailable,
                callback: this.callbacks.onTogglePreviousUpdate
            },
            connectorLines: {
                id: "connectorLines",
                section: "Timeline Layers",
                label: "Connector lines",
                status: state.showConnectorLines ? "On" : "Off",
                callback: this.callbacks.onToggleConnectorLines
            },
            columns: {
                id: "columns",
                section: "Timeline Layers",
                label: "Extra columns",
                status: state.showExtraColumns ? "Shown" : "Hidden",
                callback: this.callbacks.onToggleColumns
            },
            wbsEnable: {
                id: "wbsEnable",
                section: "WBS",
                label: "WBS grouping",
                status: state.wbsEnabled ? "On" : "Off",
                disabled: !state.wbsDataExists,
                callback: this.callbacks.onToggleWbsEnable
            },
            wbsExpand: {
                id: "wbsExpand",
                section: "WBS",
                label: "Expand WBS",
                status: state.wbsExpandToLevel && state.wbsExpandToLevel > 0 ? `To L${state.wbsExpandToLevel}` : "All",
                disabled: !state.wbsDataExists || !state.wbsEnabled,
                callback: this.callbacks.onToggleWbsExpand
            },
            wbsCollapse: {
                id: "wbsCollapse",
                section: "WBS",
                label: "Collapse WBS",
                status: state.wbsExpandToLevel && state.wbsExpandToLevel > 0 ? `To L${state.wbsExpandToLevel}` : "All",
                disabled: !state.wbsDataExists || !state.wbsEnabled,
                callback: this.callbacks.onToggleWbsCollapse
            },
            copy: { id: "copy", section: "Actions", label: "Copy data", callback: this.callbacks.onCopy },
            html: { id: "html", section: "Actions", label: "Copy HTML", title: "Copy formatted HTML export to the clipboard.", callback: this.callbacks.onExportHtml },
            pdf: { id: "pdf", section: "Actions", label: "Export PDF", callback: this.callbacks.onExport },
            help: { id: "help", section: "Actions", label: "Help", callback: this.callbacks.onHelp }
        };

        return actions.map(action => allItems[action]).filter(Boolean);
    }

    private getActiveHiddenControlCount(actions: HeaderMenuAction[]): number {
        return getActiveHiddenHeaderControlCount(actions, {
            lookAheadWindowDays: this.currentState.lookAheadWindowDays,
            showBaseline: this.currentState.showBaseline,
            showPreviousUpdate: this.currentState.showPreviousUpdate,
            showConnectorLines: this.currentState.showConnectorLines,
            showExtraColumns: this.currentState.showExtraColumns,
            wbsEnabled: this.currentState.wbsEnabled
        });
    }

    private renderActionOverflowMenu(
        buttonX: number,
        buttonSize: number,
        hiddenActions: HeaderMenuAction[],
        focusFirstItem: boolean = false
    ): void {
        const menu = this.upsertDiv("action-overflow-menu")
            .attr("id", this.overflowMenuId)
            .attr("role", "dialog")
            .attr("aria-label", "Visual controls and actions")
            .attr("aria-modal", "false")
            .on("click", event => event.stopPropagation())
            .on("keydown", (event: KeyboardEvent) => this.handleOverflowMenuKeydown(event));

        if (!this.controlsMenuOpen) {
            menu.style("display", "none");
            this.detachOverflowOutsideClickHandler();
            return;
        }

        const menuWidth = Math.min(286, Math.max(232, this.currentViewportWidth - 16));
        const menuLeft = Math.max(8, Math.min(buttonX, this.currentViewportWidth - menuWidth - 8));
        const items = this.getHeaderMenuItems(hiddenActions);
        const sections: HeaderMenuSection[] = ["Analysis", "Timeline Layers", "WBS", "Actions"];

        menu
            .style("position", "absolute")
            .style("left", `${menuLeft}px`)
            .style("top", `${UI_TOKENS.spacing.sm + buttonSize + 4}px`)
            .style("width", `${menuWidth}px`)
            .style("max-height", "320px")
            .style("overflow-y", "auto")
            .style("padding", "8px")
            .style("box-sizing", "border-box")
            .style("display", "flex")
            .style("flex-direction", "column")
            .style("gap", "6px")
            .style("background-color", HEADER_DOCK_TOKENS.chipBg)
            .style("border", `1px solid ${HEADER_DOCK_TOKENS.chipStroke}`)
            .style("border-radius", `${UI_TOKENS.radius.medium}px`)
            .style("box-shadow", HEADER_DOCK_TOKENS.shadow)
            .style("z-index", "70");

        sections.forEach(section => {
            const sectionItems = items.filter(item => item.section === section);
            if (sectionItems.length === 0) {
                return;
            }

            const sectionEl = menu.append("div")
                .attr("class", "action-overflow-menu-section")
                .style("display", "flex")
                .style("flex-direction", "column")
                .style("gap", "3px");

            sectionEl.append("div")
                .attr("class", "action-overflow-menu-section-title")
                .style("padding", "2px 6px 1px")
                .style("font-family", "Segoe UI, sans-serif")
                .style("font-size", "10px")
                .style("font-weight", UI_TOKENS.fontWeight.bold)
                .style("letter-spacing", "0.2px")
                .style("text-transform", "uppercase")
                .style("color", HEADER_DOCK_TOKENS.chipMuted)
                .text(section);

            sectionItems.forEach(item => this.renderHeaderMenuItem(sectionEl, item));
        });

        if (focusFirstItem) {
            window.setTimeout(() => this.focusFirstOverflowMenuItem(), 0);
        }
    }

    private renderHeaderMenuItem(
        sectionEl: Selection<HTMLDivElement, unknown, null, undefined>,
        item: HeaderMenuItem
    ): void {
        if (item.kind === "select") {
            this.renderLookAheadMenuItem(sectionEl, item);
            return;
        }

        if (item.kind === "number") {
            this.renderFloatThresholdMenuItem(sectionEl, item);
            return;
        }

        const button = sectionEl.append("button")
            .attr("class", "action-overflow-menu-item")
            .attr("type", "button")
            .attr("title", item.title ?? item.label)
            .property("disabled", !!item.disabled)
            .style("min-height", "30px")
            .style("padding", "0 8px")
            .style("border", "none")
            .style("border-radius", `${UI_TOKENS.radius.small}px`)
            .style("background", "transparent")
            .style("color", item.disabled ? HEADER_DOCK_TOKENS.chipMuted : HEADER_DOCK_TOKENS.buttonText)
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", "12px")
            .style("font-weight", "600")
            .style("text-align", "left")
            .style("cursor", item.disabled ? "not-allowed" : "pointer")
            .style("display", "grid")
            .style("grid-template-columns", "1fr auto")
            .style("align-items", "center")
            .style("gap", "10px")
            .on("mouseover", function () {
                if (!item.disabled) {
                    select(this).style("background-color", HEADER_DOCK_TOKENS.buttonHoverBg);
                }
            })
            .on("mouseout", function () {
                select(this).style("background-color", "transparent");
            })
            .on("click", (event) => {
                event.stopPropagation();
                if (item.disabled || !item.callback) {
                    return;
                }

                this.closeControlsMenu(true);
                item.callback();
            });

        button.append("span")
            .style("white-space", "nowrap")
            .style("overflow", "hidden")
            .style("text-overflow", "ellipsis")
            .text(item.label);

        if (item.status) {
            button.append("span")
                .style("font-size", "11px")
                .style("font-weight", UI_TOKENS.fontWeight.semibold)
                .style("color", item.disabled ? HEADER_DOCK_TOKENS.chipMuted : HEADER_DOCK_TOKENS.warningText)
                .style("white-space", "nowrap")
                .text(item.status);
        }
    }

    private renderLookAheadMenuItem(
        sectionEl: Selection<HTMLDivElement, unknown, null, undefined>,
        item: HeaderMenuItem
    ): void {
        const activeDays = Math.max(0, Math.round(this.currentState.lookAheadWindowDays || 0));
        const row = sectionEl.append("div")
            .attr("class", "action-overflow-menu-item action-overflow-menu-field")
            .attr("title", item.title ?? item.label)
            .style("min-height", "32px")
            .style("padding", "0 8px")
            .style("border-radius", `${UI_TOKENS.radius.small}px`)
            .style("display", "grid")
            .style("grid-template-columns", "1fr 88px")
            .style("align-items", "center")
            .style("gap", "8px");

        row.append("span")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", "12px")
            .style("font-weight", UI_TOKENS.fontWeight.semibold)
            .style("color", item.disabled ? HEADER_DOCK_TOKENS.chipMuted : HEADER_DOCK_TOKENS.buttonText)
            .text(item.label);

        const selectEl = row.append("select")
            .attr("aria-label", "Look-ahead window")
            .property("disabled", !!item.disabled)
            .style("height", "24px")
            .style("min-width", "0")
            .style("border", `1px solid ${HEADER_DOCK_TOKENS.inputStroke}`)
            .style("border-radius", "4px")
            .style("padding", "0 4px")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", LOOK_AHEAD_SELECT_FONT_SIZE)
            .style("font-weight", UI_TOKENS.fontWeight.semibold)
            .style("line-height", "1")
            .style("text-align-last", "left")
            .style("color", HEADER_DOCK_TOKENS.buttonText)
            .style("background-color", HEADER_DOCK_TOKENS.inputBg)
            .style("cursor", item.disabled ? "not-allowed" : "pointer")
            .on("change", (event) => {
                event.stopPropagation();
                const value = parseInt((event.target as HTMLSelectElement).value, 10);
                this.closeControlsMenu(true);
                this.callbacks.onLookAheadWindowChanged(Number.isFinite(value) ? value : 0);
            });

        selectEl.selectAll("option")
            .data(getLookAheadOptions(activeDays))
            .enter()
            .append("option")
            .attr("value", option => String(option.value))
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", LOOK_AHEAD_SELECT_FONT_SIZE)
            .style("font-weight", UI_TOKENS.fontWeight.semibold)
            .style("line-height", LOOK_AHEAD_OPTION_LINE_HEIGHT)
            .text(option => option.label);

        selectEl.property("value", String(activeDays));
    }

    private renderFloatThresholdMenuItem(
        sectionEl: Selection<HTMLDivElement, unknown, null, undefined>,
        item: HeaderMenuItem
    ): void {
        const row = sectionEl.append("div")
            .attr("class", "action-overflow-menu-item action-overflow-menu-field")
            .attr("title", item.title ?? item.label)
            .style("min-height", "32px")
            .style("padding", "0 8px")
            .style("border-radius", `${UI_TOKENS.radius.small}px`)
            .style("display", "grid")
            .style("grid-template-columns", "1fr 64px")
            .style("align-items", "center")
            .style("gap", "8px");

        row.append("span")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", "12px")
            .style("font-weight", UI_TOKENS.fontWeight.semibold)
            .style("color", HEADER_DOCK_TOKENS.buttonText)
            .text(item.label);

        row.append("input")
            .attr("type", "number")
            .attr("min", "0")
            .attr("step", "1")
            .attr("aria-label", "Near-critical threshold in days")
            .attr("value", this.currentState.floatThreshold)
            .style("height", "24px")
            .style("width", "58px")
            .style("padding", "0 4px")
            .style("border", `1px solid ${HEADER_DOCK_TOKENS.inputStroke}`)
            .style("border-radius", "4px")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", "12px")
            .style("font-weight", UI_TOKENS.fontWeight.semibold)
            .style("text-align", "center")
            .style("color", HEADER_DOCK_TOKENS.buttonText)
            .style("background-color", HEADER_DOCK_TOKENS.inputBg)
            .on("change", (event) => {
                event.stopPropagation();
                const value = parseFloat((event.target as HTMLInputElement).value);
                if (Number.isFinite(value) && value >= 0) {
                    this.closeControlsMenu(true);
                    this.callbacks.onFloatThresholdChanged(value);
                }
            });
    }
}
