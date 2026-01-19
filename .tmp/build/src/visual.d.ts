import powerbi from "powerbi-visuals-api";
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
export declare class Visual implements IVisual {
    private target;
    private host;
    private formattingSettingsService;
    private settings;
    private selectionManager;
    private tooltipService;
    private localizationManager;
    private eventService;
    private downloadService;
    private isExporting;
    private exportButtonGroup;
    private allowInteractions;
    private highContrastMode;
    private highContrastForeground;
    private highContrastBackground;
    private highContrastForegroundSelected;
    private lastTooltipItems;
    private lastTooltipIdentities;
    private stickyHeaderContainer;
    private scrollableContainer;
    private headerSvg;
    private mainSvg;
    private mainGroup;
    private gridLayer;
    private labelGridLayer;
    private arrowLayer;
    private taskLayer;
    private taskLabelLayer;
    private chartClipPath;
    private chartClipRect;
    private toggleButtonGroup;
    private headerGridLayer;
    private tooltipDiv;
    private canvasElement;
    private canvasContext;
    private useCanvasRendering;
    private CANVAS_THRESHOLD;
    private readonly MODE_TRANSITION_DURATION;
    private canvasLayer;
    private loadingOverlay;
    private loadingText;
    private loadingRowsText;
    private loadingProgressText;
    private isLoadingVisible;
    private loadingStartTime;
    private allTasksData;
    private relationships;
    private taskIdToTask;
    private taskIdQueryName;
    private taskIdTable;
    private taskIdColumn;
    private lastUpdateOptions;
    private lastTaskFilterSignature;
    private showConnectorLinesInternal;
    private showExtraColumnsInternal;
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
    private lineDateFormatter;
    private fullDateFormatter;
    private lastLocale;
    private dataDate;
    private xScale;
    private yScale;
    private selectedTaskId;
    private selectedTaskName;
    private hoveredTaskId;
    private lastDataSignature;
    private cachedSortedTasksSignature;
    private cachedTasksSortedByStartDate;
    private cachedPlottableTasksSorted;
    private dropdownNeedsRefresh;
    private dropdownContainer;
    private dropdownInput;
    private dropdownList;
    private dropdownListId;
    private dropdownActiveIndex;
    private dropdownFocusableItems;
    private dropdownTaskCache;
    private dropdownFilterTimeout;
    private readonly DROPDOWN_MAX_RESULTS;
    private marginResizer;
    private selectedTaskLabel;
    private pathInfoLabel;
    private isDropdownInteracting;
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
    private filterKeyword;
    private lastViewport;
    private renderStartTime;
    private predecessorIndex;
    private relationshipByPredecessor;
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
    private wbsEnableOverride;
    private wbsGroupLayer;
    private lastExpandCollapseAllState;
    private tooltipDebugLogged;
    private landingPageContainer;
    private helpOverlayContainer;
    private isHelpOverlayVisible;
    private relationshipIndex;
    private allDrivingChains;
    private selectedPathIndex;
    private readonly VIEWPORT_CHANGE_THRESHOLD;
    private forceFullUpdate;
    private preserveScrollOnUpdate;
    private preservedScrollTop;
    private scrollPreservationUntil;
    private lastWbsToggleTimestamp;
    private wbsToggleScrollAnchor;
    private tooltipClassName;
    private isUpdating;
    private isMarginDragging;
    private scrollHandlerBackup;
    private updateDebounceTimeout;
    private pendingUpdate;
    private readonly UPDATE_DEBOUNCE_MS;
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
    private zoomDragListenersAttached;
    private zoomMouseMoveHandler;
    private zoomMouseUpHandler;
    private zoomTouchMoveHandler;
    private zoomTouchEndHandler;
    private readonly zoomTouchListenerOptions;
    private readonly UI_TOKENS;
    private readonly LAYOUT_BREAKPOINTS;
    /**
     * Determines the current layout mode based on viewport width
     */
    private getLayoutMode;
    /**
     * Returns button dimensions and positions based on current layout mode
     * This centralizes all responsive layout calculations with smart overflow handling
     */
    private getHeaderButtonLayout;
    /**
     * Extended layout mode determination with more granular breakpoints
     */
    private getExtendedLayoutMode;
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
    private getDataSignature;
    private hasValidPlotDates;
    private ensureTaskSortCache;
    private determineUpdateType;
    destroy(): void;
    private captureScrollPosition;
    private setHoveredTask;
    private isRelationshipHovered;
    private getConnectorOpacity;
    private updateConnectorHoverStyles;
    private toggleTaskDisplayInternal;
    private toggleBaselineDisplayInternal;
    private togglePreviousUpdateDisplayInternal;
    private createOrUpdateToggleButton;
    private createOrUpdateBaselineToggleButton;
    private createOrUpdatePreviousUpdateToggleButton;
    private lightenColor;
    private createConnectorLinesToggleButton;
    private toggleColumnDisplayInternal;
    private createColumnDisplayToggleButton;
    private createOrUpdateWbsEnableToggleButton;
    /**
     * Creates both WBS expand (forward cycle) and collapse (reverse cycle) buttons
     */
    private renderWbsCycleButtons;
    /**
     * Toggles WBS grouping on/off for the viewer (persisted in formatting properties).
     */
    private toggleWbsEnabled;
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
     * Professional pill-style toggle with smooth animations and refined visuals
     * RESPONSIVE: Adapts to viewport width using getHeaderButtonLayout()
     */
    private createModeToggleButton;
    private togglecriticalPath;
    /**
     * Creates the Float Threshold control with premium input design and enhanced UX
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
    private attachZoomDragListeners;
    private detachZoomDragListeners;
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
     * Phase 1: Persists the current zoom range to settings for bookmark/refresh persistence
     */
    private persistZoomRange;
    /**
     * Phase 1: Detects if user prefers reduced motion for accessibility
     */
    private prefersReducedMotion;
    /**
     * Phase 1: Gets animation duration respecting prefers-reduced-motion
     */
    private getAnimationDuration;
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
     * Updates the zoom slider track margins to align with the chart area
     */
    private updateZoomSliderTrackMargins;
    /**
     * Ensures the chart clip path/rect exist. Recreates them if a previous clear removed <defs>.
     */
    private ensureChartClipPath;
    /**
     * Creates or updates SVG arrowhead marker definitions for connector lines.
     * Uses the arrowHeadSize setting to control marker size.
     */
    private ensureArrowMarkers;
    /**
     * Updates the SVG clip rect to match the current chart dimensions.
     * This prevents bars from rendering past the left margin when zoomed.
     */
    private updateChartClipRect;
    private toggleConnectorLinesDisplay;
    /**
     * Creates the "Copy Visible Data" button in the header area
     */
    private createCopyDataButton;
    /**
     * Copies the currently visible (filtered) tasks to clipboard
     */
    private copyVisibleDataToClipboard;
    private copyUsingLegacyMethod;
    private showCopySuccess;
    /**
     * Creates the export button in the header area
     */
    private createExportButton;
    /**
     * Updates the export button visual state
     */
    private updateExportButtonState;
    /**
     * Exports the visual as a PDF file using Power BI Download Service API
     * Falls back to direct download if the service is unavailable
     */
    private exportToPDF;
    /**
     * Fallback download method using blob URL
     * This works when the Power BI Download Service is unavailable
     */
    private fallbackDownload;
    /**
     * Handle cases where export is not allowed
     */
    private handleExportNotAllowed;
    /**
     * Generates PDF content by compositing all visual layers onto a single canvas
     * @returns Base64 encoded PDF content
     */
    private generatePDFContent;
    /**
     * Converts an SVG element to a canvas
     */
    private svgToCanvas;
    /**
     * Log data loading info. With 'top' algorithm, data arrives in one batch.
     */
    private logDataLoadInfo;
    /**
     * Format a number with thousands separators for display.
     */
    private formatNumber;
    /**
     * Show/hide loading overlay (simplified - no segment tracking).
     */
    private setLoadingOverlayVisible;
    update(options: VisualUpdateOptions): void;
    private updateInternal;
    private updateRenderOnly;
    private handleViewportOnlyUpdate;
    private handleSettingsOnlyUpdate;
    /**
     * Creates the left margin resizer used to resize the label column.
     */
    private createMarginResizer;
    /**
     * Updates the margin resizer's position to align with the current left margin.
     */
    private updateMarginResizerPosition;
    /**
     * Handles margin-only updates during drag for real-time visual feedback
     * Does NOT recreate the resizer or call clearVisual() to preserve drag state
     */
    private handleMarginDragUpdate;
    private clearVisual;
    private drawHeaderDivider;
    private setupTimeBasedSVGAndScales;
    private setupVirtualScroll;
    private getCanvasMouseCoordinates;
    private getTaskAtCanvasPoint;
    private drawRoundedRectPath;
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
    private drawLabelMarginGridLinesCanvasFallback;
    private createScales;
    private drawVisualElements;
    private drawHorizontalGridLines;
    private drawgridLines;
    /** Draws task bars, milestones, and associated labels */
    private drawTasks;
    /**
     * Draws task name labels in an unclipped layer so they stay visible in the left margin.
     */
    private drawTaskLabelsLayer;
    private drawColumnHeaders;
    /**
     * Draws vertical separator lines through the task label area, matching column headers
     */
    private drawLabelColumnSeparators;
    private drawTasksCanvas;
    /**
     * Helper to add a rounded rect to the current path
     * (Inlined for batching performance)
     */
    private pathRoundedRect;
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
    /**
     * Applies Float-Based criticality using user-provided Total Float values
     * Tasks are critical if Total Float ≤ 0, near-critical if 0 < Total Float ≤ threshold
     */
    private applyFloatBasedCriticality;
    /**
     * Identifies the longest path using P6 scheduled dates (reflective approach)
     */
    private identifyLongestPathFromP6;
    /**
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
     * Uses recursive DFS with global visited set to prevent re-exploration
     */
    private findAllDrivingChainsToTask;
    /**
     * Selects the longest chain by total working duration
     */
    private selectLongestChain;
    /**
     * Sorts driving chains and stores them for multi-path toggle
     * Sorting: earliest start date first, then longest duration as tiebreaker
     */
    private sortAndStoreDrivingChains;
    /**
     * Gets the currently selected driving chain based on settings
     * Validates index bounds to prevent errors when switching views
     */
    private getSelectedDrivingChain;
    /**
     * Updates the path information label display with interactive navigation
     * Professional navigation buttons with enhanced design and smooth animations
     * Shows "Path 1/1" even with single path so users understand there's only one driving path
     */
    private updatePathInfoLabel;
    /**
     * Navigate to the previous driving path
     * Provides feedback when navigation is not possible
     */
    private navigateToPreviousPath;
    /**
     * Navigate to the next driving path
     * Provides feedback when navigation is not possible
     */
    private navigateToNextPath;
    /**
     * Helper method for user feedback when navigation not possible
     * Shows a brief message in the path info label
     */
    private showPathNavigationFeedback;
    /**
     * Persist the selected path index to settings
     */
    private persistPathSelection;
    private identifyNearCriticalTasks;
    /**
     * Calculates CPM backward to a selected target task
     * Populates allDrivingChains for multi-path support
     */
    private calculateCPMToTask;
    /**
     * Calculates CPM forward from a selected source task to the latest finish date
     * Uses recursive DFS with global visited set
     */
    private calculateCPMFromTask;
    /**
     * Traces backward from a target task to find all predecessor tasks (Float-Based mode)
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
    private getWbsExpandedStatePayload;
    private getWbsExpandLevelLabel;
    private getCurrentWbsExpandLevel;
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
     * This method removes the scroll listener before setting scrollTop to prevent
     * handleScroll() from firing. setupVirtualScroll() will create and attach a new listener,
     * so we don't need to re-attach the old one.
     *
     * @param totalSvgHeight - Total height of SVG content for calculating max scroll bounds
     */
    private restoreScrollPosition;
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
     * WBS GROUPING: Draw WBS group headers in SVG mode
     * Renders group headers with expand/collapse controls and optional summary bars
     */
    private drawWbsGroupHeaders;
    private mightBeDate;
    private validateDataView;
    private hasDataRole;
    private getColumnIndex;
    private parseDate;
    private refreshDateFormatters;
    private formatColumnDate;
    private formatDate;
    private formatLineDate;
    private limitTasks;
    private buildTaskFilterSignature;
    private applyTaskFilter;
    private displayMessage;
    private createpathSelectionDropdown;
    private normalizeTraceMode;
    /**
     * Creates the trace mode toggle (Backward/Forward) positioned on the second header row.
     */
    private createTraceModeToggle;
    /**
     * Populates the task dropdown with tasks from the dataset
     */
    private populateTaskDropdown;
    /**
     * Filters the dropdown items based on input text
     */
    private filterTaskDropdown;
    private refreshDropdownCache;
    private renderTaskDropdown;
    private openDropdown;
    private closeDropdown;
    private moveDropdownActive;
    private activateDropdownSelection;
    private updateDropdownActiveState;
    private selectTask;
    private applyFilter;
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
    private rgbToHex;
    private blendColors;
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
    private isNonEmptyColor;
    private getWbsLevelStyle;
    private getLocalizedString;
    private updateHighContrastState;
    private resolveColor;
    private getSelectionColor;
    private getForegroundColor;
    /**
     * Gets the visual background color from settings or returns white as default.
     */
    private getVisualBackgroundColor;
    /**
     * Gets the font family from settings or returns the default system font stack.
     */
    private getFontFamily;
    private getBackgroundColor;
    private applyHighContrastStyling;
    /**
     * Applies font family settings to all key UI components that display text.
     * Called during update to ensure fonts reflect settings changes.
     */
    private applyFontFamilySettings;
    private formatTooltipValue;
    private buildTooltipDataItems;
    private getTooltipIdentities;
    private moveTaskTooltip;
    private showContextMenu;
    private clearLandingPage;
    private getRoleDisplayName;
    private getMissingRequiredRoles;
    private displayLandingPage;
    /**
     * Creates the Help button in the header area
     */
    private createHelpButton;
    /**
     * Shows the help overlay with user guide content
     */
    private showHelpOverlay;
    /**
     * Builds the help content sections using safe DOM manipulation
     */
    private buildHelpContent;
    /**
     * Hides the help overlay
     */
    private hideHelpOverlay;
    /**
     * Clears the help overlay from the DOM
     */
    private clearHelpOverlay;
    private debugLog;
}
