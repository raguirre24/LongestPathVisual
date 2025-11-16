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
    private showAllTasksInternal;
    private showBaselineInternal;
    private showPreviousUpdateInternal;
    private isInitialLoad;
    private debug;
    private margin;
    private headerHeight;
    private dateLabelOffset;
    private floatTolerance;
    private defaultMaxTasks;
    private labelPaddingLeft;
    private dateBackgroundPadding;
    private taskLabelLineHeight;
    private minTaskWidthPixels;
    private monthYearFormatter;
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
    private lastViewport;
    private lastDataViewId;
    private renderStartTime;
    private predecessorIndex;
    private relationshipIndex;
    private allDrivingChains;
    private selectedPathIndex;
    private readonly VIEWPORT_CHANGE_THRESHOLD;
    private forceFullUpdate;
    private visualTitle;
    private tooltipClassName;
    private isUpdating;
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
    private readonly UI_TOKENS;
    constructor(options: VisualConstructorOptions);
    private forceCanvasRefresh;
    private debouncedUpdate;
    private requestUpdate;
    private applyPublishModeOptimizations;
    private setupSVGRenderingHints;
    private determineUpdateType;
    destroy(): void;
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
     * Creates the Mode Toggle (Longest Path ↔ Float-Based) with premium Fluent design
     * UPGRADED: Professional pill-style toggle with smooth animations and refined visuals
     */
    private createModeToggleButton;
    private toggleCriticalityMode;
    /**
     * UPGRADED: Creates the Float Threshold control with premium input design and enhanced UX
     */
    private createFloatThresholdControl;
    private toggleConnectorLinesDisplay;
    update(options: VisualUpdateOptions): void;
    private updateInternal;
    private handleViewportOnlyUpdate;
    private handleSettingsOnlyUpdate;
    private clearVisual;
    private drawHeaderDivider;
    private createArrowheadMarkers;
    private setupTimeBasedSVGAndScales;
    private setupVirtualScroll;
    private getCanvasMouseCoordinates;
    private showTaskTooltip;
    private updateHeaderElements;
    private calculateVisibleTasks;
    private handleScroll;
    private canvasHasContent;
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
    private drawProjectEndLine;
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
    private debugLog;
}
