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
import { DataProcessor, ProcessedData } from "./data/DataProcessor";
import { Header, HeaderCallbacks, HeaderState } from "./components/Header";
import { Task, WBSGroup, Relationship, DropdownItem, UpdateType, BoundFieldState, DataQualityInfo } from "./data/Interfaces";
import { UI_TOKENS, LAYOUT_BREAKPOINTS, HEADER_DOCK_TOKENS } from "./utils/Theme";
import {
    buildDrivingEventGraph,
    calculateLongestDrivingPaths,
    expandBestDrivingPaths,
    getTaskEventNodeId,
    getTiedLatestFinishTaskIds,
    selectBestSinkNodeIds
} from "./utils/DrivingPathScoring";
import {
    getExportFloatText,
    getExportTaskType,
    normalizeLegendCategory,
    parsePersistedLegendSelection,
    sanitizeExportTextField,
    serializeLegendSelection
} from "./utils/VisualState";
import { buildDataSignature } from "./utils/DataSignature";

type DrivingChain = {
    tasks: Set<string>;
    relationships: Relationship[];
    totalDuration: number;
    startingTask: Task | null;
    endingTask?: Task | null;
};

type CornerRadii = {
    tl: number;
    tr: number;
    br: number;
    bl: number;
};

type TaskRenderStyle = {
    fillColor: string;
    strokeColor: string;
    strokeWidth: number;
    strokeOpacity: number;
    hoverStrokeColor: string;
    hoverStrokeWidth: number;
    hoverStrokeOpacity: number;
    shadowColor: string;
    shadowBlur: number;
    shadowOffsetY: number;
    svgFilter: string;
};

type BeforeDataDateOverlay = {
    x: number;
    width: number;
    corners: CornerRadii;
    dividerX: number | null;
};

type RelationshipRenderGeometry = {
    pathData: string;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
};

export class Visual implements IVisual {
    private static nextInstanceOrdinal: number = 0;
    /**
     * Keep the hidden formatting default and the runtime bootstrap in sync.
     * The initial render should default to "critical only" until persisted state says otherwise.
     */
    private static readonly DEFAULT_SHOW_ALL_TASKS: boolean = false;
    private static readonly DRIVING_PATH_MAX_PATHS: number = 200;
    private static readonly DRIVING_PATH_MAX_EXPANSIONS: number = 20000;

    private readonly instanceId: string;
    private target: HTMLElement;
    private visualWrapper: Selection<HTMLDivElement, unknown, null, undefined>;
    private host: IVisualHost;
    private formattingSettingsService: FormattingSettingsService;
    private settings: VisualSettings;
    private selectionManager: ISelectionManager;
    private tooltipService: ITooltipService | null = null;
    private localizationManager: ILocalizationManager;
    private eventService: IVisualEventService | null = null;
    private downloadService: IDownloadService | null = null;
    private isExporting: boolean = false;
    private forceSvgRenderingForExport: boolean = false;
    private exportButtonGroup: Selection<SVGGElement, unknown, null, undefined> | null = null;
    private allowInteractions: boolean = true;
    private highContrastMode: boolean = false;
    private highContrastForeground: string = "#000000";
    private highContrastBackground: string = "#FFFFFF";
    private highContrastForegroundSelected: string = "#000000";
    private lastTooltipItems: VisualTooltipDataItem[] = [];
    private lastTooltipIdentities: powerbi.extensibility.ISelectionId[] = [];

    private header: Header;
    private stickyHeaderContainer: Selection<HTMLDivElement, unknown, null, undefined>;
    private scrollableContainer: Selection<HTMLDivElement, unknown, null, undefined>;
    private headerSvg: Selection<SVGSVGElement, unknown, null, undefined>;
    private mainSvg: Selection<SVGSVGElement, unknown, null, undefined>;

    private mainGroup: Selection<SVGGElement, unknown, null, undefined>;
    private gridLayer: Selection<SVGGElement, unknown, null, undefined>;
    private labelGridLayer: Selection<SVGGElement, unknown, null, undefined>;
    private rowGridLayer: Selection<SVGGElement, unknown, null, undefined>;
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
    private readonly MAX_CANVAS_PIXEL_RATIO: number = 3;
    private readonly POWER_BI_CANVAS_SHARPNESS_SCALE: number = 1.25;
    private static readonly MIN_DATE_WIDTH: number = 80;
    private canvasLayer: Selection<HTMLCanvasElement, unknown, null, undefined>;
    private watermarkOverlay: Selection<HTMLDivElement, unknown, null, undefined>;
    private watermarkOverlayRaf: number | null = null;
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
    private dataQuality: DataQualityInfo;

    private showConnectorLinesInternal: boolean = true;
    private showExtraColumnsInternal: boolean = true;

    private wbsExpandedInternal: boolean = true;

    private showAllTasksInternal: boolean = Visual.DEFAULT_SHOW_ALL_TASKS;
    private showBaselineInternal: boolean = true;
    private showPreviousUpdateInternal: boolean = true;
    private isInitialLoad: boolean = true;

    /** Tracks which optional date-pair fields are bound and contain data */
    private boundFields: BoundFieldState = {
        baselineStartBound: false, baselineFinishBound: false,
        previousUpdateStartBound: false, previousUpdateFinishBound: false,
        baselineAvailable: false, previousUpdateAvailable: false
    };

    private debug: boolean = false;

    private margin = { top: 10, right: 100, bottom: 40, left: 280 };
    private headerHeight = 110;
    private readonly SECOND_ROW_TOP = 42; // Unified top position for second row elements
    private readonly HEADER_BAND_HEIGHT = 54;
    private readonly HEADER_CONTROLS_GAP = 8;
    private readonly HEADER_BOTTOM_PADDING = 4;
    private readonly HEADER_LINE_LABEL_EDGE_PADDING = 4;
    private readonly HEADER_LINE_LABEL_GAP = 6;
    private readonly HEADER_LINE_LABEL_MIN_HEIGHT = 18;
    private readonly HEADER_LINE_LABEL_PADDING_X = 6;
    private readonly HEADER_LINE_LABEL_PADDING_Y = 3;
    private readonly WBS_LEVEL_ACCENT_WIDTH = 4;
    private readonly WBS_TOGGLE_BOX_SIZE = 18;
    private readonly WBS_TASK_LABEL_INSET = 30;
    private legendFooterHeight = 52;
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
    private resizeObserver: ResizeObserver | null = null;

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
    private dropdownListId: string = "";
    private dropdownActiveIndex: number = -1;
    private dropdownFocusableItems: DropdownItem[] = [];
    private dropdownTaskCache: Task[] = [];
    private dropdownFilterTimeout: number | null = null;
    private readonly DROPDOWN_MAX_RESULTS: number = 500;
    private marginResizer: Selection<HTMLDivElement, unknown, null, undefined>;
    private selectedTaskLabel: Selection<HTMLDivElement, unknown, null, undefined>;
    private pathInfoLabel: Selection<HTMLDivElement, unknown, null, undefined>;
    private secondRowComparisonSummaryWidth: number = 0;
    private secondRowComparisonSummaryUsesRightLane: boolean = false;
    private pendingComparisonFinishSummaryEntries: Array<{
        className: string;
        targetDate: Date | null;
        showLabel: boolean;
        lineColor: string;
        lineWidth: number;
        lineStyle: string;
        labelColor: string;
        labelFontSize: number;
        labelBackgroundColor: string;
        labelBackgroundOpacity: number;
        labelPosition?: string;
        rowY: number;
        labelText: string;
        labelPriority?: number;
    }> = [];
    private warningBanner: Selection<HTMLDivElement, unknown, null, undefined>;
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
    private scrollThrottleTimeout: number | null = null;
    private scrollListener: (() => void) | null = null;
    private allTasksToShow: Task[] = [];
    private allFilteredTasks: Task[] = [];
    /** Durable snapshot of filtered tasks set only during full updateInternal.
     *  Never cleared by settings-only or viewport-only update cycles. */
    private _lastFilteredTasksForFinishLines: Task[] = [];
    private filterKeyword: string | null = null;

    private lastViewport: IViewport | null = null;

    private renderStartTime: number = 0;

    private predecessorIndex: Map<string, Set<string>> = new Map();
    private relationshipByPredecessor: Map<string, Relationship[]> = new Map();

    private legendDataExists: boolean = false;
    private legendColorMap: Map<string, string> = new Map();
    private legendCategories: string[] = [];
    private legendCategoriesInCurrentScope: string[] = [];
    private legendFieldName: string = "";
    private legendContainer: Selection<HTMLDivElement, unknown, null, undefined>;
    private selectedLegendCategories: Set<string> = new Set();
    private legendSelectionIds: Map<string, powerbi.visuals.ISelectionId> = new Map();
    private legendScrollPosition: number = 0;
    private lastLegendRenderSignature: string | null = null;

    private wbsDataExists: boolean = false;
    private wbsDataExistsInMetadata: boolean = false;
    private wbsLevelColumnIndices: number[] = [];
    private wbsLevelColumnNames: string[] = [];
    private lastWbsBindingSignature: string = "";
    private rememberedWbsGroupingEnabled: boolean | null = null;
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

    // Help overlay state
    private helpOverlayContainer: Selection<HTMLDivElement, unknown, null, undefined> | null = null;
    private isHelpOverlayVisible: boolean = false;
    private helpOverlayKeydownHandler: ((event: KeyboardEvent) => void) | null = null;
    private helpOverlayReturnFocusTarget: HTMLElement | null = null;
    private liveRegion: Selection<HTMLDivElement, unknown, null, undefined> | null = null;

    private relationshipIndex: Map<string, Relationship[]> = new Map();
    private hasUserProvidedFloat: boolean = false;

    private allDrivingChains: DrivingChain[] = [];
    private selectedPathIndex: number = 0;
    private drivingPathsTruncated: boolean = false;
    private drivingPathsTruncationMessage: string | null = null;
    private drivingPathExpansionCount: number = 0;

    private readonly VIEWPORT_CHANGE_THRESHOLD = 0.01;
    private forceFullUpdate: boolean = false;
    private preserveScrollOnUpdate: boolean = false;
    private preservedScrollTop: number | null = null;
    private scrollPreservationUntil: number = 0;
    private lastWbsToggleTimestamp: number = 0;
    private wbsToggleScrollAnchor: { groupId: string; visualOffset: number } | null = null;

    private tooltipClassName: string;
    private isUpdating: boolean = false;
    private isViewportTransitioning: boolean = false;
    private viewportResizeCooldownUntil: number = 0;
    private isMarginDragging: boolean = false;
    private dragStartChartWidth: number = 0;
    private scrollHandlerBackup: (() => void) | null = null;

    private updateDebounceTimeout: ReturnType<typeof setTimeout> | null = null;
    private pendingUpdate: VisualUpdateOptions | null = null;
    private readonly UPDATE_DEBOUNCE_MS = 30;
    private resizeSettleTimeout: ReturnType<typeof setTimeout> | null = null;
    private resizeSettleRaf: number | null = null;
    private settledResizeViewportKey: string | null = null;
    private readonly RESIZE_SETTLE_DEBOUNCE_MS = 80;

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

    private dataProcessor: DataProcessor;

    /**
     * Determines the current layout mode based on viewport width
     */
    private getLayoutMode(viewportWidth: number): 'wide' | 'medium' | 'narrow' {
        if (viewportWidth >= LAYOUT_BREAKPOINTS.wide) return 'wide';
        if (viewportWidth >= LAYOUT_BREAKPOINTS.medium) return 'medium';
        return 'narrow';
    }

    private getExtendedHeaderLayoutMode(viewportWidth: number): 'wide' | 'medium' | 'narrow' | 'compact' | 'very-narrow' {
        if (viewportWidth >= LAYOUT_BREAKPOINTS.wide) return 'wide';
        if (viewportWidth >= LAYOUT_BREAKPOINTS.medium) return 'medium';
        if (viewportWidth >= 500) return 'narrow';
        if (viewportWidth >= 350) return 'compact';
        return 'very-narrow';
    }

    private getPathInfoChipMaxWidth(viewportWidth: number): number {
        const mode = this.getExtendedHeaderLayoutMode(viewportWidth);

        if (mode === 'very-narrow') return 136;
        if (mode === 'compact') return 150;
        if (mode === 'narrow') return 176;
        if (mode === 'medium') return 210;
        return 232;
    }

    private shouldShowPathInfoChip(): boolean {
        const showPathInfo = this.settings?.pathSelection?.showPathInfo?.value ?? true;
        const multiPathEnabled = this.settings?.pathSelection?.enableMultiPathToggle?.value ?? true;
        const mode = this.settings?.criticalPath?.calculationMode?.value?.value ?? 'floatBased';
        const hasAnyPaths = this.allDrivingChains.length > 0;

        return showPathInfo && multiPathEnabled && mode === 'longestPath' && this.isCpmSafe() && hasAnyPaths;
    }

    /**
     * Returns button dimensions and positions based on current layout mode
     * This centralizes all responsive layout calculations with smart overflow handling
     */


    /**
     * Extended layout mode determination with more granular breakpoints
     */


    /**
     * Returns second row layout (dropdown, trace mode toggle) based on viewport width
     */
    private getSecondRowLayout(viewportWidth: number): {
        dropdown: { width: number; left: number };
        traceModeToggle: { left: number; width: number };
        statusLabel: { left: number; width: number };
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

        const traceButtonWidth = mode === "narrow" ? 30 : (mode === "medium" ? 68 : 92);
        const traceContainerWidth = (traceButtonWidth * 2) + 10;
        const traceGap = 12;
        const traceModeLeft = dropdownLeft + dropdownWidth + traceGap;
        const statusGap = 12;
        const statusLeft = traceModeLeft + traceContainerWidth + statusGap;
        const statusWidth = Math.max(0, viewportWidth - statusLeft - horizontalPadding);

        const floatThresholdMaxWidth = mode === 'narrow' ? 180 : 250;

        return {
            dropdown: { width: dropdownWidth, left: dropdownLeft },
            traceModeToggle: { left: traceModeLeft, width: traceContainerWidth },
            statusLabel: { left: statusLeft, width: statusWidth },
            floatThreshold: { maxWidth: floatThresholdMaxWidth }
        };
    }

    private getSecondRowControlTop(controlHeight: number): number {
        const laneTop = this.SECOND_ROW_TOP;
        const laneBottom = this.getHeaderBandMetrics().top;
        const laneHeight = Math.max(0, laneBottom - laneTop);
        return this.snapRectCoord(laneTop + Math.max(0, (laneHeight - controlHeight) / 2));
    }

    private hasSecondRowHeaderContent(): boolean {
        return !!(
            this.settings?.pathSelection?.enableTaskSelection?.value ||
            this.shouldReserveComparisonFinishSummaryLane()
        );
    }

    private shouldShowHeaderWarningBanner(): boolean {
        return this.getHeaderBannerWarningMessage() !== null;
    }

    private getWarningBannerTop(): number {
        const warningTop = this.hasSecondRowHeaderContent()
            ? this.SECOND_ROW_TOP + UI_TOKENS.height.compact + 8
            : this.SECOND_ROW_TOP;

        return this.snapRectCoord(warningTop);
    }

    private getEstimatedHeaderControlsBottom(): number {
        let bottom = 10 + UI_TOKENS.height.compact;

        if (this.hasSecondRowHeaderContent()) {
            bottom = Math.max(bottom, this.SECOND_ROW_TOP + UI_TOKENS.height.compact);
        }

        if (this.shouldShowHeaderWarningBanner()) {
            bottom = Math.max(bottom, this.getWarningBannerTop() + UI_TOKENS.height.compact);
        }

        return bottom;
    }

    private shouldReserveComparisonFinishSummaryLane(): boolean {
        const projectSummaryVisible = !!(
            this.settings?.projectEndLine?.show?.value &&
            (this.settings?.projectEndLine?.showLabel?.value ?? true)
        );
        const baselineSummaryVisible = !!(
            this.showBaselineInternal &&
            this.settings?.baselineFinishLine?.show?.value &&
            (this.settings?.baselineFinishLine?.showLabel?.value ?? true)
        );
        const previousSummaryVisible = !!(
            this.showPreviousUpdateInternal &&
            this.settings?.previousUpdateFinishLine?.show?.value &&
            (this.settings?.previousUpdateFinishLine?.showLabel?.value ?? true)
        );

        return projectSummaryVisible || baselineSummaryVisible || previousSummaryVisible;
    }

    private isTraceModeToggleVisible(): boolean {
        const enableTaskSelection = this.settings?.pathSelection?.enableTaskSelection?.value ?? false;
        const criticalPathMode = this.settings?.criticalPath?.calculationMode?.value?.value ?? "floatBased";
        const longestPathDisabled = criticalPathMode === "longestPath" && !this.isCpmSafe();

        return enableTaskSelection && !!this.selectedTaskId && !longestPathDisabled;
    }

    private getSecondRowRightLaneBounds(viewportWidth: number): { left: number; width: number; top: number } {
        const horizontalPadding = 10;
        const top = this.getSecondRowControlTop(UI_TOKENS.height.compact);

        if (!(this.settings?.pathSelection?.enableTaskSelection?.value ?? false)) {
            return {
                left: horizontalPadding,
                width: Math.max(0, viewportWidth - horizontalPadding * 2),
                top
            };
        }

        const secondRowLayout = this.getSecondRowLayout(viewportWidth);
        const dropdownRight = secondRowLayout.dropdown.left + secondRowLayout.dropdown.width;
        const traceRight = secondRowLayout.traceModeToggle.left + secondRowLayout.traceModeToggle.width;
        const contentLeft = (this.isTraceModeToggleVisible() ? traceRight : dropdownRight) + 12;

        return {
            left: Math.max(horizontalPadding, contentLeft),
            width: Math.max(0, viewportWidth - horizontalPadding - Math.max(horizontalPadding, contentLeft)),
            top
        };
    }

    private getSecondRowLeftLaneBounds(viewportWidth: number): { left: number; width: number; top: number } {
        const horizontalPadding = 10;
        const top = this.getSecondRowControlTop(UI_TOKENS.height.compact);

        if (!(this.settings?.pathSelection?.enableTaskSelection?.value ?? false)) {
            return {
                left: horizontalPadding,
                width: Math.max(0, viewportWidth - horizontalPadding * 2),
                top
            };
        }

        const secondRowLayout = this.getSecondRowLayout(viewportWidth);
        return {
            left: horizontalPadding,
            width: Math.max(0, secondRowLayout.dropdown.left - horizontalPadding - 12),
            top
        };
    }

    private getComparisonFinishSummaryBounds(viewportWidth: number): {
        left: number;
        width: number;
        top: number;
        align: "left" | "right";
        usesRightLane: boolean;
    } {
        const rightLane = this.getSecondRowRightLaneBounds(viewportWidth);
        const leftLane = this.getSecondRowLeftLaneBounds(viewportWidth);

        if (!(this.settings?.pathSelection?.enableTaskSelection?.value ?? false)) {
            return {
                ...rightLane,
                align: "left",
                usesRightLane: false
            };
        }

        if (rightLane.width >= 180 || rightLane.width >= leftLane.width) {
            return {
                ...rightLane,
                align: "right",
                usesRightLane: true
            };
        }

        return {
            ...leftLane,
            align: "left",
            usesRightLane: false
        };
    }

    private updateSelectedTaskStatusLabel(viewportWidth?: number): void {
        if (!this.selectedTaskLabel) {
            return;
        }

        const selectedLabelPrefix = this.getLocalizedString("ui.selectedLabel", "Selected");
        const shouldShow = !!(
            this.selectedTaskId &&
            this.selectedTaskName &&
            this.settings?.pathSelection?.showSelectedTaskLabel?.value
        );

        if (!shouldShow) {
            this.selectedTaskLabel.style("display", "none");
            return;
        }

        const effectiveWidth = viewportWidth ?? this.lastUpdateOptions?.viewport?.width ?? this.target?.clientWidth ?? 800;
        const rightLane = this.getSecondRowRightLaneBounds(effectiveWidth);
        const reservedWidth = this.secondRowComparisonSummaryUsesRightLane && this.secondRowComparisonSummaryWidth > 0
            ? this.secondRowComparisonSummaryWidth + 8
            : 0;
        const labelWidth = Math.max(0, rightLane.width - reservedWidth);

        this.selectedTaskLabel
            .style("position", "absolute")
            .style("top", `${rightLane.top}px`)
            .style("left", `${rightLane.left}px`)
            .style("right", "auto")
            .style("width", `${labelWidth}px`)
            .style("max-width", `${labelWidth}px`);

        if (labelWidth >= 96) {
            this.selectedTaskLabel
                .style("display", "inline-flex")
                .text(`${selectedLabelPrefix}: ${this.selectedTaskName}`);
        } else {
            this.selectedTaskLabel.style("display", "none");
        }
    }

    private getMinimumRequiredHeaderHeight(): number {
        return this.getEstimatedHeaderControlsBottom() +
            this.HEADER_CONTROLS_GAP +
            this.HEADER_BAND_HEIGHT +
            this.HEADER_BOTTOM_PADDING;
    }

    private applyHeaderHeight(): void {
        const configuredHeaderHeight = this.settings?.layoutSettings?.headerHeight?.value ?? this.headerHeight;
        this.headerHeight = Math.max(configuredHeaderHeight, this.getMinimumRequiredHeaderHeight());
        this.stickyHeaderContainer
            .style("height", `${this.headerHeight}px`)
            .style("min-height", `${this.headerHeight}px`);
    }

    private pointsToCssPx(pt: number): number {
        return Math.round((pt * 96 / 72) * 100) / 100;
    }

    private fontPxFromPtSetting(pt: number): string {
        return `${this.pointsToCssPx(pt)}px`;
    }

    private updateTaskNameLaneClipRect(currentLeftMargin: number, chartHeight: number): void {
        if (!this.mainSvg) {
            return;
        }

        const taskNameClipId = this.getScopedId("clip-task-name-lane");
        let defs = this.mainSvg.select("defs");
        if (defs.empty()) {
            defs = this.mainSvg.append("defs");
        }

        const layout = this.getLabelColumnLayout(currentLeftMargin);
        const clipSelection = defs.selectAll(`#${taskNameClipId}`).data([0]);
        const clipEnter = clipSelection.enter().append("clipPath").attr("id", taskNameClipId);
        clipEnter.append("rect");

        clipSelection.merge(clipEnter as any).select("rect")
            .attr("x", -currentLeftMargin)
            .attr("y", -50)
            .attr("width", Math.max(0, layout.remainingWidth))
            .attr("height", chartHeight + 100);
    }

    private getTaskNameLaneClipRef(): string {
        return this.getScopedUrlRef("clip-task-name-lane");
    }

    private fitSvgTextToWidth(
        textElement: Selection<SVGTextElement, unknown, null, undefined>,
        value: string,
        maxWidth: number
    ): string {
        const normalized = value.replace(/\s+/g, " ").trim();
        if (!normalized) {
            return "";
        }

        const node = textElement.node();
        if (!node || maxWidth <= 0) {
            return "…";
        }

        textElement.text(normalized);
        if (node.getComputedTextLength() <= maxWidth) {
            return normalized;
        }

        // Binary search for the longest prefix that fits with an ellipsis suffix.
        let lo = 0;
        let hi = normalized.length;
        let best = "";
        while (lo <= hi) {
            const mid = (lo + hi) >>> 1;
            const prefix = normalized.slice(0, mid).trimEnd();
            const candidate = prefix ? `${prefix}…` : "…";
            textElement.text(candidate);
            if (node.getComputedTextLength() <= maxWidth) {
                best = candidate;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }

        return best || "…";
    }

    private getWrappedSvgTextLines(
        textElement: Selection<SVGTextElement, unknown, null, undefined>,
        value: string,
        maxWidth: number,
        maxLines: number
    ): string[] {
        const normalized = value.replace(/\s+/g, " ").trim();
        if (!normalized || maxWidth <= 0) {
            return [];
        }

        if (maxLines <= 1) {
            return [this.fitSvgTextToWidth(textElement, normalized, maxWidth)];
        }

        const node = textElement.node();
        if (!node) {
            return [normalized];
        }

        const words = normalized.split(" ");
        const lines: string[] = [];
        let currentLine = "";

        for (let index = 0; index < words.length; index++) {
            const word = words[index];
            const candidate = currentLine ? `${currentLine} ${word}` : word;
            textElement.text(candidate);

            if (node.getComputedTextLength() <= maxWidth) {
                currentLine = candidate;
                continue;
            }

            // Candidate overflows. Finalize the current line (if any) before starting a new one.
            if (currentLine) {
                lines.push(currentLine);
                currentLine = "";
            }

            // If we've filled all but the last line, fold the remainder into one truncated line.
            if (lines.length >= maxLines - 1) {
                const remainingText = words.slice(index).join(" ");
                lines.push(this.fitSvgTextToWidth(textElement, remainingText, maxWidth));
                return lines.filter(line => line.length > 0);
            }

            // Check whether this word alone fits on a fresh line.
            textElement.text(word);
            if (node.getComputedTextLength() <= maxWidth) {
                currentLine = word;
            } else {
                // Word is wider than the column — truncate it on its own line and move on.
                lines.push(this.fitSvgTextToWidth(textElement, word, maxWidth));
            }
        }

        if (currentLine) {
            lines.push(currentLine);
        }

        return lines.filter(line => line.length > 0).slice(0, maxLines);
    }

    private renderWrappedSvgText(
        textElement: Selection<SVGTextElement, unknown, null, undefined>,
        value: string,
        x: number,
        centerY: number,
        maxWidth: number,
        maxLines: number,
        fontSizePx: number,
        anchorMode: "centerBlock" | "firstLineAtCenter" = "centerBlock"
    ): void {
        const lines = this.getWrappedSvgTextLines(textElement, value, maxWidth, maxLines);
        textElement.text(null);

        if (lines.length === 0) {
            return;
        }

        const lineAdvancePx = Math.max(fontSizePx * 1.08, fontSizePx + 1);
        const firstLineY = anchorMode === "firstLineAtCenter"
            ? centerY
            : centerY - ((lines.length - 1) * lineAdvancePx) / 2;

        lines.forEach((line, index) => {
            textElement.append("tspan")
                .attr("x", this.snapTextCoord(x))
                .attr("y", this.snapTextCoord(firstLineY + (index * lineAdvancePx)))
                .attr("dominant-baseline", "central")
                .text(line);
        });
    }

    private getMaxWrappedLabelLines(availableWidth: number, rowHeight: number, fontSizePx: number): number {
        const minWidthForTwoLines = Math.max(78, fontSizePx * 6.25);
        const minHeightForTwoLines = fontSizePx * 2.05;
        return availableWidth >= minWidthForTwoLines && rowHeight >= minHeightForTwoLines ? 2 : 1;
    }

    private snapLineCoord(value: number, strokeWidth = 1): number {
        // Align one stroke edge to a pixel boundary so lines render crisp.
        // Offset = (strokeWidth / 2) mod 1:
        //   w=1 → 0.5 (one solid pixel)
        //   w=2 → 0   (two solid pixels)
        //   w=1.5 → 0.75 (solid + one 50% edge, instead of a 3-pixel 25/100/25 bleed)
        const offset = ((strokeWidth / 2) % 1 + 1) % 1;
        return Math.round(value) + offset;
    }

    private snapRectCoord(value: number): number {
        return Math.round(value);
    }

    private snapTextCoord(value: number): number {
        return Math.round(value);
    }

    private isEmbeddedPowerBiHost(): boolean {
        try {
            return window.self !== window.top || window.location.hostname.includes("powerbi.com");
        } catch {
            return true;
        }
    }

    private getLocalCssScale(): number {
        const targetNode = this.target;
        if (!targetNode) {
            return 1;
        }

        const rect = targetNode.getBoundingClientRect();
        const widthScale = targetNode.clientWidth > 0 ? rect.width / targetNode.clientWidth : 1;
        const heightScale = targetNode.clientHeight > 0 ? rect.height / targetNode.clientHeight : 1;

        return Math.max(1, widthScale, heightScale);
    }

    private getCanvasPixelRatio(): number {
        const devicePixelRatio = window.devicePixelRatio || 1;
        const hostScale = this.getLocalCssScale();
        const sharpnessScale = this.isEmbeddedPowerBiHost()
            ? this.POWER_BI_CANVAS_SHARPNESS_SCALE
            : 1;

        return Math.min(
            this.MAX_CANVAS_PIXEL_RATIO,
            Math.max(1, devicePixelRatio * hostScale * sharpnessScale)
        );
    }

    private syncSvgPixelSize(
        svg: Selection<SVGSVGElement, unknown, null, undefined> | null | undefined,
        width?: number,
        height?: number
    ): void {
        if (!svg?.node()) {
            return;
        }

        if (typeof width === "number" && Number.isFinite(width)) {
            const snappedWidth = Math.max(1, this.snapRectCoord(width));
            svg
                .attr("width", snappedWidth)
                .style("width", `${snappedWidth}px`)
                .style("max-width", "none")
                .style("flex-shrink", "0");
        }

        if (typeof height === "number" && Number.isFinite(height)) {
            const snappedHeight = Math.max(1, this.snapRectCoord(height));
            svg
                .attr("height", snappedHeight)
                .style("height", `${snappedHeight}px`)
                .style("max-height", "none")
                .style("flex-shrink", "0");
        }
    }

    private shouldUseCanvasForViewport(taskCount: number, chartWidth: number, chartHeight: number, pixelRatio: number): boolean {
        if (this.forceSvgRenderingForExport) {
            return false;
        }

        if (taskCount <= this.CANVAS_THRESHOLD) {
            return false;
        }

        const safePixelRatio = Math.max(1, pixelRatio || 1);
        const backingWidth = Math.ceil(Math.max(0, chartWidth) * safePixelRatio);
        const backingHeight = Math.ceil(Math.max(0, chartHeight) * safePixelRatio);
        const totalBackingPixels = backingWidth * backingHeight;
        const maxBackingDimension = 6144;
        const maxBackingPixels = 18_000_000;

        return backingWidth > 0 &&
            backingHeight > 0 &&
            backingWidth <= maxBackingDimension &&
            backingHeight <= maxBackingDimension &&
            totalBackingPixels <= maxBackingPixels;
    }

    private createEmptyDataQuality(): DataQualityInfo {
        return {
            rowCount: 0,
            possibleTruncation: false,
            duplicateTaskIds: [],
            circularPaths: [],
            invalidRawDateRangeTaskIds: [],
            invalidVisualDateRangeTaskIds: [],
            warnings: [],
            cpmSafe: true
        };
    }

    private static createInstanceId(): string {
        Visual.nextInstanceOrdinal += 1;
        return `critical-path-${Visual.nextInstanceOrdinal.toString(36)}`;
    }

    private getScopedId(name: string): string {
        return `${this.instanceId}-${name}`;
    }

    private getScopedUrlRef(name: string): string {
        return `url(#${this.getScopedId(name)})`;
    }

    private ensureOwnedStyle(name: string, cssText: string): void {
        const styleId = this.getScopedId(name);
        let styleElement = document.getElementById(styleId) as HTMLStyleElement | null;

        if (!styleElement) {
            styleElement = document.createElement("style");
            styleElement.id = styleId;
            styleElement.dataset.owner = this.instanceId;
            styleElement.dataset.styleName = name;
            document.head.appendChild(styleElement);
        }

        if (styleElement.textContent !== cssText) {
            styleElement.textContent = cssText;
        }
    }

    private removeOwnedStyle(name: string): void {
        const styleElement = document.getElementById(this.getScopedId(name));
        if (styleElement?.getAttribute("data-owner") === this.instanceId) {
            styleElement.remove();
        }
    }

    private ensureLiveRegion(): void {
        if (this.liveRegion?.node()) {
            return;
        }

        this.liveRegion = this.visualWrapper.append("div")
            .attr("id", this.getScopedId("sr-live-region"))
            .attr("class", "sr-live-region")
            .attr("data-owner", this.instanceId)
            .attr("aria-live", "polite")
            .attr("aria-atomic", "true")
            .style("position", "absolute")
            .style("left", "-10000px")
            .style("width", "1px")
            .style("height", "1px")
            .style("overflow", "hidden");
    }

    private announceToLiveRegion(message: string): void {
        if (!message) {
            return;
        }

        this.ensureLiveRegion();
        if (!this.liveRegion) {
            return;
        }

        this.liveRegion.text("");
        window.setTimeout(() => {
            this.liveRegion?.text(message);
        }, 0);
    }

    constructor(options: VisualConstructorOptions) {
        this.debugLog("--- Initializing Critical Path Visual (Plot by Date) ---");
        this.instanceId = Visual.createInstanceId();
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
        this.dropdownListId = this.getScopedId("task-selection-list");

        this.showAllTasksInternal = Visual.DEFAULT_SHOW_ALL_TASKS;

        this.showBaselineInternal = true;
        this.showPreviousUpdateInternal = true;
        this.isInitialLoad = true;
        this.floatThreshold = 0;
        this.showConnectorLinesInternal = true;
        this.wbsExpandedInternal = true;

        this.tooltipClassName = this.getScopedId("critical-path-tooltip");
        this.dataQuality = this.createEmptyDataQuality();

        this.visualWrapper = d3.select(this.target).append("div")
            .attr("class", "visual-wrapper")
            .attr("data-owner", this.instanceId)
            .style("height", "100%")
            .style("width", "100%")
            .style("overflow", "hidden")
            .style("position", "relative")
            .style("display", "flex")
            .style("flex-direction", "column");

        this.stickyHeaderContainer = this.visualWrapper.append("div")
            .attr("class", "sticky-header-container")
            .style("position", "sticky")
            .style("top", "0")
            .style("left", "0")
            .style("width", "100%")
            .style("height", `${this.headerHeight}px`)
            .style("min-height", `${this.headerHeight}px`)
            .style("flex-shrink", "0")
            .style("z-index", "100")
            .style("background-color", HEADER_DOCK_TOKENS.shell)
            .style("overflow", "visible");

        this.header = new Header(this.stickyHeaderContainer, {
            onToggleCriticalPath: () => this.toggleTaskDisplayInternal(),
            onToggleBaseline: () => this.toggleBaselineDisplayInternal(),
            onTogglePreviousUpdate: () => this.togglePreviousUpdateDisplayInternal(),
            onToggleConnectorLines: () => this.toggleConnectorLinesDisplay(),
            onToggleWbsExpand: () => this.toggleWbsExpandCollapseDisplay(),
            onToggleWbsCollapse: () => this.toggleWbsCollapseCycleDisplay(),
            onToggleMode: () => this.togglecriticalPath(),
            onToggleColumns: () => this.toggleColumnDisplayInternal(),
            onToggleWbsEnable: () => this.toggleWbsEnabled(),
            onFloatThresholdChanged: (val) => {
                this.floatThreshold = val;
                if (this.lastUpdateOptions) this.update(this.lastUpdateOptions);
            },
            onHelp: () => this.showHelpOverlay(),
            onExport: () => this.exportToPDF(),
            onExportHtml: () => this.exportVisualAsHtml(),
            onCopy: () => this.copyVisibleDataToClipboard()
        });

        this.dataProcessor = new DataProcessor(this.host);


        this.headerSvg = this.stickyHeaderContainer.append("svg")
            .attr("class", "header-svg")
            .attr("width", "100%")
            .attr("height", "100%")
            .style("display", "block")
            .style("max-width", "none")
            .style("flex-shrink", "0");

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



        this.selectedTaskLabel = this.stickyHeaderContainer.append("div")
            .attr("class", "selected-task-label")
            .style("position", "absolute")
            .style("top", `${this.SECOND_ROW_TOP}px`)
            .style("left", "10px")
            .style("height", `${UI_TOKENS.height.compact}px`)
            .style("padding", "0 10px")
            .style("align-items", "center")
            .style("background-color", HEADER_DOCK_TOKENS.chipBg)
            .style("border", `1px solid ${HEADER_DOCK_TOKENS.chipStroke}`)
            .style("border-radius", `${UI_TOKENS.radius.pill}px`)
            .style("box-shadow", HEADER_DOCK_TOKENS.shadow)
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", this.fontPxFromPtSetting(8.5))
            .style("color", HEADER_DOCK_TOKENS.chipText)
            .style("font-weight", "600")
            .style("white-space", "nowrap")
            .style("overflow", "hidden")
            .style("text-overflow", "ellipsis")
            .style("z-index", "24")
            .style("display", "none");

        this.pathInfoLabel = this.stickyHeaderContainer.append("div")
            .attr("class", "path-info-label")
            .style("position", "absolute")
            .style("top", "6px")
            .style("right", "10px")
            .style("height", "24px")
            .style("padding", "0 8px")
            .style("display", "none")
            .style("align-items", "center")
            .style("gap", "4px")
            .style("background-color", HEADER_DOCK_TOKENS.chipBg)
            .style("border", `1px solid ${HEADER_DOCK_TOKENS.primary}`)
            .style("border-radius", "12px")
            .style("box-shadow", HEADER_DOCK_TOKENS.shadow)
            .style("font-family", "Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif")
            .style("font-size", "11px")
            .style("color", HEADER_DOCK_TOKENS.chipText)
            .style("font-weight", "600")
            .style("letter-spacing", "0.1px")
            .style("white-space", "nowrap")
            .style("transition", `all ${UI_TOKENS.motion.duration.normal}ms ${UI_TOKENS.motion.easing.smooth}`);

        this.warningBanner = this.stickyHeaderContainer.append("div")
            .attr("class", "data-quality-warning")
            .style("position", "absolute")
            .style("left", "10px")
            .style("top", `${this.SECOND_ROW_TOP}px`)
            .style("bottom", "auto")
            .style("max-width", "calc(100% - 20px)")
            .style("display", "none")
            .style("align-items", "center")
            .style("gap", "6px")
            .style("padding", "4px 10px")
            .style("background-color", HEADER_DOCK_TOKENS.warningBg)
            .style("border", `1px solid ${HEADER_DOCK_TOKENS.warning}`)
            .style("border-radius", `${UI_TOKENS.radius.pill}px`)
            .style("box-shadow", HEADER_DOCK_TOKENS.shadow)
            .style("font-family", "Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif")
            .style("font-size", "11px")
            .style("font-weight", "600")
            .style("color", HEADER_DOCK_TOKENS.warningText)
            .style("white-space", "nowrap")
            .style("overflow", "hidden")
            .style("text-overflow", "ellipsis")
            .style("z-index", "24")
            .attr("role", "status")
            .attr("aria-live", "polite");

        this.scrollableContainer = this.visualWrapper.append("div")
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
            .style("animation", this.prefersReducedMotion() ? "none" : `${this.getScopedId("loadingBarPulse")} 1.2s ease-in-out infinite`)
            .style("transform", "translateX(-30%)");

        this.loadingProgressText = overlayContent.append("div")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", "11px")
            .style("color", "#605E5C")
            .style("text-align", "center")
            .text("");

        this.ensureOwnedStyle(
            "loading-bar-pulse-style",
            `@keyframes ${this.getScopedId("loadingBarPulse")} { 0% { transform: translateX(-40%); } 50% { transform: translateX(20%); } 100% { transform: translateX(100%); } }
@keyframes ${this.getScopedId("loadingBarDeterminate")} { from { width: 0%; } }`
        );

        this.mainSvg = this.scrollableContainer.append("svg")
            .classed("criticalPathVisual", true)
            .style("display", "block")
            .style("max-width", "none")
            .style("flex-shrink", "0");

        this.mainGroup = this.mainSvg.append("g").classed("main-group", true);

        const defs = this.mainSvg.append("defs");
        this.chartClipPath = defs.append("clipPath")
            .attr("id", this.getScopedId("chart-area-clip"));
        this.chartClipRect = this.chartClipPath.append("rect")
            .attr("x", 0)
            .attr("y", 0)
            .attr("width", 1000)
            .attr("height", 10000);

        this.gridLayer = this.mainGroup.append("g")
            .attr("class", "grid-layer")
            .attr("clip-path", this.getScopedUrlRef("chart-area-clip"));

        this.labelGridLayer = this.mainGroup.append("g")
            .attr("class", "label-grid-layer");
        this.rowGridLayer = this.mainGroup.append("g")
            .attr("class", "row-grid-layer");
        this.arrowLayer = this.mainGroup.append("g")
            .attr("class", "arrow-layer")
            .attr("clip-path", this.getScopedUrlRef("chart-area-clip"));
        this.taskLayer = this.mainGroup.append("g")
            .attr("class", "task-layer")
            .attr("clip-path", this.getScopedUrlRef("chart-area-clip"));

        this.taskLabelLayer = this.mainGroup.append("g")
            .attr("class", "task-label-layer");

        this.createZoomSliderUI(this.visualWrapper);

        this.legendContainer = this.visualWrapper.append("div")
            .attr("class", "sticky-legend-footer")
            .style("width", "100%")
            .style("height", `${this.getLegendEffectiveFooterHeight()}px`)
            .style("min-height", `${this.getLegendEffectiveFooterHeight()}px`)
            .style("flex-shrink", "0")
            .style("z-index", "100")
            .style("background-color", HEADER_DOCK_TOKENS.shell)
            .style("border-top", `1px solid ${HEADER_DOCK_TOKENS.groupStroke}`)
            .style("box-shadow", "0 -6px 18px rgba(15, 23, 34, 0.18)")
            .style("display", "none")
            .style("overflow", "hidden");

        this.canvasElement = document.createElement('canvas');
        this.canvasElement.style.position = 'absolute';
        this.canvasElement.style.pointerEvents = 'auto';
        this.canvasElement.className = 'canvas-layer';
        this.canvasElement.style.display = 'none';
        this.canvasElement.style.visibility = 'hidden';
        this.canvasElement.style.imageRendering = 'auto';

        this.scrollableContainer.node()?.appendChild(this.canvasElement);

        this.canvasLayer = d3.select(this.canvasElement);
        this.watermarkOverlay = this.visualWrapper.append("div")
            .attr("class", "visual-watermark")
            .style("position", "absolute")
            .style("right", "8px")
            .style("bottom", "6px")
            .style("pointer-events", "none")
            .style("user-select", "none")
            .style("z-index", "1000")
            .style("font-family", "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif")
            .style("font-size", "10px")
            .style("line-height", "1")
            .style("white-space", "nowrap")
            .style("color", "#888888")
            .style("opacity", "0.75")
            .style("text-shadow", "0 1px 1px rgba(255, 255, 255, 0.65)")
            .text("© Ricardo Aguirre · CPM Gantt");
        this.scheduleWatermarkOverlayUpdate();

        this.applyPublishModeOptimizations();

        this.tooltipDiv = d3.select("body").append("div")
            .attr("class", `critical-path-tooltip ${this.tooltipClassName}`)
            .attr("data-owner", this.instanceId)
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

        this.ensureLiveRegion();

        this.traceMode = "backward";



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

        // Initialize ResizeObserver to handle container resizing events that PBI host update might miss or delay
        // This ensures the visual always fills the available space
        if (typeof ResizeObserver !== 'undefined' && this.target) {
            this.resizeObserver = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    if (entry.contentRect) {
                        const measuredViewport = this.createViewportFromDimensions(
                            entry.contentRect.width,
                            entry.contentRect.height
                        );
                        if (!measuredViewport) {
                            continue;
                        }

                        // Check if dimensions actually changed significantly from what we last rendered
                        if (this.lastViewport) {
                            const widthDiff = Math.abs(measuredViewport.width - this.lastViewport.width);
                            const heightDiff = Math.abs(measuredViewport.height - this.lastViewport.height);

                            // If difference is significant (>2px to avoid sub-pixel jitter loops), trigger update
                            if (widthDiff > 2 || heightDiff > 2) {
                                this.debugLog(`ResizeObserver detected change: [${measuredViewport.width}x${measuredViewport.height}]. Requesting update.`);
                                this.requestUpdate(true, measuredViewport);
                            }
                        } else {
                            // Initial state or lost viewport
                            this.debugLog(`ResizeObserver detected initial size: [${measuredViewport.width}x${measuredViewport.height}]. Requesting update.`);
                            this.requestUpdate(true, measuredViewport);
                        }
                    }
                }
            });
            this.resizeObserver.observe(this.target);
            this.debugLog("ResizeObserver initialized and monitoring target element.");
        }
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

    private createViewportFromDimensions(width: number, height: number): IViewport | null {
        if (!Number.isFinite(width) || !Number.isFinite(height)) {
            return null;
        }

        const normalizedWidth = Math.max(0, this.snapRectCoord(width));
        const normalizedHeight = Math.max(0, this.snapRectCoord(height));
        if (normalizedWidth <= 0 || normalizedHeight <= 0) {
            return null;
        }

        return {
            width: normalizedWidth,
            height: normalizedHeight
        };
    }

    private getViewportKey(viewport: IViewport): string {
        return `${this.snapRectCoord(viewport.width)}x${this.snapRectCoord(viewport.height)}`;
    }

    private getCurrentTargetViewport(fallback: IViewport): IViewport {
        if (!this.target) {
            return fallback;
        }

        return this.createViewportFromDimensions(
            this.target.clientWidth || fallback.width,
            this.target.clientHeight || fallback.height
        ) ?? fallback;
    }

    private createResizeUpdateOptions(baseOptions: VisualUpdateOptions, viewport: IViewport): VisualUpdateOptions {
        return {
            ...baseOptions,
            type: baseOptions.type | VisualUpdateType.Resize,
            viewport
        };
    }

    private queueSettledResizeUpdate(options: VisualUpdateOptions): void {
        this.settledResizeViewportKey = this.getViewportKey(options.viewport);
        this.forceFullUpdate = true;

        if (this.isUpdating) {
            this.pendingUpdate = options;
            this.debouncedUpdate();
            return;
        }

        this.update(options);
    }

    private scheduleSettledResizeUpdate(baseOptions: VisualUpdateOptions): void {
        if (this.resizeSettleTimeout) {
            clearTimeout(this.resizeSettleTimeout);
            this.resizeSettleTimeout = null;
        }

        if (this.resizeSettleRaf !== null) {
            cancelAnimationFrame(this.resizeSettleRaf);
            this.resizeSettleRaf = null;
        }

        this.resizeSettleTimeout = setTimeout(() => {
            this.resizeSettleTimeout = null;
            this.resizeSettleRaf = requestAnimationFrame(() => {
                this.resizeSettleRaf = requestAnimationFrame(() => {
                    this.resizeSettleRaf = null;

                    const settledViewport = this.getCurrentTargetViewport(baseOptions.viewport);
                    const settledOptions = this.createResizeUpdateOptions(baseOptions, settledViewport);

                    this.viewportResizeCooldownUntil = 0;
                    this.debugLog(`Resize settled at [${settledViewport.width}x${settledViewport.height}]. Queuing full update.`);
                    this.queueSettledResizeUpdate(settledOptions);
                });
            });
        }, this.RESIZE_SETTLE_DEBOUNCE_MS);
    }

    private requestUpdate(forceFullUpdate: boolean = false, viewport?: IViewport): void {
        if (!this.lastUpdateOptions) {
            console.error("Cannot trigger update - lastUpdateOptions is null.");
            return;
        }

        if (forceFullUpdate) {
            this.forceFullUpdate = true;
        }

        this.pendingUpdate = viewport
            ? this.createResizeUpdateOptions(this.lastUpdateOptions, viewport)
            : this.lastUpdateOptions;
        this.debouncedUpdate();
    }

    private applyPublishModeOptimizations(): void {

        if (this.isEmbeddedPowerBiHost()) {
            this.ensureOwnedStyle(
                "critical-path-publish-fixes",
                `
[data-owner="${this.instanceId}"] .visual-wrapper,
[data-owner="${this.instanceId}"] .criticalPathContainer,
[data-owner="${this.instanceId}"] .sticky-header-container,
[data-owner="${this.instanceId}"] .criticalPathVisual,
[data-owner="${this.instanceId}"] .header-svg,
[data-owner="${this.instanceId}"] .canvas-layer,
[data-owner="${this.instanceId}"] .header-toggle-button {
    backface-visibility: visible !important;
    -webkit-backface-visibility: visible !important;
    will-change: auto !important;
}
[data-owner="${this.instanceId}"] .criticalPathVisual,
[data-owner="${this.instanceId}"] .header-svg {
    max-width: none !important;
    flex-shrink: 0 !important;
}
[data-owner="${this.instanceId}"] .criticalPathVisual {
    -webkit-font-smoothing: antialiased !important;
    -moz-osx-font-smoothing: grayscale !important;
    text-rendering: geometricPrecision !important;
}
[data-owner="${this.instanceId}"] .criticalPathVisual text {
    text-rendering: geometricPrecision !important;
    -webkit-font-smoothing: antialiased !important;
    -moz-osx-font-smoothing: grayscale !important;
}
[data-owner="${this.instanceId}"] .criticalPathVisual .canvas-layer {
    image-rendering: auto !important;
}
[data-owner="${this.instanceId}"] svg .grid-line,
[data-owner="${this.instanceId}"] svg .vertical-grid-line,
[data-owner="${this.instanceId}"] svg .label-grid-line,
[data-owner="${this.instanceId}"] svg .horizontal-grid-line,
[data-owner="${this.instanceId}"] svg .label-column-separator,
[data-owner="${this.instanceId}"] svg .divider-line,
[data-owner="${this.instanceId}"] svg .data-date-line,
[data-owner="${this.instanceId}"] svg .project-end-line,
[data-owner="${this.instanceId}"] svg .baseline-end-line,
[data-owner="${this.instanceId}"] svg .previous-update-end-line {
    shape-rendering: crispEdges !important;
    vector-effect: non-scaling-stroke !important;
}
`
            );
        }
    }


    private setupSVGRenderingHints(): void {

        // Use geometricPrecision as default for smooth rendering of bars, connectors,
        // and milestones. Only grid layers use crispEdges for pixel-perfect alignment.
        if (this.mainSvg) {
            this.mainSvg
                .attr("shape-rendering", "geometricPrecision")
                .attr("text-rendering", "geometricPrecision");
        }

        if (this.headerSvg) {
            this.headerSvg
                .attr("shape-rendering", "geometricPrecision")
                .attr("text-rendering", "geometricPrecision");
        }

        // Grid layers use crispEdges for pixel-perfect grid lines
        [this.gridLayer, this.headerGridLayer, this.labelGridLayer, this.rowGridLayer].forEach(layer => {
            if (layer) {
                layer.attr("shape-rendering", "crispEdges");
            }
        });

        // Task/label layers use geometricPrecision for smooth rendering
        [this.mainGroup, this.arrowLayer, this.taskLayer,
        this.toggleButtonGroup, this.taskLabelLayer, this.wbsGroupLayer].forEach(group => {
            if (group) {
                group.attr("shape-rendering", "geometricPrecision");
            }
        });
    }

    private getDataSignature(dataView: DataView): string {
        return buildDataSignature(dataView);
    }

    private getWbsBindingSignature(dataView: DataView): string {
        const columns = dataView.table?.columns ?? dataView.metadata?.columns ?? [];

        return columns
            .filter(column => column.roles?.wbsLevels)
            .map((column, index) => `${column.queryName ?? column.displayName ?? `wbs-${index}`}`)
            .join("|");
    }

    private resetWbsBindingState(): void {
        this.wbsExpandedState.clear();
        this.wbsManuallyToggledGroups.clear();
        this.wbsManualExpansionOverride = false;
        this.wbsExpandToLevel = undefined;
        this.wbsToggleScrollAnchor = null;
    }

    private getVisualStart(task: Task): Date | null {
        return task.manualStartDate ?? task.startDate ?? null;
    }

    private getVisualFinish(task: Task): Date | null {
        return task.manualFinishDate ?? task.finishDate ?? null;
    }

    private getVisualMilestoneDate(task: Task): Date | null {
        return this.getVisualStart(task) ?? this.getVisualFinish(task);
    }

    private hasValidVisualDates(task: Task): boolean {
        const start = this.getVisualStart(task);
        const finish = this.getVisualFinish(task);
        return start instanceof Date &&
            !isNaN(start.getTime()) &&
            finish instanceof Date &&
            !isNaN(finish.getTime()) &&
            finish >= start;
    }

    private hasValidPlotDates(task: Task): boolean {
        return this.hasValidVisualDates(task);
    }

    private clearCriticalPathState(): void {
        this.allDrivingChains = [];
        this.selectedPathIndex = 0;
        this.drivingPathsTruncated = false;
        this.drivingPathsTruncationMessage = null;
        this.drivingPathExpansionCount = 0;
        for (const task of this.allTasksData) {
            task.isCritical = false;
            task.isCriticalByFloat = false;
            task.isCriticalByRel = false;
            task.isNearCritical = false;
            task.totalFloat = Infinity;
        }
        for (const rel of this.relationships) {
            rel.isCritical = false;
            rel.isDriving = false;
        }
    }

    private isLongestPathMode(): boolean {
        return (this.settings?.criticalPath?.calculationMode?.value?.value ?? "floatBased") === "longestPath";
    }

    private isCpmSafe(): boolean {
        return this.dataQuality?.cpmSafe ?? true;
    }

    private getUnsafeCpmWarningMessage(): string | null {
        if (this.isCpmSafe()) {
            return null;
        }

        const reasons: string[] = [];
        if (this.dataQuality.possibleTruncation) {
            reasons.push("dataset may be truncated at 30,000 rows");
        }
        if (this.dataQuality.circularPaths.length > 0) {
            reasons.push("circular dependencies detected");
        }
        if (this.dataQuality.invalidRawDateRangeTaskIds.length > 0) {
            reasons.push("invalid start/finish date ranges found");
        }
        if (this.dataQuality.duplicateTaskIds.length > 0) {
            reasons.push("duplicate task IDs found");
        }

        if (reasons.length === 0) {
            return "Longest Path unavailable: cyclic, truncated, or invalid schedule data.";
        }

        return `Longest Path disabled: ${reasons.join("; ")}.`;
    }

    private getHeaderBannerWarningMessage(): string | null {
        if ((this.dataQuality?.invalidVisualDateRangeTaskIds?.length ?? 0) > 0) {
            return `Plotted date warning: ${this.dataQuality.invalidVisualDateRangeTaskIds.length} task(s) have invalid visual start/finish ranges.`;
        }

        return null;
    }

    private updateDataQualityWarning(): void {
        if (!this.warningBanner) {
            return;
        }

        const message = this.getHeaderBannerWarningMessage();

        if (!message) {
            this.warningBanner
                .style("display", "none")
                .text("");
            return;
        }

        this.warningBanner
            .style("display", "inline-flex")
            .style("top", `${this.getWarningBannerTop()}px`)
            .style("bottom", "auto")
            .style("background-color", this.highContrastMode ? this.highContrastBackground : HEADER_DOCK_TOKENS.warningBg)
            .style("border-color", this.highContrastMode ? this.highContrastForeground : HEADER_DOCK_TOKENS.warning)
            .style("color", this.highContrastMode ? this.highContrastForeground : HEADER_DOCK_TOKENS.warningText)
            .text(message)
            .attr("title", message);
    }

    private ensureTaskSortCache(signature: string): void {
        if (this.cachedSortedTasksSignature === signature) {
            return;
        }

        const sortedByStartDate = this.allTasksData
            .filter(task => {
                const s = this.getVisualStart(task);
                return s instanceof Date && !isNaN(s.getTime());
            })
            .sort((a, b) => {
                const aStart = this.getVisualStart(a)?.getTime() ?? 0;
                const bStart = this.getVisualStart(b)?.getTime() ?? 0;
                return aStart - bStart;
            });

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

        // Cleanup ResizeObserver
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        if (this.updateDebounceTimeout) {
            clearTimeout(this.updateDebounceTimeout);
            this.updateDebounceTimeout = null;
        }

        if (this.resizeSettleTimeout) {
            clearTimeout(this.resizeSettleTimeout);
            this.resizeSettleTimeout = null;
        }

        if (this.resizeSettleRaf !== null) {
            cancelAnimationFrame(this.resizeSettleRaf);
            this.resizeSettleRaf = null;
        }

        if (this.watermarkOverlayRaf !== null) {
            cancelAnimationFrame(this.watermarkOverlayRaf);
            this.watermarkOverlayRaf = null;
        }

        if (this.scrollThrottleTimeout) {
            cancelAnimationFrame(this.scrollThrottleTimeout);
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
        this.settledResizeViewportKey = null;

        this.removeOwnedStyle("critical-path-publish-fixes");

        // Clean up canvas element
        if (this.canvasElement) {
            this.canvasElement.remove();
            this.canvasElement = null;
            this.canvasContext = null;
        }

        if (this.liveRegion) {
            this.liveRegion.remove();
            this.liveRegion = null;
        }

        // Clean up loading animation style
        this.removeOwnedStyle("loading-bar-pulse-style");

        // Clean up help overlay if visible
        this.clearHelpOverlay();

        // Release large data structures to allow GC
        this.allTasksData = [];
        this.relationships = [];
        this.taskIdToTask.clear();
        this.predecessorIndex.clear();
        this.relationshipByPredecessor.clear();
        this.relationshipIndex.clear();
        this.legendColorMap.clear();
        this.legendCategoriesInCurrentScope = [];
        this.wbsExpandedState.clear();
        this.wbsGroupMap.clear();
        this.allFilteredTasks = [];
        this.allTasksToShow = [];
        this._lastFilteredTasksForFinishLines = [];

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

        this.arrowLayer.selectAll<SVGPathElement, { relationship: Relationship }>(".relationship-arrow")
            .style("stroke-opacity", d => this.getConnectorOpacity(d.relationship));

        this.arrowLayer.selectAll<SVGCircleElement, { relationship: Relationship }>(".connection-dot-start, .connection-dot-end")
            .style("fill-opacity", d => this.getConnectorOpacity(d.relationship))
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
            if (!this.boundFields.baselineAvailable) {
                this.debugLog("Baseline toggle blocked: data not available");
                return;
            }
            this.debugLog("Baseline Toggle method called!");
            this.showBaselineInternal = !this.showBaselineInternal;
            this.debugLog("New showBaselineInternal value:", this.showBaselineInternal);

            this.debugLog("New showBaselineInternal value:", this.showBaselineInternal);

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
                cancelAnimationFrame(this.scrollThrottleTimeout);
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
            if (!this.boundFields.previousUpdateAvailable) {
                this.debugLog("Previous Update toggle blocked: data not available");
                return;
            }
            this.debugLog("Previous Update Toggle method called!");
            this.showPreviousUpdateInternal = !this.showPreviousUpdateInternal;
            this.debugLog("New showPreviousUpdateInternal value:", this.showPreviousUpdateInternal);

            this.debugLog("New showPreviousUpdateInternal value:", this.showPreviousUpdateInternal);

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
                cancelAnimationFrame(this.scrollThrottleTimeout);
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



        this.captureScrollPosition(); // Ensure scroll is preserved

        // Trigger generic update like others
        if (this.lastUpdateOptions) {
            this.update(this.lastUpdateOptions);
        } else {
            this.forceFullUpdate = true;
            this.requestUpdate();
        }
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
            this.rememberedWbsGroupingEnabled = newEnabled;
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
                cancelAnimationFrame(this.scrollThrottleTimeout);
                this.scrollThrottleTimeout = null;
            }

            // const viewportWidth = this.lastUpdateOptions?.viewport.width || 800;
            // this.createOrUpdateWbsEnableToggleButton(viewportWidth);

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
    /**
     * Creates the WBS Expand cycle toggle button with icon-only design
     * Similar styling to Connector Lines toggle for visual consistency
     */


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

            // const viewportWidth = this.lastUpdateOptions?.viewport?.width
            //     || (this.target instanceof HTMLElement ? this.target.clientWidth : undefined)
            //     || 800;
            // this.renderWbsCycleButtons(viewportWidth);

            this.forceFullUpdate = true;

            this.preserveScrollOnUpdate = true;

            if (this.scrollThrottleTimeout) {
                cancelAnimationFrame(this.scrollThrottleTimeout);
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




    private togglecriticalPath(): void {
        try {
            const currentMode = this.settings?.criticalPath?.calculationMode?.value?.value || 'floatBased';
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



            this.forceCanvasRefresh();

            this.captureScrollPosition();

            this.forceFullUpdate = true;

            if (this.scrollThrottleTimeout) {
                cancelAnimationFrame(this.scrollThrottleTimeout);
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
     * Creates the zoom slider UI component matching Microsoft Power BI standard style
     * Design: Thin track line with circular handles at each end
     */
    private createZoomSliderUI(visualWrapper: Selection<HTMLDivElement, unknown, null, undefined>): void {
        const sliderHeight = 32;
        const handleSize = 24;
        const handleBorderWidth = 3;

        this.zoomSliderContainer = visualWrapper.append("div")
            .attr("class", "timeline-zoom-slider-container")
            .attr("role", "group")
            .attr("aria-label", this.getLocalizedString("ui.zoomSliderLabel", "Timeline zoom controls"))
            .style("position", "relative")
            .style("width", "100%")
            .style("height", `${sliderHeight}px`)
            .style("background-color", "#FFFFFF")
            .style("border-top", "1px solid #EDEBE9")
            .style("display", "none")
            .style("z-index", "90")
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
            .attr("role", "slider")
            .attr("tabindex", "0")
            .attr("aria-label", this.getLocalizedString("ui.zoomRangeLabel", "Visible time range"))
            .attr("aria-roledescription", this.getLocalizedString("ui.zoomRangeRoleDescription", "range selection"))
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
            .attr("role", "slider")
            .attr("tabindex", "0")
            .attr("aria-label", this.getLocalizedString("ui.zoomRangeStartLabel", "Start of visible time range"))
            .style("position", "absolute")
            .style("left", "0")
            .style("top", "50%")
            .style("transform", "translate(-50%, -50%)")
            .style("width", `${handleSize}px`)
            .style("height", `${handleSize}px`)
            .style("background-color", "#605E5C")
            .style("border", `${handleBorderWidth}px solid #FFFFFF`)
            .style("border-radius", "50%")
            .style("cursor", "ew-resize")
            .style("box-shadow", "0 1px 3px rgba(0,0,0,0.2)")
            .style("z-index", "10");

        this.zoomSliderRightHandle = this.zoomSliderSelection.append("div")
            .attr("class", "zoom-slider-handle zoom-slider-handle-right")
            .attr("role", "slider")
            .attr("tabindex", "0")
            .attr("aria-label", this.getLocalizedString("ui.zoomRangeEndLabel", "End of visible time range"))
            .style("position", "absolute")
            .style("right", "0")
            .style("top", "50%")
            .style("transform", "translate(50%, -50%)")
            .style("width", `${handleSize}px`)
            .style("height", `${handleSize}px`)
            .style("background-color", "#605E5C")
            .style("border", `${handleBorderWidth}px solid #FFFFFF`)
            .style("border-radius", "50%")
            .style("cursor", "ew-resize")
            .style("box-shadow", "0 1px 3px rgba(0,0,0,0.2)")
            .style("z-index", "10");

        this.setupZoomSliderEvents();
        this.updateZoomSliderUI();
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
            })
            .on("keydown", function (event: KeyboardEvent) {
                self.handleZoomSliderKeydown(event, 'left');
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
            })
            .on("keydown", function (event: KeyboardEvent) {
                self.handleZoomSliderKeydown(event, 'right');
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
            })
            .on("keydown", function (event: KeyboardEvent) {
                self.handleZoomSliderKeydown(event, 'range');
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

    private applyZoomKeyboardChange(mutator: () => void): void {
        const previousStart = this.zoomRangeStart;
        const previousEnd = this.zoomRangeEnd;
        mutator();

        if (previousStart === this.zoomRangeStart && previousEnd === this.zoomRangeEnd) {
            return;
        }

        this.updateZoomSliderUI();
        this.captureScrollPosition();
        this.persistZoomRange();
        this.onZoomChange();
    }

    private handleZoomSliderKeydown(event: KeyboardEvent, target: 'left' | 'right' | 'range'): void {
        if (!this.zoomSliderEnabled) {
            return;
        }

        const fineStep = 0.01;
        const coarseStep = 0.05;
        const currentRange = this.zoomRangeEnd - this.zoomRangeStart;

        const panRange = (delta: number): void => {
            let newStart = this.zoomRangeStart + delta;
            let newEnd = this.zoomRangeEnd + delta;

            if (newStart < 0) {
                newStart = 0;
                newEnd = currentRange;
            }

            if (newEnd > 1) {
                newEnd = 1;
                newStart = 1 - currentRange;
            }

            this.zoomRangeStart = Math.max(0, newStart);
            this.zoomRangeEnd = Math.min(1, newEnd);
        };

        const resizeLeft = (delta: number): void => {
            this.zoomRangeStart = Math.max(
                0,
                Math.min(this.zoomRangeStart + delta, this.zoomRangeEnd - this.ZOOM_SLIDER_MIN_RANGE)
            );
        };

        const resizeRight = (delta: number): void => {
            this.zoomRangeEnd = Math.min(
                1,
                Math.max(this.zoomRangeEnd + delta, this.zoomRangeStart + this.ZOOM_SLIDER_MIN_RANGE)
            );
        };

        let handled = true;
        this.applyZoomKeyboardChange(() => {
            switch (event.key) {
                case 'ArrowLeft':
                case 'ArrowDown':
                    if (target === 'left') {
                        resizeLeft(-fineStep);
                    } else if (target === 'right') {
                        resizeRight(-fineStep);
                    } else {
                        panRange(-fineStep);
                    }
                    break;
                case 'ArrowRight':
                case 'ArrowUp':
                    if (target === 'left') {
                        resizeLeft(fineStep);
                    } else if (target === 'right') {
                        resizeRight(fineStep);
                    } else {
                        panRange(fineStep);
                    }
                    break;
                case 'PageDown':
                    if (target === 'left') {
                        resizeLeft(-coarseStep);
                    } else if (target === 'right') {
                        resizeRight(-coarseStep);
                    } else {
                        panRange(-coarseStep);
                    }
                    break;
                case 'PageUp':
                    if (target === 'left') {
                        resizeLeft(coarseStep);
                    } else if (target === 'right') {
                        resizeRight(coarseStep);
                    } else {
                        panRange(coarseStep);
                    }
                    break;
                case 'Home':
                    if (target === 'left') {
                        this.zoomRangeStart = 0;
                    } else if (target === 'right') {
                        this.zoomRangeEnd = this.zoomRangeStart + this.ZOOM_SLIDER_MIN_RANGE;
                    } else {
                        this.zoomRangeStart = 0;
                        this.zoomRangeEnd = currentRange;
                    }
                    break;
                case 'End':
                    if (target === 'left') {
                        this.zoomRangeStart = this.zoomRangeEnd - this.ZOOM_SLIDER_MIN_RANGE;
                    } else if (target === 'right') {
                        this.zoomRangeEnd = 1;
                    } else {
                        this.zoomRangeEnd = 1;
                        this.zoomRangeStart = 1 - currentRange;
                    }
                    break;
                default:
                    handled = false;
            }
        });

        if (!handled) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
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

        const startPercentText = (this.zoomRangeStart * 100).toFixed(1);
        const endPercentText = (this.zoomRangeEnd * 100).toFixed(1);
        const rangeCenterPercentText = (((this.zoomRangeStart + this.zoomRangeEnd) / 2) * 100).toFixed(1);
        const rangeValueText = `${startPercentText}% to ${endPercentText}%`;

        this.zoomSliderLeftHandle
            .attr("aria-valuemin", "0")
            .attr("aria-valuemax", "100")
            .attr("aria-valuenow", startPercentText)
            .attr("aria-valuetext", `${startPercentText}%`);

        this.zoomSliderRightHandle
            .attr("aria-valuemin", "0")
            .attr("aria-valuemax", "100")
            .attr("aria-valuenow", endPercentText)
            .attr("aria-valuetext", `${endPercentText}%`);

        this.zoomSliderSelection
            .attr("aria-valuemin", "0")
            .attr("aria-valuemax", "100")
            .attr("aria-valuenow", rangeCenterPercentText)
            .attr("aria-valuetext", rangeValueText);
    }

    private getZoomSliderHandleBorderWidth(handleSize: number): number {
        return Math.max(2, Math.min(4, Math.round(handleSize / 8)));
    }

    /**
     * Called when zoom changes - triggers visual update with throttling
     */
    private zoomChangeTimeout: ReturnType<typeof setTimeout> | null = null;

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
        const requestedSliderHeight = this.settings?.timelineZoom?.sliderHeight?.value ?? 32;
        const handleSize = this.settings?.timelineZoom?.sliderHandleSize?.value ?? 24;
        const handleBorderWidth = this.getZoomSliderHandleBorderWidth(handleSize);
        const sliderHeight = Math.max(requestedSliderHeight, handleSize + 6);
        const trackColor = this.settings?.timelineZoom?.sliderTrackColor?.value?.value ?? "#E1DFDD";
        const selectedColor = this.settings?.timelineZoom?.sliderSelectedColor?.value?.value ?? "#C8C6C4";
        const handleColor = this.settings?.timelineZoom?.sliderHandleColor?.value?.value ?? "#605E5C";

        this.zoomSliderEnabled = isEnabled;

        this.zoomSliderContainer
            .style("display", isEnabled ? "block" : "none")
            .style("height", `${sliderHeight}px`)
            .attr("aria-hidden", isEnabled ? "false" : "true");

        if (this.zoomSliderTrack) {
            this.zoomSliderTrack.style("background-color", trackColor);
        }

        if (this.zoomSliderSelection) {
            this.zoomSliderSelection
                .style("background-color", selectedColor)
                .attr("aria-disabled", isEnabled ? "false" : "true");
        }

        if (this.zoomSliderLeftHandle) {
            this.zoomSliderLeftHandle
                .style("background-color", handleColor)
                .style("width", `${handleSize}px`)
                .style("height", `${handleSize}px`)
                .style("border-width", `${handleBorderWidth}px`)
                .attr("aria-disabled", isEnabled ? "false" : "true");
        }

        if (this.zoomSliderRightHandle) {
            this.zoomSliderRightHandle
                .style("background-color", handleColor)
                .style("width", `${handleSize}px`)
                .style("height", `${handleSize}px`)
                .style("border-width", `${handleBorderWidth}px`)
                .attr("aria-disabled", isEnabled ? "false" : "true");
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

        const dpr = this.getCanvasPixelRatio();
        canvas.width = Math.max(1, Math.round(rect.width * dpr));
        canvas.height = Math.max(1, Math.round(rect.height * dpr));
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

        const leftMargin = this.getEffectiveLeftMargin();
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

        const clipPathId = this.getScopedId("chart-area-clip");
        let clipPath = defs.select<SVGClipPathElement>(`clipPath#${clipPathId}`);
        if (clipPath.empty()) {
            clipPath = defs.append("clipPath").attr("id", clipPathId);
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
        const arrowSize = this.getConnectorArrowSize();
        const connectorColor = this.settings?.connectorLines?.connectorColor?.value?.value ?? "#555555";
        const criticalColor = this.settings?.criticalPath?.criticalPathColor?.value?.value ?? "#E81123";

        // Create or update normal arrowhead marker
        const normalMarkerId = this.getScopedId("arrowhead");
        const criticalMarkerId = this.getScopedId("arrowhead-critical");

        let normalMarker = defs.select<SVGMarkerElement>(`marker#${normalMarkerId}`);
        if (normalMarker.empty()) {
            normalMarker = defs.append("marker")
                .attr("id", normalMarkerId)
                .attr("orient", "auto")
                .attr("markerUnits", "userSpaceOnUse");
            normalMarker.append("path");
        }
        normalMarker
            .attr("viewBox", `0 0 ${arrowSize} ${arrowSize}`)
            .attr("refX", arrowSize)
            .attr("refY", arrowSize / 2)
            .attr("markerWidth", arrowSize)
            .attr("markerHeight", arrowSize);
        normalMarker.select("path")
            .attr("d", `M 0,0 L ${arrowSize},${arrowSize / 2} L 0,${arrowSize} Z`)
            .attr("fill", connectorColor);

        // Create or update critical arrowhead marker
        let criticalMarker = defs.select<SVGMarkerElement>(`marker#${criticalMarkerId}`);
        if (criticalMarker.empty()) {
            criticalMarker = defs.append("marker")
                .attr("id", criticalMarkerId)
                .attr("orient", "auto")
                .attr("markerUnits", "userSpaceOnUse");
            criticalMarker.append("path");
        }
        criticalMarker
            .attr("viewBox", `0 0 ${arrowSize} ${arrowSize}`)
            .attr("refX", arrowSize)
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


            this.debugLog("Connector lines toggled and persisted");
        } catch (error) {
            console.error("Error in connector toggle method:", error);
        }
    }

    // ============================================================================
    // PDF Export Functionality
    // ============================================================================


    /**
     * Creates the export button in the header area
     */


    /**
     * Updates the export button visual state
     */
    private updateExportButtonState(loading: boolean): void {
        this.header.setExporting(loading);
    }

    private async exportVisualAsHtml(): Promise<void> {
        this.debugLog('[HTML Export] Starting export...');

        if (this.isExporting) {
            this.debugLog('[HTML Export] Export already in progress, skipping');
            return;
        }

        this.isExporting = true;

        try {
            const compositeCanvas = await this.renderCompositeExportCanvas(2, true);
            const chartImageDataUrl = compositeCanvas.toDataURL('image/png');
            const tableHtml = this.generateVisibleExportTableHtml();
            const plainText = this.generateVisibleExportTableText();
            const htmlContent = this.generateClipboardHtmlExportFragment(chartImageDataUrl, tableHtml);

            await this.copyHtmlExportToClipboard(htmlContent, plainText);
            this.showToast('HTML export copied to clipboard.', 3000);
        } catch (error) {
            console.error('[HTML Export] Export failed:', error);
            this.showToast('HTML export failed. Please try again.', 4000);
        } finally {
            this.isExporting = false;
        }
    }

    private getIntersectionRect(
        sourceRect: DOMRect,
        clipRect: DOMRect
    ): { left: number; top: number; width: number; height: number } | null {
        const left = Math.max(sourceRect.left, clipRect.left);
        const top = Math.max(sourceRect.top, clipRect.top);
        const right = Math.min(sourceRect.right, clipRect.right);
        const bottom = Math.min(sourceRect.bottom, clipRect.bottom);
        const width = right - left;
        const height = bottom - top;

        if (width <= 0 || height <= 0) {
            return null;
        }

        return { left, top, width, height };
    }

    private drawRenderedCanvasRegion(
        ctx: CanvasRenderingContext2D,
        sourceCanvas: CanvasImageSource,
        sourceRect: DOMRect,
        targetRect: DOMRect,
        clipRect: DOMRect,
        sourceScale: number
    ): void {
        const intersection = this.getIntersectionRect(sourceRect, clipRect);
        if (!intersection) {
            return;
        }

        const sx = Math.max(0, (intersection.left - sourceRect.left) * sourceScale);
        const sy = Math.max(0, (intersection.top - sourceRect.top) * sourceScale);
        const sw = intersection.width * sourceScale;
        const sh = intersection.height * sourceScale;
        const dx = intersection.left - targetRect.left;
        const dy = intersection.top - targetRect.top;

        ctx.drawImage(
            sourceCanvas,
            sx,
            sy,
            sw,
            sh,
            dx,
            dy,
            intersection.width,
            intersection.height
        );
    }

    private async renderCompositeExportCanvas(scaleFactor: number, includeAllFilteredContent: boolean = false): Promise<HTMLCanvasElement> {
        if (includeAllFilteredContent) {
            return this.renderFullFilteredCompositeExportCanvas(scaleFactor);
        }

        const visualWidth = Math.max(1, this.snapRectCoord(this.target.clientWidth));
        const visualHeight = Math.max(1, this.snapRectCoord(this.target.clientHeight));
        const targetRect = this.target.getBoundingClientRect();
        const scrollNode = this.scrollableContainer?.node();
        const scrollRect = scrollNode?.getBoundingClientRect() ?? targetRect;

        const outputCanvas = document.createElement('canvas');
        outputCanvas.width = Math.max(1, Math.round(visualWidth * scaleFactor));
        outputCanvas.height = Math.max(1, Math.round(visualHeight * scaleFactor));

        const ctx = outputCanvas.getContext('2d');
        if (!ctx) {
            throw new Error('Failed to get composite export canvas context');
        }

        ctx.setTransform(scaleFactor, 0, 0, scaleFactor, 0, 0);
        ctx.imageSmoothingEnabled = true;

        const bgColor = this.settings?.generalSettings?.visualBackgroundColor?.value?.value || '#FFFFFF';
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, visualWidth, visualHeight);

        const headerNode = this.headerSvg?.node() as SVGSVGElement | null;
        if (headerNode) {
            const headerCanvas = await this.svgToCanvas(headerNode, scaleFactor);
            this.drawRenderedCanvasRegion(ctx, headerCanvas, headerNode.getBoundingClientRect(), targetRect, targetRect, scaleFactor);
        }

        const mainSvgNode = this.mainSvg?.node() as SVGSVGElement | null;
        if (mainSvgNode) {
            const mainRect = mainSvgNode.getBoundingClientRect();
            const visibleMain = this.getIntersectionRect(mainRect, scrollRect);
            if (visibleMain) {
                const svgCrop = {
                    x: visibleMain.left - mainRect.left,
                    y: visibleMain.top - mainRect.top,
                    width: visibleMain.width,
                    height: visibleMain.height
                };
                const mainCanvas = await this.svgToCanvas(mainSvgNode, scaleFactor, svgCrop);
                ctx.drawImage(
                    mainCanvas,
                    0,
                    0,
                    mainCanvas.width,
                    mainCanvas.height,
                    visibleMain.left - targetRect.left,
                    visibleMain.top - targetRect.top,
                    visibleMain.width,
                    visibleMain.height
                );
            }
        }

        if (this.useCanvasRendering && this.canvasElement) {
            const canvasRect = this.canvasElement.getBoundingClientRect();
            const sourceScale = this.canvasElement.clientWidth > 0
                ? this.canvasElement.width / this.canvasElement.clientWidth
                : 1;
            this.drawRenderedCanvasRegion(ctx, this.canvasElement, canvasRect, targetRect, scrollRect, sourceScale);
        }

        return outputCanvas;
    }

    private async renderFullFilteredCompositeExportCanvas(scaleFactor: number): Promise<HTMLCanvasElement> {
        if (!this.xScale || !this.yScale || !this.mainSvg || !this.headerSvg) {
            return this.renderCompositeExportCanvas(scaleFactor, false);
        }

        const visualWidth = Math.max(1, this.snapRectCoord(this.target.clientWidth));
        const chartHeight = Math.max(1, this.snapRectCoord(this.yScale.range()[1]));
        const mainSvgHeight = Math.max(
            Math.max(1, this.snapRectCoord(parseFloat(this.mainSvg.attr("height")) || 0)),
            chartHeight + this.margin.top + this.margin.bottom
        );
        const exportHeight = this.headerHeight + mainSvgHeight;
        const currentLeftMargin = this.getEffectiveLeftMargin();
        const scrollNode = this.scrollableContainer?.node();
        const previousScrollTop = scrollNode?.scrollTop ?? 0;
        const previousViewportStart = this.viewportStartIndex;
        const previousViewportEnd = this.viewportEndIndex;
        const previousVisibleTaskCount = this.visibleTaskCount;
        const previousUseCanvasRendering = this.useCanvasRendering;

        try {
            this.forceSvgRenderingForExport = true;
            this.viewportStartIndex = 0;
            this.viewportEndIndex = Math.max(0, this.taskTotalCount - 1);
            this.visibleTaskCount = this.taskTotalCount;

            this.drawVisualElements(
                this.allTasksToShow,
                this.xScale,
                this.yScale,
                this.xScale.range()[1],
                chartHeight,
                currentLeftMargin
            );

            const outputCanvas = document.createElement('canvas');
            outputCanvas.width = Math.max(1, Math.round(visualWidth * scaleFactor));
            outputCanvas.height = Math.max(1, Math.round(exportHeight * scaleFactor));

            const ctx = outputCanvas.getContext('2d');
            if (!ctx) {
                throw new Error('Failed to get composite export canvas context');
            }

            ctx.setTransform(scaleFactor, 0, 0, scaleFactor, 0, 0);
            ctx.imageSmoothingEnabled = true;

            const bgColor = this.settings?.generalSettings?.visualBackgroundColor?.value?.value || '#FFFFFF';
            ctx.fillStyle = bgColor;
            ctx.fillRect(0, 0, visualWidth, exportHeight);

            const headerNode = this.headerSvg.node() as SVGSVGElement | null;
            if (headerNode) {
                const headerCanvas = await this.svgToCanvas(headerNode, scaleFactor);
                ctx.drawImage(headerCanvas, 0, 0, headerNode.getBoundingClientRect().width, headerNode.getBoundingClientRect().height);
            }

            const mainSvgNode = this.mainSvg.node() as SVGSVGElement | null;
            if (mainSvgNode) {
                const mainCanvas = await this.svgToCanvas(mainSvgNode, scaleFactor);
                ctx.drawImage(
                    mainCanvas,
                    0,
                    0,
                    mainCanvas.width,
                    mainCanvas.height,
                    0,
                    this.headerHeight,
                    visualWidth,
                    mainSvgHeight
                );
            }

            return outputCanvas;
        } finally {
            this.forceSvgRenderingForExport = false;
            this.viewportStartIndex = previousViewportStart;
            this.viewportEndIndex = previousViewportEnd;
            this.visibleTaskCount = previousVisibleTaskCount;
            this.useCanvasRendering = previousUseCanvasRendering;

            if (scrollNode) {
                scrollNode.scrollTop = previousScrollTop;
            }

            this.redrawVisibleTasks();
        }
    }


    /**
     * Exports the visual as a PDF file using Power BI Download Service API
     * Falls back to direct download if the service is unavailable
     */
    private async exportToPDF(): Promise<void> {
        this.debugLog('[PDF Export] Starting export...');

        if (this.isExporting) {
            this.debugLog('[PDF Export] Export already in progress, skipping');
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
            this.debugLog('[PDF Export] Generating PDF content...');
            const pdfBase64 = await this.generatePDFContent();
            this.debugLog('[PDF Export] PDF content generated, size:', pdfBase64.length, 'chars');

            // Try Power BI Download Service first
            if (this.downloadService) {
                try {
                    this.debugLog('[PDF Export] Checking download service status...');
                    const status = await this.downloadService.exportStatus();
                    this.debugLog('[PDF Export] Export status:', status);

                    if (status === PrivilegeStatus.Allowed) {
                        this.debugLog('[PDF Export] Triggering download via Power BI API...');
                        const result = await this.downloadService.exportVisualsContentExtended(
                            pdfBase64,
                            filename,
                            'base64',
                            'PDF export of Gantt chart visualization'
                        );

                        if (result.downloadCompleted) {
                            this.debugLog('[PDF Export] Download completed successfully:', result.fileName);
                            return; // Success!
                        } else {
                            console.warn('[PDF Export] Download may not have completed, trying fallback...');
                        }
                    } else {
                        this.debugLog('[PDF Export] Export not allowed by Power BI, status:', status);
                        // Still try fallback - it has better messaging for Desktop users
                    }
                } catch (apiError) {
                    console.warn('[PDF Export] Power BI API failed, trying fallback:', apiError);
                }
            } else {
                this.debugLog('[PDF Export] Download service not available, using fallback');
            }

            // Fallback: Direct download using blob URL
            this.debugLog('[PDF Export] Using fallback download method...');
            this.fallbackDownload(pdfBase64, filename);

        } catch (error) {
            console.error('[PDF Export] Export failed:', error);
            this.showToast('PDF export failed. Please try again.', 4000);
        } finally {
            this.isExporting = false;
            this.updateExportButtonState(false);
            this.debugLog('[PDF Export] Export process finished');
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

                this.debugLog('[PDF Export] Fallback download initiated:', filename);
                return;
            } catch (downloadError) {
                console.warn('[PDF Export] Direct download blocked, trying window.open...', downloadError);
            }

            // Try method 2: Open in new window (works in some Desktop scenarios)
            try {
                const dataUri = 'data:application/pdf;base64,' + base64Content;
                const newWindow = window.open(dataUri, '_blank');
                if (newWindow) {
                    this.debugLog('[PDF Export] Opened PDF in new tab. Use Ctrl+S or right-click to save.');
                    this.showToast('PDF opened in a new tab. Use Ctrl+S or right-click to save it.', 5000);
                    return;
                }
            } catch (windowError) {
                console.warn('[PDF Export] window.open blocked:', windowError);
            }

            // Method 3: Copy to clipboard as last resort
            this.debugLog('[PDF Export] All download methods blocked. Showing manual instructions.');
            this.showToast(
                'PDF Export is blocked by browser security. Publish to Power BI Service or use File → Export → PDF.',
                6000
            );
        } catch (error) {
            console.error('[PDF Export] Fallback download failed:', error);
            this.showToast('Unable to download PDF in this environment.', 4000);
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
        this.showToast(userMessage.replace(/\n/g, ' '), 5000);
        this.isExporting = false;
        this.updateExportButtonState(false);
    }

    /**
     * Generates PDF content by compositing all visual layers onto a single canvas
     * @returns Base64 encoded PDF content
     */
    private async generatePDFContent(): Promise<string> {
        const scaleFactor = 2;
        const visualWidth = Math.max(1, this.snapRectCoord(this.target.clientWidth));
        const visualHeight = Math.max(1, this.snapRectCoord(this.target.clientHeight));
        const outputCanvas = await this.renderCompositeExportCanvas(scaleFactor);

        // Use JPEG with quality 0.92 for much smaller file size (PNG would be ~32MB, JPEG ~1-2MB)
        const imgData = outputCanvas.toDataURL('image/jpeg', 0.92);
        this.debugLog('[PDF Export] Image data size:', Math.round(imgData.length / 1024), 'KB');

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
    private svgToCanvas(
        svg: SVGSVGElement,
        scaleFactor: number = 2,
        crop?: { x: number; y: number; width: number; height: number }
    ): Promise<HTMLCanvasElement> {
        return new Promise((resolve, reject) => {
            try {
                // Clone the SVG to avoid modifying the original
                const clonedSvg = svg.cloneNode(true) as SVGSVGElement;

                // Ensure the SVG has proper namespace
                clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
                // eslint-disable-next-line powerbi-visuals/no-http-string
                clonedSvg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

                const bbox = svg.getBoundingClientRect();
                const renderWidth = Math.max(1, crop ? crop.width : bbox.width);
                const renderHeight = Math.max(1, crop ? crop.height : bbox.height);

                if (crop) {
                    clonedSvg.setAttribute('viewBox', `${crop.x} ${crop.y} ${crop.width} ${crop.height}`);
                } else if (!clonedSvg.getAttribute('viewBox')) {
                    clonedSvg.setAttribute('viewBox', `0 0 ${bbox.width} ${bbox.height}`);
                }

                clonedSvg.setAttribute('width', String(renderWidth));
                clonedSvg.setAttribute('height', String(renderHeight));

                const svgData = new XMLSerializer().serializeToString(clonedSvg);
                const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
                const url = URL.createObjectURL(svgBlob);

                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, Math.round(renderWidth * scaleFactor));
                    canvas.height = Math.max(1, Math.round(renderHeight * scaleFactor));

                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        ctx.setTransform(scaleFactor, 0, 0, scaleFactor, 0, 0);
                        ctx.drawImage(img, 0, 0, renderWidth, renderHeight);
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
        const hasTotalFloat = this.dataProcessor.hasDataRole(dataView, 'taskTotalFloat');

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
        // Fix for stale updates: Force viewport to match actual container size if larger
        // This prevents the visual from resizing down to a cached small size when in Focus Mode
        // Note: Create a local copy to avoid mutating the host-owned options object
        const bypassResizeSettle = this.settledResizeViewportKey === this.getViewportKey(options.viewport);
        if (this.target) {
            const actualWidth = this.target.clientWidth;
            const actualHeight = this.target.clientHeight;

            // Detect significant resize (entering OR exiting Focus Mode)
            // If dimensions change by >10%, trigger the clean re-render flow.
            const isSignificantResize = !bypassResizeSettle && this.lastViewport && (
                Math.abs(this.lastViewport.width - options.viewport.width) / (this.lastViewport.width || 1) > this.VIEWPORT_CHANGE_THRESHOLD ||
                Math.abs(this.lastViewport.height - options.viewport.height) / (this.lastViewport.height || 1) > this.VIEWPORT_CHANGE_THRESHOLD
            );

            // Active cooldown from a recent large resize
            const inResizeCooldown = Date.now() < this.viewportResizeCooldownUntil;

            if (isSignificantResize) {
                this.debugLog(`Significant resize detected. Hiding content and waiting for container to settle.`);
                // Capture scroll position so the re-render restores it
                if (this.scrollableContainer?.node()) {
                    this.preservedScrollTop = this.scrollableContainer.node().scrollTop;
                    this.preserveScrollOnUpdate = true;
                    this.scrollPreservationUntil = Date.now() + 2000;
                    this.debugLog(`Resize: Captured scrollTop=${this.preservedScrollTop}`);
                }
                this.viewportResizeCooldownUntil = Date.now() + 400;
                this.hideContentForResize();
                this.scheduleSettledResizeUpdate(options);
                return;
            } else if (inResizeCooldown && !bypassResizeSettle) {
                this.debugLog(`In resize cooldown — skipping update`);
                return;
            } else if (options.viewport.width < actualWidth || options.viewport.height < actualHeight) {
                this.debugLog(`Viewport mismatch detected. Override: [${options.viewport.width}x${options.viewport.height}] -> [${actualWidth}x${actualHeight}]`);
                options = {
                    ...options,
                    viewport: { width: actualWidth, height: actualHeight }
                };
            }
        }

        // Handle concurrent updates by debouncing
        if (this.isUpdating) {
            this.debugLog("Update already in progress, queuing next update.");
            this.pendingUpdate = options;
            this.debouncedUpdate();
            return;
        }

        if (bypassResizeSettle) {
            this.settledResizeViewportKey = null;
        }

        this.debugLog("===== UPDATE() CALLED =====");
        this.debugLog("Update type:", options.type);
        this.debugLog("Has dataViews:", !!options.dataViews);

        // Rendering lifecycle is managed inside updateInternal — no double-signalling
        this.updateInternal(options)
            .catch(error => {
                console.error("Error during update:", error);
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
            cancelAnimationFrame(this.scrollThrottleTimeout);
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

        // Update lastUpdateOptions early to ensure viewport data is current for rendering
        // Update lastUpdateOptions early to ensure viewport data is current for rendering (MOVED)

        try {
            const updateType = this.determineUpdateType(options);
            // Update lastUpdateOptions after determining update type so we compare against previous state
            this.lastUpdateOptions = options;
            this.debugLog(`Update type detected: ${updateType}`);

            // Hide content during significant viewport changes (e.g. Focus Mode)
            // to prevent the 3-step layout thrashing stutter
            if (updateType === UpdateType.Full && this.lastViewport) {
                const widthRatio = Math.abs(options.viewport.width - this.lastViewport.width) / (this.lastViewport.width || 1);
                const heightRatio = Math.abs(options.viewport.height - this.lastViewport.height) / (this.lastViewport.height || 1);
                if (widthRatio > this.VIEWPORT_CHANGE_THRESHOLD || heightRatio > this.VIEWPORT_CHANGE_THRESHOLD) {
                    this.hideContentForResize();
                }
            }

            // ... (rest of logic) ...


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
                this.displayLandingPage();
                return;
            }

            const dataView = options.dataViews[0];
            const viewport = options.viewport;
            // Use the larger of options.viewport and the actual container size,
            // UNLESS we are in a resize cooldown (exiting/entering Focus Mode) where
            // the container hasn't settled yet but PBI's viewport is authoritative.
            const inCooldown = Date.now() < this.viewportResizeCooldownUntil;
            const viewportWidth = inCooldown
                ? viewport.width
                : Math.max(viewport.width, this.target?.clientWidth ?? viewport.width);
            const viewportHeight = inCooldown
                ? viewport.height
                : Math.max(viewport.height, this.target?.clientHeight ?? viewport.height);
            const renderedViewport: IViewport = { width: viewportWidth, height: viewportHeight };
            this.lastViewport = renderedViewport;
            this.lastUpdateOptions = { ...options, viewport: renderedViewport };
            const dataSignature = this.getDataSignature(dataView);
            const hadWbsInPreviousUpdate = this.wbsDataExistsInMetadata || this.wbsDataExists;
            const previousWbsEnabled = this.settings?.wbsGrouping?.enableWbsGrouping?.value;
            if (hadWbsInPreviousUpdate && previousWbsEnabled !== undefined && previousWbsEnabled !== null) {
                this.rememberedWbsGroupingEnabled = previousWbsEnabled;
            }
            const dataChanged = (options.type & VisualUpdateType.Data) !== 0 ||
                this.lastDataSignature !== dataSignature;

            if (dataChanged) {
                this.logDataLoadInfo(dataView);
            }

            this.setLoadingOverlayVisible(false);

            this.wbsLevelColumnIndices = [];
            this.wbsLevelColumnNames = [];
            this.wbsDataExistsInMetadata = this.dataProcessor.hasDataRole(dataView, 'wbsLevels');
            const wbsBindingSignature = this.getWbsBindingSignature(dataView);
            const wbsBindingChanged = wbsBindingSignature !== this.lastWbsBindingSignature;

            if (wbsBindingChanged) {
                this.debugLog("WBS binding change detected; resetting WBS expand state.", {
                    previous: this.lastWbsBindingSignature,
                    current: wbsBindingSignature
                });
                this.resetWbsBindingState();
                this.lastWbsBindingSignature = wbsBindingSignature;
            }

            if (this.wbsDataExistsInMetadata) {
                const layout = this.dataProcessor.getRoleColumnLayout(dataView, 'wbsLevels');
                this.wbsLevelColumnIndices = layout.indices;
                this.wbsLevelColumnNames = layout.names;
            }

            this.settings = this.formattingSettingsService.populateFormattingSettingsModel(VisualSettings, dataView);

            if (this.settings?.wbsGrouping?.enableWbsGrouping) {
                if (this.wbsEnableOverride !== null) {
                    this.settings.wbsGrouping.enableWbsGrouping.value = this.wbsEnableOverride;
                    this.rememberedWbsGroupingEnabled = this.wbsEnableOverride;
                } else if (this.wbsDataExistsInMetadata && !hadWbsInPreviousUpdate && this.rememberedWbsGroupingEnabled !== null) {
                    this.settings.wbsGrouping.enableWbsGrouping.value = this.rememberedWbsGroupingEnabled;
                } else if (this.wbsDataExistsInMetadata) {
                    this.rememberedWbsGroupingEnabled = this.settings.wbsGrouping.enableWbsGrouping.value;
                }
            }

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

            this.showAllTasksInternal = this.settings?.criticalPath?.showAllTasks?.value
                ?? Visual.DEFAULT_SHOW_ALL_TASKS;

            if (this.isInitialLoad) {
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
                    this.selectedLegendCategories = new Set(parsePersistedLegendSelection(savedCategories));
                    this.debugLog(`Restored legend selection: ${savedCategories ?? ""}`);
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

            this.applyHeaderHeight();

            this.updateMarginResizerPosition();

            this.clearVisual();
            this.updateHeaderElements(viewportWidth);

            this.createpathSelectionDropdown();
            this.createTraceModeToggle();

            if (!this.dataProcessor.validateDataView(dataView, this.settings)) {
                const missingRoles = this.getMissingRequiredRoles(dataView);
                this.displayLandingPage(missingRoles);
                return;
            }
            this.debugLog("Data roles validated.");

            const shouldTransform = dataChanged || this.allTasksData.length === 0;
            if (shouldTransform) {
                const processedData = this.dataProcessor.processData(
                    dataView,
                    this.settings,
                    this.wbsExpandedState,
                    this.wbsManuallyToggledGroups,
                    this.lastExpandCollapseAllState,
                    this.highContrastMode,
                    this.highContrastForeground
                );

                // Update local state from processed data
                this.allTasksData = processedData.allTasksData;
                this.relationships = processedData.relationships;
                this.taskIdToTask = processedData.taskIdToTask;
                this.predecessorIndex = processedData.predecessorIndex;
                this.relationshipIndex = processedData.relationshipIndex;
                this.relationshipByPredecessor = processedData.relationshipByPredecessor;
                this.dataDate = processedData.dataDate;
                this.hasUserProvidedFloat = processedData.hasUserProvidedFloat;
                this.legendDataExists = processedData.legendDataExists;
                this.legendCategories = processedData.legendCategories;
                this.legendColorMap = processedData.legendColorMap;
                this.legendFieldName = processedData.legendFieldName;
                this.sanitizeLegendSelectionState(true);
                this.wbsDataExists = processedData.wbsDataExists;
                this.wbsGroups = processedData.wbsGroups;
                this.wbsGroupMap = processedData.wbsGroupMap;
                this.wbsRootGroups = processedData.wbsRootGroups;
                this.wbsAvailableLevels = processedData.wbsAvailableLevels;
                this.taskIdQueryName = processedData.taskIdQueryName;
                this.taskIdTable = processedData.taskIdTable;
                this.taskIdColumn = processedData.taskIdColumn;
                this.wbsLevelColumnIndices = processedData.wbsLevelColumnIndices;
                this.wbsLevelColumnNames = processedData.wbsLevelColumnNames;
                this.dataQuality = processedData.dataQuality;

                this.lastDataSignature = dataSignature;
                this.cachedSortedTasksSignature = null;
                this.dropdownNeedsRefresh = true;
            } else {
                this.debugLog("Skipping data transform; using cached task data");
            }

            // Detect which optional fields are bound and have data,
            // then override internal toggle flags to force-hide when unavailable.
            // Must run AFTER data processing so allTasksData is populated.
            this.boundFields = this.dataProcessor.detectBoundFields(dataView, this.allTasksData || []);
            if (!this.boundFields.baselineAvailable) {
                this.showBaselineInternal = false;
            }
            if (!this.boundFields.previousUpdateAvailable) {
                this.showPreviousUpdateInternal = false;
            }

            this.settings = this.formattingSettingsService.populateFormattingSettingsModel(VisualSettings, dataView);
            this.applyHeaderHeight();
            this.updateDataQualityWarning();

            if (this.wbsEnableOverride !== null && this.settings?.wbsGrouping?.enableWbsGrouping) {
                this.settings.wbsGrouping.enableWbsGrouping.value = this.wbsEnableOverride;
                this.wbsEnableOverride = null;
            }

            if (this.selectedTaskId && !this.taskIdToTask.has(this.selectedTaskId)) {
                this.debugLog(`Selected task ${this.selectedTaskId} no longer exists in data`);
                this.selectTask(null, null);
            }

            if (this.allTasksData.length === 0) {
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
                    this.dropdownInput.property("value", this.filterKeyword || "");
                }
            }

            this.updateSelectedTaskStatusLabel(viewportWidth);

            if (this.dropdownList && this.dropdownList.style("display") !== "none") {
                this.populateTaskDropdown();
            }
            this.createTraceModeToggle();
            this.applyHighContrastStyling();

            const enableTaskSelection = this.settings.pathSelection.enableTaskSelection.value;
            const mode = this.settings.criticalPath.calculationMode.value.value;
            const longestPathUnavailable = mode === 'longestPath' && !this.isCpmSafe();

            let predecessorTaskSet = new Set<string>();
            let successorTaskSet = new Set<string>();

            if (longestPathUnavailable) {
                this.clearCriticalPathState();
            } else if (enableTaskSelection && this.selectedTaskId) {
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
                } else if (!longestPathUnavailable) {
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

                if (longestPathUnavailable) {
                    tasksToConsider = plottableTasksSorted;
                } else if (this.showAllTasksInternal) {
                    tasksToConsider = relevantPlottableTasks.length > 0 ? relevantPlottableTasks : plottableTasksSorted;
                } else {
                    if (mode === 'floatBased') {
                        // Float-Based + Trace + Show Critical: only show tasks with float <= 0 in the traced path
                        // If no critical tasks exist in the traced path, show nothing (empty)
                        const criticalTraceTasks = relevantPlottableTasks.filter(task => task.isCritical || task.isNearCritical);
                        tasksToConsider = criticalTraceTasks;
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

                let baseTasks: Task[];
                if (longestPathUnavailable || this.showAllTasksInternal) {
                    baseTasks = plottableTasksSorted;
                } else {
                    baseTasks = criticalAndNearCriticalTasks;
                }

                if (this.filterKeyword && this.filterKeyword.trim().length > 0) {
                    const lowerFilter = this.filterKeyword.toLowerCase();
                    tasksToConsider = baseTasks.filter(t => (t.name || "").toLowerCase().includes(lowerFilter));
                } else {
                    tasksToConsider = baseTasks;
                }
            }

            if (tasksToConsider === plottableTasksSorted) {
                tasksToConsider = [...plottableTasksSorted];
            }

            const maxTasksToShowSetting = this.settings.layoutSettings.maxTasksToShow.value;
            const limitedTasks = this.limitTasks(tasksToConsider, maxTasksToShowSetting);

            if (limitedTasks.length === 0) {
                this.updateLegendScopeForTasks([], true);
                this.displayMessage("No tasks to display after filtering/limiting.");
                this.renderLegend(viewportWidth, viewportHeight);
                return;
            }

            const tasksToPlot = limitedTasks.filter(task => this.hasValidPlotDates(task));
            this.updateLegendScopeForTasks(tasksToPlot, true);

            if (tasksToPlot.length === 0) {
                this.displayMessage("Selected tasks lack valid Start/Finish dates required for plotting.");
                this.renderLegend(viewportWidth, viewportHeight);
                return;
            }

            const wbsGroupingEnabled = this.wbsDataExists &&
                this.settings?.wbsGrouping?.enableWbsGrouping?.value;
            const hasActiveLegendFilter = this.hasLegendFilterAvailable() && this.selectedLegendCategories.size > 0;

            let tasksAfterLegendFilter = tasksToPlot;
            if (hasActiveLegendFilter) {
                tasksAfterLegendFilter = tasksToPlot.filter(task => {
                    const normalizedLegendValue = normalizeLegendCategory(task.legendValue);
                    if (normalizedLegendValue) {
                        return this.selectedLegendCategories.has(normalizedLegendValue);
                    }
                    return true;
                });
            }

            if (wbsGroupingEnabled) {
                // Ensure the WBS expansion level defaults are applied if a global level is set
                // (Custom overrides are handled by wbsExpandedState in processData, but global levels need explicit application)
                if (this.wbsExpandToLevel !== undefined) {
                    this.applyWbsExpandLevel(this.wbsExpandToLevel);
                }
                this.updateWbsFilteredCounts(tasksAfterLegendFilter);
            }

            // Save the fully-filtered tasks BEFORE WBS ordering strips collapsed ones.
            // This is the correct source for finish line calculations (same data WBS
            // summary bars use), as it respects LP/Search/Legend filters but NOT
            // WBS collapse state.
            this._lastFilteredTasksForFinishLines = tasksAfterLegendFilter;

            let orderedTasks: Task[];
            if (wbsGroupingEnabled) {
                orderedTasks = this.applyWbsOrdering(tasksAfterLegendFilter);
            } else {
                orderedTasks = [...tasksAfterLegendFilter].sort((a, b) => {
                    const aStart = this.getVisualStart(a)?.getTime() ?? 0;
                    const bStart = this.getVisualStart(b)?.getTime() ?? 0;
                    return aStart - bStart;
                });
            }

            // Update allFilteredTasks with the properly ordered tasks
            // This ensures export matches display order (WBS-grouped when enabled)
            this.allFilteredTasks = orderedTasks;
            this.debugLog(`[DIAG-ASSIGN] allFilteredTasks=${this.allFilteredTasks.length}, durable=${this._lastFilteredTasksForFinishLines.length}`);

            let tasksToShow = orderedTasks;

            if (wbsGroupingEnabled) {
                this.assignWbsYOrder(tasksToShow);
            } else {

                tasksToShow.forEach((task, index) => { task.yOrder = index; });
            }

            const tasksWithYOrder = tasksToShow.filter(t => t.yOrder !== undefined);
            const visibleGroupCount = wbsGroupingEnabled ? this.wbsGroups.filter(g => g.yOrder !== undefined).length : 0;

            if (tasksWithYOrder.length === 0 && visibleGroupCount === 0) {
                if (tasksAfterLegendFilter.length === 0 && hasActiveLegendFilter) {
                    this.displayMessage("No tasks match the current legend selection.");
                } else if (wbsGroupingEnabled) {
                    this.displayMessage("All WBS groups are collapsed. Expand a group to view tasks.");
                } else {
                    this.displayMessage("No tasks to display after filtering.");
                }
                this.renderLegend(viewportWidth, viewportHeight);
                return;
            }

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
                this.displayMessage("Could not create time/band scale. Check Start/Finish dates.");
                return;
            }

            this.syncSvgPixelSize(this.mainSvg, viewportWidth, totalSvgHeight);
            this.syncSvgPixelSize(this.headerSvg, viewportWidth, this.headerHeight);

            const effectiveMargin = this.getEffectiveLeftMargin();
            this.mainGroup.attr("transform", `translate(${this.snapRectCoord(effectiveMargin)}, ${this.snapRectCoord(this.margin.top)})`);
            this.headerGridLayer.attr("transform", `translate(${this.snapRectCoord(effectiveMargin)}, 0)`);

            this.createMarginResizer();

            const legendVisible = this.settings.legend.show.value && this.legendDataExists && this.getRenderableLegendCategories().length > 0;
            const legendOffset = legendVisible ? this.getLegendEffectiveFooterHeight(viewportWidth) : 0;
            const availableContentHeight = Math.max(0, viewportHeight - this.headerHeight - legendOffset);

            this.scrollableContainer
                .style("height", `${availableContentHeight}px`)
                .style("overflow-y", totalSvgHeight > availableContentHeight ? "scroll" : "hidden");

            this.taskElementHeight = taskHeight + taskPadding;

            this.restoreScrollPosition(totalSvgHeight);

            this.setupVirtualScroll(tasksToShow, taskHeight, taskPadding, totalRows, true);

            const visibleTasks = this.getVisibleTasks();

            this.drawVisualElements(visibleTasks, this.xScale, this.yScale, chartWidth, calculatedChartHeight, this.getEffectiveLeftMargin());

            this.renderLegend(viewportWidth, viewportHeight);

            this.updateHeaderElements(viewportWidth);

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

            this.displayMessage(`Error updating visual: ${errorMessage}`);
        } finally {
            if (!renderingFailed) {
                eventService?.renderingFinished(options);
            }
            this.isUpdating = false;

            // Reveal content after rendering completes — uses rAF to ensure
            // the browser paints the fully-rendered frame in one shot
            if (this.isViewportTransitioning) {
                requestAnimationFrame(() => this.revealContentAfterResize());
            }

            if (this.scrollHandlerBackup && this.scrollableContainer) {
                this.scrollableContainer.on("scroll", this.scrollHandlerBackup);
                this.scrollHandlerBackup = null;
                this.debugLog("Scroll handler restored in finally block");
            }

            // Safe-guard for iOS/Late-settling containers:
            // Sometime webviews report 0 or incorrect size initially, and even ResizeObserver might race.
            // A short delay double-check ensures we catch these late layout settlements.
            setTimeout(() => {
                // Skip safeguard during resize cooldown — the container hasn't
                // settled yet but PBI's viewport is authoritative, so the mismatch
                // is expected and should not trigger a forced update.
                if (Date.now() < this.viewportResizeCooldownUntil) {
                    this.debugLog(`[Safeguard] Skipped — in resize cooldown`);
                    return;
                }
                if (this.target && this.lastViewport) {
                    const currentWidth = this.target.clientWidth;
                    const currentHeight = this.target.clientHeight;

                    if (Math.abs(currentWidth - this.lastViewport.width) > 5 ||
                        Math.abs(currentHeight - this.lastViewport.height) > 5) {

                        this.debugLog(`[Safeguard] Size mismatch detected after delay: Rendered=[${this.lastViewport.width}x${this.lastViewport.height}], Actual=[${currentWidth}x${currentHeight}]. Forcing update.`);
                        this.requestUpdate(true);
                    }
                }
            }, 250);


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

        // Ensure we use the full available width from the container if larger than the options viewport
        // This fixes issues where Power BI sends a stale/small viewport after a resize event
        let viewportWidth = options.viewport.width;
        let viewportHeight = options.viewport.height;

        // Use the full available width from the container if larger than the options viewport,
        // UNLESS we are in a resize cooldown (exiting/entering Focus Mode).
        if (this.target && Date.now() >= this.viewportResizeCooldownUntil) {
            viewportWidth = Math.max(viewportWidth, this.target.clientWidth);
            viewportHeight = Math.max(viewportHeight, this.target.clientHeight);
        }
        const renderedViewport: IViewport = { width: viewportWidth, height: viewportHeight };
        this.lastViewport = renderedViewport;
        this.lastUpdateOptions = { ...options, viewport: renderedViewport };

        this.updateHeaderElements(viewportWidth);

        const chartWidth = Math.max(10, viewportWidth - this.getEffectiveLeftMargin() - this.margin.right);
        const legendVisible = this.settings.legend.show.value && this.legendDataExists && this.getRenderableLegendCategories().length > 0;
        const legendOffset = legendVisible ? this.getLegendEffectiveFooterHeight(viewportWidth) : 0;
        const availableContentHeight = Math.max(0, viewportHeight - this.headerHeight - legendOffset);
        const totalSvgHeight = this.taskTotalCount * this.taskElementHeight +
            this.margin.top + this.margin.bottom;

        this.scrollableContainer.style("height", `${availableContentHeight}px`)
            .style("overflow-y", totalSvgHeight > availableContentHeight ? "scroll" : "hidden");

        this.syncSvgPixelSize(this.mainSvg, viewportWidth);
        this.syncSvgPixelSize(this.headerSvg, viewportWidth, this.headerHeight);

        if (this.xScale) {
            this.xScale.range([0, chartWidth]);
            this.debugLog(`Updated X scale range to [0, ${chartWidth}]`);


        }

        this.calculateVisibleTasks();

        // Optimized: Skip full clear to allow efficient D3 updates
        // this.clearVisual();

        const visibleTasks = this.getVisibleTasks();
        const renderableTasks = visibleTasks.filter(t => t.yOrder !== undefined);

        if (this.xScale && this.yScale) {
            this.drawVisualElements(
                renderableTasks,
                this.xScale,
                this.yScale,
                chartWidth,
                this.yScale.range()[1],
                this.getEffectiveLeftMargin()
            );
        }

        // Reveal if we were transitioning (viewport-only path)
        if (this.isViewportTransitioning) {
            requestAnimationFrame(() => this.revealContentAfterResize());
        }

        this.debugLog("--- Visual Update End (Viewport Only) ---");
    }

    /**
     * Hides visual content to prevent visible layout thrashing during
     * significant viewport changes (e.g. entering/exiting Focus Mode).
     *
     * Uses opacity (not visibility) because CSS visibility on a parent CAN
     * be overridden by children that set visibility:visible — which happens
     * when showLoading(false) restores mainSvg visibility.  Opacity on a
     * parent creates a stacking context that children cannot override.
     */
    private hideContentForResize(): void {
        this.isViewportTransitioning = true;
        if (this.target) {
            d3.select(this.target).select(".visual-wrapper")
                .style("opacity", "0")
                .style("pointer-events", "none");
        }
        this.debugLog("Content hidden for viewport transition");
    }

    /**
     * Reveals visual content after rendering has completed,
     * producing a clean single-frame transition.
     */
    private revealContentAfterResize(): void {
        this.isViewportTransitioning = false;
        if (this.target) {
            d3.select(this.target).select(".visual-wrapper")
                .style("opacity", "1")
                .style("pointer-events", null);
        }
        this.debugLog("Content revealed after viewport transition");
    }

    private handleSettingsOnlyUpdate(options: VisualUpdateOptions): void {
        this.debugLog("Performing settings-only update");

        const oldSelectedPathIndex = this.settings?.pathSelection?.selectedPathIndex?.value;
        const oldMultiPathEnabled = this.settings?.pathSelection?.enableMultiPathToggle?.value;
        const oldShowPathInfo = this.settings?.pathSelection?.showPathInfo?.value;
        const oldMode = this.settings?.criticalPath?.calculationMode?.value?.value ?? 'floatBased';

        if (options.dataViews?.[0]) {
            // TODO: Re-integrate legend processing via DataProcessor
            // this.processLegendData(options.dataViews[0]);
        }

        this.settings = this.formattingSettingsService.populateFormattingSettingsModel(
            VisualSettings, options.dataViews[0]);

        const newSelectedPathIndex = this.settings?.pathSelection?.selectedPathIndex?.value;
        const newMultiPathEnabled = this.settings?.pathSelection?.enableMultiPathToggle?.value;
        const newShowPathInfo = this.settings?.pathSelection?.showPathInfo?.value;
        const mode = this.settings?.criticalPath?.calculationMode?.value?.value ?? 'floatBased';

        this.debugLog(`[Settings Update] Old path index: ${oldSelectedPathIndex}, New: ${newSelectedPathIndex}`);
        this.debugLog(`[Settings Update] Old multi-path: ${oldMultiPathEnabled}, New: ${newMultiPathEnabled}`);
        this.debugLog(`[Settings Update] Old show info: ${oldShowPathInfo}, New: ${newShowPathInfo}`);

        const requiresPathRecalc = oldSelectedPathIndex !== newSelectedPathIndex ||
            oldMultiPathEnabled !== newMultiPathEnabled ||
            oldMode !== mode;
        const pathInfoVisibilityChanged = oldShowPathInfo !== newShowPathInfo;

        if (this.settings?.comparisonBars?.showBaseline !== undefined) {
            this.showBaselineInternal = this.settings.comparisonBars.showBaseline.value;
        }

        if (this.settings?.comparisonBars?.showPreviousUpdate !== undefined) {
            this.showPreviousUpdateInternal = this.settings.comparisonBars.showPreviousUpdate.value;
        }

        // Override internal toggle flags when optional fields are unbound or all-null
        if (!this.boundFields.baselineAvailable) {
            this.showBaselineInternal = false;
        }
        if (!this.boundFields.previousUpdateAvailable) {
            this.showPreviousUpdateInternal = false;
        }

        if (this.settings?.connectorLines?.showConnectorLines !== undefined) {
            this.showConnectorLinesInternal = this.settings.connectorLines.showConnectorLines.value;
        }

        if (this.settings?.columns?.enableColumnDisplay !== undefined) {
            this.showExtraColumnsInternal = this.settings.columns.enableColumnDisplay.value;
        }


        this.applyHeaderHeight();
        this.updateDataQualityWarning();


        if (requiresPathRecalc) {
            this.debugLog("Path-related settings changed; scheduling a full refresh.");
            this.forceFullUpdate = true;
            this.requestUpdate();
            return;
        }

        if (pathInfoVisibilityChanged) {
            this.updatePathInfoLabel(options.viewport.width);
        }
        this.mainSvg?.selectAll(".message-text").remove();
        this.headerSvg?.selectAll(".message-text").remove();
        this.clearAccessibleCanvasFallback();

        this.updateHeaderElements(options.viewport.width);

        this.createpathSelectionDropdown();

        if (this.dropdownInput) {
            if (this.selectedTaskId) {
                this.dropdownInput.property("value", this.selectedTaskName || "");
            } else {
                this.dropdownInput.property("value", "");
            }
        }

        this.updateSelectedTaskStatusLabel(options.viewport.width);

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
            this.syncSvgPixelSize(this.mainSvg, options.viewport.width, totalSvgHeight);
            this.taskTotalCount = totalRows;

            this.calculateVisibleTasks();

            const visibleTasks = this.getVisibleTasks();

            if (this.xScale && this.yScale) {
                this.drawVisualElements(
                    visibleTasks,
                    this.xScale,
                    this.yScale,
                    chartWidth,
                    calculatedChartHeight,
                    this.getEffectiveLeftMargin()
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
        const lineColor = UI_TOKENS.color.neutral.grey60;

        this.marginResizer = wrapper.append("div")
            .attr("class", "margin-resizer")
            .attr("role", "separator")
            .attr("aria-orientation", "vertical")
            .attr("aria-label", "Resize task label margin")
            .style("position", "absolute")
            .style("top", "0")
            .style("bottom", "0")
            .style("height", "100%")
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
            .style("width", "2px")
            .style("transform", "translateX(-1px)")
            .style("background-color", "#666")
            .style("opacity", "1")
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
            // Capture chart width at drag start for scaleX ratio during drag
            const effMargin = self.getEffectiveLeftMargin();
            const vpW = self.lastViewport?.width || 0;
            self.dragStartChartWidth = Math.max(10, vpW - effMargin - self.margin.right);
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
        // const containerRect = containerNode.getBoundingClientRect(); // Unused
        const resizerWidth = parseFloat(this.marginResizer.style("width")) || 8;
        const effectiveMargin = this.getEffectiveLeftMargin();

        // Calculate left relative to wrapper (since marginResizer is child of wrapper)
        // wrapperNode is usually the offsetParent, but let's be safe.
        // If wrapperNode is positioned, containerNode.offsetLeft should be relative to it?
        // Actually, containerNode might be deeply nested.
        // Safer to use bounding client rect difference.
        const left = (containerNode.getBoundingClientRect().left - wrapperRect.left) + effectiveMargin - (resizerWidth / 2);

        this.marginResizer
            .style("left", `${Math.max(0, Math.round(left))}px`)
            .attr("aria-valuenow", Math.round(effectiveMargin).toString());
    }

    /**
     * Optimized handler for margin-only updates during drag.
     * Redraws everything EXCEPT connector arrows (most expensive operation).
     * Full redraw including arrows happens on drag end via persistProperties -> update().
     */
    private handleMarginDragUpdate(newLeftMargin: number): void {
        if (!this.xScale || !this.yScale || !this.allTasksToShow) return;

        this.margin.left = Math.round(newLeftMargin);
        const effectiveMargin = this.getEffectiveLeftMargin();
        if (this.canvasElement) {
            this.canvasElement.style.display = 'none';
            this.canvasElement.style.visibility = 'hidden';
        }
        this.updateWatermarkOverlayVisibility(true);

        // 1. Update group transforms
        this.mainGroup?.attr("transform", `translate(${this.snapRectCoord(effectiveMargin)}, ${this.snapRectCoord(this.margin.top)})`);
        this.headerGridLayer?.attr("transform", `translate(${this.snapRectCoord(effectiveMargin)}, 0)`);
        if (this.settings?.layoutSettings?.leftMargin) {
            this.settings.layoutSettings.leftMargin.value = newLeftMargin;
        }

        // 2. Compute new chart dimensions
        const viewportWidth = this.lastViewport?.width || 0;
        const chartWidth = Math.max(10, viewportWidth - effectiveMargin - this.margin.right);
        const chartHeight = this.yScale.range()[1] || 0;
        this.xScale.range([0, chartWidth]);

        // 3. Update clip rects
        this.updateChartClipRect(chartWidth, chartHeight);
        const leftClipId = this.getScopedId("clip-left-margin");
        this.mainSvg?.select(`#${leftClipId} rect`)
            .attr("x", -effectiveMargin)
            .attr("width", effectiveMargin)
            .attr("height", chartHeight + 100);

        // 4. Clear layers for redraw (skip arrowLayer — arrows are deferred to drag end)
        // WBS group headers use D3 enter/update/exit data binding in drawWbsGroupHeaders(),
        // so skip clearing them to allow element reuse during drag.
        // Task labels must be cleared here because the available width changes on every
        // drag frame, requiring full text re-wrapping.
        this.gridLayer?.selectAll("*").remove();
        this.rowGridLayer?.selectAll("*").remove();
        this.taskLayer?.selectAll("*").remove();
        this.taskLabelLayer?.selectAll("*").remove();
        this.labelGridLayer?.selectAll("*").remove();
        this.headerGridLayer?.selectAll("*").remove();

        // 5. Redraw all visual elements except arrows
        const visibleTasks = this.getVisibleTasks();
        const renderableTasks = visibleTasks.filter(t => t.yOrder !== undefined);
        const taskHeight = this.settings.taskBars.taskHeight.value;
        const taskBarHeight = this.settings.taskBars.taskBarHeight.value;
        const taskColor = this.resolveColor(this.settings.taskBars.taskColor.value.value, "foreground");
        const criticalColor = this.resolveColor(this.settings.criticalPath.criticalPathColor.value.value, "foreground");
        const milestoneColor = this.resolveColor(this.settings.taskBars.milestoneColor.value.value, "foreground");
        const labelColor = this.resolveColor(this.settings.textAndLabels.labelColor.value.value, "foreground");
        const showDuration = this.settings.textAndLabels.showDuration.value;
        const dateBgColor = this.resolveColor(this.settings.textAndLabels.dateBackgroundColor.value.value, "background");
        const dateBgTransparency = this.settings.textAndLabels.dateBackgroundTransparency.value;
        const dateBgOpacity = 1 - (dateBgTransparency / 100);
        const showHorzGridLines = this.settings.gridLines.showHorizontalLines.value;

        // Vertical grid lines + x-axis date labels
        this.drawgridLines(this.xScale, chartHeight, this.gridLayer, this.headerGridLayer);

        // Horizontal grid lines + alternating row backgrounds
        if (showHorzGridLines) {
            this.drawHorizontalGridLines(renderableTasks, this.yScale, chartWidth, effectiveMargin, chartHeight);
        }

        // Column headers
        this.drawColumnHeaders(this.headerHeight, effectiveMargin);

        // WBS group headers (suppress text collisions to prevent jitter during drag)
        this.drawWbsGroupHeaders(this.xScale, this.yScale, chartWidth, taskHeight, effectiveMargin, this.viewportStartIndex, this.viewportEndIndex);

        // Task bars + milestones
        this.drawTasks(
            renderableTasks, this.xScale, this.yScale,
            taskColor, milestoneColor, criticalColor,
            labelColor, showDuration, taskHeight, taskBarHeight,
            dateBgColor, dateBgOpacity
        );

        // Connector arrows (Draw them so they don't look stuck, even if expensive)
        const connectorColor = this.resolveColor(this.settings.connectorLines.connectorColor.value.value, "foreground");
        const connectorWidth = this.settings.connectorLines.connectorWidth.value;
        const criticalConnectorWidth = this.settings.connectorLines.criticalConnectorWidth.value;
        const milestoneSize = this.settings.taskBars.milestoneSize.value;

        if (this.showConnectorLinesInternal) {
            this.drawArrows(
                renderableTasks, this.xScale, this.yScale,
                criticalColor, connectorColor, connectorWidth, criticalConnectorWidth,
                taskHeight, milestoneSize
            );
        }

        // Task labels (live wrapping)
        const labelAvailableWidth = Math.max(10, effectiveMargin - this.labelPaddingLeft - 5);
        const taskNameFontSize = this.settings.textAndLabels.taskNameFontSize.value;
        const selectionHighlightColor = this.getSelectionColor();
        const lineHeight = this.taskLabelLineHeight;

        this.drawTaskLabelsLayer(
            renderableTasks, this.yScale, taskHeight, effectiveMargin,
            labelAvailableWidth, taskNameFontSize, labelColor,
            selectionHighlightColor, selectionHighlightColor, "bold", lineHeight
        );

        // Data date line
        this.drawDataDateLine(chartWidth, this.xScale, chartHeight, this.gridLayer, this.headerGridLayer);

        // Finish lines
        const tasksForProjectEnd = this.getTasksForFinishLines();
        this.drawBaselineAndPreviousEndLines(
            this.xScale, tasksForProjectEnd, chartHeight, this.gridLayer, this.headerGridLayer
        );
        this.drawProjectEndLine(
            chartWidth, this.xScale, renderableTasks, tasksForProjectEnd, chartHeight,
            this.gridLayer, this.headerGridLayer
        );
        this.reflowHeaderLineLabels(this.headerGridLayer, chartWidth);

        // Column separators
        this.drawLabelColumnSeparators(chartHeight, effectiveMargin);

        // 6. Reposition resizer and zoom slider
        this.updateMarginResizerPosition();
        this.updateZoomSliderTrackMargins();
        this.scheduleWatermarkOverlayUpdate();
    }

    private clearVisual(): void {
        this.gridLayer?.selectAll("*").remove();
        this.rowGridLayer?.selectAll("*").remove();
        this.arrowLayer?.selectAll("*").remove();
        this.taskLayer?.selectAll("*").remove();
        this.taskLabelLayer?.selectAll("*").remove();
        this.labelGridLayer?.selectAll("*").remove();
        this.wbsGroupLayer?.selectAll("*").remove();

        this.headerGridLayer?.selectAll("*").remove();
        this.headerSvg?.selectAll(".comparison-finish-key-group, .comparison-finish-key-layer").remove();
        this.secondRowComparisonSummaryWidth = 0;
        this.secondRowComparisonSummaryUsesRightLane = false;
        this.pendingComparisonFinishSummaryEntries = [];

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

        this.updateWatermarkOverlayVisibility(true);
    }

    private drawHeaderDivider(viewportWidth: number): void {
        if (!this.headerSvg) return;

        const lineData = [viewportWidth];
        const dividerY = this.snapLineCoord(this.headerHeight - 1);
        const headerPalette = this.getHeaderBandPalette();

        const lineSelection = this.headerSvg.selectAll<SVGLineElement, number>(".divider-line")
            .data(lineData);

        lineSelection.enter()
            .append("line")
            .attr("class", "divider-line")
            .attr("x1", 0)
            .attr("y1", dividerY)
            .attr("y2", dividerY)
            .attr("stroke", headerPalette.stroke)
            .attr("stroke-width", 1)
            .merge(lineSelection as any)
            .attr("x2", d => this.snapRectCoord(d));
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
        const currentLeftMargin = this.getEffectiveLeftMargin();
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

            const start = this.getVisualStart(task);
            const finish = this.getVisualFinish(task);

            if (start && !isNaN(start.getTime())) {
                allTimestamps.push(start.getTime());
            }
            if (finish && !isNaN(finish.getTime())) {
                allTimestamps.push(finish.getTime());
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

        // Pre-sort by yOrder so getVisibleTasks can use binary search (O(log n))
        // instead of a full array filter (O(n)) on every scroll frame.
        // In non-WBS mode yOrder equals array index, so sort order is unchanged.
        this.allTasksToShow.sort((a, b) => {
            const aOrder = a.yOrder ?? Number.MAX_SAFE_INTEGER;
            const bOrder = b.yOrder ?? Number.MAX_SAFE_INTEGER;
            return aOrder - bOrder;
        });

        this.taskTotalCount = totalRows !== undefined ? totalRows : tasks.length;
        this.taskElementHeight = taskHeight + taskPadding;

        const totalContentHeight = this.taskTotalCount * this.taskElementHeight;

        this.syncSvgPixelSize(
            this.mainSvg,
            undefined,
            totalContentHeight + this.margin.top + this.margin.bottom
        );

        if (this.scrollListener) {
            this.scrollableContainer.on("scroll", null);
            this.scrollListener = null;
        }

        const self = this;
        this.scrollListener = function () {
            if (!self.scrollThrottleTimeout) {
                self.scrollThrottleTimeout = requestAnimationFrame(() => {
                    self.scrollThrottleTimeout = null;
                    self.handleScroll();
                });
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
        const visibleTasks = this.getVisibleTasks();

        for (const task of visibleTasks) {
            const domainKey = task.yOrder?.toString() ?? '';
            const yPosition = this.yScale(domainKey);
            if (yPosition === undefined) continue;

            if (y < yPosition || y > yPosition + taskHeight) {
                continue;
            }

            if (task.type === 'TT_Mile' || task.type === 'TT_FinMile') {
                const milestoneDate = this.getVisualMilestoneDate(task);
                if (!milestoneDate) continue;
                const milestoneX = this.xScale(milestoneDate);
                const size = this.getRenderedMilestoneSize(milestoneSizeSetting, taskHeight);
                if (x >= milestoneX - size / 2 && x <= milestoneX + size / 2) {
                    return task;
                }
            } else {
                const visualStart = this.getVisualStart(task);
                const visualFinish = this.getVisualFinish(task);
                if (!visualStart || !visualFinish) continue;
                const taskX = this.xScale(visualStart);
                const taskWidth = this.xScale(visualFinish) - taskX;
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

    /**
     * Calculates the total width of *conditional* extra columns (Baseline, Previous Update).
     * This width is added to the user's base leftMargin to preserve Task Name width.
     */
    private getExtraColumnWidth(): number {
        if (!this.settings) return 0;

        let extraWidth = 0;
        const cols = this.settings.columns;
        const comp = this.settings.comparisonBars;
        const showExtra = this.showExtraColumnsInternal; // Based on enableColumnDisplay

        if (showExtra) {
            // Mirror the WBS summary row's collision floor (see drawWbsGroupHeaders).
            // Both sides must use Math.max(configuredWidth, MIN_DATE_WIDTH) so the
            // left margin grows by the same amount the WBS row will subtract —
            // otherwise WBS names wrap/truncate when toggling these columns on.
            if (this.showBaselineInternal) {
                extraWidth += Math.max(cols.baselineStartDateWidth.value, Visual.MIN_DATE_WIDTH);
                extraWidth += Math.max(cols.baselineFinishDateWidth.value, Visual.MIN_DATE_WIDTH);
            }
            if (this.showPreviousUpdateInternal) {
                extraWidth += Math.max(cols.previousUpdateStartDateWidth.value, Visual.MIN_DATE_WIDTH);
                extraWidth += Math.max(cols.previousUpdateFinishDateWidth.value, Visual.MIN_DATE_WIDTH);
            }
        }
        return extraWidth;
    }

    /**
     * Returns the effective left margin to use for rendering.
     * effectiveLeftMargin = userBaseMargin + extraColumnWidths
     */
    private getEffectiveLeftMargin(): number {
        const baseMargin = this.settings?.layoutSettings?.leftMargin?.value ?? 0;
        return baseMargin + this.getExtraColumnWidth();
    }

    private updateHeaderElements(viewportWidth: number): void {
        const baselineAvailable = this.boundFields.baselineAvailable;
        const previousUpdateAvailable = this.boundFields.previousUpdateAvailable;

        const state: HeaderState = {
            showAllTasks: this.showAllTasksInternal,
            showBaseline: this.showBaselineInternal,
            baselineAvailable: baselineAvailable,
            showPreviousUpdate: this.showPreviousUpdateInternal,
            previousUpdateAvailable: previousUpdateAvailable,
            boundFields: this.boundFields,
            showConnectorLines: this.showConnectorLinesInternal,
            wbsExpanded: this.wbsExpandedInternal,
            wbsDataExists: this.wbsDataExistsInMetadata || this.wbsDataExists, // Prioritize metadata check if available
            wbsAvailableLevels: this.wbsAvailableLevels,
            wbsExpandToLevel: this.getCurrentWbsExpandLevel(),
            wbsManualExpansionOverride: this.wbsManualExpansionOverride,

            currentMode: (this.settings?.criticalPath?.calculationMode?.value as any)?.value || 'floatBased',
            modeWarningMessage: this.getUnsafeCpmWarningMessage(),
            showPathInfoChip: this.shouldShowPathInfoChip(),
            floatThreshold: this.floatThreshold,
            showNearCritical: this.showNearCritical,
            showExtraColumns: this.showExtraColumnsInternal,
            wbsEnabled: !!this.settings?.wbsGrouping?.enableWbsGrouping?.value
        };

        this.header.render(viewportWidth, this.settings, state);

        const dividerLine = this.headerSvg?.select(".divider-line");
        const headerPalette = this.getHeaderBandPalette();
        if (dividerLine && !dividerLine.empty()) {
            const currentX2 = parseFloat(dividerLine.attr("x2"));
            if (Math.abs(currentX2 - viewportWidth) > 1) {
                dividerLine.attr("x2", viewportWidth);
            }
            dividerLine
                .style("stroke", headerPalette.stroke)
                .style("stroke-width", "1px")
                .style("opacity", "1");
        } else {
            this.drawHeaderDivider(viewportWidth);
            this.headerSvg?.select(".divider-line")
                .style("stroke", headerPalette.stroke)
                .style("stroke-width", "1px")
                .style("opacity", "1");
        }

        // Dropdown and other custom header elements not yet in Header component
        this.createpathSelectionDropdown();
        this.updatePathInfoLabel(viewportWidth);
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
     * Get visible tasks based on current viewport indices.
     * allTasksToShow is pre-sorted by yOrder in setupVirtualScroll, so both
     * WBS and non-WBS paths use binary search (O(log n)) + slice (O(k)).
     */
    private getVisibleTasks(): Task[] {
        if (!this.allTasksToShow || this.allTasksToShow.length === 0) return [];

        const tasks = this.allTasksToShow;
        const startTarget = this.viewportStartIndex;
        const endTarget = this.viewportEndIndex;

        // Binary search: first task with yOrder >= startTarget
        let lo = 0, hi = tasks.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            const order = tasks[mid].yOrder;
            if (order === undefined || order < startTarget) lo = mid + 1;
            else hi = mid;
        }
        const sliceStart = lo;

        // Binary search: first task with yOrder > endTarget
        hi = tasks.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            const order = tasks[mid].yOrder;
            if (order !== undefined && order <= endTarget) lo = mid + 1;
            else hi = mid;
        }

        return tasks.slice(sliceStart, lo);
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

        const shouldUseCanvas = this.shouldUseCanvasForViewport(
            renderableTasks.length,
            xScale.range()[1],
            yScale.range()[1],
            this.getCanvasPixelRatio()
        );
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

        // WBS group headers use D3 enter/update/exit in drawWbsGroupHeaders(),
        // so skip clearing here to allow element reuse during scroll.

        // Task labels use D3 enter/update/exit in drawTaskLabelsLayer(),
        // so skip clearing here to allow element reuse during scroll.

        const showHorzGridLines = this.settings.gridLines.showHorizontalLines.value;
        const currentLeftMargin = this.getEffectiveLeftMargin();
        const chartWidth = xScale.range()[1];
        const chartHeight = yScale.range()[1];
        const labelAvailableWidth = Math.max(10, currentLeftMargin - this.labelPaddingLeft - 5);
        const taskNameFontSize = this.settings.textAndLabels.taskNameFontSize.value;
        const selectionHighlightColor = this.getSelectionColor();
        const selectionLabelColor = selectionHighlightColor;
        const selectionLabelWeight = "bold";
        const lineHeight = this.taskLabelLineHeight;

        if (showHorzGridLines) {
            this.clearHorizontalGridLineStrokes();
        }

        if (this.useCanvasRendering) {
            if (this.canvasElement) {
                const leftMargin = this.snapRectCoord(this.getEffectiveLeftMargin());
                const topMargin = this.snapRectCoord(this.margin.top);
                const modeTransitionDuration = this.getAnimationDuration(this.MODE_TRANSITION_DURATION);

                if (modeChanged) {
                    this.canvasElement.style.opacity = '0';
                    this.canvasElement.style.transition = modeTransitionDuration === 0
                        ? 'none'
                        : `opacity ${modeTransitionDuration}ms ease-out`;
                }

                this.canvasElement.style.display = 'block';
                this.canvasElement.style.visibility = 'visible';
                this.canvasElement.style.left = `${leftMargin}px`;
                this.canvasElement.style.top = `${topMargin}px`;
                this.canvasElement.style.imageRendering = 'auto';
                this.canvasElement.style.transform = 'none';
                this.canvasElement.style.willChange = 'auto';
                this.canvasElement.style.backfaceVisibility = 'visible';
                this.canvasElement.style.webkitBackfaceVisibility = 'visible';
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
        }

        // Delegate to main drawing method to ensure consistency and use correct margins/columns
        this.drawVisualElements(
            renderableTasks,
            xScale,
            yScale,
            chartWidth,
            chartHeight,
            currentLeftMargin
        );

        if (this.useCanvasRendering && modeChanged && this.canvasElement) {
            const modeTransitionDuration = this.getAnimationDuration(this.MODE_TRANSITION_DURATION);
            requestAnimationFrame(() => {
                if (this.canvasElement) {
                    this.canvasElement.style.opacity = '1';
                }

                this.taskLayer
                    .transition()
                    .duration(modeTransitionDuration)
                    .style("opacity", 0)
                    .on("end", () => {
                        this.taskLayer.style("display", "none");
                        this.taskLayer.style("opacity", null);
                        this.taskLayer?.selectAll("*").remove();
                    });

                this.arrowLayer
                    .transition()
                    .duration(modeTransitionDuration)
                    .style("opacity", 0)
                    .on("end", () => {
                        this.arrowLayer.style("display", "none");
                        this.arrowLayer.style("opacity", null);
                        this.arrowLayer?.selectAll("*").remove();
                    });
            });
        }
    }

    private getHorizontalGridRowOrders(yScale: ScaleBand<string>): number[] {
        return yScale.domain()
            .map(key => parseInt(key, 10))
            .filter((yOrder: number) => Number.isFinite(yOrder))
            .filter((yOrder: number) => {
                if (this.viewportStartIndex !== undefined && yOrder < this.viewportStartIndex) {
                    return false;
                }
                if (this.viewportEndIndex !== undefined && yOrder > this.viewportEndIndex) {
                    return false;
                }
                return true;
            })
            .sort((a, b) => a - b);
    }

    private getSnappedHorizontalGridYs(yScale: ScaleBand<string>, lineWidth: number): number[] {
        return [...new Set(
            this.getHorizontalGridRowOrders(yScale)
                .map((yOrder: number) => yScale(yOrder.toString()))
                .filter((yPos): yPos is number => yPos !== undefined && !isNaN(yPos))
                .map((yPos: number) => this.snapLineCoord(yPos, lineWidth))
        )];
    }

    private clearHorizontalGridLineStrokes(): void {
        this.gridLayer?.selectAll(".grid-line.horizontal").remove();
        this.rowGridLayer?.selectAll(".horizontal-grid-line").remove();
        this.labelGridLayer?.selectAll(".label-grid-line").remove();
    }

    private clearHorizontalGridArtifacts(): void {
        this.clearHorizontalGridLineStrokes();
        this.gridLayer?.selectAll(".alternating-row-bg").remove();
        this.labelGridLayer?.selectAll(".alternating-row-bg-label").remove();
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
        chartHeight: number,
        currentLeftMargin: number
    ): void {
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

        // Optimized: Removed aggressive clearing to allow D3 data binding to update elements
        // this.taskLabelLayer?.selectAll("*").remove();
        // this.labelGridLayer?.selectAll("*").remove();
        // this.wbsGroupLayer?.selectAll("*").remove();

        this.updateChartClipRect(chartWidth, chartHeight);

        const taskColor = this.resolveColor(this.settings.taskBars.taskColor.value.value, "foreground");
        const criticalColor = this.resolveColor(this.settings.criticalPath.criticalPathColor.value.value, "foreground");
        const milestoneColor = this.resolveColor(this.settings.taskBars.milestoneColor.value.value, "foreground");
        const labelColor = this.resolveColor(this.settings.textAndLabels.labelColor.value.value, "foreground");
        const taskHeight = this.settings.taskBars.taskHeight.value;
        const taskBarHeight = this.settings.taskBars.taskBarHeight.value;
        const connectorColor = this.resolveColor(this.settings.connectorLines.connectorColor.value.value, "foreground");
        const connectorWidth = this.settings.connectorLines.connectorWidth.value;
        const criticalConnectorWidth = this.settings.connectorLines.criticalConnectorWidth.value;
        const dateBgColor = this.resolveColor(this.settings.textAndLabels.dateBackgroundColor.value.value, "background");
        const dateBgTransparency = this.settings.textAndLabels.dateBackgroundTransparency.value;
        const dateBgOpacity = 1 - (dateBgTransparency / 100);
        const showHorzGridLines = this.settings.gridLines.showHorizontalLines.value;
        const showVertGridLines = this.settings.gridLines.showVerticalLines.value;
        const showDuration = this.settings.textAndLabels.showDuration.value;

        // Use passed argument instead of re-reading settigs
        // const currentLeftMargin = this.settings.layoutSettings.leftMargin.value;

        // Fix: Clip labels to left margin
        const leftClipId = this.getScopedId("clip-left-margin");
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
        this.updateTaskNameLaneClipRect(currentLeftMargin, chartHeight);
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

        this.useCanvasRendering = this.shouldUseCanvasForViewport(
            renderableTasks.length,
            chartWidth,
            chartHeight,
            this.getCanvasPixelRatio()
        );
        if (!this.useCanvasRendering) {
            this.clearAccessibleCanvasFallback();
        }
        this.syncCanvasElementPresentation(currentLeftMargin);
        this.debugLog(`Rendering mode: ${this.useCanvasRendering ? 'Canvas' : 'SVG'} for ${renderableTasks.length} tasks`);
        if (!showHorzGridLines) {
            this.clearHorizontalGridArtifacts();
        }

        if (showHorzGridLines) {
            this.drawHorizontalGridLines(renderableTasks, yScale, chartWidth, currentLeftMargin, chartHeight);
        }

        // --- 1. Draw Grid Lines ---
        if (showVertGridLines) {
            this.drawgridLines(xScale, chartHeight, this.gridLayer, this.headerGridLayer);
        }

        // --- 2. Draw Column Headers ---
        this.drawColumnHeaders(this.headerHeight, currentLeftMargin);

        // --- 3. Draw WBS Group Headers (bars + text) ---
        // They need to be drawn before tasks to be behind them? Or mixed?
        // Actually WBS group headers are in `wbsGroupLayer` which is usually above regular tasks or interleaved.
        // In this visual, they seem to be treated as rows.

        this.drawWbsGroupHeaders(xScale, yScale, chartWidth, taskHeight, currentLeftMargin, this.viewportStartIndex, this.viewportEndIndex);

        // --- 4. Draw Tasks ---
        if (this.useCanvasRendering) {
            if (this._setupCanvasForDrawing(chartWidth, chartHeight)) {
                this.drawTasksCanvas(
                    renderableTasks, xScale, yScale,
                    taskColor, milestoneColor, criticalColor,
                    labelColor, showDuration, taskHeight, taskBarHeight,
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
                this.createAccessibleCanvasFallback(renderableTasks, yScale);
            } else {
                this.clearAccessibleCanvasFallback();
            }
        } else {
            // SVG Rendering
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
                labelColor, showDuration, taskHeight, taskBarHeight,
                dateBgColor, dateBgOpacity
            );

            // SVG Labels
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

        // --- 5. Data Date Line ---
        this.drawDataDateLine(
            chartWidth,
            xScale,
            chartHeight,
            this.gridLayer,
            this.headerGridLayer
        );

        // --- 6. Project Finish Line ---
        const tasksForProjectEnd = this.getTasksForFinishLines();
        this.drawBaselineAndPreviousEndLines(
            xScale,
            tasksForProjectEnd,
            chartHeight,
            this.gridLayer,
            this.headerGridLayer
        );
        this.drawProjectEndLine(chartWidth, xScale, renderableTasks, tasksForProjectEnd, chartHeight,
            this.gridLayer, this.headerGridLayer);
        this.reflowHeaderLineLabels(this.headerGridLayer, chartWidth);

        // --- 7. Vertical Separators ---
        this.drawLabelColumnSeparators(chartHeight, currentLeftMargin);
        this.scheduleWatermarkOverlayUpdate();
    }

    private syncCanvasElementPresentation(currentLeftMargin: number): void {
        if (!this.canvasElement) return;

        if (this.useCanvasRendering) {
            const leftMargin = this.snapRectCoord(currentLeftMargin);
            const topMargin = this.snapRectCoord(this.margin.top);

            this.canvasElement.style.display = 'block';
            this.canvasElement.style.visibility = 'visible';
            this.canvasElement.style.left = `${leftMargin}px`;
            this.canvasElement.style.top = `${topMargin}px`;
            this.canvasElement.style.imageRendering = 'auto';
            this.canvasElement.style.transform = 'none';
            this.canvasElement.style.willChange = 'auto';
            this.canvasElement.style.backfaceVisibility = 'visible';
            this.canvasElement.style.webkitBackfaceVisibility = 'visible';
        } else {
            this.canvasElement.style.display = 'none';
            this.canvasElement.style.visibility = 'hidden';
        }
    }

    private scheduleWatermarkOverlayUpdate(): void {
        if (this.watermarkOverlayRaf !== null) {
            cancelAnimationFrame(this.watermarkOverlayRaf);
        }

        this.watermarkOverlayRaf = requestAnimationFrame(() => {
            this.watermarkOverlayRaf = requestAnimationFrame(() => {
                this.watermarkOverlayRaf = null;
                this.updateWatermarkOverlayVisibility(true);
            });
        });
    }

    private updateWatermarkOverlayVisibility(forceVisible: boolean = false): void {
        if (!this.watermarkOverlay) return;

        this.updateWatermarkOverlayPosition();
        this.watermarkOverlay.style("display", forceVisible ? "block" : "block");
    }

    private updateWatermarkOverlayPosition(): void {
        if (!this.watermarkOverlay || !this.visualWrapper || !this.scrollableContainer) return;

        const wrapperNode = this.visualWrapper.node();
        const scrollNode = this.scrollableContainer.node();
        if (!wrapperNode || !scrollNode) return;

        const wrapperRect = wrapperNode.getBoundingClientRect();
        const scrollRect = scrollNode.getBoundingClientRect();
        const rightOffset = Math.max(
            8,
            wrapperRect.right - scrollRect.right + 8
        );
        const bottomOffset = Math.max(
            6,
            wrapperRect.bottom - scrollRect.bottom + 6
        );

        this.watermarkOverlay
            .style("right", `${Math.round(rightOffset)}px`)
            .style("bottom", `${Math.round(bottomOffset)}px`);
    }

    private drawHorizontalGridLines(tasks: Task[], yScale: ScaleBand<string>, chartWidth: number, currentLeftMargin: number, chartHeight: number): void {
        if (!this.rowGridLayer?.node() || !yScale) { console.warn("Skipping horizontal grid lines: Missing layer or Y scale."); return; }

        const settings = this.settings.gridLines;
        const lineColor = settings.horizontalLineColor.value.value;
        // Normalize row separator strokes to whole CSS pixels so every row
        // rasterizes consistently. Fractional widths are more prone to uneven
        // perceived weight once dashed lines, backgrounds, and browser AA mix.
        const lineWidth = Math.max(1, Math.round(settings.horizontalLineWidth.value));
        const style = settings.horizontalLineStyle.value.value;
        let lineDashArray = "none";
        switch (style) { case "dashed": lineDashArray = "4,3"; break; case "dotted": lineDashArray = "1,2"; break; default: lineDashArray = "none"; break; }

        // Alternating row colors from settings
        const showAlternating = this.settings?.generalSettings?.alternatingRowColors?.value ?? false;
        const alternatingColor = this.settings?.generalSettings?.alternatingRowColor?.value?.value ?? "#F5F5F5";
        const rowHeight = yScale.bandwidth();
        const rowStep = yScale.step();

        const uniqueYOrders = this.getHorizontalGridRowOrders(yScale);

        // Per-row height computed as (next row top − this row top) on the snapped grid.
        // A constant Math.round(bandwidth) leaves 1–2 px gaps between rects when
        // bandwidth is fractional; tiling via snapped tops removes those gaps so
        // zebra stripes appear as uniform bands and gridlines aren't framed by
        // slivers of bg color.
        const tiledRowHeight = (yOrder: number): number => {
            const top = yScale(yOrder.toString());
            if (top === undefined) return 0;
            return Math.max(1, this.snapRectCoord(top + rowStep) - this.snapRectCoord(top));
        };

        // Draw alternating row backgrounds if enabled
        if (showAlternating && rowHeight > 0) {
            // Build a list of all row indices to fill (0 to max yOrder)
            const oddRows = uniqueYOrders.filter((yOrder: number) => yOrder % 2 === 1);

            const effectiveWidth = chartWidth;
            const fillInsetTop = 1;

            this.gridLayer.selectAll<SVGRectElement, number>(".alternating-row-bg")
                .data(oddRows, d => d)
                .join(
                    enter => enter.append("rect")
                        .attr("class", "alternating-row-bg")
                        .style("pointer-events", "none"),
                    update => update,
                    exit => exit.remove()
                )
                .attr("x", 0)
                .attr("y", (yOrder: number) => this.snapRectCoord(yScale(yOrder.toString()) ?? 0) + fillInsetTop)
                .attr("width", this.snapRectCoord(effectiveWidth))
                .attr("height", (yOrder: number) => Math.max(1, tiledRowHeight(yOrder) - fillInsetTop))
                .style("fill", alternatingColor);

            // Extend alternating to label area
            if (this.labelGridLayer) {
                this.labelGridLayer.selectAll<SVGRectElement, number>(".alternating-row-bg-label")
                    .data(oddRows, d => d)
                    .join(
                        enter => enter.append("rect")
                            .attr("class", "alternating-row-bg-label")
                            .style("pointer-events", "none"),
                        update => update,
                        exit => exit.remove()
                    )
                    .attr("x", -this.snapRectCoord(currentLeftMargin))
                    .attr("y", (yOrder: number) => this.snapRectCoord(yScale(yOrder.toString()) ?? 0) + fillInsetTop)
                    .attr("width", this.snapRectCoord(currentLeftMargin))
                    .attr("height", (yOrder: number) => Math.max(1, tiledRowHeight(yOrder) - fillInsetTop))
                    .style("fill", alternatingColor);
            }
        } else {
            this.gridLayer.selectAll(".alternating-row-bg").remove();
            this.labelGridLayer?.selectAll(".alternating-row-bg-label").remove();
        }

        const snappedLineYs = this.getSnappedHorizontalGridYs(yScale, lineWidth);

        this.gridLayer.selectAll(".grid-line.horizontal").remove();
        this.labelGridLayer?.selectAll(".label-grid-line").remove();

        this.rowGridLayer.selectAll<SVGLineElement, number>(".horizontal-grid-line")
            .data(snappedLineYs, d => d)
            .join(
                enter => enter.append("line")
                    .attr("class", "horizontal-grid-line")
                    .style("pointer-events", "none"),
                update => update,
                exit => exit.remove()
            )
            .attr("x1", -this.snapRectCoord(currentLeftMargin))
            .attr("x2", this.snapRectCoord(chartWidth))
            .attr("y1", (y: number) => y)
            .attr("y2", (y: number) => y)
            .style("stroke", lineColor)
            .style("stroke-width", lineWidth)
            .style("stroke-dasharray", lineDashArray)
            .style("stroke-linecap", "butt")
            .style("vector-effect", "non-scaling-stroke")
            .style("shape-rendering", "crispEdges");
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

        const settings = this.settings.gridLines;
        if (!settings.showVerticalLines.value) {
            mainGridLayer.selectAll(".vertical-grid-line").remove();
            headerLayer.selectAll(".vertical-grid-label").remove();
            return;
        }

        const lineColor = this.resolveColor(settings.verticalLineColor.value.value, "foreground");
        const lineWidth = Math.max(1, Math.round(settings.verticalLineWidth.value));
        const lineStyle = settings.verticalLineStyle.value.value as string;
        const showMonthLabels = settings.showTimelineLabels.value;
        const labelColorSetting = settings.timelineLabelColor.value.value;
        const labelColor = this.resolveColor(labelColorSetting || lineColor, "foreground");
        const headerBandMetrics = this.getHeaderBandMetrics();
        const headerPalette = this.getHeaderBandPalette();
        const baseFontSize = this.settings.textAndLabels.fontSize.value;
        const labelFontSizeSetting = settings.timelineLabelFontSize.value;
        const labelFontSize = labelFontSizeSetting > 0 ? labelFontSizeSetting : Math.max(8, baseFontSize * 0.8);
        const labelFontSizePx = this.pointsToCssPx(labelFontSize);
        let lineDashArray = "none";
        switch (lineStyle) { case "dashed": lineDashArray = "4,3"; break; case "dotted": lineDashArray = "1,2"; break; default: lineDashArray = "none"; }

        // Calculate the visible time range to determine appropriate granularity
        const domain = xScale.domain();
        const range = xScale.range();
        const visibleDaysSpan = (domain[1].getTime() - domain[0].getTime()) / (1000 * 60 * 60 * 24);
        const pixelsPerDay = (range[1] - range[0]) / visibleDaysSpan;

        // Determine granularity based on pixel density
        // Granularity levels: monthly → bi-weekly → weekly → daily
        type GranularityLevel = 'day' | 'week' | 'biweek' | 'triweek' | 'month';
        let granularity: GranularityLevel = 'month';
        let ticks: Date[] = [];

        // Estimate label widths for different formats
        const weekLabelWidth = "02-May-26".length * labelFontSizePx * 0.55 + 10; // ~70px for DD-Mon-YY
        const monthLabelWidth = "Sep-26".length * labelFontSizePx * 0.55 + 10; // ~50px for Mon-YY
        const dayLabelWidth = "02-May".length * labelFontSizePx * 0.55 + 10; // ~55px for DD-Mon

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
                // If bi-weekly doesn't fit, fall back to tri-weekly
                if (minSpacing < weekLabelWidth) granularity = 'triweek';
            } else {
                granularity = 'triweek';
            }
        }

        if (granularity === 'triweek') {
            // Tri-weekly ticks starting on Mondays (every 3 weeks)
            try { ticks = xScale.ticks(timeMonday.every(3)); }
            catch (e) { ticks = []; }
            if (ticks.length >= 2) {
                let minSpacing = Infinity;
                for (let i = 1; i < ticks.length; i++) {
                    const spacing = xScale(ticks[i]) - xScale(ticks[i - 1]);
                    if (!isNaN(spacing)) minSpacing = Math.min(minSpacing, spacing);
                }
                // If tri-weekly doesn't fit, fall back to monthly
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
        mainGridLayer.selectAll<SVGLineElement, Date>(".vertical-grid-line")
            .data(ticks, (d: Date) => d.getTime())
            .join(
                enter => enter.append("line")
                    .attr("class", "vertical-grid-line")
                    .style("pointer-events", "none"),
                update => update,
                exit => exit.remove()
            )
            .attr("x1", (d: Date) => this.snapLineCoord(xScale(d), lineWidth))
            .attr("x2", (d: Date) => this.snapLineCoord(xScale(d), lineWidth))
            .attr("y1", 0)
            .attr("y2", this.snapRectCoord(chartHeight))
            .style("stroke", lineColor)
            .style("stroke-width", lineWidth)
            .style("stroke-dasharray", lineDashArray);

        // Draw labels with two-tier formatting
        if (showMonthLabels) {
            // --- MAJOR TIER (Top) ---
            let majorTicks: Date[] = [];
            let formatMajor: (d: Date) => string;

            if (granularity === 'month') {
                try { majorTicks = xScale.ticks(d3.timeYear); } catch (e) { majorTicks = []; }
                formatMajor = d3.timeFormat("%Y");
            } else {
                try { majorTicks = xScale.ticks(d3.timeMonth); } catch (e) { majorTicks = []; }
                formatMajor = d3.timeFormat("%B %Y");
            }

            // Ensure we cover the full domain if ticks don't (optional, D3 ticks usually suffice)

            headerLayer.selectAll<SVGTextElement, Date>(".major-grid-label")
                .data(majorTicks, (d: Date) => d.getTime())
                .join(
                    enter => enter.append("text")
                        .attr("class", "major-grid-label")
                        .attr("text-anchor", "start")
                        .style("pointer-events", "none")
                        .style("font-weight", "bold"),
                    update => update,
                    exit => exit.remove()
                )
                .attr("x", (d: Date) => {
                    const x = this.snapLineCoord(xScale(d), lineWidth);
                    return this.snapTextCoord(x + 5);
                })
                .attr("y", headerBandMetrics.majorLabelY)
                .style("font-family", this.getFontFamily())
                .style("font-size", this.fontPxFromPtSetting(labelFontSize))
                .style("fill", labelColor)
                .text((d: Date) => {
                    // Hide if way off screen to the left? 
                    // Since we align "start", if x < -100 it's gone anyway.
                    return formatMajor(d);
                });

            // --- MINOR TIER (Bottom) ---
            const formatMinor = (d: Date): string => {
                const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

                if (granularity === 'day') {
                    return String(d.getDate()).padStart(2, '0');
                } else if (granularity === 'week' || granularity === 'biweek' || granularity === 'triweek') {
                    return String(d.getDate()).padStart(2, '0');
                } else {
                    // Monthly granularity -> "Jan", "Feb"
                    return monthNames[d.getMonth()];
                }
            };

            headerLayer.selectAll<SVGTextElement, Date>(".vertical-grid-label")
                .data(ticks, (d: Date) => d.getTime())
                .join(
                    enter => enter.append("text")
                        .attr("class", "vertical-grid-label")
                        .attr("text-anchor", "middle")
                        .style("pointer-events", "none"),
                    update => update,
                    exit => exit.remove()
                )
                .attr("x", (d: Date) => this.snapTextCoord(this.snapLineCoord(xScale(d), lineWidth)))
                .attr("y", headerBandMetrics.minorLabelY)
                .style("font-family", this.getFontFamily())
                .style("font-size", this.fontPxFromPtSetting(labelFontSize))
                .style("fill", labelColor)
                .style("font-weight", "600")
                .text((d: Date) => {
                    if (xScale(d) < 35) return "";
                    return formatMinor(d);
                });
        } else {
            headerLayer.selectAll(".vertical-grid-label").remove();
            headerLayer.selectAll(".major-grid-label").remove();
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
        taskBarHeight: number,
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

        // Prioritize width from current scale range if available and non-zero
        let viewportWidth = 0;
        if (xScale && xScale.range() && xScale.range().length > 1) {
            viewportWidth = xScale.range()[1];
        } else {
            viewportWidth = this.lastUpdateOptions?.viewport?.width ?? 0;
        }

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

        // Task bar styling from settings
        const taskBarCornerRadius = this.settings.taskBars.taskBarCornerRadius.value;
        const taskBarStrokeColor = this.settings.taskBars.taskBarStrokeColor.value.value;
        const taskBarStrokeWidth = this.settings.taskBars.taskBarStrokeWidth.value;
        const milestoneShape = (this.settings.taskBars.milestoneShape.value?.value ?? "diamond") as string;

        // Calculate vertical centering
        const barHeight = Math.max(1, this.snapRectCoord(Math.min(taskBarHeight, taskHeight)));
        const barYOffset = this.snapRectCoord((taskHeight - barHeight) / 2);
        const milestoneCenterY = this.snapRectCoord(barYOffset + barHeight / 2);

        const getMilestonePath = (shape: string, size: number): string => {
            switch (shape) {
                case "circle":
                    const r = size / 2;
                    return `M ${r},0 A ${r},${r} 0 1,1 -${r},0 A ${r},${r} 0 1,1 ${r},0`;
                case "square":
                    const halfSize = size / 2;
                    return `M -${halfSize},-${halfSize} L ${halfSize},-${halfSize} L ${halfSize},${halfSize} L -${halfSize},${halfSize} Z`;
                case "diamond":
                default:
                    return `M 0,-${size / 2} L ${size / 2},0 L 0,${size / 2} L -${size / 2},0 Z`;
            }
        };

        const getTaskBarWidth = (d: Task): number => {
            const start = this.getVisualStart(d);
            const finish = this.getVisualFinish(d);
            if (!(start instanceof Date) || !(finish instanceof Date)) {
                return this.minTaskWidthPixels;
            }
            const startPos = xScale(start);
            const finishPos = xScale(finish);
            if (isNaN(startPos) || isNaN(finishPos) || finishPos < startPos) {
                return this.minTaskWidthPixels;
            }
            return Math.max(this.minTaskWidthPixels, finishPos - startPos);
        };

        const selectionHighlightColor = this.getSelectionColor();
        const selectionLabelColor = selectionHighlightColor;

        const getTaskFillColor = (d: Task, fallbackColor: string): string =>
            this.getSemanticTaskFillColor(d, fallbackColor, criticalColor, nearCriticalColor);

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
                return `translate(0, ${self.snapRectCoord(yPosition)})`;
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
            return `translate(0, ${self.snapRectCoord(yPosition)})`;
        });

        const allTaskGroups = enterGroups.merge(taskGroupsSelection);

        const showPreviousUpdate = this.showPreviousUpdateInternal;
        if (showPreviousUpdate) {
            const previousUpdateColor = this.resolveColor(this.settings.comparisonBars.previousUpdateColor.value.value, "foreground");
            const previousUpdateHeight = this.settings.comparisonBars.previousUpdateHeight.value;
            const previousUpdateOffset = this.settings.comparisonBars.previousUpdateOffset.value;
            const previousUpdateRadius = Math.min(3, previousUpdateHeight / 2);
            const previousUpdateOutline = this.getComparisonStrokeColor(previousUpdateColor);

            allTaskGroups.selectAll(".previous-update-bar").remove();

            const previousUpdateData = allTaskGroups.filter((d: Task) =>
                d.previousUpdateStartDate instanceof Date && !isNaN(d.previousUpdateStartDate.getTime()) &&
                d.previousUpdateFinishDate instanceof Date && !isNaN(d.previousUpdateFinishDate.getTime()) &&
                d.previousUpdateFinishDate >= d.previousUpdateStartDate
            );

            // Draw bars for non-milestone tasks
            previousUpdateData.filter((d: Task) => d.type !== 'TT_Mile' && d.type !== 'TT_FinMile')
                .append("rect")
                .attr("class", "previous-update-bar")
                .attr("x", (d: Task) => self.snapRectCoord(xScale(d.previousUpdateStartDate!)))
                .attr("y", self.snapRectCoord(taskHeight + previousUpdateOffset))
                .attr("width", (d: Task) => {
                    const startPos = self.snapRectCoord(xScale(d.previousUpdateStartDate!));
                    const finishPos = self.snapRectCoord(xScale(d.previousUpdateFinishDate!));
                    return Math.max(this.minTaskWidthPixels, finishPos - startPos);
                })
                .attr("height", self.snapRectCoord(previousUpdateHeight))
                .attr("rx", previousUpdateRadius)
                .attr("ry", previousUpdateRadius)
                .style("fill", previousUpdateColor)
                .style("stroke", previousUpdateOutline)
                .style("stroke-opacity", 0.7)
                .style("stroke-width", 1);

            // Draw icons for milestone tasks
            previousUpdateData.filter((d: Task) => d.type === 'TT_Mile' || d.type === 'TT_FinMile')
                .append("path")
                .attr("class", "previous-update-bar")
                .attr("d", () => getMilestonePath(milestoneShape, Math.max(previousUpdateHeight + 2, 6)))
                .attr("transform", (d: Task) => {
                    const x = self.snapRectCoord(xScale(d.previousUpdateStartDate!));
                    const y = self.snapRectCoord(taskHeight + previousUpdateOffset + previousUpdateHeight / 2);
                    return `translate(${x}, ${y})`;
                })
                .style("fill", previousUpdateColor)
                .style("stroke", previousUpdateOutline)
                .style("stroke-opacity", 0.7)
                .style("stroke-width", 1);
        } else {
            allTaskGroups.selectAll(".previous-update-bar").remove();
        }

        const showBaseline = this.showBaselineInternal;
        if (showBaseline) {
            const baselineColor = this.resolveColor(this.settings.comparisonBars.baselineColor.value.value, "foreground");
            const baselineHeight = this.settings.comparisonBars.baselineHeight.value;
            const baselineOffset = this.settings.comparisonBars.baselineOffset.value;
            const baselineRadius = Math.min(3, baselineHeight / 2);
            const baselineOutline = this.getComparisonStrokeColor(baselineColor);

            let baselineY = taskHeight;
            if (showPreviousUpdate) {
                const previousUpdateHeight = this.settings.comparisonBars.previousUpdateHeight.value;
                const previousUpdateOffset = this.settings.comparisonBars.previousUpdateOffset.value;
                baselineY = taskHeight + previousUpdateOffset + previousUpdateHeight + baselineOffset;
            } else {
                baselineY = taskHeight + baselineOffset;
            }

            allTaskGroups.selectAll(".baseline-bar").remove();

            const baselineData = allTaskGroups.filter((d: Task) =>
                d.baselineStartDate instanceof Date && !isNaN(d.baselineStartDate.getTime()) &&
                d.baselineFinishDate instanceof Date && !isNaN(d.baselineFinishDate.getTime()) &&
                d.baselineFinishDate >= d.baselineStartDate
            );

            // Draw bars for non-milestone tasks
            baselineData.filter((d: Task) => d.type !== 'TT_Mile' && d.type !== 'TT_FinMile')
                .append("rect")
                .attr("class", "baseline-bar")
                .attr("x", (d: Task) => self.snapRectCoord(xScale(d.baselineStartDate!)))
                .attr("y", self.snapRectCoord(baselineY))
                .attr("width", (d: Task) => {
                    const startPos = self.snapRectCoord(xScale(d.baselineStartDate!));
                    const finishPos = self.snapRectCoord(xScale(d.baselineFinishDate!));
                    return Math.max(this.minTaskWidthPixels, finishPos - startPos);
                })
                .attr("height", self.snapRectCoord(baselineHeight))
                .attr("rx", baselineRadius)
                .attr("ry", baselineRadius)
                .style("fill", baselineColor)
                .style("stroke", baselineOutline)
                .style("stroke-opacity", 0.7)
                .style("stroke-width", 1);

            // Draw icons for milestone tasks
            baselineData.filter((d: Task) => d.type === 'TT_Mile' || d.type === 'TT_FinMile')
                .append("path")
                .attr("class", "baseline-bar")
                .attr("d", () => getMilestonePath(milestoneShape, Math.max(baselineHeight + 2, 6)))
                .attr("transform", (d: Task) => {
                    const x = self.snapRectCoord(xScale(d.baselineStartDate!));
                    const y = self.snapRectCoord(baselineY + baselineHeight / 2);
                    return `translate(${x}, ${y})`;
                })
                .style("fill", baselineColor)
                .style("stroke", baselineOutline)
                .style("stroke-opacity", 0.7)
                .style("stroke-width", 1);
        } else {
            allTaskGroups.selectAll(".baseline-bar").remove();
        }

        allTaskGroups.selectAll(".task-bar, .milestone, .task-bar-before-data-date, .task-bar-data-date-divider").remove();

        allTaskGroups.filter((d: Task) =>
            (d.type !== 'TT_Mile' && d.type !== 'TT_FinMile')
        )
            .each(function (d: Task) {
                const start = self.getVisualStart(d);
                const finish = self.getVisualFinish(d);

                if (start instanceof Date && !isNaN(start.getTime()) && finish instanceof Date && !isNaN(finish.getTime()) && finish >= start) {
                    const startX = self.snapRectCoord(xScale(start));
                    const finishX = self.snapRectCoord(xScale(finish));
                    const barWidth = Math.max(1, finishX - startX);
                    const barRadius = Math.min(taskBarCornerRadius, barWidth / 2, barHeight / 2);
                    const baseFillColor = getTaskFillColor(d, taskColor);
                    const renderStyle = self.getTaskRenderStyle(
                        d,
                        baseFillColor,
                        barWidth,
                        false,
                        taskBarStrokeColor,
                        taskBarStrokeWidth,
                        criticalColor,
                        nearCriticalColor
                    );

                    d3.select(this).append("rect")
                        .attr("class", (d: Task) => {
                            if (d.isCritical) return "task-bar critical";
                            if (d.isNearCritical) return "task-bar near-critical";
                            return "task-bar normal";
                        })
                        .attr("role", "button")
                        .attr("aria-label", (d: Task) => {
                            const statusText = d.isCritical ? "Critical" : d.isNearCritical ? "Near Critical" : "Normal";
                            const selectedText = d.internalId === self.selectedTaskId ? " (Selected)" : "";
                            return `${d.name}, ${statusText} task, Start: ${self.formatDate(start)}, Finish: ${self.formatDate(finish)}${selectedText}. Press Enter or Space to select.`;
                        })
                        .attr("tabindex", 0)
                        .attr("aria-pressed", (d: Task) => d.internalId === self.selectedTaskId ? "true" : "false")
                        .attr("x", startX)
                        .attr("y", barYOffset)
                        .attr("width", barWidth)
                        .attr("height", barHeight)
                        .attr("rx", barRadius)
                        .attr("ry", barRadius)
                        .attr("data-base-stroke", renderStyle.strokeColor)
                        .attr("data-base-stroke-width", renderStyle.strokeWidth)
                        .attr("data-base-stroke-opacity", renderStyle.strokeOpacity)
                        .attr("data-hover-stroke", renderStyle.hoverStrokeColor)
                        .attr("data-hover-stroke-width", renderStyle.hoverStrokeWidth)
                        .attr("data-hover-stroke-opacity", renderStyle.hoverStrokeOpacity)
                        .style("fill", renderStyle.fillColor)
                        .style("stroke", renderStyle.strokeColor)
                        .style("stroke-width", renderStyle.strokeWidth)
                        .style("stroke-opacity", renderStyle.strokeOpacity)
                        .style("filter", renderStyle.svgFilter);

                    const overlay = self.getBeforeDataDateOverlay(start, finish, startX, finishX, barRadius);
                    if (overlay) {
                        const overrideColor = self.settings.dataDateColorOverride.beforeDataDateColor.value.value;
                        const overlayY = barYOffset;
                        const overlayHeight = barHeight;

                        d3.select(this)
                            .append("path")
                            .attr("class", "task-bar-before-data-date")
                            .attr("d", self.getRoundedRectPath(overlay.x, overlayY, overlay.width, overlayHeight, overlay.corners))
                            .style("fill", overrideColor)
                            .style("pointer-events", "none");

                        if (overlay.dividerX !== null && overlay.dividerX > startX + 1 && overlay.dividerX < finishX - 1) {
                            d3.select(this)
                                .append("line")
                                .attr("class", "task-bar-data-date-divider")
                                .attr("x1", overlay.dividerX)
                                .attr("x2", overlay.dividerX)
                                .attr("y1", overlayY + 1)
                                .attr("y2", overlayY + overlayHeight - 1)
                                .style("stroke", self.toRgba(self.getSoftOutlineColor(overrideColor), 0.6))
                                .style("stroke-width", 1)
                                .style("pointer-events", "none");
                        }
                    }
                }
            });

        allTaskGroups.filter((d: Task) =>
            (d.type === 'TT_Mile' || d.type === 'TT_FinMile')
        )
            .each(function (d: Task) {
                const mDate = self.getVisualMilestoneDate(d);
                if (mDate instanceof Date && !isNaN(mDate.getTime())) {
                    const milestoneSize = self.getRenderedMilestoneSize(milestoneSizeSetting, taskHeight);
                    const overrideFill = (self.settings.dataDateColorOverride.enableP6Style.value && self.dataDate &&
                        self.normalizeToStartOfDay(mDate) <= self.normalizeToStartOfDay(self.dataDate))
                        ? self.settings.dataDateColorOverride.beforeDataDateColor.value.value
                        : null;
                    const fillColor = overrideFill ?? getTaskFillColor(d, milestoneColor);
                    const renderStyle = self.getTaskRenderStyle(
                        d,
                        fillColor,
                        milestoneSize,
                        true,
                        taskBarStrokeColor,
                        taskBarStrokeWidth,
                        criticalColor,
                        nearCriticalColor
                    );

                    d3.select(this).append("path")
                        .attr("class", (d: Task) => {
                            if (d.isCritical) return "milestone critical";
                            if (d.isNearCritical) return "milestone near-critical";
                            return "milestone normal";
                        })

                        .attr("role", "button")
                        .attr("aria-label", (d: Task) => {
                            const statusText = d.isCritical ? "Critical" : d.isNearCritical ? "Near Critical" : "Normal";
                            const selectedText = d.internalId === self.selectedTaskId ? " (Selected)" : "";
                            return `${d.name}, ${statusText} milestone, Date: ${self.formatDate(mDate)}${selectedText}. Press Enter or Space to select.`;
                        })
                        .attr("tabindex", 0)
                        .attr("aria-pressed", (d: Task) => d.internalId === self.selectedTaskId ? "true" : "false")
                        .attr("transform", (d: Task) => {
                            const x = xScale(mDate);
                            if (isNaN(x)) console.warn(`Invalid X position for milestone ${d.internalId}`);
                            return `translate(${self.snapRectCoord(x)}, ${milestoneCenterY})`;
                        })
                        .attr("data-base-stroke", renderStyle.strokeColor)
                        .attr("data-base-stroke-width", renderStyle.strokeWidth)
                        .attr("data-base-stroke-opacity", renderStyle.strokeOpacity)
                        .attr("data-hover-stroke", renderStyle.hoverStrokeColor)
                        .attr("data-hover-stroke-width", renderStyle.hoverStrokeWidth)
                        .attr("data-hover-stroke-opacity", renderStyle.hoverStrokeOpacity)
                        .attr("d", () => {
                            // Support different milestone shapes from settings
                            switch (milestoneShape) {
                                case "circle":
                                    // Approximate circle with SVG path (8-point circle approximation)
                                    const r = milestoneSize / 2;
                                    return `M ${r},0 A ${r},${r} 0 1,1 -${r},0 A ${r},${r} 0 1,1 ${r},0`;
                                case "square":
                                    const halfSize = milestoneSize / 2;
                                    return `M -${halfSize},-${halfSize} L ${halfSize},-${halfSize} L ${halfSize},${halfSize} L -${halfSize},${halfSize} Z`;
                                case "diamond":
                                default:
                                    return `M 0,-${milestoneSize / 2} L ${milestoneSize / 2},0 L 0,${milestoneSize / 2} L -${milestoneSize / 2},0 Z`;
                            }
                        })
                        .style("fill", fillColor)
                        .style("stroke", renderStyle.strokeColor)
                        .style("stroke-width", renderStyle.strokeWidth)
                        .style("stroke-opacity", renderStyle.strokeOpacity)
                        .style("filter", renderStyle.svgFilter);
                }
            });



        if (showFinishDates) {
            allTaskGroups.selectAll(".date-label-group").remove();

            const dateTextFontSize = Math.max(7, generalFontSize * (reduceLabelDensity ? 0.75 : 0.85));
            const dateTextFontSizePx = this.pointsToCssPx(dateTextFontSize);
            const dateTextGroups = allTaskGroups
                .filter((d: Task) => shouldShowFinishLabel(d))
                .append("g")
                .attr("class", "date-label-group");

            const dateTextSelection = dateTextGroups.append("text")
                .attr("class", "finish-date")
                .attr("y", this.snapTextCoord(taskHeight / 2))
                .attr("text-anchor", "start")
                .attr("dominant-baseline", "central")
                .style("font-family", self.getFontFamily())
                .style("font-size", this.fontPxFromPtSetting(dateTextFontSize))
                .style("fill", labelColor)
                .style("pointer-events", "none")
                .attr("x", (d: Task): number | null => {
                    let xPos: number | null = null;
                    const dateToUse = self.getVisualFinish(d);
                    if (!(dateToUse instanceof Date && !isNaN(dateToUse.getTime()))) return null;

                    if (d.type === 'TT_Mile' || d.type === 'TT_FinMile') {
                        const milestoneMarkerDate = self.getVisualMilestoneDate(d) ?? dateToUse;
                        const milestoneX = (milestoneMarkerDate instanceof Date && !isNaN(milestoneMarkerDate.getTime())) ? xScale(milestoneMarkerDate) : NaN;
                        if (!isNaN(milestoneX)) {
                            const size = self.getRenderedMilestoneSize(milestoneSizeSetting, taskHeight);
                            xPos = milestoneX + size / 2;
                        }
                    } else {
                        const finishX = xScale(dateToUse);
                        if (!isNaN(finishX)) xPos = finishX;
                    }
                    return (xPos === null || isNaN(xPos)) ? null : self.snapTextCoord(xPos + self.dateLabelOffset);
                })
                .text((d: Task) => {
                    const dateToUse = self.getVisualFinish(d);
                    return dateToUse ? self.formatDate(dateToUse) : "";
                })
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
                            .attr("x", self.snapRectCoord(bbox.x - dateBgPaddingH))
                            .attr("y", self.snapRectCoord(bbox.y - dateBgPaddingV))
                            .attr("width", Math.max(1, self.snapRectCoord(bbox.width + (dateBgPaddingH * 2))))
                            .attr("height", Math.max(1, self.snapRectCoord(bbox.height + (dateBgPaddingV * 2))))
                            .attr("rx", 4).attr("ry", 4)
                            .style("fill", dateBackgroundColor)
                            .style("fill-opacity", dateBackgroundOpacity)

                            .style("filter", `drop-shadow(${UI_TOKENS.shadow[1]})`);
                    }
                } catch (e) {
                    console.warn(`Could not get BBox for date text on task ${d.internalId}`, e);
                }
            });
        }

        if (showDuration) {
            allTaskGroups.selectAll(".duration-text").remove();

            const durationFontSize = Math.max(7, generalFontSize * 0.8);
            const durationFontSizePx = this.pointsToCssPx(durationFontSize);
            allTaskGroups.filter((d: Task) =>
                d.type !== 'TT_Mile' && d.type !== 'TT_FinMile' &&
                self.hasValidVisualDates(d) &&
                (d.duration || 0) > 0
            )
                .append("text")
                .attr("class", "duration-text")
                .attr("y", this.snapTextCoord(taskHeight / 2))
                .attr("text-anchor", "middle")
                .attr("dominant-baseline", "central")
                .style("font-family", this.getFontFamily())
                .style("font-size", this.fontPxFromPtSetting(durationFontSize))
                .style("fill", (d: Task) => this.getDurationTextColor(getTaskFillColor(d, taskColor)))
                .style("font-weight", "500")
                .style("pointer-events", "none")
                .attr("x", (d: Task): number | null => {
                    const visualStart = self.getVisualStart(d);
                    const visualFinish = self.getVisualFinish(d);
                    if (!visualStart || !visualFinish) return null;
                    const startX = xScale(visualStart);
                    const finishX = xScale(visualFinish);
                    return (isNaN(startX) || isNaN(finishX)) ? null : this.snapTextCoord(startX + (finishX - startX) / 2);
                })
                .text((d: Task): string => {
                    const visualStart = self.getVisualStart(d);
                    const visualFinish = self.getVisualFinish(d);
                    if (!visualStart || !visualFinish) return "";
                    const startX = xScale(visualStart);
                    const finishX = xScale(visualFinish);
                    if (isNaN(startX) || isNaN(finishX)) return "";
                    const barWidth = finishX - startX;
                    const textContent = `${Math.round(d.duration || 0)}d`;
                    const estimatedTextWidth = textContent.length * (durationFontSizePx * 0.6);
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
                        const target = d3.select(event.currentTarget as Element);
                        const hoverStrokeColor = target.attr("data-hover-stroke") || self.getForegroundColor();
                        const hoverStrokeWidth = target.attr("data-hover-stroke-width") || "1.25";
                        const hoverStrokeOpacity = target.attr("data-hover-stroke-opacity") || "1";

                        target
                            .style("stroke", hoverStrokeColor)
                            .style("stroke-width", hoverStrokeWidth)
                            .style("stroke-opacity", hoverStrokeOpacity);
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
                        const target = d3.select(event.currentTarget as Element);
                        const defaultStrokeColor = target.attr("data-base-stroke") || "none";
                        const defaultStrokeWidth = target.attr("data-base-stroke-width") || "0";
                        const defaultStrokeOpacity = target.attr("data-base-stroke-opacity") || "0";

                        target
                            .style("stroke", defaultStrokeColor)
                            .style("stroke-width", defaultStrokeWidth)
                            .style("stroke-opacity", defaultStrokeOpacity);
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
                        self.announceToLiveRegion(`Focused on ${ariaLabel}`);
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
        const comp = this.settings.comparisonBars;
        const showExtra = this.showExtraColumnsInternal;

        // 1. Calculate Widths and Offsets (Right-to-Left stacking from 0)

        // Order from Grid Edge (x=0) moving Left:
        // 1. Float
        // 2. Duration 
        // 3. Finish
        // 4. Start
        // 5. Previous Finish
        // 6. Previous Start
        // 7. Baseline Finish
        // 8. Baseline Start

        const showFloat = showExtra && cols.showTotalFloat.value;
        const floatWidth = cols.totalFloatWidth.value;

        const showDur = showExtra && cols.showDuration.value;
        const durWidth = cols.durationWidth.value;

        const showFinish = showExtra && cols.showFinishDate.value;
        const finishWidth = cols.finishDateWidth.value;

        const showStart = showExtra && cols.showStartDate.value;
        const startWidth = cols.startDateWidth.value;

        // New Columns
        const showPrev = showExtra && this.showPreviousUpdateInternal;
        // Check if data roles are present for Previous? The toggle determines if we *want* to show it, 
        // but if no data is mapped, it will modify layout but show empty. 
        // Standard PowerBI behavior: if enabled in settings, show the space. 
        // Data existence check is usually done to hide the setting, but here we reuse "Show Previous Update" toggle which controls bars too.
        // Let's stick to the setting value.

        const prevFinishWidth = cols.previousUpdateFinishDateWidth.value;
        const prevStartWidth = cols.previousUpdateStartDateWidth.value;

        const showBase = showExtra && this.showBaselineInternal;
        const baseFinishWidth = cols.baselineFinishDateWidth.value;
        const baseStartWidth = cols.baselineStartDateWidth.value;

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

        // Previous Update Columns
        const prevFinishOffset = showPrev ? occupiedWidth : 0;
        if (showPrev) occupiedWidth += prevFinishWidth;

        const prevStartOffset = showPrev ? occupiedWidth : 0;
        if (showPrev) occupiedWidth += prevStartWidth;

        // Baseline Columns
        const baseFinishOffset = showBase ? occupiedWidth : 0;
        if (showBase) occupiedWidth += baseFinishWidth;

        const baseStartOffset = showBase ? occupiedWidth : 0;
        if (showBase) occupiedWidth += baseStartWidth;

        const layout = this.getLabelColumnLayout(currentLeftMargin);
        const laneLeftX = -currentLeftMargin + this.labelPaddingLeft;
        const laneRightX = (layout.taskNameDividerX - currentLeftMargin) - 4;
        const effectiveAvailableWidth = Math.max(0, laneRightX - laneLeftX);

        const wbsGroupingEnabled = this.wbsDataExists && this.settings?.wbsGrouping?.enableWbsGrouping?.value;
        const wbsIndentPerLevel = wbsGroupingEnabled ? (this.settings?.wbsGrouping?.indentPerLevel?.value ?? 20) : 0;
        const taskNameFontSizePx = this.pointsToCssPx(taskNameFontSize);
        const taskRowBandHeight = taskHeight + (this.settings?.layoutSettings?.taskPadding?.value ?? 0);
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
                return `translate(0, ${Math.round(yPosition)})`;
            })
            .filter(function () { return d3.select(this).attr("transform") !== null; });

        const mergedGroups = enterGroups.merge(labelGroups);

        mergedGroups.attr("transform", (d: Task) => {
            const domainKey = d.yOrder?.toString() ?? "";
            const yPosition = yScale(domainKey);
            if (yPosition === undefined || isNaN(yPosition)) return null;
            return `translate(0, ${Math.round(yPosition)})`;
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
                    const rawIndent = wbsGroupingEnabled && d.wbsIndentLevel ? d.wbsIndentLevel * wbsIndentPerLevel : 0;
                    const wbsInset = wbsGroupingEnabled ? this.WBS_TASK_LABEL_INSET : 0;
                    const effectiveIndent = Math.min(rawIndent, Math.max(0, effectiveAvailableWidth - wbsInset - 20));
                    return this.snapTextCoord(laneLeftX + effectiveIndent + wbsInset);
                })
                .attr("y", this.snapTextCoord(taskHeight / 2))
                .attr("text-anchor", "start")
                .attr("dominant-baseline", "central")
                .style("font-family", this.getFontFamily())
                .style("font-size", this.fontPxFromPtSetting(taskNameFontSize))
                .style("fill", (d: Task) => d.internalId === this.selectedTaskId ? selectionLabelColor : labelColor)
                .style("font-weight", (d: Task) => d.internalId === this.selectedTaskId ? selectionLabelWeight : "normal")
                .each((d: Task, _i: number, nodes: BaseType[] | ArrayLike<BaseType>) => {
                    const textElement = d3.select(nodes[_i] as SVGTextElement);
                    const rawIndent = wbsGroupingEnabled && d.wbsIndentLevel ? d.wbsIndentLevel * wbsIndentPerLevel : 0;
                    const wbsInset = wbsGroupingEnabled ? this.WBS_TASK_LABEL_INSET : 0;
                    const effectiveIndent = Math.min(rawIndent, Math.max(0, effectiveAvailableWidth - wbsInset - 20));
                    const x = laneLeftX + effectiveIndent + wbsInset;
                    const adjustedLabelWidth = Math.max(0, laneRightX - x);

                    // If individual indented row has no space, remove text
                    if (adjustedLabelWidth < 15) {
                        textElement.remove();
                        return;
                    }

                    const maxLines = this.getMaxWrappedLabelLines(
                        adjustedLabelWidth,
                        taskRowBandHeight,
                        taskNameFontSizePx
                    );

                    this.renderWrappedSvgText(
                        textElement as Selection<SVGTextElement, unknown, null, undefined>,
                        d.name || "",
                        x,
                        taskHeight / 2,
                        adjustedLabelWidth,
                        maxLines,
                        taskNameFontSizePx,
                        "firstLineAtCenter"
                    );
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
            const colY = this.snapTextCoord(taskHeight / 2);

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
                    .attr("x", this.snapTextCoord(-xOffsetFromRight - (align === "end" ? 5 : (align === "start" ? colWidth - 5 : colWidth / 2))))
                    .attr("y", colY)
                    .attr("text-anchor", align)
                    .attr("dominant-baseline", "central")
                    .style("font-family", this.getFontFamily())
                    .style("font-size", this.fontPxFromPtSetting(columnFontSize))
                    .style("fill", (d: Task) => {
                        if (isFloat) {
                            if (d.isCritical) return this.settings?.criticalPath?.criticalPathColor?.value?.value ?? '#FF0000';
                            if (d.isNearCritical) return this.settings?.criticalPath?.nearCriticalColor?.value?.value ?? '#FF8C00';
                            const floatValue = d.userProvidedTotalFloat ?? d.totalFloat;
                            if (isFinite(floatValue) && floatValue > this.floatTolerance) {
                                return this.resolveColor("#4C8C4A", "foreground");
                            }
                        }
                        return labelColor;
                    })
                    .text(getText);
            };

            // Render Start Date
            if (showStart) {
                appendColumnText(mergedGroups, startOffset, startWidth, (d: Task) => {
                    const date = this.getVisualStart(d);
                    return date ? this.formatColumnDate(date) : "";
                }, "middle");
            }

            // Render Finish Date
            if (showFinish) {
                appendColumnText(mergedGroups, finishOffset, finishWidth, (d: Task) => {
                    const date = this.getVisualFinish(d);
                    return date ? this.formatColumnDate(date) : "";
                }, "middle");
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

            // Render Previous Update Finish
            if (showPrev) {
                appendColumnText(mergedGroups, prevFinishOffset, prevFinishWidth, (d: Task) => {
                    return d.previousUpdateFinishDate ? this.formatColumnDate(d.previousUpdateFinishDate) : "";
                }, "middle");
            }

            // Render Previous Update Start
            if (showPrev) {
                appendColumnText(mergedGroups, prevStartOffset, prevStartWidth, (d: Task) => {
                    return d.previousUpdateStartDate ? this.formatColumnDate(d.previousUpdateStartDate) : "";
                }, "middle");
            }

            // Render Baseline Finish
            if (showBase) {
                appendColumnText(mergedGroups, baseFinishOffset, baseFinishWidth, (d: Task) => {
                    return d.baselineFinishDate ? this.formatColumnDate(d.baselineFinishDate) : "";
                }, "middle");
            }

            // Render Baseline Start
            if (showBase) {
                appendColumnText(mergedGroups, baseStartOffset, baseStartWidth, (d: Task) => {
                    return d.baselineStartDate ? this.formatColumnDate(d.baselineStartDate) : "";
                }, "middle");
            }
        };

        renderColumns();
    }

    private getLabelColumnLayout(currentLeftMargin: number): {
        items: Array<{ text: string; width: number; offset: number; centerX: number; lineX: number }>;
        occupiedWidth: number;
        taskNameDividerX: number;
        taskNameCenterX: number;
        showExtra: boolean;
        remainingWidth: number;
    } {
        const cols = this.settings.columns;
        const showExtra = this.showExtraColumnsInternal;
        const columnPadding = 20;
        let occupiedWidth = columnPadding;
        const items: Array<{ text: string; width: number; offset: number; centerX: number; lineX: number }> = [];

        const pushItem = (text: string, width: number): void => {
            const offset = occupiedWidth;
            occupiedWidth += width;
            items.push({
                text,
                width,
                offset,
                centerX: this.snapTextCoord(currentLeftMargin - offset - (width / 2)),
                lineX: this.snapLineCoord(currentLeftMargin - offset - width)
            });
        };

        if (showExtra && cols.showTotalFloat.value) pushItem("Total Float", cols.totalFloatWidth.value);
        if (showExtra && cols.showDuration.value) pushItem("Rem Dur", cols.durationWidth.value);
        if (showExtra && cols.showFinishDate.value) pushItem("Finish", cols.finishDateWidth.value);
        if (showExtra && cols.showStartDate.value) pushItem("Start", cols.startDateWidth.value);

        if (showExtra && this.showPreviousUpdateInternal) {
            pushItem("Prev Finish", cols.previousUpdateFinishDateWidth.value);
            pushItem("Prev Start", cols.previousUpdateStartDateWidth.value);
        }

        if (showExtra && this.showBaselineInternal) {
            pushItem("BL Finish", cols.baselineFinishDateWidth.value);
            pushItem("BL Start", cols.baselineStartDateWidth.value);
        }

        const remainingWidth = Math.max(0, currentLeftMargin - occupiedWidth);

        return {
            items,
            occupiedWidth,
            taskNameDividerX: this.snapLineCoord(currentLeftMargin - occupiedWidth),
            taskNameCenterX: this.snapTextCoord(remainingWidth / 2),
            showExtra,
            remainingWidth
        };
    }

    private getHeaderBandMetrics(): {
        top: number;
        height: number;
        columnY: number;
        majorLabelY: number;
        middleLabelY: number;
        topLabelY: number;
        bottomLabelY: number;
        minorLabelY: number;
        dividerTop: number;
        dividerBottom: number;
    } {
        const controlsBottom = this.getEstimatedHeaderControlsBottom();
        const top = Math.max(
            controlsBottom + this.HEADER_CONTROLS_GAP,
            this.headerHeight - this.HEADER_BAND_HEIGHT - this.HEADER_BOTTOM_PADDING
        );
        const availableBandHeight = Math.max(0, this.headerHeight - top - this.HEADER_BOTTOM_PADDING);
        const bandHeight = Math.max(0, Math.min(this.HEADER_BAND_HEIGHT, availableBandHeight));
        const effectiveBottom = top + bandHeight;

        return {
            top: this.snapRectCoord(top),
            height: this.snapRectCoord(bandHeight),
            columnY: this.snapTextCoord(effectiveBottom - 19),
            majorLabelY: this.snapTextCoord(top + 14),
            middleLabelY: this.snapTextCoord(top + 28),
            topLabelY: this.snapTextCoord(top + 12),
            bottomLabelY: this.snapTextCoord(effectiveBottom - 10),
            minorLabelY: this.snapTextCoord(effectiveBottom - 19),
            dividerTop: this.snapLineCoord(top + 10),
            dividerBottom: this.snapLineCoord(effectiveBottom - 9)
        };
    }

    private getHeaderBandPalette(): {
        fill: string;
        stroke: string;
        label: string;
        secondaryLabel: string;
        divider: string;
        majorDivider: string;
    } {
        if (this.highContrastMode) {
            return {
                fill: this.highContrastBackground,
                stroke: this.highContrastForeground,
                label: this.highContrastForeground,
                secondaryLabel: this.highContrastForeground,
                divider: this.highContrastForeground,
                majorDivider: this.highContrastForeground
            };
        }

        return {
            fill: HEADER_DOCK_TOKENS.shell,
            stroke: HEADER_DOCK_TOKENS.commandStroke,
            label: HEADER_DOCK_TOKENS.buttonText,
            secondaryLabel: HEADER_DOCK_TOKENS.chipMuted,
            divider: HEADER_DOCK_TOKENS.groupStroke,
            majorDivider: HEADER_DOCK_TOKENS.buttonStroke
        };
    }

    private getWbsCountLabel(group: WBSGroup): string {
        if (group.taskCount <= 0) {
            return "";
        }

        return `${group.visibleTaskCount} / ${group.taskCount}`;
    }

    private getWbsDisplayName(group: WBSGroup): string {
        return group.name;
    }

    private getFloatDisplayColor(value: number | null | undefined, fallbackColor: string): string {
        if (typeof value !== "number" || !isFinite(value)) {
            return fallbackColor;
        }

        if (value <= this.floatTolerance) {
            return this.resolveColor(this.settings?.criticalPath?.criticalPathColor?.value?.value ?? "#C73A3A", "foreground");
        }

        return this.resolveColor("#4C8C4A", "foreground");
    }

    private reflowHeaderLineLabels(
        headerLayer: Selection<SVGGElement, unknown, null, undefined>,
        chartWidth: number
    ): void {
        if (!headerLayer?.node()) {
            return;
        }

        const edgePadding = this.HEADER_LINE_LABEL_EDGE_PADDING;
        const gap = this.HEADER_LINE_LABEL_GAP;
        const labelGroups = Array.from(headerLayer.selectAll<SVGGElement, unknown>(
            ".data-date-label-group, .previous-update-end-label-group, .baseline-end-label-group, .project-end-label-group"
        ).nodes());

        if (labelGroups.length === 0) {
            return;
        }

        type HeaderLabelBox = {
            node: SVGGElement;
            priority: number;
            bbox: DOMRect | SVGRect;
            transformX: number;
            transformY: number;
            left: number;
            right: number;
            top: number;
            bottom: number;
        };

        const parseTranslate = (value: string | null): { x: number; y: number } => {
            if (!value) {
                return { x: 0, y: 0 };
            }
            const match = value.match(/translate\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?\s*\)/);
            if (!match) {
                return { x: 0, y: 0 };
            }
            return {
                x: parseFloat(match[1]) || 0,
                y: parseFloat(match[2] ?? "0") || 0
            };
        };

        const items: HeaderLabelBox[] = labelGroups.map(node => {
            const existingTransform = parseTranslate(node.getAttribute("transform"));
            node.removeAttribute("transform");
            const bbox = node.getBBox();
            return {
                node,
                priority: parseInt(node.getAttribute("data-label-priority") || "0", 10) || 0,
                bbox,
                transformX: existingTransform.x,
                transformY: existingTransform.y,
                left: bbox.x + existingTransform.x,
                right: bbox.x + existingTransform.x + bbox.width,
                top: bbox.y + existingTransform.y,
                bottom: bbox.y + existingTransform.y + bbox.height
            };
        }).sort((a, b) => {
            if (a.priority !== b.priority) {
                return a.priority - b.priority;
            }
            if (a.top !== b.top) {
                return a.top - b.top;
            }
            return b.left - a.left;
        });

        const clampIntoViewport = (item: HeaderLabelBox): void => {
            const maxLeft = Math.max(edgePadding, chartWidth - edgePadding - item.bbox.width);
            const targetLeft = Math.max(edgePadding, Math.min(item.left, maxLeft));
            item.transformX += targetLeft - item.left;
            item.left = targetLeft;
            item.right = item.left + item.bbox.width;
        };

        const placed: HeaderLabelBox[] = [];
        for (const item of items) {
            clampIntoViewport(item);

            for (const other of placed) {
                const overlapsVertically = item.top < (other.bottom + gap) && item.bottom > (other.top - gap);
                const overlapsHorizontally = item.left < (other.right + gap) && item.right > (other.left - gap);
                if (!overlapsVertically || !overlapsHorizontally) {
                    continue;
                }

                const targetLeft = Math.max(
                    edgePadding,
                    Math.min(other.left - gap - item.bbox.width, chartWidth - edgePadding - item.bbox.width)
                );
                item.transformX += targetLeft - item.left;
                item.left = targetLeft;
                item.right = item.left + item.bbox.width;
            }

            clampIntoViewport(item);
            d3.select(item.node).attr(
                "transform",
                (item.transformX !== 0 || item.transformY !== 0)
                    ? `translate(${Math.round(item.transformX)}, ${Math.round(item.transformY)})`
                    : null
            );
            placed.push(item);
        }
    }

    private drawColumnHeaders(headerHeight: number, currentLeftMargin: number): void {
        const headerSvg = this.headerSvg;
        if (!headerSvg) return;

        const bandMetrics = this.getHeaderBandMetrics();
        const headerPalette = this.getHeaderBandPalette();
        const viewportWidth = Math.max(
            1,
            this.snapRectCoord(parseFloat(headerSvg.attr("width")) || this.lastViewport?.width || this.target.clientWidth || 0)
        );

        let bandLayer = headerSvg.select<SVGGElement>(".header-band-layer");
        if (bandLayer.empty()) {
            bandLayer = headerSvg.insert("g", ":first-child")
                .attr("class", "header-band-layer");
        }

        bandLayer.selectAll<SVGRectElement, number>(".header-band-bg")
            .data([viewportWidth])
            .join(
                enter => enter.append("rect").attr("class", "header-band-bg"),
                update => update,
                exit => exit.remove()
            )
            .attr("x", 0)
            .attr("y", bandMetrics.top)
            .attr("width", d => d)
            .attr("height", bandMetrics.height)
            .style("fill", headerPalette.fill)
            .style("stroke", headerPalette.stroke)
            .style("stroke-width", 1);

        let colHeaderLayer = headerSvg.select<SVGGElement>(".column-headers");
        if (colHeaderLayer.empty()) {
            colHeaderLayer = headerSvg.append("g").attr("class", "column-headers");
        }

        const layout = this.getLabelColumnLayout(currentLeftMargin);
        const headerTaskNameClipId = this.getScopedId("clip-header-task-name");
        let defs = headerSvg.select("defs");
        if (defs.empty()) {
            defs = headerSvg.append("defs");
        }
        const headerClipSelection = defs.selectAll(`#${headerTaskNameClipId}`).data([0]);
        const headerClipEnter = headerClipSelection.enter().append("clipPath").attr("id", headerTaskNameClipId);
        headerClipEnter.append("rect");

        const fontSize = this.settings.textAndLabels.taskNameFontSize.value;
        const headerFontSizePx = this.pointsToCssPx(fontSize + 0.5);
        const yPos = bandMetrics.columnY;
        const lineY1 = bandMetrics.dividerTop;
        const lineY2 = bandMetrics.dividerBottom;

        const fontFamily = this.getFontFamily();
        const showWbsTaskHeader = this.wbsDataExists || this.settings?.wbsGrouping?.enableWbsGrouping?.value;
        const taskHeaderCandidates = showWbsTaskHeader
            ? ["WBS / Task Name", "WBS / Task", "Task Name", "Task"]
            : ["Task Name", "Task"];
        const headerTextData: Array<{ key: string; x: number; text: string; anchor: "start" | "middle" }> = [];
        if (layout.remainingWidth > 26) {
            headerTextData.push({ key: "task-name", x: 18, text: taskHeaderCandidates[0], anchor: "start" });
        }
        layout.items.forEach(item => {
            headerTextData.push({ key: `col-${item.text}`, x: item.centerX, text: item.text, anchor: "middle" });
        });

        headerClipSelection.merge(headerClipEnter as any).select("rect")
            .attr("x", 0)
            .attr("y", bandMetrics.top)
            .attr("width", Math.max(0, layout.taskNameDividerX - 8))
            .attr("height", bandMetrics.height);

        const headerTexts = colHeaderLayer.selectAll<SVGTextElement, { key: string; x: number; text: string; anchor: "start" | "middle" }>(".column-header-text")
            .data(headerTextData, d => d.key)
            .join(
                enter => enter.append("text").attr("class", "column-header-text"),
                update => update,
                exit => exit.remove()
            )
            .attr("x", d => d.x)
            .attr("y", yPos)
            .attr("text-anchor", d => d.anchor)
            .attr("dominant-baseline", "central")
            .style("font-family", fontFamily)
            .style("font-size", this.fontPxFromPtSetting(fontSize + 0.5))
            .style("font-weight", "600")
            .style("letter-spacing", "0.15px")
            .style("fill", headerPalette.label);

        headerTexts
            .attr("clip-path", d => d.key === "task-name" ? `url(#${headerTaskNameClipId})` : null)
            .text(d => d.text);

        headerTexts.filter(d => d.key === "task-name")
            .each((_d, index, nodes) => {
                const textElement = d3.select(nodes[index] as SVGTextElement);
                const node = textElement.node();
                const maxWidth = Math.max(0, layout.remainingWidth - 28);

                if (!node || maxWidth < 18) {
                    textElement.text("");
                    return;
                }

                let appliedText: string | null = null;
                for (const candidate of taskHeaderCandidates) {
                    textElement.text(candidate);
                    if (node.getComputedTextLength() <= maxWidth) {
                        appliedText = candidate;
                        break;
                    }
                }

                if (appliedText === null) {
                    textElement.text(this.fitSvgTextToWidth(textElement, taskHeaderCandidates[0], maxWidth));
                }
            });

        const separatorData: Array<{ key: string; x: number }> = layout.items.map(item => ({
            key: `col-line-${item.text}`,
            x: item.lineX
        }));
        if (layout.showExtra) {
            separatorData.push({ key: "task-name-divider", x: layout.taskNameDividerX });
        }

        colHeaderLayer.selectAll<SVGLineElement, { key: string; x: number }>(".column-header-divider")
            .data(separatorData, d => d.key)
            .join(
                enter => enter.append("line").attr("class", "column-header-divider"),
                update => update,
                exit => exit.remove()
            )
            .attr("x1", d => d.x)
            .attr("x2", d => d.x)
            .attr("y1", lineY1)
            .attr("y2", lineY2)
            .style("stroke", headerPalette.divider)
            .style("stroke-width", "1px");
    }

    /**
     * Draws vertical separator lines through the task label area, matching column headers
     */
    private drawLabelColumnSeparators(chartHeight: number, currentLeftMargin: number): void {
        const layer = this.labelGridLayer;
        if (!layer) return;

        const layout = this.getLabelColumnLayout(currentLeftMargin);
        const separatorData: Array<{ key: string; x: number }> = layout.items.map(item => ({
            key: `label-line-${item.text}`,
            x: item.lineX - currentLeftMargin
        }));
        if (layout.showExtra) {
            separatorData.push({
                key: "label-task-name-divider",
                x: layout.taskNameDividerX - currentLeftMargin
            });
        }

        layer.selectAll<SVGLineElement, { key: string; x: number }>(".label-column-separator")
            .data(separatorData, d => d.key)
            .join(
                enter => enter.append("line").attr("class", "label-column-separator"),
                update => update,
                exit => exit.remove()
            )
            .attr("x1", d => d.x)
            .attr("x2", d => d.x)
            .attr("y1", 0)
            .attr("y2", this.snapRectCoord(chartHeight))
            .style("stroke", "#D9DEE6")
            .style("stroke-width", "1px")
            .style("shape-rendering", "crispEdges");
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
        taskBarHeight: number,
        dateBackgroundColor: string,
        dateBackgroundOpacity: number
    ): void {
        if (!this.canvasContext || !this.canvasElement) return;

        const ctx = this.canvasContext;

        ctx.save();

        ctx.lineWidth = 1;

        const milestoneSizeSetting = this.settings.taskBars.milestoneSize.value;
        const minInlineDurationWidth = 28;

        // Calculate vertical centering for bars
        const barHeight = Math.max(1, this.snapRectCoord(Math.min(taskBarHeight, taskHeight)));
        const barYOffset = this.snapRectCoord((taskHeight - barHeight) / 2);

        // Task bar styling from settings (matching SVG drawTasks)
        const taskBarCornerRadius = this.settings.taskBars.taskBarCornerRadius.value;
        const taskBarStrokeColor = this.settings.taskBars.taskBarStrokeColor.value.value;
        const taskBarStrokeWidth = this.settings.taskBars.taskBarStrokeWidth.value;
        const milestoneShape = this.settings.taskBars.milestoneShape.value?.value ?? "diamond";
        const nearCriticalColor = this.resolveColor(this.settings.criticalPath.nearCriticalColor.value.value, "foreground");
        const showFinishDates = this.settings.textAndLabels.showFinishDates.value;
        const generalFontSize = this.settings.textAndLabels.fontSize.value;

        const showPreviousUpdate = this.showPreviousUpdateInternal;
        const showBaseline = this.showBaselineInternal;

        type RectBatch = { x: number, y: number, w: number, h: number, r: number, corners?: CornerRadii };
        type MilestoneBatch = { x: number, y: number, size: number, rotated: boolean };
        type LineBatch = { x1: number, y1: number, x2: number, y2: number };

        const prevUpdateBatch: RectBatch[] = [];
        const baselineBatch: RectBatch[] = [];

        const taskBatches = new Map<string, RectBatch[]>();
        const beforeDataDateBatches = new Map<string, RectBatch[]>();
        const beforeDataDateDividerBatches = new Map<string, LineBatch[]>();
        const milestoneBatches = new Map<string, MilestoneBatch[]>();

        for (const task of tasks) {
            const domainKey = task.yOrder?.toString() ?? '';
            const yPosition = yScale(domainKey);
            if (yPosition === undefined || isNaN(yPosition)) continue;

            const yPos = this.snapRectCoord(yPosition);

            if (showPreviousUpdate &&
                task.previousUpdateStartDate instanceof Date && !isNaN(task.previousUpdateStartDate.getTime()) &&
                task.previousUpdateFinishDate instanceof Date && !isNaN(task.previousUpdateFinishDate.getTime()) &&
                task.previousUpdateFinishDate >= task.previousUpdateStartDate) {
                const startX = this.snapRectCoord(xScale(task.previousUpdateStartDate));
                const finishX = this.snapRectCoord(xScale(task.previousUpdateFinishDate));
                const x = startX;
                const w = Math.max(this.minTaskWidthPixels, finishX - startX);
                const h = Math.max(1, this.snapRectCoord(this.settings.comparisonBars.previousUpdateHeight.value));
                const y = this.snapRectCoord(yPos + taskHeight + this.settings.comparisonBars.previousUpdateOffset.value);
                const r = Math.min(3, h / 2);
                prevUpdateBatch.push({ x, y, w, h, r });
            }

            if (showBaseline &&
                task.baselineStartDate instanceof Date && !isNaN(task.baselineStartDate.getTime()) &&
                task.baselineFinishDate instanceof Date && !isNaN(task.baselineFinishDate.getTime()) &&
                task.baselineFinishDate >= task.baselineStartDate) {
                let yBase: number;
                if (showPreviousUpdate) {
                    yBase = yPos + taskHeight + this.settings.comparisonBars.previousUpdateOffset.value + this.settings.comparisonBars.previousUpdateHeight.value + this.settings.comparisonBars.baselineOffset.value;
                } else {
                    yBase = yPos + taskHeight + this.settings.comparisonBars.baselineOffset.value;
                }
                const startX = this.snapRectCoord(xScale(task.baselineStartDate));
                const finishX = this.snapRectCoord(xScale(task.baselineFinishDate));
                const x = startX;
                const w = Math.max(this.minTaskWidthPixels, finishX - startX);
                const h = Math.max(1, this.snapRectCoord(this.settings.comparisonBars.baselineHeight.value));
                const y = this.snapRectCoord(yBase);
                const r = Math.min(3, h / 2);
                baselineBatch.push({ x, y, w, h, r });
            }

            const isMilestone = task.type === 'TT_Mile' || task.type === 'TT_FinMile';
            if (task.type === 'TT_Mile' || task.type === 'TT_FinMile') {
                const mDate = this.getVisualMilestoneDate(task);
                if (mDate) {
                    const milestoneSize = Math.round(this.getRenderedMilestoneSize(milestoneSizeSetting, taskHeight));
                    const semanticFill = this.getSemanticTaskFillColor(task, milestoneColor, criticalColor, nearCriticalColor);
                    const fillColor = (this.settings.dataDateColorOverride.enableP6Style.value && this.dataDate &&
                        this.normalizeToStartOfDay(mDate) <= this.normalizeToStartOfDay(this.dataDate))
                        ? this.settings.dataDateColorOverride.beforeDataDateColor.value.value
                        : semanticFill;
                    const renderStyle = this.getTaskRenderStyle(
                        task,
                        fillColor,
                        milestoneSize,
                        true,
                        taskBarStrokeColor,
                        taskBarStrokeWidth,
                        criticalColor,
                        nearCriticalColor
                    );
                    const x = this.snapRectCoord(xScale(mDate));
                    const y = this.snapRectCoord(yPos + barYOffset + barHeight / 2);
                    const styleKey = `${fillColor}|${renderStyle.strokeColor}|${renderStyle.strokeWidth}|${renderStyle.strokeOpacity}|${renderStyle.shadowBlur}|${renderStyle.shadowColor}|${renderStyle.shadowOffsetY}`;

                    if (!milestoneBatches.has(styleKey)) milestoneBatches.set(styleKey, []);
                    milestoneBatches.get(styleKey)!.push({ x, y, size: milestoneSize, rotated: true });
                }
            } else {
                const start = this.getVisualStart(task);
                const finish = this.getVisualFinish(task);
                if (!start || !finish) {
                    continue;
                }
                const startX = this.snapRectCoord(xScale(start));
                const finishX = this.snapRectCoord(xScale(finish));
                const x = startX;
                const w = Math.max(1, finishX - startX);
                const h = barHeight;
                const y = this.snapRectCoord(yPos + barYOffset);
                const r = Math.min(taskBarCornerRadius, w / 2, h / 2);
                const semanticFill = this.getSemanticTaskFillColor(task, taskColor, criticalColor, nearCriticalColor);
                const renderStyle = this.getTaskRenderStyle(
                    task,
                    semanticFill,
                    w,
                    false,
                    taskBarStrokeColor,
                    taskBarStrokeWidth,
                    criticalColor,
                    nearCriticalColor
                );
                const styleKey = `${semanticFill}|${renderStyle.strokeColor}|${renderStyle.strokeWidth}|${renderStyle.strokeOpacity}|${renderStyle.shadowBlur}|${renderStyle.shadowColor}|${renderStyle.shadowOffsetY}`;

                if (!taskBatches.has(styleKey)) taskBatches.set(styleKey, []);
                taskBatches.get(styleKey)!.push({ x, y, w, h, r });

                const overlay = this.getBeforeDataDateOverlay(start, finish, startX, finishX, r);
                if (overlay) {
                    const overrideColor = this.settings.dataDateColorOverride.beforeDataDateColor.value.value;
                    const overlayStyleKey = `${overrideColor}`;
                    if (!beforeDataDateBatches.has(overlayStyleKey)) beforeDataDateBatches.set(overlayStyleKey, []);
                    beforeDataDateBatches.get(overlayStyleKey)!.push({
                        x: overlay.x,
                        y,
                        w: overlay.width,
                        h,
                        r,
                        corners: overlay.corners
                    });

                    if (overlay.dividerX !== null && overlay.dividerX > startX + 1 && overlay.dividerX < finishX - 1) {
                        const dividerKey = this.toRgba(this.getSoftOutlineColor(overrideColor), 0.6);
                        if (!beforeDataDateDividerBatches.has(dividerKey)) beforeDataDateDividerBatches.set(dividerKey, []);
                        beforeDataDateDividerBatches.get(dividerKey)!.push({
                            x1: overlay.dividerX,
                            y1: y + 1,
                            x2: overlay.dividerX,
                            y2: y + h - 1
                        });
                    }
                }
            }
        } // Close for loop

        if (prevUpdateBatch.length > 0) {
            const pColor = this.resolveColor(this.settings.comparisonBars.previousUpdateColor.value.value, "foreground");
            const pStroke = this.getComparisonStrokeColor(pColor);

            ctx.fillStyle = pColor;
            ctx.strokeStyle = pStroke;
            ctx.lineWidth = 1;

            ctx.beginPath();
            for (const b of prevUpdateBatch) {
                this.pathRoundedRect(ctx, b.x, b.y, b.w, b.h, b.r);
            }
            ctx.fill();

            ctx.globalAlpha = 0.7;
            ctx.stroke();
            ctx.globalAlpha = 1.0;
        }

        if (baselineBatch.length > 0) {
            const bColor = this.resolveColor(this.settings.comparisonBars.baselineColor.value.value, "foreground");
            const bStroke = this.getComparisonStrokeColor(bColor);

            ctx.fillStyle = bColor;
            ctx.strokeStyle = bStroke;
            ctx.lineWidth = 1;

            ctx.beginPath();
            for (const b of baselineBatch) {
                this.pathRoundedRect(ctx, b.x, b.y, b.w, b.h, b.r);
            }
            ctx.fill();

            ctx.globalAlpha = 0.7;
            ctx.stroke();
            ctx.globalAlpha = 1.0;
        }

        taskBatches.forEach((batch, styleKey) => {
            const [fill, stroke, widthStr, opacityStr, blurStr, shadowCol, offsetStr] = styleKey.split('|');
            const strokeWidth = parseFloat(widthStr);
            const strokeOpacity = parseFloat(opacityStr);
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
            if (strokeWidth > 0 && stroke !== 'none' && strokeOpacity > 0) {
                ctx.globalAlpha = strokeOpacity;
                ctx.stroke();
                ctx.globalAlpha = 1.0;
            }
        });

        beforeDataDateBatches.forEach((batch, fill) => {
            ctx.fillStyle = fill;
            ctx.beginPath();
            for (const b of batch) {
                if (b.corners) {
                    this.pathRoundedRectWithCorners(ctx, b.x, b.y, b.w, b.h, b.corners);
                } else {
                    this.pathRoundedRect(ctx, b.x, b.y, b.w, b.h, b.r);
                }
            }
            ctx.fill();
        });

        beforeDataDateDividerBatches.forEach((batch, stroke) => {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (const divider of batch) {
                ctx.moveTo(divider.x1, divider.y1);
                ctx.lineTo(divider.x2, divider.y2);
            }
            ctx.stroke();
        });

        milestoneBatches.forEach((batch, styleKey) => {
            const [fill, stroke, widthStr, opacityStr, blurStr, shadowCol, offsetStr] = styleKey.split('|');
            const strokeWidth = parseFloat(widthStr);
            const strokeOpacity = parseFloat(opacityStr);
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

            for (const m of batch) {
                const half = m.size / 2;
                ctx.beginPath();
                switch (milestoneShape) {
                    case "circle": {
                        ctx.arc(m.x, m.y, half, 0, Math.PI * 2);
                        break;
                    }
                    case "square": {
                        ctx.rect(m.x - half, m.y - half, m.size, m.size);
                        break;
                    }
                    case "diamond":
                    default: {
                        ctx.moveTo(m.x, m.y - half);
                        ctx.lineTo(m.x + half, m.y);
                        ctx.lineTo(m.x, m.y + half);
                        ctx.lineTo(m.x - half, m.y);
                        ctx.closePath();
                        break;
                    }
                }
                ctx.fill();
                if (strokeWidth > 0 && stroke !== 'none' && strokeOpacity > 0) {
                    ctx.globalAlpha = strokeOpacity;
                    ctx.stroke();
                    ctx.globalAlpha = 1.0;
                }
            }

            ctx.shadowColor = 'transparent';
        });

        // Draw duration text on task bars (matching SVG)
        if (showDuration) {
            const durationFontSize = Math.max(7, generalFontSize * 0.8);
            const durationFontSizePx = this.pointsToCssPx(durationFontSize);
            ctx.save();
            ctx.font = `500 ${this.fontPxFromPtSetting(durationFontSize)} ${this.getFontFamily()}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            for (const task of tasks) {
                if (task.type === 'TT_Mile' || task.type === 'TT_FinMile') continue;
                const start = this.getVisualStart(task);
                const finish = this.getVisualFinish(task);
                if (!(start instanceof Date) || !(finish instanceof Date) || finish < start) continue;
                if (!task.duration || task.duration <= 0) continue;

                const domainKey = task.yOrder?.toString() ?? '';
                const yPosition = yScale(domainKey);
                if (yPosition === undefined || isNaN(yPosition)) continue;

                const startX = xScale(start);
                const finishX = xScale(finish);
                if (isNaN(startX) || isNaN(finishX)) continue;

                const barWidth = finishX - startX;
                const textContent = `${Math.round(task.duration)}d`;
                const estimatedTextWidth = textContent.length * (durationFontSizePx * 0.6);
                const minWidth = Math.max(minInlineDurationWidth, estimatedTextWidth + 8);
                if (barWidth < minWidth) continue;

                const taskFill = this.getSemanticTaskFillColor(task, taskColor, criticalColor, nearCriticalColor);
                ctx.fillStyle = this.getDurationTextColor(taskFill);
                ctx.fillText(textContent, this.snapTextCoord(startX + barWidth / 2), this.snapTextCoord(yPosition + taskHeight / 2));
            }
            ctx.restore();
        }

        // Draw finish date labels (matching SVG)
        if (showFinishDates) {
            const viewportWidth = (xScale && xScale.range() && xScale.range().length > 1) ? xScale.range()[1] : (this.lastUpdateOptions?.viewport?.width ?? 0);
            const reduceLabelDensity = this.getLayoutMode(viewportWidth) === 'narrow';
            const dateTextFontSize = Math.max(7, generalFontSize * (reduceLabelDensity ? 0.75 : 0.85));
            const dateTextFontSizePx = this.pointsToCssPx(dateTextFontSize);
            const dateBgPaddingH = this.dateBackgroundPadding.horizontal;
            const dateBgPaddingV = this.dateBackgroundPadding.vertical;

            ctx.save();
            ctx.font = `${this.fontPxFromPtSetting(dateTextFontSize)} ${this.getFontFamily()}`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';

            for (const task of tasks) {
                // In narrow mode, only show labels for selected/critical/milestone tasks
                if (reduceLabelDensity) {
                    if (task.internalId !== this.selectedTaskId && !task.isCritical &&
                        task.type !== 'TT_Mile' && task.type !== 'TT_FinMile') continue;
                }

                const dateToUse = this.getVisualFinish(task);
                if (!(dateToUse instanceof Date) || isNaN(dateToUse.getTime())) continue;

                const domainKey = task.yOrder?.toString() ?? '';
                const yPosition = yScale(domainKey);
                if (yPosition === undefined || isNaN(yPosition)) continue;

                let xPos: number | null = null;
                if (task.type === 'TT_Mile' || task.type === 'TT_FinMile') {
                    const milestoneMarkerDate = this.getVisualMilestoneDate(task) ?? dateToUse;
                    if (milestoneMarkerDate instanceof Date && !isNaN(milestoneMarkerDate.getTime())) {
                        const milestoneX = xScale(milestoneMarkerDate);
                        if (!isNaN(milestoneX)) {
                            const size = this.getRenderedMilestoneSize(milestoneSizeSetting, taskHeight);
                            xPos = milestoneX + size / 2;
                        }
                    }
                } else {
                    const finishX = xScale(dateToUse);
                    if (!isNaN(finishX)) xPos = finishX;
                }

                if (xPos === null || isNaN(xPos)) continue;
                xPos = this.snapTextCoord(xPos + this.dateLabelOffset);

                const labelText = this.formatDate(dateToUse);
                const textMetrics = ctx.measureText(labelText);
                const textWidth = textMetrics.width;
                const textHeight = dateTextFontSizePx * 1.4;
                const yCenter = this.snapTextCoord(yPosition + taskHeight / 2);

                // Draw background box
                if (dateBackgroundOpacity > 0) {
                    const bgX = this.snapRectCoord(xPos - dateBgPaddingH);
                    const bgY = this.snapRectCoord(yCenter - textHeight / 2 - dateBgPaddingV);
                    const bgW = Math.max(1, this.snapRectCoord(textWidth + dateBgPaddingH * 2));
                    const bgH = Math.max(1, this.snapRectCoord(textHeight + dateBgPaddingV * 2));

                    ctx.fillStyle = dateBackgroundColor;
                    ctx.globalAlpha = dateBackgroundOpacity;
                    ctx.beginPath();
                    this.pathRoundedRect(ctx, bgX, bgY, bgW, bgH, 4);
                    ctx.fill();
                    ctx.globalAlpha = 1.0;
                }

                // Draw text
                ctx.fillStyle = labelColor;
                ctx.fillText(labelText, xPos, yCenter);
            }
            ctx.restore();
        }

        ctx.restore();
    }

    /**
     * Draws a low-opacity copyright watermark in the bottom-right corner
     * of the canvas. Called at the end of every canvas render pass.
     * Do not remove — required by licensing terms.
     */
    private drawCanvasWatermark(): void {
        const ctx = this.canvasContext;
        const canvas = this.canvasElement;
        if (!ctx || !canvas) return;

        const text = "© Ricardo Aguirre · CPM Gantt";
        const cssWidth = canvas.clientWidth || canvas.width;
        const cssHeight = canvas.clientHeight || canvas.height;
        if (cssWidth <= 0 || cssHeight <= 0) return;

        const scaleX = canvas.width / cssWidth;
        const scaleY = canvas.height / cssHeight;
        const scrollNode = this.scrollableContainer?.node();
        const viewportBottom = scrollNode
            ? Math.min(cssHeight, scrollNode.scrollTop + scrollNode.clientHeight)
            : cssHeight;

        ctx.save();
        // Reset any transforms so coordinates are in CSS pixels relative
        // to the canvas backing store, then apply the actual canvas scale.
        ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
        ctx.globalAlpha = 0.35;
        ctx.font = "10px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
        ctx.fillStyle = "#888888";
        ctx.textAlign = "right";
        ctx.textBaseline = "bottom";

        ctx.fillText(text, cssWidth - 8, viewportBottom - 6);
        ctx.restore();
    }

    /**
     * Helper to add a rounded rect to the current path
     * (Inlined for batching performance)
     */
    private pathRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
        this.pathRoundedRectWithCorners(ctx, x, y, width, height, this.getCornerRadii(radius, true, true));
    }

    private pathRoundedRectWithCorners(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        width: number,
        height: number,
        corners: CornerRadii
    ): void {
        const { tl, tr, br, bl } = this.clampCornerRadii(width, height, corners);
        ctx.moveTo(x + tl, y);
        ctx.lineTo(x + width - tr, y);
        if (tr > 0) {
            ctx.quadraticCurveTo(x + width, y, x + width, y + tr);
        } else {
            ctx.lineTo(x + width, y);
        }
        ctx.lineTo(x + width, y + height - br);
        if (br > 0) {
            ctx.quadraticCurveTo(x + width, y + height, x + width - br, y + height);
        } else {
            ctx.lineTo(x + width, y + height);
        }
        ctx.lineTo(x + bl, y + height);
        if (bl > 0) {
            ctx.quadraticCurveTo(x, y + height, x, y + height - bl);
        } else {
            ctx.lineTo(x, y + height);
        }
        ctx.lineTo(x, y + tl);
        if (tl > 0) {
            ctx.quadraticCurveTo(x, y, x + tl, y);
        } else {
            ctx.lineTo(x, y);
        }
    }

    private clearAccessibleCanvasFallback(): void {
        this.mainSvg?.selectAll(`.accessible-fallback-layer[data-owner="${this.instanceId}"]`).remove();
    }

    /**
     * ACCESSIBILITY: Creates an invisible but screen-reader accessible fallback for canvas rendering.
     * This ensures users with assistive technology can access task information even when canvas mode is active.
     * @param tasks The tasks being rendered on canvas
     * @param yScale The Y-axis scale for positioning
     */
    private createAccessibleCanvasFallback(tasks: Task[], yScale: ScaleBand<string>): void {
        if (!this.mainSvg) return;

        this.clearAccessibleCanvasFallback();

        const accessibleLayer = this.mainSvg.append("g")
            .attr("class", "accessible-fallback-layer")
            .attr("data-owner", this.instanceId)
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
                    const milestoneDate = this.getVisualMilestoneDate(d);
                    return `${d.name}, ${statusText} milestone, Date: ${this.formatDate(milestoneDate)}${selectedText}. Press Enter or Space to select.`;
                } else {
                    return `${d.name}, ${statusText} task, Start: ${this.formatDate(this.getVisualStart(d))}, Finish: ${this.formatDate(this.getVisualFinish(d))}${selectedText}. Press Enter or Space to select.`;
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
        const canvasPixelRatio = this.getCanvasPixelRatio();
        const backingStoreRatio = (ctx as any).webkitBackingStorePixelRatio ||
            (ctx as any).mozBackingStorePixelRatio ||
            (ctx as any).msBackingStorePixelRatio ||
            (ctx as any).oBackingStorePixelRatio ||
            (ctx as any).backingStorePixelRatio || 1;

        const ratio = canvasPixelRatio / backingStoreRatio;

        const displayWidth = Math.max(1, this.snapRectCoord(chartWidth));
        const displayHeight = Math.max(1, this.snapRectCoord(chartHeight));
        const canvasWidth = Math.round(displayWidth * ratio);
        const canvasHeight = Math.round(displayHeight * ratio);

        this.canvasElement.style.width = `${displayWidth}px`;
        this.canvasElement.style.height = `${displayHeight}px`;

        if (this.canvasElement.width !== canvasWidth) {
            this.canvasElement.width = canvasWidth;
        }
        if (this.canvasElement.height !== canvasHeight) {
            this.canvasElement.height = canvasHeight;
        }

        this.canvasContext = this.canvasElement.getContext('2d', {
            alpha: true,
            desynchronized: false,
            willReadFrequently: false
        });

        if (!this.canvasContext) {
            console.error("Failed to get 2D context from canvas.");
            return false;
        }

        this.canvasContext.setTransform(1, 0, 0, 1, 0, 0);
        this.canvasContext.clearRect(0, 0, canvasWidth, canvasHeight);
        this.canvasContext.setTransform(ratio, 0, 0, ratio, 0, 0);

        this.canvasContext.beginPath();
        this.canvasContext.rect(0, 0, displayWidth, displayHeight);
        this.canvasContext.clip();

        this.canvasContext.imageSmoothingEnabled = false;



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

                const predStart = this.getVisualStart(pred);
                const predFinish = this.getVisualFinish(pred);
                const succStart = this.getVisualStart(succ);
                const succFinish = this.getVisualFinish(succ);

                switch (relType) {
                    case 'FS': case 'FF':
                        baseStartDate = predIsMilestone ? (predStart ?? predFinish) : predFinish;
                        break;
                    case 'SS': case 'SF':
                        baseStartDate = predStart;
                        break;
                }
                switch (relType) {
                    case 'FS': case 'SS':
                        baseEndDate = succStart;
                        break;
                    case 'FF': case 'SF':
                        baseEndDate = succIsMilestone ? (succStart ?? succFinish) : succFinish;
                        break;
                }

                if (!baseStartDate || !baseEndDate) return;

                const startX = xScale(baseStartDate);
                const endX = xScale(baseEndDate);

                const milestoneDrawSize = this.getRenderedMilestoneSize(milestoneSizeSetting, taskHeight);
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

                            if (Math.abs(succY - predY) > cornerRadius * 2) {
                                const verticalEnd = succY - (isGoingDown ? cornerRadius : -cornerRadius);

                                ctx.lineTo(effectiveStartX, verticalEnd);
                                ctx.arcTo(effectiveStartX, succY, effectiveStartX + cornerRadius, succY, cornerRadius);
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

                // Draw arrowhead at the end point (matching SVG marker-end)
                ctx.setLineDash([]); // Arrowheads are always solid
                const arrowSize = this.getConnectorArrowSize();
                // Determine incoming direction to the end point
                // The line always arrives at (effectiveEndX, succY) horizontally
                const arrowDirX = (relType === 'FS' || relType === 'SS') ? -1 : 1;
                ctx.beginPath();
                ctx.moveTo(effectiveEndX, succY);
                ctx.lineTo(effectiveEndX + arrowDirX * arrowSize, succY - arrowSize / 2);
                ctx.lineTo(effectiveEndX + arrowDirX * arrowSize, succY + arrowSize / 2);
                ctx.closePath();
                ctx.fillStyle = isCritical ? criticalColor : connectorColor;
                ctx.fill();

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

    private getRelationshipRenderGeometry(
        rel: Relationship,
        taskPositions: ReadonlyMap<string, number>,
        xScale: ScaleTime<number, number>,
        yScale: ScaleBand<string>,
        taskHeight: number,
        milestoneSizeSetting: number,
        elbowOffset: number,
        connectionEndPadding: number
    ): RelationshipRenderGeometry | null {
        const pred = this.taskIdToTask.get(rel.predecessorId);
        const succ = this.taskIdToTask.get(rel.successorId);
        const predYOrder = taskPositions.get(rel.predecessorId);
        const succYOrder = taskPositions.get(rel.successorId);

        if (!pred || !succ || predYOrder === undefined || succYOrder === undefined) {
            return null;
        }

        const predYBandPos = yScale(predYOrder.toString());
        const succYBandPos = yScale(succYOrder.toString());
        if (predYBandPos === undefined || succYBandPos === undefined || isNaN(predYBandPos) || isNaN(succYBandPos)) {
            return null;
        }

        const predY = predYBandPos + taskHeight / 2;
        const succY = succYBandPos + taskHeight / 2;
        const relType = rel.type || 'FS';
        const predIsMilestone = pred.type === 'TT_Mile' || pred.type === 'TT_FinMile';
        const succIsMilestone = succ.type === 'TT_Mile' || succ.type === 'TT_FinMile';

        let baseStartDate: Date | null | undefined = null;
        let baseEndDate: Date | null | undefined = null;

        const predStart = this.getVisualStart(pred);
        const predFinish = this.getVisualFinish(pred);
        const succStart = this.getVisualStart(succ);
        const succFinish = this.getVisualFinish(succ);

        switch (relType) {
            case 'FS':
            case 'FF':
                baseStartDate = predIsMilestone ? (predStart ?? predFinish) : predFinish;
                break;
            case 'SS':
            case 'SF':
                baseStartDate = predStart;
                break;
        }
        switch (relType) {
            case 'FS':
            case 'SS':
                baseEndDate = succStart;
                break;
            case 'FF':
            case 'SF':
                baseEndDate = succIsMilestone ? (succStart ?? succFinish) : succFinish;
                break;
        }

        let startX: number | null = null;
        let endX: number | null = null;
        if (baseStartDate instanceof Date && !isNaN(baseStartDate.getTime())) {
            startX = xScale(baseStartDate);
        }
        if (baseEndDate instanceof Date && !isNaN(baseEndDate.getTime())) {
            endX = xScale(baseEndDate);
        }

        if (startX === null || endX === null || isNaN(startX) || isNaN(endX)) {
            return null;
        }

        const milestoneDrawSize = this.getRenderedMilestoneSize(milestoneSizeSetting, taskHeight);
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

        if (Math.abs(pStartX - pEndX) < elbowOffset && Math.abs(pStartY - pEndY) < 1) {
            return null;
        }

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

        return {
            pathData,
            startX: pStartX,
            startY: pStartY,
            endX: pEndX,
            endY: pEndY
        };
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

        const relationshipGeometries = visibleRelationships
            .map(rel => ({
                relationship: rel,
                geometry: this.getRelationshipRenderGeometry(
                    rel,
                    taskPositions,
                    xScale,
                    yScale,
                    taskHeight,
                    milestoneSizeSetting,
                    elbowOffset,
                    connectionEndPadding
                )
            }))
            .filter((entry): entry is { relationship: Relationship; geometry: RelationshipRenderGeometry } => entry.geometry !== null);

        this.arrowLayer.selectAll<SVGPathElement, { relationship: Relationship; geometry: RelationshipRenderGeometry }>(".relationship-arrow")
            .data(relationshipGeometries, d => `${d.relationship.predecessorId}-${d.relationship.successorId}`)
            .join(
                enter => enter.append("path"),
                update => update,
                exit => exit.remove()
            )
            .attr("class", d => {
                const isDriving = d.relationship.isDriving ?? d.relationship.isCritical;
                return `relationship-arrow ${d.relationship.isCritical ? "critical" : "normal"} ${isDriving ? "driving" : "non-driving"}`;
            })
            .attr("fill", "none")
            .attr("stroke", (d) => d.relationship.isCritical ? criticalColor : connectorColor)
            .attr("stroke-opacity", (d) => {
                const isDriving = d.relationship.isDriving ?? d.relationship.isCritical;
                const baseOpacity = this.getConnectorOpacity(d.relationship);
                return differentiateDrivers && !isDriving ? baseOpacity * nonDrivingOpacity : baseOpacity;
            })
            .attr("stroke-width", (d) => {
                const baseWidth = d.relationship.isCritical ? criticalConnectorWidth : connectorWidth;
                return d.relationship.isCritical ? Math.max(1.6, baseWidth) : Math.max(1, baseWidth);
            })
            .attr("stroke-linecap", "round")
            .attr("stroke-linejoin", "round")
            .attr("stroke-dasharray", (d) => getDashArray(d.relationship))
            .attr("marker-end", (d) => d.relationship.isCritical
                ? this.getScopedUrlRef("arrowhead-critical")
                : this.getScopedUrlRef("arrowhead"))
            .attr("d", d => d.geometry.pathData);

        this.arrowLayer.selectAll<SVGCircleElement, { relationship: Relationship; geometry: RelationshipRenderGeometry }>(".connection-dot-start")
            .data(relationshipGeometries, d => `${d.relationship.predecessorId}-${d.relationship.successorId}`)
            .join(
                enter => enter.append("circle").attr("class", "connection-dot-start"),
                update => update,
                exit => exit.remove()
            )
            .attr("cx", d => d.geometry.startX)
            .attr("cy", d => d.geometry.startY)
            .attr("r", 0)
            .style("fill", d => d.relationship.isCritical ? criticalColor : connectorColor)
            .style("fill-opacity", 0)
            .style("pointer-events", "none");

        this.arrowLayer.selectAll<SVGCircleElement, { relationship: Relationship; geometry: RelationshipRenderGeometry }>(".connection-dot-end")
            .data(relationshipGeometries, d => `${d.relationship.predecessorId}-${d.relationship.successorId}`)
            .join(
                enter => enter.append("circle").attr("class", "connection-dot-end"),
                update => update,
                exit => exit.remove()
            )
            .attr("cx", d => d.geometry.endX)
            .attr("cy", d => d.geometry.endY)
            .attr("r", 0)
            .style("fill", d => d.relationship.isCritical ? criticalColor : connectorColor)
            .style("fill-opacity", 0)
            .style("pointer-events", "none");

    }

    private getLineDashArray(style: string): string {
        switch (style) {
            case "dashed": return "5,3";
            case "dotted": return "1,2";
            default: return "none";
        }
    }

    /**
     * Gets the appropriate task set for finish line calculations.
     * Prefers `allFilteredTasks` which respects all filters (LP, Search, Legend).
     * Falls back to `allTasksToShow` when `allFilteredTasks` is unavailable
     * (e.g., during a settings-only update cycle from persistProperties).
     */
    private getTasksForFinishLines(): Task[] {
        const aft = this.allFilteredTasks?.length ?? 0;
        const dur = this._lastFilteredTasksForFinishLines?.length ?? 0;
        const ats = this.allTasksToShow?.length ?? 0;
        this.debugLog(`[DIAG-FINISH] allFilteredTasks=${aft}, durable=${dur}, allTasksToShow=${ats}`);
        // Primary: current filtered tasks (set by full updateInternal)
        if (this.allFilteredTasks && this.allFilteredTasks.length > 0) {
            return this.allFilteredTasks;
        }
        // Durable fallback: last known good filtered tasks (survives settings-only updates)
        if (this._lastFilteredTasksForFinishLines && this._lastFilteredTasksForFinishLines.length > 0) {
            return this._lastFilteredTasksForFinishLines;
        }
        // Last resort
        if (this.allTasksToShow && this.allTasksToShow.length > 0) {
            return this.allTasksToShow;
        }
        return this.allTasksData || [];
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
        labelPriority?: number;
        xScale: ScaleTime<number, number>;
        chartHeight: number;
        mainGridLayer: Selection<SVGGElement, unknown, null, undefined>;
        headerLayer: Selection<SVGGElement, unknown, null, undefined>;
    }): void {
        const {
            className, targetDate, lineColor, lineWidth, lineStyle, showLabel,
            labelColor, labelFontSize, labelBackgroundColor, labelBackgroundOpacity,
            labelY, labelXOffset = 5, labelPosition = "right", labelFormatter,
            labelPriority = 0,
            xScale, chartHeight, mainGridLayer, headerLayer
        } = config;

        if (!mainGridLayer?.node() || !headerLayer?.node() || !xScale) { return; }

        mainGridLayer.select(`.${className}-line`).remove();
        headerLayer.selectAll(`.${className}-label-group`).remove();

        if (!(targetDate instanceof Date) || isNaN(targetDate.getTime())) { return; }

        const endX = this.snapLineCoord(xScale(targetDate), lineWidth);
        if (!isFinite(endX)) { console.warn(`Calculated ${className} line position is invalid:`, endX); return; }

        const lineDashArray = this.getLineDashArray(lineStyle);

        mainGridLayer.append("line")
            .attr("class", `${className}-line`)
            .attr("x1", endX).attr("y1", 0)
            .attr("x2", endX).attr("y2", this.snapRectCoord(chartHeight))
            .attr("stroke", lineColor)
            .attr("stroke-width", lineWidth)
            .attr("stroke-dasharray", lineDashArray)
            .attr("clip-path", this.getScopedUrlRef("chart-area-clip"))
            .style("pointer-events", "none");

        if (showLabel) {
            const labelText = labelFormatter ? labelFormatter(targetDate) : this.formatDate(targetDate);
            const sign = labelPosition === "left" ? -1 : 1;
            const anchor = labelPosition === "left" ? "end" : "start";
            const labelX = this.snapTextCoord(endX + (labelXOffset * sign));

            const labelGroup = headerLayer.append("g")
                .attr("class", `${className}-label-group`)
                .attr("data-label-priority", String(labelPriority))
                .style("pointer-events", "none");

            const textElement = labelGroup.append("text")
                .attr("class", `${className}-label`)
                .attr("x", labelX)
                .attr("y", this.snapTextCoord(labelY))
                .attr("text-anchor", anchor)
                .attr("dominant-baseline", "central")
                .style("font-family", this.getFontFamily())
                .style("fill", labelColor)
                .style("font-size", this.fontPxFromPtSetting(labelFontSize))
                .style("font-weight", "600")
                .text(labelText);

            if (labelBackgroundOpacity > 0) {
                const bbox = (textElement.node() as SVGTextElement)?.getBBox();
                if (bbox) {
                    const chipHeight = Math.max(
                        this.HEADER_LINE_LABEL_MIN_HEIGHT,
                        this.snapRectCoord(bbox.height + this.HEADER_LINE_LABEL_PADDING_Y * 2)
                    );
                    labelGroup.insert("rect", `.${className}-label`)
                        .attr("x", this.snapRectCoord(bbox.x - this.HEADER_LINE_LABEL_PADDING_X))
                        .attr("y", this.snapRectCoord(labelY - chipHeight / 2))
                        .attr("width", Math.max(1, this.snapRectCoord(bbox.width + this.HEADER_LINE_LABEL_PADDING_X * 2)))
                        .attr("height", chipHeight)
                        .attr("rx", 4)
                        .attr("ry", 4)
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
        const headerBandMetrics = this.getHeaderBandMetrics();

        const latestFinishDate = settings.show.value
            ? this.getLatestFinishDate(allTasks, (t: Task) => this.getVisualFinish(t))
            : null;

        this.drawFinishLine({
            className: "project-end",
            targetDate: latestFinishDate,
            lineColor,
            lineWidth,
            lineStyle,
            showLabel: false,
            labelColor,
            labelFontSize,
            labelBackgroundColor,
            labelBackgroundOpacity,
            labelPosition: settings.labelPosition?.value?.value as string,
            labelY: headerBandMetrics.bottomLabelY,
            labelFormatter: (d: Date) => showLabelPrefix ? `Finish: ${this.formatLineDate(d)}` : this.formatLineDate(d),
            labelPriority: 40,
            xScale,
            chartHeight,
            mainGridLayer,
            headerLayer
        });

        const comparisonSummaryEntries = [
            ...this.pendingComparisonFinishSummaryEntries,
            {
                className: "project-end",
                targetDate: latestFinishDate,
                showLabel,
                lineColor,
                lineWidth,
                lineStyle,
                labelColor,
                labelFontSize,
                labelBackgroundColor,
                labelBackgroundOpacity,
                labelPosition: settings.labelPosition?.value?.value as string,
                rowY: headerBandMetrics.bottomLabelY,
                labelText: latestFinishDate
                    ? (showLabelPrefix ? `Finish: ${this.formatLineDate(latestFinishDate)}` : this.formatLineDate(latestFinishDate))
                    : "",
                labelPriority: 5
            }
        ];

        this.drawComparisonFinishKey(headerLayer, chartWidth, comparisonSummaryEntries);
        this.pendingComparisonFinishSummaryEntries = [];
    }

    private drawDataDateLine(
        chartWidth: number,
        xScale: ScaleTime<number, number>,
        chartHeight: number,
        mainGridLayer: Selection<SVGGElement, unknown, null, undefined>,
        headerLayer: Selection<SVGGElement, unknown, null, undefined>
    ): void {
        if (!mainGridLayer?.node() || !headerLayer?.node() || !xScale) { return; }

        mainGridLayer.selectAll(".data-date-line").remove();
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
        const headerBandMetrics = this.getHeaderBandMetrics();

        let lineDashArray = "none";
        switch (lineStyle) { case "dashed": lineDashArray = "5,3"; break; case "dotted": lineDashArray = "1,2"; break; default: lineDashArray = "none"; }

        const dataDateX = this.snapLineCoord(xScale(this.dataDate), lineWidth);

        if (!isFinite(dataDateX) || dataDateX < 0 || dataDateX > chartWidth) { return; }

        const effectiveHeight = chartHeight > 0 ? chartHeight : (this.mainSvg ? (parseFloat(this.mainSvg.attr("height")) || 0) : 0);

        mainGridLayer.append("line")
            .attr("class", "data-date-line")
            .attr("x1", dataDateX).attr("y1", 0)
            .attr("x2", dataDateX).attr("y2", this.snapRectCoord(effectiveHeight))
            .attr("stroke", lineColor)
            .attr("stroke-width", lineWidth)
            .attr("stroke-dasharray", lineDashArray)
            .attr("clip-path", this.getScopedUrlRef("chart-area-clip"))
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

            const labelY = headerBandMetrics.majorLabelY;
            const labelPosition = settings.labelPosition?.value?.value as string || "right";
            const sign = labelPosition === "left" ? -1 : 1;
            const anchor = labelPosition === "left" ? "end" : "start";
            const labelX = this.snapTextCoord(dataDateX + (5 * sign));

            const labelGroup = headerLayer.append("g")
                .attr("class", "data-date-label-group")
                .attr("data-label-priority", "10")
                .style("pointer-events", "none");

            const textElement = labelGroup.append("text")
                .attr("class", "data-date-label")
                .attr("x", labelX)
                .attr("y", this.snapTextCoord(labelY))
                .attr("text-anchor", anchor)
                .attr("dominant-baseline", "central")
                .style("font-family", this.getFontFamily())
                .style("fill", labelColor)
                .style("font-size", this.fontPxFromPtSetting(labelFontSize))
                .style("font-weight", "600")
                .text(dataDateText);

            if (labelBackgroundOpacity > 0) {
                const bbox = (textElement.node() as SVGTextElement)?.getBBox();
                if (bbox) {
                    const chipHeight = Math.max(
                        this.HEADER_LINE_LABEL_MIN_HEIGHT,
                        this.snapRectCoord(bbox.height + this.HEADER_LINE_LABEL_PADDING_Y * 2)
                    );
                    labelGroup.insert("rect", ".data-date-label")
                        .attr("x", this.snapRectCoord(bbox.x - this.HEADER_LINE_LABEL_PADDING_X))
                        .attr("y", this.snapRectCoord(labelY - chipHeight / 2))
                        .attr("width", Math.max(1, this.snapRectCoord(bbox.width + this.HEADER_LINE_LABEL_PADDING_X * 2)))
                        .attr("height", chipHeight)
                        .attr("rx", 4)
                        .attr("ry", 4)
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
        this.headerSvg?.selectAll(".comparison-finish-key-group").remove();

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
        const headerBandMetrics = this.getHeaderBandMetrics();

        this.drawFinishLine({
            className: "baseline-end",
            targetDate: baselineTargetDate,
            lineColor: baselineLineColor,
            lineWidth: baselineLineWidth,
            lineStyle: baselineLineStyle,
            showLabel: false,
            labelColor: baselineLabelColor,
            labelFontSize: baselineLabelFontSize,
            labelBackgroundColor: baselineLabelBackgroundColor,
            labelBackgroundOpacity: baselineLabelBackgroundOpacity,
            labelPosition: baselineSettings.labelPosition?.value?.value as string,
            labelY: headerBandMetrics.middleLabelY,
            labelFormatter: (d: Date) => baselineShowLabelPrefix ? `Baseline Finish: ${this.formatLineDate(d)}` : `Baseline: ${this.formatLineDate(d)}`,
            labelPriority: 30,
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
            showLabel: false,
            labelColor: prevLabelColor,
            labelFontSize: prevLabelFontSize,
            labelBackgroundColor: prevLabelBackgroundColor,
            labelBackgroundOpacity: prevLabelBackgroundOpacity,
            labelPosition: prevSettings.labelPosition?.value?.value as string,
            labelY: headerBandMetrics.topLabelY,
            labelFormatter: (d: Date) => prevShowLabelPrefix ? `Previous Finish: ${this.formatLineDate(d)}` : `Previous: ${this.formatLineDate(d)}`,
            labelPriority: 20,
            xScale,
            chartHeight,
            mainGridLayer,
            headerLayer
        });

        this.pendingComparisonFinishSummaryEntries = [
            {
                className: "previous-update-end",
                targetDate: prevTargetDate,
                showLabel: prevShowLabel,
                lineColor: prevLineColor,
                lineWidth: prevLineWidth,
                lineStyle: prevLineStyle,
                labelColor: prevLabelColor,
                labelFontSize: prevLabelFontSize,
                labelBackgroundColor: prevLabelBackgroundColor,
                labelBackgroundOpacity: prevLabelBackgroundOpacity,
                labelPosition: prevSettings.labelPosition?.value?.value as string,
                rowY: headerBandMetrics.topLabelY,
                labelText: prevTargetDate
                    ? (prevShowLabelPrefix ? `Previous: ${this.formatLineDate(prevTargetDate)}` : this.formatLineDate(prevTargetDate))
                    : "",
                labelPriority: 5
            },
            {
                className: "baseline-end",
                targetDate: baselineTargetDate,
                showLabel: baselineShowLabel,
                lineColor: baselineLineColor,
                lineWidth: baselineLineWidth,
                lineStyle: baselineLineStyle,
                labelColor: baselineLabelColor,
                labelFontSize: baselineLabelFontSize,
                labelBackgroundColor: baselineLabelBackgroundColor,
                labelBackgroundOpacity: baselineLabelBackgroundOpacity,
                labelPosition: baselineSettings.labelPosition?.value?.value as string,
                rowY: headerBandMetrics.middleLabelY,
                labelText: baselineTargetDate
                    ? (baselineShowLabelPrefix ? `Baseline: ${this.formatLineDate(baselineTargetDate)}` : this.formatLineDate(baselineTargetDate))
                    : "",
                labelPriority: 5
            }
        ];
    }

    private drawComparisonFinishKey(
        headerLayer: Selection<SVGGElement, unknown, null, undefined>,
        chartWidth: number,
        entries: Array<{
            className: string;
            targetDate: Date | null;
            showLabel: boolean;
            lineColor: string;
            lineWidth: number;
            lineStyle: string;
            labelColor: string;
            labelFontSize: number;
            labelBackgroundColor: string;
            labelBackgroundOpacity: number;
            labelPosition?: string;
            rowY: number;
            labelText: string;
            labelPriority?: number;
        }>
    ): void {
        if (!headerLayer?.node() || !this.headerSvg?.node() || chartWidth <= 0) {
            return;
        }

        const visibleEntries = entries.filter(entry =>
            entry.showLabel &&
            entry.targetDate instanceof Date &&
            !isNaN(entry.targetDate.getTime()) &&
            entry.labelText.trim().length > 0
        );

        if (visibleEntries.length === 0) {
            this.secondRowComparisonSummaryWidth = 0;
            this.secondRowComparisonSummaryUsesRightLane = false;
            this.updateSelectedTaskStatusLabel();
            return;
        }

        const viewportWidth = Math.max(
            1,
            this.snapRectCoord(parseFloat(this.headerSvg?.attr("width") || "0") || this.lastUpdateOptions?.viewport?.width || this.target?.clientWidth || 0)
        );
        const summaryBounds = this.getComparisonFinishSummaryBounds(viewportWidth);

        if (summaryBounds.width <= 0) {
            this.secondRowComparisonSummaryWidth = 0;
            this.secondRowComparisonSummaryUsesRightLane = false;
            this.updateSelectedTaskStatusLabel(viewportWidth);
            return;
        }

        let summaryLayer = this.headerSvg.select<SVGGElement>(".comparison-finish-key-layer");
        if (summaryLayer.empty()) {
            summaryLayer = this.headerSvg.append("g")
                .attr("class", "comparison-finish-key-layer")
                .style("pointer-events", "none");
        }

        const keyGroup = summaryLayer.append("g")
            .attr("class", `comparison-finish-key-group comparison-finish-key-group-${summaryBounds.align}`)
            .attr("data-label-priority", String(Math.min(...visibleEntries.map(entry => entry.labelPriority ?? 5))))
            .style("pointer-events", "none");

        const compactSummary = summaryBounds.width < 240;
        const chipPaddingX = compactSummary ? 4 : 5;
        const chipPaddingY = compactSummary ? 2 : 3;
        const chipGap = compactSummary ? 5 : 6;
        const minTextWidth = compactSummary ? 16 : 24;
        const availableTextWidth = Math.max(
            minTextWidth,
            Math.floor(
                (
                    summaryBounds.width -
                    (chipGap * Math.max(0, visibleEntries.length - 1)) -
                    (visibleEntries.length * (chipPaddingX * 2))
                ) / visibleEntries.length
            )
        );

        let cursorX = 0;
        visibleEntries.forEach(entry => {
            const chipGroup = keyGroup.append("g")
                .attr("class", `comparison-finish-key-chip ${entry.className}-summary-chip`)
                .attr("transform", `translate(${Math.round(cursorX)}, 0)`);

            const text = chipGroup.append("text")
                .attr("class", `${entry.className}-summary-label`)
                .attr("x", this.snapTextCoord(chipPaddingX))
                .attr("y", 0)
                .attr("text-anchor", "start")
                .attr("dominant-baseline", "central")
                .style("font-family", this.getFontFamily())
                .style("fill", entry.labelColor)
                .style("font-size", this.fontPxFromPtSetting(entry.labelFontSize))
                .style("font-weight", "600");

            const fittedText = this.fitSvgTextToWidth(
                text as Selection<SVGTextElement, unknown, null, undefined>,
                entry.labelText,
                availableTextWidth
            );
            text.text(fittedText);

            const textBBox = (text.node() as SVGTextElement)?.getBBox();
            if (!textBBox) {
                return;
            }

            const chipHeight = Math.max(
                this.HEADER_LINE_LABEL_MIN_HEIGHT + 2,
                this.snapRectCoord(textBBox.height + chipPaddingY * 2)
            );
            const chipWidth = Math.max(
                1,
                this.snapRectCoord(textBBox.width + chipPaddingX * 2)
            );

            chipGroup.insert("rect", `.${entry.className}-summary-label`)
                .attr("x", 0)
                .attr("y", this.snapRectCoord(-chipHeight / 2))
                .attr("width", chipWidth)
                .attr("height", chipHeight)
                .attr("rx", 5)
                .attr("ry", 5)
                .style("fill", entry.labelBackgroundOpacity > 0 ? entry.labelBackgroundColor : HEADER_DOCK_TOKENS.chipBg)
                .style("fill-opacity", entry.labelBackgroundOpacity > 0 ? entry.labelBackgroundOpacity : 1)
                .style("stroke", this.highContrastMode ? this.highContrastForeground : entry.lineColor)
                .style("stroke-width", "1");

            cursorX += chipWidth + chipGap;
        });

        const bbox = (keyGroup.node() as SVGGElement).getBBox();
        const centerY = summaryBounds.top + (UI_TOKENS.height.compact / 2);
        const targetLeft = summaryBounds.align === "right"
            ? summaryBounds.left + Math.max(0, summaryBounds.width - bbox.width)
            : summaryBounds.left;

        keyGroup.attr(
            "transform",
            `translate(${Math.round(targetLeft - bbox.x)}, ${Math.round(centerY - (bbox.y + (bbox.height / 2)))})`
        );

        this.secondRowComparisonSummaryWidth = Math.ceil(bbox.width);
        this.secondRowComparisonSummaryUsesRightLane = summaryBounds.usesRightLane;
        this.updateSelectedTaskStatusLabel(viewportWidth);
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

        if (!this.isCpmSafe()) {
            this.clearCriticalPathState();
            this.updatePathInfoLabel();
            return;
        }

        if (this.allTasksData.length === 0) {
            this.debugLog("No tasks for longest path identification.");
            return;
        }

        this.clearCriticalPathState();

        this.identifyDrivingRelationships();

        const projectFinishTasks = this.findProjectFinishTasks();
        if (projectFinishTasks.length === 0) {
            console.warn("Could not identify project finish task");
            return;
        }

        this.debugLog(`Project finish tasks: ${projectFinishTasks.map(task => `${task.name} (${task.internalId})`).join(", ")}`);

        const drivingScope = this.collectDrivingAncestorsForTargets(projectFinishTasks.map(task => task.internalId));
        const drivingChains = this.buildBestDrivingChains(
            drivingScope,
            projectFinishTasks.map(task => task.internalId)
        );
        const resolvedChains = drivingChains.length > 0
            ? drivingChains
            : projectFinishTasks.map(task => ({
                tasks: new Set([task.internalId]),
                relationships: [],
                totalDuration: this.getTaskScheduleSpanDays(task),
                startingTask: task,
                endingTask: task
            }));

        this.allDrivingChains = this.sortAndStoreDrivingChains(resolvedChains);

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

        // Check if user has provided Relationship Free Float for ANY relationship
        // Uses flag calculated in DataProcessor to avoid O(N) iteration here
        const hasUserProvidedFloat = this.hasUserProvidedFloat;

        for (const rel of this.relationships) {
            const pred = this.taskIdToTask.get(rel.predecessorId);
            const succ = this.taskIdToTask.get(rel.successorId);

            if (!pred || !succ) {
                rel.relationshipFloat = Infinity;
                rel.isDriving = false;
                rel.isCritical = false;
                continue;
            }

            // STRICT FILTERING LOGIC
            if (hasUserProvidedFloat) {
                if (rel.freeFloat !== null && rel.freeFloat !== undefined) {
                    rel.relationshipFloat = rel.freeFloat;
                    // It is driving if float <= 0 (or tolerance). 
                    // We set isDriving immediately here for strict mode to avoid downstream ambiguity
                    // But to respect the 'minFloat' logic below for standard groups, we can just set the float
                    // can let the group logic handle it?
                    // The user said: "only calcualte the driving paths using the provided values... filter out any relationship where ... blank"
                    // If it's blank (else block), we ignore it.
                } else {
                    // Blank value in strict mode -> Ignore this relationship for driving purposes
                    rel.relationshipFloat = Infinity;
                }
            } else {
                // Legacy / Fallback Mode (No user provided float found in dataset)
                let relFloat: number;

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

                rel.relationshipFloat = relFloat;
            }

            // Allow downstream logic to set isDriving based on minFloat unless strictly excluded
            rel.isDriving = false;
            rel.isCritical = false;
        }

        // Use the pre-built relationshipIndex (successorId -> Relationship[]) instead of
        // rebuilding a successor map from scratch on every call — O(1) lookup vs O(R) rebuild
        let drivingCount = 0;
        for (const [successorId, rels] of this.relationshipIndex) {
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
                    drivingCount++;
                }
            }
        }

        this.debugLog(`Identified ${drivingCount} driving relationships`);
    }

    private findProjectFinishTasks(): Task[] {
        const terminalTaskIds = this.getDrivingTerminalTaskIds();
        const candidateTaskIds = terminalTaskIds.length > 0
            ? terminalTaskIds
            : this.allTasksData.map(task => task.internalId);
        const tiedFinishTaskIds = getTiedLatestFinishTaskIds(
            this.taskIdToTask,
            candidateTaskIds,
            this.floatTolerance
        );

        const tasks = tiedFinishTaskIds
            .map(taskId => this.taskIdToTask.get(taskId))
            .filter((task): task is Task => !!task);

        this.debugLog(`Found ${tasks.length} tied terminal finish task(s).`);
        return tasks;
    }

    private getDrivingIncoming(taskId: string, scope?: Set<string>): Relationship[] {
        const incoming = (this.relationshipIndex.get(taskId) || []).filter(rel => rel.isDriving);
        if (!scope) {
            return incoming;
        }
        return incoming.filter(rel => scope.has(rel.predecessorId) && scope.has(rel.successorId));
    }

    private getDrivingOutgoing(taskId: string, scope?: Set<string>): Relationship[] {
        const outgoing = (this.relationshipByPredecessor.get(taskId) || []).filter(rel => rel.isDriving);
        if (!scope) {
            return outgoing;
        }
        return outgoing.filter(rel => scope.has(rel.predecessorId) && scope.has(rel.successorId));
    }

    private getDrivingTerminalTaskIds(scope?: Set<string>): string[] {
        const candidateTaskIds = scope
            ? Array.from(scope)
            : this.allTasksData.map(task => task.internalId);

        return candidateTaskIds
            .filter(taskId => this.taskIdToTask.has(taskId))
            .filter(taskId => this.getDrivingOutgoing(taskId, scope).length === 0)
            .sort((a, b) => this.compareTaskIdsForTopo(a, b));
    }

    private compareTaskIdsForTopo(aId: string, bId: string): number {
        const aTask = this.taskIdToTask.get(aId);
        const bTask = this.taskIdToTask.get(bId);
        const aStart = aTask?.startDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const bStart = bTask?.startDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
        if (aStart !== bStart) {
            return aStart - bStart;
        }

        const aFinish = aTask?.finishDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const bFinish = bTask?.finishDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
        if (aFinish !== bFinish) {
            return aFinish - bFinish;
        }

        return aId.localeCompare(bId);
    }

    private insertIntoSortedTopoQueue(queue: string[], taskId: string): void {
        let low = 0;
        let high = queue.length;

        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (this.compareTaskIdsForTopo(taskId, queue[mid]) < 0) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }

        queue.splice(low, 0, taskId);
    }

    private collectDrivingAncestors(targetTaskId: string): Set<string> {
        const nodeIds = new Set<string>();
        const stack: string[] = [targetTaskId];

        while (stack.length > 0) {
            const currentId = stack.pop()!;
            if (nodeIds.has(currentId)) {
                continue;
            }

            nodeIds.add(currentId);
            for (const rel of this.getDrivingIncoming(currentId)) {
                stack.push(rel.predecessorId);
            }
        }

        return nodeIds;
    }

    private collectDrivingAncestorsForTargets(targetTaskIds: Iterable<string>): Set<string> {
        const collected = new Set<string>();
        for (const targetTaskId of targetTaskIds) {
            for (const taskId of this.collectDrivingAncestors(targetTaskId)) {
                collected.add(taskId);
            }
        }
        return collected;
    }

    private collectDrivingDescendants(sourceTaskId: string): Set<string> {
        const nodeIds = new Set<string>();
        const stack: string[] = [sourceTaskId];

        while (stack.length > 0) {
            const currentId = stack.pop()!;
            if (nodeIds.has(currentId)) {
                continue;
            }

            nodeIds.add(currentId);
            for (const rel of this.getDrivingOutgoing(currentId)) {
                stack.push(rel.successorId);
            }
        }

        return nodeIds;
    }

    private getDrivingTopologicalOrder(nodeIds: Set<string>): string[] | null {
        const indegree = new Map<string, number>();
        nodeIds.forEach(taskId => indegree.set(taskId, 0));

        nodeIds.forEach(taskId => {
            for (const rel of this.getDrivingOutgoing(taskId, nodeIds)) {
                indegree.set(rel.successorId, (indegree.get(rel.successorId) ?? 0) + 1);
            }
        });

        const queue = Array.from(nodeIds)
            .filter(taskId => (indegree.get(taskId) ?? 0) === 0)
            .sort((a, b) => this.compareTaskIdsForTopo(a, b));
        const order: string[] = [];

        while (queue.length > 0) {
            const currentId = queue.shift()!;
            order.push(currentId);

            for (const rel of this.getDrivingOutgoing(currentId, nodeIds)) {
                const nextIndegree = (indegree.get(rel.successorId) ?? 0) - 1;
                indegree.set(rel.successorId, nextIndegree);
                if (nextIndegree === 0) {
                    this.insertIntoSortedTopoQueue(queue, rel.successorId);
                }
            }
        }

        if (order.length !== nodeIds.size) {
            return null;
        }

        return order;
    }

    private updateDrivingPathGenerationState(result: {
        paths: { length: number };
        truncated: boolean;
        truncatedByPathLimit: boolean;
        truncatedByExpansionLimit: boolean;
        expansionCount: number;
    }): void {
        this.drivingPathsTruncated = result.truncated;
        this.drivingPathExpansionCount = result.expansionCount;

        if (!result.truncated) {
            this.drivingPathsTruncationMessage = null;
            return;
        }

        if (result.truncatedByPathLimit) {
            this.drivingPathsTruncationMessage = `Showing first ${result.paths.length} paths`;
            return;
        }

        if (result.truncatedByExpansionLimit && result.paths.length > 0) {
            this.drivingPathsTruncationMessage = `Showing first ${result.paths.length} paths`;
            return;
        }

        this.drivingPathsTruncationMessage = "Path generation truncated";
    }

    private getTaskScheduleSpanDays(task: Task | null | undefined): number {
        const startTime = task?.startDate?.getTime();
        const finishTime = task?.finishDate?.getTime();
        if (!Number.isFinite(startTime) || !Number.isFinite(finishTime)) {
            return 0;
        }

        return Math.max(0, ((finishTime as number) - (startTime as number)) / 86400000);
    }

    private createDrivingChain(taskIds: string[], relationships: Relationship[], spanDays: number): DrivingChain | null {
        if (taskIds.length === 0) {
            return null;
        }

        const startingTask = this.taskIdToTask.get(taskIds[0]) ?? null;
        const endingTask = this.taskIdToTask.get(taskIds[taskIds.length - 1]) ?? null;

        return {
            tasks: new Set(taskIds),
            relationships: [...relationships],
            totalDuration: spanDays,
            startingTask,
            endingTask
        };
    }

    private buildBestDrivingChains(
        scopeTaskIds: Set<string>,
        sinkTaskIds: string[],
        explicitSourceTaskIds?: string[]
    ): DrivingChain[] {
        this.drivingPathsTruncated = false;
        this.drivingPathsTruncationMessage = null;
        this.drivingPathExpansionCount = 0;

        if (scopeTaskIds.size === 0) {
            return [];
        }

        const topoOrder = this.getDrivingTopologicalOrder(scopeTaskIds);
        if (!topoOrder) {
            console.warn("Unable to build driving paths: driving graph is cyclic.");
            return [];
        }

        const scopedRelationships: Relationship[] = [];
        const seenRelationships = new Set<string>();
        for (const taskId of topoOrder) {
            const outgoing = this.getDrivingOutgoing(taskId, scopeTaskIds)
                .sort((a, b) => {
                    const successorOrder = this.compareTaskIdsForTopo(a.successorId, b.successorId);
                    if (successorOrder !== 0) {
                        return successorOrder;
                    }
                    const typeOrder = (a.type || "FS").localeCompare(b.type || "FS");
                    if (typeOrder !== 0) {
                        return typeOrder;
                    }
                    return (a.lag ?? 0) - (b.lag ?? 0);
                });

            for (const relationship of outgoing) {
                const key = `${relationship.predecessorId}|${relationship.successorId}|${relationship.type || "FS"}|${relationship.lag ?? ""}`;
                if (!seenRelationships.has(key)) {
                    seenRelationships.add(key);
                    scopedRelationships.push(relationship);
                }
            }
        }

        const graph = buildDrivingEventGraph(this.taskIdToTask, topoOrder, scopedRelationships);
        const sourceNodeIds = (explicitSourceTaskIds && explicitSourceTaskIds.length > 0
            ? explicitSourceTaskIds.map(taskId => getTaskEventNodeId(taskId, "start"))
            : graph.rootStartNodeIds)
            .filter(nodeId => graph.nodeIndex.has(nodeId));
        const candidateSinkNodeIds = sinkTaskIds
            .map(taskId => getTaskEventNodeId(taskId, "finish"))
            .filter(nodeId => graph.nodeIndex.has(nodeId));

        if (sourceNodeIds.length === 0 || candidateSinkNodeIds.length === 0) {
            return [];
        }

        const longestPaths = calculateLongestDrivingPaths(graph, sourceNodeIds, this.floatTolerance);
        const bestSinkNodeIds = selectBestSinkNodeIds(
            longestPaths.distances,
            candidateSinkNodeIds,
            this.floatTolerance
        );

        if (bestSinkNodeIds.length === 0) {
            return [];
        }

        const expandedPaths = expandBestDrivingPaths(
            graph,
            longestPaths.bestIncoming,
            longestPaths.distances,
            bestSinkNodeIds,
            {
                maxPaths: Visual.DRIVING_PATH_MAX_PATHS,
                maxExpansions: Visual.DRIVING_PATH_MAX_EXPANSIONS
            }
        );
        this.updateDrivingPathGenerationState(expandedPaths);

        const chains = expandedPaths.paths
            .map(path => this.createDrivingChain(path.taskIds, path.relationships, path.spanDays))
            .filter((chain): chain is DrivingChain => chain !== null);

        if (chains.length > 0) {
            return chains;
        }

        if (explicitSourceTaskIds && explicitSourceTaskIds.length === 1) {
            const singleTaskId = explicitSourceTaskIds[0];
            const fallbackTask = this.taskIdToTask.get(singleTaskId) ?? null;
            if (fallbackTask) {
                return [{
                    tasks: new Set([singleTaskId]),
                    relationships: [],
                    totalDuration: this.getTaskScheduleSpanDays(fallbackTask),
                    startingTask: fallbackTask,
                    endingTask: fallbackTask
                }];
            }
        }

        return [];
    }

    private buildBestDrivingChainsToTarget(targetTaskId: string): DrivingChain[] {
        const targetTask = this.taskIdToTask.get(targetTaskId);
        if (!targetTask) {
            return [];
        }

        const ancestorIds = this.collectDrivingAncestors(targetTaskId);
        const chains = this.buildBestDrivingChains(ancestorIds, [targetTaskId]);
        if (chains.length > 0) {
            return chains;
        }

        return [{
            tasks: new Set([targetTaskId]),
            relationships: [],
            totalDuration: this.getTaskScheduleSpanDays(targetTask),
            startingTask: targetTask,
            endingTask: targetTask
        }];
    }

    private buildBestDrivingChainsFromSource(sourceTaskId: string): DrivingChain[] {
        const sourceTask = this.taskIdToTask.get(sourceTaskId);
        if (!sourceTask) {
            return [];
        }

        const descendantIds = this.collectDrivingDescendants(sourceTaskId);
        const terminalTaskIds = this.getDrivingTerminalTaskIds(descendantIds);
        const sinkTaskIds = getTiedLatestFinishTaskIds(
            this.taskIdToTask,
            terminalTaskIds.length > 0 ? terminalTaskIds : descendantIds,
            this.floatTolerance
        );
        const chains = this.buildBestDrivingChains(descendantIds, sinkTaskIds, [sourceTaskId]);
        if (chains.length > 0) {
            return chains;
        }

        return [{
            tasks: new Set([sourceTaskId]),
            relationships: [],
            totalDuration: this.getTaskScheduleSpanDays(sourceTask),
            startingTask: sourceTask,
            endingTask: sourceTask
        }];
    }

    private sortAndStoreDrivingChains(chains: DrivingChain[]): DrivingChain[] {
        if (chains.length === 0) return [];

        const sortedChains = [...chains].sort((a, b) => {
            const aDate = a.startingTask?.startDate?.getTime() ?? Infinity;
            const bDate = b.startingTask?.startDate?.getTime() ?? Infinity;

            if (aDate < bDate) return -1;
            if (aDate > bDate) return 1;

            if (a.totalDuration !== b.totalDuration) {
                return b.totalDuration - a.totalDuration;
            }

            const endCompare = (a.endingTask?.internalId ?? "").localeCompare(b.endingTask?.internalId ?? "");
            if (endCompare !== 0) {
                return endCompare;
            }

            return (a.startingTask?.internalId ?? "").localeCompare(b.startingTask?.internalId ?? "");
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

    private sortForwardDrivingChains(chains: DrivingChain[]): DrivingChain[] {
        if (chains.length === 0) {
            return [];
        }

        return [...chains].sort((a, b) => {
            const aEndDate = a.endingTask?.finishDate?.getTime() ?? -Infinity;
            const bEndDate = b.endingTask?.finishDate?.getTime() ?? -Infinity;

            if (aEndDate !== bEndDate) {
                return bEndDate - aEndDate;
            }

            if (a.totalDuration !== b.totalDuration) {
                return b.totalDuration - a.totalDuration;
            }

            return (a.endingTask?.internalId ?? "").localeCompare(b.endingTask?.internalId ?? "");
        });
    }

    /**
     * Gets the currently selected driving chain based on settings
     * Validates index bounds to prevent errors when switching views
     */
    private getSelectedDrivingChain(): DrivingChain | null {
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
    private updatePathInfoLabel(viewportWidth?: number): void {
        if (!this.pathInfoLabel) return;

        const hasMultiplePaths = this.allDrivingChains.length > 1;

        if (!this.shouldShowPathInfoChip()) {
            this.pathInfoLabel.style("display", "none");
            return;
        }

        const currentChain = this.allDrivingChains[this.selectedPathIndex];
        if (!currentChain) {
            this.pathInfoLabel.style("display", "none");
            return;
        }

        // Use provided viewportWidth, falling back to lastUpdateOptions or default
        const effectiveWidth = viewportWidth ?? this.lastUpdateOptions?.viewport?.width ?? 800;
        const maxChipWidth = this.getPathInfoChipMaxWidth(effectiveWidth);
        const isTight = maxChipWidth <= 150;
        const showTaskCount = maxChipWidth >= 170;
        const showDuration = maxChipWidth >= 228;
        const navButtonSize = isTight ? 18 : 20;
        const navIconSize = isTight ? 10 : 12;
        const chipPaddingX = isTight ? 4 : 5;
        const chipGap = isTight ? 3 : 4;
        const infoGap = isTight ? 3 : 4;
        const infoPaddingX = isTight ? 1 : 2;

        this.pathInfoLabel
            .style("padding", `0 ${chipPaddingX}px`)
            .style("gap", `${chipGap}px`)
            .style("max-width", `${maxChipWidth}px`)
            .style("min-width", "0")
            .style("overflow", "hidden")
            .style("box-sizing", "border-box")
            .style("background-color", this.highContrastMode ? this.highContrastBackground : HEADER_DOCK_TOKENS.chipBg)
            .style("border", `1px solid ${this.highContrastMode ? this.highContrastForeground : HEADER_DOCK_TOKENS.primary}`)
            .style("color", this.highContrastMode ? this.highContrastForeground : HEADER_DOCK_TOKENS.chipText)
            .attr(
                "title",
                this.drivingPathsTruncationMessage
                    ? `Current Path Information: Path Number | Total Tasks | Total Duration | ${this.drivingPathsTruncationMessage}`
                    : "Current Path Information: Path Number | Total Tasks | Total Duration"
            );

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
            .style("padding", "2px")
            .style("border-radius", `${UI_TOKENS.radius.small}px`)
            .style("display", "flex")
            .style("flex", "0 0 auto")
            .style("align-items", "center")
            .style("justify-content", "center")
            .style("transition", `all ${UI_TOKENS.motion.duration.fast}ms ${UI_TOKENS.motion.easing.smooth}`)
            .style("user-select", "none")
            .style("box-sizing", "border-box")
            .style("width", `${navButtonSize}px`)
            .style("height", `${navButtonSize}px`)
            .attr("title", buttonTitle);

        const prevSvg = prevButton.append("svg")
            .attr("width", `${navIconSize}`)
            .attr("height", `${navIconSize}`)
            .attr("viewBox", "0 0 12 12");

        prevSvg.append("path")
            .attr("d", "M 8 2 L 4 6 L 8 10")
            .attr("stroke", HEADER_DOCK_TOKENS.chipMuted)
            .attr("stroke-width", "2")
            .attr("stroke-linecap", "round")
            .attr("stroke-linejoin", "round")
            .attr("fill", "none");

        const self = this;

        if (hasMultiplePaths) {
            prevButton
                .attr("role", "button")
                .attr("tabindex", "0")
                .attr("aria-label", buttonTitle)
                .on("mouseover", function () {
                    d3.select(this)
                        .style("background-color", HEADER_DOCK_TOKENS.menuHover)
                        .style("transform", "scale(1.1)");
                    d3.select(this).select("path")
                        .attr("stroke", HEADER_DOCK_TOKENS.buttonText);
                })
                .on("mouseout", function () {
                    d3.select(this)
                        .style("background-color", "transparent")
                        .style("transform", "scale(1)");
                    d3.select(this).select("path")
                        .attr("stroke", HEADER_DOCK_TOKENS.chipMuted);
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

            prevButton.on("keydown", function (event: KeyboardEvent) {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    self.navigateToPreviousPath();
                }
            });
        }

        const infoContainer = this.pathInfoLabel.append("div")
            .style("display", "flex")
            .style("flex", "1 1 auto")
            .style("align-items", "center")
            .style("gap", `${infoGap}px`)
            .style("padding", `0 ${infoPaddingX}px`)
            .style("font-size", `${UI_TOKENS.fontSize.sm}px`)
            .style("min-width", "0")
            .style("overflow", "hidden")
            .style("white-space", "nowrap");

        infoContainer.append("span")
            .style("font-weight", "700")
            .style("letter-spacing", "0")
            .style("color", HEADER_DOCK_TOKENS.chipText)
            .text(isTight ? `${pathNumber}/${totalPaths}` : `Path ${pathNumber}/${totalPaths}`)
            .attr("aria-label", `Currently viewing path ${pathNumber} of ${totalPaths}`);

        if (showTaskCount) {
            infoContainer.append("span")
                .style("color", HEADER_DOCK_TOKENS.primary)
                .style("font-weight", "600")
                .attr("aria-hidden", "true")
                .text("|");

            infoContainer.append("span")
                .style("font-weight", "500")
                .style("color", HEADER_DOCK_TOKENS.chipText)
                .attr("aria-label", `${taskCount} tasks in this path`)
                .text(`${taskCount} tasks`);

            if (showDuration) {
                infoContainer.append("span")
                    .style("color", HEADER_DOCK_TOKENS.primary)
                    .style("font-weight", "600")
                    .attr("aria-hidden", "true")
                    .text("|");

                infoContainer.append("span")
                    .style("font-weight", "500")
                    .style("color", HEADER_DOCK_TOKENS.chipText)
                    .attr("aria-label", `Total duration ${duration} days`)
                    .text(`${duration}d`);
            }
        }

        const nextButtonTitle = hasMultiplePaths ? "Next driving path" : "Only one driving path";
        const nextButton = this.pathInfoLabel.append("div")
            .style("cursor", buttonCursor)
            .style("opacity", buttonOpacity)
            .style("padding", "2px")
            .style("border-radius", `${UI_TOKENS.radius.small}px`)
            .style("display", "flex")
            .style("flex", "0 0 auto")
            .style("align-items", "center")
            .style("justify-content", "center")
            .style("transition", `all ${UI_TOKENS.motion.duration.fast}ms ${UI_TOKENS.motion.easing.smooth}`)
            .style("user-select", "none")
            .style("box-sizing", "border-box")
            .style("width", `${navButtonSize}px`)
            .style("height", `${navButtonSize}px`)
            .attr("title", nextButtonTitle);

        const nextSvg = nextButton.append("svg")
            .attr("width", `${navIconSize}`)
            .attr("height", `${navIconSize}`)
            .attr("viewBox", "0 0 12 12");

        nextSvg.append("path")
            .attr("d", "M 4 2 L 8 6 L 4 10")
            .attr("stroke", HEADER_DOCK_TOKENS.chipMuted)
            .attr("stroke-width", "2")
            .attr("stroke-linecap", "round")
            .attr("stroke-linejoin", "round")
            .attr("fill", "none");

        if (hasMultiplePaths) {
            nextButton
                .attr("role", "button")
                .attr("tabindex", "0")
                .attr("aria-label", nextButtonTitle)
                .on("mouseover", function () {
                    d3.select(this)
                        .style("background-color", HEADER_DOCK_TOKENS.menuHover)
                        .style("transform", "scale(1.1)");
                    d3.select(this).select("path")
                        .attr("stroke", HEADER_DOCK_TOKENS.buttonText);
                })
                .on("mouseout", function () {
                    d3.select(this)
                        .style("background-color", "transparent")
                        .style("transform", "scale(1)");
                    d3.select(this).select("path")
                        .attr("stroke", HEADER_DOCK_TOKENS.chipMuted);
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

            nextButton.on("keydown", function (event: KeyboardEvent) {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    self.navigateToNextPath();
                }
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
                .style("color", UI_TOKENS.color.warning?.default || "#C87800")
                .style("font-weight", "500")
                .style("font-size", `${UI_TOKENS.fontSize.sm}px`)
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

        if (!this.isCpmSafe()) {
            this.clearCriticalPathState();
            this.updatePathInfoLabel();
            return;
        }

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

        this.clearCriticalPathState();

        this.identifyDrivingRelationships();

        const chains = this.buildBestDrivingChainsToTarget(targetTaskId);
        this.allDrivingChains = this.sortAndStoreDrivingChains(chains);

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

        if (!this.isCpmSafe()) {
            this.clearCriticalPathState();
            this.updatePathInfoLabel();
            return;
        }

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

        this.clearCriticalPathState();

        this.identifyDrivingRelationships();
        this.allDrivingChains = this.sortForwardDrivingChains(
            this.buildBestDrivingChainsFromSource(sourceTaskId)
        );

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


    /**
     * WBS GROUPING: Processes WBS data and builds hierarchical group structure
     * Builds the WBS hierarchy from task WBS level fields and calculates summary metrics
     */


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

        // Cycle logic: if at the end, go back to start
        if (idx === sequence.length - 1) {
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

        // Cycle logic: if at the start, go to end (expand all)
        if (idx === 0) {
            return sequence[sequence.length - 1];
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
            cancelAnimationFrame(this.scrollThrottleTimeout);
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
                    .sort((a, b) => {
                        const aStart = this.getVisualStart(a)?.getTime() ?? 0;
                        const bStart = this.getVisualStart(b)?.getTime() ?? 0;
                        return aStart - bStart;
                    });

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
            .sort((a, b) => {
                const aStart = this.getVisualStart(a)?.getTime() ?? 0;
                const bStart = this.getVisualStart(b)?.getTime() ?? 0;
                return aStart - bStart;
            });

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
            group.summaryEarlyStartDate = null;
            group.summaryEarlyFinishDate = null;
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
            group.summaryTotalFloat = null;
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
            let minEarlyStart: Date | null = null;
            let maxEarlyFinish: Date | null = null;
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
            let minTotalFloat: number | null = null;

            for (const task of group.tasks) {

                if (!filteredTaskIds.has(task.internalId)) continue;

                const visualStart = this.getVisualStart(task);
                const visualFinish = this.getVisualFinish(task);

                // Filter out invalid or extremely old dates (likely placeholders)
                const isValidStart = visualStart && visualStart.getFullYear() > 1980;
                const isValidFinish = visualFinish && visualFinish.getFullYear() > 1980;

                if (isValidStart && (!minStart || visualStart! < minStart)) {
                    minStart = visualStart;
                }
                if (isValidFinish && (!maxFinish || visualFinish! > maxFinish)) {
                    maxFinish = visualFinish;
                }

                // Track Early Start / Early Finish (task.startDate/finishDate) for duration calc
                const earlyStart = task.startDate;
                const earlyFinish = task.finishDate;
                if (earlyStart && earlyStart.getFullYear() > 1980 && (!minEarlyStart || earlyStart < minEarlyStart)) {
                    minEarlyStart = earlyStart;
                }
                if (earlyFinish && earlyFinish.getFullYear() > 1980 && (!maxEarlyFinish || earlyFinish > maxEarlyFinish)) {
                    maxEarlyFinish = earlyFinish;
                }

                if (task.isCritical) {
                    hasCritical = true;
                    if (visualStart && (!criticalMinStart || visualStart < criticalMinStart)) {
                        criticalMinStart = visualStart;
                    }
                    if (visualFinish && (!criticalMaxFinish || visualFinish > criticalMaxFinish)) {
                        criticalMaxFinish = visualFinish;
                    }
                }

                if (task.isNearCritical) {
                    hasNearCritical = true;
                    if (visualStart && (!nearCriticalMinStart || visualStart < nearCriticalMinStart)) {
                        nearCriticalMinStart = visualStart;
                    }
                    if (visualFinish && (!nearCriticalMaxFinish || visualFinish > nearCriticalMaxFinish)) {
                        nearCriticalMaxFinish = visualFinish;
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

                const taskFloat = task.userProvidedTotalFloat ?? task.totalFloat;
                if (isFinite(taskFloat)) {
                    minTotalFloat = minTotalFloat === null
                        ? taskFloat
                        : Math.min(minTotalFloat, taskFloat);
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
                if (child.summaryEarlyStartDate && (!minEarlyStart || child.summaryEarlyStartDate < minEarlyStart)) {
                    minEarlyStart = child.summaryEarlyStartDate;
                }
                if (child.summaryEarlyFinishDate && (!maxEarlyFinish || child.summaryEarlyFinishDate > maxEarlyFinish)) {
                    maxEarlyFinish = child.summaryEarlyFinishDate;
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

                if (typeof child.summaryTotalFloat === "number" && isFinite(child.summaryTotalFloat)) {
                    minTotalFloat = minTotalFloat === null
                        ? child.summaryTotalFloat
                        : Math.min(minTotalFloat, child.summaryTotalFloat);
                }
            }

            group.summaryStartDate = minStart;
            group.summaryFinishDate = maxFinish;
            group.summaryEarlyStartDate = minEarlyStart;
            group.summaryEarlyFinishDate = maxEarlyFinish;
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
            group.summaryTotalFloat = minTotalFloat;
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
                    .sort((a, b) => {
                        const aStart = this.getVisualStart(a)?.getTime() ?? 0;
                        const bStart = this.getVisualStart(b)?.getTime() ?? 0;
                        return aStart - bStart;
                    });

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
            .sort((a, b) => {
                const aStart = this.getVisualStart(a)?.getTime() ?? 0;
                const bStart = this.getVisualStart(b)?.getTime() ?? 0;
                return aStart - bStart;
            });

        for (const task of tasksWithoutWbs) {
            task.yOrder = currentYOrder++;
        }

        this.debugLog(`Assigned yOrder to ${currentYOrder} items (groups + tasks)`);
    }

    /**
     * WBS GROUPING: Draw WBS group headers in SVG mode
     * Renders group headers with expand/collapse controls and optional summary bars
     * Refactored to use D3 data binding to prevent DOM thrashing during drag.
     */
    private drawWbsGroupHeaders(
        xScale: ScaleTime<number, number>,
        yScale: ScaleBand<string>,
        chartWidth: number,
        taskHeight: number,
        currentLeftMargin: number,
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
        // const currentLeftMargin = this.getEffectiveLeftMargin(); // Use passed argument!
        const taskNameFontSize = this.settings.textAndLabels.taskNameFontSize.value;

        const groupNameFontSizeSetting = this.settings.wbsGrouping.groupNameFontSize?.value ?? 0;
        const groupNameFontSizePt = groupNameFontSizeSetting > 0 ? groupNameFontSizeSetting : taskNameFontSize + 1;
        const groupNameFontSizePx = this.pointsToCssPx(groupNameFontSizePt);
        const defaultGroupNameColor = this.settings.wbsGrouping.groupNameColor?.value?.value ?? "#333333";
        const criticalPathColor = this.resolveColor(this.settings.criticalPath.criticalPathColor.value.value, "foreground");
        const mode = this.settings?.criticalPath?.calculationMode?.value?.value || 'floatBased';
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

        // 1. Prepare Data
        const visibleGroups = this.wbsGroups.filter(group => {
            if (group.yOrder === undefined) return false;
            if (viewportStartIndex !== undefined && viewportEndIndex !== undefined) {
                if (group.yOrder < viewportStartIndex || group.yOrder > viewportEndIndex) return false;
            }
            const domainKey = group.yOrder.toString();
            const bandStart = yScale(domainKey);
            return bandStart !== undefined;
        });

        // 2. Bind Data
        const groupsSel = this.wbsGroupLayer
            .selectAll<SVGGElement, WBSGroup>('.wbs-group-header')
            .data(visibleGroups, (d) => d.id);

        // 3. Exit
        groupsSel.exit().remove();

        // 4. Enter
        const groupsEnter = groupsSel.enter()
            .append('g')
            .attr('class', 'wbs-group-header')
            .style('cursor', 'pointer');

        const chromeEnter = groupsEnter.append('g').attr('class', 'wbs-group-chrome');
        chromeEnter.append('rect').attr('class', 'wbs-header-bg');
        chromeEnter.append('rect').attr('class', 'wbs-level-accent');
        chromeEnter.append('line').attr('class', 'wbs-row-divider');

        const toggleEnter = groupsEnter.append('g').attr('class', 'wbs-expand-toggle');
        toggleEnter.append('rect').attr('class', 'wbs-expand-button');
        toggleEnter.append('path').attr('class', 'wbs-expand-chevron');

        groupsEnter.append('g').attr('class', 'wbs-summary-bars').attr('clip-path', this.getScopedUrlRef("chart-area-clip"));
        groupsEnter.append('text')
            .attr('class', 'wbs-group-name')
            .attr('text-anchor', 'start')
            .style('font-weight', '600');
        const badgeEnter = groupsEnter.append('g').attr('class', 'wbs-count-badge');
        badgeEnter.append('rect').attr('class', 'wbs-count-badge-bg');
        badgeEnter.append('text').attr('class', 'wbs-count-badge-text');

        const groupsUpdate = groupsEnter.merge(groupsSel);

        groupsUpdate.attr('data-group-id', d => d.id);

        const self = this;
        const taskPadding = self.settings.layoutSettings.taskPadding.value;
        const rowBorderColor = self.resolveColor("#DEE3EA", "foreground");
        const buttonFillColor = self.resolveColor("#FFFFFF", "background");
        const buttonStrokeColor = self.resolveColor("#CDD4DE", "foreground");
        const badgeFillColor = self.resolveColor("#FFFFFF", "background");
        const badgeTextColor = self.resolveColor("#4F5967", "foreground");
        const mutedTextColor = self.resolveColor("#8A919D", "foreground");
        const defaultGroupBg = self.resolveColor(defaultGroupHeaderColor, "background");

        groupsUpdate.each(function (group) {
            const g = d3.select(this);
            const domainKey = group.yOrder!.toString();
            const bandStart = yScale(domainKey)!;
            const bandCenter = Math.round(bandStart + taskHeight / 2);

            const rawIndent = Math.max(0, (group.level - 1) * indentPerLevel);
            const levelStyle = self.getWbsLevelStyle(group.level, defaultGroupHeaderColor, defaultGroupNameColor);
            const accentColor = self.resolveColor(levelStyle.background, "foreground");
            const groupNameColor = self.resolveColor(levelStyle.text, "foreground");
            const summaryFillColor = self.blendColors(groupSummaryColor, accentColor, 0.82);
            const summaryStrokeColor = self.toRgba(self.getSoftOutlineColor(summaryFillColor), group.isExpanded ? 0.45 : 0.85);
            const summaryCapColor = self.getSoftOutlineColor(summaryFillColor);
            const bgOpacity = (group.visibleTaskCount === 0) ? 0.68 : 1;
            const columnTextColor = (group.visibleTaskCount === 0)
                ? mutedTextColor
                : self.resolveColor("#4F5967", "foreground");

            const bgInsetTop = 1;
            const bgHeight = Math.max(1, taskHeight + taskPadding - 2 - bgInsetTop);
            const bgY = bandStart + bgInsetTop;
            const bgX = -currentLeftMargin + 1;
            const bgWidth = Math.max(1, currentLeftMargin - 2);

            g.select<SVGRectElement>('.wbs-header-bg')
                .attr('x', bgX)
                .attr('y', Math.round(bgY))
                .attr('width', bgWidth)
                .attr('height', bgHeight)
                .attr('rx', 2)
                .attr('ry', 2)
                .style('fill', defaultGroupBg)
                .style('stroke', rowBorderColor)
                .style('stroke-width', 1)
                .style('opacity', bgOpacity);

            g.select<SVGLineElement>('.wbs-row-divider')
                .attr('x1', bgX)
                .attr('x2', 0)
                .attr('y1', Math.round(bgY + bgHeight))
                .attr('y2', Math.round(bgY + bgHeight))
                .style('stroke', rowBorderColor)
                .style('stroke-width', 1)
                .style('opacity', 0.7);

            const barsGroup = g.select('.wbs-summary-bars');
            barsGroup.selectAll('*').remove();

            if (showGroupSummary && group.taskCount > 0 && group.summaryStartDate && group.summaryFinishDate) {
                const isCollapsed = !group.isExpanded;
                const startX = Math.round(xScale(group.summaryStartDate));
                const finishX = Math.round(xScale(group.summaryFinishDate));
                const barWidth = Math.round(Math.max(2, finishX - startX));
                const barHeight = Math.max(3, taskHeight * (isCollapsed ? 0.52 : 0.28));
                const barY = Math.round(bandCenter - barHeight / 2);
                const barRadius = Math.min(5, Math.max(2, barHeight / 2));

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

                const enableOverride = self.settings.dataDateColorOverride.enableP6Style.value;
                const dataDate = self.dataDate;
                const overrideColor = self.settings.dataDateColorOverride.beforeDataDateColor.value.value;
                barsGroup.append('rect')
                    .attr('class', 'wbs-summary-bar')
                    .attr('x', startX).attr('y', barY).attr('width', barWidth).attr('height', barHeight)
                    .attr('rx', barRadius).attr('ry', barRadius)
                    .style('fill', summaryFillColor).style('opacity', barOpacity)
                    .style('stroke', summaryStrokeColor).style('stroke-width', isCollapsed ? 0.8 : 0.45);

                const summaryOverlay = self.getBeforeDataDateOverlay(
                    group.summaryStartDate,
                    group.summaryFinishDate,
                    startX,
                    finishX,
                    barRadius
                );

                if (summaryOverlay) {
                    barsGroup.append('path')
                        .attr('class', 'wbs-summary-bar-before-data-date')
                        .attr('d', self.getRoundedRectPath(summaryOverlay.x, barY, summaryOverlay.width, barHeight, summaryOverlay.corners))
                        .style('fill', overrideColor)
                        .style('opacity', barOpacity);

                    if (summaryOverlay.dividerX !== null && summaryOverlay.dividerX > startX + 1 && summaryOverlay.dividerX < finishX - 1) {
                        barsGroup.append('line')
                            .attr('class', 'wbs-summary-bar-divider')
                            .attr('x1', summaryOverlay.dividerX)
                            .attr('x2', summaryOverlay.dividerX)
                            .attr('y1', barY + 1)
                            .attr('y2', barY + barHeight - 1)
                            .style('stroke', self.toRgba(self.getSoftOutlineColor(overrideColor), 0.6))
                            .style('stroke-width', 1)
                            .style('opacity', barOpacity);
                    }
                }

                if (barWidth > 6) {
                    const capRadius = Math.min(3, Math.max(1.5, barHeight / 3));
                    const capOpacity = isCollapsed ? barOpacity : Math.min(0.35, barOpacity + 0.1);
                    const diamondSize = Math.max(5, Math.min(8, barHeight + 2));
                    barsGroup.append('circle').attr('class', 'wbs-summary-cap-start')
                        .attr('cx', startX).attr('cy', barY + barHeight / 2).attr('r', capRadius)
                        .style('fill', summaryCapColor).style('opacity', capOpacity);
                    barsGroup.append('path').attr('class', 'wbs-summary-cap-end')
                        .attr('d', `M 0,-${diamondSize / 2} L ${diamondSize / 2},0 L 0,${diamondSize / 2} L -${diamondSize / 2},0 Z`)
                        .attr('transform', `translate(${finishX}, ${barY + barHeight / 2})`)
                        .style('fill', summaryCapColor).style('opacity', capOpacity);
                }

                // Near Critical
                if (showNearCriticalSummary && group.hasNearCriticalTasks && group.nearCriticalStartDate && group.nearCriticalFinishDate) {
                    let effectiveNearStart = group.nearCriticalStartDate;
                    if (enableOverride && dataDate && effectiveNearStart < dataDate) effectiveNearStart = dataDate;

                    const clampedNearStartDate = group.summaryStartDate ? new Date(Math.max(effectiveNearStart.getTime(), group.summaryStartDate.getTime())) : effectiveNearStart;
                    const clampedNearFinishDate = group.summaryFinishDate ? new Date(Math.min(group.nearCriticalFinishDate.getTime(), group.summaryFinishDate.getTime())) : group.nearCriticalFinishDate;

                    if (clampedNearStartDate <= clampedNearFinishDate) {
                        const nearStartX = xScale(clampedNearStartDate);
                        const nearFinishX = xScale(clampedNearFinishDate);
                        const nearWidth = Math.max(2, nearFinishX - nearStartX);
                        const nearStartsAtBeginning = nearStartX <= startX + 1;
                        const nearEndsAtEnd = nearFinishX >= finishX - 1;
                        const forceSquareStart = enableOverride && dataDate && effectiveNearStart.getTime() === dataDate.getTime();

                        barsGroup.append('rect').attr('class', 'wbs-summary-bar-near-critical')
                            .attr('x', nearStartX).attr('y', barY).attr('width', nearWidth).attr('height', barHeight)
                            .attr('rx', (nearStartsAtBeginning && !forceSquareStart) || nearEndsAtEnd ? barRadius : 0)
                            .attr('ry', (nearStartsAtBeginning && !forceSquareStart) || nearEndsAtEnd ? barRadius : 0)
                            .style('fill', nearCriticalColor).style('opacity', barOpacity);
                    }
                }

                // Critical
                if (group.hasCriticalTasks && group.criticalStartDate && group.criticalFinishDate) {
                    let effectiveCriticalStart = group.criticalStartDate;
                    if (enableOverride && dataDate && effectiveCriticalStart < dataDate) effectiveCriticalStart = dataDate;

                    const criticalStartX = xScale(effectiveCriticalStart);
                    const criticalFinishX = xScale(group.criticalFinishDate);
                    if (criticalFinishX > criticalStartX) {
                        const criticalWidth = Math.max(2, criticalFinishX - criticalStartX);
                        const criticalStartsAtBeginning = criticalStartX <= startX + 1;
                        const criticalEndsAtEnd = criticalFinishX >= finishX - 1;
                        const forceSquareStart = enableOverride && dataDate && effectiveCriticalStart.getTime() === dataDate.getTime();

                        barsGroup.append('rect').attr('class', 'wbs-summary-bar-critical')
                            .attr('x', criticalStartX).attr('y', barY).attr('width', criticalWidth).attr('height', barHeight)
                            .attr('rx', (criticalStartsAtBeginning && !forceSquareStart) || criticalEndsAtEnd ? barRadius : 0)
                            .attr('ry', (criticalStartsAtBeginning && !forceSquareStart) || criticalEndsAtEnd ? barRadius : 0)
                            .style('fill', criticalPathColor).style('opacity', barOpacity);
                    }
                }
            }

            const cols = self.settings.columns;
            const showExtra = self.showExtraColumnsInternal;
            const labelLayout = self.getLabelColumnLayout(currentLeftMargin);
            const showStart = showExtra && cols.showStartDate.value;
            const startWidth = cols.startDateWidth.value;
            const showFinish = showExtra && cols.showFinishDate.value;
            const finishWidth = cols.finishDateWidth.value;
            const showDur = showExtra && cols.showDuration.value;
            const durWidth = cols.durationWidth.value;
            const showFloat = showExtra && cols.showTotalFloat.value;
            const floatWidth = cols.totalFloatWidth.value;

            let occupiedWidth = 0;
            const columnPadding = 20;
            occupiedWidth += columnPadding;

            const floatOffset = showFloat ? occupiedWidth : 0;
            if (showFloat) { occupiedWidth += floatWidth; }
            const durOffset = showDur ? occupiedWidth : 0;
            if (showDur) { occupiedWidth += durWidth; }

            const finishOffset = showFinish ? occupiedWidth : 0;
            if (showFinish) { occupiedWidth += finishWidth; }
            const startOffset = showStart ? occupiedWidth : 0;
            if (showStart) { occupiedWidth += startWidth; }

            let prevFinishOffset = 0;
            let prevStartOffset = 0;
            let baseFinishOffset = 0;
            let baseStartOffset = 0;

            if (showExtra && showPreviousUpdate) {
                prevFinishOffset = occupiedWidth; occupiedWidth += cols.previousUpdateFinishDateWidth.value;
                prevStartOffset = occupiedWidth; occupiedWidth += cols.previousUpdateStartDateWidth.value;
            }

            if (showExtra && showBaseline) {
                baseFinishOffset = occupiedWidth; occupiedWidth += cols.baselineFinishDateWidth.value;
                baseStartOffset = occupiedWidth; occupiedWidth += cols.baselineStartDateWidth.value;
            }

            g.selectAll('.wbs-summary-date, .wbs-summary-value').remove();

            const dateFontSize = Math.max(7, Math.round(groupNameFontSizePx * 0.88 * 100) / 100);
            const textColor = (group.visibleTaskCount === 0) ? mutedTextColor : groupNameColor;
            const textOpacity = (group.visibleTaskCount === 0) ? 0.7 : 1.0;

            const drawColumnValue = (
                className: string,
                value: string,
                offset: number,
                width: number,
                fill: string = columnTextColor
            ) => {
                if (!value) return;
                g.append('text').attr('class', `wbs-summary-value ${className}`)
                    .attr('x', Math.round(-offset - width / 2)).attr('y', Math.round(bandCenter))
                    .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
                    .style('font-size', `${dateFontSize}px`).style('font-family', self.getFontFamily())
                    .style('font-weight', '500')
                    .style('fill', fill).style('opacity', textOpacity)
                    .text(value);
            };

            const drawColumnDate = (dateVal: Date | undefined | null, offset: number, width: number) => {
                if (!dateVal) return;
                drawColumnValue('wbs-summary-date', self.formatColumnDate(dateVal), offset, width, columnTextColor);
            };

            if (showStart) drawColumnDate(group.summaryStartDate, startOffset, startWidth);
            if (showFinish) drawColumnDate(group.summaryFinishDate, finishOffset, finishWidth);
            if (showDur) {
                let durValue = "";
                if (group.summaryEarlyStartDate && group.summaryEarlyFinishDate && group.summaryEarlyFinishDate >= group.summaryEarlyStartDate) {
                    let workingDays = 0;
                    const cur = new Date(group.summaryEarlyStartDate);
                    cur.setHours(0, 0, 0, 0);
                    const end = new Date(group.summaryEarlyFinishDate);
                    end.setHours(0, 0, 0, 0);
                    
                    while (cur < end) {
                        const day = cur.getDay();
                        if (day !== 0 && day !== 6) { // Skip Sunday (0) and Saturday (6)
                            workingDays++;
                        }
                        cur.setDate(cur.getDate() + 1);
                    }
                    if (workingDays > 0) durValue = workingDays.toString();
                }
                drawColumnValue('wbs-summary-duration', durValue, durOffset, durWidth, columnTextColor);
            }
            if (showFloat) {
                const floatValue = typeof group.summaryTotalFloat === "number" && isFinite(group.summaryTotalFloat)
                    ? group.summaryTotalFloat.toFixed(0)
                    : "";
                drawColumnValue(
                    'wbs-summary-float',
                    floatValue,
                    floatOffset,
                    floatWidth,
                    self.getFloatDisplayColor(group.summaryTotalFloat, columnTextColor)
                );
            }
            if (showExtra && showPreviousUpdate) {
                drawColumnDate(group.summaryPreviousUpdateFinishDate, prevFinishOffset, cols.previousUpdateFinishDateWidth.value);
                drawColumnDate(group.summaryPreviousUpdateStartDate, prevStartOffset, cols.previousUpdateStartDateWidth.value);
            }
            if (showExtra && showBaseline) {
                drawColumnDate(group.summaryBaselineFinishDate, baseFinishOffset, cols.baselineFinishDateWidth.value);
                drawColumnDate(group.summaryBaselineStartDate, baseStartOffset, cols.baselineStartDateWidth.value);
            }

            const countText = self.getWbsCountLabel(group);
            const badgeGroup = g.select<SVGGElement>('.wbs-count-badge');
            const badgeFontSize = Math.max(8, Math.round(groupNameFontSizePx * 0.74 * 100) / 100);
            const badgeHeight = Math.max(16, Math.round(groupNameFontSizePx * 1.25));
            const badgeWidth = countText
                ? Math.max(40, Math.round(countText.length * badgeFontSize * 0.62 + 16))
                : 0;
            const taskCellLeftX = bgX + 8;
            const taskCellRightX = (labelLayout.taskNameDividerX - currentLeftMargin) - 4;
            const minimumNameLaneWidth = 42;
            const minimumTreeLaneWidth = self.WBS_TOGGLE_BOX_SIZE + minimumNameLaneWidth + 14;
            const maxBadgeReservedWidth = countText ? badgeWidth + 6 : 0;
            const availableTaskCellWidth = Math.max(0, taskCellRightX - taskCellLeftX);
            const effectiveIndent = Math.min(
                rawIndent,
                Math.max(0, availableTaskCellWidth - minimumTreeLaneWidth - maxBadgeReservedWidth)
            );
            const accentX = Math.min(
                taskCellRightX - self.WBS_LEVEL_ACCENT_WIDTH - 6,
                taskCellLeftX + effectiveIndent
            );
            const displayedAccentX = Math.max(taskCellLeftX, accentX);
            const toggleBaseX = displayedAccentX + self.WBS_LEVEL_ACCENT_WIDTH + 6;
            const nameStartWithoutBadge = toggleBaseX + self.WBS_TOGGLE_BOX_SIZE + 8;
            const canShowBadge = !!countText && (taskCellRightX - badgeWidth - 6 - nameStartWithoutBadge) >= minimumNameLaneWidth;
            const visibleBadgeWidth = canShowBadge ? badgeWidth : 0;
            const nameRightX = canShowBadge ? (taskCellRightX - visibleBadgeWidth - 6) : taskCellRightX;
            const hasRoomForToggle = (nameRightX - taskCellLeftX) >= (self.WBS_TOGGLE_BOX_SIZE + 4);
            const minToggleX = taskCellLeftX + 2;
            const maxToggleX = Math.max(minToggleX, nameRightX - self.WBS_TOGGLE_BOX_SIZE - 4);
            const toggleX = Math.max(minToggleX, Math.min(toggleBaseX, maxToggleX));
            const toggleY = Math.round(bandCenter - self.WBS_TOGGLE_BOX_SIZE / 2);
            const toggleGroup = g.select<SVGGElement>('.wbs-expand-toggle')
                .style('display', hasRoomForToggle ? null : 'none')
                .attr('transform', `translate(${toggleX}, ${toggleY})`);

            g.select<SVGRectElement>('.wbs-level-accent')
                .attr('x', Math.round(displayedAccentX))
                .attr('y', Math.round(bgY))
                .attr('width', self.WBS_LEVEL_ACCENT_WIDTH)
                .attr('height', bgHeight)
                .attr('rx', 1)
                .attr('ry', 1)
                .style('fill', accentColor)
                .style('opacity', group.visibleTaskCount === 0 ? 0.55 : 0.95);

            toggleGroup.select<SVGRectElement>('.wbs-expand-button')
                .attr('x', 0)
                .attr('y', 0)
                .attr('width', self.WBS_TOGGLE_BOX_SIZE)
                .attr('height', self.WBS_TOGGLE_BOX_SIZE)
                .attr('rx', 4)
                .attr('ry', 4)
                .style('fill', buttonFillColor)
                .style('stroke', buttonStrokeColor)
                .style('stroke-width', 1)
                .style('opacity', group.visibleTaskCount === 0 ? 0.7 : 1);

            toggleGroup.select<SVGPathElement>('.wbs-expand-chevron')
                .attr('d', group.isExpanded ? 'M5 7 L9 11 L13 7' : 'M7 5 L11 9 L7 13')
                .style('fill', 'none')
                .style('stroke', group.visibleTaskCount === 0 ? mutedTextColor : groupNameColor)
                .style('stroke-width', 1.8)
                .style('stroke-linecap', 'round')
                .style('stroke-linejoin', 'round');

            if (!canShowBadge) {
                badgeGroup.style('display', 'none');
            } else {
                const badgeX = taskCellRightX - visibleBadgeWidth;
                const badgeY = Math.round(bandCenter - badgeHeight / 2);
                badgeGroup.style('display', null);
                badgeGroup.select<SVGRectElement>('.wbs-count-badge-bg')
                    .attr('x', badgeX)
                    .attr('y', badgeY)
                    .attr('width', visibleBadgeWidth)
                    .attr('height', badgeHeight)
                    .attr('rx', Math.round(badgeHeight / 2))
                    .attr('ry', Math.round(badgeHeight / 2))
                    .style('fill', badgeFillColor)
                    .style('stroke', buttonStrokeColor)
                    .style('stroke-width', 1)
                    .style('opacity', group.visibleTaskCount === 0 ? 0.75 : 1);

                badgeGroup.select<SVGTextElement>('.wbs-count-badge-text')
                    .attr('x', badgeX + visibleBadgeWidth / 2)
                    .attr('y', Math.round(bandCenter))
                    .attr('text-anchor', 'middle')
                    .attr('dominant-baseline', 'central')
                    .style('font-size', `${badgeFontSize}px`)
                    .style('font-family', self.getFontFamily())
                    .style('font-weight', '600')
                    .style('letter-spacing', '0.1px')
                    .style('fill', badgeTextColor)
                    .style('opacity', group.visibleTaskCount === 0 ? 0.8 : 1)
                    .text(countText);
            }

            const textX = hasRoomForToggle
                ? Math.max(toggleX + self.WBS_TOGGLE_BOX_SIZE + 8, Math.max(taskCellLeftX + 12, displayedAccentX + 12))
                : taskCellLeftX + 4;
            const textY = bandCenter;
            const availableWidth = nameRightX - textX;
            const showGroupName = availableWidth > 20;

            const textElement = g.select<SVGTextElement>('.wbs-group-name');

            if (!showGroupName) {
                textElement.style('display', 'none');
            } else {
                textElement.style('display', null);
                const displayName = self.getWbsDisplayName(group);

                textElement
                    .attr('x', textX)
                    .attr('y', Math.round(textY))
                    .attr('clip-path', null)
                    .attr('dominant-baseline', 'central')
                    .style('font-size', `${groupNameFontSizePx}px`)
                    .style('font-family', self.getFontFamily())
                    .style('fill', textColor)
                    .style('opacity', textOpacity)
                    .style('letter-spacing', '0.1px');

                const maxLines = self.getMaxWrappedLabelLines(
                    availableWidth,
                    bgHeight,
                    groupNameFontSizePx
                );

                self.renderWrappedSvgText(
                    textElement as Selection<SVGTextElement, unknown, null, undefined>,
                    displayName,
                    textX,
                    textY,
                    availableWidth,
                    maxLines,
                    groupNameFontSizePx,
                    'firstLineAtCenter'
                );
            }

            g.on('click', function (event) {
                self.hideTooltip();
                self.toggleWbsGroupExpansion(group.id);
            });
        });
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
        // Format as DD-Mon-YY (e.g., "16-Jun-26") for consistent display
        const day = date.getDate().toString().padStart(2, '0');
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = monthNames[date.getMonth()];
        const year = date.getFullYear().toString().slice(-2);
        return `${day}-${month}-${year}`;
    }

    private formatDate(date: Date | null | undefined): string {
        if (!date || !(date instanceof Date) || isNaN(date.getTime())) return "";
        try {
            // Format as DD-Mon-YY (e.g., "16-Jun-26") for consistent display
            const day = String(date.getDate()).padStart(2, '0');
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const month = monthNames[date.getMonth()];
            const year = String(date.getFullYear()).slice(-2);
            return `${day}-${month}-${year}`;
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

    private displayMessage(message: string): void {
        this.debugLog("Displaying Message:", message);

        this.clearLandingPage();

        const containerNode = this.scrollableContainer?.node();
        if (!containerNode || !this.mainSvg || !this.headerSvg) {
            console.error("Cannot display message, containers or svgs not ready.");
            return;
        }
        this.clearVisual();

        const width = containerNode?.clientWidth || 300;
        const height = containerNode?.clientHeight || Math.max(100, this.target.clientHeight - this.headerHeight);

        this.syncSvgPixelSize(this.mainSvg, width, height);
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
        const secondRowControlTop = this.getSecondRowControlTop(UI_TOKENS.height.compact);
        const searchPlaceholder = this.getLocalizedString("ui.searchPlaceholder", "Search for a task...");

        this.dropdownContainer.style("display", enableTaskSelection ? "block" : "none");
        if (!enableTaskSelection) {
            this.updateSelectedTaskStatusLabel(viewportWidth);
            return;
        }

        this.dropdownContainer
            .style("position", "absolute")
            .style("top", `${secondRowControlTop}px`)
            .style("left", `${secondRowLayout.dropdown.left}px`)
            .style("right", "auto")
            .style("transform", "none")
            .style("z-index", "20");

        // Select existing elements or create new ones
        let inputSelection = this.dropdownContainer.select<HTMLInputElement>("input.task-selection-input");
        if (inputSelection.empty()) {
            inputSelection = this.dropdownContainer.append<HTMLInputElement>("input")
                .attr("class", "task-selection-input");
        }
        this.dropdownInput = inputSelection;

        // Update attributes and styles (idempotent)
        this.dropdownInput
            .attr("type", "text")
            .attr("placeholder", searchPlaceholder)
            .attr("role", "combobox")
            .attr("aria-autocomplete", "list")
            .attr("aria-expanded", "false")
            .attr("aria-controls", this.dropdownListId)
            .attr("aria-haspopup", "listbox")
            .attr("aria-activedescendant", null)
            .attr("aria-label", searchPlaceholder)
            .style("width", `${dropdownWidth}px`)
            .style("height", `${UI_TOKENS.height.compact}px`)
            .style("padding", `0 ${UI_TOKENS.spacing.lg}px`)
            .style("border", `1px solid ${HEADER_DOCK_TOKENS.inputStroke}`)
            .style("border-radius", `${UI_TOKENS.radius.pill}px`)
            .style("font-family", "Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif")
            .style("font-size", this.fontPxFromPtSetting(8.5))
            .style("font-weight", "500")
            .style("color", HEADER_DOCK_TOKENS.chipText)
            .style("background", HEADER_DOCK_TOKENS.inputBg)
            .style("box-sizing", "border-box")
            .style("outline", "none")
            .style("box-shadow", HEADER_DOCK_TOKENS.shadow)
            .style("transition", `all ${UI_TOKENS.motion.duration.normal}ms ${UI_TOKENS.motion.easing.smooth}`);

        this.dropdownInput
            .on("focus", function () {
                d3.select(this)
                    .style("border-color", HEADER_DOCK_TOKENS.inputFocus)
                    .style("border-width", "1px")
                    .style("box-shadow", `0 0 0 2px ${HEADER_DOCK_TOKENS.primaryBg}`);
            })
            .on("blur", function () {
                d3.select(this)
                    .style("border-color", HEADER_DOCK_TOKENS.inputStroke)
                    .style("border-width", "1px")
                    .style("box-shadow", HEADER_DOCK_TOKENS.shadow);
            });

        let listSelection = this.dropdownContainer.select<HTMLDivElement>("div.task-selection-list");
        if (listSelection.empty()) {
            listSelection = this.dropdownContainer.append<HTMLDivElement>("div")
                .attr("class", "task-selection-list");
        }
        this.dropdownList = listSelection;

        this.dropdownList
            .attr("id", this.dropdownListId)
            .attr("role", "listbox")
            .attr("aria-label", this.getLocalizedString("ui.taskListLabel", "Task results"))
            .style("position", "absolute")
            .style("top", "100%")
            .style("left", "0")
            .style("width", `${dropdownWidth}px`)
            .style("max-height", "400px")
            .style("margin-top", "6px")
            .style("overflow-y", "auto")
            .style("background", HEADER_DOCK_TOKENS.menuBg)
            .style("border", `1px solid ${HEADER_DOCK_TOKENS.menuStroke}`)
            .style("border-radius", `${UI_TOKENS.radius.medium}px`)
            .style("box-shadow", HEADER_DOCK_TOKENS.shadow)
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
                self.isDropdownInteracting = true;
                const inputValue = (this as HTMLInputElement).value.trim();
                if (self.dropdownFilterTimeout) {
                    clearTimeout(self.dropdownFilterTimeout);
                }
                self.dropdownFilterTimeout = window.setTimeout(() => {
                    self.renderTaskDropdown(inputValue);
                    self.openDropdown();
                    // Keep interacting flag true a bit longer to survive any update cycles
                    setTimeout(() => {
                        self.isDropdownInteracting = false;
                    }, 300);
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
                        const currentInputValue = self.dropdownInput?.property("value") || "";

                        // If the user cleared the text and left, clear the filter
                        if (currentInputValue === "") {
                            self.closeDropdown(false);
                            if (self.filterKeyword || self.selectedTaskId) {
                                self.applyFilter("");
                            }
                        } else {
                            // User left input with text - apply it as filter
                            // This ensures filter persists when clicking other UI elements
                            self.closeDropdown(false);
                            if (currentInputValue !== self.filterKeyword && !self.selectedTaskId) {
                                self.applyFilter(currentInputValue);
                            }
                        }
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
                    if (self.dropdownActiveIndex >= 0) {
                        self.activateDropdownSelection();
                    } else {
                        const val = (this as HTMLInputElement).value;
                        self.applyFilter(val);
                    }
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

        this.updateSelectedTaskStatusLabel(viewportWidth);
    }

    private normalizeTraceMode(value: unknown): "backward" | "forward" {
        return value === "forward" ? "forward" : "backward";
    }

    /**
     * Creates the trace mode toggle (Backward/Forward) positioned on the second header row.
     */
    private createTraceModeToggle(): void {
        if (!this.stickyHeaderContainer || !this.settings?.pathSelection) return;

        const criticalPathMode = this.settings?.criticalPath?.calculationMode?.value?.value ?? "floatBased";
        const longestPathDisabled = criticalPathMode === "longestPath" && !this.isCpmSafe();

        if (!this.settings.pathSelection.enableTaskSelection.value || longestPathDisabled) {
            this.stickyHeaderContainer.select<HTMLDivElement>(".trace-mode-toggle")
                .style("display", "none");
            return;
        }
        if (!this.selectedTaskId) {
            this.stickyHeaderContainer.select<HTMLDivElement>(".trace-mode-toggle")
                .style("display", "none");
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
        const secondRowControlTop = this.getSecondRowControlTop(UI_TOKENS.height.compact);
        this.traceMode = currentMode;

        let container = this.stickyHeaderContainer.select<HTMLDivElement>(".trace-mode-toggle");
        if (container.empty()) {
            container = this.stickyHeaderContainer.append("div")
                .attr("class", "trace-mode-toggle");
        }

        container.selectAll("*").remove();
        container
            .attr("role", "radiogroup")
            .attr("aria-label", this.getLocalizedString("ui.traceModeLabel", "Trace Mode"))
            .attr("title", this.getLocalizedString("ui.traceModeTooltip", "Select direction to trace dependencies from the selected task"))
            .style("position", "absolute")
            .style("top", `${secondRowControlTop}px`)
            .style("left", `${secondRowLayout.traceModeToggle.left}px`)
            .style("width", `${secondRowLayout.traceModeToggle.width}px`)
            .style("display", "inline-flex")
            .style("align-items", "center")
            .style("height", `${UI_TOKENS.height.compact}px`) // 24px
            .style("padding", "0 2px")
            .style("gap", "2px")
            .style("background-color", HEADER_DOCK_TOKENS.chipBg)
            .style("border", `1px solid ${HEADER_DOCK_TOKENS.chipStroke}`)
            .style("border-radius", `${UI_TOKENS.radius.pill}px`)
            .style("box-sizing", "border-box")
            .style("box-shadow", HEADER_DOCK_TOKENS.shadow)
            .style("z-index", "25")
            .style("user-select", "none");

        const self = this;
        // Function to handle mode change logic
        const setMode = (mode: string) => {
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
            {
                value: "backward",
                title: "Trace backward from the selected task",
                path: "M 10 3 L 4 8 L 10 13" // Left arrow
            },
            {
                value: "forward",
                title: "Trace forward from the selected task",
                path: "M 6 3 L 12 8 L 6 13" // Right arrow
            }
        ];

        for (const option of options) {
            const isActive = option.value === currentMode;
            const optionLabel = option.value === "backward" ? labelBackward : labelForward;
            const buttonWidth = Math.floor((secondRowLayout.traceModeToggle.width - 6) / 2);
            const buttonHeight = UI_TOKENS.height.compact - 6;

            const button = container.append("div")
                .attr("class", `trace-mode-option ${option.value}`)
                .attr("role", "radio")
                .attr("aria-checked", isActive ? "true" : "false")
                .attr("tabindex", isActive ? "0" : "-1")
                .attr("aria-label", option.title)
                .style("display", "flex")
                .style("align-items", "center")
                .style("justify-content", "center")
                .style("gap", isCompact ? "0" : "4px")
                .style("width", `${buttonWidth}px`)
                .style("height", `${buttonHeight}px`)
                .style("border-radius", `${UI_TOKENS.radius.pill}px`)
                .style("background-color", isActive ? HEADER_DOCK_TOKENS.primaryBg : "transparent")
                .style("color", isActive ? HEADER_DOCK_TOKENS.buttonText : HEADER_DOCK_TOKENS.chipMuted)
                .style("cursor", "pointer")
                .style("transition", `all ${UI_TOKENS.motion.duration.fast}ms ${UI_TOKENS.motion.easing.smooth}`)
                .style("font-family", this.getFontFamily())
                .style("font-size", this.fontPxFromPtSetting(8))
                .style("font-weight", "600");

            const svg = button.append("svg")
                .attr("width", "16")
                .attr("height", "16")
                .attr("viewBox", "0 0 16 16")
                .style("display", "block");

            svg.append("path")
                .attr("d", option.path)
                .attr("fill", "none")
                .attr("stroke", isActive ? HEADER_DOCK_TOKENS.buttonText : HEADER_DOCK_TOKENS.chipMuted)
                .attr("stroke-width", "2")
                .attr("stroke-linecap", "round")
                .attr("stroke-linejoin", "round");

            if (!isCompact) {
                button.append("span")
                    .style("pointer-events", "none")
                    .style("white-space", "nowrap")
                    .text(optionLabel);
            }

            button.append("title").text(option.title);

            button
                .on("mouseover", function () {
                    if (option.value !== self.traceMode) {
                        d3.select(this)
                            .style("background-color", HEADER_DOCK_TOKENS.menuHover)
                            .style("color", HEADER_DOCK_TOKENS.buttonText);
                        d3.select(this).select("path")
                            .attr("stroke", HEADER_DOCK_TOKENS.buttonText);
                    }
                })
                .on("mouseout", function () {
                    if (option.value !== self.traceMode) {
                        d3.select(this)
                            .style("background-color", "transparent")
                            .style("color", HEADER_DOCK_TOKENS.chipMuted);
                        d3.select(this).select("path")
                            .attr("stroke", HEADER_DOCK_TOKENS.chipMuted);
                    }
                })
                .on("click", function (event) {
                    event.stopPropagation();
                    setMode(option.value);
                })
                .on("keydown", function (event: KeyboardEvent) {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
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
            // Do not auto-select the first item to allow for filtering
            // this.dropdownActiveIndex = 0;
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

            const defaultBg = isSelected ? HEADER_DOCK_TOKENS.menuActive : HEADER_DOCK_TOKENS.menuBg;
            const row = this.dropdownList.append("div")
                .attr("class", `dropdown-item ${item.type}`)
                .attr("id", item.id)
                .attr("role", isFocusable ? "option" : "presentation")
                .attr("aria-selected", isFocusable ? (isSelected ? "true" : "false") : null)
                .attr("data-selected", isSelected ? "true" : "false")
                .attr("data-default-bg", defaultBg)
                .style("padding", isFocusable ? "6px 10px" : "8px 10px")
                .style("cursor", isFocusable ? "pointer" : "default")
                .style("color", item.type === "clear"
                    ? HEADER_DOCK_TOKENS.chipMuted
                    : (item.type === "empty" || item.type === "overflow"
                        ? HEADER_DOCK_TOKENS.buttonSubtle
                        : HEADER_DOCK_TOKENS.chipText))
                .style("font-style", item.type === "clear" || item.type === "empty" || item.type === "overflow" ? "italic" : "normal")
                .style("border-bottom", `1px solid ${HEADER_DOCK_TOKENS.menuStroke}`)
                .style("white-space", "normal")
                .style("word-wrap", "break-word")
                .style("overflow-wrap", "break-word")
                .style("line-height", "1.4")
                .style("font-size", item.type === "task" ? "11px" : "10px")
                .style("font-family", "Segoe UI, sans-serif")
                .style("background-color", isActive ? HEADER_DOCK_TOKENS.menuHover : defaultBg)
                .style("font-weight", isSelected ? "600" : "normal")
                .text(item.label);

            if (item.type === "task" && item.task) {
                row.attr("data-task-id", item.task.internalId)
                    .attr("data-task-name", item.label)
                    .attr("title", item.label);
            }

            if (isFocusable) {
                row.on("mouseover", function () {
                    (this as HTMLDivElement).style.backgroundColor = HEADER_DOCK_TOKENS.menuHover;
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
            // Fix: selectTask(null, null) clears Trace but not Filter.
            // Using applyFilter("") clears active filter AND active text input.
            this.applyFilter("");
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
                const defaultBg = node.getAttribute("data-default-bg") || HEADER_DOCK_TOKENS.menuBg;
                const isSelected = node.getAttribute("data-selected") === "true";
                node.setAttribute("aria-selected", isSelected ? "true" : "false");
                node.style.backgroundColor = isActive ? HEADER_DOCK_TOKENS.menuHover : defaultBg;
            });

        if (activeId) {
            const node = document.getElementById(activeId);
            if (node) {
                node.scrollIntoView({ block: "nearest" });
            }
        }
    }

    private selectTask(taskId: string | null, taskName: string | null): void {

        const wasFilterActive = this.filterKeyword !== null && this.filterKeyword.trim().length > 0;
        this.filterKeyword = null;

        if (this.selectedTaskId === taskId && taskId !== null) {
            taskId = null;
            taskName = null;
        }

        const taskChanged = this.selectedTaskId !== taskId;

        if (!taskChanged && !wasFilterActive) {
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

        this.updateSelectedTaskStatusLabel();

        this.announceToLiveRegion(taskId && taskName
            ? `${selectedLabelPrefix}: ${taskName}`
            : this.getLocalizedString("ui.selectionCleared", "Selection cleared"));

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

    private applyFilter(keyword: string): void {
        this.filterKeyword = keyword;

        // Manually clear selection to avoid triggering selectTask's filter clean-up
        this.selectedTaskId = null;
        this.selectedTaskName = null;

        if (this.allowInteractions && this.selectionManager) {
            this.selectionManager.clear();
        }

        this.createTraceModeToggle();

        this.host.persistProperties({
            merge: [{
                objectName: "persistedState",
                properties: { selectedTaskId: "" },
                selector: null
            }]
        });

        this.closeDropdown(false);
        // Important: preserve the input text which is the filter
        if (this.dropdownInput) {
            this.dropdownInput.property("value", keyword);
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

        // Hide formatting pane cards for unbound optional fields
        if (this.settings?.baselineFinishLine && !this.boundFields.baselineAvailable) {
            this.settings.baselineFinishLine.visible = false;
        }
        if (this.settings?.previousUpdateFinishLine && !this.boundFields.previousUpdateAvailable) {
            this.settings.previousUpdateFinishLine.visible = false;
        }

        const formattingModel = this.formattingSettingsService.buildFormattingModel(this.settings);

        return formattingModel;
    }

    /**
     * Keeps legend chips aligned with the currently rendered task scope.
     */
    private getLegendCategoriesForTaskScope(tasks: Task[]): string[] {
        if (!this.legendDataExists || this.legendCategories.length === 0 || tasks.length === 0) {
            return [];
        }

        const scopedValues = new Set<string>();
        for (const task of tasks) {
            const category = normalizeLegendCategory(task.legendValue);
            if (category) {
                scopedValues.add(category);
            }
        }

        const includedCategories = new Set<string>();
        const scopedCategories: string[] = [];
        for (const category of this.legendCategories) {
            const normalizedCategory = normalizeLegendCategory(category);
            if (normalizedCategory && scopedValues.has(normalizedCategory) && !includedCategories.has(normalizedCategory)) {
                scopedCategories.push(category);
                includedCategories.add(normalizedCategory);
            }
        }

        return scopedCategories;
    }

    private updateLegendScopeForTasks(tasks: Task[], persistSelectionChanges: boolean = false): void {
        const scopedCategories = this.getLegendCategoriesForTaskScope(tasks);
        const currentSignature = JSON.stringify(this.legendCategoriesInCurrentScope);
        const nextSignature = JSON.stringify(scopedCategories);

        this.legendCategoriesInCurrentScope = scopedCategories;
        if (currentSignature !== nextSignature) {
            this.lastLegendRenderSignature = null;
            this.legendScrollPosition = 0;
        }

        this.sanitizeLegendSelectionState(persistSelectionChanges, scopedCategories);
    }

    private getRenderableLegendCategories(): string[] {
        return this.legendCategoriesInCurrentScope;
    }

    private getRenderableLegendCategorySet(): Set<string> {
        return new Set(
            this.getRenderableLegendCategories()
                .map(category => normalizeLegendCategory(category))
                .filter((category): category is string => category !== null)
        );
    }

    private persistLegendSelectionState(): void {
        const selectedCategoriesStr = serializeLegendSelection(this.selectedLegendCategories);
        this.host.persistProperties({
            merge: [{
                objectName: "persistedState",
                properties: { selectedLegendCategories: selectedCategoriesStr },
                selector: null
            }]
        });
    }

    private hasLegendFilterAvailable(): boolean {
        return !!(this.settings?.legend?.show?.value && this.legendDataExists && this.getRenderableLegendCategories().length > 0);
    }

    private sanitizeLegendSelectionState(
        persistIfChanged: boolean = false,
        availableLegendCategories?: Iterable<string>
    ): void {
        const categorySource = availableLegendCategories ?? this.legendCategories;
        const availableCategories = new Set(
            Array.from(categorySource)
                .map(category => normalizeLegendCategory(category))
                .filter((category): category is string => category !== null)
        );

        const sanitized = new Set(
            Array.from(this.selectedLegendCategories)
                .map(category => normalizeLegendCategory(category))
                .filter((category): category is string => category !== null && availableCategories.has(category))
        );

        const currentKey = Array.from(this.selectedLegendCategories).sort().join("|");
        const sanitizedKey = Array.from(sanitized).sort().join("|");
        if (currentKey === sanitizedKey) {
            return;
        }

        this.selectedLegendCategories = sanitized;
        this.lastLegendRenderSignature = null;
        if (sanitized.size === 0) {
            this.legendScrollPosition = 0;
        }

        if (persistIfChanged) {
            this.persistLegendSelectionState();
        }
    }

    private refreshAfterLegendSelectionChange(): void {
        this.captureScrollPosition();
        this.forceFullUpdate = true;

        if (this.lastUpdateOptions) {
            this.update(this.lastUpdateOptions);
        }

        requestAnimationFrame(() => {
            this.drawZoomSliderMiniChart();
        });
    }

    private clearLegendSelection(): void {
        if (this.selectedLegendCategories.size === 0) {
            return;
        }
        this.selectedLegendCategories.clear();
        this.persistLegendSelectionState();
        this.refreshAfterLegendSelectionChange();
    }

    private toggleLegendCategory(category: string): void {
        const normalizedCategory = normalizeLegendCategory(category);
        if (!normalizedCategory) {
            return;
        }

        if (this.selectedLegendCategories.size === 0) {
            this.selectedLegendCategories.add(normalizedCategory);
        } else {

            if (this.selectedLegendCategories.has(normalizedCategory)) {
                this.selectedLegendCategories.delete(normalizedCategory);

                if (this.selectedLegendCategories.size === 0) {

                }
            } else {
                this.selectedLegendCategories.add(normalizedCategory);

                const renderedCategories = this.getRenderableLegendCategorySet();
                const selectedRenderedCount = Array.from(this.selectedLegendCategories)
                    .filter(selectedCategory => renderedCategories.has(selectedCategory))
                    .length;
                if (renderedCategories.size > 0 && selectedRenderedCount === renderedCategories.size) {
                    this.selectedLegendCategories.clear();
                }
            }
        }

        this.persistLegendSelectionState();
        this.refreshAfterLegendSelectionChange();
    }

    private getLegendTitleState(): { titleText: string; showTitle: boolean } {
        const customTitleText = this.settings?.legend?.titleText?.value?.trim() || "";
        const fallbackTitleText = this.legendFieldName?.trim() || "";
        const titleText = customTitleText || fallbackTitleText;
        const showTitleToggle = this.settings?.legend?.showTitle?.value ?? true;
        const showTitle = customTitleText.length > 0 || (showTitleToggle && fallbackTitleText.length > 0);

        return { titleText, showTitle };
    }

    private getLegendEffectiveFooterHeight(viewportWidth?: number): number {
        const effectiveWidth = viewportWidth ?? Math.max(this.target?.clientWidth ?? 0, LAYOUT_BREAKPOINTS.medium);
        const isNarrow = this.getLayoutMode(effectiveWidth) === "narrow";
        const { showTitle } = this.getLegendTitleState();

        if (isNarrow && showTitle) {
            return this.legendFooterHeight + 10;
        }

        if (isNarrow) {
            return this.legendFooterHeight + 4;
        }

        return this.legendFooterHeight;
    }

    private getLegendRenderSignature(viewportWidth: number, renderCategories: string[]): string {
        const layoutMode = this.getLayoutMode(viewportWidth);
        const { titleText, showTitle } = this.getLegendTitleState();
        const categorySignature = renderCategories
            .map(category => `${category}:${this.legendColorMap.get(category) || ""}`)
            .join("|");
        const selectedSignature = Array.from(this.selectedLegendCategories).sort().join("|");

        return JSON.stringify({
            show: this.settings.legend.show.value,
            width: viewportWidth,
            layoutMode,
            fontSize: this.settings.legend.fontSize.value,
            showTitle,
            titleText,
            fieldName: this.legendFieldName,
            highContrast: this.highContrastMode,
            background: this.getBackgroundColor(),
            foreground: this.getForegroundColor(),
            fontFamily: this.getFontFamily(),
            categories: categorySignature,
            selected: selectedSignature
        });
    }

    /**
     * Render the legend UI in sticky footer with horizontal scrolling
     */
    private renderLegend(viewportWidth: number, viewportHeight: number): void {
        if (!this.legendContainer) return;

        const renderCategories = this.getRenderableLegendCategories();
        const showLegend = this.settings.legend.show.value && this.legendDataExists && renderCategories.length > 0;

        if (!showLegend) {
            this.legendContainer.style("display", "none");
            this.lastLegendRenderSignature = null;
            this.legendScrollPosition = 0;
            return;
        }

        const legendRenderSignature = this.getLegendRenderSignature(viewportWidth, renderCategories);
        if (this.lastLegendRenderSignature === legendRenderSignature) {
            this.legendContainer.style("display", "block");
            return;
        }

        const layoutMode = this.getLayoutMode(viewportWidth);
        const isNarrow = layoutMode === "narrow";
        const fontSize = this.settings.legend.fontSize.value;
        const { titleText, showTitle } = this.getLegendTitleState();
        const legendFooterHeight = this.getLegendEffectiveFooterHeight(viewportWidth);
        const legendFontSizePx = this.pointsToCssPx(fontSize);
        const sectionLabelSizePx = Math.max(10, legendFontSizePx - 3);
        const titleFontSizePx = Math.max(10, this.pointsToCssPx(fontSize + (isNarrow ? 0 : 0.25)));
        const statusFontSizePx = Math.max(9, legendFontSizePx - 1);
        const itemFontSizePx = Math.max(10, legendFontSizePx - 0.5);
        const compactSummaryWidth = isNarrow
            ? Math.max(180, Math.min(260, Math.round(viewportWidth * 0.3)))
            : Math.max(260, Math.min(440, Math.round(viewportWidth * 0.28)));
        const shellBackground = this.highContrastMode
            ? this.getBackgroundColor()
            : HEADER_DOCK_TOKENS.shell;
        const shellBorder = this.highContrastMode ? this.getForegroundColor() : HEADER_DOCK_TOKENS.groupStroke;
        const shellText = this.highContrastMode ? this.getForegroundColor() : HEADER_DOCK_TOKENS.chipText;
        const shellMuted = this.highContrastMode ? this.getForegroundColor() : HEADER_DOCK_TOKENS.chipMuted;
        const railBackground = this.highContrastMode ? this.getBackgroundColor() : HEADER_DOCK_TOKENS.shell;
        const railBorder = this.highContrastMode ? this.getForegroundColor() : HEADER_DOCK_TOKENS.contextStroke;
        const buttonBackground = this.highContrastMode ? this.getBackgroundColor() : HEADER_DOCK_TOKENS.buttonBg;
        const buttonBorder = this.highContrastMode ? this.getForegroundColor() : HEADER_DOCK_TOKENS.buttonStroke;
        const buttonHoverBackground = this.highContrastMode ? this.getBackgroundColor() : HEADER_DOCK_TOKENS.buttonHoverBg;
        const buttonHoverBorder = this.highContrastMode ? this.getForegroundColor() : HEADER_DOCK_TOKENS.buttonHoverStroke;
        const buttonTextColor = this.highContrastMode ? this.getForegroundColor() : HEADER_DOCK_TOKENS.buttonText;
        const buttonDisabledColor = this.highContrastMode ? this.getForegroundColor() : HEADER_DOCK_TOKENS.buttonMuted;
        const renderedCategorySet = this.getRenderableLegendCategorySet();
        const selectedRenderedCount = Array.from(this.selectedLegendCategories)
            .filter(category => renderedCategorySet.has(category))
            .length;
        const totalCount = renderCategories.length;
        const selectedCount = this.selectedLegendCategories.size === 0 ? totalCount : selectedRenderedCount;
        const hiddenCount = Math.max(0, totalCount - selectedCount);
        const isFiltered = this.selectedLegendCategories.size > 0 && selectedCount < totalCount;

        this.legendContainer.selectAll("*").remove();
        this.legendContainer
            .style("display", "block")
            .style("height", `${legendFooterHeight}px`)
            .style("min-height", `${legendFooterHeight}px`)
            .style("background", shellBackground)
            .style("border-top", `1px solid ${shellBorder}`)
            .style("box-shadow", this.highContrastMode ? "none" : "0 -6px 18px rgba(15, 23, 34, 0.18)")
            .style("color", shellText);

        const mainContainer = this.legendContainer.append("div")
            .attr("class", "legend-main")
            .style("display", "flex")
            .style("align-items", "center")
            .style("gap", `${UI_TOKENS.spacing.sm}px`)
            .style("height", "100%")
            .style("padding", isNarrow ? "6px 10px" : "6px 12px")
            .style("box-sizing", "border-box")
            .style("font-family", this.getFontFamily());

        const metaBlock = mainContainer.append("div")
            .attr("class", "legend-meta")
            .style("display", "flex")
            .style("flex-direction", "row")
            .style("align-items", "center")
            .style("gap", `${UI_TOKENS.spacing.xs}px`)
            .style("flex", "0 1 auto")
            .style("min-width", "0")
            .style("max-width", `${compactSummaryWidth}px`)
            .style("padding-right", `${UI_TOKENS.spacing.sm}px`);

        metaBlock.append("div")
            .attr("class", "legend-section-label")
            .style("font-size", `${sectionLabelSizePx}px`)
            .style("font-weight", String(UI_TOKENS.fontWeight.semibold))
            .style("letter-spacing", "0.08em")
            .style("text-transform", "uppercase")
            .style("color", shellMuted)
            .style("flex-shrink", "0")
            .text("Legend");

        if (showTitle && titleText) {
            metaBlock.append("div")
                .attr("class", "legend-title")
                .style("font-size", `${titleFontSizePx}px`)
                .style("font-weight", String(UI_TOKENS.fontWeight.semibold))
                .style("color", shellText)
                .style("line-height", "1.1")
                .style("flex", "1")
                .style("min-width", "0")
                .style("white-space", "nowrap")
                .style("overflow", "hidden")
                .style("text-overflow", "ellipsis")
                .attr("title", titleText)
                .text(titleText);
        }

        const createStatusChip = (text: string, bg: string, border: string, color: string) => {
            metaBlock.append("div")
                .attr("class", "legend-status-chip")
                .style("display", "inline-flex")
                .style("align-items", "center")
                .style("padding", "2px 7px")
                .style("border-radius", `${UI_TOKENS.radius.full}px`)
                .style("background", bg)
                .style("border", `1px solid ${border}`)
                .style("font-size", `${statusFontSizePx}px`)
                .style("font-weight", String(UI_TOKENS.fontWeight.medium))
                .style("color", color)
                .style("line-height", "1.1")
                .style("flex-shrink", "0")
                .style("white-space", "nowrap")
                .text(text);
        };

        createStatusChip(
            `${selectedCount} / ${totalCount} visible`,
            this.highContrastMode ? "transparent" : HEADER_DOCK_TOKENS.chipBg,
            this.highContrastMode ? shellText : HEADER_DOCK_TOKENS.chipStroke,
            shellText
        );

        if (isFiltered) {
            createStatusChip(
                `${hiddenCount} hidden`,
                this.highContrastMode ? "transparent" : HEADER_DOCK_TOKENS.warningBg,
                this.highContrastMode ? shellText : HEADER_DOCK_TOKENS.warning,
                this.highContrastMode ? shellText : HEADER_DOCK_TOKENS.warningText
            );
        }

        const rail = mainContainer.append("div")
            .attr("class", "legend-rail")
            .style("flex", "1")
            .style("min-width", "0")
            .style("display", "flex")
            .style("align-items", "center")
            .style("gap", `${UI_TOKENS.spacing.xs}px`)
            .style("padding", isNarrow ? "4px 5px" : "5px 6px")
            .style("border-radius", `${UI_TOKENS.radius.medium}px`)
            .style("background", railBackground)
            .style("border", `1px solid ${railBorder}`)
            .style("box-shadow", this.highContrastMode ? "none" : "inset 0 1px 0 rgba(255,255,255,0.04)");

        const scrollWrapper = rail.append("div")
            .attr("class", "legend-scroll-wrapper")
            .style("flex", "1")
            .style("min-width", "0")
            .style("overflow", "hidden")
            .style("position", "relative");

        const scrollableContent = scrollWrapper.append("div")
            .attr("class", "legend-scroll-content")
            .style("display", "flex")
            .style("gap", `${UI_TOKENS.spacing.xs}px`)
            .style("align-items", "center")
            .style("transition", `transform ${UI_TOKENS.motion.duration.normal}ms ${UI_TOKENS.motion.easing.standard}`)
            .style("padding", "0")
            .style("width", "max-content");

        const actions = rail.append("div")
            .attr("class", "legend-actions")
            .style("display", "flex")
            .style("align-items", "center")
            .style("gap", `${UI_TOKENS.spacing.xs}px`)
            .style("flex-shrink", "0");

        const scrollButtons = actions.append("div")
            .attr("class", "legend-scroll-buttons")
            .style("display", "flex")
            .style("align-items", "center")
            .style("gap", `${UI_TOKENS.spacing.xs}px`);

        const createActionButton = (
            label: string,
            ariaLabel: string,
            compact: boolean = false,
            parent: Selection<HTMLDivElement, unknown, null, undefined> = actions
        ) => {
            const button = parent.append("div")
                .attr("class", "legend-action-button")
                .attr("role", "button")
                .attr("aria-label", ariaLabel)
                .attr("tabindex", 0)
                .style("display", "inline-flex")
                .style("align-items", "center")
                .style("justify-content", "center")
                .style("height", compact ? "26px" : "28px")
                .style("min-width", compact ? "26px" : "28px")
                .style("padding", compact ? "0" : "0 9px")
                .style("border-radius", compact ? `${UI_TOKENS.radius.medium}px` : `${UI_TOKENS.radius.full}px`)
                .style("background", buttonBackground)
                .style("border", `1px solid ${buttonBorder}`)
                .style("color", buttonTextColor)
                .style("font-size", `${Math.max(10, compact ? statusFontSizePx : statusFontSizePx - 0.5)}px`)
                .style("font-weight", String(UI_TOKENS.fontWeight.medium))
                .style("line-height", "1")
                .style("cursor", "pointer")
                .style("user-select", "none")
                .style("box-shadow", this.highContrastMode ? "none" : UI_TOKENS.shadow[1])
                .style("transition", `transform ${UI_TOKENS.motion.duration.fast}ms ${UI_TOKENS.motion.easing.standard}, background ${UI_TOKENS.motion.duration.fast}ms ${UI_TOKENS.motion.easing.standard}, border-color ${UI_TOKENS.motion.duration.fast}ms ${UI_TOKENS.motion.easing.standard}, opacity ${UI_TOKENS.motion.duration.fast}ms ${UI_TOKENS.motion.easing.standard}`)
                .text(label);

            button.on("mouseenter", function () {
                const current = d3.select(this);
                if (current.attr("aria-disabled") === "true") return;
                current
                    .style("transform", "translateY(-1px)")
                    .style("background", buttonHoverBackground)
                    .style("border-color", buttonHoverBorder);
            });

            button.on("mouseleave", function () {
                const current = d3.select(this);
                current
                    .style("transform", "translateY(0)")
                    .style("background", buttonBackground)
                    .style("border-color", buttonBorder);
            });

            return button;
        };

        let resetButton: Selection<HTMLDivElement, unknown, null, undefined> | null = null;
        if (isFiltered) {
            const resetLabel = isNarrow ? "All" : "Show All";
            resetButton = createActionButton(resetLabel, "Show all legend categories");
            resetButton.on("click", () => this.clearLegendSelection());
            resetButton.on("keydown", (event: KeyboardEvent) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    this.clearLegendSelection();
                }
            });
        }

        const leftArrow = createActionButton("<", "Scroll legend left", true, scrollButtons);
        const rightArrow = createActionButton(">", "Scroll legend right", true, scrollButtons);

        renderCategories.forEach(category => {
            const normalizedCategory = normalizeLegendCategory(category);
            const color = this.legendColorMap.get(category) || "#999";
            const isSelected = this.selectedLegendCategories.size === 0 || (!!normalizedCategory && this.selectedLegendCategories.has(normalizedCategory));
            const selectedBackground = this.highContrastMode ? "transparent" : this.toRgba(color, 0.18);
            const selectedBorder = this.highContrastMode ? shellText : this.toRgba(color, 0.42);
            const unselectedBackground = this.highContrastMode ? "transparent" : "rgba(255,255,255,0.03)";
            const unselectedBorder = this.highContrastMode ? shellText : HEADER_DOCK_TOKENS.groupStroke;
            const labelColor = isSelected ? shellText : shellMuted;

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
                .style("gap", `${UI_TOKENS.spacing.xs}px`)
                .style("flex-shrink", "0")
                .style("padding", isNarrow ? "4px 8px" : "5px 10px")
                .style("border-radius", `${UI_TOKENS.radius.full}px`)
                .style("background", isSelected ? selectedBackground : unselectedBackground)
                .style("border", `1px solid ${isSelected ? selectedBorder : unselectedBorder}`)
                .style("cursor", "pointer")
                .style("user-select", "none")
                .style("opacity", isSelected ? "1" : "0.7")
                .style("box-shadow", isSelected && !this.highContrastMode ? `inset 0 1px 0 ${this.toRgba("#FFFFFF", 0.06)}` : "none")
                .style("transition", `transform ${UI_TOKENS.motion.duration.fast}ms ${UI_TOKENS.motion.easing.standard}, opacity ${UI_TOKENS.motion.duration.fast}ms ${UI_TOKENS.motion.easing.standard}, border-color ${UI_TOKENS.motion.duration.fast}ms ${UI_TOKENS.motion.easing.standard}, background ${UI_TOKENS.motion.duration.fast}ms ${UI_TOKENS.motion.easing.standard}`);

            item.append("div")
                .attr("class", "legend-swatch")
                .style("width", "10px")
                .style("height", "10px")
                .style("background-color", isSelected ? color : "transparent")
                .style("border", `2px solid ${color}`)
                .style("border-radius", `${UI_TOKENS.radius.full}px`)
                .style("flex-shrink", "0")
                .style("box-shadow", isSelected && !this.highContrastMode ? `0 0 0 2px ${this.toRgba(color, 0.16)}` : "none")
                .style("transition", `transform ${UI_TOKENS.motion.duration.fast}ms ${UI_TOKENS.motion.easing.standard}, box-shadow ${UI_TOKENS.motion.duration.fast}ms ${UI_TOKENS.motion.easing.standard}`);

            item.append("span")
                .attr("class", "legend-label")
                .style("font-size", `${itemFontSizePx}px`)
                .style("white-space", "pre")
                .style("color", labelColor)
                .style("font-weight", String(isSelected ? UI_TOKENS.fontWeight.semibold : UI_TOKENS.fontWeight.medium))
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

            item.on("mouseenter", function () {
                d3.select(this)
                    .style("opacity", "1")
                    .style("transform", "translateY(-1px)");
            });

            item.on("mouseleave", function () {
                d3.select(this)
                    .style("opacity", isSelected ? "1" : "0.7")
                    .style("transform", "translateY(0)");
            });
        });

        let scrollPosition = this.legendScrollPosition;
        const getMaxScroll = (): number => {
            const contentWidth = (scrollableContent.node() as HTMLElement).scrollWidth;
            const wrapperWidth = (scrollWrapper.node() as HTMLElement).clientWidth;
            return Math.max(0, contentWidth - wrapperWidth);
        };

        const updateArrowStates = () => {
            const maxScroll = getMaxScroll();
            const hasOverflow = maxScroll > 0;
            const leftDisabled = scrollPosition <= 0;
            const rightDisabled = scrollPosition >= maxScroll || !hasOverflow;

            scrollButtons.style("display", hasOverflow ? "flex" : "none");

            [leftArrow, rightArrow].forEach((button, index) => {
                const disabled = index === 0 ? leftDisabled : rightDisabled;
                button
                    .classed("is-disabled", disabled)
                    .attr("aria-disabled", disabled ? "true" : "false")
                    .style("opacity", disabled ? "0.38" : "1")
                    .style("cursor", disabled ? "default" : "pointer")
                    .style("color", disabled ? buttonDisabledColor : buttonTextColor);
            });
        };

        const setScrollPosition = (nextPosition: number) => {
            scrollPosition = Math.max(0, Math.min(getMaxScroll(), nextPosition));
            this.legendScrollPosition = scrollPosition;
            scrollableContent.style("transform", `translateX(-${scrollPosition}px)`);
            updateArrowStates();
        };

        const getScrollAmount = (): number => {
            const wrapperWidth = (scrollWrapper.node() as HTMLElement).clientWidth;
            return Math.max(140, Math.round(wrapperWidth * 0.55));
        };

        const handleScrollLeft = () => {
            if (scrollPosition <= 0) return;
            setScrollPosition(scrollPosition - getScrollAmount());
        };

        const handleScrollRight = () => {
            const maxScroll = getMaxScroll();
            if (scrollPosition >= maxScroll) return;
            setScrollPosition(scrollPosition + getScrollAmount());
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

        scrollWrapper.on("wheel", (event: WheelEvent) => {
            const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
            if (delta === 0 || getMaxScroll() === 0) return;
            event.preventDefault();
            setScrollPosition(scrollPosition + delta);
        });

        if (resetButton) {
            resetButton.style("margin-right", `${UI_TOKENS.spacing.xs}px`);
        }

        setScrollPosition(this.legendScrollPosition);
        requestAnimationFrame(() => {
            setScrollPosition(this.legendScrollPosition);
        });

        this.lastLegendRenderSignature = legendRenderSignature;
    }

    /**
     * Convert hex color to RGB object
     */
    /**
     * Normalizes a Date to midnight (start of day) UTC for consistent day-level comparisons.
     * This prevents time-component mismatches between task dates and the data date
     * when comparing whether a task falls before/after the data date boundary.
     */
    private normalizeToStartOfDay(date: Date): number {
        const d = new Date(date.getTime());
        d.setUTCHours(0, 0, 0, 0);
        return d.getTime();
    }

    private hexToRgb(hex: string): { r: number; g: number; b: number } {
        let normalized = hex.replace(/^#/, '').trim();
        if (normalized.length === 3) {
            normalized = normalized.split('').map(ch => ch + ch).join('');
        }
        if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
            return { r: Number.NaN, g: Number.NaN, b: Number.NaN };
        }

        const bigint = parseInt(normalized, 16);
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

    private toRgba(color: string, alpha: number): string {
        const rgb = this.hexToRgb(color);
        if ([rgb.r, rgb.g, rgb.b].some(value => Number.isNaN(value))) {
            return color;
        }
        const clampedAlpha = Math.max(0, Math.min(1, alpha));
        return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clampedAlpha})`;
    }

    private getSoftOutlineColor(fillColor: string): string {
        return this.blendColors(fillColor, this.getContrastColor(fillColor), 0.8);
    }

    private getComparisonStrokeColor(fillColor: string): string {
        return this.toRgba(this.getSoftOutlineColor(fillColor), 0.55);
    }

    private getSemanticTaskFillColor(
        task: Task,
        fallbackColor: string,
        criticalColor: string,
        nearCriticalColor: string
    ): string {
        if (this.legendDataExists && task.legendColor) return task.legendColor;
        if (!this.legendDataExists) {
            if (task.isCritical) return criticalColor;
            if (task.isNearCritical) return nearCriticalColor;
        }
        return fallbackColor;
    }

    private getRenderedMilestoneSize(milestoneSizeSetting: number, taskHeight: number): number {
        const configuredBarHeight = this.settings?.taskBars?.taskBarHeight?.value ?? taskHeight;
        const visualLimit = Math.min(taskHeight * 0.9, configuredBarHeight + 2);
        return Math.max(4, Math.min(milestoneSizeSetting, visualLimit));
    }

    private getCornerRadii(radius: number, roundLeft: boolean, roundRight: boolean): CornerRadii {
        const safeRadius = Math.max(0, radius);
        return {
            tl: roundLeft ? safeRadius : 0,
            tr: roundRight ? safeRadius : 0,
            br: roundRight ? safeRadius : 0,
            bl: roundLeft ? safeRadius : 0
        };
    }

    private clampCornerRadii(width: number, height: number, corners: CornerRadii): CornerRadii {
        const maxRadius = Math.max(0, Math.min(width / 2, height / 2));
        return {
            tl: Math.max(0, Math.min(corners.tl, maxRadius)),
            tr: Math.max(0, Math.min(corners.tr, maxRadius)),
            br: Math.max(0, Math.min(corners.br, maxRadius)),
            bl: Math.max(0, Math.min(corners.bl, maxRadius))
        };
    }

    private getRoundedRectPath(x: number, y: number, width: number, height: number, corners: CornerRadii): string {
        const safeWidth = Math.max(0, width);
        const safeHeight = Math.max(0, height);
        const { tl, tr, br, bl } = this.clampCornerRadii(safeWidth, safeHeight, corners);
        const right = x + safeWidth;
        const bottom = y + safeHeight;

        return [
            `M ${x + tl},${y}`,
            `H ${right - tr}`,
            tr > 0 ? `Q ${right},${y} ${right},${y + tr}` : `L ${right},${y}`,
            `V ${bottom - br}`,
            br > 0 ? `Q ${right},${bottom} ${right - br},${bottom}` : `L ${right},${bottom}`,
            `H ${x + bl}`,
            bl > 0 ? `Q ${x},${bottom} ${x},${bottom - bl}` : `L ${x},${bottom}`,
            `V ${y + tl}`,
            tl > 0 ? `Q ${x},${y} ${x + tl},${y}` : `L ${x},${y}`,
            "Z"
        ].join(" ");
    }

    private getBeforeDataDateOverlay(
        start: Date,
        finish: Date,
        startX: number,
        finishX: number,
        radius: number
    ): BeforeDataDateOverlay | null {
        const enableOverride = this.settings?.dataDateColorOverride?.enableP6Style?.value ?? false;
        const dataDate = this.dataDate;
        if (!enableOverride || !dataDate) {
            return null;
        }

        const ddTime = this.normalizeToStartOfDay(dataDate);
        const startTime = this.normalizeToStartOfDay(start);
        const finishTime = this.normalizeToStartOfDay(finish);

        if (startTime >= ddTime) {
            return null;
        }

        if (finishTime <= ddTime) {
            return {
                x: startX,
                width: Math.max(1, finishX - startX),
                corners: this.getCornerRadii(radius, true, true),
                dividerX: null
            };
        }

        const rawSplitX = this.snapRectCoord(this.xScale ? this.xScale(dataDate) : startX);
        const clampedSplitX = Math.max(startX + 1, Math.min(finishX - 1, rawSplitX));
        const overlayWidth = Math.max(1, clampedSplitX - startX);

        return {
            x: startX,
            width: overlayWidth,
            corners: this.getCornerRadii(radius, true, false),
            dividerX: clampedSplitX
        };
    }

    private getTaskRenderStyle(
        task: Task,
        baseFillColor: string,
        visualWidth: number,
        isMilestone: boolean,
        taskBarStrokeColor: string,
        taskBarStrokeWidth: number,
        criticalColor: string,
        nearCriticalColor: string
    ): TaskRenderStyle {
        const hasExplicitStroke = taskBarStrokeWidth > 0 || this.isNonEmptyColor(taskBarStrokeColor);
        const defaultOutline = this.getSoftOutlineColor(baseFillColor);
        const explicitOutline = this.isNonEmptyColor(taskBarStrokeColor) ? taskBarStrokeColor : defaultOutline;
        const selectionHighlightColor = this.getSelectionColor();

        let strokeColor = hasExplicitStroke ? explicitOutline : "none";
        let strokeWidth = hasExplicitStroke ? Math.max(0.75, taskBarStrokeWidth || 1) : 0;
        let strokeOpacity = hasExplicitStroke ? 0.82 : 0;
        let hoverStrokeColor = strokeColor === "none" ? defaultOutline : strokeColor;
        let hoverStrokeWidth = Math.max(strokeWidth, isMilestone ? 1.4 : 1.25);
        let hoverStrokeOpacity = strokeColor === "none" ? 0.95 : 1;
        let shadowColor = "transparent";
        let shadowBlur = 0;
        let shadowOffsetY = 0;
        let svgFilter = visualWidth >= 10 || isMilestone ? `drop-shadow(${UI_TOKENS.shadow[1]})` : "none";

        if (isMilestone) {
            strokeColor = hasExplicitStroke ? explicitOutline : defaultOutline;
            strokeWidth = Math.max(strokeWidth, 1.15);
            strokeOpacity = Math.max(strokeOpacity, 0.9);
            hoverStrokeColor = strokeColor;
            hoverStrokeWidth = Math.max(hoverStrokeWidth, 1.55);
            hoverStrokeOpacity = 1;
        }

        if (task.isCritical) {
            shadowColor = this.toRgba(criticalColor, this.legendDataExists ? 0.28 : 0.22);
            shadowBlur = visualWidth >= 10 || isMilestone ? (isMilestone ? 3 : 4) : 0;
            svgFilter = shadowBlur > 0 ? `drop-shadow(0 0 ${shadowBlur}px ${shadowColor})` : svgFilter;

            if (this.legendDataExists) {
                strokeColor = criticalColor;
                strokeWidth = Math.max(strokeWidth, this.settings.criticalPath.criticalBorderWidth.value);
            } else {
                strokeColor = strokeWidth > 0 ? strokeColor : defaultOutline;
                strokeWidth = Math.max(strokeWidth, isMilestone ? 1.5 : Math.max(1, this.settings.criticalPath.criticalBorderWidth.value * 0.65));
            }

            strokeOpacity = Math.max(strokeOpacity, 0.95);
            hoverStrokeColor = criticalColor;
            hoverStrokeWidth = Math.max(hoverStrokeWidth, strokeWidth + 0.35);
            hoverStrokeOpacity = 1;
        } else if (task.isNearCritical) {
            shadowColor = this.toRgba(nearCriticalColor, this.legendDataExists ? 0.24 : 0.2);
            shadowBlur = visualWidth >= 10 || isMilestone ? (isMilestone ? 2.5 : 3) : 0;
            svgFilter = shadowBlur > 0 ? `drop-shadow(0 0 ${shadowBlur}px ${shadowColor})` : svgFilter;

            if (this.legendDataExists) {
                strokeColor = nearCriticalColor;
                strokeWidth = Math.max(strokeWidth, this.settings.criticalPath.nearCriticalBorderWidth.value);
            } else {
                strokeColor = strokeWidth > 0 ? strokeColor : defaultOutline;
                strokeWidth = Math.max(strokeWidth, isMilestone ? 1.35 : Math.max(1, this.settings.criticalPath.nearCriticalBorderWidth.value * 0.65));
            }

            strokeOpacity = Math.max(strokeOpacity, 0.9);
            hoverStrokeColor = nearCriticalColor;
            hoverStrokeWidth = Math.max(hoverStrokeWidth, strokeWidth + 0.3);
            hoverStrokeOpacity = 1;
        }

        if (task.internalId === this.selectedTaskId) {
            strokeColor = selectionHighlightColor;
            strokeWidth = Math.max(strokeWidth + 0.6, isMilestone ? 2.1 : 2.4);
            strokeOpacity = 1;
            hoverStrokeColor = selectionHighlightColor;
            hoverStrokeWidth = strokeWidth;
            hoverStrokeOpacity = 1;
            shadowColor = this.toRgba(selectionHighlightColor, 0.32);
            shadowBlur = isMilestone ? 5 : 6;
            shadowOffsetY = 0;
            svgFilter = `drop-shadow(0 0 ${shadowBlur}px ${shadowColor})`;
        } else if (shadowBlur === 0 && (visualWidth >= 10 || isMilestone)) {
            shadowColor = this.toRgba(baseFillColor, 0.12);
            shadowBlur = 2;
            shadowOffsetY = 1;
            svgFilter = `drop-shadow(${UI_TOKENS.shadow[1]})`;
        }

        if (!isMilestone && visualWidth < 8) {
            strokeWidth = strokeWidth > 0 ? Math.min(strokeWidth, task.internalId === this.selectedTaskId ? 1.8 : 1.1) : 0;
            hoverStrokeWidth = Math.min(Math.max(hoverStrokeWidth, 1), task.internalId === this.selectedTaskId ? 1.8 : 1.3);
        }

        if (strokeWidth <= 0.05) {
            strokeColor = "none";
            strokeOpacity = 0;
        }

        return {
            fillColor: baseFillColor,
            strokeColor,
            strokeWidth,
            strokeOpacity,
            hoverStrokeColor,
            hoverStrokeWidth,
            hoverStrokeOpacity,
            shadowColor,
            shadowBlur,
            shadowOffsetY,
            svgFilter
        };
    }

    private getConnectorArrowSize(): number {
        return Math.max(4, this.settings?.connectorLines?.arrowHeadSize?.value ?? 6);
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
            this.stickyHeaderContainer?.style("background-color", HEADER_DOCK_TOKENS.shell);
            this.legendContainer?.style("background-color", HEADER_DOCK_TOKENS.shell);
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

        this.warningBanner
            ?.style("background-color", background)
            .style("color", foreground)
            .style("border", `1px solid ${foreground}`);

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
        const mode = this.settings?.criticalPath?.calculationMode?.value?.value || "floatBased";

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

        const startText = this.formatDate(this.getVisualStart(task));
        if (startText) items.push({ displayName: startLabel, value: startText });

        const finishText = this.formatDate(this.getVisualFinish(task));
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
        const mode = this.settings?.criticalPath?.calculationMode?.value?.value || "floatBased";
        const requiredRoles = ["taskId", "startDate", "finishDate"];
        requiredRoles.push(mode === "floatBased" ? "taskTotalFloat" : "duration");
        return requiredRoles.filter(role => !this.dataProcessor.hasDataRole(dataView, role));
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

        const mode = this.settings?.criticalPath?.calculationMode?.value?.value || "floatBased";
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

    // ============================================================================
    // Help Overlay Functionality
    // ============================================================================


    /**
     * Creates the Help button in the header area
     */
    private createHelpButton(buttonSize: number = 24): void {
        if (!this.headerSvg) return;

        const viewportWidth = this.lastUpdateOptions?.viewport?.width || 800;
        const xPos = viewportWidth - buttonSize - 10; // Right aligned

        const helpBtnGroup = this.headerSvg.append('g')
            .attr('class', 'help-btn-group')
            .attr('transform', `translate(${xPos}, 10)`)
            .style('cursor', 'pointer')
            .on('click', () => this.showHelpOverlay());

        helpBtnGroup.append('rect')
            .attr('class', 'help-btn-bg')
            .attr('width', buttonSize)
            .attr('height', buttonSize)
            .attr('rx', UI_TOKENS.radius.medium)
            .attr('ry', UI_TOKENS.radius.medium)
            .style('fill', UI_TOKENS.color.neutral.white)
            .style('stroke', UI_TOKENS.color.neutral.grey60)
            .style('stroke-width', 1.5)
            .style('filter', `drop-shadow(${UI_TOKENS.shadow[2]})`)
            .style('transition', `all ${UI_TOKENS.motion.duration.normal}ms`);

        // Icon group - Question mark icon
        const iconG = helpBtnGroup.append('g')
            .attr('class', 'help-icon')
            .attr('transform', `translate(${buttonSize / 2}, ${buttonSize / 2})`);

        // Question mark circle
        iconG.append('circle')
            .attr('r', 7)
            .attr('fill', 'none')
            .attr('stroke', UI_TOKENS.color.primary.default)
            .attr('stroke-width', 1.5);

        // Question mark
        iconG.append('text')
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .attr('y', 0)
            .attr('font-size', '11px')
            .attr('font-weight', '600')
            .attr('fill', UI_TOKENS.color.primary.default)
            .text('?');

        // Tooltip
        helpBtnGroup.append('title')
            .text('Show help and user guide');

        // Event handlers
        const self = this;

    }

    /**
     * Shows the help overlay with user guide content
     */
    private showHelpOverlay(): void {
        if (this.isHelpOverlayVisible) return;

        this.isHelpOverlayVisible = true;
        this.clearHelpOverlay();
        this.helpOverlayReturnFocusTarget = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;

        const dialogTitleId = this.getScopedId("help-dialog-title");
        const dialogDescriptionId = this.getScopedId("help-dialog-description");
        const helpTitle = this.getLocalizedString("ui.helpDialogTitle", "User Guide");
        const helpDescription = this.getLocalizedString(
            "ui.helpDialogDescription",
            "Usage guidance for controls, tracing, filtering, exports, and accessibility in the current visual."
        );
        const closeHelpLabel = this.getLocalizedString("ui.closeHelp", "Close help");
        const closeGuideLabel = this.getLocalizedString("ui.helpDialogClose", "Close");

        // Create overlay container that covers the entire visual
        const overlay = d3.select(this.target)
            .append('div')
            .attr('class', 'help-overlay')
            .attr('data-owner', this.instanceId)
            .style('position', 'absolute')
            .style('top', '0')
            .style('left', '0')
            .style('width', '100%')
            .style('height', '100%')
            .style('background', 'rgba(0, 0, 0, 0.6)')
            .style('z-index', '10000')
            .style('display', 'flex')
            .style('align-items', 'center')
            .style('justify-content', 'center')
            .style('padding', '20px')
            .style('box-sizing', 'border-box');

        this.helpOverlayContainer = overlay;

        // Create the help content card
        const card = overlay.append('div')
            .attr('class', 'help-card')
            .attr('role', 'dialog')
            .attr('aria-modal', 'true')
            .attr('aria-labelledby', dialogTitleId)
            .attr('aria-describedby', dialogDescriptionId)
            .attr('tabindex', '-1')
            .style('max-width', '800px')
            .style('max-height', '90%')
            .style('width', '100%')
            .style('background', this.getBackgroundColor())
            .style('border-radius', '16px')
            .style('box-shadow', '0 24px 48px rgba(0, 0, 0, 0.2)')
            .style('display', 'flex')
            .style('flex-direction', 'column')
            .style('overflow', 'hidden')
            .style('font-family', 'Segoe UI, sans-serif')
            .style('color', this.getForegroundColor());

        // Header with close button
        const header = card.append('div')
            .style('display', 'flex')
            .style('align-items', 'center')
            .style('justify-content', 'space-between')
            .style('padding', '20px 24px')
            .style('border-bottom', `1px solid ${UI_TOKENS.color.neutral.grey30} `)
            .style('flex-shrink', '0');

        // Header title with icon - using safe DOM manipulation
        const headerTitle = header.append('div')
            .style('display', 'flex')
            .style('align-items', 'center')
            .style('gap', '12px');

        // Create SVG icon using D3's proper namespace handling
        const headerIcon = headerTitle.append('svg')
            .attr('width', 24)
            .attr('height', 24)
            .attr('viewBox', '0 0 24 24')
            .attr('fill', 'none');
        headerIcon.append('circle')
            .attr('cx', 12)
            .attr('cy', 12)
            .attr('r', 10)
            .attr('stroke', UI_TOKENS.color.primary.default)
            .attr('stroke-width', 2);
        headerIcon.append('text')
            .attr('x', 12)
            .attr('y', 16)
            .attr('text-anchor', 'middle')
            .attr('font-size', 14)
            .attr('font-weight', 600)
            .attr('fill', UI_TOKENS.color.primary.default)
            .text('?');

        headerTitle.append('span')
            .attr('id', dialogTitleId)
            .style('font-size', '20px')
            .style('font-weight', '600')
            .text(helpTitle);

        // Close button with X icon - using safe DOM manipulation
        const closeBtn = header.append('button')
            .attr('type', 'button')
            .attr('aria-label', closeHelpLabel)
            .style('background', 'none')
            .style('border', 'none')
            .style('cursor', 'pointer')
            .style('padding', '8px')
            .style('border-radius', '8px')
            .style('display', 'flex')
            .style('align-items', 'center')
            .style('justify-content', 'center')
            .style('transition', this.getAnimationDuration(150) === 0 ? 'none' : 'background 0.15s')
            .on('mouseover', function () {
                d3.select(this).style('background', UI_TOKENS.color.neutral.grey20);
            })
            .on('mouseout', function () {
                d3.select(this).style('background', 'none');
            })
            .on('click', () => this.hideHelpOverlay());

        // Create close icon SVG
        const closeIcon = closeBtn.append('svg')
            .attr('width', 20)
            .attr('height', 20)
            .attr('viewBox', '0 0 20 20')
            .attr('fill', UI_TOKENS.color.neutral.grey130);
        closeIcon.append('path')
            .attr('d', 'M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z');

        // Scrollable content area
        const content = card.append('div')
            .style('flex', '1')
            .style('overflow-y', 'auto')
            .style('padding', '24px')
            .style('line-height', '1.6');

        content.append('p')
            .attr('id', dialogDescriptionId)
            .style('margin', '0 0 16px 0')
            .style('font-size', '13px')
            .style('color', this.getForegroundColor())
            .text(helpDescription);

        // Build help content
        this.buildHelpContent(content);

        // Footer with close button
        const footer = card.append('div')
            .style('padding', '16px 24px')
            .style('border-top', `1px solid ${UI_TOKENS.color.neutral.grey30} `)
            .style('display', 'flex')
            .style('justify-content', 'flex-end')
            .style('flex-shrink', '0');

        footer.append('button')
            .attr('type', 'button')
            .style('background', UI_TOKENS.color.primary.default)
            .style('color', '#fff')
            .style('border', 'none')
            .style('padding', '10px 24px')
            .style('border-radius', '8px')
            .style('font-size', '14px')
            .style('font-weight', '500')
            .style('cursor', 'pointer')
            .style('transition', this.getAnimationDuration(150) === 0 ? 'none' : 'background 0.15s')
            .text(closeGuideLabel)
            .on('mouseover', function () {
                d3.select(this).style('background', UI_TOKENS.color.primary.hover);
            })
            .on('mouseout', function () {
                d3.select(this).style('background', UI_TOKENS.color.primary.default);
            })
            .on('click', () => this.hideHelpOverlay());

        // Close on backdrop click
        overlay.on('click', (event) => {
            if (event.target === overlay.node()) {
                this.hideHelpOverlay();
            }
        });

        this.helpOverlayKeydownHandler = (event: KeyboardEvent) => {
            if (!this.isHelpOverlayVisible) {
                return;
            }

            if (event.key === 'Escape') {
                event.preventDefault();
                this.hideHelpOverlay();
                return;
            }

            if (event.key !== 'Tab') {
                return;
            }

            const focusableElements = this.getHelpOverlayFocusableElements();
            if (focusableElements.length === 0) {
                event.preventDefault();
                (card.node() as HTMLElement | null)?.focus();
                return;
            }

            const activeElement = document.activeElement as HTMLElement | null;
            const firstElement = focusableElements[0];
            const lastElement = focusableElements[focusableElements.length - 1];

            if (event.shiftKey) {
                if (!activeElement || activeElement === firstElement || !overlay.node()?.contains(activeElement)) {
                    event.preventDefault();
                    lastElement.focus();
                }
                return;
            }

            if (!activeElement || activeElement === lastElement || !overlay.node()?.contains(activeElement)) {
                event.preventDefault();
                firstElement.focus();
            }
        };
        document.addEventListener('keydown', this.helpOverlayKeydownHandler);

        requestAnimationFrame(() => {
            (closeBtn.node() as HTMLButtonElement | null)?.focus();
        });
    }

    /**
     * Builds the help content sections using safe DOM manipulation
     */
    private buildHelpContent(container: Selection<HTMLDivElement, unknown, null, undefined>): void {
        const primaryColor = UI_TOKENS.color.primary.default;

        // Helper to create a section
        const createSection = (icon: string, title: string): Selection<HTMLDivElement, unknown, null, undefined> => {
            const section = container.append('div')
                .style('margin-bottom', '28px');

            const titleDiv = section.append('div')
                .style('font-size', '16px')
                .style('font-weight', '600')
                .style('color', primaryColor)
                .style('margin-bottom', '12px')
                .style('display', 'flex')
                .style('align-items', 'center')
                .style('gap', '8px');

            titleDiv.append('span').text(icon);
            titleDiv.append('span').text(title);

            return section;
        };

        // Helper to add a paragraph
        const addParagraph = (section: Selection<HTMLDivElement, unknown, null, undefined>, text: string): void => {
            section.append('p')
                .style('font-size', '13px')
                .style('margin-bottom', '8px')
                .text(text);
        };

        // Helper to add a subtitle
        const addSubtitle = (section: Selection<HTMLDivElement, unknown, null, undefined>, text: string): void => {
            section.append('div')
                .style('font-size', '14px')
                .style('font-weight', '600')
                .style('margin-bottom', '8px')
                .style('margin-top', '16px')
                .text(text);
        };

        // Helper to create a list
        const createList = (section: Selection<HTMLDivElement, unknown, null, undefined>): Selection<HTMLUListElement, unknown, null, undefined> => {
            return section.append('ul')
                .style('margin', '0')
                .style('padding-left', '20px')
                .style('font-size', '13px');
        };

        // Helper to add list items with bold label
        const addListItem = (list: Selection<HTMLUListElement, unknown, null, undefined>, label: string, description: string): void => {
            const li = list.append('li').style('margin-bottom', '6px');
            li.append('strong').text(label);
            li.append('span').text(' - ' + description);
        };

        // Helper to add simple list item
        const addSimpleListItem = (list: Selection<HTMLUListElement, unknown, null, undefined>, text: string): void => {
            list.append('li').style('margin-bottom', '6px').text(text);
        };

        // ========== Introduction ==========
        const introSection = createSection('📊', 'Welcome to the Longest Path Visual');
        addParagraph(introSection, 'This visual combines a task table, a schedule timeline, and interactive analysis tools so you can review critical path logic, float-based risk, comparisons, and grouped WBS views in one place.');
        addParagraph(introSection, 'Use the header to change the analysis mode, filter what is shown, turn comparison layers on or off, search for tasks, and export the current view.');

        // ========== Calculation Modes ==========
        const modeSection = createSection('🔄', 'Calculation Modes');
        addParagraph(modeSection, 'The visual supports two criticality methods. Use the LP / Float toggle in the header to switch between them.');

        addSubtitle(modeSection, 'Longest Path (CPM)');
        const cpmPara = modeSection.append('p')
            .style('font-size', '13px')
            .style('margin-bottom', '8px');
        cpmPara.text('Highlights the driving chain of dependent activities from start to finish using CPM-style relationship logic.');

        addSubtitle(modeSection, 'Float-Based');
        const floatPara = modeSection.append('p')
            .style('font-size', '13px')
            .style('margin-bottom', '8px');
        floatPara.text('Uses Total Float values instead of the driving chain. Tasks with zero or negative float are critical, and tasks above zero can also be highlighted as near-critical when the threshold is enabled. ');
        floatPara.append('span')
            .style('display', 'inline-block')
            .style('padding', '2px 8px')
            .style('border-radius', '4px')
            .style('font-size', '11px')
            .style('font-weight', '500')
            .style('background', UI_TOKENS.color.primary.light)
            .text('Default');

        const modeList = createList(modeSection);
        addListItem(modeList, 'Show All / Critical', 'Switch between the full schedule and a focused critical view. In Float mode, near-critical tasks can also stay highlighted when the threshold is enabled.');
        addListItem(modeList, 'Path Info', 'In Longest Path mode, the path chip can show the active driving path, total tasks, and duration. If multiple valid paths exist, you can step through them.');

        // ========== Header Controls ==========
        const headerSection = createSection('🧭', 'Header Controls');
        addParagraph(headerSection, 'The header is the main command area for changing what the visual displays.');
        const headerList = createList(headerSection);
        addListItem(headerList, 'Baseline', 'Show or hide baseline comparison bars and the baseline finish marker.');
        addListItem(headerList, 'Previous Update', 'Show or hide previous update comparison bars and the previous finish marker.');
        addListItem(headerList, 'Connector Lines', 'Show or hide relationship lines between linked tasks.');
        addListItem(headerList, 'Columns', 'Show or hide the date, duration, and float columns next to the WBS / task name column.');
        addListItem(headerList, 'WBS', 'Enable or disable hierarchical WBS grouping when WBS levels are available.');
        addListItem(headerList, 'Copy', 'Copy the visible rows to the clipboard in a format that can be pasted into Excel.');
        addListItem(headerList, 'HTML', 'Copy a formatted HTML export of the current visual to the clipboard, including the chart image and visible table.');
        addListItem(headerList, 'PDF', 'Export the current rendered view as a PDF document.');

        // ========== Task Selection & Tracing ==========
        const selectionSection = createSection('🎯', 'Task Selection & Path Tracing');
        addParagraph(selectionSection, 'Use the search field or click directly on bars and milestones to select a task, then trace the schedule around it.');
        const selectionList = createList(selectionSection);
        addListItem(selectionList, 'Task Search', 'Search by task ID or name, then choose a result from the dropdown list.');
        addListItem(selectionList, 'Trace Backward', 'Follow predecessors that drive into the selected task.');
        addListItem(selectionList, 'Trace Forward', 'Follow successors that flow out from the selected task.');
        addListItem(selectionList, 'Driving Path Navigation', 'When multiple best driving paths exist in Longest Path mode, use the path chip arrows to move between them.');

        const tipPara = selectionSection.append('p')
            .style('font-size', '13px')
            .style('margin-bottom', '8px');
        tipPara.append('strong').text('Tip: ');
        tipPara.append('span').text('Press Escape to clear the current selection, close the search dropdown, or close this help dialog.');

        // ========== WBS Grouping ==========
        const wbsSection = createSection('📁', 'WBS Grouping');
        addParagraph(wbsSection, 'When WBS fields are available, the visual can switch from a flat task list to grouped hierarchical rows.');
        const wbsList = createList(wbsSection);
        addListItem(wbsList, 'Group Headers', 'Each group row shows the WBS name, visible task count, and optional summary values.');
        addListItem(wbsList, 'Enable / Disable', 'Use the WBS button in the header to switch between grouped and flat task views.');
        addListItem(wbsList, 'Expand / Collapse Level', 'Use the + and − WBS buttons to cycle through grouping depth, from collapsed to fully expanded and back again.');
        addListItem(wbsList, 'Manual Open / Close', 'Click a group chevron to expand or collapse a single branch without changing the whole view.');

        const wbsNote = wbsSection.append('p')
            .style('font-size', '13px')
            .style('margin-bottom', '8px');
        wbsNote.append('strong').text('Note: ');
        wbsNote.append('span').text('Copy and export actions respect the current WBS state. If tasks are hidden because groups are collapsed, the visible WBS rows are exported instead.');

        // ========== Bars, Milestones & Lines ==========
        const timelineSection = createSection('📅', 'Bars, Milestones & Lines');
        addParagraph(timelineSection, 'The timeline combines current-task bars, optional comparison bars, milestones, and vertical reference lines.');
        const timelineList = createList(timelineSection);
        addListItem(timelineList, 'Current Task Bars', 'Show each task using the visual start and visual finish dates used by the current analysis mode.');
        addListItem(timelineList, 'Milestones', 'Milestones appear as diamonds at a single scheduled date.');
        addListItem(timelineList, 'Baseline / Previous Bars', 'When enabled, lighter comparison bars appear beneath the current task bar so you can compare plan, previous update, and current dates.');
        addListItem(timelineList, 'Finish & Reference Lines', 'Project Finish, Baseline Finish, Previous Finish, and Data Date can each draw a vertical line and label.');
        addListItem(timelineList, 'Data Date Override', 'When the before-data-date override is enabled in settings, the earlier portion of a task bar uses the override color while the remaining portion keeps the task state color.');

        // ========== Near Critical ==========
        const nearCriticalSection = createSection('⚠️', 'Near-Critical Analysis');
        addParagraph(nearCriticalSection, 'Near-critical highlighting is available in Float mode.');
        const nearCriticalList = createList(nearCriticalSection);
        addListItem(nearCriticalList, 'Threshold Chip', 'Use the Near-Critical control in the header to set the maximum Total Float value that should be treated as near-critical.');
        addListItem(nearCriticalList, 'Critical vs Near-Critical', 'Zero or negative float is critical. Values above zero and at or below the threshold are near-critical.');
        addListItem(nearCriticalList, 'Visual Priority', 'Near-critical tasks are intended to stand out from normal work without taking precedence over critical tasks.');

        // ========== Legend & Filtering ==========
        const legendSection = createSection('🎨', 'Legend & Filtering');
        addParagraph(legendSection, 'When a legend category field is bound and the legend is enabled, a legend rail appears at the bottom of the visual.');
        const legendList = createList(legendSection);
        addListItem(legendList, 'Click a Legend Chip', 'Filter the schedule to one category.');
        addListItem(legendList, 'Click Additional Chips', 'Add or remove more categories from the current filter.');
        addListItem(legendList, 'Show All', 'Reset the legend filter and show every category again.');
        addListItem(legendList, 'Scroll Arrows', 'Move left or right when there are more legend categories than can fit in the footer.');

        // ========== Zoom & Layout ==========
        const zoomSection = createSection('🔍', 'Zoom & Layout');
        const zoomList = createList(zoomSection);
        addListItem(zoomList, 'Bottom Range Slider', 'Focus on a smaller time window without changing the underlying data.');
        addListItem(zoomList, 'Drag Handles', 'Resize the visible time range by dragging the left or right slider handles.');
        addListItem(zoomList, 'Drag the Window', 'Pan across time by dragging the selected range between the handles.');
        addListItem(zoomList, 'Vertical Scroll', 'Use the mouse wheel or scrollbar to move through tasks.');
        addListItem(zoomList, 'Table / Timeline Divider', 'Drag the divider between the left table and the timeline to resize the task-name area.');

        // ========== Export & Copy ==========
        const exportSection = createSection('📋', 'Export & Copy');
        const exportList = createList(exportSection);
        addListItem(exportList, 'Copy Button', 'Copies the visible rows to the clipboard as plain text and HTML so you can paste into Excel or another document.');
        addListItem(exportList, 'HTML Button', 'Copies an HTML version of the current visual to the clipboard, including the chart image and visible table.');
        addListItem(exportList, 'PDF Button', 'Exports the current rendered view as a PDF.');

        const exportNote = exportSection.append('p')
            .style('font-size', '13px')
            .style('margin-bottom', '8px');
        exportNote.append('strong').text('Included data: ');
        exportNote.append('span').text('Exports use the currently visible schedule, preserve WBS structure when applicable, and include displayed float values and task types when those fields are available.');

        // ========== Warnings ==========
        const warningSection = createSection('🛡️', 'Warnings & Data Quality');
        addParagraph(warningSection, 'The visual can show warnings when some analysis results should be treated carefully.');
        const warningList = createList(warningSection);
        addListItem(warningList, 'CPM Safety Warning', 'If the schedule relationships are not safe for CPM-style tracing, the LP / Float mode control shows a warning indicator and explains that Longest Path analysis is unavailable.');
        addListItem(warningList, 'Plotted Date Warning', 'The banner can also warn when some tasks have invalid visual start / finish ranges and cannot be plotted normally.');
        addListItem(warningList, 'What to Check', 'Review relationship data, start / finish dates, and float inputs if the schedule does not behave as expected.');

        // ========== Tooltips ==========
        const tooltipSection = createSection('💬', 'Tooltips');
        addParagraph(tooltipSection, 'Hover over a task bar, milestone, or other plotted item to see more detail.');
        const tooltipList = createList(tooltipSection);
        addSimpleListItem(tooltipList, 'Task ID and task name');
        addSimpleListItem(tooltipList, 'Start, finish, and duration information');
        addSimpleListItem(tooltipList, 'Total Float and criticality status');
        addSimpleListItem(tooltipList, 'Additional project fields included in the bound data');

        // ========== Keyboard Shortcuts ==========
        const keyboardSection = createSection('⌨️', 'Keyboard Shortcuts');
        const keyboardList = createList(keyboardSection);
        addListItem(keyboardList, 'Escape', 'Close this help dialog, close the search dropdown, or clear the current selection when applicable.');
        addListItem(keyboardList, 'Tab', 'Move through interactive controls such as header buttons, the search box, and dialog actions.');
        addListItem(keyboardList, 'Enter / Space', 'Activate the currently focused control.');
    }

    /**
     * Hides the help overlay
     */
    private hideHelpOverlay(): void {
        this.isHelpOverlayVisible = false;
        this.clearHelpOverlay();
        if (this.helpOverlayReturnFocusTarget?.isConnected) {
            this.helpOverlayReturnFocusTarget.focus();
        }
        this.helpOverlayReturnFocusTarget = null;
    }

    /**
     * Clears the help overlay from the DOM
     */
    private clearHelpOverlay(): void {
        if (this.helpOverlayKeydownHandler) {
            document.removeEventListener('keydown', this.helpOverlayKeydownHandler);
            this.helpOverlayKeydownHandler = null;
        }
        if (this.helpOverlayContainer) {
            this.helpOverlayContainer.remove();
            this.helpOverlayContainer = null;
        }
        // Also remove by class in case state got out of sync
        d3.select(this.target).selectAll('.help-overlay').remove();
    }

    private getHelpOverlayFocusableElements(): HTMLElement[] {
        const overlayNode = this.helpOverlayContainer?.node();
        if (!overlayNode) {
            return [];
        }

        return Array.from(
            overlayNode.querySelectorAll<HTMLElement>(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            )
        ).filter(element => {
            if (element.hasAttribute('disabled')) {
                return false;
            }

            const style = window.getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden';
        });
    }

    private escapeHtml(value: string): string {
        return value
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    private sanitizeExportCell(value: unknown): string {
        return sanitizeExportTextField(value);
    }

    private getExportTaskTypeLabel(task: Task): string {
        return getExportTaskType(task);
    }

    private getExportFloatLabel(task: Task): string {
        return getExportFloatText(task, "");
    }

    private getExportCriticalValue(task: Task): boolean {
        return Number.isFinite(task.userProvidedTotalFloat)
            ? (task.userProvidedTotalFloat as number) <= 0
            : task.isCritical;
    }

    private getExportTableTasks(): Task[] {
        if (this.allTasksToShow && this.allTasksToShow.length > 0) {
            return this.allTasksToShow;
        }
        const visibleFilteredTasks = (this.allFilteredTasks || [])
            .filter(task => task.yOrder !== undefined)
            .sort((a, b) => (a.yOrder ?? 0) - (b.yOrder ?? 0));
        if (visibleFilteredTasks.length > 0) {
            return visibleFilteredTasks;
        }
        if (this.allFilteredTasks && this.allFilteredTasks.length > 0) {
            return this.allFilteredTasks;
        }
        return [];
    }

    private getVisibleExportWbsGroups(): WBSGroup[] {
        return (this.wbsGroups || [])
            .filter(group => group.yOrder !== undefined)
            .sort((a, b) => (a.yOrder ?? 0) - (b.yOrder ?? 0));
    }

    private generateFlatExportTableHtml(
        exportDateFormatter: (date: Date) => string,
        tasks: Task[]
    ): string {
        const maxWbsDepth = tasks.reduce((max, task) => Math.max(max, task.wbsLevels?.length || 0), 0);
        const headers = ["Index", "Task ID", "Task Name", "Task Type"];
        if (this.showBaselineInternal) headers.push("Baseline Start", "Baseline Finish");
        if (this.showPreviousUpdateInternal) headers.push("Previous Start", "Previous Finish");
        headers.push("Start Date", "Finish Date", "Duration", "Total Float", "Is Critical");
        for (let i = 0; i < maxWbsDepth; i++) headers.push(`WBS Level ${i + 1}`);

        let html = `<table border="1" cellspacing="0" cellpadding="2" style="border-collapse: collapse; width: 100%; font-family: 'Segoe UI', sans-serif; font-size: 11px; white-space: nowrap;">`;
        html += `<tr style="font-weight: bold; background-color: #f0f0f0;">${headers.map(header => `<th style="padding: 4px; white-space: nowrap;">${this.escapeHtml(header)}</th>`).join("")}</tr>`;

        tasks.forEach((task, index) => {
            const taskType = this.getExportTaskTypeLabel(task);
            const totalFloat = this.getExportFloatLabel(task);
            const isCritical = this.getExportCriticalValue(task);
            const visualStartDate = this.getVisualStart(task);
            const visualFinishDate = this.getVisualFinish(task);
            const taskId = this.sanitizeExportCell(task.id?.toString() || "");
            const taskName = this.sanitizeExportCell(task.name || "");

            html += `<tr>`;
            html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${index + 1}</td>`;
            html += `<td style="padding: 2px; white-space: nowrap;">${this.escapeHtml(taskId)}</td>`;
            html += `<td style="padding: 2px; white-space: nowrap;">${this.escapeHtml(taskName)}</td>`;
            html += `<td style="padding: 2px; white-space: nowrap;">${this.escapeHtml(taskType)}</td>`;

            if (this.showBaselineInternal) {
                html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${task.baselineStartDate ? exportDateFormatter(task.baselineStartDate) : ""}</td>`;
                html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${task.baselineFinishDate ? exportDateFormatter(task.baselineFinishDate) : ""}</td>`;
            }
            if (this.showPreviousUpdateInternal) {
                html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${task.previousUpdateStartDate ? exportDateFormatter(task.previousUpdateStartDate) : ""}</td>`;
                html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${task.previousUpdateFinishDate ? exportDateFormatter(task.previousUpdateFinishDate) : ""}</td>`;
            }

            html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${visualStartDate ? exportDateFormatter(visualStartDate) : ""}</td>`;
            html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${visualFinishDate ? exportDateFormatter(visualFinishDate) : ""}</td>`;
            html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${task.duration?.toString() || "0"}</td>`;
            html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${this.escapeHtml(totalFloat)}</td>`;
            html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${isCritical ? "Yes" : "No"}</td>`;

            for (let i = 0; i < maxWbsDepth; i++) {
                html += `<td style="padding: 2px; white-space: nowrap;">${this.escapeHtml(this.sanitizeExportCell(task.wbsLevels?.[i] || ""))}</td>`;
            }

            html += `</tr>`;
        });

        html += `</table>`;
        return html;
    }

    private generateFlatExportTableText(
        exportDateFormatter: (date: Date) => string,
        tasks: Task[]
    ): string {
        const maxWbsDepth = tasks.reduce((max, task) => Math.max(max, task.wbsLevels?.length || 0), 0);
        const headers = ["Index", "Task ID", "Task Name", "Task Type"];
        if (this.showBaselineInternal) headers.push("Baseline Start", "Baseline Finish");
        if (this.showPreviousUpdateInternal) headers.push("Previous Start", "Previous Finish");
        headers.push("Start Date", "Finish Date", "Duration", "Total Float", "Is Critical");
        for (let i = 0; i < maxWbsDepth; i++) headers.push(`WBS Level ${i + 1}`);

        const rows = tasks.map((task, index) => {
            const taskType = this.getExportTaskTypeLabel(task);
            const totalFloat = this.getExportFloatLabel(task);
            const isCritical = this.getExportCriticalValue(task);
            const visualStartDate = this.getVisualStart(task);
            const visualFinishDate = this.getVisualFinish(task);

            const row = [
                String(index + 1),
                this.sanitizeExportCell(task.id?.toString() || ""),
                this.sanitizeExportCell(task.name || ""),
                this.sanitizeExportCell(taskType)
            ];

            if (this.showBaselineInternal) {
                row.push(
                    task.baselineStartDate ? exportDateFormatter(task.baselineStartDate) : "",
                    task.baselineFinishDate ? exportDateFormatter(task.baselineFinishDate) : ""
                );
            }
            if (this.showPreviousUpdateInternal) {
                row.push(
                    task.previousUpdateStartDate ? exportDateFormatter(task.previousUpdateStartDate) : "",
                    task.previousUpdateFinishDate ? exportDateFormatter(task.previousUpdateFinishDate) : ""
                );
            }

            row.push(
                visualStartDate ? exportDateFormatter(visualStartDate) : "",
                visualFinishDate ? exportDateFormatter(visualFinishDate) : "",
                task.duration?.toString() || "0",
                totalFloat,
                isCritical ? "Yes" : "No"
            );

            for (let i = 0; i < maxWbsDepth; i++) {
                row.push(this.sanitizeExportCell(task.wbsLevels?.[i] || ""));
            }

            return row.map(value => this.sanitizeExportCell(value)).join('\t');
        });

        return [headers.join('\t'), ...rows].join('\n');
    }

    private generateVisibleWbsOnlyExportTableHtml(
        exportDateFormatter: (date: Date) => string,
        visibleWbsGroups: WBSGroup[]
    ): string {
        const hasBaseline = this.showBaselineInternal && visibleWbsGroups.some(group => group.summaryBaselineStartDate || group.summaryBaselineFinishDate);
        const hasPrevious = this.showPreviousUpdateInternal && visibleWbsGroups.some(group => group.summaryPreviousUpdateStartDate || group.summaryPreviousUpdateFinishDate);
        const hasFloat = visibleWbsGroups.some(group => typeof group.summaryTotalFloat === "number" && isFinite(group.summaryTotalFloat));

        let html = `<table border="1" cellspacing="0" cellpadding="2" style="border-collapse: collapse; width: 100%; font-family: 'Segoe UI', sans-serif; font-size: 11px; white-space: nowrap;">`;
        html += `<tr style="font-weight: bold; background-color: #f0f0f0;">`;
        html += `<th style="padding: 4px; white-space: nowrap;">Index</th>`;
        html += `<th style="padding: 4px; white-space: nowrap;">WBS Name</th>`;
        if (hasBaseline) {
            html += `<th style="padding: 4px; white-space: nowrap;">Baseline Start</th>`;
            html += `<th style="padding: 4px; white-space: nowrap;">Baseline Finish</th>`;
        }
        if (hasPrevious) {
            html += `<th style="padding: 4px; white-space: nowrap;">Previous Start</th>`;
            html += `<th style="padding: 4px; white-space: nowrap;">Previous Finish</th>`;
        }
        html += `<th style="padding: 4px; white-space: nowrap;">Start Date</th>`;
        html += `<th style="padding: 4px; white-space: nowrap;">Finish Date</th>`;
        if (hasFloat) {
            html += `<th style="padding: 4px; white-space: nowrap;">Total Float</th>`;
        }
        html += `</tr>`;

        visibleWbsGroups.forEach((group, index) => {
            const indent = Math.max(0, (group.level - 1) * (this.settings?.wbsGrouping?.indentPerLevel?.value || 20));
            const levelStyle = this.getWbsLevelStyle(
                group.level,
                this.settings?.wbsGrouping?.groupHeaderColor?.value?.value || "#F0F0F0",
                this.settings?.wbsGrouping?.groupNameColor?.value?.value || "#333333"
            );
            const bgColor = this.resolveColor(this.settings?.wbsGrouping?.groupHeaderColor?.value?.value || "#F7F8FA", "background");
            const textColor = this.resolveColor(levelStyle.text, "foreground");
            const accentColor = this.resolveColor(levelStyle.background, "foreground");

            html += `<tr style="background-color: ${bgColor}; color: ${textColor}; font-weight: bold;">`;
            html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${index + 1}</td>`;
            html += `<td style="padding: 2px; padding-left: ${indent + 8}px; white-space: nowrap; border-left: 4px solid ${accentColor};">${this.escapeHtml(this.sanitizeExportCell(this.getWbsDisplayName(group)))}</td>`;
            if (hasBaseline) {
                html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${group.summaryBaselineStartDate ? exportDateFormatter(group.summaryBaselineStartDate) : ""}</td>`;
                html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${group.summaryBaselineFinishDate ? exportDateFormatter(group.summaryBaselineFinishDate) : ""}</td>`;
            }
            if (hasPrevious) {
                html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${group.summaryPreviousUpdateStartDate ? exportDateFormatter(group.summaryPreviousUpdateStartDate) : ""}</td>`;
                html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${group.summaryPreviousUpdateFinishDate ? exportDateFormatter(group.summaryPreviousUpdateFinishDate) : ""}</td>`;
            }
            html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${group.summaryStartDate ? exportDateFormatter(group.summaryStartDate) : ""}</td>`;
            html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${group.summaryFinishDate ? exportDateFormatter(group.summaryFinishDate) : ""}</td>`;
            if (hasFloat) {
                html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${typeof group.summaryTotalFloat === "number" && isFinite(group.summaryTotalFloat) ? group.summaryTotalFloat.toFixed(0) : ""}</td>`;
            }
            html += `</tr>`;
        });

        html += `</table>`;
        return html;
    }

    private generateVisibleWbsOnlyExportTableText(
        exportDateFormatter: (date: Date) => string,
        visibleWbsGroups: WBSGroup[]
    ): string {
        const hasBaseline = this.showBaselineInternal && visibleWbsGroups.some(group => group.summaryBaselineStartDate || group.summaryBaselineFinishDate);
        const hasPrevious = this.showPreviousUpdateInternal && visibleWbsGroups.some(group => group.summaryPreviousUpdateStartDate || group.summaryPreviousUpdateFinishDate);
        const hasFloat = visibleWbsGroups.some(group => typeof group.summaryTotalFloat === "number" && isFinite(group.summaryTotalFloat));
        const headers = ["Index", "WBS Name"];
        if (hasBaseline) headers.push("Baseline Start", "Baseline Finish");
        if (hasPrevious) headers.push("Previous Start", "Previous Finish");
        headers.push("Start Date", "Finish Date");
        if (hasFloat) headers.push("Total Float");

        const rows = visibleWbsGroups.map((group, index) => {
            const row = [
                String(index + 1),
                this.sanitizeExportCell(this.getWbsDisplayName(group))
            ];
            if (hasBaseline) {
                row.push(
                    group.summaryBaselineStartDate ? exportDateFormatter(group.summaryBaselineStartDate) : "",
                    group.summaryBaselineFinishDate ? exportDateFormatter(group.summaryBaselineFinishDate) : ""
                );
            }
            if (hasPrevious) {
                row.push(
                    group.summaryPreviousUpdateStartDate ? exportDateFormatter(group.summaryPreviousUpdateStartDate) : "",
                    group.summaryPreviousUpdateFinishDate ? exportDateFormatter(group.summaryPreviousUpdateFinishDate) : ""
                );
            }
            row.push(
                group.summaryStartDate ? exportDateFormatter(group.summaryStartDate) : "",
                group.summaryFinishDate ? exportDateFormatter(group.summaryFinishDate) : ""
            );
            if (hasFloat) {
                row.push(typeof group.summaryTotalFloat === "number" && isFinite(group.summaryTotalFloat) ? group.summaryTotalFloat.toFixed(0) : "");
            }
            return row.map(value => this.sanitizeExportCell(value)).join('\t');
        });

        return [headers.join('\t'), ...rows].join('\n');
    }

    private generateVisibleExportTableHtml(): string {
        const exportDateFormatter = d3.timeFormat("%d-%b-%y");
        const showWbs = this.settings?.wbsGrouping?.enableWbsGrouping?.value ?? false;
        const tasks = this.getExportTableTasks();
        const visibleWbsGroups = this.getVisibleExportWbsGroups();
        const visibleTaskIds = new Set(tasks.map(task => task.internalId));
        const areTasksVisible = tasks.some(task => task.yOrder !== undefined);

        if (showWbs && !areTasksVisible && visibleWbsGroups.length > 0) {
            return this.generateVisibleWbsOnlyExportTableHtml(exportDateFormatter, visibleWbsGroups);
        }

        if (showWbs) {
            return this.generateWbsHierarchicalHtml(exportDateFormatter, tasks);
        }

        return this.generateFlatExportTableHtml(exportDateFormatter, tasks);
    }

    private generateVisibleExportTableText(): string {
        const exportDateFormatter = d3.timeFormat("%d-%b-%y");
        const showWbs = this.settings?.wbsGrouping?.enableWbsGrouping?.value ?? false;
        const tasks = this.getExportTableTasks();
        const visibleWbsGroups = this.getVisibleExportWbsGroups();
        const areTasksVisible = tasks.some(task => task.yOrder !== undefined);

        if (showWbs && !areTasksVisible && visibleWbsGroups.length > 0) {
            return this.generateVisibleWbsOnlyExportTableText(exportDateFormatter, visibleWbsGroups);
        }

        return this.generateFlatExportTableText(exportDateFormatter, tasks);
    }

    private generateClipboardExportMetadataFragment(): string {
        const timestamp = new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short'
        }).format(new Date());
        const selectedTaskBlock = this.selectedTaskName
            ? `<div style="margin-top: 4px;"><strong>Selected task:</strong> ${this.escapeHtml(this.selectedTaskName)}</div>`
            : "";

        return `<div style="margin-bottom: 12px; font-size: 13px; color: #555;">
<div><strong>Exported:</strong> ${this.escapeHtml(timestamp)}</div>
${selectedTaskBlock}
</div>`;
    }

    private generateClipboardTableExportFragment(tableHtml: string): string {
        return `<div style="font-family: 'Segoe UI', Arial, sans-serif; color: #1f1f1f; background: #ffffff;">
${this.generateClipboardExportMetadataFragment()}
<div>
${tableHtml}
</div>
</div>`;
    }

    private generateClipboardHtmlExportFragment(chartImageDataUrl: string, tableHtml: string): string {
        return `<div style="font-family: 'Segoe UI', Arial, sans-serif; color: #1f1f1f; background: #ffffff;">
${this.generateClipboardExportMetadataFragment()}
<div style="margin-bottom: 16px;">
<img src="${chartImageDataUrl}" alt="Exported Gantt chart" style="max-width: 100%; height: auto; border: 1px solid #d0d0d0;">
</div>
<div>
${tableHtml}
</div>
</div>`;
    }

    private async copyHtmlExportToClipboard(htmlContent: string, plainText: string): Promise<void> {
        if (navigator.clipboard && navigator.clipboard.write) {
            try {
                const data = [new ClipboardItem({
                    'text/html': new Blob([htmlContent], { type: 'text/html' }),
                    'text/plain': new Blob([plainText], { type: 'text/plain' })
                })];
                await navigator.clipboard.write(data);
                return;
            } catch (error) {
                console.warn('[HTML Export] Async clipboard write failed, trying fallback.', error);
            }
        }

        try {
            const handler = (event: ClipboardEvent) => {
                event.preventDefault();
                if (event.clipboardData) {
                    event.clipboardData.setData('text/html', htmlContent);
                    event.clipboardData.setData('text/plain', plainText);
                }
            };

            document.addEventListener('copy', handler);
            const success = document.execCommand('copy');
            document.removeEventListener('copy', handler);

            if (success) {
                return;
            }
        } catch (error) {
            console.warn('[HTML Export] Clipboard event fallback failed.', error);
        }

        const textArea = document.createElement('textarea');
        textArea.value = plainText;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.top = '0';
        document.body.appendChild(textArea);

        try {
            textArea.focus();
            textArea.select();
            const success = document.execCommand('copy');
            if (!success) {
                throw new Error('Clipboard copy failed');
            }
        } finally {
            document.body.removeChild(textArea);
        }
    }

    /**
     * Generates hierarchical HTML content for WBS export with colored group headers
     * and indented task names, matching the visual display layout.
     */
    private generateWbsHierarchicalHtml(
        exportDateFormatter: (date: Date) => string,
        tasks: Task[]
    ): string {
        const defaultGroupHeaderColor = this.settings?.wbsGrouping?.groupHeaderColor?.value?.value || "#F0F0F0";
        const defaultGroupNameColor = this.settings?.wbsGrouping?.groupNameColor?.value?.value || "#333333";
        const indentPerLevel = this.settings?.wbsGrouping?.indentPerLevel?.value || 20;

        // Calculate total columns for spanning (no WBS level columns in hierarchical mode)
        let totalColumns = 5; // Index, Task ID, Task Name, Task Type, Is Critical
        totalColumns += 4; // Start Date, Finish Date, Duration, Total Float
        if (this.showBaselineInternal) totalColumns += 2;
        if (this.showPreviousUpdateInternal) totalColumns += 2;

        let html = `<table border="1" cellspacing="0" cellpadding="2" style="border-collapse: collapse;">`;

        // HTML headers
        html += `<tr style="font-weight: bold; background-color: #f0f0f0;">`;
        html += `<th style="padding: 2px; white-space: nowrap;">Index</th>`;
        html += `<th style="padding: 2px; white-space: nowrap;">Task ID</th>`;
        html += `<th style="padding: 2px; white-space: nowrap;">Task Name</th>`;
        html += `<th style="padding: 2px; white-space: nowrap;">Task Type</th>`;
        if (this.showBaselineInternal) {
            html += `<th style="padding: 2px; white-space: nowrap;">Baseline Start</th>`;
            html += `<th style="padding: 2px; white-space: nowrap;">Baseline Finish</th>`;
        }
        if (this.showPreviousUpdateInternal) {
            html += `<th style="padding: 2px; white-space: nowrap;">Previous Start</th>`;
            html += `<th style="padding: 2px; white-space: nowrap;">Previous Finish</th>`;
        }
        html += `<th style="padding: 2px; white-space: nowrap;">Start Date</th>`;
        html += `<th style="padding: 2px; white-space: nowrap;">Finish Date</th>`;
        html += `<th style="padding: 2px; white-space: nowrap;">Duration</th>`;
        html += `<th style="padding: 2px; white-space: nowrap;">Total Float</th>`;
        html += `<th style="padding: 2px; white-space: nowrap;">Is Critical</th>`;
        html += `</tr>`;

        let rowIndex = 0;
        let previousLevels: string[] = [];

        for (const task of tasks) {
            rowIndex++;
            const taskType = this.getExportTaskTypeLabel(task);
            const totalFloat = this.getExportFloatLabel(task);
            const isCritical = this.getExportCriticalValue(task);
            const visualStartDate = this.getVisualStart(task);
            const visualFinishDate = this.getVisualFinish(task);
            const currentLevels = task.wbsLevels || [];

            let divergenceIndex = 0;
            while (
                divergenceIndex < previousLevels.length &&
                divergenceIndex < currentLevels.length &&
                previousLevels[divergenceIndex] === currentLevels[divergenceIndex]
            ) {
                divergenceIndex++;
            }

            for (let levelIndex = divergenceIndex; levelIndex < currentLevels.length; levelIndex++) {
                const pathId = currentLevels
                    .slice(0, levelIndex + 1)
                    .map((levelName, index) => `L${index + 1}:${levelName}`)
                    .join("|");
                const group = this.wbsGroupMap.get(pathId);
                const groupLevel = group?.level ?? (levelIndex + 1);
                const levelStyle = this.getWbsLevelStyle(groupLevel, defaultGroupHeaderColor, defaultGroupNameColor);
                const bgColor = this.resolveColor(defaultGroupHeaderColor, "background");
                const textColor = this.resolveColor(levelStyle.text, "foreground");
                const accentColor = this.resolveColor(levelStyle.background, "foreground");
                const indentPx = Math.max(0, levelIndex * indentPerLevel);
                const groupName = this.sanitizeExportCell(group ? this.getWbsDisplayName(group) : (currentLevels[levelIndex] || ""));
                const groupFloat = typeof group?.summaryTotalFloat === "number" && isFinite(group.summaryTotalFloat)
                    ? group.summaryTotalFloat.toFixed(0)
                    : "";

                html += `<tr style="background-color: ${bgColor}; color: ${textColor}; font-weight: bold;">`;
                html += `<td style="padding: 2px;"></td>`;
                html += `<td style="padding: 2px;"></td>`;
                html += `<td style="padding: 2px ${indentPx}px; white-space: nowrap; padding-left: ${indentPx + 8}px; border-left: 4px solid ${accentColor};">${this.escapeHtml(groupName)}</td>`;
                html += `<td style="padding: 2px;"></td>`;
                if (this.showBaselineInternal) {
                    html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${group?.summaryBaselineStartDate ? exportDateFormatter(group.summaryBaselineStartDate) : ""}</td>`;
                    html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${group?.summaryBaselineFinishDate ? exportDateFormatter(group.summaryBaselineFinishDate) : ""}</td>`;
                }
                if (this.showPreviousUpdateInternal) {
                    html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${group?.summaryPreviousUpdateStartDate ? exportDateFormatter(group.summaryPreviousUpdateStartDate) : ""}</td>`;
                    html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${group?.summaryPreviousUpdateFinishDate ? exportDateFormatter(group.summaryPreviousUpdateFinishDate) : ""}</td>`;
                }
                html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${group?.summaryStartDate ? exportDateFormatter(group.summaryStartDate) : ""}</td>`;
                html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${group?.summaryFinishDate ? exportDateFormatter(group.summaryFinishDate) : ""}</td>`;
                html += `<td style="padding: 2px;"></td>`;
                html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${groupFloat}</td>`;
                html += `<td style="padding: 2px;"></td>`;
                html += `</tr>`;
            }

            previousLevels = currentLevels;
            const taskIndentPx = currentLevels.length * indentPerLevel;
            const taskId = this.sanitizeExportCell(task.id?.toString() || "");
            const taskName = this.sanitizeExportCell(task.name || "");

            html += `<tr>`;
            html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${rowIndex}</td>`;
            html += `<td style="padding: 2px; white-space: nowrap;">${this.escapeHtml(taskId)}</td>`;
            html += `<td style="padding: 2px; white-space: nowrap; padding-left: ${taskIndentPx + 2}px;">${this.escapeHtml(taskName)}</td>`;
            html += `<td style="padding: 2px; white-space: nowrap;">${this.escapeHtml(taskType)}</td>`;

            if (this.showBaselineInternal) {
                html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${task.baselineStartDate ? exportDateFormatter(task.baselineStartDate) : ""}</td>`;
                html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${task.baselineFinishDate ? exportDateFormatter(task.baselineFinishDate) : ""}</td>`;
            }
            if (this.showPreviousUpdateInternal) {
                html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${task.previousUpdateStartDate ? exportDateFormatter(task.previousUpdateStartDate) : ""}</td>`;
                html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${task.previousUpdateFinishDate ? exportDateFormatter(task.previousUpdateFinishDate) : ""}</td>`;
            }

            html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${visualStartDate ? exportDateFormatter(visualStartDate) : ""}</td>`;
            html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${visualFinishDate ? exportDateFormatter(visualFinishDate) : ""}</td>`;
            html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${task.duration?.toString() || "0"}</td>`;
            html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${this.escapeHtml(totalFloat)}</td>`;
            html += `<td style="text-align: center; padding: 2px; white-space: nowrap;">${isCritical ? "Yes" : "No"}</td>`;
            html += `</tr>`;
        }

        html += `</table>`;
        return html;
    }

    /**
     * Copies the currently visible data to the clipboard in a format suitable for Excel.
     * Delegates to ClipboardExporter module for the actual export logic.
     * 
     * When WBS is enabled but no tasks are visible (WBS groups are collapsed),
     * exports the visible WBS groups "as-is" on the screen.
     */
    private async copyVisibleDataToClipboard(): Promise<void> {
        const tasks = this.getExportTableTasks();
        const visibleWbsGroups = this.getVisibleExportWbsGroups();
        const showWbs = this.settings?.wbsGrouping?.enableWbsGrouping?.value ?? false;
        const areTasksVisible = tasks.some(task => task.yOrder !== undefined);

        if (tasks.length === 0 && visibleWbsGroups.length === 0) {
            console.warn("No visible data to copy.");
            return;
        }

        try {
            const tableHtml = this.generateVisibleExportTableHtml();
            const plainText = this.generateVisibleExportTableText();
            const htmlContent = this.generateClipboardTableExportFragment(tableHtml);
            const copiedRowCount = showWbs && !areTasksVisible && visibleWbsGroups.length > 0
                ? visibleWbsGroups.length
                : tasks.length;

            await this.copyHtmlExportToClipboard(htmlContent, plainText);
            this.showCopySuccess(copiedRowCount);
        } catch (error) {
            console.error('Copy failed:', error);
            this.showToast('Copy failed. Please try again.', 4000);
        }
    }
    /**
     * Shows visual feedback when copy is successful
     * Uses non-blocking toast notification instead of alert()
     */
    private showCopySuccess(count: number): void {
        const message = `Copied ${count} rows to clipboard!`;
        this.debugLog(message);

        // Show visual feedback on the copy button via the Header component
        this.header?.showCopySuccess();

        // Show non-blocking toast instead of blocking alert()
        this.showToast(`${message} You can now paste into Excel.`);
    }

    /**
     * Displays a temporary, non-blocking toast notification overlay
     */
    private showToast(text: string, durationMs: number = 3000): void {
        const existing = this.target.querySelector('.copy-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'copy-toast';
        toast.textContent = text;
        Object.assign(toast.style, {
            position: 'absolute',
            bottom: '12px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.8)',
            color: '#fff',
            padding: '8px 16px',
            borderRadius: '6px',
            fontSize: '12px',
            fontFamily: "'Segoe UI', sans-serif",
            zIndex: '10000',
            pointerEvents: 'none',
            opacity: '0',
            transition: 'opacity 0.3s ease'
        });

        this.target.style.position = this.target.style.position || 'relative';
        this.target.appendChild(toast);

        // Trigger fade-in
        requestAnimationFrame(() => { toast.style.opacity = '1'; });

        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 350);
        }, durationMs);
    }

    private debugLog(...args: unknown[]): void {
        if (this.debug) {
            console.log(...args);
        }
    }

}













