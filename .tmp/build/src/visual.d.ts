import powerbi from "powerbi-visuals-api";
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
export declare class Visual implements IVisual {
    private target;
    private host;
    private formattingSettingsService;
    private settings;
    private stickyHeaderContainer;
    private scrollableContainer;
    private headerSvg;
    private mainSvg;
    private mainGroup;
    private gridLayer;
    private arrowLayer;
    private taskLayer;
    private toggleButtonGroup;
    private headerGridLayer;
    private tooltipDiv;
    private canvasElement;
    private canvasContext;
    private useCanvasRendering;
    private CANVAS_THRESHOLD;
    private canvasLayer;
    private allTasksData;
    private relationships;
    private taskIdToTask;
    private taskIdQueryName;
    private taskIdTable;
    private taskIdColumn;
    private lastUpdateOptions;
    private showConnectorLinesInternal;
    private connectorToggleGroup;
    private wbsExpandedInternal;
    private showAllTasksInternal;
    private showBaselineInternal;
    private showPreviousUpdateInternal;
    private isInitialLoad;
    private debug;
    private margin;
    private headerHeight;
    private legendFooterHeight;
    private dateLabelOffset;
    private floatTolerance;
    private defaultMaxTasks;
    private labelPaddingLeft;
    private dateBackgroundPadding;
    private taskLabelLineHeight;
    private minTaskWidthPixels;
    private monthYearFormatter;
    private dataDate;
    private xScale;
    private yScale;
    private selectedTaskId;
    private selectedTaskName;
    private dropdownContainer;
    private dropdownInput;
    private dropdownList;
    private marginResizer;
    private selectedTaskLabel;
    private pathInfoLabel;
    private traceMode;
    private floatThresholdInput;
    private floatThreshold;
    private showNearCritical;
    private viewportStartIndex;
    private viewportEndIndex;
    private visibleTaskCount;
    private taskTotalCount;
    private taskElementHeight;
    private scrollThrottleTimeout;
    private scrollListener;
    private allTasksToShow;
    private allFilteredTasks;
    private lastViewport;
    private lastDataViewId;
    private renderStartTime;
    private predecessorIndex;
    private legendDataExists;
    private legendColorMap;
    private legendCategories;
    private legendFieldName;
    private legendContainer;
    private selectedLegendCategories;
    private legendSelectionIds;
    private wbsDataExists;
    private wbsDataExistsInMetadata;
    private wbsLevelColumnIndices;
    private wbsLevelColumnNames;
    private wbsGroups;
    private wbsGroupMap;
    private wbsRootGroups;
    private wbsExpandedState;
    private wbsExpandToLevel;
    private wbsAvailableLevels;
    private wbsManualExpansionOverride;
    private wbsManuallyToggledGroups;
    private wbsGroupLayer;
    private lastExpandCollapseAllState;
    private tooltipDebugLogged;
    private relationshipIndex;
    private allDrivingChains;
    private selectedPathIndex;
    private readonly VIEWPORT_CHANGE_THRESHOLD;
    private forceFullUpdate;
    private preserveScrollOnUpdate;
    private preservedScrollTop;
    private scrollPreservationUntil;
    private wbsToggleScrollAnchor;
    private visualTitle;
    private tooltipClassName;
    private isUpdating;
    private isMarginDragging;
    private scrollHandlerBackup;
    private updateDebounceTimeout;
    private pendingUpdate;
    private readonly UPDATE_DEBOUNCE_MS;
    private renderState;
    private lastRenderTime;
    private readonly MIN_RENDER_INTERVAL;
    private virtualScrollEnabled;
    private scrollContainer;
    private renderCache;
    private cpmMemo;
    private zoomSliderContainer;
    private zoomSliderTrack;
    private zoomSliderSelection;
    private zoomSliderLeftHandle;
    private zoomSliderRightHandle;
    private zoomSliderMiniChart;
    private zoomRangeStart;
    private zoomRangeEnd;
    private fullTimelineDomain;
    private isZoomSliderDragging;
    private zoomDragType;
    private zoomDragStartX;
    private zoomDragStartLeft;
    private zoomDragStartRight;
    private zoomSliderEnabled;
    private readonly ZOOM_SLIDER_MIN_RANGE;
    private readonly UI_TOKENS;
    private readonly LAYOUT_BREAKPOINTS;
    /**
     * Determines the current layout mode based on viewport width
     */
    private getLayoutMode;
    /**
     * Returns button dimensions and positions based on current layout mode
     * This centralizes all responsive layout calculations
     */
    private getHeaderButtonLayout;
    /**
     * Returns second row layout (dropdown, trace mode toggle) based on viewport width
     */
    private getSecondRowLayout;
    constructor(options: VisualConstructorOptions);
    private forceCanvasRefresh;
    private debouncedUpdate;
    private requestUpdate;
    private applyPublishModeOptimizations;
    private setupSVGRenderingHints;
    private determineUpdateType;
    destroy(): void;
    /**
     * Centralized scroll preservation helper.
     * Call this before any update() that should maintain scroll position.
     * Sets up both the preserved scroll value and the cooldown to prevent Power BI re-triggers.
     */
    private captureScrollPosition;
    /**
     * Phase 1: Check if enough time has passed since last render (throttling)
     * @returns true if render should proceed, false if should skip
     */
    private shouldRender;
    /**
     * Phase 2: Generate a cache key based on viewport and settings
     */
    private getViewportKey;
    /**
     * Phase 2: Invalidate render cache when settings or data change
     */
    private invalidateRenderCache;
    /**
     * Phase 2: Calculate which tasks are visible in the current viewport
     * @returns Object with start and end indices of visible tasks
     */
    private calculateVisibleRange;
    /**
     * Phase 2: Get cached task color or compute and cache it
     */
    private getCachedTaskColor;
    private toggleTaskDisplayInternal;
    private toggleBaselineDisplayInternal;
    private togglePreviousUpdateDisplayInternal;
    /**
     * Creates/updates the Show All/Show Critical toggle button with professional Fluent design
     * UPGRADED: Enhanced visuals, better spacing, smoother animations, refined icons
     * RESPONSIVE: Adapts to viewport width using getHeaderButtonLayout()
     */
    private createOrUpdateToggleButton;
    /**
     * Creates/updates the Baseline toggle with professional theming and user color integration
     * UPGRADED: Enhanced visuals, better icon design, smoother animations, refined color integration
     */
    private createOrUpdateBaselineToggleButton;
    /**
     * UPGRADED: Creates/updates the Previous Update toggle with professional theming and user color integration
     */
    private createOrUpdatePreviousUpdateToggleButton;
    private lightenColor;
    /**
     * UPGRADED: Creates the Connector Lines toggle with modern icon-only design
     */
    private createConnectorLinesToggleButton;
    /**
     * Creates both WBS expand (forward cycle) and collapse (reverse cycle) buttons
     */
    private renderWbsCycleButtons;
    /**
     * Creates the WBS Expand cycle toggle button with icon-only design
     * Similar styling to Connector Lines toggle for visual consistency
     */
    private createWbsExpandCycleToggleButton;
    /**
     * Creates the WBS Collapse cycle toggle button with icon-only design (reverse order)
     */
    private createWbsCollapseCycleToggleButton;
    /**
     * Cycles the WBS expand depth (collapse -> Level 1/2/3/.../N -> expand all)
     * Levels are dynamic based on the number of WBS columns added by the user
     */
    private toggleWbsExpandCollapseDisplay;
    /**
     * Cycles the WBS expand depth in reverse order (expand all -> ... -> collapse)
     */
    private toggleWbsCollapseCycleDisplay;
    private cycleWbsExpandLevel;
    /**
     * Creates the Mode Toggle (Longest Path ↔ Float-Based) with premium Fluent design
     * UPGRADED: Professional pill-style toggle with smooth animations and refined visuals
     * RESPONSIVE: Adapts to viewport width using getHeaderButtonLayout()
     */
    private createModeToggleButton;
    private toggleCriticalityMode;
    /**
     * UPGRADED: Creates the Float Threshold control with premium input design and enhanced UX
     */
    private createFloatThresholdControl;
    /**
     * Creates the zoom slider UI component matching Microsoft Power BI standard style
     * Design: Thin track line with circular handles at each end
     */
    private createZoomSliderUI;
    /**
     * Sets up mouse and touch event handlers for the zoom slider
     */
    private setupZoomSliderEvents;
    /**
     * Starts a zoom slider drag operation
     */
    private startZoomDrag;
    /**
     * Handles zoom slider drag movement
     */
    private handleZoomDrag;
    /**
     * Ends a zoom slider drag operation
     */
    private endZoomDrag;
    /**
     * Resets zoom to show full timeline
     */
    private resetZoom;
    /**
     * Jumps the zoom selection to center on a clicked position
     */
    private jumpZoomTo;
    /**
     * Updates the zoom slider UI to reflect current zoom state
     */
    private updateZoomSliderUI;
    /**
     * Called when zoom changes - triggers visual update with throttling
     */
    private zoomChangeTimeout;
    private onZoomChange;
    /**
     * Updates the zoom slider visibility and styling based on settings
     */
    private updateZoomSliderVisibility;
    /**
     * Updates the scrollable container height based on visible components
     * Note: With flexbox layout, height is automatically managed.
     * This method is kept for backwards compatibility but flexbox handles the layout.
     */
    private updateScrollableContainerHeight;
    /**
     * Draws the mini chart preview in the zoom slider showing task distribution
     */
    private drawZoomSliderMiniChart;
    /**
     * Gets the zoomed date domain based on current zoom state
     */
    private getZoomedDomain;
    /**
     * Updates the zoom slider track margins to align with the chart area
     */
    private updateZoomSliderTrackMargins;
    private toggleConnectorLinesDisplay;
    update(options: VisualUpdateOptions): void;
    private updateInternal;
    private handleViewportOnlyUpdate;
    private handleSettingsOnlyUpdate;
    /**
     * Handles margin-only updates during drag for real-time visual feedback
     * Does NOT recreate the resizer or call clearVisual() to preserve drag state
     */
    private handleMarginDragUpdate;
    private clearVisual;
    private drawHeaderDivider;
    private createArrowheadMarkers;
    private setupTimeBasedSVGAndScales;
    private setupVirtualScroll;
    private getCanvasMouseCoordinates;
    private showTaskTooltip;
    private hideTooltip;
    private updateHeaderElements;
    private calculateVisibleTasks;
    private handleScroll;
    private canvasHasContent;
    /**
     * Get visible tasks based on current viewport indices
     * When WBS grouping is enabled, filters by yOrder (row number) instead of array index
     * because WBS group headers occupy rows but aren't in the task array
     */
    private getVisibleTasks;
    private redrawVisibleTasks;
    private drawHorizontalGridLinesCanvas;
    private createScales;
    private drawVisualElements;
    private drawHorizontalGridLines;
    private drawVerticalGridLines;
    /** Draws task bars, milestones, and associated labels */
    private drawTasks;
    private drawTasksCanvas;
    /**
     * ACCESSIBILITY: Creates an invisible but screen-reader accessible fallback for canvas rendering.
     * This ensures users with assistive technology can access task information even when canvas mode is active.
     * @param tasks The tasks being rendered on canvas
     * @param yScale The Y-axis scale for positioning
     */
    private createAccessibleCanvasFallback;
    /**
     * Prepares the canvas for high-DPI rendering.
     * This function sizes the canvas backing store, clears it, and applies the necessary scale transform.
     * @param chartWidth The desired CSS width of the chart.
     * @param chartHeight The desired CSS height of the chart.
     * @returns {boolean} True if the canvas was set up successfully, false otherwise.
     */
    private _setupCanvasForDrawing;
    private drawArrowsCanvas;
    /**
     * Positions the tooltip intelligently to prevent it from being cut off at screen edges
     * @param tooltipNode The tooltip DOM element
     * @param event The mouse event that triggered the tooltip
     */
    private positionTooltip;
    private drawArrows;
    private getLineDashArray;
    private getLatestFinishDate;
    private drawFinishLine;
    private drawProjectEndLine;
    private drawDataDateLine;
    private drawBaselineAndPreviousEndLines;
    private calculateCPMOffThread;
    private determineCriticalityMode;
    private applyFloatBasedCriticality;
    private calculateCPM;
    /**
     * Identifies the longest path using P6 scheduled dates (reflective approach)
     * This replaces the old calculateCPM() method for Longest Path mode
     */
    private identifyLongestPathFromP6;
    /**
     * Identifies which relationships are driving based on minimum float
     */
    private identifyDrivingRelationships;
    /**
     * Finds the project finish task (latest finish date)
     */
    private findProjectFinishTask;
    /**
     * Finds all driving chains leading to a specific task
     */
    private findAllDrivingChainsToTask;
    /**
     * Selects the longest chain by total working duration
     */
    private selectLongestChain;
    /**
     * Sorts driving chains by duration (descending) and stores them for multi-path toggle
     */
    private sortAndStoreDrivingChains;
    /**
     * Gets the currently selected driving chain based on settings
     */
    private getSelectedDrivingChain;
    /**
     * Updates the path information label display with interactive navigation
     * UPGRADED: Professional navigation buttons with enhanced design and smooth animations
     */
    private updatePathInfoLabel;
    /**
     * Navigate to the previous driving path
     */
    private navigateToPreviousPath;
    /**
     * Navigate to the next driving path
     */
    private navigateToNextPath;
    /**
     * Persist the selected path index to settings
     */
    private persistPathSelection;
    private identifyNearCriticalTasks;
    /**
     * Identifies predecessor tasks connected through driving relationships
     */
    private identifyDrivingPredecessorTasks;
    /**
     * Identifies successor tasks connected through driving relationships
     */
    private identifyDrivingSuccessorTasks;
    private calculateCPMToTask;
    /**
     * Calculates CPM (Critical Path Method) forward from a selected source task
     * OPTIMIZED: Converted from exponential recursion to iterative stack-based DFS
     * PERFORMANCE FIX: Uses indexed lookups instead of filtering entire relationship array
     */
    private calculateCPMFromTask;
    /**
     * Traces backward from a target task to find all predecessor tasks (Float-Based mode)
     * OPTIMIZED: Added safety limits to prevent memory exhaustion
     */
    private identifyPredecessorTasksFloatBased;
    /**
     * Traces forward from a source task to find all successor tasks (Float-Based mode)
     * OPTIMIZED: Added safety limits to prevent memory exhaustion
     */
    private identifySuccessorTasksFloatBased;
    /**
     * Extracts and validates task ID from a data row
     */
    private extractTaskId;
    /**
     * Extracts predecessor ID from a data row
     */
    private extractPredecessorId;
    private createTaskFromRow;
    /**
     * Extracts tooltip data from a row
     */
    private extractTooltipData;
    private transformDataOptimized;
    /**
     * DATA QUALITY: Validates data quality and reports issues to the user
     * Checks for:
     * - Duplicate Task IDs
     * - Circular dependencies
     * - Invalid date ranges (start after finish)
     * - Tasks with no dates
     */
    private validateDataQuality;
    /**
     * Detects circular dependencies in the task graph
     * @returns Array of circular dependency paths as strings
     */
    private detectCircularDependencies;
    /**
     * Process legend data and assign colors to tasks based on legend values
     */
    private processLegendData;
    /**
     * WBS GROUPING: Processes WBS data and builds hierarchical group structure
     * Builds the WBS hierarchy from task WBS level fields and calculates summary metrics
     */
    private processWBSData;
    /**
     * WBS GROUPING: Helpers for expand-to-level behavior
     */
    private refreshWbsAvailableLevels;
    private getMaxWbsLevel;
    private getWbsExpandLevelLabel;
    private getNextWbsExpandLevel;
    private getPreviousWbsExpandLevel;
    private applyWbsExpandLevel;
    /**
     * Capture a WBS anchor near the middle of the current viewport so global
     * expand/collapse cycles keep the user roughly in place.
     */
    private captureWbsAnchorForGlobalToggle;
    /**
     * WBS GROUPING: Toggle expansion state for a WBS group
     */
    private toggleWbsGroupExpansion;
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
    private restoreScrollPosition;
    /**
     * WBS GROUPING: Check if a task should be visible based on WBS group expansion state
     */
    private isTaskVisibleWithWbsGrouping;
    /**
     * WBS GROUPING: Apply WBS ordering and filtering to tasks
     * Returns tasks sorted by WBS hierarchy with collapsed groups filtered out
     */
    private applyWbsOrdering;
    /**
     * WBS GROUPING: Update filtered task counts for groups
     * This must be called BEFORE applyWbsOrdering so that collapse state doesn't affect counts
     *
     * @param filteredTasks - Tasks after filtering (legend, etc.) but before collapse/expand ordering
     */
    private updateWbsFilteredCounts;
    /**
     * WBS GROUPING: Assign yOrder to both group headers and tasks after all filtering
     * This creates a unified layout where group headers reserve their own rows
     *
     * @param tasksToShow - Final filtered list of tasks to display (after collapse/expand)
     */
    private assignWbsYOrder;
    /**
     * WBS GROUPING: Get the ordered list of items to display (groups + tasks)
     * Returns a flat list with groups interleaved with their visible tasks
     */
    private getWbsOrderedDisplayItems;
    /**
     * WBS GROUPING: Draw WBS group headers in SVG mode
     * Renders group headers with expand/collapse controls and optional summary bars
     */
    private drawWbsGroupHeaders;
    private mightBeDate;
    private validateDataView;
    private hasDataRole;
    private getColumnIndex;
    private parseDate;
    private formatDate;
    private limitTasks;
    private applyTaskFilter;
    private displayMessage;
    private createTaskSelectionDropdown;
    /**
     * Populates the task dropdown with tasks from the dataset
     */
    private populateTaskDropdown;
    /**
     * Creates an interactive margin resizer that allows users to drag and adjust
     * the left margin width between task descriptions and gantt bars
     *
     * CRITICAL: This must be called AFTER mainSvg has been sized with .attr("height", totalSvgHeight)
     *
     * IMPLEMENTATION: Uses SVG rect element so it scrolls with the gantt chart content
     * and never appears in the sticky header area
     */
    private createMarginResizer;
    /**
     * Updates the position of the SVG margin resizer based on current settings
     */
    private updateMarginResizerPosition;
    /**
     * Creates the Trace Mode Toggle (Backward/Forward) with professional design
     * UPGRADED: Enhanced visuals, better button design, smoother animations, refined styling
     */
    private createTraceModeToggle;
    /**
     * Filters the dropdown items based on input text
     */
    private filterTaskDropdown;
    private selectTask;
    private ensureTaskVisible;
    getFormattingModel(): powerbi.visuals.FormattingModel;
    /**
     * Toggle a legend category on/off for filtering
     */
    private toggleLegendCategory;
    /**
     * Render the legend UI in sticky footer with horizontal scrolling
     */
    private renderLegend;
    /**
     * Convert hex color to RGB object
     */
    private hexToRgb;
    /**
     * Calculate luminance of a color (for contrast calculation)
     */
    private getLuminance;
    /**
     * Get contrasting text color (black or white) for a given background color
     */
    private getContrastColor;
    /**
     * Get duration text color based on settings or auto-contrast
     */
    private getDurationTextColor;
    private debugLog;
}
