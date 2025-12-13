import * as d3 from "d3";
import { timeFormat } from "d3-time-format";
import { timeMonth } from "d3-time";
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

import { VisualSettings } from "./settings";
import { FormattingSettingsService, formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import { IBasicFilter, FilterType } from "powerbi-models";
import FilterAction = powerbi.FilterAction;
import PriorityQueue from "./priorityQueue";

/**
 * ============================================================================
 * PERFORMANCE OPTIMIZATIONS - Phase 1 & Phase 2
 * ============================================================================
 *
 * This visual has been optimized for handling large datasets (10,000+ tasks)
 * with the following improvements:
 *
 * PHASE 1 - Quick Wins:
 * ----------------------
 * 1. Canvas Threshold Reduced: 500 → 250 tasks
 *    - Switches to high-performance canvas rendering earlier
 *    - Expected improvement: 40% faster for 250-500 task range
 *
 * 2. Render Throttling: 16ms minimum interval (~60 FPS)
 *    - Prevents render thrashing during rapid updates
 *    - Uses shouldRender() method to gate rendering calls
 *
 * 3. Data Transformation Optimization:
 *    - Pre-allocated arrays instead of dynamic growth
 *    - for...of loops instead of forEach (faster iteration)
 *    - Single-pass processing where possible
 *    - Expected improvement: 10-15% faster data processing
 *
 * 4. CPM Algorithm Optimization:
 *    - Converted forEach to for...of throughout
 *    - CPM memoization cache for repeated calculations
 *    - Expected improvement: 25-50% faster for complex networks
 *
 * PHASE 2 - Medium-Term Improvements:
 * ------------------------------------
 * 1. Virtual Scrolling Enhancement:
 *    - calculateVisibleRange() with buffer zones
 *    - Only renders visible tasks + buffer
 *    - Constant rendering time regardless of dataset size
 *    - Expected improvement: 75-85% faster, supports 10,000+ tasks
 *
 * 2. Render Caching:
 *    - Task position cache (renderCache.taskPositions)
 *    - Relationship path cache (renderCache.relationshipPaths)
 *    - Color computation cache (renderCache.colors)
 *    - Cache invalidation on data/settings changes
 *    - Expected improvement: 30-40% faster on repeated renders
 *
 * 3. Cache-Aware Color Computation:
 *    - getCachedTaskColor() avoids redundant calculations
 *    - Viewport key generation for cache invalidation
 *    - getViewportKey() for viewport-based cache management
 *
 * PERFORMANCE TARGETS:
 * --------------------
 * - 1,000 tasks:  < 100ms render time (was 400ms)
 * - 5,000 tasks:  < 300ms render time (was 2000ms)
 * - 10,000 tasks: < 400ms render time (was unusable)
 * - 60,000 tasks: < 1000ms render time (was crashes)
 *
 * KEY METHODS:
 * ------------
 * - shouldRender():           Render throttling gate
 * - getViewportKey():         Cache key generation
 * - invalidateRenderCache():  Clear caches on changes
 * - calculateVisibleRange():  Virtual scrolling calculation
 * - getCachedTaskColor():     Cached color computation
 *
 * See PERFORMANCE_ANALYSIS.md for detailed analysis and roadmap.
 * ============================================================================
 */

interface Task {
    id: string | number;
    internalId: string;
    name: string;
    type: string;
    duration: number;
    userProvidedTotalFloat?: number;
    taskFreeFloat?: number;  // NEW: Task Free Float value
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
    tooltipData?: Array<{key: string, value: PrimitiveValue}>;  // Array preserves field order
    legendValue?: string;       // Value from legend field for this task
    legendColor?: string;       // Assigned color for this legend value
    // WBS Grouping fields - dynamic array supporting any number of hierarchy levels
    wbsLevels?: string[];       // Array of WBS level values (ordered from highest to deepest)
    wbsGroupId?: string;        // Computed: concatenated WBS path for grouping
    wbsIndentLevel?: number;    // Computed: depth level for indentation (0-based)
}

// WBS Group interface for hierarchical grouping
interface WBSGroup {
    id: string;                 // Unique group identifier (e.g., "L1:Phase1|L2:Design")
    level: number;              // Hierarchy level (1-based, dynamic based on WBS columns added)
    name: string;               // Display name of this group level
    fullPath: string;           // Full WBS path for sorting
    parentId: string | null;    // Parent group's id (null for top-level)
    children: WBSGroup[];       // Child groups
    tasks: Task[];              // Direct tasks in this group
    allTasks: Task[];           // All tasks including children (computed)
    isExpanded: boolean;        // Current expansion state
    yOrder?: number;            // Y-position order in the visual (for layout)
    visibleTaskCount: number;   // Number of currently visible tasks after all filtering
    // Summary metrics (computed from all descendant tasks)
    summaryStartDate?: Date | null;
    summaryFinishDate?: Date | null;
    hasCriticalTasks: boolean;
    hasNearCriticalTasks?: boolean;
    taskCount: number;
    // Critical date range (for partial highlighting)
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
    type: string;              // FS, SS, FF, SF
    freeFloat: number | null;  // Optional free float value from data
    isCritical: boolean;       // Determined by numerical CPM based on float/driving logic
    lag: number | null; 
}

// Update type enumeration
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

    // *** Containers for sticky header and scrollable content ***
    private stickyHeaderContainer: Selection<HTMLDivElement, unknown, null, undefined>;
    private scrollableContainer: Selection<HTMLDivElement, unknown, null, undefined>;
    private headerSvg: Selection<SVGSVGElement, unknown, null, undefined>;
    private mainSvg: Selection<SVGSVGElement, unknown, null, undefined>;

    private mainGroup: Selection<SVGGElement, unknown, null, undefined>;
    private gridLayer: Selection<SVGGElement, unknown, null, undefined>;
    private arrowLayer: Selection<SVGGElement, unknown, null, undefined>;
    private taskLayer: Selection<SVGGElement, unknown, null, undefined>;
    private chartClipPath: Selection<SVGClipPathElement, unknown, null, undefined>;
    private chartClipRect: Selection<SVGRectElement, unknown, null, undefined>;
    private toggleButtonGroup: Selection<SVGGElement, unknown, null, undefined>;
    private headerGridLayer: Selection<SVGGElement, unknown, null, undefined>;
    private tooltipDiv: Selection<HTMLDivElement, unknown, HTMLElement, any>;
    private canvasElement: HTMLCanvasElement | null = null;
    private canvasContext: CanvasRenderingContext2D | null = null;
    private useCanvasRendering: boolean = false;
    private CANVAS_THRESHOLD: number = 250; // Switch to canvas when more than 250 tasks (Phase 1 optimization)
    private canvasLayer: Selection<HTMLCanvasElement, unknown, null, undefined>;

    // --- Data properties remain the same ---
    private allTasksData: Task[] = [];
    private relationships: Relationship[] = [];
    private taskIdToTask: Map<string, Task> = new Map();
    private taskIdQueryName: string | null = null;
    private taskIdTable: string | null = null;
    private taskIdColumn: string | null = null;
    private lastUpdateOptions: VisualUpdateOptions | null = null;

    // Connect lines toggle state and group
    private showConnectorLinesInternal: boolean = true;
    private connectorToggleGroup: Selection<SVGGElement, unknown, null, undefined>;

    // WBS expand/collapse toggle state
    private wbsExpandedInternal: boolean = true;

    // --- State properties remain the same ---
    private showAllTasksInternal: boolean = true;
    private showBaselineInternal: boolean = true;
    private showPreviousUpdateInternal: boolean = true;
    private isInitialLoad: boolean = true;

    // Debug flag to control verbose logging
    private debug: boolean = false;

    // --- Configuration/Constants ---
    private margin = { top: 10, right: 100, bottom: 40, left: 280 };
    private headerHeight = 110;
    private legendFooterHeight = 60;  // Fixed height for legend footer
    private dateLabelOffset = 8;
    private floatTolerance = 0.001;
    private defaultMaxTasks = 500;
    private labelPaddingLeft = 10;
    private dateBackgroundPadding = { horizontal: 6, vertical: 3 };  // UPGRADED: Increased from {4, 2} for better spacing
    private taskLabelLineHeight = "1.1em";
    private minTaskWidthPixels = 1;
    private monthYearFormatter = timeFormat("%b-%y");
    private dataDate: Date | null = null;

    // --- Store scales ---
    private xScale: ScaleTime<number, number> | null = null;
    private yScale: ScaleBand<string> | null = null;

    // --- Task selection ---
    private selectedTaskId: string | null = null;
    private selectedTaskName: string | null = null;
    private dropdownContainer: Selection<HTMLDivElement, unknown, null, undefined>;
    private dropdownInput: Selection<HTMLInputElement, unknown, null, undefined>;
    private dropdownList: Selection<HTMLDivElement, unknown, null, undefined>;
    private marginResizer: Selection<HTMLDivElement, unknown, null, undefined>;
    private selectedTaskLabel: Selection<HTMLDivElement, unknown, null, undefined>;
    private pathInfoLabel: Selection<HTMLDivElement, unknown, null, undefined>;

    private traceMode: string = "backward"; // Default to "backward"

    private floatThresholdInput: Selection<HTMLInputElement, unknown, null, undefined>;
    private floatThreshold: number = 0;
    private showNearCritical: boolean = true;

    private viewportStartIndex: number = 0;     // First visible task index
    private viewportEndIndex: number = 0;       // Last visible task index
    private visibleTaskCount: number = 0;       // Number of tasks to render
    private taskTotalCount: number = 0;         // Total number of tasks
    private taskElementHeight: number = 0;      // Height of a single task element with padding
    private scrollThrottleTimeout: any | null = null;
    private scrollListener: any;                // Reference to scroll event handler
    private allTasksToShow: Task[] = [];        // Store full task list to avoid reprocessing
    private allFilteredTasks: Task[] = [];      // All filtered tasks (before collapse/expand) for project end date

    // Update type detection
    private lastViewport: IViewport | null = null;
    private lastDataViewId: string | null = null;

    // Performance monitoring
    private renderStartTime: number = 0;
    
    // Enhanced data structures for performance
    private predecessorIndex: Map<string, Set<string>> = new Map(); // taskId -> Set of tasks that have this as predecessor

    // Legend properties
    private legendDataExists: boolean = false;
    private legendColorMap: Map<string, string> = new Map(); // legendValue -> color
    private legendCategories: string[] = []; // Unique legend values in order
    private legendFieldName: string = ""; // Name of the legend field
    private legendContainer: Selection<HTMLDivElement, unknown, null, undefined>; // Legend UI container
    private selectedLegendCategories: Set<string> = new Set(); // Empty set = all selected (no filter)
    private legendSelectionIds: Map<string, powerbi.visuals.ISelectionId> = new Map(); // Category -> SelectionId for color persistence (Pillar 2)

    // WBS Grouping properties
    private wbsDataExists: boolean = false;
    private wbsDataExistsInMetadata: boolean = false;           // WBS columns exist in dataView metadata (for button visibility)
    private wbsLevelColumnIndices: number[] = [];               // Column indices for WBS level fields (ordered)
    private wbsLevelColumnNames: string[] = [];                 // Column display names for WBS levels (for UI)
    private wbsGroups: WBSGroup[] = [];                         // Flat list of all WBS groups
    private wbsGroupMap: Map<string, WBSGroup> = new Map();     // groupId -> WBSGroup for quick lookup
    private wbsRootGroups: WBSGroup[] = [];                     // Top-level groups (Level 1)
    private wbsExpandedState: Map<string, boolean> = new Map(); // Persisted expand/collapse state
    private wbsExpandToLevel: number | null | undefined = undefined; // null = expand all, 0 = collapse all, number = expand to depth
    private wbsAvailableLevels: number[] = [];                  // Unique WBS levels detected in data
    private wbsManualExpansionOverride: boolean = false;        // When true, honor per-group manual expansion even if global toggle is collapsed
    private wbsManuallyToggledGroups: Set<string> = new Set();  // BUG-007 FIX: Track which groups have been manually toggled
    private wbsGroupLayer: Selection<SVGGElement, unknown, null, undefined>; // SVG layer for group headers
    private lastExpandCollapseAllState: boolean | null = null;  // Track expand/collapse all toggle state

    // Tooltip properties
    private tooltipDebugLogged: boolean = false; // Flag to log tooltip column info only once

    private relationshipIndex: Map<string, Relationship[]> = new Map(); // Quick lookup for relationships by successorId

    // Multi-path support: store all driving chains
    private allDrivingChains: Array<{
        tasks: Set<string>,
        relationships: Relationship[],
        totalDuration: number,
        startingTask: Task | null
    }> = [];
    private selectedPathIndex: number = 0; // 0-based index into allDrivingChains

    private readonly VIEWPORT_CHANGE_THRESHOLD = 0.3; // 30% change triggers full recalculation
    private forceFullUpdate: boolean = false;
    private preserveScrollOnUpdate: boolean = false; // When true, scroll position is preserved during full update
    private preservedScrollTop: number | null = null; // Strict scroll preservation: exact scrollTop to restore after update
    private scrollPreservationUntil: number = 0; // Timestamp until which scroll should be preserved (handles Power BI re-triggers)
    private wbsToggleScrollAnchor: { groupId: string; visualOffset: number } | null = null; // Track WBS group position for scroll adjustment

    private visualTitle: Selection<HTMLDivElement, unknown, null, undefined>;
    private tooltipClassName: string;
    private isUpdating: boolean = false;
    private isMarginDragging: boolean = false; // BUG-008 FIX: Track margin drag state to prevent update conflicts
    private scrollHandlerBackup: any = null;

    private updateDebounceTimeout: any = null;
    private pendingUpdate: VisualUpdateOptions | null = null;
    private readonly UPDATE_DEBOUNCE_MS = 100;
    private renderState: {
    isRendering: boolean;
    lastRenderMode: 'canvas' | 'svg' | null;
    lastTaskCount: number;
} = {
    isRendering: false,
    lastRenderMode: null,
    lastTaskCount: 0
};

    // Phase 1 & 2: Performance optimizations
    private lastRenderTime: number = 0;
    private readonly MIN_RENDER_INTERVAL: number = 16; // ~60 FPS

    // Phase 2: Virtual scrolling
    private virtualScrollEnabled: boolean = true;
    private scrollContainer: HTMLElement | null = null;

    // Phase 2: Render cache
    private renderCache: {
        taskPositions: Map<string, {x: number, y: number, width: number}>;
        relationshipPaths: Map<string, string>;
        lastViewportKey: string;
        colors: Map<string, string>;
    } = {
        taskPositions: new Map(),
        relationshipPaths: new Map(),
        lastViewportKey: "",
        colors: new Map()
    };

    // Phase 2: CPM memoization
    private cpmMemo: Map<string, number> = new Map();

    // ============================================================================
    // TIMELINE ZOOM SLIDER - Microsoft-style axis zoom control
    // ============================================================================
    private zoomSliderContainer: Selection<HTMLDivElement, unknown, null, undefined>;
    private zoomSliderTrack: Selection<HTMLDivElement, unknown, null, undefined>;
    private zoomSliderSelection: Selection<HTMLDivElement, unknown, null, undefined>;
    private zoomSliderLeftHandle: Selection<HTMLDivElement, unknown, null, undefined>;
    private zoomSliderRightHandle: Selection<HTMLDivElement, unknown, null, undefined>;
    private zoomSliderMiniChart: Selection<HTMLCanvasElement, unknown, null, undefined>;

    // Zoom state (0-1 percentages of the full timeline)
    private zoomRangeStart: number = 0;     // 0 = start of full timeline
    private zoomRangeEnd: number = 1;       // 1 = end of full timeline
    private fullTimelineDomain: [Date, Date] | null = null;  // Store full domain for reference
    private isZoomSliderDragging: boolean = false;
    private zoomDragType: 'left' | 'right' | 'middle' | null = null;
    private zoomDragStartX: number = 0;
    private zoomDragStartLeft: number = 0;
    private zoomDragStartRight: number = 0;
    private zoomSliderEnabled: boolean = true;
    private readonly ZOOM_SLIDER_MIN_RANGE: number = 0.02; // Minimum 2% of timeline visible

    // ============================================================================
    // DESIGN TOKENS - Professional UI System (Fluent Design 2)
    // ============================================================================
    private readonly UI_TOKENS = {
        // Heights - Standardized for consistency and touch-friendliness
        height: {
            compact: 24,    // Minimal toggles
            standard: 32,   // Default for most controls (upgraded from 28 for better touch targets)
            comfortable: 36 // Prominent controls (inputs, navigation)
        },

        // Border Radius - Modern, cohesive appearance with refined radii
        radius: {
            small: 3,       // Inner elements, inputs
            medium: 8,      // Standard buttons (upgraded from 6 for smoother look)
            large: 16,      // Pill-shaped toggles (upgraded from 14)
            pill: 20,       // Large pill containers (upgraded from 16)
            full: 9999      // Perfect circles
        },

        // Spacing - Enhanced 4px grid system with better distribution
        spacing: {
            xs: 4,
            sm: 6,
            md: 10,         // Upgraded from 8 for better breathing room
            lg: 14,         // Upgraded from 12
            xl: 18,         // Upgraded from 16
            xxl: 24         // Upgraded from 20 for better header spacing
        },

        // Typography - Professional hierarchy with refined sizes
        fontSize: {
            xs: 10,
            sm: 11,
            md: 12,
            lg: 13,
            xl: 14          // New size for prominent labels
        },

        fontWeight: {
            normal: 400,
            medium: 500,
            semibold: 600,
            bold: 700
        },

        // Colors - Enhanced Microsoft Fluent 2 Design System with refined palette
        color: {
            primary: {
                default: '#0078D4',
                hover: '#106EBE',
                pressed: '#005A9E',
                light: '#DEECF9',        // Refined from #E6F2FA for better contrast
                lighter: '#EFF6FC',      // Refined from #F3F9FD
                subtle: '#F3F9FD'        // New: very subtle backgrounds
            },
            warning: {
                default: '#F7A800',
                hover: '#E09200',
                pressed: '#C87E00',
                light: '#FFF4CE',        // Refined from #FFF9E6 for better visibility
                lighter: '#FFFAED',      // Refined from #FFFCF3
                subtle: '#FFFCF8'        // New: very subtle backgrounds
            },
            success: {
                default: '#107C10',
                hover: '#0E6B0E',
                pressed: '#0C5A0C',
                light: '#DFF6DD',        // Refined from #E6F4E6 for better contrast
                lighter: '#F1FAF1',      // Refined from #F3FAF3
                subtle: '#F7FDF7'        // New: very subtle backgrounds
            },
            danger: {
                default: '#D13438',
                hover: '#B82E31',
                pressed: '#A0272A',
                light: '#FDE7E9',
                lighter: '#FEF4F5',
                subtle: '#FFF9FA'        // New: very subtle backgrounds
            },
            neutral: {
                black: '#201F1E',
                grey190: '#201F1E',
                grey160: '#323130',
                grey140: '#484644',      // New: better gradation
                grey130: '#605E5C',
                grey90: '#A19F9D',
                grey60: '#C8C6C4',
                grey40: '#D2D0CE',       // New: lighter border option
                grey30: '#EDEBE9',
                grey20: '#F3F2F1',
                grey10: '#FAF9F8',
                grey5: '#FCFCFC',        // New: ultra-light backgrounds
                white: '#FFFFFF'
            }
        },

        // Shadows - Enhanced Fluent elevation system with more refined shadows
        shadow: {
            1: '0 0.5px 1px rgba(0, 0, 0, 0.08)',                                          // New: subtle shadow
            2: '0 1px 2px rgba(0, 0, 0, 0.08), 0 0.5px 1px rgba(0, 0, 0, 0.04)',         // Enhanced
            4: '0 2px 4px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06)',            // Enhanced
            8: '0 4px 8px rgba(0, 0, 0, 0.12), 0 2px 4px rgba(0, 0, 0, 0.08)',           // Enhanced
            16: '0 8px 16px rgba(0, 0, 0, 0.14), 0 4px 8px rgba(0, 0, 0, 0.1)',          // Enhanced
            24: '0 12px 24px rgba(0, 0, 0, 0.16), 0 6px 12px rgba(0, 0, 0, 0.12)'        // New: dramatic elevation
        },

        // Motion - Professional, smooth animations with refined easing
        motion: {
            duration: {
                instant: 0,
                fast: 120,      // Upgraded from 100 for smoother feel
                normal: 200,    // Upgraded from 150 for more polished transitions
                slow: 350,      // Upgraded from 300
                slower: 500
            },
            easing: {
                standard: 'cubic-bezier(0.4, 0, 0.2, 1)',          // Material Design standard
                decelerate: 'cubic-bezier(0, 0, 0.2, 1)',          // Entering elements
                accelerate: 'cubic-bezier(0.4, 0, 1, 1)',          // Exiting elements
                sharp: 'cubic-bezier(0.4, 0, 0.6, 1)',             // Quick, decisive
                smooth: 'cubic-bezier(0.4, 0.14, 0.3, 1)'          // New: extra smooth for premium feel
            }
        }
    };

    // ============================================================================
    // RESPONSIVE LAYOUT SYSTEM - Viewport-aware button sizing and positioning
    // ============================================================================
    private readonly LAYOUT_BREAKPOINTS = {
        wide: 850,      // Full labels on all buttons
        medium: 650,    // Shorter labels, compact spacing
        narrow: 0       // Icon-only for secondary buttons
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
        baseline: { x: number; width: number; iconOnly: boolean };
        previousUpdate: { x: number; width: number; iconOnly: boolean };
        connectorLines: { x: number; size: number };
        wbsExpandToggle: { x: number; size: number };
        wbsCollapseToggle: { x: number; size: number };
        gap: number;
    } {
        const mode = this.getLayoutMode(viewportWidth);
        const gap = mode === 'wide' ? 12 : (mode === 'medium' ? 8 : 6);
        const iconButtonSize = 36;
        let x = 10; // Starting position

        // Show All/Critical button
        const showAllWidth = mode === 'narrow' ? 100 : 140;
        const showAllCritical = { x, width: showAllWidth, showText: true };
        x += showAllWidth + gap;

        // Mode Toggle (LP/Float)
        const modeWidth = mode === 'wide' ? 150 : (mode === 'medium' ? 130 : 110);
        const modeToggle = { x, width: modeWidth, showFullLabels: mode === 'wide' };
        x += modeWidth + gap;

        // Baseline button - icon-only in narrow mode
        const baselineIconOnly = mode === 'narrow';
        const baselineWidth = baselineIconOnly ? iconButtonSize : (mode === 'medium' ? 90 : 110);
        const baseline = { x, width: baselineWidth, iconOnly: baselineIconOnly };
        x += baselineWidth + gap;

        // Previous Update button - icon-only in narrow mode
        const prevIconOnly = mode === 'narrow';
        const prevWidth = prevIconOnly ? iconButtonSize : (mode === 'medium' ? 90 : 120);
        const previousUpdate = { x, width: prevWidth, iconOnly: prevIconOnly };
        x += prevWidth + gap;

        // Connector Lines button (always icon-only)
        const connectorLines = { x, size: iconButtonSize };
        x += iconButtonSize + gap;

        // WBS Toggle buttons (always icon-only)
        const wbsExpandToggle = { x, size: iconButtonSize };
        x += iconButtonSize + gap;
        const wbsCollapseToggle = { x, size: iconButtonSize };

        return {
            mode,
            showAllCritical,
            modeToggle,
            baseline,
            previousUpdate,
            connectorLines,
            wbsExpandToggle,
            wbsCollapseToggle,
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

        // Dropdown width respects formatting setting with sensible bounds per viewport
        const defaultWidth = mode === 'wide' ? 350 : (mode === 'medium' ? 280 : 200);
        const configuredWidth = this.settings?.taskSelection?.dropdownWidth?.value ?? defaultWidth;
        const minWidth = 150;
        const maxWidth = Math.max(minWidth, viewportWidth - 20); // leave breathing room on edges
        const dropdownWidth = Math.min(Math.max(configuredWidth, minWidth), maxWidth);

        // Horizontal position follows formatting setting (left/center/right)
        const position = this.settings?.taskSelection?.dropdownPosition?.value?.value || "left";
        const horizontalPadding = 10;
        const maxLeft = Math.max(horizontalPadding, viewportWidth - dropdownWidth - horizontalPadding);
        let dropdownLeft = horizontalPadding;

        if (position === "center") {
            dropdownLeft = (viewportWidth - dropdownWidth) / 2;
        } else if (position === "right") {
            dropdownLeft = viewportWidth - dropdownWidth - horizontalPadding;
        }

        // Clamp to keep the control inside the header
        dropdownLeft = Math.max(horizontalPadding, Math.min(dropdownLeft, maxLeft));

        // Trace mode toggle positioned after dropdown with gap
        const traceGap = 20;
        const approxTraceWidth = 180; // keep toggle visible even when dropdown is large
        const maxTraceLeft = Math.max(horizontalPadding, viewportWidth - approxTraceWidth);
        const traceModeLeft = Math.min(dropdownLeft + dropdownWidth + traceGap, maxTraceLeft);

        // Float threshold control max width
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
    this.formattingSettingsService = new FormattingSettingsService();

    this.showAllTasksInternal = true;
    // Initialize baseline internal state. Will be synced in first update.
    this.showBaselineInternal = true;
    this.showPreviousUpdateInternal = true;
    this.isInitialLoad = true;
    this.floatThreshold = 0;
    this.showConnectorLinesInternal = true;
    this.wbsExpandedInternal = true;
    
    // Generate unique tooltip class name
    this.tooltipClassName = `critical-path-tooltip-${Date.now()}`;

    // --- Overall wrapper ---
    // Use flexbox layout for proper stacking of header, content, slider, and legend
    const visualWrapper = d3.select(this.target).append("div")
        .attr("class", "visual-wrapper")
        .style("height", "100%")
        .style("width", "100%")
        .style("overflow", "hidden")
        .style("display", "flex")
        .style("flex-direction", "column");

    // --- Sticky Header Container ---
    this.stickyHeaderContainer = visualWrapper.append("div")
        .attr("class", "sticky-header-container")
        .style("position", "sticky")
        .style("top", "0")
        .style("left", "0")
        .style("width", "100%")
        .style("height", `${this.headerHeight}px`)
        .style("min-height", `${this.headerHeight}px`)
        .style("flex-shrink", "0")  // Don't shrink the header
        .style("z-index", "100")  // High z-index to ensure it's always above resizer
        .style("background-color", "white")  // Solid background to cover anything behind it
        .style("overflow", "visible");

    // --- SVG for Header Elements ---
    this.headerSvg = this.stickyHeaderContainer.append("svg")
        .attr("class", "header-svg")
        .attr("width", "100%")
        .attr("height", "100%");

    // --- Group within header SVG for labels ---
    this.headerGridLayer = this.headerSvg.append("g")
        .attr("class", "header-grid-layer");

    // --- Group for Toggle Button within header SVG ---
    this.toggleButtonGroup = this.headerSvg.append("g")
        .attr("class", "toggle-button-group")
        .style("cursor", "pointer");
        
    // --- Task Selection Dropdown ---
    this.dropdownContainer = this.stickyHeaderContainer.append("div")
        .attr("class", "task-selection-dropdown-container")
        .style("position", "absolute")
        .style("top", "10px")
        .style("left", "150px")
        .style("z-index", "20")
        .style("display", "none");

    this.dropdownInput = this.dropdownContainer.append("input")
        .attr("type", "text")
        .attr("class", "task-selection-input")
        .attr("placeholder", "Search for a task...")
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
    
    // --- Create modern Float Threshold control ---
    this.createFloatThresholdControl();

    // --- Selected Task Label ---
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

    // --- Driving Path Info Label (Path Selection Control) ---
    // UPGRADED: Professional path selection control with enhanced design
    this.pathInfoLabel = this.stickyHeaderContainer.append("div")
        .attr("class", "path-info-label")
        .style("position", "absolute")
        .style("top", "6px")  // Updated for better alignment
        .style("right", "10px")
        .style("height", `${this.UI_TOKENS.height.standard}px`)  // Using design tokens
        .style("padding", `0 ${this.UI_TOKENS.spacing.lg}px`)
        .style("display", "none")
        .style("align-items", "center")
        .style("gap", `${this.UI_TOKENS.spacing.md}px`)
        .style("background-color", this.UI_TOKENS.color.neutral.white)
        .style("border", `2px solid ${this.UI_TOKENS.color.primary.default}`)  // Heavier border
        .style("border-radius", `${this.UI_TOKENS.radius.pill}px`)  // More rounded
        .style("box-shadow", this.UI_TOKENS.shadow[4])  // Better shadow
        .style("font-family", "Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif")
        .style("font-size", `${this.UI_TOKENS.fontSize.md}px`)
        .style("color", this.UI_TOKENS.color.primary.default)
        .style("font-weight", "600")  // Bolder
        .style("letter-spacing", "0.2px")
        .style("white-space", "nowrap")
        .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

    // --- Scrollable Container for main chart content ---
    // Uses flex: 1 to take remaining space after header, slider, and legend
    this.scrollableContainer = visualWrapper.append("div")
        .attr("class", "criticalPathContainer")
        .style("flex", "1")  // Take remaining space in flexbox
        .style("min-height", "0")  // Allow flex child to shrink below content size
        .style("overflow-anchor", "none")  // CRITICAL: Disable browser scroll anchoring to prevent scroll jumping
        .style("width", "100%")
        .style("overflow-y", "auto")
        .style("overflow-x", "hidden")
        .style("padding-top", `0px`);

    // --- Main SVG for the chart content ---
    this.mainSvg = this.scrollableContainer.append("svg")
        .classed("criticalPathVisual", true)
        .style("display", "block");

    // --- Group for chart content ---
    this.mainGroup = this.mainSvg.append("g").classed("main-group", true);

    // --- SVG ClipPath for chart area (prevents bars from rendering past left margin when zoomed) ---
    const defs = this.mainSvg.append("defs");
    this.chartClipPath = defs.append("clipPath")
        .attr("id", "chart-area-clip");
    this.chartClipRect = this.chartClipPath.append("rect")
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", 1000)  // Will be updated in setupTimeBasedSVGAndScales
        .attr("height", 10000);

    // --- Layers within the main SVG ---
    this.gridLayer = this.mainGroup.append("g").attr("class", "grid-layer");
    this.arrowLayer = this.mainGroup.append("g")
        .attr("class", "arrow-layer")
        .attr("clip-path", "url(#chart-area-clip)");
    this.taskLayer = this.mainGroup.append("g")
        .attr("class", "task-layer")
        .attr("clip-path", "url(#chart-area-clip)");

    // --- Timeline Zoom Slider Container (Microsoft-style axis zoom) ---
    // Created BEFORE legend so it appears above the legend in the visual
    this.createZoomSliderUI(visualWrapper);

    // --- Sticky Legend Footer Container (similar to header) ---
    // Positioned at the very bottom of the visual
    this.legendContainer = visualWrapper.append("div")
        .attr("class", "sticky-legend-footer")
        .style("width", "100%")
        .style("height", `${this.legendFooterHeight}px`)
        .style("min-height", `${this.legendFooterHeight}px`)
        .style("flex-shrink", "0")  // Don't shrink the legend
        .style("z-index", "100")
        .style("background-color", "white")
        .style("border-top", "2px solid #e0e0e0")
        .style("box-shadow", "0 -2px 4px rgba(0,0,0,0.1)")
        .style("display", "none")
        .style("overflow", "hidden");

    // --- Canvas layer for high-performance rendering ---
    this.canvasElement = document.createElement('canvas');
    this.canvasElement.style.position = 'absolute';
    this.canvasElement.style.pointerEvents = 'auto';
    this.canvasElement.className = 'canvas-layer';
    this.canvasElement.style.display = 'none';
    this.canvasElement.style.visibility = 'hidden';

    // Critical rendering optimizations for published mode
    this.canvasElement.style.imageRendering = '-webkit-optimize-contrast';
    this.canvasElement.style.imageRendering = 'crisp-edges';
    (this.canvasElement.style as any).msInterpolationMode = 'nearest-neighbor';
    this.canvasElement.style.transform = 'translate3d(0,0,0)'; // Force GPU layer
    this.canvasElement.style.backfaceVisibility = 'hidden';
    this.canvasElement.style.webkitBackfaceVisibility = 'hidden';
    this.canvasElement.style.willChange = 'transform';
    this.canvasElement.style.perspective = '1000px';

    // Add canvas to the scrollable container
    this.scrollableContainer.node()?.appendChild(this.canvasElement);

    // Create D3 selection for the canvas
    this.canvasLayer = d3.select(this.canvasElement);

    // Apply publish mode optimizations
    this.applyPublishModeOptimizations();

    // --- Tooltip with improved styling ---
    // Remove any existing tooltips from this instance
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

    // ACCESSIBILITY: Create ARIA live region for screen reader announcements
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

    // Initialize trace mode
    this.traceMode = "backward";
    
    // Create connector lines toggle button with modern styling
    this.createConnectorLinesToggleButton();
    
    // Add canvas click handler using native element
    d3.select(this.canvasElement).on("click", (event: MouseEvent) => {
        if (!this.useCanvasRendering || !this.xScale || !this.yScale || !this.canvasElement) return;
        
        const coords = this.getCanvasMouseCoordinates(event);
        const x = coords.x;
        const y = coords.y;
        
        // Find clicked task
        let clickedTask: Task | null = null;
        
        for (const task of this.allTasksToShow.slice(this.viewportStartIndex, this.viewportEndIndex + 1)) {
            const domainKey = task.yOrder?.toString() ?? '';
            const yPosition = this.yScale(domainKey);
            if (yPosition === undefined) continue;
            
            const taskHeight = this.settings.taskAppearance.taskHeight.value;
            
            // Check if click is within task bounds
            if (y >= yPosition && y <= yPosition + taskHeight) {
                if (task.startDate && task.finishDate) {
                    const taskX = this.xScale(task.startDate);
                    const taskWidth = this.xScale(task.finishDate) - taskX;
                    
                    if (x >= taskX && x <= taskX + taskWidth) {
                        clickedTask = task;
                        break;
                    }
                }
            }
        }
        
        // Handle task selection
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
    
    // Add canvas mousemove handler
    d3.select(this.canvasElement).on("mousemove", (event: MouseEvent) => {
        if (!this.useCanvasRendering || !this.xScale || !this.yScale || !this.canvasElement) return;
        
        const showTooltips = this.settings.displayOptions.showTooltips.value;
        if (!showTooltips) return;
        
        const coords = this.getCanvasMouseCoordinates(event);
        const x = coords.x;
        const y = coords.y;
        
        // Find task under mouse
        let hoveredTask: Task | null = null;
        
        for (const task of this.allTasksToShow.slice(this.viewportStartIndex, this.viewportEndIndex + 1)) {
            const domainKey = task.yOrder?.toString() ?? '';
            const yPosition = this.yScale(domainKey);
            if (yPosition === undefined) continue;
            
            const taskHeight = this.settings.taskAppearance.taskHeight.value;
            const milestoneSizeSetting = this.settings.taskAppearance.milestoneSize.value;
            
            // Check if mouse is within task vertical bounds
            if (y >= yPosition && y <= yPosition + taskHeight) {
                if (task.type === 'TT_Mile' || task.type === 'TT_FinMile') {
                    // Check milestone bounds
                    const milestoneDate = task.startDate || task.finishDate;
                    if (milestoneDate) {
                        const milestoneX = this.xScale(milestoneDate);
                        const size = Math.max(4, Math.min(milestoneSizeSetting, taskHeight * 0.9));
                        
                        // Check if within diamond bounds (approximate as square for simplicity)
                        if (x >= milestoneX - size/2 && x <= milestoneX + size/2) {
                            hoveredTask = task;
                            break;
                        }
                    }
                } else {
                    // Check regular task bounds
                    if (task.startDate && task.finishDate) {
                        const taskX = this.xScale(task.startDate);
                        const taskWidth = this.xScale(task.finishDate) - taskX;
                        
                        if (x >= taskX && x <= taskX + taskWidth) {
                            hoveredTask = task;
                            break;
                        }
                    }
                }
            }
        }
        
        // Show or hide tooltip
        if (hoveredTask) {
            this.showTaskTooltip(hoveredTask, event);
            d3.select(this.canvasElement).style("cursor", "pointer");
        } else {
            if (this.tooltipDiv) {
                this.tooltipDiv.style("visibility", "hidden");
            }
            d3.select(this.canvasElement).style("cursor", "default");
        }
    });
    
    // Add mouseout handler
    d3.select(this.canvasElement).on("mouseout", () => {
        if (this.tooltipDiv) {
            this.tooltipDiv.style("visibility", "hidden");
        }
        d3.select(this.canvasElement).style("cursor", "default");
    });
}

private forceCanvasRefresh(): void {
    this.debugLog("Forcing canvas refresh");

    // Clear canvas if it exists
    if (this.canvasElement && this.canvasContext) {
        this.canvasContext.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
    }

    // Clear SVG elements
    if (this.taskLayer) {
        this.taskLayer.selectAll("*").remove();
    }
    if (this.arrowLayer) {
        this.arrowLayer.selectAll("*").remove();
    }

    // Clear WBS group layer
    if (this.wbsGroupLayer) {
        this.wbsGroupLayer.selectAll('.wbs-group-header').remove();
    }

    // Recalculate visible tasks based on current scroll position (preserve scroll state)
    if (this.scrollableContainer?.node() && this.allTasksToShow?.length > 0) {
        this.calculateVisibleTasks();

        // Force immediate redraw if we have scales
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
    // Detect if we're in Power BI Service (iframe context)
    const isInIframe = window.self !== window.top;
    
    if (isInIframe || window.location.hostname.includes('powerbi.com')) {
        // Apply global CSS fixes for Power BI Service
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
        
        // Force a specific zoom level reset if possible
        if (this.target) {
            this.target.style.zoom = '1';
            (this.target.style as any).imageRendering = '-webkit-optimize-contrast';
        }
    }
}

private setupSVGRenderingHints(): void {
    // Set rendering hints for all SVG elements
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
    
    // Apply to groups
    [this.mainGroup, this.gridLayer, this.arrowLayer, this.taskLayer, 
     this.headerGridLayer, this.toggleButtonGroup].forEach(group => {
        if (group) {
            group.attr("shape-rendering", "geometricPrecision");
        }
    });
}

private determineUpdateType(options: VisualUpdateOptions): UpdateType {
    // Store and reset flag immediately with try-finally for safety
    const wasForced = this.forceFullUpdate;
    try {
        this.forceFullUpdate = false;
        
        if (wasForced) {
            this.debugLog("Force full update requested");
            return UpdateType.Full;
        }
        
        // Check if this is the first update
        if (!this.lastUpdateOptions) {
            return UpdateType.Full;
        }

        // Use Power BI Update Type Flags for robust detection
        let dataChanged = false;
        let settingsChanged = false;
        let viewportChanged = false;

        // Check flags provided by Power BI (options.type is a bitmask)
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

        // Fallback manual checks for redundancy
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

        // Ensure viewportChanged captures manual comparison if flag was missed
        if (!viewportChanged) {
            viewportChanged = this.lastViewport ? 
                (options.viewport.width !== this.lastViewport.width || 
                options.viewport.height !== this.lastViewport.height) : true;
        }
        
        // Check if viewport changed significantly (likely focus mode)
        let isSignificantViewportChange = false;
        if (this.lastViewport && viewportChanged) {
            const widthChangeRatio = Math.abs(options.viewport.width - this.lastViewport.width) / (this.lastViewport.width || 1);
            const heightChangeRatio = Math.abs(options.viewport.height - this.lastViewport.height) / (this.lastViewport.height || 1);
            isSignificantViewportChange = widthChangeRatio > this.VIEWPORT_CHANGE_THRESHOLD || 
                                        heightChangeRatio > this.VIEWPORT_CHANGE_THRESHOLD;
        }
        
        // Determine final update type based on prioritized flags
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
        
        // If multiple minor flags are set, default to a full update for safety
        if (settingsChanged || viewportChanged) {
            return UpdateType.Full;
        }

        return UpdateType.Full;
    } finally {
        // Ensure flag is always reset even if error occurs
        this.forceFullUpdate = false;
    }
}

public destroy(): void {
    // Clear all timeouts
    if (this.updateDebounceTimeout) {
        clearTimeout(this.updateDebounceTimeout);
        this.updateDebounceTimeout = null;
    }

    if (this.scrollThrottleTimeout) {
        clearTimeout(this.scrollThrottleTimeout);
        this.scrollThrottleTimeout = null;
    }

    // Phase 1 & 2: Clear caches
    this.renderCache.taskPositions.clear();
    this.renderCache.relationshipPaths.clear();
    this.renderCache.colors.clear();
    this.cpmMemo.clear();

    // Remove this instance's tooltip
    d3.select("body").selectAll(`.${this.tooltipClassName}`).remove();

    // Clear any scroll listeners
    if (this.scrollListener && this.scrollableContainer) {
        this.scrollableContainer.on("scroll", null);
        this.scrollListener = null;
    }
    
    // Clear pending updates
    this.pendingUpdate = null;
    
    // Apply empty filter
    this.applyTaskFilter([]);
    
    // Remove any global styles added
    const styleId = 'critical-path-publish-fixes';
    const styleElement = document.getElementById(styleId);
    if (styleElement) {
        styleElement.remove();
    }
    
    this.debugLog("Critical Path Visual destroyed.");
}

// ==================== Phase 1 & 2: Performance Optimization Methods ====================

/**
 * Centralized scroll preservation helper.
 * Call this before any update() that should maintain scroll position.
 * Sets up both the preserved scroll value and the cooldown to prevent Power BI re-triggers.
 */
private captureScrollPosition(): void {
    if (this.scrollableContainer?.node()) {
        this.preservedScrollTop = this.scrollableContainer.node().scrollTop;
        this.preserveScrollOnUpdate = true;
        this.scrollPreservationUntil = Date.now() + 500;
        this.debugLog(`Scroll position captured: ${this.preservedScrollTop}`);
    }
}

/**
 * Phase 1: Check if enough time has passed since last render (throttling)
 * @returns true if render should proceed, false if should skip
 */
private shouldRender(): boolean {
    const now = performance.now();
    if (now - this.lastRenderTime < this.MIN_RENDER_INTERVAL) {
        return false;
    }
    this.lastRenderTime = now;
    return true;
}

/**
 * Phase 2: Generate a cache key based on viewport and settings
 */
private getViewportKey(): string {
    const viewport = this.lastUpdateOptions?.viewport;
    const settings = this.settings;
    return `${viewport?.width || 0}x${viewport?.height || 0}_${settings?.layoutSettings?.leftMargin?.value || 0}_${settings?.layoutSettings?.taskPadding?.value || 0}`;
}

/**
 * Phase 2: Invalidate render cache when settings or data change
 */
private invalidateRenderCache(): void {
    this.renderCache.taskPositions.clear();
    this.renderCache.relationshipPaths.clear();
    this.renderCache.colors.clear();
    this.renderCache.lastViewportKey = "";
    this.debugLog("Render cache invalidated");
}

/**
 * Phase 2: Calculate which tasks are visible in the current viewport
 * @returns Object with start and end indices of visible tasks
 */
private calculateVisibleRange(tasks: Task[]): {start: number, end: number, visibleTasks: Task[]} {
    if (!this.virtualScrollEnabled || !this.scrollableContainer?.node()) {
        // Virtualization disabled or no container - return all tasks
        return {
            start: 0,
            end: tasks.length,
            visibleTasks: tasks
        };
    }

    const scrollTop = this.scrollableContainer.node()?.scrollTop || 0;
    const containerHeight = this.lastUpdateOptions?.viewport?.height || 600;
    const taskHeight = (this.settings?.taskAppearance?.taskHeight?.value || 18) +
                      (this.settings?.layoutSettings?.taskPadding?.value || 12);

    // Calculate visible range
    const startIndex = Math.floor(scrollTop / taskHeight);
    const visibleCount = Math.ceil(containerHeight / taskHeight);
    const endIndex = startIndex + visibleCount;

    // Add buffer for smooth scrolling
    const BUFFER_SIZE = 10;
    const bufferedStart = Math.max(0, startIndex - BUFFER_SIZE);
    const bufferedEnd = Math.min(tasks.length, endIndex + BUFFER_SIZE);

    this.debugLog(`Virtual scroll: showing tasks ${bufferedStart}-${bufferedEnd} of ${tasks.length}`);

    return {
        start: bufferedStart,
        end: bufferedEnd,
        visibleTasks: tasks.slice(bufferedStart, bufferedEnd)
    };
}

/**
 * Phase 2: Get cached task color or compute and cache it
 */
private getCachedTaskColor(task: Task, defaultColor: string, criticalColor: string, nearCriticalColor: string): string {
    const cacheKey = `${task.internalId}_${task.isCritical}_${task.isNearCritical}`;

    if (this.renderCache.colors.has(cacheKey)) {
        return this.renderCache.colors.get(cacheKey)!;
    }

    let color = defaultColor;
    if (task.internalId === this.selectedTaskId) {
        color = "#8A2BE2";
    } else if (task.isCritical) {
        color = criticalColor;
    } else if (task.isNearCritical) {
        color = nearCriticalColor;
    }

    this.renderCache.colors.set(cacheKey, color);
    return color;
}

// ==================== End Performance Optimization Methods ====================

private toggleTaskDisplayInternal(): void {
    try {
        this.debugLog("Internal Toggle method called!");
        this.showAllTasksInternal = !this.showAllTasksInternal;
        this.debugLog("New showAllTasksInternal value:", this.showAllTasksInternal);

        // DON'T update button text here - let createOrUpdateToggleButton() rebuild entire button
        // This ensures the icon updates properly along with the text

        // Persist state
        this.host.persistProperties({
            merge: [{
                objectName: "displayOptions",
                properties: { showAllTasks: this.showAllTasksInternal },
                selector: null
            }]
        });
        
        // Force canvas refresh before update
        this.forceCanvasRefresh();

        // BUG-001 FIX: Preserve scroll position when toggling Show All/Critical
        // The scroll position will be clamped if content becomes shorter
        this.captureScrollPosition();

        // Force full update
        this.forceFullUpdate = true;
        if (this.lastUpdateOptions) {
            this.update(this.lastUpdateOptions);
        }

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

        // Update button appearance immediately
        this.createOrUpdateBaselineToggleButton(this.lastUpdateOptions?.viewport.width || 800);

        // Persist the state back to the formatting pane setting so it's saved with the report
        // and the format pane toggle stays in sync.
        this.host.persistProperties({
            merge: [{
                objectName: "taskAppearance",
                properties: { showBaseline: this.showBaselineInternal },
                selector: null
            }]
        });

        // STRICT SCROLL PRESERVATION: Capture exact scroll position before update
        // Unlike WBS toggle (which needs anchor-based restoration), baseline toggle
        // should preserve the exact same scroll position since row layout doesn't change.
        if (this.scrollableContainer?.node()) {
            this.preservedScrollTop = this.scrollableContainer.node().scrollTop;
            this.debugLog(`Baseline toggle: Captured scrollTop=${this.preservedScrollTop}`);
        }

        // Toggling baseline can affect the X-axis scale if baseline dates are outside the range
        // of actual dates (because setupTimeBasedSVGAndScales now depends on showBaselineInternal).
        // Therefore, a full update is required to recalculate scales.
        this.forceFullUpdate = true;
        this.preserveScrollOnUpdate = true; // Preserve scroll during scale recalculation
        // Set a 500ms cooldown to prevent scroll reset from Power BI re-triggered updates
        this.scrollPreservationUntil = Date.now() + 500;
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

        // Update button appearance immediately
        this.createOrUpdatePreviousUpdateToggleButton(this.lastUpdateOptions?.viewport.width || 800);

        // Persist the state
        this.host.persistProperties({
            merge: [{
                objectName: "taskAppearance",
                properties: { showPreviousUpdate: this.showPreviousUpdateInternal },
                selector: null
            }]
        });

        // STRICT SCROLL PRESERVATION: Capture exact scroll position before update
        // Unlike WBS toggle (which needs anchor-based restoration), previous update toggle
        // should preserve the exact same scroll position since row layout doesn't change.
        if (this.scrollableContainer?.node()) {
            this.preservedScrollTop = this.scrollableContainer.node().scrollTop;
            this.debugLog(`Previous update toggle: Captured scrollTop=${this.preservedScrollTop}`);
        }

        // Force full update as scales may need recalculation
        this.forceFullUpdate = true;
        this.preserveScrollOnUpdate = true; // Preserve scroll during scale recalculation
        // Set a 500ms cooldown to prevent scroll reset from Power BI re-triggered updates
        this.scrollPreservationUntil = Date.now() + 500;
        if (this.lastUpdateOptions) {
            this.update(this.lastUpdateOptions);
        }

        this.debugLog("Visual update triggered by previous update toggle");
    } catch (error) {
        console.error("Error in previous update toggle method:", error);
    }
}

/**
 * Creates/updates the Show All/Show Critical toggle button with professional Fluent design
 * UPGRADED: Enhanced visuals, better spacing, smoother animations, refined icons
 * RESPONSIVE: Adapts to viewport width using getHeaderButtonLayout()
 */
private createOrUpdateToggleButton(viewportWidth: number): void {
    if (!this.toggleButtonGroup || !this.headerSvg) return;

    // Remove all event handlers before clearing
    this.toggleButtonGroup.selectAll("*")
        .on("click", null)
        .on("mouseover", null)
        .on("mouseout", null);

    this.toggleButtonGroup.selectAll("*").remove();

    // Get responsive layout dimensions
    const layout = this.getHeaderButtonLayout(viewportWidth);
    const buttonWidth = layout.showAllCritical.width;
    const buttonHeight = this.UI_TOKENS.height.standard;
    const buttonX = layout.showAllCritical.x;
    const buttonY = this.UI_TOKENS.spacing.sm;

    // Button state logic (text shows what clicking WILL do)
    const isShowingCritical = this.showAllTasksInternal;

    this.toggleButtonGroup
        .attr("transform", `translate(${buttonX}, ${buttonY})`)
        .attr("role", "button")
        .attr("aria-label", isShowingCritical ? "Show critical path only" : "Show all tasks")
        .attr("aria-pressed", (!isShowingCritical).toString())
        .attr("tabindex", "0");

    // Professional button background with refined shadow
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

    // ICON shows what you WILL see when you click (matches button text)
    // When button says "Show Critical" -> show RED critical icon
    // When button says "Show All" -> show GREEN bars icon
    const iconPadding = this.UI_TOKENS.spacing.lg;
    const iconColor = isShowingCritical
        ? this.UI_TOKENS.color.danger.default   // RED icon when button says "Show Critical"
        : this.UI_TOKENS.color.success.default; // GREEN icon when button says "Show All"

    // Icon background circle
    this.toggleButtonGroup.append("circle")
        .attr("cx", iconPadding)
        .attr("cy", buttonHeight / 2)
        .attr("r", 10)
        .style("fill", isShowingCritical ? this.UI_TOKENS.color.danger.subtle : this.UI_TOKENS.color.success.subtle)
        .style("pointer-events", "none")
        .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

    // Icon path (RED funnel for critical, GREEN bars for all)
    this.toggleButtonGroup.append("path")
        .attr("d", isShowingCritical
            ? "M2.5,-1.5 L5,-3.5 L7.5,-1.5 L7.5,0 L5,2 L2.5,0 Z"  // RED funnel when button says "Show Critical"
            : "M1.5,-3 L8,-3 M1.5,0 L8.5,0 M1.5,3 L8,3")  // GREEN bars when button says "Show All"
        .attr("transform", `translate(${iconPadding}, ${buttonHeight/2})`)
        .attr("stroke", iconColor)
        .attr("stroke-width", 2.25)
        .attr("fill", isShowingCritical ? iconColor : "none")  // Fill the funnel when showing critical icon
        .attr("stroke-linecap", "round")
        .attr("stroke-linejoin", "round")
        .style("pointer-events", "none")
        .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

    // Button text shows what clicking will DO
    // Use shorter text in narrow mode
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

    // Professional hover states with refined animations
    const self = this;
    this.toggleButtonGroup
        .on("mouseover", function() {
            d3.select(this).select("rect")
                .style("fill", self.UI_TOKENS.color.neutral.grey10)
                .style("stroke", self.UI_TOKENS.color.neutral.grey90)
                .style("stroke-width", 2)
                .style("transform", "translateY(-2px)")
                .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[8]})`);
        })
        .on("mouseout", function() {
            d3.select(this).select("rect")
                .style("fill", self.UI_TOKENS.color.neutral.white)
                .style("stroke", self.UI_TOKENS.color.neutral.grey60)
                .style("stroke-width", 1.5)
                .style("transform", "translateY(0)")
                .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[2]})`);
        })
        .on("mousedown", function() {
            d3.select(this).select("rect")
                .style("transform", "translateY(0) scale(0.96)")
                .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[4]})`);
        })
        .on("mouseup", function() {
            d3.select(this).select("rect")
                .style("transform", "translateY(-2px) scale(1)")
                .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[8]})`);
        });

    // Clickable overlay
    const clickOverlay = this.toggleButtonGroup.append("rect")
        .attr("width", buttonWidth)
        .attr("height", buttonHeight)
        .attr("rx", this.UI_TOKENS.radius.medium)
        .attr("ry", this.UI_TOKENS.radius.medium)
        .style("fill", "transparent")
        .style("cursor", "pointer");

    // Click and keyboard handlers
    clickOverlay.on("click", function(event) {
        if (event) event.stopPropagation();
        self.toggleTaskDisplayInternal();
    });

    this.toggleButtonGroup.on("keydown", function(event) {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            self.toggleTaskDisplayInternal();
        }
    });

    // Enhanced tooltip (describes what clicking will do)
    this.toggleButtonGroup.append("title")
        .text(isShowingCritical
            ? "Click to filter and show only critical path tasks"
            : "Click to show all tasks in the project");
}

/**
 * Creates/updates the Baseline toggle with professional theming and user color integration
 * UPGRADED: Enhanced visuals, better icon design, smoother animations, refined color integration
 */
private createOrUpdateBaselineToggleButton(viewportWidth: number): void {
    if (!this.headerSvg) return;

    this.headerSvg.selectAll(".baseline-toggle-group").remove();

    // Check if the baseline fields are available in the data roles
    const dataView = this.lastUpdateOptions?.dataViews?.[0];
    const hasBaselineStart = dataView ? this.hasDataRole(dataView, 'baselineStartDate') : false;
    const hasBaselineFinish = dataView ? this.hasDataRole(dataView, 'baselineFinishDate') : false;
    const isAvailable = hasBaselineStart && hasBaselineFinish;

    // Professional color theming with better contrast
    const baselineColor = this.settings.taskAppearance.baselineColor.value.value;
    const lightBaselineColor = this.lightenColor(baselineColor, 0.93);  // Lighter for better contrast
    const hoverBaselineColor = this.lightenColor(baselineColor, 0.85);
    const previousUpdateColor = this.settings.taskAppearance.previousUpdateColor.value.value;

    // Get responsive layout
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

    // Professional button styling with user color theming
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

    // Professional icon container with better visual hierarchy
    // Center icon when in icon-only mode, otherwise position for text
    const iconX = iconOnly ? (buttonWidth / 2 - 8) : (this.UI_TOKENS.spacing.lg + 2);
    const iconY = buttonHeight / 2;

    // Icon background for better visual separation
    baselineToggleGroup.append("circle")
        .attr("cx", iconX + 8)
        .attr("cy", iconY)
        .attr("r", 11)
        .style("fill", this.showBaselineInternal ? this.lightenColor(baselineColor, 0.95) : this.UI_TOKENS.color.neutral.grey10)
        .style("opacity", 0.6)
        .style("pointer-events", "none")
        .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

    // Enhanced icon bars with professional styling
    // Main bar icon (top) - refined with better proportions
    baselineToggleGroup.append("rect")
        .attr("x", iconX)
        .attr("y", iconY - 8)
        .attr("width", 16)
        .attr("height", 4.5)
        .attr("rx", 2)
        .attr("ry", 2)
        .attr("fill", this.showBaselineInternal ? this.UI_TOKENS.color.primary.default : this.UI_TOKENS.color.neutral.grey90)
        .style("pointer-events", "none")
        .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

    // Previous update bar icon (middle)
    baselineToggleGroup.append("rect")
        .attr("x", iconX)
        .attr("y", iconY - 1.5)
        .attr("width", 16)
        .attr("height", 3.5)
        .attr("rx", 1.5)
        .attr("ry", 1.5)
        .attr("fill", this.showBaselineInternal ? previousUpdateColor : this.UI_TOKENS.color.neutral.grey60)
        .style("opacity", this.showBaselineInternal ? 1 : 0.6)
        .style("pointer-events", "none")
        .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

    // Baseline bar icon (bottom) - highlighted when active with better visual weight
    baselineToggleGroup.append("rect")
        .attr("x", iconX)
        .attr("y", iconY + 4)
        .attr("width", 16)
        .attr("height", 3.5)
        .attr("rx", 1.5)
        .attr("ry", 1.5)
        .attr("fill", this.showBaselineInternal ? baselineColor : this.UI_TOKENS.color.neutral.grey60)
        .style("opacity", this.showBaselineInternal ? 1 : 0.6)
        .style("pointer-events", "none")
        .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

    // Professional typography with better spacing - only show when not icon-only
    if (!iconOnly) {
        baselineToggleGroup.append("text")
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

    // Enhanced tooltip
    baselineToggleGroup.append("title")
        .text(isAvailable
            ? (this.showBaselineInternal ? "Click to hide baseline task bars" : "Click to show baseline task bars below main bars")
            : "Requires Baseline Start Date and Baseline Finish Date fields to be mapped");

    if (isAvailable) {
        const self = this;

        // Professional hover interactions with refined animations
        baselineToggleGroup
            .on("mouseover", function() {
                d3.select(this).select("rect")
                    .style("fill", self.showBaselineInternal ? hoverBaselineColor : self.UI_TOKENS.color.neutral.grey10)
                    .style("stroke-width", 2.5)
                    .style("transform", "translateY(-2px)")
                    .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[8]})`);
            })
            .on("mouseout", function() {
                d3.select(this).select("rect")
                    .style("fill", self.showBaselineInternal ? lightBaselineColor : self.UI_TOKENS.color.neutral.white)
                    .style("stroke-width", self.showBaselineInternal ? 2 : 1.5)
                    .style("transform", "translateY(0)")
                    .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[2]})`);
            })
            .on("mousedown", function() {
                d3.select(this).select("rect")
                    .style("transform", "translateY(0) scale(0.96)")
                    .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[4]})`);
            })
            .on("mouseup", function() {
                d3.select(this).select("rect")
                    .style("transform", "translateY(-2px) scale(1)")
                    .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[8]})`);
            });

        baselineToggleGroup.on("click", function(event) {
            if (event) event.stopPropagation();
            self.toggleBaselineDisplayInternal();
        });

        // Keyboard support
        baselineToggleGroup.on("keydown", function(event) {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                self.toggleBaselineDisplayInternal();
            }
        });
    }
}

/**
 * UPGRADED: Creates/updates the Previous Update toggle with professional theming and user color integration
 */
private createOrUpdatePreviousUpdateToggleButton(viewportWidth: number): void {
    if (!this.headerSvg) return;

    this.headerSvg.selectAll(".previous-update-toggle-group").remove();

    // Check if the previous update fields are available in the data roles
    const dataView = this.lastUpdateOptions?.dataViews?.[0];
    const hasPreviousUpdateStart = dataView ? this.hasDataRole(dataView, 'previousUpdateStartDate') : false;
    const hasPreviousUpdateFinish = dataView ? this.hasDataRole(dataView, 'previousUpdateFinishDate') : false;
    const isAvailable = hasPreviousUpdateStart && hasPreviousUpdateFinish;

    // Get colors from settings with enhanced theming
    const previousUpdateColor = this.settings.taskAppearance.previousUpdateColor.value.value;
    const lightPreviousUpdateColor = this.lightenColor(previousUpdateColor, 0.90);
    const hoverPreviousUpdateColor = this.lightenColor(previousUpdateColor, 0.80);
    const baselineColor = this.settings.taskAppearance.baselineColor.value.value;

    // Get responsive layout
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

    // Enhanced button styling with user color theming
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

    // Enhanced icon representing the stacking order (Main -> Previous Update -> Baseline)
    // Center icon when in icon-only mode, otherwise position for text
    const iconX = iconOnly ? (buttonWidth / 2 - 8) : this.UI_TOKENS.spacing.lg;
    const iconY = buttonHeight / 2;

    // Icon background circle
    previousUpdateToggleGroup.append("circle")
        .attr("cx", iconX + 8)
        .attr("cy", iconY)
        .attr("r", iconOnly ? 11 : 14)
        .attr("fill", this.showPreviousUpdateInternal ? previousUpdateColor : this.UI_TOKENS.color.neutral.grey20)
        .attr("opacity", this.showPreviousUpdateInternal ? 0.15 : 0.5)
        .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

    // Main bar icon (top)
    previousUpdateToggleGroup.append("rect")
        .attr("x", iconX)
        .attr("y", iconY - 7)
        .attr("width", 16)
        .attr("height", 4)
        .attr("rx", 1.5)
        .attr("ry", 1.5)
        .attr("fill", this.showPreviousUpdateInternal ? this.UI_TOKENS.color.primary.default : this.UI_TOKENS.color.neutral.grey90)
        .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

    // Previous update bar icon (middle) - highlighted when active
    previousUpdateToggleGroup.append("rect")
        .attr("x", iconX)
        .attr("y", iconY - 1)
        .attr("width", 16)
        .attr("height", 3)
        .attr("rx", 1)
        .attr("ry", 1)
        .attr("fill", this.showPreviousUpdateInternal ? previousUpdateColor : this.UI_TOKENS.color.neutral.grey60)
        .style("opacity", this.showPreviousUpdateInternal ? 1 : 0.6)
        .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

    // Baseline bar icon (bottom)
    previousUpdateToggleGroup.append("rect")
        .attr("x", iconX)
        .attr("y", iconY + 4)
        .attr("width", 16)
        .attr("height", 3)
        .attr("rx", 1)
        .attr("ry", 1)
        .attr("fill", this.showPreviousUpdateInternal ? baselineColor : this.UI_TOKENS.color.neutral.grey60)
        .style("opacity", this.showPreviousUpdateInternal ? 1 : 0.6)
        .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

    // Enhanced typography - only show when not icon-only
    if (!iconOnly) {
        previousUpdateToggleGroup.append("text")
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

    // Enhanced tooltip
    previousUpdateToggleGroup.append("title")
        .text(isAvailable
            ? (this.showPreviousUpdateInternal ? "Click to hide previous update task bars" : "Click to show previous update task bars between main and baseline")
            : "Requires Previous Update Start Date and Previous Update Finish Date fields to be mapped");

    if (isAvailable) {
        const self = this;

        // Enhanced hover interactions
        previousUpdateToggleGroup
            .on("mouseover", function() {
                d3.select(this).select("rect")
                    .style("fill", self.showPreviousUpdateInternal ? hoverPreviousUpdateColor : self.UI_TOKENS.color.neutral.grey20)
                    .style("transform", "translateY(-2px)")
                    .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[8]})`);
            })
            .on("mouseout", function() {
                d3.select(this).select("rect")
                    .style("fill", self.showPreviousUpdateInternal ? lightPreviousUpdateColor : self.UI_TOKENS.color.neutral.white)
                    .style("transform", "translateY(0)")
                    .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[2]})`);
            })
            .on("mousedown", function() {
                d3.select(this).select("rect")
                    .style("transform", "translateY(0) scale(0.98)");
            })
            .on("mouseup", function() {
                d3.select(this).select("rect")
                    .style("transform", "translateY(-2px) scale(1)");
            });

        previousUpdateToggleGroup.on("click", function(event) {
            if (event) event.stopPropagation();
            self.togglePreviousUpdateDisplayInternal();
        });

        // Keyboard support
        previousUpdateToggleGroup.on("keydown", function(event) {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                self.togglePreviousUpdateDisplayInternal();
            }
        });
    }
}

private lightenColor(color: string, factor: number): string {
    // Convert hex to RGB
    const hex = color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    
    // Lighten by blending with white
    const newR = Math.round(r + (255 - r) * factor);
    const newG = Math.round(g + (255 - g) * factor);
    const newB = Math.round(b + (255 - b) * factor);
    
    // Convert back to hex
    return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
}

/**
 * UPGRADED: Creates the Connector Lines toggle with modern icon-only design
 */
private createConnectorLinesToggleButton(viewportWidth?: number): void {
    if (!this.headerSvg) return;

    this.headerSvg.selectAll(".connector-toggle-group").remove();

    const showConnectorToggle = this.settings?.connectorLines?.showConnectorToggle?.value ?? false;
    if (!showConnectorToggle) return;

    // Get responsive layout
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

    // Enhanced button with active/inactive states
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

    // Enhanced connector icon with better visibility
    // Nudge icon up to leave more breathing room for badge label
    const iconCenter = (buttonSize / 2) - 2;
    const iconG = connectorToggleGroup.append("g")
        .attr("transform", `translate(${iconCenter}, ${iconCenter})`);

    // Connection path with improved design
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

    // Small connection dots for clarity
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

    // Enhanced tooltip
    connectorToggleGroup.append("title")
        .text(this.showConnectorLinesInternal
            ? "Click to hide connector lines between dependent tasks"
            : "Click to show connector lines between dependent tasks");

    // Enhanced hover interactions
    const self = this;
    connectorToggleGroup
        .on("mouseover", function() {
            d3.select(this).select("rect")
                .style("fill", self.showConnectorLinesInternal
                    ? self.UI_TOKENS.color.success.default
                    : self.UI_TOKENS.color.neutral.grey20)
                .style("transform", "translateY(-2px)")
                .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[8]})`);

            if (self.showConnectorLinesInternal) {
                d3.select(this).select("path").attr("stroke", self.UI_TOKENS.color.neutral.white);
                d3.select(this).selectAll("circle").attr("fill", self.UI_TOKENS.color.neutral.white);
            }
        })
        .on("mouseout", function() {
            d3.select(this).select("rect")
                .style("fill", self.showConnectorLinesInternal
                    ? self.UI_TOKENS.color.success.light
                    : self.UI_TOKENS.color.neutral.white)
                .style("transform", "translateY(0)")
                .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[2]})`);

            if (self.showConnectorLinesInternal) {
                d3.select(this).select("path").attr("stroke", self.UI_TOKENS.color.success.default);
                d3.select(this).selectAll("circle").attr("fill", self.UI_TOKENS.color.success.default);
            }
        })
        .on("mousedown", function() {
            d3.select(this).select("rect")
                .style("transform", "translateY(0) scale(0.95)");
        })
        .on("mouseup", function() {
            d3.select(this).select("rect")
                .style("transform", "translateY(-2px) scale(1)");
        });

    connectorToggleGroup.on("click", function(event) {
        if (event) event.stopPropagation();
        self.toggleConnectorLinesDisplay();
    });

    // Keyboard support
    connectorToggleGroup.on("keydown", function(event) {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            self.toggleConnectorLinesDisplay();
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
 * Creates the WBS Expand cycle toggle button with icon-only design
 * Similar styling to Connector Lines toggle for visual consistency
 */
private createWbsExpandCycleToggleButton(viewportWidth?: number): void {
    if (!this.headerSvg) return;

    this.headerSvg.selectAll(".wbs-expand-toggle-group").remove();

    // FIXED: Use metadata-based check for button visibility.
    // This ensures the button remains visible even when filters hide all WBS-assigned tasks.
    // wbsDataExistsInMetadata checks if WBS columns exist in the dataView metadata,
    // while wbsDataExists checks if current tasks have WBS values (affected by filters).
    const wbsColumnsExist = this.wbsDataExistsInMetadata;
    const wbsEnabled = wbsColumnsExist && this.settings?.wbsGrouping?.enableWbsGrouping?.value;
    const showWbsToggle = this.settings?.wbsGrouping?.showWbsToggle?.value ?? true;
    if (!wbsEnabled || !showWbsToggle) return;

    if (this.wbsAvailableLevels.length === 0 && this.wbsGroups.length > 0) {
        this.refreshWbsAvailableLevels();
    }

    const maxLevel = this.getMaxWbsLevel();
    const currentLevelRaw = this.wbsExpandToLevel ?? (this.wbsExpandedInternal ? (maxLevel || null) : 0);
    const currentLevel = currentLevelRaw === null && maxLevel > 0 ? maxLevel : currentLevelRaw;
    const levelLabel = this.getWbsExpandLevelLabel(currentLevel);
    const nextLevelValue = this.getNextWbsExpandLevel();
    const nextLevelLabel = nextLevelValue !== null ? this.getWbsExpandLevelLabel(nextLevelValue) : levelLabel;

    // Get responsive layout
    const layout = this.getHeaderButtonLayout(viewportWidth || 800);
    const { x: buttonX, size: buttonSize } = layout.wbsExpandToggle;

    const wbsToggleGroup = this.headerSvg.append("g")
        .attr("class", "wbs-expand-toggle-group")
        .style("cursor", "pointer")
        .attr("role", "button")
        .attr("aria-label", `${levelLabel} (click to cycle)`)
        .attr("aria-pressed", this.wbsExpandedInternal.toString())
        .attr("tabindex", "0");

    const buttonY = this.UI_TOKENS.spacing.sm;

    wbsToggleGroup.attr("transform", `translate(${buttonX}, ${buttonY})`);

    // Button background with active/inactive states
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

    // WBS expand icon: plus with downward chevron
    const iconCenterX = buttonSize / 2;
    const iconCenterY = (buttonSize / 2) - 4; // Nudge up for badge breathing room
    const iconG = wbsToggleGroup.append("g")
        .attr("transform", `translate(${iconCenterX}, ${iconCenterY})`);

    const iconColor = this.wbsExpandedInternal
        ? this.UI_TOKENS.color.primary.default
        : this.UI_TOKENS.color.neutral.grey130;

    // Soft background circle for contrast
    iconG.append("circle")
        .attr("r", 11)
        .attr("fill", this.wbsExpandedInternal ? this.UI_TOKENS.color.primary.subtle : this.UI_TOKENS.color.neutral.grey10)
        .attr("opacity", 0.7);

    // Plus sign
    iconG.append("path")
        .attr("d", "M-4,0 L4,0 M0,-4 L0,4")
        .attr("stroke", iconColor)
        .attr("stroke-width", 2.2)
        .attr("fill", "none")
        .attr("stroke-linecap", "round");

    // Downward chevron to indicate expanding
    iconG.append("path")
        .attr("d", "M-4,5 L0,8 L4,5")
        .attr("stroke", iconColor)
        .attr("stroke-width", 1.8)
        .attr("fill", "none")
        .attr("stroke-linecap", "round")
        .attr("stroke-linejoin", "round");

    // Small badge to show current depth (0, L2, L3, All)
    const badgeText = currentLevel === null
        ? (maxLevel > 0 ? `L${maxLevel}` : "All")
        : currentLevel === 0
            ? "0"
            : `L${currentLevel}`;
    wbsToggleGroup.append("text")
        .attr("x", buttonSize / 2)
        .attr("y", buttonSize - 10) // lift badge off the border
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .style("font-family", "Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif")
        .style("font-size", `${this.UI_TOKENS.fontSize.sm}px`)
        .style("font-weight", this.UI_TOKENS.fontWeight.semibold)
        .style("fill", iconColor)
        .text(badgeText);

    // Tooltip
    const levelsDesc = this.wbsAvailableLevels.length > 0
        ? this.wbsAvailableLevels.map(l => `L${l}`).join("/")
        : "no levels";
    wbsToggleGroup.append("title")
        .text(`${levelLabel}. Next: ${nextLevelLabel}. Cycle order: collapse -> ${levelsDesc}.`);

    // Hover interactions
    const self = this;
    wbsToggleGroup
        .on("mouseover", function() {
            d3.select(this).select("rect")
                .style("fill", self.wbsExpandedInternal
                    ? self.UI_TOKENS.color.primary.default
                    : self.UI_TOKENS.color.neutral.grey20)
                .style("transform", "translateY(-2px)")
                .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[8]})`);

            if (self.wbsExpandedInternal) {
                d3.select(this).selectAll("path").attr("stroke", self.UI_TOKENS.color.neutral.white);
            }
        })
        .on("mouseout", function() {
            d3.select(this).select("rect")
                .style("fill", self.wbsExpandedInternal
                    ? self.UI_TOKENS.color.primary.light
                    : self.UI_TOKENS.color.neutral.white)
                .style("transform", "translateY(0)")
                .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[2]})`);

            if (self.wbsExpandedInternal) {
                d3.select(this).selectAll("path").attr("stroke", self.UI_TOKENS.color.primary.default);
            }
        })
        .on("mousedown", function() {
            d3.select(this).select("rect")
                .style("transform", "translateY(0) scale(0.95)");
        })
        .on("mouseup", function() {
            d3.select(this).select("rect")
                .style("transform", "translateY(-2px) scale(1)");
        });

    wbsToggleGroup.on("click", function(event) {
        if (event) event.stopPropagation();
        self.toggleWbsExpandCollapseDisplay();
    });

    // Keyboard support
    wbsToggleGroup.on("keydown", function(event) {
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

    // Use same visibility rules as expand button
    const wbsColumnsExist = this.wbsDataExistsInMetadata;
    const wbsEnabled = wbsColumnsExist && this.settings?.wbsGrouping?.enableWbsGrouping?.value;
    const showWbsToggle = this.settings?.wbsGrouping?.showWbsToggle?.value ?? true;
    if (!wbsEnabled || !showWbsToggle) return;

    if (this.wbsAvailableLevels.length === 0 && this.wbsGroups.length > 0) {
        this.refreshWbsAvailableLevels();
    }

    const maxLevel = this.getMaxWbsLevel();
    const currentLevelRaw = this.wbsExpandToLevel ?? (this.wbsExpandedInternal ? (maxLevel || null) : 0);
    const currentLevel = currentLevelRaw === null && maxLevel > 0 ? maxLevel : currentLevelRaw;
    const levelLabel = this.getWbsExpandLevelLabel(currentLevel);
    const previousLevelValue = this.getPreviousWbsExpandLevel();
    const previousLevelLabel = previousLevelValue !== null ? this.getWbsExpandLevelLabel(previousLevelValue) : levelLabel;

    // Get responsive layout
    const layout = this.getHeaderButtonLayout(viewportWidth || 800);
    const { x: buttonX, size: buttonSize } = layout.wbsCollapseToggle;

    const isCollapsed = this.wbsExpandToLevel === 0 || !this.wbsExpandedInternal;

    const wbsCollapseGroup = this.headerSvg.append("g")
        .attr("class", "wbs-collapse-toggle-group")
        .style("cursor", "pointer")
        .attr("role", "button")
        .attr("aria-label", `${levelLabel} (reverse cycle)`)
        .attr("aria-pressed", isCollapsed.toString())
        .attr("tabindex", "0");

    const buttonY = this.UI_TOKENS.spacing.sm;

    wbsCollapseGroup.attr("transform", `translate(${buttonX}, ${buttonY})`);

    // Button background with active/inactive states
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

    // Collapse icon: minus with upward chevron
    const iconCenterX = buttonSize / 2;
    const iconCenterY = (buttonSize / 2) - 4; // Nudge up for badge breathing room
    const iconG = wbsCollapseGroup.append("g")
        .attr("transform", `translate(${iconCenterX}, ${iconCenterY})`);

    const iconColor = isCollapsed
        ? this.UI_TOKENS.color.primary.default
        : this.UI_TOKENS.color.neutral.grey130;

    // Soft background circle for contrast
    iconG.append("circle")
        .attr("r", 11)
        .attr("fill", isCollapsed ? this.UI_TOKENS.color.primary.subtle : this.UI_TOKENS.color.neutral.grey10)
        .attr("opacity", 0.7);

    // Minus sign
    iconG.append("path")
        .attr("d", "M-5,0 L5,0")
        .attr("stroke", iconColor)
        .attr("stroke-width", 2.2)
        .attr("fill", "none")
        .attr("stroke-linecap", "round");

    // Upward chevron to indicate collapsing direction
    iconG.append("path")
        .attr("d", "M-4,-3 L0,-7 L4,-3")
        .attr("stroke", iconColor)
        .attr("stroke-width", 1.8)
        .attr("fill", "none")
        .attr("stroke-linecap", "round")
        .attr("stroke-linejoin", "round");

    // Small badge to show current depth (0, L2, L3, All)
    const badgeText = currentLevel === null
        ? (maxLevel > 0 ? `L${maxLevel}` : "All")
        : currentLevel === 0
            ? "0"
            : `L${currentLevel}`;
    wbsCollapseGroup.append("text")
        .attr("x", buttonSize / 2)
        .attr("y", buttonSize - 10) // lift badge off the border
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .style("font-family", "Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif")
        .style("font-size", `${this.UI_TOKENS.fontSize.sm}px`)
        .style("font-weight", this.UI_TOKENS.fontWeight.semibold)
        .style("fill", iconColor)
        .text(badgeText);

    // Tooltip
    const levelsDesc = this.wbsAvailableLevels.length > 0
        ? [...this.wbsAvailableLevels].sort((a, b) => b - a).map(l => `L${l}`).join("/")
        : "no levels";
    const reverseCycle = this.wbsAvailableLevels.length > 0
        ? `expand all -> ${levelsDesc} -> collapse`
        : "collapse";
    wbsCollapseGroup.append("title")
        .text(`${levelLabel}. Previous: ${previousLevelLabel}. Reverse cycle: ${reverseCycle}.`);

    // Hover interactions
    const self = this;
    wbsCollapseGroup
        .on("mouseover", function() {
            d3.select(this).select("rect")
                .style("fill", isCollapsed
                    ? self.UI_TOKENS.color.primary.default
                    : self.UI_TOKENS.color.neutral.grey20)
                .style("transform", "translateY(-2px)")
                .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[8]})`);

            if (isCollapsed) {
                d3.select(this).selectAll("path").attr("stroke", self.UI_TOKENS.color.neutral.white);
            }
        })
        .on("mouseout", function() {
            d3.select(this).select("rect")
                .style("fill", isCollapsed
                    ? self.UI_TOKENS.color.primary.light
                    : self.UI_TOKENS.color.neutral.white)
                .style("transform", "translateY(0)")
                .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[2]})`);

            if (isCollapsed) {
                d3.select(this).selectAll("path").attr("stroke", self.UI_TOKENS.color.primary.default);
            }
        })
        .on("mousedown", function() {
            d3.select(this).select("rect")
                .style("transform", "translateY(0) scale(0.95)");
        })
        .on("mouseup", function() {
            d3.select(this).select("rect")
                .style("transform", "translateY(-2px) scale(1)");
        });

    wbsCollapseGroup.on("click", function(event) {
        if (event) event.stopPropagation();
        self.toggleWbsCollapseCycleDisplay();
    });

    // Keyboard support
    wbsCollapseGroup.on("keydown", function(event) {
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

        if (this.wbsAvailableLevels.length === 0 && this.wbsGroups.length > 0) {
            this.refreshWbsAvailableLevels();
        }

        const levelGetter = direction === "previous"
            ? this.getPreviousWbsExpandLevel.bind(this)
            : this.getNextWbsExpandLevel.bind(this);

        const nextLevel = levelGetter();
        if (nextLevel === null && this.wbsAvailableLevels.length === 0) {
            return;
        }
        const effectiveNext = nextLevel;

        this.debugLog("WBS expand depth cycle", {
            current: this.wbsExpandToLevel,
            next: effectiveNext,
            direction,
            availableLevels: this.wbsAvailableLevels
        });

        this.wbsManualExpansionOverride = false;

        // BUG-007 FIX: Clear manually toggled groups when going to "collapse all" (level 0)
        // This gives users a way to reset their manual overrides
        if (effectiveNext === 0) {
            this.wbsManuallyToggledGroups.clear();
            this.debugLog("Cleared manually toggled groups on collapse all");
        }

        // Capture an anchor so the viewport stays roughly centered on a nearby group
        this.captureWbsAnchorForGlobalToggle();

        this.applyWbsExpandLevel(effectiveNext);

        // Persist the general expand/collapse intent for backwards compatibility
        this.host.persistProperties({
            merge: [{
                objectName: "wbsGrouping",
                properties: { expandCollapseAll: this.wbsExpandedInternal },
                selector: null
            }]
        });

        // Update button appearance using current viewport width to avoid layout jump
        const viewportWidth = this.lastUpdateOptions?.viewport?.width
            || (this.target instanceof HTMLElement ? this.target.clientWidth : undefined)
            || 800;
        this.renderWbsCycleButtons(viewportWidth);

        // Force full update to re-render with new expansion state
        this.forceFullUpdate = true;
        // Preserve scroll via captured anchor during the full update
        this.preserveScrollOnUpdate = true;
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
 * UPGRADED: Professional pill-style toggle with smooth animations and refined visuals
 * RESPONSIVE: Adapts to viewport width using getHeaderButtonLayout()
 */
private createModeToggleButton(viewportWidth: number): void {
    if (!this.headerSvg) return;

    this.headerSvg.selectAll(".mode-toggle-group").remove();

    const currentMode = this.settings?.criticalityMode?.calculationMode?.value?.value || 'longestPath';
    const isFloatBased = currentMode === 'floatBased';
    const dataView = this.lastUpdateOptions?.dataViews?.[0];
    const hasTotalFloat = dataView ? this.hasDataRole(dataView, 'taskTotalFloat') : false;

    // Get responsive layout dimensions
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

    // Main button container
    const buttonG = modeToggleGroup.append("g")
        .attr("class", "mode-button-container");

    // Enhanced theme colors based on mode
    const bgColor = isFloatBased ? this.UI_TOKENS.color.warning.subtle : this.UI_TOKENS.color.primary.subtle;
    const borderColor = isFloatBased ? this.UI_TOKENS.color.warning.default : this.UI_TOKENS.color.primary.default;
    const hoverBgColor = isFloatBased ? this.UI_TOKENS.color.warning.lighter : this.UI_TOKENS.color.primary.lighter;

    // Professional button background with refined styling
    const buttonRect = buttonG.append("rect")
        .attr("width", buttonWidth)
        .attr("height", buttonHeight)
        .attr("rx", this.UI_TOKENS.radius.pill)  // More pronounced pill shape
        .attr("ry", this.UI_TOKENS.radius.pill)
        .style("fill", bgColor)
        .style("stroke", borderColor)
        .style("stroke-width", 2)  // Heavier border for premium feel
        .style("filter", hasTotalFloat ? `drop-shadow(${this.UI_TOKENS.shadow[2]})` : "none")
        .style("opacity", hasTotalFloat ? 1 : 0.4)
        .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

    // Professional mode indicator pill with refined design
    // Scale pill size based on button width
    const pillWidth = Math.min(106, buttonWidth - 20);
    const pillHeight = 22;
    const pillG = buttonG.append("g")
        .attr("transform", `translate(${(buttonWidth - pillWidth) / 2}, ${buttonHeight/2})`);

    const pillX = isFloatBased ? pillWidth/2 : 0;

    // Background track with refined styling
    pillG.append("rect")
        .attr("class", "mode-pill-bg")
        .attr("x", 0)
        .attr("y", -pillHeight/2)
        .attr("width", pillWidth)
        .attr("height", pillHeight)
        .attr("rx", this.UI_TOKENS.radius.large)
        .attr("ry", this.UI_TOKENS.radius.large)
        .style("fill", this.UI_TOKENS.color.neutral.grey20)  // Lighter track
        .style("opacity", 0.8);

    // Professional sliding pill indicator with smooth animation and better shadow
    const slidingPill = pillG.append("rect")
        .attr("class", "mode-pill")
        .attr("x", pillX)
        .attr("y", -pillHeight/2)
        .attr("width", pillWidth/2)
        .attr("height", pillHeight)
        .attr("rx", this.UI_TOKENS.radius.large)
        .attr("ry", this.UI_TOKENS.radius.large)
        .style("fill", borderColor)
        .style("filter", `drop-shadow(${this.UI_TOKENS.shadow[4]})`)  // Better shadow
        .style("transition", `all ${this.UI_TOKENS.motion.duration.slow}ms ${this.UI_TOKENS.motion.easing.smooth}`);

    // Professional mode labels with enhanced typography
    const labelY = 0;

    // LP label with better styling
    pillG.append("text")
        .attr("x", pillWidth/4)
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

    // Float label with better styling
    pillG.append("text")
        .attr("x", 3*pillWidth/4)
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

    // Enhanced tooltip
    modeToggleGroup.append("title")
        .text(hasTotalFloat
            ? `Current mode: ${isFloatBased ? 'Float-Based Criticality' : 'Longest Path (CPM)'}\nClick to switch calculation method`
            : "Float-Based mode requires Task Total Float field to be mapped");

    // Professional interactions with refined animations
    if (hasTotalFloat) {
        const self = this;

        modeToggleGroup
            .on("mouseover", function() {
                d3.select(this).select(".mode-button-container rect")
                    .style("fill", hoverBgColor)
                    .style("stroke-width", 2.5)
                    .style("transform", "translateY(-2px)")
                    .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[8]})`);
            })
            .on("mouseout", function() {
                d3.select(this).select(".mode-button-container rect")
                    .style("fill", bgColor)
                    .style("stroke-width", 2)
                    .style("transform", "translateY(0)")
                    .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[2]})`);
            })
            .on("mousedown", function() {
                d3.select(this).select(".mode-button-container rect")
                    .style("transform", "translateY(0) scale(0.96)")
                    .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[4]})`);
            })
            .on("mouseup", function() {
                d3.select(this).select(".mode-button-container rect")
                    .style("transform", "translateY(-2px) scale(1)")
                    .style("filter", `drop-shadow(${self.UI_TOKENS.shadow[8]})`);
            });

        modeToggleGroup.on("click", function(event) {
            if (event) event.stopPropagation();
            self.toggleCriticalityMode();
        });

        // Keyboard support
        modeToggleGroup.on("keydown", function(event) {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                self.toggleCriticalityMode();
            }
        });
    }
}

private toggleCriticalityMode(): void {
    try {
        const currentMode = this.settings?.criticalityMode?.calculationMode?.value?.value || 'longestPath';
        const newMode = currentMode === 'longestPath' ? 'floatBased' : 'longestPath';
        
        this.debugLog(`Toggling criticality mode from ${currentMode} to ${newMode}`);
        
        // Reset float threshold when switching to Longest Path mode
        if (newMode === 'longestPath' && this.floatThreshold > 0) {
            this.debugLog(`Resetting float threshold from ${this.floatThreshold} to 0`);
            this.floatThreshold = 0;
            
            // Update float threshold input if it exists
            if (this.floatThresholdInput) {
                this.floatThresholdInput.property("value", "0");
            }
        }
        
        // Update the settings value locally
        if (this.settings?.criticalityMode?.calculationMode) {
            this.settings.criticalityMode.calculationMode.value = {
                value: newMode,
                displayName: newMode === 'longestPath' ? 'Longest Path' : 'Float-Based'
            };
        }
        
        // Single batch persist
        const properties: any[] = [{
            objectName: "criticalityMode",
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
        
        // Update UI elements
        this.createModeToggleButton(this.lastUpdateOptions?.viewport.width || 800);
        this.createFloatThresholdControl();
        
        // CRITICAL FIX: Force canvas refresh
        this.forceCanvasRefresh();

        // BUG-002 FIX: Preserve scroll position when changing criticality mode
        // Mode change doesn't fundamentally reorder tasks, so scroll should be preserved
        this.captureScrollPosition();

        // Request update
        this.forceFullUpdate = true;
        if (this.lastUpdateOptions) {
            this.update(this.lastUpdateOptions);
        }

        this.debugLog("Visual update triggered by mode toggle");
        
    } catch (error) {
        console.error("Error toggling criticality mode:", error);
    }
}

/**
 * UPGRADED: Creates the Float Threshold control with premium input design and enhanced UX
 */
private createFloatThresholdControl(): void {
    this.stickyHeaderContainer.selectAll(".float-threshold-wrapper").remove();

    // Only show in float-based mode when near-critical is enabled
    const currentMode = this.settings?.criticalityMode?.calculationMode?.value?.value || 'longestPath';
    const isFloatBased = currentMode === 'floatBased';

    if (!this.showNearCritical || !isFloatBased) {
        this.floatThresholdInput = null as any;
        return;
    }

    // Get responsive layout mode
    const viewportWidth = this.lastUpdateOptions?.viewport?.width || 800;
    const layoutMode = this.getLayoutMode(viewportWidth);
    const isCompact = layoutMode === 'narrow';
    const isMedium = layoutMode === 'medium';

    // Premium control container with elevated design
    // Position in the right corner of the header
    const controlContainer = this.stickyHeaderContainer.append("div")
        .attr("class", "float-threshold-wrapper")
        .attr("role", "group")
        .attr("aria-label", "Near-critical threshold setting")
        .style("position", "absolute")
        .style("right", "10px")
        .style("top", `${this.UI_TOKENS.spacing.sm}px`)
        .style("display", "flex")
        .style("align-items", "center")
        .style("gap", isCompact ? `${this.UI_TOKENS.spacing.sm}px` : `${this.UI_TOKENS.spacing.md}px`)
        .style("height", `${this.UI_TOKENS.height.comfortable}px`)
        .style("padding", isCompact ? `0 ${this.UI_TOKENS.spacing.md}px` : `0 ${this.UI_TOKENS.spacing.xl}px`)
        .style("background-color", this.UI_TOKENS.color.neutral.white)
        .style("border", `2px solid ${this.UI_TOKENS.color.warning.default}`)
        .style("border-radius", `${this.UI_TOKENS.radius.pill}px`)
        .style("box-shadow", this.UI_TOKENS.shadow[4])
        .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

    // Icon and label container
    const labelContainer = controlContainer.append("div")
        .style("display", "flex")
        .style("align-items", "center")
        .style("gap", `${this.UI_TOKENS.spacing.sm}px`);

    // Near-critical indicator - solid color for consistency
    const iconSize = 12;
    const iconSvg = labelContainer.append("svg")
        .attr("width", iconSize)
        .attr("height", iconSize)
        .attr("viewBox", `0 0 ${iconSize} ${iconSize}`)
        .style("flex-shrink", "0");

    iconSvg.append("circle")
        .attr("cx", iconSize/2)
        .attr("cy", iconSize/2)
        .attr("r", iconSize/2)
        .attr("fill", this.UI_TOKENS.color.warning.default);

    // Descriptive label with enhanced typography - responsive text
    const labelText = isCompact ? "NC ≤" : (isMedium ? "Near-Crit ≤" : "Near-Critical ≤");
    labelContainer.append("span")
        .style("font-size", `${this.UI_TOKENS.fontSize.md}px`)
        .style("letter-spacing", "0.2px")
        .style("color", this.UI_TOKENS.color.neutral.grey160)
        .style("font-family", "Segoe UI, sans-serif")
        .style("font-weight", this.UI_TOKENS.fontWeight.medium)
        .style("white-space", "nowrap")
        .text(labelText);

    // Enhanced input field with premium styling
    this.floatThresholdInput = controlContainer.append("input")
        .attr("type", "number")
        .attr("min", "0")
        .attr("step", "1")
        .attr("value", this.floatThreshold)
        .attr("aria-label", "Near-critical threshold in days")
        .style("width", isCompact ? "44px" : "56px")
        .style("height", "24px")
        .style("padding", `${this.UI_TOKENS.spacing.xs}px ${this.UI_TOKENS.spacing.md}px`)
        .style("border", `2px solid ${this.UI_TOKENS.color.neutral.grey60}`)
        .style("border-radius", `${this.UI_TOKENS.radius.small}px`)
        .style("font-size", `${this.UI_TOKENS.fontSize.md}px`)
        .style("font-family", "Segoe UI, sans-serif")
        .style("font-weight", this.UI_TOKENS.fontWeight.semibold)
        .style("text-align", "center")
        .style("outline", "none")
        .style("background-color", this.UI_TOKENS.color.neutral.white)
        .style("color", this.UI_TOKENS.color.neutral.grey160)
        .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

    // Unit label with refined styling - hide in compact mode
    if (!isCompact) {
        controlContainer.append("span")
            .style("font-size", `${this.UI_TOKENS.fontSize.sm}px`)
            .style("letter-spacing", "0.2px")
            .style("color", this.UI_TOKENS.color.neutral.grey130)
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-weight", this.UI_TOKENS.fontWeight.medium)
            .style("white-space", "nowrap")
            .text("days");
    }

    // Enhanced help icon with better accessibility - hide in compact mode
    if (!isCompact) {
        const helpIcon = controlContainer.append("div")
            .attr("role", "button")
            .attr("aria-label", "Information about near-critical threshold")
            .attr("tabindex", "0")
            .style("width", "18px")
            .style("height", "18px")
            .style("border-radius", "50%")
            .style("border", `2px solid ${this.UI_TOKENS.color.neutral.grey60}`)
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

        // Enhanced hover interactions for help icon
        helpIcon
            .on("mouseover", function() {
                d3.select(this)
                    .style("background-color", this.UI_TOKENS.color.warning.light)
                    .style("border-color", this.UI_TOKENS.color.warning.default)
                    .style("color", this.UI_TOKENS.color.warning.default);
            }.bind(this))
            .on("mouseout", function() {
                d3.select(this)
                    .style("background-color", this.UI_TOKENS.color.neutral.grey10)
                    .style("border-color", this.UI_TOKENS.color.neutral.grey60)
                    .style("color", this.UI_TOKENS.color.neutral.grey130);
            }.bind(this));
    }

    // Enhanced input interactions
    const self = this;
    this.floatThresholdInput
        .on("focus", function() {
            d3.select(this)
                .style("border-color", self.UI_TOKENS.color.warning.default)
                .style("box-shadow", `0 0 0 3px ${self.UI_TOKENS.color.warning.lighter}`);
        })
        .on("blur", function() {
            d3.select(this)
                .style("border-color", self.UI_TOKENS.color.neutral.grey60)
                .style("box-shadow", "none");
        });

    // Input handler with visual feedback
    let floatThresholdTimeout: any = null;
    this.floatThresholdInput.on("input", function() {
        const value = parseFloat((this as HTMLInputElement).value);
        const newThreshold = isNaN(value) ? 0 : Math.max(0, value);

        // Update local value immediately for UI feedback
        self.floatThreshold = newThreshold;

        // Enhanced visual feedback
        d3.select(this)
            .transition()
            .duration(self.UI_TOKENS.motion.duration.fast)
            .style("background-color", self.UI_TOKENS.color.warning.lighter)
            .transition()
            .duration(self.UI_TOKENS.motion.duration.normal)
            .style("background-color", self.UI_TOKENS.color.neutral.white);

        // Debounce the actual update
        if (floatThresholdTimeout) {
            clearTimeout(floatThresholdTimeout);
        }

        floatThresholdTimeout = setTimeout(() => {
            self.host.persistProperties({
                merge: [{
                    objectName: "persistedState",
                    properties: { floatThreshold: self.floatThreshold },
                    selector: null
                }]
            });

            self.requestUpdate(true);
        }, 500); // Wait 500ms after user stops typing
    });

    // Container hover effect for elevated feel
    controlContainer
        .on("mouseover", function() {
            d3.select(this)
                .style("box-shadow", self.UI_TOKENS.shadow[8])
                .style("transform", "translateY(-1px)");
        })
        .on("mouseout", function() {
            d3.select(this)
                .style("box-shadow", self.UI_TOKENS.shadow[4])
                .style("transform", "translateY(0)");
        });
}

// ============================================================================
// TIMELINE ZOOM SLIDER - Microsoft-style axis zoom implementation
// ============================================================================

/**
 * Creates the zoom slider UI component matching Microsoft Power BI standard style
 * Design: Thin track line with circular handles at each end
 */
private createZoomSliderUI(visualWrapper: Selection<HTMLDivElement, unknown, null, undefined>): void {
    const sliderHeight = 32; // Compact height for Microsoft-style slider

    // Main container positioned at the bottom of the scrollable area
    this.zoomSliderContainer = visualWrapper.append("div")
        .attr("class", "timeline-zoom-slider-container")
        .style("position", "relative")
        .style("width", "100%")
        .style("height", `${sliderHeight}px`)
        .style("background-color", "#FFFFFF")
        .style("border-top", "1px solid #EDEBE9")
        .style("display", "none") // Hidden by default, shown when enabled
        .style("z-index", "50")
        .style("flex-shrink", "0")
        .style("user-select", "none");

    // Track container - will have margins applied to align with chart
    // This is positioned using left/right margins to match the chart area
    this.zoomSliderTrack = this.zoomSliderContainer.append("div")
        .attr("class", "zoom-slider-track")
        .style("position", "absolute")
        .style("left", "280px")  // Default, will be updated by updateZoomSliderTrackMargins
        .style("right", "100px") // Default, will be updated by updateZoomSliderTrackMargins
        .style("top", "50%")
        .style("transform", "translateY(-50%)")
        .style("height", "4px")
        .style("background-color", "#E1DFDD")
        .style("border-radius", "2px");

    // Mini chart canvas for task distribution preview (hidden in Microsoft style)
    const miniChartCanvas = document.createElement('canvas');
    miniChartCanvas.className = 'zoom-slider-mini-chart';
    miniChartCanvas.style.position = 'absolute';
    miniChartCanvas.style.left = '0';
    miniChartCanvas.style.top = '0';
    miniChartCanvas.style.width = '100%';
    miniChartCanvas.style.height = '100%';
    miniChartCanvas.style.pointerEvents = 'none';
    miniChartCanvas.style.display = 'none'; // Hidden by default for clean Microsoft look
    this.zoomSliderTrack.node()?.appendChild(miniChartCanvas);
    this.zoomSliderMiniChart = d3.select(miniChartCanvas);

    // Selection range (the visible/selected portion between handles)
    this.zoomSliderSelection = this.zoomSliderTrack.append("div")
        .attr("class", "zoom-slider-selection")
        .style("position", "absolute")
        .style("left", "0%")
        .style("width", "100%")
        .style("top", "0")
        .style("bottom", "0")
        .style("background-color", "#C8C6C4")  // Darker gray for selected area
        .style("border-radius", "2px")
        .style("cursor", "grab");

    // Left handle - circular Microsoft-style
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

    // Right handle - circular Microsoft-style
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

    // Setup event handlers
    this.setupZoomSliderEvents();
}

/**
 * Sets up mouse and touch event handlers for the zoom slider
 */
private setupZoomSliderEvents(): void {
    const self = this;

    // Left handle drag
    this.zoomSliderLeftHandle
        .on("mousedown", function(event: MouseEvent) {
            event.stopPropagation();
            event.preventDefault();
            self.startZoomDrag(event, 'left');
        })
        .on("touchstart", function(event: TouchEvent) {
            event.stopPropagation();
            event.preventDefault();
            const touch = event.touches[0];
            self.startZoomDrag({ clientX: touch.clientX, clientY: touch.clientY } as MouseEvent, 'left');
        });

    // Right handle drag
    this.zoomSliderRightHandle
        .on("mousedown", function(event: MouseEvent) {
            event.stopPropagation();
            event.preventDefault();
            self.startZoomDrag(event, 'right');
        })
        .on("touchstart", function(event: TouchEvent) {
            event.stopPropagation();
            event.preventDefault();
            const touch = event.touches[0];
            self.startZoomDrag({ clientX: touch.clientX, clientY: touch.clientY } as MouseEvent, 'right');
        });

    // Middle (selection area) drag for panning
    this.zoomSliderSelection
        .on("mousedown", function(event: MouseEvent) {
            // Only start middle drag if not on handles
            const target = event.target as HTMLElement;
            if (target.classList.contains('zoom-slider-handle') ||
                target.classList.contains('handle-grip')) {
                return;
            }
            event.preventDefault();
            self.startZoomDrag(event, 'middle');
        })
        .on("touchstart", function(event: TouchEvent) {
            const target = event.target as HTMLElement;
            if (target.classList.contains('zoom-slider-handle') ||
                target.classList.contains('handle-grip')) {
                return;
            }
            event.preventDefault();
            const touch = event.touches[0];
            self.startZoomDrag({ clientX: touch.clientX, clientY: touch.clientY } as MouseEvent, 'middle');
        });

    // Double-click on track to reset zoom
    this.zoomSliderTrack
        .on("dblclick", function() {
            self.resetZoom();
        });

    // Click on track outside selection to jump to that position
    this.zoomSliderTrack
        .on("mousedown", function(event: MouseEvent) {
            const target = event.target as HTMLElement;
            // Only handle clicks directly on the track, not on selection or handles
            if (!target.classList.contains('zoom-slider-track')) {
                return;
            }
            const trackRect = (self.zoomSliderTrack.node() as HTMLElement).getBoundingClientRect();
            const clickPercent = (event.clientX - trackRect.left) / trackRect.width;
            self.jumpZoomTo(clickPercent);
        });

    // Global mouse/touch move and up handlers (attached to document)
    document.addEventListener('mousemove', (event) => this.handleZoomDrag(event));
    document.addEventListener('mouseup', () => this.endZoomDrag());
    document.addEventListener('touchmove', (event) => {
        if (this.isZoomSliderDragging && event.touches.length > 0) {
            const touch = event.touches[0];
            this.handleZoomDrag({ clientX: touch.clientX, clientY: touch.clientY } as MouseEvent);
        }
    });
    document.addEventListener('touchend', () => this.endZoomDrag());
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

    // Update cursor based on drag type
    if (type === 'middle') {
        this.zoomSliderSelection.style("cursor", "grabbing");
    }

    // Add dragging class for visual feedback
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
            // Move left handle (start of zoom)
            let newStart = Math.max(0, Math.min(this.zoomDragStartLeft + deltaPercent,
                this.zoomRangeEnd - this.ZOOM_SLIDER_MIN_RANGE));
            this.zoomRangeStart = newStart;
            break;

        case 'right':
            // Move right handle (end of zoom)
            let newEnd = Math.min(1, Math.max(this.zoomDragStartRight + deltaPercent,
                this.zoomRangeStart + this.ZOOM_SLIDER_MIN_RANGE));
            this.zoomRangeEnd = newEnd;
            break;

        case 'middle':
            // Pan the entire selection
            const rangeSize = this.zoomDragStartRight - this.zoomDragStartLeft;
            let newRangeStart = this.zoomDragStartLeft + deltaPercent;
            let newRangeEnd = this.zoomDragStartRight + deltaPercent;

            // Clamp to boundaries
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

    // Update the slider UI
    this.updateZoomSliderUI();

    // Trigger visual update (throttled)
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

    // Clamp to boundaries
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
    // Throttle the visual updates
    if (this.zoomChangeTimeout) {
        clearTimeout(this.zoomChangeTimeout);
    }

    this.zoomChangeTimeout = setTimeout(() => {
        this.zoomChangeTimeout = null;
        // Force a re-render with the new zoom settings
        if (this.lastUpdateOptions) {
            this.forceFullUpdate = true;
            this.preserveScrollOnUpdate = true;
            if (this.scrollableContainer?.node()) {
                this.preservedScrollTop = this.scrollableContainer.node().scrollTop;
            }
            this.update(this.lastUpdateOptions);
        }
    }, 16); // ~60fps throttle
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

    // Update scrollable container height to account for slider
    this.updateScrollableContainerHeight();
}

/**
 * Updates the scrollable container height based on visible components
 * Note: With flexbox layout, height is automatically managed.
 * This method is kept for backwards compatibility but flexbox handles the layout.
 */
private updateScrollableContainerHeight(): void {
    // With flexbox layout (flex: 1 on scrollable container), the height is
    // automatically calculated based on available space after header,
    // zoom slider, and legend. No manual height calculation needed.
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

    // Set canvas size with device pixel ratio for sharp rendering
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Get all tasks to draw
    const tasksToShow = this.allFilteredTasks.length > 0 ? this.allFilteredTasks : this.allTasksToShow;
    if (tasksToShow.length === 0 || !this.fullTimelineDomain) return;

    const [minDate, maxDate] = this.fullTimelineDomain;
    const timeRange = maxDate.getTime() - minDate.getTime();
    if (timeRange <= 0) return;

    // Draw task bars as thin lines
    const barHeight = Math.max(1, rect.height / Math.max(tasksToShow.length, 50));
    const criticalColor = this.settings?.taskAppearance?.criticalPathColor?.value?.value ?? "#E81123";
    const taskColor = this.settings?.taskAppearance?.taskColor?.value?.value ?? "#0078D4";

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
 * Gets the zoomed date domain based on current zoom state
 */
private getZoomedDomain(): [Date, Date] | null {
    if (!this.fullTimelineDomain) return null;

    const [fullMin, fullMax] = this.fullTimelineDomain;
    const fullRange = fullMax.getTime() - fullMin.getTime();

    const zoomedMin = new Date(fullMin.getTime() + fullRange * this.zoomRangeStart);
    const zoomedMax = new Date(fullMin.getTime() + fullRange * this.zoomRangeEnd);

    return [zoomedMin, zoomedMax];
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
 * Updates the SVG clip rect to match the current chart dimensions.
 * This prevents bars from rendering past the left margin when zoomed.
 */
private updateChartClipRect(chartWidth: number, chartHeight: number): void {
    if (!this.chartClipRect) return;

    this.chartClipRect
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", chartWidth)
        .attr("height", chartHeight + 1000); // Extra height to account for scroll
}

private toggleConnectorLinesDisplay(): void {
    try {
        this.debugLog("Connector Lines Toggle method called!");
        this.showConnectorLinesInternal = !this.showConnectorLinesInternal;
        this.debugLog("New showConnectorLinesInternal value:", this.showConnectorLinesInternal);

        // STRICT SCROLL PRESERVATION: capture current position so toggling doesn't jump to top
        if (this.scrollableContainer?.node()) {
            const currentScrollTop = this.scrollableContainer.node().scrollTop;
            this.preservedScrollTop = currentScrollTop;
            this.preserveScrollOnUpdate = true;
            // Guard against subsequent Power BI retriggers
            this.scrollPreservationUntil = Date.now() + 500;
            this.debugLog(`Connector toggle: Captured scrollTop=${currentScrollTop}`);
        }

        // Persist the connector lines state
        this.host.persistProperties({
            merge: [{
                objectName: "connectorLines",
                properties: { showConnectorLines: this.showConnectorLinesInternal },
                selector: null
            }]
        });

        // Update visual immediately without requiring user scroll
        this.redrawVisibleTasks();

        // Update button appearance using current viewport width to avoid layout jump
        const viewportWidth = this.lastUpdateOptions?.viewport?.width
            || (this.target instanceof HTMLElement ? this.target.clientWidth : undefined)
            || 800;
        this.createConnectorLinesToggleButton(viewportWidth);

        this.debugLog("Connector lines toggled and persisted");
    } catch (error) {
        console.error("Error in connector toggle method:", error);
    }
}

    public update(options: VisualUpdateOptions) {
        console.log("===== UPDATE() CALLED =====");
        console.log("Update type:", options.type);
        console.log("Has dataViews:", !!options.dataViews);
        void this.updateInternal(options);
    }

private async updateInternal(options: VisualUpdateOptions) {
    this.debugLog("--- Visual Update Start ---");
    this.renderStartTime = performance.now();
    this.hideTooltip();
    
    if (this.isUpdating) {
        this.debugLog("Update already in progress, skipping");
        return;
    }

    // BUG-008 FIX: Skip Power BI updates during margin drag to prevent race conditions
    // The visual is already being updated via handleMarginDragUpdate() during drag
    if (this.isMarginDragging) {
        this.debugLog("Margin drag in progress, skipping Power BI update");
        return;
    }

    this.isUpdating = true;

    try {
        const updateType = this.determineUpdateType(options);
        this.debugLog(`Update type detected: ${updateType}`);
        
        if (updateType === UpdateType.Full && this.scrollableContainer?.node()) {
            const node = this.scrollableContainer.node();

            // Check if scroll should be preserved (e.g., when expanding/collapsing individual WBS groups)
            // Use BOTH the boolean flag AND a time-based cooldown to handle Power BI re-triggers
            const now = Date.now();
            const inCooldownPeriod = now < this.scrollPreservationUntil;
            const shouldPreserveScroll = this.preserveScrollOnUpdate || inCooldownPeriod;

            this.debugLog(`Scroll preservation check: flag=${this.preserveScrollOnUpdate}, inCooldown=${inCooldownPeriod}, shouldPreserve=${shouldPreserveScroll}, scrollTop=${node.scrollTop}`);

            this.preserveScrollOnUpdate = false; // Reset flag after checking

            if (!shouldPreserveScroll && !this.scrollThrottleTimeout && node.scrollTop > 0) {
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

        if (!options || !options.dataViews || !options.dataViews[0] || !options.viewport) {
            this.applyTaskFilter([]); // ← FIX #1: Clear filter on invalid options
            this.displayMessage("Required options not available."); 
            return;
        }
        
        const dataView = options.dataViews[0];
        const viewport = options.viewport;
        const viewportHeight = viewport.height;
        const viewportWidth = viewport.width;

        this.debugLog("Viewport:", viewportWidth, "x", viewportHeight);

        // METADATA CHECK: Determine if WBS columns exist in metadata (for button visibility)
        // This is independent of whether filtered tasks have WBS values
        // Also populate WBS level column indices and names for dynamic hierarchy support
        this.wbsLevelColumnIndices = [];
        this.wbsLevelColumnNames = [];
        this.wbsDataExistsInMetadata = this.hasDataRole(dataView, 'wbsLevels');

        if (this.wbsDataExistsInMetadata && dataView.table?.columns) {
            // Find all columns bound to the 'wbsLevels' data role
            for (let i = 0; i < dataView.table.columns.length; i++) {
                const column = dataView.table.columns[i];
                if (column.roles && column.roles['wbsLevels']) {
                    this.wbsLevelColumnIndices.push(i);
                    this.wbsLevelColumnNames.push(column.displayName || `Level ${this.wbsLevelColumnIndices.length}`);
                }
            }
        }

        this.settings = this.formattingSettingsService.populateFormattingSettingsModel(VisualSettings, dataView);

        if (this.settings?.taskAppearance?.showBaseline !== undefined) {
            this.showBaselineInternal = this.settings.taskAppearance.showBaseline.value;
        }

        if (this.settings?.taskAppearance?.showPreviousUpdate !== undefined) {
            this.showPreviousUpdateInternal = this.settings.taskAppearance.showPreviousUpdate.value;
        }

        // Sync connector lines state with settings
        if (this.settings?.connectorLines?.showConnectorLines !== undefined) {
            this.showConnectorLinesInternal = this.settings.connectorLines.showConnectorLines.value;
        }

        // Sync WBS expand/collapse state with settings
        if (this.settings?.wbsGrouping?.expandCollapseAll !== undefined) {
            this.wbsExpandedInternal = this.settings.wbsGrouping.expandCollapseAll.value;
            // Default expand depth follows existing toggle unless user manually overrode later
            if (!this.wbsManualExpansionOverride && this.wbsExpandToLevel === undefined) {
                this.wbsExpandToLevel = this.wbsExpandedInternal ? undefined : 0;
            }
        }

        this.showNearCritical = this.settings.displayOptions.showNearCritical.value;

        this.applyPublishModeOptimizations();

        // Update zoom slider visibility and styling from settings
        this.updateZoomSliderVisibility();

        if (this.isInitialLoad) {
            if (this.settings?.displayOptions?.showAllTasks !== undefined) {
                this.showAllTasksInternal = this.settings.displayOptions.showAllTasks.value;
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
            // BUG-006 FIX: Restore persisted legend selection state
            if (this.settings?.persistedState?.selectedLegendCategories !== undefined) {
                const savedCategories = this.settings.persistedState.selectedLegendCategories.value;
                if (savedCategories && savedCategories.trim().length > 0) {
                    this.selectedLegendCategories = new Set(savedCategories.split(',').filter(c => c.trim()));
                    this.debugLog(`Restored legend selection: ${savedCategories}`);
                } else {
                    this.selectedLegendCategories.clear();
                }
            }
            this.isInitialLoad = false;
        }

        const criticalColor = this.settings.taskAppearance.criticalPathColor.value.value;
        const connectorColor = this.settings.connectorLines.connectorColor.value.value;

        this.margin.left = this.settings.layoutSettings.leftMargin.value;
        this.updateMarginResizerPosition();

        this.clearVisual();
        this.updateHeaderElements(viewportWidth);
        this.createFloatThresholdControl();
        this.createTaskSelectionDropdown();
        this.createTraceModeToggle();

        if (!this.validateDataView(dataView)) {
            this.applyTaskFilter([]); // ← FIX #2: Clear filter on validation failure
            const mode = this.settings?.criticalityMode?.calculationMode?.value?.value || 'longestPath';
            if (mode === 'floatBased') {
                this.displayMessage("Float-Based mode requires: Task ID, Task Total Float, Start Date, Finish Date.");
            } else {
                this.displayMessage("Longest Path mode requires: Task ID, Duration, Start Date, Finish Date.");
            }
            return;
        }
        this.debugLog("Data roles validated.");

        this.transformDataOptimized(dataView);

        // CRITICAL FIX: Re-populate settings model now that SelectionIds exist.
        // This ensures the formatting pane gets valid selectors for the color pickers.
        this.settings = this.formattingSettingsService.populateFormattingSettingsModel(VisualSettings, dataView);

        // Phase 2: Invalidate render cache after data transformation
        this.invalidateRenderCache();

        if (this.selectedTaskId && !this.taskIdToTask.has(this.selectedTaskId)) {
            this.debugLog(`Selected task ${this.selectedTaskId} no longer exists in data`);
            this.selectTask(null, null);
        }

        if (this.allTasksData.length === 0) {
            this.applyTaskFilter([]); // ← FIX #3: Clear filter when no data
            this.displayMessage("No valid task data found to display.");
            return;
        }
        this.debugLog(`Transformed ${this.allTasksData.length} tasks.`);

        if (this.selectedTaskId) {
            const selectedTask = this.taskIdToTask.get(this.selectedTaskId);
            this.selectedTaskName = (selectedTask && selectedTask.name) || null;
        }

        this.createTaskSelectionDropdown();
        if (this.dropdownInput) {
            if (this.selectedTaskId) {
                this.dropdownInput.property("value", this.selectedTaskName || "");
            } else {
                this.dropdownInput.property("value", "");
            }
        }
        
        if (this.selectedTaskLabel) {
            if (this.selectedTaskId && this.selectedTaskName && this.settings.taskSelection.showSelectedTaskLabel.value) {
                this.selectedTaskLabel
                    .style("display", "block")
                    .text(`Selected: ${this.selectedTaskName}`);
            } else {
                this.selectedTaskLabel.style("display", "none");
            }
        }

        this.populateTaskDropdown();
        this.createTraceModeToggle();

        const enableTaskSelection = this.settings.taskSelection.enableTaskSelection.value;
        const mode = this.settings.criticalityMode.calculationMode.value.value;

        let predecessorTaskSet = new Set<string>();
        let successorTaskSet = new Set<string>();

        if (enableTaskSelection && this.selectedTaskId) {
            const traceModeSetting = this.settings.taskSelection.traceMode.value.value;
            const effectiveTraceMode = this.traceMode || traceModeSetting;

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

        const hasValidPlotDates = (task: Task) =>
            task.startDate instanceof Date && !isNaN(task.startDate.getTime()) &&
            task.finishDate instanceof Date && !isNaN(task.finishDate.getTime()) &&
            task.finishDate >= task.startDate;

        const tasksSortedByStartDate = this.allTasksData
            .filter(task => task.startDate instanceof Date && !isNaN(task.startDate.getTime()))
            .sort((a, b) => (a.startDate?.getTime() ?? 0) - (b.startDate?.getTime() ?? 0));

        // Only use tasks that can actually be plotted for subsequent filtering
        const plottableTasksSorted = tasksSortedByStartDate.filter(hasValidPlotDates);

        const criticalAndNearCriticalTasks = plottableTasksSorted.filter(task => 
            task.isCritical || task.isNearCritical
        );

        let tasksToConsider: Task[] = [];
        
        if (enableTaskSelection && this.selectedTaskId) {
            const effectiveTraceMode = this.traceMode || this.settings.taskSelection.traceMode.value.value;
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
            if (selectedTask && hasValidPlotDates(selectedTask) && !tasksToConsider.find(t => t.internalId === this.selectedTaskId)) {
                tasksToConsider.push(selectedTask);
            }
        } else {
            tasksToConsider = this.showAllTasksInternal 
                ? plottableTasksSorted 
                : (criticalAndNearCriticalTasks.length > 0) ? criticalAndNearCriticalTasks : plottableTasksSorted;
        }

        const maxTasksToShowSetting = this.settings.layoutSettings.maxTasksToShow.value;
        const limitedTasks = this.limitTasks(tasksToConsider, maxTasksToShowSetting);
        
        if (limitedTasks.length === 0) {
            this.applyTaskFilter([]); // ← FIX #4: Clear filter when no tasks after limiting
            this.displayMessage("No tasks to display after filtering/limiting."); 
            return;
        }

        const tasksToPlot = limitedTasks.filter(hasValidPlotDates);
        
        if (tasksToPlot.length === 0) {
            this.applyTaskFilter([]); // ← FIX #5: Clear filter when no valid dates
            this.displayMessage("Selected tasks lack valid Start/Finish dates required for plotting.");
            return;
        }

        // WBS GROUPING: If enabled, sort and order by WBS hierarchy
        const wbsGroupingEnabled = this.wbsDataExists &&
            this.settings?.wbsGrouping?.enableWbsGrouping?.value;

        // IMPORTANT: For WBS mode, calculate filtered task count BEFORE applying collapse/expand
        // This ensures groups remain visible even when collapsed
        let tasksAfterLegendFilter = tasksToPlot;
        if (this.legendDataExists && this.selectedLegendCategories.size > 0) {
            tasksAfterLegendFilter = tasksToPlot.filter(task => {
                if (task.legendValue) {
                    return this.selectedLegendCategories.has(task.legendValue);
                }
                return true;
            });
        }

        // Store all filtered tasks BEFORE collapse/expand for project end line calculation
        // This ensures the finish date reflects all filtered tasks, not just visible ones
        this.allFilteredTasks = [...tasksAfterLegendFilter];

        // Update group filtered counts BEFORE ordering (which respects collapse state)
        if (wbsGroupingEnabled) {
            this.updateWbsFilteredCounts(tasksAfterLegendFilter);
        }

        let orderedTasks: Task[];
        if (wbsGroupingEnabled) {
            // Use WBS-aware ordering (respects collapse/expand state)
            orderedTasks = this.applyWbsOrdering(tasksAfterLegendFilter);
        } else {
            // Original behavior: sort by start date
            orderedTasks = [...tasksAfterLegendFilter].sort((a, b) => (a.startDate?.getTime() ?? 0) - (b.startDate?.getTime() ?? 0));
        }

        // Final task list after all filtering and ordering
        let tasksToShow = orderedTasks;

        // NOW assign yOrder after all filtering is complete
        // For WBS mode, this also assigns yOrder to group headers
        if (wbsGroupingEnabled) {
            this.assignWbsYOrder(tasksToShow);
        } else {
            // Standard mode: just assign sequential yOrder to tasks
            tasksToShow.forEach((task, index) => { task.yOrder = index; });
        }

        // Check if we have any visible items after yOrder assignment
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

        // ✅ CORRECT: Apply filter with valid tasks
        this.applyTaskFilter(tasksToShow.map(t => t.id));

        const taskHeight = this.settings.taskAppearance.taskHeight.value;
        const taskPadding = this.settings.layoutSettings.taskPadding.value;

        // Calculate total rows based on the highest yOrder value assigned
        let totalRows = tasksWithYOrder.length;
        if (wbsGroupingEnabled) {
            // Find the maximum yOrder value across both tasks and groups
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
            // Total rows is max yOrder + 1 (since yOrder is 0-based)
            totalRows = maxYOrder + 1;
        }

        const totalSvgHeight = Math.max(50, totalRows * (taskHeight + taskPadding)) + this.margin.top + this.margin.bottom;

        const scaleSetupResult = this.setupTimeBasedSVGAndScales({ width: viewportWidth, height: totalSvgHeight }, tasksToShow);
        this.xScale = scaleSetupResult.xScale;
        this.yScale = scaleSetupResult.yScale;
        const chartWidth = scaleSetupResult.chartWidth;
        const calculatedChartHeight = scaleSetupResult.calculatedChartHeight;

        if (!this.xScale || !this.yScale) {
            this.applyTaskFilter([]); // ← FIX #6: Clear filter when scale creation fails
            this.displayMessage("Could not create time/band scale. Check Start/Finish dates."); 
            return;
        }

        this.mainSvg.attr("width", viewportWidth).attr("height", totalSvgHeight);
        this.headerSvg.attr("width", viewportWidth);

        this.mainGroup.attr("transform", `translate(${this.margin.left}, ${this.margin.top})`);
        this.headerGridLayer.attr("transform", `translate(${this.margin.left}, 0)`);

        // Create/update the margin resizer after SVG is properly sized
        this.createMarginResizer();

        const legendVisible = this.settings.legend.show.value && this.legendDataExists && this.legendCategories.length > 0;
        const legendOffset = legendVisible ? this.legendFooterHeight : 0;
        const availableContentHeight = Math.max(0, viewportHeight - this.headerHeight - legendOffset);

        // Always fill the available viewport height (minus header/legend) so the legend stays pinned.
        this.scrollableContainer
            .style("height", `${availableContentHeight}px`)
            .style("overflow-y", totalSvgHeight > availableContentHeight ? "scroll" : "hidden");

        // Update taskElementHeight before scroll adjustment (needed for position calculation)
        this.taskElementHeight = taskHeight + taskPadding;

        // SCROLL RESTORATION: Handle both strict preservation and WBS anchor-based restoration
        // Priority 1: Strict scroll preservation (for baseline/previous update toggles)
        // Priority 2: WBS anchor-based restoration (for WBS group expand/collapse)
        this.restoreScrollPosition(totalSvgHeight);

        // Pass skipInitialRender=true to prevent requestAnimationFrame double-render
        // since we call drawVisualElements immediately after
        this.setupVirtualScroll(tasksToShow, taskHeight, taskPadding, totalRows, true);

        // Get visible tasks using the centralized WBS-aware helper
        const visibleTasks = this.getVisibleTasks();

        this.drawVisualElements(visibleTasks, this.xScale, this.yScale, chartWidth, calculatedChartHeight);

        // Render legend after visual elements are drawn
        this.renderLegend(viewportWidth, viewportHeight);

        // Ensure WBS toggle button is visible now that WBS data has been processed
        // This fixes timing issue where button may not appear on initial load
        this.renderWbsCycleButtons(viewportWidth);

        // Update zoom slider UI and draw mini chart preview
        this.updateZoomSliderUI();
        this.drawZoomSliderMiniChart();
        this.updateZoomSliderTrackMargins();

        const renderEndTime = performance.now();
        this.debugLog(`Total render time: ${renderEndTime - this.renderStartTime}ms`);

    } catch (error) {
        console.error("--- ERROR during visual update ---", error);
        const errorMessage = error instanceof Error ? error.message : String(error);

        // ← FIX #7: Clear filter on unexpected errors
        this.applyTaskFilter([]);
        this.displayMessage(`Error updating visual: ${errorMessage}`);
    } finally {
        this.isUpdating = false;

        // BUG-012 FIX: Ensure scroll handler is always restored even if an error occurs
        // This prevents scroll events from being permanently disabled after an error
        if (this.scrollHandlerBackup && this.scrollableContainer) {
            this.scrollableContainer.on("scroll", this.scrollHandlerBackup);
            this.scrollHandlerBackup = null;
            this.debugLog("Scroll handler restored in finally block");
        }
    }
}

private handleViewportOnlyUpdate(options: VisualUpdateOptions): void {
        this.debugLog("Performing viewport-only update");
        const viewportWidth = options.viewport.width;
        const viewportHeight = options.viewport.height;
        
        // Update buttons and header elements
        // Use the centralized function which now includes the baseline toggle
        this.updateHeaderElements(viewportWidth);
        
        // Recalculate chart dimensions
        const chartWidth = Math.max(10, viewportWidth - this.settings.layoutSettings.leftMargin.value - this.margin.right);
        const legendVisible = this.settings.legend.show.value && this.legendDataExists && this.legendCategories.length > 0;
        const legendOffset = legendVisible ? this.legendFooterHeight : 0;
        const availableContentHeight = Math.max(0, viewportHeight - this.headerHeight - legendOffset);
        const totalSvgHeight = this.taskTotalCount * this.taskElementHeight + 
                             this.margin.top + this.margin.bottom;
        
        // Always fill available height (minus header/legend) to keep legend pinned
        this.scrollableContainer.style("height", `${availableContentHeight}px`)
                              .style("overflow-y", totalSvgHeight > availableContentHeight ? "scroll" : "hidden");
        
        // Update SVG dimensions
        this.mainSvg.attr("width", viewportWidth);
        this.headerSvg.attr("width", viewportWidth);
        
        // CRITICAL FIX: Update X scale range for new width
        if (this.xScale) {
            this.xScale.range([0, chartWidth]);
            this.debugLog(`Updated X scale range to [0, ${chartWidth}]`);
        }
        
        // Recalculate visible tasks for new viewport
        this.calculateVisibleTasks();
        
        // Clear and redraw with updated scales
        this.clearVisual();
        
        // Redraw grid lines if needed
        const showHorzGridLines = this.settings.gridLines.showGridLines.value;
        const showVertGridLines = this.settings.verticalGridLines.show.value;
        
        // Get visible tasks using the centralized WBS-aware helper
        const visibleTasks = this.getVisibleTasks();

        if (showHorzGridLines && this.yScale) {
            const currentLeftMargin = this.settings.layoutSettings.leftMargin.value;
            this.drawHorizontalGridLines(visibleTasks, this.yScale, chartWidth, currentLeftMargin,
                                        this.yScale.range()[1]);
        }

        if (showVertGridLines && this.xScale && this.yScale) {
            this.drawVerticalGridLines(this.xScale, this.yScale.range()[1],
                                      this.gridLayer, this.headerGridLayer);
        }

        // Redraw visible tasks with updated dimensions
        if (this.xScale && this.yScale) {
            this.drawVisualElements(
                visibleTasks,
                this.xScale,
                this.yScale,
                chartWidth,
                this.yScale.range()[1]
            );

            // Draw Data Date line on viewport-only updates
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

        // Store old settings to detect changes
        const oldSelectedPathIndex = this.settings?.drivingPathSelection?.selectedPathIndex?.value;
        const oldMultiPathEnabled = this.settings?.drivingPathSelection?.enableMultiPathToggle?.value;
        const oldShowPathInfo = this.settings?.drivingPathSelection?.showPathInfo?.value;

        // --- FIX START: REORDERED LOGIC ---

        // 1. First, process legend data to generate fresh SelectionIDs from the current DataView
        if (options.dataViews?.[0]) {
            this.processLegendData(options.dataViews[0]);
        }

        // 2. THEN populate settings.
        // getFormattingModel will now find the valid SelectionIds generated in step 1
        // and create functional color pickers.
        this.settings = this.formattingSettingsService.populateFormattingSettingsModel(
            VisualSettings, options.dataViews[0]);

        // --- FIX END ---

        // Check if driving path selection changed
        const newSelectedPathIndex = this.settings?.drivingPathSelection?.selectedPathIndex?.value;
        const newMultiPathEnabled = this.settings?.drivingPathSelection?.enableMultiPathToggle?.value;
        const newShowPathInfo = this.settings?.drivingPathSelection?.showPathInfo?.value;

        this.debugLog(`[Settings Update] Old path index: ${oldSelectedPathIndex}, New: ${newSelectedPathIndex}`);
        this.debugLog(`[Settings Update] Old multi-path: ${oldMultiPathEnabled}, New: ${newMultiPathEnabled}`);
        this.debugLog(`[Settings Update] Old show info: ${oldShowPathInfo}, New: ${newShowPathInfo}`);

        const drivingPathChanged = oldSelectedPathIndex !== newSelectedPathIndex ||
                                   oldMultiPathEnabled !== newMultiPathEnabled ||
                                   oldShowPathInfo !== newShowPathInfo;

        // Sync internal states when settings change via the pane
        if (this.settings?.taskAppearance?.showBaseline !== undefined) {
            this.showBaselineInternal = this.settings.taskAppearance.showBaseline.value;
        }

        // If driving path selection changed, recalculate criticality
        if (drivingPathChanged) {
            this.debugLog("Driving path selection changed, recalculating...");
            const mode = this.settings?.criticalityMode?.calculationMode?.value?.value ?? 'longestPath';
            if (mode === 'longestPath') {
                this.identifyLongestPathFromP6();
            } else {
                // Just update the label visibility (will hide it)
                this.updatePathInfoLabel();
            }
        }

        // Clear and redraw with new settings
        this.clearVisual();
        // Use the centralized function which includes all header elements
        this.updateHeaderElements(options.viewport.width);
        this.createFloatThresholdControl();
        this.createTaskSelectionDropdown();

        // Keep dropdown/labels in sync with the current selection after recreation
        if (this.dropdownInput) {
            if (this.selectedTaskId) {
                this.dropdownInput.property("value", this.selectedTaskName || "");
            } else {
                this.dropdownInput.property("value", "");
            }
        }

        if (this.selectedTaskLabel) {
            if (this.selectedTaskId && this.selectedTaskName && this.settings.taskSelection.showSelectedTaskLabel.value) {
                this.selectedTaskLabel
                    .style("display", "block")
                    .text(`Selected: ${this.selectedTaskName}`);
            } else {
                this.selectedTaskLabel.style("display", "none");
            }
        }

        this.populateTaskDropdown();
        this.createTraceModeToggle();
        
        // Redraw with updated settings
        // We must recalculate scales here because a setting change (like baseline toggle via format pane)
        // might affect the X-axis domain or Y-axis layout (task height/padding).
        if (this.xScale && this.yScale) {
             // Calculate total rows for proper scrolling (including WBS groups if enabled)
             const taskHeight = this.settings.taskAppearance.taskHeight.value;
             const taskPadding = this.settings.layoutSettings.taskPadding.value;
             const wbsGroupingEnabled = this.wbsDataExists && this.settings?.wbsGrouping?.enableWbsGrouping?.value;

             let totalRows = this.allTasksToShow.length;
             if (wbsGroupingEnabled) {
                 // Find the maximum yOrder value across both tasks and groups
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

             // Recalculate scales
             const scaleSetupResult = this.setupTimeBasedSVGAndScales(
                options.viewport,
                this.allTasksToShow // Use all tasks for scale calculation
            );
            this.xScale = scaleSetupResult.xScale;
            this.yScale = scaleSetupResult.yScale;
            const chartWidth = scaleSetupResult.chartWidth;
            const calculatedChartHeight = scaleSetupResult.calculatedChartHeight;

            // Update taskElementHeight as it might have changed
            this.taskElementHeight = taskHeight + taskPadding;

            // Update virtual scroll with correct totalRows
            const totalSvgHeight = Math.max(50, totalRows * this.taskElementHeight) + this.margin.top + this.margin.bottom;
            this.mainSvg.attr("height", totalSvgHeight);
            this.taskTotalCount = totalRows;

            // Recalculate visible tasks in case layout changed
            this.calculateVisibleTasks();

            // Get visible tasks using the centralized WBS-aware helper
            const visibleTasks = this.getVisibleTasks();

            // Ensure scales are valid before drawing
            if (this.xScale && this.yScale) {
                this.drawVisualElements(
                    visibleTasks,
                    this.xScale,
                    this.yScale,
                    chartWidth,
                    calculatedChartHeight
                );

                // Draw Data Date line on settings-only updates
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
 * Handles margin-only updates during drag for real-time visual feedback
 * Does NOT recreate the resizer or call clearVisual() to preserve drag state
 */
private handleMarginDragUpdate(newLeftMargin: number): void {
    if (!this.xScale || !this.yScale || !this.allTasksToShow) return;

    // Update margin
    this.margin.left = newLeftMargin;

    // Recalculate chart width based on new margin
    const viewportWidth = this.lastViewport?.width || 0;
    const chartWidth = Math.max(10, viewportWidth - newLeftMargin - this.margin.right);

    // Update X scale range
    this.xScale.range([0, chartWidth]);

    // Update transforms
    this.mainGroup?.attr("transform", `translate(${this.margin.left}, ${this.margin.top})`);
    this.headerGridLayer?.attr("transform", `translate(${this.margin.left}, 0)`);

    // Redraw only the visual elements (gantt bars, grid lines, etc.) without destroying resizer
    const visibleTasks = this.allTasksToShow.slice(this.viewportStartIndex, this.viewportEndIndex + 1);

    // Clear only the drawing layers, NOT the resizer
    this.gridLayer?.selectAll("*").remove();
    this.arrowLayer?.selectAll("*").remove();
    this.taskLayer?.selectAll("*").remove();
    this.headerGridLayer?.selectAll("*").remove();

    // Redraw with new dimensions
    this.drawVisualElements(
        visibleTasks,
        this.xScale,
        this.yScale,
        chartWidth,
        0  // calculatedChartHeight not needed for redraw
    );

    // Update resizer position (but don't recreate it)
    this.updateMarginResizerPosition();
}

private clearVisual(): void {
            this.gridLayer?.selectAll("*").remove();
            this.arrowLayer?.selectAll("*").remove();
            this.taskLayer?.selectAll("*").remove();
            this.mainSvg?.select("defs").remove();
        
            this.headerGridLayer?.selectAll("*").remove();

            /* MODIFICATION: Stop removing persistent header elements. They will be updated in place.
            this.headerSvg?.selectAll(".divider-line").remove();
            this.headerSvg?.selectAll(".connector-toggle-group").remove(); // Clear connector toggle
            this.stickyHeaderContainer?.selectAll(".visual-title").remove();
            */
        
            this.mainSvg?.selectAll(".message-text").remove();
            this.headerSvg?.selectAll(".message-text").remove();
            
            // NEW: Clear canvas
            if (this.canvasElement && this.canvasContext) {
                this.canvasContext.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
                this.canvasElement.style.display = 'none';
            }
        }

private drawHeaderDivider(viewportWidth: number): void {
        if (!this.headerSvg) return;

        /* MODIFICATION: Use D3 update pattern instead of always appending */
        
        const lineData = [viewportWidth];
        // Select the existing line (if any) and bind the data
        const lineSelection = this.headerSvg.selectAll<SVGLineElement, number>(".divider-line")
            .data(lineData);

        // Enter + Update pattern
        lineSelection.enter()
            .append("line")
            .attr("class", "divider-line")
            .attr("x1", 0)
            .attr("y1", this.headerHeight - 1)
            .attr("y2", this.headerHeight - 1)
            .attr("stroke", "#e0e0e0") // Lighter color
            .attr("stroke-width", 1)
            .merge(lineSelection as any) // Merge enter selection with the update selection (Casting to any if needed due to D3 type definitions)
            .attr("x2", d => d); // Update the width (x2)
    }
    
    private createArrowheadMarkers(
        targetSvg: Selection<SVGSVGElement, unknown, null, undefined>,
        arrowSize: number,
        criticalColor: string,
        connectorColor: string
    ): void {
        if (!targetSvg) return;
        targetSvg.select("defs").remove();
        const defs = targetSvg.append("defs");
        
        // Create critical path marker - LARGER and more visible
        defs.append("marker")
            .attr("id", "arrowhead-critical")
            .attr("viewBox", "0 0 12 12")
            .attr("refX", 11)  // Position at tip
            .attr("refY", 6)
            .attr("markerWidth", arrowSize * 1.5)  // 50% larger
            .attr("markerHeight", arrowSize * 1.5)
            .attr("orient", "auto")
            .append("path")
                .attr("d", "M 1,1 L 11,6 L 1,11 L 3,6 Z")  // Filled triangle with notch
                .style("fill", criticalColor)
                .style("stroke", criticalColor)
                .style("stroke-width", "0.5");

        // Create normal connector marker - LARGER and more visible
        defs.append("marker")
            .attr("id", "arrowhead")
            .attr("viewBox", "0 0 12 12")
            .attr("refX", 11)
            .attr("refY", 6)
            .attr("markerWidth", arrowSize * 1.3)  // 30% larger
            .attr("markerHeight", arrowSize * 1.3)
            .attr("orient", "auto")
            .append("path")
                .attr("d", "M 1,1 L 11,6 L 1,11 L 3,6 Z")
                .style("fill", connectorColor)
                .style("stroke", connectorColor)
                .style("stroke-width", "0.5");
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
    const taskHeight = this.settings.taskAppearance.taskHeight.value;
    const taskPadding = this.settings.layoutSettings.taskPadding.value;
    const currentLeftMargin = this.settings.layoutSettings.leftMargin.value;
    const svgWidth = effectiveViewport.width;

    // Calculate row count: include group headers when WBS grouping is enabled
    let rowCount = tasksToShow.length;
    const wbsGroupingEnabled = this.wbsDataExists && this.settings?.wbsGrouping?.enableWbsGrouping?.value;

    if (wbsGroupingEnabled) {
        // Find the maximum yOrder value across both tasks and groups
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
        // Row count is max yOrder + 1 (since yOrder is 0-based)
        if (maxYOrder >= 0) {
            rowCount = maxYOrder + 1;
        }
    }

    const calculatedChartHeight = Math.max(50, rowCount * (taskHeight + taskPadding));
    const chartWidth = Math.max(10, svgWidth - currentLeftMargin - this.margin.right);

    // Collect ALL date timestamps including baseline dates
    const allTimestamps: number[] = [];

    // Include Data Date so scale always accounts for it
    if (this.dataDate instanceof Date && !isNaN(this.dataDate.getTime())) {
        allTimestamps.push(this.dataDate.getTime());
    }

    // NEW: Check if baseline should be included based on the internal toggle state
    const includeBaselineInScale = this.showBaselineInternal;
    const includePreviousUpdateInScale = this.showPreviousUpdateInternal;

    // IMPORTANT: For WBS mode, include dates from summary bars of ALL groups
    // This maintains consistent time scale perspective regardless of collapse/expand state
    if (wbsGroupingEnabled && this.wbsGroups.length > 0) {
        for (const group of this.wbsGroups) {
            if (group.summaryStartDate && !isNaN(group.summaryStartDate.getTime())) {
                allTimestamps.push(group.summaryStartDate.getTime());
            }
            if (group.summaryFinishDate && !isNaN(group.summaryFinishDate.getTime())) {
                allTimestamps.push(group.summaryFinishDate.getTime());
            }

            // Include WBS-level previous update and baseline ranges when toggles are on
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
        // Add regular start/finish dates
        if (task.startDate && !isNaN(task.startDate.getTime())) {
            allTimestamps.push(task.startDate.getTime());
        }
        if (task.finishDate && !isNaN(task.finishDate.getTime())) {
            allTimestamps.push(task.finishDate.getTime());
        }

        // IMPORTANT: Only add baseline dates if they exist AND the toggle is ON
        if (includeBaselineInScale) {
            if (task.baselineStartDate && !isNaN(task.baselineStartDate.getTime())) {
                allTimestamps.push(task.baselineStartDate.getTime());
            }
            if (task.baselineFinishDate && !isNaN(task.baselineFinishDate.getTime())) {
                allTimestamps.push(task.baselineFinishDate.getTime());
            }
        }

        // Add previous update dates if toggle is ON
        if (includePreviousUpdateInScale) {
            if (task.previousUpdateStartDate && !isNaN(task.previousUpdateStartDate.getTime())) {
                allTimestamps.push(task.previousUpdateStartDate.getTime());
            }
            if (task.previousUpdateFinishDate && !isNaN(task.previousUpdateFinishDate.getTime())) {
                allTimestamps.push(task.previousUpdateFinishDate.getTime());
            }
        }
    });

    // WBS FIX: When all groups are collapsed, include WBS group summary dates for scale calculation
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

    // Filter out any invalid timestamps
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
        const singleDate = new Date(minTimestamp);
        domainMinDate = new Date(new Date(singleDate).setDate(singleDate.getDate() - 1));
        domainMaxDate = new Date(new Date(singleDate).setDate(singleDate.getDate() + 1));
    } else {
        // Add padding to ensure all dates (including baselines) are visible
        const domainPaddingMilliseconds = Math.max((maxTimestamp - minTimestamp) * 0.05, 86400000);
        domainMinDate = new Date(minTimestamp - domainPaddingMilliseconds);
        domainMaxDate = new Date(maxTimestamp + domainPaddingMilliseconds);
    }

    // Store the full timeline domain for the zoom slider
    this.fullTimelineDomain = [domainMinDate, domainMaxDate];

    // Apply zoom state to calculate visible domain
    let visibleMinDate = domainMinDate;
    let visibleMaxDate = domainMaxDate;

    const isZoomed = this.zoomSliderEnabled && (this.zoomRangeStart > 0 || this.zoomRangeEnd < 1);
    if (isZoomed) {
        const fullRange = domainMaxDate.getTime() - domainMinDate.getTime();
        visibleMinDate = new Date(domainMinDate.getTime() + fullRange * this.zoomRangeStart);
        visibleMaxDate = new Date(domainMinDate.getTime() + fullRange * this.zoomRangeEnd);
    }

    // Log for debugging
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
    // Use totalRows if provided (includes groups in WBS mode), otherwise use task count
    this.taskTotalCount = totalRows !== undefined ? totalRows : tasks.length;
    this.taskElementHeight = taskHeight + taskPadding;

    // Create a placeholder container with proper height to enable scrolling
    const totalContentHeight = this.taskTotalCount * this.taskElementHeight;

    // Set full height for scrolling
    this.mainSvg
        .attr("height", totalContentHeight + this.margin.top + this.margin.bottom);

    // Remove any existing scroll listener properly
    if (this.scrollListener) {
        this.scrollableContainer.on("scroll", null);
        this.scrollListener = null;
    }

    // Setup scroll handler with throttling
    const self = this;
    this.scrollListener = function() {
        if (!self.scrollThrottleTimeout) {
            self.scrollThrottleTimeout = setTimeout(() => {
                self.scrollThrottleTimeout = null;
                self.handleScroll();
            }, 50); // Throttle to 20fps
        }
    };

    this.scrollableContainer.on("scroll", this.scrollListener);

    // CRITICAL: Calculate initial visible range
    this.calculateVisibleTasks();

    // Only schedule initial render if not skipped (caller will handle rendering)
    // This prevents double-render when drawVisualElements is called immediately after
    if (!skipInitialRender && this.xScale && this.yScale && this.allTasksToShow.length > 0) {
        requestAnimationFrame(() => {
            this.redrawVisibleTasks();
        });
    }
}

// Add this helper method for canvas mouse coordinates
private getCanvasMouseCoordinates(event: MouseEvent): { x: number, y: number } {
    if (!this.canvasElement) return { x: 0, y: 0 };
    
    const rect = this.canvasElement.getBoundingClientRect();
    
    // Simply convert from page coordinates to canvas coordinates
    // No need to account for DPR here as we're working in CSS pixels
    return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
    };
}

// Add this helper method for showing tooltips
private showTaskTooltip(task: Task, event: MouseEvent): void {
    const tooltip = this.tooltipDiv;
    if (!tooltip || !task) return;
    
    tooltip.selectAll("*").remove();
    tooltip.style("visibility", "visible");
    
    // Standard Fields
    tooltip.append("div").append("strong").text("Task: ")
        .select<HTMLElement>(function() { return this.parentNode as HTMLElement; })
        .append("span").text(task.name || "");
        
    tooltip.append("div").append("strong").text("Start Date: ")
        .select<HTMLElement>(function() { return this.parentNode as HTMLElement; })
        .append("span").text(this.formatDate(task.startDate));
        
    tooltip.append("div").append("strong").text("Finish Date: ")
        .select<HTMLElement>(function() { return this.parentNode as HTMLElement; })
        .append("span").text(this.formatDate(task.finishDate));
    
    // Mode-specific Info
    const modeInfo = tooltip.append("div")
        .classed("tooltip-mode-info", true)
        .style("margin-top", "8px")
        .style("border-top", "1px solid #eee")
        .style("padding-top", "8px");

    // Display mode
    const mode = this.settings?.criticalityMode?.calculationMode?.value?.value || 'longestPath';
    const criticalColor = this.settings.taskAppearance.criticalPathColor.value.value;
    const selectionHighlightColor = "#8A2BE2";
    
    modeInfo.append("div")
        .style("font-size", "10px")
        .style("font-style", "italic")
        .style("color", "#666")
        .text(`Mode: ${mode === 'floatBased' ? 'Float-Based' : 'Longest Path'}`);

    // Status
    modeInfo.append("div").append("strong").style("color", "#555").text("Status: ")
        .select<HTMLElement>(function() { return this.parentNode as HTMLElement; })
        .append("span")
        .style("color", function() {
            if (task.internalId === this.selectedTaskId) return selectionHighlightColor;
            if (task.isCritical) return criticalColor;
            if (task.isNearCritical) return this.settings.taskAppearance.nearCriticalColor.value.value;
            return "inherit";
        }.bind(this))
        .text(function() {
            if (task.internalId === this.selectedTaskId) return "Selected";
            if (task.isCritical) return mode === 'floatBased' ? "Critical (Float ≤ 0)" : "On Longest Path";
            if (task.isNearCritical) return "Near Critical";
            return mode === 'floatBased' ? "Non-Critical" : "Not on Longest Path";
        }.bind(this));

    // Show float values in Float-Based mode
    if (mode === 'floatBased') {
        if (task.userProvidedTotalFloat !== undefined) {
            modeInfo.append("div").append("strong").text("Total Float: ")
                .select<HTMLElement>(function() { return this.parentNode as HTMLElement; })
                .append("span")
                .style("color", task.userProvidedTotalFloat <= 0 ? criticalColor : "inherit")
                .text(task.userProvidedTotalFloat.toFixed(2) + " days");
        }
        
        if (task.taskFreeFloat !== undefined) {
            modeInfo.append("div").append("strong").text("Task Free Float: ")
                .select<HTMLElement>(function() { return this.parentNode as HTMLElement; })
                .append("span").text(task.taskFreeFloat.toFixed(2) + " days");
        }
    }

    // Duration (only for Longest Path mode)
    if (mode === 'longestPath') {
        modeInfo.append("div").append("strong").text("Rem. Duration: ")
            .select<HTMLElement>(function() { return this.parentNode as HTMLElement; })
            .append("span").text(`${task.duration} (work days)`);
    }
    
    // Custom Tooltip Fields
    if (task.tooltipData && task.tooltipData.length > 0) {
        const customInfo = tooltip.append("div")
            .classed("tooltip-custom-info", true)
            .style("margin-top", "8px")
            .style("border-top", "1px solid #eee")
            .style("padding-top", "8px");

        customInfo.append("div")
            .style("font-weight", "bold")
            .style("margin-bottom", "4px")
            .text("Additional Information:");

        // Iterate over array in order
        for (const item of task.tooltipData) {
            let formattedValue = "";
            if (item.value instanceof Date) {
                formattedValue = this.formatDate(item.value);
            } else if (typeof item.value === 'number') {
                formattedValue = item.value.toLocaleString();
            } else {
                formattedValue = String(item.value);
            }

            customInfo.append("div")
                .append("strong").text(`${item.key}: `)
                .select<HTMLElement>(function() { return this.parentNode as HTMLElement; })
                .append("span").text(formattedValue);
        }
    }

    // User Float Threshold Info
    if (this.showNearCritical && this.floatThreshold > 0) {
        tooltip.append("div")
            .style("margin-top", "8px")
            .style("font-style", "italic")
            .style("font-size", "10px")
            .style("color", "#666")
            .text(`Near Critical Threshold: ${this.floatThreshold}`);
    }

    // Add selection hint
    tooltip.append("div")
        .style("margin-top", "8px")
        .style("font-style", "italic")
        .style("font-size", "10px")
        .style("color", "#666")
        .text(`Click to ${this.selectedTaskId === task.internalId ? "deselect" : "select"} this task`);

    // Position the tooltip
    this.positionTooltip(tooltip.node(), event);
}

private hideTooltip(): void {
    if (this.tooltipDiv) {
        this.tooltipDiv.style("visibility", "hidden");
    }
}

private updateHeaderElements(viewportWidth: number): void {
    // Check if elements need updating

    // FIX: Safely get the current text.
    // Initialize currentToggleText as empty.
    let currentToggleText = "";
    const textSelection = this.toggleButtonGroup?.select("text");
    
    // Check if the selection exists AND is not empty before attempting to read its text content.
    if (textSelection && !textSelection.empty()) {
        currentToggleText = textSelection.text();
    }
    
    const expectedToggleText = this.showAllTasksInternal ? "Show Critical" : "Show All";
    
    // If the text doesn't match (which it won't on initial load, as currentToggleText will be ""), the button is created/updated.
    if (currentToggleText !== expectedToggleText) {
        this.createOrUpdateToggleButton(viewportWidth);
    }
    
    // Only redraw divider if width changed significantly
    const dividerLine = this.headerSvg?.select(".divider-line");
    if (dividerLine && !dividerLine.empty()) {
        const currentX2 = parseFloat(dividerLine.attr("x2"));
        if (Math.abs(currentX2 - viewportWidth) > 1) {
            dividerLine.attr("x2", viewportWidth);
        }
    } else {
        this.drawHeaderDivider(viewportWidth);
    }
    
    // Update other header elements as needed
    this.createModeToggleButton(viewportWidth);
    this.createOrUpdateBaselineToggleButton(viewportWidth);
    this.createOrUpdatePreviousUpdateToggleButton(viewportWidth);
    this.createConnectorLinesToggleButton(viewportWidth);
    this.renderWbsCycleButtons(viewportWidth);
}

    private calculateVisibleTasks(): void {
        if (!this.scrollableContainer || !this.scrollableContainer.node()) return;
        
        const containerNode = this.scrollableContainer.node();
        const scrollTop = containerNode.scrollTop;
        const viewportHeight = containerNode.clientHeight;
        
        // Add buffer rows above and below viewport for smooth scrolling
        const bufferCount = Math.ceil(viewportHeight / this.taskElementHeight) * 0.5;
        
        // Calculate visible task range based on scroll position
        this.viewportStartIndex = Math.max(0, Math.floor(scrollTop / this.taskElementHeight) - bufferCount);
        
        // Calculate how many tasks can fit in viewport (plus buffer)
        this.visibleTaskCount = Math.ceil(viewportHeight / this.taskElementHeight) + (bufferCount * 2);
        
        // Ensure we don't exceed total count
        this.viewportEndIndex = Math.min(this.taskTotalCount - 1, this.viewportStartIndex + this.visibleTaskCount);
        
        this.debugLog(`Viewport: ${this.viewportStartIndex} - ${this.viewportEndIndex} of ${this.taskTotalCount}`);
    }
    
private handleScroll(): void {
    const oldStart = this.viewportStartIndex;
    const oldEnd = this.viewportEndIndex;
    
    this.calculateVisibleTasks();
    
    // Only redraw if the visible range has changed OR if canvas is empty
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

// Add this helper method
private canvasHasContent(): boolean {
    if (!this.canvasElement || !this.canvasContext) return false;

    // Check if canvas has any non-transparent pixels
    try {
        const imageData = this.canvasContext.getImageData(0, 0, 1, 1);
        return imageData.data[3] > 0; // Check alpha channel
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
        // Filter tasks whose yOrder falls within the visible range
        return this.allTasksToShow.filter(t =>
            t.yOrder !== undefined &&
            t.yOrder >= this.viewportStartIndex &&
            t.yOrder <= this.viewportEndIndex
        );
    } else {
        // Original behavior: slice by array index
        return this.allTasksToShow.slice(this.viewportStartIndex, this.viewportEndIndex + 1);
    }
}

private redrawVisibleTasks(): void {
    if (!this.xScale || !this.yScale || !this.allTasksToShow) {
        console.warn("Cannot redraw: Missing scales or task data");
        return;
    }

    // Use centralized helper for WBS-aware visible task calculation
    const visibleTasks = this.getVisibleTasks();

    const shouldUseCanvas = visibleTasks.length > this.CANVAS_THRESHOLD;
    const modeChanged = shouldUseCanvas !== this.useCanvasRendering;

    // BUG-011 FIX: Track if we're switching modes to delay hiding until new content is ready
    if (modeChanged) {
        this.useCanvasRendering = shouldUseCanvas;
        // DON'T hide old layer yet - render new content first, then hide old
        // This prevents flicker by ensuring new content is visible before old is hidden
    }

    // Clear existing elements in current mode (but don't hide layers yet if mode changed)
    if (!modeChanged) {
        // Same mode - just clear existing elements
        this.arrowLayer?.selectAll("*").remove();
        this.taskLayer?.selectAll("*").remove();
    } else {
        // Mode changed - clear the NEW renderer's old content (if any)
        if (this.useCanvasRendering) {
            // Switching TO canvas - canvas might have stale content
            if (this.canvasContext && this.canvasElement) {
                this.canvasContext.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
            }
        } else {
            // Switching TO SVG - SVG layers might have stale content
            this.taskLayer?.selectAll("*").remove();
            this.arrowLayer?.selectAll("*").remove();
        }
    }

    // Clear WBS group layer before redrawing
    if (this.wbsGroupLayer) {
        this.wbsGroupLayer.selectAll('.wbs-group-header').remove();
    }

    // MODIFICATION: Prepare for Gridline redraw
    const showHorzGridLines = this.settings.gridLines.showGridLines.value;
    const currentLeftMargin = this.settings.layoutSettings.leftMargin.value;
    const chartWidth = this.xScale.range()[1];
    const chartHeight = this.yScale.range()[1];

    // MODIFICATION: Always clear stale SVG gridlines before redrawing in either mode.
    if (showHorzGridLines) {
        this.gridLayer?.selectAll(".grid-line.horizontal").remove();
    }
    
    if (this.useCanvasRendering) {
        // --- Canvas Rendering Path ---
        // BUG-011 FIX: Hide SVG layers AFTER canvas content is ready (see below)
        // Position the canvas element with pixel-perfect positioning
        if (this.canvasElement) {
            const leftMargin = Math.round(this.margin.left);
            const topMargin = Math.round(this.margin.top);
            
            this.canvasElement.style.display = 'block';
            this.canvasElement.style.visibility = 'visible';
            this.canvasElement.style.left = `${leftMargin}px`;
            this.canvasElement.style.top = `${topMargin}px`;
            this.canvasElement.style.imageRendering = 'auto';
            this.canvasElement.style.transform = 'translateZ(0)'; // Force GPU acceleration
        }

        // Use the new helper to size, clear, and scale the canvas
        if (this._setupCanvasForDrawing(chartWidth, chartHeight)) {

            // MODIFICATION: Draw Gridlines on Canvas
            if (showHorzGridLines) {
                this.drawHorizontalGridLinesCanvas(visibleTasks, this.yScale, chartWidth, currentLeftMargin);
            }

            // Draw tasks on the prepared canvas
            this.drawTasksCanvas(
                visibleTasks,
                this.xScale,
                this.yScale,
                this.settings.taskAppearance.taskColor.value.value,
                this.settings.taskAppearance.milestoneColor.value.value,
                this.settings.taskAppearance.criticalPathColor.value.value,
                this.settings.textAndLabels.labelColor.value.value,
                this.settings.textAndLabels.showDuration.value,
                this.settings.taskAppearance.taskHeight.value,
                this.settings.textAndLabels.dateBackgroundColor.value.value,
                1 - (this.settings.textAndLabels.dateBackgroundTransparency.value / 100)
            );

            // ACCESSIBILITY: Create fallback for canvas rendering
            this.createAccessibleCanvasFallback(visibleTasks, this.yScale);

            if (this.showConnectorLinesInternal) {
                // Draw arrows on the prepared canvas
                this.drawArrowsCanvas(
                    visibleTasks,
                    this.xScale,
                    this.yScale,
                    this.settings.taskAppearance.criticalPathColor.value.value,
                    this.settings.connectorLines.connectorColor.value.value,
                    this.settings.connectorLines.connectorWidth.value,
                    this.settings.connectorLines.criticalConnectorWidth.value,
                    this.settings.taskAppearance.taskHeight.value,
                    this.settings.taskAppearance.milestoneSize.value,
                );
            }

            // Draw Data Date line on canvas and header
            this.drawDataDateLine(
                chartWidth,
                this.xScale,
                chartHeight,
                this.gridLayer,
                this.headerGridLayer
            );

            // BUG-011 FIX: NOW hide SVG layers (after canvas content is fully rendered)
            // This prevents flicker by showing new content before hiding old
            this.taskLayer.style("display", "none");
            this.arrowLayer.style("display", "none");
            // Also clear SVG content to free memory
            if (modeChanged) {
                this.taskLayer?.selectAll("*").remove();
                this.arrowLayer?.selectAll("*").remove();
            }
        }
    } else {
        // --- SVG Rendering Path ---
        // BUG-011 FIX: Show SVG layers first, render content, then hide canvas
        this.taskLayer.style("display", "block");
        this.taskLayer.style("visibility", "visible");
        this.arrowLayer.style("display", "block");
        this.arrowLayer.style("visibility", "visible");

        // Apply SVG rendering hints
        this.setupSVGRenderingHints();

        // MODIFICATION: Draw Gridlines on SVG
        if (showHorzGridLines) {
            this.drawHorizontalGridLines(visibleTasks, this.yScale, chartWidth, currentLeftMargin, chartHeight);
        }
        
        // Draw arrows first so they appear behind tasks
        if (this.showConnectorLinesInternal) {
            this.drawArrows(
                visibleTasks,
                this.xScale,
                this.yScale,
                this.settings.taskAppearance.criticalPathColor.value.value,
                this.settings.connectorLines.connectorColor.value.value,
                this.settings.connectorLines.connectorWidth.value,
                this.settings.connectorLines.criticalConnectorWidth.value,
                this.settings.taskAppearance.taskHeight.value,
                this.settings.taskAppearance.milestoneSize.value,
            );
        }
        
        this.drawTasks(
            visibleTasks,
            this.xScale,
            this.yScale,
            this.settings.taskAppearance.taskColor.value.value,
            this.settings.taskAppearance.milestoneColor.value.value,
            this.settings.taskAppearance.criticalPathColor.value.value,
            this.settings.textAndLabels.labelColor.value.value,
            this.settings.textAndLabels.showDuration.value,
            this.settings.taskAppearance.taskHeight.value,
            this.settings.textAndLabels.dateBackgroundColor.value.value,
            1 - (this.settings.textAndLabels.dateBackgroundTransparency.value / 100)
        );

        // Draw WBS group headers (SVG mode) - only for visible viewport range
        this.drawWbsGroupHeaders(
            this.xScale,
            this.yScale,
            chartWidth,
            this.settings.taskAppearance.taskHeight.value,
            this.viewportStartIndex,
            this.viewportEndIndex
        );

        // BUG-011 FIX: NOW hide canvas (after SVG content is fully rendered)
        // This prevents flicker by showing new content before hiding old
        if (this.canvasElement) {
            this.canvasElement.style.display = 'none';
        }
        // Also clear canvas content to free memory
        if (modeChanged && this.canvasContext && this.canvasElement) {
            this.canvasContext.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
        }
    }

    // Draw WBS group headers for canvas mode (using SVG overlay) - only for visible viewport range
    if (this.useCanvasRendering) {
        this.drawWbsGroupHeaders(
            this.xScale,
            this.yScale,
            chartWidth,
            this.settings.taskAppearance.taskHeight.value,
            this.viewportStartIndex,
            this.viewportEndIndex
        );
    }

    // Redraw project end and reference lines (Always SVG; clears when toggled off)
    // Use allFilteredTasks to show finish date of all filtered tasks (not just visible/non-collapsed)
    const tasksForProjectEnd = this.allFilteredTasks.length > 0 ? this.allFilteredTasks : this.allTasksToShow;
    this.drawBaselineAndPreviousEndLines(
        this.xScale,
        tasksForProjectEnd,
        this.yScale.range()[1],
        this.gridLayer,
        this.headerGridLayer
    );
    this.drawProjectEndLine(
        this.xScale.range()[1],
        this.xScale,
        visibleTasks,
        tasksForProjectEnd,
        this.yScale.range()[1],
        this.gridLayer,
        this.headerGridLayer
    );

    // Draw Data Date line if provided
    this.drawDataDateLine(
        this.xScale.range()[1],
        this.xScale,
        this.yScale.range()[1],
        this.gridLayer,
        this.headerGridLayer
    );
}

private drawHorizontalGridLinesCanvas(tasks: Task[], yScale: ScaleBand<string>, chartWidth: number, currentLeftMargin: number): void {
        if (!this.canvasContext) return;
        const ctx = this.canvasContext;
        ctx.save();

        const settings = this.settings.gridLines;
        const lineColor = settings.gridLineColor.value.value;
        const lineWidth = settings.gridLineWidth.value;
        const style = settings.gridLineStyle.value.value;

        ctx.strokeStyle = lineColor;
        ctx.lineWidth = lineWidth;

        // Configure line dash style
        switch (style) {
            case "dashed": ctx.setLineDash([4, 3]); break;
            case "dotted": ctx.setLineDash([1, 2]); break;
            default: ctx.setLineDash([]); break;
        }

        // Define the horizontal span
        const x1 = -currentLeftMargin;
        const x2 = chartWidth;

        // Collect all yOrder values from tasks
        const taskYOrders = tasks
            .filter(t => t.yOrder !== undefined && t.yOrder > 0)
            .map(t => t.yOrder as number);

        // If WBS grouping is enabled, also include visible WBS group yOrders
        let allYOrders: number[] = [...taskYOrders];
        if (this.wbsDataExists && this.settings?.wbsGrouping?.enableWbsGrouping?.value) {
            const groupYOrders = this.wbsGroups
                .filter(g => g.yOrder !== undefined && g.yOrder > 0 &&
                    g.yOrder >= this.viewportStartIndex && g.yOrder <= this.viewportEndIndex)
                .map(g => g.yOrder as number);
            allYOrders = [...allYOrders, ...groupYOrders];
        }

        // Remove duplicates and sort
        const uniqueYOrders = [...new Set(allYOrders)].sort((a, b) => a - b);

        uniqueYOrders.forEach(yOrder => {
            const yPos = yScale(yOrder.toString());
            if (yPos !== undefined && !isNaN(yPos)) {
                // Ensure pixel alignment for crisp lines
                const alignedY = Math.round(yPos);
                ctx.beginPath();
                ctx.moveTo(x1, alignedY);
                ctx.lineTo(x2, alignedY);
                ctx.stroke();
            }
        });

        ctx.restore();
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

        // Build yDomain: include both tasks AND group headers (when WBS is enabled)
        const yDomainSet = new Set<string>();

        // Add task yOrders
        for (const task of tasksToShow) {
            if (task.yOrder !== undefined) {
                yDomainSet.add(task.yOrder.toString());
            }
        }

        // Add group header yOrders if WBS grouping is enabled
        const wbsGroupingEnabled = this.wbsDataExists &&
            this.settings?.wbsGrouping?.enableWbsGrouping?.value;

        if (wbsGroupingEnabled) {
            for (const group of this.wbsGroups) {
                if (group.yOrder !== undefined) {
                    yDomainSet.add(group.yOrder.toString());
                }
            }
        }

        // Convert to sorted array
        const yDomain = Array.from(yDomainSet).sort((a, b) => parseInt(a) - parseInt(b));

        if (yDomain.length === 0) {
             this.debugLog("Y-scale domain is empty because no tasks are being plotted.");
             // Still return xScale if valid
             return { xScale: (isNaN(xScale.range()[0]) ? null : xScale), yScale: null, chartWidth, calculatedChartHeight };
        }

// For virtual scrolling, y-scale domain contains all tasks but range positions visible ones
        const yScale = d3.scaleBand<string>()
            .domain(yDomain) // Keep full domain
            .range([0, calculatedChartHeight]) // Full range for complete chart height
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

    // Update SVG clip rect to prevent bars from rendering past left margin when zoomed
    this.updateChartClipRect(chartWidth, chartHeight);

    const taskColor = this.settings.taskAppearance.taskColor.value.value;
    const criticalColor = this.settings.taskAppearance.criticalPathColor.value.value;
    const milestoneColor = this.settings.taskAppearance.milestoneColor.value.value;
    const labelColor = this.settings.textAndLabels.labelColor.value.value;
    const taskHeight = this.settings.taskAppearance.taskHeight.value;
    const connectorColor = this.settings.connectorLines.connectorColor.value.value;
    const connectorWidth = this.settings.connectorLines.connectorWidth.value;
    const criticalConnectorWidth = this.settings.connectorLines.criticalConnectorWidth.value;
    const dateBgColor = this.settings.textAndLabels.dateBackgroundColor.value.value;
    const dateBgTransparency = this.settings.textAndLabels.dateBackgroundTransparency.value;
    const dateBgOpacity = 1 - (dateBgTransparency / 100);
    const showHorzGridLines = this.settings.gridLines.showGridLines.value;
    const showVertGridLines = this.settings.verticalGridLines.show.value;
    const showDuration = this.settings.textAndLabels.showDuration.value;
    // MODIFICATION: Ensure currentLeftMargin is defined here for conditional use.
    const currentLeftMargin = this.settings.layoutSettings.leftMargin.value;
    
    // Decide whether to use Canvas or SVG based on task count
    this.useCanvasRendering = tasksToShow.length > this.CANVAS_THRESHOLD;
    this.debugLog(`Rendering mode: ${this.useCanvasRendering ? 'Canvas' : 'SVG'} for ${tasksToShow.length} tasks`);
    
    /* MODIFICATION: Remove the unconditional SVG draw. It is handled conditionally below.
    if (showHorzGridLines) {
        const currentLeftMargin = this.settings.layoutSettings.leftMargin.value;
        this.drawHorizontalGridLines(tasksToShow, yScale, chartWidth, currentLeftMargin, chartHeight);
    }
    */

    if (showVertGridLines) {
        // Vertical gridlines are always drawn in SVG (as they align with the SVG header)
        this.drawVerticalGridLines(xScale, chartHeight, this.gridLayer, this.headerGridLayer);
    }
    
    if (this.useCanvasRendering) {
        // --- Canvas Rendering Path ---
        this.taskLayer.style("display", "none");
        this.arrowLayer.style("display", "none");
        
        // Position the canvas element and ensure it's visible
        if (this.canvasElement) {
            this.canvasElement.style.display = 'block';
            this.canvasElement.style.visibility = 'visible'; // CRITICAL: Ensure visibility
            this.canvasElement.style.left = `${this.margin.left}px`;
            this.canvasElement.style.top = `${this.margin.top}px`;
            this.canvasElement.style.pointerEvents = 'auto'; // Ensure interactions work
            this.canvasElement.style.zIndex = '1'; // Ensure it's above other elements
        }
        
        // Use the new helper to size, clear, and scale the canvas
        if (this._setupCanvasForDrawing(chartWidth, chartHeight)) {

            // MODIFICATION: Draw horizontal gridlines on Canvas
            if (showHorzGridLines) {
                this.drawHorizontalGridLinesCanvas(tasksToShow, yScale, chartWidth, currentLeftMargin);
            }

            // Draw tasks on the prepared canvas
            this.drawTasksCanvas(
                tasksToShow, xScale, yScale,
                taskColor, milestoneColor, criticalColor,
                labelColor, showDuration, taskHeight,
                dateBgColor, dateBgOpacity
            );
            
            // Draw arrows on the prepared canvas if needed
            if (this.showConnectorLinesInternal) {
                this.drawArrowsCanvas(
                    tasksToShow, xScale, yScale,
                    criticalColor, connectorColor, connectorWidth, criticalConnectorWidth,
                    taskHeight, this.settings.taskAppearance.milestoneSize.value
                );
            }
        }
    } else {
        // --- SVG Rendering Path ---
        if (this.canvasElement) {
            this.canvasElement.style.display = 'none';
            this.canvasElement.style.visibility = 'hidden';
        }
        this.taskLayer.style("display", "block");
        this.taskLayer.style("visibility", "visible");
        this.arrowLayer.style("display", "block");
        this.arrowLayer.style("visibility", "visible");
        
        // Apply SVG rendering hints
        this.setupSVGRenderingHints();

        // MODIFICATION: Draw horizontal gridlines on SVG
        if (showHorzGridLines) {
            this.drawHorizontalGridLines(tasksToShow, yScale, chartWidth, currentLeftMargin, chartHeight);
        }
        
        // Draw arrows first so they appear behind tasks
        if (this.showConnectorLinesInternal) {
            this.drawArrows(
                tasksToShow, xScale, yScale,
                criticalColor, connectorColor, connectorWidth, criticalConnectorWidth,
                taskHeight, this.settings.taskAppearance.milestoneSize.value
            );
        }
        
        this.drawTasks(
            tasksToShow, xScale, yScale,
            taskColor, milestoneColor, criticalColor,
            labelColor, showDuration, taskHeight,
                dateBgColor, dateBgOpacity
            );

            // Draw WBS group headers (SVG mode only)
            this.drawWbsGroupHeaders(xScale, yScale, chartWidth, taskHeight);

            // Draw Data Date line when in SVG mode
            this.drawDataDateLine(
                chartWidth,
                xScale,
                chartHeight,
                this.gridLayer,
                this.headerGridLayer
            );
        }

        // Project end and reference lines are always drawn in SVG (clears when toggled off)
        const tasksForProjectEnd = this.allFilteredTasks.length > 0 ? this.allFilteredTasks : this.allTasksToShow;
        this.drawBaselineAndPreviousEndLines(
            xScale,
            tasksForProjectEnd,
            chartHeight,
            this.gridLayer,
            this.headerGridLayer
        );
        this.drawProjectEndLine(chartWidth, xScale, tasksToShow, tasksForProjectEnd, chartHeight,
                                this.gridLayer, this.headerGridLayer);
}

private drawHorizontalGridLines(tasks: Task[], yScale: ScaleBand<string>, chartWidth: number, currentLeftMargin: number, chartHeight: number): void {
        if (!this.gridLayer?.node() || !yScale) { console.warn("Skipping horizontal grid lines: Missing layer or Y scale."); return; }
        this.gridLayer.selectAll(".grid-line.horizontal").remove();

        const settings = this.settings.gridLines;
        const lineColor = settings.gridLineColor.value.value;
        const lineWidth = settings.gridLineWidth.value;
        const style = settings.gridLineStyle.value.value;
        let lineDashArray = "none";
         switch (style) { case "dashed": lineDashArray = "4,3"; break; case "dotted": lineDashArray = "1,2"; break; default: lineDashArray = "none"; break; }

        // Collect all yOrder values from tasks
        const taskYOrders = tasks
            .filter(t => t.yOrder !== undefined && t.yOrder > 0)
            .map(t => t.yOrder as number);

        // If WBS grouping is enabled, also include WBS group yOrders
        let allYOrders: number[] = [...taskYOrders];
        if (this.wbsDataExists && this.settings?.wbsGrouping?.enableWbsGrouping?.value) {
            const groupYOrders = this.wbsGroups
                .filter(g => g.yOrder !== undefined && g.yOrder > 0)
                .map(g => g.yOrder as number);
            allYOrders = [...allYOrders, ...groupYOrders];
        }

        // Remove duplicates and sort
        const uniqueYOrders = [...new Set(allYOrders)].sort((a, b) => a - b);

        // Draw gridlines for each yOrder
        this.gridLayer.selectAll(".grid-line.horizontal")
            .data(uniqueYOrders)
            .enter()
            .append("line")
            .attr("class", "grid-line horizontal")
            .attr("x1", -currentLeftMargin)
            .attr("x2", chartWidth)
            .attr("y1", (yOrder: number) => yScale(yOrder.toString()) ?? 0)
            .attr("y2", (yOrder: number) => yScale(yOrder.toString()) ?? 0)
            .style("stroke", lineColor)
            .style("stroke-width", lineWidth)
            .style("stroke-dasharray", lineDashArray)
            .style("pointer-events", "none");
    }

    private drawVerticalGridLines(
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
    
        const settings = this.settings.verticalGridLines;
        if (!settings.show.value) return;
    
        const lineColor = settings.lineColor.value.value;
        const lineWidth = settings.lineWidth.value;
        const lineStyle = settings.lineStyle.value.value as string;
        const showMonthLabels = settings.showMonthLabels.value;
        const labelColorSetting = settings.labelColor.value.value;
        const labelColor = labelColorSetting || lineColor;
        const baseFontSize = this.settings.textAndLabels.fontSize.value;
        const labelFontSizeSetting = settings.labelFontSize.value;
        const labelFontSize = labelFontSizeSetting > 0 ? labelFontSizeSetting : Math.max(8, baseFontSize * 0.8);
        let lineDashArray = "none";
        switch (lineStyle) { case "dashed": lineDashArray = "4,3"; break; case "dotted": lineDashArray = "1,2"; break; default: lineDashArray = "none"; }
    
        // --- Adaptive Ticking Logic ---
        const typicalLabel = "Sep-27";
        const estimatedLabelWidthPx = typicalLabel.length * labelFontSize * 0.6 + 10;
        let tickInterval = 1;
        let monthTicks: Date[] = [];
        const maxInterval = 12;
         while (tickInterval <= maxInterval) {
             try { monthTicks = xScale.ticks(timeMonth.every(tickInterval)); }
             catch (e) { console.error("Error generating ticks:", e); monthTicks = []; break; }
             if (monthTicks.length < 2) break;
             let minSpacingPx = Infinity;
             for (let i = 1; i < monthTicks.length; i++) {
                 const spacing = xScale(monthTicks[i]) - xScale(monthTicks[i - 1]);
                 if (!isNaN(spacing)) minSpacingPx = Math.min(minSpacingPx, spacing);
             }
             if (minSpacingPx === Infinity) { console.warn("Could not determine valid spacing for interval:", tickInterval); break; }
             if (minSpacingPx >= estimatedLabelWidthPx) break;
             tickInterval++;
             if (tickInterval > maxInterval) {
                 console.warn(`Month label spacing tight even at max interval ${maxInterval}.`);
                 try { monthTicks = xScale.ticks(timeMonth.every(maxInterval)); }
                 catch(e) { console.error("Error generating final ticks:", e); monthTicks = []; }
                 break;
             }
         }
    
        // --- Draw vertical grid LINES in MAIN grid layer ---
        mainGridLayer.selectAll(".vertical-grid-line")
            .data(monthTicks)
            .enter()
            .append("line")
            // ... (line attributes) ...
            .attr("class", "vertical-grid-line")
            .attr("x1", (d: Date) => xScale(d))
            .attr("x2", (d: Date) => xScale(d))
            .attr("y1", 0)
            .attr("y2", chartHeight)
            .style("stroke", lineColor)
            .style("stroke-width", lineWidth)
            .style("stroke-dasharray", lineDashArray)
            .style("pointer-events", "none");
    
        // --- Draw month LABELS in HEADER layer ---
        if (showMonthLabels) {
            headerLayer.selectAll(".vertical-grid-label")
                .data(monthTicks)
                .enter()
                .append("text")
                // ... (label attributes) ...
                .attr("class", "vertical-grid-label")
                .attr("x", (d: Date) => xScale(d))
                .attr("y", this.headerHeight - 15) // Updated position: closer to bottom of header
                .attr("text-anchor", "middle")
                .style("font-size", `${labelFontSize}pt`)
                .style("fill", labelColor)
                .style("pointer-events", "none")
                .text((d: Date) => this.monthYearFormatter(d));
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

    const showTooltips = this.settings.displayOptions.showTooltips.value;
    const currentLeftMargin = this.settings.layoutSettings.leftMargin.value;
    const labelAvailableWidth = Math.max(10, currentLeftMargin - this.labelPaddingLeft - 5);
    const generalFontSize = this.settings.textAndLabels.fontSize.value;
    const taskNameFontSize = this.settings.textAndLabels.taskNameFontSize.value;
    const milestoneSizeSetting = this.settings.taskAppearance.milestoneSize.value;
    const showFinishDates = this.settings.textAndLabels.showFinishDates.value;
    const lineHeight = this.taskLabelLineHeight;
    const dateBgPaddingH = this.dateBackgroundPadding.horizontal;
    const dateBgPaddingV = this.dateBackgroundPadding.vertical;
    const nearCriticalColor = this.settings.taskAppearance.nearCriticalColor.value.value;
    const self = this; // Store reference for callbacks
    
    // Define selection highlight styles
    const selectionHighlightColor = "#8A2BE2"; // Bright blue for selected task
    const selectionStrokeWidth = 2.5;          // Thicker border for selected task
    const selectionLabelColor = "#8A2BE2";     // Matching blue for label
    const selectionLabelWeight = "bold";       // Bold font for selected task label

    // Apply the data join pattern for task groups
    const taskGroupsSelection = this.taskLayer.selectAll<SVGGElement, Task>(".task-group")
        .data(tasks, (d: Task) => d.internalId);
    
    // Exit: Remove elements that no longer have data
    taskGroupsSelection.exit().remove();
    
    // Enter: Create new elements for new data
    const enterGroups = taskGroupsSelection.enter().append("g")
        .attr("class", "task-group")
        .attr("transform", (d: Task) => {
            const domainKey = d.yOrder?.toString() ?? '';
            const yPosition = yScale(domainKey);
            if (yPosition === undefined || isNaN(yPosition)) {
                console.warn(`Skipping task ${d.internalId} due to invalid yPosition (yOrder: ${domainKey}).`);
                return null; // Use null to filter later
            }
            return `translate(0, ${yPosition})`;
        })
        .filter(function() { // Filter out groups where transform failed
            return d3.select(this).attr("transform") !== null;
        });
    
    // Update: Update existing elements
    taskGroupsSelection.attr("transform", (d: Task) => {
        const domainKey = d.yOrder?.toString() ?? '';
        const yPosition = yScale(domainKey);
        if (yPosition === undefined || isNaN(yPosition)) {
            console.warn(`Skipping task ${d.internalId} due to invalid yPosition (yOrder: ${domainKey}).`);
            return null;
        }
        return `translate(0, ${yPosition})`;
    });
    
    // Merge enter and existing selections
    const allTaskGroups = enterGroups.merge(taskGroupsSelection);

    // --- Draw Previous Update Bars FIRST (directly below task bar) ---
    const showPreviousUpdate = this.showPreviousUpdateInternal;
    if (showPreviousUpdate) {
        const previousUpdateColor = this.settings.taskAppearance.previousUpdateColor.value.value;
        const previousUpdateHeight = this.settings.taskAppearance.previousUpdateHeight.value;
        const previousUpdateOffset = this.settings.taskAppearance.previousUpdateOffset.value;

        allTaskGroups.selectAll(".previous-update-bar").remove();

        allTaskGroups.filter((d: Task) =>
            d.previousUpdateStartDate instanceof Date && !isNaN(d.previousUpdateStartDate.getTime()) &&
            d.previousUpdateFinishDate instanceof Date && !isNaN(d.previousUpdateFinishDate.getTime()) &&
            d.previousUpdateFinishDate >= d.previousUpdateStartDate
        )
        .append("rect")
            .attr("class", "previous-update-bar")
            .attr("x", (d: Task) => xScale(d.previousUpdateStartDate!))
            .attr("y", taskHeight + previousUpdateOffset) // Directly below task bar
            .attr("width", (d: Task) => {
                const startPos = xScale(d.previousUpdateStartDate!);
                const finishPos = xScale(d.previousUpdateFinishDate!);
                return Math.max(this.minTaskWidthPixels, finishPos - startPos);
            })
            .attr("height", previousUpdateHeight)
            .style("fill", previousUpdateColor);
    } else {
        allTaskGroups.selectAll(".previous-update-bar").remove();
    }

    // --- Draw Baseline Bars SECOND (below previous update bars) ---
    const showBaseline = this.showBaselineInternal;
    if (showBaseline) {
        const baselineColor = this.settings.taskAppearance.baselineColor.value.value;
        const baselineHeight = this.settings.taskAppearance.baselineHeight.value;
        const baselineOffset = this.settings.taskAppearance.baselineOffset.value;
        
        // Calculate Y position based on what's visible above
        let baselineY = taskHeight;
        if (showPreviousUpdate) {
            const previousUpdateHeight = this.settings.taskAppearance.previousUpdateHeight.value;
            const previousUpdateOffset = this.settings.taskAppearance.previousUpdateOffset.value;
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
            .style("fill", baselineColor);
    } else {
        allTaskGroups.selectAll(".baseline-bar").remove();
    }
    
    // --- Draw Task Bars ---
    // First remove any existing bars to redraw them (simpler than updating positions)
    allTaskGroups.selectAll(".task-bar, .milestone").remove();

    // UPGRADED: Draw bars for normal tasks with enhanced corner radius and shadows
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
        // ACCESSIBILITY: Add ARIA attributes for screen readers
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
        .attr("width", (d: Task) => {
            const startPos = xScale(d.startDate!);
            const finishPos = xScale(d.finishDate!);
            if (isNaN(startPos) || isNaN(finishPos) || finishPos < startPos) {
                return this.minTaskWidthPixels;
            }
            return Math.max(this.minTaskWidthPixels, finishPos - startPos);
        })
        .attr("height", taskHeight)
        // UPGRADED: Increased corner radius from 3px to 5px for smoother appearance
        .attr("rx", Math.min(5, taskHeight * 0.15)).attr("ry", Math.min(5, taskHeight * 0.15))
        .style("fill", (d: Task) => {
            // Selected task always highlighted
            if (d.internalId === this.selectedTaskId) return selectionHighlightColor;

            // WITH LEGEND: Use legend colors for fill
            if (this.legendDataExists && d.legendColor) {
                return d.legendColor;
            }

            // WITHOUT LEGEND (OLD STYLE): Use fill to show criticality
            if (!this.legendDataExists) {
                if (d.isCritical) return criticalColor;
                if (d.isNearCritical) return nearCriticalColor;
            }

            // Default color
            return taskColor;
        })
        // Stroke: different logic based on legend
        .style("stroke", (d: Task) => {
            if (d.internalId === this.selectedTaskId) return selectionHighlightColor;

            // WITH LEGEND: Use borders to show criticality
            if (this.legendDataExists) {
                if (d.isCritical) return criticalColor;
                if (d.isNearCritical) return this.settings.taskAppearance.nearCriticalColor.value.value;
            }

            // WITHOUT LEGEND (OLD STYLE): Minimal borders
            return "#333";
        })
        .style("stroke-width", (d: Task) => {
            if (d.internalId === this.selectedTaskId) return 3;

            // WITH LEGEND: Thick borders for critical tasks
            if (this.legendDataExists) {
                if (d.isCritical) return this.settings.taskAppearance.criticalBorderWidth.value;
                if (d.isNearCritical) return this.settings.taskAppearance.nearCriticalBorderWidth.value;
            }

            // WITHOUT LEGEND (OLD STYLE): Thin borders for everyone
            if (d.isCritical) return 1;  // Slightly thicker for critical
            return 0.5;
        })
        // Glow: only with legend
        .style("filter", (d: Task) => {
            // WITH LEGEND: Add glow for critical tasks
            if (this.legendDataExists) {
                if (d.isCritical) {
                    const rgb = this.hexToRgb(criticalColor);
                    return `drop-shadow(0 0 3px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.35))`;
                }
                if (d.isNearCritical) {
                    const nearColor = this.settings.taskAppearance.nearCriticalColor.value.value;
                    const rgb = this.hexToRgb(nearColor);
                    return `drop-shadow(0 0 2px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25))`;
                }
            }

            // WITHOUT LEGEND (OLD STYLE): Standard shadow
            return `drop-shadow(${this.UI_TOKENS.shadow[2]})`;
        });

    // --- Draw Milestones ---
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
        // ACCESSIBILITY: Add ARIA attributes for milestones
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
            return `M 0,-${size / 2} L ${size / 2},0 L 0,${size / 2} L -${size / 2},0 Z`;
        })
        .style("fill", (d: Task) => {
            // Selected task always highlighted
            if (d.internalId === this.selectedTaskId) return selectionHighlightColor;

            // WITH LEGEND: Use legend colors for fill
            if (this.legendDataExists && d.legendColor) {
                return d.legendColor;
            }

            // WITHOUT LEGEND (OLD STYLE): Use fill to show criticality
            if (!this.legendDataExists) {
                if (d.isCritical) return criticalColor;
                if (d.isNearCritical) return nearCriticalColor;
            }

            // Default milestone color
            return milestoneColor;
        })
        // Stroke: different logic based on legend
        .style("stroke", (d: Task) => {
            if (d.internalId === this.selectedTaskId) return selectionHighlightColor;

            // WITH LEGEND: Use borders to show criticality
            if (this.legendDataExists) {
                if (d.isCritical) return criticalColor;
                if (d.isNearCritical) return this.settings.taskAppearance.nearCriticalColor.value.value;
            }

            // WITHOUT LEGEND (OLD STYLE): Standard black border
            return "#000";
        })
        .style("stroke-width", (d: Task) => {
            if (d.internalId === this.selectedTaskId) return 3;

            // WITH LEGEND: Thick borders for critical tasks
            if (this.legendDataExists) {
                if (d.isCritical) return this.settings.taskAppearance.criticalBorderWidth.value;
                if (d.isNearCritical) return this.settings.taskAppearance.nearCriticalBorderWidth.value;
            }

            // WITHOUT LEGEND (OLD STYLE): Standard border
            return 1.5;
        })
        // Glow: only with legend
        .style("filter", (d: Task) => {
            // WITH LEGEND: Add glow for critical tasks
            if (this.legendDataExists) {
                if (d.isCritical) {
                    const rgb = this.hexToRgb(criticalColor);
                    return `drop-shadow(0 0 3px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.35))`;
                }
                if (d.isNearCritical) {
                    const nearColor = this.settings.taskAppearance.nearCriticalColor.value.value;
                    const rgb = this.hexToRgb(nearColor);
                    return `drop-shadow(0 0 2px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25))`;
                }
            }

            // WITHOUT LEGEND (OLD STYLE): Standard shadow
            return `drop-shadow(${this.UI_TOKENS.shadow[2]})`;
        });

    // --- Update Task Labels ---
    // First remove existing labels to avoid updating complex wrapped text
    allTaskGroups.selectAll(".task-label").remove();

    // WBS indentation settings
    const wbsGroupingEnabled = this.wbsDataExists && this.settings?.wbsGrouping?.enableWbsGrouping?.value;
    const wbsIndentPerLevel = wbsGroupingEnabled ? (this.settings?.wbsGrouping?.indentPerLevel?.value ?? 20) : 0;

    // Draw task labels
    const taskLabels = allTaskGroups.append("text")
        .attr("class", "task-label")
        .attr("x", (d: Task) => {
            // Apply WBS indentation if grouping is enabled
            const indent = wbsGroupingEnabled && d.wbsIndentLevel ? d.wbsIndentLevel * wbsIndentPerLevel : 0;
            return -currentLeftMargin + this.labelPaddingLeft + indent;
        })
        .attr("y", taskHeight / 2)
        .attr("text-anchor", "start")
        .attr("dominant-baseline", "central")
        .style("font-size", `${taskNameFontSize}pt`)
        .style("fill", (d: Task) => d.internalId === this.selectedTaskId ? selectionLabelColor : labelColor)
        .style("font-weight", (d: Task) => d.internalId === this.selectedTaskId ? selectionLabelWeight : "normal")
        .style("pointer-events", "auto")
        .style("cursor", "pointer")
        .each(function(d: Task) {
            const textElement = d3.select(this);
            const words = (d.name || "").split(/\s+/).reverse();
            let word: string | undefined;
            let line: string[] = [];
            const x = parseFloat(textElement.attr("x"));
            const y = parseFloat(textElement.attr("y"));
            const dy = 0;
            // Adjust available width for WBS indentation
            const indent = wbsGroupingEnabled && d.wbsIndentLevel ? d.wbsIndentLevel * wbsIndentPerLevel : 0;
            const adjustedLabelWidth = labelAvailableWidth - indent;
            let tspan = textElement.text(null).append("tspan").attr("x", x).attr("y", y).attr("dy", dy + "em");
            let lineCount = 1;
            const maxLines = 2;

            while (word = words.pop()) {
                line.push(word);
                tspan.text(line.join(" "));
                try {
                    const node = tspan.node();
                    if (node && node.getComputedTextLength() > adjustedLabelWidth && line.length > 1) {
                        line.pop();
                        tspan.text(line.join(" "));

                        if (lineCount < maxLines) {
                            line = [word];
                            tspan = textElement.append("tspan")
                                .attr("x", x)
                                .attr("dy", lineHeight)
                                .text(word);
                            lineCount++;
                        } else {
                            const currentText = tspan.text();
                            if (currentText.length > 3) {
                                tspan.text(currentText.slice(0, -3) + "...");
                            }
                            break;
                        }
                    }
                } catch (e) {
                    console.warn("Could not get computed text length for wrapping:", e);
                    tspan.text(line.join(" "));
                    break;
                }
            }
        });

    // Add click handler to task labels
    taskLabels.on("click", (event: MouseEvent, d: Task) => {
        if (this.selectedTaskId === d.internalId) {
            this.selectTask(null, null);
        } else {
            this.selectTask(d.internalId, d.name);
        }
        
        if (this.dropdownInput) {
            this.dropdownInput.property("value", this.selectedTaskName || "");
        }
        
        event.stopPropagation();
    });
    
    // --- Finish Date Labels (easier to redraw than update) ---
    if (showFinishDates) {
        allTaskGroups.selectAll(".date-label-group").remove();
        
        const dateTextFontSize = Math.max(8, generalFontSize * 0.85);
        const dateTextGroups = allTaskGroups.append("g").attr("class", "date-label-group");

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
            .filter(function() { return d3.select(this).attr("x") !== null; });

        // Add background rect using BBox
        dateTextGroups.each((d: Task, i: number, nodes: BaseType[] | ArrayLike<BaseType>) => {
            const group = d3.select(nodes[i] as SVGGElement);
            const textElement = group.select<SVGTextElement>(".finish-date").node();
            
            // Separate null checks to avoid accessing properties on null
            if (!textElement) {
                group.remove(); 
                return;
            }
            
            // Now safe to check other properties since textElement is not null
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
                        // UPGRADED: Increased border radius from 3px to 4px for smoother appearance
                        .attr("rx", 4).attr("ry", 4)
                        .style("fill", dateBackgroundColor)
                        .style("fill-opacity", dateBackgroundOpacity)
                        // UPGRADED: Add subtle shadow to date label backgrounds for depth
                        .style("filter", `drop-shadow(${this.UI_TOKENS.shadow[1]})`);
                }
            } catch (e) {
                console.warn(`Could not get BBox for date text on task ${d.internalId}`, e);
            }
        });
    }

    // --- Duration Text (redraw for simplicity) ---
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
            .style("fill", "white")
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
                return (barWidth > estimatedTextWidth + 4) ? textContent : "";
            })
            .filter(function() { return d3.select(this).attr("x") !== null && d3.select(this).text() !== ""; });
    }

    // --- Attach Tooltips and Click Handlers ---
    const setupInteractivity = (selection: Selection<BaseType, Task, BaseType, unknown>) => {
        selection
            .on("mouseover", (event: MouseEvent, d: Task) => {
                // Only apply hover effect if not the selected task
                if (d.internalId !== self.selectedTaskId) {
                    // Determine the correct hover stroke color and width based on criticality
                    let hoverStrokeColor = "#333";
                    let hoverStrokeWidth = "2px";

                    if (self.legendDataExists) {
                        // WITH LEGEND: Preserve critical/near-critical styling on hover
                        if (d.isCritical) {
                            hoverStrokeColor = criticalColor;
                            hoverStrokeWidth = String(self.settings.taskAppearance.criticalBorderWidth.value);
                        } else if (d.isNearCritical) {
                            hoverStrokeColor = nearCriticalColor;
                            hoverStrokeWidth = String(self.settings.taskAppearance.nearCriticalBorderWidth.value);
                        }
                    } else {
                        // WITHOUT LEGEND: Slightly emphasize on hover
                        if (d.isCritical) {
                            hoverStrokeWidth = "1.5px";
                        }
                    }

                    d3.select(event.currentTarget as Element)
                        .style("stroke", hoverStrokeColor)
                        .style("stroke-width", hoverStrokeWidth);
                }
                d3.select(event.currentTarget as Element).style("cursor", "pointer");

                // Show tooltip if enabled
                if (showTooltips) {
                    const tooltip = self.tooltipDiv;
                    if (!tooltip || !d) return;
                    tooltip.selectAll("*").remove();
                    tooltip.style("visibility", "visible");
                    
                    // Standard Fields
                    tooltip.append("div").append("strong").text("Task: ")
                        .select<HTMLElement>(function() { return this.parentNode as HTMLElement; })
                        .append("span").text(d.name || "");
                    tooltip.append("div").append("strong").text("Start Date: ")
                        .select<HTMLElement>(function() { return this.parentNode as HTMLElement; })
                        .append("span").text(self.formatDate(d.startDate));
                    tooltip.append("div").append("strong").text("Finish Date: ")
                        .select<HTMLElement>(function() { return this.parentNode as HTMLElement; })
                        .append("span").text(self.formatDate(d.finishDate));
                    
                    // Mode-specific Info
                    const modeInfo = tooltip.append("div")
                        .classed("tooltip-mode-info", true)
                        .style("margin-top", "8px")
                        .style("border-top", "1px solid #eee")
                        .style("padding-top", "8px");

                    // Display mode
                    const mode = self.settings?.criticalityMode?.calculationMode?.value?.value || 'longestPath';
                    modeInfo.append("div")
                        .style("font-size", "10px")
                        .style("font-style", "italic")
                        .style("color", "#666")
                        .text(`Mode: ${mode === 'floatBased' ? 'Float-Based' : 'Longest Path'}`);

                    // Status
                    modeInfo.append("div").append("strong").style("color", "#555").text("Status: ")
                        .select<HTMLElement>(function() { return this.parentNode as HTMLElement; })
                        .append("span")
                        .style("color", function() {
                            if (d.internalId === self.selectedTaskId) return selectionHighlightColor;
                            if (d.isCritical) return criticalColor;
                            if (d.isNearCritical) return nearCriticalColor;
                            return "inherit";
                        })
                        .text(function() {
                            if (d.internalId === self.selectedTaskId) return "Selected";
                            if (d.isCritical) return mode === 'floatBased' ? "Critical (Float ≤ 0)" : "On Longest Path";
                            if (d.isNearCritical) return "Near Critical";
                            return mode === 'floatBased' ? "Non-Critical" : "Not on Longest Path";
                        });

                    // Show float values in Float-Based mode
                    if (mode === 'floatBased') {
                        // Show Total Float (used for criticality)
                        if (d.userProvidedTotalFloat !== undefined) {
                            modeInfo.append("div").append("strong").text("Total Float: ")
                                .select<HTMLElement>(function() { return this.parentNode as HTMLElement; })
                                .append("span")
                                .style("color", d.userProvidedTotalFloat <= 0 ? criticalColor : "inherit")
                                .text(d.userProvidedTotalFloat.toFixed(2) + " days");
                        }
                        
                        // Show Task Free Float (informational)
                        if (d.taskFreeFloat !== undefined) {
                            modeInfo.append("div").append("strong").text("Task Free Float: ")
                                .select<HTMLElement>(function() { return this.parentNode as HTMLElement; })
                                .append("span").text(d.taskFreeFloat.toFixed(2) + " days");
                        }
                    }

                    // Duration (only for Longest Path mode)
                    if (mode === 'longestPath') {
                        modeInfo.append("div").append("strong").text("Rem. Duration: ")
                            .select<HTMLElement>(function() { return this.parentNode as HTMLElement; })
                            .append("span").text(`${d.duration} (work days)`);
                    }
                    
                    // Custom Tooltip Fields
                    if (d.tooltipData && d.tooltipData.length > 0) {
                        const customInfo = tooltip.append("div")
                            .classed("tooltip-custom-info", true)
                            .style("margin-top", "8px")
                            .style("border-top", "1px solid #eee")
                            .style("padding-top", "8px");

                        customInfo.append("div")
                            .style("font-weight", "bold")
                            .style("margin-bottom", "4px")
                            .text("Additional Information:");

                        // Iterate over array in order
                        for (const item of d.tooltipData) {
                            let formattedValue = "";
                            if (item.value instanceof Date) {
                                formattedValue = self.formatDate(item.value);
                            } else if (typeof item.value === 'number') {
                                formattedValue = item.value.toLocaleString();
                            } else {
                                formattedValue = String(item.value);
                            }

                            customInfo.append("div")
                                .append("strong").text(`${item.key}: `)
                                .select<HTMLElement>(function() { return this.parentNode as HTMLElement; })
                                .append("span").text(formattedValue);
                        }
                    }

                    // User Float Threshold Info
                    if (self.showNearCritical && self.floatThreshold > 0) {
                        tooltip.append("div")
                            .style("margin-top", "8px")
                            .style("font-style", "italic")
                            .style("font-size", "10px")
                            .style("color", "#666")
                            .text(`Near Critical Threshold: ${self.floatThreshold}`);
                    }

                    // Add selection hint
                    tooltip.append("div")
                        .style("margin-top", "8px")
                        .style("font-style", "italic")
                        .style("font-size", "10px")
                        .style("color", "#666")
                        .text(`Click to ${self.selectedTaskId === d.internalId ? "deselect" : "select"} this task`);

                    // Position the tooltip
                    self.positionTooltip(tooltip.node(), event);
                }
            })
            .on("mousemove", (event: MouseEvent) => {
                if (self.tooltipDiv && showTooltips) {
                    self.positionTooltip(self.tooltipDiv.node(), event);
                }
            })
            .on("mouseout", (event: MouseEvent, d: Task) => {
                // Restore normal appearance only if not selected
                if (d.internalId !== self.selectedTaskId) {
                    // Determine the correct default stroke color and width based on criticality
                    let defaultStrokeColor = "#333";
                    let defaultStrokeWidth = "0.5";

                    if (self.legendDataExists) {
                        // WITH LEGEND: Restore critical/near-critical styling
                        if (d.isCritical) {
                            defaultStrokeColor = criticalColor;
                            defaultStrokeWidth = String(self.settings.taskAppearance.criticalBorderWidth.value);
                        } else if (d.isNearCritical) {
                            defaultStrokeColor = nearCriticalColor;
                            defaultStrokeWidth = String(self.settings.taskAppearance.nearCriticalBorderWidth.value);
                        }
                    } else {
                        // WITHOUT LEGEND: Restore standard styling
                        if (d.isCritical) {
                            defaultStrokeWidth = "1";
                        }
                    }

                    d3.select(event.currentTarget as Element)
                        .style("stroke", defaultStrokeColor)
                        .style("stroke-width", defaultStrokeWidth);
                }

                if (self.tooltipDiv && showTooltips) {
                    self.tooltipDiv.style("visibility", "hidden");
                }
            })
            .on("click", (event: MouseEvent, d: Task) => {
                // Toggle task selection
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
            // ACCESSIBILITY: Add keyboard navigation support
            .on("keydown", (event: KeyboardEvent, d: Task) => {
                // Handle Enter and Space keys for selection
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();

                    // Toggle task selection
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
            // ACCESSIBILITY: Add focus indicators
            .on("focus", function(_event: FocusEvent, _d: Task) {
                // Add visible focus ring
                d3.select(this)
                    .style("outline", "2px solid #0078D4")
                    .style("outline-offset", "2px");

                // Announce to screen readers
                const element = this as SVGElement;
                const ariaLabel = element.getAttribute("aria-label");
                if (ariaLabel) {
                    // Update aria-live region if it exists
                    const liveRegion = d3.select("body").select(".sr-live-region");
                    if (!liveRegion.empty()) {
                        liveRegion.text(`Focused on ${ariaLabel}`);
                    }
                }
            })
            .on("blur", function(_event: FocusEvent, _d: Task) {
                // Remove focus ring
                d3.select(this)
                    .style("outline", null)
                    .style("outline-offset", null);
            });
    };

    // Apply interactivity to both task bars and milestones
    setupInteractivity(allTaskGroups.selectAll(".task-bar, .milestone"));
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
    
    // Save context state before drawing
    ctx.save();
    
    // Apply consistent line width for pixel-perfect rendering
    ctx.lineWidth = Math.round(window.devicePixelRatio) / window.devicePixelRatio;
    
    try {
        const showFinishDates = this.settings.textAndLabels.showFinishDates.value;
        const generalFontSize = this.settings.textAndLabels.fontSize.value;
        const taskNameFontSize = this.settings.textAndLabels.taskNameFontSize.value;
        const milestoneSizeSetting = this.settings.taskAppearance.milestoneSize.value;
        const currentLeftMargin = this.settings.layoutSettings.leftMargin.value;
        const nearCriticalColor = this.settings.taskAppearance.nearCriticalColor.value.value;
        
        // Previous Update settings
        const showPreviousUpdate = this.showPreviousUpdateInternal;
        const previousUpdateColor = this.settings.taskAppearance.previousUpdateColor.value.value;
        const previousUpdateHeight = this.settings.taskAppearance.previousUpdateHeight.value;
        const previousUpdateOffset = this.settings.taskAppearance.previousUpdateOffset.value;
        
        // Baseline settings
        const showBaseline = this.showBaselineInternal;
        const baselineColor = this.settings.taskAppearance.baselineColor.value.value;
        const baselineHeight = this.settings.taskAppearance.baselineHeight.value;
        const baselineOffset = this.settings.taskAppearance.baselineOffset.value;
        
        // Calculate pixel-perfect font sizes
        const baseFontSize = 13; // Base pixel size for 10pt
        const taskNamePixelSize = Math.round((taskNameFontSize / 10) * baseFontSize);
        const generalPixelSize = Math.round((generalFontSize / 10) * baseFontSize);
        
        // Use web-safe font stack with fallbacks
        const fontFamily = '"Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';
        
        // Set initial font with subpixel antialiasing
        ctx.font = `${taskNamePixelSize}px ${fontFamily}`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'start';
        
        // Force text rendering mode
        (ctx as any).textRendering = 'optimizeLegibility';
        
        // Draw each task
        tasks.forEach((task: Task) => {
            const domainKey = task.yOrder?.toString() ?? '';
            const yPosition = yScale(domainKey);
            if (yPosition === undefined || isNaN(yPosition)) return;

            // Use pixel-aligned coordinates
            const yPos = Math.round(yPosition);

            // --- Draw Previous Update Bar on Canvas FIRST (directly below task bar) ---
            if (showPreviousUpdate && task.previousUpdateStartDate && task.previousUpdateFinishDate && 
                task.previousUpdateFinishDate >= task.previousUpdateStartDate) {
                const x_prev = Math.round(xScale(task.previousUpdateStartDate));
                const width_prev = Math.round(Math.max(1, xScale(task.previousUpdateFinishDate) - x_prev));
                const y_prev = Math.round(yPos + taskHeight + previousUpdateOffset); // Directly below task bar

                ctx.fillStyle = previousUpdateColor;
                ctx.fillRect(x_prev, y_prev, width_prev, Math.round(previousUpdateHeight));
            }

            // --- Draw Baseline Bar on Canvas SECOND (below previous update bar) ---
            if (showBaseline && task.baselineStartDate && task.baselineFinishDate && 
                task.baselineFinishDate >= task.baselineStartDate) {
                // Calculate Y position based on what's above
                let y_base: number;
                if (showPreviousUpdate) {
                    // Position below previous update bar
                    y_base = Math.round(yPos + taskHeight + previousUpdateOffset + previousUpdateHeight + baselineOffset);
                } else {
                    // Position directly below main task bar
                    y_base = Math.round(yPos + taskHeight + baselineOffset);
                }
                
                const x_base = Math.round(xScale(task.baselineStartDate));
                const width_base = Math.round(Math.max(1, xScale(task.baselineFinishDate) - x_base));

                ctx.fillStyle = baselineColor;
                ctx.fillRect(x_base, y_base, width_base, Math.round(baselineHeight));
            }
            
            // Determine task fill color based on legend existence
            let fillColor = taskColor;  // Default

            // Selected task always highlighted
            if (task.internalId === this.selectedTaskId) {
                fillColor = "#8A2BE2";
            } else {
                // WITH LEGEND: Use legend colors for fill
                if (this.legendDataExists && task.legendColor) {
                    fillColor = task.legendColor;
                }
                // WITHOUT LEGEND (OLD STYLE): Use fill to show criticality
                else if (!this.legendDataExists) {
                    if (task.isCritical) {
                        fillColor = criticalColor;
                    } else if (task.isNearCritical) {
                        fillColor = nearCriticalColor;
                    }
                }
            }

            // Determine stroke color and width based on legend existence
            let strokeColor = "#333";
            let strokeWidth = 0.5;

            if (task.internalId === this.selectedTaskId) {
                strokeColor = "#8A2BE2";
                strokeWidth = 3;
            } else {
                // WITH LEGEND: Use borders to show criticality
                if (this.legendDataExists) {
                    if (task.isCritical) {
                        strokeColor = criticalColor;
                        strokeWidth = this.settings.taskAppearance.criticalBorderWidth.value;
                    } else if (task.isNearCritical) {
                        strokeColor = this.settings.taskAppearance.nearCriticalColor.value.value;
                        strokeWidth = this.settings.taskAppearance.nearCriticalBorderWidth.value;
                    }
                }
                // WITHOUT LEGEND (OLD STYLE): Minimal borders
                else {
                    if (task.isCritical) {
                        strokeWidth = 1;  // Slightly thicker for critical
                    }
                }
            }
            
            // Draw task or milestone with pixel alignment
            if (task.type === 'TT_Mile' || task.type === 'TT_FinMile') {
                // UPGRADED: Draw milestone diamond with enhanced stroke and shadow
                const milestoneDate = task.startDate || task.finishDate;
                if (milestoneDate) {
                    const x = Math.round(xScale(milestoneDate));
                    const y = Math.round(yPos + taskHeight / 2);
                    const size = Math.round(Math.max(4, Math.min(milestoneSizeSetting, taskHeight * 0.9)));
                    const halfSize = size / 2;

                    const isSelected = task.internalId === this.selectedTaskId;

                    // UPGRADED: Add subtle shadow for depth
                    if (isSelected) {
                        ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
                        ctx.shadowBlur = 6;
                        ctx.shadowOffsetX = 0;
                        ctx.shadowOffsetY = 3;
                    } else {
                        ctx.shadowColor = 'rgba(0, 0, 0, 0.08)';
                        ctx.shadowBlur = 2;
                        ctx.shadowOffsetX = 0;
                        ctx.shadowOffsetY = 1;
                    }

                    ctx.beginPath();
                    ctx.moveTo(x, y - halfSize);
                    ctx.lineTo(x + halfSize, y);
                    ctx.lineTo(x, y + halfSize);
                    ctx.lineTo(x - halfSize, y);
                    ctx.closePath();

                    ctx.fillStyle = fillColor;
                    ctx.fill();

                    // Reset shadow for stroke
                    ctx.shadowColor = 'transparent';
                    ctx.shadowBlur = 0;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;

                    // Apply stroke based on criticality and selection
                    ctx.strokeStyle = strokeColor;
                    ctx.lineWidth = strokeWidth;
                    ctx.stroke();
                }
            } else {
                // UPGRADED: Draw regular task bar with enhanced corner radius and shadow effects
                if (task.startDate && task.finishDate) {
                    const x = Math.round(xScale(task.startDate));
                    const width = Math.round(Math.max(1, xScale(task.finishDate) - xScale(task.startDate)));
                    const y = Math.round(yPos);
                    const height = Math.round(taskHeight);
                    const radius = Math.min(5, Math.round(height * 0.15));  // UPGRADED: Increased from 3px to 5px

                    // UPGRADED: Add subtle shadow effect for depth
                    const isSelected = task.internalId === this.selectedTaskId;
                    const isCritical = task.isCritical;

                    if (isSelected || isCritical) {
                        ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
                        ctx.shadowBlur = isSelected ? 6 : 4;
                        ctx.shadowOffsetX = 0;
                        ctx.shadowOffsetY = isSelected ? 3 : 2;
                    } else {
                        ctx.shadowColor = 'rgba(0, 0, 0, 0.08)';
                        ctx.shadowBlur = 2;
                        ctx.shadowOffsetX = 0;
                        ctx.shadowOffsetY = 1;
                    }

                    // Draw crisp rounded rectangle
                    ctx.beginPath();
                    ctx.moveTo(x + radius, y);
                    ctx.lineTo(x + width - radius, y);
                    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
                    ctx.lineTo(x + width, y + height - radius);
                    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
                    ctx.lineTo(x + radius, y + height);
                    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
                    ctx.lineTo(x, y + radius);
                    ctx.quadraticCurveTo(x, y, x + radius, y);
                    ctx.closePath();

                    ctx.fillStyle = fillColor;
                    ctx.fill();

                    // Reset shadow for stroke
                    ctx.shadowColor = 'transparent';
                    ctx.shadowBlur = 0;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;

                    // Apply stroke based on criticality and selection
                    if (strokeWidth > 0.5) {
                        ctx.strokeStyle = strokeColor;
                        ctx.lineWidth = strokeWidth;
                        ctx.stroke();
                    }

                    // UPGRADED: Draw duration text with better sizing, readability, and text shadow
                    if (showDuration && task.duration > 0 && width > 25) {  // UPGRADED: Increased from 20 to 25
                        const durationText = `${Math.round(task.duration)}d`;
                        // UPGRADED: Slightly larger and bolder for better readability
                        const durationFontSize = Math.round((Math.max(7.5, generalFontSize * 0.85) / 10) * baseFontSize);

                        ctx.save();
                        ctx.font = `bold ${durationFontSize}px ${fontFamily}`;
                        ctx.fillStyle = this.getDurationTextColor(fillColor);
                        ctx.textAlign = "center";
                        ctx.textBaseline = "middle";

                        const centerX = Math.round(x + width / 2);
                        const centerY = Math.round(y + height / 2);

                        const textWidth = ctx.measureText(durationText).width;
                        if (textWidth < width - 4) {
                            // UPGRADED: Add subtle text shadow/outline for better readability on colored bars
                            ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
                            ctx.shadowBlur = 2;
                            ctx.shadowOffsetX = 0;
                            ctx.shadowOffsetY = 1;
                            ctx.fillText(durationText, centerX, centerY);
                        }
                        ctx.restore();
                    }
                }
            }
            
            // Draw task name with improved clarity
            const labelX = Math.round(-currentLeftMargin + this.labelPaddingLeft);
            const labelY = Math.round(yPos + taskHeight / 2);
            
            ctx.font = `${taskNamePixelSize}px ${fontFamily}`;
            ctx.fillStyle = task.internalId === this.selectedTaskId ? "#8A2BE2" : labelColor;
            ctx.textAlign = "start";
            ctx.textBaseline = "middle";
            
            // Text truncation
            const maxWidth = Math.round(currentLeftMargin - this.labelPaddingLeft - 5);
            let taskName = task.name || "";
            const metrics = ctx.measureText(taskName);
            
            if (metrics.width > maxWidth) {
                while (taskName.length > 0 && ctx.measureText(taskName + "...").width > maxWidth) {
                    taskName = taskName.slice(0, -1);
                }
                taskName += "...";
            }
            
            // Draw with pixel alignment
            ctx.fillText(taskName, labelX, labelY);
            
            // Draw finish date if enabled
            if (showFinishDates && task.finishDate) {
                const dateText = this.formatDate(task.finishDate);
                const dateX = Math.round(task.type === 'TT_Mile' || task.type === 'TT_FinMile'
                    ? xScale(task.startDate || task.finishDate) + milestoneSizeSetting / 2 + this.dateLabelOffset
                    : xScale(task.finishDate) + this.dateLabelOffset);
                    
                const dateFontSize = Math.round((Math.max(8, generalFontSize * 0.85) / 10) * baseFontSize);
                
                ctx.save();
                ctx.font = `${dateFontSize}px ${fontFamily}`;
                
                // Measure text for background
                const textMetrics = ctx.measureText(dateText);
                const bgPadding = this.dateBackgroundPadding;
                const textHeight = dateFontSize;
                
                // Draw background
                ctx.fillStyle = dateBackgroundColor;
                ctx.globalAlpha = dateBackgroundOpacity;
                
                const bgX = Math.round(dateX - bgPadding.horizontal);
                const bgY = Math.round(labelY - textHeight/2 - bgPadding.vertical);
                const bgWidth = Math.round(textMetrics.width + bgPadding.horizontal * 2);
                const bgHeight = Math.round(textHeight + bgPadding.vertical * 2);
                
                ctx.fillRect(bgX, bgY, bgWidth, bgHeight);
                ctx.globalAlpha = 1.0;
                
                // Draw text
                ctx.fillStyle = labelColor;
                ctx.textAlign = "start";
                ctx.textBaseline = "middle";
                ctx.fillText(dateText, dateX, labelY);
                
                ctx.restore();
            }
        });
    } finally {
        ctx.restore();
    }
}

/**
 * ACCESSIBILITY: Creates an invisible but screen-reader accessible fallback for canvas rendering.
 * This ensures users with assistive technology can access task information even when canvas mode is active.
 * @param tasks The tasks being rendered on canvas
 * @param yScale The Y-axis scale for positioning
 */
private createAccessibleCanvasFallback(tasks: Task[], yScale: ScaleBand<string>): void {
    if (!this.mainSvg) return;

    // Remove existing accessible layer
    this.mainSvg.selectAll(".accessible-fallback-layer").remove();

    // Create accessible SVG layer (invisible but screen-reader accessible)
    const accessibleLayer = this.mainSvg.append("g")
        .attr("class", "accessible-fallback-layer")
        .attr("role", "list")
        .attr("aria-label", "Project tasks (canvas rendering mode)")
        .style("opacity", 0)
        .style("pointer-events", "none");

    // Create accessible elements for each task
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

    // Add focusable rect for each task
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
        .attr("height", this.settings.taskAppearance.taskHeight.value)
        .style("fill", "transparent")
        .on("keydown", (event: KeyboardEvent, d: Task) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();

                // Toggle task selection
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
        .on("focus", function(_event: FocusEvent, _d: Task) {
            d3.select(this)
                .style("outline", "2px solid #0078D4")
                .style("outline-offset", "2px");
        })
        .on("blur", function(_event: FocusEvent, _d: Task) {
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

    // Get all possible pixel ratios for better cross-browser support
    const ctx = this.canvasElement.getContext('2d');
    const devicePixelRatio = window.devicePixelRatio || 1;
    const backingStoreRatio = (ctx as any).webkitBackingStorePixelRatio ||
                             (ctx as any).mozBackingStorePixelRatio ||
                             (ctx as any).msBackingStorePixelRatio ||
                             (ctx as any).oBackingStorePixelRatio ||
                             (ctx as any).backingStorePixelRatio || 1;
    
    // Calculate the actual ratio we should use
    const ratio = devicePixelRatio / backingStoreRatio;

    // Round dimensions to avoid subpixel rendering
    const displayWidth = Math.round(chartWidth);
    const displayHeight = Math.round(chartHeight);
    const canvasWidth = Math.round(displayWidth * ratio);
    const canvasHeight = Math.round(displayHeight * ratio);

    // Set the CSS display size of the canvas
    this.canvasElement.style.width = `${displayWidth}px`;
    this.canvasElement.style.height = `${displayHeight}px`;

    // Set the actual backing store size
    this.canvasElement.width = canvasWidth;
    this.canvasElement.height = canvasHeight;

    // Get fresh context with optimized settings
    this.canvasContext = this.canvasElement.getContext('2d', {
        alpha: false,
        desynchronized: false, // Changed to false for better stability in iframes
        willReadFrequently: false
    });
    
    if (!this.canvasContext) {
        console.error("Failed to get 2D context from canvas.");
        return false;
    }

    // Reset and scale the context
    this.canvasContext.setTransform(ratio, 0, 0, ratio, 0, 0);

    // Clear the canvas with white background
    this.canvasContext.fillStyle = '#FFFFFF';
    this.canvasContext.fillRect(0, 0, displayWidth, displayHeight);

    // Set up clipping region to prevent drawing past chart boundaries (fixes zoom overflow)
    this.canvasContext.beginPath();
    this.canvasContext.rect(0, 0, displayWidth, displayHeight);
    this.canvasContext.clip();

    // Set rendering quality hints
    this.canvasContext.imageSmoothingEnabled = false; // Disable for crisper text
    this.canvasContext.imageSmoothingQuality = 'high';

    // Additional rendering hints for text
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
    
    // Save context state
    ctx.save();
    
    try {
        const connectionEndPadding = 0;
        const elbowOffset = this.settings.connectorLines.elbowOffset.value;
        
        // Build position map
        const taskPositions = new Map<string, number>();
        tasks.forEach((task: Task) => {
            if (task.yOrder !== undefined) taskPositions.set(task.internalId, task.yOrder);
        });
        
        // Filter visible relationships
        const visibleRelationships = this.relationships.filter((rel: Relationship) =>
            taskPositions.has(rel.predecessorId) && taskPositions.has(rel.successorId)
        );

        // UPGRADED: Professional connector line rendering with smooth curves and anti-aliasing
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

            // Calculate start and end dates
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
            const startGap = predIsMilestone ? (milestoneDrawSize / 2 + 3) : 3;  // Increased from 2
            const endGap = succIsMilestone ? (milestoneDrawSize / 2 + 3 + connectionEndPadding) : (3 + connectionEndPadding);

            let effectiveStartX = startX;
            let effectiveEndX = endX;

            if (relType === 'FS' || relType === 'FF') effectiveStartX += startGap;
            else effectiveStartX -= startGap;
            if (predIsMilestone && (relType === 'SS' || relType === 'SF')) effectiveStartX = startX + startGap;

            if (relType === 'FS' || relType === 'SS') effectiveEndX -= endGap;
            else effectiveEndX += endGap;
            if (succIsMilestone && (relType === 'FF' || relType === 'SF')) effectiveEndX = endX + endGap - connectionEndPadding;

            // Professional line styling with enhanced visuals
            const isCritical = rel.isCritical;
            const baseLineWidth = isCritical ? criticalConnectorWidth : connectorWidth;
            const enhancedLineWidth = Math.max(1.5, baseLineWidth);  // Minimum 1.5px for visibility

            ctx.strokeStyle = isCritical ? criticalColor : connectorColor;
            ctx.lineWidth = enhancedLineWidth;
            ctx.lineCap = 'round';  // Rounded line caps for smoother appearance
            ctx.lineJoin = 'round';  // Rounded joins for smoother corners

            // Enable anti-aliasing for smoother lines
            (ctx as any).imageSmoothingEnabled = true;
            (ctx as any).imageSmoothingQuality = 'high';

            // Draw path with smooth curves
            ctx.beginPath();
            ctx.moveTo(effectiveStartX, predY);

            const cornerRadius = 8;  // Radius for smooth corners

            if (Math.abs(predY - succY) < 1) {
                // Horizontal line
                ctx.lineTo(effectiveEndX, succY);
            } else {
                // Draw appropriate connector based on type with smooth corners
                const isGoingDown = succY > predY;

                switch(relType) {
                    case 'FS':
                        // Smooth L-shape with rounded corner
                        if (Math.abs(effectiveStartX - effectiveStartX) > cornerRadius * 2 &&
                            Math.abs(succY - predY) > cornerRadius * 2) {
                            const verticalStart = predY + (isGoingDown ? cornerRadius : -cornerRadius);
                            const horizontalStart = effectiveStartX;
                            const horizontalEnd = effectiveEndX - (effectiveEndX > effectiveStartX ? cornerRadius : -cornerRadius);

                            ctx.lineTo(effectiveStartX, verticalStart);
                            ctx.arcTo(effectiveStartX, succY, horizontalEnd, succY, cornerRadius);
                            ctx.lineTo(effectiveEndX, succY);
                        } else {
                            // Fallback to straight lines if too small for curves
                            ctx.lineTo(effectiveStartX, succY);
                            ctx.lineTo(effectiveEndX, succY);
                        }
                        break;
                    case 'SS':
                        const ssOffsetX = Math.min(effectiveStartX, effectiveEndX) - elbowOffset;
                        // Three-segment path with smooth corners
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
                        // Complex path with multiple smooth corners
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
                            // Fallback
                            ctx.lineTo(sfStartOffset, predY);
                            ctx.lineTo(sfStartOffset, midY);
                            ctx.lineTo(sfEndOffset, midY);
                            ctx.lineTo(sfEndOffset, succY);
                            ctx.lineTo(effectiveEndX, succY);
                        }
                        break;
                    default:
                        // Fallback to FS style
                        ctx.lineTo(effectiveStartX, succY);
                        ctx.lineTo(effectiveEndX, succY);
                }
            }

            ctx.stroke();
        });
    } finally {
        // Always restore context state
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
        
        // Get viewport dimensions
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        // Get tooltip dimensions
        const tooltipRect = tooltipNode.getBoundingClientRect();
        const tooltipWidth = tooltipRect.width;
        const tooltipHeight = tooltipRect.height;
        
        // Calculate available space in different directions
        const spaceRight = viewportWidth - event.clientX - 15; // 15px is default right offset
        const spaceBottom = viewportHeight - event.clientY - 10; // 10px is default bottom offset
        
        // Default positions (standard positioning)
        let xPos = event.pageX + 15;
        let yPos = event.pageY - 10;
        
        // Check if tooltip would extend beyond right edge
        if (spaceRight < tooltipWidth) {
            // Position tooltip to the left of the cursor instead
            xPos = Math.max(10, event.pageX - tooltipWidth - 10);
        }
        
        // Check if tooltip would extend beyond bottom edge
        if (spaceBottom < tooltipHeight) {
            // Position tooltip above the cursor instead
            yPos = Math.max(10, event.pageY - tooltipHeight - 10);
        }
        
        // Apply the calculated position
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
        // arrowSize parameter removed
    ): void {
        // If connector lines are hidden, clear any existing lines and return
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

        // Replace arrowHeadVisibleLength calculation with fixed value
        const connectionEndPadding = 0; // Fixed padding instead of dynamic arrow size
        const elbowOffset = this.settings.connectorLines.elbowOffset.value;

        const taskPositions = new Map<string, number>();
        tasks.forEach((task: Task) => {
            if (task.yOrder !== undefined) taskPositions.set(task.internalId, task.yOrder);
        });

        const visibleRelationships = this.relationships.filter((rel: Relationship) =>
            taskPositions.has(rel.predecessorId) && taskPositions.has(rel.successorId)
        );

        // UPGRADED: Professional SVG connector lines with smooth curves and rounded caps/joins
        this.arrowLayer.selectAll(".relationship-arrow")
            .data(visibleRelationships, (d: Relationship) => `${d.predecessorId}-${d.successorId}`)
            .enter()
            .append("path")
            .attr("class", (d: Relationship) => `relationship-arrow ${d.isCritical ? "critical" : "normal"}`)
            .attr("fill", "none")
            .attr("stroke", (d: Relationship) => d.isCritical ? criticalColor : connectorColor)
            .attr("stroke-width", (d: Relationship) => {
                const baseWidth = d.isCritical ? criticalConnectorWidth : connectorWidth;
                return Math.max(1.5, baseWidth);  // UPGRADED: Minimum 1.5px for better visibility
            })
            .attr("stroke-linecap", "round")  // UPGRADED: Rounded line caps for smoother appearance
            .attr("stroke-linejoin", "round")  // UPGRADED: Rounded joins for smoother corners
            .attr("marker-end", (d: Relationship) => d.isCritical ? "url(#arrowhead-critical)" : "url(#arrowhead)")  // RESTORED: Arrowheads!
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
                const startGap = predIsMilestone ? (milestoneDrawSize / 2 + 3) : 3;  // UPGRADED: Increased from 2 to 3
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

                if (Math.abs(pStartX - pEndX) < elbowOffset && Math.abs(pStartY - pEndY) < 1) return null; // Skip tiny paths

                // UPGRADED: Smooth corner radius for professional appearance
                const cornerRadius = 8;
                let pathData: string;

                // Check if tasks are at the same vertical level
                if (Math.abs(pStartY - pEndY) < 1) {
                    // Simple horizontal connection for all relationship types when tasks at same level
                    pathData = `M ${pStartX},${pStartY} H ${pEndX}`;
                } else {
                    // UPGRADED: Different path creation based on relationship type with smooth quadratic curves
                    const isGoingDown = pEndY > pStartY;

                    switch(relType) {
                        case 'FS':
                            // Finish to Start: Smooth L-shape with rounded corner
                            if (Math.abs(pEndY - pStartY) > cornerRadius * 2) {
                                const verticalEnd = pEndY - (isGoingDown ? cornerRadius : -cornerRadius);
                                pathData = `M ${pStartX},${pStartY} L ${pStartX},${verticalEnd} Q ${pStartX},${pEndY} ${pStartX + cornerRadius},${pEndY} L ${pEndX},${pEndY}`;
                            } else {
                                pathData = `M ${pStartX},${pStartY} V ${pEndY} H ${pEndX}`;
                            }
                            break;

                        case 'SS':
                            // Start to Start: Path with smooth corners at both turns
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
                            // Finish to Finish: Path with smooth corners at both turns
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
                            // Start to Finish: Complex path with multiple smooth corners
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
                            // Fallback to FS style
                            pathData = `M ${pStartX},${pStartY} V ${pEndY} H ${pEndX}`;
                    }
                }
                return pathData;
            })
            .filter(function() { return d3.select(this).attr("d") !== null; });

        // Add connection dots at start and end points for clarity
        this.arrowLayer.selectAll(".connection-dot-start")
            .data(visibleRelationships, (d: Relationship) => `start-${d.predecessorId}-${d.successorId}`)
            .enter()
            .append("circle")
            .attr("class", "connection-dot-start")
            .attr("r", 2.5)  // Small dot
            .attr("fill", (d: Relationship) => d.isCritical ? criticalColor : connectorColor)
            .attr("stroke", "white")
            .attr("stroke-width", 0.5)
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

        // Add connection dots at end points
        this.arrowLayer.selectAll(".connection-dot-end")
            .data(visibleRelationships, (d: Relationship) => `end-${d.predecessorId}-${d.successorId}`)
            .enter()
            .append("circle")
            .attr("class", "connection-dot-end")
            .attr("r", 2.5)  // Small dot
            .attr("fill", (d: Relationship) => d.isCritical ? criticalColor : connectorColor)
            .attr("stroke", "white")
            .attr("stroke-width", 0.5)
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
        labelFormatter?: (date: Date) => string;
        xScale: ScaleTime<number, number>;
        chartHeight: number;
        mainGridLayer: Selection<SVGGElement, unknown, null, undefined>;
        headerLayer: Selection<SVGGElement, unknown, null, undefined>;
    }): void {
        const {
            className, targetDate, lineColor, lineWidth, lineStyle, showLabel,
            labelColor, labelFontSize, labelBackgroundColor, labelBackgroundOpacity,
            labelY, labelXOffset = 5, labelFormatter,
            xScale, chartHeight, mainGridLayer, headerLayer
        } = config;

        if (!mainGridLayer?.node() || !headerLayer?.node() || !xScale) { return; }

        // Always clear previous render so toggles don't leave stale lines
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
            .style("pointer-events", "none");

        if (showLabel) {
            const labelText = labelFormatter ? labelFormatter(targetDate) : this.formatDate(targetDate);
            const labelX = endX + labelXOffset;

            const labelGroup = headerLayer.append("g")
                .attr("class", `${className}-label-group`)
                .style("pointer-events", "none");

            const textElement = labelGroup.append("text")
                .attr("class", `${className}-label`)
                .attr("x", labelX)
                .attr("y", labelY)
                .attr("text-anchor", "start")
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
        allTasks: Task[],  // Added parameter for all tasks
        chartHeight: number,
        mainGridLayer: Selection<SVGGElement, unknown, null, undefined>,
        headerLayer: Selection<SVGGElement, unknown, null, undefined>
    ): void {
        if (!mainGridLayer?.node() || !headerLayer?.node() || !xScale) { return; }

        const settings = this.settings.projectEndLine;

        const lineColor = settings.lineColor.value.value;
        const lineWidth = settings.lineWidth.value;
        const lineStyle = settings.lineStyle.value.value as string;

        const showLabel = settings.showLabel?.value ?? true;
        const labelColor = settings.labelColor?.value?.value ?? lineColor;
        const labelFontSize = settings.labelFontSize?.value ?? this.settings.textAndLabels.fontSize.value;
        const showLabelPrefix = settings.showLabelPrefix?.value ?? true;
        const labelBackgroundColor = settings.labelBackgroundColor?.value?.value ?? "#FFFFFF";
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
            labelY: this.headerHeight - 12,
            labelFormatter: (d: Date) => showLabelPrefix ? `Finish: ${this.formatDate(d)}` : this.formatDate(d),
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

        // Always clear previous render so stale lines don't remain when toggled off or data missing
        mainGridLayer.select(".data-date-line").remove();
        headerLayer.selectAll(".data-date-label-group").remove();

        if (!(this.dataDate instanceof Date) || isNaN(this.dataDate.getTime())) { return; }

        const settings = this.settings?.dataDateLine;
        if (!settings || !settings.show.value) return;

        const lineColor = settings.lineColor.value.value;
        const lineWidth = settings.lineWidth.value;
        const lineStyle = settings.lineStyle.value.value;
        const showLabel = settings.showLabel?.value ?? true;
        const labelColor = settings.labelColor?.value?.value ?? lineColor;
        const labelFontSize = settings.labelFontSize?.value ?? this.settings.textAndLabels.fontSize.value;
        const showLabelPrefix = settings.showLabelPrefix?.value ?? true;
        const labelBackgroundColor = settings.labelBackgroundColor?.value?.value ?? "#FFFFFF";
        const labelBackgroundTransparency = settings.labelBackgroundTransparency?.value ?? 0;
        const labelBackgroundOpacity = 1 - (labelBackgroundTransparency / 100);

        let lineDashArray = "none";
        switch (lineStyle) { case "dashed": lineDashArray = "5,3"; break; case "dotted": lineDashArray = "1,2"; break; default: lineDashArray = "none"; }

        const dataDateX = xScale(this.dataDate);

        if (isNaN(dataDateX) || !isFinite(dataDateX)) { console.warn("Calculated Data Date line position is invalid:", dataDateX); return; }

        // Always draw on SVG grid layer (mirrors Project End line behavior)
        const effectiveHeight = chartHeight > 0 ? chartHeight : (this.mainSvg ? (parseFloat(this.mainSvg.attr("height")) || 0) : 0);

        mainGridLayer.append("line")
            .attr("class", "data-date-line")
            .attr("x1", dataDateX).attr("y1", 0)
            .attr("x2", dataDateX).attr("y2", effectiveHeight)
            .attr("stroke", lineColor)
            .attr("stroke-width", lineWidth)
            .attr("stroke-dasharray", lineDashArray)
            .style("pointer-events", "none");

        // Also draw on canvas when canvas rendering is active to ensure visibility above the canvas layer
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
                ? `Data Date: ${this.formatDate(this.dataDate)}`
                : this.formatDate(this.dataDate);

            const labelY = this.headerHeight - 26;
            const labelX = dataDateX + 5;

            const labelGroup = headerLayer.append("g")
                .attr("class", "data-date-label-group")
                .style("pointer-events", "none");

            const textElement = labelGroup.append("text")
                .attr("class", "data-date-label")
                .attr("x", labelX)
                .attr("y", labelY)
                .attr("text-anchor", "start")
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

        const lineSettings = this.settings.projectEndLine;

        // Baseline finish line (requires baseline toggle ON)
        const baselineToggleOn = this.showBaselineInternal;
        const baselineShowSetting = lineSettings.baselineShow?.value ?? false;
        const baselineTargetDate = (baselineToggleOn && baselineShowSetting)
            ? this.getLatestFinishDate(allTasks, (t: Task) => t.baselineFinishDate)
            : null;

        const baselineLineColor = this.settings.taskAppearance.baselineColor.value.value;
        const baselineLineWidth = lineSettings.baselineLineWidth?.value ?? lineSettings.lineWidth.value;
        const baselineLineStyle = (lineSettings.baselineLineStyle?.value?.value as string | undefined) ?? lineSettings.lineStyle.value.value as string;
        const baselineShowLabel = (lineSettings.baselineShowLabel?.value ?? true) && baselineToggleOn && baselineShowSetting;
        const baselineLabelColor = lineSettings.baselineLabelColor?.value?.value ?? baselineLineColor;
        const baselineLabelFontSize = lineSettings.baselineLabelFontSize?.value ?? this.settings.textAndLabels.fontSize.value;
        const baselineShowLabelPrefix = lineSettings.baselineShowLabelPrefix?.value ?? true;
        const baselineLabelBackgroundColor = lineSettings.baselineLabelBackgroundColor?.value?.value ?? "#FFFFFF";
        const baselineLabelBackgroundTransparency = lineSettings.baselineLabelBackgroundTransparency?.value ?? 0;
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
            labelY: this.headerHeight - 36, // stagger labels to reduce overlap
            labelFormatter: (d: Date) => baselineShowLabelPrefix ? `Baseline Finish: ${this.formatDate(d)}` : `Baseline: ${this.formatDate(d)}`,
            xScale,
            chartHeight,
            mainGridLayer,
            headerLayer
        });

        // Previous Update finish line (requires previous update toggle ON)
        const prevToggleOn = this.showPreviousUpdateInternal;
        const prevShowSetting = lineSettings.previousUpdateShow?.value ?? false;
        const prevTargetDate = (prevToggleOn && prevShowSetting)
            ? this.getLatestFinishDate(allTasks, (t: Task) => t.previousUpdateFinishDate)
            : null;

        const prevLineColor = this.settings.taskAppearance.previousUpdateColor.value.value;
        const prevLineWidth = lineSettings.previousUpdateLineWidth?.value ?? lineSettings.lineWidth.value;
        const prevLineStyle = (lineSettings.previousUpdateLineStyle?.value?.value as string | undefined) ?? lineSettings.lineStyle.value.value as string;
        const prevShowLabel = (lineSettings.previousUpdateShowLabel?.value ?? true) && prevToggleOn && prevShowSetting;
        const prevLabelColor = lineSettings.previousUpdateLabelColor?.value?.value ?? prevLineColor;
        const prevLabelFontSize = lineSettings.previousUpdateLabelFontSize?.value ?? this.settings.textAndLabels.fontSize.value;
        const prevShowLabelPrefix = lineSettings.previousUpdateShowLabelPrefix?.value ?? true;
        const prevLabelBackgroundColor = lineSettings.previousUpdateLabelBackgroundColor?.value?.value ?? "#FFFFFF";
        const prevLabelBackgroundTransparency = lineSettings.previousUpdateLabelBackgroundTransparency?.value ?? 0;
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
            labelY: this.headerHeight - 50, // stagger labels to reduce overlap
            labelFormatter: (d: Date) => prevShowLabelPrefix ? `Previous Finish: ${this.formatDate(d)}` : `Previous: ${this.formatDate(d)}`,
            xScale,
            chartHeight,
            mainGridLayer,
            headerLayer
        });
    }

private async calculateCPMOffThread(): Promise<void> {
    const mode = this.settings?.criticalityMode?.calculationMode?.value?.value || 'longestPath';
    
    if (mode === 'floatBased') {
        return Promise.resolve();
    }
    
    // Use P6 reflective approach directly
    this.identifyLongestPathFromP6();
    return Promise.resolve();
}

private async determineCriticalityMode(): Promise<void> {
    const mode = this.settings.criticalityMode.calculationMode.value.value;
    this.debugLog(`Criticality Mode: ${mode}`);
    
    if (mode === "floatBased") {
        this.applyFloatBasedCriticality();
    } else {
        // Use P6 reflective approach
        this.identifyLongestPathFromP6();
    }
}

private applyFloatBasedCriticality(): void {
    this.debugLog("Applying Float-Based criticality using Total Float for criticality and Task Free Float for tracing...");
    const startTime = performance.now();

    // Clear driving chains since we're not in Longest Path mode
    this.allDrivingChains = [];

    // Apply task criticality based on TOTAL FLOAT (not Task Free Float)
    this.allTasksData.forEach(task => {
        // Use Total Float for criticality determination (as before)
        if (task.userProvidedTotalFloat !== undefined && !isNaN(task.userProvidedTotalFloat)) {
            task.totalFloat = task.userProvidedTotalFloat;
            task.isCritical = task.totalFloat <= 0;  // Critical if Total Float ≤ 0
            task.isCriticalByFloat = task.isCritical;
            
            // Near-critical determination based on Total Float
            // IMPORTANT: Only apply near-critical if threshold > 0
            if (this.showNearCritical && !task.isCritical && this.floatThreshold > 0) {
                task.isNearCritical = task.totalFloat > 0 && 
                                     task.totalFloat <= this.floatThreshold;
            } else {
                task.isNearCritical = false;
            }
        } else {
            // No total float value provided
            task.totalFloat = Infinity;
            task.isCritical = false;
            task.isCriticalByFloat = false;
            task.isNearCritical = false;
        }
        
        // Task Free Float is stored but NOT used for criticality
        // It will be used for path tracing in the identify methods
        
        task.isCriticalByRel = false;
        // Reset CPM-specific values
        task.earlyStart = 0;
        task.earlyFinish = task.duration;
        task.lateStart = task.totalFloat === Infinity ? Infinity : 0;
        task.lateFinish = task.totalFloat === Infinity ? Infinity : task.duration;
    });
    
    // Relationships are no longer critical based on free float
    this.relationships.forEach(rel => {
        rel.isCritical = false; // All relationships non-critical in task-based model
    });
    
    const endTime = performance.now();
    const criticalCount = this.allTasksData.filter(t => t.isCritical).length;
    const nearCriticalCount = this.allTasksData.filter(t => t.isNearCritical).length;

    // Update path info display (will hide it since we're in Float-based mode)
    this.updatePathInfoLabel();

    this.debugLog(`Float-Based criticality applied in ${endTime - startTime}ms.`);
    this.debugLog(`Critical tasks (Total Float ≤ 0): ${criticalCount}, Near-critical tasks: ${nearCriticalCount}`);
}

private calculateCPM(): void {
    this.identifyLongestPathFromP6();
}

/**
 * Identifies the longest path using P6 scheduled dates (reflective approach)
 * This replaces the old calculateCPM() method for Longest Path mode
 */
private identifyLongestPathFromP6(): void {
    this.debugLog("Starting P6 reflective longest path identification...");
    const startTime = performance.now();

    if (this.allTasksData.length === 0) {
        this.debugLog("No tasks for longest path identification.");
        return;
    }

    // Phase 2: Clear CPM memoization cache for fresh calculation
    this.cpmMemo.clear();

    // Phase 1: Reset criticality flags - use for...of instead of forEach
    for (const task of this.allTasksData) {
        task.isCritical = false;
        task.isCriticalByFloat = false;
        task.isCriticalByRel = false;
        task.isNearCritical = false;
        task.totalFloat = Infinity;
    }

    // Step 1: Calculate which relationships are driving
    this.identifyDrivingRelationships();

    // Step 2: Find the project finish
    const projectFinishTask = this.findProjectFinishTask();
    if (!projectFinishTask) {
        console.warn("Could not identify project finish task");
        return;
    }

    this.debugLog(`Project finish task: ${projectFinishTask.name} (${projectFinishTask.internalId})`);

    // Step 3: Find all driving chains to the project finish
    const drivingChains = this.findAllDrivingChainsToTask(projectFinishTask.internalId);

    // Step 4: Sort chains by duration and store all of them
    this.allDrivingChains = this.sortAndStoreDrivingChains(drivingChains);

    // Step 5: Get the selected chain based on user preference
    const selectedChain = this.getSelectedDrivingChain();

    if (selectedChain) {
        // Phase 1: Mark tasks in the selected chain as critical - use for...of
        for (const taskId of selectedChain.tasks) {
            const task = this.taskIdToTask.get(taskId);
            if (task) {
                task.isCritical = true;
                task.isCriticalByFloat = true;
                task.totalFloat = 0;
            }
        }

        // Phase 1: Mark relationships in the selected chain as critical - use for...of
        for (const rel of selectedChain.relationships) {
            rel.isCritical = true;
        }

        this.debugLog(`Selected driving path ${this.selectedPathIndex + 1}/${this.allDrivingChains.length}: ${selectedChain.tasks.size} tasks, duration ${selectedChain.totalDuration}`);
    }
    
    // Apply near-critical logic if enabled
    if (this.showNearCritical && this.floatThreshold > 0) {
        this.identifyNearCriticalTasks();
    }

    // Update path info display
    this.updatePathInfoLabel();

    const endTime = performance.now();
    this.debugLog(`P6 longest path completed in ${endTime - startTime}ms`);
}

/**
 * Identifies which relationships are driving based on minimum float
 */
private identifyDrivingRelationships(): void {
    // Phase 1: First, determine relationship float for all relationships
    // Use provided free float if available, otherwise calculate it
    // Use for...of instead of forEach for better performance
    for (const rel of this.relationships) {
        const pred = this.taskIdToTask.get(rel.predecessorId);
        const succ = this.taskIdToTask.get(rel.successorId);

        if (!pred || !succ) {
            (rel as any).relationshipFloat = Infinity;
            (rel as any).isDriving = false;
            rel.isCritical = false;
            continue;
        }

        let relFloat: number;

        // Use provided free float if available
        if (rel.freeFloat !== null && rel.freeFloat !== undefined) {
            relFloat = rel.freeFloat;
            this.debugLog(`Using provided free float ${relFloat} for relationship ${rel.predecessorId} -> ${rel.successorId}`);
        } else {
            // Calculate relationship float if not provided
            if (!pred.startDate || !pred.finishDate ||
                !succ.startDate || !succ.finishDate) {
                (rel as any).relationshipFloat = Infinity;
                (rel as any).isDriving = false;
                rel.isCritical = false;
                continue;
            }

            const relType = rel.type || 'FS';
            const lag = rel.lag || 0;

            // Get dates in days since epoch
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

        (rel as any).relationshipFloat = relFloat;
        (rel as any).isDriving = false;
        rel.isCritical = false;
    }

    // Phase 1: Group relationships by successor - use for...of
    const successorGroups = new Map<string, Relationship[]>();
    for (const rel of this.relationships) {
        if (!successorGroups.has(rel.successorId)) {
            successorGroups.set(rel.successorId, []);
        }
        successorGroups.get(rel.successorId)!.push(rel);
    }

    // Phase 1: For each successor, mark the predecessor(s) with minimum float as driving
    for (const [successorId, rels] of successorGroups) {
        let minFloat = Infinity;
        for (const rel of rels) {
            const relFloat = (rel as any).relationshipFloat;
            if (relFloat < minFloat) {
                minFloat = relFloat;
            }
        }

        // Mark all relationships with minimum float as driving
        for (const rel of rels) {
            const relFloat = (rel as any).relationshipFloat;
            if (Math.abs(relFloat - minFloat) <= this.floatTolerance) {
                (rel as any).isDriving = true;
            }
        }
    }

    const drivingCount = this.relationships.filter(r => (r as any).isDriving).length;
    this.debugLog(`Identified ${drivingCount} driving relationships`);
}

/**
 * Finds the project finish task (latest finish date)
 */
private findProjectFinishTask(): Task | null {
    let latestFinish: Date | null = null;
    let candidates: Task[] = [];
    
    this.allTasksData.forEach(task => {
        if (!task.finishDate) return;
        
        if (!latestFinish || task.finishDate > latestFinish) {
            latestFinish = task.finishDate;
            candidates = [task];
        } else if (Math.abs(task.finishDate.getTime() - latestFinish.getTime()) <= this.floatTolerance * 86400000) {
            candidates.push(task);
        }
    });
    
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];
    
    // Multiple candidates - select best one
    let bestCandidate = candidates[0];
    let bestChainDuration = 0;
    
    for (const candidate of candidates) {
        const chains = this.findAllDrivingChainsToTask(candidate.internalId);
        const bestChain = this.selectLongestChain(chains);
        if (bestChain && bestChain.totalDuration > bestChainDuration) {
            bestCandidate = candidate;
            bestChainDuration = bestChain.totalDuration;
        }
    }
    
    return bestCandidate;
}

/**
 * Finds all driving chains leading to a specific task
 */
private findAllDrivingChainsToTask(targetTaskId: string): Array<{
    tasks: Set<string>,
    relationships: Relationship[],
    totalDuration: number,
    startingTask: Task | null // MODIFICATION: Added startingTask to the return type
}> {
    const chains: Array<{
        tasks: Set<string>,
        relationships: Relationship[],
        totalDuration: number,
        startingTask: Task | null // MODIFICATION: Added startingTask to the return type
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
        
        // Find driving predecessors
        const drivingPreds = this.relationships.filter(rel => 
            rel.successorId === taskId && (rel as any).isDriving
        );
        
        if (drivingPreds.length === 0) {
            // Chain start - record it
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
                startingTask: task // MODIFICATION: Capture the starting task of the chain
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
                startingTask: task // MODIFICATION: Capture the starting task
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
 * Sorts driving chains by duration (descending) and stores them for multi-path toggle
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

    // Sort by duration descending
    const sortedChains = [...chains].sort((a, b) => b.totalDuration - a.totalDuration);

    this.debugLog(`Found ${sortedChains.length} driving paths to project finish`);

    // Log details about each path for debugging
    sortedChains.forEach((chain, index) => {
        this.debugLog(`  Path ${index + 1}: ${chain.tasks.size} tasks, ${chain.totalDuration.toFixed(1)} days`);
    });

    return sortedChains;
}

/**
 * Gets the currently selected driving chain based on settings
 */
private getSelectedDrivingChain(): {
    tasks: Set<string>,
    relationships: Relationship[],
    totalDuration: number,
    startingTask: Task | null
} | null {
    if (this.allDrivingChains.length === 0) return null;

    // Get the selected path index from settings (1-based)
    const settingsIndex = this.settings?.drivingPathSelection?.selectedPathIndex?.value ?? 1;
    this.debugLog(`[Path Selection] Settings index: ${settingsIndex}, Total chains: ${this.allDrivingChains.length}`);

    // Convert to 0-based and clamp to valid range
    this.selectedPathIndex = Math.max(0, Math.min(settingsIndex - 1, this.allDrivingChains.length - 1));

    // If multi-path toggle is disabled, always return the longest path (index 0)
    const multiPathEnabled = this.settings?.drivingPathSelection?.enableMultiPathToggle?.value ?? true;
    this.debugLog(`[Path Selection] Multi-path enabled: ${multiPathEnabled}, Final index: ${this.selectedPathIndex}`);

    if (!multiPathEnabled) {
        this.selectedPathIndex = 0;
    }

    return this.allDrivingChains[this.selectedPathIndex];
}

/**
 * Updates the path information label display with interactive navigation
 * UPGRADED: Professional navigation buttons with enhanced design and smooth animations
 */
private updatePathInfoLabel(): void {
    if (!this.pathInfoLabel) return;

    // Check if multi-path display is enabled
    const showPathInfo = this.settings?.drivingPathSelection?.showPathInfo?.value ?? true;
    const multiPathEnabled = this.settings?.drivingPathSelection?.enableMultiPathToggle?.value ?? true;

    // Only show if enabled and in Longest Path mode with multiple paths
    const mode = this.settings?.criticalityMode?.calculationMode?.value?.value ?? 'longestPath';
    const hasMultiplePaths = this.allDrivingChains.length > 1;

    if (!showPathInfo || mode !== 'longestPath' || !hasMultiplePaths || !multiPathEnabled) {
        this.pathInfoLabel.style("display", "none");
        return;
    }

    // Get current chain info
    const currentChain = this.allDrivingChains[this.selectedPathIndex];
    if (!currentChain) {
        this.pathInfoLabel.style("display", "none");
        return;
    }

    // Get responsive layout mode
    const viewportWidth = this.lastUpdateOptions?.viewport?.width || 800;
    const layoutMode = this.getLayoutMode(viewportWidth);
    const isCompact = layoutMode === 'narrow';
    const isMedium = layoutMode === 'medium';

    // Update container padding based on layout mode
    this.pathInfoLabel
        .style("padding", isCompact ? `0 ${this.UI_TOKENS.spacing.sm}px` : `0 ${this.UI_TOKENS.spacing.lg}px`)
        .style("gap", isCompact ? `${this.UI_TOKENS.spacing.xs}px` : `${this.UI_TOKENS.spacing.md}px`);

    // Clear existing content
    this.pathInfoLabel.selectAll("*").remove();

    // Format the display info
    const pathNumber = this.selectedPathIndex + 1;
    const totalPaths = this.allDrivingChains.length;
    const duration = currentChain.totalDuration.toFixed(1);
    const taskCount = currentChain.tasks.size;

    // Professional Previous button with SVG arrow
    const prevButton = this.pathInfoLabel.append("div")
        .style("cursor", "pointer")
        .style("padding", "6px")  // Increased from 4px 8px
        .style("border-radius", `${this.UI_TOKENS.radius.small}px`)
        .style("display", "flex")
        .style("align-items", "center")
        .style("justify-content", "center")
        .style("transition", `all ${this.UI_TOKENS.motion.duration.fast}ms ${this.UI_TOKENS.motion.easing.smooth}`)
        .style("user-select", "none")
        .style("width", "24px")
        .style("height", "24px");

    // SVG arrow for previous button
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
    prevButton
        .on("mouseover", function() {
            d3.select(this)
                .style("background-color", self.UI_TOKENS.color.primary.light)
                .style("transform", "scale(1.1)");
        })
        .on("mouseout", function() {
            d3.select(this)
                .style("background-color", "transparent")
                .style("transform", "scale(1)");
        })
        .on("mousedown", function() {
            d3.select(this).style("transform", "scale(0.95)");
        })
        .on("mouseup", function() {
            d3.select(this).style("transform", "scale(1.1)");
        });

    prevButton.on("click", function(event) {
        event.stopPropagation();
        self.navigateToPreviousPath();
    });

    // Professional path info text container - responsive layout
    const infoContainer = this.pathInfoLabel.append("div")
        .style("display", "flex")
        .style("align-items", "center")
        .style("gap", isCompact ? `${this.UI_TOKENS.spacing.xs}px` : `${this.UI_TOKENS.spacing.md}px`)
        .style("padding", isCompact ? "0 2px" : "0 6px");

    // Path indicator - always show, but compact in narrow mode
    infoContainer.append("span")
        .style("font-weight", "700")  // Bolder
        .style("letter-spacing", "0.3px")
        .text(isCompact ? `${pathNumber}/${totalPaths}` : `Path ${pathNumber}/${totalPaths}`);

    // Show additional info only in wide and medium modes
    if (!isCompact) {
        infoContainer.append("span")
            .style("color", this.UI_TOKENS.color.primary.default)
            .style("font-weight", "600")
            .text("•");

        infoContainer.append("span")
            .style("font-weight", "500")
            .text(`${taskCount} tasks`);

        // Duration only in wide mode
        if (!isMedium) {
            infoContainer.append("span")
                .style("color", this.UI_TOKENS.color.primary.default)
                .style("font-weight", "600")
                .text("•");

            infoContainer.append("span")
                .style("font-weight", "500")
                .text(`${duration} days`);
        }
    }

    // Professional Next button with SVG arrow
    const nextButton = this.pathInfoLabel.append("div")
        .style("cursor", "pointer")
        .style("padding", "6px")
        .style("border-radius", `${this.UI_TOKENS.radius.small}px`)
        .style("display", "flex")
        .style("align-items", "center")
        .style("justify-content", "center")
        .style("transition", `all ${this.UI_TOKENS.motion.duration.fast}ms ${this.UI_TOKENS.motion.easing.smooth}`)
        .style("user-select", "none")
        .style("width", "24px")
        .style("height", "24px");

    // SVG arrow for next button
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

    nextButton
        .on("mouseover", function() {
            d3.select(this)
                .style("background-color", self.UI_TOKENS.color.primary.light)
                .style("transform", "scale(1.1)");
        })
        .on("mouseout", function() {
            d3.select(this)
                .style("background-color", "transparent")
                .style("transform", "scale(1)");
        })
        .on("mousedown", function() {
            d3.select(this).style("transform", "scale(0.95)");
        })
        .on("mouseup", function() {
            d3.select(this).style("transform", "scale(1.1)");
        });

    nextButton.on("click", function(event) {
        event.stopPropagation();
        self.navigateToNextPath();
    });

    this.pathInfoLabel.style("display", "flex");
}

/**
 * Navigate to the previous driving path
 */
private navigateToPreviousPath(): void {
    if (this.allDrivingChains.length <= 1) return;

    // Move to previous path (with wrapping)
    this.selectedPathIndex = this.selectedPathIndex === 0
        ? this.allDrivingChains.length - 1
        : this.selectedPathIndex - 1;

    this.debugLog(`[Path Navigation] Switched to path ${this.selectedPathIndex + 1}/${this.allDrivingChains.length}`);

    // Persist the change
    this.persistPathSelection();

    // Recalculate and redraw
    this.identifyLongestPathFromP6();

    // Force full redraw
    this.forceFullUpdate = true;
    if (this.lastUpdateOptions) {
        this.update(this.lastUpdateOptions);
    }
}

/**
 * Navigate to the next driving path
 */
private navigateToNextPath(): void {
    if (this.allDrivingChains.length <= 1) return;

    // Move to next path (with wrapping)
    this.selectedPathIndex = (this.selectedPathIndex + 1) % this.allDrivingChains.length;

    this.debugLog(`[Path Navigation] Switched to path ${this.selectedPathIndex + 1}/${this.allDrivingChains.length}`);

    // Persist the change
    this.persistPathSelection();

    // Recalculate and redraw
    this.identifyLongestPathFromP6();

    // Force full redraw
    this.forceFullUpdate = true;
    if (this.lastUpdateOptions) {
        this.update(this.lastUpdateOptions);
    }
}

/**
 * Persist the selected path index to settings
 */
private persistPathSelection(): void {
    try {
        const pathIndex1Based = this.selectedPathIndex + 1;

        // Update local settings
        if (this.settings?.drivingPathSelection?.selectedPathIndex) {
            this.settings.drivingPathSelection.selectedPathIndex.value = pathIndex1Based;
        }

        // Persist to Power BI
        this.host.persistProperties({
            merge: [{
                objectName: "drivingPathSelection",
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
    // Only identify near-critical tasks if threshold > 0
    if (this.floatThreshold <= 0) {
        this.debugLog("Float threshold is 0, skipping near-critical identification");
        return;
    }
    
    this.allTasksData.forEach(task => {
        if (task.isCritical) return;
        
        let minFloatToCritical = Infinity;
        const visited = new Set<string>();
        const queue: Array<{taskId: string, accumulatedFloat: number}> = [
            {taskId: task.internalId, accumulatedFloat: 0}
        ];
        
        while (queue.length > 0) {
            const {taskId, accumulatedFloat} = queue.shift()!;
            
            if (visited.has(taskId)) continue;
            visited.add(taskId);
            
            const currentTask = this.taskIdToTask.get(taskId);
            if (!currentTask) continue;
            
            if (currentTask.isCritical) {
                minFloatToCritical = Math.min(minFloatToCritical, accumulatedFloat);
                continue;
            }
            
            // Find successors with minimum float
            const successorRels = this.relationships.filter(r => r.predecessorId === taskId);
            const successorFloats = new Map<string, number>();
            
            successorRels.forEach(rel => {
                const relFloat = (rel as any).relationshipFloat ?? Infinity;
                const currentMin = successorFloats.get(rel.successorId) ?? Infinity;
                successorFloats.set(rel.successorId, Math.min(currentMin, relFloat));
            });
            
            successorFloats.forEach((minFloat, succId) => {
                const floatToAdd = Math.max(0, minFloat);
                queue.push({
                    taskId: succId,
                    accumulatedFloat: accumulatedFloat + floatToAdd
                });
            });
        }
        
        if (minFloatToCritical <= this.floatThreshold) {
            task.isNearCritical = true;
            task.totalFloat = minFloatToCritical;
        }
    });
}

/**
 * Identifies predecessor tasks connected through driving relationships
 */
private identifyDrivingPredecessorTasks(targetTaskId: string): Set<string> {
    const tasksInPath = new Set<string>();
    tasksInPath.add(targetTaskId);
    
    this.identifyDrivingRelationships(); // Ensure driving relationships are identified
    
    const queue: string[] = [targetTaskId];
    const visited = new Set<string>();
    visited.add(targetTaskId);
    
    while (queue.length > 0) {
        const currentTaskId = queue.shift()!;
        
        // Find driving predecessors only
        const drivingPreds = this.relationships.filter(rel => 
            rel.successorId === currentTaskId && (rel as any).isDriving
        );
        
        for (const rel of drivingPreds) {
            if (!visited.has(rel.predecessorId)) {
                tasksInPath.add(rel.predecessorId);
                visited.add(rel.predecessorId);
                queue.push(rel.predecessorId);
            }
        }
    }
    
    this.debugLog(`P6 backward trace from ${targetTaskId}: ${tasksInPath.size} tasks`);
    return tasksInPath;
}

/**
 * Identifies successor tasks connected through driving relationships
 */
private identifyDrivingSuccessorTasks(sourceTaskId: string): Set<string> {
    const tasksInPath = new Set<string>();
    tasksInPath.add(sourceTaskId);
    
    this.identifyDrivingRelationships(); // Ensure driving relationships are identified
    
    const queue: string[] = [sourceTaskId];
    const visited = new Set<string>();
    visited.add(sourceTaskId);
    
    while (queue.length > 0) {
        const currentTaskId = queue.shift()!;
        
        // Find driving successors only
        const drivingSuccs = this.relationships.filter(rel => 
            rel.predecessorId === currentTaskId && (rel as any).isDriving
        );
        
        for (const rel of drivingSuccs) {
            if (!visited.has(rel.successorId)) {
                tasksInPath.add(rel.successorId);
                visited.add(rel.successorId);
                queue.push(rel.successorId);
            }
        }
    }
    
    this.debugLog(`P6 forward trace from ${sourceTaskId}: ${tasksInPath.size} tasks`);
    return tasksInPath;
}

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
    
    // Reset all tasks
    this.allTasksData.forEach(task => {
        task.isCritical = false;
        task.isCriticalByFloat = false;
        task.isCriticalByRel = false;
        task.isNearCritical = false;
        task.totalFloat = Infinity;
    });
    
    // Identify driving relationships
    this.identifyDrivingRelationships();
    
    // Find all driving chains to the target
    const chains = this.findAllDrivingChainsToTask(targetTaskId);
    
    // MODIFICATION START: Instead of just selecting the longest chain,
    // we now select the chain that starts on the earliest date.
    // Duration is used as a tie-breaker.
    if (chains.length > 0) {
        chains.sort((a, b) => {
            const aDate = a.startingTask?.startDate?.getTime() ?? Infinity;
            const bDate = b.startingTask?.startDate?.getTime() ?? Infinity;

            if (aDate < bDate) return -1;
            if (aDate > bDate) return 1;

            // If dates are the same, use duration as a tie-breaker (longest wins)
            return b.totalDuration - a.totalDuration;
        });

        const bestChain = chains[0]; // The best chain is now the first one after sorting
        
        if (bestChain) {
            bestChain.tasks.forEach(taskId => {
                const task = this.taskIdToTask.get(taskId);
                if (task) {
                    task.isCritical = true;
                    task.isCriticalByFloat = true;
                    task.totalFloat = 0;
                }
            });
            
            bestChain.relationships.forEach(rel => {
                rel.isCritical = true;
            });

            this.debugLog(`P6 path to ${targetTaskId} with ${bestChain.tasks.size} tasks, starting on ${this.formatDate(bestChain.startingTask?.startDate)}`);
        }
    }
    // MODIFICATION END

    // Always mark target task as critical
    targetTask.isCritical = true;
    targetTask.isCriticalByFloat = true;
}

/**
 * Calculates CPM (Critical Path Method) forward from a selected source task
 * OPTIMIZED: Converted from exponential recursion to iterative stack-based DFS
 * PERFORMANCE FIX: Uses indexed lookups instead of filtering entire relationship array
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

    // Reset all tasks
    this.allTasksData.forEach(task => {
        task.isCritical = false;
        task.isCriticalByFloat = false;
        task.isCriticalByRel = false;
        task.isNearCritical = false;
        task.totalFloat = Infinity;
    });

    // First, identify all driving relationships in the schedule
    this.identifyDrivingRelationships();

    // OPTIMIZATION: Build a driving successor index for O(1) lookups
    // This avoids filtering the entire relationship array on every iteration
    const drivingSuccessorIndex = new Map<string, Array<{ succId: string, rel: Relationship }>>();
    for (const rel of this.relationships) {
        if ((rel as any).isDriving) {
            if (!drivingSuccessorIndex.has(rel.predecessorId)) {
                drivingSuccessorIndex.set(rel.predecessorId, []);
            }
            drivingSuccessorIndex.get(rel.predecessorId)!.push({
                succId: rel.successorId,
                rel: rel
            });
        }
    }

    const completedChains: Array<{
        tasks: Set<string>,
        relationships: Relationship[],
        totalDuration: number,
        endingTask: Task
    }> = [];

    // CRITICAL FIX: Use GLOBAL visited set to prevent exponential explosion
    // Previously visitedInPath was cleared on backtrack, causing tasks to be visited
    // multiple times in different branches (exponential complexity)
    const globalVisited = new Set<string>();

    // Stack-based DFS to avoid deep recursion and stack overflow
    interface StackFrame {
        taskId: string;
        chain: Set<string>;
        rels: Relationship[];
        duration: number;
        depth: number;
    }

    const MAX_DEPTH = 1000; // Safety limit to prevent infinite loops
    const MAX_CHAINS = 10000; // Limit number of chains to explore
    const stack: StackFrame[] = [{
        taskId: sourceTaskId,
        chain: new Set([sourceTaskId]),
        rels: [],
        duration: sourceTask.duration,
        depth: 0
    }];

    let exploredChains = 0;

    while (stack.length > 0 && exploredChains < MAX_CHAINS) {
        const frame = stack.pop()!;
        const { taskId, chain, rels, duration, depth } = frame;

        // Safety checks
        if (depth > MAX_DEPTH) {
            console.warn(`Forward trace: Max depth (${MAX_DEPTH}) reached at task ${taskId}. Stopping this branch.`);
            continue;
        }

        // CRITICAL: Check global visited to prevent re-exploring same task
        if (globalVisited.has(taskId)) {
            continue; // Already fully explored from this task
        }

        globalVisited.add(taskId);

        const task = this.taskIdToTask.get(taskId);
        if (!task) continue;

        // Get driving successors using index (O(1) instead of O(n) filter)
        const drivingSuccs = drivingSuccessorIndex.get(taskId) || [];

        if (drivingSuccs.length === 0) {
            // End of driving chain - record it
            completedChains.push({
                tasks: new Set(chain),
                relationships: [...rels],
                totalDuration: duration,
                endingTask: task
            });
            exploredChains++;
        } else {
            // Push successors to stack (reverse order for DFS)
            for (let i = drivingSuccs.length - 1; i >= 0; i--) {
                const { succId, rel } = drivingSuccs[i];

                // Cycle detection within current chain
                if (chain.has(succId)) {
                    this.debugLog(`Cycle detected: ${taskId} → ${succId} already in chain`);
                    continue;
                }

                const succTask = this.taskIdToTask.get(succId);
                if (!succTask) continue;

                // Create new chain state for this branch
                const newChain = new Set(chain);
                newChain.add(succId);

                const newRels = [...rels, rel];
                const newDuration = duration + succTask.duration;

                stack.push({
                    taskId: succId,
                    chain: newChain,
                    rels: newRels,
                    duration: newDuration,
                    depth: depth + 1
                });
            }
        }
    }

    if (exploredChains >= MAX_CHAINS) {
        console.warn(`Forward trace stopped after exploring ${MAX_CHAINS} chains. Network may be very complex.`);
    }

    if (completedChains.length > 0) {
        // Sort to find best chain: latest finish date, then longest duration
        completedChains.sort((a, b) => {
            const aDate = a.endingTask?.finishDate?.getTime() ?? -Infinity;
            const bDate = b.endingTask?.finishDate?.getTime() ?? -Infinity;

            if (aDate > bDate) return -1;
            if (aDate < bDate) return 1;

            return b.totalDuration - a.totalDuration;
        });

        const bestChain = completedChains[0];

        if (bestChain) {
            // Mark tasks in best path as critical
            bestChain.tasks.forEach(taskId => {
                const task = this.taskIdToTask.get(taskId);
                if (task) {
                    task.isCritical = true;
                    task.isCriticalByFloat = true;
                    task.totalFloat = 0;
                }
            });

            bestChain.relationships.forEach(rel => {
                rel.isCritical = true;
            });

            this.debugLog(`Forward path from ${sourceTaskId}: ${bestChain.tasks.size} tasks, ${completedChains.length} chains found, ending ${this.formatDate(bestChain.endingTask?.finishDate)}`);
        }
    } else {
        // No forward driving path - selected task is an endpoint
        sourceTask.isCritical = true;
        sourceTask.isCriticalByFloat = true;
        this.debugLog(`No forward driving path from ${sourceTaskId}. Task marked as critical endpoint.`);
    }
}

/**
 * Traces backward from a target task to find all predecessor tasks (Float-Based mode)
 * OPTIMIZED: Added safety limits to prevent memory exhaustion
 */
private identifyPredecessorTasksFloatBased(targetTaskId: string): Set<string> {
    const tasksInPath = new Set<string>();
    tasksInPath.add(targetTaskId);

    const queue: string[] = [targetTaskId];
    const visited = new Set<string>();
    visited.add(targetTaskId);

    // Safety limits to prevent memory explosion
    const MAX_TASKS = 10000; // Hard limit on tasks to trace
    const MAX_ITERATIONS = 50000; // Prevent infinite loops
    let iterations = 0;

    while (queue.length > 0 && iterations < MAX_ITERATIONS) {
        iterations++;

        // Check if we've hit the task limit
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

    // Safety limits to prevent memory explosion
    const MAX_TASKS = 10000; // Hard limit on tasks to trace
    const MAX_ITERATIONS = 50000; // Prevent infinite loops
    let iterations = 0;

    while (queue.length > 0 && iterations < MAX_ITERATIONS) {
        iterations++;

        // Check if we've hit the task limit
        if (tasksInPath.size > MAX_TASKS) {
            console.warn(`Forward trace from ${sourceTaskId} hit task limit (${MAX_TASKS}). Stopping to prevent memory exhaustion.`);
            break;
        }

        const currentTaskId = queue.shift()!;

        // predecessorIndex maps: predecessor → Set<successors>
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
    
    // Get column indices
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
    
    // Extract task properties
    const taskName = (nameIdx !== -1 && row[nameIdx] != null) 
        ? String(row[nameIdx]).trim() 
        : `Task ${taskId}`;
        
    const taskType = (typeIdx !== -1 && row[typeIdx] != null) 
        ? String(row[typeIdx]).trim() 
        : 'TT_Task';
    
    // Parse duration
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
    
    // Parse user-provided total float
    let userProvidedTotalFloat: number | undefined = undefined;
    if (totalFloatIdx !== -1 && row[totalFloatIdx] != null) {
        const parsedFloat = Number(row[totalFloatIdx]);
        if (!isNaN(parsedFloat) && isFinite(parsedFloat)) {
            userProvidedTotalFloat = parsedFloat;
        }
    }
    
    // Parse task free float (NEW)
    let taskFreeFloat: number | undefined = undefined;
    if (taskFreeFloatIdx !== -1 && row[taskFreeFloatIdx] != null) {
        const parsedFloat = Number(row[taskFreeFloatIdx]);
        if (!isNaN(parsedFloat) && isFinite(parsedFloat)) {
            taskFreeFloat = parsedFloat;
        }
    }
    
    // Parse dates
    const startDate = (startDateIdx !== -1 && row[startDateIdx] != null) 
        ? this.parseDate(row[startDateIdx]) 
        : null;
    const finishDate = (finishDateIdx !== -1 && row[finishDateIdx] != null) 
        ? this.parseDate(row[finishDateIdx]) 
        : null;
    
    // Parse baseline dates
    const baselineStartDate = (baselineStartDateIdx !== -1 && row[baselineStartDateIdx] != null) 
        ? this.parseDate(row[baselineStartDateIdx]) 
        : null;
    const baselineFinishDate = (baselineFinishDateIdx !== -1 && row[baselineFinishDateIdx] != null) 
        ? this.parseDate(row[baselineFinishDateIdx]) 
        : null;

    // Parse previous update dates
    const previousUpdateStartDate = (previousUpdateStartDateIdx !== -1 && row[previousUpdateStartDateIdx] != null) 
        ? this.parseDate(row[previousUpdateStartDateIdx]) 
        : null;
    const previousUpdateFinishDate = (previousUpdateFinishDateIdx !== -1 && row[previousUpdateFinishDateIdx] != null) 
        ? this.parseDate(row[previousUpdateFinishDateIdx]) 
        : null;
    
    // Parse legend value
    const legendIdx = this.getColumnIndex(dataView, 'legend');
    const legendValue = (legendIdx !== -1 && row[legendIdx] != null)
        ? String(row[legendIdx])
        : undefined;

    // Parse WBS level values dynamically from wbsLevelColumnIndices
    const wbsLevels: string[] = [];
    for (const colIdx of this.wbsLevelColumnIndices) {
        if (colIdx !== -1 && row[colIdx] != null) {
            const value = String(row[colIdx]).trim();
            if (value) {
                wbsLevels.push(value);
            }
        }
    }

    // Get tooltip data
    const tooltipData = this.extractTooltipData(row, dataView);

    // Create task object
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
        legendValue: legendValue,
        wbsLevels: wbsLevels.length > 0 ? wbsLevels : undefined
    };

    return task;
}

/**
 * Extracts tooltip data from a row
 */
private extractTooltipData(row: any[], dataView: DataView): Array<{key: string, value: PrimitiveValue}> | undefined {
    const columns = dataView.metadata?.columns;
    if (!columns) return undefined;

    // Collect tooltip columns with their metadata
    const tooltipColumns: Array<{column: any, rowIndex: number}> = [];

    columns.forEach((column, index) => {
        if (column.roles?.tooltip) {
            // Log column properties for debugging (first occurrence only)
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

    // Try sorting by queryName which often contains role index
    tooltipColumns.sort((a, b) => {
        const aQuery = a.column.queryName || '';
        const bQuery = b.column.queryName || '';

        // Extract numeric indices from queryNames like "Sum(Field).tooltip.0"
        const aMatch = aQuery.match(/\.tooltip\.(\d+)$/);
        const bMatch = bQuery.match(/\.tooltip\.(\d+)$/);

        if (aMatch && bMatch) {
            return parseInt(aMatch[1]) - parseInt(bMatch[1]);
        }

        // Fallback to Power BI's internal column index. This usually corresponds to the order fields were added to the bucket.
        if (a.column.index !== undefined && b.column.index !== undefined) {
            return a.column.index - b.column.index;
        }

        // Final fallback to the order they appeared in the metadata.
        return a.rowIndex - b.rowIndex;
    });

    // Build tooltip data array in the correct order
    const tooltipData: Array<{key: string, value: PrimitiveValue}> = [];

    for (const item of tooltipColumns) {
        const value = row[item.rowIndex];
        if (value !== null && value !== undefined) {
            // Check if this should be treated as a date
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
            // Otherwise store original value
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
    
    // Clear existing data
    this.allTasksData = [];
    this.relationships = [];
    this.taskIdToTask.clear();
    this.predecessorIndex.clear();
    this.relationshipIndex.clear();
    this.dataDate = null;

    if (!dataView.table?.rows || !dataView.metadata?.columns) {
        console.error("Data transformation failed: No table data or columns found.");
        return;
    }
    
    const rows = dataView.table.rows;
    const columns = dataView.metadata.columns;

    // Get column indices once
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

    // Single pass data structures
    const taskDataMap = new Map<
        string,
        {
            rows: any[];
            task: Task | null;
            relationships: Array<{
                predId: string;
                relType: string;
                lag: number | null;
                freeFloat: number | null;
            }>;
        }
    >();

    // NEW: track every predecessor id we see so we can create synthetic start tasks
    const allPredecessorIds = new Set<string>();

    // SINGLE PASS: Group all rows by task ID
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex];
        const taskId = this.extractTaskId(row);
        if (!taskId) {
            console.warn(`Skipping row ${rowIndex}: Invalid or missing Task ID.`);
            continue;
        }

        // Capture Data Date (use earliest valid value to keep it consistent across rows)
        if (dataDateIdx !== -1 && row[dataDateIdx] != null) {
            const parsedDataDate = this.parseDate(row[dataDateIdx]);
            if (parsedDataDate) {
                const ts = parsedDataDate.getTime();
                if (this.dataDate === null || ts < this.dataDate.getTime()) {
                    this.dataDate = parsedDataDate;
                }
            }
        }

        // Get or create task data entry
        let taskData = taskDataMap.get(taskId);
        if (!taskData) {
            taskData = {
                rows: [],
                task: null,
                relationships: [],
            };
            taskDataMap.set(taskId, taskData);
        }

        taskData.rows.push(row);

        // Extract relationship data if present
        if (predIdIdx !== -1 && row[predIdIdx] != null) {
            const predId = this.extractPredecessorId(row);
            if (predId && predId !== taskId) {
                // NEW: remember that this id exists as a predecessor
                allPredecessorIds.add(predId);

                // Parse relationship properties
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

                // Extract relationship free float if provided
                let relFreeFloat: number | null = null;
                if (relFreeFloatIdx !== -1 && row[relFreeFloatIdx] != null) {
                    const parsedFreeFloat = Number(row[relFreeFloatIdx]);
                    if (!isNaN(parsedFreeFloat) && isFinite(parsedFreeFloat)) {
                        relFreeFloat = parsedFreeFloat;
                    }
                }

                // Check if this relationship already exists
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

    // NEW: figure out how many "predecessor-only" tasks we have
    // (appear only as predecessors, never as a successor/taskId)
    let syntheticTaskCount = 0;
    for (const predId of allPredecessorIds) {
        if (!taskDataMap.has(predId)) {
            syntheticTaskCount++;
        }
    }

    // Phase 1: Process grouped data to create tasks and relationships
    // Pre-allocate arrays for better performance (including synthetic tasks)
    this.allTasksData = new Array(taskDataMap.size + syntheticTaskCount);
    this.relationships = [];

    const successorMap = new Map<string, Task[]>();
    let taskIndex = 0;

    // Phase 1: Use for...of instead of forEach for better performance
    for (const [taskId, taskData] of taskDataMap) {
        // Create task from first row (they should all have same task data)
        if (taskData.rows.length > 0 && !taskData.task) {
            taskData.task = this.createTaskFromRow(taskData.rows[0], 0);
        }
        if (!taskData.task) continue;

        const task = taskData.task;

        // Build predecessor index
        if (!this.predecessorIndex.has(taskId)) {
            this.predecessorIndex.set(taskId, new Set());
        }

        // Apply relationships to task
        for (const rel of taskData.relationships) {
            task.predecessorIds.push(rel.predId);
            task.relationshipTypes[rel.predId] = rel.relType;
            task.relationshipLags[rel.predId] = rel.lag;

            // Update predecessor index
            if (!this.predecessorIndex.has(rel.predId)) {
                this.predecessorIndex.set(rel.predId, new Set());
            }
            this.predecessorIndex.get(rel.predId)!.add(taskId);

            // Add to successor map for later processing
            if (!successorMap.has(rel.predId)) {
                successorMap.set(rel.predId, []);
            }
            successorMap.get(rel.predId)!.push(task);

            // Create relationship object with free float from data if available
            const relationship: Relationship = {
                predecessorId: rel.predId,
                successorId: taskId,
                type: rel.relType,
                freeFloat: rel.freeFloat, // Use provided free float or null
                lag: rel.lag,
                isCritical: false,
            };
            this.relationships.push(relationship);

            // Add to relationship index (by successor/task id)
            if (!this.relationshipIndex.has(taskId)) {
                this.relationshipIndex.set(taskId, []);
            }
            this.relationshipIndex.get(taskId)!.push(relationship);
        }

        // Add task to collections
        this.allTasksData[taskIndex++] = task;
        this.taskIdToTask.set(taskId, task);
    }

    // NEW: Phase 1b – create synthetic tasks for ids that only ever appear as predecessors
    for (const predId of allPredecessorIds) {
        // If we already created a real task for this id (it appeared as a successor), skip it
        if (this.taskIdToTask.has(predId)) {
            continue;
        }

        const syntheticTask: Task = {
            id: predId,
            internalId: predId,
            name: String(predId),
            type: "Synthetic",       // You can rename this to whatever makes sense
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

    // Trim array to actual size if needed (should normally be exact)
    if (taskIndex < this.allTasksData.length) {
        this.allTasksData.length = taskIndex;
    }

    // Phase 2: Assign successors and predecessors with cached lookups
    for (const task of this.allTasksData) {
        // Set successors from map (synthetic tasks will get their successors from the map as well)
        task.successors = successorMap.get(task.internalId) || [];

        // Set predecessor task references (now includes synthetic predecessor-only tasks)
        task.predecessors = task.predecessorIds
            .map((id) => this.taskIdToTask.get(id))
            .filter((t) => t !== undefined) as Task[];
    }

    // Process legend data and assign colours
    this.processLegendData(dataView);

    // Process WBS data and build hierarchy
    this.processWBSData();

    // DATA QUALITY: Validate data quality and warn users of potential issues
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

    // Check 1: Duplicate Task IDs (already handled by Map overwrite, but warn user)
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

    // Check 2: Circular dependencies
    const circularPaths = this.detectCircularDependencies();
    if (circularPaths.length > 0) {
        warnings.push(`Circular dependencies detected in ${circularPaths.length} path(s): ${circularPaths.slice(0, 3).join(', ')}${circularPaths.length > 3 ? '...' : ''}`);
    }

    // Check 3: Invalid date ranges
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

    // Check 4: Tasks with no valid dates
    const noDateTasks = this.allTasksData.filter(task =>
        !(task.startDate instanceof Date && !isNaN(task.startDate.getTime())) &&
        !(task.finishDate instanceof Date && !isNaN(task.finishDate.getTime()))
    );

    if (noDateTasks.length > 0 && noDateTasks.length < this.allTasksData.length) {
        warnings.push(`${noDateTasks.length} task(s) have no valid dates and will not be displayed`);
    }

    // Check 5: Synthetic tasks (predecessor-only tasks missing task details)
    const syntheticTasks = this.allTasksData.filter(task => task.type === "Synthetic");
    if (syntheticTasks.length > 0) {
        const syntheticIds = syntheticTasks.map(t => t.id).slice(0, 5);
        warnings.push(`${syntheticTasks.length} task(s) referenced as predecessors but missing from task list: ${syntheticIds.join(', ')}${syntheticTasks.length > 5 ? '...' : ''}. Add these tasks to your data source with proper Task Name values.`);
    }

    // Report warnings to console (enterprise visuals should log data quality issues)
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
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (taskId: string, path: string[]): void => {
        if (recursionStack.has(taskId)) {
            // Found a cycle - extract the circular portion
            const cycleStart = path.indexOf(taskId);
            const cycle = path.slice(cycleStart).concat([taskId]);
            circularPaths.push(cycle.join(' → '));
            return;
        }

        if (visited.has(taskId)) {
            return;
        }

        visited.add(taskId);
        recursionStack.add(taskId);
        path.push(taskId);

        const task = this.taskIdToTask.get(taskId);
        if (task && task.predecessorIds) {
            for (const predId of task.predecessorIds) {
                dfs(predId, [...path]);
            }
        }

        recursionStack.delete(taskId);
    };

    // Check all tasks
    for (const task of this.allTasksData) {
        if (!visited.has(task.internalId)) {
            dfs(task.internalId, []);
        }
    }

    return circularPaths;
}

/**
 * Process legend data and assign colors to tasks based on legend values
 */
private processLegendData(dataView: DataView): void {
    // Reset legend data
    this.legendDataExists = false;
    this.legendColorMap.clear();
    this.legendCategories = [];
    this.legendSelectionIds.clear();
    this.legendFieldName = "";

    // Check if legend field exists in metadata
    const columns = dataView.metadata?.columns;
    if (!columns) return;

    const legendColumn = columns.find(col => col.roles?.legend);
    if (!legendColumn) {
        // No legend field - clear legend colors from all tasks
        for (const task of this.allTasksData) {
            task.legendColor = undefined;
        }
        return;
    }

    this.legendFieldName = legendColumn.displayName || "Legend";
    this.legendDataExists = true;

    // Collect unique legend values from tasks
    const legendValueSet = new Set<string>();
    for (const task of this.allTasksData) {
        if (task.legendValue) {
            legendValueSet.add(task.legendValue);
        }
    }

    this.legendCategories = Array.from(legendValueSet);

    // Sort categories BEFORE assigning colors (so indices match the sorted order)
    const sortOrder = this.settings?.legend?.sortOrder?.value?.value || "none";
    if (sortOrder === "ascending") {
        this.legendCategories.sort((a, b) => a.localeCompare(b));
    } else if (sortOrder === "descending") {
        this.legendCategories.sort((a, b) => b.localeCompare(a));
    }

    // Assign colors from persisted settings or theme palette
    const legendColorsObjects = dataView.metadata?.objects?.legendColors;
    for (let i = 0; i < this.legendCategories.length && i < 20; i++) {
        const category = this.legendCategories[i];
        const colorKey = `color${i + 1}`; // color1, color2, etc.

        // Check if user has set a custom color for this slot
        const persistedColor = legendColorsObjects?.[colorKey];

        if (persistedColor && typeof persistedColor === 'object' && 'solid' in persistedColor) {
            // Use persisted color
            this.legendColorMap.set(category, (persistedColor as any).solid.color);
        } else {
            // Use theme default color
            const defaultColor = this.host.colorPalette.getColor(category).value;
            this.legendColorMap.set(category, defaultColor);
        }
    }

    // Assign colors to tasks (this part remains valid)
    // We map the task's legend value to the color map we just built
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
    // Reset WBS data
    this.wbsDataExists = false;
    this.wbsGroups = [];
    this.wbsGroupMap.clear();
    this.wbsRootGroups = [];
    this.wbsAvailableLevels = [];

    // Check if any task has WBS data (using dynamic wbsLevels array)
    const hasWbsData = this.allTasksData.some(task =>
        task.wbsLevels && task.wbsLevels.length > 0
    );

    if (!hasWbsData) {
        // No WBS data - clear WBS properties from tasks
        for (const task of this.allTasksData) {
            task.wbsGroupId = undefined;
            task.wbsIndentLevel = 0;
        }
        return;
    }

    this.wbsDataExists = true;
    const defaultExpanded = this.settings?.wbsGrouping?.defaultExpanded?.value ?? true;
    const expandCollapseAll = this.settings?.wbsGrouping?.expandCollapseAll?.value ?? true;

    // Check if expandCollapseAll toggle has changed - if so, we'll override all states
    const expandCollapseAllChanged = this.lastExpandCollapseAllState !== null &&
                                      this.lastExpandCollapseAllState !== expandCollapseAll;
    if (expandCollapseAllChanged) {
        // Clear persisted states so new groups will use the current expandCollapseAll value
        this.wbsExpandedState.clear();
    }
    this.lastExpandCollapseAllState = expandCollapseAll;

    // Build unique WBS paths and assign to tasks
    // Path format: "L1:Value1|L2:Value2|L3:Value3" (dynamic levels based on columns added)
    for (const task of this.allTasksData) {
        const pathParts: string[] = [];

        if (task.wbsLevels && task.wbsLevels.length > 0) {
            // Build path from the wbsLevels array - levels are 1-based
            for (let i = 0; i < task.wbsLevels.length; i++) {
                const level = i + 1; // 1-based level
                pathParts.push(`L${level}:${task.wbsLevels[i]}`);
            }
        }

        if (pathParts.length > 0) {
            task.wbsGroupId = pathParts.join('|');
            // Indent level is the depth in the hierarchy (0-based, equals number of levels - 1)
            task.wbsIndentLevel = pathParts.length - 1;
        } else {
            task.wbsGroupId = undefined;
            task.wbsIndentLevel = 0;
        }
    }

    // Build hierarchical group structure
    // First, collect all unique group paths at each level
    const groupPaths = new Set<string>();

    for (const task of this.allTasksData) {
        if (!task.wbsGroupId) continue;

        // Add all parent paths as well
        const parts = task.wbsGroupId.split('|');
        let currentPath = '';
        for (const part of parts) {
            currentPath = currentPath ? `${currentPath}|${part}` : part;
            groupPaths.add(currentPath);
        }
    }

    // Create WBSGroup objects for each unique path
    for (const path of groupPaths) {
        const parts = path.split('|');
        const lastPart = parts[parts.length - 1];
        const levelMatch = lastPart.match(/^L(\d+):(.+)$/);

        if (!levelMatch) continue;

        const level = parseInt(levelMatch[1], 10);
        const name = levelMatch[2];
        const parentPath = parts.length > 1 ? parts.slice(0, -1).join('|') : null;

        // Check if we have a persisted expansion state, otherwise use current expandCollapseAll value
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

    // Build parent-child relationships
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

    // Assign tasks to their immediate (deepest) group
    for (const task of this.allTasksData) {
        if (task.wbsGroupId) {
            const group = this.wbsGroupMap.get(task.wbsGroupId);
            if (group) {
                group.tasks.push(task);
            }
        }
    }

    // Calculate allTasks (including children) and summary metrics recursively
    const calculateGroupMetrics = (group: WBSGroup): void => {
        // Start with direct tasks
        group.allTasks = [...group.tasks];

        // Recursively process children first
        for (const child of group.children) {
            calculateGroupMetrics(child);
            // Add child's allTasks to this group's allTasks
            group.allTasks.push(...child.allTasks);
        }

        // Calculate summary metrics from all tasks
        group.taskCount = group.allTasks.length;
        group.hasCriticalTasks = group.allTasks.some(t => t.isCritical);
        group.hasNearCriticalTasks = group.allTasks.some(t => t.isNearCritical);

        // Calculate summary dates (earliest start, latest finish)
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

    // Calculate metrics for all root groups (which recursively calculates for all children)
    for (const rootGroup of this.wbsRootGroups) {
        calculateGroupMetrics(rootGroup);
    }

    // Sort groups by earliest start date for logical task flow ordering
    // Groups with earlier tasks appear first, making the visual flow chronologically
    const sortByStartDate = (a: WBSGroup, b: WBSGroup): number => {
        const aStart = a.summaryStartDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const bStart = b.summaryStartDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
        if (aStart !== bStart) return aStart - bStart;
        // If start dates are equal, fall back to alphabetical for consistency
        return a.fullPath.localeCompare(b.fullPath);
    };

    this.wbsGroups.sort(sortByStartDate);
    this.wbsRootGroups.sort(sortByStartDate);

    // Sort children within each group by their start date
    for (const group of this.wbsGroups) {
        group.children.sort(sortByStartDate);
    }

    // Track which levels exist and re-apply any level-based expansion preference
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

private getNextWbsExpandLevel(): number | null {
    if (this.wbsAvailableLevels.length === 0) {
        return null;
    }
    const levels = Array.from(new Set(this.wbsAvailableLevels)).sort((a, b) => a - b);
    const sequence: Array<number> = [0, ...levels]; // collapse -> per-level (no redundant "all")
    const current = this.wbsExpandToLevel ?? (this.wbsExpandedInternal ? levels[levels.length - 1] : 0);
    const idx = sequence.findIndex(l => l === current);
    const nextIdx = idx === -1 ? 0 : (idx + 1) % sequence.length;
    return sequence[nextIdx];
}

private getPreviousWbsExpandLevel(): number | null {
    if (this.wbsAvailableLevels.length === 0) {
        return null;
    }
    const levels = Array.from(new Set(this.wbsAvailableLevels)).sort((a, b) => a - b);
    const sequence: Array<number> = [0, ...levels];
    const current = this.wbsExpandToLevel ?? (this.wbsExpandedInternal ? levels[levels.length - 1] : 0);
    const idx = sequence.findIndex(l => l === current);
    const prevIdx = idx === -1 ? sequence.length - 1 : (idx - 1 + sequence.length) % sequence.length;
    return sequence[prevIdx];
}

private applyWbsExpandLevel(targetLevel: number | null): void {
    // If no groups yet, just store the intent
    if (!this.wbsGroups.length) {
        this.wbsExpandToLevel = targetLevel;
        this.wbsExpandedInternal = targetLevel !== 0;
        return;
    }

    const maxLevel = this.getMaxWbsLevel(); // 0 if no available levels
    const effectiveLevel = targetLevel === null
        ? null
        : Math.min(Math.max(targetLevel, 0), maxLevel);

    this.wbsExpandToLevel = effectiveLevel;
    this.wbsExpandedInternal = effectiveLevel !== 0;

    // BUG-007 FIX: Preserve manually toggled groups while applying level-based states to others
    // Only clear states for non-manually-toggled groups
    for (const group of this.wbsGroups) {
        // If group was manually toggled, preserve its current state
        if (this.wbsManuallyToggledGroups.has(group.id)) {
            // Keep existing state from wbsExpandedState (already set by manual toggle)
            const existingState = this.wbsExpandedState.get(group.id);
            if (existingState !== undefined) {
                group.isExpanded = existingState;
            }
        } else {
            // Apply level-based expansion for non-manually-toggled groups
            const expanded = effectiveLevel === null ? true : group.level <= effectiveLevel;
            group.isExpanded = expanded;
            this.wbsExpandedState.set(group.id, expanded);
        }
    }

    // Update wbsExpandedInternal based on all groups
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
    const targetY = scrollTop + viewportHeight / 2; // aim for middle of viewport

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
        this.scrollPreservationUntil = Date.now() + 500; // guard against retriggers
        this.debugLog(`Global WBS anchor captured: group=${bestGroup.id}, yOrder=${bestGroup.yOrder}, offset=${visualOffset}`);
    } else {
        // Fallback: preserve current scrollTop strictly
        this.preservedScrollTop = scrollTop;
        this.preserveScrollOnUpdate = true;
        this.scrollPreservationUntil = Date.now() + 500;
        this.debugLog("Global WBS anchor fallback: preserving current scrollTop");
    }
}

/**
 * WBS GROUPING: Toggle expansion state for a WBS group
 */
private toggleWbsGroupExpansion(groupId: string): void {
    const group = this.wbsGroupMap.get(groupId);
    if (!group) return;

    // CRITICAL: Clear any pending scroll throttle timeout to prevent it from
    // interfering with the WBS toggle update. Without this, drawVisualElements()
    // would skip rendering if a scroll just happened (scrollThrottleTimeout !== null)
    if (this.scrollThrottleTimeout) {
        clearTimeout(this.scrollThrottleTimeout);
        this.scrollThrottleTimeout = null;
    }

    this.hideTooltip();

    // Before toggling, capture the group's visual position (position relative to viewport)
    // so we can restore it after re-render
    if (this.scrollableContainer?.node() && group.yOrder !== undefined) {
        const scrollTop = this.scrollableContainer.node().scrollTop;
        const groupAbsoluteY = group.yOrder * this.taskElementHeight;
        const visualOffset = groupAbsoluteY - scrollTop;
        this.wbsToggleScrollAnchor = { groupId, visualOffset };
        this.debugLog(`WBS toggle: Capturing anchor for group ${groupId}, yOrder=${group.yOrder}, visualOffset=${visualOffset}`);
    }

    // Switching a single group puts us in manual mode (stop enforcing level-based expansion)
    this.wbsExpandToLevel = undefined;
    this.wbsManualExpansionOverride = true;

    // BUG-007 FIX: Track this group as manually toggled so it's preserved on global level cycling
    this.wbsManuallyToggledGroups.add(groupId);

    group.isExpanded = !group.isExpanded;
    this.wbsExpandedState.set(groupId, group.isExpanded);
    this.wbsExpandedInternal = Array.from(this.wbsGroupMap.values()).some(g => g.isExpanded);

    // Trigger re-render while preserving scroll position
    if (this.lastUpdateOptions) {
        this.forceFullUpdate = true;
        this.preserveScrollOnUpdate = true; // Preserve scroll for individual group expansion
        // Set a 500ms cooldown to prevent scroll reset from Power BI re-triggered updates
        this.scrollPreservationUntil = Date.now() + 500;
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
 * IMPORTANT: This method removes the scroll listener before setting scrollTop to prevent
 * handleScroll() from firing. setupVirtualScroll() will create and attach a NEW listener,
 * so we don't need to re-attach the old one.
 *
 * @param totalSvgHeight - Total height of SVG content for calculating max scroll bounds
 */
private restoreScrollPosition(totalSvgHeight: number): void {
    if (!this.scrollableContainer?.node()) {
        // Clear any pending restoration state
        this.preservedScrollTop = null;
        this.wbsToggleScrollAnchor = null;
        return;
    }

    const containerNode = this.scrollableContainer.node();
    const maxScroll = Math.max(0, totalSvgHeight - containerNode.clientHeight);

    // Remove scroll listener BEFORE setting scrollTop to prevent handleScroll() from firing.
    // setupVirtualScroll() will create and attach a NEW listener after this method returns.
    if (this.scrollListener) {
        this.scrollableContainer.on("scroll", null);
        // Note: We don't null out this.scrollListener here because setupVirtualScroll
        // will check for it and remove it again (harmless), then create a new one.
    }

    // PRIORITY 1: Strict scroll preservation (baseline/previous update toggles)
    // This is used when the row layout doesn't change, only visual elements do.
    if (this.preservedScrollTop !== null) {
        const targetScrollTop = this.preservedScrollTop;
        this.preservedScrollTop = null; // Clear after use

        // Clamp to valid range (content height may have changed due to scale recalculation)
        const clampedScrollTop = Math.max(0, Math.min(targetScrollTop, maxScroll));

        this.debugLog(`Strict scroll restoration: target=${targetScrollTop}, clamped=${clampedScrollTop}, maxScroll=${maxScroll}`);

        containerNode.scrollTop = clampedScrollTop;

        // Force synchronous layout reflow to ensure browser processes the scroll change
        // before setupVirtualScroll calls calculateVisibleTasks()
        void containerNode.scrollTop; // Reading forces reflow

        return; // Strict preservation takes priority, skip WBS anchor
    }

    // PRIORITY 2: WBS anchor-based restoration (WBS group expand/collapse)
    // This is used when expanding/collapsing a WBS group - the clicked group should
    // remain at the same visual position (pixels from top of viewport).
    if (this.wbsToggleScrollAnchor) {
        const { groupId, visualOffset } = this.wbsToggleScrollAnchor;
        this.wbsToggleScrollAnchor = null; // Clear after use

        const group = this.wbsGroupMap.get(groupId);
        if (!group || group.yOrder === undefined) {
            this.debugLog(`WBS scroll anchor: Group ${groupId} not found or no yOrder, skipping`);
            return;
        }

        // Calculate the new absolute Y position of the group header
        const newAbsoluteY = group.yOrder * this.taskElementHeight;

        // Calculate the scroll position that keeps the group at the same visual offset
        // visualOffset = groupAbsoluteY - scrollTop (captured before expansion)
        // newScrollTop = newAbsoluteY - visualOffset (to maintain same visual position)
        const newScrollTop = newAbsoluteY - visualOffset;
        const clampedScrollTop = Math.max(0, Math.min(newScrollTop, maxScroll));

        this.debugLog(`WBS anchor restoration: group=${groupId}, yOrder=${group.yOrder}, ` +
                     `newAbsoluteY=${newAbsoluteY}, visualOffset=${visualOffset}, ` +
                     `newScrollTop=${newScrollTop}, clamped=${clampedScrollTop}, maxScroll=${maxScroll}`);

        containerNode.scrollTop = clampedScrollTop;

        // Force synchronous layout reflow to ensure browser processes the scroll change
        // before setupVirtualScroll calls calculateVisibleTasks()
        void containerNode.scrollTop; // Reading forces reflow
    }
}

/**
 * WBS GROUPING: Check if a task should be visible based on WBS group expansion state
 */
private isTaskVisibleWithWbsGrouping(task: Task): boolean {
    if (!this.wbsDataExists || !this.settings?.wbsGrouping?.enableWbsGrouping?.value) {
        return true; // WBS grouping disabled, show all tasks
    }

    if (!task.wbsGroupId) {
        return true; // Task has no WBS assignment, show it
    }

    // Check if any ancestor group is collapsed
    const parts = task.wbsGroupId.split('|');
    let currentPath = '';

    for (let i = 0; i < parts.length - 1; i++) { // Don't check the task's own group
        currentPath = currentPath ? `${currentPath}|${parts[i]}` : parts[i];
        const group = this.wbsGroupMap.get(currentPath);
        if (group && !group.isExpanded) {
            return false; // Parent group is collapsed, hide task
        }
    }

    return true;
}

/**
 * WBS GROUPING: Apply WBS ordering and filtering to tasks
 * Returns tasks sorted by WBS hierarchy with collapsed groups filtered out
 */
private applyWbsOrdering(tasks: Task[]): Task[] {
    const orderedTasks: Task[] = [];
    const taskSet = new Set(tasks.map(t => t.internalId));

    // Helper to process a group and its children recursively
    const processGroup = (group: WBSGroup): void => {
        if (group.isExpanded) {
            // Process child groups first (sorted alphabetically)
            for (const child of group.children) {
                processGroup(child);
            }

            // Then add direct tasks of this group (only if they're in our input list)
            // Sort by start date within the group
            const directTasks = group.tasks
                .filter(t => taskSet.has(t.internalId))
                .sort((a, b) => (a.startDate?.getTime() ?? 0) - (b.startDate?.getTime() ?? 0));

            for (const task of directTasks) {
                orderedTasks.push(task);
            }
        }
        // If group is collapsed, its tasks and children are not added
    };

    // Process root groups in order
    for (const rootGroup of this.wbsRootGroups) {
        processGroup(rootGroup);
    }

    // Add tasks without WBS assignment at the end (sorted by start date)
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
    // Reset visible counts
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

    // Create a set of filtered task IDs for quick lookup
    const filteredTaskIds = new Set(filteredTasks.map(t => t.internalId));

    // Count tasks that passed filtering (regardless of collapse state)
    for (const task of filteredTasks) {
        if (task.wbsGroupId) {
            const group = this.wbsGroupMap.get(task.wbsGroupId);
            if (group) {
                group.visibleTaskCount++;
            }
        }
    }

    // Recalculate summary dates based on FILTERED tasks only
    // Also calculate critical date ranges for partial highlighting
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

        // Check direct tasks
        for (const task of group.tasks) {
            // Only include tasks that passed filtering
            if (!filteredTaskIds.has(task.internalId)) continue;

            if (task.startDate && (!minStart || task.startDate < minStart)) {
                minStart = task.startDate;
            }
            if (task.finishDate && (!maxFinish || task.finishDate > maxFinish)) {
                maxFinish = task.finishDate;
            }

            // Track critical task date range separately
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

        // Recursively process children
        for (const child of group.children) {
            calculateFilteredSummary(child);
            if (child.hasCriticalTasks) hasCritical = true;
            if (child.summaryStartDate && (!minStart || child.summaryStartDate < minStart)) {
                minStart = child.summaryStartDate;
            }
            if (child.summaryFinishDate && (!maxFinish || child.summaryFinishDate > maxFinish)) {
                maxFinish = child.summaryFinishDate;
            }
            // Merge child critical date ranges
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

    // Calculate filtered summaries for all root groups
    for (const rootGroup of this.wbsRootGroups) {
        calculateFilteredSummary(rootGroup);
    }

    // Propagate counts up the hierarchy
    const propagateCounts = (group: WBSGroup): void => {
        for (const child of group.children) {
            propagateCounts(child);
            group.visibleTaskCount += child.visibleTaskCount;
        }
    };
    for (const rootGroup of this.wbsRootGroups) {
        propagateCounts(rootGroup);
    }

    // Re-sort groups based on the FILTERED summary dates
    // This ensures that in Critical Mode, groups are sorted by the earliest
    // start date of critical tasks, not all tasks
    const sortByFilteredStartDate = (a: WBSGroup, b: WBSGroup): number => {
        const aStart = a.summaryStartDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const bStart = b.summaryStartDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
        if (aStart !== bStart) return aStart - bStart;
        // If start dates are equal, fall back to alphabetical for consistency
        return a.fullPath.localeCompare(b.fullPath);
    };

    // Sort root groups
    this.wbsRootGroups.sort(sortByFilteredStartDate);

    // Sort children within each group
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
    // Reset yOrder for all groups
    for (const group of this.wbsGroups) {
        group.yOrder = undefined;
    }

    // Reset yOrder for ALL tasks to prevent stale values from conflicting with group yOrders
    for (const task of this.allTasksData) {
        task.yOrder = undefined;
    }

    // Note: visibleTaskCount is already set by updateWbsFilteredCounts()
    // It represents tasks that passed filtering, NOT tasks currently shown after collapse/expand
    // This is intentional so that collapsed groups remain visible

    // Create a Set of task IDs from the tasks that will be displayed
    // (This is AFTER collapse/expand has been applied by applyWbsOrdering)
    const visibleTaskIds = new Set(tasksToShow.map(t => t.internalId));

    // Now assign yOrder in a unified sequence
    let currentYOrder = 0;

    // Helper to check if a group should be visible
    const hideEmptyGroups = this.settings?.wbsGrouping?.hideEmptyGroups?.value ?? true;
    const isGroupVisible = (group: WBSGroup): boolean => {
        // If hideEmptyGroups is enabled, hide groups with no visible/filtered tasks
        if (hideEmptyGroups && group.visibleTaskCount === 0) return false;

        // Still hide groups with no tasks at all (regardless of setting)
        if (group.taskCount === 0) return false;

        // Root groups are visible if they have tasks
        if (!group.parentId) return true;

        // Child groups are visible if parent is expanded and visible
        const parent = this.wbsGroupMap.get(group.parentId);
        return parent ? parent.isExpanded && isGroupVisible(parent) : true;
    };

    // Recursive function to assign yOrder to groups and their tasks
    const assignYOrderRecursive = (group: WBSGroup): void => {
        if (!isGroupVisible(group)) return;

        // Assign yOrder to the group header itself
        group.yOrder = currentYOrder++;

        if (group.isExpanded) {
            // Process child groups first
            for (const child of group.children) {
                assignYOrderRecursive(child);
            }

            // Then assign yOrder to direct tasks that are in the visible list
            const directVisibleTasks = group.tasks
                .filter(t => visibleTaskIds.has(t.internalId))
                .sort((a, b) => (a.startDate?.getTime() ?? 0) - (b.startDate?.getTime() ?? 0));

            for (const task of directVisibleTasks) {
                task.yOrder = currentYOrder++;
            }
        }
        // If collapsed, tasks don't get yOrder (they're hidden)
    };

    // Process all root groups
    for (const rootGroup of this.wbsRootGroups) {
        assignYOrderRecursive(rootGroup);
    }

    // Handle tasks without WBS assignment
    const tasksWithoutWbs = tasksToShow
        .filter(t => !t.wbsGroupId)
        .sort((a, b) => (a.startDate?.getTime() ?? 0) - (b.startDate?.getTime() ?? 0));

    for (const task of tasksWithoutWbs) {
        task.yOrder = currentYOrder++;
    }

    this.debugLog(`Assigned yOrder to ${currentYOrder} items (groups + tasks)`);
}

/**
 * WBS GROUPING: Get the ordered list of items to display (groups + tasks)
 * Returns a flat list with groups interleaved with their visible tasks
 */
private getWbsOrderedDisplayItems(): Array<{ type: 'group' | 'task', group?: WBSGroup, task?: Task }> {
    const items: Array<{ type: 'group' | 'task', group?: WBSGroup, task?: Task }> = [];

    if (!this.wbsDataExists || !this.settings?.wbsGrouping?.enableWbsGrouping?.value) {
        // WBS grouping disabled, return just tasks
        for (const task of this.allTasksToShow) {
            items.push({ type: 'task', task });
        }
        return items;
    }

    // Build ordered list with groups and tasks
    const processGroup = (group: WBSGroup, depth: number): void => {
        // Add the group header
        items.push({ type: 'group', group });

        if (group.isExpanded) {
            // Add child groups first (sorted)
            for (const child of group.children) {
                processGroup(child, depth + 1);
            }

            // Add direct tasks of this group (sorted by start date)
            const directTasks = group.tasks
                .filter(t => this.allTasksToShow.includes(t))
                .sort((a, b) => (a.startDate?.getTime() ?? 0) - (b.startDate?.getTime() ?? 0));

            for (const task of directTasks) {
                items.push({ type: 'task', task });
            }
        }
    };

    // Process root groups
    for (const rootGroup of this.wbsRootGroups) {
        processGroup(rootGroup, 0);
    }

    // Add tasks without WBS assignment at the end
    const tasksWithoutWbs = this.allTasksToShow
        .filter(t => !t.wbsGroupId)
        .sort((a, b) => (a.startDate?.getTime() ?? 0) - (b.startDate?.getTime() ?? 0));

    for (const task of tasksWithoutWbs) {
        items.push({ type: 'task', task });
    }

    return items;
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
    if (!this.wbsDataExists || !this.settings?.wbsGrouping?.enableWbsGrouping?.value) {
        // Remove any existing WBS group elements
        this.taskLayer?.selectAll('.wbs-group-header').remove();
        return;
    }

    const showGroupSummary = this.settings.wbsGrouping.showGroupSummary.value;
    const groupHeaderColor = this.settings.wbsGrouping.groupHeaderColor.value.value;
    const groupSummaryColor = this.settings.wbsGrouping.groupSummaryColor.value.value;
    const nearCriticalColor = this.settings.taskAppearance.nearCriticalColor.value.value;
    const indentPerLevel = this.settings.wbsGrouping.indentPerLevel.value;
    const currentLeftMargin = this.settings.layoutSettings.leftMargin.value;
    const taskNameFontSize = this.settings.textAndLabels.taskNameFontSize.value;
    // Get custom group name settings (use taskNameFontSize if groupNameFontSize is 0)
    const groupNameFontSizeSetting = this.settings.wbsGrouping.groupNameFontSize?.value ?? 0;
    const groupNameFontSize = groupNameFontSizeSetting > 0 ? groupNameFontSizeSetting : taskNameFontSize + 1;
    const groupNameColor = this.settings.wbsGrouping.groupNameColor?.value?.value ?? '#333333';
    const criticalPathColor = this.settings.taskAppearance.criticalPathColor.value.value;
    const mode = this.settings?.criticalityMode?.calculationMode?.value?.value || 'longestPath';
    const showNearCriticalSummary = this.showNearCritical && this.floatThreshold > 0 && mode === 'floatBased';
    const showBaseline = this.showBaselineInternal;
    const showPreviousUpdate = this.showPreviousUpdateInternal;
    const baselineColor = this.settings.taskAppearance.baselineColor.value.value;
    const baselineHeight = this.settings.taskAppearance.baselineHeight.value;
    const baselineOffset = this.settings.taskAppearance.baselineOffset.value;
    const previousUpdateColor = this.settings.taskAppearance.previousUpdateColor.value.value;
    const previousUpdateHeight = this.settings.taskAppearance.previousUpdateHeight.value;
    const previousUpdateOffset = this.settings.taskAppearance.previousUpdateOffset.value;

    // Create a separate layer for WBS headers if it doesn't exist
    // Insert AFTER gridLayer so WBS headers appear on top of gridlines
    if (!this.wbsGroupLayer) {
        this.wbsGroupLayer = this.mainGroup.insert('g', '.arrow-layer')
            .attr('class', 'wbs-group-layer');
    }

    // Clear existing headers
    this.wbsGroupLayer.selectAll('.wbs-group-header').remove();

    const self = this;

    // Draw each group that has a yOrder assigned and is within the visible viewport
    for (const group of this.wbsGroups) {
        // Skip groups without yOrder (they're not visible)
        if (group.yOrder === undefined) continue;

        // If viewport range is provided, only render groups within the visible range
        if (viewportStartIndex !== undefined && viewportEndIndex !== undefined) {
            if (group.yOrder < viewportStartIndex || group.yOrder > viewportEndIndex) {
                continue;
            }
        }

        // Get Y position from the group's own yOrder
        // yScale returns the START of the band, so we need to position elements within the band
        const domainKey = group.yOrder.toString();
        const bandStart = yScale(domainKey);

        if (bandStart === undefined) continue; // Safety check

        // Calculate center of band for positioning (same as tasks)
        const bandCenter = bandStart + taskHeight / 2;

        const indent = (group.level - 2) * indentPerLevel;
        const headerGroup = this.wbsGroupLayer.append('g')
            .attr('class', 'wbs-group-header')
            .attr('data-group-id', group.id)
            .style('cursor', 'pointer');

        // Background rectangle will be sized after text is rendered to accommodate wrapping
        const bgOpacity = (group.visibleTaskCount === 0) ? 0.4 : 0.8;

        // Summary bar - DRAW FIRST so it appears BEHIND the text (SVG z-order)
        // Show summary bar when group is collapsed and has tasks (even if filtered)
        if (!group.isExpanded && showGroupSummary && group.taskCount > 0 &&
            group.summaryStartDate && group.summaryFinishDate) {
            const startX = xScale(group.summaryStartDate);
            const finishX = xScale(group.summaryFinishDate);
            const barWidth = Math.max(2, finishX - startX);
            const barHeight = taskHeight * 0.6; // Make it 60% of task height for better visibility
            const barY = bandCenter - barHeight / 2; // Center bar within the band

            // Dim the bar if all tasks are filtered out
            const barOpacity = (group.visibleTaskCount === 0) ? 0.4 : 0.8;

            // Previous update summary bar (mirrors task-level behavior)
            if (showPreviousUpdate &&
                group.summaryPreviousUpdateStartDate && group.summaryPreviousUpdateFinishDate &&
                group.summaryPreviousUpdateFinishDate >= group.summaryPreviousUpdateStartDate) {
                const prevStartX = xScale(group.summaryPreviousUpdateStartDate);
                const prevFinishX = xScale(group.summaryPreviousUpdateFinishDate);
                const prevWidth = Math.max(2, prevFinishX - prevStartX);
                const prevY = barY + barHeight + previousUpdateOffset;

                headerGroup.append('rect')
                    .attr('class', 'wbs-summary-bar-previous-update')
                    .attr('x', prevStartX)
                    .attr('y', prevY)
                    .attr('width', prevWidth)
                    .attr('height', previousUpdateHeight)
                    .attr('rx', 3)
                    .attr('ry', 3)
                    .style('fill', previousUpdateColor)
                    .style('opacity', barOpacity);
            }

            // Baseline summary bar (mirrors task-level behavior)
            if (showBaseline &&
                group.summaryBaselineStartDate && group.summaryBaselineFinishDate &&
                group.summaryBaselineFinishDate >= group.summaryBaselineStartDate) {
                const baselineStartX = xScale(group.summaryBaselineStartDate);
                const baselineFinishX = xScale(group.summaryBaselineFinishDate);
                const baselineWidth = Math.max(2, baselineFinishX - baselineStartX);
                const baselineY = barY + barHeight +
                    (showPreviousUpdate ? previousUpdateHeight + previousUpdateOffset : 0) +
                    baselineOffset;

                headerGroup.append('rect')
                    .attr('class', 'wbs-summary-bar-baseline')
                    .attr('x', baselineStartX)
                    .attr('y', baselineY)
                    .attr('width', baselineWidth)
                    .attr('height', baselineHeight)
                    .attr('rx', 3)
                    .attr('ry', 3)
                    .style('fill', baselineColor)
                    .style('opacity', barOpacity);
            }

            // Draw the base (non-critical) summary bar
            headerGroup.append('rect')
                .attr('class', 'wbs-summary-bar')
                .attr('x', startX)
                .attr('y', barY)
                .attr('width', barWidth)
                .attr('height', barHeight)
                .attr('rx', 3)
                .attr('ry', 3)
                .style('fill', groupSummaryColor)
                .style('opacity', barOpacity);

            // Highlight near-critical portion when applicable (Float-Based mode, threshold > 0)
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

                    headerGroup.append('rect')
                        .attr('class', 'wbs-summary-bar-near-critical')
                        .attr('x', nearStartX)
                        .attr('y', barY)
                        .attr('width', nearWidth)
                        .attr('height', barHeight)
                        .attr('rx', (nearStartsAtBeginning || nearEndsAtEnd) ? 3 : 0)
                        .attr('ry', (nearStartsAtBeginning || nearEndsAtEnd) ? 3 : 0)
                        .style('fill', nearCriticalColor)
                        .style('opacity', barOpacity);
                }
            }

            // If there are critical tasks, overlay the critical portion in red
            if (group.hasCriticalTasks && group.criticalStartDate && group.criticalFinishDate) {
                const criticalStartX = xScale(group.criticalStartDate);
                const criticalFinishX = xScale(group.criticalFinishDate);
                const criticalWidth = Math.max(2, criticalFinishX - criticalStartX);

                // Determine if we need rounded corners on each end
                // Left rounded if critical starts at or before summary start
                // Right rounded if critical ends at or after summary finish
                const criticalStartsAtBeginning = criticalStartX <= startX + 1;
                const criticalEndsAtEnd = criticalFinishX >= finishX - 1;

                headerGroup.append('rect')
                    .attr('class', 'wbs-summary-bar-critical')
                    .attr('x', criticalStartX)
                    .attr('y', barY)
                    .attr('width', criticalWidth)
                    .attr('height', barHeight)
                    .attr('rx', (criticalStartsAtBeginning || criticalEndsAtEnd) ? 3 : 0)
                    .attr('ry', (criticalStartsAtBeginning || criticalEndsAtEnd) ? 3 : 0)
                    .style('fill', criticalPathColor)
                    .style('opacity', barOpacity);
            }
        }

        // Expand/collapse indicator
        const expandIcon = group.isExpanded ? '\u25BC' : '\u25B6'; // ▼ or ▶
        const iconColor = (group.visibleTaskCount === 0) ? '#999' : '#333';

        headerGroup.append('text')
            .attr('class', 'wbs-expand-icon')
            .attr('x', -currentLeftMargin + indent + 8)
            .attr('y', bandCenter - 2)
            .style('font-size', `${taskNameFontSize}px`)
            .style('font-family', 'Segoe UI, sans-serif')
            .style('fill', iconColor)
            .text(expandIcon);

        // Group name with task count (show visible vs total if different)
        let displayName: string;
        if (group.isExpanded) {
            // When expanded, show name only or visible count if filtered
            if (group.visibleTaskCount === 0) {
                displayName = `${group.name} (all ${group.taskCount} tasks filtered)`;
            } else if (group.visibleTaskCount < group.taskCount) {
                displayName = `${group.name} (${group.visibleTaskCount}/${group.taskCount} visible)`;
            } else {
                displayName = group.name;
            }
        } else {
            // When collapsed, show total task count
            if (group.visibleTaskCount === 0) {
                displayName = `${group.name} (${group.taskCount} tasks - all filtered)`;
            } else if (group.visibleTaskCount < group.taskCount) {
                displayName = `${group.name} (${group.visibleTaskCount}/${group.taskCount} tasks)`;
            } else {
                displayName = `${group.name} (${group.taskCount} tasks)`;
            }
        }

        // Determine text color based on visibility (use custom groupNameColor, dimmed if no visible tasks)
        const textColor = (group.visibleTaskCount === 0) ? '#999' : groupNameColor;
        const textOpacity = (group.visibleTaskCount === 0) ? 0.6 : 1.0;

        // Calculate available width for group name text (with wrapping)
        const textX = -currentLeftMargin + indent + 22;
        const textY = bandCenter; // Center text within the band (same as tasks)
        const availableWidth = currentLeftMargin - indent - 30; // Leave some padding
        const lineHeight = '1.1em';
        const maxLines = 2;

        const textElement = headerGroup.append('text')
            .attr('class', 'wbs-group-name')
            .attr('x', textX)
            .attr('y', textY)
            .attr('dominant-baseline', 'central')
            .style('font-size', `${groupNameFontSize}px`)
            .style('font-family', 'Segoe UI, sans-serif')
            .style('font-weight', '600')
            .style('fill', textColor)
            .style('opacity', textOpacity);

        // Apply text wrapping similar to task names
        const words = displayName.split(/\s+/).reverse();
        let word: string | undefined;
        let line: string[] = [];
        let firstTspan = textElement.text(null).append('tspan')
            .attr('x', textX)
            .attr('y', textY)
            .attr('dy', '0em');
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
                        // Truncate with ellipsis on last line
                        const currentText = tspan.text();
                        if (currentText.length > 3) {
                            tspan.text(currentText.slice(0, -3) + '...');
                        }
                        break;
                    }
                }
            } catch (e) {
                // Fallback if getComputedTextLength fails
                tspan.text(line.join(' '));
                break;
            }
        }

        // If text wrapped to 2 lines, adjust first line up to center the text block
        if (lineCount > 1) {
            firstTspan.attr('dy', '-0.55em');
        }

        // Now draw the background rectangle sized to accommodate the text
        // Calculate height based on whether text wrapped to 2 lines
        const lineHeightPx = groupNameFontSize * 1.1;
        const bgHeight = lineCount > 1 ? taskHeight + lineHeightPx : taskHeight + 4;
        // Position background to cover the band, centered around bandCenter
        const bgY = bandCenter - bgHeight / 2;

        // Insert background at the beginning of the group so it's behind everything
        headerGroup.insert('rect', ':first-child')
            .attr('class', 'wbs-header-bg')
            .attr('x', -currentLeftMargin + indent)
            .attr('y', bgY)
            .attr('width', currentLeftMargin - indent - 5)
            .attr('height', bgHeight)
            .style('fill', groupHeaderColor)
            .style('opacity', bgOpacity);

        // Click handler for expand/collapse
        headerGroup.on('click', function() {
            self.hideTooltip();
            self.toggleWbsGroupExpansion(group.id);
        });
    }
}

    // Helper method to detect possible date values
    private mightBeDate(value: PrimitiveValue): boolean {
        // If already a Date, then it's a date
        if (value instanceof Date) return true;
        
        // Check if string has date-like format
        if (typeof value === 'string') {
            // Check for ISO date formats or common date separators
            return /^\d{4}-\d{1,2}-\d{1,2}|^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}/.test(value);
        }
        
        // Check if number might be a timestamp (milliseconds since epoch)
        if (typeof value === 'number') {
            // Very rough check: timestamps typically have 10+ digits for ms since epoch
            // This is a simplistic check - could be refined further
            return value > 946684800000; // Jan 1, 2000 as Unix timestamp (in ms)
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
    
    // Mode-specific validation
    const mode = this.settings?.criticalityMode?.calculationMode?.value?.value || 'longestPath';
    const hasDuration = this.hasDataRole(dataView, 'duration');
    const hasTotalFloat = this.hasDataRole(dataView, 'taskTotalFloat');
    const hasTaskFreeFloat = this.hasDataRole(dataView, 'taskFreeFloat');

    let isValid = true;
    if (!hasId) { 
        console.warn("validateDataView: Missing 'taskId' data role."); 
        isValid = false; 
    }
    
    if (mode === 'floatBased') {
        // Float-Based mode: BOTH total float and task free float are required
        if (!hasTotalFloat) { 
            console.warn("validateDataView: Float-Based mode requires 'taskTotalFloat' data role for criticality."); 
            isValid = false; 
        }
    } else {
        // Longest Path mode: duration is required
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

        try { // Wrap parsing attempts in try-catch
            if (dateValue instanceof Date) {
                if (!isNaN(dateValue.getTime())) date = dateValue;
            }
            else if (typeof dateValue === 'string') {
                let dateStrToParse = dateValue.trim();
                if (dateStrToParse) {
                    // ISO 8601 or RFC 2822 are more reliably parsed by Date.parse
                    const parsedTimestamp = Date.parse(dateStrToParse);
                    if (!isNaN(parsedTimestamp)) date = new Date(parsedTimestamp);

                    // Fallback: try direct new Date() (less reliable for ambiguous formats)
                    if (!date) {
                        date = new Date(dateStrToParse);
                        if (isNaN(date.getTime())) date = null;
                    }
                }
            }
            else if (typeof dateValue === 'number') {
                 const num = dateValue;
                 if (!isNaN(num) && isFinite(num)) {
                     // Check for Excel Date Serial Number (Windows epoch: Dec 30 1899)
                     // 25569 is days between 1900-01-01 and 1970-01-01 (Unix epoch)
                     // Excel incorrectly treats 1900 as a leap year, need to adjust if date <= Feb 28 1900
                     if (num > 0 && num < 60) { // Handle potential dates near Excel Epoch start carefully
                        // Excel's "day 1" is Dec 31, 1899 (interpreted as Jan 1, 1900)
                        // Excel's "day 60" is Feb 29, 1900 (incorrect leap day)
                        // For simplicity, we'll assume standard Excel serial after day 60
                     } else if (num >= 61 && num < 2958466) { // Approx year 9999
                         // Convert Excel serial date (days since Dec 30, 1899) to Unix timestamp (milliseconds since Jan 1, 1970)
                         date = new Date(Math.round((num - 25569) * 86400 * 1000));
                     }
                     // Check for plausible Unix Timestamp (ms) - typical range
                     else if (num > 631152000000 && num < Date.now() + 3153600000000 * 20) { // Allow 20 years future
                         date = new Date(num);
                     }
                     // Check for Unix Timestamp (seconds) - convert to ms
                     else if (num > 631152000 && num < (Date.now() / 1000) + 31536000 * 20) {
                         date = new Date(num * 1000);
                     }

                     if (date && isNaN(date.getTime())) date = null; // Validate resulting date
                 }
            }
        } catch (e) {
             date = null; // Ensure date is null on any parsing error
             console.warn(`Error parsing date value: "${String(dateValue)}"`, e);
        }


        if (!date) {
            // console.warn(`Could not parse date value: "${String(dateValue)}" (Type: ${typeof dateValue}).`);
        }
        return date;
    }

    private formatDate(date: Date | null | undefined): string {
        if (!date || !(date instanceof Date) || isNaN(date.getTime())) return "";
        try {
            // Use a specific, unambiguous format if locale causes issues
            // return date.toLocaleDateString(); // Use locale-sensitive format
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0'); // Month is 0-indexed
            const year = date.getFullYear();
            return `${day}/${month}/${year}`; // Example: DD/MM/YYYY
        } catch (e) {
            console.error("Error formatting date:", e);
            return "Invalid Date";
        }
    }


    private limitTasks(tasksToFilter: Task[], maxTasks: number): Task[] {
        const effectiveMaxTasks = (!isNaN(maxTasks) && maxTasks > 0) ? Math.floor(maxTasks) : this.defaultMaxTasks;

        if (tasksToFilter.length <= effectiveMaxTasks) {
            return [...tasksToFilter];
        }

        this.debugLog(`Limiting tasks shown from ${tasksToFilter.length} to ${effectiveMaxTasks}`);

        // Create a map to preserve original order from tasksToFilter
        const originalIndexMap = new Map<string, number>();
        tasksToFilter.forEach((task, index) => {
            originalIndexMap.set(task.internalId, index);
        });

        const tasksToShow: Task[] = [];
        const shownTaskIds = new Set<string>();
    
        // Always include first task
        if (tasksToFilter.length > 0) {
            const firstTask = tasksToFilter[0];
            tasksToShow.push(firstTask);
            shownTaskIds.add(firstTask.internalId);
        }
    
        // Always include last task (if different and space permits)
        if (tasksToFilter.length > 1 && tasksToShow.length < effectiveMaxTasks) {
            const lastTask = tasksToFilter[tasksToFilter.length - 1];
            if (!shownTaskIds.has(lastTask.internalId)) {
                tasksToShow.push(lastTask);
                shownTaskIds.add(lastTask.internalId);
            }
        }
    
        // Get tasks not yet included (excluding first/last)
        const remainingTasks = tasksToFilter.slice(1, -1).filter(task => !shownTaskIds.has(task.internalId));
    
        // Prioritize critical tasks
        let slotsAvailable = effectiveMaxTasks - tasksToShow.length;
        if (slotsAvailable > 0) {
            const criticalTasks = remainingTasks.filter(task => task.isCritical);
            const criticalToAdd = criticalTasks.slice(0, slotsAvailable);
            criticalToAdd.forEach(task => {
                tasksToShow.push(task);
                shownTaskIds.add(task.internalId);
            });
        }
        
        // Prioritize near-critical tasks (NEW)
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
    
        // Prioritize milestones (non-critical and non-near-critical ones)
        slotsAvailable = effectiveMaxTasks - tasksToShow.length;
        if (slotsAvailable > 0) {
             const milestones = remainingTasks.filter(task =>
                 !shownTaskIds.has(task.internalId) && // Not already added
                 (task.type === 'TT_Mile' || task.type === 'TT_FinMile')
             );
             const milestonesToAdd = milestones.slice(0, slotsAvailable);
             milestonesToAdd.forEach(milestone => {
                 tasksToShow.push(milestone);
                 shownTaskIds.add(milestone.internalId);
             });
        }
    
        // Fill remaining slots with sampled regular tasks
        slotsAvailable = effectiveMaxTasks - tasksToShow.length;
        if (slotsAvailable > 0) {
            const regularTasks = remainingTasks.filter(task => !shownTaskIds.has(task.internalId));
    
            if (regularTasks.length > 0) {
                if (regularTasks.length <= slotsAvailable) {
                    regularTasks.forEach(task => { tasksToShow.push(task); shownTaskIds.add(task.internalId); });
                } else {
                    // Sample evenly
                    const step = Math.max(1, regularTasks.length / slotsAvailable);
                    for (let i = 0; i < slotsAvailable && tasksToShow.length < effectiveMaxTasks; i++) {
                        const index = Math.min(regularTasks.length - 1, Math.floor(i * step));
                        const taskToAdd = regularTasks[index];
                        if (!shownTaskIds.has(taskToAdd.internalId)) {
                            tasksToShow.push(taskToAdd);
                            shownTaskIds.add(taskToAdd.internalId);
                        } else {
                            // Find next available if sampled one was already added
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
    
        // Re-sort the final limited set to preserve the original order from tasksToFilter
        tasksToShow.sort((a, b) => {
            const indexA = originalIndexMap.get(a.internalId) ?? Infinity;
            const indexB = originalIndexMap.get(b.internalId) ?? Infinity;
            return indexA - indexB;
        });

        this.debugLog(`Final limited task count: ${tasksToShow.length}`);
        return tasksToShow;
    }

    private applyTaskFilter(taskIds: (string | number)[]): void {
        if (!this.taskIdTable || !this.taskIdColumn) return;

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
    }

private displayMessage(message: string): void {
    this.debugLog("Displaying Message:", message);
    
    // Clear any active cross-filters when showing error messages
    this.applyTaskFilter([]); // ← ADDED THIS LINE FOR EXTRA SAFETY
    
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
        .style("fill", "#777777")
        .style("font-size", "14px")
        .style("font-weight", "bold")
        .text(message);

    const viewportWidth = this.lastUpdateOptions?.viewport.width || width;
    this.createOrUpdateToggleButton(viewportWidth);
    this.drawHeaderDivider(viewportWidth);
}

private createTaskSelectionDropdown(): void {
    if (!this.dropdownContainer || !this.selectedTaskLabel) {
        console.warn("Dropdown elements not ready.");
        return;
    }

    const enableTaskSelection = this.settings.taskSelection.enableTaskSelection.value;
    const viewportWidth = this.lastUpdateOptions?.viewport?.width || 800;
    const secondRowLayout = this.getSecondRowLayout(viewportWidth);
    const dropdownWidth = secondRowLayout.dropdown.width;
    const showSelectedTaskLabel = this.settings.taskSelection.showSelectedTaskLabel.value;

    // Show/hide dropdown based on settings
    this.dropdownContainer.style("display", enableTaskSelection ? "block" : "none");
    if (!enableTaskSelection) {
        this.selectedTaskLabel.style("display", "none");
        return;
    }

    // Remove existing input and list to recreate them
    this.dropdownContainer.selectAll("*").remove();

    // Position in second row of header - below the first row of toggles (responsive)
    this.dropdownContainer
        .style("position", "absolute")
        .style("top", "44px")    // Below first row (standard height 32px + spacing 12px)
        .style("left", `${secondRowLayout.dropdown.left}px`)   // Responsive alignment
        .style("right", "auto")
        .style("transform", "none")
        .style("z-index", "20");

    // Create the input with unified professional styling
    this.dropdownInput = this.dropdownContainer.append("input")
        .attr("type", "text")
        .attr("class", "task-selection-input")
        .attr("placeholder", "Search for a task...")
        .style("width", `${dropdownWidth}px`)
        .style("height", `${this.UI_TOKENS.height.standard}px`)  // Match standard height
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

    // Add focus effects with unified design
    const selfRef = this;
    this.dropdownInput
        .on("focus", function() {
            d3.select(this)
                .style("border-color", selfRef.UI_TOKENS.color.primary.default)
                .style("border-width", "2px")
                .style("box-shadow", selfRef.UI_TOKENS.shadow[4]);
        })
        .on("blur", function() {
            d3.select(this)
                .style("border-color", selfRef.UI_TOKENS.color.neutral.grey60)
                .style("border-width", "1.5px")
                .style("box-shadow", selfRef.UI_TOKENS.shadow[2]);
        });

    // Create dropdown list with unified professional styling
    this.dropdownList = this.dropdownContainer.append("div")
        .attr("class", "task-selection-list")
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

    // Rest of the method remains the same...
    const self = this;
    
    // Input event handlers
    this.dropdownInput
        .on("input", function() {
            const inputValue = (this as HTMLInputElement).value.trim();
            self.filterTaskDropdown(inputValue);
            
            // Show dropdown when typing
            if (self.dropdownList) {
                self.dropdownList.style("display", "block");
            }
        })
        .on("focus", function() {
            self.dropdownList.style("display", "block");
            self.populateTaskDropdown();
            
            // Disable pointer events on the trace toggle while dropdown is open
            self.stickyHeaderContainer?.selectAll(".trace-mode-toggle")
                .style("pointer-events", "none");
        })
        .on("blur", function() {
            // Delay hiding to allow click events on dropdown items
            setTimeout(() => {
                if (self.dropdownList) {
                    self.dropdownList.style("display", "none");
                }
                // Re-enable trace toggle
                self.stickyHeaderContainer?.selectAll(".trace-mode-toggle")
                    .style("pointer-events", "auto");
            }, 200);
        })
        .on("keydown", function(event: KeyboardEvent) {
            if (event.key === "Escape") {
                self.selectTask(null, null);
                self.dropdownInput.property("value", "");
                self.dropdownList.style("display", "none");
                
                // Re-enable trace toggle
                self.stickyHeaderContainer?.selectAll(".trace-mode-toggle")
                    .style("pointer-events", "auto");
                
                event.preventDefault();
            }
        });

    // Populate the dropdown with current value if selected
    if (this.selectedTaskId && this.selectedTaskName) {
        this.dropdownInput.property("value", this.selectedTaskName);
    }
    
    // Update selected task label visibility (keep this on the right)
    if (this.selectedTaskLabel) {
        // Selected task label stays on the right side
        this.selectedTaskLabel
            .style("position", "absolute")
            .style("top", "10px")
            .style("right", "15px")
            .style("left", "auto");
            
        if (this.selectedTaskId && this.selectedTaskName && showSelectedTaskLabel) {
            this.selectedTaskLabel
                .style("display", "block")
                .text(`Selected: ${this.selectedTaskName}`);
        } else {
            this.selectedTaskLabel.style("display", "none");
        }
    }
}

/**
 * Populates the task dropdown with tasks from the dataset
 */
private populateTaskDropdown(): void {
    if (!this.dropdownList) {
        console.warn("Dropdown list not initialized");
        return;
    }
    
    if (this.allTasksData.length === 0) {
        console.warn("No tasks available to populate dropdown");
        // Show "No tasks available" message
        this.dropdownList.selectAll("*").remove();
        this.dropdownList.append("div")
            .attr("class", "dropdown-item no-data")
            .text("No tasks available")
            .style("padding", "8px 10px")
            .style("color", "#999")
            .style("font-style", "italic")
            .style("font-size", "11px")
            .style("font-family", "Segoe UI, sans-serif");
        return;
    }
    
    // Clear existing items
    this.dropdownList.selectAll("*").remove();

    // Filter out synthetic tasks (predecessor-only tasks without proper data)
    // and sort remaining tasks by name for better usability
    const realTasks = this.allTasksData.filter(task => task.type !== "Synthetic");
    const sortedTasks = [...realTasks].sort((a, b) =>
        (a.name || "").localeCompare(b.name || ""));

    const self = this;
    
    // Add "Clear Selection" option FIRST (at the top)
    const clearOption = this.dropdownList.append("div")
        .attr("class", "dropdown-item clear-selection")
        .style("padding", "8px 10px")
        .style("cursor", "pointer")
        .style("color", "#666")
        .style("font-style", "italic")
        .style("border-bottom", "1px solid #eee")
        .style("font-size", "10px")
        .style("font-family", "Segoe UI, sans-serif")
        .style("background-color", "white")
        .text("× Clear Selection");
    
    clearOption
        .on("mouseover", function() {
            d3.select(this).style("background-color", "#f0f0f0");
        })
        .on("mouseout", function() {
            d3.select(this).style("background-color", "white");
        })
        .on("mousedown", function() {
            // Use mousedown instead of click to fire before blur
            event?.preventDefault();
            event?.stopPropagation();
            self.selectTask(null, null);
            self.dropdownInput.property("value", "");
            self.dropdownList.style("display", "none");
            
            // Re-enable trace toggle
            self.stickyHeaderContainer?.selectAll(".trace-mode-toggle")
                .style("pointer-events", "auto");
        });
    
    // Create dropdown items for tasks (synthetic tasks already filtered out)
    sortedTasks.forEach(task => {
        const taskName = task.name || `Task ${task.internalId}`;
        const item = this.dropdownList.append("div")
            .attr("class", "dropdown-item")
            .attr("data-task-id", task.internalId)
            .attr("data-task-name", taskName)
            .attr("title", taskName)
            .style("padding", "6px 10px")
            .style("cursor", "pointer")
            .style("border-bottom", "1px solid #f5f5f5")
            .style("white-space", "normal")
            .style("word-wrap", "break-word")
            .style("overflow-wrap", "break-word")
            .style("line-height", "1.4")
            .style("font-size", "11px")
            .style("font-family", "Segoe UI, sans-serif")
            .style("background-color", task.internalId === self.selectedTaskId ? "#f0f0f0" : "white")
            .style("font-weight", task.internalId === self.selectedTaskId ? "600" : "normal")
            .text(taskName);
        
        // Add hover effects
        item.on("mouseover", function() {
            d3.select(this).style("background-color", "#e6f7ff");
        });
        
        item.on("mouseout", function() {
            d3.select(this).style("background-color", 
                task.internalId === self.selectedTaskId ? "#f0f0f0" : "white");
        });
        
        // Use mousedown instead of click to fire before blur
        item.on("mousedown", function() {
            event?.preventDefault();
            event?.stopPropagation();
            self.selectTask(task.internalId, task.name);
            self.dropdownInput.property("value", taskName);
            self.dropdownList.style("display", "none");
            
            // Re-enable trace toggle
            self.stickyHeaderContainer?.selectAll(".trace-mode-toggle")
                .style("pointer-events", "auto");
        });
    });
    
    this.debugLog(`Populated dropdown with ${sortedTasks.length} tasks plus clear option`);
}

/**
 * Creates an interactive margin resizer that allows users to drag and adjust
 * the left margin width between task descriptions and gantt bars
 *
 * CRITICAL: This must be called AFTER mainSvg has been sized with .attr("height", totalSvgHeight)
 *
 * IMPLEMENTATION: Uses SVG rect element so it scrolls with the gantt chart content
 * and never appears in the sticky header area
 */
private createMarginResizer(): void {
    // Remove any existing resizer from SVG
    this.mainSvg.selectAll(".margin-resizer-group").remove();

    // Get the actual SVG height - this determines where gantt bars are rendered
    const svgHeight = this.mainSvg ? parseFloat(this.mainSvg.attr("height")) || 0 : 0;

    if (svgHeight === 0) {
        // SVG not sized yet, skip creating resizer
        this.debugLog("Skipping resizer creation - SVG height is 0");
        return;
    }

    // The gantt bars are rendered in mainGroup which is translated by margin.top
    // Calculate the height of the gantt bar area
    const resizerHeight = svgHeight - this.margin.top - this.margin.bottom;

    if (resizerHeight <= 0) {
        this.debugLog("Skipping resizer creation - calculated height <= 0");
        return;
    }

    this.debugLog(`Creating SVG resizer: height=${resizerHeight}px, svgHeight=${svgHeight}px`);

    // Create a group for the resizer within mainSvg (so it scrolls with content)
    const resizerGroup = this.mainSvg.append("g")
        .attr("class", "margin-resizer-group")
        .attr("transform", `translate(0, ${this.margin.top})`)  // Position after date axis
        .style("cursor", "col-resize");

    // Create an invisible wide rect for easy grabbing (8px wide)
    const interactionRect = resizerGroup.append("rect")
        .attr("class", "margin-resizer-interaction")
        .attr("x", 0)  // Will be positioned by updateMarginResizerPosition
        .attr("y", 0)
        .attr("width", 8)
        .attr("height", resizerHeight)
        .attr("fill", "transparent")
        .style("cursor", "col-resize")
        .style("pointer-events", "all");

    // Create the visible 2px line
    const visibleLine = resizerGroup.append("rect")
        .attr("class", "margin-resizer-line")
        .attr("x", 3)  // Center within the 8px interaction zone
        .attr("y", 0)
        .attr("width", 2)
        .attr("height", resizerHeight)
        .attr("fill", this.UI_TOKENS.color.neutral.grey60)
        .style("pointer-events", "none")  // Let parent handle events
        .style("transition", `fill ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

    // Store reference to the group for later updates
    this.marginResizer = resizerGroup as any;

    // Position the resizer horizontally
    this.updateMarginResizerPosition();

    // Add hover effect (SVG attributes instead of CSS)
    const self = this;
    this.marginResizer
        .on("mouseenter", function() {
            d3.select(this).select(".margin-resizer-line")
                .attr("fill", self.UI_TOKENS.color.primary.default)
                .attr("width", 3);  // Make slightly wider on hover
        })
        .on("mouseleave", function() {
            d3.select(this).select(".margin-resizer-line")
                .attr("fill", self.UI_TOKENS.color.neutral.grey60)
                .attr("width", 2);
        });

    // Add drag behavior with proper coordinate handling and real-time visual updates
    // BUG-008 FIX: Use class property instead of local variable to track drag state
    let lastDragTime = 0;
    const dragThrottleMs = 50; // Throttle redraws to every 50ms for performance

    const drag = d3.drag<SVGGElement, unknown>()
        .on("start", function(event) {
            self.isMarginDragging = true; // BUG-008 FIX: Set class property
            lastDragTime = 0; // Reset throttle timer
            d3.select(this).select(".margin-resizer-line")
                .attr("fill", self.UI_TOKENS.color.primary.pressed)
                .attr("width", 4);
        })
        .on("drag", function(event) {
            if (!self.isMarginDragging) return; // BUG-008 FIX: Check class property

            // Get the SVG bounds for coordinate calculation
            const svgNode = self.mainSvg.node();
            if (!svgNode) return;

            const svgRect = svgNode.getBoundingClientRect();

            // Calculate the new left margin based on mouse position relative to SVG
            const mouseX = event.sourceEvent.clientX - svgRect.left;
            const newLeftMargin = Math.max(50, Math.min(600, mouseX));

            // Update the setting value
            self.settings.layoutSettings.leftMargin.value = newLeftMargin;

            // Update the margin immediately
            self.margin.left = newLeftMargin;

            // Throttle redraws for performance
            const now = Date.now();
            if (now - lastDragTime >= dragThrottleMs) {
                lastDragTime = now;

                // Use lightweight margin update that preserves drag state
                self.handleMarginDragUpdate(newLeftMargin);
            } else {
                // Between throttled updates, just update transforms for smooth movement
                if (self.mainGroup) {
                    self.mainGroup.attr("transform", `translate(${self.margin.left}, ${self.margin.top})`);
                }
                if (self.headerGridLayer) {
                    self.headerGridLayer.attr("transform", `translate(${self.margin.left}, 0)`);
                }
                self.updateMarginResizerPosition();
            }
        })
        .on("end", function(event) {
            self.isMarginDragging = false; // BUG-008 FIX: Clear class property
            d3.select(this).select(".margin-resizer-line")
                .attr("fill", self.UI_TOKENS.color.primary.default)
                .attr("width", 3);

            // Persist the new margin value to Power BI settings
            // Power BI will trigger an update when the persist completes, so we don't call update() here
            // This prevents the snap-back effect where update() reads the old value before persist completes
            self.host.persistProperties({
                merge: [{
                    objectName: "layoutSettings",
                    properties: { leftMargin: self.settings.layoutSettings.leftMargin.value },
                    selector: null
                }]
            });

            // Don't call update() here - let Power BI trigger it after persistProperties completes
            // The visual is already in the correct state from handleMarginDragUpdate()
        });

    this.marginResizer.call(drag as any);
}

/**
 * Updates the position of the SVG margin resizer based on current settings
 */
private updateMarginResizerPosition(): void {
    if (!this.marginResizer || !this.settings) return;

    const leftMargin = this.settings.layoutSettings.leftMargin.value;

    // Position both the interaction rect and visible line at the margin boundary
    // The group is already translated to (0, margin.top), so we only set x position
    this.marginResizer.select(".margin-resizer-interaction")
        .attr("x", leftMargin - 4);  // -4 to center the 8px wide zone on the margin line

    this.marginResizer.select(".margin-resizer-line")
        .attr("x", leftMargin - 1);  // -1 to center the 2px line on the margin
}

/**
 * Creates the Trace Mode Toggle (Backward/Forward) with professional design
 * UPGRADED: Enhanced visuals, better button design, smoother animations, refined styling
 */
private createTraceModeToggle(): void {
    this.stickyHeaderContainer.selectAll(".trace-mode-toggle").remove();

    if (!this.settings.taskSelection.enableTaskSelection.value) return;

    // HIDE the toggle completely when no task is selected (instead of graying out)
    if (!this.selectedTaskId) return;

    // Get responsive layout position
    const viewportWidth = this.lastUpdateOptions?.viewport?.width || 800;
    const secondRowLayout = this.getSecondRowLayout(viewportWidth);

    const toggleContainer = this.stickyHeaderContainer.append("div")
        .attr("class", "trace-mode-toggle")
        .style("position", "absolute")
        .style("top", "44px")  // Align with task dropdown in second row
        .style("left", `${secondRowLayout.traceModeToggle.left}px`)  // Responsive position
        .style("z-index", "20");

    const isDisabled = false;  // Never disabled since we only show when task is selected

    // Professional toggle design with compact height
    const toggleWrapper = toggleContainer.append("div")
        .style("display", "flex")
        .style("align-items", "center")
        .style("gap", `${this.UI_TOKENS.spacing.md}px`);

    // Professional label
    toggleWrapper.append("span")
        .style("font-family", "Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif")
        .style("font-size", `${this.UI_TOKENS.fontSize.md}px`)
        .style("font-weight", this.UI_TOKENS.fontWeight.medium.toString())
        .style("color", this.UI_TOKENS.color.neutral.grey130)
        .style("white-space", "nowrap")
        .style("letter-spacing", "0.2px")
        .text("Trace:");

    // Professional toggle buttons container - compact height
    const toggleButtons = toggleWrapper.append("div")
        .style("display", "flex")
        .style("border", `1.5px solid ${this.UI_TOKENS.color.neutral.grey60}`)
        .style("border-radius", `${this.UI_TOKENS.radius.large}px`)
        .style("overflow", "hidden")
        .style("height", `${this.UI_TOKENS.height.compact}px`)  // Compact height (24px)
        .style("background", this.UI_TOKENS.color.neutral.white)
        .style("box-shadow", this.UI_TOKENS.shadow[2])
        .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);
    
    // Professional Backward Button - compact design
    const backwardButton = toggleButtons.append("div")
        .attr("class", "trace-mode-button backward")
        .style("padding", `0 ${this.UI_TOKENS.spacing.lg}px`)
        .style("cursor", "pointer")
        .style("background-color", this.traceMode === "backward" ? this.UI_TOKENS.color.primary.default : this.UI_TOKENS.color.neutral.white)
        .style("border-right", `1px solid ${this.UI_TOKENS.color.neutral.grey40}`)
        .style("display", "flex")
        .style("align-items", "center")
        .style("gap", `${this.UI_TOKENS.spacing.xs}px`)
        .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

    // Compact backward arrow using SVG
    const backwardSvg = backwardButton.append("svg")
        .attr("width", "12")
        .attr("height", "12")
        .attr("viewBox", "0 0 12 12")
        .style("flex-shrink", "0");

    backwardSvg.append("path")
        .attr("d", "M 8 2 L 4 6 L 8 10")
        .attr("stroke", this.traceMode === "backward" ? this.UI_TOKENS.color.neutral.white : this.UI_TOKENS.color.neutral.grey130)
        .attr("stroke-width", "2")
        .attr("stroke-linecap", "round")
        .attr("stroke-linejoin", "round")
        .attr("fill", "none");

    backwardButton.append("span")
        .style("font-family", "Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif")
        .style("font-size", `${this.UI_TOKENS.fontSize.sm}px`)
        .style("color", this.traceMode === "backward" ? this.UI_TOKENS.color.neutral.white : this.UI_TOKENS.color.neutral.grey130)
        .style("font-weight", this.traceMode === "backward" ? this.UI_TOKENS.fontWeight.semibold : this.UI_TOKENS.fontWeight.medium)
        .style("letter-spacing", "0.2px")
        .text("Back");

    // Professional Forward Button - compact design
    const forwardButton = toggleButtons.append("div")
        .attr("class", "trace-mode-button forward")
        .style("padding", `0 ${this.UI_TOKENS.spacing.lg}px`)
        .style("cursor", "pointer")
        .style("background-color", this.traceMode === "forward" ? this.UI_TOKENS.color.primary.default : this.UI_TOKENS.color.neutral.white)
        .style("display", "flex")
        .style("align-items", "center")
        .style("gap", `${this.UI_TOKENS.spacing.xs}px`)
        .style("transition", `all ${this.UI_TOKENS.motion.duration.normal}ms ${this.UI_TOKENS.motion.easing.smooth}`);

    forwardButton.append("span")
        .style("font-family", "Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif")
        .style("font-size", `${this.UI_TOKENS.fontSize.sm}px`)
        .style("color", this.traceMode === "forward" ? this.UI_TOKENS.color.neutral.white : this.UI_TOKENS.color.neutral.grey130)
        .style("font-weight", this.traceMode === "forward" ? this.UI_TOKENS.fontWeight.semibold : this.UI_TOKENS.fontWeight.medium)
        .style("letter-spacing", "0.2px")
        .text("Forward");

    // Compact forward arrow using SVG
    const forwardSvg = forwardButton.append("svg")
        .attr("width", "12")
        .attr("height", "12")
        .attr("viewBox", "0 0 12 12")
        .style("flex-shrink", "0");

    forwardSvg.append("path")
        .attr("d", "M 4 2 L 8 6 L 4 10")
        .attr("stroke", this.traceMode === "forward" ? this.UI_TOKENS.color.neutral.white : this.UI_TOKENS.color.neutral.grey130)
        .attr("stroke-width", "2")
        .attr("stroke-linecap", "round")
        .attr("stroke-linejoin", "round")
        .attr("fill", "none");
    
    // Tooltip based on mode (only shown when task is selected)
    const tooltipText = this.traceMode === "backward"
        ? "Showing predecessors leading to selected task"
        : "Showing successors from selected task";

    toggleContainer.append("title").text(tooltipText);

    const self = this;

    // Professional hover effects
    backwardButton
        .on("mouseover", function() {
            if (self.traceMode !== "backward") {
                d3.select(this).style("background-color", self.UI_TOKENS.color.neutral.grey10);
            } else {
                d3.select(this).style("background-color", self.UI_TOKENS.color.primary.hover);
            }
        })
        .on("mouseout", function() {
            if (self.traceMode !== "backward") {
                d3.select(this).style("background-color", self.UI_TOKENS.color.neutral.white);
            } else {
                d3.select(this).style("background-color", self.UI_TOKENS.color.primary.default);
            }
        })
        .on("mousedown", function() {
            if (self.traceMode === "backward") {
                d3.select(this).style("background-color", self.UI_TOKENS.color.primary.pressed);
            }
        })
        .on("mouseup", function() {
            if (self.traceMode === "backward") {
                d3.select(this).style("background-color", self.UI_TOKENS.color.primary.hover);
            }
        });

    forwardButton
        .on("mouseover", function() {
            if (self.traceMode !== "forward") {
                d3.select(this).style("background-color", self.UI_TOKENS.color.neutral.grey10);
            } else {
                d3.select(this).style("background-color", self.UI_TOKENS.color.primary.hover);
            }
        })
        .on("mouseout", function() {
            if (self.traceMode !== "forward") {
                d3.select(this).style("background-color", self.UI_TOKENS.color.neutral.white);
            } else {
                d3.select(this).style("background-color", self.UI_TOKENS.color.primary.default);
            }
        })
        .on("mousedown", function() {
            if (self.traceMode === "forward") {
                d3.select(this).style("background-color", self.UI_TOKENS.color.primary.pressed);
            }
        })
        .on("mouseup", function() {
            if (self.traceMode === "forward") {
                d3.select(this).style("background-color", self.UI_TOKENS.color.primary.hover);
            }
        });

    // Click handlers
    backwardButton.on("click", function() {
        if (self.traceMode !== "backward") {
            self.traceMode = "backward";
            self.host.persistProperties({
                merge: [{
                    objectName: "persistedState",
                    properties: { traceMode: self.traceMode },
                    selector: null
                }]
            });
            self.createTraceModeToggle();

            // Force canvas refresh
            self.forceCanvasRefresh();

            // BUG-004 FIX: Preserve scroll position when changing trace direction
            self.captureScrollPosition();
            self.forceFullUpdate = true;
            if (self.lastUpdateOptions) {
                self.update(self.lastUpdateOptions);
            }
        }
    });

    forwardButton.on("click", function() {
        if (self.traceMode !== "forward") {
            self.traceMode = "forward";
            self.host.persistProperties({
                merge: [{
                    objectName: "persistedState",
                    properties: { traceMode: self.traceMode },
                    selector: null
                }]
            });
            self.createTraceModeToggle();

            // Force canvas refresh
            self.forceCanvasRefresh();

            // BUG-004 FIX: Preserve scroll position when changing trace direction
            self.captureScrollPosition();
            self.forceFullUpdate = true;
            if (self.lastUpdateOptions) {
                self.update(self.lastUpdateOptions);
            }
        }
    });
}
/**
 * Filters the dropdown items based on input text
 */
private filterTaskDropdown(searchText: string = ""): void {
    if (!this.dropdownList) return;
    
    const searchLower = searchText.toLowerCase().trim();
    
    // Always show the clear selection option
    this.dropdownList.select(".clear-selection")
        .style("display", "block");
    
    // Filter task items
    this.dropdownList.selectAll(".dropdown-item:not(.clear-selection):not(.no-data)")
        .style("display", function() {
            const element = this as HTMLElement;
            const taskName = element.getAttribute("data-task-name") || "";
            return taskName.toLowerCase().includes(searchLower) ? "block" : "none";
        });
    
    // Check if any items are visible
    const visibleItems = this.dropdownList.selectAll(".dropdown-item:not(.clear-selection)")
        .filter(function() {
            return (this as HTMLElement).style.display !== "none";
        });
    
    // If no items match the search, show a message
    if (visibleItems.empty() && searchLower.length > 0) {
        // Remove any existing no-results message
        this.dropdownList.selectAll(".no-results").remove();
        
        this.dropdownList.append("div")
            .attr("class", "dropdown-item no-results")
            .text(`No tasks matching "${searchText}"`)
            .style("padding", "8px 10px")
            .style("color", "#999")
            .style("font-style", "italic")
            .style("font-size", "11px")
            .style("font-family", "Segoe UI, sans-serif");
    } else {
        // Remove no-results message if it exists
        this.dropdownList.selectAll(".no-results").remove();
    }
}

private selectTask(taskId: string | null, taskName: string | null): void {
    // If same task clicked again, deselect it
    if (this.selectedTaskId === taskId && taskId !== null) {
        taskId = null;
        taskName = null;
    }
    
    const taskChanged = this.selectedTaskId !== taskId;
    
    if (!taskChanged) {
        return; // No change, no update needed
    }
    
    this.selectedTaskId = taskId;
    this.selectedTaskName = taskName;

    // Batch UI updates
    this.createTraceModeToggle();
    
    // Update dropdown if exists
    if (this.dropdownInput) {
        this.dropdownInput.property("value", taskName || "");
    }
    
    // Update selected task label
    if (this.selectedTaskLabel) {
        if (taskId && taskName && this.settings.taskSelection.showSelectedTaskLabel.value) {
            this.selectedTaskLabel
                .style("display", "block")
                .text(`Selected: ${taskName}`);
        } else {
            this.selectedTaskLabel.style("display", "none");
        }
    }
    
    // Persist the selected task
    this.host.persistProperties({
        merge: [{
            objectName: "persistedState",
            properties: { selectedTaskId: this.selectedTaskId || "" },
            selector: null
        }]
    });
    
    // Force canvas refresh before update
    this.forceCanvasRefresh();
    
    // Ensure selected task is visible if needed
    if (taskId) {
        requestAnimationFrame(() => {
            this.ensureTaskVisible(taskId);
        });
    }
    
    // Force full update
    this.forceFullUpdate = true;
    if (this.lastUpdateOptions) {
        this.update(this.lastUpdateOptions);
    }
}

private ensureTaskVisible(taskId: string): void {
    const task = this.taskIdToTask.get(taskId);
    if (!task || task.yOrder === undefined) return;
    
    const taskIndex = task.yOrder;
    // Check if task is outside current viewport
    if (taskIndex < this.viewportStartIndex || taskIndex > this.viewportEndIndex) {
        // Scroll to make task visible (centered if possible)
        const containerNode = this.scrollableContainer.node();
        const viewportHeight = containerNode.clientHeight;
        const targetScrollTop = (taskIndex * this.taskElementHeight) - 
                               (viewportHeight / 2) + (this.taskElementHeight / 2);
        
        // Scroll to position
        containerNode.scrollTop = Math.max(0, targetScrollTop);
        
        // Force recalculation of visible tasks
        this.handleScroll();
    }
}

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        this.debugLog("getFormattingModel called");
        if (!this.formattingSettingsService) {
             console.error("FormattingSettingsService not initialized before getFormattingModel call.");
             return { cards: [] };
        }
        // Ensure settings are populated if called before first update (might happen in PBI service)
        if (!this.settings && this.lastUpdateOptions?.dataViews?.[0]) {
             this.settings = this.formattingSettingsService.populateFormattingSettingsModel(VisualSettings, this.lastUpdateOptions.dataViews[0]);
        } else if (!this.settings) {
             // Create default settings if no data/options available yet
             this.settings = new VisualSettings();
        }

        // Modify legendColors card before building model if legend exists
        if (this.legendDataExists && this.legendCategories.length > 0 && this.settings?.legendColors) {
            const ColorPicker = formattingSettings.ColorPicker;

            // Update the display name of the card
            this.settings.legendColors.displayName = "Data Colors";

            // Create dynamic color picker slices for each category (up to 20)
            const slices: formattingSettings.Slice[] = [];
            for (let i = 0; i < this.legendCategories.length && i < 20; i++) {
                const category = this.legendCategories[i];
                const colorKey = `color${i + 1}`;

                // Get the current color for this category
                const currentColor = this.legendColorMap.get(category) || "#000000";

                // Create a color picker with the category name as display name
                const colorPicker = new ColorPicker({
                    name: colorKey,
                    displayName: category, // Show actual category name
                    value: { value: currentColor }
                });

                slices.push(colorPicker);
            }

            // Replace the slices in the legendColors card
            this.settings.legendColors.slices = slices;
        } else if (this.settings?.legendColors) {
            // Hide the card if no legend data exists
            this.settings.legendColors.visible = false;
        }

        const formattingModel = this.formattingSettingsService.buildFormattingModel(this.settings);

        return formattingModel;
    }

    /**
     * Toggle a legend category on/off for filtering
     */
    private toggleLegendCategory(category: string): void {
        // If currently empty (all selected), clicking adds ONLY this category (filter TO it)
        if (this.selectedLegendCategories.size === 0) {
            this.selectedLegendCategories.add(category);
        } else {
            // Toggle the category
            if (this.selectedLegendCategories.has(category)) {
                this.selectedLegendCategories.delete(category);
                // If all are deselected, reset to "all selected" state
                if (this.selectedLegendCategories.size === 0) {
                    // Keep it empty - empty = all selected
                }
            } else {
                this.selectedLegendCategories.add(category);
                // If all categories are now selected, reset to empty set for efficiency
                if (this.selectedLegendCategories.size === this.legendCategories.length) {
                    this.selectedLegendCategories.clear();
                }
            }
        }

        // BUG-006 FIX: Persist legend selection state
        // Convert Set to comma-separated string for storage
        const selectedCategoriesStr = Array.from(this.selectedLegendCategories).join(',');
        this.host.persistProperties({
            merge: [{
                objectName: "persistedState",
                properties: { selectedLegendCategories: selectedCategoriesStr },
                selector: null
            }]
        });

        // BUG-005 FIX: Preserve scroll position when toggling legend filter
        // Legend filtering doesn't reorder tasks, just shows/hides them, so scroll should be preserved
        this.captureScrollPosition();
        this.forceFullUpdate = true;

        // Re-render the visual with the new filter
        if (this.lastUpdateOptions) {
            this.update(this.lastUpdateOptions);
        }
    }

    /**
     * Render the legend UI in sticky footer with horizontal scrolling
     */
    private renderLegend(viewportWidth: number, viewportHeight: number): void {
        if (!this.legendContainer) return;

        // Check if legend should be shown
        const showLegend = this.settings.legend.show.value && this.legendDataExists && this.legendCategories.length > 0;

        if (!showLegend) {
            this.legendContainer.style("display", "none");
            return;
        }

        // Show legend container - flexbox handles height automatically
        this.legendContainer.style("display", "block");

        // Get legend settings
        const fontSize = this.settings.legend.fontSize.value;
        const showTitle = this.settings.legend.showTitle.value;
        const titleText = this.settings.legend.titleText.value || this.legendFieldName;

        // Clear existing legend content
        this.legendContainer.selectAll("*").remove();

        // Main container with flexbox layout
        const mainContainer = this.legendContainer.append("div")
            .style("display", "flex")
            .style("align-items", "center")
            .style("height", "100%")
            .style("padding", "0 10px");

        // Left scroll arrow
        const leftArrow = mainContainer.append("div")
            .attr("class", "legend-scroll-left")
            .style("flex-shrink", "0")
            .style("width", "30px")
            .style("height", "30px")
            .style("display", "flex")
            .style("align-items", "center")
            .style("justify-content", "center")
            .style("cursor", "pointer")
            .style("background-color", "#f0f0f0")
            .style("border-radius", "4px")
            .style("margin-right", "10px")
            .style("user-select", "none")
            .style("transition", "background-color 0.2s")
            .text("◀")
            .style("font-size", "14px")
            .style("color", "#666");

        // Scrollable content wrapper
        const scrollWrapper = mainContainer.append("div")
            .style("flex", "1")
            .style("overflow", "hidden")
            .style("position", "relative");

        // Scrollable content container
        const scrollableContent = scrollWrapper.append("div")
            .attr("class", "legend-scrollable-content")
            .style("display", "flex")
            .style("gap", "20px")
            .style("align-items", "center")
            .style("transition", "transform 0.3s ease")
            .style("padding", "5px 0");

        // Add title if enabled
        if (showTitle && titleText) {
            scrollableContent.append("div")
                .style("font-family", "Segoe UI, sans-serif")
                .style("font-size", `${fontSize + 1}px`)
                .style("font-weight", "bold")
                .style("color", "#333")
                .style("white-space", "nowrap")
                .style("margin-right", "10px")
                .text(titleText + ":");
        }

        // UX ENHANCEMENT: Add selection count indicator
        const selectedCount = this.selectedLegendCategories.size === 0 ? this.legendCategories.length : this.selectedLegendCategories.size;
        const totalCount = this.legendCategories.length;

        scrollableContent.append("div")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", `${fontSize - 1}px`)
            .style("color", "#888")
            .style("white-space", "nowrap")
            .style("margin-right", "15px")
            .style("padding", "2px 8px")
            .style("background-color", "#f0f0f0")
            .style("border-radius", "10px")
            .attr("title", "Number of visible categories")
            .text(`${selectedCount} of ${totalCount} shown`);

        // Add legend items
        this.legendCategories.forEach(category => {
            const color = this.legendColorMap.get(category) || "#999";
            // Check if this category is selected (empty set = all selected)
            const isSelected = this.selectedLegendCategories.size === 0 || this.selectedLegendCategories.has(category);

            const item = scrollableContent.append("div")
                .attr("data-category", category)
                // UX ENHANCEMENT: Add role and aria attributes for accessibility
                .attr("role", "button")
                .attr("aria-label", `${isSelected ? 'Hide' : 'Show'} ${category} tasks. Click to toggle visibility.`)
                .attr("aria-pressed", isSelected ? "true" : "false")
                .attr("tabindex", 0)
                // UX ENHANCEMENT: Add title attribute for discoverability
                .attr("title", `Click to ${isSelected ? 'hide' : 'show'} "${category}" tasks`)
                .style("display", "flex")
                .style("align-items", "center")
                .style("gap", "6px")
                .style("flex-shrink", "0")
                .style("cursor", "pointer")
                .style("user-select", "none")
                .style("padding", "4px 10px")
                .style("border-radius", "6px")
                // UX ENHANCEMENT: Improved transitions for smoother feel
                .style("transition", "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)")
                .style("opacity", isSelected ? "1" : "0.5")
                // UX ENHANCEMENT: Add subtle border to make items more distinct
                .style("border", `1px solid ${isSelected ? '#ddd' : '#e8e8e8'}`);

            // Color swatch
            item.append("div")
                .style("width", "16px")
                .style("height", "16px")
                .style("background-color", color)
                .style("border", `2px solid ${isSelected ? color : '#ccc'}`)
                .style("border-radius", "3px")
                .style("flex-shrink", "0")
                .style("transition", "border-color 0.2s");

            // Label
            item.append("span")
                .style("font-family", "Segoe UI, sans-serif")
                .style("font-size", `${fontSize}px`)
                .style("color", isSelected ? "#333" : "#999")
                .style("white-space", "nowrap")
                .style("font-weight", isSelected ? "500" : "400")
                .style("text-decoration", isSelected ? "none" : "line-through")
                .text(category);

            // Click handler for filtering
            item.on("click", () => {
                this.toggleLegendCategory(category);
            });

            // UX ENHANCEMENT: Keyboard support
            item.on("keydown", (event: KeyboardEvent) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    this.toggleLegendCategory(category);
                }
            });

            // UX ENHANCEMENT: Improved hover effect with subtle elevation
            item.on("mouseenter", function() {
                d3.select(this)
                    .style("background-color", "#f8f9fa")
                    .style("transform", "translateY(-1px)")
                    .style("box-shadow", "0 2px 4px rgba(0,0,0,0.1)");
            }).on("mouseleave", function() {
                d3.select(this)
                    .style("background-color", "transparent")
                    .style("transform", "translateY(0)")
                    .style("box-shadow", "none");
            });

            // UX ENHANCEMENT: Focus indicator
            item.on("focus", function() {
                d3.select(this)
                    .style("outline", "2px solid #0078D4")
                    .style("outline-offset", "2px");
            }).on("blur", function() {
                d3.select(this)
                    .style("outline", "none");
            });
        });

        // Right scroll arrow
        const rightArrow = mainContainer.append("div")
            .attr("class", "legend-scroll-right")
            .style("flex-shrink", "0")
            .style("width", "30px")
            .style("height", "30px")
            .style("display", "flex")
            .style("align-items", "center")
            .style("justify-content", "center")
            .style("cursor", "pointer")
            .style("background-color", "#f0f0f0")
            .style("border-radius", "4px")
            .style("margin-left", "10px")
            .style("user-select", "none")
            .style("transition", "background-color 0.2s")
            .text("▶")
            .style("font-size", "14px")
            .style("color", "#666");

        // Scroll logic
        let scrollPosition = 0;
        const scrollAmount = 200; // pixels to scroll per click

        leftArrow.on("click", function() {
            scrollPosition = Math.max(0, scrollPosition - scrollAmount);
            scrollableContent.style("transform", `translateX(-${scrollPosition}px)`);
            updateArrowStates();
        });

        rightArrow.on("click", function() {
            const contentWidth = (scrollableContent.node() as HTMLElement).scrollWidth;
            const wrapperWidth = (scrollWrapper.node() as HTMLElement).clientWidth;
            const maxScroll = Math.max(0, contentWidth - wrapperWidth);
            scrollPosition = Math.min(maxScroll, scrollPosition + scrollAmount);
            scrollableContent.style("transform", `translateX(-${scrollPosition}px)`);
            updateArrowStates();
        });

        // Update arrow states based on scroll position
        const updateArrowStates = () => {
            const contentWidth = (scrollableContent.node() as HTMLElement).scrollWidth;
            const wrapperWidth = (scrollWrapper.node() as HTMLElement).clientWidth;
            const maxScroll = Math.max(0, contentWidth - wrapperWidth);

            // Disable/enable arrows
            if (scrollPosition <= 0) {
                leftArrow.style("opacity", "0.3").style("cursor", "default");
            } else {
                leftArrow.style("opacity", "1").style("cursor", "pointer");
            }

            if (scrollPosition >= maxScroll || maxScroll === 0) {
                rightArrow.style("opacity", "0.3").style("cursor", "default");
            } else {
                rightArrow.style("opacity", "1").style("cursor", "pointer");
            }
        };

        // Hover effects for arrows
        leftArrow.on("mouseenter", function() {
            if (scrollPosition > 0) {
                d3.select(this).style("background-color", "#e0e0e0");
            }
        }).on("mouseleave", function() {
            d3.select(this).style("background-color", "#f0f0f0");
        });

        rightArrow.on("mouseenter", function() {
            const contentWidth = (scrollableContent.node() as HTMLElement).scrollWidth;
            const wrapperWidth = (scrollWrapper.node() as HTMLElement).clientWidth;
            if (scrollPosition < contentWidth - wrapperWidth) {
                d3.select(this).style("background-color", "#e0e0e0");
            }
        }).on("mouseleave", function() {
            d3.select(this).style("background-color", "#f0f0f0");
        });

        // Wait a frame for layout to settle, then update arrow states
        setTimeout(() => updateArrowStates(), 0);
    }

    /**
     * Convert hex color to RGB object
     */
    private hexToRgb(hex: string): { r: number; g: number; b: number } {
        // Remove # if present
        hex = hex.replace(/^#/, '');

        // Parse hex values
        const bigint = parseInt(hex, 16);
        const r = (bigint >> 16) & 255;
        const g = (bigint >> 8) & 255;
        const b = bigint & 255;

        return { r, g, b };
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
        // Use white text for dark backgrounds, black for light backgrounds
        return luminance > 0.5 ? '#000000' : '#FFFFFF';
    }

    /**
     * Get duration text color based on settings or auto-contrast
     */
    private getDurationTextColor(backgroundColor: string): string {
        const settingColor = this.settings.textAndLabels.durationTextColor.value.value;

        // If set to "Auto", calculate contrast color
        if (settingColor === "Auto" || !settingColor) {
            return this.getContrastColor(backgroundColor);
        }

        return settingColor;
    }

    // Debug helper
    private debugLog(...args: unknown[]): void {
        if (this.debug) {
            console.log(...args);
        }
    }

} // End of Visual class
