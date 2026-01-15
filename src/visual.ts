import * as d3 from "d3";
import { timeMonth, timeMonday, timeDay } from "d3-time";
import { Selection, BaseType } from "d3-selection";
import { ScaleTime, ScaleBand } from "d3-scale";

import powerbi from "powerbi-visuals-api";
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import VisualUpdateType = powerbi.VisualUpdateType;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import DataView = powerbi.DataView;
import IViewport = powerbi.IViewport;
import IVisual = powerbi.extensibility.visual.IVisual;
import PrimitiveValue = powerbi.PrimitiveValue;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ITooltipService = powerbi.extensibility.ITooltipService;
import ILocalizationManager = powerbi.extensibility.ILocalizationManager;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;
import IDownloadService = powerbi.extensibility.IDownloadService;
import PrivilegeStatus = powerbi.PrivilegeStatus;

import { jsPDF } from "jspdf";

import { VisualSettings } from "./settings";
import { FormattingSettingsService, formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import { IBasicFilter, FilterType } from "powerbi-models";
import FilterAction = powerbi.FilterAction;

interface Task {
    id: string | number;
    internalId: string;
    name: string;
    type: string;
    duration: number;
    userProvidedTotalFloat?: number;
    taskFreeFloat?: number;
    predecessorIds: string[];
    relationshipTypes: { [predId: string]: string; };
    relationshipLags: { [predId: string]: number | null; };
    successors: Task[];
    predecessors: Task[];
    earlyStart: number;
    earlyFinish: number;
    lateStart: number;
    lateFinish: number;
    totalFloat: number;
    isCritical: boolean;
    isCriticalByFloat?: boolean;
    isCriticalByRel?: boolean;
    isNearCritical?: boolean;
    startDate?: Date | null;
    finishDate?: Date | null;
    baselineStartDate?: Date | null;
    baselineFinishDate?: Date | null;
    previousUpdateStartDate?: Date | null;
    previousUpdateFinishDate?: Date | null;
    yOrder?: number;
    tooltipData?: Array<{ key: string, value: PrimitiveValue }>;
    selectionId?: powerbi.visuals.ISelectionId;
    legendValue?: string;
    legendColor?: string;

    wbsLevels?: string[];
    wbsGroupId?: string;
    wbsIndentLevel?: number;
}

interface WBSGroup {
    id: string;
    level: number;
    name: string;
    fullPath: string;
    parentId: string | null;
    children: WBSGroup[];
    tasks: Task[];
    allTasks: Task[];
    isExpanded: boolean;
    yOrder?: number;
    visibleTaskCount: number;

    summaryStartDate?: Date | null;
    summaryFinishDate?: Date | null;
    hasCriticalTasks: boolean;
    hasNearCriticalTasks?: boolean;
    taskCount: number;

    criticalStartDate?: Date | null;
    criticalFinishDate?: Date | null;
    nearCriticalStartDate?: Date | null;
    nearCriticalFinishDate?: Date | null;
    summaryBaselineStartDate?: Date | null;
    summaryBaselineFinishDate?: Date | null;
    summaryPreviousUpdateStartDate?: Date | null;
    summaryPreviousUpdateFinishDate?: Date | null;
}

interface Relationship {
    predecessorId: string;
    successorId: string;
    type: string;
    freeFloat: number | null;
    isCritical: boolean;
    lag: number | null;
    relationshipFloat?: number;
    isDriving?: boolean;
}

interface DropdownItem {
    id: string;
    type: "clear" | "task" | "empty" | "overflow";
    label: string;
    task?: Task;
    focusable: boolean;
}

enum UpdateType {
    Full = "Full",
    DataOnly = "DataOnly",
    ViewportOnly = "ViewportOnly",
    SettingsOnly = "SettingsOnly",
    DataAndSettings = 'DataAndSettings'
}

export class Visual implements IVisual {
    private target: HTMLElement;
    private host: IVisualHost;
    private formattingSettingsService: FormattingSettingsService;
    private settings: VisualSettings;
    private selectionManager: ISelectionManager;
    private tooltipService: ITooltipService | null = null;
    private localizationManager: ILocalizationManager;
    private eventService: IVisualEventService | null = null;
    private downloadService: IDownloadService | null = null;
    private isExporting: boolean = false;
    private exportButtonGroup: Selection<SVGGElement, unknown, null, undefined> | null = null;
    private allowInteractions: boolean = true;
    private highContrastMode: boolean = false;
    private highContrastForeground: string = "#000000";
    private highContrastBackground: string = "#FFFFFF";
    private highContrastForegroundSelected: string = "#000000";
    private lastTooltipItems: VisualTooltipDataItem[] = [];
    private lastTooltipIdentities: powerbi.extensibility.ISelectionId[] = [];

    private stickyHeaderContainer: Selection<HTMLDivElement, unknown, null, undefined>;
    private scrollableContainer: Selection<HTMLDivElement, unknown, null, undefined>;
    private headerSvg: Selection<SVGSVGElement, unknown, null, undefined>;
    private mainSvg: Selection<SVGSVGElement, unknown, null, undefined>;

    private mainGroup: Selection<SVGGElement, unknown, null, undefined>;
    private gridLayer: Selection<SVGGElement, unknown, null, undefined>;
    private labelGridLayer: Selection<SVGGElement, unknown, null, undefined>;
    private arrowLayer: Selection<SVGGElement, unknown, null, undefined>;
    private taskLayer: Selection<SVGGElement, unknown, null, undefined>;
    private taskLabelLayer: Selection<SVGGElement, unknown, null, undefined>;
    private chartClipPath: Selection<SVGClipPathElement, unknown, null, undefined>;
    private chartClipRect: Selection<SVGRectElement, unknown, null, undefined>;
    private toggleButtonGroup: Selection<SVGGElement, unknown, null, undefined>;
    private headerGridLayer: Selection<SVGGElement, unknown, null, undefined>;
    private tooltipDiv: Selection<HTMLDivElement, unknown, HTMLElement, any>;
    private canvasElement: HTMLCanvasElement | null = null;
    private canvasContext: CanvasRenderingContext2D | null = null;
    private useCanvasRendering: boolean = false;
    private CANVAS_THRESHOLD: number = 250;
    private readonly MODE_TRANSITION_DURATION: number = 150;
    private canvasLayer: Selection<HTMLCanvasElement, unknown, null, undefined>;
    private loadingOverlay: Selection<HTMLDivElement, unknown, null, undefined>;
    private loadingText: Selection<HTMLDivElement, unknown, null, undefined>;
    private loadingRowsText: Selection<HTMLDivElement, unknown, null, undefined>;
    private loadingProgressText: Selection<HTMLDivElement, unknown, null, undefined>;
    private isLoadingVisible: boolean = false;
    private loadingStartTime: number | null = null;

    private allTasksData: Task[] = [];
    private relationships: Relationship[] = [];
    private taskIdToTask: Map<string, Task> = new Map();
    private taskIdQueryName: string | null = null;
    private taskIdTable: string | null = null;
    private taskIdColumn: string | null = null;
    private lastUpdateOptions: VisualUpdateOptions | null = null;
    private lastTaskFilterSignature: string | null = null;

    private showConnectorLinesInternal: boolean = true;
    private showExtraColumnsInternal: boolean = true;

    private wbsExpandedInternal: boolean = true;

    private showAllTasksInternal: boolean = true;
    private showBaselineInternal: boolean = true;
    private showPreviousUpdateInternal: boolean = true;
    private isInitialLoad: boolean = true;

    private debug: boolean = false;

    private margin = { top: 10, right: 100, bottom: 40, left: 280 };
    private headerHeight = 110;
    private legendFooterHeight = 60;
    private dateLabelOffset = 8;
    private floatTolerance = 0.001;
    private defaultMaxTasks = 500;
    private labelPaddingLeft = 10;
    private dateBackgroundPadding = { horizontal: 6, vertical: 3 };
    private taskLabelLineHeight = "1.1em";
    private minTaskWidthPixels = 1;
    private monthYearFormatter: Intl.DateTimeFormat;
    private lineDateFormatter: Intl.DateTimeFormat;
    private fullDateFormatter: Intl.DateTimeFormat;
    private lastLocale: string | null = null;
    private dataDate: Date | null = null;

    private xScale: ScaleTime<number, number> | null = null;
    private yScale: ScaleBand<string> | null = null;

    private selectedTaskId: string | null = null;
    private selectedTaskName: string | null = null;
    private hoveredTaskId: string | null = null;
    private lastDataSignature: string | null = null;
    private cachedSortedTasksSignature: string | null = null;
    private cachedTasksSortedByStartDate: Task[] = [];
    private cachedPlottableTasksSorted: Task[] = [];
    private dropdownNeedsRefresh: boolean = true;
    private dropdownContainer: Selection<HTMLDivElement, unknown, null, undefined>;
    private dropdownInput: Selection<HTMLInputElement, unknown, null, undefined>;
    private dropdownList: Selection<HTMLDivElement, unknown, null, undefined>;
    private dropdownListId: string = `task-selection-list-${Date.now()}`;
    private dropdownActiveIndex: number = -1;
    private dropdownFocusableItems: DropdownItem[] = [];
    private dropdownTaskCache: Task[] = [];
    private dropdownFilterTimeout: number | null = null;
    private readonly DROPDOWN_MAX_RESULTS: number = 500;
    private marginResizer: Selection<HTMLDivElement, unknown, null, undefined>;
    private selectedTaskLabel: Selection<HTMLDivElement, unknown, null, undefined>;
    private pathInfoLabel: Selection<HTMLDivElement, unknown, null, undefined>;
    private isDropdownInteracting: boolean = false;

    private traceMode: string = "backward";

    private floatThresholdInput: Selection<HTMLInputElement, unknown, null, undefined>;
    private floatThreshold: number = 0;
    private showNearCritical: boolean = true;

    private viewportStartIndex: number = 0;
    private viewportEndIndex: number = 0;
    private visibleTaskCount: number = 0;
    private taskTotalCount: number = 0;
    private taskElementHeight: number = 0;
    private scrollThrottleTimeout: any | null = null;
    private scrollListener: any;
    private allTasksToShow: Task[] = [];
    private allFilteredTasks: Task[] = [];

    private lastViewport: IViewport | null = null;

    private renderStartTime: number = 0;

    private predecessorIndex: Map<string, Set<string>> = new Map();
    private relationshipByPredecessor: Map<string, Relationship[]> = new Map();

    private legendDataExists: boolean = false;
    private legendColorMap: Map<string, string> = new Map();
    private legendCategories: string[] = [];
    private legendFieldName: string = "";
    private legendContainer: Selection<HTMLDivElement, unknown, null, undefined>;
    private selectedLegendCategories: Set<string> = new Set();
    private legendSelectionIds: Map<string, powerbi.visuals.ISelectionId> = new Map();

    private wbsDataExists: boolean = false;
    private wbsDataExistsInMetadata: boolean = false;
    private wbsLevelColumnIndices: number[] = [];
    private wbsLevelColumnNames: string[] = [];
    private wbsGroups: WBSGroup[] = [];
    private wbsGroupMap: Map<string, WBSGroup> = new Map();
    private wbsRootGroups: WBSGroup[] = [];
    private wbsExpandedState: Map<string, boolean> = new Map();
    private wbsExpandToLevel: number | null | undefined = undefined;
    private wbsAvailableLevels: number[] = [];
    private wbsManualExpansionOverride: boolean = false;
    private wbsManuallyToggledGroups: Set<string> = new Set();
    private wbsEnableOverride: boolean | null = null;
    private wbsGroupLayer: Selection<SVGGElement, unknown, null, undefined>;
    private lastExpandCollapseAllState: boolean | null = null;

    private tooltipDebugLogged: boolean = false;
    private landingPageContainer: Selection<HTMLDivElement, unknown, null, undefined> | null = null;

    private relationshipIndex: Map<string, Relationship[]> = new Map();

    private allDrivingChains: Array<{
        tasks: Set<string>,
        relationships: Relationship[],
        totalDuration: number,
        startingTask: Task | null
    }> = [];
    private selectedPathIndex: number = 0;

    private readonly VIEWPORT_CHANGE_THRESHOLD = 0.3;
    private forceFullUpdate: boolean = false;
    private preserveScrollOnUpdate: boolean = false;
    private preservedScrollTop: number | null = null;
    private scrollPreservationUntil: number = 0;
    private lastWbsToggleTimestamp: number = 0;
    private wbsToggleScrollAnchor: { groupId: string; visualOffset: number } | null = null;

    private tooltipClassName: string;
    private isUpdating: boolean = false;
    private isMarginDragging: boolean = false;
    private scrollHandlerBackup: any = null;

    private updateDebounceTimeout: any = null;
    private pendingUpdate: VisualUpdateOptions | null = null;
    private readonly UPDATE_DEBOUNCE_MS = 100;

    private zoomSliderContainer: Selection<HTMLDivElement, unknown, null, undefined>;
    private zoomSliderTrack: Selection<HTMLDivElement, unknown, null, undefined>;
    private zoomSliderSelection: Selection<HTMLDivElement, unknown, null, undefined>;
    private zoomSliderLeftHandle: Selection<HTMLDivElement, unknown, null, undefined>;
    private zoomSliderRightHandle: Selection<HTMLDivElement, unknown, null, undefined>;
    private zoomSliderMiniChart: Selection<HTMLCanvasElement, unknown, null, undefined>;

    private zoomRangeStart: number = 0;
    private zoomRangeEnd: number = 1;
    private fullTimelineDomain: [Date, Date] | null = null;
    private isZoomSliderDragging: boolean = false;
    private zoomDragType: 'left' | 'right' | 'middle' | null = null;
    private zoomDragStartX: number = 0;
    private zoomDragStartLeft: number = 0;
    private zoomDragStartRight: number = 0;
    private zoomSliderEnabled: boolean = true;
    private readonly ZOOM_SLIDER_MIN_RANGE: number = 0.02;
    private zoomDragListenersAttached: boolean = false;
    private zoomMouseMoveHandler: ((event: MouseEvent) => void) | null = null;
    private zoomMouseUpHandler: (() => void) | null = null;
    private zoomTouchMoveHandler: ((event: TouchEvent) => void) | null = null;
    private zoomTouchEndHandler: (() => void) | null = null;
    private readonly zoomTouchListenerOptions: AddEventListenerOptions = { passive: true };

    private readonly UI_TOKENS = {

        height: {
            compact: 24,
            standard: 32,
            comfortable: 36
        },

        radius: {
            small: 3,
            medium: 8,
            large: 16,
            pill: 20,
            full: 9999
        },

        spacing: {
            xs: 4,
            sm: 6,
            md: 10,
            lg: 14,
            xl: 18,
            xxl: 24
        },

        fontSize: {
            xs: 10,
            sm: 11,
            md: 12,
            lg: 13,
            xl: 14
        },

        fontWeight: {
            normal: 400,
            medium: 500,
            semibold: 600,
            bold: 700
        },

        color: {
            primary: {
                default: '#0078D4',
                hover: '#106EBE',
                pressed: '#005A9E',
                light: '#DEECF9',
                lighter: '#EFF6FC',
                subtle: '#F3F9FD'
            },
            warning: {
                default: '#F7A800',
                hover: '#E09200',
                pressed: '#C87E00',
                light: '#FFF4CE',
                lighter: '#FFFAED',
                subtle: '#FFFCF8'
            },
            success: {
                default: '#107C10',
                hover: '#0E6B0E',
                pressed: '#0C5A0C',
                light: '#DFF6DD',
                lighter: '#F1FAF1',
                subtle: '#F7FDF7'
            },
            danger: {
                default: '#D13438',
                hover: '#B82E31',
                pressed: '#A0272A',
                light: '#FDE7E9',
                lighter: '#FEF4F5',
                subtle: '#FFF9FA'
            },
            neutral: {
                black: '#201F1E',
                grey190: '#201F1E',
                grey160: '#323130',
                grey140: '#484644',
                grey130: '#605E5C',
                grey90: '#A19F9D',
                grey60: '#C8C6C4',
                grey40: '#D2D0CE',
                grey30: '#EDEBE9',
                grey20: '#F3F2F1',
                grey10: '#FAF9F8',
                grey5: '#FCFCFC',
                white: '#FFFFFF'
            }
        },

        shadow: {
            1: '0 0.5px 1px rgba(0, 0, 0, 0.08)',
            2: '0 1px 2px rgba(0, 0, 0, 0.08), 0 0.5px 1px rgba(0, 0, 0, 0.04)',
            4: '0 2px 4px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06)',
            8: '0 4px 8px rgba(0, 0, 0, 0.12), 0 2px 4px rgba(0, 0, 0, 0.08)',
            16: '0 8px 16px rgba(0, 0, 0, 0.14), 0 4px 8px rgba(0, 0, 0, 0.1)',
            24: '0 12px 24px rgba(0, 0, 0, 0.16), 0 6px 12px rgba(0, 0, 0, 0.12)'
        },

        motion: {
            duration: {
                instant: 0,
                fast: 120,
                normal: 200,
                slow: 350,
                slower: 500
            },
            easing: {
                standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
                decelerate: 'cubic-bezier(0, 0, 0.2, 1)',
                accelerate: 'cubic-bezier(0.4, 0, 1, 1)',
                sharp: 'cubic-bezier(0.4, 0, 0.6, 1)',
                smooth: 'cubic-bezier(0.4, 0.14, 0.3, 1)'
            }
        }
    };

    private readonly LAYOUT_BREAKPOINTS = {
        wide: 850,
        medium: 650,
        narrow: 0
    };

    /**
     * Determines the current layout mode based on viewport width
     */
    private getLayoutMode(viewportWidth: number): 'wide' | 'medium' | 'narrow' {
        if (viewportWidth >= this.LAYOUT_BREAKPOINTS.wide) return 'wide';
        if (viewportWidth >= this.LAYOUT_BREAKPOINTS.medium) return 'medium';
        return 'narrow';
    }

    /**
     * Returns button dimensions and positions based on current layout mode
     * This centralizes all responsive layout calculations
     */
    private getHeaderButtonLayout(viewportWidth: number): {
        mode: 'wide' | 'medium' | 'narrow';
        showAllCritical: { x: number; width: number; showText: boolean };
        modeToggle: { x: number; width: number; showFullLabels: boolean };
        colToggle: { x: number; size: number };
        baseline: { x: number; width: number; iconOnly: boolean };
        previousUpdate: { x: number; width: number; iconOnly: boolean };
        connectorLines: { x: number; size: number };
        wbsEnable: { x: number; width: number };
        wbsExpandToggle: { x: number; size: number };
        wbsCollapseToggle: { x: number; size: number };
        copyButton: { x: number; size: number };
        exportButton: { x: number; size: number };
        gap: number;
    } {
        const mode = this.getLayoutMode(viewportWidth);
        const gap = mode === 'wide' ? 12 : (mode === 'medium' ? 8 : 6);
        const iconButtonSize = 36;
        let x = 10;

        const showAllWidth = mode === 'narrow' ? 100 : 140;
        const showAllCritical = { x, width: showAllWidth, showText: true };
        x += showAllWidth + gap;

        const modeWidth = mode === 'wide' ? 150 : (mode === 'medium' ? 130 : 110);
        const modeToggle = { x, width: modeWidth, showFullLabels: mode === 'wide' };
        x += modeWidth + gap;

        const baselineIconOnly = mode === 'narrow';
        const baselineWidth = baselineIconOnly ? iconButtonSize : (mode === 'medium' ? 90 : 110);
        const baseline = { x, width: baselineWidth, iconOnly: baselineIconOnly };
        x += baselineWidth + gap;

        const prevIconOnly = mode === 'narrow';
        const prevWidth = prevIconOnly ? iconButtonSize : (mode === 'medium' ? 90 : 120);
        const previousUpdate = { x, width: prevWidth, iconOnly: prevIconOnly };
        x += prevWidth + gap;

        const connectorLines = { x, size: iconButtonSize };
        x += iconButtonSize + gap;

        // Column toggle moved here - after connector lines, before WBS
        const colToggle = { x, size: iconButtonSize };
        x += iconButtonSize + gap;

        const wbsEnableWidth = mode === 'narrow' ? 60 : 70;
        const wbsEnable = { x, width: wbsEnableWidth };
        x += wbsEnableWidth + gap;

        const wbsExpandToggle = { x, size: iconButtonSize };
        x += iconButtonSize + gap;
        const wbsCollapseToggle = { x, size: iconButtonSize };
        x += iconButtonSize + gap;

        // Copy button - smaller icon button (28px)
        const copyButtonSize = 28;
        const copyButton = { x, size: copyButtonSize };
        x += copyButtonSize + gap;

        // Export button - smaller icon button (28px)
        const exportButtonSize = 28;
        const exportButton = { x, size: exportButtonSize };

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
            gap
        };
    }

    /**
     * Returns second row layout (dropdown, trace mode toggle) based on viewport width
     */
    private getSecondRowLayout(viewportWidth: number): {
        dropdown: { width: number; left: number };
        traceModeToggle: { left: number };
        floatThreshold: { maxWidth: number };
    } {
        const mode = this.getLayoutMode(viewportWidth);

        const defaultWidth = mode === 'wide' ? 350 : (mode === 'medium' ? 280 : 200);
        const configuredWidth = this.settings?.pathSelection?.dropdownWidth?.value ?? defaultWidth;
        const minWidth = 150;
        const maxWidth = Math.max(minWidth, viewportWidth - 20);
        const dropdownWidth = Math.min(Math.max(configuredWidth, minWidth), maxWidth);

        const position = this.settings?.pathSelection?.dropdownPosition?.value?.value || "left";
        const horizontalPadding = 10;
        const maxLeft = Math.max(horizontalPadding, viewportWidth - dropdownWidth - horizontalPadding);
        let dropdownLeft = horizontalPadding;

        if (position === "center") {
            dropdownLeft = (viewportWidth - dropdownWidth) / 2;
        } else if (position === "right") {
            dropdownLeft = viewportWidth - dropdownWidth - horizontalPadding;
        }

        dropdownLeft = Math.max(horizontalPadding, Math.min(dropdownLeft, maxLeft));

        // Position Trace Mode Toggle right after the dropdown with a small gap
        const traceGap = 15;
        const traceModeLeft = dropdownLeft + dropdownWidth + traceGap;

        const floatThresholdMaxWidth = mode === 'narrow' ? 180 : 250;

        return {
            dropdown: { width: dropdownWidth, left: dropdownLeft },
            traceModeToggle: { left: traceModeLeft },
            floatThreshold: { maxWidth: floatThresholdMaxWidth }
        };
    }

    constructor(options: VisualConstructorOptions) {
        this.debugLog("--- Initializing Critical Path Visual (Plot by Date) ---");
        this.target = options.element;
        this.host = options.host;
        this.localizationManager = this.host.createLocalizationManager();
        this.formattingSettingsService = new FormattingSettingsService(this.localizationManager);
        this.selectionManager = this.host.createSelectionManager();
        this.tooltipService = this.host.tooltipService;
        this.eventService = this.host.eventService;
        this.downloadService = this.host.downloadService;
        this.zoomMouseMoveHandler = (event: MouseEvent) => this.handleZoomDrag(event);
        this.zoomMouseUpHandler = () => this.endZoomDrag();
        this.zoomTouchMoveHandler = (event: TouchEvent) => {
            if (this.isZoomSliderDragging && event.touches.length > 0) {
                const touch = event.touches[0];
                this.handleZoomDrag({ clientX: touch.clientX, clientY: touch.clientY } as MouseEvent);
            }
        };
        this.zoomTouchEndHandler = () => this.endZoomDrag();
        this.refreshDateFormatters();

        this.showAllTasksInternal = true;

        this.showBaselineInternal = true;
        this.showPreviousUpdateInternal = true;
        this.isInitialLoad = true;
        this.floatThreshold = 0;
        this.showConnectorLinesInternal = true;
        this.wbsExpandedInternal = true;

        this.tooltipClassName = `critical-path-tooltip-${Date.now()}`;

        const visualWrapper = d3.select(this.target).append("div")
            .attr("class", "visual-wrapper")
            .style("height", "100%")
            .style("width", "100%")
            .style("overflow", "hidden")
            .style("position", "relative")
            .style("display", "flex")
            .style("flex-direction", "column");

        this.stickyHeaderContainer = visualWrapper.append("div")
            .attr("class", "sticky-header-container")
            .style("position", "sticky")
            .style("top", "0")
            .style("left", "0")
            .style("width", "100%")
            .style("height", `${this.headerHeight}px`)
            .style("min-height", `${this.headerHeight}px`)
            .style("flex-shrink", "0")
            .style("z-index", "100")
            .style("background-color", "white")
            .style("overflow", "visible");

        this.headerSvg = this.stickyHeaderContainer.append("svg")
            .attr("class", "header-svg")
            .attr("width", "100%")
            .attr("height", "100%");

        this.headerGridLayer = this.headerSvg.append("g")
            .attr("class", "header-grid-layer");

        this.toggleButtonGroup = this.headerSvg.append("g")
            .attr("class", "toggle-button-group")
            .style("cursor", "pointer");

        this.dropdownContainer = this.stickyHeaderContainer.append("div")
            .attr("class", "task-selection-dropdown-container")
            .style("position", "absolute")
            .style("top", "10px")
            .style("left", "150px")
            .style("z-index", "20")
            .style("display", "none");

        const searchPlaceholder = this.getLocalizedString("ui.searchPlaceholder", "Search for a task...");
        this.dropdownInput = this.dropdownContainer.append("input")
            .attr("type", "text")
            .attr("class", "task-selection-input")
            .attr("placeholder", searchPlaceholder)
            .style("width", "250px")
            .style("padding", "5px 8px")
            .style("border", "1px solid #ccc")
            .style("border-radius", "4px")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", "9px")
            .style("color", "#333");

        this.dropdownList = this.dropdownContainer.append("div")
            .attr("class", "task-selection-list")
            .style("position", "absolute")
            .style("top", "100%")
            .style("left", "0")
            .style("max-height", "150px")
            .style("overflow-y", "auto")
            .style("width", "100%")
            .style("background", "white")
            .style("border", "1px solid #ccc")
            .style("border-top", "none")
            .style("border-radius", "0 0 4px 4px")
            .style("box-shadow", "0 2px 5px rgba(0,0,0,0.1)")
            .style("display", "none")
            .style("z-index", "30")
            .style("pointer-events", "auto")
            .style("margin-bottom", "40px");

        this.createFloatThresholdControl();

        this.selectedTaskLabel = this.stickyHeaderContainer.append("div")
            .attr("class", "selected-task-label")
            .style("position", "absolute")
            .style("top", "10px")
            .style("right", "15px")
            .style("padding", "5px 10px")
            .style("background-color", "rgba(255,255,255,0.8)")
            .style("border", "1px solid #ccc")
            .style("border-radius", "4px")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", "9px")
            .style("color", "#333")
            .style("font-weight", "bold")
            .style("display", "none");

        this.pathInfoLabel = this.stickyHeaderContainer.append("div")
            .attr("class", "path-info-label")
            .style("position", "absolute")
            .style("top", "6px")
            .style("right", "10px")
            .style("height", `${this.UI_TOKENS.height.standard}px`)
            .style("padding", `0 ${this.UI_TOKENS.spacing.sm}px`)
            .style("display", "none")
            .style("align-items", "center")
            .style("gap", `${this.UI_TOKENS.spacing.sm}px`)
            .style("background-color", this.UI_TOKENS.color.neutral.white)
            .style("border", `1.5px solid ${this.UI_TOKENS.color.primary.default}`)
            .style("border-radius", `${this.UI_TOKENS.radius.pill}px`)
            .style("box-shadow", this.UI_TOKENS.shadow[4])
            .style("font-family", "Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif")
            .style("font-size", `${this.UI_TOKENS.fontSize.sm}px`)
            .style("color", this.UI_TOKENS.color.primary.default)
            .style("font-weight", "600")
            .style("letter-spacing", "0.1px")
            .style("white-space", "nowrap")
            .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

        this.scrollableContainer = visualWrapper.append("div")
            .attr("class", "criticalPathContainer")
            .style("flex", "1")
            .style("min-height", "0")
            .style("overflow-anchor", "none")
            .style("width", "100%")
            .style("overflow-y", "auto")
            .style("overflow-x", "hidden")
            .style("padding-top", `0px`)
            .style("position", "relative");

        this.loadingOverlay = this.scrollableContainer.append("div")
            .attr("class", "loading-overlay")
            .style("position", "absolute")
            .style("top", "0")
            .style("left", "0")
            .style("width", "100%")
            .style("height", "100%")
            .style("display", "none")
            .style("align-items", "center")
            .style("justify-content", "center")
            .style("flex-direction", "column")
            .style("background", "rgba(255,255,255,0.92)")
            .style("backdrop-filter", "blur(2px)")
            .style("z-index", "50");

        const overlayContent = this.loadingOverlay.append("div")
            .style("min-width", "260px")
            .style("padding", "12px 16px")
            .style("border-radius", "10px")
            .style("box-shadow", "0 4px 12px rgba(0,0,0,0.12)")
            .style("background", "#ffffff")
            .style("display", "flex")
            .style("flex-direction", "column")
            .style("gap", "10px");

        this.loadingText = overlayContent.append("div")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", "13px")
            .style("color", "#323130")
            .style("font-weight", "600")
            .text("Loading data…");

        this.loadingRowsText = overlayContent.append("div")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", "20px")
            .style("color", "#0078D4")
            .style("font-weight", "700")
            .style("text-align", "center")
            .style("margin", "4px 0")
            .text("0 rows");

        const barTrack = overlayContent.append("div")
            .style("height", "6px")
            .style("width", "100%")
            .style("border-radius", "999px")
            .style("background", "#f3f2f1")
            .style("overflow", "hidden");

        barTrack.append("div")
            .style("height", "100%")
            .style("width", "35%")
            .style("border-radius", "999px")
            .style("background", "linear-gradient(90deg, #0078D4, #1890F5)")
            .style("animation", "loadingBarPulse 1.2s ease-in-out infinite")
            .style("transform", "translateX(-30%)");

        this.loadingProgressText = overlayContent.append("div")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", "11px")
            .style("color", "#605E5C")
            .style("text-align", "center")
            .text("");

        if (!document.getElementById("loading-bar-pulse-style")) {
            const styleEl = document.createElement("style");
            styleEl.id = "loading-bar-pulse-style";
            styleEl.textContent = `@keyframes loadingBarPulse { 0% { transform: translateX(-40%); } 50% { transform: translateX(20%); } 100% { transform: translateX(100%); } } @keyframes loadingBarDeterminate { from { width: 0%; } }`;
            document.head.appendChild(styleEl);
        }

        this.mainSvg = this.scrollableContainer.append("svg")
            .classed("criticalPathVisual", true)
            .style("display", "block");

        this.mainGroup = this.mainSvg.append("g").classed("main-group", true);

        const defs = this.mainSvg.append("defs");
        this.chartClipPath = defs.append("clipPath")
            .attr("id", "chart-area-clip");
        this.chartClipRect = this.chartClipPath.append("rect")
            .attr("x", 0)
            .attr("y", 0)
            .attr("width", 1000)
            .attr("height", 10000);

        this.gridLayer = this.mainGroup.append("g")
            .attr("class", "grid-layer")
            .attr("clip-path", "url(#chart-area-clip)");

        this.labelGridLayer = this.mainGroup.append("g")
            .attr("class", "label-grid-layer");
        this.arrowLayer = this.mainGroup.append("g")
            .attr("class", "arrow-layer")
            .attr("clip-path", "url(#chart-area-clip)");
        this.taskLayer = this.mainGroup.append("g")
            .attr("class", "task-layer")
            .attr("clip-path", "url(#chart-area-clip)");

        this.taskLabelLayer = this.mainGroup.append("g")
            .attr("class", "task-label-layer");

        this.createZoomSliderUI(visualWrapper);

        this.legendContainer = visualWrapper.append("div")
            .attr("class", "sticky-legend-footer")
            .style("width", "100%")
            .style("height", `${this.legendFooterHeight}px`)
            .style("min-height", `${this.legendFooterHeight}px`)
            .style("flex-shrink", "0")
            .style("z-index", "100")
            .style("background-color", "white")
            .style("border-top", "2px solid #e0e0e0")
            .style("box-shadow", "0 -2px 4px rgba(0,0,0,0.1)")
            .style("display", "none")
            .style("overflow", "hidden");

        this.canvasElement = document.createElement('canvas');
        this.canvasElement.style.position = 'absolute';
        this.canvasElement.style.pointerEvents = 'auto';
        this.canvasElement.className = 'canvas-layer';
        this.canvasElement.style.display = 'none';
        this.canvasElement.style.visibility = 'hidden';

        this.canvasElement.style.imageRendering = '-webkit-optimize-contrast';
        this.canvasElement.style.imageRendering = 'crisp-edges';
        (this.canvasElement.style as any).msInterpolationMode = 'nearest-neighbor';
        this.canvasElement.style.transform = 'translate3d(0,0,0)';
        this.canvasElement.style.backfaceVisibility = 'hidden';
        this.canvasElement.style.webkitBackfaceVisibility = 'hidden';
        this.canvasElement.style.willChange = 'transform';
        this.canvasElement.style.perspective = '1000px';

        this.scrollableContainer.node()?.appendChild(this.canvasElement);

        this.canvasLayer = d3.select(this.canvasElement);

        this.applyPublishModeOptimizations();

        d3.select("body").selectAll(`.${this.tooltipClassName}`).remove();

        this.tooltipDiv = d3.select("body").append("div")
            .attr("class", `critical-path-tooltip ${this.tooltipClassName}`)
            .style("position", "absolute")
            .style("visibility", "hidden")
            .style("background-color", "white")
            .style("border", "1px solid #ddd")
            .style("border-radius", "5px")
            .style("padding", "10px")
            .style("box-shadow", "0 2px 10px rgba(0,0,0,0.2)")
            .style("pointer-events", "none")
            .style("z-index", "1000")
            .style("max-width", "300px")
            .style("font-size", "12px")
            .style("line-height", "1.4")
            .style("color", "#333");

        const existingLiveRegion = d3.select("body").select(".sr-live-region");
        if (existingLiveRegion.empty()) {
            d3.select("body").append("div")
                .attr("class", "sr-live-region")
                .attr("aria-live", "polite")
                .attr("aria-atomic", "true")
                .style("position", "absolute")
                .style("left", "-10000px")
                .style("width", "1px")
                .style("height", "1px")
                .style("overflow", "hidden");
        }

        this.traceMode = "backward";

        this.createConnectorLinesToggleButton();

        d3.select(this.canvasElement).on("click", (event: MouseEvent) => {
            if (!this.useCanvasRendering || !this.xScale || !this.yScale || !this.canvasElement) return;

            const coords = this.getCanvasMouseCoordinates(event);
            const clickedTask = this.getTaskAtCanvasPoint(coords.x, coords.y);

            if (clickedTask) {
                if (this.selectedTaskId === clickedTask.internalId) {
                    this.selectTask(null, null);
                } else {
                    this.selectTask(clickedTask.internalId, clickedTask.name);
                }

                if (this.dropdownInput) {
                    this.dropdownInput.property("value", this.selectedTaskName || "");
                }
            }
        });

        d3.select(this.canvasElement).on("contextmenu", (event: MouseEvent) => {
            if (!this.useCanvasRendering || !this.xScale || !this.yScale || !this.canvasElement) return;

            const coords = this.getCanvasMouseCoordinates(event);
            const clickedTask = this.getTaskAtCanvasPoint(coords.x, coords.y);
            if (clickedTask) {
                this.showContextMenu(event, clickedTask);
            }
        });

        d3.select(this.canvasElement).on("mousemove", (event: MouseEvent) => {
            if (!this.useCanvasRendering || !this.xScale || !this.yScale || !this.canvasElement) return;

            const showTooltips = this.settings.generalSettings.showTooltips.value;
            const coords = this.getCanvasMouseCoordinates(event);
            const hoveredTask = this.getTaskAtCanvasPoint(coords.x, coords.y);
            const previousHoveredId = this.hoveredTaskId;
            const nextHoveredId = hoveredTask ? hoveredTask.internalId : null;

            this.setHoveredTask(nextHoveredId);

            if (hoveredTask) {
                if (showTooltips) {
                    if (previousHoveredId === hoveredTask.internalId) {
                        this.moveTaskTooltip(event);
                    } else {
                        this.showTaskTooltip(hoveredTask, event);
                    }
                }
                d3.select(this.canvasElement).style("cursor", "pointer");
            } else {
                if (showTooltips) {
                    this.hideTooltip();
                }
                d3.select(this.canvasElement).style("cursor", "default");
            }
        });

        d3.select(this.canvasElement).on("mouseout", () => {
            this.setHoveredTask(null);
            this.hideTooltip();
            d3.select(this.canvasElement).style("cursor", "default");
        });
    }

    private forceCanvasRefresh(): void {
        this.debugLog("Forcing canvas refresh");

        if (this.canvasElement && this.canvasContext) {
            this.canvasContext.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
        }

        if (this.taskLayer) {
            this.taskLayer.selectAll("*").remove();
        }
        if (this.arrowLayer) {
            this.arrowLayer.selectAll("*").remove();
        }
        if (this.taskLabelLayer) {
            this.taskLabelLayer.selectAll("*").remove();
        }
        if (this.labelGridLayer) {
            this.labelGridLayer.selectAll("*").remove();
        }

        if (this.wbsGroupLayer) {
            this.wbsGroupLayer.selectAll('.wbs-group-header').remove();
        }

        if (this.scrollableContainer?.node() && this.allTasksToShow?.length > 0) {
            this.calculateVisibleTasks();

            if (this.xScale && this.yScale) {
                requestAnimationFrame(() => {
                    this.redrawVisibleTasks();
                });
            }
        }
    }

    private debouncedUpdate(): void {
        if (this.updateDebounceTimeout) {
            clearTimeout(this.updateDebounceTimeout);
        }

        this.updateDebounceTimeout = setTimeout(() => {
            if (this.pendingUpdate) {
                const options = this.pendingUpdate;
                this.pendingUpdate = null;
                this.update(options);
            }
            this.updateDebounceTimeout = null;
        }, this.UPDATE_DEBOUNCE_MS);
    }

    private requestUpdate(forceFullUpdate: boolean = false): void {
        if (!this.lastUpdateOptions) {
            console.error("Cannot trigger update - lastUpdateOptions is null.");
            return;
        }

        if (forceFullUpdate) {
            this.forceFullUpdate = true;
        }

        this.pendingUpdate = this.lastUpdateOptions;
        this.debouncedUpdate();
    }

    private applyPublishModeOptimizations(): void {

        const isInIframe = window.self !== window.top;

        if (isInIframe || window.location.hostname.includes('powerbi.com')) {

            const styleId = 'critical-path-publish-fixes';
            if (!document.getElementById(styleId)) {
                const style = document.createElement('style');
                style.id = styleId;
                style.textContent = `
                .criticalPathVisual {
                    -webkit-font-smoothing: antialiased !important;
                    -moz-osx-font-smoothing: grayscale !important;
                    text-rendering: optimizeLegibility !important;
                }
                .criticalPathVisual text {
                    text-rendering: geometricPrecision !important;
                    shape-rendering: crispEdges !important;
                }
                .criticalPathVisual .canvas-layer {
                    image-rendering: -webkit-optimize-contrast !important;
                    image-rendering: crisp-edges !important;
                    -ms-interpolation-mode: nearest-neighbor !important;
                    transform: translateZ(0) !important;
                    backface-visibility: hidden !important;
                    -webkit-backface-visibility: hidden !important;
                    perspective: 1000px !important;
                }
                .visual-wrapper {
                    transform: translateZ(0) !important;
                    will-change: transform !important;
                }
                .sticky-header-container {
                    transform: translateZ(0) !important;
                    -webkit-transform: translateZ(0) !important;
                }
                svg rect, svg path, svg line {
                    shape-rendering: crispEdges !important;
                    vector-effect: non-scaling-stroke !important;
                }
            `;
                document.head.appendChild(style);
            }

            if (this.target) {
                this.target.style.zoom = '1';
                (this.target.style as any).imageRendering = '-webkit-optimize-contrast';
            }
        }
    }

    private setupSVGRenderingHints(): void {

        if (this.mainSvg) {
            this.mainSvg
                .attr("shape-rendering", "crispEdges")
                .attr("text-rendering", "optimizeLegibility");
        }

        if (this.headerSvg) {
            this.headerSvg
                .attr("shape-rendering", "crispEdges")
                .attr("text-rendering", "optimizeLegibility");
        }

        [this.mainGroup, this.gridLayer, this.arrowLayer, this.taskLayer,
        this.headerGridLayer, this.toggleButtonGroup].forEach(group => {
            if (group) {
                group.attr("shape-rendering", "geometricPrecision");
            }
        });
    }

    private getDataSignature(dataView: DataView): string {
        const rowCount = dataView.table?.rows?.length ?? 0;
        const columnKey = dataView.metadata?.columns
            ? dataView.metadata.columns.map(col => col.queryName || col.displayName || "").join("|")
            : "";
        return `${rowCount}|${columnKey}`;
    }

    private hasValidPlotDates(task: Task): boolean {
        return task.startDate instanceof Date && !isNaN(task.startDate.getTime()) &&
            task.finishDate instanceof Date && !isNaN(task.finishDate.getTime()) &&
            task.finishDate >= task.startDate;
    }

    private ensureTaskSortCache(signature: string): void {
        if (this.cachedSortedTasksSignature === signature) {
            return;
        }

        const sortedByStartDate = this.allTasksData
            .filter(task => task.startDate instanceof Date && !isNaN(task.startDate.getTime()))
            .sort((a, b) => (a.startDate?.getTime() ?? 0) - (b.startDate?.getTime() ?? 0));

        this.cachedTasksSortedByStartDate = sortedByStartDate;
        this.cachedPlottableTasksSorted = sortedByStartDate.filter(task => this.hasValidPlotDates(task));
        this.cachedSortedTasksSignature = signature;
    }

    private determineUpdateType(options: VisualUpdateOptions): UpdateType {

        const wasForced = this.forceFullUpdate;
        try {
            this.forceFullUpdate = false;

            if (wasForced) {
                this.debugLog("Force full update requested");
                return UpdateType.Full;
            }

            if (!this.lastUpdateOptions) {
                return UpdateType.Full;
            }

            let dataChanged = false;
            let settingsChanged = false;
            let viewportChanged = false;

            if (options.type & VisualUpdateType.Data) {
                dataChanged = true;
                this.debugLog("Data change detected via PBI flags (e.g., external filter).");
            }
            if (options.type & VisualUpdateType.Resize) {
                viewportChanged = true;
            }
            if ((options.type & VisualUpdateType.Style) ||
                (options.type & VisualUpdateType.ViewMode)) {
                settingsChanged = true;
            }

            if (!dataChanged) {
                const currentDataView = options.dataViews?.[0];
                const lastDataView = this.lastUpdateOptions.dataViews?.[0];

                if (currentDataView && lastDataView) {
                    const currentRowCount = currentDataView.table?.rows?.length || 0;
                    const lastRowCount = lastDataView.table?.rows?.length || 0;
                    if (currentRowCount !== lastRowCount) {
                        dataChanged = true;
                        this.debugLog("Data change detected via row count mismatch.");
                    }
                } else if (currentDataView !== lastDataView) {
                    dataChanged = true;
                }
            }

            if (!viewportChanged) {
                viewportChanged = this.lastViewport ?
                    (options.viewport.width !== this.lastViewport.width ||
                        options.viewport.height !== this.lastViewport.height) : true;
            }

            let isSignificantViewportChange = false;
            if (this.lastViewport && viewportChanged) {
                const widthChangeRatio = Math.abs(options.viewport.width - this.lastViewport.width) / (this.lastViewport.width || 1);
                const heightChangeRatio = Math.abs(options.viewport.height - this.lastViewport.height) / (this.lastViewport.height || 1);
                isSignificantViewportChange = widthChangeRatio > this.VIEWPORT_CHANGE_THRESHOLD ||
                    heightChangeRatio > this.VIEWPORT_CHANGE_THRESHOLD;
            }

            if (dataChanged) {
                return UpdateType.Full;
            } else if (isSignificantViewportChange) {
                this.debugLog("Significant viewport change detected - treating as full update");
                return UpdateType.Full;
            } else if (viewportChanged && !dataChanged && !settingsChanged) {
                return UpdateType.ViewportOnly;
            } else if (settingsChanged && !dataChanged) {
                return UpdateType.SettingsOnly;
            }

            if (settingsChanged || viewportChanged) {
                return UpdateType.Full;
            }

            return UpdateType.Full;
        } finally {

            this.forceFullUpdate = false;
        }
    }

    public destroy(): void {

        if (this.updateDebounceTimeout) {
            clearTimeout(this.updateDebounceTimeout);
            this.updateDebounceTimeout = null;
        }

        if (this.scrollThrottleTimeout) {
            clearTimeout(this.scrollThrottleTimeout);
            this.scrollThrottleTimeout = null;
        }

        if (this.dropdownFilterTimeout) {
            clearTimeout(this.dropdownFilterTimeout);
            this.dropdownFilterTimeout = null;
        }

        d3.select("body").selectAll(`.${this.tooltipClassName}`).remove();

        if (this.scrollListener && this.scrollableContainer) {
            this.scrollableContainer.on("scroll", null);
            this.scrollListener = null;
        }

        this.detachZoomDragListeners();

        this.pendingUpdate = null;

        this.applyTaskFilter([]);

        const styleId = 'critical-path-publish-fixes';
        const styleElement = document.getElementById(styleId);
        if (styleElement) {
            styleElement.remove();
        }

        this.debugLog("Critical Path Visual destroyed.");
    }

    private captureScrollPosition(): void {
        if (this.scrollableContainer?.node()) {
            this.preservedScrollTop = this.scrollableContainer.node().scrollTop;
            this.preserveScrollOnUpdate = true;
            this.scrollPreservationUntil = Date.now() + 1500;
            this.debugLog(`Scroll position captured: ${this.preservedScrollTop}`);
        }
    }

    private setHoveredTask(taskId: string | null): void {
        const nextTaskId = taskId ?? null;
        if (this.hoveredTaskId === nextTaskId) {
            return;
        }
        this.hoveredTaskId = nextTaskId;
        this.updateConnectorHoverStyles();
    }

    private isRelationshipHovered(rel: Relationship): boolean {
        return this.hoveredTaskId !== null &&
            (rel.predecessorId === this.hoveredTaskId || rel.successorId === this.hoveredTaskId);
    }

    private getConnectorOpacity(rel: Relationship): number {
        if (!this.hoveredTaskId) {
            return rel.isCritical ? 0.85 : 0.35;
        }
        return this.isRelationshipHovered(rel)
            ? (rel.isCritical ? 0.95 : 0.85)
            : 0.12;
    }

    private updateConnectorHoverStyles(): void {
        if (!this.showConnectorLinesInternal || this.useCanvasRendering || !this.arrowLayer) {
            return;
        }

        this.arrowLayer.selectAll<SVGPathElement, Relationship>(".relationship-arrow")
            .style("stroke-opacity", (d: Relationship) => this.getConnectorOpacity(d));

        this.arrowLayer.selectAll<SVGCircleElement, Relationship>(".connection-dot-start, .connection-dot-end")
            .style("fill-opacity", (d: Relationship) => this.getConnectorOpacity(d))
            .style("stroke-opacity", 0.6);
    }

    private toggleTaskDisplayInternal(): void {
        try {
            this.debugLog("Internal Toggle method called!");
            this.showAllTasksInternal = !this.showAllTasksInternal;
            this.debugLog("New showAllTasksInternal value:", this.showAllTasksInternal);

            this.host.persistProperties({
                merge: [{
                    objectName: "criticalPath",
                    properties: { showAllTasks: this.showAllTasksInternal },
                    selector: null
                }]
            });

            this.forceCanvasRefresh();

            this.captureScrollPosition();

            this.forceFullUpdate = true;
            if (this.lastUpdateOptions) {
                this.update(this.lastUpdateOptions);
            }

            this.drawZoomSliderMiniChart();

            this.debugLog("Visual update triggered by internal toggle");
        } catch (error) {
            console.error("Error in internal toggle method:", error);
        }
    }

    private toggleBaselineDisplayInternal(): void {
        try {
            this.debugLog("Baseline Toggle method called!");
            this.showBaselineInternal = !this.showBaselineInternal;
            this.debugLog("New showBaselineInternal value:", this.showBaselineInternal);

            this.createOrUpdateBaselineToggleButton(this.lastUpdateOptions?.viewport.width || 800);

            this.host.persistProperties({
                merge: [{
                    objectName: "comparisonBars",
                    properties: { showBaseline: this.showBaselineInternal },
                    selector: null
                }]
            });

            if (this.scrollableContainer?.node()) {
                this.preservedScrollTop = this.scrollableContainer.node().scrollTop;
                this.debugLog(`Baseline toggle: Captured scrollTop=${this.preservedScrollTop}`);
            }

            this.forceFullUpdate = true;
            this.preserveScrollOnUpdate = true;

            this.scrollPreservationUntil = Date.now() + 1500;

            if (this.scrollThrottleTimeout) {
                clearTimeout(this.scrollThrottleTimeout);
                this.scrollThrottleTimeout = null;
            }

            if (this.lastUpdateOptions) {
                this.update(this.lastUpdateOptions);
            }

            this.debugLog("Visual update triggered by baseline toggle");
        } catch (error) {
            console.error("Error in baseline toggle method:", error);
        }
    }

    private togglePreviousUpdateDisplayInternal(): void {
        try {
            this.debugLog("Previous Update Toggle method called!");
            this.showPreviousUpdateInternal = !this.showPreviousUpdateInternal;
            this.debugLog("New showPreviousUpdateInternal value:", this.showPreviousUpdateInternal);

            this.createOrUpdatePreviousUpdateToggleButton(this.lastUpdateOptions?.viewport.width || 800);

            this.host.persistProperties({
                merge: [{
                    objectName: "comparisonBars",
                    properties: { showPreviousUpdate: this.showPreviousUpdateInternal },
                    selector: null
                }]
            });

            if (this.scrollableContainer?.node()) {
                this.preservedScrollTop = this.scrollableContainer.node().scrollTop;
                this.debugLog(`Previous update toggle: Captured scrollTop=${this.preservedScrollTop}`);
            }

            this.forceFullUpdate = true;
            this.preserveScrollOnUpdate = true;

            this.scrollPreservationUntil = Date.now() + 1500;

            if (this.scrollThrottleTimeout) {
                clearTimeout(this.scrollThrottleTimeout);
                this.scrollThrottleTimeout = null;
            }

            if (this.lastUpdateOptions) {
                this.update(this.lastUpdateOptions);
            }

            this.debugLog("Visual update triggered by previous update toggle");
        } catch (error) {
            console.error("Error in previous update toggle method:", error);
        }
    }

    private createOrUpdateToggleButton(viewportWidth: number): void {
        if (!this.toggleButtonGroup || !this.headerSvg) return;

        this.toggleButtonGroup.selectAll("*")
            .on("click", null)
            .on("mouseover", null)
            .on("mouseout", null);

        this.toggleButtonGroup.selectAll("*").remove();

        const layout = this.getHeaderButtonLayout(viewportWidth);
        const buttonWidth = layout.showAllCritical.width;
        const buttonHeight = this.UI_TOKENS.height.standard;
        const buttonX = layout.showAllCritical.x;
        const buttonY = this.UI_TOKENS.spacing.sm;

        const isShowingCritical = this.showAllTasksInternal;

        this.toggleButtonGroup
            .attr("transform", `translate(${buttonX}, ${buttonY})`)
            .attr("role", "button")
            .attr("aria-label", isShowingCritical ? "Show critical path only" : "Show all tasks")
            .attr("aria-pressed", (!isShowingCritical).toString())
            .attr("tabindex", "0");

        const buttonRect = this.toggleButtonGroup.append("rect")
            .attr("width", buttonWidth)
            .attr("height", buttonHeight)
            .attr("rx", this.UI_TOKENS.radius.medium)
            .attr("ry", this.UI_TOKENS.radius.medium)
            .style("fill", this.UI_TOKENS.color.neutral.white)
            .style("stroke", this.UI_TOKENS.color.neutral.grey60)
            .style("stroke-width", 1.5)
            .style("filter", `drop-shadow(${this.UI_TOKENS.shadow[2]})`)
            .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

        const iconPadding = this.UI_TOKENS.spacing.lg;
        const iconColor = isShowingCritical
            ? this.UI_TOKENS.color.danger.default
            : this.UI_TOKENS.color.success.default;

        this.toggleButtonGroup.append("circle")
            .attr("cx", iconPadding)
            .attr("cy", buttonHeight / 2)
            .attr("r", 10)
            .style("fill", isShowingCritical ? this.UI_TOKENS.color.danger.subtle : this.UI_TOKENS.color.success.subtle)
            .style("pointer-events", "none")
            .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

        this.toggleButtonGroup.append("path")
            .attr("d", isShowingCritical
                ? "M2.5,-1.5 L5,-3.5 L7.5,-1.5 L7.5,0 L5,2 L2.5,0 Z"
                : "M1.5,-3 L8,-3 M1.5,0 L8.5,0 M1.5,3 L8,3")
            .attr("transform", `translate(${iconPadding}, ${buttonHeight / 2})`)
            .attr("stroke", iconColor)
            .attr("stroke-width", 2.25)
            .attr("fill", isShowingCritical ? iconColor : "none")
            .attr("stroke-linecap", "round")
            .attr("stroke-linejoin", "round")
            .style("pointer-events", "none")
            .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

        const buttonText = layout.mode === 'narrow'
            ? (isShowingCritical ? "Critical" : "All")
            : (isShowingCritical ? "Show Critical" : "Show All");

        this.toggleButtonGroup.append("text")
            .attr("x", buttonWidth / 2 + this.UI_TOKENS.spacing.md)
            .attr("y", buttonHeight / 2)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .style("font-family", "Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif")
            .style("font-size", `${this.UI_TOKENS.fontSize.md}px`)
            .style("fill", this.UI_TOKENS.color.neutral.grey160)
            .style("font-weight", this.UI_TOKENS.fontWeight.semibold.toString())
            .style("letter-spacing", "0.2px")
            .style("pointer-events", "none")
            .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`)
            .text(buttonText);

        const self = this;
        this.toggleButtonGroup
            .on("mouseover", function () {
                d3.select(this).select("rect")
                    .style("fill", self.UI_TOKENS.color.neutral.grey10)
                    .style("stroke", self.UI_TOKENS.color.neutral.grey90)
                    .style("stroke-width", 2)
                    .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[8]})`);
            })
            .on("mouseout", function () {
                d3.select(this).select("rect")
                    .style("fill", self.UI_TOKENS.color.neutral.white)
                    .style("stroke", self.UI_TOKENS.color.neutral.grey60)
                    .style("stroke-width", 1.5)
                    .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[2]})`);
            })
            .on("mousedown", function () {
                d3.select(this).select("rect")
                    .style("transform", "scale(0.96)")
                    .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[4]})`);
            })
            .on("mouseup", function () {
                d3.select(this).select("rect")
                    .style("transform", "scale(1)")
                    .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[8]})`);
            });

        const clickOverlay = this.toggleButtonGroup.append("rect")
            .attr("width", buttonWidth)
            .attr("height", buttonHeight)
            .attr("rx", this.UI_TOKENS.radius.medium)
            .attr("ry", this.UI_TOKENS.radius.medium)
            .style("fill", "transparent")
            .style("cursor", "pointer");

        clickOverlay.on("click", function (event) {
            if (event) event.stopPropagation();
            self.toggleTaskDisplayInternal();
        });

        this.toggleButtonGroup.on("keydown", function (event) {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                self.toggleTaskDisplayInternal();
            }
        });

        this.toggleButtonGroup.append("title")
            .text(isShowingCritical
                ? "Click to filter and show only critical path tasks"
                : "Click to show all tasks in the project");
    }

    private createOrUpdateBaselineToggleButton(viewportWidth: number): void {
        if (!this.headerSvg) return;

        this.headerSvg.selectAll(".baseline-toggle-group").remove();

        const dataView = this.lastUpdateOptions?.dataViews?.[0];
        const hasBaselineStart = dataView ? this.hasDataRole(dataView, 'baselineStartDate') : false;
        const hasBaselineFinish = dataView ? this.hasDataRole(dataView, 'baselineFinishDate') : false;
        const isAvailable = hasBaselineStart && hasBaselineFinish;

        const baselineColor = this.settings.comparisonBars.baselineColor.value.value;
        const lightBaselineColor = this.lightenColor(baselineColor, 0.93);
        const hoverBaselineColor = this.lightenColor(baselineColor, 0.85);
        const previousUpdateColor = this.settings.comparisonBars.previousUpdateColor.value.value;

        const layout = this.getHeaderButtonLayout(viewportWidth);
        const { x: buttonX, width: buttonWidth, iconOnly } = layout.baseline;

        const baselineToggleGroup = this.headerSvg.append("g")
            .attr("class", "baseline-toggle-group")
            .style("cursor", isAvailable ? "pointer" : "not-allowed")
            .attr("role", "button")
            .attr("aria-label", `${this.showBaselineInternal ? 'Hide' : 'Show'} baseline task bars`)
            .attr("aria-pressed", this.showBaselineInternal.toString())
            .attr("aria-disabled", (!isAvailable).toString())
            .attr("tabindex", isAvailable ? "0" : "-1");

        const buttonHeight = this.UI_TOKENS.height.standard;
        const buttonY = this.UI_TOKENS.spacing.sm;

        baselineToggleGroup.attr("transform", `translate(${buttonX}, ${buttonY})`);

        const buttonRect = baselineToggleGroup.append("rect")
            .attr("width", buttonWidth)
            .attr("height", buttonHeight)
            .attr("rx", this.UI_TOKENS.radius.medium)
            .attr("ry", this.UI_TOKENS.radius.medium)
            .style("fill", this.showBaselineInternal ? lightBaselineColor : this.UI_TOKENS.color.neutral.white)
            .style("stroke", baselineColor)
            .style("stroke-width", this.showBaselineInternal ? 2 : 1.5)
            .style("opacity", isAvailable ? 1 : 0.4)
            .style("filter", isAvailable ? `drop-shadow(${this.UI_TOKENS.shadow[2]})` : "none")
            .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

        const iconX = iconOnly ? (buttonWidth / 2 - 8) : (this.UI_TOKENS.spacing.lg + 2);
        const iconY = buttonHeight / 2;

        const iconG = baselineToggleGroup.append("g")
            .attr("class", "icon-group")
            .attr("transform", `translate(${iconX}, ${iconY})`);

        iconG.append("rect")
            .attr("class", "icon-rect-1")
            .attr("x", 0)
            .attr("y", -8)
            .attr("width", 16)
            .attr("height", 4.5)
            .attr("rx", 2)
            .attr("ry", 2)
            .attr("fill", this.showBaselineInternal ? this.UI_TOKENS.color.primary.default : this.UI_TOKENS.color.neutral.grey90)
            .style("pointer-events", "none")
            .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

        iconG.append("rect")
            .attr("class", "icon-rect-2")
            .attr("x", 0)
            .attr("y", -1.5)
            .attr("width", 16)
            .attr("height", 3.5)
            .attr("rx", 1.5)
            .attr("ry", 1.5)
            .attr("fill", this.showBaselineInternal ? previousUpdateColor : this.UI_TOKENS.color.neutral.grey60)
            .style("opacity", this.showBaselineInternal ? 1 : 0.6)
            .style("pointer-events", "none")
            .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

        iconG.append("rect")
            .attr("class", "icon-rect-3")
            .attr("x", 0)
            .attr("y", 4)
            .attr("width", 16)
            .attr("height", 3.5)
            .attr("rx", 1.5)
            .attr("ry", 1.5)
            .attr("fill", this.showBaselineInternal ? baselineColor : this.UI_TOKENS.color.neutral.grey60)
            .style("opacity", this.showBaselineInternal ? 1 : 0.6)
            .style("pointer-events", "none")
            .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

        if (!iconOnly) {
            baselineToggleGroup.append("text")
                .attr("class", "toggle-text")
                .attr("x", iconX + 26)
                .attr("y", buttonHeight / 2)
                .attr("dominant-baseline", "central")
                .style("font-family", "Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif")
                .style("font-size", `${this.UI_TOKENS.fontSize.md}px`)
                .style("fill", this.UI_TOKENS.color.neutral.grey160)
                .style("font-weight", this.showBaselineInternal ? this.UI_TOKENS.fontWeight.semibold : this.UI_TOKENS.fontWeight.medium)
                .style("letter-spacing", "0.2px")
                .style("pointer-events", "none")
                .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`)
                .text("Baseline");
        }

        baselineToggleGroup.append("title")
            .text(isAvailable
                ? (this.showBaselineInternal ? "Click to hide baseline task bars" : "Click to show baseline task bars below main bars")
                : "Requires Baseline Start Date and Baseline Finish Date fields to be mapped");

        if (isAvailable) {
            const self = this;

            baselineToggleGroup
                .on("mouseover", function () {
                    d3.select(this).select("rect")
                        .style("fill", self.showBaselineInternal ? hoverBaselineColor : self.UI_TOKENS.color.neutral.grey10)
                        .style("stroke-width", 2.5)
                        .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[8]})`);

                    if (self.showBaselineInternal) {
                        d3.select(this).selectAll(".icon-rect-1, .icon-rect-2, .icon-rect-3, .toggle-text")
                            .style("fill", self.UI_TOKENS.color.neutral.white);
                    }
                })
                .on("mouseout", function () {
                    d3.select(this).select("rect")
                        .style("fill", self.showBaselineInternal ? lightBaselineColor : self.UI_TOKENS.color.neutral.white)
                        .style("stroke-width", self.showBaselineInternal ? 2 : 1.5)
                        .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[2]})`);

                    if (self.showBaselineInternal) {
                        const group = d3.select(this);
                        group.select(".icon-rect-1").style("fill", self.UI_TOKENS.color.primary.default);
                        group.select(".icon-rect-2").style("fill", previousUpdateColor);
                        group.select(".icon-rect-3").style("fill", baselineColor);
                        group.select(".toggle-text").style("fill", self.UI_TOKENS.color.neutral.grey160);
                    }
                })
                .on("mousedown", function () {
                    d3.select(this).select("rect")
                        .style("transform", "scale(0.96)")
                        .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[4]})`);
                })
                .on("mouseup", function () {
                    d3.select(this).select("rect")
                        .style("transform", "scale(1)")
                        .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[8]})`);
                });

            baselineToggleGroup.on("click", function (event) {
                if (event) event.stopPropagation();
                self.toggleBaselineDisplayInternal();
            });

            baselineToggleGroup.on("keydown", function (event) {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    self.toggleBaselineDisplayInternal();
                }
            });
        }
    }

    private createOrUpdatePreviousUpdateToggleButton(viewportWidth: number): void {
        if (!this.headerSvg) return;

        this.headerSvg.selectAll(".previous-update-toggle-group").remove();

        const dataView = this.lastUpdateOptions?.dataViews?.[0];
        const hasPreviousUpdateStart = dataView ? this.hasDataRole(dataView, 'previousUpdateStartDate') : false;
        const hasPreviousUpdateFinish = dataView ? this.hasDataRole(dataView, 'previousUpdateFinishDate') : false;
        const isAvailable = hasPreviousUpdateStart && hasPreviousUpdateFinish;

        const previousUpdateColor = this.settings.comparisonBars.previousUpdateColor.value.value;
        const lightPreviousUpdateColor = this.lightenColor(previousUpdateColor, 0.90);
        const hoverPreviousUpdateColor = this.lightenColor(previousUpdateColor, 0.80);
        const baselineColor = this.settings.comparisonBars.baselineColor.value.value;

        const layout = this.getHeaderButtonLayout(viewportWidth);
        const { x: buttonX, width: buttonWidth, iconOnly } = layout.previousUpdate;

        const previousUpdateToggleGroup = this.headerSvg.append("g")
            .attr("class", "previous-update-toggle-group")
            .style("cursor", isAvailable ? "pointer" : "not-allowed")
            .attr("role", "button")
            .attr("aria-label", `${this.showPreviousUpdateInternal ? 'Hide' : 'Show'} previous update task bars`)
            .attr("aria-pressed", this.showPreviousUpdateInternal.toString())
            .attr("aria-disabled", (!isAvailable).toString())
            .attr("tabindex", isAvailable ? "0" : "-1");

        const buttonHeight = this.UI_TOKENS.height.standard;
        const buttonY = this.UI_TOKENS.spacing.sm;

        previousUpdateToggleGroup.attr("transform", `translate(${buttonX}, ${buttonY})`);

        const buttonRect = previousUpdateToggleGroup.append("rect")
            .attr("width", buttonWidth)
            .attr("height", buttonHeight)
            .attr("rx", this.UI_TOKENS.radius.medium)
            .attr("ry", this.UI_TOKENS.radius.medium)
            .style("fill", this.showPreviousUpdateInternal ? lightPreviousUpdateColor : this.UI_TOKENS.color.neutral.white)
            .style("stroke", previousUpdateColor)
            .style("stroke-width", this.showPreviousUpdateInternal ? 2 : 1.5)
            .style("opacity", isAvailable ? 1 : 0.4)
            .style("filter", isAvailable ? `drop-shadow(${this.UI_TOKENS.shadow[2]})` : "none")
            .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

        const iconX = iconOnly ? (buttonWidth / 2 - 8) : this.UI_TOKENS.spacing.lg;
        const iconY = buttonHeight / 2;

        const iconG = previousUpdateToggleGroup.append("g")
            .attr("class", "icon-group")
            .attr("transform", `translate(${iconX}, ${iconY})`);

        iconG.append("rect")
            .attr("class", "icon-rect-1")
            .attr("x", 0)
            .attr("y", -7)
            .attr("width", 16)
            .attr("height", 4)
            .attr("rx", 1.5)
            .attr("ry", 1.5)
            .attr("fill", this.showPreviousUpdateInternal ? this.UI_TOKENS.color.primary.default : this.UI_TOKENS.color.neutral.grey90)
            .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

        iconG.append("rect")
            .attr("class", "icon-rect-2")
            .attr("x", 0)
            .attr("y", -1)
            .attr("width", 16)
            .attr("height", 3)
            .attr("rx", 1)
            .attr("ry", 1)
            .attr("fill", this.showPreviousUpdateInternal ? previousUpdateColor : this.UI_TOKENS.color.neutral.grey60)
            .style("opacity", this.showPreviousUpdateInternal ? 1 : 0.6)
            .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

        iconG.append("rect")
            .attr("class", "icon-rect-3")
            .attr("x", 0)
            .attr("y", 4)
            .attr("width", 16)
            .attr("height", 3)
            .attr("rx", 1)
            .attr("ry", 1)
            .attr("fill", this.showPreviousUpdateInternal ? baselineColor : this.UI_TOKENS.color.neutral.grey60)
            .style("opacity", this.showPreviousUpdateInternal ? 1 : 0.6)
            .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

        if (!iconOnly) {
            previousUpdateToggleGroup.append("text")
                .attr("class", "toggle-text")
                .attr("x", iconX + 24)
                .attr("y", buttonHeight / 2)
                .attr("dominant-baseline", "central")
                .style("font-family", "Segoe UI, sans-serif")
                .style("font-size", `${this.UI_TOKENS.fontSize.md}px`)
                .style("letter-spacing", "0.2px")
                .style("fill", this.UI_TOKENS.color.neutral.grey160)
                .style("font-weight", this.showPreviousUpdateInternal ? this.UI_TOKENS.fontWeight.semibold : this.UI_TOKENS.fontWeight.medium)
                .style("pointer-events", "none")
                .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`)
                .text("Prev Update");
        }

        previousUpdateToggleGroup.append("title")
            .text(isAvailable
                ? (this.showPreviousUpdateInternal ? "Click to hide previous update task bars" : "Click to show previous update task bars between main and baseline")
                : "Requires Previous Update Start Date and Previous Update Finish Date fields to be mapped");

        if (isAvailable) {
            const self = this;

            previousUpdateToggleGroup
                .on("mouseover", function () {
                    d3.select(this).select("rect")
                        .style("fill", self.showPreviousUpdateInternal ? hoverPreviousUpdateColor : self.UI_TOKENS.color.neutral.grey20)
                        .style("stroke-width", 2.5)
                        .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[8]})`);

                    if (self.showPreviousUpdateInternal) {
                        d3.select(this).selectAll(".icon-rect-1, .icon-rect-2, .icon-rect-3, .toggle-text")
                            .style("fill", self.UI_TOKENS.color.neutral.white);
                    }
                })
                .on("mouseout", function () {
                    d3.select(this).select("rect")
                        .style("fill", self.showPreviousUpdateInternal ? lightPreviousUpdateColor : self.UI_TOKENS.color.neutral.white)
                        .style("stroke-width", self.showPreviousUpdateInternal ? 2 : 1.5)
                        .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[2]})`);

                    if (self.showPreviousUpdateInternal) {
                        const group = d3.select(this);
                        group.select(".icon-rect-1").style("fill", self.UI_TOKENS.color.primary.default);
                        group.select(".icon-rect-2").style("fill", previousUpdateColor);
                        group.select(".icon-rect-3").style("fill", baselineColor);
                        group.select(".toggle-text").style("fill", self.UI_TOKENS.color.neutral.grey160);
                    }
                })
                .on("mousedown", function () {
                    d3.select(this).select("rect")
                        .style("transform", "scale(0.98)")
                        .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[4]})`);
                })
                .on("mouseup", function () {
                    d3.select(this).select("rect")
                        .style("transform", "scale(1)")
                        .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[8]})`);
                });

            previousUpdateToggleGroup.on("click", function (event) {
                if (event) event.stopPropagation();
                self.togglePreviousUpdateDisplayInternal();
            });

            previousUpdateToggleGroup.on("keydown", function (event) {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    self.togglePreviousUpdateDisplayInternal();
                }
            });
        }
    }

    private lightenColor(color: string, factor: number): string {

        const hex = color.replace('#', '');
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);

        const newR = Math.round(r + (255 - r) * factor);
        const newG = Math.round(g + (255 - g) * factor);
        const newB = Math.round(b + (255 - b) * factor);

        return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
    }

    private createConnectorLinesToggleButton(viewportWidth?: number): void {
        if (!this.headerSvg) return;

        this.headerSvg.selectAll(".connector-toggle-group").remove();

        const showConnectorToggle = this.settings?.connectorLines?.showConnectorToggle?.value ?? false;
        if (!showConnectorToggle) return;

        const layout = this.getHeaderButtonLayout(viewportWidth || 800);
        const { x: buttonX, size: buttonSize } = layout.connectorLines;

        const connectorToggleGroup = this.headerSvg.append("g")
            .attr("class", "connector-toggle-group")
            .style("cursor", "pointer")
            .attr("role", "button")
            .attr("aria-label", `${this.showConnectorLinesInternal ? 'Hide' : 'Show'} connector lines between tasks`)
            .attr("aria-pressed", this.showConnectorLinesInternal.toString())
            .attr("tabindex", "0");

        const buttonY = this.UI_TOKENS.spacing.sm;

        connectorToggleGroup.attr("transform", `translate(${buttonX}, ${buttonY})`);

        const buttonRect = connectorToggleGroup.append("rect")
            .attr("width", buttonSize)
            .attr("height", buttonSize)
            .attr("rx", this.UI_TOKENS.radius.medium)
            .attr("ry", this.UI_TOKENS.radius.medium)
            .style("fill", this.showConnectorLinesInternal
                ? this.UI_TOKENS.color.success.light
                : this.UI_TOKENS.color.neutral.white)
            .style("stroke", this.showConnectorLinesInternal
                ? this.UI_TOKENS.color.success.default
                : this.UI_TOKENS.color.neutral.grey60)
            .style("stroke-width", this.showConnectorLinesInternal ? 2 : 1.5)
            .style("filter", `drop-shadow(${this.UI_TOKENS.shadow[2]})`)
            .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

        const iconCenter = (buttonSize / 2) - 2;
        const iconG = connectorToggleGroup.append("g")
            .attr("transform", `translate(${iconCenter}, ${iconCenter})`);

        iconG.append("path")
            .attr("d", "M-6,-3 L0,3 L6,-3")
            .attr("stroke", this.showConnectorLinesInternal
                ? this.UI_TOKENS.color.success.default
                : this.UI_TOKENS.color.neutral.grey130)
            .attr("stroke-width", 2)
            .attr("fill", "none")
            .attr("stroke-linecap", "round")
            .attr("stroke-linejoin", "round")
            .attr("stroke-dasharray", this.showConnectorLinesInternal ? "none" : "3,2")
            .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

        if (this.showConnectorLinesInternal) {
            iconG.append("circle")
                .attr("cx", -6)
                .attr("cy", -3)
                .attr("r", 1.5)
                .attr("fill", this.UI_TOKENS.color.success.default);

            iconG.append("circle")
                .attr("cx", 6)
                .attr("cy", -3)
                .attr("r", 1.5)
                .attr("fill", this.UI_TOKENS.color.success.default);
        }

        connectorToggleGroup.append("title")
            .text(this.showConnectorLinesInternal
                ? "Click to hide connector lines between dependent tasks"
                : "Click to show connector lines between dependent tasks");

        const self = this;
        connectorToggleGroup
            .on("mouseover", function () {
                d3.select(this).select("rect")
                    .style("fill", self.showConnectorLinesInternal
                        ? self.UI_TOKENS.color.success.default
                        : self.UI_TOKENS.color.neutral.grey20)
                    .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[8]})`);

                if (self.showConnectorLinesInternal) {
                    d3.select(this).select("path").attr("stroke", self.UI_TOKENS.color.neutral.white);
                    d3.select(this).selectAll("circle").attr("fill", self.UI_TOKENS.color.neutral.white);
                }
            })
            .on("mouseout", function () {
                d3.select(this).select("rect")
                    .style("fill", self.showConnectorLinesInternal
                        ? self.UI_TOKENS.color.success.light
                        : self.UI_TOKENS.color.neutral.white)
                    .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[2]})`);

                if (self.showConnectorLinesInternal) {
                    d3.select(this).select("path").attr("stroke", self.UI_TOKENS.color.success.default);
                    d3.select(this).selectAll("circle").attr("fill", self.UI_TOKENS.color.success.default);
                }
            })
            .on("mousedown", function () {
                d3.select(this).select("rect")
                    .style("transform", "scale(0.95)");
            })
            .on("mouseup", function () {
                d3.select(this).select("rect")
                    .style("transform", "scale(1)");
            });

        connectorToggleGroup.on("click", function (event) {
            if (event) event.stopPropagation();
            self.toggleConnectorLinesDisplay();
        });

        connectorToggleGroup.on("keydown", function (event) {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                self.toggleConnectorLinesDisplay();
            }
        });
    }

    private toggleColumnDisplayInternal(): void {
        this.showExtraColumnsInternal = !this.showExtraColumnsInternal;
        this.debugLog(`Toggled extra columns display. New state: ${this.showExtraColumnsInternal}`);

        // Persist the change so it survives reload
        if (this.settings?.columns) {
            this.settings.columns.enableColumnDisplay.value = this.showExtraColumnsInternal;

            this.host.persistProperties({
                merge: [{
                    objectName: "columns",
                    properties: { enableColumnDisplay: this.showExtraColumnsInternal },
                    selector: null
                }]
            });
        }

        this.createColumnDisplayToggleButton(this.lastUpdateOptions?.viewport?.width || 800);

        this.captureScrollPosition(); // Ensure scroll is preserved

        // Trigger generic update like others
        if (this.lastUpdateOptions) {
            this.update(this.lastUpdateOptions);
        } else {
            this.forceFullUpdate = true;
            this.requestUpdate();
        }
    }

    private createColumnDisplayToggleButton(viewportWidth?: number): void {
        if (!this.headerSvg) return;

        this.headerSvg.selectAll(".column-toggle-group").remove();

        // Check if feature is enabled in settings (it is by default in capabilities, but good to check)
        // Also check if any columns are actually enabled to be shown? 
        // Even if individual cols are off, the toggle controls the "Area". 
        // But if ALL individual cols are off in settings, toggle does nothing visually except expand space.
        // We'll show it regardless.

        const layout = this.getHeaderButtonLayout(viewportWidth || 800);
        const { x: buttonX, size: buttonSize } = layout.colToggle;

        const colToggleGroup = this.headerSvg.append("g")
            .attr("class", "column-toggle-group")
            .style("cursor", "pointer")
            .attr("role", "button")
            .attr("aria-label", this.showExtraColumnsInternal ? "Hide data columns" : "Show data columns")
            .attr("aria-pressed", this.showExtraColumnsInternal.toString())
            .attr("tabindex", "0");

        const buttonY = this.UI_TOKENS.spacing.sm;

        colToggleGroup.attr("transform", `translate(${buttonX}, ${buttonY})`);

        colToggleGroup.append("rect")
            .attr("width", buttonSize)
            .attr("height", buttonSize)
            .attr("rx", this.UI_TOKENS.radius.medium)
            .attr("ry", this.UI_TOKENS.radius.medium)
            .style("fill", this.showExtraColumnsInternal
                ? this.UI_TOKENS.color.primary.light
                : this.UI_TOKENS.color.neutral.white)
            .style("stroke", this.showExtraColumnsInternal
                ? this.UI_TOKENS.color.primary.default
                : this.UI_TOKENS.color.neutral.grey60)
            .style("stroke-width", this.showExtraColumnsInternal ? 2 : 1.5)
            .style("filter", `drop-shadow(${this.UI_TOKENS.shadow[2]})`)
            .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

        const iconCenterX = buttonSize / 2;
        const iconCenterY = buttonSize / 2;
        const iconG = colToggleGroup.append("g")
            .attr("transform", `translate(${iconCenterX}, ${iconCenterY})`);

        const iconColor = this.showExtraColumnsInternal
            ? this.UI_TOKENS.color.primary.default
            : this.UI_TOKENS.color.neutral.grey130;

        // Draw Arrows
        if (this.showExtraColumnsInternal) {
            // Left Arrow (Collapse)
            iconG.append("path")
                .attr("d", "M 2,-4 L -2,0 L 2,4")
                .attr("stroke", iconColor)
                .attr("stroke-width", 2)
                .attr("fill", "none")
                .attr("stroke-linecap", "round")
                .attr("stroke-linejoin", "round");
            // Vertical bar to left? No, just arrow is enough.
        } else {
            // Right Arrow (Expand)
            iconG.append("path")
                .attr("d", "M -2,-4 L 2,0 L -2,4")
                .attr("stroke", iconColor)
                .attr("stroke-width", 2)
                .attr("fill", "none")
                .attr("stroke-linecap", "round")
                .attr("stroke-linejoin", "round");
        }

        const tooltipText = this.showExtraColumnsInternal ? "Hide data columns" : "Show data columns";
        colToggleGroup.append("title").text(tooltipText);

        const self = this;
        colToggleGroup
            .on("mouseover", function () {
                d3.select(this).select("rect")
                    .style("fill", self.showExtraColumnsInternal
                        ? self.UI_TOKENS.color.primary.default
                        : self.UI_TOKENS.color.neutral.grey20)
                    .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[8]})`);

                if (self.showExtraColumnsInternal) {
                    d3.select(this).select("path").attr("stroke", self.UI_TOKENS.color.neutral.white);
                }
            })
            .on("mouseout", function () {
                d3.select(this).select("rect")
                    .style("fill", self.showExtraColumnsInternal
                        ? self.UI_TOKENS.color.primary.light
                        : self.UI_TOKENS.color.neutral.white)
                    .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[2]})`);

                if (self.showExtraColumnsInternal) {
                    d3.select(this).select("path").attr("stroke", iconColor);
                }
            })
            .on("mousedown", function () {
                d3.select(this).select("rect").style("transform", "scale(0.95)");
            })
            .on("mouseup", function () {
                d3.select(this).select("rect").style("transform", "scale(1)");
            });

        colToggleGroup.on("click", function (event) {
            if (event) event.stopPropagation();
            self.toggleColumnDisplayInternal();
        });

        colToggleGroup.on("keydown", function (event) {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                self.toggleColumnDisplayInternal();
            }
        });
    }

    private createOrUpdateWbsEnableToggleButton(viewportWidth?: number): void {
        if (!this.headerSvg) return;

        this.headerSvg.selectAll(".wbs-enable-toggle-group").remove();

        const wbsColumnsExist = this.wbsDataExistsInMetadata;
        const showWbsToggle = this.settings?.wbsGrouping?.showWbsToggle?.value ?? true;
        if (!wbsColumnsExist || !showWbsToggle) return;

        const isEnabled = !!this.settings?.wbsGrouping?.enableWbsGrouping?.value;

        const layout = this.getHeaderButtonLayout(viewportWidth || 800);
        const { x: buttonX, width: buttonWidth } = layout.wbsEnable;
        const buttonHeight = this.UI_TOKENS.height.standard;
        const buttonY = this.UI_TOKENS.spacing.sm;

        const group = this.headerSvg.append("g")
            .attr("class", "wbs-enable-toggle-group")
            .style("cursor", "pointer")
            .attr("role", "button")
            .attr("aria-pressed", isEnabled.toString())
            .attr("aria-label", isEnabled ? "Turn off WBS grouping" : "Turn on WBS grouping")
            .attr("tabindex", "0")
            .attr("transform", `translate(${buttonX}, ${buttonY})`);

        const fill = isEnabled ? this.UI_TOKENS.color.primary.light : this.UI_TOKENS.color.neutral.white;
        const stroke = isEnabled ? this.UI_TOKENS.color.primary.default : this.UI_TOKENS.color.neutral.grey60;
        const textColor = isEnabled ? this.UI_TOKENS.color.primary.default : this.UI_TOKENS.color.neutral.grey130;

        group.append("rect")
            .attr("width", buttonWidth)
            .attr("height", buttonHeight)
            .attr("rx", this.UI_TOKENS.radius.medium)
            .attr("ry", this.UI_TOKENS.radius.medium)
            .style("fill", fill)
            .style("stroke", stroke)
            .style("stroke-width", isEnabled ? 2 : 1.5)
            .style("filter", `drop-shadow(${this.UI_TOKENS.shadow[2]})`)
            .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

        const textY = buttonHeight / 2;
        group.append("text")
            .attr("class", "toggle-text")
            .attr("x", buttonWidth / 2 + 6)
            .attr("y", textY)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .style("font-family", "Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif")
            .style("font-size", `${this.UI_TOKENS.fontSize.md}px`)
            .style("font-weight", this.UI_TOKENS.fontWeight.semibold)
            .style("fill", textColor)
            .text("WBS");

        group.append("circle")
            .attr("class", "toggle-circle")
            .attr("cx", 10)
            .attr("cy", textY)
            .attr("r", 4)
            .style("fill", isEnabled ? this.UI_TOKENS.color.primary.default : this.UI_TOKENS.color.neutral.grey60);

        const self = this;
        group.on("mouseover", function () {
            d3.select(this).select("rect")
                .style("fill", isEnabled ? self.UI_TOKENS.color.primary.default : self.UI_TOKENS.color.neutral.grey20)
                .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[6]})`);

            if (isEnabled) {
                d3.select(this).selectAll(".toggle-text, .toggle-circle")
                    .style("fill", self.UI_TOKENS.color.neutral.white);
            }
        }).on("mouseout", function () {
            d3.select(this).select("rect")
                .style("fill", fill)
                .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[2]})`);

            if (isEnabled) {
                d3.select(this).select(".toggle-text").style("fill", textColor);
                d3.select(this).select(".toggle-circle").style("fill", self.UI_TOKENS.color.primary.default);
            }
        });

        group.on("click", function (event) {
            if (event) event.stopPropagation();
            self.toggleWbsEnabled();
        });

        group.on("keydown", function (event: KeyboardEvent) {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                self.toggleWbsEnabled();
            }
        });
    }

    /**
     * Creates both WBS expand (forward cycle) and collapse (reverse cycle) buttons
     */
    private renderWbsCycleButtons(viewportWidth?: number): void {
        this.createWbsExpandCycleToggleButton(viewportWidth);
        this.createWbsCollapseCycleToggleButton(viewportWidth);
    }

    /**
     * Toggles WBS grouping on/off for the viewer (persisted in formatting properties).
     */
    private toggleWbsEnabled(): void {
        try {
            const wbsColumnsExist = this.wbsDataExistsInMetadata;
            if (!wbsColumnsExist || !this.settings?.wbsGrouping?.enableWbsGrouping) return;

            const newEnabled = !this.settings.wbsGrouping.enableWbsGrouping.value;
            this.settings.wbsGrouping.enableWbsGrouping.value = newEnabled;
            this.wbsEnableOverride = newEnabled;
            this.lastWbsToggleTimestamp = Date.now();
            this.scrollPreservationUntil = Math.max(this.scrollPreservationUntil, this.lastWbsToggleTimestamp + 2000);

            if (!newEnabled) {
                this.wbsGroupLayer?.selectAll('.wbs-group-header').remove();
                this.taskLabelLayer?.selectAll("*").remove();
                this.labelGridLayer?.selectAll("*").remove();
                this.wbsExpandedInternal = false;
                this.wbsManualExpansionOverride = false;
                this.wbsManuallyToggledGroups.clear();
                this.wbsToggleScrollAnchor = null;
            }

            this.host.persistProperties({
                merge: [{
                    objectName: "wbsGrouping",
                    properties: { enableWbsGrouping: newEnabled },
                    selector: null
                }]
            });

            if (this.scrollableContainer?.node()) {
                this.preservedScrollTop = this.scrollableContainer.node().scrollTop;
                this.preserveScrollOnUpdate = true;
                this.scrollPreservationUntil = Date.now() + 1500;
            }

            this.forceFullUpdate = true;

            if (this.scrollThrottleTimeout) {
                clearTimeout(this.scrollThrottleTimeout);
                this.scrollThrottleTimeout = null;
            }

            const viewportWidth = this.lastUpdateOptions?.viewport.width || 800;
            this.createOrUpdateWbsEnableToggleButton(viewportWidth);

            if (this.lastUpdateOptions) {
                this.update(this.lastUpdateOptions);
            } else {

                this.wbsGroupLayer?.selectAll('.wbs-group-header').remove();
            }
        } catch (error) {
            console.error("Error toggling WBS grouping:", error);
        }
    }

    /**
     * Creates the WBS Expand cycle toggle button with icon-only design
     * Similar styling to Connector Lines toggle for visual consistency
     */
    private createWbsExpandCycleToggleButton(viewportWidth?: number): void {
        if (!this.headerSvg) return;

        this.headerSvg.selectAll(".wbs-expand-toggle-group").remove();

        const wbsColumnsExist = this.wbsDataExistsInMetadata;
        const wbsEnabled = wbsColumnsExist && this.settings?.wbsGrouping?.enableWbsGrouping?.value;
        const showWbsToggle = this.settings?.wbsGrouping?.showWbsToggle?.value ?? true;
        if (!wbsEnabled || !showWbsToggle) return;

        if (this.wbsAvailableLevels.length === 0 && this.wbsGroups.length > 0) {
            this.refreshWbsAvailableLevels();
        }

        const isCustom = this.wbsManualExpansionOverride;
        const currentLevel = this.getCurrentWbsExpandLevel();
        const levelLabel = isCustom
            ? "Custom (manual overrides)"
            : this.getWbsExpandLevelLabel(this.wbsExpandToLevel !== undefined ? this.wbsExpandToLevel : currentLevel);
        const nextLevelValue = this.getNextWbsExpandLevel();
        const nextLevelLabel = nextLevelValue !== null
            ? this.getWbsExpandLevelLabel(nextLevelValue)
            : this.getWbsExpandLevelLabel(currentLevel);

        const layout = this.getHeaderButtonLayout(viewportWidth || 800);
        const { x: buttonX, size: buttonSize } = layout.wbsExpandToggle;

        const wbsToggleGroup = this.headerSvg.append("g")
            .attr("class", "wbs-expand-toggle-group")
            .style("cursor", "pointer")
            .attr("role", "button")
            .attr("aria-label", isCustom
                ? "Custom (manual overrides). Click to expand and clear overrides"
                : `${levelLabel} (click to expand)`)
            .attr("aria-pressed", this.wbsExpandedInternal.toString())
            .attr("tabindex", "0");

        const buttonY = this.UI_TOKENS.spacing.sm;

        wbsToggleGroup.attr("transform", `translate(${buttonX}, ${buttonY})`);

        wbsToggleGroup.append("rect")
            .attr("width", buttonSize)
            .attr("height", buttonSize)
            .attr("rx", this.UI_TOKENS.radius.medium)
            .attr("ry", this.UI_TOKENS.radius.medium)
            .style("fill", this.wbsExpandedInternal
                ? this.UI_TOKENS.color.primary.light
                : this.UI_TOKENS.color.neutral.white)
            .style("stroke", this.wbsExpandedInternal
                ? this.UI_TOKENS.color.primary.default
                : this.UI_TOKENS.color.neutral.grey60)
            .style("stroke-width", this.wbsExpandedInternal ? 2 : 1.5)
            .style("filter", `drop-shadow(${this.UI_TOKENS.shadow[2]})`)
            .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

        const iconCenterX = buttonSize / 2;
        const iconCenterY = (buttonSize / 2) - 4;
        const iconG = wbsToggleGroup.append("g")
            .attr("transform", `translate(${iconCenterX}, ${iconCenterY})`);

        const iconColor = this.wbsExpandedInternal
            ? this.UI_TOKENS.color.primary.default
            : this.UI_TOKENS.color.neutral.grey130;

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

        const badgeText = isCustom
            ? "C"
            : currentLevel === 0
                ? "0"
                : `L${currentLevel}`;
        wbsToggleGroup.append("text")
            .attr("class", "toggle-text")
            .attr("x", buttonSize / 2)
            .attr("y", buttonSize - 10)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .style("font-family", "Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif")
            .style("font-size", `${this.UI_TOKENS.fontSize.sm}px`)
            .style("font-weight", this.UI_TOKENS.fontWeight.semibold)
            .style("fill", iconColor)
            .text(badgeText);

        const levelsDesc = this.wbsAvailableLevels.length > 0
            ? this.wbsAvailableLevels.map(l => `L${l}`).join(" -> ")
            : "no levels";
        const expandSteps = this.wbsAvailableLevels.length > 0
            ? `Expand steps: 0 -> ${levelsDesc} (stops at max).`
            : "Expand steps: 0 (stops at 0).";
        wbsToggleGroup.append("title")
            .text(`${levelLabel}. Next: ${nextLevelLabel}. ${isCustom ? "Manual overrides will be cleared." : expandSteps}`);

        const self = this;
        wbsToggleGroup
            .on("mouseover", function () {
                d3.select(this).select("rect")
                    .style("fill", self.wbsExpandedInternal
                        ? self.UI_TOKENS.color.primary.default
                        : self.UI_TOKENS.color.neutral.grey20)
                    .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[8]})`);

                if (self.wbsExpandedInternal) {
                    d3.select(this).selectAll("path").attr("stroke", self.UI_TOKENS.color.neutral.white);
                    d3.select(this).selectAll(".toggle-text").style("fill", self.UI_TOKENS.color.neutral.white);
                }
            })
            .on("mouseout", function () {
                d3.select(this).select("rect")
                    .style("fill", self.wbsExpandedInternal
                        ? self.UI_TOKENS.color.primary.light
                        : self.UI_TOKENS.color.neutral.white)
                    .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[2]})`);

                if (self.wbsExpandedInternal) {
                    d3.select(this).selectAll("path").attr("stroke", self.UI_TOKENS.color.primary.default);
                    d3.select(this).selectAll(".toggle-text").style("fill", iconColor);
                }
            })
            .on("mousedown", function () {
                d3.select(this).select("rect")
                    .style("transform", "scale(0.95)");
            })
            .on("mouseup", function () {
                d3.select(this).select("rect")
                    .style("transform", "scale(1)");
            });

        wbsToggleGroup.on("click", function (event) {
            if (event) event.stopPropagation();
            self.toggleWbsExpandCollapseDisplay();
        });

        wbsToggleGroup.on("keydown", function (event) {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                self.toggleWbsExpandCollapseDisplay();
            }
        });
    }

    /**
     * Creates the WBS Collapse cycle toggle button with icon-only design (reverse order)
     */
    private createWbsCollapseCycleToggleButton(viewportWidth?: number): void {
        if (!this.headerSvg) return;

        this.headerSvg.selectAll(".wbs-collapse-toggle-group").remove();

        const wbsColumnsExist = this.wbsDataExistsInMetadata;
        const wbsEnabled = wbsColumnsExist && this.settings?.wbsGrouping?.enableWbsGrouping?.value;
        const showWbsToggle = this.settings?.wbsGrouping?.showWbsToggle?.value ?? true;
        if (!wbsEnabled || !showWbsToggle) return;

        if (this.wbsAvailableLevels.length === 0 && this.wbsGroups.length > 0) {
            this.refreshWbsAvailableLevels();
        }

        const isCustom = this.wbsManualExpansionOverride;
        const currentLevel = this.getCurrentWbsExpandLevel();
        const levelLabel = isCustom
            ? "Custom (manual overrides)"
            : this.getWbsExpandLevelLabel(this.wbsExpandToLevel !== undefined ? this.wbsExpandToLevel : currentLevel);
        const previousLevelValue = this.getPreviousWbsExpandLevel();
        const previousLevelLabel = previousLevelValue !== null
            ? this.getWbsExpandLevelLabel(previousLevelValue)
            : this.getWbsExpandLevelLabel(currentLevel);

        const layout = this.getHeaderButtonLayout(viewportWidth || 800);
        const { x: buttonX, size: buttonSize } = layout.wbsCollapseToggle;

        const isCollapsed = this.wbsExpandToLevel === 0 || !this.wbsExpandedInternal;

        const wbsCollapseGroup = this.headerSvg.append("g")
            .attr("class", "wbs-collapse-toggle-group")
            .style("cursor", "pointer")
            .attr("role", "button")
            .attr("aria-label", isCustom
                ? "Custom (manual overrides). Click to collapse and clear overrides"
                : `${levelLabel} (click to collapse)`)
            .attr("aria-pressed", isCollapsed.toString())
            .attr("tabindex", "0");

        const buttonY = this.UI_TOKENS.spacing.sm;

        wbsCollapseGroup.attr("transform", `translate(${buttonX}, ${buttonY})`);

        wbsCollapseGroup.append("rect")
            .attr("width", buttonSize)
            .attr("height", buttonSize)
            .attr("rx", this.UI_TOKENS.radius.medium)
            .attr("ry", this.UI_TOKENS.radius.medium)
            .style("fill", isCollapsed
                ? this.UI_TOKENS.color.primary.light
                : this.UI_TOKENS.color.neutral.white)
            .style("stroke", isCollapsed
                ? this.UI_TOKENS.color.primary.default
                : this.UI_TOKENS.color.neutral.grey60)
            .style("stroke-width", isCollapsed ? 2 : 1.5)
            .style("filter", `drop-shadow(${this.UI_TOKENS.shadow[2]})`)
            .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

        const iconCenterX = buttonSize / 2;
        const iconCenterY = (buttonSize / 2) - 4;
        const iconG = wbsCollapseGroup.append("g")
            .attr("transform", `translate(${iconCenterX}, ${iconCenterY})`);

        const iconColor = isCollapsed
            ? this.UI_TOKENS.color.primary.default
            : this.UI_TOKENS.color.neutral.grey130;

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

        const badgeText = isCustom
            ? "C"
            : currentLevel === 0
                ? "0"
                : `L${currentLevel}`;
        wbsCollapseGroup.append("text")
            .attr("class", "toggle-text")
            .attr("x", buttonSize / 2)
            .attr("y", buttonSize - 10)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .style("font-family", "Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif")
            .style("font-size", `${this.UI_TOKENS.fontSize.sm}px`)
            .style("font-weight", this.UI_TOKENS.fontWeight.semibold)
            .style("fill", iconColor)
            .text(badgeText);

        const levelsDesc = this.wbsAvailableLevels.length > 0
            ? [...this.wbsAvailableLevels].sort((a, b) => b - a).map(l => `L${l}`).join(" -> ")
            : "no levels";
        const collapseSteps = this.wbsAvailableLevels.length > 0
            ? `Collapse steps: ${levelsDesc} -> 0 (stops at 0).`
            : "Collapse steps: 0 (stops at 0).";
        wbsCollapseGroup.append("title")
            .text(`${levelLabel}. Previous: ${previousLevelLabel}. ${isCustom ? "Manual overrides will be cleared." : collapseSteps}`);

        const self = this;
        wbsCollapseGroup
            .on("mouseover", function () {
                d3.select(this).select("rect")
                    .style("fill", isCollapsed
                        ? self.UI_TOKENS.color.primary.default
                        : self.UI_TOKENS.color.neutral.grey20)
                    .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[8]})`);

                if (isCollapsed) {
                    d3.select(this).selectAll("path").attr("stroke", self.UI_TOKENS.color.neutral.white);
                    d3.select(this).selectAll(".toggle-text").style("fill", self.UI_TOKENS.color.neutral.white);
                }
            })
            .on("mouseout", function () {
                d3.select(this).select("rect")
                    .style("fill", isCollapsed
                        ? self.UI_TOKENS.color.primary.light
                        : self.UI_TOKENS.color.neutral.white)
                    .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[2]})`);

                if (isCollapsed) {
                    d3.select(this).selectAll("path").attr("stroke", self.UI_TOKENS.color.primary.default);
                    d3.select(this).selectAll(".toggle-text").style("fill", iconColor);
                }
            })
            .on("mousedown", function () {
                d3.select(this).select("rect")
                    .style("transform", "scale(0.95)");
            })
            .on("mouseup", function () {
                d3.select(this).select("rect")
                    .style("transform", "scale(1)");
            });

        wbsCollapseGroup.on("click", function (event) {
            if (event) event.stopPropagation();
            self.toggleWbsCollapseCycleDisplay();
        });

        wbsCollapseGroup.on("keydown", function (event) {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                self.toggleWbsCollapseCycleDisplay();
            }
        });
    }

    /**
     * Cycles the WBS expand depth (collapse -> Level 1/2/3/.../N -> expand all)
     * Levels are dynamic based on the number of WBS columns added by the user
     */
    private toggleWbsExpandCollapseDisplay(): void {
        this.cycleWbsExpandLevel("next");
    }

    /**
     * Cycles the WBS expand depth in reverse order (expand all -> ... -> collapse)
     */
    private toggleWbsCollapseCycleDisplay(): void {
        this.cycleWbsExpandLevel("previous");
    }

    private cycleWbsExpandLevel(direction: "next" | "previous"): void {
        try {
            if (!this.wbsDataExists || !this.settings?.wbsGrouping?.enableWbsGrouping?.value) {
                return;
            }

            this.hideTooltip();
            this.lastWbsToggleTimestamp = Date.now();
            this.scrollPreservationUntil = Math.max(this.scrollPreservationUntil, this.lastWbsToggleTimestamp + 2000);

            if (this.wbsAvailableLevels.length === 0 && this.wbsGroups.length > 0) {
                this.refreshWbsAvailableLevels();
            }

            const levelGetter = direction === "previous"
                ? this.getPreviousWbsExpandLevel.bind(this)
                : this.getNextWbsExpandLevel.bind(this);

            const currentLevel = this.getCurrentWbsExpandLevel();
            const nextLevel = levelGetter();
            if (nextLevel === null && this.wbsAvailableLevels.length === 0) {
                return;
            }
            const effectiveNext = nextLevel;
            const hasManualOverrides = this.wbsManualExpansionOverride || this.wbsManuallyToggledGroups.size > 0;

            if (!hasManualOverrides && effectiveNext === currentLevel) {
                return;
            }

            this.debugLog("WBS expand depth cycle", {
                current: currentLevel,
                next: effectiveNext,
                direction,
                availableLevels: this.wbsAvailableLevels
            });

            this.wbsManualExpansionOverride = false;

            if (hasManualOverrides) {
                this.wbsManuallyToggledGroups.clear();
                this.wbsExpandedState.clear();
                this.debugLog("Cleared manual WBS overrides for global toggle");
            }

            this.captureWbsAnchorForGlobalToggle();

            this.applyWbsExpandLevel(effectiveNext);

            this.taskLabelLayer?.selectAll("*").remove();
            this.labelGridLayer?.selectAll("*").remove();
            this.wbsGroupLayer?.selectAll("*").remove();

            const persistedLevel = effectiveNext === null ? -1 : effectiveNext;
            const expandedStatePayload = this.getWbsExpandedStatePayload();
            const manualGroupsPayload = Array.from(this.wbsManuallyToggledGroups);

            this.host.persistProperties({
                merge: [{
                    objectName: "wbsGrouping",
                    properties: { expandCollapseAll: this.wbsExpandedInternal },
                    selector: null
                }, {
                    objectName: "persistedState",
                    properties: {
                        wbsExpandLevel: persistedLevel,
                        wbsExpandedState: JSON.stringify(expandedStatePayload),
                        wbsManualToggledGroups: JSON.stringify(manualGroupsPayload)
                    },
                    selector: null
                }]
            });

            const viewportWidth = this.lastUpdateOptions?.viewport?.width
                || (this.target instanceof HTMLElement ? this.target.clientWidth : undefined)
                || 800;
            this.renderWbsCycleButtons(viewportWidth);

            this.forceFullUpdate = true;

            this.preserveScrollOnUpdate = true;

            if (this.scrollThrottleTimeout) {
                clearTimeout(this.scrollThrottleTimeout);
                this.scrollThrottleTimeout = null;
            }

            if (this.lastUpdateOptions) {
                this.update(this.lastUpdateOptions);
            }

            this.debugLog("WBS expand depth updated", { level: effectiveNext, direction });
        } catch (error) {
            console.error(`Error in WBS toggle method (${direction}):`, error);
        }
    }

    /**
     * Creates the Mode Toggle (Longest Path ↔ Float-Based) with premium Fluent design
     * Professional pill-style toggle with smooth animations and refined visuals
     * RESPONSIVE: Adapts to viewport width using getHeaderButtonLayout()
     */
    private createModeToggleButton(viewportWidth: number): void {
        if (!this.headerSvg) return;

        this.headerSvg.selectAll(".mode-toggle-group").remove();

        const currentMode = this.settings?.criticalPath?.calculationMode?.value?.value || 'longestPath';
        const isFloatBased = currentMode === 'floatBased';
        const dataView = this.lastUpdateOptions?.dataViews?.[0];
        const hasTotalFloat = dataView ? this.hasDataRole(dataView, 'taskTotalFloat') : false;

        const layout = this.getHeaderButtonLayout(viewportWidth);
        const buttonWidth = layout.modeToggle.width;
        const buttonHeight = this.UI_TOKENS.height.standard;
        const buttonX = layout.modeToggle.x;
        const buttonY = this.UI_TOKENS.spacing.sm;

        const modeToggleGroup = this.headerSvg.append("g")
            .attr("class", "mode-toggle-group")
            .style("cursor", hasTotalFloat ? "pointer" : "not-allowed")
            .attr("role", "button")
            .attr("aria-label", `Switch calculation mode. Currently: ${isFloatBased ? 'Float-Based' : 'Longest Path'}`)
            .attr("aria-pressed", isFloatBased.toString())
            .attr("aria-disabled", (!hasTotalFloat).toString())
            .attr("tabindex", hasTotalFloat ? "0" : "-1");

        modeToggleGroup.attr("transform", `translate(${buttonX}, ${buttonY})`);

        const buttonG = modeToggleGroup.append("g")
            .attr("class", "mode-button-container");

        const bgColor = isFloatBased ? this.UI_TOKENS.color.warning.subtle : this.UI_TOKENS.color.primary.subtle;
        const borderColor = isFloatBased ? this.UI_TOKENS.color.warning.default : this.UI_TOKENS.color.primary.default;
        const hoverBgColor = isFloatBased ? this.UI_TOKENS.color.warning.lighter : this.UI_TOKENS.color.primary.lighter;

        const buttonRect = buttonG.append("rect")
            .attr("width", buttonWidth)
            .attr("height", buttonHeight)
            .attr("rx", this.UI_TOKENS.radius.pill)
            .attr("ry", this.UI_TOKENS.radius.pill)
            .style("fill", bgColor)
            .style("stroke", borderColor)
            .style("stroke-width", 1.5)
            .style("filter", hasTotalFloat ? `drop-shadow(${this.UI_TOKENS.shadow[2]})` : "none")
            .style("opacity", hasTotalFloat ? 1 : 0.4)
            .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

        const pillWidth = Math.min(106, buttonWidth - 20);
        const pillHeight = 22;
        const pillG = buttonG.append("g")
            .attr("transform", `translate(${(buttonWidth - pillWidth) / 2}, ${buttonHeight / 2})`);

        const pillX = isFloatBased ? pillWidth / 2 : 0;

        pillG.append("rect")
            .attr("class", "mode-pill-bg")
            .attr("x", 0)
            .attr("y", -pillHeight / 2)
            .attr("width", pillWidth)
            .attr("height", pillHeight)
            .attr("rx", this.UI_TOKENS.radius.large)
            .attr("ry", this.UI_TOKENS.radius.large)
            .style("fill", this.UI_TOKENS.color.neutral.grey20)
            .style("opacity", 0.8);

        const slidingPill = pillG.append("rect")
            .attr("class", "mode-pill")
            .attr("x", pillX)
            .attr("y", -pillHeight / 2)
            .attr("width", pillWidth / 2)
            .attr("height", pillHeight)
            .attr("rx", this.UI_TOKENS.radius.large)
            .attr("ry", this.UI_TOKENS.radius.large)
            .style("fill", borderColor)
            .style("filter", `drop-shadow(${this.UI_TOKENS.shadow[4]})`)
            .style("transition", `all ${this.UI_TOKENS.motion.duration.slow}ms ${this.UI_TOKENS.motion.easing.smooth}`);

        const labelY = 0;

        pillG.append("text")
            .attr("x", pillWidth / 4)
            .attr("y", labelY)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .style("font-family", "Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif")
            .style("font-size", `${this.UI_TOKENS.fontSize.md}px`)
            .style("font-weight", isFloatBased ? this.UI_TOKENS.fontWeight.medium : this.UI_TOKENS.fontWeight.bold)
            .style("fill", isFloatBased ? this.UI_TOKENS.color.neutral.grey130 : this.UI_TOKENS.color.neutral.white)
            .style("pointer-events", "none")
            .style("letter-spacing", "0.5px")
            .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`)
            .text("LP");

        pillG.append("text")
            .attr("x", 3 * pillWidth / 4)
            .attr("y", labelY)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .style("font-family", "Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif")
            .style("font-size", `${this.UI_TOKENS.fontSize.md}px`)
            .style("font-weight", isFloatBased ? this.UI_TOKENS.fontWeight.bold : this.UI_TOKENS.fontWeight.medium)
            .style("fill", isFloatBased ? this.UI_TOKENS.color.neutral.white : this.UI_TOKENS.color.neutral.grey130)
            .style("pointer-events", "none")
            .style("letter-spacing", "0.5px")
            .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`)
            .text("Float");

        modeToggleGroup.append("title")
            .text(hasTotalFloat
                ? `Current mode: ${isFloatBased ? 'Float-Based Criticality' : 'Longest Path (CPM)'}\nClick to switch calculation method`
                : "Float-Based mode requires Task Total Float field to be mapped");

        if (hasTotalFloat) {
            const self = this;

            modeToggleGroup
                .on("mouseover", function () {
                    d3.select(this).select(".mode-button-container rect")
                        .style("fill", hoverBgColor) // already lighter
                        .style("stroke-width", 2.5) // Increase border width only
                        .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[8]})`);
                })
                .on("mouseout", function () {
                    d3.select(this).select(".mode-button-container rect")
                        .style("fill", bgColor)
                        .style("stroke-width", 1.5)
                        .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[2]})`);
                })
                .on("mousedown", function () {
                    d3.select(this).select(".mode-button-container rect")
                        .style("transform", "scale(0.96)")
                        .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[4]})`);
                })
                .on("mouseup", function () {
                    d3.select(this).select(".mode-button-container rect")
                        .style("transform", "scale(1)")
                        .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[8]})`);
                });

            modeToggleGroup.on("click", function (event) {
                if (event) event.stopPropagation();
                self.togglecriticalPath();
            });

            modeToggleGroup.on("keydown", function (event) {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    self.togglecriticalPath();
                }
            });
        }
    }

    private togglecriticalPath(): void {
        try {
            const currentMode = this.settings?.criticalPath?.calculationMode?.value?.value || 'longestPath';
            const newMode = currentMode === 'longestPath' ? 'floatBased' : 'longestPath';

            this.debugLog(`Toggling criticality mode from ${currentMode} to ${newMode}`);

            if (newMode === 'longestPath' && this.floatThreshold > 0) {
                this.debugLog(`Resetting float threshold from ${this.floatThreshold} to 0`);
                this.floatThreshold = 0;

                if (this.floatThresholdInput) {
                    this.floatThresholdInput.property("value", "0");
                }
            }

            this.allTasksData.forEach(task => {
                task.isNearCritical = false;

                if (newMode === 'longestPath') {
                    task.isCriticalByFloat = false;
                }
            });

            if (this.settings?.criticalPath?.calculationMode) {
                this.settings.criticalPath.calculationMode.value = {
                    value: newMode,
                    displayName: newMode === 'longestPath' ? 'Longest Path' : 'Float-Based'
                };
            }

            const properties: any[] = [{
                objectName: "criticalPath",
                properties: { calculationMode: newMode },
                selector: null
            }];

            if (newMode === 'longestPath') {
                properties.push({
                    objectName: "persistedState",
                    properties: { floatThreshold: 0 },
                    selector: null
                });
            }

            this.host.persistProperties({ merge: properties });

            this.createModeToggleButton(this.lastUpdateOptions?.viewport.width || 800);
            this.createFloatThresholdControl();

            this.forceCanvasRefresh();

            this.captureScrollPosition();

            this.forceFullUpdate = true;

            if (this.scrollThrottleTimeout) {
                clearTimeout(this.scrollThrottleTimeout);
                this.scrollThrottleTimeout = null;
            }

            if (this.lastUpdateOptions) {
                this.update(this.lastUpdateOptions);
            }

            this.debugLog("Visual update triggered by mode toggle");

        } catch (error) {
            console.error("Error toggling criticality mode:", error);
        }
    }

    /**
     * Creates the Float Threshold control with premium input design and enhanced UX
     */
    private createFloatThresholdControl(): void {
        this.stickyHeaderContainer.selectAll(".float-threshold-wrapper").remove();

        const currentMode = this.settings?.criticalPath?.calculationMode?.value?.value || 'longestPath';
        const isFloatBased = currentMode === 'floatBased';

        if (!this.showNearCritical || !isFloatBased) {
            this.floatThresholdInput = null as any;
            return;
        }

        const viewportWidth = this.lastUpdateOptions?.viewport?.width || 800;
        const layoutMode = this.getLayoutMode(viewportWidth);
        const isCompact = layoutMode === 'narrow';
        const isMedium = layoutMode === 'medium';
        const maxWidth = isCompact ? 180 : (isMedium ? 210 : 240);
        const horizontalPadding = isCompact
            ? this.UI_TOKENS.spacing.sm
            : (isMedium ? this.UI_TOKENS.spacing.md : this.UI_TOKENS.spacing.lg);

        const controlContainer = this.stickyHeaderContainer.append("div")
            .attr("class", "float-threshold-wrapper")
            .attr("role", "group")
            .attr("aria-label", "Near-critical threshold setting")
            .style("position", "absolute")
            .style("right", "10px")
            .style("top", `${this.UI_TOKENS.spacing.sm}px`)
            .style("display", "flex")
            .style("align-items", "center")
            .style("gap", isCompact ? `${this.UI_TOKENS.spacing.xs}px` : `${this.UI_TOKENS.spacing.sm}px`)
            .style("height", `${isCompact ? this.UI_TOKENS.height.standard : this.UI_TOKENS.height.comfortable}px`)
            .style("padding", `0 ${horizontalPadding}px`)
            .style("max-width", `${maxWidth}px`)
            .style("background-color", this.UI_TOKENS.color.neutral.white)
            .style("border", `1.5px solid ${this.UI_TOKENS.color.warning.default}`)
            .style("border-radius", `${this.UI_TOKENS.radius.pill}px`)
            .style("box-shadow", this.UI_TOKENS.shadow[2])
            .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

        const labelContainer = controlContainer.append("div")
            .style("display", "flex")
            .style("align-items", "center")
            .style("gap", `${this.UI_TOKENS.spacing.xs}px`);

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
            .attr("fill", this.UI_TOKENS.color.warning.default);

        const labelText = isCompact ? "NC ≤" : (isMedium ? "Near-Crit ≤" : "Near-Critical ≤");
        labelContainer.append("span")
            .style("font-size", `${this.UI_TOKENS.fontSize.sm}px`)
            .style("letter-spacing", "0.1px")
            .style("color", this.UI_TOKENS.color.neutral.grey160)
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-weight", this.UI_TOKENS.fontWeight.medium)
            .style("white-space", "nowrap")
            .text(labelText);

        const inputWidth = isCompact ? 42 : (isMedium ? 50 : 54);
        this.floatThresholdInput = controlContainer.append("input")
            .attr("type", "number")
            .attr("min", "0")
            .attr("step", "1")
            .attr("value", this.floatThreshold)
            .attr("aria-label", "Near-critical threshold in days")
            .style("width", `${inputWidth}px`)
            .style("height", "24px")
            .style("padding", `${this.UI_TOKENS.spacing.xs}px ${this.UI_TOKENS.spacing.sm}px`)
            .style("border", `1.5px solid ${this.UI_TOKENS.color.neutral.grey60}`)
            .style("border-radius", `${this.UI_TOKENS.radius.small}px`)
            .style("font-size", `${this.UI_TOKENS.fontSize.md}px`)
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-weight", this.UI_TOKENS.fontWeight.semibold)
            .style("text-align", "center")
            .style("outline", "none")
            .style("background-color", this.UI_TOKENS.color.neutral.white)
            .style("color", this.UI_TOKENS.color.neutral.grey160)
            .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

        if (!isCompact) {
            controlContainer.append("span")
                .style("font-size", `${this.UI_TOKENS.fontSize.sm}px`)
                .style("letter-spacing", "0.1px")
                .style("color", this.UI_TOKENS.color.neutral.grey130)
                .style("font-family", "Segoe UI, sans-serif")
                .style("font-weight", this.UI_TOKENS.fontWeight.medium)
                .style("white-space", "nowrap")
                .text("days");
        }

        if (!isCompact) {
            const helpIcon = controlContainer.append("div")
                .attr("role", "button")
                .attr("aria-label", "Information about near-critical threshold")
                .attr("tabindex", "0")
                .style("width", "16px")
                .style("height", "16px")
                .style("border-radius", "50%")
                .style("border", `1.5px solid ${this.UI_TOKENS.color.neutral.grey60}`)
                .style("background-color", this.UI_TOKENS.color.neutral.grey10)
                .style("display", "flex")
                .style("align-items", "center")
                .style("justify-content", "center")
                .style("cursor", "help")
                .style("font-size", `${this.UI_TOKENS.fontSize.xs}px`)
                .style("color", this.UI_TOKENS.color.neutral.grey130)
                .style("font-family", "Segoe UI, sans-serif")
                .style("font-weight", this.UI_TOKENS.fontWeight.bold)
                .style("transition", `all ${this.UI_TOKENS.motion.duration.fast}ms ${this.UI_TOKENS.motion.easing.smooth}`)
                .text("?");

            helpIcon.append("title")
                .text("Tasks with Total Float less than or equal to this value will be highlighted as near-critical path tasks");

            helpIcon
                .on("mouseover", function () {
                    d3.select(this)
                        .style("background-color", this.UI_TOKENS.color.warning.light)
                        .style("border-color", this.UI_TOKENS.color.warning.default)
                        .style("color", this.UI_TOKENS.color.warning.default);
                }.bind(this))
                .on("mouseout", function () {
                    d3.select(this)
                        .style("background-color", this.UI_TOKENS.color.neutral.grey10)
                        .style("border-color", this.UI_TOKENS.color.neutral.grey60)
                        .style("color", this.UI_TOKENS.color.neutral.grey130);
                }.bind(this));
        }

        const self = this;
        this.floatThresholdInput
            .on("focus", function () {
                d3.select(this)
                    .style("border-color", self.UI_TOKENS.color.warning.default)
                    .style("box-shadow", `0 0 0 3px ${self.UI_TOKENS.color.warning.lighter}`);
            })
            .on("blur", function () {
                d3.select(this)
                    .style("border-color", self.UI_TOKENS.color.neutral.grey60)
                    .style("box-shadow", "none");
            });

        let floatThresholdTimeout: any = null;
        this.floatThresholdInput.on("input", function () {
            const value = parseFloat((this as HTMLInputElement).value);
            const newThreshold = isNaN(value) ? 0 : Math.max(0, value);

            self.floatThreshold = newThreshold;

            d3.select(this)
                .transition()
                .duration(self.UI_TOKENS.motion.duration.fast)
                .style("background-color", self.UI_TOKENS.color.warning.lighter)
                .transition()
                .duration(self.UI_TOKENS.motion.duration.normal)
                .style("background-color", self.UI_TOKENS.color.neutral.white);

            if (floatThresholdTimeout) {
                clearTimeout(floatThresholdTimeout);
            }

            floatThresholdTimeout = setTimeout(() => {

                if (self.scrollThrottleTimeout) {
                    clearTimeout(self.scrollThrottleTimeout);
                    self.scrollThrottleTimeout = null;
                }

                self.host.persistProperties({
                    merge: [{
                        objectName: "persistedState",
                        properties: { floatThreshold: self.floatThreshold },
                        selector: null
                    }]
                });

                self.requestUpdate(true);
            }, 500);
        });

        controlContainer
            .on("mouseover", function () {
                d3.select(this)
                    .style("box-shadow", self.UI_TOKENS.shadow[8]);
            })
            .on("mouseout", function () {
                d3.select(this)
                    .style("box-shadow", self.UI_TOKENS.shadow[4]);
            });
    }

    /**
     * Creates the zoom slider UI component matching Microsoft Power BI standard style
     * Design: Thin track line with circular handles at each end
     */
    private createZoomSliderUI(visualWrapper: Selection<HTMLDivElement, unknown, null, undefined>): void {
        const sliderHeight = 32;

        this.zoomSliderContainer = visualWrapper.append("div")
            .attr("class", "timeline-zoom-slider-container")
            .style("position", "relative")
            .style("width", "100%")
            .style("height", `${sliderHeight}px`)
            .style("background-color", "#FFFFFF")
            .style("border-top", "1px solid #EDEBE9")
            .style("display", "none")
            .style("z-index", "50")
            .style("flex-shrink", "0")
            .style("user-select", "none");

        this.zoomSliderTrack = this.zoomSliderContainer.append("div")
            .attr("class", "zoom-slider-track")
            .style("position", "absolute")
            .style("left", "280px")
            .style("right", "100px")
            .style("top", "50%")
            .style("transform", "translateY(-50%)")
            .style("height", "4px")
            .style("background-color", "#E1DFDD")
            .style("border-radius", "2px");

        const miniChartCanvas = document.createElement('canvas');
        miniChartCanvas.className = 'zoom-slider-mini-chart';
        miniChartCanvas.style.position = 'absolute';
        miniChartCanvas.style.left = '0';
        miniChartCanvas.style.top = '0';
        miniChartCanvas.style.width = '100%';
        miniChartCanvas.style.height = '100%';
        miniChartCanvas.style.pointerEvents = 'none';
        miniChartCanvas.style.display = 'none';
        this.zoomSliderTrack.node()?.appendChild(miniChartCanvas);
        this.zoomSliderMiniChart = d3.select(miniChartCanvas);

        this.zoomSliderSelection = this.zoomSliderTrack.append("div")
            .attr("class", "zoom-slider-selection")
            .style("position", "absolute")
            .style("left", "0%")
            .style("width", "100%")
            .style("top", "0")
            .style("bottom", "0")
            .style("background-color", "#C8C6C4")
            .style("border-radius", "2px")
            .style("cursor", "grab");

        this.zoomSliderLeftHandle = this.zoomSliderSelection.append("div")
            .attr("class", "zoom-slider-handle zoom-slider-handle-left")
            .style("position", "absolute")
            .style("left", "0")
            .style("top", "50%")
            .style("transform", "translate(-50%, -50%)")
            .style("width", "12px")
            .style("height", "12px")
            .style("background-color", "#605E5C")
            .style("border", "2px solid #FFFFFF")
            .style("border-radius", "50%")
            .style("cursor", "ew-resize")
            .style("box-shadow", "0 1px 3px rgba(0,0,0,0.2)")
            .style("z-index", "10");

        this.zoomSliderRightHandle = this.zoomSliderSelection.append("div")
            .attr("class", "zoom-slider-handle zoom-slider-handle-right")
            .style("position", "absolute")
            .style("right", "0")
            .style("top", "50%")
            .style("transform", "translate(50%, -50%)")
            .style("width", "12px")
            .style("height", "12px")
            .style("background-color", "#605E5C")
            .style("border", "2px solid #FFFFFF")
            .style("border-radius", "50%")
            .style("cursor", "ew-resize")
            .style("box-shadow", "0 1px 3px rgba(0,0,0,0.2)")
            .style("z-index", "10");

        this.setupZoomSliderEvents();
    }

    /**
     * Sets up mouse and touch event handlers for the zoom slider
     */
    private setupZoomSliderEvents(): void {
        const self = this;

        this.zoomSliderLeftHandle
            .on("mousedown", function (event: MouseEvent) {
                event.stopPropagation();
                event.preventDefault();
                self.startZoomDrag(event, 'left');
            })
            .on("touchstart", function (event: TouchEvent) {
                event.stopPropagation();
                event.preventDefault();
                const touch = event.touches[0];
                self.startZoomDrag({ clientX: touch.clientX, clientY: touch.clientY } as MouseEvent, 'left');
            });

        this.zoomSliderRightHandle
            .on("mousedown", function (event: MouseEvent) {
                event.stopPropagation();
                event.preventDefault();
                self.startZoomDrag(event, 'right');
            })
            .on("touchstart", function (event: TouchEvent) {
                event.stopPropagation();
                event.preventDefault();
                const touch = event.touches[0];
                self.startZoomDrag({ clientX: touch.clientX, clientY: touch.clientY } as MouseEvent, 'right');
            });

        this.zoomSliderSelection
            .on("mousedown", function (event: MouseEvent) {

                const target = event.target as HTMLElement;
                if (target.classList.contains('zoom-slider-handle') ||
                    target.classList.contains('handle-grip')) {
                    return;
                }
                event.preventDefault();
                self.startZoomDrag(event, 'middle');
            })
            .on("touchstart", function (event: TouchEvent) {
                const target = event.target as HTMLElement;
                if (target.classList.contains('zoom-slider-handle') ||
                    target.classList.contains('handle-grip')) {
                    return;
                }
                event.preventDefault();
                const touch = event.touches[0];
                self.startZoomDrag({ clientX: touch.clientX, clientY: touch.clientY } as MouseEvent, 'middle');
            });

        this.zoomSliderTrack
            .on("dblclick", function () {
                self.resetZoom();
            });

        this.zoomSliderTrack
            .on("mousedown", function (event: MouseEvent) {
                const target = event.target as HTMLElement;

                if (!target.classList.contains('zoom-slider-track')) {
                    return;
                }
                const trackRect = (self.zoomSliderTrack.node() as HTMLElement).getBoundingClientRect();
                const clickPercent = (event.clientX - trackRect.left) / trackRect.width;
                self.jumpZoomTo(clickPercent);
            });

        this.attachZoomDragListeners();
    }

    private attachZoomDragListeners(): void {
        if (this.zoomDragListenersAttached ||
            !this.zoomMouseMoveHandler ||
            !this.zoomMouseUpHandler ||
            !this.zoomTouchMoveHandler ||
            !this.zoomTouchEndHandler) {
            return;
        }

        document.addEventListener("mousemove", this.zoomMouseMoveHandler);
        document.addEventListener("mouseup", this.zoomMouseUpHandler);
        document.addEventListener("touchmove", this.zoomTouchMoveHandler, this.zoomTouchListenerOptions);
        document.addEventListener("touchend", this.zoomTouchEndHandler);
        this.zoomDragListenersAttached = true;
    }

    private detachZoomDragListeners(): void {
        if (!this.zoomDragListenersAttached ||
            !this.zoomMouseMoveHandler ||
            !this.zoomMouseUpHandler ||
            !this.zoomTouchMoveHandler ||
            !this.zoomTouchEndHandler) {
            return;
        }

        document.removeEventListener("mousemove", this.zoomMouseMoveHandler);
        document.removeEventListener("mouseup", this.zoomMouseUpHandler);
        document.removeEventListener("touchmove", this.zoomTouchMoveHandler, this.zoomTouchListenerOptions);
        document.removeEventListener("touchend", this.zoomTouchEndHandler);
        this.zoomDragListenersAttached = false;
    }

    /**
     * Starts a zoom slider drag operation
     */
    private startZoomDrag(event: MouseEvent, type: 'left' | 'right' | 'middle'): void {
        this.isZoomSliderDragging = true;
        this.zoomDragType = type;
        this.zoomDragStartX = event.clientX;
        this.zoomDragStartLeft = this.zoomRangeStart;
        this.zoomDragStartRight = this.zoomRangeEnd;

        if (type === 'middle') {
            this.zoomSliderSelection.style("cursor", "grabbing");
        }

        this.zoomSliderContainer.classed("dragging", true);
    }

    /**
     * Handles zoom slider drag movement
     */
    private handleZoomDrag(event: MouseEvent): void {
        if (!this.isZoomSliderDragging || !this.zoomDragType) return;

        const trackRect = (this.zoomSliderTrack.node() as HTMLElement)?.getBoundingClientRect();
        if (!trackRect) return;

        const deltaX = event.clientX - this.zoomDragStartX;
        const deltaPercent = deltaX / trackRect.width;

        switch (this.zoomDragType) {
            case 'left':

                let newStart = Math.max(0, Math.min(this.zoomDragStartLeft + deltaPercent,
                    this.zoomRangeEnd - this.ZOOM_SLIDER_MIN_RANGE));
                this.zoomRangeStart = newStart;
                break;

            case 'right':

                let newEnd = Math.min(1, Math.max(this.zoomDragStartRight + deltaPercent,
                    this.zoomRangeStart + this.ZOOM_SLIDER_MIN_RANGE));
                this.zoomRangeEnd = newEnd;
                break;

            case 'middle':

                const rangeSize = this.zoomDragStartRight - this.zoomDragStartLeft;
                let newRangeStart = this.zoomDragStartLeft + deltaPercent;
                let newRangeEnd = this.zoomDragStartRight + deltaPercent;

                if (newRangeStart < 0) {
                    newRangeStart = 0;
                    newRangeEnd = rangeSize;
                }
                if (newRangeEnd > 1) {
                    newRangeEnd = 1;
                    newRangeStart = 1 - rangeSize;
                }

                this.zoomRangeStart = newRangeStart;
                this.zoomRangeEnd = newRangeEnd;
                break;
        }

        this.updateZoomSliderUI();

        this.onZoomChange();
    }

    /**
     * Ends a zoom slider drag operation
     */
    private endZoomDrag(): void {
        if (!this.isZoomSliderDragging) return;

        this.isZoomSliderDragging = false;
        this.zoomDragType = null;
        this.zoomSliderSelection.style("cursor", "grab");
        this.zoomSliderContainer.classed("dragging", false);

        // Preserve scroll position before persisting (which triggers update cycle)
        this.captureScrollPosition();

        // Phase 1: Persist zoom range to settings
        this.persistZoomRange();
    }

    /**
     * Phase 1: Persists the current zoom range to settings for bookmark/refresh persistence
     */
    private persistZoomRange(): void {
        this.host.persistProperties({
            merge: [{
                objectName: "persistedState",
                properties: {
                    zoomRangeStart: this.zoomRangeStart,
                    zoomRangeEnd: this.zoomRangeEnd
                },
                selector: null
            }]
        });
    }

    /**
     * Phase 1: Detects if user prefers reduced motion for accessibility
     */
    private prefersReducedMotion(): boolean {
        return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    }

    /**
     * Phase 1: Gets animation duration respecting prefers-reduced-motion
     */
    private getAnimationDuration(normalDuration: number): number {
        return this.prefersReducedMotion() ? 0 : normalDuration;
    }

    /**
     * Resets zoom to show full timeline
     */
    private resetZoom(): void {
        this.zoomRangeStart = 0;
        this.zoomRangeEnd = 1;
        this.updateZoomSliderUI();
        this.onZoomChange();
    }

    /**
     * Jumps the zoom selection to center on a clicked position
     */
    private jumpZoomTo(clickPercent: number): void {
        const rangeSize = this.zoomRangeEnd - this.zoomRangeStart;
        let newStart = clickPercent - rangeSize / 2;
        let newEnd = clickPercent + rangeSize / 2;

        if (newStart < 0) {
            newStart = 0;
            newEnd = rangeSize;
        }
        if (newEnd > 1) {
            newEnd = 1;
            newStart = 1 - rangeSize;
        }

        this.zoomRangeStart = newStart;
        this.zoomRangeEnd = newEnd;
        this.updateZoomSliderUI();
        this.onZoomChange();
    }

    /**
     * Updates the zoom slider UI to reflect current zoom state
     */
    private updateZoomSliderUI(): void {
        if (!this.zoomSliderSelection) return;

        const leftPercent = this.zoomRangeStart * 100;
        const widthPercent = (this.zoomRangeEnd - this.zoomRangeStart) * 100;

        this.zoomSliderSelection
            .style("left", `${leftPercent}%`)
            .style("width", `${widthPercent}%`);
    }

    /**
     * Called when zoom changes - triggers visual update with throttling
     */
    private zoomChangeTimeout: any = null;

    private onZoomChange(): void {

        if (this.zoomChangeTimeout) {
            clearTimeout(this.zoomChangeTimeout);
        }

        this.zoomChangeTimeout = setTimeout(() => {
            this.zoomChangeTimeout = null;

            this.updateRenderOnly();

        }, 16);
    }

    /**
     * Updates the zoom slider visibility and styling based on settings
     */
    private updateZoomSliderVisibility(): void {
        if (!this.zoomSliderContainer) return;

        const isEnabled = this.settings?.timelineZoom?.enableZoomSlider?.value ?? true;
        const sliderHeight = this.settings?.timelineZoom?.sliderHeight?.value ?? 32;
        const trackColor = this.settings?.timelineZoom?.sliderTrackColor?.value?.value ?? "#E1DFDD";
        const selectedColor = this.settings?.timelineZoom?.sliderSelectedColor?.value?.value ?? "#C8C6C4";
        const handleColor = this.settings?.timelineZoom?.sliderHandleColor?.value?.value ?? "#605E5C";

        this.zoomSliderEnabled = isEnabled;

        this.zoomSliderContainer
            .style("display", isEnabled ? "block" : "none")
            .style("height", `${sliderHeight}px`);

        if (this.zoomSliderTrack) {
            this.zoomSliderTrack.style("background-color", trackColor);
        }

        if (this.zoomSliderSelection) {
            this.zoomSliderSelection.style("background-color", selectedColor);
        }

        if (this.zoomSliderLeftHandle) {
            this.zoomSliderLeftHandle.style("background-color", handleColor);
        }

        if (this.zoomSliderRightHandle) {
            this.zoomSliderRightHandle.style("background-color", handleColor);
        }

        this.updateScrollableContainerHeight();
    }

    /**
     * Updates the scrollable container height based on visible components
     * Note: With flexbox layout, height is automatically managed.
     * This method is kept for backwards compatibility but flexbox handles the layout.
     */
    private updateScrollableContainerHeight(): void {

    }

    /**
     * Draws the mini chart preview in the zoom slider showing task distribution
     */
    private drawZoomSliderMiniChart(): void {
        if (!this.zoomSliderMiniChart || !this.fullTimelineDomain || !this.settings?.timelineZoom?.showMiniChart?.value) {
            return;
        }

        const canvas = this.zoomSliderMiniChart.node() as HTMLCanvasElement;
        if (!canvas) return;

        const rect = canvas.parentElement?.getBoundingClientRect();
        if (!rect) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, rect.width, rect.height);

        const tasksToShow = this.allFilteredTasks.length > 0 ? this.allFilteredTasks : this.allTasksToShow;
        if (tasksToShow.length === 0 || !this.fullTimelineDomain) return;

        const [minDate, maxDate] = this.fullTimelineDomain;
        const timeRange = maxDate.getTime() - minDate.getTime();
        if (timeRange <= 0) return;

        const barHeight = Math.max(1, rect.height / Math.max(tasksToShow.length, 50));
        const criticalColor = this.settings?.criticalPath?.criticalPathColor?.value?.value ?? "#E81123";
        const taskColor = this.settings?.taskBars?.taskColor?.value?.value ?? "#0078D4";

        ctx.globalAlpha = 0.5;

        tasksToShow.forEach((task, index) => {
            if (!task.startDate || !task.finishDate) return;

            const startPercent = (task.startDate.getTime() - minDate.getTime()) / timeRange;
            const endPercent = (task.finishDate.getTime() - minDate.getTime()) / timeRange;

            const x = startPercent * rect.width;
            const width = Math.max(1, (endPercent - startPercent) * rect.width);
            const y = (index / tasksToShow.length) * rect.height;

            ctx.fillStyle = task.isCritical ? criticalColor : taskColor;
            ctx.fillRect(x, y, width, barHeight);
        });

        ctx.globalAlpha = 1;
    }

    /**
     * Updates the zoom slider track margins to align with the chart area
     */
    private updateZoomSliderTrackMargins(): void {
        if (!this.zoomSliderTrack || !this.settings) return;

        const leftMargin = this.settings.layoutSettings?.leftMargin?.value ?? 280;
        const rightMargin = this.margin.right ?? 100;

        this.zoomSliderTrack
            .style("left", `${leftMargin}px`)
            .style("right", `${rightMargin}px`);
    }

    /**
     * Ensures the chart clip path/rect exist. Recreates them if a previous clear removed <defs>.
     */
    private ensureChartClipPath(): void {
        if (!this.mainSvg) return;

        let defs = this.mainSvg.select("defs");
        if (defs.empty()) {
            defs = this.mainSvg.append("defs");
        }

        let clipPath = defs.select<SVGClipPathElement>("clipPath#chart-area-clip");
        if (clipPath.empty()) {
            clipPath = defs.append("clipPath").attr("id", "chart-area-clip");
        }
        this.chartClipPath = clipPath;

        let clipRect = clipPath.select<SVGRectElement>("rect");
        if (clipRect.empty()) {
            clipRect = clipPath.append("rect").attr("x", 0).attr("y", 0).attr("width", 0).attr("height", 0);
        }
        this.chartClipRect = clipRect;

        // Ensure arrowhead markers exist
        this.ensureArrowMarkers(defs);
    }

    /**
     * Creates or updates SVG arrowhead marker definitions for connector lines.
     * Uses the arrowHeadSize setting to control marker size.
     */
    private ensureArrowMarkers(defs: d3.Selection<any, unknown, null, undefined>): void {
        const arrowSize = this.settings?.connectorLines?.arrowHeadSize?.value ?? 6;
        const connectorColor = this.settings?.connectorLines?.connectorColor?.value?.value ?? "#555555";
        const criticalColor = this.settings?.criticalPath?.criticalPathColor?.value?.value ?? "#E81123";

        // Create or update normal arrowhead marker
        let normalMarker = defs.select<SVGMarkerElement>("marker#arrowhead");
        if (normalMarker.empty()) {
            normalMarker = defs.append("marker")
                .attr("id", "arrowhead")
                .attr("orient", "auto")
                .attr("markerUnits", "strokeWidth");
            normalMarker.append("path");
        }
        normalMarker
            .attr("viewBox", `0 0 ${arrowSize} ${arrowSize}`)
            .attr("refX", arrowSize - 1)
            .attr("refY", arrowSize / 2)
            .attr("markerWidth", arrowSize)
            .attr("markerHeight", arrowSize);
        normalMarker.select("path")
            .attr("d", `M 0,0 L ${arrowSize},${arrowSize / 2} L 0,${arrowSize} Z`)
            .attr("fill", connectorColor);

        // Create or update critical arrowhead marker
        let criticalMarker = defs.select<SVGMarkerElement>("marker#arrowhead-critical");
        if (criticalMarker.empty()) {
            criticalMarker = defs.append("marker")
                .attr("id", "arrowhead-critical")
                .attr("orient", "auto")
                .attr("markerUnits", "strokeWidth");
            criticalMarker.append("path");
        }
        criticalMarker
            .attr("viewBox", `0 0 ${arrowSize} ${arrowSize}`)
            .attr("refX", arrowSize - 1)
            .attr("refY", arrowSize / 2)
            .attr("markerWidth", arrowSize)
            .attr("markerHeight", arrowSize);
        criticalMarker.select("path")
            .attr("d", `M 0,0 L ${arrowSize},${arrowSize / 2} L 0,${arrowSize} Z`)
            .attr("fill", criticalColor);
    }

    /**
     * Updates the SVG clip rect to match the current chart dimensions.
     * This prevents bars from rendering past the left margin when zoomed.
     */
    private updateChartClipRect(chartWidth: number, chartHeight: number): void {
        this.ensureChartClipPath();
        if (!this.chartClipRect) return;

        this.chartClipRect
            .attr("x", 0)
            .attr("y", 0)
            .attr("width", chartWidth)
            .attr("height", chartHeight + 1000);
    }

    private toggleConnectorLinesDisplay(): void {
        try {
            this.debugLog("Connector Lines Toggle method called!");
            this.showConnectorLinesInternal = !this.showConnectorLinesInternal;
            this.debugLog("New showConnectorLinesInternal value:", this.showConnectorLinesInternal);

            if (this.scrollableContainer?.node()) {
                const currentScrollTop = this.scrollableContainer.node().scrollTop;
                this.preservedScrollTop = currentScrollTop;
                this.preserveScrollOnUpdate = true;

                this.scrollPreservationUntil = Date.now() + 500;
                this.debugLog(`Connector toggle: Captured scrollTop=${currentScrollTop}`);
            }

            this.host.persistProperties({
                merge: [{
                    objectName: "connectorLines",
                    properties: { showConnectorLines: this.showConnectorLinesInternal },
                    selector: null
                }]
            });

            this.redrawVisibleTasks();

            const viewportWidth = this.lastUpdateOptions?.viewport?.width
                || (this.target instanceof HTMLElement ? this.target.clientWidth : undefined)
                || 800;
            this.createConnectorLinesToggleButton(viewportWidth);

            this.debugLog("Connector lines toggled and persisted");
        } catch (error) {
            console.error("Error in connector toggle method:", error);
        }
    }

    // ============================================================================
    // PDF Export Functionality
    // ============================================================================

    /**
     * Creates the "Copy Visible Data" button in the header area
     */
    private createCopyDataButton(viewportWidth?: number): void {
        if (!this.headerSvg) return;

        // Remove existing button
        this.headerSvg.selectAll('.copy-data-button-group').remove();

        const layout = this.getHeaderButtonLayout(viewportWidth || 800);
        const { x: buttonX, size: buttonSize } = layout.copyButton;
        const buttonY = this.UI_TOKENS.spacing.sm;

        // Create button group
        const copyBtnGroup = this.headerSvg.append('g')
            .attr('class', 'copy-data-button-group')
            .attr('transform', `translate(${buttonX}, ${buttonY})`)
            .style('cursor', 'pointer')
            .attr('role', 'button')
            .attr('aria-label', 'Copy visible data to clipboard')
            .attr('tabindex', '0');

        // Button background
        copyBtnGroup.append('rect')
            .attr('class', 'copy-btn-bg')
            .attr('width', buttonSize)
            .attr('height', buttonSize)
            .attr('rx', this.UI_TOKENS.radius.medium)
            .attr('ry', this.UI_TOKENS.radius.medium)
            .style('fill', this.UI_TOKENS.color.neutral.white)
            .style('stroke', this.UI_TOKENS.color.neutral.grey60)
            .style('stroke-width', 1.5)
            .style('filter', `drop-shadow(${this.UI_TOKENS.shadow[2]})`)
            .style('transition', `all ${this.UI_TOKENS.motion.duration.normal}ms`);

        // Icon group
        const iconG = copyBtnGroup.append('g')
            .attr('class', 'copy-icon')
            .attr('transform', `translate(${buttonSize / 2}, ${buttonSize / 2})`);

        // Copy Icon (Two overlapping rectangles)
        iconG.append('path')
            .attr('d', 'M-4,1 L-4,5 L4,5 L4,-3 L0,-3 M0,-7 L6,-7 L6,1 L0,1 L0,-7 Z')
            .attr('fill', 'none')
            .attr('stroke', this.UI_TOKENS.color.neutral.grey130)
            .attr('stroke-width', 1.5)
            .attr('stroke-linecap', 'round')
            .attr('stroke-linejoin', 'round');

        // Tooltip
        copyBtnGroup.append('title')
            .text('Copy visible data to clipboard');

        // Event handlers
        const self = this;
        copyBtnGroup
            .on('mouseover', function () {
                d3.select(this).select('.copy-btn-bg')
                    .style('fill', self.UI_TOKENS.color.neutral.grey20)
                    .style('filter', `drop-shadow(${self.UI_TOKENS.shadow[8]})`);
            })
            .on('mouseout', function () {
                d3.select(this).select('.copy-btn-bg')
                    .style('fill', self.UI_TOKENS.color.neutral.white)
                    .style('filter', `drop-shadow(${self.UI_TOKENS.shadow[2]})`);
            })
            .on('click', function (event) {
                event.stopPropagation();
                self.copyVisibleDataToClipboard();
            })
            .on('keydown', function (event) {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    self.copyVisibleDataToClipboard();
                }
            });
    }

    /**
     * Copies the currently visible (filtered) tasks to clipboard
     */
    private copyVisibleDataToClipboard(): void {
        try {
            if (!this.allFilteredTasks || this.allFilteredTasks.length === 0) {
                alert("No visible data to copy.");
                return;
            }

            // Define headers
            // Calculate max depth for WBS columns
            const maxWbsDepth = this.allFilteredTasks.reduce((max, task) => Math.max(max, task.wbsLevels?.length || 0), 0);

            // Define base headers
            const headers = [
                "Index", "Task ID", "Task Name", "Start Date", "Finish Date",
                "Duration", "Total Float", "Is Critical"
            ];

            // Add dynamic WBS headers
            for (let i = 0; i < maxWbsDepth; i++) {
                headers.push(`WBS Level ${i + 1}`);
            }

            // Format rows (Tab Separated for Excel)
            const rows = this.allFilteredTasks.map((task, index) => {
                const wbsCols = [];
                for (let i = 0; i < maxWbsDepth; i++) {
                    wbsCols.push(task.wbsLevels?.[i] || "");
                }

                return [
                    (index + 1).toString(),
                    task.id?.toString() || "",
                    task.name?.replace(/\t/g, " ") || "", // Sanitize tabs
                    task.startDate ? this.fullDateFormatter.format(task.startDate) : "",
                    task.finishDate ? this.fullDateFormatter.format(task.finishDate) : "",
                    task.duration?.toString() || "0",
                    task.totalFloat?.toString() || "0",
                    task.isCritical ? "Yes" : "No",
                    ...wbsCols
                ].join("\t");
            });

            // Combine headers and rows
            const tsvContent = [headers.join("\t"), ...rows].join("\n");

            // Write to clipboard
            // Force legacy method for stability
            this.copyUsingLegacyMethod(tsvContent);
            return;

            navigator.clipboard.writeText(tsvContent).then(() => {
                const message = `Copied ${this.allFilteredTasks.length} rows to clipboard!`;
                console.log(message);

                // Show temporary success feedback on the button
                const btn = this.headerSvg?.select('.copy-data-button-group');
                if (btn) {
                    const originalStroke = btn.select('.copy-btn-bg').style('stroke');
                    btn.select('.copy-btn-bg')
                        .style('stroke', this.UI_TOKENS.color.success.default)
                        .style('stroke-width', 2);

                    setTimeout(() => {
                        btn.select('.copy-btn-bg')
                            .style('stroke', originalStroke)
                            .style('stroke-width', 1.5);
                    }, 1000);
                }

                alert(message + "\n\nYou can now paste into Excel.");
            }).catch(err => {
                console.error('Failed to copy text: ', err);
                alert('Failed to copy to clipboard. Please check browser permissions.');
            });

        } catch (error) {
            console.error('Error copying data:', error);
            alert('An error occurred while copying data.');
        }
    }

    private copyUsingLegacyMethod(text: string): void {
        let textArea: HTMLTextAreaElement | null = null;
        try {
            textArea = document.createElement("textarea");
            textArea.value = text;

            // Ensure it's not visible but part of DOM
            textArea.style.position = "fixed";
            textArea.style.left = "-9999px";
            textArea.style.top = "0";
            document.body.appendChild(textArea);

            textArea.focus();
            textArea.select();

            const successful = document.execCommand('copy');
            if (successful) {
                this.showCopySuccess(this.allFilteredTasks.length);
            } else {
                // Last ditch effort: Try allowing user to copy manually? 
                // No, just alert failure.
                alert("Clipboard copy failed. Please try again.");
            }
        } catch (err) {
            console.error('Fallback copy failed:', err);
            alert("Clipboard copy failed: " + err);
        } finally {
            if (textArea && document.body.contains(textArea)) {
                document.body.removeChild(textArea);
            }
        }
    }

    private showCopySuccess(count: number): void {
        const message = `Copied ${count} rows to clipboard!`;
        console.log(message);

        // Show temporary success feedback on the button
        const btn = this.headerSvg?.select('.copy-data-button-group');
        if (btn) {
            const originalStroke = btn.select('.copy-btn-bg').style('stroke');
            btn.select('.copy-btn-bg')
                .style('stroke', this.UI_TOKENS.color.success.default)
                .style('stroke-width', 2);

            setTimeout(() => {
                btn.select('.copy-btn-bg')
                    .style('stroke', originalStroke)
                    .style('stroke-width', 1.5);
            }, 1000);
        }

        // Use timeout to ensure alert doesn't block UI immediately
        setTimeout(() => alert(message + "\n\nYou can now paste into Excel."), 10);
    }

    /**
     * Creates the export button in the header area
     */
    private createExportButton(viewportWidth?: number): void {
        // Also update the Copy Data button
        this.createCopyDataButton(viewportWidth);

        if (!this.headerSvg) return;

        // Remove existing button
        this.headerSvg.selectAll('.export-button-group').remove();
        this.exportButtonGroup = null;

        // Check setting
        const showExportButton = this.settings?.generalSettings?.showExportButton?.value ?? true;
        if (!showExportButton) return;

        // Use centralized layout for button positioning
        const layout = this.getHeaderButtonLayout(viewportWidth || 800);
        const { x: buttonX, size: buttonSize } = layout.exportButton;
        const buttonY = this.UI_TOKENS.spacing.sm;

        // Create button group
        this.exportButtonGroup = this.headerSvg.append('g')
            .attr('class', 'export-button-group')
            .attr('transform', `translate(${buttonX}, ${buttonY})`)
            .style('cursor', 'pointer')
            .attr('role', 'button')
            .attr('aria-label', 'Export chart as PDF')
            .attr('tabindex', '0');

        // Button background
        this.exportButtonGroup.append('rect')
            .attr('class', 'export-btn-bg')
            .attr('width', buttonSize)
            .attr('height', buttonSize)
            .attr('rx', this.UI_TOKENS.radius.medium)
            .attr('ry', this.UI_TOKENS.radius.medium)
            .style('fill', this.UI_TOKENS.color.neutral.white)
            .style('stroke', this.UI_TOKENS.color.neutral.grey60)
            .style('stroke-width', 1.5)
            .style('filter', `drop-shadow(${this.UI_TOKENS.shadow[2]})`)
            .style('transition', `all ${this.UI_TOKENS.motion.duration.normal}ms`);

        // Icon group
        const iconG = this.exportButtonGroup.append('g')
            .attr('class', 'export-icon')
            .attr('transform', `translate(${buttonSize / 2}, ${buttonSize / 2})`);

        // Document icon (page with folded corner)
        iconG.append('path')
            .attr('d', 'M-5,-7 L-5,7 L5,7 L5,-3 L1,-7 Z')
            .attr('fill', 'none')
            .attr('stroke', this.UI_TOKENS.color.neutral.grey130)
            .attr('stroke-width', 1.5)
            .attr('stroke-linecap', 'round')
            .attr('stroke-linejoin', 'round');

        // Folded corner
        iconG.append('path')
            .attr('d', 'M1,-7 L1,-3 L5,-3')
            .attr('fill', 'none')
            .attr('stroke', this.UI_TOKENS.color.neutral.grey130)
            .attr('stroke-width', 1.5)
            .attr('stroke-linecap', 'round')
            .attr('stroke-linejoin', 'round');

        // Download arrow
        iconG.append('path')
            .attr('class', 'export-arrow')
            .attr('d', 'M0,0 L0,4 M-2,2 L0,4 L2,2')
            .attr('fill', 'none')
            .attr('stroke', this.UI_TOKENS.color.primary.default)
            .attr('stroke-width', 1.5)
            .attr('stroke-linecap', 'round')
            .attr('stroke-linejoin', 'round');

        // Tooltip
        this.exportButtonGroup.append('title')
            .text('Export chart as PDF');

        // Loading spinner (hidden by default)
        const spinner = iconG.append('g')
            .attr('class', 'export-spinner')
            .style('display', 'none');

        spinner.append('circle')
            .attr('r', 6)
            .attr('fill', 'none')
            .attr('stroke', this.UI_TOKENS.color.primary.default)
            .attr('stroke-width', 2)
            .attr('stroke-dasharray', '20 10')
            .attr('stroke-linecap', 'round');

        // Event handlers
        const self = this;

        this.exportButtonGroup
            .on('mouseover', function () {
                if (self.isExporting) return;
                d3.select(this).select('.export-btn-bg')
                    .style('fill', self.UI_TOKENS.color.neutral.grey20)
                    .style('filter', `drop-shadow(${self.UI_TOKENS.shadow[8]})`);
            })
            .on('mouseout', function () {
                if (self.isExporting) return;
                d3.select(this).select('.export-btn-bg')
                    .style('fill', self.UI_TOKENS.color.neutral.white)
                    .style('filter', `drop-shadow(${self.UI_TOKENS.shadow[2]})`);
            })
            .on('click', function (event) {
                event.stopPropagation();
                if (!self.isExporting) {
                    self.exportToPDF();
                }
            })
            .on('keydown', function (event) {
                if ((event.key === 'Enter' || event.key === ' ') && !self.isExporting) {
                    event.preventDefault();
                    self.exportToPDF();
                }
            });
    }

    /**
     * Updates the export button visual state
     */
    private updateExportButtonState(loading: boolean): void {
        if (!this.exportButtonGroup) return;

        const iconPaths = this.exportButtonGroup.selectAll('.export-icon path');
        const spinner = this.exportButtonGroup.select('.export-spinner');

        if (loading) {
            // Show spinner, hide icon paths
            iconPaths.style('display', 'none');
            spinner.style('display', 'block');

            this.exportButtonGroup
                .classed('is-exporting', true)
                .style('cursor', 'wait')
                .select('.export-btn-bg')
                .style('fill', this.UI_TOKENS.color.neutral.grey20);
        } else {
            // Show icon, hide spinner
            iconPaths.style('display', 'block');
            spinner.style('display', 'none');

            this.exportButtonGroup
                .classed('is-exporting', false)
                .style('cursor', 'pointer')
                .select('.export-btn-bg')
                .style('fill', this.UI_TOKENS.color.neutral.white);
        }
    }

    /**
     * Exports the visual as a PDF file using Power BI Download Service API
     * Falls back to direct download if the service is unavailable
     */
    private async exportToPDF(): Promise<void> {
        console.log('[PDF Export] Starting export...');

        if (this.isExporting) {
            console.log('[PDF Export] Export already in progress, skipping');
            return;
        }

        this.isExporting = true;
        this.updateExportButtonState(true);

        try {
            // Generate filename with timestamp
            const now = new Date();
            const timestamp = now.toISOString()
                .replace(/[:.]/g, '-')
                .replace('T', '-')
                .slice(0, 19);
            const filename = `gantt-export-${timestamp}.pdf`;

            // Generate PDF content
            console.log('[PDF Export] Generating PDF content...');
            const pdfBase64 = await this.generatePDFContent();
            console.log('[PDF Export] PDF content generated, size:', pdfBase64.length, 'chars');

            // Try Power BI Download Service first
            if (this.downloadService) {
                try {
                    console.log('[PDF Export] Checking download service status...');
                    const status = await this.downloadService.exportStatus();
                    console.log('[PDF Export] Export status:', status);

                    if (status === PrivilegeStatus.Allowed) {
                        console.log('[PDF Export] Triggering download via Power BI API...');
                        const result = await this.downloadService.exportVisualsContentExtended(
                            pdfBase64,
                            filename,
                            'base64',
                            'PDF export of Gantt chart visualization'
                        );

                        if (result.downloadCompleted) {
                            console.log('[PDF Export] Download completed successfully:', result.fileName);
                            return; // Success!
                        } else {
                            console.warn('[PDF Export] Download may not have completed, trying fallback...');
                        }
                    } else {
                        console.log('[PDF Export] Export not allowed by Power BI, status:', status);
                        // Still try fallback - it has better messaging for Desktop users
                    }
                } catch (apiError) {
                    console.warn('[PDF Export] Power BI API failed, trying fallback:', apiError);
                }
            } else {
                console.log('[PDF Export] Download service not available, using fallback');
            }

            // Fallback: Direct download using blob URL
            console.log('[PDF Export] Using fallback download method...');
            this.fallbackDownload(pdfBase64, filename);

        } catch (error) {
            console.error('[PDF Export] Export failed:', error);
            alert('PDF export failed. Please check the console for details.');
        } finally {
            this.isExporting = false;
            this.updateExportButtonState(false);
            console.log('[PDF Export] Export process finished');
        }
    }

    /**
     * Fallback download method using blob URL
     * This works when the Power BI Download Service is unavailable
     */
    private fallbackDownload(base64Content: string, filename: string): void {
        try {
            // Convert base64 to blob
            const byteCharacters = atob(base64Content);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: 'application/pdf' });

            // Try method 1: Direct download link
            try {
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = filename;
                link.style.display = 'none';

                document.body.appendChild(link);
                link.click();

                setTimeout(() => {
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                }, 100);

                console.log('[PDF Export] Fallback download initiated:', filename);
                return;
            } catch (downloadError) {
                console.warn('[PDF Export] Direct download blocked, trying window.open...', downloadError);
            }

            // Try method 2: Open in new window (works in some Desktop scenarios)
            try {
                const dataUri = 'data:application/pdf;base64,' + base64Content;
                const newWindow = window.open(dataUri, '_blank');
                if (newWindow) {
                    console.log('[PDF Export] Opened PDF in new tab. Use Ctrl+S or right-click to save.');
                    alert('PDF opened in a new tab.\n\nUse Ctrl+S or right-click and "Save as..." to download it.');
                    return;
                }
            } catch (windowError) {
                console.warn('[PDF Export] window.open blocked:', windowError);
            }

            // Method 3: Copy to clipboard as last resort
            console.log('[PDF Export] All download methods blocked. Showing manual instructions.');
            alert(
                'PDF Export is blocked by browser security in Power BI Desktop.\n\n' +
                'Workaround options:\n' +
                '1. Publish the report to Power BI Service and export from there\n' +
                '2. Use Power BI Desktop\'s built-in "Export to PDF" feature (File → Export → PDF)\n' +
                '3. Take a screenshot of the visual'
            );
        } catch (error) {
            console.error('[PDF Export] Fallback download failed:', error);
            alert('Unable to download PDF. This feature may not be available in the current environment.');
        }
    }

    /**
     * Handle cases where export is not allowed
     */
    private handleExportNotAllowed(status: PrivilegeStatus): void {
        let message: string;
        let userMessage: string;

        switch (status) {
            case PrivilegeStatus.DisabledByAdmin:
                message = 'Export is disabled by your administrator.';
                userMessage = 'PDF Export is disabled by your Power BI administrator.\n\n' +
                    'To enable this feature, your admin needs to allow "Export data" in the tenant settings.';
                break;
            case PrivilegeStatus.NotDeclared:
                message = 'Export capability not configured.';
                userMessage = 'PDF Export is not properly configured. Please reload the visual.';
                break;
            case PrivilegeStatus.NotSupported:
                message = 'Export is not supported in this environment.';
                userMessage = 'PDF Export is not supported in this environment.\n\n' +
                    'Try using Power BI Service (app.powerbi.com) instead of Desktop development mode.';
                break;
            default:
                message = 'Export is currently unavailable.';
                userMessage = 'PDF Export is currently unavailable. Please try again later.';
        }

        console.warn('Export not allowed:', message);
        alert(userMessage);
        this.isExporting = false;
        this.updateExportButtonState(false);
    }

    /**
     * Generates PDF content by compositing all visual layers onto a single canvas
     * @returns Base64 encoded PDF content
     */
    private async generatePDFContent(): Promise<string> {
        const scaleFactor = 2; // Export at 2x for quality

        // Get dimensions
        const visualWidth = this.target.clientWidth;
        const visualHeight = this.target.clientHeight;

        // Create high-resolution output canvas
        const outputCanvas = document.createElement('canvas');
        outputCanvas.width = visualWidth * scaleFactor;
        outputCanvas.height = visualHeight * scaleFactor;

        const ctx = outputCanvas.getContext('2d');
        if (!ctx) {
            throw new Error('Failed to get canvas context');
        }

        // Scale for high-res output
        ctx.scale(scaleFactor, scaleFactor);

        // 1. Fill with background color
        const bgColor = this.settings?.generalSettings?.visualBackgroundColor?.value?.value || '#FFFFFF';
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, visualWidth, visualHeight);

        // 2. Capture and draw sticky header
        if (this.headerSvg) {
            try {
                const headerNode = this.headerSvg.node() as SVGSVGElement;
                if (headerNode) {
                    const headerCanvas = await this.svgToCanvas(headerNode);
                    ctx.drawImage(headerCanvas, 0, 0);
                }
            } catch (e) {
                console.warn('Could not capture header SVG:', e);
            }
        }

        // 3. Draw main content area
        const contentY = this.headerHeight;

        if (this.useCanvasRendering && this.canvasElement) {
            // Canvas mode: draw the existing canvas
            const canvasRect = this.canvasElement.getBoundingClientRect();
            const targetRect = this.target.getBoundingClientRect();
            const offsetX = canvasRect.left - targetRect.left;
            const offsetY = canvasRect.top - targetRect.top;

            ctx.drawImage(
                this.canvasElement,
                0, 0, this.canvasElement.width, this.canvasElement.height,
                offsetX, offsetY,
                this.canvasElement.width / (window.devicePixelRatio || 1),
                this.canvasElement.height / (window.devicePixelRatio || 1)
            );
        } else if (this.mainSvg) {
            // SVG mode: convert SVG to canvas and draw
            try {
                const mainSvgNode = this.mainSvg.node() as SVGSVGElement;
                if (mainSvgNode) {
                    const mainCanvas = await this.svgToCanvas(mainSvgNode);
                    ctx.drawImage(mainCanvas, this.margin.left, contentY);
                }
            } catch (e) {
                console.warn('Could not capture main SVG:', e);
            }
        }

        // 4. Generate PDF from composite canvas
        // Use JPEG with quality 0.92 for much smaller file size (PNG would be ~32MB, JPEG ~1-2MB)
        const imgData = outputCanvas.toDataURL('image/jpeg', 0.92);
        console.log('[PDF Export] Image data size:', Math.round(imgData.length / 1024), 'KB');

        const pdf = new jsPDF({
            orientation: visualWidth > visualHeight ? 'landscape' : 'portrait',
            unit: 'px',
            format: [visualWidth, visualHeight],
            compress: true
        });

        pdf.addImage(imgData, 'JPEG', 0, 0, visualWidth, visualHeight, undefined, 'FAST');

        // Return base64 without the data URI prefix
        const pdfOutput = pdf.output('datauristring');
        return pdfOutput.split(',')[1];
    }

    /**
     * Converts an SVG element to a canvas
     */
    private svgToCanvas(svg: SVGSVGElement): Promise<HTMLCanvasElement> {
        return new Promise((resolve, reject) => {
            try {
                // Clone the SVG to avoid modifying the original
                const clonedSvg = svg.cloneNode(true) as SVGSVGElement;

                // Ensure the SVG has proper namespace
                // eslint-disable-next-line powerbi-visuals/no-http-string
                clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
                // eslint-disable-next-line powerbi-visuals/no-http-string
                clonedSvg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

                // Get computed styles and inline them
                const bbox = svg.getBoundingClientRect();
                clonedSvg.setAttribute('width', String(bbox.width));
                clonedSvg.setAttribute('height', String(bbox.height));

                const svgData = new XMLSerializer().serializeToString(clonedSvg);
                const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
                const url = URL.createObjectURL(svgBlob);

                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = bbox.width * 2;  // 2x for quality
                    canvas.height = bbox.height * 2;

                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        ctx.scale(2, 2);
                        ctx.drawImage(img, 0, 0);
                    }

                    URL.revokeObjectURL(url);
                    resolve(canvas);
                };
                img.onerror = () => {
                    URL.revokeObjectURL(url);
                    reject(new Error('Failed to load SVG as image'));
                };
                img.src = url;
            } catch (e) {
                reject(e);
            }
        });
    }

    /**
     * Log data loading info. With 'top' algorithm, data arrives in one batch.
     */
    private logDataLoadInfo(dataView: DataView): void {
        const rowCount = dataView.table?.rows?.length || 0;
        const hasTotalFloat = this.hasDataRole(dataView, 'taskTotalFloat');

        this.debugLog(
            `[WBS] Data loaded: ${rowCount.toLocaleString()} rows`,
            `| Sorted by: ${hasTotalFloat ? 'Total Float (critical first)' : 'Start Date'}`
        );

        if (rowCount >= 30000) {
            console.warn(
                `[WBS] Dataset at 30,000 row limit. ` +
                `Critical tasks prioritized via ${hasTotalFloat ? 'Total Float' : 'Start Date'} sort.`
            );
        }
    }

    /**
     * Format a number with thousands separators for display.
     */
    private formatNumber(num: number): string {
        return num.toLocaleString();
    }

    /**
     * Show/hide loading overlay (simplified - no segment tracking).
     */
    private setLoadingOverlayVisible(show: boolean, options?: { message?: string; rowCount?: number }): void {
        if (!this.loadingOverlay) return;

        if (show) {
            if (!this.loadingStartTime) {
                this.loadingStartTime = performance.now();
            }
            if (options?.message && this.loadingText) {
                this.loadingText.text(options.message);
            }
            if (this.loadingRowsText && options?.rowCount !== undefined) {
                this.loadingRowsText.text(options.rowCount > 0 ? `${this.formatNumber(options.rowCount)} rows` : "Initializing…");
            }
            if (this.loadingProgressText) {
                this.loadingProgressText.text("");
            }
            this.loadingOverlay.style("display", "flex");
            this.mainSvg?.style("visibility", "hidden");
            this.canvasLayer?.style("visibility", "hidden");
            this.isLoadingVisible = true;
        } else {
            this.loadingStartTime = null;
            this.loadingOverlay.style("display", "none");
            this.mainSvg?.style("visibility", "visible");
            this.canvasLayer?.style("visibility", "visible");
            this.isLoadingVisible = false;
        }
    }

    public update(options: VisualUpdateOptions) {
        this.eventService.renderingStarted(options);

        this.debugLog("===== UPDATE() CALLED =====");
        this.debugLog("Update type:", options.type);
        this.debugLog("Has dataViews:", !!options.dataViews);

        this.updateInternal(options)
            .then(() => {
                this.eventService.renderingFinished(options);
            })
            .catch(error => {
                console.error("Error during update:", error);
                this.eventService.renderingFinished(options);
            });
    }

    private async updateInternal(options: VisualUpdateOptions) {
        this.debugLog("--- Visual Update Start ---");
        this.renderStartTime = performance.now();
        this.hideTooltip();

        if (this.isUpdating) {
            this.debugLog("Update already in progress, skipping");
            return;
        }

        if (this.scrollThrottleTimeout) {
            clearTimeout(this.scrollThrottleTimeout);
            this.scrollThrottleTimeout = null;
        }

        if (this.isMarginDragging) {
            this.debugLog("Margin drag in progress, skipping Power BI update");
            return;
        }

        this.isUpdating = true;

        const allowInteractions = (options as VisualUpdateOptions & { allowInteractions?: boolean }).allowInteractions;
        const hostAllowsInteractions = this.host?.hostCapabilities?.allowInteractions;
        this.allowInteractions = allowInteractions !== false && hostAllowsInteractions !== false;
        this.updateHighContrastState();
        this.refreshDateFormatters();
        this.applyHighContrastStyling();
        const eventService = this.eventService;
        let renderingFailed = false;
        eventService?.renderingStarted(options);

        try {
            const updateType = this.determineUpdateType(options);
            this.debugLog(`Update type detected: ${updateType}`);

            if (updateType === UpdateType.Full && this.scrollableContainer?.node()) {
                const node = this.scrollableContainer.node();

                const now = Date.now();
                const inCooldownPeriod = now < this.scrollPreservationUntil;
                const wbsToggleRecent = this.lastWbsToggleTimestamp > 0 && (now - this.lastWbsToggleTimestamp) < 2000;
                const shouldPreserveScroll = this.preserveScrollOnUpdate || inCooldownPeriod || wbsToggleRecent;

                this.debugLog(`Scroll preservation check: flag=${this.preserveScrollOnUpdate}, inCooldown=${inCooldownPeriod}, wbsRecent=${wbsToggleRecent}, shouldPreserve=${shouldPreserveScroll}, scrollTop=${node.scrollTop}`);

                this.preserveScrollOnUpdate = false;

                if (!shouldPreserveScroll && !this.scrollThrottleTimeout && node.scrollTop > 0 && this.preservedScrollTop === null && this.wbsToggleScrollAnchor === null) {
                    if (this.scrollListener) {
                        this.scrollableContainer.on("scroll", null);
                        this.scrollHandlerBackup = this.scrollListener;
                    }

                    this.debugLog("Resetting scroll position for full update");
                    node.scrollTop = 0;

                    requestAnimationFrame(() => {
                        if (this.scrollHandlerBackup && this.scrollableContainer) {
                            this.scrollableContainer.on("scroll", this.scrollHandlerBackup);
                            this.scrollHandlerBackup = null;
                        }
                    });
                } else if (shouldPreserveScroll) {
                    this.debugLog("Preserving scroll position for individual WBS group toggle");
                }
            }

            this.lastViewport = options.viewport;

            if (updateType === UpdateType.ViewportOnly && this.allTasksData.length > 0) {
                this.handleViewportOnlyUpdate(options);
                return;
            }

            if (updateType === UpdateType.SettingsOnly && this.allTasksData.length > 0) {
                this.handleSettingsOnlyUpdate(options);
                return;
            }

            this.lastUpdateOptions = options;
            this.clearLandingPage();

            if (!options || !options.dataViews || !options.dataViews[0] || !options.viewport) {
                this.applyTaskFilter([]);
                this.displayLandingPage();
                return;
            }

            const dataView = options.dataViews[0];
            const viewport = options.viewport;
            const viewportHeight = viewport.height;
            const viewportWidth = viewport.width;
            const dataSignature = this.getDataSignature(dataView);
            const dataChanged = (options.type & VisualUpdateType.Data) !== 0 ||
                this.lastDataSignature !== dataSignature;

            if (dataChanged) {
                this.logDataLoadInfo(dataView);
            }

            this.setLoadingOverlayVisible(false);

            this.wbsLevelColumnIndices = [];
            this.wbsLevelColumnNames = [];
            this.wbsDataExistsInMetadata = this.hasDataRole(dataView, 'wbsLevels');

            if (this.wbsDataExistsInMetadata && dataView.table?.columns) {

                for (let i = 0; i < dataView.table.columns.length; i++) {
                    const column = dataView.table.columns[i];
                    if (column.roles && column.roles['wbsLevels']) {
                        this.wbsLevelColumnIndices.push(i);
                        this.wbsLevelColumnNames.push(column.displayName || `Level ${this.wbsLevelColumnIndices.length}`);
                    }
                }
            }

            this.settings = this.formattingSettingsService.populateFormattingSettingsModel(VisualSettings, dataView);

            if (this.settings?.comparisonBars?.showBaseline !== undefined) {
                this.showBaselineInternal = this.settings.comparisonBars.showBaseline.value;
            }

            if (this.settings?.comparisonBars?.showPreviousUpdate !== undefined) {
                this.showPreviousUpdateInternal = this.settings.comparisonBars.showPreviousUpdate.value;
            }

            if (this.settings?.connectorLines?.showConnectorLines !== undefined) {
                this.showConnectorLinesInternal = this.settings.connectorLines.showConnectorLines.value;
            }

            if (this.settings?.columns?.enableColumnDisplay !== undefined) {
                this.showExtraColumnsInternal = this.settings.columns.enableColumnDisplay.value;
            }

            if (this.settings?.wbsGrouping?.expandCollapseAll !== undefined) {
                this.wbsExpandedInternal = this.settings.wbsGrouping.expandCollapseAll.value;

                if (!this.wbsManualExpansionOverride && this.wbsExpandToLevel === undefined) {
                    this.wbsExpandToLevel = this.wbsExpandedInternal ? undefined : 0;
                }
            }

            this.showNearCritical = this.settings.criticalPath.showNearCritical.value;

            this.applyPublishModeOptimizations();

            this.updateZoomSliderVisibility();

            if (this.isInitialLoad) {
                if (this.settings?.criticalPath?.showAllTasks !== undefined) {
                    this.showAllTasksInternal = this.settings.criticalPath.showAllTasks.value;
                }

                if (this.settings?.persistedState?.selectedTaskId !== undefined) {
                    this.selectedTaskId = this.settings.persistedState.selectedTaskId.value || null;
                }
                if (this.settings?.persistedState?.floatThreshold !== undefined) {
                    this.floatThreshold = this.settings.persistedState.floatThreshold.value;
                }
                if (this.settings?.persistedState?.traceMode !== undefined) {
                    const persistedMode = this.settings.persistedState.traceMode.value;
                    this.traceMode = persistedMode ? persistedMode : "backward";
                }

                if (this.settings?.persistedState?.selectedLegendCategories !== undefined) {
                    const savedCategories = this.settings.persistedState.selectedLegendCategories.value;
                    if (savedCategories && savedCategories.trim().length > 0) {
                        this.selectedLegendCategories = new Set(savedCategories.split(',').filter(c => c.trim()));
                        this.debugLog(`Restored legend selection: ${savedCategories}`);
                    } else {
                        this.selectedLegendCategories.clear();
                    }
                }
                if (this.settings?.persistedState?.wbsExpandedState !== undefined) {
                    const savedState = this.settings.persistedState.wbsExpandedState.value;
                    this.wbsExpandedState.clear();
                    if (savedState && savedState.trim().length > 0) {
                        try {
                            const parsed = JSON.parse(savedState) as Record<string, unknown>;
                            if (parsed && typeof parsed === "object") {
                                for (const [groupId, expanded] of Object.entries(parsed)) {
                                    if (typeof expanded === "boolean") {
                                        this.wbsExpandedState.set(groupId, expanded);
                                    }
                                }
                            }
                        } catch (error) {
                            console.warn("Failed to parse persisted WBS expanded state.", error);
                        }
                    }
                } else {
                    this.wbsExpandedState.clear();
                }
                if (this.settings?.persistedState?.wbsManualToggledGroups !== undefined) {
                    const savedGroups = this.settings.persistedState.wbsManualToggledGroups.value;
                    this.wbsManuallyToggledGroups.clear();
                    if (savedGroups && savedGroups.trim().length > 0) {
                        try {
                            const parsed = JSON.parse(savedGroups) as unknown;
                            if (Array.isArray(parsed)) {
                                for (const groupId of parsed) {
                                    if (typeof groupId === "string" && groupId.length > 0) {
                                        this.wbsManuallyToggledGroups.add(groupId);
                                    }
                                }
                            }
                        } catch (error) {
                            console.warn("Failed to parse persisted WBS manual group list.", error);
                        }
                    }
                } else {
                    this.wbsManuallyToggledGroups.clear();
                }
                if (this.settings?.persistedState?.wbsExpandLevel !== undefined) {
                    const persistedLevel = this.settings.persistedState.wbsExpandLevel.value;
                    if (persistedLevel !== undefined && persistedLevel !== null) {
                        if (persistedLevel === -2) {
                            this.wbsManualExpansionOverride = true;
                            this.wbsExpandToLevel = undefined;
                            if (this.wbsExpandedState.size > 0) {
                                this.wbsExpandedInternal = Array.from(this.wbsExpandedState.values()).some(v => v);
                            }
                        } else {
                            const resolvedLevel = persistedLevel === -1 ? null : persistedLevel;
                            this.wbsManualExpansionOverride = false;
                            this.wbsExpandToLevel = resolvedLevel;
                            this.wbsExpandedInternal = resolvedLevel !== 0;
                        }
                    }
                }
                // Phase 1: Restore persisted zoom range
                if (this.settings?.persistedState?.zoomRangeStart !== undefined &&
                    this.settings?.persistedState?.zoomRangeEnd !== undefined) {
                    const persistedStart = this.settings.persistedState.zoomRangeStart.value;
                    const persistedEnd = this.settings.persistedState.zoomRangeEnd.value;
                    // Only restore if it's a valid non-default range
                    if (typeof persistedStart === 'number' && typeof persistedEnd === 'number' &&
                        persistedEnd > persistedStart && persistedStart >= 0 && persistedEnd <= 1) {
                        this.zoomRangeStart = persistedStart;
                        this.zoomRangeEnd = persistedEnd;
                        this.debugLog(`Restored zoom range: ${persistedStart} - ${persistedEnd}`);
                    }
                }
                this.isInitialLoad = false;
            }

            const criticalColor = this.settings.criticalPath.criticalPathColor.value.value;
            const connectorColor = this.settings.connectorLines.connectorColor.value.value;

            this.margin.left = this.settings.layoutSettings.leftMargin.value;
            this.margin.right = this.settings.layoutSettings.rightMargin.value;
            this.updateMarginResizerPosition();

            this.clearVisual();
            this.updateHeaderElements(viewportWidth);
            this.createFloatThresholdControl();
            this.createpathSelectionDropdown();
            this.createTraceModeToggle();

            if (!this.validateDataView(dataView)) {
                this.applyTaskFilter([]);
                const missingRoles = this.getMissingRequiredRoles(dataView);
                this.displayLandingPage(missingRoles);
                return;
            }
            this.debugLog("Data roles validated.");

            const shouldTransform = dataChanged || this.allTasksData.length === 0;
            if (shouldTransform) {
                this.transformDataOptimized(dataView);
                this.lastDataSignature = dataSignature;
                this.cachedSortedTasksSignature = null;
                this.dropdownNeedsRefresh = true;
            } else {
                this.debugLog("Skipping data transform; using cached task data");
            }

            this.settings = this.formattingSettingsService.populateFormattingSettingsModel(VisualSettings, dataView);

            if (this.wbsEnableOverride !== null && this.settings?.wbsGrouping?.enableWbsGrouping) {
                this.settings.wbsGrouping.enableWbsGrouping.value = this.wbsEnableOverride;
                this.wbsEnableOverride = null;
            }

            if (this.selectedTaskId && !this.taskIdToTask.has(this.selectedTaskId)) {
                this.debugLog(`Selected task ${this.selectedTaskId} no longer exists in data`);
                this.selectTask(null, null);
            }

            if (this.allTasksData.length === 0) {
                this.applyTaskFilter([]);
                this.displayMessage("No valid task data found to display.");
                return;
            }
            this.debugLog(`Transformed ${this.allTasksData.length} tasks.`);

            if (this.selectedTaskId) {
                const selectedTask = this.taskIdToTask.get(this.selectedTaskId);
                this.selectedTaskName = (selectedTask && selectedTask.name) || null;
            }

            this.createpathSelectionDropdown();
            if (this.dropdownInput) {
                if (this.selectedTaskId) {
                    this.dropdownInput.property("value", this.selectedTaskName || "");
                } else {
                    this.dropdownInput.property("value", "");
                }
            }

            if (this.selectedTaskLabel) {
                if (this.selectedTaskId && this.selectedTaskName && this.settings.pathSelection.showSelectedTaskLabel.value) {
                    this.selectedTaskLabel
                        .style("display", "block")
                        .text(`${this.getLocalizedString("ui.selectedLabel", "Selected")}: ${this.selectedTaskName}`);
                } else {
                    this.selectedTaskLabel.style("display", "none");
                }
            }

            if (this.dropdownList && this.dropdownList.style("display") !== "none") {
                this.populateTaskDropdown();
            }
            this.createTraceModeToggle();
            this.applyHighContrastStyling();

            const enableTaskSelection = this.settings.pathSelection.enableTaskSelection.value;
            const mode = this.settings.criticalPath.calculationMode.value.value;

            let predecessorTaskSet = new Set<string>();
            let successorTaskSet = new Set<string>();

            if (enableTaskSelection && this.selectedTaskId) {
                const traceModeSetting = this.normalizeTraceMode(this.settings.pathSelection.traceMode.value.value);
                const effectiveTraceMode = this.normalizeTraceMode(this.traceMode || traceModeSetting);

                if (mode === 'floatBased') {
                    this.applyFloatBasedCriticality();

                    if (effectiveTraceMode === 'forward') {
                        successorTaskSet = this.identifySuccessorTasksFloatBased(this.selectedTaskId);
                    } else {
                        predecessorTaskSet = this.identifyPredecessorTasksFloatBased(this.selectedTaskId);
                    }
                } else {
                    if (this.showAllTasksInternal) {
                        this.debugLog("Longest Path 'Show All' is active: Performing full structural trace.");
                        if (effectiveTraceMode === 'forward') {
                            successorTaskSet = this.identifySuccessorTasksFloatBased(this.selectedTaskId);
                        } else {
                            predecessorTaskSet = this.identifyPredecessorTasksFloatBased(this.selectedTaskId);
                        }

                        if (effectiveTraceMode === 'forward') {
                            this.calculateCPMFromTask(this.selectedTaskId);
                        } else {
                            this.calculateCPMToTask(this.selectedTaskId);
                        }
                    } else {
                        this.debugLog("Longest Path 'Show Critical' is active: Tracing driving path.");
                        if (effectiveTraceMode === 'forward') {
                            this.calculateCPMFromTask(this.selectedTaskId);
                        } else {
                            this.calculateCPMToTask(this.selectedTaskId);
                        }
                    }
                }
            } else {
                if (mode === 'floatBased') {
                    this.applyFloatBasedCriticality();
                } else {
                    this.identifyLongestPathFromP6();
                }
            }

            this.ensureTaskSortCache(this.lastDataSignature ?? dataSignature);

            const plottableTasksSorted = this.cachedPlottableTasksSorted;

            const criticalAndNearCriticalTasks = plottableTasksSorted.filter(task =>
                task.isCritical || task.isNearCritical
            );

            let tasksToConsider: Task[] = [];

            if (enableTaskSelection && this.selectedTaskId) {
                const traceModeSetting = this.normalizeTraceMode(this.settings.pathSelection.traceMode.value.value);
                const effectiveTraceMode = this.normalizeTraceMode(this.traceMode || traceModeSetting);
                const relevantTaskSet = effectiveTraceMode === 'forward' ? successorTaskSet : predecessorTaskSet;
                const relevantPlottableTasks = plottableTasksSorted.filter(task => relevantTaskSet.has(task.internalId));

                if (this.showAllTasksInternal) {
                    tasksToConsider = relevantPlottableTasks.length > 0 ? relevantPlottableTasks : plottableTasksSorted;
                } else {
                    if (mode === 'floatBased') {
                        const criticalTraceTasks = relevantPlottableTasks.filter(task => task.isCritical || task.isNearCritical);
                        if (criticalTraceTasks.length > 0) {
                            tasksToConsider = criticalTraceTasks;
                        } else if (criticalAndNearCriticalTasks.length > 0) {
                            tasksToConsider = criticalAndNearCriticalTasks;
                        } else if (relevantPlottableTasks.length > 0) {
                            tasksToConsider = relevantPlottableTasks;
                        } else {
                            tasksToConsider = plottableTasksSorted;
                        }
                    } else {
                        if (criticalAndNearCriticalTasks.length > 0) {
                            tasksToConsider = criticalAndNearCriticalTasks;
                        } else if (relevantPlottableTasks.length > 0) {
                            tasksToConsider = relevantPlottableTasks;
                        } else {
                            tasksToConsider = plottableTasksSorted;
                        }
                    }
                }

                const selectedTask = this.taskIdToTask.get(this.selectedTaskId);
                if (selectedTask && this.hasValidPlotDates(selectedTask) && !tasksToConsider.find(t => t.internalId === this.selectedTaskId)) {
                    tasksToConsider.push(selectedTask);
                }
            } else {
                tasksToConsider = this.showAllTasksInternal
                    ? plottableTasksSorted
                    : (criticalAndNearCriticalTasks.length > 0) ? criticalAndNearCriticalTasks : plottableTasksSorted;
            }

            if (tasksToConsider === plottableTasksSorted) {
                tasksToConsider = [...plottableTasksSorted];
            }

            const maxTasksToShowSetting = this.settings.layoutSettings.maxTasksToShow.value;
            const limitedTasks = this.limitTasks(tasksToConsider, maxTasksToShowSetting);

            if (limitedTasks.length === 0) {
                this.applyTaskFilter([]);
                this.displayMessage("No tasks to display after filtering/limiting.");
                return;
            }

            const tasksToPlot = limitedTasks.filter(task => this.hasValidPlotDates(task));

            if (tasksToPlot.length === 0) {
                this.applyTaskFilter([]);
                this.displayMessage("Selected tasks lack valid Start/Finish dates required for plotting.");
                return;
            }

            const wbsGroupingEnabled = this.wbsDataExists &&
                this.settings?.wbsGrouping?.enableWbsGrouping?.value;

            let tasksAfterLegendFilter = tasksToPlot;
            if (this.legendDataExists && this.selectedLegendCategories.size > 0) {
                tasksAfterLegendFilter = tasksToPlot.filter(task => {
                    if (task.legendValue) {
                        return this.selectedLegendCategories.has(task.legendValue);
                    }
                    return true;
                });
            }

            this.allFilteredTasks = [...tasksAfterLegendFilter];

            if (wbsGroupingEnabled) {
                this.updateWbsFilteredCounts(tasksAfterLegendFilter);
            }

            let orderedTasks: Task[];
            if (wbsGroupingEnabled) {

                orderedTasks = this.applyWbsOrdering(tasksAfterLegendFilter);
            } else {

                orderedTasks = [...tasksAfterLegendFilter].sort((a, b) => (a.startDate?.getTime() ?? 0) - (b.startDate?.getTime() ?? 0));
            }

            let tasksToShow = orderedTasks;

            if (wbsGroupingEnabled) {
                this.assignWbsYOrder(tasksToShow);
            } else {

                tasksToShow.forEach((task, index) => { task.yOrder = index; });
            }

            const tasksWithYOrder = tasksToShow.filter(t => t.yOrder !== undefined);
            const visibleGroupCount = wbsGroupingEnabled ? this.wbsGroups.filter(g => g.yOrder !== undefined).length : 0;

            if (tasksWithYOrder.length === 0 && visibleGroupCount === 0) {
                this.applyTaskFilter([]);
                if (wbsGroupingEnabled) {
                    this.displayMessage("All WBS groups are collapsed or filtered. Expand a group to view tasks.");
                } else {
                    this.displayMessage("No tasks to display after filtering.");
                }
                return;
            }

            this.applyTaskFilter(tasksToShow.map(t => t.id));

            const taskHeight = this.settings.taskBars.taskHeight.value;
            const taskPadding = this.settings.layoutSettings.taskPadding.value;

            let totalRows = tasksWithYOrder.length;
            if (wbsGroupingEnabled) {

                let maxYOrder = -1;
                for (const task of tasksWithYOrder) {
                    if (task.yOrder !== undefined && task.yOrder > maxYOrder) {
                        maxYOrder = task.yOrder;
                    }
                }
                for (const group of this.wbsGroups) {
                    if (group.yOrder !== undefined && group.yOrder > maxYOrder) {
                        maxYOrder = group.yOrder;
                    }
                }

                totalRows = maxYOrder + 1;
            }

            const totalSvgHeight = Math.max(50, totalRows * (taskHeight + taskPadding)) + this.margin.top + this.margin.bottom;

            const scaleSetupResult = this.setupTimeBasedSVGAndScales({ width: viewportWidth, height: totalSvgHeight }, tasksToShow);
            this.xScale = scaleSetupResult.xScale;
            this.yScale = scaleSetupResult.yScale;
            const chartWidth = scaleSetupResult.chartWidth;
            const calculatedChartHeight = scaleSetupResult.calculatedChartHeight;

            if (!this.xScale || !this.yScale) {
                this.applyTaskFilter([]);
                this.displayMessage("Could not create time/band scale. Check Start/Finish dates.");
                return;
            }

            this.mainSvg.attr("width", viewportWidth).attr("height", totalSvgHeight);
            this.headerSvg.attr("width", viewportWidth);

            this.mainGroup.attr("transform", `translate(${this.margin.left}, ${this.margin.top})`);
            this.headerGridLayer.attr("transform", `translate(${this.margin.left}, 0)`);

            this.createMarginResizer();

            const legendVisible = this.settings.legend.show.value && this.legendDataExists && this.legendCategories.length > 0;
            const legendOffset = legendVisible ? this.legendFooterHeight : 0;
            const availableContentHeight = Math.max(0, viewportHeight - this.headerHeight - legendOffset);

            this.scrollableContainer
                .style("height", `${availableContentHeight}px`)
                .style("overflow-y", totalSvgHeight > availableContentHeight ? "scroll" : "hidden");

            this.taskElementHeight = taskHeight + taskPadding;

            this.restoreScrollPosition(totalSvgHeight);

            this.setupVirtualScroll(tasksToShow, taskHeight, taskPadding, totalRows, true);

            const visibleTasks = this.getVisibleTasks();

            this.drawVisualElements(visibleTasks, this.xScale, this.yScale, chartWidth, calculatedChartHeight);

            this.renderLegend(viewportWidth, viewportHeight);

            this.renderWbsCycleButtons(viewportWidth);

            this.updateZoomSliderUI();
            this.drawZoomSliderMiniChart();
            this.updateZoomSliderTrackMargins();

            const renderEndTime = performance.now();
            this.debugLog(`Total render time: ${renderEndTime - this.renderStartTime}ms`);

        } catch (error) {
            console.error("--- ERROR during visual update ---", error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            renderingFailed = true;
            eventService?.renderingFailed(options, errorMessage);

            this.applyTaskFilter([]);
            this.displayMessage(`Error updating visual: ${errorMessage}`);
        } finally {
            if (!renderingFailed) {
                eventService?.renderingFinished(options);
            }
            this.isUpdating = false;

            if (this.scrollHandlerBackup && this.scrollableContainer) {
                this.scrollableContainer.on("scroll", this.scrollHandlerBackup);
                this.scrollHandlerBackup = null;
                this.debugLog("Scroll handler restored in finally block");
            }
        }
    }

    private updateRenderOnly(): void {

        if (!this.lastViewport || !this.allTasksToShow) return;

        const scaleResult = this.setupTimeBasedSVGAndScales(
            this.lastViewport,
            this.allTasksToShow
        );

        if (!scaleResult.xScale || !scaleResult.yScale) return;

        this.xScale = scaleResult.xScale;
        this.yScale = scaleResult.yScale;

        // Redraw the vertical grid lines (x-axis timeline) to update in real-time during zoom
        const showVertGridLines = this.settings.gridLines.showVerticalLines.value;
        if (showVertGridLines && this.xScale && this.yScale) {
            this.drawgridLines(this.xScale, this.yScale.range()[1],
                this.gridLayer, this.headerGridLayer);
        }

        this.calculateVisibleTasks();

        this.redrawVisibleTasks();

        if (this.zoomSliderEnabled) {
            this.updateZoomSliderUI();
            this.drawZoomSliderMiniChart();
            this.updateZoomSliderTrackMargins();
        }
    }

    private handleViewportOnlyUpdate(options: VisualUpdateOptions): void {
        this.debugLog("Performing viewport-only update");
        const viewportWidth = options.viewport.width;
        const viewportHeight = options.viewport.height;

        this.updateHeaderElements(viewportWidth);

        const chartWidth = Math.max(10, viewportWidth - this.settings.layoutSettings.leftMargin.value - this.margin.right);
        const legendVisible = this.settings.legend.show.value && this.legendDataExists && this.legendCategories.length > 0;
        const legendOffset = legendVisible ? this.legendFooterHeight : 0;
        const availableContentHeight = Math.max(0, viewportHeight - this.headerHeight - legendOffset);
        const totalSvgHeight = this.taskTotalCount * this.taskElementHeight +
            this.margin.top + this.margin.bottom;

        this.scrollableContainer.style("height", `${availableContentHeight}px`)
            .style("overflow-y", totalSvgHeight > availableContentHeight ? "scroll" : "hidden");

        this.mainSvg.attr("width", viewportWidth);
        this.headerSvg.attr("width", viewportWidth);

        if (this.xScale) {
            this.xScale.range([0, chartWidth]);
            this.debugLog(`Updated X scale range to [0, ${chartWidth}]`);
        }

        this.calculateVisibleTasks();

        this.clearVisual();

        const showHorzGridLines = this.settings.gridLines.showHorizontalLines.value;
        const showVertGridLines = this.settings.gridLines.showVerticalLines.value;

        const visibleTasks = this.getVisibleTasks();
        const renderableTasks = visibleTasks.filter(t => t.yOrder !== undefined);

        if (showHorzGridLines && this.yScale) {
            const currentLeftMargin = this.settings.layoutSettings.leftMargin.value;
            this.drawHorizontalGridLines(renderableTasks, this.yScale, chartWidth, currentLeftMargin,
                this.yScale.range()[1]);
        }

        if (showVertGridLines && this.xScale && this.yScale) {
            this.drawgridLines(this.xScale, this.yScale.range()[1],
                this.gridLayer, this.headerGridLayer);
        }

        if (this.xScale && this.yScale) {
            this.drawVisualElements(
                renderableTasks,
                this.xScale,
                this.yScale,
                chartWidth,
                this.yScale.range()[1]
            );

            this.drawDataDateLine(
                this.xScale.range()[1],
                this.xScale,
                this.yScale.range()[1],
                this.gridLayer,
                this.headerGridLayer
            );
        }

        this.debugLog("--- Visual Update End (Viewport Only) ---");
    }

    private handleSettingsOnlyUpdate(options: VisualUpdateOptions): void {
        this.debugLog("Performing settings-only update");

        const oldSelectedPathIndex = this.settings?.pathSelection?.selectedPathIndex?.value;
        const oldMultiPathEnabled = this.settings?.pathSelection?.enableMultiPathToggle?.value;
        const oldShowPathInfo = this.settings?.pathSelection?.showPathInfo?.value;

        if (options.dataViews?.[0]) {
            this.processLegendData(options.dataViews[0]);
        }

        this.settings = this.formattingSettingsService.populateFormattingSettingsModel(
            VisualSettings, options.dataViews[0]);

        const newSelectedPathIndex = this.settings?.pathSelection?.selectedPathIndex?.value;
        const newMultiPathEnabled = this.settings?.pathSelection?.enableMultiPathToggle?.value;
        const newShowPathInfo = this.settings?.pathSelection?.showPathInfo?.value;

        this.debugLog(`[Settings Update] Old path index: ${oldSelectedPathIndex}, New: ${newSelectedPathIndex}`);
        this.debugLog(`[Settings Update] Old multi-path: ${oldMultiPathEnabled}, New: ${newMultiPathEnabled}`);
        this.debugLog(`[Settings Update] Old show info: ${oldShowPathInfo}, New: ${newShowPathInfo}`);

        const drivingPathChanged = oldSelectedPathIndex !== newSelectedPathIndex ||
            oldMultiPathEnabled !== newMultiPathEnabled ||
            oldShowPathInfo !== newShowPathInfo;

        if (this.settings?.comparisonBars?.showBaseline !== undefined) {
            this.showBaselineInternal = this.settings.comparisonBars.showBaseline.value;
        }

        if (drivingPathChanged) {
            this.debugLog("Driving path selection changed, recalculating...");
            const mode = this.settings?.criticalPath?.calculationMode?.value?.value ?? 'longestPath';
            if (mode === 'longestPath') {
                this.identifyLongestPathFromP6();
            } else {

                this.updatePathInfoLabel();
            }
        }

        this.clearVisual();

        this.updateHeaderElements(options.viewport.width);
        this.createFloatThresholdControl();
        this.createpathSelectionDropdown();

        if (this.dropdownInput) {
            if (this.selectedTaskId) {
                this.dropdownInput.property("value", this.selectedTaskName || "");
            } else {
                this.dropdownInput.property("value", "");
            }
        }

        if (this.selectedTaskLabel) {
            if (this.selectedTaskId && this.selectedTaskName && this.settings.pathSelection.showSelectedTaskLabel.value) {
                this.selectedTaskLabel
                    .style("display", "block")
                    .text(`${this.getLocalizedString("ui.selectedLabel", "Selected")}: ${this.selectedTaskName}`);
            } else {
                this.selectedTaskLabel.style("display", "none");
            }
        }

        if (this.dropdownList && this.dropdownList.style("display") !== "none") {
            this.populateTaskDropdown();
        }
        this.createTraceModeToggle();

        if (this.xScale && this.yScale) {

            const taskHeight = this.settings.taskBars.taskHeight.value;
            const taskPadding = this.settings.layoutSettings.taskPadding.value;
            const wbsGroupingEnabled = this.wbsDataExists && this.settings?.wbsGrouping?.enableWbsGrouping?.value;

            let totalRows = this.allTasksToShow.length;
            if (wbsGroupingEnabled) {

                let maxYOrder = -1;
                for (const task of this.allTasksToShow) {
                    if (task.yOrder !== undefined && task.yOrder > maxYOrder) {
                        maxYOrder = task.yOrder;
                    }
                }
                for (const group of this.wbsGroups) {
                    if (group.yOrder !== undefined && group.yOrder > maxYOrder) {
                        maxYOrder = group.yOrder;
                    }
                }
                if (maxYOrder >= 0) {
                    totalRows = maxYOrder + 1;
                }
            }

            const scaleSetupResult = this.setupTimeBasedSVGAndScales(
                options.viewport,
                this.allTasksToShow
            );
            this.xScale = scaleSetupResult.xScale;
            this.yScale = scaleSetupResult.yScale;
            const chartWidth = scaleSetupResult.chartWidth;
            const calculatedChartHeight = scaleSetupResult.calculatedChartHeight;

            this.taskElementHeight = taskHeight + taskPadding;

            const totalSvgHeight = Math.max(50, totalRows * this.taskElementHeight) + this.margin.top + this.margin.bottom;
            this.mainSvg.attr("height", totalSvgHeight);
            this.taskTotalCount = totalRows;

            this.calculateVisibleTasks();

            const visibleTasks = this.getVisibleTasks();

            if (this.xScale && this.yScale) {
                this.drawVisualElements(
                    visibleTasks,
                    this.xScale,
                    this.yScale,
                    chartWidth,
                    calculatedChartHeight
                );

                this.drawDataDateLine(
                    this.xScale.range()[1],
                    this.xScale,
                    this.yScale.range()[1],
                    this.gridLayer,
                    this.headerGridLayer
                );
            }
        }

        this.debugLog("--- Visual Update End (Settings Only) ---");
    }

    /**
     * Creates the left margin resizer used to resize the label column.
     */
    private createMarginResizer(): void {
        if (!this.scrollableContainer) return;

        const wrapper = d3.select(this.target).select<HTMLDivElement>(".visual-wrapper");
        if (wrapper.empty()) return;

        wrapper.selectAll(".margin-resizer").remove();

        const resizerWidth = 8;
        const lineColor = this.UI_TOKENS.color.neutral.grey60;

        this.marginResizer = wrapper.append("div")
            .attr("class", "margin-resizer")
            .attr("role", "separator")
            .attr("aria-orientation", "vertical")
            .attr("aria-label", "Resize task label margin")
            .style("position", "absolute")
            .style("top", "0")
            .style("width", `${resizerWidth}px`)
            .style("cursor", "col-resize")
            .style("z-index", "60")
            .style("user-select", "none")
            .style("touch-action", "none");

        this.marginResizer.append("div")
            .attr("class", "margin-resizer-line")
            .style("position", "absolute")
            .style("top", "0")
            .style("bottom", "0")
            .style("left", "50%")
            .style("width", "1px")
            .style("transform", "translateX(-0.5px)")
            .style("background-color", lineColor)
            .style("opacity", "0.7")
            .style("pointer-events", "none");

        const self = this;
        let startX = 0;
        let startMargin = 0;
        let previousCursor = "";
        let previousUserSelect = "";

        const getMarginBounds = (): { min: number; max: number } => {
            const minValue = this.settings?.layoutSettings?.leftMargin?.options?.minValue?.value ?? 50;
            const maxValue = this.settings?.layoutSettings?.leftMargin?.options?.maxValue?.value ?? 1000;
            const viewportWidth = this.lastViewport?.width
                || this.lastUpdateOptions?.viewport?.width
                || (this.target instanceof HTMLElement ? this.target.clientWidth : 0);
            const maxByViewport = Math.max(minValue, viewportWidth - this.margin.right - 10);
            return {
                min: minValue,
                max: Math.min(maxValue, maxByViewport)
            };
        };

        const clampMargin = (value: number): number => {
            const bounds = getMarginBounds();
            return Math.min(Math.max(value, bounds.min), bounds.max);
        };

        let latestClientX = 0;
        let rafId: number | null = null;

        const performDragUpdate = (): void => {
            try {
                const delta = latestClientX - startX;
                const nextMargin = clampMargin(startMargin + delta);
                if (nextMargin !== self.margin.left) {
                    self.handleMarginDragUpdate(nextMargin);
                    self.updateZoomSliderTrackMargins();
                }
            } catch (e) {
                console.error("Drag update error:", e);
            } finally {
                rafId = null;
            }
        };

        const updateMargin = (clientX: number): void => {
            latestClientX = clientX;
            if (rafId === null) {
                rafId = requestAnimationFrame(performDragUpdate);
            }
        };

        const endDrag = (): void => {
            if (!self.isMarginDragging) return;
            self.isMarginDragging = false;

            if (rafId !== null) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }

            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", endDrag);
            document.removeEventListener("touchmove", onTouchMove);
            document.removeEventListener("touchend", endDrag);

            document.body.style.cursor = previousCursor;
            document.body.style.userSelect = previousUserSelect;

            if (self.settings?.layoutSettings?.leftMargin) {
                self.settings.layoutSettings.leftMargin.value = self.margin.left;
            }

            self.host.persistProperties({
                merge: [{
                    objectName: "layoutSettings",
                    properties: { leftMargin: self.margin.left },
                    selector: null
                }]
            });

            // Issue 2 Fix: Preserve scroll position when update triggers
            if (self.scrollableContainer?.node()) {
                self.preservedScrollTop = self.scrollableContainer.node().scrollTop;
            }
            self.preserveScrollOnUpdate = true;
            // Note: We do NOT call self.requestUpdate(true) here to avoid double-update race conditions for scroll
        };

        const onMouseMove = (event: MouseEvent): void => {
            if (!self.isMarginDragging) return;
            event.preventDefault();
            updateMargin(event.clientX);
        };

        const onTouchMove = (event: TouchEvent): void => {
            if (!self.isMarginDragging || event.touches.length === 0) return;
            event.preventDefault();
            updateMargin(event.touches[0].clientX);
        };

        const startDrag = (clientX: number): void => {
            if (self.isMarginDragging) return;
            self.isMarginDragging = true;
            startX = clientX;
            startMargin = self.margin.left;
            previousCursor = document.body.style.cursor;
            previousUserSelect = document.body.style.userSelect;
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", endDrag);
            document.addEventListener("touchmove", onTouchMove, { passive: false });
            document.addEventListener("touchend", endDrag);
        };

        this.marginResizer
            .attr("tabindex", "0")
            .attr("aria-valuemin", getMarginBounds().min.toString())
            .attr("aria-valuemax", getMarginBounds().max.toString())
            .on("mousedown", function (event: MouseEvent) {
                event.preventDefault();
                event.stopPropagation();
                startDrag(event.clientX);
            })
            .on("touchstart", function (event: TouchEvent) {
                if (event.touches.length === 0) return;
                event.preventDefault();
                event.stopPropagation();
                startDrag(event.touches[0].clientX);
            })
            .on("keydown", function (event: KeyboardEvent) {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const step = event.shiftKey ? 25 : 10;
                const delta = event.key === "ArrowLeft" ? -step : step;
                const nextMargin = clampMargin(self.margin.left + delta);
                self.handleMarginDragUpdate(nextMargin);
                self.updateZoomSliderTrackMargins();
                if (self.settings?.layoutSettings?.leftMargin) {
                    self.settings.layoutSettings.leftMargin.value = self.margin.left;
                }
                self.host.persistProperties({
                    merge: [{
                        objectName: "layoutSettings",
                        properties: { leftMargin: self.margin.left },
                        selector: null
                    }]
                });
                self.requestUpdate(true);
            });

        this.updateMarginResizerPosition();
    }

    /**
     * Updates the margin resizer's position to align with the current left margin.
     */
    private updateMarginResizerPosition(): void {
        if (!this.marginResizer || !this.scrollableContainer) return;

        const containerNode = this.scrollableContainer.node();
        if (!containerNode) return;

        const wrapperNode = containerNode.parentElement;
        if (!wrapperNode) return;

        const wrapperRect = wrapperNode.getBoundingClientRect();
        const containerRect = containerNode.getBoundingClientRect();
        const resizerWidth = parseFloat(this.marginResizer.style("width")) || 8;
        const left = containerNode.offsetLeft + this.margin.left - (resizerWidth / 2);
        const top = containerRect.top - wrapperRect.top;
        const height = containerRect.height;

        this.marginResizer
            .style("left", `${Math.max(0, Math.round(left))}px`)
            .style("top", `${Math.max(0, Math.round(top))}px`)
            .style("height", `${Math.max(0, Math.round(height))}px`)
            .attr("aria-valuenow", Math.round(this.margin.left).toString());
    }

    /**
     * Handles margin-only updates during drag for real-time visual feedback
     * Does NOT recreate the resizer or call clearVisual() to preserve drag state
     */
    private handleMarginDragUpdate(newLeftMargin: number): void {
        if (!this.xScale || !this.yScale || !this.allTasksToShow) return;

        this.margin.left = newLeftMargin;
        if (this.settings?.layoutSettings?.leftMargin) {
            this.settings.layoutSettings.leftMargin.value = newLeftMargin;
        }

        const viewportWidth = this.lastViewport?.width || 0;
        const chartWidth = Math.max(10, viewportWidth - newLeftMargin - this.margin.right);

        // Calculate chartHeight from yScale - this is needed for finish lines to render
        const chartHeight = this.yScale.range()[1] || 0;

        this.xScale.range([0, chartWidth]);

        this.mainGroup?.attr("transform", `translate(${this.margin.left}, ${this.margin.top})`);
        this.headerGridLayer?.attr("transform", `translate(${this.margin.left}, 0)`);

        const visibleTasks = this.getVisibleTasks();

        this.gridLayer?.selectAll("*").remove();
        this.labelGridLayer?.selectAll("*").remove();
        this.arrowLayer?.selectAll("*").remove();
        this.taskLayer?.selectAll("*").remove();
        this.taskLabelLayer?.selectAll("*").remove();
        this.headerGridLayer?.selectAll("*").remove();

        this.drawVisualElements(
            visibleTasks,
            this.xScale,
            this.yScale,
            chartWidth,
            chartHeight
        );

        this.updateMarginResizerPosition();
        this.updateZoomSliderTrackMargins();
    }

    private clearVisual(): void {
        this.gridLayer?.selectAll("*").remove();
        this.arrowLayer?.selectAll("*").remove();
        this.taskLayer?.selectAll("*").remove();
        this.taskLabelLayer?.selectAll("*").remove();
        this.labelGridLayer?.selectAll("*").remove();
        this.wbsGroupLayer?.selectAll("*").remove();

        this.headerGridLayer?.selectAll("*").remove();

        /* Stop removing persistent header elements. They will be updated in place.
        this.headerSvg?.selectAll(".divider-line").remove();
        this.headerSvg?.selectAll(".connector-toggle-group").remove();
        this.stickyHeaderContainer?.selectAll(".visual-title").remove();
        */

        this.mainSvg?.selectAll(".message-text").remove();
        this.headerSvg?.selectAll(".message-text").remove();

        if (this.canvasElement && this.canvasContext) {
            this.canvasContext.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
            this.canvasElement.style.display = 'none';
        }
    }

    private drawHeaderDivider(viewportWidth: number): void {
        if (!this.headerSvg) return;

        /* Use D3 update pattern instead of always appending */

        const lineData = [viewportWidth];

        const lineSelection = this.headerSvg.selectAll<SVGLineElement, number>(".divider-line")
            .data(lineData);

        lineSelection.enter()
            .append("line")
            .attr("class", "divider-line")
            .attr("x1", 0)
            .attr("y1", this.headerHeight - 1)
            .attr("y2", this.headerHeight - 1)
            .attr("stroke", this.resolveColor("#e0e0e0", "foreground"))
            .attr("stroke-width", 1)
            .merge(lineSelection as any)
            .attr("x2", d => d);
    }

    private setupTimeBasedSVGAndScales(
        effectiveViewport: IViewport,
        tasksToShow: Task[]
    ): {
        xScale: ScaleTime<number, number> | null,
        yScale: ScaleBand<string> | null,
        chartWidth: number,
        calculatedChartHeight: number
    } {
        const taskHeight = this.settings.taskBars.taskHeight.value;
        const taskPadding = this.settings.layoutSettings.taskPadding.value;
        const currentLeftMargin = this.settings.layoutSettings.leftMargin.value;
        const svgWidth = effectiveViewport.width;

        let rowCount = tasksToShow.length;
        const wbsGroupingEnabled = this.wbsDataExists && this.settings?.wbsGrouping?.enableWbsGrouping?.value;

        if (wbsGroupingEnabled) {

            let maxYOrder = -1;
            for (const task of tasksToShow) {
                if (task.yOrder !== undefined && task.yOrder > maxYOrder) {
                    maxYOrder = task.yOrder;
                }
            }
            for (const group of this.wbsGroups) {
                if (group.yOrder !== undefined && group.yOrder > maxYOrder) {
                    maxYOrder = group.yOrder;
                }
            }

            if (maxYOrder >= 0) {
                rowCount = maxYOrder + 1;
            }
        }

        const calculatedChartHeight = Math.max(50, rowCount * (taskHeight + taskPadding));
        const chartWidth = Math.max(10, svgWidth - currentLeftMargin - this.margin.right);

        const allTimestamps: number[] = [];

        if (this.dataDate instanceof Date && !isNaN(this.dataDate.getTime())) {
            allTimestamps.push(this.dataDate.getTime());
        }

        const includeBaselineInScale = this.showBaselineInternal;
        const includePreviousUpdateInScale = this.showPreviousUpdateInternal;

        if (wbsGroupingEnabled && this.wbsGroups.length > 0) {
            for (const group of this.wbsGroups) {
                if (group.summaryStartDate && !isNaN(group.summaryStartDate.getTime())) {
                    allTimestamps.push(group.summaryStartDate.getTime());
                }
                if (group.summaryFinishDate && !isNaN(group.summaryFinishDate.getTime())) {
                    allTimestamps.push(group.summaryFinishDate.getTime());
                }

                if (this.showPreviousUpdateInternal) {
                    if (group.summaryPreviousUpdateStartDate && !isNaN(group.summaryPreviousUpdateStartDate.getTime())) {
                        allTimestamps.push(group.summaryPreviousUpdateStartDate.getTime());
                    }
                    if (group.summaryPreviousUpdateFinishDate && !isNaN(group.summaryPreviousUpdateFinishDate.getTime())) {
                        allTimestamps.push(group.summaryPreviousUpdateFinishDate.getTime());
                    }
                }

                if (this.showBaselineInternal) {
                    if (group.summaryBaselineStartDate && !isNaN(group.summaryBaselineStartDate.getTime())) {
                        allTimestamps.push(group.summaryBaselineStartDate.getTime());
                    }
                    if (group.summaryBaselineFinishDate && !isNaN(group.summaryBaselineFinishDate.getTime())) {
                        allTimestamps.push(group.summaryBaselineFinishDate.getTime());
                    }
                }
            }
        }

        tasksToShow.forEach(task => {

            if (task.startDate && !isNaN(task.startDate.getTime())) {
                allTimestamps.push(task.startDate.getTime());
            }
            if (task.finishDate && !isNaN(task.finishDate.getTime())) {
                allTimestamps.push(task.finishDate.getTime());
            }

            if (includeBaselineInScale) {
                if (task.baselineStartDate && !isNaN(task.baselineStartDate.getTime())) {
                    allTimestamps.push(task.baselineStartDate.getTime());
                }
                if (task.baselineFinishDate && !isNaN(task.baselineFinishDate.getTime())) {
                    allTimestamps.push(task.baselineFinishDate.getTime());
                }
            }

            if (includePreviousUpdateInScale) {
                if (task.previousUpdateStartDate && !isNaN(task.previousUpdateStartDate.getTime())) {
                    allTimestamps.push(task.previousUpdateStartDate.getTime());
                }
                if (task.previousUpdateFinishDate && !isNaN(task.previousUpdateFinishDate.getTime())) {
                    allTimestamps.push(task.previousUpdateFinishDate.getTime());
                }
            }
        });

        if (wbsGroupingEnabled && tasksToShow.length === 0) {
            for (const group of this.wbsGroups) {
                if (group.yOrder !== undefined && group.taskCount > 0) {
                    if (group.summaryStartDate && !isNaN(group.summaryStartDate.getTime())) {
                        allTimestamps.push(group.summaryStartDate.getTime());
                    }
                    if (group.summaryFinishDate && !isNaN(group.summaryFinishDate.getTime())) {
                        allTimestamps.push(group.summaryFinishDate.getTime());
                    }
                    if (this.showPreviousUpdateInternal) {
                        if (group.summaryPreviousUpdateStartDate && !isNaN(group.summaryPreviousUpdateStartDate.getTime())) {
                            allTimestamps.push(group.summaryPreviousUpdateStartDate.getTime());
                        }
                        if (group.summaryPreviousUpdateFinishDate && !isNaN(group.summaryPreviousUpdateFinishDate.getTime())) {
                            allTimestamps.push(group.summaryPreviousUpdateFinishDate.getTime());
                        }
                    }
                    if (this.showBaselineInternal) {
                        if (group.summaryBaselineStartDate && !isNaN(group.summaryBaselineStartDate.getTime())) {
                            allTimestamps.push(group.summaryBaselineStartDate.getTime());
                        }
                        if (group.summaryBaselineFinishDate && !isNaN(group.summaryBaselineFinishDate.getTime())) {
                            allTimestamps.push(group.summaryBaselineFinishDate.getTime());
                        }
                    }
                }
            }
        }

        const validTimestamps = allTimestamps.filter(t => t != null && !isNaN(t) && isFinite(t));

        if (validTimestamps.length === 0) {
            console.warn("No valid dates found among tasks to plot (including baseline dates if enabled). Cannot create time scale.");
            return { xScale: null, yScale: null, chartWidth, calculatedChartHeight };
        }

        const minTimestamp = Math.min(...validTimestamps);
        const maxTimestamp = Math.max(...validTimestamps);

        let domainMinDate: Date;
        let domainMaxDate: Date;

        if (minTimestamp > maxTimestamp) {
            const midPoint = (minTimestamp + maxTimestamp) / 2;
            const range = Math.max(86400000 * 7, Math.abs(maxTimestamp - minTimestamp) * 1.1);
            domainMinDate = new Date(midPoint - range / 2);
            domainMaxDate = new Date(midPoint + range / 2);
        } else if (minTimestamp === maxTimestamp) {
            domainMinDate = new Date(minTimestamp);
            domainMaxDate = new Date(minTimestamp + 86400000);
        } else {

            const domainPaddingMilliseconds = Math.max((maxTimestamp - minTimestamp) * 0.05, 86400000);
            domainMinDate = new Date(minTimestamp);
            domainMaxDate = new Date(maxTimestamp + domainPaddingMilliseconds);
        }

        this.fullTimelineDomain = [domainMinDate, domainMaxDate];

        let visibleMinDate = domainMinDate;
        let visibleMaxDate = domainMaxDate;

        const isZoomed = this.zoomSliderEnabled && (this.zoomRangeStart > 0 || this.zoomRangeEnd < 1);
        if (isZoomed) {
            const fullRange = domainMaxDate.getTime() - domainMinDate.getTime();
            visibleMinDate = new Date(domainMinDate.getTime() + fullRange * this.zoomRangeStart);
            visibleMaxDate = new Date(domainMinDate.getTime() + fullRange * this.zoomRangeEnd);
        }

        this.debugLog(`X-axis domain calculation:
        - Regular dates found: ${tasksToShow.filter(t => t.startDate || t.finishDate).length} tasks
        - Baseline dates included: ${includeBaselineInScale}
        - Total timestamps considered: ${validTimestamps.length}
        - Full Domain: ${domainMinDate.toISOString()} to ${domainMaxDate.toISOString()}
        - Zoomed: ${isZoomed} (${(this.zoomRangeStart * 100).toFixed(1)}% - ${(this.zoomRangeEnd * 100).toFixed(1)}%)
        - Visible Domain: ${visibleMinDate.toISOString()} to ${visibleMaxDate.toISOString()}`);

        return this.createScales(
            visibleMinDate, visibleMaxDate,
            chartWidth, tasksToShow, calculatedChartHeight,
            taskHeight, taskPadding
        );
    }

    private setupVirtualScroll(tasks: Task[], taskHeight: number, taskPadding: number, totalRows?: number, skipInitialRender: boolean = false): void {
        this.allTasksToShow = [...tasks];

        this.taskTotalCount = totalRows !== undefined ? totalRows : tasks.length;
        this.taskElementHeight = taskHeight + taskPadding;

        const totalContentHeight = this.taskTotalCount * this.taskElementHeight;

        this.mainSvg
            .attr("height", totalContentHeight + this.margin.top + this.margin.bottom);

        if (this.scrollListener) {
            this.scrollableContainer.on("scroll", null);
            this.scrollListener = null;
        }

        const self = this;
        this.scrollListener = function () {
            if (!self.scrollThrottleTimeout) {
                self.scrollThrottleTimeout = setTimeout(() => {
                    self.scrollThrottleTimeout = null;
                    self.handleScroll();
                }, 50);
            }
        };

        this.scrollableContainer.on("scroll", this.scrollListener);

        this.calculateVisibleTasks();

        if (!skipInitialRender && this.xScale && this.yScale && this.allTasksToShow.length > 0) {
            requestAnimationFrame(() => {
                this.redrawVisibleTasks();
            });
        }
    }

    private getCanvasMouseCoordinates(event: MouseEvent): { x: number, y: number } {
        if (!this.canvasElement) return { x: 0, y: 0 };

        const rect = this.canvasElement.getBoundingClientRect();

        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
        };
    }

    private getTaskAtCanvasPoint(x: number, y: number): Task | null {
        if (!this.xScale || !this.yScale) return null;

        const taskHeight = this.settings.taskBars.taskHeight.value;
        const milestoneSizeSetting = this.settings.taskBars.milestoneSize.value;
        const visibleTasks = this.allTasksToShow.slice(this.viewportStartIndex, this.viewportEndIndex + 1);

        for (const task of visibleTasks) {
            const domainKey = task.yOrder?.toString() ?? '';
            const yPosition = this.yScale(domainKey);
            if (yPosition === undefined) continue;

            if (y < yPosition || y > yPosition + taskHeight) {
                continue;
            }

            if (task.type === 'TT_Mile' || task.type === 'TT_FinMile') {
                const milestoneDate = task.startDate || task.finishDate;
                if (!milestoneDate) continue;
                const milestoneX = this.xScale(milestoneDate);
                const size = Math.max(4, Math.min(milestoneSizeSetting, taskHeight * 0.9));
                if (x >= milestoneX - size / 2 && x <= milestoneX + size / 2) {
                    return task;
                }
            } else {
                if (!task.startDate || !task.finishDate) continue;
                const taskX = this.xScale(task.startDate);
                const taskWidth = this.xScale(task.finishDate) - taskX;
                if (x >= taskX && x <= taskX + taskWidth) {
                    return task;
                }
            }
        }

        return null;
    }

    private drawRoundedRectPath(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        width: number,
        height: number,
        radius: number
    ): void {
        const clampedRadius = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
        ctx.beginPath();
        ctx.moveTo(x + clampedRadius, y);
        ctx.lineTo(x + width - clampedRadius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + clampedRadius);
        ctx.lineTo(x + width, y + height - clampedRadius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - clampedRadius, y + height);
        ctx.lineTo(x + clampedRadius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - clampedRadius);
        ctx.lineTo(x, y + clampedRadius);
        ctx.quadraticCurveTo(x, y, x + clampedRadius, y);
        ctx.closePath();
    }

    private showTaskTooltip(task: Task, event: MouseEvent): void {
        const showTooltips = this.settings?.generalSettings?.showTooltips?.value;
        if (!showTooltips || !task) return;

        const dataItems = this.buildTooltipDataItems(task);
        const identities = this.getTooltipIdentities(task);

        if (this.tooltipService && this.tooltipService.enabled()) {
            this.lastTooltipItems = dataItems;
            this.lastTooltipIdentities = identities;
            this.tooltipService.show({
                coordinates: [event.clientX, event.clientY],
                isTouchEvent: false,
                dataItems,
                identities
            });
            if (this.tooltipDiv) {
                this.tooltipDiv.style("visibility", "hidden");
            }
            return;
        }

        const tooltip = this.tooltipDiv;
        if (!tooltip) return;

        tooltip.selectAll("*").remove();
        tooltip.style("visibility", "visible");

        for (const item of dataItems) {
            const row = tooltip.append("div");
            row.append("strong").text(`${item.displayName}: `);
            row.append("span").text(item.value || "");
        }

        this.positionTooltip(tooltip.node(), event);
    }

    private hideTooltip(): void {
        if (this.tooltipService && this.tooltipService.enabled()) {
            this.tooltipService.hide({
                isTouchEvent: false,
                immediately: true
            });
        }
        this.lastTooltipItems = [];
        this.lastTooltipIdentities = [];
        if (this.tooltipDiv) {
            this.tooltipDiv.style("visibility", "hidden");
        }
    }

    private updateHeaderElements(viewportWidth: number): void {

        let currentToggleText = "";
        const textSelection = this.toggleButtonGroup?.select("text");

        if (textSelection && !textSelection.empty()) {
            currentToggleText = textSelection.text();
        }

        const expectedToggleText = this.showAllTasksInternal ? "Show Critical" : "Show All";

        if (currentToggleText !== expectedToggleText) {
            this.createOrUpdateToggleButton(viewportWidth);
        }

        const dividerLine = this.headerSvg?.select(".divider-line");
        if (dividerLine && !dividerLine.empty()) {
            const currentX2 = parseFloat(dividerLine.attr("x2"));
            if (Math.abs(currentX2 - viewportWidth) > 1) {
                dividerLine.attr("x2", viewportWidth);
            }
        } else {
            this.drawHeaderDivider(viewportWidth);
        }

        this.createModeToggleButton(viewportWidth);
        this.createColumnDisplayToggleButton(viewportWidth);
        this.createOrUpdateBaselineToggleButton(viewportWidth);
        this.createOrUpdatePreviousUpdateToggleButton(viewportWidth);
        this.createConnectorLinesToggleButton(viewportWidth);
        this.createOrUpdateWbsEnableToggleButton(viewportWidth);
        this.renderWbsCycleButtons(viewportWidth);
        this.createExportButton(viewportWidth);
    }

    private calculateVisibleTasks(): void {
        if (!this.scrollableContainer || !this.scrollableContainer.node()) return;

        const containerNode = this.scrollableContainer.node();
        const scrollTop = containerNode.scrollTop;
        const viewportHeight = containerNode.clientHeight;

        const bufferCount = Math.ceil(viewportHeight / this.taskElementHeight) * 0.5;

        this.viewportStartIndex = Math.max(0, Math.floor(scrollTop / this.taskElementHeight) - bufferCount);

        this.visibleTaskCount = Math.ceil(viewportHeight / this.taskElementHeight) + (bufferCount * 2);

        this.viewportEndIndex = Math.min(this.taskTotalCount - 1, this.viewportStartIndex + this.visibleTaskCount);

        this.debugLog(`Viewport: ${this.viewportStartIndex} - ${this.viewportEndIndex} of ${this.taskTotalCount}`);
    }

    private handleScroll(): void {
        const oldStart = this.viewportStartIndex;
        const oldEnd = this.viewportEndIndex;

        this.calculateVisibleTasks();

        const canvasNeedsRedraw = this.canvasElement &&
            this.canvasContext &&
            this.useCanvasRendering &&
            !this.canvasHasContent();

        if (oldStart !== this.viewportStartIndex ||
            oldEnd !== this.viewportEndIndex ||
            canvasNeedsRedraw) {
            this.redrawVisibleTasks();
        }
    }

    private canvasHasContent(): boolean {
        if (!this.canvasElement || !this.canvasContext) return false;

        try {
            const imageData = this.canvasContext.getImageData(0, 0, 1, 1);
            return imageData.data[3] > 0;
        } catch {
            return false;
        }
    }

    /**
     * Get visible tasks based on current viewport indices
     * When WBS grouping is enabled, filters by yOrder (row number) instead of array index
     * because WBS group headers occupy rows but aren't in the task array
     */
    private getVisibleTasks(): Task[] {
        if (!this.allTasksToShow) return [];

        const wbsGroupingEnabled = this.wbsDataExists && this.settings?.wbsGrouping?.enableWbsGrouping?.value;

        if (wbsGroupingEnabled) {

            return this.allTasksToShow.filter(t =>
                t.yOrder !== undefined &&
                t.yOrder >= this.viewportStartIndex &&
                t.yOrder <= this.viewportEndIndex
            );
        } else {

            return this.allTasksToShow
                .slice(this.viewportStartIndex, this.viewportEndIndex + 1)
                .filter(t => t.yOrder !== undefined);
        }
    }

    private redrawVisibleTasks(): void {

        const xScale = this.xScale;
        const yScale = this.yScale;
        const allTasksToShow = this.allTasksToShow;

        if (!xScale || !yScale || !allTasksToShow) {
            console.warn("Cannot redraw: Missing scales or task data");
            return;
        }

        this.calculateVisibleTasks();

        const visibleTasks = this.getVisibleTasks();
        const renderableTasks = visibleTasks.filter(t => t.yOrder !== undefined);

        if (renderableTasks.length === 0 && allTasksToShow.length > 0) {
            this.debugLog(`WARNING: getVisibleTasks() returned 0 renderable tasks but allTasksToShow has ${allTasksToShow.length} tasks. Viewport indices: ${this.viewportStartIndex}-${this.viewportEndIndex}, Total count: ${this.taskTotalCount}`);
        }

        const shouldUseCanvas = renderableTasks.length > this.CANVAS_THRESHOLD;
        const modeChanged = shouldUseCanvas !== this.useCanvasRendering;

        if (modeChanged) {
            this.useCanvasRendering = shouldUseCanvas;

        }

        if (this.useCanvasRendering) {

            if (this.canvasContext && this.canvasElement) {
                this.canvasContext.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
            }

            if (modeChanged) {
                this.taskLayer?.selectAll("*").remove();
                this.arrowLayer?.selectAll("*").remove();
            }
        } else {

            this.arrowLayer?.selectAll("*").remove();
            this.taskLayer?.selectAll("*").remove();

            if (modeChanged && this.canvasContext && this.canvasElement) {
                this.canvasContext.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
            }
        }

        if (this.wbsGroupLayer) {
            this.wbsGroupLayer.selectAll('.wbs-group-header').remove();
        }

        if (this.labelGridLayer) {
            this.labelGridLayer.selectAll(".label-grid-line").remove();
        }

        if (this.taskLabelLayer) {
            this.taskLabelLayer.selectAll("*").remove();
        }

        const showHorzGridLines = this.settings.gridLines.showHorizontalLines.value;
        const currentLeftMargin = this.settings.layoutSettings.leftMargin.value;
        const chartWidth = xScale.range()[1];
        const chartHeight = yScale.range()[1];
        const labelAvailableWidth = Math.max(10, currentLeftMargin - this.labelPaddingLeft - 5);
        const taskNameFontSize = this.settings.textAndLabels.taskNameFontSize.value;
        const selectionHighlightColor = this.getSelectionColor();
        const selectionLabelColor = selectionHighlightColor;
        const selectionLabelWeight = "bold";
        const lineHeight = this.taskLabelLineHeight;

        if (showHorzGridLines) {
            this.gridLayer?.selectAll(".grid-line.horizontal").remove();
        }

        if (this.useCanvasRendering) {

            if (this.canvasElement) {
                const leftMargin = Math.round(this.margin.left);
                const topMargin = Math.round(this.margin.top);

                if (modeChanged) {
                    this.canvasElement.style.opacity = '0';
                    this.canvasElement.style.transition = `opacity ${this.MODE_TRANSITION_DURATION}ms ease-out`;
                }

                this.canvasElement.style.display = 'block';
                this.canvasElement.style.visibility = 'visible';
                this.canvasElement.style.left = `${leftMargin}px`;
                this.canvasElement.style.top = `${topMargin}px`;
                this.canvasElement.style.imageRendering = 'auto';
                this.canvasElement.style.transform = 'translateZ(0)';
            }

            if (this._setupCanvasForDrawing(chartWidth, chartHeight)) {

                if (showHorzGridLines) {
                    this.drawHorizontalGridLinesCanvas(renderableTasks, yScale, chartWidth, currentLeftMargin);

                    this.drawLabelMarginGridLinesCanvasFallback(renderableTasks, yScale, currentLeftMargin);
                }

                this.drawTasksCanvas(
                    renderableTasks,
                    xScale,
                    yScale,
                    this.settings.taskBars.taskColor.value.value,
                    this.settings.taskBars.milestoneColor.value.value,
                    this.settings.criticalPath.criticalPathColor.value.value,
                    this.settings.textAndLabels.labelColor.value.value,
                    this.settings.textAndLabels.showDuration.value,
                    this.settings.taskBars.taskHeight.value,
                    this.settings.textAndLabels.dateBackgroundColor.value.value,
                    1 - (this.settings.textAndLabels.dateBackgroundTransparency.value / 100)
                );

                this.createAccessibleCanvasFallback(renderableTasks, yScale);

                if (this.showConnectorLinesInternal) {

                    this.drawArrowsCanvas(
                        renderableTasks,
                        xScale,
                        yScale,
                        this.settings.criticalPath.criticalPathColor.value.value,
                        this.settings.connectorLines.connectorColor.value.value,
                        this.settings.connectorLines.connectorWidth.value,
                        this.settings.connectorLines.criticalConnectorWidth.value,
                        this.settings.taskBars.taskHeight.value,
                        this.settings.taskBars.milestoneSize.value,
                    );
                }

                this.drawTaskLabelsLayer(
                    renderableTasks,
                    yScale,
                    this.settings.taskBars.taskHeight.value,
                    currentLeftMargin,
                    labelAvailableWidth,
                    taskNameFontSize,
                    this.settings.textAndLabels.labelColor.value.value,
                    selectionHighlightColor,
                    selectionLabelColor,
                    selectionLabelWeight,
                    lineHeight
                );

                this.drawDataDateLine(
                    chartWidth,
                    xScale,
                    chartHeight,
                    this.gridLayer,
                    this.headerGridLayer
                );

                if (modeChanged && this.canvasElement) {

                    requestAnimationFrame(() => {
                        if (this.canvasElement) {
                            this.canvasElement.style.opacity = '1';
                        }

                        this.taskLayer
                            .transition()
                            .duration(this.MODE_TRANSITION_DURATION)
                            .style("opacity", 0)
                            .on("end", () => {
                                this.taskLayer.style("display", "none");
                                this.taskLayer.style("opacity", null);
                                this.taskLayer?.selectAll("*").remove();
                            });

                        this.arrowLayer
                            .transition()
                            .duration(this.MODE_TRANSITION_DURATION)
                            .style("opacity", 0)
                            .on("end", () => {
                                this.arrowLayer.style("display", "none");
                                this.arrowLayer.style("opacity", null);
                                this.arrowLayer?.selectAll("*").remove();
                            });
                    });
                } else {

                    this.taskLayer.style("display", "none");
                    this.arrowLayer.style("display", "none");
                }
            }
        } else {

            if (modeChanged) {
                this.taskLayer
                    .style("opacity", 0)
                    .style("display", "block")
                    .style("visibility", "visible");
                this.arrowLayer
                    .style("opacity", 0)
                    .style("display", "block")
                    .style("visibility", "visible");
            } else {
                this.taskLayer.style("display", "block");
                this.taskLayer.style("visibility", "visible");
                this.arrowLayer.style("display", "block");
                this.arrowLayer.style("visibility", "visible");
            }

            this.setupSVGRenderingHints();

            if (showHorzGridLines) {
                this.drawHorizontalGridLines(renderableTasks, yScale, chartWidth, currentLeftMargin, chartHeight);
            }

            if (this.showConnectorLinesInternal) {
                this.drawArrows(
                    renderableTasks,
                    xScale,
                    yScale,
                    this.settings.criticalPath.criticalPathColor.value.value,
                    this.settings.connectorLines.connectorColor.value.value,
                    this.settings.connectorLines.connectorWidth.value,
                    this.settings.connectorLines.criticalConnectorWidth.value,
                    this.settings.taskBars.taskHeight.value,
                    this.settings.taskBars.milestoneSize.value,
                );
            }

            this.drawTasks(
                renderableTasks,
                xScale,
                yScale,
                this.settings.taskBars.taskColor.value.value,
                this.settings.taskBars.milestoneColor.value.value,
                this.settings.criticalPath.criticalPathColor.value.value,
                this.settings.textAndLabels.labelColor.value.value,
                this.settings.textAndLabels.showDuration.value,
                this.settings.taskBars.taskHeight.value,
                this.settings.textAndLabels.dateBackgroundColor.value.value,
                1 - (this.settings.textAndLabels.dateBackgroundTransparency.value / 100)
            );

            this.drawWbsGroupHeaders(
                xScale,
                yScale,
                chartWidth,
                this.settings.taskBars.taskHeight.value,
                this.viewportStartIndex,
                this.viewportEndIndex
            );

            if (modeChanged && this.canvasElement) {

                requestAnimationFrame(() => {

                    this.taskLayer
                        .transition()
                        .duration(this.MODE_TRANSITION_DURATION)
                        .style("opacity", 1);

                    this.arrowLayer
                        .transition()
                        .duration(this.MODE_TRANSITION_DURATION)
                        .style("opacity", 1);

                    if (this.canvasElement) {
                        this.canvasElement.style.transition = `opacity ${this.MODE_TRANSITION_DURATION}ms ease-out`;
                        this.canvasElement.style.opacity = '0';

                        setTimeout(() => {
                            if (this.canvasElement) {
                                this.canvasElement.style.display = 'none';
                                this.canvasElement.style.transition = '';
                            }

                            if (this.canvasContext && this.canvasElement) {
                                this.canvasContext.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
                            }
                        }, this.MODE_TRANSITION_DURATION);
                    }
                });
            } else if (this.canvasElement) {

                this.canvasElement.style.display = 'none';
            }
        }

        if (this.useCanvasRendering) {
            this.drawWbsGroupHeaders(
                xScale,
                yScale,
                chartWidth,
                this.settings.taskBars.taskHeight.value,
                this.viewportStartIndex,
                this.viewportEndIndex
            );
        }

        const tasksForProjectEnd = this.allFilteredTasks.length > 0 ? this.allFilteredTasks : allTasksToShow;
        this.drawBaselineAndPreviousEndLines(
            xScale,
            tasksForProjectEnd,
            yScale.range()[1],
            this.gridLayer,
            this.headerGridLayer
        );
        this.drawProjectEndLine(
            xScale.range()[1],
            xScale,
            renderableTasks,
            tasksForProjectEnd,
            yScale.range()[1],
            this.gridLayer,
            this.headerGridLayer
        );

        this.drawDataDateLine(
            xScale.range()[1],
            xScale,
            yScale.range()[1],
            this.gridLayer,
            this.headerGridLayer
        );
    }

    private drawHorizontalGridLinesCanvas(tasks: Task[], yScale: ScaleBand<string>, chartWidth: number, currentLeftMargin: number): void {
        if (!this.canvasContext) return;
        const ctx = this.canvasContext;
        ctx.save();

        const settings = this.settings.gridLines;
        const lineColor = this.resolveColor(settings.horizontalLineColor.value.value, "foreground");
        const lineWidth = settings.horizontalLineWidth.value;
        const style = settings.horizontalLineStyle.value.value;

        ctx.strokeStyle = lineColor;
        ctx.lineWidth = lineWidth;

        switch (style) {
            case "dashed": ctx.setLineDash([4, 3]); break;
            case "dotted": ctx.setLineDash([1, 2]); break;
            default: ctx.setLineDash([]); break;
        }

        const x1 = 0;
        const x2 = chartWidth;

        const taskYOrders = tasks
            .filter(t => t.yOrder !== undefined && t.yOrder > 0)
            .map(t => t.yOrder as number);

        let allYOrders: number[] = [...taskYOrders];
        if (this.wbsDataExists && this.settings?.wbsGrouping?.enableWbsGrouping?.value) {
            const groupYOrders = this.wbsGroups
                .filter(g => g.yOrder !== undefined && g.yOrder > 0 &&
                    g.yOrder >= this.viewportStartIndex && g.yOrder <= this.viewportEndIndex)
                .map(g => g.yOrder as number);
            allYOrders = [...allYOrders, ...groupYOrders];
        }

        const uniqueYOrders = [...new Set(allYOrders)].sort((a, b) => a - b);

        uniqueYOrders.forEach(yOrder => {
            const yPos = yScale(yOrder.toString());
            if (yPos !== undefined && !isNaN(yPos)) {

                const alignedY = Math.round(yPos);
                ctx.beginPath();
                ctx.moveTo(x1, alignedY);
                ctx.lineTo(x2, alignedY);
                ctx.stroke();
            }
        });

        ctx.restore();
    }

    private drawLabelMarginGridLinesCanvasFallback(tasks: Task[], yScale: ScaleBand<string>, currentLeftMargin: number): void {
        if (!this.labelGridLayer || !yScale) return;
        this.labelGridLayer.selectAll(".label-grid-line").remove();

        const settings = this.settings.gridLines;
        const lineColor = this.resolveColor(settings.horizontalLineColor.value.value, "foreground");
        const lineWidth = settings.horizontalLineWidth.value;
        const style = settings.horizontalLineStyle.value.value;
        let lineDashArray: string | undefined;
        switch (style) {
            case "dashed": lineDashArray = "4,3"; break;
            case "dotted": lineDashArray = "1,2"; break;
            default: lineDashArray = undefined; break;
        }

        const taskYOrders = tasks
            .filter(t => t.yOrder !== undefined && t.yOrder > 0)
            .map(t => t.yOrder as number);
        let allYOrders: number[] = [...taskYOrders];
        if (this.wbsDataExists && this.settings?.wbsGrouping?.enableWbsGrouping?.value) {
            const groupYOrders = this.wbsGroups
                .filter(g => g.yOrder !== undefined && g.yOrder > 0 &&
                    g.yOrder >= this.viewportStartIndex && g.yOrder <= this.viewportEndIndex)
                .map(g => g.yOrder as number);
            allYOrders = [...allYOrders, ...groupYOrders];
        }
        const uniqueYOrders = [...new Set(allYOrders)].sort((a, b) => a - b);

        this.labelGridLayer.selectAll(".label-grid-line")
            .data(uniqueYOrders)
            .enter()
            .append("line")
            .attr("class", "label-grid-line")
            .attr("x1", -currentLeftMargin)
            .attr("x2", 0)
            .attr("y1", (yOrder: number) => yScale(yOrder.toString()) ?? 0)
            .attr("y2", (yOrder: number) => yScale(yOrder.toString()) ?? 0)
            .style("stroke", lineColor)
            .style("stroke-width", lineWidth)
            .style("stroke-dasharray", lineDashArray)
            .style("pointer-events", "none");
    }

    private createScales(
        domainMin: Date, domainMax: Date, chartWidth: number, tasksToShow: Task[],
        calculatedChartHeight: number, taskHeight: number, taskPadding: number
    ): {
        xScale: ScaleTime<number, number> | null,
        yScale: ScaleBand<string> | null,
        chartWidth: number,
        calculatedChartHeight: number
    } {
        if (domainMin.getTime() >= domainMax.getTime()) {
            console.warn("Invalid date domain for time scale (Min >= Max).");
            return { xScale: null, yScale: null, chartWidth, calculatedChartHeight };
        }

        const xScale = d3.scaleTime()
            .domain([domainMin, domainMax])
            .range([0, chartWidth]);

        const yDomainSet = new Set<string>();

        for (const task of tasksToShow) {
            if (task.yOrder !== undefined) {
                yDomainSet.add(task.yOrder.toString());
            }
        }

        const wbsGroupingEnabled = this.wbsDataExists &&
            this.settings?.wbsGrouping?.enableWbsGrouping?.value;

        if (wbsGroupingEnabled) {
            for (const group of this.wbsGroups) {
                if (group.yOrder !== undefined) {
                    yDomainSet.add(group.yOrder.toString());
                }
            }
        }

        const yDomain = Array.from(yDomainSet).sort((a, b) => parseInt(a) - parseInt(b));

        if (yDomain.length === 0) {
            this.debugLog("Y-scale domain is empty because no tasks are being plotted.");

            return { xScale: (isNaN(xScale.range()[0]) ? null : xScale), yScale: null, chartWidth, calculatedChartHeight };
        }

        const yScale = d3.scaleBand<string>()
            .domain(yDomain)
            .range([0, calculatedChartHeight])
            .paddingInner(taskPadding / (taskHeight + taskPadding))
            .paddingOuter(taskPadding / (taskHeight + taskPadding) / 2);

        this.debugLog(`Created Scales - X-Domain: ${domainMin.toISOString()} to ${domainMax.toISOString()}, Y-Domain Keys: ${yDomain.length}`);
        return { xScale, yScale, chartWidth, calculatedChartHeight };
    }

    private drawVisualElements(
        tasksToShow: Task[],
        xScale: ScaleTime<number, number>,
        yScale: ScaleBand<string>,
        chartWidth: number,
        chartHeight: number
    ): void {
        if (this.scrollThrottleTimeout !== null) {
            this.debugLog("Skipping full redraw during active scroll");
            return;
        }

        if (!(this.gridLayer?.node() && this.taskLayer?.node() && this.arrowLayer?.node() &&
            xScale && yScale && yScale.bandwidth())) {
            console.error("Cannot draw elements: Missing main layers or invalid scales/bandwidth.");
            this.displayMessage("Error during drawing setup.");
            return;
        }

        if (!this.headerGridLayer?.node()) {
            console.error("Cannot draw header elements: Missing header layer.");
            this.displayMessage("Error during drawing setup.");
            return;
        }

        this.taskLabelLayer?.selectAll("*").remove();
        this.labelGridLayer?.selectAll("*").remove();
        this.wbsGroupLayer?.selectAll("*").remove();

        this.updateChartClipRect(chartWidth, chartHeight);

        const taskColor = this.resolveColor(this.settings.taskBars.taskColor.value.value, "foreground");
        const criticalColor = this.resolveColor(this.settings.criticalPath.criticalPathColor.value.value, "foreground");
        const milestoneColor = this.resolveColor(this.settings.taskBars.milestoneColor.value.value, "foreground");
        const labelColor = this.resolveColor(this.settings.textAndLabels.labelColor.value.value, "foreground");
        const taskHeight = this.settings.taskBars.taskHeight.value;
        const connectorColor = this.resolveColor(this.settings.connectorLines.connectorColor.value.value, "foreground");
        const connectorWidth = this.settings.connectorLines.connectorWidth.value;
        const criticalConnectorWidth = this.settings.connectorLines.criticalConnectorWidth.value;
        const dateBgColor = this.resolveColor(this.settings.textAndLabels.dateBackgroundColor.value.value, "background");
        const dateBgTransparency = this.settings.textAndLabels.dateBackgroundTransparency.value;
        const dateBgOpacity = 1 - (dateBgTransparency / 100);
        const showHorzGridLines = this.settings.gridLines.showHorizontalLines.value;
        const showVertGridLines = this.settings.gridLines.showVerticalLines.value;
        const showDuration = this.settings.textAndLabels.showDuration.value;

        const currentLeftMargin = this.settings.layoutSettings.leftMargin.value;

        // Fix: Clip labels to left margin
        const leftClipId = "clip-left-margin";
        let defs = this.mainSvg.select("defs");
        if (defs.empty()) defs = this.mainSvg.append("defs");

        const clipSelection = defs.selectAll(`#${leftClipId}`).data([0]);
        const clipEnter = clipSelection.enter().append("clipPath").attr("id", leftClipId);
        clipEnter.append("rect");

        const clipRect = clipSelection.merge(clipEnter as any).select("rect");
        clipRect
            .attr("x", -currentLeftMargin)
            .attr("y", -50)
            .attr("width", currentLeftMargin)
            .attr("height", chartHeight + 100);

        this.taskLabelLayer?.attr("clip-path", `url(#${leftClipId})`);
        const labelAvailableWidth = Math.max(10, currentLeftMargin - this.labelPaddingLeft - 5);
        const taskNameFontSize = this.settings.textAndLabels.taskNameFontSize.value;
        const selectionHighlightColor = this.getSelectionColor();
        const selectionLabelColor = selectionHighlightColor;
        const selectionLabelWeight = "bold";
        const lineHeight = this.taskLabelLineHeight;
        const wbsGroupingEnabled = this.wbsDataExists && this.settings?.wbsGrouping?.enableWbsGrouping?.value;
        const renderableTasks = tasksToShow.filter(t => t.yOrder !== undefined);
        if (!wbsGroupingEnabled) {
            this.wbsGroupLayer?.selectAll('.wbs-group-header').remove();
        }

        this.useCanvasRendering = renderableTasks.length > this.CANVAS_THRESHOLD;
        this.debugLog(`Rendering mode: ${this.useCanvasRendering ? 'Canvas' : 'SVG'} for ${renderableTasks.length} tasks`);

        /* Remove the unconditional SVG draw. It is handled conditionally below.
        if (showHorzGridLines) {
            const currentLeftMargin = this.settings.layoutSettings.leftMargin.value;
            this.drawHorizontalGridLines(tasksToShow, yScale, chartWidth, currentLeftMargin, chartHeight);
        }
        */

        if (showVertGridLines) {

            this.drawgridLines(xScale, chartHeight, this.gridLayer, this.headerGridLayer);
        }

        // Draw Headers ALWAYS (both for SVG and Canvas modes)
        this.drawColumnHeaders(this.headerHeight, currentLeftMargin);

        if (this.useCanvasRendering) {

            this.taskLayer.style("display", "none");
            this.arrowLayer.style("display", "none");

            if (this.canvasElement) {
                this.canvasElement.style.display = 'block';
                this.canvasElement.style.visibility = 'visible';
                this.canvasElement.style.left = `${this.margin.left}px`;
                this.canvasElement.style.top = `${this.margin.top}px`;
                this.canvasElement.style.pointerEvents = 'auto';
                this.canvasElement.style.zIndex = '1';
            }

            if (this._setupCanvasForDrawing(chartWidth, chartHeight)) {

                if (showHorzGridLines) {
                    this.drawHorizontalGridLinesCanvas(renderableTasks, yScale, chartWidth, currentLeftMargin);
                }

                this.drawTasksCanvas(
                    renderableTasks, xScale, yScale,
                    taskColor, milestoneColor, criticalColor,
                    labelColor, showDuration, taskHeight,
                    dateBgColor, dateBgOpacity
                );

                if (this.showConnectorLinesInternal) {
                    this.drawArrowsCanvas(
                        renderableTasks, xScale, yScale,
                        criticalColor, connectorColor, connectorWidth, criticalConnectorWidth,
                        taskHeight, this.settings.taskBars.milestoneSize.value
                    );
                }

                this.drawTaskLabelsLayer(
                    renderableTasks,
                    yScale,
                    taskHeight,
                    currentLeftMargin,
                    labelAvailableWidth,
                    taskNameFontSize,
                    labelColor,
                    selectionHighlightColor,
                    selectionLabelColor,
                    selectionLabelWeight,
                    lineHeight
                );
            }
        } else {

            if (this.canvasElement) {
                this.canvasElement.style.display = 'none';
                this.canvasElement.style.visibility = 'hidden';
            }
            this.taskLayer.style("display", "block");
            this.taskLayer.style("visibility", "visible");
            this.arrowLayer.style("display", "block");
            this.arrowLayer.style("visibility", "visible");

            this.setupSVGRenderingHints();

            if (showHorzGridLines) {
                this.drawHorizontalGridLines(renderableTasks, yScale, chartWidth, currentLeftMargin, chartHeight);
            }

            if (this.showConnectorLinesInternal) {
                this.drawArrows(
                    renderableTasks, xScale, yScale,
                    criticalColor, connectorColor, connectorWidth, criticalConnectorWidth,
                    taskHeight, this.settings.taskBars.milestoneSize.value
                );
            }

            this.drawTasks(
                renderableTasks, xScale, yScale,
                taskColor, milestoneColor, criticalColor,
                labelColor, showDuration, taskHeight,
                dateBgColor, dateBgOpacity
            );

            this.drawWbsGroupHeaders(xScale, yScale, chartWidth, taskHeight);

            this.drawDataDateLine(
                chartWidth,
                xScale,
                chartHeight,
                this.gridLayer,
                this.headerGridLayer
            );
        }

        const tasksForProjectEnd = this.allFilteredTasks.length > 0 ? this.allFilteredTasks : this.allTasksToShow;
        this.drawColumnHeaders(this.headerHeight, currentLeftMargin);
        this.drawLabelColumnSeparators(chartHeight, currentLeftMargin);

        this.drawBaselineAndPreviousEndLines(
            xScale,
            tasksForProjectEnd,
            chartHeight,
            this.gridLayer,
            this.headerGridLayer
        );
        this.drawProjectEndLine(chartWidth, xScale, renderableTasks, tasksForProjectEnd, chartHeight,
            this.gridLayer, this.headerGridLayer);
    }

    private drawHorizontalGridLines(tasks: Task[], yScale: ScaleBand<string>, chartWidth: number, currentLeftMargin: number, chartHeight: number): void {
        if (!this.gridLayer?.node() || !yScale) { console.warn("Skipping horizontal grid lines: Missing layer or Y scale."); return; }
        this.gridLayer.selectAll(".grid-line.horizontal").remove();
        this.gridLayer.selectAll(".alternating-row-bg").remove();
        this.labelGridLayer?.selectAll(".label-grid-line").remove();
        this.labelGridLayer?.selectAll(".alternating-row-bg-label").remove();

        const settings = this.settings.gridLines;
        const lineColor = settings.horizontalLineColor.value.value;
        const lineWidth = settings.horizontalLineWidth.value;
        const style = settings.horizontalLineStyle.value.value;
        let lineDashArray = "none";
        switch (style) { case "dashed": lineDashArray = "4,3"; break; case "dotted": lineDashArray = "1,2"; break; default: lineDashArray = "none"; break; }

        // Alternating row colors from settings
        const showAlternating = this.settings?.generalSettings?.alternatingRowColors?.value ?? false;
        const alternatingColor = this.settings?.generalSettings?.alternatingRowColor?.value?.value ?? "#F5F5F5";
        const rowHeight = yScale.bandwidth();

        const taskYOrders = tasks
            .filter(t => t.yOrder !== undefined && t.yOrder > 0)
            .map(t => t.yOrder as number);

        let allYOrders: number[] = [...taskYOrders];
        if (this.wbsDataExists && this.settings?.wbsGrouping?.enableWbsGrouping?.value) {
            const groupYOrders = this.wbsGroups
                .filter(g => g.yOrder !== undefined && g.yOrder > 0)
                .map(g => g.yOrder as number);
            allYOrders = [...allYOrders, ...groupYOrders];
        }

        const uniqueYOrders = [...new Set(allYOrders)].sort((a, b) => a - b);

        // Draw alternating row backgrounds if enabled
        if (showAlternating && rowHeight > 0) {
            // Build a list of all row indices to fill (0 to max yOrder)
            const maxYOrder = Math.max(...uniqueYOrders, 0);
            const rowIndices: number[] = [];
            for (let i = 0; i <= maxYOrder; i++) {
                rowIndices.push(i);
            }

            this.gridLayer.selectAll(".alternating-row-bg")
                .data(rowIndices.filter(i => i % 2 === 1)) // Odd rows get background
                .enter()
                .append("rect")
                .attr("class", "alternating-row-bg")
                .attr("x", 0)
                .attr("y", (yOrder: number) => yScale(yOrder.toString()) ?? 0)
                .attr("width", chartWidth)
                .attr("height", rowHeight)
                .style("fill", alternatingColor)
                .style("pointer-events", "none");

            // Extend alternating to label area
            if (this.labelGridLayer) {
                this.labelGridLayer.selectAll(".alternating-row-bg-label")
                    .data(rowIndices.filter(i => i % 2 === 1))
                    .enter()
                    .append("rect")
                    .attr("class", "alternating-row-bg-label")
                    .attr("x", -currentLeftMargin)
                    .attr("y", (yOrder: number) => yScale(yOrder.toString()) ?? 0)
                    .attr("width", currentLeftMargin)
                    .attr("height", rowHeight)
                    .style("fill", alternatingColor)
                    .style("pointer-events", "none");
            }
        }

        this.gridLayer.selectAll(".grid-line.horizontal")
            .data(uniqueYOrders)
            .enter()
            .append("line")
            .attr("class", "grid-line horizontal")
            .attr("x1", 0)
            .attr("x2", chartWidth)
            .attr("y1", (yOrder: number) => yScale(yOrder.toString()) ?? 0)
            .attr("y2", (yOrder: number) => yScale(yOrder.toString()) ?? 0)
            .style("stroke", lineColor)
            .style("stroke-width", lineWidth)
            .style("stroke-dasharray", lineDashArray)
            .style("pointer-events", "none");

        if (this.labelGridLayer) {
            this.labelGridLayer.selectAll(".label-grid-line")
                .data(uniqueYOrders)
                .enter()
                .append("line")
                .attr("class", "label-grid-line")
                .attr("x1", -currentLeftMargin)
                .attr("x2", 0)
                .attr("y1", (yOrder: number) => yScale(yOrder.toString()) ?? 0)
                .attr("y2", (yOrder: number) => yScale(yOrder.toString()) ?? 0)
                .style("stroke", lineColor)
                .style("stroke-width", lineWidth)
                .style("stroke-dasharray", lineDashArray)
                .style("pointer-events", "none");
        }
    }

    private drawgridLines(
        xScale: ScaleTime<number, number>,
        chartHeight: number,
        mainGridLayer: Selection<SVGGElement, unknown, null, undefined>,
        headerLayer: Selection<SVGGElement, unknown, null, undefined>
    ): void {
        if (!mainGridLayer?.node() || !headerLayer?.node() || !xScale?.ticks) {
            console.warn("Skipping vertical grid lines: Missing layers or invalid X scale.");
            return;
        }

        mainGridLayer.selectAll(".vertical-grid-line").remove();
        headerLayer.selectAll(".vertical-grid-label").remove();

        const settings = this.settings.gridLines;
        if (!settings.showVerticalLines.value) return;

        const lineColor = this.resolveColor(settings.verticalLineColor.value.value, "foreground");
        const lineWidth = settings.verticalLineWidth.value;
        const lineStyle = settings.verticalLineStyle.value.value as string;
        const showMonthLabels = settings.showTimelineLabels.value;
        const labelColorSetting = settings.timelineLabelColor.value.value;
        const labelColor = this.resolveColor(labelColorSetting || lineColor, "foreground");
        const baseFontSize = this.settings.textAndLabels.fontSize.value;
        const labelFontSizeSetting = settings.timelineLabelFontSize.value;
        const labelFontSize = labelFontSizeSetting > 0 ? labelFontSizeSetting : Math.max(8, baseFontSize * 0.8);
        let lineDashArray = "none";
        switch (lineStyle) { case "dashed": lineDashArray = "4,3"; break; case "dotted": lineDashArray = "1,2"; break; default: lineDashArray = "none"; }

        // Calculate the visible time range to determine appropriate granularity
        const domain = xScale.domain();
        const range = xScale.range();
        const visibleDaysSpan = (domain[1].getTime() - domain[0].getTime()) / (1000 * 60 * 60 * 24);
        const pixelsPerDay = (range[1] - range[0]) / visibleDaysSpan;

        // Determine granularity based on pixel density
        // Granularity levels: monthly → bi-weekly → weekly → daily
        type GranularityLevel = 'day' | 'week' | 'biweek' | 'month';
        let granularity: GranularityLevel = 'month';
        let ticks: Date[] = [];

        // Estimate label widths for different formats
        const weekLabelWidth = "02-May-26".length * labelFontSize * 0.55 + 10; // ~70px for DD-Mon-YY
        const monthLabelWidth = "Sep-26".length * labelFontSize * 0.55 + 10; // ~50px for Mon-YY
        const dayLabelWidth = "02-May".length * labelFontSize * 0.55 + 10; // ~55px for DD-Mon

        // Calculate approximate spacing for each granularity
        const pixelsPerWeek = pixelsPerDay * 7;
        const pixelsPerBiWeek = pixelsPerDay * 14;

        // Choose granularity: prefer finer detail when zoomed in
        // The thresholds determine when we switch between granularity levels
        if (pixelsPerDay >= dayLabelWidth * 1.2 && visibleDaysSpan <= 45) {
            // Show days when very zoomed in (less than ~45 days visible and enough space)
            granularity = 'day';
        } else if (pixelsPerWeek >= weekLabelWidth * 1.1 && visibleDaysSpan <= 90) {
            // Show weeks when zoomed in (less than ~3 months visible and enough space)
            granularity = 'week';
        } else if (pixelsPerBiWeek >= weekLabelWidth * 1.1 && visibleDaysSpan <= 180) {
            // Show bi-weekly when moderately zoomed (less than ~6 months visible and enough space)
            granularity = 'biweek';
        } else {
            // Default to months
            granularity = 'month';
        }

        // Generate ticks based on granularity
        if (granularity === 'day') {
            // Daily ticks - try every day, then every 2, 3, 5 days
            const dayIntervals = [1, 2, 3, 5, 7];
            for (const interval of dayIntervals) {
                try { ticks = xScale.ticks(timeDay.every(interval)); }
                catch (e) { ticks = []; break; }
                if (ticks.length < 2) continue;
                let minSpacing = Infinity;
                for (let i = 1; i < ticks.length; i++) {
                    const spacing = xScale(ticks[i]) - xScale(ticks[i - 1]);
                    if (!isNaN(spacing)) minSpacing = Math.min(minSpacing, spacing);
                }
                if (minSpacing >= dayLabelWidth) break;
            }
            // If days don't fit well, fall back to weeks
            if (ticks.length < 2) granularity = 'week';
        }

        if (granularity === 'week') {
            // Weekly ticks starting on Mondays
            try { ticks = xScale.ticks(timeMonday.every(1)); }
            catch (e) { ticks = []; }
            if (ticks.length >= 2) {
                let minSpacing = Infinity;
                for (let i = 1; i < ticks.length; i++) {
                    const spacing = xScale(ticks[i]) - xScale(ticks[i - 1]);
                    if (!isNaN(spacing)) minSpacing = Math.min(minSpacing, spacing);
                }
                // If weekly doesn't fit, fall back to bi-weekly
                if (minSpacing < weekLabelWidth) granularity = 'biweek';
            } else {
                granularity = 'biweek';
            }
        }

        if (granularity === 'biweek') {
            // Bi-weekly ticks starting on Mondays (every 2 weeks)
            try { ticks = xScale.ticks(timeMonday.every(2)); }
            catch (e) { ticks = []; }
            if (ticks.length >= 2) {
                let minSpacing = Infinity;
                for (let i = 1; i < ticks.length; i++) {
                    const spacing = xScale(ticks[i]) - xScale(ticks[i - 1]);
                    if (!isNaN(spacing)) minSpacing = Math.min(minSpacing, spacing);
                }
                // If bi-weekly doesn't fit, fall back to monthly
                if (minSpacing < weekLabelWidth) granularity = 'month';
            } else {
                granularity = 'month';
            }
        }

        if (granularity === 'month') {
            // Monthly ticks - existing logic with interval scaling
            let tickInterval = 1;
            const maxInterval = 12;
            while (tickInterval <= maxInterval) {
                try { ticks = xScale.ticks(timeMonth.every(tickInterval)); }
                catch (e) { ticks = []; break; }
                if (ticks.length < 2) break;
                let minSpacing = Infinity;
                for (let i = 1; i < ticks.length; i++) {
                    const spacing = xScale(ticks[i]) - xScale(ticks[i - 1]);
                    if (!isNaN(spacing)) minSpacing = Math.min(minSpacing, spacing);
                }
                if (minSpacing === Infinity) break;
                if (minSpacing >= monthLabelWidth) break;
                tickInterval++;
                if (tickInterval > maxInterval) {
                    try { ticks = xScale.ticks(timeMonth.every(maxInterval)); }
                    catch (e) { ticks = []; }
                    break;
                }
            }
        }

        // Draw grid lines
        mainGridLayer.selectAll(".vertical-grid-line")
            .data(ticks)
            .enter()
            .append("line")
            .attr("class", "vertical-grid-line")
            .attr("x1", (d: Date) => xScale(d))
            .attr("x2", (d: Date) => xScale(d))
            .attr("y1", 0)
            .attr("y2", chartHeight)
            .style("stroke", lineColor)
            .style("stroke-width", lineWidth)
            .style("stroke-dasharray", lineDashArray)
            .style("pointer-events", "none");

        // Draw labels with appropriate formatting based on granularity
        if (showMonthLabels) {
            const formatLabel = (d: Date): string => {
                const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

                if (granularity === 'day') {
                    // Format: "02-May" for daily (no year to save space)
                    const day = String(d.getDate()).padStart(2, '0');
                    const month = monthNames[d.getMonth()];
                    return `${day}-${month}`;
                } else if (granularity === 'week' || granularity === 'biweek') {
                    // Format: "02-May-26" for weekly/bi-weekly (DD-Mon-YY)
                    const day = String(d.getDate()).padStart(2, '0');
                    const month = monthNames[d.getMonth()];
                    const year = String(d.getFullYear()).slice(-2);
                    return `${day}-${month}-${year}`;
                } else {
                    // Format: "May-26" for monthly (Mon-YY)
                    return this.monthYearFormatter.format(d);
                }
            };

            headerLayer.selectAll(".vertical-grid-label")
                .data(ticks)
                .enter()
                .append("text")
                .attr("class", "vertical-grid-label")
                .attr("x", (d: Date) => xScale(d))
                .attr("y", this.headerHeight - 15)
                .attr("text-anchor", "middle")
                .style("font-family", this.getFontFamily())
                .style("font-size", `${labelFontSize}pt`)
                .style("fill", labelColor)
                .style("pointer-events", "none")
                .text((d: Date) => formatLabel(d));
        }
    }

    /** Draws task bars, milestones, and associated labels */
    private drawTasks(
        tasks: Task[],
        xScale: ScaleTime<number, number>,
        yScale: ScaleBand<string>,
        taskColor: string,
        milestoneColor: string,
        criticalColor: string,
        labelColor: string,
        showDuration: boolean,
        taskHeight: number,
        dateBackgroundColor: string,
        dateBackgroundOpacity: number
    ): void {
        if (!this.taskLayer?.node() || !xScale || !yScale || !yScale.bandwidth()) {
            console.error("Cannot draw tasks: Missing task layer or invalid scales/bandwidth.");
            return;
        }

        const showTooltips = this.settings.generalSettings.showTooltips.value;
        const currentLeftMargin = this.settings.layoutSettings.leftMargin.value;
        const labelAvailableWidth = Math.max(10, currentLeftMargin - this.labelPaddingLeft - 5);
        const generalFontSize = this.settings.textAndLabels.fontSize.value;
        const taskNameFontSize = this.settings.textAndLabels.taskNameFontSize.value;
        const milestoneSizeSetting = this.settings.taskBars.milestoneSize.value;
        const showFinishDates = this.settings.textAndLabels.showFinishDates.value;
        const viewportWidth = this.lastUpdateOptions?.viewport?.width ?? 0;
        const reduceLabelDensity = this.getLayoutMode(viewportWidth) === 'narrow';
        const shouldShowFinishLabel = (d: Task): boolean => {
            if (!reduceLabelDensity) return true;
            return d.internalId === this.selectedTaskId ||
                d.isCritical ||
                d.type === 'TT_Mile' ||
                d.type === 'TT_FinMile';
        };
        const lineHeight = this.taskLabelLineHeight;
        const dateBgPaddingH = this.dateBackgroundPadding.horizontal;
        const dateBgPaddingV = this.dateBackgroundPadding.vertical;
        const nearCriticalColor = this.resolveColor(this.settings.criticalPath.nearCriticalColor.value.value, "foreground");
        const self = this;
        const minInlineDurationWidth = 28;
        const minBarWidthForStrongStroke = 8;
        const minBarWidthForGlow = 10;

        // Task bar styling from settings
        const taskBarCornerRadius = this.settings.taskBars.taskBarCornerRadius.value;
        const taskBarStrokeColor = this.settings.taskBars.taskBarStrokeColor.value.value;
        const taskBarStrokeWidth = this.settings.taskBars.taskBarStrokeWidth.value;
        const milestoneShape = this.settings.taskBars.milestoneShape.value?.value ?? "diamond";

        const getTaskBarWidth = (d: Task): number => {
            if (!(d.startDate instanceof Date) || !(d.finishDate instanceof Date)) {
                return this.minTaskWidthPixels;
            }
            const startPos = xScale(d.startDate);
            const finishPos = xScale(d.finishDate);
            if (isNaN(startPos) || isNaN(finishPos) || finishPos < startPos) {
                return this.minTaskWidthPixels;
            }
            return Math.max(this.minTaskWidthPixels, finishPos - startPos);
        };

        const getTaskFillColor = (d: Task, fallbackColor: string): string => {
            if (d.internalId === this.selectedTaskId) return selectionHighlightColor;
            if (this.legendDataExists && d.legendColor) return d.legendColor;
            if (!this.legendDataExists) {
                if (d.isCritical) return criticalColor;
                if (d.isNearCritical) return nearCriticalColor;
            }
            return fallbackColor;
        };

        const selectionHighlightColor = this.getSelectionColor();
        const selectionStrokeWidth = 2.5;
        const selectionLabelColor = selectionHighlightColor;
        const selectionLabelWeight = "bold";

        const taskGroupsSelection = this.taskLayer.selectAll<SVGGElement, Task>(".task-group")
            .data(tasks, (d: Task) => d.internalId);

        taskGroupsSelection.exit().remove();

        const enterGroups = taskGroupsSelection.enter().append("g")
            .attr("class", "task-group")
            .attr("transform", (d: Task) => {
                const domainKey = d.yOrder?.toString() ?? '';
                const yPosition = yScale(domainKey);
                if (yPosition === undefined || isNaN(yPosition)) {
                    console.warn(`Skipping task ${d.internalId} due to invalid yPosition (yOrder: ${domainKey}).`);
                    return null;
                }
                return `translate(0, ${yPosition})`;
            })
            .filter(function () {
                return d3.select(this).attr("transform") !== null;
            });

        taskGroupsSelection.attr("transform", (d: Task) => {
            const domainKey = d.yOrder?.toString() ?? '';
            const yPosition = yScale(domainKey);
            if (yPosition === undefined || isNaN(yPosition)) {
                console.warn(`Skipping task ${d.internalId} due to invalid yPosition (yOrder: ${domainKey}).`);
                return null;
            }
            return `translate(0, ${yPosition})`;
        });

        const allTaskGroups = enterGroups.merge(taskGroupsSelection);

        const showPreviousUpdate = this.showPreviousUpdateInternal;
        if (showPreviousUpdate) {
            const previousUpdateColor = this.resolveColor(this.settings.comparisonBars.previousUpdateColor.value.value, "foreground");
            const previousUpdateHeight = this.settings.comparisonBars.previousUpdateHeight.value;
            const previousUpdateOffset = this.settings.comparisonBars.previousUpdateOffset.value;
            const previousUpdateRadius = Math.min(3, previousUpdateHeight / 2);
            const previousUpdateOutline = this.getContrastColor(previousUpdateColor);

            allTaskGroups.selectAll(".previous-update-bar").remove();

            allTaskGroups.filter((d: Task) =>
                d.previousUpdateStartDate instanceof Date && !isNaN(d.previousUpdateStartDate.getTime()) &&
                d.previousUpdateFinishDate instanceof Date && !isNaN(d.previousUpdateFinishDate.getTime()) &&
                d.previousUpdateFinishDate >= d.previousUpdateStartDate
            )
                .append("rect")
                .attr("class", "previous-update-bar")
                .attr("x", (d: Task) => xScale(d.previousUpdateStartDate!))
                .attr("y", taskHeight + previousUpdateOffset)
                .attr("width", (d: Task) => {
                    const startPos = xScale(d.previousUpdateStartDate!);
                    const finishPos = xScale(d.previousUpdateFinishDate!);
                    return Math.max(this.minTaskWidthPixels, finishPos - startPos);
                })
                .attr("height", previousUpdateHeight)
                .attr("rx", previousUpdateRadius)
                .attr("ry", previousUpdateRadius)
                .style("fill", previousUpdateColor)
                .style("stroke", previousUpdateOutline)
                .style("stroke-opacity", 0.25)
                .style("stroke-width", 0.6);
        } else {
            allTaskGroups.selectAll(".previous-update-bar").remove();
        }

        const showBaseline = this.showBaselineInternal;
        if (showBaseline) {
            const baselineColor = this.resolveColor(this.settings.comparisonBars.baselineColor.value.value, "foreground");
            const baselineHeight = this.settings.comparisonBars.baselineHeight.value;
            const baselineOffset = this.settings.comparisonBars.baselineOffset.value;
            const baselineRadius = Math.min(3, baselineHeight / 2);
            const baselineOutline = this.getContrastColor(baselineColor);

            let baselineY = taskHeight;
            if (showPreviousUpdate) {
                const previousUpdateHeight = this.settings.comparisonBars.previousUpdateHeight.value;
                const previousUpdateOffset = this.settings.comparisonBars.previousUpdateOffset.value;
                baselineY = taskHeight + previousUpdateOffset + previousUpdateHeight + baselineOffset;
            } else {
                baselineY = taskHeight + baselineOffset;
            }

            allTaskGroups.selectAll(".baseline-bar").remove();

            allTaskGroups.filter((d: Task) =>
                d.baselineStartDate instanceof Date && !isNaN(d.baselineStartDate.getTime()) &&
                d.baselineFinishDate instanceof Date && !isNaN(d.baselineFinishDate.getTime()) &&
                d.baselineFinishDate >= d.baselineStartDate
            )
                .append("rect")
                .attr("class", "baseline-bar")
                .attr("x", (d: Task) => xScale(d.baselineStartDate!))
                .attr("y", baselineY)
                .attr("width", (d: Task) => {
                    const startPos = xScale(d.baselineStartDate!);
                    const finishPos = xScale(d.baselineFinishDate!);
                    return Math.max(this.minTaskWidthPixels, finishPos - startPos);
                })
                .attr("height", baselineHeight)
                .attr("rx", baselineRadius)
                .attr("ry", baselineRadius)
                .style("fill", baselineColor)
                .style("stroke", baselineOutline)
                .style("stroke-opacity", 0.25)
                .style("stroke-width", 0.6);
        } else {
            allTaskGroups.selectAll(".baseline-bar").remove();
        }

        allTaskGroups.selectAll(".task-bar, .milestone").remove();

        allTaskGroups.filter((d: Task) =>
            d.type !== 'TT_Mile' && d.type !== 'TT_FinMile' &&
            d.startDate instanceof Date && !isNaN(d.startDate.getTime()) &&
            d.finishDate instanceof Date && !isNaN(d.finishDate.getTime()) &&
            d.finishDate >= d.startDate
        )
            .append("rect")
            .attr("class", (d: Task) => {
                if (d.isCritical) return "task-bar critical";
                if (d.isNearCritical) return "task-bar near-critical";
                return "task-bar normal";
            })

            .attr("role", "button")
            .attr("aria-label", (d: Task) => {
                const statusText = d.isCritical ? "Critical" : d.isNearCritical ? "Near Critical" : "Normal";
                const selectedText = d.internalId === this.selectedTaskId ? " (Selected)" : "";
                return `${d.name}, ${statusText} task, Start: ${this.formatDate(d.startDate)}, Finish: ${this.formatDate(d.finishDate)}${selectedText}. Press Enter or Space to select.`;
            })
            .attr("tabindex", 0)
            .attr("aria-pressed", (d: Task) => d.internalId === this.selectedTaskId ? "true" : "false")
            .attr("x", (d: Task) => xScale(d.startDate!))
            .attr("y", 0)
            .attr("width", (d: Task) => getTaskBarWidth(d))
            .attr("height", taskHeight)

            .attr("rx", (d: Task) => Math.min(taskBarCornerRadius, getTaskBarWidth(d) / 2))
            .attr("ry", (d: Task) => Math.min(taskBarCornerRadius, getTaskBarWidth(d) / 2))
            .style("fill", (d: Task) => getTaskFillColor(d, taskColor))

            .style("stroke", (d: Task) => {
                if (d.internalId === this.selectedTaskId) return selectionHighlightColor;

                if (this.legendDataExists) {
                    if (d.isCritical) return criticalColor;
                    if (d.isNearCritical) return nearCriticalColor;
                }

                // Use custom stroke color if set, otherwise use foreground color
                return taskBarStrokeColor || this.getForegroundColor();
            })
            .style("stroke-width", (d: Task) => {
                const barWidth = getTaskBarWidth(d);
                // Use custom stroke width setting as base
                let baseWidth = taskBarStrokeWidth > 0 ? taskBarStrokeWidth : 0.5;

                if (d.internalId === this.selectedTaskId) {
                    baseWidth = 3;
                } else if (this.legendDataExists) {
                    if (d.isCritical) baseWidth = this.settings.criticalPath.criticalBorderWidth.value;
                    else if (d.isNearCritical) baseWidth = this.settings.criticalPath.nearCriticalBorderWidth.value;
                } else if (d.isCritical) {
                    baseWidth = this.settings.criticalPath.criticalBorderWidth.value;
                }

                if (barWidth < minBarWidthForStrongStroke) {
                    return Math.min(baseWidth, 1);
                }
                return baseWidth;
            })

            .style("filter", (d: Task) => {
                const barWidth = getTaskBarWidth(d);
                if (barWidth < minBarWidthForGlow) return "none";

                if (this.legendDataExists) {
                    if (d.isCritical) {
                        const rgb = this.hexToRgb(criticalColor);
                        return `drop-shadow(0 0 3px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.35))`;
                    }
                    if (d.isNearCritical) {
                        const nearColor = nearCriticalColor;
                        const rgb = this.hexToRgb(nearColor);
                        return `drop-shadow(0 0 2px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25))`;
                    }
                }

                return `drop-shadow(${this.UI_TOKENS.shadow[2]})`;
            });

        allTaskGroups.filter((d: Task) =>
            (d.type === 'TT_Mile' || d.type === 'TT_FinMile') &&
            ((d.startDate instanceof Date && !isNaN(d.startDate.getTime())) ||
                (d.finishDate instanceof Date && !isNaN(d.finishDate.getTime())))
        )
            .append("path")
            .attr("class", (d: Task) => {
                if (d.isCritical) return "milestone critical";
                if (d.isNearCritical) return "milestone near-critical";
                return "milestone normal";
            })

            .attr("role", "button")
            .attr("aria-label", (d: Task) => {
                const statusText = d.isCritical ? "Critical" : d.isNearCritical ? "Near Critical" : "Normal";
                const selectedText = d.internalId === this.selectedTaskId ? " (Selected)" : "";
                const milestoneDate = (d.startDate instanceof Date && !isNaN(d.startDate.getTime())) ? d.startDate : d.finishDate;
                return `${d.name}, ${statusText} milestone, Date: ${this.formatDate(milestoneDate)}${selectedText}. Press Enter or Space to select.`;
            })
            .attr("tabindex", 0)
            .attr("aria-pressed", (d: Task) => d.internalId === this.selectedTaskId ? "true" : "false")
            .attr("transform", (d: Task) => {
                const milestoneDate = (d.startDate instanceof Date && !isNaN(d.startDate.getTime())) ? d.startDate : d.finishDate;
                const x = (milestoneDate instanceof Date && !isNaN(milestoneDate.getTime())) ? xScale(milestoneDate) : 0;
                const y = taskHeight / 2;
                if (isNaN(x)) console.warn(`Invalid X position for milestone ${d.internalId}`);
                return `translate(${x}, ${y})`;
            })
            .attr("d", () => {
                const size = Math.max(4, Math.min(milestoneSizeSetting, taskHeight * 0.9));
                // Support different milestone shapes from settings
                switch (milestoneShape) {
                    case "circle":
                        // Approximate circle with SVG path (8-point circle approximation)
                        const r = size / 2;
                        return `M ${r},0 A ${r},${r} 0 1,1 -${r},0 A ${r},${r} 0 1,1 ${r},0`;
                    case "square":
                        const halfSize = size / 2;
                        return `M -${halfSize},-${halfSize} L ${halfSize},-${halfSize} L ${halfSize},${halfSize} L -${halfSize},${halfSize} Z`;
                    case "diamond":
                    default:
                        return `M 0,-${size / 2} L ${size / 2},0 L 0,${size / 2} L -${size / 2},0 Z`;
                }
            })
            .style("fill", (d: Task) => getTaskFillColor(d, milestoneColor))

            .style("stroke", (d: Task) => {
                if (d.internalId === this.selectedTaskId) return selectionHighlightColor;

                if (this.legendDataExists) {
                    if (d.isCritical) return criticalColor;
                    if (d.isNearCritical) return nearCriticalColor;
                }

                return this.getForegroundColor();
            })
            .style("stroke-width", (d: Task) => {
                if (d.internalId === this.selectedTaskId) return 3;

                if (this.legendDataExists) {
                    if (d.isCritical) return this.settings.criticalPath.criticalBorderWidth.value;
                    if (d.isNearCritical) return this.settings.criticalPath.nearCriticalBorderWidth.value;
                }

                return 1.5;
            })

            .style("filter", (d: Task) => {

                if (this.legendDataExists) {
                    if (d.isCritical) {
                        const rgb = this.hexToRgb(criticalColor);
                        return `drop-shadow(0 0 3px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.35))`;
                    }
                    if (d.isNearCritical) {
                        const nearColor = nearCriticalColor;
                        const rgb = this.hexToRgb(nearColor);
                        return `drop-shadow(0 0 2px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25))`;
                    }
                }

                return `drop-shadow(${this.UI_TOKENS.shadow[2]})`;
            });

        this.drawTaskLabelsLayer(
            tasks,
            yScale,
            taskHeight,
            currentLeftMargin,
            labelAvailableWidth,
            taskNameFontSize,
            labelColor,
            selectionHighlightColor,
            selectionLabelColor,
            selectionLabelWeight,
            this.taskLabelLineHeight
        );

        if (showFinishDates) {
            allTaskGroups.selectAll(".date-label-group").remove();

            const dateTextFontSize = Math.max(7, generalFontSize * (reduceLabelDensity ? 0.75 : 0.85));
            const dateTextGroups = allTaskGroups
                .filter((d: Task) => shouldShowFinishLabel(d))
                .append("g")
                .attr("class", "date-label-group");

            const dateTextSelection = dateTextGroups.append("text")
                .attr("class", "finish-date")
                .attr("y", taskHeight / 2)
                .attr("text-anchor", "start")
                .attr("dominant-baseline", "central")
                .style("font-size", `${dateTextFontSize}pt`)
                .style("fill", labelColor)
                .style("pointer-events", "none")
                .attr("x", (d: Task): number | null => {
                    let xPos: number | null = null;
                    const dateToUse = d.finishDate;
                    if (!(dateToUse instanceof Date && !isNaN(dateToUse.getTime()))) return null;

                    if (d.type === 'TT_Mile' || d.type === 'TT_FinMile') {
                        const milestoneMarkerDate = (d.startDate instanceof Date && !isNaN(d.startDate.getTime())) ? d.startDate : d.finishDate;
                        const milestoneX = (milestoneMarkerDate instanceof Date && !isNaN(milestoneMarkerDate.getTime())) ? xScale(milestoneMarkerDate) : NaN;
                        if (!isNaN(milestoneX)) {
                            const size = Math.max(4, Math.min(milestoneSizeSetting, taskHeight * 0.9));
                            xPos = milestoneX + size / 2;
                        }
                    } else {
                        const finishX = xScale(dateToUse);
                        if (!isNaN(finishX)) xPos = finishX;
                    }
                    return (xPos === null || isNaN(xPos)) ? null : (xPos + self.dateLabelOffset);
                })
                .text((d: Task) => self.formatDate(d.finishDate))
                .filter(function () { return d3.select(this).attr("x") !== null; });

            dateTextGroups.each((d: Task, i: number, nodes: BaseType[] | ArrayLike<BaseType>) => {
                const group = d3.select(nodes[i] as SVGGElement);
                const textElement = group.select<SVGTextElement>(".finish-date").node();

                if (!textElement) {
                    group.remove();
                    return;
                }

                if (textElement.getAttribute("x") === null || !textElement.textContent || textElement.textContent.trim() === "") {
                    group.remove();
                    return;
                }

                try {
                    const bbox = textElement.getBBox();
                    if (bbox && bbox.width > 0 && bbox.height > 0 && isFinite(bbox.x) && isFinite(bbox.y)) {
                        group.insert("rect", ".finish-date")
                            .attr("class", "date-background")
                            .attr("x", bbox.x - dateBgPaddingH)
                            .attr("y", bbox.y - dateBgPaddingV)
                            .attr("width", bbox.width + (dateBgPaddingH * 2))
                            .attr("height", bbox.height + (dateBgPaddingV * 2))

                            .attr("rx", 4).attr("ry", 4)
                            .style("fill", dateBackgroundColor)
                            .style("fill-opacity", dateBackgroundOpacity)

                            .style("filter", `drop-shadow(${this.UI_TOKENS.shadow[1]})`);
                    }
                } catch (e) {
                    console.warn(`Could not get BBox for date text on task ${d.internalId}`, e);
                }
            });
        }

        if (showDuration) {
            allTaskGroups.selectAll(".duration-text").remove();

            const durationFontSize = Math.max(7, generalFontSize * 0.8);
            allTaskGroups.filter((d: Task) =>
                d.type !== 'TT_Mile' && d.type !== 'TT_FinMile' &&
                d.startDate instanceof Date && !isNaN(d.startDate.getTime()) &&
                d.finishDate instanceof Date && !isNaN(d.finishDate.getTime()) &&
                d.finishDate >= d.startDate &&
                (d.duration || 0) > 0
            )
                .append("text")
                .attr("class", "duration-text")
                .attr("y", taskHeight / 2)
                .attr("text-anchor", "middle")
                .attr("dominant-baseline", "central")
                .style("font-size", `${durationFontSize}pt`)
                .style("fill", (d: Task) => this.getDurationTextColor(getTaskFillColor(d, taskColor)))
                .style("font-weight", "500")
                .style("pointer-events", "none")
                .attr("x", (d: Task): number | null => {
                    const startX = xScale(d.startDate!);
                    const finishX = xScale(d.finishDate!);
                    return (isNaN(startX) || isNaN(finishX)) ? null : startX + (finishX - startX) / 2;
                })
                .text((d: Task): string => {
                    const startX = xScale(d.startDate!);
                    const finishX = xScale(d.finishDate!);
                    if (isNaN(startX) || isNaN(finishX)) return "";
                    const barWidth = finishX - startX;
                    const textContent = `${Math.round(d.duration || 0)}d`;
                    const estimatedTextWidth = textContent.length * (durationFontSize * 0.6);
                    const minWidth = Math.max(minInlineDurationWidth, estimatedTextWidth + 8);
                    return (barWidth >= minWidth) ? textContent : "";
                })
                .filter(function () { return d3.select(this).attr("x") !== null && d3.select(this).text() !== ""; });
        }

        const setupInteractivity = (selection: Selection<BaseType, Task, BaseType, unknown>) => {
            selection
                .on("mouseover", (event: MouseEvent, d: Task) => {
                    self.setHoveredTask(d.internalId);

                    if (d.internalId !== self.selectedTaskId) {

                        let hoverStrokeColor = self.getForegroundColor();
                        let hoverStrokeWidth = "2px";

                        if (self.legendDataExists) {

                            if (d.isCritical) {
                                hoverStrokeColor = criticalColor;
                                hoverStrokeWidth = String(self.settings.criticalPath.criticalBorderWidth.value);
                            } else if (d.isNearCritical) {
                                hoverStrokeColor = nearCriticalColor;
                                hoverStrokeWidth = String(self.settings.criticalPath.nearCriticalBorderWidth.value);
                            }
                        } else {

                            if (d.isCritical) {
                                hoverStrokeWidth = "1.5px";
                            }
                        }

                        d3.select(event.currentTarget as Element)
                            .style("stroke", hoverStrokeColor)
                            .style("stroke-width", hoverStrokeWidth);
                    }
                    d3.select(event.currentTarget as Element).style("cursor", "pointer");

                    if (showTooltips) {
                        self.showTaskTooltip(d, event);
                    }
                })
                .on("mousemove", (event: MouseEvent) => {
                    if (showTooltips) {
                        self.moveTaskTooltip(event);
                    }
                })
                .on("mouseout", (event: MouseEvent, d: Task) => {
                    self.setHoveredTask(null);

                    if (d.internalId !== self.selectedTaskId) {

                        let defaultStrokeColor = self.getForegroundColor();
                        let defaultStrokeWidth = "0.5";

                        if (self.legendDataExists) {

                            if (d.isCritical) {
                                defaultStrokeColor = criticalColor;
                                defaultStrokeWidth = String(self.settings.criticalPath.criticalBorderWidth.value);
                            } else if (d.isNearCritical) {
                                defaultStrokeColor = nearCriticalColor;
                                defaultStrokeWidth = String(self.settings.criticalPath.nearCriticalBorderWidth.value);
                            }
                        } else {

                            if (d.isCritical) {
                                defaultStrokeWidth = "1";
                            }
                        }

                        d3.select(event.currentTarget as Element)
                            .style("stroke", defaultStrokeColor)
                            .style("stroke-width", defaultStrokeWidth);
                    }

                    if (showTooltips) {
                        self.hideTooltip();
                    }
                })
                .on("contextmenu", (event: MouseEvent, d: Task) => {
                    self.showContextMenu(event, d);
                })
                .on("click", (event: MouseEvent, d: Task) => {

                    if (self.selectedTaskId === d.internalId) {
                        self.selectTask(null, null);
                    } else {
                        self.selectTask(d.internalId, d.name);
                    }

                    if (self.dropdownInput) {
                        self.dropdownInput.property("value", self.selectedTaskName || "");
                    }

                    event.stopPropagation();
                })

                .on("keydown", (event: KeyboardEvent, d: Task) => {

                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();

                        if (self.selectedTaskId === d.internalId) {
                            self.selectTask(null, null);
                        } else {
                            self.selectTask(d.internalId, d.name);
                        }

                        if (self.dropdownInput) {
                            self.dropdownInput.property("value", self.selectedTaskName || "");
                        }
                    }
                })

                .on("focus", function (_event: FocusEvent, _d: Task) {

                    d3.select(this)
                        .style("outline", "2px solid #0078D4")
                        .style("outline-offset", "2px");

                    const element = this as SVGElement;
                    const ariaLabel = element.getAttribute("aria-label");
                    if (ariaLabel) {

                        const liveRegion = d3.select("body").select(".sr-live-region");
                        if (!liveRegion.empty()) {
                            liveRegion.text(`Focused on ${ariaLabel}`);
                        }
                    }
                })
                .on("blur", function (_event: FocusEvent, _d: Task) {

                    d3.select(this)
                        .style("outline", null)
                        .style("outline-offset", null);
                });
        };

        setupInteractivity(allTaskGroups.selectAll(".task-bar, .milestone"));
    }

    /**
     * Draws task name labels in an unclipped layer so they stay visible in the left margin.
     */
    private drawTaskLabelsLayer(
        tasks: Task[],
        yScale: ScaleBand<string>,
        taskHeight: number,
        currentLeftMargin: number,
        labelAvailableWidth: number,
        taskNameFontSize: number,
        labelColor: string,
        selectionHighlightColor: string,
        selectionLabelColor: string,
        selectionLabelWeight: string,

        lineHeight: string
    ): void {
        if (!this.taskLabelLayer || !yScale) return;

        // Column Settings
        const cols = this.settings.columns;
        const showExtra = this.showExtraColumnsInternal;
        const showStart = showExtra && cols.showStartDate.value;
        const startWidth = cols.startDateWidth.value;
        const showFinish = showExtra && cols.showFinishDate.value;
        const finishWidth = cols.finishDateWidth.value;
        const showDur = showExtra && cols.showDuration.value;
        const durWidth = cols.durationWidth.value;
        const showFloat = showExtra && cols.showTotalFloat.value;
        const floatWidth = cols.totalFloatWidth.value;

        // Calculate occupied width by columns (Right-to-Left stacking from x=0)
        let occupiedWidth = 0;

        // Add padding between the last column (closest to chart) and the chart start
        const columnPadding = 20;
        occupiedWidth += columnPadding;

        const floatOffset = showFloat ? occupiedWidth : 0;
        if (showFloat) occupiedWidth += floatWidth;

        const durOffset = showDur ? occupiedWidth : 0;
        if (showDur) occupiedWidth += durWidth;

        const finishOffset = showFinish ? occupiedWidth : 0;
        if (showFinish) occupiedWidth += finishWidth;

        const startOffset = showStart ? occupiedWidth : 0;
        if (showStart) occupiedWidth += startWidth;

        // Calculate available width for Task Name
        // Allow it to be 0 or negative to trigger hiding logic if space is insufficient
        let effectiveAvailableWidth = currentLeftMargin - occupiedWidth - this.labelPaddingLeft - 5;

        const wbsGroupingEnabled = this.wbsDataExists && this.settings?.wbsGrouping?.enableWbsGrouping?.value;
        const wbsIndentPerLevel = wbsGroupingEnabled ? (this.settings?.wbsGrouping?.indentPerLevel?.value ?? 20) : 0;
        const renderableTasks = tasks.filter(t => {
            if (t.yOrder === undefined) return false;
            const domainKey = t.yOrder.toString();
            const yPosition = yScale(domainKey);
            return yPosition !== undefined && !isNaN(yPosition);
        });

        const labelGroups = this.taskLabelLayer
            .selectAll<SVGGElement, Task>(".task-label-group")
            .data(renderableTasks, (d: Task) => d.internalId);

        labelGroups.exit().remove();

        const enterGroups = labelGroups.enter()
            .append("g")
            .attr("class", "task-label-group")
            .attr("transform", (d: Task) => {
                const domainKey = d.yOrder?.toString() ?? "";
                const yPosition = yScale(domainKey);
                if (yPosition === undefined || isNaN(yPosition)) return null;
                return `translate(0, ${yPosition})`;
            })
            .filter(function () { return d3.select(this).attr("transform") !== null; });

        const mergedGroups = enterGroups.merge(labelGroups);

        mergedGroups.attr("transform", (d: Task) => {
            const domainKey = d.yOrder?.toString() ?? "";
            const yPosition = yScale(domainKey);
            if (yPosition === undefined || isNaN(yPosition)) return null;
            return `translate(0, ${yPosition})`;
        });

        mergedGroups.filter(function () {
            return d3.select(this).attr("transform") === null;
        }).remove();

        // Clear existing labels
        mergedGroups.selectAll(".task-label").remove();
        mergedGroups.selectAll(".column-label").remove();

        // 1. Render Task Name (Left-to-Right)
        // Only render if we have minimal viable space
        if (effectiveAvailableWidth > 15) {
            const taskLabels = mergedGroups.append("text")
                .attr("class", "task-label")
                // x: Start from left margin edge + padding + indent
                .attr("x", (d: Task) => {
                    const indent = wbsGroupingEnabled && d.wbsIndentLevel ? d.wbsIndentLevel * wbsIndentPerLevel : 0;
                    return -currentLeftMargin + this.labelPaddingLeft + indent;
                })
                .attr("y", taskHeight / 2)
                .attr("text-anchor", "start")
                .style("font-family", this.getFontFamily())
                .style("font-size", `${taskNameFontSize}pt`)
                .style("fill", (d: Task) => d.internalId === this.selectedTaskId ? selectionLabelColor : labelColor)
                .style("font-weight", (d: Task) => d.internalId === this.selectedTaskId ? selectionLabelWeight : "normal")
                .each((d: Task, _i: number, nodes: BaseType[] | ArrayLike<BaseType>) => {
                    const textElement = d3.select(nodes[_i] as SVGTextElement);
                    const indent = wbsGroupingEnabled && d.wbsIndentLevel ? d.wbsIndentLevel * wbsIndentPerLevel : 0;
                    const adjustedLabelWidth = effectiveAvailableWidth - indent;

                    // If individual indented row has no space, remove text
                    if (adjustedLabelWidth < 15) {
                        textElement.remove();
                        return;
                    }

                    const words = (d.name || "").split(/\s+/).reverse();
                    let word: string | undefined;
                    let line: string[] = [];
                    const x = parseFloat(textElement.attr("x"));
                    const y = parseFloat(textElement.attr("y")); // original y is taskHeight / 2 (centered) -> moved to baseline?

                    let firstTspan = textElement.text(null).append("tspan").attr("x", x).attr("y", y).attr("dy", "0.32em");
                    let tspan = firstTspan;
                    let lineCount = 1;
                    const maxLines = 2; // Allow wrapping to 2 lines

                    while (word = words.pop()) {
                        line.push(word);
                        tspan.text(line.join(" "));
                        try {
                            const textLength = tspan.node()!.getComputedTextLength();
                            if (textLength > adjustedLabelWidth) {
                                if (line.length > 1) {
                                    line.pop();
                                    tspan.text(line.join(" "));
                                    line = [word];
                                    if (lineCount >= maxLines) {
                                        tspan.text(tspan.text() + "...");
                                        break;
                                    }

                                    // Keep first line static (dy="0.32em")
                                    // Position second line below it (0.32 + 1.1 = ~1.42em)

                                    lineCount++;
                                    tspan = textElement.append("tspan").attr("x", x).attr("y", y).attr("dy", "1.45em").text(word);
                                } else {
                                    // Single word is too long for the line
                                    // If it's the first line and we have more lines allowed, we can just let it wrap effectively (which means this word takes the line and we move to next)
                                    // BUT if this single word is ALREADY wider than valid width, we must truncate it.

                                    // Simple binary-like backoff or just substring loop
                                    let subWord = word;
                                    while (subWord.length > 0 && tspan.node()!.getComputedTextLength() > adjustedLabelWidth) {
                                        subWord = subWord.slice(0, -1);
                                        tspan.text(subWord + "...");
                                    }
                                    if (subWord.length === 0) tspan.text("..."); // Minimal fallback

                                    // Since we truncated this word on this line, we technically stop here for this line.
                                    // If we have maxLines > 1, should we try to put the REST of the word on the next line?
                                    // That's complex hyphenation. simpler to just truncate the word and stop or wrap.
                                    // Given the user issue is overlapping, HARD truncation is preferred.
                                    break;
                                }
                            }
                        } catch (e) { break; }
                    }
                });

            // Interactivity for Task Labels
            taskLabels.on("click", (event: MouseEvent, d: Task) => {
                if (this.selectedTaskId === d.internalId) this.selectTask(null, null);
                else this.selectTask(d.internalId, d.name);
                event.stopPropagation();
            });
        }

        // 2. Render Columns (Right-to-Left stacking, coords are negative from 0)
        // This is outside the check, so columns remain visible even if Task Name is hidden
        const renderColumns = () => {
            const columnFontSize = taskNameFontSize * 0.9;
            const colY = taskHeight / 2;

            // Helper to append column text
            const appendColumnText = (
                selection: Selection<SVGGElement, Task, any, any>,
                xOffsetFromRight: number, // positive value, will be negated
                colWidth: number,
                getText: (d: Task) => string,
                align: "start" | "end" | "middle" = "middle", // Default to middle
                isFloat: boolean = false
            ) => {
                selection.append("text")
                    .attr("class", "column-label")
                    .attr("x", -xOffsetFromRight - (align === "end" ? 5 : (align === "start" ? colWidth - 5 : colWidth / 2)))
                    .attr("y", colY)
                    .attr("text-anchor", align)
                    .attr("dominant-baseline", "central")
                    .style("font-size", `${columnFontSize}pt`)
                    .style("fill", (d: Task) => {
                        if (isFloat) {
                            if (d.isCritical) return this.settings?.criticalPath?.criticalPathColor?.value?.value ?? '#FF0000';
                            if (d.isNearCritical) return this.settings?.criticalPath?.nearCriticalColor?.value?.value ?? '#FF8C00';
                        }
                        return labelColor;
                    })
                    .text(getText);
            };

            // Render Start Date
            if (showStart) {
                appendColumnText(mergedGroups, startOffset, startWidth, (d: Task) => d.startDate ? this.formatColumnDate(d.startDate) : "", "middle");
            }

            // Render Finish Date
            if (showFinish) {
                appendColumnText(mergedGroups, finishOffset, finishWidth, (d: Task) => d.finishDate ? this.formatColumnDate(d.finishDate) : "", "middle");
            }

            // Render Duration
            if (showDur) {
                appendColumnText(mergedGroups, durOffset, durWidth, (d: Task) => d.duration !== undefined ? d.duration.toFixed(0) : "", "middle");
            }

            // Render Total Float
            if (showFloat) {
                appendColumnText(mergedGroups, floatOffset, floatWidth, (d: Task) => {
                    const val = d.userProvidedTotalFloat ?? d.totalFloat;
                    return (val !== undefined && isFinite(val)) ? val.toFixed(0) : "-";
                }, "middle", true);
            }
        };

        renderColumns();
    }

    private drawColumnHeaders(headerHeight: number, currentLeftMargin: number): void {
        const headerSvg = this.headerSvg;
        if (!headerSvg) return;

        let colHeaderLayer = headerSvg.select<SVGGElement>(".column-headers");
        if (colHeaderLayer.empty()) {
            colHeaderLayer = headerSvg.append("g").attr("class", "column-headers");
        }
        colHeaderLayer.selectAll("*").remove();

        const cols = this.settings.columns;
        let occupiedWidth = 0;

        // Add padding between the last column (closest to chart) and the chart start
        const columnPadding = 20;
        occupiedWidth += columnPadding;

        type Item = { text: string, width: number, offset: number };
        const items: Item[] = [];
        const showExtra = this.showExtraColumnsInternal;

        if (showExtra && cols.showTotalFloat.value) {
            items.push({ text: "Total Float", width: cols.totalFloatWidth.value, offset: occupiedWidth });
            occupiedWidth += cols.totalFloatWidth.value;
        }
        if (showExtra && cols.showDuration.value) {
            items.push({ text: "Rem Dur", width: cols.durationWidth.value, offset: occupiedWidth });
            occupiedWidth += cols.durationWidth.value;
        }
        if (showExtra && cols.showFinishDate.value) {
            items.push({ text: "Finish", width: cols.finishDateWidth.value, offset: occupiedWidth });
            occupiedWidth += cols.finishDateWidth.value;
        }
        if (showExtra && cols.showStartDate.value) {
            items.push({ text: "Start", width: cols.startDateWidth.value, offset: occupiedWidth });
            occupiedWidth += cols.startDateWidth.value;
        }

        const fontSize = this.settings.textAndLabels.taskNameFontSize.value;
        const color = this.resolveColor(this.settings.textAndLabels.labelColor.value.value, "foreground");
        const yPos = headerHeight - 15;

        // Draw Task Name Header
        const remainingWidth = Math.max(0, currentLeftMargin - occupiedWidth);
        const taskNameCenter = remainingWidth / 2;

        if (showExtra && remainingWidth > 35) { // Only draw if space permits and columns are enabled
            colHeaderLayer.append("text")
                .attr("x", taskNameCenter)
                .attr("y", yPos)
                .attr("text-anchor", "middle")
                .style("font-size", `${fontSize}pt`)
                .style("font-weight", "bold")
                .style("fill", color)
                .text("Task Name");
        }

        // Draw Column Headers
        items.forEach(item => {
            // Position from right to left starting at currentLeftMargin
            const centerX = currentLeftMargin - item.offset - (item.width / 2);
            colHeaderLayer.append("text")
                .attr("x", centerX)
                .attr("y", yPos)
                .attr("text-anchor", "middle")
                .style("font-size", `${fontSize}pt`)
                .style("font-weight", "bold")
                .style("fill", color)
                .text(item.text);

            // Divider line (at left edge of column)
            const lineX = currentLeftMargin - item.offset - item.width;
            colHeaderLayer.append("line")
                .attr("x1", lineX)
                .attr("x2", lineX)
                .attr("y1", yPos - 15)
                .attr("y2", yPos + 5)
                .style("stroke", "#ccc")
                .style("stroke-width", "1px");
        });

        // Divider for Task Name (at right edge of Task Name column, which is left edge of first data column)
        if (showExtra) {
            const taskNameDividerX = currentLeftMargin - occupiedWidth;
            colHeaderLayer.append("line")
                .attr("x1", taskNameDividerX)
                .attr("x2", taskNameDividerX)
                .attr("y1", yPos - 15)
                .attr("y2", yPos + 5)
                .style("stroke", "#ccc")
                .style("stroke-width", "1px");
        }
    }

    /**
     * Draws vertical separator lines through the task label area, matching column headers
     */
    private drawLabelColumnSeparators(chartHeight: number, currentLeftMargin: number): void {
        const layer = this.labelGridLayer;
        if (!layer) return;

        // Clean up existing separators
        layer.selectAll(".label-column-separator").remove();

        const cols = this.settings.columns;
        const showExtra = this.showExtraColumnsInternal;

        // Utilize same width calculation logic as drawColumnHeaders
        const columnPadding = 20;
        let occupiedWidth = columnPadding; // Start with padding

        type Item = { width: number, offset: number };
        const items: Item[] = [];

        if (showExtra && cols.showTotalFloat.value) {
            items.push({ width: cols.totalFloatWidth.value, offset: occupiedWidth });
            occupiedWidth += cols.totalFloatWidth.value;
        }
        if (showExtra && cols.showDuration.value) {
            items.push({ width: cols.durationWidth.value, offset: occupiedWidth });
            occupiedWidth += cols.durationWidth.value;
        }
        if (showExtra && cols.showFinishDate.value) {
            items.push({ width: cols.finishDateWidth.value, offset: occupiedWidth });
            occupiedWidth += cols.finishDateWidth.value;
        }
        if (showExtra && cols.showStartDate.value) {
            items.push({ width: cols.startDateWidth.value, offset: occupiedWidth });
            occupiedWidth += cols.startDateWidth.value;
        }

        // Coordinates in labelGridLayer are relative to mainGroup transform (margin.left, margin.top)
        // Relative X = -offset - width

        items.forEach(item => {
            const lineX = -item.offset - item.width;
            layer.append("line")
                .attr("class", "label-column-separator")
                .attr("x1", lineX)
                .attr("x2", lineX)
                .attr("y1", 0)
                .attr("y2", chartHeight)
                .style("stroke", "#ccc")
                .style("stroke-width", "1px")
                .style("shape-rendering", "crispEdges");
        });

        // Divider for Task Name
        if (showExtra) {
            const taskNameDividerX = -occupiedWidth;
            layer.append("line")
                .attr("class", "label-column-separator")
                .attr("x1", taskNameDividerX)
                .attr("x2", taskNameDividerX)
                .attr("y1", 0)
                .attr("y2", chartHeight)
                .style("stroke", "#ccc")
                .style("stroke-width", "1px")
                .style("shape-rendering", "crispEdges");
        }
    }

    private drawTasksCanvas(
        tasks: Task[],
        xScale: ScaleTime<number, number>,
        yScale: ScaleBand<string>,
        taskColor: string,
        milestoneColor: string,
        criticalColor: string,
        labelColor: string,
        showDuration: boolean,
        taskHeight: number,
        dateBackgroundColor: string,
        dateBackgroundOpacity: number
    ): void {
        if (!this.canvasContext || !this.canvasElement) return;

        const ctx = this.canvasContext;

        ctx.save();

        const dpr = window.devicePixelRatio || 1;
        ctx.lineWidth = 1;

        const milestoneSizeSetting = this.settings.taskBars.milestoneSize.value;
        const minBarWidthForGlow = 10;

        const showPreviousUpdate = this.showPreviousUpdateInternal;
        const showBaseline = this.showBaselineInternal;

        type RectBatch = { x: number, y: number, w: number, h: number, r: number };
        type MilestoneBatch = { x: number, y: number, size: number, rotated: boolean };

        const prevUpdateBatch: RectBatch[] = [];
        const baselineBatch: RectBatch[] = [];

        const taskBatches = new Map<string, RectBatch[]>();
        const milestoneBatches = new Map<string, MilestoneBatch[]>();

        for (const task of tasks) {
            const domainKey = task.yOrder?.toString() ?? '';
            const yPosition = yScale(domainKey);
            if (yPosition === undefined || isNaN(yPosition)) continue;

            const yPos = Math.round(yPosition);

            if (showPreviousUpdate && task.previousUpdateStartDate && task.previousUpdateFinishDate && task.previousUpdateFinishDate >= task.previousUpdateStartDate) {
                const x = Math.round(xScale(task.previousUpdateStartDate));
                const w = Math.round(Math.max(1, xScale(task.previousUpdateFinishDate) - x));
                const h = Math.round(this.settings.comparisonBars.previousUpdateHeight.value);
                const y = Math.round(yPos + taskHeight + this.settings.comparisonBars.previousUpdateOffset.value);
                const r = Math.min(3, h / 2);
                prevUpdateBatch.push({ x, y, w, h, r });
            }

            if (showBaseline && task.baselineStartDate && task.baselineFinishDate && task.baselineFinishDate >= task.baselineStartDate) {
                let yBase: number;
                if (showPreviousUpdate) {
                    yBase = yPos + taskHeight + this.settings.comparisonBars.previousUpdateOffset.value + this.settings.comparisonBars.previousUpdateHeight.value + this.settings.comparisonBars.baselineOffset.value;
                } else {
                    yBase = yPos + taskHeight + this.settings.comparisonBars.baselineOffset.value;
                }
                const x = Math.round(xScale(task.baselineStartDate));
                const w = Math.round(Math.max(1, xScale(task.baselineFinishDate) - x));
                const h = Math.round(this.settings.comparisonBars.baselineHeight.value);
                const y = Math.round(yBase);
                const r = Math.min(3, h / 2);
                baselineBatch.push({ x, y, w, h, r });
            }

            let fillColor = taskColor;
            let strokeColor = this.getForegroundColor();
            let strokeWidth = 0.5;
            let shadowBlur = 0;
            let shadowColor = 'transparent';
            let shadowOffset = 0;

            const isSelected = task.internalId === this.selectedTaskId;

            if (isSelected) {
                fillColor = this.getSelectionColor();
                strokeColor = this.getSelectionColor();
                strokeWidth = 3;
                shadowColor = 'rgba(0, 0, 0, 0.15)';
                shadowBlur = 6;
                shadowOffset = 3;
            } else {

                if (this.legendDataExists && task.legendColor) {
                    fillColor = task.legendColor;
                } else if (!this.legendDataExists) {
                    if (task.isCritical) fillColor = criticalColor;
                    else if (task.isNearCritical) fillColor = this.resolveColor(this.settings.criticalPath.nearCriticalColor.value.value, "foreground");
                }

                if (this.legendDataExists) {
                    if (task.isCritical) {
                        strokeColor = criticalColor;
                        strokeWidth = this.settings.criticalPath.criticalBorderWidth.value;
                    } else if (task.isNearCritical) {
                        strokeColor = this.resolveColor(this.settings.criticalPath.nearCriticalColor.value.value, "foreground");
                        strokeWidth = this.settings.criticalPath.nearCriticalBorderWidth.value;
                    }
                } else {
                    if (task.isCritical) strokeWidth = 1;
                }

                const widthVal = (task.startDate && task.finishDate) ? (xScale(task.finishDate) - xScale(task.startDate)) : 0;
                if (widthVal >= minBarWidthForGlow || task.type === 'TT_Mile' || task.type === 'TT_FinMile') {
                    if (this.legendDataExists) {
                        if (task.isCritical) {
                            const rgb = this.hexToRgb(criticalColor);
                            shadowColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.35)`;
                            shadowBlur = 3;
                        } else if (task.isNearCritical) {
                            const ncColor = this.resolveColor(this.settings.criticalPath.nearCriticalColor.value.value, "foreground");
                            const rgb = this.hexToRgb(ncColor);
                            shadowColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25)`;
                            shadowBlur = 2;
                        } else {
                            shadowColor = 'rgba(0, 0, 0, 0.08)';
                            shadowBlur = 2;
                            shadowOffset = 1;
                        }
                    } else {
                        shadowColor = 'rgba(0, 0, 0, 0.08)';
                        shadowBlur = 2;
                        shadowOffset = 1;
                    }
                }
            }

            const styleKey = `${fillColor}|${strokeColor}|${strokeWidth}|${shadowBlur}|${shadowColor}|${shadowOffset}`;

            if (task.type === 'TT_Mile' || task.type === 'TT_FinMile') {
                const mDate = task.startDate || task.finishDate;
                if (mDate) {
                    const x = Math.round(xScale(mDate));
                    const y = Math.round(yPos + taskHeight / 2);
                    const size = Math.round(Math.max(4, Math.min(milestoneSizeSetting, taskHeight * 0.9)));

                    if (!milestoneBatches.has(styleKey)) milestoneBatches.set(styleKey, []);
                    milestoneBatches.get(styleKey)!.push({ x, y, size, rotated: true });
                }
            } else if (task.startDate && task.finishDate) {
                const x = Math.round(xScale(task.startDate));
                const w = Math.round(Math.max(1, xScale(task.finishDate) - xScale(task.startDate)));
                const h = Math.round(taskHeight);
                const r = Math.min(5, Math.round(h * 0.15), Math.round(w / 2));

                if (!taskBatches.has(styleKey)) taskBatches.set(styleKey, []);
                taskBatches.get(styleKey)!.push({ x, y: yPos, w, h, r });
            }
        }

        if (prevUpdateBatch.length > 0) {
            const pColor = this.resolveColor(this.settings.comparisonBars.previousUpdateColor.value.value, "foreground");
            const pStroke = this.getContrastColor(pColor);

            ctx.fillStyle = pColor;
            ctx.strokeStyle = pStroke;
            ctx.lineWidth = 0.6;

            ctx.beginPath();
            for (const b of prevUpdateBatch) {
                this.pathRoundedRect(ctx, b.x, b.y, b.w, b.h, b.r);
            }
            ctx.fill();

            ctx.globalAlpha = 0.25;
            ctx.stroke();
            ctx.globalAlpha = 1.0;
        }

        if (baselineBatch.length > 0) {
            const bColor = this.resolveColor(this.settings.comparisonBars.baselineColor.value.value, "foreground");
            const bStroke = this.getContrastColor(bColor);

            ctx.fillStyle = bColor;
            ctx.strokeStyle = bStroke;
            ctx.lineWidth = 0.6;

            ctx.beginPath();
            for (const b of baselineBatch) {
                this.pathRoundedRect(ctx, b.x, b.y, b.w, b.h, b.r);
            }
            ctx.fill();

            ctx.globalAlpha = 0.25;
            ctx.stroke();
            ctx.globalAlpha = 1.0;
        }

        taskBatches.forEach((batch, styleKey) => {
            const [fill, stroke, widthStr, blurStr, shadowCol, offsetStr] = styleKey.split('|');
            const strokeWidth = parseFloat(widthStr);
            const shadowBlur = parseFloat(blurStr);
            const shadowOffset = parseFloat(offsetStr);

            ctx.fillStyle = fill;
            ctx.strokeStyle = stroke;
            ctx.lineWidth = strokeWidth;

            if (shadowBlur > 0) {
                ctx.shadowColor = shadowCol;
                ctx.shadowBlur = shadowBlur;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = shadowOffset;
            } else {
                ctx.shadowColor = 'transparent';
            }

            ctx.beginPath();
            for (const b of batch) {
                this.pathRoundedRect(ctx, b.x, b.y, b.w, b.h, b.r);
            }
            ctx.fill();

            ctx.shadowColor = 'transparent';
            if (strokeWidth > 0) ctx.stroke();
        });

        milestoneBatches.forEach((batch, styleKey) => {
            const [fill, stroke, widthStr, blurStr, shadowCol, offsetStr] = styleKey.split('|');
            const strokeWidth = parseFloat(widthStr);
            const shadowBlur = parseFloat(blurStr);
            const shadowOffset = parseFloat(offsetStr);

            ctx.fillStyle = fill;
            ctx.strokeStyle = stroke;
            ctx.lineWidth = strokeWidth;

            if (shadowBlur > 0) {
                ctx.shadowColor = shadowCol;
                ctx.shadowBlur = shadowBlur;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = shadowOffset;
            } else {
                ctx.shadowColor = 'transparent';
            }

            ctx.beginPath();
            for (const m of batch) {
                const half = m.size / 2;
                ctx.moveTo(m.x, m.y - half);
                ctx.lineTo(m.x + half, m.y);
                ctx.lineTo(m.x, m.y + half);
                ctx.lineTo(m.x - half, m.y);
                ctx.closePath();
            }
            ctx.fill();

            ctx.shadowColor = 'transparent';
            if (strokeWidth > 0) ctx.stroke();
        });

        ctx.restore();
    }

    /**
     * Helper to add a rounded rect to the current path
     * (Inlined for batching performance)
     */
    private pathRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
        const r = Math.max(0, Math.min(radius, height / 2, width / 2));
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + width - r, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + r);
        ctx.lineTo(x + width, y + height - r);
        ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
        ctx.lineTo(x + r, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
    }

    /**
     * ACCESSIBILITY: Creates an invisible but screen-reader accessible fallback for canvas rendering.
     * This ensures users with assistive technology can access task information even when canvas mode is active.
     * @param tasks The tasks being rendered on canvas
     * @param yScale The Y-axis scale for positioning
     */
    private createAccessibleCanvasFallback(tasks: Task[], yScale: ScaleBand<string>): void {
        if (!this.mainSvg) return;

        this.mainSvg.selectAll(".accessible-fallback-layer").remove();

        const accessibleLayer = this.mainSvg.append("g")
            .attr("class", "accessible-fallback-layer")
            .attr("role", "list")
            .attr("aria-label", "Project tasks (canvas rendering mode)")
            .style("opacity", 0)
            .style("pointer-events", "none");

        const taskGroups = accessibleLayer.selectAll(".accessible-task")
            .data(tasks, (d: Task) => d.internalId)
            .enter()
            .append("g")
            .attr("class", "accessible-task")
            .attr("role", "listitem")
            .attr("transform", (d: Task) => {
                const domainKey = d.yOrder?.toString() ?? '';
                const yPosition = yScale(domainKey);
                return yPosition !== undefined ? `translate(0, ${yPosition})` : "translate(0, 0)";
            });

        taskGroups.append("rect")
            .attr("role", "button")
            .attr("aria-label", (d: Task) => {
                const statusText = d.isCritical ? "Critical" : d.isNearCritical ? "Near Critical" : "Normal";
                const selectedText = d.internalId === this.selectedTaskId ? " (Selected)" : "";
                if (d.type === 'TT_Mile' || d.type === 'TT_FinMile') {
                    const milestoneDate = (d.startDate instanceof Date && !isNaN(d.startDate.getTime())) ? d.startDate : d.finishDate;
                    return `${d.name}, ${statusText} milestone, Date: ${this.formatDate(milestoneDate)}${selectedText}. Press Enter or Space to select.`;
                } else {
                    return `${d.name}, ${statusText} task, Start: ${this.formatDate(d.startDate)}, Finish: ${this.formatDate(d.finishDate)}${selectedText}. Press Enter or Space to select.`;
                }
            })
            .attr("tabindex", 0)
            .attr("aria-pressed", (d: Task) => d.internalId === this.selectedTaskId ? "true" : "false")
            .attr("x", 0)
            .attr("y", 0)
            .attr("width", "100%")
            .attr("height", this.settings.taskBars.taskHeight.value)
            .style("fill", "transparent")
            .on("keydown", (event: KeyboardEvent, d: Task) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();

                    if (this.selectedTaskId === d.internalId) {
                        this.selectTask(null, null);
                    } else {
                        this.selectTask(d.internalId, d.name);
                    }

                    if (this.dropdownInput) {
                        this.dropdownInput.property("value", this.selectedTaskName || "");
                    }
                }
            })
            .on("focus", function (_event: FocusEvent, _d: Task) {
                d3.select(this)
                    .style("outline", "2px solid #0078D4")
                    .style("outline-offset", "2px");
            })
            .on("blur", function (_event: FocusEvent, _d: Task) {
                d3.select(this)
                    .style("outline", null)
                    .style("outline-offset", null);
            });
    }

    /**
     * Prepares the canvas for high-DPI rendering.
     * This function sizes the canvas backing store, clears it, and applies the necessary scale transform.
     * @param chartWidth The desired CSS width of the chart.
     * @param chartHeight The desired CSS height of the chart.
     * @returns {boolean} True if the canvas was set up successfully, false otherwise.
     */
    private _setupCanvasForDrawing(chartWidth: number, chartHeight: number): boolean {
        if (!this.canvasElement) {
            return false;
        }

        const ctx = this.canvasElement.getContext('2d');
        const devicePixelRatio = window.devicePixelRatio || 1;
        const backingStoreRatio = (ctx as any).webkitBackingStorePixelRatio ||
            (ctx as any).mozBackingStorePixelRatio ||
            (ctx as any).msBackingStorePixelRatio ||
            (ctx as any).oBackingStorePixelRatio ||
            (ctx as any).backingStorePixelRatio || 1;

        const ratio = devicePixelRatio / backingStoreRatio;

        const displayWidth = Math.round(chartWidth);
        const displayHeight = Math.round(chartHeight);
        const canvasWidth = Math.round(displayWidth * ratio);
        const canvasHeight = Math.round(displayHeight * ratio);

        this.canvasElement.style.width = `${displayWidth}px`;
        this.canvasElement.style.height = `${displayHeight}px`;

        this.canvasElement.width = canvasWidth;
        this.canvasElement.height = canvasHeight;

        this.canvasContext = this.canvasElement.getContext('2d', {
            alpha: false,
            desynchronized: false,
            willReadFrequently: false
        });

        if (!this.canvasContext) {
            console.error("Failed to get 2D context from canvas.");
            return false;
        }

        this.canvasContext.setTransform(ratio, 0, 0, ratio, 0, 0);

        this.canvasContext.fillStyle = '#FFFFFF';
        this.canvasContext.fillRect(0, 0, displayWidth, displayHeight);

        this.canvasContext.beginPath();
        this.canvasContext.rect(0, 0, displayWidth, displayHeight);
        this.canvasContext.clip();

        this.canvasContext.imageSmoothingEnabled = false;
        this.canvasContext.imageSmoothingQuality = 'high';

        (this.canvasContext as any).textRendering = 'optimizeLegibility';
        (this.canvasContext as any).webkitFontSmoothing = 'antialiased';
        (this.canvasContext as any).mozOsxFontSmoothing = 'grayscale';

        this.debugLog(`Canvas setup: Ratio=${ratio}, Display=${displayWidth}x${displayHeight}, Canvas=${canvasWidth}x${canvasHeight}`);
        return true;
    }

    private drawArrowsCanvas(
        tasks: Task[],
        xScale: ScaleTime<number, number>,
        yScale: ScaleBand<string>,
        criticalColor: string,
        connectorColor: string,
        connectorWidth: number,
        criticalConnectorWidth: number,
        taskHeight: number,
        milestoneSizeSetting: number
    ): void {
        if (!this.canvasContext || !this.canvasElement) return;

        const ctx = this.canvasContext;

        ctx.save();

        try {
            const connectionEndPadding = 0;
            const elbowOffset = this.settings.connectorLines.elbowOffset.value;

            const taskPositions = new Map<string, number>();
            tasks.forEach((task: Task) => {
                if (task.yOrder !== undefined) taskPositions.set(task.internalId, task.yOrder);
            });

            const visibleTaskIds = new Set(taskPositions.keys());
            const visibleRelationships: Relationship[] = [];
            for (const predecessorId of visibleTaskIds) {
                const relationships = this.relationshipByPredecessor.get(predecessorId);
                if (!relationships) continue;
                for (const rel of relationships) {
                    if (visibleTaskIds.has(rel.successorId)) {
                        visibleRelationships.push(rel);
                    }
                }
            }

            visibleRelationships.forEach((rel: Relationship) => {
                const pred = this.taskIdToTask.get(rel.predecessorId);
                const succ = this.taskIdToTask.get(rel.successorId);
                const predYOrder = taskPositions.get(rel.predecessorId);
                const succYOrder = taskPositions.get(rel.successorId);

                if (!pred || !succ || predYOrder === undefined || succYOrder === undefined) return;

                const predYBandPos = yScale(predYOrder.toString());
                const succYBandPos = yScale(succYOrder.toString());
                if (predYBandPos === undefined || succYBandPos === undefined) return;

                const predY = predYBandPos + taskHeight / 2;
                const succY = succYBandPos + taskHeight / 2;
                const relType = rel.type || 'FS';
                const predIsMilestone = pred.type === 'TT_Mile' || pred.type === 'TT_FinMile';
                const succIsMilestone = succ.type === 'TT_Mile' || succ.type === 'TT_FinMile';

                let baseStartDate: Date | null | undefined = null;
                let baseEndDate: Date | null | undefined = null;

                switch (relType) {
                    case 'FS': case 'FF':
                        baseStartDate = predIsMilestone ? (pred.startDate ?? pred.finishDate) : pred.finishDate;
                        break;
                    case 'SS': case 'SF':
                        baseStartDate = pred.startDate;
                        break;
                }
                switch (relType) {
                    case 'FS': case 'SS':
                        baseEndDate = succ.startDate;
                        break;
                    case 'FF': case 'SF':
                        baseEndDate = succIsMilestone ? (succ.startDate ?? succ.finishDate) : succ.finishDate;
                        break;
                }

                if (!baseStartDate || !baseEndDate) return;

                const startX = xScale(baseStartDate);
                const endX = xScale(baseEndDate);

                const milestoneDrawSize = Math.max(4, Math.min(milestoneSizeSetting, taskHeight * 0.9));
                const startGap = predIsMilestone ? (milestoneDrawSize / 2 + 3) : 3;
                const endGap = succIsMilestone ? (milestoneDrawSize / 2 + 3 + connectionEndPadding) : (3 + connectionEndPadding);

                let effectiveStartX = startX;
                let effectiveEndX = endX;

                if (relType === 'FS' || relType === 'FF') effectiveStartX += startGap;
                else effectiveStartX -= startGap;
                if (predIsMilestone && (relType === 'SS' || relType === 'SF')) effectiveStartX = startX + startGap;

                if (relType === 'FS' || relType === 'SS') effectiveEndX -= endGap;
                else effectiveEndX += endGap;
                if (succIsMilestone && (relType === 'FF' || relType === 'SF')) effectiveEndX = endX + endGap - connectionEndPadding;

                const isCritical = rel.isCritical;
                const isDriving = rel.isDriving ?? isCritical; // Driving if marked or critical
                const baseLineWidth = isCritical ? criticalConnectorWidth : connectorWidth;
                const enhancedLineWidth = isCritical
                    ? Math.max(1.6, baseLineWidth)
                    : Math.max(1, baseLineWidth);

                const previousAlpha = ctx.globalAlpha;

                // Phase 2: Differentiate driving vs non-driving connectors
                const differentiateDrivers = this.settings?.connectorLines?.differentiateDrivers?.value ?? true;
                const nonDrivingOpacity = (this.settings?.connectorLines?.nonDrivingOpacity?.value ?? 40) / 100;
                const nonDrivingLineStyle = this.settings?.connectorLines?.nonDrivingLineStyle?.value?.value ?? 'dashed';

                // Apply opacity - driving lines are full opacity, non-driving are reduced
                const baseOpacity = this.getConnectorOpacity(rel);
                ctx.globalAlpha = differentiateDrivers && !isDriving ? baseOpacity * nonDrivingOpacity : baseOpacity;
                ctx.strokeStyle = isCritical ? criticalColor : connectorColor;
                ctx.lineWidth = enhancedLineWidth;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';

                // Phase 2: Set dash pattern for non-driving lines
                if (differentiateDrivers && !isDriving) {
                    switch (nonDrivingLineStyle) {
                        case 'dashed':
                            ctx.setLineDash([6, 4]);
                            break;
                        case 'dotted':
                            ctx.setLineDash([2, 3]);
                            break;
                        default: // solid
                            ctx.setLineDash([]);
                    }
                } else {
                    ctx.setLineDash([]); // Driving lines are always solid
                }

                (ctx as any).imageSmoothingEnabled = true;
                (ctx as any).imageSmoothingQuality = 'high';

                ctx.beginPath();
                ctx.moveTo(effectiveStartX, predY);

                const cornerRadius = 8;

                if (Math.abs(predY - succY) < 1) {

                    ctx.lineTo(effectiveEndX, succY);
                } else {

                    const isGoingDown = succY > predY;

                    switch (relType) {
                        case 'FS':

                            if (Math.abs(effectiveStartX - effectiveStartX) > cornerRadius * 2 &&
                                Math.abs(succY - predY) > cornerRadius * 2) {
                                const verticalStart = predY + (isGoingDown ? cornerRadius : -cornerRadius);
                                const horizontalStart = effectiveStartX;
                                const horizontalEnd = effectiveEndX - (effectiveEndX > effectiveStartX ? cornerRadius : -cornerRadius);

                                ctx.lineTo(effectiveStartX, verticalStart);
                                ctx.arcTo(effectiveStartX, succY, horizontalEnd, succY, cornerRadius);
                                ctx.lineTo(effectiveEndX, succY);
                            } else {

                                ctx.lineTo(effectiveStartX, succY);
                                ctx.lineTo(effectiveEndX, succY);
                            }
                            break;
                        case 'SS':
                            const ssOffsetX = Math.min(effectiveStartX, effectiveEndX) - elbowOffset;

                            if (Math.abs(effectiveStartX - ssOffsetX) > cornerRadius &&
                                Math.abs(succY - predY) > cornerRadius * 2) {
                                ctx.lineTo(ssOffsetX + cornerRadius, predY);
                                ctx.arcTo(ssOffsetX, predY, ssOffsetX, predY + (isGoingDown ? cornerRadius : -cornerRadius), cornerRadius);
                                const vertEnd = succY - (isGoingDown ? cornerRadius : -cornerRadius);
                                ctx.lineTo(ssOffsetX, vertEnd);
                                ctx.arcTo(ssOffsetX, succY, ssOffsetX + cornerRadius, succY, cornerRadius);
                                ctx.lineTo(effectiveEndX, succY);
                            } else {
                                ctx.lineTo(ssOffsetX, predY);
                                ctx.lineTo(ssOffsetX, succY);
                                ctx.lineTo(effectiveEndX, succY);
                            }
                            break;
                        case 'FF':
                            const ffOffsetX = Math.max(effectiveStartX, effectiveEndX) + elbowOffset;
                            if (Math.abs(ffOffsetX - effectiveStartX) > cornerRadius &&
                                Math.abs(succY - predY) > cornerRadius * 2) {
                                ctx.lineTo(ffOffsetX - cornerRadius, predY);
                                ctx.arcTo(ffOffsetX, predY, ffOffsetX, predY + (isGoingDown ? cornerRadius : -cornerRadius), cornerRadius);
                                const vertEnd = succY - (isGoingDown ? cornerRadius : -cornerRadius);
                                ctx.lineTo(ffOffsetX, vertEnd);
                                ctx.arcTo(ffOffsetX, succY, ffOffsetX - cornerRadius, succY, cornerRadius);
                                ctx.lineTo(effectiveEndX, succY);
                            } else {
                                ctx.lineTo(ffOffsetX, predY);
                                ctx.lineTo(ffOffsetX, succY);
                                ctx.lineTo(effectiveEndX, succY);
                            }
                            break;
                        case 'SF':
                            const sfStartOffset = effectiveStartX - elbowOffset;
                            const sfEndOffset = effectiveEndX + elbowOffset;
                            const midY = (predY + succY) / 2;

                            if (Math.abs(effectiveStartX - sfStartOffset) > cornerRadius) {
                                ctx.lineTo(sfStartOffset + cornerRadius, predY);
                                ctx.arcTo(sfStartOffset, predY, sfStartOffset, midY, cornerRadius);
                                const mid1 = midY + (predY < midY ? -cornerRadius : cornerRadius);
                                ctx.lineTo(sfStartOffset, mid1);
                                ctx.arcTo(sfStartOffset, midY, sfEndOffset, midY, cornerRadius);
                                ctx.lineTo(sfEndOffset - cornerRadius, midY);
                                const mid2 = midY + (succY > midY ? cornerRadius : -cornerRadius);
                                ctx.arcTo(sfEndOffset, midY, sfEndOffset, mid2, cornerRadius);
                                ctx.lineTo(sfEndOffset, succY - (succY > midY ? cornerRadius : -cornerRadius));
                                ctx.arcTo(sfEndOffset, succY, effectiveEndX, succY, cornerRadius);
                                ctx.lineTo(effectiveEndX, succY);
                            } else {

                                ctx.lineTo(sfStartOffset, predY);
                                ctx.lineTo(sfStartOffset, midY);
                                ctx.lineTo(sfEndOffset, midY);
                                ctx.lineTo(sfEndOffset, succY);
                                ctx.lineTo(effectiveEndX, succY);
                            }
                            break;
                        default:

                            ctx.lineTo(effectiveStartX, succY);
                            ctx.lineTo(effectiveEndX, succY);
                    }
                }

                ctx.stroke();
                ctx.setLineDash([]); // Reset line dash for next connector
                ctx.globalAlpha = previousAlpha;
            });
        } finally {

            ctx.restore();
        }
    }

    /**
     * Positions the tooltip intelligently to prevent it from being cut off at screen edges
     * @param tooltipNode The tooltip DOM element
     * @param event The mouse event that triggered the tooltip
     */
    private positionTooltip(tooltipNode: HTMLElement | null, event: MouseEvent): void {
        if (!tooltipNode) return;

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        const tooltipRect = tooltipNode.getBoundingClientRect();
        const tooltipWidth = tooltipRect.width;
        const tooltipHeight = tooltipRect.height;

        const spaceRight = viewportWidth - event.clientX - 15;
        const spaceBottom = viewportHeight - event.clientY - 10;

        let xPos = event.pageX + 15;
        let yPos = event.pageY - 10;

        if (spaceRight < tooltipWidth) {

            xPos = Math.max(10, event.pageX - tooltipWidth - 10);
        }

        if (spaceBottom < tooltipHeight) {

            yPos = Math.max(10, event.pageY - tooltipHeight - 10);
        }

        d3.select(tooltipNode)
            .style("left", `${xPos}px`)
            .style("top", `${yPos}px`);
    }

    private drawArrows(
        tasks: Task[],
        xScale: ScaleTime<number, number>,
        yScale: ScaleBand<string>,
        criticalColor: string,
        connectorColor: string,
        connectorWidth: number,
        criticalConnectorWidth: number,
        taskHeight: number,
        milestoneSizeSetting: number

    ): void {

        if (!this.showConnectorLinesInternal) {
            if (this.arrowLayer) {
                this.arrowLayer.selectAll(".relationship-arrow, .connection-dot-start, .connection-dot-end").remove();
            }
            return;
        }

        if (!this.arrowLayer?.node() || !xScale || !yScale) {
            console.warn("Skipping arrow drawing: Missing layer or invalid scales.");
            return;
        }
        this.arrowLayer.selectAll(".relationship-arrow, .connection-dot-start, .connection-dot-end").remove();

        const connectionEndPadding = 0;
        const elbowOffset = this.settings.connectorLines.elbowOffset.value;

        const taskPositions = new Map<string, number>();
        tasks.forEach((task: Task) => {
            if (task.yOrder !== undefined) taskPositions.set(task.internalId, task.yOrder);
        });

        const visibleTaskIds = new Set(taskPositions.keys());
        const visibleRelationships: Relationship[] = [];
        for (const predecessorId of visibleTaskIds) {
            const relationships = this.relationshipByPredecessor.get(predecessorId);
            if (!relationships) continue;
            for (const rel of relationships) {
                if (visibleTaskIds.has(rel.successorId)) {
                    visibleRelationships.push(rel);
                }
            }
        }
        // Phase 2: Get driving differentiation settings
        const differentiateDrivers = this.settings?.connectorLines?.differentiateDrivers?.value ?? true;
        const nonDrivingOpacity = (this.settings?.connectorLines?.nonDrivingOpacity?.value ?? 40) / 100;
        const nonDrivingLineStyle = this.settings?.connectorLines?.nonDrivingLineStyle?.value?.value ?? 'dashed';

        // Helper to get dash array for SVG
        const getDashArray = (rel: Relationship): string => {
            const isDriving = rel.isDriving ?? rel.isCritical;
            if (!differentiateDrivers || isDriving) return 'none';
            switch (nonDrivingLineStyle) {
                case 'dashed': return '6,4';
                case 'dotted': return '2,3';
                default: return 'none';
            }
        };

        this.arrowLayer.selectAll(".relationship-arrow")
            .data(visibleRelationships, (d: Relationship) => `${d.predecessorId}-${d.successorId}`)
            .enter()
            .append("path")
            .attr("class", (d: Relationship) => {
                const isDriving = d.isDriving ?? d.isCritical;
                return `relationship-arrow ${d.isCritical ? "critical" : "normal"} ${isDriving ? "driving" : "non-driving"}`;
            })
            .attr("fill", "none")
            .attr("stroke", (d: Relationship) => d.isCritical ? criticalColor : connectorColor)
            .attr("stroke-opacity", (d: Relationship) => {
                const isDriving = d.isDriving ?? d.isCritical;
                const baseOpacity = this.getConnectorOpacity(d);
                return differentiateDrivers && !isDriving ? baseOpacity * nonDrivingOpacity : baseOpacity;
            })
            .attr("stroke-width", (d: Relationship) => {
                const baseWidth = d.isCritical ? criticalConnectorWidth : connectorWidth;
                return d.isCritical ? Math.max(1.6, baseWidth) : Math.max(1, baseWidth);
            })
            .attr("stroke-linecap", "round")
            .attr("stroke-linejoin", "round")
            .attr("stroke-dasharray", (d: Relationship) => getDashArray(d))
            .attr("marker-end", (d: Relationship) => d.isCritical ? "url(#arrowhead-critical)" : "url(#arrowhead)")
            .attr("d", (rel: Relationship): string | null => {
                const pred = this.taskIdToTask.get(rel.predecessorId);
                const succ = this.taskIdToTask.get(rel.successorId);
                const predYOrder = taskPositions.get(rel.predecessorId);
                const succYOrder = taskPositions.get(rel.successorId);

                if (!pred || !succ || predYOrder === undefined || succYOrder === undefined) return null;

                const predYBandPos = yScale(predYOrder.toString());
                const succYBandPos = yScale(succYOrder.toString());
                if (predYBandPos === undefined || succYBandPos === undefined || isNaN(predYBandPos) || isNaN(succYBandPos)) return null;

                const predY = predYBandPos + taskHeight / 2;
                const succY = succYBandPos + taskHeight / 2;
                const relType = rel.type || 'FS';
                const predIsMilestone = pred.type === 'TT_Mile' || pred.type === 'TT_FinMile';
                const succIsMilestone = succ.type === 'TT_Mile' || succ.type === 'TT_FinMile';

                let baseStartDate: Date | null | undefined = null;
                let baseEndDate: Date | null | undefined = null;

                switch (relType) {
                    case 'FS': case 'FF': baseStartDate = predIsMilestone ? (pred.startDate ?? pred.finishDate) : pred.finishDate; break;
                    case 'SS': case 'SF': baseStartDate = pred.startDate; break;
                }
                switch (relType) {
                    case 'FS': case 'SS': baseEndDate = succ.startDate; break;
                    case 'FF': case 'SF': baseEndDate = succIsMilestone ? (succ.startDate ?? succ.finishDate) : succ.finishDate; break;
                }

                let startX: number | null = null;
                let endX: number | null = null;
                if (baseStartDate instanceof Date && !isNaN(baseStartDate.getTime())) startX = xScale(baseStartDate);
                if (baseEndDate instanceof Date && !isNaN(baseEndDate.getTime())) endX = xScale(baseEndDate);

                if (startX === null || endX === null || isNaN(startX) || isNaN(endX)) return null;

                const milestoneDrawSize = Math.max(4, Math.min(milestoneSizeSetting, taskHeight * 0.9));
                const startGap = predIsMilestone ? (milestoneDrawSize / 2 + 3) : 3;
                const endGap = succIsMilestone ? (milestoneDrawSize / 2 + 3 + connectionEndPadding) : (3 + connectionEndPadding);

                let effectiveStartX = startX;
                let effectiveEndX = endX;

                if (relType === 'FS' || relType === 'FF') effectiveStartX += startGap;
                else effectiveStartX -= startGap;
                if (predIsMilestone && (relType === 'SS' || relType === 'SF')) effectiveStartX = startX + startGap;

                if (relType === 'FS' || relType === 'SS') effectiveEndX -= endGap;
                else effectiveEndX += endGap;
                if (succIsMilestone && (relType === 'FF' || relType === 'SF')) effectiveEndX = endX + endGap - connectionEndPadding;

                const pStartX = effectiveStartX;
                const pStartY = predY;
                const pEndX = effectiveEndX;
                const pEndY = succY;

                if (Math.abs(pStartX - pEndX) < elbowOffset && Math.abs(pStartY - pEndY) < 1) return null;

                const cornerRadius = 8;
                let pathData: string;

                if (Math.abs(pStartY - pEndY) < 1) {

                    pathData = `M ${pStartX},${pStartY} H ${pEndX}`;
                } else {

                    const isGoingDown = pEndY > pStartY;

                    switch (relType) {
                        case 'FS':

                            if (Math.abs(pEndY - pStartY) > cornerRadius * 2) {
                                const verticalEnd = pEndY - (isGoingDown ? cornerRadius : -cornerRadius);
                                pathData = `M ${pStartX},${pStartY} L ${pStartX},${verticalEnd} Q ${pStartX},${pEndY} ${pStartX + cornerRadius},${pEndY} L ${pEndX},${pEndY}`;
                            } else {
                                pathData = `M ${pStartX},${pStartY} V ${pEndY} H ${pEndX}`;
                            }
                            break;

                        case 'SS':

                            const ssOffsetX = Math.min(pStartX, pEndX) - elbowOffset;
                            if (Math.abs(pStartX - ssOffsetX) > cornerRadius && Math.abs(pEndY - pStartY) > cornerRadius * 2) {
                                const h1End = ssOffsetX + cornerRadius;
                                const v1End = pEndY - (isGoingDown ? cornerRadius : -cornerRadius);
                                pathData = `M ${pStartX},${pStartY} L ${h1End},${pStartY} Q ${ssOffsetX},${pStartY} ${ssOffsetX},${pStartY + (isGoingDown ? cornerRadius : -cornerRadius)} L ${ssOffsetX},${v1End} Q ${ssOffsetX},${pEndY} ${h1End},${pEndY} L ${pEndX},${pEndY}`;
                            } else {
                                pathData = `M ${pStartX},${pStartY} H ${ssOffsetX} V ${pEndY} H ${pEndX}`;
                            }
                            break;

                        case 'FF':

                            const ffOffsetX = Math.max(pStartX, pEndX) + elbowOffset;
                            if (Math.abs(ffOffsetX - pStartX) > cornerRadius && Math.abs(pEndY - pStartY) > cornerRadius * 2) {
                                const h1End = ffOffsetX - cornerRadius;
                                const v1End = pEndY - (isGoingDown ? cornerRadius : -cornerRadius);
                                pathData = `M ${pStartX},${pStartY} L ${h1End},${pStartY} Q ${ffOffsetX},${pStartY} ${ffOffsetX},${pStartY + (isGoingDown ? cornerRadius : -cornerRadius)} L ${ffOffsetX},${v1End} Q ${ffOffsetX},${pEndY} ${h1End},${pEndY} L ${pEndX},${pEndY}`;
                            } else {
                                pathData = `M ${pStartX},${pStartY} H ${ffOffsetX} V ${pEndY} H ${pEndX}`;
                            }
                            break;

                        case 'SF':

                            const sfStartOffset = pStartX - elbowOffset;
                            const sfEndOffset = pEndX + elbowOffset;
                            const midY = (pStartY + pEndY) / 2;
                            if (Math.abs(pStartX - sfStartOffset) > cornerRadius) {
                                const h1End = sfStartOffset + cornerRadius;
                                const v1Start = pStartY + (midY > pStartY ? cornerRadius : -cornerRadius);
                                const v1End = midY - (midY > pStartY ? cornerRadius : -cornerRadius);
                                const h2End = sfEndOffset - cornerRadius;
                                const v2Start = midY + (pEndY > midY ? cornerRadius : -cornerRadius);
                                const v2End = pEndY - (pEndY > midY ? cornerRadius : -cornerRadius);
                                pathData = `M ${pStartX},${pStartY} L ${h1End},${pStartY} Q ${sfStartOffset},${pStartY} ${sfStartOffset},${v1Start} L ${sfStartOffset},${v1End} Q ${sfStartOffset},${midY} ${h1End},${midY} L ${h2End},${midY} Q ${sfEndOffset},${midY} ${sfEndOffset},${v2Start} L ${sfEndOffset},${v2End} Q ${sfEndOffset},${pEndY} ${h2End},${pEndY} L ${pEndX},${pEndY}`;
                            } else {
                                pathData = `M ${pStartX},${pStartY} H ${sfStartOffset} V ${midY} H ${sfEndOffset} V ${pEndY} H ${pEndX}`;
                            }
                            break;

                        default:

                            pathData = `M ${pStartX},${pStartY} V ${pEndY} H ${pEndX}`;
                    }
                }
                return pathData;
            })
            .filter(function () { return d3.select(this).attr("d") !== null; });

        this.arrowLayer.selectAll(".connection-dot-start")
            .data(visibleRelationships, (d: Relationship) => `start-${d.predecessorId}-${d.successorId}`)
            .enter()
            .append("circle")
            .attr("class", "connection-dot-start")
            .attr("r", (d: Relationship) => d.isCritical ? 2.5 : 2)
            .attr("fill", (d: Relationship) => d.isCritical ? criticalColor : connectorColor)
            .attr("fill-opacity", (d: Relationship) => this.getConnectorOpacity(d))
            .attr("stroke", "white")
            .attr("stroke-width", 0.5)
            .attr("stroke-opacity", 0.6)
            .attr("cx", (rel: Relationship): number => {
                const pred = this.taskIdToTask.get(rel.predecessorId);
                const predYOrder = taskPositions.get(rel.predecessorId);
                if (!pred || predYOrder === undefined) return 0;

                const relType = rel.type || 'FS';
                const predIsMilestone = pred.type === 'TT_Mile' || pred.type === 'TT_FinMile';

                let baseStartDate: Date | null | undefined = null;
                switch (relType) {
                    case 'FS': case 'FF': baseStartDate = predIsMilestone ? (pred.startDate ?? pred.finishDate) : pred.finishDate; break;
                    case 'SS': case 'SF': baseStartDate = pred.startDate; break;
                }

                if (baseStartDate instanceof Date && !isNaN(baseStartDate.getTime())) {
                    const startX = xScale(baseStartDate);
                    const milestoneDrawSize = Math.max(4, Math.min(milestoneSizeSetting, taskHeight * 0.9));
                    const startGap = predIsMilestone ? (milestoneDrawSize / 2 + 3) : 3;

                    if (relType === 'FS' || relType === 'FF') return startX + startGap;
                    else return startX - startGap;
                }
                return 0;
            })
            .attr("cy", (rel: Relationship): number => {
                const predYOrder = taskPositions.get(rel.predecessorId);
                if (predYOrder === undefined) return 0;
                const predYBandPos = yScale(predYOrder.toString());
                if (predYBandPos === undefined) return 0;
                return predYBandPos + taskHeight / 2;
            });

        this.arrowLayer.selectAll(".connection-dot-end")
            .data(visibleRelationships, (d: Relationship) => `end-${d.predecessorId}-${d.successorId}`)
            .enter()
            .append("circle")
            .attr("class", "connection-dot-end")
            .attr("r", (d: Relationship) => d.isCritical ? 2.5 : 2)
            .attr("fill", (d: Relationship) => d.isCritical ? criticalColor : connectorColor)
            .attr("fill-opacity", (d: Relationship) => this.getConnectorOpacity(d))
            .attr("stroke", "white")
            .attr("stroke-width", 0.5)
            .attr("stroke-opacity", 0.6)
            .attr("cx", (rel: Relationship): number => {
                const succ = this.taskIdToTask.get(rel.successorId);
                const succYOrder = taskPositions.get(rel.successorId);
                if (!succ || succYOrder === undefined) return 0;

                const relType = rel.type || 'FS';
                const succIsMilestone = succ.type === 'TT_Mile' || succ.type === 'TT_FinMile';

                let baseEndDate: Date | null | undefined = null;
                switch (relType) {
                    case 'FS': case 'SS': baseEndDate = succ.startDate; break;
                    case 'FF': case 'SF': baseEndDate = succIsMilestone ? (succ.startDate ?? succ.finishDate) : succ.finishDate; break;
                }

                if (baseEndDate instanceof Date && !isNaN(baseEndDate.getTime())) {
                    const endX = xScale(baseEndDate);
                    const milestoneDrawSize = Math.max(4, Math.min(milestoneSizeSetting, taskHeight * 0.9));
                    const endGap = succIsMilestone ? (milestoneDrawSize / 2 + 3) : 3;

                    if (relType === 'FS' || relType === 'SS') return endX - endGap;
                    else return endX + endGap;
                }
                return 0;
            })
            .attr("cy", (rel: Relationship): number => {
                const succYOrder = taskPositions.get(rel.successorId);
                if (succYOrder === undefined) return 0;
                const succYBandPos = yScale(succYOrder.toString());
                if (succYBandPos === undefined) return 0;
                return succYBandPos + taskHeight / 2;
            });
    }

    private getLineDashArray(style: string): string {
        switch (style) {
            case "dashed": return "5,3";
            case "dotted": return "1,2";
            default: return "none";
        }
    }

    private getLatestFinishDate(allTasks: Task[], selector: (task: Task) => Date | null | undefined): Date | null {
        let latestFinishTimestamp: number | null = null;
        for (const task of allTasks) {
            const candidate = selector(task);
            if (candidate instanceof Date && !isNaN(candidate.getTime())) {
                const ts = candidate.getTime();
                if (latestFinishTimestamp === null || ts > latestFinishTimestamp) {
                    latestFinishTimestamp = ts;
                }
            }
        }
        return latestFinishTimestamp !== null ? new Date(latestFinishTimestamp) : null;
    }

    private drawFinishLine(config: {
        className: string;
        targetDate: Date | null;
        lineColor: string;
        lineWidth: number;
        lineStyle: string;
        showLabel: boolean;
        labelColor: string;
        labelFontSize: number;
        labelBackgroundColor: string;
        labelBackgroundOpacity: number;
        labelY: number;
        labelXOffset?: number;
        labelPosition?: string;
        labelFormatter?: (date: Date) => string;
        xScale: ScaleTime<number, number>;
        chartHeight: number;
        mainGridLayer: Selection<SVGGElement, unknown, null, undefined>;
        headerLayer: Selection<SVGGElement, unknown, null, undefined>;
    }): void {
        const {
            className, targetDate, lineColor, lineWidth, lineStyle, showLabel,
            labelColor, labelFontSize, labelBackgroundColor, labelBackgroundOpacity,
            labelY, labelXOffset = 5, labelPosition = "right", labelFormatter,
            xScale, chartHeight, mainGridLayer, headerLayer
        } = config;

        if (!mainGridLayer?.node() || !headerLayer?.node() || !xScale) { return; }

        mainGridLayer.select(`.${className}-line`).remove();
        headerLayer.selectAll(`.${className}-label-group`).remove();

        if (!(targetDate instanceof Date) || isNaN(targetDate.getTime())) { return; }

        const endX = xScale(targetDate);
        if (!isFinite(endX)) { console.warn(`Calculated ${className} line position is invalid:`, endX); return; }

        const lineDashArray = this.getLineDashArray(lineStyle);

        mainGridLayer.append("line")
            .attr("class", `${className}-line`)
            .attr("x1", endX).attr("y1", 0)
            .attr("x2", endX).attr("y2", chartHeight)
            .attr("stroke", lineColor)
            .attr("stroke-width", lineWidth)
            .attr("stroke-dasharray", lineDashArray)
            .attr("clip-path", "url(#chart-area-clip)")
            .style("pointer-events", "none");

        if (showLabel) {
            const labelText = labelFormatter ? labelFormatter(targetDate) : this.formatDate(targetDate);
            const sign = labelPosition === "left" ? -1 : 1;
            const anchor = labelPosition === "left" ? "end" : "start";
            const labelX = endX + (labelXOffset * sign);

            const labelGroup = headerLayer.append("g")
                .attr("class", `${className}-label-group`)
                .style("pointer-events", "none");

            const textElement = labelGroup.append("text")
                .attr("class", `${className}-label`)
                .attr("x", labelX)
                .attr("y", labelY)
                .attr("text-anchor", anchor)
                .style("fill", labelColor)
                .style("font-size", `${labelFontSize}pt`)
                .style("font-weight", "600")
                .text(labelText);

            if (labelBackgroundOpacity > 0) {
                const bbox = (textElement.node() as SVGTextElement)?.getBBox();
                if (bbox) {
                    const padding = { h: 4, v: 2 };
                    labelGroup.insert("rect", `.${className}-label`)
                        .attr("x", bbox.x - padding.h)
                        .attr("y", bbox.y - padding.v)
                        .attr("width", bbox.width + padding.h * 2)
                        .attr("height", bbox.height + padding.v * 2)
                        .attr("rx", 3)
                        .attr("ry", 3)
                        .style("fill", labelBackgroundColor)
                        .style("fill-opacity", labelBackgroundOpacity);
                }
            }
        }
    }

    private drawProjectEndLine(
        chartWidth: number,
        xScale: ScaleTime<number, number>,
        visibleTasks: Task[],
        allTasks: Task[],
        chartHeight: number,
        mainGridLayer: Selection<SVGGElement, unknown, null, undefined>,
        headerLayer: Selection<SVGGElement, unknown, null, undefined>
    ): void {
        if (!mainGridLayer?.node() || !headerLayer?.node() || !xScale) { return; }

        const settings = this.settings.projectEndLine;

        const lineColor = this.resolveColor(settings.lineColor.value.value, "foreground");
        const lineWidth = settings.lineWidth.value;
        const lineStyle = settings.lineStyle.value.value as string;

        const showLabel = settings.showLabel?.value ?? true;
        const labelColor = this.resolveColor(settings.labelColor?.value?.value ?? lineColor, "foreground");
        const labelFontSize = settings.labelFontSize?.value ?? this.settings.textAndLabels.fontSize.value;
        const showLabelPrefix = settings.showLabelPrefix?.value ?? true;
        const labelBackgroundColor = this.resolveColor(settings.labelBackgroundColor?.value?.value ?? "#FFFFFF", "background");
        const labelBackgroundTransparency = settings.labelBackgroundTransparency?.value ?? 0;
        const labelBackgroundOpacity = 1 - (labelBackgroundTransparency / 100);

        const latestFinishDate = settings.show.value
            ? this.getLatestFinishDate(allTasks, (t: Task) => t.finishDate)
            : null;

        this.drawFinishLine({
            className: "project-end",
            targetDate: latestFinishDate,
            lineColor,
            lineWidth,
            lineStyle,
            showLabel,
            labelColor,
            labelFontSize,
            labelBackgroundColor,
            labelBackgroundOpacity,
            labelPosition: settings.labelPosition?.value?.value as string,
            labelY: this.headerHeight - 12,
            labelFormatter: (d: Date) => showLabelPrefix ? `Finish: ${this.formatLineDate(d)}` : this.formatLineDate(d),
            xScale,
            chartHeight,
            mainGridLayer,
            headerLayer
        });
    }

    private drawDataDateLine(
        chartWidth: number,
        xScale: ScaleTime<number, number>,
        chartHeight: number,
        mainGridLayer: Selection<SVGGElement, unknown, null, undefined>,
        headerLayer: Selection<SVGGElement, unknown, null, undefined>
    ): void {
        if (!mainGridLayer?.node() || !headerLayer?.node() || !xScale) { return; }

        mainGridLayer.select(".data-date-line").remove();
        headerLayer.selectAll(".data-date-label-group").remove();

        if (!(this.dataDate instanceof Date) || isNaN(this.dataDate.getTime())) { return; }

        const settings = this.settings?.dataDateLine;
        if (!settings || !settings.show.value) return;

        const lineColor = this.resolveColor(settings.lineColor.value.value, "foreground");
        const lineWidth = settings.lineWidth.value;
        const lineStyle = settings.lineStyle.value.value;
        const showLabel = settings.showLabel?.value ?? true;
        const labelColor = this.resolveColor(settings.labelColor?.value?.value ?? lineColor, "foreground");
        const labelFontSize = settings.labelFontSize?.value ?? this.settings.textAndLabels.fontSize.value;
        const showLabelPrefix = settings.showLabelPrefix?.value ?? true;
        const labelBackgroundColor = this.resolveColor(settings.labelBackgroundColor?.value?.value ?? "#FFFFFF", "background");
        const labelBackgroundTransparency = settings.labelBackgroundTransparency?.value ?? 0;
        const labelBackgroundOpacity = 1 - (labelBackgroundTransparency / 100);

        let lineDashArray = "none";
        switch (lineStyle) { case "dashed": lineDashArray = "5,3"; break; case "dotted": lineDashArray = "1,2"; break; default: lineDashArray = "none"; }

        const dataDateX = xScale(this.dataDate);

        if (!isFinite(dataDateX) || dataDateX < 0 || dataDateX > chartWidth) { return; }

        const effectiveHeight = chartHeight > 0 ? chartHeight : (this.mainSvg ? (parseFloat(this.mainSvg.attr("height")) || 0) : 0);

        mainGridLayer.append("line")
            .attr("class", "data-date-line")
            .attr("x1", dataDateX).attr("y1", 0)
            .attr("x2", dataDateX).attr("y2", effectiveHeight)
            .attr("stroke", lineColor)
            .attr("stroke-width", lineWidth)
            .attr("stroke-dasharray", lineDashArray)
            .attr("clip-path", "url(#chart-area-clip)")
            .style("pointer-events", "none");

        if (this.useCanvasRendering && this.canvasContext) {
            const ctx = this.canvasContext;
            ctx.save();
            ctx.strokeStyle = lineColor;
            ctx.lineWidth = lineWidth;
            switch (lineStyle) {
                case "dashed": ctx.setLineDash([5, 3]); break;
                case "dotted": ctx.setLineDash([1, 2]); break;
                default: ctx.setLineDash([]); break;
            }
            ctx.beginPath();
            ctx.moveTo(dataDateX, 0);
            ctx.lineTo(dataDateX, effectiveHeight);
            ctx.stroke();
            ctx.restore();
        }

        if (showLabel) {
            const dataDateText = showLabelPrefix
                ? `Data Date: ${this.formatLineDate(this.dataDate)}`
                : this.formatLineDate(this.dataDate);

            const labelY = this.headerHeight - 26;
            const labelPosition = settings.labelPosition?.value?.value as string || "right";
            const sign = labelPosition === "left" ? -1 : 1;
            const anchor = labelPosition === "left" ? "end" : "start";
            const labelX = dataDateX + (5 * sign);

            const labelGroup = headerLayer.append("g")
                .attr("class", "data-date-label-group")
                .style("pointer-events", "none");

            const textElement = labelGroup.append("text")
                .attr("class", "data-date-label")
                .attr("x", labelX)
                .attr("y", labelY)
                .attr("text-anchor", anchor)
                .style("fill", labelColor)
                .style("font-size", labelFontSize + "pt")
                .style("font-weight", "600")
                .text(dataDateText);

            if (labelBackgroundOpacity > 0) {
                const bbox = (textElement.node() as SVGTextElement)?.getBBox();
                if (bbox) {
                    const padding = { h: 4, v: 2 };
                    labelGroup.insert("rect", ".data-date-label")
                        .attr("x", bbox.x - padding.h)
                        .attr("y", bbox.y - padding.v)
                        .attr("width", bbox.width + padding.h * 2)
                        .attr("height", bbox.height + padding.v * 2)
                        .attr("rx", 3)
                        .attr("ry", 3)
                        .style("fill", labelBackgroundColor)
                        .style("fill-opacity", labelBackgroundOpacity);
                }
            }
        }
    }

    private drawBaselineAndPreviousEndLines(
        xScale: ScaleTime<number, number>,
        allTasks: Task[],
        chartHeight: number,
        mainGridLayer: Selection<SVGGElement, unknown, null, undefined>,
        headerLayer: Selection<SVGGElement, unknown, null, undefined>
    ): void {
        if (!mainGridLayer?.node() || !headerLayer?.node() || !xScale) { return; }

        // Use the new separate baselineFinishLine card
        const baselineSettings = this.settings.baselineFinishLine;

        const baselineToggleOn = this.showBaselineInternal;
        const baselineShowSetting = baselineSettings.show?.value ?? false;
        const baselineTargetDate = (baselineToggleOn && baselineShowSetting)
            ? this.getLatestFinishDate(allTasks, (t: Task) => t.baselineFinishDate)
            : null;

        const baselineLineColor = this.resolveColor(this.settings.comparisonBars.baselineColor.value.value, "foreground");
        const baselineLineWidth = baselineSettings.lineWidth?.value ?? 1.5;
        const baselineLineStyle = (baselineSettings.lineStyle?.value?.value as string | undefined) ?? "dashed";
        const baselineShowLabel = (baselineSettings.showLabel?.value ?? true) && baselineToggleOn && baselineShowSetting;
        const baselineLabelColor = this.resolveColor(baselineSettings.labelColor?.value?.value ?? baselineLineColor, "foreground");
        const baselineLabelFontSize = baselineSettings.labelFontSize?.value ?? this.settings.textAndLabels.fontSize.value;
        const baselineShowLabelPrefix = baselineSettings.showLabelPrefix?.value ?? true;
        const baselineLabelBackgroundColor = this.resolveColor(baselineSettings.labelBackgroundColor?.value?.value ?? "#FFFFFF", "background");
        const baselineLabelBackgroundTransparency = baselineSettings.labelBackgroundTransparency?.value ?? 0;
        const baselineLabelBackgroundOpacity = 1 - (baselineLabelBackgroundTransparency / 100);

        this.drawFinishLine({
            className: "baseline-end",
            targetDate: baselineTargetDate,
            lineColor: baselineLineColor,
            lineWidth: baselineLineWidth,
            lineStyle: baselineLineStyle,
            showLabel: baselineShowLabel,
            labelColor: baselineLabelColor,
            labelFontSize: baselineLabelFontSize,
            labelBackgroundColor: baselineLabelBackgroundColor,
            labelBackgroundOpacity: baselineLabelBackgroundOpacity,
            labelPosition: baselineSettings.labelPosition?.value?.value as string,
            labelY: this.headerHeight - 36,
            labelFormatter: (d: Date) => baselineShowLabelPrefix ? `Baseline Finish: ${this.formatLineDate(d)}` : `Baseline: ${this.formatLineDate(d)}`,
            xScale,
            chartHeight,
            mainGridLayer,
            headerLayer
        });

        // Use the new separate previousUpdateFinishLine card
        const prevSettings = this.settings.previousUpdateFinishLine;

        const prevToggleOn = this.showPreviousUpdateInternal;
        const prevShowSetting = prevSettings.show?.value ?? false;
        const prevTargetDate = (prevToggleOn && prevShowSetting)
            ? this.getLatestFinishDate(allTasks, (t: Task) => t.previousUpdateFinishDate)
            : null;

        const prevLineColor = this.resolveColor(this.settings.comparisonBars.previousUpdateColor.value.value, "foreground");
        const prevLineWidth = prevSettings.lineWidth?.value ?? 1.5;
        const prevLineStyle = (prevSettings.lineStyle?.value?.value as string | undefined) ?? "dashed";
        const prevShowLabel = (prevSettings.showLabel?.value ?? true) && prevToggleOn && prevShowSetting;
        const prevLabelColor = this.resolveColor(prevSettings.labelColor?.value?.value ?? prevLineColor, "foreground");
        const prevLabelFontSize = prevSettings.labelFontSize?.value ?? this.settings.textAndLabels.fontSize.value;
        const prevShowLabelPrefix = prevSettings.showLabelPrefix?.value ?? true;
        const prevLabelBackgroundColor = this.resolveColor(prevSettings.labelBackgroundColor?.value?.value ?? "#FFFFFF", "background");
        const prevLabelBackgroundTransparency = prevSettings.labelBackgroundTransparency?.value ?? 0;
        const prevLabelBackgroundOpacity = 1 - (prevLabelBackgroundTransparency / 100);

        this.drawFinishLine({
            className: "previous-update-end",
            targetDate: prevTargetDate,
            lineColor: prevLineColor,
            lineWidth: prevLineWidth,
            lineStyle: prevLineStyle,
            showLabel: prevShowLabel,
            labelColor: prevLabelColor,
            labelFontSize: prevLabelFontSize,
            labelBackgroundColor: prevLabelBackgroundColor,
            labelBackgroundOpacity: prevLabelBackgroundOpacity,
            labelPosition: prevSettings.labelPosition?.value?.value as string,
            labelY: this.headerHeight - 50,
            labelFormatter: (d: Date) => prevShowLabelPrefix ? `Previous Finish: ${this.formatLineDate(d)}` : `Previous: ${this.formatLineDate(d)}`,
            xScale,
            chartHeight,
            mainGridLayer,
            headerLayer
        });
    }

    /**
     * Applies Float-Based criticality using user-provided Total Float values
     * Tasks are critical if Total Float ≤ 0, near-critical if 0 < Total Float ≤ threshold
     */
    private applyFloatBasedCriticality(): void {
        this.debugLog("Applying Float-Based criticality using Total Float values...");
        const startTime = performance.now();

        this.allDrivingChains = [];

        let criticalCount = 0;
        let nearCriticalCount = 0;

        for (const task of this.allTasksData) {
            if (task.userProvidedTotalFloat !== undefined && !isNaN(task.userProvidedTotalFloat)) {
                task.totalFloat = task.userProvidedTotalFloat;
                task.isCritical = task.totalFloat <= 0;
                task.isCriticalByFloat = task.isCritical;

                if (this.showNearCritical && !task.isCritical && this.floatThreshold > 0) {
                    task.isNearCritical = task.totalFloat > 0 && task.totalFloat <= this.floatThreshold;
                } else {
                    task.isNearCritical = false;
                }

                if (task.isCritical) criticalCount++;
                else if (task.isNearCritical) nearCriticalCount++;
            } else {

                task.totalFloat = Infinity;
                task.isCritical = false;
                task.isCriticalByFloat = false;
                task.isNearCritical = false;
            }

            task.isCriticalByRel = false;

            task.earlyStart = 0;
            task.earlyFinish = task.duration;
            task.lateStart = task.totalFloat === Infinity ? Infinity : 0;
            task.lateFinish = task.totalFloat === Infinity ? Infinity : task.duration;
        }

        for (const rel of this.relationships) {
            rel.isCritical = false;
            rel.isDriving = false;
        }

        this.updatePathInfoLabel();

        const endTime = performance.now();
        this.debugLog(`Float-Based criticality applied in ${(endTime - startTime).toFixed(2)}ms.`);
        this.debugLog(`Critical tasks (Total Float ≤ 0): ${criticalCount}, Near-critical tasks: ${nearCriticalCount}`);
    }

    /**
     * Identifies the longest path using P6 scheduled dates (reflective approach)
     */
    private identifyLongestPathFromP6(): void {
        this.debugLog("Starting P6 reflective longest path identification...");
        const startTime = performance.now();

        if (this.allTasksData.length === 0) {
            this.debugLog("No tasks for longest path identification.");
            return;
        }

        for (const task of this.allTasksData) {
            task.isCritical = false;
            task.isCriticalByFloat = false;
            task.isCriticalByRel = false;
            task.isNearCritical = false;
            task.totalFloat = Infinity;
        }

        this.identifyDrivingRelationships();

        const projectFinishTask = this.findProjectFinishTask();
        if (!projectFinishTask) {
            console.warn("Could not identify project finish task");
            return;
        }

        this.debugLog(`Project finish task: ${projectFinishTask.name} (${projectFinishTask.internalId})`);

        const drivingChains = this.findAllDrivingChainsToTask(projectFinishTask.internalId);

        this.allDrivingChains = this.sortAndStoreDrivingChains(drivingChains);

        const selectedChain = this.getSelectedDrivingChain();

        if (selectedChain) {

            for (const taskId of selectedChain.tasks) {
                const task = this.taskIdToTask.get(taskId);
                if (task) {
                    task.isCritical = true;
                    task.isCriticalByFloat = true;
                    task.totalFloat = 0;
                }
            }

            for (const rel of selectedChain.relationships) {
                rel.isCritical = true;
            }

            this.debugLog(`Selected driving path ${this.selectedPathIndex + 1}/${this.allDrivingChains.length}: ${selectedChain.tasks.size} tasks, duration ${selectedChain.totalDuration}`);
        }

        if (this.showNearCritical && this.floatThreshold > 0) {
            this.identifyNearCriticalTasks();
        }

        this.updatePathInfoLabel();

        const endTime = performance.now();
        this.debugLog(`P6 longest path completed in ${endTime - startTime}ms`);
    }

    /**
    /**
     * Identifies which relationships are driving based on minimum float
     */
    private identifyDrivingRelationships(): void {

        for (const rel of this.relationships) {
            const pred = this.taskIdToTask.get(rel.predecessorId);
            const succ = this.taskIdToTask.get(rel.successorId);

            if (!pred || !succ) {
                rel.relationshipFloat = Infinity;
                rel.isDriving = false;
                rel.isCritical = false;
                continue;
            }

            let relFloat: number;

            if (rel.freeFloat !== null && rel.freeFloat !== undefined) {
                relFloat = rel.freeFloat;
            } else {

                if (!pred.startDate || !pred.finishDate ||
                    !succ.startDate || !succ.finishDate) {
                    rel.relationshipFloat = Infinity;
                    rel.isDriving = false;
                    rel.isCritical = false;
                    continue;
                }

                const relType = rel.type || 'FS';
                const lag = rel.lag || 0;

                const predStart = pred.startDate.getTime() / 86400000;
                const predFinish = pred.finishDate.getTime() / 86400000;
                const succStart = succ.startDate.getTime() / 86400000;
                const succFinish = succ.finishDate.getTime() / 86400000;

                relFloat = 0;

                switch (relType) {
                    case 'FS': relFloat = succStart - (predFinish + lag); break;
                    case 'SS': relFloat = succStart - (predStart + lag); break;
                    case 'FF': relFloat = succFinish - (predFinish + lag); break;
                    case 'SF': relFloat = succFinish - (predStart + lag); break;
                }
            }

            rel.relationshipFloat = relFloat;
            rel.isDriving = false;
            rel.isCritical = false;
        }

        const successorGroups = new Map<string, Relationship[]>();
        for (const rel of this.relationships) {
            if (!successorGroups.has(rel.successorId)) {
                successorGroups.set(rel.successorId, []);
            }
            successorGroups.get(rel.successorId)!.push(rel);
        }

        for (const [successorId, rels] of successorGroups) {
            let minFloat = Infinity;
            for (const rel of rels) {
                const relFloat = rel.relationshipFloat ?? Infinity;
                if (relFloat < minFloat) {
                    minFloat = relFloat;
                }
            }

            for (const rel of rels) {
                const relFloat = rel.relationshipFloat ?? Infinity;
                if (Math.abs(relFloat - minFloat) <= this.floatTolerance) {
                    rel.isDriving = true;
                }
            }
        }

        const drivingCount = this.relationships.filter(r => r.isDriving).length;
        this.debugLog(`Identified ${drivingCount} driving relationships`);
    }

    /**
     * Finds the project finish task (latest finish date)
     */
    private findProjectFinishTask(): Task | null {
        let latestFinish: Date | null = null;
        let candidates: Task[] = [];

        for (const task of this.allTasksData) {
            if (!task.finishDate) continue;

            if (!latestFinish || task.finishDate > latestFinish) {
                latestFinish = task.finishDate;
                candidates = [task];
            } else if (Math.abs(task.finishDate.getTime() - latestFinish.getTime()) <= this.floatTolerance * 86400000) {
                candidates.push(task);
            }
        }

        if (candidates.length === 0) return null;
        if (candidates.length === 1) return candidates[0];
        let bestCandidate = candidates[0];
        let earliestStart = bestCandidate.startDate?.getTime() ?? Infinity;

        for (let i = 1; i < candidates.length; i++) {
            const candidate = candidates[i];
            const candidateStart = candidate.startDate?.getTime() ?? Infinity;

            if (candidateStart < earliestStart) {
                earliestStart = candidateStart;
                bestCandidate = candidate;
            }
        }

        this.debugLog(`Found ${candidates.length} tasks with latest finish date, selected ${bestCandidate.name} (earliest start)`);
        return bestCandidate;
    }

    /**
     * Finds all driving chains leading to a specific task
     * Uses recursive DFS with global visited set to prevent re-exploration
     */
    private findAllDrivingChainsToTask(targetTaskId: string): Array<{
        tasks: Set<string>,
        relationships: Relationship[],
        totalDuration: number,
        startingTask: Task | null
    }> {
        const chains: Array<{
            tasks: Set<string>,
            relationships: Relationship[],
            totalDuration: number,
            startingTask: Task | null
        }> = [];

        const visited = new Set<string>();
        const currentPath = new Set<string>();
        const currentRelationships: Relationship[] = [];

        const dfs = (taskId: string) => {
            if (visited.has(taskId)) return;

            visited.add(taskId);
            currentPath.add(taskId);

            const task = this.taskIdToTask.get(taskId);
            if (!task) {
                currentPath.delete(taskId);
                return;
            }

            const drivingPreds = this.relationships.filter(rel =>
                rel.successorId === taskId && rel.isDriving
            );

            if (drivingPreds.length === 0) {

                const chainTasks = new Set(currentPath);
                const chainRels = [...currentRelationships];

                let totalDuration = 0;
                chainTasks.forEach(tId => {
                    const t = this.taskIdToTask.get(tId);
                    if (t) totalDuration += t.duration;
                });

                chains.push({
                    tasks: chainTasks,
                    relationships: chainRels,
                    totalDuration: totalDuration,
                    startingTask: task
                });
            } else {
                for (const rel of drivingPreds) {
                    currentRelationships.push(rel);
                    dfs(rel.predecessorId);
                    currentRelationships.pop();
                }
            }

            currentPath.delete(taskId);
        };

        dfs(targetTaskId);

        if (chains.length === 0) {
            const task = this.taskIdToTask.get(targetTaskId);
            if (task) {
                chains.push({
                    tasks: new Set([targetTaskId]),
                    relationships: [],
                    totalDuration: task.duration,
                    startingTask: task
                });
            }
        }

        return chains;
    }
    /**
     * Selects the longest chain by total working duration
     */
    private selectLongestChain(chains: Array<{
        tasks: Set<string>,
        relationships: Relationship[],
        totalDuration: number
    }>): {
        tasks: Set<string>,
        relationships: Relationship[],
        totalDuration: number
    } | null {
        if (chains.length === 0) return null;
        chains.sort((a, b) => b.totalDuration - a.totalDuration);
        return chains[0];
    }

    /**
     * Sorts driving chains and stores them for multi-path toggle
     * Sorting: earliest start date first, then longest duration as tiebreaker
     */
    private sortAndStoreDrivingChains(chains: Array<{
        tasks: Set<string>,
        relationships: Relationship[],
        totalDuration: number,
        startingTask: Task | null
    }>): Array<{
        tasks: Set<string>,
        relationships: Relationship[],
        totalDuration: number,
        startingTask: Task | null
    }> {
        if (chains.length === 0) return [];

        const sortedChains = [...chains].sort((a, b) => {
            const aDate = a.startingTask?.startDate?.getTime() ?? Infinity;
            const bDate = b.startingTask?.startDate?.getTime() ?? Infinity;

            if (aDate < bDate) return -1;
            if (aDate > bDate) return 1;

            return b.totalDuration - a.totalDuration;
        });

        this.debugLog(`Found ${sortedChains.length} driving paths`);

        const logCount = Math.min(sortedChains.length, 5);
        for (let i = 0; i < logCount; i++) {
            const chain = sortedChains[i];
            this.debugLog(`  Path ${i + 1}: ${chain.tasks.size} tasks, ` +
                `${chain.totalDuration.toFixed(1)} days, ` +
                `starts ${this.formatDate(chain.startingTask?.startDate)}`);
        }
        if (sortedChains.length > 5) {
            this.debugLog(`  ... and ${sortedChains.length - 5} more paths`);
        }

        return sortedChains;
    }

    /**
     * Gets the currently selected driving chain based on settings
     * Validates index bounds to prevent errors when switching views
     */
    private getSelectedDrivingChain(): {
        tasks: Set<string>,
        relationships: Relationship[],
        totalDuration: number,
        startingTask: Task | null
    } | null {
        if (this.allDrivingChains.length === 0) return null;

        const settingsIndex = this.settings?.pathSelection?.selectedPathIndex?.value ?? 1;

        this.selectedPathIndex = Math.max(0, Math.min(settingsIndex - 1, this.allDrivingChains.length - 1));

        const multiPathEnabled = this.settings?.pathSelection?.enableMultiPathToggle?.value ?? true;

        if (!multiPathEnabled) {
            this.selectedPathIndex = 0;
        }

        this.debugLog(`[Path Selection] Index: ${this.selectedPathIndex + 1}/${this.allDrivingChains.length}, ` +
            `Multi-path: ${multiPathEnabled ? 'enabled' : 'disabled'}`);

        return this.allDrivingChains[this.selectedPathIndex];
    }

    /**
     * Updates the path information label display with interactive navigation
     * Professional navigation buttons with enhanced design and smooth animations
     * Shows "Path 1/1" even with single path so users understand there's only one driving path
     */
    private updatePathInfoLabel(): void {
        if (!this.pathInfoLabel) return;

        const showPathInfo = this.settings?.pathSelection?.showPathInfo?.value ?? true;
        const multiPathEnabled = this.settings?.pathSelection?.enableMultiPathToggle?.value ?? true;

        const mode = this.settings?.criticalPath?.calculationMode?.value?.value ?? 'longestPath';
        const hasMultiplePaths = this.allDrivingChains.length > 1;
        const hasAnyPaths = this.allDrivingChains.length > 0;

        if (!showPathInfo || mode !== 'longestPath' || !hasAnyPaths || !multiPathEnabled) {
            this.pathInfoLabel.style("display", "none");
            return;
        }

        const currentChain = this.allDrivingChains[this.selectedPathIndex];
        if (!currentChain) {
            this.pathInfoLabel.style("display", "none");
            return;
        }

        const viewportWidth = this.lastUpdateOptions?.viewport?.width || 800;
        const layoutMode = this.getLayoutMode(viewportWidth);
        const isCompact = layoutMode === 'narrow';
        const isMedium = layoutMode === 'medium';

        this.pathInfoLabel
            .style("padding", isCompact ? `0 ${this.UI_TOKENS.spacing.xs}px` : `0 ${this.UI_TOKENS.spacing.sm}px`)
            .style("gap", isCompact ? `${this.UI_TOKENS.spacing.xs}px` : `${this.UI_TOKENS.spacing.sm}px`);

        this.pathInfoLabel.selectAll("*").remove();

        const pathNumber = this.selectedPathIndex + 1;
        const totalPaths = this.allDrivingChains.length;
        const duration = currentChain.totalDuration.toFixed(1);
        const taskCount = currentChain.tasks.size;

        const buttonOpacity = hasMultiplePaths ? "1" : "0.35";
        const buttonCursor = hasMultiplePaths ? "pointer" : "default";
        const buttonTitle = hasMultiplePaths ? "Previous driving path" : "Only one driving path";

        const prevButton = this.pathInfoLabel.append("div")
            .style("cursor", buttonCursor)
            .style("opacity", buttonOpacity)
            .style("padding", "4px")
            .style("border-radius", `${this.UI_TOKENS.radius.small}px`)
            .style("display", "flex")
            .style("align-items", "center")
            .style("justify-content", "center")
            .style("transition", `all ${this.UI_TOKENS.motion.duration.fast}ms ${this.UI_TOKENS.motion.easing.smooth}`)
            .style("user-select", "none")
            .style("width", "22px")
            .style("height", "22px")
            .attr("title", buttonTitle);

        const prevSvg = prevButton.append("svg")
            .attr("width", "12")
            .attr("height", "12")
            .attr("viewBox", "0 0 12 12");

        prevSvg.append("path")
            .attr("d", "M 8 2 L 4 6 L 8 10")
            .attr("stroke", this.UI_TOKENS.color.primary.default)
            .attr("stroke-width", "2")
            .attr("stroke-linecap", "round")
            .attr("stroke-linejoin", "round")
            .attr("fill", "none");

        const self = this;

        if (hasMultiplePaths) {
            prevButton
                .on("mouseover", function () {
                    d3.select(this)
                        .style("background-color", self.UI_TOKENS.color.primary.light)
                        .style("transform", "scale(1.1)");
                })
                .on("mouseout", function () {
                    d3.select(this)
                        .style("background-color", "transparent")
                        .style("transform", "scale(1)");
                })
                .on("mousedown", function () {
                    d3.select(this).style("transform", "scale(0.95)");
                })
                .on("mouseup", function () {
                    d3.select(this).style("transform", "scale(1.1)");
                });

            prevButton.on("click", function (event) {
                event.stopPropagation();
                self.navigateToPreviousPath();
            });
        }

        const infoContainer = this.pathInfoLabel.append("div")
            .style("display", "flex")
            .style("align-items", "center")
            .style("gap", isCompact ? `${this.UI_TOKENS.spacing.xs}px` : `${this.UI_TOKENS.spacing.sm}px`)
            .style("padding", isCompact ? "0 1px" : "0 4px")
            .style("font-size", `${this.UI_TOKENS.fontSize.sm}px`);

        infoContainer.append("span")
            .style("font-weight", "700")
            .style("letter-spacing", "0.15px")
            .text(isCompact ? `${pathNumber}/${totalPaths}` : `Path ${pathNumber}/${totalPaths}`);

        if (!isCompact) {
            infoContainer.append("span")
                .style("color", this.UI_TOKENS.color.primary.default)
                .style("font-weight", "600")
                .text("|");

            infoContainer.append("span")
                .style("font-weight", "500")
                .text(`${taskCount} tasks`);

            if (!isMedium) {
                infoContainer.append("span")
                    .style("color", this.UI_TOKENS.color.primary.default)
                    .style("font-weight", "600")
                    .text("|");

                infoContainer.append("span")
                    .style("font-weight", "500")
                    .text(`${duration} days`);
            }
        }

        const nextButtonTitle = hasMultiplePaths ? "Next driving path" : "Only one driving path";
        const nextButton = this.pathInfoLabel.append("div")
            .style("cursor", buttonCursor)
            .style("opacity", buttonOpacity)
            .style("padding", "4px")
            .style("border-radius", `${this.UI_TOKENS.radius.small}px`)
            .style("display", "flex")
            .style("align-items", "center")
            .style("justify-content", "center")
            .style("transition", `all ${this.UI_TOKENS.motion.duration.fast}ms ${this.UI_TOKENS.motion.easing.smooth}`)
            .style("user-select", "none")
            .style("width", "22px")
            .style("height", "22px")
            .attr("title", nextButtonTitle);

        const nextSvg = nextButton.append("svg")
            .attr("width", "12")
            .attr("height", "12")
            .attr("viewBox", "0 0 12 12");

        nextSvg.append("path")
            .attr("d", "M 4 2 L 8 6 L 4 10")
            .attr("stroke", this.UI_TOKENS.color.primary.default)
            .attr("stroke-width", "2")
            .attr("stroke-linecap", "round")
            .attr("stroke-linejoin", "round")
            .attr("fill", "none");

        if (hasMultiplePaths) {
            nextButton
                .on("mouseover", function () {
                    d3.select(this)
                        .style("background-color", self.UI_TOKENS.color.primary.light)
                        .style("transform", "scale(1.1)");
                })
                .on("mouseout", function () {
                    d3.select(this)
                        .style("background-color", "transparent")
                        .style("transform", "scale(1)");
                })
                .on("mousedown", function () {
                    d3.select(this).style("transform", "scale(0.95)");
                })
                .on("mouseup", function () {
                    d3.select(this).style("transform", "scale(1.1)");
                });

            nextButton.on("click", function (event) {
                event.stopPropagation();
                self.navigateToNextPath();
            });
        }

        this.pathInfoLabel.style("display", "flex");
    }

    /**
     * Navigate to the previous driving path
     * Provides feedback when navigation is not possible
     */
    private navigateToPreviousPath(): void {

        if (this.allDrivingChains.length === 0) {
            this.debugLog("[Path Navigation] No driving chains available");
            return;
        }

        if (this.allDrivingChains.length === 1) {
            this.debugLog("[Path Navigation] Only one path exists - navigation disabled");
            this.showPathNavigationFeedback("Only one driving path exists");
            return;
        }

        this.selectedPathIndex = this.selectedPathIndex === 0
            ? this.allDrivingChains.length - 1
            : this.selectedPathIndex - 1;

        this.debugLog(`[Path Navigation] Switched to path ${this.selectedPathIndex + 1}/${this.allDrivingChains.length}`);

        this.persistPathSelection();

        this.identifyLongestPathFromP6();

        this.forceFullUpdate = true;
        if (this.lastUpdateOptions) {
            this.update(this.lastUpdateOptions);
        }
    }

    /**
     * Navigate to the next driving path
     * Provides feedback when navigation is not possible
     */
    private navigateToNextPath(): void {

        if (this.allDrivingChains.length === 0) {
            this.debugLog("[Path Navigation] No driving chains available");
            return;
        }

        if (this.allDrivingChains.length === 1) {
            this.debugLog("[Path Navigation] Only one path exists - navigation disabled");
            this.showPathNavigationFeedback("Only one driving path exists");
            return;
        }

        this.selectedPathIndex = (this.selectedPathIndex + 1) % this.allDrivingChains.length;

        this.debugLog(`[Path Navigation] Switched to path ${this.selectedPathIndex + 1}/${this.allDrivingChains.length}`);

        this.persistPathSelection();

        this.identifyLongestPathFromP6();

        this.forceFullUpdate = true;
        if (this.lastUpdateOptions) {
            this.update(this.lastUpdateOptions);
        }
    }

    /**
     * Helper method for user feedback when navigation not possible
     * Shows a brief message in the path info label
     */
    private showPathNavigationFeedback(message: string): void {
        if (this.pathInfoLabel) {

            const originalDisplay = this.pathInfoLabel.style("display");

            this.pathInfoLabel
                .style("display", "flex")
                .selectAll("*").remove();

            this.pathInfoLabel.append("span")
                .style("color", this.UI_TOKENS.color.warning?.default || "#C87800")
                .style("font-weight", "500")
                .style("font-size", `${this.UI_TOKENS.fontSize.sm}px`)
                .text(message);

            setTimeout(() => {
                this.pathInfoLabel.style("display", originalDisplay);
                this.updatePathInfoLabel();
            }, 2000);
        }
    }

    /**
     * Persist the selected path index to settings
     */
    private persistPathSelection(): void {
        try {
            const pathIndex1Based = this.selectedPathIndex + 1;

            if (this.settings?.pathSelection?.selectedPathIndex) {
                this.settings.pathSelection.selectedPathIndex.value = pathIndex1Based;
            }

            this.host.persistProperties({
                merge: [{
                    objectName: "pathSelection",
                    properties: { selectedPathIndex: pathIndex1Based },
                    selector: null
                }]
            });

            this.debugLog(`[Path Selection] Persisted path index: ${pathIndex1Based}`);
        } catch (error) {
            console.error("Error persisting path selection:", error);
        }
    }

    private identifyNearCriticalTasks(): void {

        if (this.floatThreshold <= 0) {
            this.debugLog("Float threshold is 0, skipping near-critical identification");
            return;
        }

        const predecessorToSuccessorMinFloat = new Map<string, Map<string, number>>();
        for (const rel of this.relationships) {
            const relFloat = (rel as any).relationshipFloat ?? Infinity;
            let successorMap = predecessorToSuccessorMinFloat.get(rel.predecessorId);
            if (!successorMap) {
                successorMap = new Map<string, number>();
                predecessorToSuccessorMinFloat.set(rel.predecessorId, successorMap);
            }
            const currentMin = successorMap.get(rel.successorId) ?? Infinity;
            if (relFloat < currentMin) {
                successorMap.set(rel.successorId, relFloat);
            }
        }

        this.allTasksData.forEach(task => {
            if (task.isCritical) return;

            let minFloatToCritical = Infinity;
            const visited = new Set<string>();
            const queue: Array<{ taskId: string, accumulatedFloat: number }> = [
                { taskId: task.internalId, accumulatedFloat: 0 }
            ];

            while (queue.length > 0) {
                const { taskId, accumulatedFloat } = queue.shift()!;

                if (visited.has(taskId)) continue;
                visited.add(taskId);

                const currentTask = this.taskIdToTask.get(taskId);
                if (!currentTask) continue;

                if (currentTask.isCritical) {
                    minFloatToCritical = Math.min(minFloatToCritical, accumulatedFloat);
                    continue;
                }

                const successorFloats = predecessorToSuccessorMinFloat.get(taskId);
                if (!successorFloats) {
                    continue;
                }

                for (const [succId, minFloat] of successorFloats) {
                    const floatToAdd = Math.max(0, minFloat);
                    queue.push({
                        taskId: succId,
                        accumulatedFloat: accumulatedFloat + floatToAdd
                    });
                }
            }

            if (minFloatToCritical <= this.floatThreshold) {
                task.isNearCritical = true;
                task.totalFloat = minFloatToCritical;
            }
        });
    }

    /**
     * Calculates CPM backward to a selected target task
     * Populates allDrivingChains for multi-path support
     */
    private calculateCPMToTask(targetTaskId: string | null): void {
        this.debugLog(`Calculating P6 driving path to task: ${targetTaskId || "None"}`);

        if (!targetTaskId) {
            this.identifyLongestPathFromP6();
            return;
        }

        const targetTask = this.taskIdToTask.get(targetTaskId);
        if (!targetTask) {
            console.warn(`Target task ${targetTaskId} not found.`);
            this.identifyLongestPathFromP6();
            return;
        }

        for (const task of this.allTasksData) {
            task.isCritical = false;
            task.isCriticalByFloat = false;
            task.isCriticalByRel = false;
            task.isNearCritical = false;
            task.totalFloat = Infinity;
        }

        this.identifyDrivingRelationships();

        const chains = this.findAllDrivingChainsToTask(targetTaskId);

        this.allDrivingChains = [...chains].sort((a, b) => {
            const aDate = a.startingTask?.startDate?.getTime() ?? Infinity;
            const bDate = b.startingTask?.startDate?.getTime() ?? Infinity;

            if (aDate < bDate) return -1;
            if (aDate > bDate) return 1;

            return b.totalDuration - a.totalDuration;
        });

        if (this.selectedPathIndex >= this.allDrivingChains.length) {
            this.selectedPathIndex = 0;
        }

        const selectedChain = this.getSelectedDrivingChain();

        if (selectedChain) {

            for (const taskId of selectedChain.tasks) {
                const task = this.taskIdToTask.get(taskId);
                if (task) {
                    task.isCritical = true;
                    task.isCriticalByFloat = true;
                    task.totalFloat = 0;
                }
            }

            for (const rel of selectedChain.relationships) {
                rel.isCritical = true;
            }

            this.debugLog(`P6 path to ${targetTaskId}: ${selectedChain.tasks.size} tasks, ` +
                `${this.allDrivingChains.length} total paths, ` +
                `starting ${this.formatDate(selectedChain.startingTask?.startDate)}`);
        }

        targetTask.isCritical = true;
        targetTask.isCriticalByFloat = true;

        this.updatePathInfoLabel();
    }

    /**
     * Calculates CPM forward from a selected source task to the latest finish date
     * Uses recursive DFS with global visited set
     */
    private calculateCPMFromTask(sourceTaskId: string | null): void {
        this.debugLog(`Calculating driving path from task: ${sourceTaskId || "None"} to the latest finish date.`);

        if (!sourceTaskId) {
            this.identifyLongestPathFromP6();
            return;
        }

        const sourceTask = this.taskIdToTask.get(sourceTaskId);
        if (!sourceTask) {
            console.warn(`Source task ${sourceTaskId} not found.`);
            this.identifyLongestPathFromP6();
            return;
        }

        for (const task of this.allTasksData) {
            task.isCritical = false;
            task.isCriticalByFloat = false;
            task.isCriticalByRel = false;
            task.isNearCritical = false;
            task.totalFloat = Infinity;
        }

        this.identifyDrivingRelationships();

        const completedChains: Array<{
            tasks: Set<string>,
            relationships: Relationship[],
            totalDuration: number,
            endingTask: Task | null
        }> = [];

        const visited = new Set<string>();
        const currentPath = new Set<string>();
        const currentRelationships: Relationship[] = [];

        const dfs = (taskId: string, currentDuration: number) => {
            if (visited.has(taskId)) return;

            visited.add(taskId);
            currentPath.add(taskId);

            const task = this.taskIdToTask.get(taskId);
            if (!task) {
                currentPath.delete(taskId);
                return;
            }

            const taskDuration = currentDuration + task.duration;

            const drivingSuccs = this.relationships.filter(rel =>
                rel.predecessorId === taskId && rel.isDriving
            );

            if (drivingSuccs.length === 0) {

                completedChains.push({
                    tasks: new Set(currentPath),
                    relationships: [...currentRelationships],
                    totalDuration: taskDuration,
                    endingTask: task
                });
            } else {
                for (const rel of drivingSuccs) {
                    currentRelationships.push(rel);
                    dfs(rel.successorId, taskDuration);
                    currentRelationships.pop();
                }
            }

            currentPath.delete(taskId);
        };

        currentPath.add(sourceTaskId);
        visited.add(sourceTaskId);

        const drivingSuccs = this.relationships.filter(rel =>
            rel.predecessorId === sourceTaskId && rel.isDriving
        );

        if (drivingSuccs.length === 0) {

            completedChains.push({
                tasks: new Set([sourceTaskId]),
                relationships: [],
                totalDuration: sourceTask.duration,
                endingTask: sourceTask
            });
        } else {
            for (const rel of drivingSuccs) {
                currentRelationships.push(rel);
                dfs(rel.successorId, sourceTask.duration);
                currentRelationships.pop();
            }
        }

        this.allDrivingChains = completedChains.map(c => ({
            tasks: c.tasks,
            relationships: c.relationships,
            totalDuration: c.totalDuration,
            startingTask: sourceTask
        }));

        this.allDrivingChains.sort((a, b) => {

            const aEndTask = completedChains.find(c => c.tasks === a.tasks)?.endingTask;
            const bEndTask = completedChains.find(c => c.tasks === b.tasks)?.endingTask;

            const aDate = aEndTask?.finishDate?.getTime() ?? -Infinity;
            const bDate = bEndTask?.finishDate?.getTime() ?? -Infinity;

            if (aDate > bDate) return -1;
            if (aDate < bDate) return 1;

            return b.totalDuration - a.totalDuration;
        });

        if (this.selectedPathIndex >= this.allDrivingChains.length) {
            this.selectedPathIndex = 0;
        }

        const selectedChain = this.getSelectedDrivingChain();

        if (selectedChain) {

            for (const taskId of selectedChain.tasks) {
                const task = this.taskIdToTask.get(taskId);
                if (task) {
                    task.isCritical = true;
                    task.isCriticalByFloat = true;
                    task.totalFloat = 0;
                }
            }

            for (const rel of selectedChain.relationships) {
                rel.isCritical = true;
            }

            this.debugLog(`Forward path from ${sourceTaskId}: ${selectedChain.tasks.size} tasks, ` +
                `${this.allDrivingChains.length} chains found`);
        } else {

            sourceTask.isCritical = true;
            sourceTask.isCriticalByFloat = true;
            this.debugLog(`No forward driving path from ${sourceTaskId}. Task marked as critical endpoint.`);
        }

        this.updatePathInfoLabel();
    }

    /**
     * Traces backward from a target task to find all predecessor tasks (Float-Based mode)
     */
    private identifyPredecessorTasksFloatBased(targetTaskId: string): Set<string> {
        const tasksInPath = new Set<string>();
        tasksInPath.add(targetTaskId);

        const queue: string[] = [targetTaskId];
        const visited = new Set<string>();
        visited.add(targetTaskId);

        const MAX_TASKS = 10000;
        const MAX_ITERATIONS = 50000;
        let iterations = 0;

        while (queue.length > 0 && iterations < MAX_ITERATIONS) {
            iterations++;

            if (tasksInPath.size > MAX_TASKS) {
                console.warn(`Backward trace from ${targetTaskId} hit task limit (${MAX_TASKS}). Stopping to prevent memory exhaustion.`);
                break;
            }

            const currentTaskId = queue.shift()!;
            const task = this.taskIdToTask.get(currentTaskId);
            if (!task) continue;

            for (const predId of task.predecessorIds) {
                if (!visited.has(predId)) {
                    const predecessor = this.taskIdToTask.get(predId);
                    if (!predecessor) continue;

                    tasksInPath.add(predId);
                    visited.add(predId);
                    queue.push(predId);
                }
            }
        }

        if (iterations >= MAX_ITERATIONS) {
            console.warn(`Backward trace from ${targetTaskId} hit iteration limit (${MAX_ITERATIONS}). Network may contain cycles or be extremely large.`);
        }

        this.debugLog(`Float-Based backward trace from ${targetTaskId}: found ${tasksInPath.size} tasks in ${iterations} iterations`);
        return tasksInPath;
    }

    /**
     * Traces forward from a source task to find all successor tasks (Float-Based mode)
     * OPTIMIZED: Added safety limits to prevent memory exhaustion
     */
    private identifySuccessorTasksFloatBased(sourceTaskId: string): Set<string> {
        const tasksInPath = new Set<string>();
        tasksInPath.add(sourceTaskId);

        const queue: string[] = [sourceTaskId];
        const visited = new Set<string>();
        visited.add(sourceTaskId);

        const MAX_TASKS = 10000;
        const MAX_ITERATIONS = 50000;
        let iterations = 0;

        while (queue.length > 0 && iterations < MAX_ITERATIONS) {
            iterations++;

            if (tasksInPath.size > MAX_TASKS) {
                console.warn(`Forward trace from ${sourceTaskId} hit task limit (${MAX_TASKS}). Stopping to prevent memory exhaustion.`);
                break;
            }

            const currentTaskId = queue.shift()!;

            const successorIds = this.predecessorIndex.get(currentTaskId) || new Set();

            for (const succId of successorIds) {
                if (!visited.has(succId)) {
                    const successor = this.taskIdToTask.get(succId);
                    if (!successor) continue;

                    tasksInPath.add(succId);
                    visited.add(succId);
                    queue.push(succId);
                }
            }
        }

        if (iterations >= MAX_ITERATIONS) {
            console.warn(`Forward trace from ${sourceTaskId} hit iteration limit (${MAX_ITERATIONS}). Network may contain cycles or be extremely large.`);
        }

        this.debugLog(`Float-Based forward trace from ${sourceTaskId}: found ${tasksInPath.size} tasks in ${iterations} iterations`);
        return tasksInPath;
    }

    /**
     * Extracts and validates task ID from a data row
     */
    private extractTaskId(row: any[]): string | null {
        const idIdx = this.getColumnIndex(this.lastUpdateOptions?.dataViews[0], 'taskId');
        if (idIdx === -1) return null;

        const rawTaskId = row[idIdx];
        if (rawTaskId == null || (typeof rawTaskId !== 'string' && typeof rawTaskId !== 'number')) {
            return null;
        }

        const taskIdStr = String(rawTaskId).trim();
        return taskIdStr === '' ? null : taskIdStr;
    }

    /**
     * Extracts predecessor ID from a data row
     */
    private extractPredecessorId(row: any[]): string | null {
        const predIdIdx = this.getColumnIndex(this.lastUpdateOptions?.dataViews[0], 'predecessorId');
        if (predIdIdx === -1) return null;

        const rawPredId = row[predIdIdx];
        if (rawPredId == null || (typeof rawPredId !== 'string' && typeof rawPredId !== 'number')) {
            return null;
        }

        const predIdStr = String(rawPredId).trim();
        return predIdStr === '' ? null : predIdStr;
    }

    private createTaskFromRow(row: any[], rowIndex: number): Task | null {
        const dataView = this.lastUpdateOptions?.dataViews?.[0];
        if (!dataView) return null;

        const taskId = this.extractTaskId(row);
        if (!taskId) return null;

        const nameIdx = this.getColumnIndex(dataView, 'taskName');
        const typeIdx = this.getColumnIndex(dataView, 'taskType');
        const durationIdx = this.getColumnIndex(dataView, 'duration');
        const startDateIdx = this.getColumnIndex(dataView, 'startDate');
        const finishDateIdx = this.getColumnIndex(dataView, 'finishDate');
        const totalFloatIdx = this.getColumnIndex(dataView, 'taskTotalFloat');
        const taskFreeFloatIdx = this.getColumnIndex(dataView, 'taskFreeFloat');
        const baselineStartDateIdx = this.getColumnIndex(dataView, 'baselineStartDate');
        const baselineFinishDateIdx = this.getColumnIndex(dataView, 'baselineFinishDate');
        const previousUpdateStartDateIdx = this.getColumnIndex(dataView, 'previousUpdateStartDate');
        const previousUpdateFinishDateIdx = this.getColumnIndex(dataView, 'previousUpdateFinishDate');

        const taskName = (nameIdx !== -1 && row[nameIdx] != null)
            ? String(row[nameIdx]).trim()
            : `Task ${taskId}`;

        const taskType = (typeIdx !== -1 && row[typeIdx] != null)
            ? String(row[typeIdx]).trim()
            : 'TT_Task';

        let duration = 0;
        if (durationIdx !== -1 && row[durationIdx] != null) {
            const parsedDuration = Number(row[durationIdx]);
            if (!isNaN(parsedDuration) && isFinite(parsedDuration)) {
                duration = parsedDuration;
            }
        }
        if (taskType === 'TT_Mile' || taskType === 'TT_FinMile') {
            duration = 0;
        }
        duration = Math.max(0, duration);

        let userProvidedTotalFloat: number | undefined = undefined;
        if (totalFloatIdx !== -1 && row[totalFloatIdx] != null) {
            const parsedFloat = Number(row[totalFloatIdx]);
            if (!isNaN(parsedFloat) && isFinite(parsedFloat)) {
                userProvidedTotalFloat = parsedFloat;
            }
        }

        let taskFreeFloat: number | undefined = undefined;
        if (taskFreeFloatIdx !== -1 && row[taskFreeFloatIdx] != null) {
            const parsedFloat = Number(row[taskFreeFloatIdx]);
            if (!isNaN(parsedFloat) && isFinite(parsedFloat)) {
                taskFreeFloat = parsedFloat;
            }
        }

        const startDate = (startDateIdx !== -1 && row[startDateIdx] != null)
            ? this.parseDate(row[startDateIdx])
            : null;
        const finishDate = (finishDateIdx !== -1 && row[finishDateIdx] != null)
            ? this.parseDate(row[finishDateIdx])
            : null;

        const baselineStartDate = (baselineStartDateIdx !== -1 && row[baselineStartDateIdx] != null)
            ? this.parseDate(row[baselineStartDateIdx])
            : null;
        const baselineFinishDate = (baselineFinishDateIdx !== -1 && row[baselineFinishDateIdx] != null)
            ? this.parseDate(row[baselineFinishDateIdx])
            : null;

        const previousUpdateStartDate = (previousUpdateStartDateIdx !== -1 && row[previousUpdateStartDateIdx] != null)
            ? this.parseDate(row[previousUpdateStartDateIdx])
            : null;
        const previousUpdateFinishDate = (previousUpdateFinishDateIdx !== -1 && row[previousUpdateFinishDateIdx] != null)
            ? this.parseDate(row[previousUpdateFinishDateIdx])
            : null;

        const legendIdx = this.getColumnIndex(dataView, 'legend');
        const legendValue = (legendIdx !== -1 && row[legendIdx] != null)
            ? String(row[legendIdx])
            : undefined;

        const wbsLevels: string[] = [];
        for (const colIdx of this.wbsLevelColumnIndices) {
            if (colIdx !== -1 && row[colIdx] != null) {
                const value = String(row[colIdx]).trim();
                if (value) {
                    wbsLevels.push(value);
                }
            }
        }

        const tooltipData = this.extractTooltipData(row, dataView);

        const safeRowIndex = rowIndex >= 0 ? rowIndex : 0;
        const selectionId = dataView.table
            ? this.host.createSelectionIdBuilder().withTable(dataView.table, safeRowIndex).createSelectionId()
            : undefined;

        const task: Task = {
            id: row[this.getColumnIndex(dataView, 'taskId')],
            internalId: taskId,
            name: taskName,
            type: taskType,
            duration: duration,
            userProvidedTotalFloat: userProvidedTotalFloat,
            taskFreeFloat: taskFreeFloat,
            predecessorIds: [],
            predecessors: [],
            successors: [],
            relationshipTypes: {},
            relationshipLags: {},
            earlyStart: 0,
            earlyFinish: duration,
            lateStart: Infinity,
            lateFinish: Infinity,
            totalFloat: Infinity,
            isCritical: false,
            isCriticalByFloat: false,
            isCriticalByRel: false,
            startDate: startDate,
            finishDate: finishDate,
            baselineStartDate: baselineStartDate,
            baselineFinishDate: baselineFinishDate,
            previousUpdateStartDate: previousUpdateStartDate,
            previousUpdateFinishDate: previousUpdateFinishDate,
            tooltipData: tooltipData,
            selectionId: selectionId,
            legendValue: legendValue,
            wbsLevels: wbsLevels.length > 0 ? wbsLevels : undefined
        };

        return task;
    }

    /**
     * Extracts tooltip data from a row
     */
    private extractTooltipData(row: any[], dataView: DataView): Array<{ key: string, value: PrimitiveValue }> | undefined {
        const columns = dataView.metadata?.columns;
        if (!columns) return undefined;

        const tooltipColumns: Array<{ column: any, rowIndex: number }> = [];

        columns.forEach((column, index) => {
            if (column.roles?.tooltip) {

                if (index === 0 || !this.tooltipDebugLogged) {
                    this.debugLog(`Tooltip column: ${column.displayName}, index: ${column.index}, queryName: ${column.queryName}`);
                }
                tooltipColumns.push({
                    column: column,
                    rowIndex: index
                });
            }
        });

        this.tooltipDebugLogged = true;

        tooltipColumns.sort((a, b) => {
            const aQuery = a.column.queryName || '';
            const bQuery = b.column.queryName || '';

            const aMatch = aQuery.match(/\.tooltip\.(\d+)$/);
            const bMatch = bQuery.match(/\.tooltip\.(\d+)$/);

            if (aMatch && bMatch) {
                return parseInt(aMatch[1]) - parseInt(bMatch[1]);
            }

            if (a.column.index !== undefined && b.column.index !== undefined) {
                return a.column.index - b.column.index;
            }

            return a.rowIndex - b.rowIndex;
        });

        const tooltipData: Array<{ key: string, value: PrimitiveValue }> = [];

        for (const item of tooltipColumns) {
            const value = row[item.rowIndex];
            if (value !== null && value !== undefined) {

                if (item.column.type?.dateTime || this.mightBeDate(value)) {
                    const parsedDate = this.parseDate(value);
                    if (parsedDate) {
                        tooltipData.push({
                            key: item.column.displayName || `Field ${item.rowIndex}`,
                            value: parsedDate
                        });
                        continue;
                    }
                }

                tooltipData.push({
                    key: item.column.displayName || `Field ${item.rowIndex}`,
                    value: value
                });
            }
        }

        return tooltipData.length > 0 ? tooltipData : undefined;
    }

    private transformDataOptimized(dataView: DataView): void {
        this.debugLog("Transforming data with enhanced optimization...");
        const startTime = performance.now();

        this.allTasksData = [];
        this.relationships = [];
        this.taskIdToTask.clear();
        this.predecessorIndex.clear();
        this.relationshipIndex.clear();
        this.relationshipByPredecessor.clear();
        this.dataDate = null;

        if (!dataView.table?.rows || !dataView.metadata?.columns) {
            console.error("Data transformation failed: No table data or columns found.");
            return;
        }

        const rows = dataView.table.rows;
        const columns = dataView.metadata.columns;

        const idIdx = this.getColumnIndex(dataView, "taskId");
        if (idIdx !== -1) {
            this.taskIdQueryName = dataView.metadata.columns[idIdx].queryName || null;
            const match = this.taskIdQueryName
                ? this.taskIdQueryName.match(/([^\[]+)\[([^\]]+)\]/)
                : null;
            if (match) {
                this.taskIdTable = match[1];
                this.taskIdColumn = match[2];
            } else if (this.taskIdQueryName) {
                const parts = this.taskIdQueryName.split(".");
                this.taskIdTable = parts.length > 1 ? parts[0] : null;
                this.taskIdColumn = parts[parts.length - 1];
            } else {
                this.taskIdTable = null;
                this.taskIdColumn = null;
            }
        }

        const predIdIdx = this.getColumnIndex(dataView, "predecessorId");
        const relTypeIdx = this.getColumnIndex(dataView, "relationshipType");
        const relLagIdx = this.getColumnIndex(dataView, "relationshipLag");
        const relFreeFloatIdx = this.getColumnIndex(dataView, "relationshipFreeFloat");
        const dataDateIdx = this.getColumnIndex(dataView, "dataDate");

        if (idIdx === -1) {
            console.error("Data transformation failed: Missing Task ID column.");
            this.displayMessage("Missing essential data fields.");
            return;
        }

        const taskDataMap = new Map<
            string,
            {
                rows: any[];
                task: Task | null;
                rowIndex: number;
                relationships: Array<{
                    predId: string;
                    relType: string;
                    lag: number | null;
                    freeFloat: number | null;
                }>;
            }
        >();

        const allPredecessorIds = new Set<string>();

        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
            const row = rows[rowIndex];
            const taskId = this.extractTaskId(row);
            if (!taskId) {
                console.warn(`Skipping row ${rowIndex}: Invalid or missing Task ID.`);
                continue;
            }

            if (dataDateIdx !== -1 && row[dataDateIdx] != null) {
                const parsedDataDate = this.parseDate(row[dataDateIdx]);
                if (parsedDataDate) {
                    const ts = parsedDataDate.getTime();
                    if (this.dataDate === null || ts > this.dataDate.getTime()) {
                        this.dataDate = parsedDataDate;
                    }
                }
            }

            let taskData = taskDataMap.get(taskId);
            if (!taskData) {
                taskData = {
                    rows: [],
                    task: null,
                    rowIndex: rowIndex,
                    relationships: [],
                };
                taskDataMap.set(taskId, taskData);
            }

            taskData.rows.push(row);

            if (predIdIdx !== -1 && row[predIdIdx] != null) {
                const predId = this.extractPredecessorId(row);
                if (predId && predId !== taskId) {

                    allPredecessorIds.add(predId);

                    const relTypeRaw =
                        relTypeIdx !== -1 && row[relTypeIdx] != null
                            ? String(row[relTypeIdx]).trim().toUpperCase()
                            : "FS";
                    const validRelTypes = ["FS", "SS", "FF", "SF"];
                    const relType = validRelTypes.includes(relTypeRaw)
                        ? relTypeRaw
                        : "FS";

                    let relLag: number | null = null;
                    if (relLagIdx !== -1 && row[relLagIdx] != null) {
                        const parsedLag = Number(row[relLagIdx]);
                        if (!isNaN(parsedLag) && isFinite(parsedLag)) {
                            relLag = parsedLag;
                        }
                    }

                    let relFreeFloat: number | null = null;
                    if (relFreeFloatIdx !== -1 && row[relFreeFloatIdx] != null) {
                        const parsedFreeFloat = Number(row[relFreeFloatIdx]);
                        if (!isNaN(parsedFreeFloat) && isFinite(parsedFreeFloat)) {
                            relFreeFloat = parsedFreeFloat;
                        }
                    }

                    const existingRel = taskData.relationships.find(
                        (r) => r.predId === predId
                    );
                    if (!existingRel) {
                        taskData.relationships.push({
                            predId: predId,
                            relType: relType,
                            lag: relLag,
                            freeFloat: relFreeFloat,
                        });
                    }
                }
            }
        }

        let syntheticTaskCount = 0;
        for (const predId of allPredecessorIds) {
            if (!taskDataMap.has(predId)) {
                syntheticTaskCount++;
            }
        }

        this.allTasksData = new Array(taskDataMap.size + syntheticTaskCount);
        this.relationships = [];

        const successorMap = new Map<string, Task[]>();
        let taskIndex = 0;

        for (const [taskId, taskData] of taskDataMap) {

            if (taskData.rows.length > 0 && !taskData.task) {
                taskData.task = this.createTaskFromRow(taskData.rows[0], taskData.rowIndex);
            }
            if (!taskData.task) continue;

            const task = taskData.task;

            if (!this.predecessorIndex.has(taskId)) {
                this.predecessorIndex.set(taskId, new Set());
            }

            for (const rel of taskData.relationships) {
                task.predecessorIds.push(rel.predId);
                task.relationshipTypes[rel.predId] = rel.relType;
                task.relationshipLags[rel.predId] = rel.lag;

                if (!this.predecessorIndex.has(rel.predId)) {
                    this.predecessorIndex.set(rel.predId, new Set());
                }
                this.predecessorIndex.get(rel.predId)!.add(taskId);

                if (!successorMap.has(rel.predId)) {
                    successorMap.set(rel.predId, []);
                }
                successorMap.get(rel.predId)!.push(task);

                const relationship: Relationship = {
                    predecessorId: rel.predId,
                    successorId: taskId,
                    type: rel.relType,
                    freeFloat: rel.freeFloat,
                    lag: rel.lag,
                    isCritical: false,
                };
                this.relationships.push(relationship);

                if (!this.relationshipIndex.has(taskId)) {
                    this.relationshipIndex.set(taskId, []);
                }
                this.relationshipIndex.get(taskId)!.push(relationship);

                if (!this.relationshipByPredecessor.has(rel.predId)) {
                    this.relationshipByPredecessor.set(rel.predId, []);
                }
                this.relationshipByPredecessor.get(rel.predId)!.push(relationship);
            }

            this.allTasksData[taskIndex++] = task;
            this.taskIdToTask.set(taskId, task);
        }

        for (const predId of allPredecessorIds) {

            if (this.taskIdToTask.has(predId)) {
                continue;
            }

            const syntheticTask: Task = {
                id: predId,
                internalId: predId,
                name: String(predId),
                type: "Synthetic",
                duration: 0,
                userProvidedTotalFloat: undefined,
                taskFreeFloat: undefined,
                predecessorIds: [],
                predecessors: [],
                successors: [],
                relationshipTypes: {},
                relationshipLags: {},
                earlyStart: 0,
                earlyFinish: 0,
                lateStart: Infinity,
                lateFinish: Infinity,
                totalFloat: Infinity,
                isCritical: false,
                isCriticalByFloat: false,
                isCriticalByRel: false,
                startDate: null,
                finishDate: null,
                baselineStartDate: null,
                baselineFinishDate: null,
                previousUpdateStartDate: null,
                previousUpdateFinishDate: null,
                tooltipData: undefined,
                legendValue: undefined,
            };

            this.allTasksData[taskIndex++] = syntheticTask;
            this.taskIdToTask.set(predId, syntheticTask);
        }

        if (taskIndex < this.allTasksData.length) {
            this.allTasksData.length = taskIndex;
        }

        for (const task of this.allTasksData) {

            task.successors = successorMap.get(task.internalId) || [];

            task.predecessors = task.predecessorIds
                .map((id) => this.taskIdToTask.get(id))
                .filter((t) => t !== undefined) as Task[];
        }

        this.processLegendData(dataView);

        this.processWBSData();

        this.validateDataQuality();

        const endTime = performance.now();
        this.debugLog(
            `Data transformation complete in ${endTime - startTime}ms. ` +
            `Found ${this.allTasksData.length} tasks and ${this.relationships.length} relationships.`
        );
    }

    /**
     * DATA QUALITY: Validates data quality and reports issues to the user
     * Checks for:
     * - Duplicate Task IDs
     * - Circular dependencies
     * - Invalid date ranges (start after finish)
     * - Tasks with no dates
     */
    private validateDataQuality(): void {
        const warnings: string[] = [];

        const seenIds = new Map<string, number>();
        for (const task of this.allTasksData) {
            const count = seenIds.get(task.id as string) || 0;
            seenIds.set(task.id as string, count + 1);
        }

        const duplicates = Array.from(seenIds.entries())
            .filter(([_id, count]) => count > 1)
            .map(([id, count]) => `${id} (${count}x)`);

        if (duplicates.length > 0) {
            warnings.push(`Duplicate Task IDs found: ${duplicates.slice(0, 5).join(', ')}${duplicates.length > 5 ? ` and ${duplicates.length - 5} more` : ''}`);
        }

        const circularPaths = this.detectCircularDependencies();
        if (circularPaths.length > 0) {
            warnings.push(`Circular dependencies detected in ${circularPaths.length} path(s): ${circularPaths.slice(0, 3).join(', ')}${circularPaths.length > 3 ? '...' : ''}`);
        }

        const invalidDates: string[] = [];
        for (const task of this.allTasksData) {
            if (task.startDate instanceof Date && task.finishDate instanceof Date &&
                !isNaN(task.startDate.getTime()) && !isNaN(task.finishDate.getTime())) {
                if (task.startDate > task.finishDate) {
                    invalidDates.push(task.name);
                }
            }
        }

        if (invalidDates.length > 0) {
            warnings.push(`Invalid date ranges (start > finish): ${invalidDates.slice(0, 5).join(', ')}${invalidDates.length > 5 ? ` and ${invalidDates.length - 5} more` : ''}`);
        }

        const noDateTasks = this.allTasksData.filter(task =>
            !(task.startDate instanceof Date && !isNaN(task.startDate.getTime())) &&
            !(task.finishDate instanceof Date && !isNaN(task.finishDate.getTime()))
        );

        if (noDateTasks.length > 0 && noDateTasks.length < this.allTasksData.length) {
            warnings.push(`${noDateTasks.length} task(s) have no valid dates and will not be displayed`);
        }

        const syntheticTasks = this.allTasksData.filter(task => task.type === "Synthetic");
        if (syntheticTasks.length > 0) {
            const syntheticIds = syntheticTasks.map(t => t.id).slice(0, 5);
            warnings.push(`${syntheticTasks.length} task(s) referenced as predecessors but missing from task list: ${syntheticIds.join(', ')}${syntheticTasks.length > 5 ? '...' : ''}. Add these tasks to your data source with proper Task Name values.`);
        }

        if (warnings.length > 0) {
            console.warn('Data Quality Issues Detected:');
            warnings.forEach((warning, index) => {
                console.warn(`  ${index + 1}. ${warning}`);
            });
        }
    }

    /**
     * Detects circular dependencies in the task graph
     * @returns Array of circular dependency paths as strings
     */
    private detectCircularDependencies(): string[] {
        const circularPaths: string[] = [];
        const seenCycles = new Set<string>();
        const visitState = new Map<string, 0 | 1 | 2>();
        const parent = new Map<string, string | null>();

        type StackFrame = { id: string; preds: string[]; index: number };
        const stack: StackFrame[] = [];

        const pushNode = (taskId: string, parentId: string | null) => {
            visitState.set(taskId, 1);
            parent.set(taskId, parentId);
            const preds = this.taskIdToTask.get(taskId)?.predecessorIds ?? [];
            stack.push({ id: taskId, preds, index: 0 });
        };

        for (const task of this.allTasksData) {
            const startId = task.internalId;
            if (visitState.get(startId)) {
                continue;
            }

            pushNode(startId, null);

            while (stack.length > 0) {
                const frame = stack[stack.length - 1];

                if (frame.index >= frame.preds.length) {
                    visitState.set(frame.id, 2);
                    stack.pop();
                    continue;
                }

                const predId = frame.preds[frame.index++];
                if (!this.taskIdToTask.has(predId)) {
                    continue;
                }

                const state = visitState.get(predId) ?? 0;
                if (state === 0) {
                    pushNode(predId, frame.id);
                } else if (state === 1) {
                    const cycle: string[] = [predId];
                    let current: string | null = frame.id;

                    while (current && current !== predId) {
                        cycle.push(current);
                        current = parent.get(current) ?? null;
                    }

                    cycle.push(predId);
                    cycle.reverse();

                    const key = cycle.join('->');
                    if (!seenCycles.has(key)) {
                        seenCycles.add(key);
                        circularPaths.push(cycle.join(' -> '));
                    }
                }
            }
        }

        return circularPaths;
    }

    /**
     * Process legend data and assign colors to tasks based on legend values
     */
    private processLegendData(dataView: DataView): void {

        this.legendDataExists = false;
        this.legendColorMap.clear();
        this.legendCategories = [];
        this.legendSelectionIds.clear();
        this.legendFieldName = "";

        const columns = dataView.metadata?.columns;
        if (!columns) return;

        const legendColumn = columns.find(col => col.roles?.legend);
        if (!legendColumn) {

            for (const task of this.allTasksData) {
                task.legendColor = undefined;
            }
            return;
        }

        this.legendFieldName = legendColumn.displayName || "Legend";
        this.legendDataExists = true;

        const legendValueSet = new Set<string>();
        for (const task of this.allTasksData) {
            if (task.legendValue) {
                legendValueSet.add(task.legendValue);
            }
        }

        this.legendCategories = Array.from(legendValueSet);

        const sortOrder = this.settings?.legend?.sortOrder?.value?.value || "none";
        if (sortOrder === "ascending") {
            this.legendCategories.sort((a, b) => a.localeCompare(b));
        } else if (sortOrder === "descending") {
            this.legendCategories.sort((a, b) => b.localeCompare(a));
        }

        const legendColorsObjects = dataView.metadata?.objects?.legendColors;
        const useHighContrast = this.highContrastMode;
        for (let i = 0; i < this.legendCategories.length && i < 20; i++) {
            const category = this.legendCategories[i];
            const colorKey = `color${i + 1}`;

            if (useHighContrast) {
                this.legendColorMap.set(category, this.highContrastForeground);
                continue;
            }

            const persistedColor = legendColorsObjects?.[colorKey];

            if (persistedColor && typeof persistedColor === 'object' && 'solid' in persistedColor) {

                this.legendColorMap.set(category, (persistedColor as any).solid.color);
            } else {

                const defaultColor = this.host.colorPalette.getColor(category).value;
                this.legendColorMap.set(category, defaultColor);
            }
        }

        for (const task of this.allTasksData) {
            if (task.legendValue) {
                task.legendColor = this.legendColorMap.get(task.legendValue);
            } else {
                task.legendColor = undefined;
            }
        }

        this.debugLog(`Legend processed: ${this.legendCategories.length} categories found`);
    }

    /**
     * WBS GROUPING: Processes WBS data and builds hierarchical group structure
     * Builds the WBS hierarchy from task WBS level fields and calculates summary metrics
     */
    private processWBSData(): void {

        this.wbsDataExists = false;
        this.wbsGroups = [];
        this.wbsGroupMap.clear();
        this.wbsRootGroups = [];
        this.wbsAvailableLevels = [];

        const hasWbsData = this.allTasksData.some(task =>
            task.wbsLevels && task.wbsLevels.length > 0
        );

        if (!hasWbsData) {

            for (const task of this.allTasksData) {
                task.wbsGroupId = undefined;
                task.wbsIndentLevel = 0;
            }
            return;
        }

        this.wbsDataExists = true;
        const defaultExpanded = this.settings?.wbsGrouping?.defaultExpanded?.value ?? true;
        const expandCollapseAll = this.settings?.wbsGrouping?.expandCollapseAll?.value ?? true;

        const expandCollapseAllChanged = this.lastExpandCollapseAllState !== null &&
            this.lastExpandCollapseAllState !== expandCollapseAll;
        if (expandCollapseAllChanged) {

            this.wbsExpandedState.clear();
        }
        this.lastExpandCollapseAllState = expandCollapseAll;

        for (const task of this.allTasksData) {
            const pathParts: string[] = [];

            if (task.wbsLevels && task.wbsLevels.length > 0) {

                for (let i = 0; i < task.wbsLevels.length; i++) {
                    const level = i + 1;
                    pathParts.push(`L${level}:${task.wbsLevels[i]}`);
                }
            }

            if (pathParts.length > 0) {
                task.wbsGroupId = pathParts.join('|');

                task.wbsIndentLevel = pathParts.length - 1;
            } else {
                task.wbsGroupId = undefined;
                task.wbsIndentLevel = 0;
            }
        }

        const groupPaths = new Set<string>();

        for (const task of this.allTasksData) {
            if (!task.wbsGroupId) continue;

            const parts = task.wbsGroupId.split('|');
            let currentPath = '';
            for (const part of parts) {
                currentPath = currentPath ? `${currentPath}|${part}` : part;
                groupPaths.add(currentPath);
            }
        }

        for (const path of groupPaths) {
            const parts = path.split('|');
            const lastPart = parts[parts.length - 1];
            const levelMatch = lastPart.match(/^L(\d+):(.+)$/);

            if (!levelMatch) continue;

            const level = parseInt(levelMatch[1], 10);
            const name = levelMatch[2];
            const parentPath = parts.length > 1 ? parts.slice(0, -1).join('|') : null;

            const isExpanded = this.wbsExpandedState.has(path)
                ? this.wbsExpandedState.get(path)!
                : expandCollapseAll;

            const group: WBSGroup = {
                id: path,
                level: level,
                name: name,
                fullPath: path,
                parentId: parentPath,
                children: [],
                tasks: [],
                allTasks: [],
                isExpanded: isExpanded,
                yOrder: undefined,
                visibleTaskCount: 0,
                summaryStartDate: null,
                summaryFinishDate: null,
                hasCriticalTasks: false,
                taskCount: 0,
                criticalStartDate: null,
                criticalFinishDate: null,
                hasNearCriticalTasks: false,
                nearCriticalStartDate: null,
                nearCriticalFinishDate: null,
                summaryBaselineStartDate: null,
                summaryBaselineFinishDate: null,
                summaryPreviousUpdateStartDate: null,
                summaryPreviousUpdateFinishDate: null
            };

            this.wbsGroups.push(group);
            this.wbsGroupMap.set(path, group);
        }

        for (const group of this.wbsGroups) {
            if (group.parentId) {
                const parent = this.wbsGroupMap.get(group.parentId);
                if (parent) {
                    parent.children.push(group);
                }
            } else {
                this.wbsRootGroups.push(group);
            }
        }

        for (const task of this.allTasksData) {
            if (task.wbsGroupId) {
                const group = this.wbsGroupMap.get(task.wbsGroupId);
                if (group) {
                    group.tasks.push(task);
                }
            }
        }

        const calculateGroupMetrics = (group: WBSGroup): void => {

            group.allTasks = [...group.tasks];

            for (const child of group.children) {
                calculateGroupMetrics(child);

                group.allTasks.push(...child.allTasks);
            }

            group.taskCount = group.allTasks.length;
            group.hasCriticalTasks = group.allTasks.some(t => t.isCritical);
            group.hasNearCriticalTasks = group.allTasks.some(t => t.isNearCritical);

            let minStart: Date | null = null;
            let maxFinish: Date | null = null;
            let nearCriticalMinStart: Date | null = null;
            let nearCriticalMaxFinish: Date | null = null;
            let baselineMinStart: Date | null = null;
            let baselineMaxFinish: Date | null = null;
            let prevUpdateMinStart: Date | null = null;
            let prevUpdateMaxFinish: Date | null = null;

            for (const task of group.allTasks) {
                if (task.startDate) {
                    if (!minStart || task.startDate < minStart) {
                        minStart = task.startDate;
                    }
                }
                if (task.finishDate) {
                    if (!maxFinish || task.finishDate > maxFinish) {
                        maxFinish = task.finishDate;
                    }
                }

                if (task.baselineStartDate) {
                    if (!baselineMinStart || task.baselineStartDate < baselineMinStart) {
                        baselineMinStart = task.baselineStartDate;
                    }
                }
                if (task.baselineFinishDate) {
                    if (!baselineMaxFinish || task.baselineFinishDate > baselineMaxFinish) {
                        baselineMaxFinish = task.baselineFinishDate;
                    }
                }

                if (task.previousUpdateStartDate) {
                    if (!prevUpdateMinStart || task.previousUpdateStartDate < prevUpdateMinStart) {
                        prevUpdateMinStart = task.previousUpdateStartDate;
                    }
                }
                if (task.previousUpdateFinishDate) {
                    if (!prevUpdateMaxFinish || task.previousUpdateFinishDate > prevUpdateMaxFinish) {
                        prevUpdateMaxFinish = task.previousUpdateFinishDate;
                    }
                }

                if (task.isNearCritical) {
                    if (task.startDate && (!nearCriticalMinStart || task.startDate < nearCriticalMinStart)) {
                        nearCriticalMinStart = task.startDate;
                    }
                    if (task.finishDate && (!nearCriticalMaxFinish || task.finishDate > nearCriticalMaxFinish)) {
                        nearCriticalMaxFinish = task.finishDate;
                    }
                }
            }

            group.summaryStartDate = minStart;
            group.summaryFinishDate = maxFinish;
            group.nearCriticalStartDate = nearCriticalMinStart;
            group.nearCriticalFinishDate = nearCriticalMaxFinish;
            group.summaryBaselineStartDate = baselineMinStart;
            group.summaryBaselineFinishDate = baselineMaxFinish;
            group.summaryPreviousUpdateStartDate = prevUpdateMinStart;
            group.summaryPreviousUpdateFinishDate = prevUpdateMaxFinish;
        };

        for (const rootGroup of this.wbsRootGroups) {
            calculateGroupMetrics(rootGroup);
        }

        const sortByStartDate = (a: WBSGroup, b: WBSGroup): number => {
            const aStart = a.summaryStartDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
            const bStart = b.summaryStartDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
            if (aStart !== bStart) return aStart - bStart;

            return a.fullPath.localeCompare(b.fullPath);
        };

        this.wbsGroups.sort(sortByStartDate);
        this.wbsRootGroups.sort(sortByStartDate);

        for (const group of this.wbsGroups) {
            group.children.sort(sortByStartDate);
        }

        this.refreshWbsAvailableLevels();
        if (this.wbsExpandToLevel !== undefined && !this.wbsManualExpansionOverride) {
            this.applyWbsExpandLevel(this.wbsExpandToLevel);
        }

        this.debugLog(`WBS processed: ${this.wbsGroups.length} groups found, ${this.wbsRootGroups.length} root groups`);
    }

    /**
     * WBS GROUPING: Helpers for expand-to-level behavior
     */
    private refreshWbsAvailableLevels(): void {
        const levelSet = new Set<number>();
        for (const group of this.wbsGroups) {
            levelSet.add(group.level);
        }
        this.wbsAvailableLevels = Array.from(levelSet).sort((a, b) => a - b);
    }

    private getMaxWbsLevel(): number {
        return this.wbsAvailableLevels.length > 0
            ? this.wbsAvailableLevels[this.wbsAvailableLevels.length - 1]
            : 0;
    }

    private getWbsExpandedStatePayload(): Record<string, boolean> {
        const payload: Record<string, boolean> = {};
        if (this.wbsGroups.length > 0) {
            this.wbsExpandedState.clear();
            for (const group of this.wbsGroups) {
                this.wbsExpandedState.set(group.id, group.isExpanded);
                payload[group.id] = group.isExpanded;
            }
            return payload;
        }

        for (const [groupId, expanded] of this.wbsExpandedState.entries()) {
            payload[groupId] = expanded;
        }
        return payload;
    }

    private getWbsExpandLevelLabel(level: number | null | undefined): string {
        if (level === 0) {
            return "Collapse all WBS levels";
        }
        if (level === null) {
            const max = this.getMaxWbsLevel();
            return max > 0 ? `Expand all (to Level ${max})` : "Expand all WBS levels";
        }
        if (level === undefined) {
            return this.wbsExpandedInternal ? "Expand all WBS levels" : "Collapse all WBS levels";
        }
        return `Expand to Level ${level}`;
    }

    private getCurrentWbsExpandLevel(): number {
        if (this.wbsAvailableLevels.length === 0) {
            return 0;
        }

        const maxLevel = this.getMaxWbsLevel();
        if (this.wbsExpandToLevel === null) {
            return maxLevel;
        }
        if (this.wbsExpandToLevel === undefined) {
            return this.wbsExpandedInternal ? maxLevel : 0;
        }

        return Math.min(Math.max(this.wbsExpandToLevel, 0), maxLevel);
    }

    private getNextWbsExpandLevel(): number | null {
        if (this.wbsAvailableLevels.length === 0) {
            return null;
        }
        const levels = Array.from(new Set(this.wbsAvailableLevels)).sort((a, b) => a - b);
        const sequence: Array<number> = [0, ...levels];
        const current = this.getCurrentWbsExpandLevel();
        const idx = sequence.findIndex(l => l === current);
        if (idx === -1) {
            return sequence[0];
        }
        const nextIdx = Math.min(idx + 1, sequence.length - 1);
        return sequence[nextIdx];
    }

    private getPreviousWbsExpandLevel(): number | null {
        if (this.wbsAvailableLevels.length === 0) {
            return null;
        }
        const levels = Array.from(new Set(this.wbsAvailableLevels)).sort((a, b) => a - b);
        const sequence: Array<number> = [0, ...levels];
        const current = this.getCurrentWbsExpandLevel();
        const idx = sequence.findIndex(l => l === current);
        if (idx === -1) {
            return sequence[0];
        }
        const prevIdx = Math.max(idx - 1, 0);
        return sequence[prevIdx];
    }

    private applyWbsExpandLevel(targetLevel: number | null): void {

        if (!this.wbsGroups.length) {
            this.wbsExpandToLevel = targetLevel;
            this.wbsExpandedInternal = targetLevel !== 0;
            return;
        }

        const maxLevel = this.getMaxWbsLevel();
        const effectiveLevel = targetLevel === null
            ? null
            : Math.min(Math.max(targetLevel, 0), maxLevel);

        this.wbsExpandToLevel = effectiveLevel;
        this.wbsExpandedInternal = effectiveLevel !== 0;

        for (const group of this.wbsGroups) {

            if (this.wbsManuallyToggledGroups.has(group.id)) {

                const existingState = this.wbsExpandedState.get(group.id);
                if (existingState !== undefined) {
                    group.isExpanded = existingState;
                }
            } else {

                const expanded = effectiveLevel === null ? true : group.level <= effectiveLevel;
                group.isExpanded = expanded;
                this.wbsExpandedState.set(group.id, expanded);
            }
        }

        this.wbsExpandedInternal = Array.from(this.wbsGroupMap.values()).some(g => g.isExpanded);
    }

    /**
     * Capture a WBS anchor near the middle of the current viewport so global
     * expand/collapse cycles keep the user roughly in place.
     */
    private captureWbsAnchorForGlobalToggle(): void {
        if (!this.scrollableContainer?.node()) return;
        if (!this.wbsDataExists || !this.settings?.wbsGrouping?.enableWbsGrouping?.value) return;

        const container = this.scrollableContainer.node();
        const scrollTop = container.scrollTop;
        const viewportHeight = container.clientHeight || 0;
        const targetY = scrollTop + viewportHeight / 2;

        let bestGroup: WBSGroup | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;

        for (const group of this.wbsGroups) {
            if (group.yOrder === undefined) continue;
            const rowY = group.yOrder * this.taskElementHeight;
            const distance = Math.abs(rowY - targetY);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestGroup = group;
            }
        }

        if (bestGroup && bestGroup.yOrder !== undefined) {
            const groupAbsoluteY = bestGroup.yOrder * this.taskElementHeight;
            const visualOffset = groupAbsoluteY - scrollTop;
            this.wbsToggleScrollAnchor = { groupId: bestGroup.id, visualOffset };
            this.preserveScrollOnUpdate = true;
            this.scrollPreservationUntil = Date.now() + 2000;
            this.debugLog(`Global WBS anchor captured: group=${bestGroup.id}, yOrder=${bestGroup.yOrder}, offset=${visualOffset}`);
        } else {

            this.preservedScrollTop = scrollTop;
            this.preserveScrollOnUpdate = true;
            this.scrollPreservationUntil = Date.now() + 2000;
            this.debugLog("Global WBS anchor fallback: preserving current scrollTop");
        }
    }

    /**
     * WBS GROUPING: Toggle expansion state for a WBS group
     */
    private toggleWbsGroupExpansion(groupId: string): void {
        const group = this.wbsGroupMap.get(groupId);
        if (!group) return;
        this.lastWbsToggleTimestamp = Date.now();
        this.scrollPreservationUntil = Math.max(this.scrollPreservationUntil, this.lastWbsToggleTimestamp + 2000);

        if (this.scrollThrottleTimeout) {
            clearTimeout(this.scrollThrottleTimeout);
            this.scrollThrottleTimeout = null;
        }

        this.hideTooltip();

        if (this.scrollableContainer?.node() && group.yOrder !== undefined) {
            const scrollTop = this.scrollableContainer.node().scrollTop;
            const groupAbsoluteY = group.yOrder * this.taskElementHeight;
            const visualOffset = groupAbsoluteY - scrollTop;
            this.wbsToggleScrollAnchor = { groupId, visualOffset };
            this.debugLog(`WBS toggle: Capturing anchor for group ${groupId}, yOrder=${group.yOrder}, visualOffset=${visualOffset}`);
        }

        const priorExpandedInternal = this.wbsExpandedInternal;
        if (this.wbsExpandToLevel === undefined) {
            this.wbsExpandToLevel = priorExpandedInternal ? null : 0;
        }
        this.wbsManualExpansionOverride = true;

        this.wbsManuallyToggledGroups.add(groupId);

        group.isExpanded = !group.isExpanded;
        this.wbsExpandedState.set(groupId, group.isExpanded);
        this.wbsExpandedInternal = Array.from(this.wbsGroupMap.values()).some(g => g.isExpanded);

        const expandedStatePayload = this.getWbsExpandedStatePayload();
        const manualGroupsPayload = Array.from(this.wbsManuallyToggledGroups);
        this.host.persistProperties({
            merge: [{
                objectName: "persistedState",
                properties: {
                    wbsExpandLevel: -2,
                    wbsExpandedState: JSON.stringify(expandedStatePayload),
                    wbsManualToggledGroups: JSON.stringify(manualGroupsPayload)
                },
                selector: null
            }]
        });

        this.taskLabelLayer?.selectAll("*").remove();
        this.labelGridLayer?.selectAll("*").remove();
        this.wbsGroupLayer?.selectAll("*").remove();

        if (this.lastUpdateOptions) {
            this.forceFullUpdate = true;
            this.preserveScrollOnUpdate = true;

            this.scrollPreservationUntil = Date.now() + 2000;
            this.updateInternal(this.lastUpdateOptions);
        }
    }

    /**
     * SCROLL RESTORATION: Unified scroll position restoration for all update scenarios.
     * Handles two restoration modes:
     * 1. STRICT PRESERVATION: Exact scrollTop restoration (baseline/previous update toggles)
     * 2. WBS ANCHOR-BASED: Smart anchoring that keeps a WBS group at the same visual offset
     *
     * This must be called AFTER the scroll container height is set but BEFORE setupVirtualScroll().
     * The order is critical: container height → scroll restoration → virtual scroll setup
     *
     * This method removes the scroll listener before setting scrollTop to prevent
     * handleScroll() from firing. setupVirtualScroll() will create and attach a new listener,
     * so we don't need to re-attach the old one.
     *
     * @param totalSvgHeight - Total height of SVG content for calculating max scroll bounds
     */
    private restoreScrollPosition(totalSvgHeight: number): void {
        if (!this.scrollableContainer?.node()) {

            this.preservedScrollTop = null;
            this.wbsToggleScrollAnchor = null;
            return;
        }

        const containerNode = this.scrollableContainer.node();
        const maxScroll = Math.max(0, totalSvgHeight - containerNode.clientHeight);

        if (this.scrollListener) {
            this.scrollableContainer.on("scroll", null);

        }

        if (this.preservedScrollTop !== null) {
            const targetScrollTop = this.preservedScrollTop;
            this.preservedScrollTop = null;

            const clampedScrollTop = Math.max(0, Math.min(targetScrollTop, maxScroll));

            this.debugLog(`Strict scroll restoration: target=${targetScrollTop}, clamped=${clampedScrollTop}, maxScroll=${maxScroll}`);

            containerNode.scrollTop = clampedScrollTop;

            void containerNode.scrollTop;

            return;
        }

        if (this.wbsToggleScrollAnchor) {
            const { groupId, visualOffset } = this.wbsToggleScrollAnchor;
            this.wbsToggleScrollAnchor = null;

            const group = this.wbsGroupMap.get(groupId);
            if (!group || group.yOrder === undefined) {
                this.debugLog(`WBS scroll anchor: Group ${groupId} not found or no yOrder, skipping`);
                return;
            }

            const newAbsoluteY = group.yOrder * this.taskElementHeight;

            const newScrollTop = newAbsoluteY - visualOffset;
            const clampedScrollTop = Math.max(0, Math.min(newScrollTop, maxScroll));

            this.debugLog(`WBS anchor restoration: group=${groupId}, yOrder=${group.yOrder}, ` +
                `newAbsoluteY=${newAbsoluteY}, visualOffset=${visualOffset}, ` +
                `newScrollTop=${newScrollTop}, clamped=${clampedScrollTop}, maxScroll=${maxScroll}`);

            containerNode.scrollTop = clampedScrollTop;

            void containerNode.scrollTop;
        }
    }

    /**
     * WBS GROUPING: Apply WBS ordering and filtering to tasks
     * Returns tasks sorted by WBS hierarchy with collapsed groups filtered out
     */
    private applyWbsOrdering(tasks: Task[]): Task[] {
        const orderedTasks: Task[] = [];
        const taskSet = new Set(tasks.map(t => t.internalId));

        const processGroup = (group: WBSGroup): void => {
            if (group.isExpanded) {

                for (const child of group.children) {
                    processGroup(child);
                }

                const directTasks = group.tasks
                    .filter(t => taskSet.has(t.internalId))
                    .sort((a, b) => (a.startDate?.getTime() ?? 0) - (b.startDate?.getTime() ?? 0));

                for (const task of directTasks) {
                    orderedTasks.push(task);
                }
            }

        };

        for (const rootGroup of this.wbsRootGroups) {
            processGroup(rootGroup);
        }

        const tasksWithoutWbs = tasks
            .filter(t => !t.wbsGroupId)
            .sort((a, b) => (a.startDate?.getTime() ?? 0) - (b.startDate?.getTime() ?? 0));

        for (const task of tasksWithoutWbs) {
            orderedTasks.push(task);
        }

        return orderedTasks;
    }

    /**
     * WBS GROUPING: Update filtered task counts for groups
     * This must be called BEFORE applyWbsOrdering so that collapse state doesn't affect counts
     *
     * @param filteredTasks - Tasks after filtering (legend, etc.) but before collapse/expand ordering
     */
    private updateWbsFilteredCounts(filteredTasks: Task[]): void {

        for (const group of this.wbsGroups) {
            group.visibleTaskCount = 0;
            group.summaryStartDate = null;
            group.summaryFinishDate = null;
            group.hasCriticalTasks = false;
            group.criticalStartDate = null;
            group.criticalFinishDate = null;
            group.hasNearCriticalTasks = false;
            group.nearCriticalStartDate = null;
            group.nearCriticalFinishDate = null;
            group.summaryBaselineStartDate = null;
            group.summaryBaselineFinishDate = null;
            group.summaryPreviousUpdateStartDate = null;
            group.summaryPreviousUpdateFinishDate = null;
        }

        const filteredTaskIds = new Set(filteredTasks.map(t => t.internalId));

        for (const task of filteredTasks) {
            if (task.wbsGroupId) {
                const group = this.wbsGroupMap.get(task.wbsGroupId);
                if (group) {
                    group.visibleTaskCount++;
                }
            }
        }

        const calculateFilteredSummary = (group: WBSGroup): void => {
            let minStart: Date | null = null;
            let maxFinish: Date | null = null;
            let hasCritical = false;
            let criticalMinStart: Date | null = null;
            let criticalMaxFinish: Date | null = null;
            let hasNearCritical = false;
            let nearCriticalMinStart: Date | null = null;
            let nearCriticalMaxFinish: Date | null = null;
            let baselineMinStart: Date | null = null;
            let baselineMaxFinish: Date | null = null;
            let prevUpdateMinStart: Date | null = null;
            let prevUpdateMaxFinish: Date | null = null;

            for (const task of group.tasks) {

                if (!filteredTaskIds.has(task.internalId)) continue;

                if (task.startDate && (!minStart || task.startDate < minStart)) {
                    minStart = task.startDate;
                }
                if (task.finishDate && (!maxFinish || task.finishDate > maxFinish)) {
                    maxFinish = task.finishDate;
                }

                if (task.isCritical) {
                    hasCritical = true;
                    if (task.startDate && (!criticalMinStart || task.startDate < criticalMinStart)) {
                        criticalMinStart = task.startDate;
                    }
                    if (task.finishDate && (!criticalMaxFinish || task.finishDate > criticalMaxFinish)) {
                        criticalMaxFinish = task.finishDate;
                    }
                }

                if (task.isNearCritical) {
                    hasNearCritical = true;
                    if (task.startDate && (!nearCriticalMinStart || task.startDate < nearCriticalMinStart)) {
                        nearCriticalMinStart = task.startDate;
                    }
                    if (task.finishDate && (!nearCriticalMaxFinish || task.finishDate > nearCriticalMaxFinish)) {
                        nearCriticalMaxFinish = task.finishDate;
                    }
                }

                if (task.baselineStartDate) {
                    if (!baselineMinStart || task.baselineStartDate < baselineMinStart) {
                        baselineMinStart = task.baselineStartDate;
                    }
                }
                if (task.baselineFinishDate) {
                    if (!baselineMaxFinish || task.baselineFinishDate > baselineMaxFinish) {
                        baselineMaxFinish = task.baselineFinishDate;
                    }
                }

                if (task.previousUpdateStartDate) {
                    if (!prevUpdateMinStart || task.previousUpdateStartDate < prevUpdateMinStart) {
                        prevUpdateMinStart = task.previousUpdateStartDate;
                    }
                }
                if (task.previousUpdateFinishDate) {
                    if (!prevUpdateMaxFinish || task.previousUpdateFinishDate > prevUpdateMaxFinish) {
                        prevUpdateMaxFinish = task.previousUpdateFinishDate;
                    }
                }
            }

            for (const child of group.children) {
                calculateFilteredSummary(child);
                if (child.hasCriticalTasks) hasCritical = true;
                if (child.summaryStartDate && (!minStart || child.summaryStartDate < minStart)) {
                    minStart = child.summaryStartDate;
                }
                if (child.summaryFinishDate && (!maxFinish || child.summaryFinishDate > maxFinish)) {
                    maxFinish = child.summaryFinishDate;
                }

                if (child.criticalStartDate && (!criticalMinStart || child.criticalStartDate < criticalMinStart)) {
                    criticalMinStart = child.criticalStartDate;
                }
                if (child.criticalFinishDate && (!criticalMaxFinish || child.criticalFinishDate > criticalMaxFinish)) {
                    criticalMaxFinish = child.criticalFinishDate;
                }

                if (child.hasNearCriticalTasks) hasNearCritical = true;
                if (child.nearCriticalStartDate && (!nearCriticalMinStart || child.nearCriticalStartDate < nearCriticalMinStart)) {
                    nearCriticalMinStart = child.nearCriticalStartDate;
                }
                if (child.nearCriticalFinishDate && (!nearCriticalMaxFinish || child.nearCriticalFinishDate > nearCriticalMaxFinish)) {
                    nearCriticalMaxFinish = child.nearCriticalFinishDate;
                }

                if (child.summaryBaselineStartDate && (!baselineMinStart || child.summaryBaselineStartDate < baselineMinStart)) {
                    baselineMinStart = child.summaryBaselineStartDate;
                }
                if (child.summaryBaselineFinishDate && (!baselineMaxFinish || child.summaryBaselineFinishDate > baselineMaxFinish)) {
                    baselineMaxFinish = child.summaryBaselineFinishDate;
                }

                if (child.summaryPreviousUpdateStartDate && (!prevUpdateMinStart || child.summaryPreviousUpdateStartDate < prevUpdateMinStart)) {
                    prevUpdateMinStart = child.summaryPreviousUpdateStartDate;
                }
                if (child.summaryPreviousUpdateFinishDate && (!prevUpdateMaxFinish || child.summaryPreviousUpdateFinishDate > prevUpdateMaxFinish)) {
                    prevUpdateMaxFinish = child.summaryPreviousUpdateFinishDate;
                }
            }

            group.summaryStartDate = minStart;
            group.summaryFinishDate = maxFinish;
            group.hasCriticalTasks = hasCritical;
            group.criticalStartDate = criticalMinStart;
            group.criticalFinishDate = criticalMaxFinish;
            group.hasNearCriticalTasks = hasNearCritical;
            group.nearCriticalStartDate = nearCriticalMinStart;
            group.nearCriticalFinishDate = nearCriticalMaxFinish;
            group.summaryBaselineStartDate = baselineMinStart;
            group.summaryBaselineFinishDate = baselineMaxFinish;
            group.summaryPreviousUpdateStartDate = prevUpdateMinStart;
            group.summaryPreviousUpdateFinishDate = prevUpdateMaxFinish;
        };

        for (const rootGroup of this.wbsRootGroups) {
            calculateFilteredSummary(rootGroup);
        }

        const propagateCounts = (group: WBSGroup): void => {
            for (const child of group.children) {
                propagateCounts(child);
                group.visibleTaskCount += child.visibleTaskCount;
            }
        };
        for (const rootGroup of this.wbsRootGroups) {
            propagateCounts(rootGroup);
        }

        const sortByFilteredStartDate = (a: WBSGroup, b: WBSGroup): number => {
            const aStart = a.summaryStartDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
            const bStart = b.summaryStartDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
            if (aStart !== bStart) return aStart - bStart;

            return a.fullPath.localeCompare(b.fullPath);
        };

        this.wbsRootGroups.sort(sortByFilteredStartDate);

        for (const group of this.wbsGroups) {
            group.children.sort(sortByFilteredStartDate);
        }
    }

    /**
     * WBS GROUPING: Assign yOrder to both group headers and tasks after all filtering
     * This creates a unified layout where group headers reserve their own rows
     *
     * @param tasksToShow - Final filtered list of tasks to display (after collapse/expand)
     */
    private assignWbsYOrder(tasksToShow: Task[]): void {

        for (const group of this.wbsGroups) {
            group.yOrder = undefined;
        }

        for (const task of this.allTasksData) {
            task.yOrder = undefined;
        }

        const visibleTaskIds = new Set(tasksToShow.map(t => t.internalId));

        let currentYOrder = 0;

        const hideEmptyGroups = this.settings?.wbsGrouping?.hideEmptyGroups?.value ?? true;
        const isGroupVisible = (group: WBSGroup): boolean => {

            if (hideEmptyGroups && group.visibleTaskCount === 0) return false;

            if (group.taskCount === 0) return false;

            if (!group.parentId) return true;

            const parent = this.wbsGroupMap.get(group.parentId);
            return parent ? parent.isExpanded && isGroupVisible(parent) : true;
        };

        const assignYOrderRecursive = (group: WBSGroup): void => {
            if (!isGroupVisible(group)) return;

            group.yOrder = currentYOrder++;

            if (group.isExpanded) {

                for (const child of group.children) {
                    assignYOrderRecursive(child);
                }

                const directVisibleTasks = group.tasks
                    .filter(t => visibleTaskIds.has(t.internalId))
                    .sort((a, b) => (a.startDate?.getTime() ?? 0) - (b.startDate?.getTime() ?? 0));

                for (const task of directVisibleTasks) {
                    task.yOrder = currentYOrder++;
                }
            }

        };

        for (const rootGroup of this.wbsRootGroups) {
            assignYOrderRecursive(rootGroup);
        }

        const tasksWithoutWbs = tasksToShow
            .filter(t => !t.wbsGroupId)
            .sort((a, b) => (a.startDate?.getTime() ?? 0) - (b.startDate?.getTime() ?? 0));

        for (const task of tasksWithoutWbs) {
            task.yOrder = currentYOrder++;
        }

        this.debugLog(`Assigned yOrder to ${currentYOrder} items (groups + tasks)`);
    }

    /**
     * WBS GROUPING: Draw WBS group headers in SVG mode
     * Renders group headers with expand/collapse controls and optional summary bars
     */
    private drawWbsGroupHeaders(
        xScale: ScaleTime<number, number>,
        yScale: ScaleBand<string>,
        chartWidth: number,
        taskHeight: number,
        viewportStartIndex?: number,
        viewportEndIndex?: number
    ): void {

        if (!xScale || !yScale) {
            console.warn("drawWbsGroupHeaders: Skipping render - xScale or yScale is null");

            this.wbsGroupLayer?.selectAll('.wbs-group-header').remove();
            return;
        }

        if (!this.wbsDataExists || !this.settings?.wbsGrouping?.enableWbsGrouping?.value) {

            this.taskLayer?.selectAll('.wbs-group-header').remove();
            return;
        }

        const showGroupSummary = this.settings.wbsGrouping.showGroupSummary.value;
        const defaultGroupHeaderColor = this.settings.wbsGrouping.groupHeaderColor.value.value;
        const groupSummaryColor = this.resolveColor(this.settings.wbsGrouping.groupSummaryColor.value.value, "foreground");
        const nearCriticalColor = this.resolveColor(this.settings.criticalPath.nearCriticalColor.value.value, "foreground");
        const indentPerLevel = this.settings.wbsGrouping.indentPerLevel.value;
        const currentLeftMargin = this.settings.layoutSettings.leftMargin.value;
        const taskNameFontSize = this.settings.textAndLabels.taskNameFontSize.value;

        const groupNameFontSizeSetting = this.settings.wbsGrouping.groupNameFontSize?.value ?? 0;
        const groupNameFontSize = groupNameFontSizeSetting > 0 ? groupNameFontSizeSetting : taskNameFontSize + 1;
        const defaultGroupNameColor = this.settings.wbsGrouping.groupNameColor?.value?.value ?? "#333333";
        const criticalPathColor = this.resolveColor(this.settings.criticalPath.criticalPathColor.value.value, "foreground");
        const mode = this.settings?.criticalPath?.calculationMode?.value?.value || 'longestPath';
        const showNearCriticalSummary = this.showNearCritical && this.floatThreshold > 0 && mode === 'floatBased';
        const showBaseline = this.showBaselineInternal;
        const showPreviousUpdate = this.showPreviousUpdateInternal;
        const baselineColor = this.resolveColor(this.settings.comparisonBars.baselineColor.value.value, "foreground");
        const baselineHeight = this.settings.comparisonBars.baselineHeight.value;
        const baselineOffset = this.settings.comparisonBars.baselineOffset.value;
        const previousUpdateColor = this.resolveColor(this.settings.comparisonBars.previousUpdateColor.value.value, "foreground");
        const previousUpdateHeight = this.settings.comparisonBars.previousUpdateHeight.value;
        const previousUpdateOffset = this.settings.comparisonBars.previousUpdateOffset.value;

        if (!this.wbsGroupLayer) {
            this.wbsGroupLayer = this.mainGroup.insert('g', '.arrow-layer')
                .attr('class', 'wbs-group-layer');
        }

        this.wbsGroupLayer.selectAll('.wbs-group-header').remove();

        const self = this;

        for (const group of this.wbsGroups) {

            if (group.yOrder === undefined) continue;

            if (viewportStartIndex !== undefined && viewportEndIndex !== undefined) {
                if (group.yOrder < viewportStartIndex || group.yOrder > viewportEndIndex) {
                    continue;
                }
            }

            const domainKey = group.yOrder.toString();
            const bandStart = yScale(domainKey);

            if (bandStart === undefined) continue;

            const bandCenter = bandStart + taskHeight / 2;

            const indent = Math.max(0, (group.level - 1) * indentPerLevel);
            const levelStyle = this.getWbsLevelStyle(group.level, defaultGroupHeaderColor, defaultGroupNameColor);
            const groupHeaderColor = this.resolveColor(levelStyle.background, "background");
            const groupNameColor = this.resolveColor(levelStyle.text, "foreground");
            const summaryFillColor = this.blendColors(groupHeaderColor, groupSummaryColor, 0.35);
            const summaryStrokeColor = this.getContrastColor(summaryFillColor);
            const headerGroup = this.wbsGroupLayer.append('g')
                .attr('class', 'wbs-group-header')
                .attr('data-group-id', group.id)
                .style('cursor', 'pointer');

            const bgOpacity = (group.visibleTaskCount === 0) ? 0.4 : 0.8;

            const barsGroup = headerGroup.append('g')
                .attr('class', 'wbs-summary-bars')
                .attr('clip-path', 'url(#chart-area-clip)');

            if (showGroupSummary && group.taskCount > 0 &&
                group.summaryStartDate && group.summaryFinishDate) {
                const isCollapsed = !group.isExpanded;
                const startX = xScale(group.summaryStartDate);
                const finishX = xScale(group.summaryFinishDate);
                const barWidth = Math.max(2, finishX - startX);
                const barHeight = Math.max(2, taskHeight * (isCollapsed ? 0.65 : 0.35));
                const barY = bandCenter - barHeight / 2;
                const barRadius = Math.min(3, Math.max(1, barHeight / 2));

                const baseOpacity = isCollapsed ? 0.78 : 0.25;
                const barOpacity = (group.visibleTaskCount === 0)
                    ? baseOpacity * (isCollapsed ? 0.5 : 0.35)
                    : baseOpacity;

                const prevBarHeight = isCollapsed
                    ? previousUpdateHeight
                    : Math.max(1, Math.min(previousUpdateHeight, barHeight * 0.7));
                const prevOffset = isCollapsed
                    ? previousUpdateOffset
                    : Math.max(1, Math.min(previousUpdateOffset, barHeight * 0.6));
                const prevRadius = Math.min(3, prevBarHeight / 2);
                const baselineBarHeight = isCollapsed
                    ? baselineHeight
                    : Math.max(1, Math.min(baselineHeight, barHeight * 0.7));
                const baselineOffsetEff = isCollapsed
                    ? baselineOffset
                    : Math.max(1, Math.min(baselineOffset, barHeight * 0.6));
                const baselineRadius = Math.min(3, baselineBarHeight / 2);

                if (showPreviousUpdate &&
                    group.summaryPreviousUpdateStartDate && group.summaryPreviousUpdateFinishDate &&
                    group.summaryPreviousUpdateFinishDate >= group.summaryPreviousUpdateStartDate) {
                    const prevStartX = xScale(group.summaryPreviousUpdateStartDate);
                    const prevFinishX = xScale(group.summaryPreviousUpdateFinishDate);
                    const prevWidth = Math.max(2, prevFinishX - prevStartX);
                    const prevY = barY + barHeight + prevOffset;

                    barsGroup.append('rect')
                        .attr('class', 'wbs-summary-bar-previous-update')
                        .attr('x', prevStartX)
                        .attr('y', prevY)
                        .attr('width', prevWidth)
                        .attr('height', prevBarHeight)
                        .attr('rx', prevRadius)
                        .attr('ry', prevRadius)
                        .style('fill', previousUpdateColor)
                        .style('opacity', barOpacity);
                }

                if (showBaseline &&
                    group.summaryBaselineStartDate && group.summaryBaselineFinishDate &&
                    group.summaryBaselineFinishDate >= group.summaryBaselineStartDate) {
                    const baselineStartX = xScale(group.summaryBaselineStartDate);
                    const baselineFinishX = xScale(group.summaryBaselineFinishDate);
                    const baselineWidth = Math.max(2, baselineFinishX - baselineStartX);
                    const baselineY = barY + barHeight +
                        (showPreviousUpdate ? prevBarHeight + prevOffset : 0) +
                        baselineOffsetEff;

                    barsGroup.append('rect')
                        .attr('class', 'wbs-summary-bar-baseline')
                        .attr('x', baselineStartX)
                        .attr('y', baselineY)
                        .attr('width', baselineWidth)
                        .attr('height', baselineBarHeight)
                        .attr('rx', baselineRadius)
                        .attr('ry', baselineRadius)
                        .style('fill', baselineColor)
                        .style('opacity', barOpacity);
                }

                barsGroup.append('rect')
                    .attr('class', 'wbs-summary-bar')
                    .attr('x', startX)
                    .attr('y', barY)
                    .attr('width', barWidth)
                    .attr('height', barHeight)
                    .attr('rx', barRadius)
                    .attr('ry', barRadius)
                    .style('fill', summaryFillColor)
                    .style('opacity', barOpacity)
                    .style('stroke', summaryStrokeColor)
                    .style('stroke-width', isCollapsed ? 0.8 : 0.4)
                    .style('stroke-opacity', 0.25);

                if (barWidth > 6) {
                    const capRadius = Math.min(3, Math.max(1.5, barHeight / 3));
                    const capOpacity = isCollapsed ? barOpacity : Math.min(0.35, barOpacity + 0.1);

                    barsGroup.append('circle')
                        .attr('class', 'wbs-summary-cap-start')
                        .attr('cx', startX)
                        .attr('cy', barY + barHeight / 2)
                        .attr('r', capRadius)
                        .style('fill', summaryStrokeColor)
                        .style('opacity', capOpacity);

                    barsGroup.append('circle')
                        .attr('class', 'wbs-summary-cap-end')
                        .attr('cx', finishX)
                        .attr('cy', barY + barHeight / 2)
                        .attr('r', capRadius)
                        .style('fill', summaryStrokeColor)
                        .style('opacity', capOpacity);
                }

                if (showNearCriticalSummary && group.hasNearCriticalTasks && group.nearCriticalStartDate && group.nearCriticalFinishDate) {
                    const clampedNearStartDate = group.summaryStartDate
                        ? new Date(Math.max(group.nearCriticalStartDate.getTime(), group.summaryStartDate.getTime()))
                        : group.nearCriticalStartDate;
                    const clampedNearFinishDate = group.summaryFinishDate
                        ? new Date(Math.min(group.nearCriticalFinishDate.getTime(), group.summaryFinishDate.getTime()))
                        : group.nearCriticalFinishDate;

                    if (clampedNearStartDate <= clampedNearFinishDate) {
                        const nearStartX = xScale(clampedNearStartDate);
                        const nearFinishX = xScale(clampedNearFinishDate);
                        const nearWidth = Math.max(2, nearFinishX - nearStartX);

                        const nearStartsAtBeginning = nearStartX <= startX + 1;
                        const nearEndsAtEnd = nearFinishX >= finishX - 1;

                        barsGroup.append('rect')
                            .attr('class', 'wbs-summary-bar-near-critical')
                            .attr('x', nearStartX)
                            .attr('y', barY)
                            .attr('width', nearWidth)
                            .attr('height', barHeight)
                            .attr('rx', (nearStartsAtBeginning || nearEndsAtEnd) ? barRadius : 0)
                            .attr('ry', (nearStartsAtBeginning || nearEndsAtEnd) ? barRadius : 0)
                            .style('fill', nearCriticalColor)
                            .style('opacity', barOpacity);
                    }
                }

                if (group.hasCriticalTasks && group.criticalStartDate && group.criticalFinishDate) {
                    const criticalStartX = xScale(group.criticalStartDate);
                    const criticalFinishX = xScale(group.criticalFinishDate);
                    const criticalWidth = Math.max(2, criticalFinishX - criticalStartX);

                    const criticalStartsAtBeginning = criticalStartX <= startX + 1;
                    const criticalEndsAtEnd = criticalFinishX >= finishX - 1;

                    barsGroup.append('rect')
                        .attr('class', 'wbs-summary-bar-critical')
                        .attr('x', criticalStartX)
                        .attr('y', barY)
                        .attr('width', criticalWidth)
                        .attr('height', barHeight)
                        .attr('rx', (criticalStartsAtBeginning || criticalEndsAtEnd) ? barRadius : 0)
                        .attr('ry', (criticalStartsAtBeginning || criticalEndsAtEnd) ? barRadius : 0)
                        .style('fill', criticalPathColor)
                        .style('opacity', barOpacity);
                }
            }

            const expandIcon = group.isExpanded ? '\u25BC' : '\u25B6';
            const mutedTextColor = this.resolveColor("#777777", "foreground");
            const iconColor = (group.visibleTaskCount === 0) ? mutedTextColor : groupNameColor;

            headerGroup.append('text')
                .attr('class', 'wbs-expand-icon')
                .attr('x', -currentLeftMargin + indent + 8)
                .attr('y', bandCenter - 2)
                .style('font-size', `${taskNameFontSize}px`)
                .style('font-family', this.getFontFamily())
                .style('fill', iconColor)
                .text(expandIcon);

            const baseName = group.name;
            const tasksLabel = this.getLocalizedString("wbs.tasksLabel", "tasks");
            const visibleLabel = this.getLocalizedString("wbs.visibleLabel", "visible");
            let countSuffix = "";
            if (group.taskCount > 0) {
                if (group.visibleTaskCount < group.taskCount) {
                    countSuffix = `${group.visibleTaskCount}/${group.taskCount} ${visibleLabel}`;
                } else if (!group.isExpanded) {
                    countSuffix = `${group.taskCount} ${tasksLabel}`;
                }
            }
            const displayName = countSuffix ? `${baseName} - ${countSuffix}` : baseName;

            const textColor = (group.visibleTaskCount === 0) ? mutedTextColor : groupNameColor;
            const textOpacity = (group.visibleTaskCount === 0) ? 0.65 : 1.0;

            const textX = -currentLeftMargin + indent + 22;
            const textY = bandCenter;
            const availableWidth = currentLeftMargin - indent - 30;
            const lineHeight = '1.1em';
            const maxLines = 2;

            const textElement = headerGroup.append('text')
                .attr('class', 'wbs-group-name')
                .attr('clip-path', 'url(#clip-left-margin)')
                .attr('x', textX)
                .attr('y', textY)
                // vertical alignment handled via dy to support iOS
                .style('font-size', `${groupNameFontSize}px`)
                .style('font-family', this.getFontFamily())
                .style('font-weight', '600')
                .style('fill', textColor)
                .style('opacity', textOpacity);

            const words = displayName.split(/\s+/).reverse();
            let word: string | undefined;
            let line: string[] = [];
            let firstTspan = textElement.text(null).append('tspan')
                .attr('x', textX)
                .attr('y', textY)
                .attr('dy', '0.35em');
            let tspan = firstTspan;
            let lineCount = 1;

            while (word = words.pop()) {
                line.push(word);
                tspan.text(line.join(' '));
                try {
                    const node = tspan.node();
                    if (node && node.getComputedTextLength() > availableWidth && line.length > 1) {
                        line.pop();
                        tspan.text(line.join(' '));

                        if (lineCount < maxLines) {
                            line = [word];
                            tspan = textElement.append('tspan')
                                .attr('x', textX)
                                .attr('dy', lineHeight)
                                .text(word);
                            lineCount++;
                        } else {

                            const currentText = tspan.text();
                            if (currentText.length > 3) {
                                tspan.text(currentText.slice(0, -3) + '...');
                            }
                            break;
                        }
                    }
                } catch (e) {

                    tspan.text(line.join(' '));
                    break;
                }
            }

            // Keep first line position consistent
            // if (lineCount > 1) { firstTspan.attr('dy', '-0.2em'); }

            const lineHeightPx = groupNameFontSize * 1.1;

            // Constrain background height to available row height to prevent overlap
            const taskPadding = this.settings.layoutSettings.taskPadding.value || 5;
            const bgHeight = taskHeight + taskPadding - 1; // -1 for a tiny visual gap

            const bgY = bandStart;

            headerGroup.insert('rect', ':first-child')
                .attr('class', 'wbs-header-bg')
                .attr('x', -currentLeftMargin + indent)
                .attr('y', bgY)
                .attr('width', currentLeftMargin - indent - 5)
                .attr('height', bgHeight)
                .style('fill', groupHeaderColor)
                .style('opacity', bgOpacity);

            headerGroup.on('click', function () {
                self.hideTooltip();
                self.toggleWbsGroupExpansion(group.id);
            });
        }
    }

    private mightBeDate(value: PrimitiveValue): boolean {

        if (value instanceof Date) return true;

        if (typeof value === 'string') {

            return /^\d{4}-\d{1,2}-\d{1,2}|^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}/.test(value);
        }

        if (typeof value === 'number') {

            return value > 946684800000;
        }

        return false;
    }

    private validateDataView(dataView: DataView): boolean {
        if (!dataView?.table?.rows || !dataView.metadata?.columns) {
            console.warn("validateDataView: Missing table/rows or metadata/columns.");
            return false;
        }

        const hasId = this.hasDataRole(dataView, 'taskId');
        const hasStartDate = this.hasDataRole(dataView, 'startDate');
        const hasFinishDate = this.hasDataRole(dataView, 'finishDate');

        const mode = this.settings?.criticalPath?.calculationMode?.value?.value || 'longestPath';
        const hasDuration = this.hasDataRole(dataView, 'duration');
        const hasTotalFloat = this.hasDataRole(dataView, 'taskTotalFloat');
        const hasTaskFreeFloat = this.hasDataRole(dataView, 'taskFreeFloat');

        let isValid = true;
        if (!hasId) {
            console.warn("validateDataView: Missing 'taskId' data role.");
            isValid = false;
        }

        if (mode === 'floatBased') {

            if (!hasTotalFloat) {
                console.warn("validateDataView: Float-Based mode requires 'taskTotalFloat' data role for criticality.");
                isValid = false;
            }
        } else {

            if (!hasDuration) {
                console.warn("validateDataView: Longest Path mode requires 'duration' data role (needed for CPM).");
                isValid = false;
            }
        }

        if (!hasStartDate) {
            console.warn("validateDataView: Missing 'startDate' data role (needed for plotting).");
            isValid = false;
        }
        if (!hasFinishDate) {
            console.warn("validateDataView: Missing 'finishDate' data role (needed for plotting).");
            isValid = false;
        }

        return isValid;
    }

    private hasDataRole(dataView: DataView, roleName: string): boolean {
        if (!dataView?.metadata?.columns) return false;
        return dataView.metadata.columns.some(column => column.roles?.[roleName]);
    }

    private getColumnIndex(dataView: DataView, roleName: string): number {
        if (!dataView?.metadata?.columns) return -1;
        return dataView.metadata.columns.findIndex(column => column.roles?.[roleName]);
    }

    private parseDate(dateValue: PrimitiveValue): Date | null {
        if (dateValue == null) return null;
        let date: Date | null = null;

        try {
            if (dateValue instanceof Date) {
                if (!isNaN(dateValue.getTime())) date = dateValue;
            }
            else if (typeof dateValue === 'string') {
                let dateStrToParse = dateValue.trim();
                if (dateStrToParse) {

                    const parsedTimestamp = Date.parse(dateStrToParse);
                    if (!isNaN(parsedTimestamp)) date = new Date(parsedTimestamp);

                    if (!date) {
                        date = new Date(dateStrToParse);
                        if (isNaN(date.getTime())) date = null;
                    }
                }
            }
            else if (typeof dateValue === 'number') {
                const num = dateValue;
                if (!isNaN(num) && isFinite(num)) {

                    if (num > 0 && num < 60) {

                    } else if (num >= 61 && num < 2958466) {

                        date = new Date(Math.round((num - 25569) * 86400 * 1000));
                    }

                    else if (num > 631152000000 && num < Date.now() + 3153600000000 * 20) {
                        date = new Date(num);
                    }

                    else if (num > 631152000 && num < (Date.now() / 1000) + 31536000 * 20) {
                        date = new Date(num * 1000);
                    }

                    if (date && isNaN(date.getTime())) date = null;
                }
            }
        } catch (e) {
            date = null;
            console.warn(`Error parsing date value: "${String(dateValue)}"`, e);
        }

        if (!date) {

        }
        return date;
    }

    private refreshDateFormatters(): void {
        const locale = this.host?.locale || undefined;
        if (this.lastLocale === locale &&
            this.fullDateFormatter &&
            this.lineDateFormatter &&
            this.monthYearFormatter) {
            return;
        }

        this.lastLocale = locale || null;
        this.fullDateFormatter = new Intl.DateTimeFormat(locale, {
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        });
        this.lineDateFormatter = new Intl.DateTimeFormat(locale, {
            day: "2-digit",
            month: "short",
            year: "2-digit"
        });
        this.monthYearFormatter = new Intl.DateTimeFormat(locale, {
            month: "short",
            year: "2-digit"
        });
    }

    private formatColumnDate(date: Date): string {
        if (!date || isNaN(date.getTime())) return "";
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
    }

    private formatDate(date: Date | null | undefined): string {
        if (!date || !(date instanceof Date) || isNaN(date.getTime())) return "";
        try {
            this.refreshDateFormatters();
            return this.fullDateFormatter.format(date);
        } catch (e) {
            console.error("Error formatting date:", e);
            return "Invalid Date";
        }
    }

    private formatLineDate(date: Date | null | undefined): string {
        if (!date || !(date instanceof Date) || isNaN(date.getTime())) return "";
        try {
            // Format as DD-Mon-YY (e.g., "05-Aug-27")
            const day = String(date.getDate()).padStart(2, '0');
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const month = monthNames[date.getMonth()];
            const year = String(date.getFullYear()).slice(-2);
            return `${day}-${month}-${year}`;
        } catch (e) {
            console.error("Error formatting line date:", e);
            return this.formatDate(date);
        }
    }

    private limitTasks(tasksToFilter: Task[], maxTasks: number): Task[] {
        const effectiveMaxTasks = (!isNaN(maxTasks) && maxTasks > 0) ? Math.floor(maxTasks) : this.defaultMaxTasks;

        if (tasksToFilter.length <= effectiveMaxTasks) {
            return [...tasksToFilter];
        }

        this.debugLog(`Limiting tasks shown from ${tasksToFilter.length} to ${effectiveMaxTasks}`);

        const originalIndexMap = new Map<string, number>();
        tasksToFilter.forEach((task, index) => {
            originalIndexMap.set(task.internalId, index);
        });

        const tasksToShow: Task[] = [];
        const shownTaskIds = new Set<string>();

        if (tasksToFilter.length > 0) {
            const firstTask = tasksToFilter[0];
            tasksToShow.push(firstTask);
            shownTaskIds.add(firstTask.internalId);
        }

        if (tasksToFilter.length > 1 && tasksToShow.length < effectiveMaxTasks) {
            const lastTask = tasksToFilter[tasksToFilter.length - 1];
            if (!shownTaskIds.has(lastTask.internalId)) {
                tasksToShow.push(lastTask);
                shownTaskIds.add(lastTask.internalId);
            }
        }

        const remainingTasks = tasksToFilter.slice(1, -1).filter(task => !shownTaskIds.has(task.internalId));

        let slotsAvailable = effectiveMaxTasks - tasksToShow.length;
        if (slotsAvailable > 0) {
            const criticalTasks = remainingTasks.filter(task => task.isCritical);
            const criticalToAdd = criticalTasks.slice(0, slotsAvailable);
            criticalToAdd.forEach(task => {
                tasksToShow.push(task);
                shownTaskIds.add(task.internalId);
            });
        }

        slotsAvailable = effectiveMaxTasks - tasksToShow.length;
        if (slotsAvailable > 0) {
            const nearCriticalTasks = remainingTasks.filter(task =>
                !shownTaskIds.has(task.internalId) && task.isNearCritical);
            const nearCriticalToAdd = nearCriticalTasks.slice(0, slotsAvailable);
            nearCriticalToAdd.forEach(task => {
                tasksToShow.push(task);
                shownTaskIds.add(task.internalId);
            });
        }

        slotsAvailable = effectiveMaxTasks - tasksToShow.length;
        if (slotsAvailable > 0) {
            const milestones = remainingTasks.filter(task =>
                !shownTaskIds.has(task.internalId) &&
                (task.type === 'TT_Mile' || task.type === 'TT_FinMile')
            );
            const milestonesToAdd = milestones.slice(0, slotsAvailable);
            milestonesToAdd.forEach(milestone => {
                tasksToShow.push(milestone);
                shownTaskIds.add(milestone.internalId);
            });
        }

        slotsAvailable = effectiveMaxTasks - tasksToShow.length;
        if (slotsAvailable > 0) {
            const regularTasks = remainingTasks.filter(task => !shownTaskIds.has(task.internalId));

            if (regularTasks.length > 0) {
                if (regularTasks.length <= slotsAvailable) {
                    regularTasks.forEach(task => { tasksToShow.push(task); shownTaskIds.add(task.internalId); });
                } else {

                    const step = Math.max(1, regularTasks.length / slotsAvailable);
                    for (let i = 0; i < slotsAvailable && tasksToShow.length < effectiveMaxTasks; i++) {
                        const index = Math.min(regularTasks.length - 1, Math.floor(i * step));
                        const taskToAdd = regularTasks[index];
                        if (!shownTaskIds.has(taskToAdd.internalId)) {
                            tasksToShow.push(taskToAdd);
                            shownTaskIds.add(taskToAdd.internalId);
                        } else {

                            let nextIndex = index + 1;
                            while (nextIndex < regularTasks.length && shownTaskIds.has(regularTasks[nextIndex].internalId)) { nextIndex++; }
                            if (nextIndex < regularTasks.length) {
                                const nextTask = regularTasks[nextIndex];
                                tasksToShow.push(nextTask);
                                shownTaskIds.add(nextTask.internalId);
                            }
                        }
                    }
                }
            }
        }

        tasksToShow.sort((a, b) => {
            const indexA = originalIndexMap.get(a.internalId) ?? Infinity;
            const indexB = originalIndexMap.get(b.internalId) ?? Infinity;
            return indexA - indexB;
        });

        this.debugLog(`Final limited task count: ${tasksToShow.length}`);
        return tasksToShow;
    }

    private buildTaskFilterSignature(taskIds: (string | number)[]): string {
        if (taskIds.length === 0) return "EMPTY";
        const normalized = taskIds.map((id) => String(id)).sort();
        return `${normalized.length}:${normalized.join("|")}`;
    }

    private applyTaskFilter(taskIds: (string | number)[]): void {
        if (!this.taskIdTable || !this.taskIdColumn) {
            this.lastTaskFilterSignature = null;
            return;
        }
        if (!this.allowInteractions && taskIds.length > 0) {
            this.debugLog("Allow interactions disabled; skipping filter update.");
            return;
        }

        const signature = this.buildTaskFilterSignature(taskIds);
        if (signature === this.lastTaskFilterSignature) {
            return;
        }

        const filter: IBasicFilter = {
            // eslint-disable-next-line powerbi-visuals/no-http-string
            $schema: "http://powerbi.com/product/schema#basic",
            target: {
                table: this.taskIdTable,
                column: this.taskIdColumn
            },
            filterType: FilterType.Basic,
            operator: "In",
            values: taskIds
        };

        const action = taskIds.length > 0 ? FilterAction.merge : FilterAction.remove;
        this.host.applyJsonFilter(filter, "general", "filter", action);
        this.lastTaskFilterSignature = signature;
    }

    private displayMessage(message: string): void {
        this.debugLog("Displaying Message:", message);

        this.applyTaskFilter([]);

        this.clearLandingPage();

        const containerNode = this.scrollableContainer?.node();
        if (!containerNode || !this.mainSvg || !this.headerSvg) {
            console.error("Cannot display message, containers or svgs not ready.");
            return;
        }
        this.clearVisual();

        const width = containerNode?.clientWidth || 300;
        const height = containerNode?.clientHeight || Math.max(100, this.target.clientHeight - this.headerHeight);

        this.mainSvg.attr("width", width).attr("height", height);
        this.mainGroup?.attr("transform", null);

        this.mainSvg.append("text")
            .attr("class", "message-text")
            .attr("x", width / 2)
            .attr("y", height / 2)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "middle")
            .style("fill", this.resolveColor("#777777", "foreground"))
            .style("font-size", "14px")
            .style("font-weight", "bold")
            .text(message);

        const viewportWidth = this.lastUpdateOptions?.viewport.width || width;
        this.createOrUpdateToggleButton(viewportWidth);
        this.drawHeaderDivider(viewportWidth);
    }

    private createpathSelectionDropdown(): void {
        if (!this.dropdownContainer || !this.selectedTaskLabel) {
            console.warn("Dropdown elements not ready.");
            return;
        }

        const enableTaskSelection = this.settings.pathSelection.enableTaskSelection.value;
        const viewportWidth = this.lastUpdateOptions?.viewport?.width || 800;
        const secondRowLayout = this.getSecondRowLayout(viewportWidth);
        const dropdownWidth = secondRowLayout.dropdown.width;
        const showSelectedTaskLabel = this.settings.pathSelection.showSelectedTaskLabel.value;
        const searchPlaceholder = this.getLocalizedString("ui.searchPlaceholder", "Search for a task...");
        const selectedLabelPrefix = this.getLocalizedString("ui.selectedLabel", "Selected");

        this.dropdownContainer.style("display", enableTaskSelection ? "block" : "none");
        if (!enableTaskSelection) {
            this.selectedTaskLabel.style("display", "none");
            return;
        }

        this.dropdownContainer.selectAll("*").remove();

        this.dropdownContainer
            .style("position", "absolute")
            .style("top", "40px")
            .style("left", `${secondRowLayout.dropdown.left}px`)
            .style("right", "auto")
            .style("transform", "none")
            .style("z-index", "20");

        this.dropdownInput = this.dropdownContainer.append("input")
            .attr("type", "text")
            .attr("class", "task-selection-input")
            .attr("placeholder", searchPlaceholder)
            .attr("role", "combobox")
            .attr("aria-autocomplete", "list")
            .attr("aria-expanded", "false")
            .attr("aria-controls", this.dropdownListId)
            .attr("aria-haspopup", "listbox")
            .attr("aria-activedescendant", null)
            .attr("aria-label", searchPlaceholder)
            .style("width", `${dropdownWidth}px`)
            .style("height", `${this.UI_TOKENS.height.compact}px`)
            .style("padding", `0 ${this.UI_TOKENS.spacing.lg}px`)
            .style("border", `1.5px solid ${this.UI_TOKENS.color.neutral.grey60}`)
            .style("border-radius", `${this.UI_TOKENS.radius.medium}px`)
            .style("font-family", "Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif")
            .style("font-size", `${this.UI_TOKENS.fontSize.lg}px`)
            .style("color", this.UI_TOKENS.color.neutral.grey160)
            .style("background", this.UI_TOKENS.color.neutral.white)
            .style("box-sizing", "border-box")
            .style("outline", "none")
            .style("box-shadow", this.UI_TOKENS.shadow[2])
            .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

        const selfRef = this;
        this.dropdownInput
            .on("focus", function () {
                d3.select(this)
                    .style("border-color", selfRef.UI_TOKENS.color.primary.default)
                    .style("border-width", "2px")
                    .style("box-shadow", selfRef.UI_TOKENS.shadow[4]);
            })
            .on("blur", function () {
                d3.select(this)
                    .style("border-color", selfRef.UI_TOKENS.color.neutral.grey60)
                    .style("border-width", "1.5px")
                    .style("box-shadow", selfRef.UI_TOKENS.shadow[2]);
            });

        this.dropdownList = this.dropdownContainer.append("div")
            .attr("class", "task-selection-list")
            .attr("id", this.dropdownListId)
            .attr("role", "listbox")
            .attr("aria-label", this.getLocalizedString("ui.taskListLabel", "Task results"))
            .style("position", "absolute")
            .style("top", "100%")
            .style("left", "0")
            .style("width", `${dropdownWidth}px`)
            .style("max-height", "400px")
            .style("margin-top", `${this.UI_TOKENS.spacing.xs}px`)
            .style("overflow-y", "auto")
            .style("background", this.UI_TOKENS.color.neutral.white)
            .style("border", `1.5px solid ${this.UI_TOKENS.color.neutral.grey60}`)
            .style("border-radius", `${this.UI_TOKENS.radius.medium}px`)
            .style("box-shadow", this.UI_TOKENS.shadow[8])
            .style("display", "none")
            .style("z-index", "1000")
            .style("box-sizing", "border-box");
        this.dropdownNeedsRefresh = true;

        const self = this;

        this.dropdownList
            .on("mousedown", () => {
                this.isDropdownInteracting = true;
            })
            .on("mouseup", () => {

                setTimeout(() => {
                    this.isDropdownInteracting = false;
                }, 50);
            });

        this.dropdownInput
            .on("input", function () {
                const inputValue = (this as HTMLInputElement).value.trim();
                if (self.dropdownFilterTimeout) {
                    clearTimeout(self.dropdownFilterTimeout);
                }
                self.dropdownFilterTimeout = window.setTimeout(() => {
                    self.renderTaskDropdown(inputValue);
                    self.openDropdown();
                }, 120);
            })
            .on("focus", function () {
                self.renderTaskDropdown((this as HTMLInputElement).value.trim());
                self.openDropdown();

                self.stickyHeaderContainer?.selectAll(".trace-mode-toggle")
                    .style("pointer-events", "none");
            })
            .on("blur", function (event: FocusEvent) {
                // Phase 1: Improved blur handling - check if focus moved within dropdown
                const relatedTarget = event.relatedTarget as HTMLElement | null;
                const dropdownNode = self.dropdownList?.node();
                const inputNode = self.dropdownInput?.node();

                // Don't close if focus moved to the dropdown list or stayed in input
                if (relatedTarget && (dropdownNode?.contains(relatedTarget) || inputNode === relatedTarget)) {
                    return;
                }

                // Use longer delay and smarter detection
                setTimeout(() => {
                    if (!self.isDropdownInteracting) {
                        self.closeDropdown(false);
                    }

                    self.stickyHeaderContainer?.selectAll(".trace-mode-toggle")
                        .style("pointer-events", "auto");
                }, 200);
            })
            .on("keydown", function (event: KeyboardEvent) {
                if (event.key === "ArrowDown") {
                    event.preventDefault();
                    self.moveDropdownActive(1);
                } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    self.moveDropdownActive(-1);
                } else if (event.key === "Enter") {
                    event.preventDefault();
                    self.activateDropdownSelection();
                } else if (event.key === "Escape") {
                    self.isDropdownInteracting = false;
                    self.closeDropdown(true);

                    self.stickyHeaderContainer?.selectAll(".trace-mode-toggle")
                        .style("pointer-events", "auto");

                    event.preventDefault();
                }
            });

        if (this.selectedTaskId && this.selectedTaskName) {
            this.dropdownInput.property("value", this.selectedTaskName);
        }

        if (this.selectedTaskLabel) {

            this.selectedTaskLabel
                .style("position", "absolute")
                .style("top", "10px")
                .style("right", "15px")
                .style("left", "auto");

            if (this.selectedTaskId && this.selectedTaskName && showSelectedTaskLabel) {
                this.selectedTaskLabel
                    .style("display", "block")
                    .text(`${selectedLabelPrefix}: ${this.selectedTaskName}`);
            } else {
                this.selectedTaskLabel.style("display", "none");
            }
        }
    }

    private normalizeTraceMode(value: unknown): "backward" | "forward" {
        return value === "forward" ? "forward" : "backward";
    }

    /**
     * Creates the trace mode toggle (Backward/Forward) positioned on the second header row.
     */
    private createTraceModeToggle(): void {
        if (!this.stickyHeaderContainer || !this.settings?.pathSelection) return;

        this.stickyHeaderContainer.selectAll(".trace-mode-toggle").remove();

        if (!this.settings.pathSelection.enableTaskSelection.value) {
            return;
        }
        if (!this.selectedTaskId) {
            return;
        }

        const viewportWidth = this.lastUpdateOptions?.viewport?.width || 800;
        const secondRowLayout = this.getSecondRowLayout(viewportWidth);
        const layoutMode = this.getLayoutMode(viewportWidth);
        const isCompact = layoutMode === "narrow";
        const isMedium = layoutMode === "medium";

        const labelBackward = isCompact ? "Back" : (isMedium ? "Backward" : "Trace Backward");
        const labelForward = isCompact ? "Fwd" : (isMedium ? "Forward" : "Trace Forward");
        const configuredMode = this.normalizeTraceMode(this.settings.pathSelection.traceMode.value.value);
        const currentMode = this.normalizeTraceMode(this.traceMode || configuredMode);
        this.traceMode = currentMode;

        const container = this.stickyHeaderContainer.append("div")
            .attr("class", "trace-mode-toggle")
            .attr("role", "radiogroup")
            .attr("aria-label", this.getLocalizedString("ui.traceModeLabel", "Trace Mode"))
            .style("position", "absolute")
            .style("top", "40px")
            .style("left", `${secondRowLayout.traceModeToggle.left}px`)
            .style("display", "inline-flex")
            .style("align-items", "center")
            .style("height", `${this.UI_TOKENS.height.compact}px`)
            .style("padding", "2px")
            .style("gap", "2px")
            .style("background-color", this.UI_TOKENS.color.neutral.white)
            .style("border", `1.5px solid ${this.UI_TOKENS.color.neutral.grey60}`)
            .style("border-radius", `${this.UI_TOKENS.radius.pill}px`)
            .style("box-shadow", this.UI_TOKENS.shadow[2])
            .style("z-index", "25")
            .style("user-select", "none");

        const self = this;
        const setMode = (mode: string): void => {
            if (self.traceMode === mode) return;
            self.traceMode = mode;

            self.host.persistProperties({
                merge: [{
                    objectName: "persistedState",
                    properties: { traceMode: mode },
                    selector: null
                }]
            });

            self.captureScrollPosition();
            self.forceFullUpdate = true;
            if (self.lastUpdateOptions) {
                self.update(self.lastUpdateOptions);
            }
        };

        const options = [
            { value: "backward", label: labelBackward, title: "Trace backward from the selected task" },
            { value: "forward", label: labelForward, title: "Trace forward from the selected task" }
        ];

        for (const option of options) {
            const isActive = option.value === currentMode;
            const button = container.append("div")
                .attr("class", `trace-mode-option ${option.value}`)
                .attr("role", "radio")
                .attr("aria-checked", isActive ? "true" : "false")
                .attr("tabindex", isActive ? "0" : "-1")
                .attr("aria-label", option.title)
                .style("display", "flex")
                .style("align-items", "center")
                .style("justify-content", "center")
                .style("height", `${this.UI_TOKENS.height.compact - 6}px`)
                .style("padding", `0 ${isCompact ? this.UI_TOKENS.spacing.sm : this.UI_TOKENS.spacing.md}px`)
                .style("border-radius", `${this.UI_TOKENS.radius.pill}px`)
                .style("font-family", "Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif")
                .style("font-size", `${this.UI_TOKENS.fontSize.sm}px`)
                .style("font-weight", isActive ? this.UI_TOKENS.fontWeight.semibold.toString() : this.UI_TOKENS.fontWeight.medium.toString())
                .style("color", isActive ? this.UI_TOKENS.color.neutral.white : this.UI_TOKENS.color.neutral.grey130)
                .style("background-color", isActive ? this.UI_TOKENS.color.primary.default : "transparent")
                .style("cursor", "pointer")
                .style("transition", `all ${this.UI_TOKENS.motion.duration.fast}ms ${this.UI_TOKENS.motion.easing.smooth}`)
                .text(option.label);

            button.append("title").text(option.title);

            button
                .on("mouseover", function () {
                    if (option.value !== self.traceMode) {
                        d3.select(this)
                            .style("background-color", self.UI_TOKENS.color.primary.light)
                            .style("color", self.UI_TOKENS.color.primary.default);
                    }
                })
                .on("mouseout", function () {
                    if (option.value !== self.traceMode) {
                        d3.select(this)
                            .style("background-color", "transparent")
                            .style("color", self.UI_TOKENS.color.neutral.grey130);
                    }
                })
                .on("click", function (event) {
                    event.stopPropagation();
                    setMode(option.value);
                })
                .on("keydown", function (event: KeyboardEvent) {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setMode(option.value);
                    }
                });
        }
    }
    /**
     * Populates the task dropdown with tasks from the dataset
     */
    private populateTaskDropdown(): void {
        if (!this.dropdownList || !this.settings?.pathSelection?.enableTaskSelection?.value) {
            console.warn("Dropdown list not initialized");
            return;
        }

        this.refreshDropdownCache();
        const currentSearch = this.dropdownInput
            ? String(this.dropdownInput.property("value") ?? "")
            : "";
        this.renderTaskDropdown(currentSearch.trim());
    }

    /**
     * Filters the dropdown items based on input text
     */
    private filterTaskDropdown(searchText: string = ""): void {
        this.renderTaskDropdown(searchText);
    }

    private refreshDropdownCache(): void {
        if (!this.dropdownNeedsRefresh && this.dropdownTaskCache.length > 0) return;

        const realTasks = this.allTasksData.filter(task => task.type !== "Synthetic");
        this.dropdownTaskCache = [...realTasks].sort((a, b) =>
            (a.name || "").localeCompare(b.name || ""));
        this.dropdownNeedsRefresh = false;
    }

    private renderTaskDropdown(searchText: string): void {
        if (!this.dropdownList) return;

        this.refreshDropdownCache();

        const searchLower = searchText.toLowerCase().trim();
        const clearSelectionText = this.getLocalizedString("ui.clearSelection", "Clear Selection");
        const noResultsText = this.getLocalizedString("ui.noTasksMatching", "No tasks matching");
        const noTasksText = this.getLocalizedString("ui.noTasksAvailable", "No tasks available");
        const moreResultsText = this.getLocalizedString("ui.moreResults", "Type to refine results");

        if (this.dropdownTaskCache.length === 0) {
            console.warn("No tasks available to populate dropdown");

            this.dropdownList.selectAll("*").remove();
            this.dropdownList.append("div")
                .attr("class", "dropdown-item no-data")
                .attr("role", "presentation")
                .text(noTasksText)
                .style("padding", "8px 10px")
                .style("color", "#999")
                .style("font-style", "italic")
                .style("font-size", "11px")
                .style("font-family", "Segoe UI, sans-serif");
            this.dropdownFocusableItems = [];
            this.dropdownActiveIndex = -1;
            this.updateDropdownActiveState();
            return;
        }

        const matches = searchLower
            ? this.dropdownTaskCache.filter(task =>
                (task.name || "").toLowerCase().includes(searchLower))
            : this.dropdownTaskCache;

        const limited = matches.slice(0, this.DROPDOWN_MAX_RESULTS);
        const hasMore = matches.length > limited.length;

        const items: DropdownItem[] = [];
        items.push({ id: `${this.dropdownListId}-clear`, type: "clear", label: clearSelectionText, focusable: true });

        if (limited.length === 0) {
            items.push({
                id: `${this.dropdownListId}-empty`,
                type: "empty",
                label: `${noResultsText} "${searchText}"`,
                focusable: false
            });
        } else {
            for (const task of limited) {
                const label = task.name || `Task ${task.internalId}`;
                items.push({
                    id: `${this.dropdownListId}-task-${task.internalId}`,
                    type: "task",
                    label,
                    task,
                    focusable: true
                });
            }
            if (hasMore) {
                items.push({
                    id: `${this.dropdownListId}-overflow`,
                    type: "overflow",
                    label: moreResultsText,
                    focusable: false
                });
            }
        }

        this.dropdownFocusableItems = items.filter(item => item.focusable);

        const selectedIndex = this.dropdownFocusableItems.findIndex(item =>
            item.type === "task" && item.task?.internalId === this.selectedTaskId);
        if (selectedIndex >= 0) {
            this.dropdownActiveIndex = selectedIndex;
        } else if (this.dropdownActiveIndex < 0 && this.dropdownFocusableItems.length > 0) {
            this.dropdownActiveIndex = 0;
        } else if (this.dropdownActiveIndex >= this.dropdownFocusableItems.length) {
            this.dropdownActiveIndex = this.dropdownFocusableItems.length - 1;
        }

        this.dropdownList.selectAll("*").remove();

        const self = this;
        let focusIndex = -1;

        for (const item of items) {
            const isFocusable = item.focusable;
            const thisFocusIndex = isFocusable ? ++focusIndex : -1;
            const isActive = thisFocusIndex === this.dropdownActiveIndex;
            const isSelected = item.type === "task" && item.task?.internalId === this.selectedTaskId;

            const defaultBg = isSelected ? "#f0f0f0" : "white";
            const row = this.dropdownList.append("div")
                .attr("class", `dropdown-item ${item.type}`)
                .attr("id", item.id)
                .attr("role", isFocusable ? "option" : "presentation")
                .attr("aria-selected", isFocusable ? (isSelected ? "true" : "false") : null)
                .attr("data-selected", isSelected ? "true" : "false")
                .attr("data-default-bg", defaultBg)
                .style("padding", isFocusable ? "6px 10px" : "8px 10px")
                .style("cursor", isFocusable ? "pointer" : "default")
                .style("color", item.type === "clear" ? "#666" : (item.type === "empty" || item.type === "overflow" ? "#999" : "#333"))
                .style("font-style", item.type === "clear" || item.type === "empty" || item.type === "overflow" ? "italic" : "normal")
                .style("border-bottom", item.type === "task" ? "1px solid #f5f5f5" : "1px solid #eee")
                .style("white-space", "normal")
                .style("word-wrap", "break-word")
                .style("overflow-wrap", "break-word")
                .style("line-height", "1.4")
                .style("font-size", item.type === "task" ? "11px" : "10px")
                .style("font-family", "Segoe UI, sans-serif")
                .style("background-color", isActive ? "#e6f7ff" : defaultBg)
                .style("font-weight", isSelected ? "600" : "normal")
                .text(item.label);

            if (item.type === "task" && item.task) {
                row.attr("data-task-id", item.task.internalId)
                    .attr("data-task-name", item.label)
                    .attr("title", item.label);
            }

            if (isFocusable) {
                row.on("mouseover", function () {
                    (this as HTMLDivElement).style.backgroundColor = "#e6f7ff";
                })
                    .on("mouseout", function () {
                        self.updateDropdownActiveState();
                    })
                    .on("mousedown", function (event: MouseEvent) {
                        event.preventDefault();
                        event.stopPropagation();
                        self.dropdownActiveIndex = thisFocusIndex;
                        self.updateDropdownActiveState();
                        self.activateDropdownSelection();
                    });
            }
        }

        this.updateDropdownActiveState();
    }

    private openDropdown(): void {
        if (!this.dropdownList || !this.dropdownInput) return;
        this.dropdownList.style("display", "block");
        this.dropdownInput.attr("aria-expanded", "true");
    }

    private closeDropdown(clearSelection: boolean): void {
        if (!this.dropdownList || !this.dropdownInput) return;

        if (clearSelection) {
            this.selectTask(null, null);
            this.dropdownInput.property("value", "");
        }

        this.dropdownList.style("display", "none");
        this.dropdownInput.attr("aria-expanded", "false");
        this.dropdownActiveIndex = -1;
        this.updateDropdownActiveState();
        this.isDropdownInteracting = false;
    }

    private moveDropdownActive(delta: number): void {
        const count = this.dropdownFocusableItems.length;
        if (count === 0) return;

        if (this.dropdownActiveIndex < 0) {
            this.dropdownActiveIndex = 0;
        } else {
            this.dropdownActiveIndex = (this.dropdownActiveIndex + delta + count) % count;
        }
        this.updateDropdownActiveState();
    }

    private activateDropdownSelection(): void {
        const item = this.dropdownFocusableItems[this.dropdownActiveIndex];
        if (!item || !this.dropdownInput || !this.dropdownList) return;

        if (item.type === "clear") {
            this.selectTask(null, null);
            this.dropdownInput.property("value", "");
            this.closeDropdown(false);
            this.stickyHeaderContainer?.selectAll(".trace-mode-toggle")
                .style("pointer-events", "auto");
            return;
        }

        if (item.type === "task" && item.task) {
            this.selectTask(item.task.internalId, item.task.name);
            this.dropdownInput.property("value", item.label);
            this.closeDropdown(false);
            this.stickyHeaderContainer?.selectAll(".trace-mode-toggle")
                .style("pointer-events", "auto");
        }
    }

    private updateDropdownActiveState(): void {
        if (!this.dropdownList || !this.dropdownInput) return;

        const activeItem = this.dropdownFocusableItems[this.dropdownActiveIndex];
        const activeId = activeItem ? activeItem.id : "";

        this.dropdownInput.attr("aria-activedescendant", activeId || null);

        this.dropdownList.selectAll<HTMLDivElement, unknown>(".dropdown-item[role=\"option\"]")
            .each(function () {
                const node = this as HTMLDivElement;
                const isActive = node.id === activeId;
                const defaultBg = node.getAttribute("data-default-bg") || "white";
                const isSelected = node.getAttribute("data-selected") === "true";
                node.setAttribute("aria-selected", isSelected ? "true" : "false");
                node.style.backgroundColor = isActive ? "#e6f7ff" : defaultBg;
            });

        if (activeId) {
            const node = document.getElementById(activeId);
            if (node) {
                node.scrollIntoView({ block: "nearest" });
            }
        }
    }

    private selectTask(taskId: string | null, taskName: string | null): void {

        if (this.selectedTaskId === taskId && taskId !== null) {
            taskId = null;
            taskName = null;
        }

        const taskChanged = this.selectedTaskId !== taskId;

        if (!taskChanged) {
            return;
        }

        this.selectedTaskId = taskId;
        this.selectedTaskName = taskName;
        const selectedLabelPrefix = this.getLocalizedString("ui.selectedLabel", "Selected");

        const selectionId = taskId ? this.taskIdToTask.get(taskId)?.selectionId : null;
        if (this.allowInteractions && this.selectionManager) {
            if (selectionId) {
                this.selectionManager.select(selectionId as unknown as powerbi.extensibility.ISelectionId);
            } else {
                this.selectionManager.clear();
            }
        }

        this.createTraceModeToggle();

        if (this.dropdownInput) {
            this.dropdownInput.property("value", taskName || "");
        }

        if (this.selectedTaskLabel) {
            if (taskId && taskName && this.settings.pathSelection.showSelectedTaskLabel.value) {
                this.selectedTaskLabel
                    .style("display", "block")
                    .text(`${selectedLabelPrefix}: ${taskName}`);
            } else {
                this.selectedTaskLabel.style("display", "none");
            }
        }

        this.host.persistProperties({
            merge: [{
                objectName: "persistedState",
                properties: { selectedTaskId: this.selectedTaskId || "" },
                selector: null
            }]
        });

        this.forceCanvasRefresh();

        if (taskId) {
            requestAnimationFrame(() => {
                this.ensureTaskVisible(taskId);
            });
        }

        this.forceFullUpdate = true;
        if (this.lastUpdateOptions) {
            this.update(this.lastUpdateOptions);
        }
    }

    private ensureTaskVisible(taskId: string): void {
        const task = this.taskIdToTask.get(taskId);
        if (!task || task.yOrder === undefined) return;

        const taskIndex = task.yOrder;

        if (taskIndex < this.viewportStartIndex || taskIndex > this.viewportEndIndex) {

            const containerNode = this.scrollableContainer.node();
            const viewportHeight = containerNode.clientHeight;
            const targetScrollTop = (taskIndex * this.taskElementHeight) -
                (viewportHeight / 2) + (this.taskElementHeight / 2);

            containerNode.scrollTop = Math.max(0, targetScrollTop);

            this.handleScroll();
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        this.debugLog("getFormattingModel called");
        if (!this.formattingSettingsService) {
            console.error("FormattingSettingsService not initialized before getFormattingModel call.");
            return { cards: [] };
        }

        if (!this.settings && this.lastUpdateOptions?.dataViews?.[0]) {
            this.settings = this.formattingSettingsService.populateFormattingSettingsModel(VisualSettings, this.lastUpdateOptions.dataViews[0]);
        } else if (!this.settings) {

            this.settings = new VisualSettings();
        }

        if (this.legendDataExists && this.legendCategories.length > 0 && this.settings?.legendColors) {
            const ColorPicker = formattingSettings.ColorPicker;

            this.settings.legendColors.displayName = "Data Colors";

            const slices: formattingSettings.Slice[] = [];
            for (let i = 0; i < this.legendCategories.length && i < 20; i++) {
                const category = this.legendCategories[i];
                const colorKey = `color${i + 1}`;

                const currentColor = this.legendColorMap.get(category) || "#000000";

                const colorPicker = new ColorPicker({
                    name: colorKey,
                    displayName: category,
                    value: { value: currentColor }
                });

                slices.push(colorPicker);
            }

            this.settings.legendColors.slices = slices;
        } else if (this.settings?.legendColors) {

            this.settings.legendColors.visible = false;
        }

        if (this.settings?.wbsLevelStyles) {
            const levelNames = this.wbsLevelColumnNames || [];
            const wbsLevelStyles = this.settings.wbsLevelStyles as any;
            const maxLevel = 10;

            for (let level = 1; level <= maxLevel; level++) {
                const levelName = levelNames[level - 1];
                const backgroundLabel = levelName
                    ? `Level ${level} (${levelName}) Background`
                    : `Level ${level} Background`;
                const textLabel = levelName
                    ? `Level ${level} (${levelName}) Text`
                    : `Level ${level} Text`;

                const backgroundSlice = wbsLevelStyles[`level${level}Background`];
                const textSlice = wbsLevelStyles[`level${level}Text`];

                if (backgroundSlice) backgroundSlice.displayName = backgroundLabel;
                if (textSlice) textSlice.displayName = textLabel;
            }
        }

        const formattingModel = this.formattingSettingsService.buildFormattingModel(this.settings);

        return formattingModel;
    }

    /**
     * Toggle a legend category on/off for filtering
     */
    private toggleLegendCategory(category: string): void {

        if (this.selectedLegendCategories.size === 0) {
            this.selectedLegendCategories.add(category);
        } else {

            if (this.selectedLegendCategories.has(category)) {
                this.selectedLegendCategories.delete(category);

                if (this.selectedLegendCategories.size === 0) {

                }
            } else {
                this.selectedLegendCategories.add(category);

                if (this.selectedLegendCategories.size === this.legendCategories.length) {
                    this.selectedLegendCategories.clear();
                }
            }
        }

        const selectedCategoriesStr = Array.from(this.selectedLegendCategories).join(',');
        this.host.persistProperties({
            merge: [{
                objectName: "persistedState",
                properties: { selectedLegendCategories: selectedCategoriesStr },
                selector: null
            }]
        });

        this.captureScrollPosition();
        this.forceFullUpdate = true;

        if (this.lastUpdateOptions) {
            this.update(this.lastUpdateOptions);
        }

        requestAnimationFrame(() => {
            this.drawZoomSliderMiniChart();
        });
    }

    /**
     * Render the legend UI in sticky footer with horizontal scrolling
     */
    private renderLegend(viewportWidth: number, viewportHeight: number): void {
        if (!this.legendContainer) return;

        const showLegend = this.settings.legend.show.value && this.legendDataExists && this.legendCategories.length > 0;

        if (!showLegend) {
            this.legendContainer.style("display", "none");
            return;
        }

        this.legendContainer.style("display", "block");

        const fontSize = this.settings.legend.fontSize.value;
        const showTitle = this.settings.legend.showTitle.value;
        const titleText = this.settings.legend.titleText.value || this.legendFieldName;

        this.legendContainer.selectAll("*").remove();

        const mainContainer = this.legendContainer.append("div")
            .attr("class", "legend-main")
            .style("display", "flex")
            .style("align-items", "center")
            .style("height", "100%")
            .style("padding", "8px 12px")
            .style("box-sizing", "border-box");

        const leftArrow = mainContainer.append("div")
            .attr("class", "legend-scroll-arrow legend-scroll-left")
            .attr("role", "button")
            .attr("aria-label", "Scroll legend left")
            .attr("tabindex", 0)
            .style("flex-shrink", "0")
            .text("<");

        const scrollWrapper = mainContainer.append("div")
            .attr("class", "legend-scroll-wrapper")
            .style("flex", "1")
            .style("overflow", "hidden")
            .style("position", "relative");

        const scrollableContent = scrollWrapper.append("div")
            .attr("class", "legend-scroll-content")
            .style("display", "flex")
            .style("gap", "20px")
            .style("align-items", "center")
            .style("transition", "transform 0.3s ease")
            .style("padding", "5px 0");

        if (showTitle && titleText) {
            scrollableContent.append("div")
                .attr("class", "legend-title")
                .style("font-size", `${fontSize + 1}px`)
                .style("white-space", "nowrap")
                .text(`${titleText}:`);
        }

        const selectedCount = this.selectedLegendCategories.size === 0 ? this.legendCategories.length : this.selectedLegendCategories.size;
        const totalCount = this.legendCategories.length;

        scrollableContent.append("div")
            .attr("class", "legend-count")
            .style("font-size", `${fontSize - 1}px`)
            .style("white-space", "nowrap")
            .attr("title", "Number of visible categories")
            .text(`${selectedCount} of ${totalCount} shown`);

        this.legendCategories.forEach(category => {
            const color = this.legendColorMap.get(category) || "#999";

            const isSelected = this.selectedLegendCategories.size === 0 || this.selectedLegendCategories.has(category);

            const item = scrollableContent.append("div")
                .attr("class", "legend-item")
                .classed("is-selected", isSelected)
                .style("--legend-color", color)
                .attr("data-category", category)

                .attr("role", "button")
                .attr("aria-label", `${isSelected ? 'Hide' : 'Show'} ${category} tasks. Click to toggle visibility.`)
                .attr("aria-pressed", isSelected ? "true" : "false")
                .attr("tabindex", 0)

                .attr("title", `Click to ${isSelected ? 'hide' : 'show'} "${category}" tasks`)
                .style("display", "flex")
                .style("align-items", "center")
                .style("gap", "6px")
                .style("flex-shrink", "0")
                .style("cursor", "pointer")
                .style("user-select", "none")
                // Enhanced contrast: reduce opacity for unselected items
                .style("opacity", isSelected ? "1" : "0.3")
                .style("filter", isSelected ? "none" : "grayscale(50%)")
                .style("transition", "opacity 0.2s ease, transform 0.15s ease, filter 0.2s ease");

            item.append("div")
                .attr("class", "legend-swatch")
                .style("width", "16px")
                .style("height", "16px")
                // Enhanced contrast: show hollow swatch for unselected items
                .style("background-color", isSelected ? color : "transparent")
                .style("border", `2px solid ${color}`)
                .style("border-radius", "3px")
                .style("flex-shrink", "0")
                .style("box-shadow", isSelected ? `0 2px 5px rgba(0,0,0,0.2)` : "none")
                .style("transform", isSelected ? "scale(1.1)" : "scale(1)")
                .style("transition", "all 0.2s ease");

            item.append("span")
                .attr("class", "legend-label")
                .style("font-size", `${fontSize}px`)
                .style("white-space", "nowrap")
                // Enhanced contrast: color fade for unselected
                .style("text-decoration", "none")
                .style("color", isSelected ? "inherit" : "#aaa")
                .style("font-weight", isSelected ? "600" : "400")
                .text(category);

            item.on("click", () => {
                this.toggleLegendCategory(category);
            });

            item.on("keydown", (event: KeyboardEvent) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    this.toggleLegendCategory(category);
                }
            });

            // Add hover effect for better interactivity feedback
            item.on("mouseenter", function () {
                d3.select(this)
                    .style("opacity", isSelected ? "0.85" : "0.7")
                    .style("transform", "scale(1.02)");
            });

            item.on("mouseleave", function () {
                d3.select(this)
                    .style("opacity", isSelected ? "1" : "0.4")
                    .style("transform", "scale(1)");
            });

        });

        const rightArrow = mainContainer.append("div")
            .attr("class", "legend-scroll-arrow legend-scroll-right")
            .attr("role", "button")
            .attr("aria-label", "Scroll legend right")
            .attr("tabindex", 0)
            .style("flex-shrink", "0")
            .text(">");

        let scrollPosition = 0;
        const scrollAmount = 200;

        const updateArrowStates = () => {
            const contentWidth = (scrollableContent.node() as HTMLElement).scrollWidth;
            const wrapperWidth = (scrollWrapper.node() as HTMLElement).clientWidth;
            const maxScroll = Math.max(0, contentWidth - wrapperWidth);

            const leftDisabled = scrollPosition <= 0;
            const rightDisabled = scrollPosition >= maxScroll || maxScroll === 0;

            leftArrow
                .classed("is-disabled", leftDisabled)
                .attr("aria-disabled", leftDisabled ? "true" : "false");
            rightArrow
                .classed("is-disabled", rightDisabled)
                .attr("aria-disabled", rightDisabled ? "true" : "false");
        };

        const handleScrollLeft = () => {
            if (scrollPosition <= 0) return;
            scrollPosition = Math.max(0, scrollPosition - scrollAmount);
            scrollableContent.style("transform", `translateX(-${scrollPosition}px)`);
            updateArrowStates();
        };

        const handleScrollRight = () => {
            const contentWidth = (scrollableContent.node() as HTMLElement).scrollWidth;
            const wrapperWidth = (scrollWrapper.node() as HTMLElement).clientWidth;
            const maxScroll = Math.max(0, contentWidth - wrapperWidth);
            if (scrollPosition >= maxScroll) return;
            scrollPosition = Math.min(maxScroll, scrollPosition + scrollAmount);
            scrollableContent.style("transform", `translateX(-${scrollPosition}px)`);
            updateArrowStates();
        };

        leftArrow.on("click", handleScrollLeft);
        rightArrow.on("click", handleScrollRight);

        leftArrow.on("keydown", (event: KeyboardEvent) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleScrollLeft();
            }
        });

        rightArrow.on("keydown", (event: KeyboardEvent) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleScrollRight();
            }
        });

        setTimeout(() => updateArrowStates(), 0);
    }

    /**
     * Convert hex color to RGB object
     */
    private hexToRgb(hex: string): { r: number; g: number; b: number } {

        hex = hex.replace(/^#/, '');

        const bigint = parseInt(hex, 16);
        const r = (bigint >> 16) & 255;
        const g = (bigint >> 8) & 255;
        const b = bigint & 255;

        return { r, g, b };
    }

    private rgbToHex(r: number, g: number, b: number): string {
        const clamp = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));
        const toHex = (value: number): string => clamp(value).toString(16).padStart(2, '0');
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }

    private blendColors(colorA: string, colorB: string, weightA: number): string {
        const weight = Math.max(0, Math.min(1, weightA));
        const rgbA = this.hexToRgb(colorA);
        const rgbB = this.hexToRgb(colorB);
        const values = [rgbA.r, rgbA.g, rgbA.b, rgbB.r, rgbB.g, rgbB.b];
        if (values.some(value => Number.isNaN(value))) {
            return colorB;
        }
        const r = (rgbA.r * weight) + (rgbB.r * (1 - weight));
        const g = (rgbA.g * weight) + (rgbB.g * (1 - weight));
        const b = (rgbA.b * weight) + (rgbB.b * (1 - weight));
        return this.rgbToHex(r, g, b);
    }

    /**
     * Calculate luminance of a color (for contrast calculation)
     */
    private getLuminance(r: number, g: number, b: number): number {
        const a = [r, g, b].map(v => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
    }

    /**
     * Get contrasting text color (black or white) for a given background color
     */
    private getContrastColor(backgroundColor: string): string {
        const rgb = this.hexToRgb(backgroundColor);
        const luminance = this.getLuminance(rgb.r, rgb.g, rgb.b);

        return luminance > 0.5 ? '#000000' : '#FFFFFF';
    }

    /**
     * Get duration text color based on settings or auto-contrast
     */
    private getDurationTextColor(backgroundColor: string): string {
        const settingColor = this.settings.textAndLabels.durationTextColor.value.value;

        if (settingColor === "Auto" || !settingColor) {
            return this.getContrastColor(backgroundColor);
        }

        return settingColor;
    }

    private isNonEmptyColor(value: string | null | undefined): value is string {
        return typeof value === "string" && value.trim().length > 0;
    }

    private getWbsLevelStyle(level: number, fallbackBackground: string, fallbackText: string): { background: string; text: string } {
        const levelStyles = this.settings?.wbsLevelStyles as any;
        if (!levelStyles) {
            return { background: fallbackBackground, text: fallbackText };
        }

        const safeLevel = Math.max(1, level);
        const backgroundValue = levelStyles[`level${safeLevel}Background`]?.value?.value;
        const textValue = levelStyles[`level${safeLevel}Text`]?.value?.value;

        return {
            background: this.isNonEmptyColor(backgroundValue) ? backgroundValue : fallbackBackground,
            text: this.isNonEmptyColor(textValue) ? textValue : fallbackText
        };
    }

    private getLocalizedString(key: string, fallback: string): string {
        if (!this.localizationManager) return fallback;
        const value = this.localizationManager.getDisplayName(key);
        return value && value !== key ? value : fallback;
    }

    private updateHighContrastState(): void {
        const palette = this.host.colorPalette;
        this.highContrastMode = palette.isHighContrast;
        if (this.highContrastMode) {
            this.highContrastForeground = palette.foreground.value;
            this.highContrastBackground = palette.background.value;
            this.highContrastForegroundSelected = palette.foregroundSelected?.value || palette.foreground.value;
        }
    }

    private resolveColor(color: string, role: "foreground" | "background" | "selected" = "foreground"): string {
        if (!this.highContrastMode) return color;
        switch (role) {
            case "background":
                return this.highContrastBackground;
            case "selected":
                return this.highContrastForegroundSelected;
            default:
                return this.highContrastForeground;
        }
    }

    private getSelectionColor(): string {
        const settingColor = this.settings?.generalSettings?.selectionHighlightColor?.value?.value;
        return this.resolveColor(settingColor || "#0078D4", "selected");
    }

    private getForegroundColor(): string {
        return this.resolveColor("#000000", "foreground");
    }

    /**
     * Gets the visual background color from settings or returns white as default.
     */
    private getVisualBackgroundColor(): string {
        const settingColor = this.settings?.generalSettings?.visualBackgroundColor?.value?.value;
        return this.resolveColor(settingColor || "#FFFFFF", "background");
    }

    /**
     * Gets the font family from settings or returns the default system font stack.
     */
    private getFontFamily(): string {
        const settingFont = this.settings?.textAndLabels?.fontFamily?.value?.value;
        const defaultFont = "Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif";
        return (typeof settingFont === "string" && settingFont) ? settingFont : defaultFont;
    }

    private getBackgroundColor(): string {
        return this.resolveColor("#FFFFFF", "background");
    }

    private applyHighContrastStyling(): void {
        if (!this.highContrastMode) {
            // Use background color from settings
            const bgColor = this.getVisualBackgroundColor();
            this.stickyHeaderContainer?.style("background-color", bgColor);
            this.legendContainer?.style("background-color", bgColor);
            if (this.scrollableContainer) {
                this.scrollableContainer.style("background-color", bgColor);
            }
            if (this.tooltipDiv) {
                this.tooltipDiv
                    .style("background-color", bgColor)
                    .style("color", "#333")
                    .style("border", "1px solid #ddd");
            }
            return;
        }

        const foreground = this.highContrastForeground;
        const background = this.highContrastBackground;

        this.stickyHeaderContainer?.style("background-color", background);
        this.legendContainer?.style("background-color", background);

        this.selectedTaskLabel
            ?.style("background-color", background)
            .style("color", foreground)
            .style("border", `1px solid ${foreground}`);

        this.pathInfoLabel
            ?.style("background-color", background)
            .style("color", foreground)
            .style("border", `1.5px solid ${foreground}`);

        if (this.dropdownInput) {
            this.dropdownInput
                .style("color", foreground)
                .style("background", background)
                .style("border", `1.5px solid ${foreground}`);
        }

        if (this.dropdownList) {
            this.dropdownList
                .style("background", background)
                .style("border", `1.5px solid ${foreground}`);
        }

        if (this.tooltipDiv) {
            this.tooltipDiv
                .style("background-color", background)
                .style("color", foreground)
                .style("border", `1px solid ${foreground}`);
        }

        // Apply font family in high contrast mode too
        this.applyFontFamilySettings();
    }

    /**
     * Applies font family settings to all key UI components that display text.
     * Called during update to ensure fonts reflect settings changes.
     */
    private applyFontFamilySettings(): void {
        const fontFamily = this.getFontFamily();

        // Apply to dropdown input
        this.dropdownInput?.style("font-family", fontFamily);

        // Apply to dropdown list
        this.dropdownList?.style("font-family", fontFamily);

        // Apply to selected task label
        this.selectedTaskLabel?.style("font-family", fontFamily);

        // Apply to path info label
        this.pathInfoLabel?.style("font-family", fontFamily);

        // Apply to tooltip
        this.tooltipDiv?.style("font-family", fontFamily);

        // Apply to loading text elements
        this.loadingText?.style("font-family", fontFamily);
        this.loadingRowsText?.style("font-family", fontFamily);
        this.loadingProgressText?.style("font-family", fontFamily);

        // Apply to legend
        this.legendContainer?.style("font-family", fontFamily);

        // Apply to float threshold input
        this.floatThresholdInput?.style("font-family", fontFamily);

        // Apply to any other header text elements (like "Visible Tasks" label)
        this.headerSvg?.selectAll("text").style("font-family", fontFamily);
    }

    private formatTooltipValue(value: PrimitiveValue): string {
        if (value instanceof Date) return this.formatDate(value);
        if (typeof value === "number") return value.toLocaleString();
        if (value === null || value === undefined) return "";
        return String(value);
    }

    private buildTooltipDataItems(task: Task): VisualTooltipDataItem[] {
        const items: VisualTooltipDataItem[] = [];
        const mode = this.settings?.criticalPath?.calculationMode?.value?.value || "longestPath";

        const taskLabel = this.getLocalizedString("tooltip.task", "Task");
        const startLabel = this.getLocalizedString("tooltip.startDate", "Start Date");
        const finishLabel = this.getLocalizedString("tooltip.finishDate", "Finish Date");
        const modeLabel = this.getLocalizedString("tooltip.mode", "Mode");
        const statusLabel = this.getLocalizedString("tooltip.status", "Status");
        const durationLabel = this.getLocalizedString("tooltip.duration", "Remaining Duration");
        const totalFloatLabel = this.getLocalizedString("tooltip.totalFloat", "Total Float");
        const taskFreeFloatLabel = this.getLocalizedString("tooltip.taskFreeFloat", "Task Free Float");
        const nearCriticalLabel = this.getLocalizedString("tooltip.nearCriticalThreshold", "Near Critical Threshold");

        const modeValue = mode === "floatBased"
            ? this.getLocalizedString("tooltip.mode.floatBased", "Float-Based")
            : this.getLocalizedString("tooltip.mode.longestPath", "Longest Path");

        let statusValue = "";
        if (task.internalId === this.selectedTaskId) {
            statusValue = this.getLocalizedString("tooltip.status.selected", "Selected");
        } else if (task.isCritical) {
            statusValue = mode === "floatBased"
                ? this.getLocalizedString("tooltip.status.criticalFloat", "Critical (Float = 0)")
                : this.getLocalizedString("tooltip.status.criticalPath", "On Longest Path");
        } else if (task.isNearCritical) {
            statusValue = this.getLocalizedString("tooltip.status.nearCritical", "Near Critical");
        } else {
            statusValue = mode === "floatBased"
                ? this.getLocalizedString("tooltip.status.nonCritical", "Non-Critical")
                : this.getLocalizedString("tooltip.status.notOnPath", "Not on Longest Path");
        }

        if (task.name) {
            items.push({ displayName: taskLabel, value: task.name });
        }

        const startText = this.formatDate(task.startDate);
        if (startText) items.push({ displayName: startLabel, value: startText });

        const finishText = this.formatDate(task.finishDate);
        if (finishText) items.push({ displayName: finishLabel, value: finishText });

        items.push({ displayName: modeLabel, value: modeValue });
        items.push({ displayName: statusLabel, value: statusValue });

        if (mode === "floatBased") {
            if (task.userProvidedTotalFloat !== undefined) {
                items.push({ displayName: totalFloatLabel, value: `${task.userProvidedTotalFloat.toFixed(2)} days` });
            }
            if (task.taskFreeFloat !== undefined) {
                items.push({ displayName: taskFreeFloatLabel, value: `${task.taskFreeFloat.toFixed(2)} days` });
            }
        } else if (mode === "longestPath") {
            items.push({ displayName: durationLabel, value: `${task.duration} days` });
        }

        if (task.tooltipData && task.tooltipData.length > 0) {
            for (const item of task.tooltipData) {
                const formattedValue = this.formatTooltipValue(item.value);
                if (formattedValue !== "") {
                    items.push({ displayName: item.key, value: formattedValue });
                }
            }
        }

        if (this.showNearCritical && this.floatThreshold > 0) {
            items.push({ displayName: nearCriticalLabel, value: `${this.floatThreshold}` });
        }

        return items;
    }

    private getTooltipIdentities(task: Task): powerbi.extensibility.ISelectionId[] {
        if (task.selectionId) {
            return [task.selectionId as unknown as powerbi.extensibility.ISelectionId];
        }
        return [];
    }

    private moveTaskTooltip(event: MouseEvent): void {
        if (this.tooltipService && this.tooltipService.enabled() && this.lastTooltipItems.length > 0) {
            this.tooltipService.move({
                coordinates: [event.clientX, event.clientY],
                isTouchEvent: false,
                dataItems: this.lastTooltipItems,
                identities: this.lastTooltipIdentities
            });
            return;
        }

        if (this.tooltipDiv) {
            this.positionTooltip(this.tooltipDiv.node(), event);
        }
    }

    private showContextMenu(event: MouseEvent, task: Task): void {
        if (!this.allowInteractions || !this.selectionManager || !task.selectionId) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        this.selectionManager.showContextMenu(
            task.selectionId as unknown as powerbi.extensibility.ISelectionId,
            { x: event.clientX, y: event.clientY }
        );
    }

    private clearLandingPage(): void {
        if (this.landingPageContainer) {
            this.landingPageContainer.remove();
            this.landingPageContainer = null;
        }
    }

    private getRoleDisplayName(roleName: string): string {
        switch (roleName) {
            case "taskId":
                return this.getLocalizedString("role.taskId", "Task ID");
            case "taskName":
                return this.getLocalizedString("role.taskName", "Task Name");
            case "taskType":
                return this.getLocalizedString("role.taskType", "Task Type");
            case "duration":
                return this.getLocalizedString("role.duration", "Duration (Work Days)");
            case "taskTotalFloat":
                return this.getLocalizedString("role.taskTotalFloat", "Task Total Float");
            case "taskFreeFloat":
                return this.getLocalizedString("role.taskFreeFloat", "Task Free Float");
            case "startDate":
                return this.getLocalizedString("role.startDate", "Start Date");
            case "finishDate":
                return this.getLocalizedString("role.finishDate", "Finish Date");
            case "predecessorId":
                return this.getLocalizedString("role.predecessorId", "Predecessor ID");
            case "relationshipType":
                return this.getLocalizedString("role.relationshipType", "Relationship Type");
            case "relationshipLag":
                return this.getLocalizedString("role.relationshipLag", "Relationship Lag");
            case "relationshipFreeFloat":
                return this.getLocalizedString("role.relationshipFreeFloat", "Relationship Free Float");
            case "legend":
                return this.getLocalizedString("role.legend", "Legend");
            case "tooltip":
                return this.getLocalizedString("role.tooltip", "Tooltip");
            case "wbsLevels":
                return this.getLocalizedString("role.wbsLevels", "WBS Levels");
            case "baselineStartDate":
                return this.getLocalizedString("role.baselineStartDate", "Baseline Start Date");
            case "baselineFinishDate":
                return this.getLocalizedString("role.baselineFinishDate", "Baseline Finish Date");
            case "previousUpdateStartDate":
                return this.getLocalizedString("role.previousUpdateStartDate", "Previous Update Start Date");
            case "previousUpdateFinishDate":
                return this.getLocalizedString("role.previousUpdateFinishDate", "Previous Update Finish Date");
            case "dataDate":
                return this.getLocalizedString("role.dataDate", "Data Date");
            default:
                return roleName;
        }
    }

    private getMissingRequiredRoles(dataView: DataView): string[] {
        const mode = this.settings?.criticalPath?.calculationMode?.value?.value || "longestPath";
        const requiredRoles = ["taskId", "startDate", "finishDate"];
        requiredRoles.push(mode === "floatBased" ? "taskTotalFloat" : "duration");
        return requiredRoles.filter(role => !this.hasDataRole(dataView, role));
    }

    private displayLandingPage(missingRoles: string[] = []): void {
        if (!this.scrollableContainer) return;

        this.clearLandingPage();
        this.clearVisual();
        this.legendContainer?.style("display", "none");

        const titleText = this.getLocalizedString("landing.title", "Build your longest path view");
        const bodyText = this.getLocalizedString("landing.body", "Add the required fields to start analyzing your schedule.");
        const requiredTitle = this.getLocalizedString("landing.requiredFields", "Required fields");
        const optionalTitle = this.getLocalizedString("landing.optionalFields", "Optional fields");
        const missingSuffix = this.getLocalizedString("landing.missingSuffix", "(missing)");

        const mode = this.settings?.criticalPath?.calculationMode?.value?.value || "longestPath";
        const requiredRoles = ["taskId", "startDate", "finishDate", mode === "floatBased" ? "taskTotalFloat" : "duration"];
        const optionalRoles = [
            "taskName",
            "taskType",
            "predecessorId",
            "relationshipType",
            "relationshipLag",
            "relationshipFreeFloat",
            "legend",
            "tooltip",
            "wbsLevels",
            "baselineStartDate",
            "baselineFinishDate",
            "previousUpdateStartDate",
            "previousUpdateFinishDate",
            "dataDate",
            "taskFreeFloat"
        ];

        const missingSet = new Set(missingRoles);
        const container = this.scrollableContainer.append("div")
            .attr("class", "landing-page")
            .style("height", "100%")
            .style("width", "100%")
            .style("display", "flex")
            .style("align-items", "center")
            .style("justify-content", "center")
            .style("padding", "20px")
            .style("box-sizing", "border-box");

        this.landingPageContainer = container;

        const card = container.append("div")
            .style("max-width", "520px")
            .style("width", "100%")
            .style("padding", "20px 24px")
            .style("border-radius", "12px")
            .style("background", this.getBackgroundColor())
            .style("border", `1px solid ${this.getForegroundColor()}`)
            .style("color", this.getForegroundColor())
            .style("font-family", "Segoe UI, sans-serif")
            .style("box-shadow", "0 4px 12px rgba(0,0,0,0.08)");

        card.append("div")
            .style("font-size", "18px")
            .style("font-weight", "600")
            .style("margin-bottom", "8px")
            .text(titleText);

        card.append("div")
            .style("font-size", "13px")
            .style("color", this.getForegroundColor())
            .style("margin-bottom", "16px")
            .text(bodyText);

        const requiredSection = card.append("div").style("margin-bottom", "12px");
        requiredSection.append("div")
            .style("font-size", "12px")
            .style("font-weight", "600")
            .style("margin-bottom", "6px")
            .text(requiredTitle);

        const requiredList = requiredSection.append("ul")
            .style("margin", "0")
            .style("padding-left", "18px")
            .style("font-size", "12px");

        for (const role of requiredRoles) {
            const displayName = this.getRoleDisplayName(role);
            const isMissing = missingSet.has(role);
            requiredList.append("li")
                .style("margin-bottom", "4px")
                .text(isMissing ? `${displayName} ${missingSuffix}` : displayName);
        }

        const optionalSection = card.append("div");
        optionalSection.append("div")
            .style("font-size", "12px")
            .style("font-weight", "600")
            .style("margin-bottom", "6px")
            .text(optionalTitle);

        const optionalList = optionalSection.append("ul")
            .style("margin", "0")
            .style("padding-left", "18px")
            .style("font-size", "12px");

        for (const role of optionalRoles) {
            optionalList.append("li")
                .style("margin-bottom", "4px")
                .text(this.getRoleDisplayName(role));
        }
    }

    private debugLog(...args: unknown[]): void {
        if (this.debug) {
            console.log(...args);
        }
    }

}

