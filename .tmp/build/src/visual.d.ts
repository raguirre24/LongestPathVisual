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
    private selectedTaskLabel;
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
    constructor(options: VisualConstructorOptions);
    private forceCanvasRefresh;
    private debouncedUpdate;
    private requestUpdate;
    private applyPublishModeOptimizations;
    private setupSVGRenderingHints;
    private determineUpdateType;
    destroy(): void;
    private toggleTaskDisplayInternal;
    private toggleBaselineDisplayInternal;
    private togglePreviousUpdateDisplayInternal;
    private createOrUpdateToggleButton;
    private createOrUpdateBaselineToggleButton;
    private createOrUpdatePreviousUpdateToggleButton;
    private createConnectorLinesToggleButton;
    private createModeToggleButton;
    private toggleCriticalityMode;
    private createFloatThresholdControl;
    private createOrUpdateVisualTitle;
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
    private calculateCPMFromTask;
    private identifyPredecessorTasksFloatBased;
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
