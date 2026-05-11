
import { select, Selection } from "d3-selection";
import { VisualSettings } from "../settings";
import { UI_TOKENS, LAYOUT_BREAKPOINTS, HEADER_DOCK_TOKENS } from "../utils/Theme";
import { BoundFieldState } from "../data/Interfaces";
import { getProgressLineReferenceLabel } from "../utils/ProgressLine";
import type { ProgressLineReference } from "../utils/ProgressLine";
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
    onToggleProgressLine: () => void;
    onProgressLineReferenceChanged: (reference: ProgressLineReference) => void;
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
    progressLineVisible: boolean;
    progressLineAvailable: boolean;
    progressLineReference: ProgressLineReference;
    progressLineBaselineAvailable: boolean;
    progressLinePreviousUpdateAvailable: boolean;
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
    kind?: "button" | "options" | "number" | "progressLine";
    callback?: () => void;
}

export type HeaderPalette = Partial<typeof HEADER_DOCK_TOKENS> & {
    isHighContrast?: boolean;
    usesCustomColours?: boolean;
};

const LOOK_AHEAD_SELECT_FONT_SIZE = `${UI_TOKENS.fontSize.sm}px`;
const LOOK_AHEAD_OPTION_LINE_HEIGHT = "1.2";
const LOOK_AHEAD_OPTION_ROW_HEIGHT = 22;

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
    private readonly lookAheadListboxId: string;
    private overflowDocumentPointerDownHandler: ((event: PointerEvent) => void) | null = null;
    private lookAheadDropdownOpen: boolean = false;
    private lookAheadDropdownActiveIndex: number = 0;
    private lookAheadDocumentPointerDownHandler: ((event: PointerEvent) => void) | null = null;

    // Button Selections
    private toggleButtonGroup!: Selection<SVGGElement, unknown, null, undefined>;

    // Temporary storage for render cycle
    private currentSettings!: VisualSettings;
    private currentState!: HeaderState;
    private currentViewportWidth!: number;

    constructor(container: Selection<HTMLDivElement, unknown, null, undefined>, callbacks: HeaderCallbacks) {
        this.container = container;
        this.callbacks = callbacks;
        this.overflowMenuId = `header-controls-menu-${Header.nextMenuOrdinal++}`;
        this.lookAheadListboxId = `${this.overflowMenuId}-look-ahead-options`;
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
        const groupPaddingY = 3;
        const groupPaddingX = 6;
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
            { key: "copy", items: [layout.copyButton] },
            { key: "actions", items: [layout.htmlExportButton, layout.exportButton, layout.helpButton, layout.actionOverflowButton] }
        ];

        const visibleGroups: GroupRect[] = groups.map(group => {
            const visibleItems = group.items.filter(item => item.visible);
            if (visibleItems.length === 0) {
                return null;
            }

            const left = Math.max(rowX + 4, Math.min(...visibleItems.map(item => item.x)) - groupPaddingX);
            const right = Math.min(
                this.currentViewportWidth - (rowX + 4),
                Math.max(...visibleItems.map(item => item.x + (item.width ?? item.size ?? UI_TOKENS.height.standard))) + groupPaddingX
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
            .attr("stroke", this.getHeaderCommandBorderColor())
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
            .attr("stroke", this.getHeaderGroupBorderColor())
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
        this.detachLookAheadOutsideClickHandler();

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

    private getHeaderShellBackground(): string {
        return this.getPaletteToken("shell");
    }

    private getHeaderControlBackground(): string {
        return this.getPaletteToken("buttonBg");
    }

    private getHeaderControlHoverBackground(): string {
        return this.getPaletteToken("buttonHoverBg");
    }

    private getHeaderControlTextColor(): string {
        return this.getPaletteToken("buttonText");
    }

    private getHeaderMutedTextColor(): string {
        return this.getPaletteToken("buttonMuted");
    }

    private getHeaderChipBackground(): string {
        return this.getPaletteToken("chipBg");
    }

    private getHeaderChipTextColor(): string {
        return this.getPaletteToken("chipText");
    }

    private getHeaderChipMutedTextColor(): string {
        return this.getPaletteToken("chipMuted");
    }

    private getHeaderInputBackground(): string {
        return this.getPaletteToken("inputBg");
    }

    private getHeaderBorderColor(): string {
        return this.getPaletteToken("buttonStroke");
    }

    private getHeaderHoverBorderColor(): string {
        return this.getPaletteToken("buttonHoverStroke");
    }

    private getHeaderCommandBorderColor(): string {
        return this.getPaletteToken("commandStroke");
    }

    private getHeaderGroupBorderColor(): string {
        return this.getPaletteToken("groupStroke");
    }

    private getHeaderChipBorderColor(): string {
        return this.getPaletteToken("chipStroke");
    }

    private getHeaderInputBorderColor(): string {
        return this.getPaletteToken("inputStroke");
    }

    private getHeaderInputFocusBorderColor(): string {
        return this.getPaletteToken("inputFocus");
    }

    private getHeaderMenuBorderColor(): string {
        return this.getPaletteToken("menuStroke");
    }

    private getHeaderMenuBackground(): string {
        return this.getPaletteToken("menuBg");
    }

    private getHeaderMenuHoverBackground(): string {
        return this.getPaletteToken("menuHover");
    }

    private getHeaderGroupBackground(): string {
        return this.getPaletteToken("groupBg");
    }

    private getHeaderPrimaryColor(): string {
        return this.getPaletteToken("primary");
    }

    private getHeaderSuccessColor(): string {
        return this.getPaletteToken("success");
    }

    private getHeaderWarningColor(): string {
        return this.getPaletteToken("warning");
    }

    private getHeaderDangerColor(): string {
        return this.getPaletteToken("danger");
    }

    private getHeaderShadow(): string {
        return this.getPaletteToken("shadow");
    }

    private applyHeaderPaletteOverrides(): void {
        if (!this.currentPalette.isHighContrast) {
            return;
        }

        const foreground = this.getHeaderControlTextColor();
        const shellBackground = this.getHeaderShellBackground();
        const controlBackground = this.getHeaderControlBackground();
        const border = this.getHeaderBorderColor();
        const inputBackground = this.getHeaderInputBackground();

        this.toggleButtonGroup
            .selectAll<SVGRectElement, unknown>(".header-command-shell, .header-command-group")
            .attr("fill", shellBackground)
            .attr("stroke", border)
            .attr("stroke-width", this.currentPalette.isHighContrast ? 1.5 : 1);

        this.container
            .selectAll<HTMLButtonElement, unknown>("button.header-toggle-button")
            .style("background-color", "transparent")
            .style("color", foreground);

        this.container
            .selectAll<SVGRectElement, unknown>("button.header-toggle-button svg > rect:first-child")
            .attr("fill", controlBackground)
            .attr("stroke", border)
            .style("fill", controlBackground)
            .style("stroke", border);

        this.container
            .selectAll<SVGRectElement, unknown>("button.header-toggle-button svg > rect:not(:first-child)")
            .style("fill", foreground);

        this.container
            .selectAll<SVGElement, unknown>("button.header-toggle-button svg .glyph-fill")
            .attr("fill", foreground)
            .style("fill", foreground);

        this.container
            .selectAll<SVGElement, unknown>("button.header-toggle-button svg .glyph-stroke")
            .attr("stroke", foreground)
            .style("stroke", foreground);

        this.container
            .selectAll<SVGPathElement | SVGLineElement, unknown>("button.header-toggle-button svg path, button.header-toggle-button svg line")
            .attr("stroke", foreground)
            .style("stroke", foreground);

        this.container
            .selectAll<SVGCircleElement, unknown>("button.header-toggle-button svg circle")
            .attr("stroke", foreground)
            .attr("fill", foreground)
            .style("stroke", foreground)
            .style("fill", foreground);

        this.container
            .selectAll<SVGTextElement, unknown>("button.header-toggle-button svg text")
            .style("fill", foreground);

        this.container
            .selectAll<HTMLDivElement, unknown>("div.look-ahead-control-wrapper, div.look-ahead-option-list, div.float-threshold-wrapper")
            .style("background-color", controlBackground)
            .style("border", `${this.currentPalette.isHighContrast ? "1.5px" : "1px"} solid ${border}`)
            .style("box-shadow", this.currentPalette.isHighContrast ? "none" : this.getHeaderShadow())
            .style("color", foreground);

        this.container
            .selectAll<HTMLElement, unknown>("div.look-ahead-control-wrapper button, div.float-threshold-wrapper input, div.action-overflow-menu button.look-ahead-option-button, div.action-overflow-menu input")
            .style("color", foreground)
            .style("background-color", inputBackground)
            .style("border", `${this.currentPalette.isHighContrast ? "1.5px" : "1px"} solid ${border}`);

        this.container
            .selectAll<HTMLDivElement, unknown>("div.action-overflow-menu")
            .style("background-color", controlBackground)
            .style("border", `${this.currentPalette.isHighContrast ? "1.5px" : "1px"} solid ${border}`)
            .style("box-shadow", this.currentPalette.isHighContrast ? "none" : this.getHeaderShadow())
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
                .attr('fill', this.getHeaderControlBackground())
                .attr('stroke', this.getHeaderSuccessColor())
                .attr('stroke-width', 1.5);

            if (this.copySuccessTimeout !== null) {
                clearTimeout(this.copySuccessTimeout);
            }

            this.copySuccessTimeout = window.setTimeout(() => {
                const liveRect = this.container.select<HTMLButtonElement>('button.copy-data-button-group')
                    .select<SVGRectElement>('.copy-button-bg');
                liveRect
                    .attr('fill', this.getHeaderControlBackground())
                    .attr('stroke', this.getHeaderBorderColor())
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
            .style("background-color", this.getHeaderChipBackground())
            .style("padding", "16px 24px")
            .style("border-radius", "8px")
            .style("box-shadow", this.getHeaderShadow())
            .style("border", `1px solid ${this.getHeaderChipBorderColor()}`)
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
            .style("color", this.getHeaderChipTextColor())
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
                .attr('fill', this.getHeaderControlBackground())
                .attr('stroke', this.getHeaderPrimaryColor());
        } else {
            iconPaths.style('display', 'block');
            spinner.style('display', 'none');
            btn.classed('is-exporting', false)
                .attr('aria-busy', 'false')
                .property('disabled', false)
                .style('cursor', 'pointer')
                .style('background-color', 'transparent');
            bgRect
                .attr('fill', this.getHeaderControlBackground())
                .attr('stroke', this.getHeaderBorderColor());
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
        const activeColor = this.getHeaderDangerColor();
        const buttonFill = this.getHeaderControlBackground();
        const buttonStroke = isActive ? activeColor : this.getHeaderBorderColor();
        const hoverFill = this.getHeaderControlHoverBackground();
        const hoverStroke = isActive ? activeColor : this.getHeaderHoverBorderColor();
        const iconColor = isActive ? activeColor : this.getHeaderControlTextColor();

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
                .attr("fill", activeColor);
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
        const inactiveColor = this.getHeaderControlTextColor();
        const buttonFill = this.getHeaderControlBackground();
        const buttonStroke = showBaseline ? baselineColor : this.getHeaderBorderColor();
        const hoverFill = this.getHeaderControlHoverBackground();
        const hoverStroke = showBaseline ? baselineColor : this.getHeaderHoverBorderColor();
        const labelFill = showBaseline ? baselineColor : inactiveColor;

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
            .attr("stroke", showBaseline ? baselineColor : inactiveColor)
            .attr("stroke-width", 2)
            .attr("stroke-linecap", "round");

        iconG.append("rect")
            .attr("x", -7)
            .attr("y", -1)
            .attr("width", 14)
            .attr("height", 4)
            .attr("rx", 1.8)
            .attr("ry", 1.8)
            .attr("fill", showBaseline ? baselineColor : inactiveColor)
            .style("opacity", showBaseline ? "1" : "0.7");

        iconG.append("text")
            .attr("x", 0)
            .attr("y", -5.8)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", "7px")
            .style("font-weight", "800")
            .style("fill", showBaseline ? baselineColor : inactiveColor)
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
        const inactiveColor = this.getHeaderControlTextColor();
        const buttonFill = this.getHeaderControlBackground();
        const buttonStroke = showPreviousUpdate ? previousUpdateColor : this.getHeaderBorderColor();
        const hoverFill = this.getHeaderControlHoverBackground();
        const hoverStroke = showPreviousUpdate ? previousUpdateColor : this.getHeaderHoverBorderColor();
        const labelFill = showPreviousUpdate ? previousUpdateColor : inactiveColor;

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
            .attr("stroke", showPreviousUpdate ? previousUpdateColor : inactiveColor)
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
            .attr("fill", showPreviousUpdate ? previousUpdateColor : inactiveColor)
            .style("opacity", showPreviousUpdate ? "1" : "0.7");

        iconG.append("text")
            .attr("x", 0)
            .attr("y", -5.8)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", "7px")
            .style("font-weight", "800")
            .style("fill", showPreviousUpdate ? previousUpdateColor : inactiveColor)
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
            progressLine: true,
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
        const activeTextColor = this.getHeaderSuccessColor();
        const inactiveTextColor = this.getHeaderControlTextColor();
        const buttonFill = this.getHeaderControlBackground();
        const buttonStroke = showConnectorLines ? activeTextColor : this.getHeaderBorderColor();
        const hoverFill = this.getHeaderControlHoverBackground();
        const hoverStroke = showConnectorLines ? activeTextColor : this.getHeaderHoverBorderColor();

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

        const iconColor = showConnectorLines ? activeTextColor : inactiveTextColor;
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
            iconG.selectAll<SVGElement, unknown>(".glyph-fill").attr("fill", iconColor);
            iconG.selectAll<SVGElement, unknown>(".glyph-stroke").attr("stroke", iconColor);
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
        const activeTextColor = this.getHeaderPrimaryColor();
        const inactiveTextColor = this.getHeaderControlTextColor();
        const buttonFill = this.getHeaderControlBackground();
        const buttonStroke = wbsExpanded ? activeTextColor : this.getHeaderBorderColor();
        const hoverFill = this.getHeaderControlHoverBackground();
        const hoverStroke = wbsExpanded ? activeTextColor : this.getHeaderHoverBorderColor();
        const iconColor = wbsExpanded ? activeTextColor : inactiveTextColor;
        const hoverIconColor = wbsExpanded ? activeTextColor : inactiveTextColor;

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
            iconG.selectAll<SVGElement, unknown>(".glyph-fill").attr("fill", hoverIconColor);
            iconG.selectAll<SVGElement, unknown>(".glyph-stroke").attr("stroke", hoverIconColor);
            textEl.style("fill", hoverIconColor);
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
        const activeTextColor = this.getHeaderPrimaryColor();
        const inactiveTextColor = this.getHeaderControlTextColor();
        const buttonFill = this.getHeaderControlBackground();
        const buttonStroke = isCollapsed ? activeTextColor : this.getHeaderBorderColor();
        const hoverFill = this.getHeaderControlHoverBackground();
        const hoverStroke = isCollapsed ? activeTextColor : this.getHeaderHoverBorderColor();
        const iconColor = isCollapsed ? activeTextColor : inactiveTextColor;
        const hoverIconColor = isCollapsed ? activeTextColor : inactiveTextColor;

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
            iconG.selectAll<SVGElement, unknown>(".glyph-fill").attr("fill", hoverIconColor);
            iconG.selectAll<SVGElement, unknown>(".glyph-stroke").attr("stroke", hoverIconColor);
            textEl.style("fill", hoverIconColor);
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
        const controlBackground = this.getHeaderChipBackground();
        const inputBackground = this.getHeaderInputBackground();
        const textColor = this.getHeaderChipTextColor();
        const mutedTextColor = this.getHeaderChipMutedTextColor();
        const self = this;

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
            .style("background-color", controlBackground)
            .style("border", `1px solid ${this.getHeaderBorderColor()}`)
            .style("border-radius", "12px")
            .style("box-shadow", "none")
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
            .style("color", textColor)
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
            .style("border", `1px solid ${this.getHeaderInputBorderColor()}`)
            .style("border-radius", "4px")
            .style("font-size", "11px")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-weight", UI_TOKENS.fontWeight.semibold)
            .style("text-align", "center")
            .style("color", textColor)
            .style("background-color", inputBackground)
            .style("outline", "none")
            .on("focus", function () {
                select(this)
                    .style("border", `1px solid ${self.getHeaderInputFocusBorderColor()}`)
                    .style("box-shadow", "none");
            })
            .on("blur", function () {
                select(this)
                    .style("border", `1px solid ${self.getHeaderInputBorderColor()}`)
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
                .style("color", mutedTextColor)
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
                .style("fill", mutedTextColor);

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

        const bgColor = this.getHeaderControlBackground();
        const borderColor = hasModeWarning
            ? this.getHeaderWarningColor()
            : (isFloatBased ? this.getHeaderWarningColor() : this.getHeaderPrimaryColor());
        const activeColor = isFloatBased ? this.getHeaderWarningColor() : this.getHeaderPrimaryColor();
        const inactiveTextColor = this.getHeaderControlTextColor();
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
                .attr("fill", bgColor)
                .attr("stroke", activeColor)
                .attr("stroke-width", 1.5);

            // Text code (LP or FL)
            iconG.append("text")
                .attr("text-anchor", "middle")
                .attr("dominant-baseline", "central")
                .attr("y", 1)
                .style("font-family", "Segoe UI, sans-serif")
                .style("font-size", "10px")
                .style("font-weight", "bold")
                .style("fill", activeColor)
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
                .style("fill", this.getHeaderGroupBackground())
                .style("opacity", 0.8);

            pillG.append("rect")
                .attr("x", pillX)
                .attr("y", -pillHeight / 2)
                .attr("width", pillWidth / 2)
                .attr("height", pillHeight)
                .attr("rx", UI_TOKENS.radius.large)
                .attr("ry", UI_TOKENS.radius.large)
                .style("fill", "transparent")
                .style("stroke", activeColor)
                .style("stroke-width", 1.5)
                .style("transition", `all ${UI_TOKENS.motion.duration.slow}ms ${UI_TOKENS.motion.easing.smooth}`);

            pillG.append("text")
                .attr("x", pillWidth / 4)
                .attr("y", 0)
                .attr("text-anchor", "middle")
                .attr("dominant-baseline", "central")
                .style("font-family", "Segoe UI, sans-serif")
                .style("font-size", `${UI_TOKENS.fontSize.md}px`)
                .style("font-weight", isFloatBased ? UI_TOKENS.fontWeight.medium : UI_TOKENS.fontWeight.bold)
                .style("fill", isFloatBased ? inactiveTextColor : activeColor)
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
                .style("fill", isFloatBased ? activeColor : inactiveTextColor)
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
                .attr("stroke", this.getHeaderBorderColor())
                .attr("stroke-width", 1.2);

            badge.append("text")
                .attr("text-anchor", "middle")
                .attr("dominant-baseline", "central")
                .attr("y", 0.6)
                .style("font-family", "Segoe UI, sans-serif")
                .style("font-size", buttonWidth < 80 ? "8px" : "9px")
                .style("font-weight", "800")
                .style("fill", activeColor)
                .style("pointer-events", "none")
                .text("!");
        }
    }

    private attachLookAheadOutsideClickHandler(): void {
        if (this.lookAheadDocumentPointerDownHandler) {
            return;
        }

        this.lookAheadDocumentPointerDownHandler = (event: PointerEvent) => {
            const target = event.target as Node | null;
            const wrapperNode = this.container.select<HTMLDivElement>("div.look-ahead-control-wrapper").node();

            if (!target || wrapperNode?.contains(target)) {
                return;
            }

            this.closeLookAheadDropdown(false);
        };

        document.addEventListener("pointerdown", this.lookAheadDocumentPointerDownHandler, true);
    }

    private detachLookAheadOutsideClickHandler(): void {
        if (!this.lookAheadDocumentPointerDownHandler) {
            return;
        }

        document.removeEventListener("pointerdown", this.lookAheadDocumentPointerDownHandler, true);
        this.lookAheadDocumentPointerDownHandler = null;
    }

    private closeLookAheadDropdown(returnFocus: boolean = false): void {
        this.lookAheadDropdownOpen = false;
        this.detachLookAheadOutsideClickHandler();

        this.container.select<HTMLDivElement>("div.look-ahead-option-list")
            .style("display", "none");

        const button = this.container.select<HTMLButtonElement>("button.look-ahead-control-button")
            .attr("aria-expanded", "false");

        if (returnFocus) {
            button.node()?.focus();
        }
    }

    private openLookAheadDropdown(options: Array<{ value: number; label: string }>, activeDays: number): void {
        this.closeControlsMenu(false);
        this.lookAheadDropdownOpen = true;
        const activeIndex = options.findIndex(option => option.value === activeDays);
        this.lookAheadDropdownActiveIndex = activeIndex >= 0 ? activeIndex : 0;
        this.attachLookAheadOutsideClickHandler();
        this.createLookAheadControl();
        window.setTimeout(() => this.focusLookAheadOption(this.lookAheadDropdownActiveIndex), 0);
    }

    private focusLookAheadOption(index: number): void {
        const optionButtons = Array.from(
            this.container
                .select<HTMLDivElement>("div.look-ahead-option-list")
                .node()
                ?.querySelectorAll<HTMLButtonElement>("button.look-ahead-option-button") ?? []
        );

        if (optionButtons.length === 0) {
            return;
        }

        const nextIndex = (index + optionButtons.length) % optionButtons.length;
        this.lookAheadDropdownActiveIndex = nextIndex;
        optionButtons[nextIndex]?.focus();
    }

    private selectLookAheadWindow(days: number): void {
        this.closeLookAheadDropdown(true);
        this.callbacks.onLookAheadWindowChanged(Number.isFinite(days) ? days : 0);
    }

    private createLookAheadControl(): void {
        const layout = this.getHeaderButtonLayout(this.currentViewportWidth, this.currentSettings, this.currentState);
        const { x: controlX, width: controlWidth, visible } = layout.lookAhead;

        if (!visible) {
            this.closeLookAheadDropdown(false);
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
        const activeColor = this.getHeaderPrimaryColor();
        const textColor = this.getHeaderControlTextColor();
        const borderColor = isActive ? activeColor : this.getHeaderBorderColor();
        const backgroundColor = this.getHeaderControlBackground();
        const mutedTextColor = this.getHeaderControlTextColor();
        const inputBackground = this.getHeaderInputBackground();
        const hoverBackground = this.getHeaderControlHoverBackground();
        const labelColor = isAvailable ? (isActive ? activeColor : textColor) : mutedTextColor;
        const isCompact = controlWidth < 76;
        const valueWidth = isCompact ? Math.max(42, controlWidth - 10) : Math.max(46, controlWidth - 33);

        const options = getLookAheadOptions(activeDays);
        const selectedOption = options.find(option => option.value === activeDays) ?? options[0];

        if (!isAvailable && this.lookAheadDropdownOpen) {
            this.closeLookAheadDropdown(false);
        }

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
            .style("box-shadow", isActive ? this.getHeaderShadow() : "none")
            .style("z-index", this.lookAheadDropdownOpen ? "85" : "45");

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

        const button = wrapper.append("button")
            .attr("id", `${this.lookAheadListboxId}-button`)
            .attr("class", "look-ahead-control-button")
            .attr("type", "button")
            .attr("aria-label", "Look-ahead window")
            .attr("aria-haspopup", "listbox")
            .attr("aria-expanded", String(this.lookAheadDropdownOpen && isAvailable))
            .attr("aria-controls", this.lookAheadListboxId)
            .attr("title", title)
            .property("disabled", !isAvailable)
            .style("width", `${valueWidth}px`)
            .style("height", "22px")
            .style("min-width", "0")
            .style("border", `1px solid ${isActive ? activeColor : this.getHeaderInputBorderColor()}`)
            .style("outline", "none")
            .style("border-radius", "4px")
            .style("padding", isCompact ? "0 13px 0 3px" : "0 15px 0 4px")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", LOOK_AHEAD_SELECT_FONT_SIZE)
            .style("font-weight", UI_TOKENS.fontWeight.semibold)
            .style("line-height", "1")
            .style("text-align", "left")
            .style("color", isAvailable ? (isActive ? activeColor : textColor) : mutedTextColor)
            .style("background-color", inputBackground)
            .style("cursor", isAvailable ? "pointer" : "not-allowed")
            .style("display", "flex")
            .style("align-items", "center")
            .style("justify-content", "flex-start")
            .style("box-sizing", "border-box")
            .on("click", (event) => {
                event.stopPropagation();
                if (!isAvailable) {
                    return;
                }

                if (this.lookAheadDropdownOpen) {
                    this.closeLookAheadDropdown(false);
                } else {
                    this.openLookAheadDropdown(options, activeDays);
                }
            })
            .on("keydown", (event: KeyboardEvent) => {
                if (!isAvailable) {
                    return;
                }

                if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
                    event.preventDefault();
                    event.stopPropagation();
                    this.openLookAheadDropdown(options, activeDays);
                } else if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    this.closeLookAheadDropdown(false);
                }
            });

        button.append("span")
            .style("overflow", "hidden")
            .style("text-overflow", "ellipsis")
            .style("white-space", "nowrap")
            .text(selectedOption?.label ?? "Off");

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
            .style("border-top", `5px solid ${isAvailable ? (isActive ? activeColor : textColor) : mutedTextColor}`)
            .style("pointer-events", "none");

        const list = wrapper.append("div")
            .attr("id", this.lookAheadListboxId)
            .attr("class", "look-ahead-option-list")
            .attr("role", "listbox")
            .attr("aria-label", "Look-ahead window options")
            .attr("aria-labelledby", `${this.lookAheadListboxId}-button`)
            .style("position", "absolute")
            .style("right", isCompact ? "4px" : "5px")
            .style("top", `${controlHeight + 3}px`)
            .style("width", `${valueWidth}px`)
            .style("max-height", `${Math.min(LOOK_AHEAD_OPTION_ROW_HEIGHT * options.length, 168)}px`)
            .style("overflow-y", "auto")
            .style("box-sizing", "border-box")
            .style("padding", "2px")
            .style("display", this.lookAheadDropdownOpen && isAvailable ? "flex" : "none")
            .style("flex-direction", "column")
            .style("gap", "1px")
            .style("background-color", this.getHeaderChipBackground())
            .style("border", `1px solid ${this.getHeaderChipBorderColor()}`)
            .style("border-radius", `${UI_TOKENS.radius.small}px`)
            .style("box-shadow", this.getHeaderShadow())
            .style("z-index", "90");

        options.forEach((option, index) => {
            const selected = option.value === activeDays;
            const optionId = `${this.lookAheadListboxId}-option-${option.value}`;
            const selectedFill = inputBackground;
            const optionTextColor = selected ? activeColor : textColor;

            list.append("button")
                .attr("id", optionId)
                .attr("class", "look-ahead-option-button")
                .attr("type", "button")
                .attr("role", "option")
                .attr("aria-selected", String(selected))
                .style("height", `${LOOK_AHEAD_OPTION_ROW_HEIGHT}px`)
                .style("min-height", `${LOOK_AHEAD_OPTION_ROW_HEIGHT}px`)
                .style("width", "100%")
                .style("padding", "0 4px")
                .style("border", `1px solid ${selected ? activeColor : this.getHeaderMenuBorderColor()}`)
                .style("border-radius", "3px")
                .style("box-sizing", "border-box")
                .style("font-family", "Segoe UI, sans-serif")
                .style("font-size", LOOK_AHEAD_SELECT_FONT_SIZE)
                .style("font-weight", UI_TOKENS.fontWeight.semibold)
                .style("line-height", LOOK_AHEAD_OPTION_LINE_HEIGHT)
                .style("text-align", "left")
                .style("color", optionTextColor)
                .style("background-color", selectedFill)
                .style("cursor", "pointer")
                .on("mouseover", function () {
                    select(this).style("background-color", selected ? selectedFill : hoverBackground);
                })
                .on("mouseout", function () {
                    select(this).style("background-color", selectedFill);
                })
                .on("focus", () => {
                    this.lookAheadDropdownActiveIndex = index;
                })
                .on("click", (event) => {
                    event.stopPropagation();
                    this.selectLookAheadWindow(option.value);
                })
                .on("keydown", (event: KeyboardEvent) => {
                    if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        this.closeLookAheadDropdown(true);
                    } else if (event.key === "ArrowDown") {
                        event.preventDefault();
                        event.stopPropagation();
                        this.focusLookAheadOption(index + 1);
                    } else if (event.key === "ArrowUp") {
                        event.preventDefault();
                        event.stopPropagation();
                        this.focusLookAheadOption(index - 1);
                    } else if (event.key === "Home") {
                        event.preventDefault();
                        event.stopPropagation();
                        this.focusLookAheadOption(0);
                    } else if (event.key === "End") {
                        event.preventDefault();
                        event.stopPropagation();
                        this.focusLookAheadOption(options.length - 1);
                    } else if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        this.selectLookAheadWindow(option.value);
                    }
                })
                .text(option.label);
        });

        if (this.lookAheadDropdownOpen && isAvailable) {
            button.attr("aria-activedescendant", `${this.lookAheadListboxId}-option-${options[this.lookAheadDropdownActiveIndex]?.value ?? activeDays}`);
        } else {
            button.attr("aria-activedescendant", null);
        }
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
        const activeTextColor = this.getHeaderPrimaryColor();
        const inactiveTextColor = this.getHeaderControlTextColor();
        const buttonFill = this.getHeaderControlBackground();
        const buttonStroke = showColumns ? activeTextColor : this.getHeaderBorderColor();
        const hoverFill = this.getHeaderControlHoverBackground();
        const hoverStroke = showColumns ? activeTextColor : this.getHeaderHoverBorderColor();
        const iconColor = showColumns ? activeTextColor : inactiveTextColor;
        const hoverIconColor = showColumns ? activeTextColor : inactiveTextColor;

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
            iconG.selectAll<SVGElement, unknown>(".glyph-fill").attr("fill", hoverIconColor);
            iconG.selectAll<SVGElement, unknown>(".glyph-stroke").attr("stroke", hoverIconColor);
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
        const activeTextColor = this.getHeaderPrimaryColor();
        const inactiveTextColor = this.getHeaderControlTextColor();
        const buttonFill = this.getHeaderControlBackground();
        const buttonStroke = isEnabled ? activeTextColor : this.getHeaderBorderColor();
        const hoverFill = this.getHeaderControlHoverBackground();
        const hoverStroke = isEnabled ? activeTextColor : this.getHeaderHoverBorderColor();
        const wbsColor = isEnabled ? activeTextColor : inactiveTextColor;
        const hoverIconColor = isEnabled ? activeTextColor : inactiveTextColor;

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
            iconG.selectAll<SVGElement, unknown>(".glyph-fill").attr("fill", hoverIconColor);
            iconG.selectAll<SVGElement, unknown>(".glyph-stroke").attr("stroke", hoverIconColor);
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
        const buttonFill = this.getHeaderControlBackground();
        const buttonStroke = this.getHeaderBorderColor();
        const hoverFill = this.getHeaderControlHoverBackground();
        const hoverStroke = this.getHeaderHoverBorderColor();
        const activeTextColor = this.getHeaderControlTextColor();
        const mutedTextColor = this.getHeaderMutedTextColor();

        const btn = this.upsertButton("copy-data-button-group")
            .attr("type", "button")
            .attr("aria-label", "Copy visible data for Excel")
            .attr("title", "Copy visible data for Excel")
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
            .attr('stroke', mutedTextColor)
            .attr('stroke-width', 1.5)
            .attr('stroke-linecap', 'round')
            .attr('stroke-linejoin', 'round');

        btn.on("mouseover", function () {
            bgRect.attr("fill", hoverFill)
                .attr("stroke", hoverStroke);
            iconG.select("path").attr("stroke", activeTextColor);
        })
            .on("mouseout", function () {
                bgRect.attr("fill", buttonFill)
                    .attr("stroke", buttonStroke);
                iconG.select("path").attr("stroke", mutedTextColor);
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
        const activeTextColor = this.getHeaderPrimaryColor();
        const inactiveTextColor = this.getHeaderControlTextColor();
        const buttonFill = this.getHeaderControlBackground();
        const buttonStroke = this.exportButtonLoading ? activeTextColor : this.getHeaderBorderColor();
        const hoverFill = this.getHeaderControlHoverBackground();
        const hoverStroke = this.getHeaderHoverBorderColor();
        const mutedTextColor = inactiveTextColor;

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
            .attr('stroke', mutedTextColor)
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
            .attr('stroke', activeTextColor)
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
                .attr("stroke", inactiveTextColor);
        })
            .on("mouseout", () => {
                bgRect.attr("fill", buttonFill)
                    .attr("stroke", buttonStroke);
                iconG.select<SVGPathElement>(".export-icon-path")
                    .attr("stroke", mutedTextColor);
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
        const buttonFill = this.getHeaderControlBackground();
        const buttonStroke = this.getHeaderBorderColor();
        const hoverFill = this.getHeaderControlHoverBackground();
        const hoverStroke = this.getHeaderHoverBorderColor();
        const activeTextColor = this.getHeaderControlTextColor();
        const mutedTextColor = this.getHeaderMutedTextColor();

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
            .attr('stroke', mutedTextColor)
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
            .style('fill', mutedTextColor)
            .text('HTML');

        btn.on("mouseover", function () {
            bgRect.attr("fill", hoverFill)
                .attr("stroke", hoverStroke);
            iconG.select("path").attr("stroke", activeTextColor);
            iconG.select("text").style("fill", activeTextColor);
        })
            .on("mouseout", function () {
                bgRect.attr("fill", buttonFill)
                    .attr("stroke", buttonStroke);
                iconG.select("path").attr("stroke", mutedTextColor);
                iconG.select("text").style("fill", mutedTextColor);
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
        const buttonFill = this.getHeaderControlBackground();
        const buttonStroke = this.getHeaderBorderColor();
        const hoverFill = this.getHeaderControlHoverBackground();
        const hoverStroke = this.getHeaderHoverBorderColor();
        const activeTextColor = this.getHeaderControlTextColor();
        const mutedTextColor = this.getHeaderMutedTextColor();

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
            .style('fill', mutedTextColor)
            .text("?");

        btn.on("mouseover", function () {
            select(this).select<SVGRectElement>(".help-button-bg")
                .style("fill", hoverFill)
                .style("stroke", hoverStroke);
            select(this).select("text")
                .style("fill", activeTextColor);
        })
            .on("mouseout", function () {
                select(this).select<SVGRectElement>(".help-button-bg")
                    .style("fill", buttonFill)
                    .style("stroke", buttonStroke);
                select(this).select("text")
                    .style("fill", mutedTextColor);
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
            "button:not([disabled]), input:not([disabled])"
        )).filter(item => item.getAttribute("aria-hidden") !== "true");
    }

    private handleOverflowMenuKeydown(event: KeyboardEvent): void {
        if (event.key === "Escape") {
            event.preventDefault();
            this.closeControlsMenu(true);
            return;
        }

        const tagName = (event.target as HTMLElement | null)?.tagName?.toLowerCase();
        if (tagName === "input" || tagName === "textarea") {
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
        const buttonFill = this.getHeaderControlBackground();
        const buttonStroke = this.getHeaderBorderColor();
        const hoverFill = this.getHeaderControlHoverBackground();
        const hoverStroke = this.getHeaderHoverBorderColor();
        const activeTextColor = this.getHeaderControlTextColor();
        const mutedTextColor = this.getHeaderMutedTextColor();
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
                .attr("stroke", mutedTextColor)
                .attr("stroke-width", 1.4)
                .attr("stroke-linecap", "round");

            iconG.append("circle")
                .attr("class", "action-overflow-dot")
                .attr("cx", knobX)
                .attr("cy", y)
                .attr("r", 2)
                .style("fill", mutedTextColor);
        });

        if (activeHiddenCount > 0) {
            svg.append("circle")
                .attr("class", "action-overflow-badge")
                .attr("cx", buttonSize - 7)
                .attr("cy", 7)
                .attr("r", 6)
                .attr("fill", HEADER_DOCK_TOKENS.warning)
                .attr("stroke", this.getHeaderBorderColor())
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
                .style("fill", activeTextColor);
            select(this).selectAll<SVGLineElement, unknown>(".action-overflow-line")
                .style("stroke", activeTextColor);
        })
            .on("mouseout", function () {
                select(this).select<SVGRectElement>(".action-overflow-button-bg")
                    .style("fill", buttonFill)
                    .style("stroke", buttonStroke);
                select(this).selectAll<SVGCircleElement, unknown>(".action-overflow-dot")
                    .style("fill", mutedTextColor);
                select(this).selectAll<SVGLineElement, unknown>(".action-overflow-line")
                    .style("stroke", mutedTextColor);
            });

        this.renderActionOverflowMenu(buttonX, buttonSize, hiddenActions);
    }

    private getProgressLineReferenceShortLabel(reference: ProgressLineReference): string {
        return reference === "previousUpdateFinish" ? "Previous" : "Baseline";
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
                kind: "options"
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
            progressLine: {
                id: "progressLine",
                section: "Timeline Layers",
                label: "Progress line",
                status: state.progressLineVisible ? this.getProgressLineReferenceShortLabel(state.progressLineReference) : "Off",
                title: state.progressLineAvailable
                    ? "Show the finish-variance progress line and choose its reference finish."
                    : "Progress line requires a Data Date, Current Finish, and either Baseline Finish or Previous Update Finish.",
                disabled: !state.progressLineAvailable,
                kind: "progressLine"
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
            showProgressLine: this.currentState.progressLineVisible,
            showConnectorLines: this.currentState.showConnectorLines,
            showExtraColumns: this.currentState.showExtraColumns,
            wbsEnabled: this.currentState.wbsEnabled
        });
    }

    private getHeaderMenuItemActiveColor(item: HeaderMenuItem): string | null {
        if (item.disabled) {
            return null;
        }

        const state = this.currentState;
        switch (item.id) {
            case "baseline":
                return state.showBaseline ? this.currentSettings.comparisonBars.baselineColor.value.value : null;
            case "previousUpdate":
                return state.showPreviousUpdate ? this.currentSettings.comparisonBars.previousUpdateColor.value.value : null;
            case "connectorLines":
                return state.showConnectorLines ? this.getHeaderSuccessColor() : null;
            case "columns":
                return state.showExtraColumns ? this.getHeaderPrimaryColor() : null;
            case "wbsEnable":
                return state.wbsEnabled ? this.getHeaderPrimaryColor() : null;
            case "wbsExpand":
                return state.wbsExpanded ? this.getHeaderPrimaryColor() : null;
            case "wbsCollapse":
                return ((state.wbsExpandToLevel ?? 0) === 0 || !state.wbsExpanded) ? this.getHeaderPrimaryColor() : null;
            default:
                return null;
        }
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
            .style("background-color", this.getHeaderChipBackground())
            .style("border", `1px solid ${this.getHeaderChipBorderColor()}`)
            .style("border-radius", `${UI_TOKENS.radius.medium}px`)
            .style("box-shadow", this.getHeaderShadow())
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
                .style("color", this.getHeaderChipMutedTextColor())
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
        if (item.kind === "options") {
            this.renderLookAheadMenuItem(sectionEl, item);
            return;
        }

        if (item.kind === "number") {
            this.renderFloatThresholdMenuItem(sectionEl, item);
            return;
        }

        if (item.kind === "progressLine") {
            this.renderProgressLineMenuItem(sectionEl, item);
            return;
        }

        const textColor = this.getHeaderControlTextColor();
        const mutedTextColor = this.getHeaderChipMutedTextColor();
        const hoverBackground = this.getHeaderControlHoverBackground();
        const activeItemColor = this.getHeaderMenuItemActiveColor(item);
        const itemTextColor = item.disabled ? mutedTextColor : (activeItemColor ?? textColor);
        const itemBorderColor = activeItemColor ?? this.getHeaderMenuBorderColor();

        const button = sectionEl.append("button")
            .attr("class", "action-overflow-menu-item")
            .attr("type", "button")
            .attr("title", item.title ?? item.label)
            .property("disabled", !!item.disabled)
            .style("min-height", "30px")
            .style("padding", "0 8px")
            .style("border", `1px solid ${itemBorderColor}`)
            .style("border-radius", `${UI_TOKENS.radius.small}px`)
            .style("box-sizing", "border-box")
            .style("background", "transparent")
            .style("color", itemTextColor)
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
                    select(this).style("background-color", hoverBackground);
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
                .style("color", itemTextColor)
                .style("white-space", "nowrap")
                .text(item.status);
        }
    }

    private renderProgressLineMenuItem(
        sectionEl: Selection<HTMLDivElement, unknown, null, undefined>,
        item: HeaderMenuItem
    ): void {
        const state = this.currentState;
        const activeReference = state.progressLineReference;
        const textColor = this.getHeaderControlTextColor();
        const mutedTextColor = this.getHeaderChipMutedTextColor();
        const activeColor = this.getHeaderPrimaryColor();
        const inputBackground = this.getHeaderInputBackground();
        const controlBackground = this.getHeaderControlBackground();
        const hoverBackground = this.getHeaderControlHoverBackground();
        const references: Array<{ value: ProgressLineReference; label: string; available: boolean }> = [
            { value: "baselineFinish", label: "Baseline", available: state.progressLineBaselineAvailable },
            { value: "previousUpdateFinish", label: "Previous", available: state.progressLinePreviousUpdateAvailable }
        ];

        const row = sectionEl.append("div")
            .attr("class", "action-overflow-menu-item action-overflow-menu-field progress-line-menu-item")
            .attr("title", item.title ?? item.label)
            .style("min-height", "76px")
            .style("padding", "6px 8px")
            .style("border-radius", `${UI_TOKENS.radius.small}px`)
            .style("display", "flex")
            .style("flex-direction", "column")
            .style("align-items", "stretch")
            .style("gap", "7px");

        const headerLine = row.append("div")
            .style("display", "grid")
            .style("grid-template-columns", "1fr auto")
            .style("align-items", "center")
            .style("gap", "8px");

        const labelStack = headerLine.append("div")
            .style("display", "flex")
            .style("flex-direction", "column")
            .style("min-width", "0");

        labelStack.append("span")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", "12px")
            .style("font-weight", UI_TOKENS.fontWeight.semibold)
            .style("color", item.disabled ? mutedTextColor : textColor)
            .style("white-space", "nowrap")
            .style("overflow", "hidden")
            .style("text-overflow", "ellipsis")
            .text(item.label);

        labelStack.append("span")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", "10.5px")
            .style("font-weight", UI_TOKENS.fontWeight.normal)
            .style("color", mutedTextColor)
            .style("white-space", "nowrap")
            .style("overflow", "hidden")
            .style("text-overflow", "ellipsis")
            .text(state.progressLineVisible
                ? `Against ${this.getProgressLineReferenceShortLabel(activeReference)}`
                : "Finish variance");

        const toggleSelected = state.progressLineVisible;
        const toggleFill = inputBackground;
        const toggleStroke = toggleSelected ? activeColor : this.getHeaderInputBorderColor();
        const toggleTextColor = toggleSelected ? activeColor : textColor;

        headerLine.append("button")
            .attr("class", "progress-line-toggle-button")
            .attr("type", "button")
            .attr("aria-pressed", String(toggleSelected))
            .attr("aria-label", `${toggleSelected ? "Hide" : "Show"} progress line`)
            .attr("title", item.title ?? item.label)
            .property("disabled", !!item.disabled)
            .style("height", "24px")
            .style("min-width", "44px")
            .style("padding", "0 8px")
            .style("border", `1px solid ${toggleStroke}`)
            .style("border-radius", "4px")
            .style("box-sizing", "border-box")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", "11px")
            .style("font-weight", UI_TOKENS.fontWeight.semibold)
            .style("color", item.disabled ? mutedTextColor : toggleTextColor)
            .style("background-color", item.disabled ? controlBackground : toggleFill)
            .style("cursor", item.disabled ? "not-allowed" : "pointer")
            .on("mouseover", function () {
                if (!item.disabled && !toggleSelected) {
                    select(this).style("background-color", hoverBackground);
                }
            })
            .on("mouseout", function () {
                select(this).style("background-color", item.disabled ? controlBackground : toggleFill);
            })
            .on("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (item.disabled) {
                    return;
                }

                this.callbacks.onToggleProgressLine();
            })
            .text(toggleSelected ? "On" : "Off");

        const optionGrid = row.append("div")
            .attr("role", "radiogroup")
            .attr("aria-label", "Progress line reference finish")
            .style("display", "grid")
            .style("grid-template-columns", "repeat(2, minmax(0, 1fr))")
            .style("gap", "4px");

        references.forEach(reference => {
            const selected = reference.value === activeReference;
            const disabled = !reference.available;
            const selectedFill = inputBackground;
            const selectedStroke = selected ? activeColor : this.getHeaderInputBorderColor();
            const optionTextColor = selected ? activeColor : textColor;
            const title = reference.available
                ? `Use ${getProgressLineReferenceLabel(reference.value)} as the progress line reference`
                : `${getProgressLineReferenceLabel(reference.value)} does not have enough data`;

            optionGrid.append("button")
                .attr("class", "progress-line-reference-button")
                .attr("type", "button")
                .attr("role", "radio")
                .attr("aria-checked", String(selected))
                .attr("title", title)
                .property("disabled", disabled)
                .style("height", "24px")
                .style("min-width", "0")
                .style("padding", "0 4px")
                .style("border", `1px solid ${selectedStroke}`)
                .style("border-radius", "4px")
                .style("box-sizing", "border-box")
                .style("font-family", "Segoe UI, sans-serif")
                .style("font-size", LOOK_AHEAD_SELECT_FONT_SIZE)
                .style("font-weight", UI_TOKENS.fontWeight.semibold)
                .style("line-height", LOOK_AHEAD_OPTION_LINE_HEIGHT)
                .style("color", disabled ? mutedTextColor : optionTextColor)
                .style("background-color", disabled ? controlBackground : selectedFill)
                .style("cursor", disabled ? "not-allowed" : "pointer")
                .on("mouseover", function () {
                    if (!disabled && !selected) {
                        select(this).style("background-color", hoverBackground);
                    }
                })
                .on("mouseout", function () {
                    select(this).style("background-color", disabled ? controlBackground : selectedFill);
                })
                .on("click", (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (disabled || selected) {
                        return;
                    }

                    this.callbacks.onProgressLineReferenceChanged(reference.value);
                })
                .on("keydown", (event: KeyboardEvent) => {
                    if (disabled) {
                        return;
                    }

                    const buttons = Array.from(
                        optionGrid.node()?.querySelectorAll<HTMLButtonElement>("button.progress-line-reference-button:not(:disabled)") ?? []
                    );
                    const currentIndex = buttons.indexOf(event.currentTarget as HTMLButtonElement);
                    const focusButton = (index: number) => {
                        if (buttons.length === 0) {
                            return;
                        }

                        buttons[(index + buttons.length) % buttons.length]?.focus();
                    };

                    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                        event.preventDefault();
                        event.stopPropagation();
                        focusButton(currentIndex + 1);
                    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                        event.preventDefault();
                        event.stopPropagation();
                        focusButton(currentIndex - 1);
                    }
                })
                .text(reference.label);
        });
    }

    private renderLookAheadMenuItem(
        sectionEl: Selection<HTMLDivElement, unknown, null, undefined>,
        item: HeaderMenuItem
    ): void {
        const activeDays = Math.max(0, Math.round(this.currentState.lookAheadWindowDays || 0));
        const options = getLookAheadOptions(activeDays);
        const textColor = this.getHeaderControlTextColor();
        const mutedTextColor = this.getHeaderChipMutedTextColor();
        const activeColor = this.getHeaderPrimaryColor();
        const inputBackground = this.getHeaderInputBackground();
        const controlBackground = this.getHeaderControlBackground();
        const hoverBackground = this.getHeaderControlHoverBackground();
        const row = sectionEl.append("div")
            .attr("class", "action-overflow-menu-item action-overflow-menu-field")
            .attr("title", item.title ?? item.label)
            .style("min-height", "58px")
            .style("padding", "6px 8px")
            .style("border-radius", `${UI_TOKENS.radius.small}px`)
            .style("display", "flex")
            .style("flex-direction", "column")
            .style("align-items", "stretch")
            .style("gap", "6px");

        const headerLine = row.append("div")
            .style("display", "flex")
            .style("align-items", "center")
            .style("justify-content", "space-between")
            .style("gap", "8px");

        headerLine.append("span")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", "12px")
            .style("font-weight", UI_TOKENS.fontWeight.semibold)
            .style("color", item.disabled ? mutedTextColor : textColor)
            .text(item.label);

        headerLine.append("span")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", "11px")
            .style("font-weight", UI_TOKENS.fontWeight.semibold)
            .style("color", item.disabled ? mutedTextColor : (activeDays > 0 ? activeColor : textColor))
            .style("white-space", "nowrap")
            .text(item.status ?? "Off");

        const optionGrid = row.append("div")
            .attr("role", "group")
            .attr("aria-label", "Look-ahead window")
            .style("display", "grid")
            .style("grid-template-columns", "repeat(4, minmax(0, 1fr))")
            .style("gap", "4px");

        options.forEach(option => {
            const selected = option.value === activeDays;
            const selectedFill = inputBackground;
            const optionTextColor = selected ? activeColor : textColor;
            const nextValue = Number.isFinite(option.value) ? option.value : 0;

            optionGrid.append("button")
                .attr("class", "look-ahead-option-button")
                .attr("type", "button")
                .attr("aria-pressed", String(selected))
                .attr("title", `${item.label}: ${option.label}`)
                .property("disabled", !!item.disabled)
                .style("height", "24px")
                .style("min-width", "0")
                .style("padding", "0 3px")
                .style("border", `1px solid ${selected ? activeColor : this.getHeaderInputBorderColor()}`)
                .style("border-radius", "4px")
                .style("box-sizing", "border-box")
                .style("font-family", "Segoe UI, sans-serif")
                .style("font-size", LOOK_AHEAD_SELECT_FONT_SIZE)
                .style("font-weight", UI_TOKENS.fontWeight.semibold)
                .style("line-height", LOOK_AHEAD_OPTION_LINE_HEIGHT)
                .style("color", item.disabled ? mutedTextColor : optionTextColor)
                .style("background-color", item.disabled ? controlBackground : selectedFill)
                .style("cursor", item.disabled ? "not-allowed" : "pointer")
                .on("mouseover", function () {
                    if (!item.disabled && !selected) {
                        select(this).style("background-color", hoverBackground);
                    }
                })
                .on("mouseout", function () {
                    select(this).style("background-color", item.disabled ? controlBackground : selectedFill);
                })
                .on("click", (event) => {
                    event.stopPropagation();
                    if (item.disabled) {
                        return;
                    }

                    this.closeControlsMenu(true);
                    if (nextValue !== activeDays) {
                        this.callbacks.onLookAheadWindowChanged(nextValue);
                    }
                })
                .on("keydown", (event: KeyboardEvent) => {
                    if (item.disabled) {
                        return;
                    }

                    const buttons = Array.from(
                        optionGrid.node()?.querySelectorAll<HTMLButtonElement>("button.look-ahead-option-button") ?? []
                    );
                    const currentIndex = buttons.indexOf(event.currentTarget as HTMLButtonElement);
                    const focusButton = (index: number) => {
                        if (buttons.length === 0) {
                            return;
                        }

                        buttons[(index + buttons.length) % buttons.length]?.focus();
                    };

                    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                        event.preventDefault();
                        event.stopPropagation();
                        focusButton(currentIndex + 1);
                    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                        event.preventDefault();
                        event.stopPropagation();
                        focusButton(currentIndex - 1);
                    } else if (event.key === "Home") {
                        event.preventDefault();
                        event.stopPropagation();
                        focusButton(0);
                    } else if (event.key === "End") {
                        event.preventDefault();
                        event.stopPropagation();
                        focusButton(buttons.length - 1);
                    }
                })
                .text(option.label);
        });
    }

    private renderFloatThresholdMenuItem(
        sectionEl: Selection<HTMLDivElement, unknown, null, undefined>,
        item: HeaderMenuItem
    ): void {
        const textColor = this.getHeaderControlTextColor();
        const inputBackground = this.getHeaderInputBackground();
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
            .style("color", textColor)
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
            .style("border", `1px solid ${this.getHeaderInputBorderColor()}`)
            .style("border-radius", "4px")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", "12px")
            .style("font-weight", UI_TOKENS.fontWeight.semibold)
            .style("text-align", "center")
            .style("color", textColor)
            .style("background-color", inputBackground)
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
