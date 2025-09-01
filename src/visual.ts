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
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import { IBasicFilter, FilterType } from "powerbi-models";
import FilterAction = powerbi.FilterAction;
import PriorityQueue from "./priorityQueue";

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
    yOrder?: number;
    tooltipData?: Map<string, PrimitiveValue>;
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
    private toggleButtonGroup: Selection<SVGGElement, unknown, null, undefined>;
    private headerGridLayer: Selection<SVGGElement, unknown, null, undefined>;
    private tooltipDiv: Selection<HTMLDivElement, unknown, HTMLElement, any>;
    private canvasElement: HTMLCanvasElement | null = null;
    private canvasContext: CanvasRenderingContext2D | null = null;
    private useCanvasRendering: boolean = false;
    private CANVAS_THRESHOLD: number = 500; // Switch to canvas when more than 500 tasks
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

    // --- State properties remain the same ---
    private showAllTasksInternal: boolean = true;
    private isInitialLoad: boolean = true;

    // Debug flag to control verbose logging
    private debug: boolean = false;

    // --- Configuration/Constants ---
    private margin = { top: 10, right: 100, bottom: 40, left: 280 };
    private headerHeight = 110;
    private dateLabelOffset = 8;
    private floatTolerance = 0.001;
    private defaultMaxTasks = 500;
    private labelPaddingLeft = 10;
    private dateBackgroundPadding = { horizontal: 4, vertical: 2 };
    private taskLabelLineHeight = "1.1em";
    private minTaskWidthPixels = 1;
    private monthYearFormatter = timeFormat("%b-%y");

    // --- Store scales ---
    private xScale: ScaleTime<number, number> | null = null;
    private yScale: ScaleBand<string> | null = null;

    // --- Task selection ---
    private selectedTaskId: string | null = null;
    private selectedTaskName: string | null = null;
    private dropdownContainer: Selection<HTMLDivElement, unknown, null, undefined>;
    private dropdownInput: Selection<HTMLInputElement, unknown, null, undefined>;
    private dropdownList: Selection<HTMLDivElement, unknown, null, undefined>;
    private selectedTaskLabel: Selection<HTMLDivElement, unknown, null, undefined>;

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

    // Update type detection
    private lastViewport: IViewport | null = null;
    private lastDataViewId: string | null = null;

    // Performance monitoring
    private renderStartTime: number = 0;
    
    // Enhanced data structures for performance
    private predecessorIndex: Map<string, Set<string>> = new Map(); // taskId -> Set of tasks that have this as predecessor

    private relationshipIndex: Map<string, Relationship[]> = new Map(); // Quick lookup for relationships by successorId

    private readonly VIEWPORT_CHANGE_THRESHOLD = 0.3; // 30% change triggers full recalculation
    private forceFullUpdate: boolean = false;

    private visualTitle: Selection<HTMLDivElement, unknown, null, undefined>;
    private tooltipClassName: string;
    private isUpdating: boolean = false;
    private scrollHandlerBackup: any = null;

constructor(options: VisualConstructorOptions) {
    this.debugLog("--- Initializing Critical Path Visual (Plot by Date) ---");
    this.target = options.element;
    this.host = options.host;
    this.formattingSettingsService = new FormattingSettingsService();

    this.showAllTasksInternal = true;
    this.isInitialLoad = true;
    this.floatThreshold = 0;
    this.showConnectorLinesInternal = true;
    
    // Generate unique tooltip class name
    this.tooltipClassName = `critical-path-tooltip-${Date.now()}`;

    // --- Overall wrapper ---
    const visualWrapper = d3.select(this.target).append("div")
        .attr("class", "visual-wrapper")
        .style("height", "100%")
        .style("width", "100%")
        .style("overflow", "hidden");

    // --- Sticky Header Container ---
    this.stickyHeaderContainer = visualWrapper.append("div")
        .attr("class", "sticky-header-container")
        .style("position", "sticky")
        .style("top", "0")
        .style("left", "0")
        .style("width", "100%")
        .style("height", `${this.headerHeight}px`)
        .style("z-index", "10")
        .style("overflow", "hidden");

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

    // --- Scrollable Container for main chart content ---
    this.scrollableContainer = visualWrapper.append("div")
        .attr("class", "criticalPathContainer")
        .style("height", `calc(100% - ${this.headerHeight}px)`)
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

    // --- Layers within the main SVG ---
    this.gridLayer = this.mainGroup.append("g").attr("class", "grid-layer");
    this.arrowLayer = this.mainGroup.append("g").attr("class", "arrow-layer");
    this.taskLayer = this.mainGroup.append("g").attr("class", "task-layer");

    // --- Canvas layer for high-performance rendering ---
    this.canvasElement = document.createElement('canvas');
    this.canvasElement.style.position = 'absolute';
    this.canvasElement.style.pointerEvents = 'auto';
    this.canvasElement.className = 'canvas-layer';
    this.canvasElement.style.display = 'none';
    this.canvasElement.style.visibility = 'hidden';
    
    // Add canvas to the scrollable container, not the SVG
    this.scrollableContainer.node()?.appendChild(this.canvasElement);
    
    // Create D3 selection for the canvas
    this.canvasLayer = d3.select(this.canvasElement);

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

private determineUpdateType(options: VisualUpdateOptions): UpdateType {
    // Store and reset flag immediately to prevent race conditions
    const wasForced = this.forceFullUpdate;
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
}

public destroy(): void {
    // Remove this instance's tooltip
    d3.select("body").selectAll(`.${this.tooltipClassName}`).remove();
    
    // Clear any scroll listeners
    if (this.scrollListener && this.scrollableContainer) {
        this.scrollableContainer.on("scroll", null);
        this.scrollListener = null;
    }
    
    // Clear any timeouts
    if (this.scrollThrottleTimeout) {
        clearTimeout(this.scrollThrottleTimeout);
        this.scrollThrottleTimeout = null;
    }
    
    // Apply empty filter
    this.applyTaskFilter([]);
    
    this.debugLog("Critical Path Visual destroyed.");
}

    private toggleTaskDisplayInternal(): void {
        try {
            this.debugLog("Internal Toggle method called!");
            this.showAllTasksInternal = !this.showAllTasksInternal;
            this.debugLog("New showAllTasksInternal value:", this.showAllTasksInternal);
            
            // Update button text if button exists
            const buttonElement = this.headerSvg?.select(".toggle-button-group")?.select("text");
            if (buttonElement?.node()) {
                buttonElement.text(this.showAllTasksInternal ? "Show Longest Path" : "Show All Tasks");
            } else {
                console.warn("ToggleButtonGroup not found when trying to update text.");
            }
            
            if (!this.lastUpdateOptions) {
                console.error("Cannot trigger update - lastUpdateOptions is null during internal toggle.");
                return;
            }
            
            // ADDED: Force a full update for toggle changes
            this.forceFullUpdate = true;
            
            this.update(this.lastUpdateOptions);
            this.debugLog("Visual update triggered by internal toggle");
        } catch (error) {
            console.error("Error in internal toggle method:", error);
        }
    }

private createOrUpdateToggleButton(viewportWidth: number): void {
    if (!this.toggleButtonGroup || !this.headerSvg) return;

    // Remove all event handlers before clearing
    this.toggleButtonGroup.selectAll("*")
        .on("click", null)
        .on("mouseover", null)
        .on("mouseout", null);
        
    this.toggleButtonGroup.selectAll("*").remove();

    const buttonWidth = 120;
    const buttonHeight = 22;
    const buttonPadding = { left: 8, top: 4 };
    const buttonX = buttonPadding.left;
    const buttonY = buttonPadding.top;

    this.toggleButtonGroup
        .attr("transform", `translate(${buttonX}, ${buttonY})`);

    const buttonRect = this.toggleButtonGroup.append("rect")
        .attr("width", buttonWidth)
        .attr("height", buttonHeight)
        .attr("rx", 4)
        .attr("ry", 4)
        .style("fill", "#ffffff")
        .style("stroke", "#d0d0d0")
        .style("stroke-width", 1);

    const iconPadding = 8;
    this.toggleButtonGroup.append("path")
        .attr("d", this.showAllTasksInternal 
            ? "M2,0 L5,-2 L8,0 Z"
            : "M1,-2 L6,-2 M1,0 L8,0 M1,2 L7,2")
        .attr("transform", `translate(${iconPadding}, ${buttonHeight/2})`)
        .attr("stroke", this.showAllTasksInternal ? "#dc3545" : "#28a745")
        .attr("stroke-width", 1.2)
        .attr("fill", this.showAllTasksInternal ? "#dc3545" : "none")
        .attr("stroke-linecap", "round")
        .style("pointer-events", "none");

    this.toggleButtonGroup.append("text")
        .attr("x", buttonWidth / 2 + 4)
        .attr("y", buttonHeight / 2)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .style("font-family", "Segoe UI, sans-serif")
        .style("font-size", "11px")
        .style("fill", "#333")
        .style("font-weight", "400")
        .style("pointer-events", "none")
        .text(this.showAllTasksInternal ? "Show Critical" : "Show All");

    this.toggleButtonGroup
        .on("mouseover", function() { 
            d3.select(this).select("rect")
                .style("fill", "#f8f9fa")
                .style("stroke", "#999"); 
        })
        .on("mouseout", function() { 
            d3.select(this).select("rect")
                .style("fill", "#ffffff")
                .style("stroke", "#d0d0d0"); 
        });

    const clickOverlay = this.toggleButtonGroup.append("rect")
        .attr("width", buttonWidth)
        .attr("height", buttonHeight)
        .attr("rx", 4).attr("ry", 4)
        .style("fill", "transparent")
        .style("cursor", "pointer");

    const self = this;
    clickOverlay.on("click", function(event) {
        if (event) event.stopPropagation();
        self.toggleTaskDisplayInternal();
    });
}

    private createConnectorLinesToggleButton(viewportWidth?: number): void {
        if (!this.headerSvg) return;
        
        this.headerSvg.selectAll(".connector-toggle-group").remove();
        
        const showConnectorToggle = this.settings?.connectorLines?.showConnectorToggle?.value ?? false;
        if (!showConnectorToggle) return;
        
        const connectorToggleGroup = this.headerSvg.append("g")
            .attr("class", "connector-toggle-group")
            .style("cursor", "pointer");
        
        // Icon-only button
        const buttonSize = 22;
        const buttonX = 240; // After filter toggle
        const buttonY = 4;
        
        connectorToggleGroup.attr("transform", `translate(${buttonX}, ${buttonY})`);
        
        const buttonRect = connectorToggleGroup.append("rect")
            .attr("width", buttonSize)
            .attr("height", buttonSize)
            .attr("rx", 4)
            .attr("ry", 4)
            .style("fill", this.showConnectorLinesInternal ? "#ffffff" : "#f5f5f5")
            .style("stroke", "#d0d0d0")
            .style("stroke-width", 1);
        
        // Connector icon
        const iconCenter = buttonSize / 2;
        connectorToggleGroup.append("path")
            .attr("d", `M${iconCenter-5},${iconCenter-2} L${iconCenter},${iconCenter+2} L${iconCenter+5},${iconCenter-2}`)
            .attr("stroke", this.showConnectorLinesInternal ? "#52c41a" : "#999")
            .attr("stroke-width", 1.5)
            .attr("fill", "none")
            .attr("stroke-dasharray", this.showConnectorLinesInternal ? "none" : "2,2");
        
        // Tooltip
        connectorToggleGroup.append("title")
            .text(this.showConnectorLinesInternal ? "Hide connector lines" : "Show connector lines");
        
        // Hover effect
        connectorToggleGroup
            .on("mouseover", function() { 
                d3.select(this).select("rect").style("fill", "#f8f9fa");
            })
            .on("mouseout", function() { 
                d3.select(this).select("rect")
                    .style("fill", self.showConnectorLinesInternal ? "#ffffff" : "#f5f5f5");
            });
        
        const self = this;
        connectorToggleGroup.on("click", function(event) {
            if (event) event.stopPropagation();
            self.toggleConnectorLinesDisplay();
        });
    }

private createModeToggleButton(viewportWidth: number): void {
    if (!this.headerSvg) return;
    
    this.headerSvg.selectAll(".mode-toggle-group").remove();
    
    const currentMode = this.settings?.criticalityMode?.calculationMode?.value?.value || 'longestPath';
    const isFloatBased = currentMode === 'floatBased';
    const dataView = this.lastUpdateOptions?.dataViews?.[0];
    const hasTotalFloat = dataView ? this.hasDataRole(dataView, 'taskTotalFloat') : false;
    
    const modeToggleGroup = this.headerSvg.append("g")
        .attr("class", "mode-toggle-group")
        .style("cursor", hasTotalFloat ? "pointer" : "not-allowed");
    
    // Increased width for better spacing
    const buttonWidth = 220; // Increased from 180
    const buttonHeight = 24;
    const buttonX = 136;
    const buttonY = 4;
    
    modeToggleGroup.attr("transform", `translate(${buttonX}, ${buttonY})`);
    
    // Main button container with shadow effect
    const buttonG = modeToggleGroup.append("g")
        .attr("class", "mode-button-container");
    
    // Drop shadow filter
    const filterId = `mode-shadow-${Date.now()}`;
    const defs = this.headerSvg.select("defs").empty() 
        ? this.headerSvg.append("defs") 
        : this.headerSvg.select("defs");
    
    const filter = defs.append("filter")
        .attr("id", filterId)
        .attr("x", "-50%")
        .attr("y", "-50%")
        .attr("width", "200%")
        .attr("height", "200%");
    
    filter.append("feDropShadow")
        .attr("dx", 0)
        .attr("dy", 1)
        .attr("stdDeviation", 1)
        .attr("flood-opacity", 0.1);
    
    // Button background
    const buttonRect = buttonG.append("rect")
        .attr("width", buttonWidth)
        .attr("height", buttonHeight)
        .attr("rx", 12)
        .attr("ry", 12)
        .style("fill", isFloatBased ? "#fff7e6" : "#e6f4ff")
        .style("stroke", isFloatBased ? "#faad14" : "#1890ff")
        .style("stroke-width", 1.5)
        .style("filter", hasTotalFloat ? `url(#${filterId})` : "none")
        .style("opacity", hasTotalFloat ? 1 : 0.4);
    
    // Mode indicator pill with better spacing
    const pillG = buttonG.append("g")
        .attr("transform", `translate(8, ${buttonHeight/2})`); // Increased left padding
    
    // Adjusted pill dimensions for better spacing
    const pillWidth = 100; // Increased from 80
    const pillHeight = 16;
    const pillX = isFloatBased ? pillWidth/2 : 0; // Adjusted positioning
    
    // Background track for the toggle
    pillG.append("rect")
        .attr("class", "mode-pill-bg")
        .attr("x", 0)
        .attr("y", -pillHeight/2)
        .attr("width", pillWidth)
        .attr("height", pillHeight)
        .attr("rx", 8)
        .attr("ry", 8)
        .style("fill", "#e8e8e8")
        .style("opacity", 0.8);
    
    // Sliding pill indicator
    const slidingPill = pillG.append("rect")
        .attr("class", "mode-pill")
        .attr("x", pillX)
        .attr("y", -pillHeight/2)
        .attr("width", pillWidth/2)
        .attr("height", pillHeight)
        .attr("rx", 8)
        .attr("ry", 8)
        .style("fill", isFloatBased ? "#faad14" : "#1890ff")
        .style("transition", "all 0.3s ease");
    
    // Mode labels with better positioning
    const labelY = 0;
    
    // CPM label - positioned at 1/4 of pill width
    pillG.append("text")
        .attr("x", pillWidth/4)
        .attr("y", labelY)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .style("font-family", "Segoe UI, sans-serif")
        .style("font-size", "11px") // Slightly larger
        .style("font-weight", isFloatBased ? "400" : "600")
        .style("fill", isFloatBased ? "#666" : "white")
        .style("pointer-events", "none")
        .style("letter-spacing", "0.5px") // Add slight letter spacing
        .text("CPM");
    
    // Float label - positioned at 3/4 of pill width
    pillG.append("text")
        .attr("x", 3*pillWidth/4)
        .attr("y", labelY)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .style("font-family", "Segoe UI, sans-serif")
        .style("font-size", "11px") // Slightly larger
        .style("font-weight", isFloatBased ? "600" : "400")
        .style("fill", isFloatBased ? "white" : "#666")
        .style("pointer-events", "none")
        .style("letter-spacing", "0.5px") // Add slight letter spacing
        .text("Float");
    
    // Current mode text with adjusted position
    buttonG.append("text")
        .attr("x", 118) // Adjusted position due to wider pill
        .attr("y", buttonHeight/2)
        .attr("dominant-baseline", "central")
        .style("font-family", "Segoe UI, sans-serif")
        .style("font-size", "11px")
        .style("fill", "#333")
        .style("pointer-events", "none")
        .text(isFloatBased ? "Float-Based" : "Longest Path");
    
    // Tooltip
    modeToggleGroup.append("title")
        .text(hasTotalFloat 
            ? `Current: ${isFloatBased ? 'Float-Based' : 'Longest Path (CPM)'}\nClick to switch modes`
            : "Float-Based mode requires Task Total Float field");
    
    if (hasTotalFloat) {
        modeToggleGroup
            .on("mouseover", function() {
                d3.select(this).select(".mode-button-container rect")
                    .style("fill", isFloatBased ? "#fff1e6" : "#d9f0ff");
            })
            .on("mouseout", function() {
                d3.select(this).select(".mode-button-container rect")
                    .style("fill", isFloatBased ? "#fff7e6" : "#e6f4ff");
            });
        
        const self = this;
        modeToggleGroup.on("click", function(event) {
            if (event) event.stopPropagation();
            self.toggleCriticalityMode();
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
            
            // Persist the reset threshold
            this.host.persistProperties({
                merge: [{
                    objectName: "persistedState",
                    properties: { floatThreshold: 0 },
                    selector: null
                }]
            });
        }
        
        // Update the settings value
        if (this.settings?.criticalityMode?.calculationMode) {
            this.settings.criticalityMode.calculationMode.value = {
                value: newMode,
                displayName: newMode === 'longestPath' ? 'Longest Path (CPM)' : 'Float-Based'
            };
        }
        
        // Persist the new mode
        this.host.persistProperties({
            merge: [{
                objectName: "criticalityMode",
                properties: { calculationMode: newMode },
                selector: null
            }]
        });
        
        // Force a full update
        this.forceFullUpdate = true;
        
        if (!this.lastUpdateOptions) {
            console.error("Cannot trigger update - lastUpdateOptions is null during mode toggle.");
            return;
        }
        
        // Trigger update
        this.update(this.lastUpdateOptions);
        this.debugLog("Visual update triggered by mode toggle");
        this.createOrUpdateVisualTitle();
        
    } catch (error) {
        console.error("Error toggling criticality mode:", error);
    }
}

private createFloatThresholdControl(): void {
    this.stickyHeaderContainer.selectAll(".float-threshold-wrapper").remove();

    // Only show in float-based mode when near-critical is enabled
    const currentMode = this.settings?.criticalityMode?.calculationMode?.value?.value || 'longestPath';
    const isFloatBased = currentMode === 'floatBased';
    
    if (!this.showNearCritical || !isFloatBased) {
        this.floatThresholdInput = null as any;
        return;
    }

    // Enhanced control design
    const controlContainer = this.stickyHeaderContainer.append("div")
        .attr("class", "float-threshold-wrapper")
        .style("position", "absolute")
        .style("right", "10px")
        .style("top", "4px") // CHANGED: First row (was "32px")
        .style("display", "flex")
        .style("align-items", "center")
        .style("gap", "8px")
        .style("height", "28px")
        .style("padding", "0 12px")
        .style("background-color", "#ffffff")
        .style("border", "1px solid #d0d0d0")
        .style("border-radius", "14px")
        .style("box-shadow", "0 1px 3px rgba(0,0,0,0.05)");

    // Icon and label container
    const labelContainer = controlContainer.append("div")
        .style("display", "flex")
        .style("align-items", "center")
        .style("gap", "6px");

    // Near-critical indicator with gradient
    const iconSize = 10;
    const iconSvg = labelContainer.append("svg")
        .attr("width", iconSize)
        .attr("height", iconSize)
        .attr("viewBox", `0 0 ${iconSize} ${iconSize}`);
    
    // Gradient definition
    const gradientId = `near-critical-gradient-${Date.now()}`;
    const gradient = iconSvg.append("defs")
        .append("radialGradient")
        .attr("id", gradientId);
    
    gradient.append("stop")
        .attr("offset", "0%")
        .attr("stop-color", "#FFB84D");
    
    gradient.append("stop")
        .attr("offset", "100%")
        .attr("stop-color", "#F7941F");
    
    iconSvg.append("circle")
        .attr("cx", iconSize/2)
        .attr("cy", iconSize/2)
        .attr("r", iconSize/2)
        .attr("fill", `url(#${gradientId})`);

    // Descriptive label
    labelContainer.append("span")
        .style("font-size", "12px")
        .style("color", "#333")
        .style("font-family", "Segoe UI, sans-serif")
        .style("font-weight", "500")
        .text("Near-Critical ≤");

    // Enhanced input field
    this.floatThresholdInput = controlContainer.append("input")
        .attr("type", "number")
        .attr("min", "0")
        .attr("step", "1") // CHANGED: From "0.5" to "1"
        .attr("value", this.floatThreshold)
        .style("width", "50px")
        .style("height", "20px")
        .style("padding", "2px 6px")
        .style("border", "1px solid #d9d9d9")
        .style("border-radius", "4px")
        .style("font-size", "12px")
        .style("font-family", "Segoe UI, sans-serif")
        .style("font-weight", "500")
        .style("text-align", "center")
        .style("outline", "none")
        .style("background-color", "white")
        .style("transition", "border-color 0.2s ease");

    // Unit label
    controlContainer.append("span")
        .style("font-size", "11px")
        .style("color", "#666")
        .style("font-family", "Segoe UI, sans-serif")
        .text("days");

    // Help icon with tooltip
    const helpIcon = controlContainer.append("div")
        .style("width", "16px")
        .style("height", "16px")
        .style("border-radius", "50%")
        .style("background-color", "#f0f0f0")
        .style("display", "flex")
        .style("align-items", "center")
        .style("justify-content", "center")
        .style("cursor", "help")
        .style("font-size", "10px")
        .style("color", "#666")
        .style("font-family", "Segoe UI, sans-serif")
        .style("font-weight", "600")
        .text("?");

    helpIcon.append("title")
        .text("Tasks with Total Float ≤ this value will be highlighted as near-critical");

    // Hover effects
    this.floatThresholdInput
        .on("focus", function() {
            d3.select(this).style("border-color", "#40a9ff");
        })
        .on("blur", function() {
            d3.select(this).style("border-color", "#d9d9d9");
        });

    // Input handler
    const self = this;
    this.floatThresholdInput.on("input", function() {
        const value = parseFloat(this.value);
        self.floatThreshold = isNaN(value) ? 0 : Math.max(0, value);
        
        // Visual feedback
        d3.select(this)
            .transition()
            .duration(200)
            .style("background-color", "#e6f7ff")
            .transition()
            .duration(200)
            .style("background-color", "white");
        
        self.host.persistProperties({
            merge: [{
                objectName: "persistedState",
                properties: { floatThreshold: self.floatThreshold },
                selector: null
            }]
        });
        
        self.forceFullUpdate = true;
        if (self.lastUpdateOptions) {
            self.update(self.lastUpdateOptions);
        }
    });
}

    private createOrUpdateVisualTitle(): void {
        if (!this.stickyHeaderContainer) return;

        // Configuration constants for better readability and maintenance
        const CONFIG = {
            COLORS: {
                floatBased: "#faad14",
                longestPath: "#1890ff",
                textPrimary: "#333",
                textSecondary: "#666"
            },
            TOOLTIPS: {
                floatBased: "Mode: Float-Based. Criticality is determined by the 'Task Total Float' field.",
                longestPath: "Mode: Longest Path (CPM). Criticality is calculated to find the longest sequence of tasks."
            }
        };

        // Prepare data for the D3 data-join pattern
        const mode = this.settings?.criticalityMode?.calculationMode?.value?.value || 'longestPath';
        const isFloatBased = mode === 'floatBased';
        const titleData = [{
            mode,
            displayName: isFloatBased ? 'Float-Based Critical Path' : 'Longest Path (CPM)',
            color: isFloatBased ? CONFIG.COLORS.floatBased : CONFIG.COLORS.longestPath,
            tooltip: isFloatBased ? CONFIG.TOOLTIPS.floatBased : CONFIG.TOOLTIPS.longestPath,
            selectedTaskName: (this.selectedTaskId && this.selectedTaskName) ? this.selectedTaskName : null
        }];

        // Use the D3 data-join pattern for efficient updates
        const titleSelection = this.stickyHeaderContainer.selectAll<HTMLDivElement, typeof titleData[0]>(".visual-title")
            .data(titleData);

        // --- ENTER: Create the title's structure the first time ---
        const titleEnter = titleSelection.enter().append("div")
            .attr("class", "visual-title")
            .style("position", "absolute")
            .style("top", "4px")
            .style("left", "50%")
            .style("transform", "translateX(-50%)")
            .style("z-index", "15")
            // MODIFICATION 1: Use a vertical layout for title and subtitle
            .style("display", "flex")
            .style("flex-direction", "column")
            .style("align-items", "center")
            .style("gap", "2px") // Adds a small space between title and subtitle
            .style("pointer-events", "none")
            .style("max-width", "60%");

        // New container for the top row to keep the icon and mode name together
        const topRowEnter = titleEnter.append("div")
            .attr("class", "title-top-row")
            .style("display", "flex")
            .style("align-items", "center")
            .style("gap", "6px");

        topRowEnter.append("div").attr("class", "mode-icon");
        topRowEnter.append("span").attr("class", "mode-name");

        // Container for the subtitle (selected task)
        const subtitleEnter = titleEnter.append("div")
            .attr("class", "title-subtitle")
            .style("text-align", "center");

        // The span for the task name, which will be populated on update
        subtitleEnter.append("span")
            .attr("class", "selected-task-name")
            .style("white-space", "nowrap")
            .style("overflow", "hidden")
            .style("text-overflow", "ellipsis")
            .style("display", "inline-block"); // Required for truncation to work

        // --- UPDATE: Merge enter and update selections to apply dynamic styles ---
        const titleUpdate = titleEnter.merge(titleSelection);
        
        titleUpdate
            .attr("title", d => d.tooltip)
            .transition().duration(200)
            .style("opacity", 1);
            
        // Update the top row elements
        const topRowUpdate = titleUpdate.select(".title-top-row");
        
        topRowUpdate.select(".mode-icon")
            .style("width", "8px")
            .style("height", "8px")
            .style("border-radius", "50%")
            .style("flex-shrink", "0")
            .style("background-color", d => d.color);

        topRowUpdate.select(".mode-name")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", "13px")
            .style("font-weight", "600")
            .style("color", CONFIG.COLORS.textPrimary)
            .text(d => d.displayName);
            
        // Update the subtitle section
        const subtitleUpdate = titleUpdate.select<HTMLDivElement>(".title-subtitle");
        
        subtitleUpdate
            .style("display", d => d.selectedTaskName ? "block" : "none");
            
        subtitleUpdate.select(".selected-task-name")
            .style("font-family", "Segoe UI, sans-serif")
            .style("font-size", "11px")
            .style("color", CONFIG.COLORS.textSecondary)
            .style("font-weight", "normal")
            .style("max-width", "600px")
            .attr("title", d => d.selectedTaskName) // Full name on hover
            .text(d => d.selectedTaskName ? `Tracing: ${d.selectedTaskName}` : "");

        // --- EXIT ---
        titleSelection.exit()
            .transition().duration(200)
            .style("opacity", 0)
            .remove();
    }

    private toggleConnectorLinesDisplay(): void {
        try {
            this.debugLog("Connector Lines Toggle method called!");
            this.showConnectorLinesInternal = !this.showConnectorLinesInternal;
            this.debugLog("New showConnectorLinesInternal value:", this.showConnectorLinesInternal);

            // Only update the button text if the button is visible
            if (this.settings?.connectorLines?.showConnectorToggle?.value) {
                this.headerSvg.select(".connector-toggle-group").select("text")
                    .text(this.showConnectorLinesInternal ? "Hide Connector Lines" : "Show Connector Lines");
            }

            if (!this.lastUpdateOptions) {
                console.error("Cannot trigger update - lastUpdateOptions is null during connector toggle.");
                return;
            }
            
            // ADDED: Force a full update for toggle changes
            this.forceFullUpdate = true;
            
            this.update(this.lastUpdateOptions);
            this.debugLog("Visual update triggered by connector toggle");
        } catch (error) {
            console.error("Error in connector toggle method:", error);
        }
    }

    public update(options: VisualUpdateOptions) {
        void this.updateInternal(options);
    }

private async updateInternal(options: VisualUpdateOptions) {
    this.debugLog("--- Visual Update Start ---");
    this.renderStartTime = performance.now();
    
    // Prevent concurrent updates
    if (this.isUpdating) {
        this.debugLog("Update already in progress, skipping");
        return;
    }
    
    this.isUpdating = true;

    try {
        // Determine update type for optimization
        const updateType = this.determineUpdateType(options);
        this.debugLog(`Update type detected: ${updateType}`);
        
        // Handle scroll reset for full updates
        if (updateType === UpdateType.Full && this.scrollableContainer?.node()) {
            // Temporarily disable scroll handler
            this.scrollHandlerBackup = this.scrollListener;
            if (this.scrollListener) {
                this.scrollableContainer.on("scroll", null);
            }
            
            // Reset scroll position
            const node = this.scrollableContainer.node();
            if (node.scrollTop > 0) {
                this.debugLog("EARLY SCROLL RESET: Full update detected, resetting scrollTop to 0.");
                node.scrollTop = 0;
            }
        }
        
        // Store current viewport for comparison
        this.lastViewport = options.viewport;
        
        // Handle viewport-only updates efficiently
        if (updateType === UpdateType.ViewportOnly && this.allTasksData.length > 0) {
            this.handleViewportOnlyUpdate(options);
            return;
        }
        
        // Handle settings-only updates efficiently
        if (updateType === UpdateType.SettingsOnly && this.allTasksData.length > 0) {
            this.handleSettingsOnlyUpdate(options);
            return;
        }
        
        // Continue with normal update for other types
        this.lastUpdateOptions = options;

        if (!options || !options.dataViews || !options.dataViews[0] || !options.viewport) {
            this.displayMessage("Required options not available."); 
            return;
        }
        
        const dataView = options.dataViews[0];
        const viewport = options.viewport;
        const viewportHeight = viewport.height;
        const viewportWidth = viewport.width;

        this.debugLog("Viewport:", viewportWidth, "x", viewportHeight);

        this.settings = this.formattingSettingsService.populateFormattingSettingsModel(VisualSettings, dataView);

        this.showNearCritical = this.settings.displayOptions.showNearCritical.value;

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
            this.isInitialLoad = false;
        }

        const criticalColor = this.settings.taskAppearance.criticalPathColor.value.value;
        const connectorColor = this.settings.connectorLines.connectorColor.value.value;

        this.margin.left = this.settings.layoutSettings.leftMargin.value;

        this.clearVisual();
        this.updateHeaderElements(viewportWidth);
        this.createFloatThresholdControl();
        this.createTaskSelectionDropdown();
        this.createTraceModeToggle();

        if (!this.validateDataView(dataView)) {
            const mode = this.settings?.criticalityMode?.calculationMode?.value?.value || 'longestPath';
            if (mode === 'floatBased') {
                this.displayMessage("Float-Based mode requires: Task ID, Task Total Float, Start Date, Finish Date.");
            } else {
                this.displayMessage("Longest Path mode requires: Task ID, Duration, Start Date, Finish Date.");
            }
            return;
        }
        this.debugLog("Data roles validated.");

        // Transform data
        this.transformDataOptimized(dataView);
        
        // Validate selected task after data transformation
        if (this.selectedTaskId && !this.taskIdToTask.has(this.selectedTaskId)) {
            this.debugLog(`Selected task ${this.selectedTaskId} no longer exists in data`);
            this.selectTask(null, null);
        }
        
        if (this.allTasksData.length === 0) {
            this.displayMessage("No valid task data found to display."); 
            return;
        }
        this.debugLog(`Transformed ${this.allTasksData.length} tasks.`);

        // Restore selected task name after data is loaded
        if (this.selectedTaskId) {
            const selectedTask = this.taskIdToTask.get(this.selectedTaskId);
            this.selectedTaskName = selectedTask ? selectedTask.name || null : null;
        }

        // Create or update the task selection dropdown
        this.createTaskSelectionDropdown();

        // Populate input with the persisted task name if available
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
        
        // Enable task selection flag
        const enableTaskSelection = this.settings.taskSelection.enableTaskSelection.value;
        
        // Get criticality mode
        const mode = this.settings.criticalityMode.calculationMode.value.value;
        
        // Task-specific path calculation if task selected
        let tasksInPathToTarget = new Set<string>();
        let tasksInPathFromTarget = new Set<string>();

        if (enableTaskSelection && this.selectedTaskId) {
            // Get the trace mode from settings or UI toggle
            const traceModeFromSettings = this.settings.taskSelection.traceMode.value.value;
            const effectiveTraceMode = this.traceMode || traceModeFromSettings;
            
            if (mode === "floatBased") {
                // Float-Based mode with task selection
                this.applyFloatBasedCriticality();
                
                if (effectiveTraceMode === "forward") {
                    tasksInPathFromTarget = this.identifySuccessorTasksFloatBased(this.selectedTaskId);
                    this.debugLog(`Float-Based: Identified ${tasksInPathFromTarget.size} tasks forward from ${this.selectedTaskId}`);
                } else {
                    tasksInPathToTarget = this.identifyPredecessorTasksFloatBased(this.selectedTaskId);
                    this.debugLog(`Float-Based: Identified ${tasksInPathToTarget.size} tasks backward to ${this.selectedTaskId}`);
                }
            } else {
                // P6 Longest Path mode with task selection
                if (effectiveTraceMode === "forward") {
                    this.calculateCPMFromTask(this.selectedTaskId);
                    tasksInPathFromTarget = this.identifyDrivingSuccessorTasks(this.selectedTaskId);
                    this.debugLog(`P6: Identified ${tasksInPathFromTarget.size} tasks in driving path from ${this.selectedTaskId}`);
                } else {
                    this.calculateCPMToTask(this.selectedTaskId);
                    tasksInPathToTarget = this.identifyDrivingPredecessorTasks(this.selectedTaskId);
                    this.debugLog(`P6: Identified ${tasksInPathToTarget.size} tasks in driving path to ${this.selectedTaskId}`);
                }
            }
        } else {
            // No task selected - use appropriate criticality determination
            if (mode === "floatBased") {
                // Apply Float-Based criticality
                this.applyFloatBasedCriticality();
                this.debugLog(`Float-Based criticality applied. Found ${this.allTasksData.filter(t => t.isCritical).length} critical tasks.`);
            } else {
                // Use P6 reflective approach for Longest Path
                this.identifyLongestPathFromP6();
                this.debugLog(`P6 longest path identified. Found ${this.allTasksData.filter(t => t.isCritical).length} critical tasks.`);
            }
        }

        // --- Filtering/Limiting/Sorting logic ---
        this.debugLog(`Filtering tasks based on internal state: showAllTasksInternal = ${this.showAllTasksInternal}`);

        // Sort tasks by early start (or start date for P6)
        const tasksSortedByES = this.allTasksData
            .filter(task => task.startDate instanceof Date && !isNaN(task.startDate.getTime()))
            .sort((a, b) => (a.startDate?.getTime() ?? 0) - (b.startDate?.getTime() ?? 0));
            
        // Get critical path tasks AND near-critical tasks
        const criticalPathTasks = tasksSortedByES.filter(task => task.isCritical);
        const nearCriticalTasks = tasksSortedByES.filter(task => task.isNearCritical);
        const criticalAndNearCriticalTasks = tasksSortedByES.filter(task => task.isCritical || task.isNearCritical);

        // Handle task selection with showAllTasksInternal state
        let tasksToConsider: Task[] = [];

        if (enableTaskSelection && this.selectedTaskId) {
            // Get the trace mode from settings or UI toggle
            const traceModeFromSettings = this.settings.taskSelection.traceMode.value.value;
            const effectiveTraceMode = this.traceMode || traceModeFromSettings;
            
            if (mode === "floatBased") {
                // FLOAT-BASED MODE WITH TASK SELECTION
                if (effectiveTraceMode === "forward") {
                    // Forward tracing in Float-Based mode
                    if (this.showAllTasksInternal) {
                        // Show all successor tasks
                        tasksToConsider = tasksSortedByES.filter(task => 
                            tasksInPathFromTarget.has(task.internalId));
                    } else {
                        // Show only critical/near-critical tasks that are also in the forward path
                        tasksToConsider = tasksSortedByES.filter(task => 
                            tasksInPathFromTarget.has(task.internalId) && 
                            (task.isCritical || task.isNearCritical));
                    }
                } else {
                    // Backward tracing in Float-Based mode
                    if (this.showAllTasksInternal) {
                        // Show all predecessor tasks
                        tasksToConsider = tasksSortedByES.filter(task => 
                            tasksInPathToTarget.has(task.internalId));
                    } else {
                        // Show only critical/near-critical tasks that are also in the backward path
                        tasksToConsider = tasksSortedByES.filter(task => 
                            tasksInPathToTarget.has(task.internalId) && 
                            (task.isCritical || task.isNearCritical));
                    }
                }
                
                // Always include the selected task itself
                const selectedTask = this.taskIdToTask.get(this.selectedTaskId);
                if (selectedTask && !tasksToConsider.find(t => t.internalId === this.selectedTaskId)) {
                    tasksToConsider.push(selectedTask);
                }
                
            } else {
                // P6 LONGEST PATH MODE WITH TASK SELECTION
                if (effectiveTraceMode === "forward") {
                    // Handle forward tracing
                    if (this.showAllTasksInternal) {
                        // "Show All Tasks" mode + task selected = all successor tasks
                        tasksToConsider = tasksSortedByES.filter(task => 
                            tasksInPathFromTarget.has(task.internalId));
                    } else {
                        // "Show Critical Only" mode + task selected = critical path from target
                        tasksToConsider = criticalAndNearCriticalTasks;
                    }
                } else {
                    // Handle backward tracing
                    if (this.showAllTasksInternal) {
                        // "Show All Tasks" mode + task selected = all predecessor tasks
                        tasksToConsider = tasksSortedByES.filter(task => 
                            tasksInPathToTarget.has(task.internalId));
                    } else {
                        // "Show Critical Only" mode + task selected = critical path to target
                        tasksToConsider = criticalAndNearCriticalTasks;
                    }
                }
            }
        } else {
            // No task selected, use standard toggle behavior
            tasksToConsider = this.showAllTasksInternal
                ? tasksSortedByES
                : (criticalAndNearCriticalTasks.length > 0) ? criticalAndNearCriticalTasks : tasksSortedByES;
        }

        this.debugLog(`Tasks to consider for display (after filtering): ${tasksToConsider.length}`);

        // Update toggle button text
        if (this.toggleButtonGroup) {
            this.toggleButtonGroup.select("text")
                .text(this.showAllTasksInternal ? "Show Critical" : "Show All");
        }

        const maxTasksToShowSetting = this.settings.layoutSettings.maxTasksToShow.value;
        const limitedTasks = this.limitTasks(tasksToConsider, maxTasksToShowSetting);
        if (limitedTasks.length === 0) {
            this.displayMessage("No tasks to display after filtering/limiting."); 
            return;
        }
        this.debugLog(`Tasks after limiting to ${maxTasksToShowSetting}: ${limitedTasks.length}`);

        // Final check for valid dates required for plotting
        const tasksToPlot = limitedTasks.filter(task =>
            task.startDate instanceof Date && !isNaN(task.startDate.getTime()) &&
            task.finishDate instanceof Date && !isNaN(task.finishDate.getTime()) &&
            task.finishDate >= task.startDate
        );
        if (tasksToPlot.length === 0) {
            if (limitedTasks.length > 0) {
                this.displayMessage("Selected tasks lack valid Start/Finish dates required for plotting.");
                console.warn("Update aborted: All limited tasks filtered out due to invalid dates.");
            } else {
                this.displayMessage("No tasks with valid dates to display.");
                console.warn("Update aborted: No tasks with valid dates.");
            }
            return;
        }
        if (tasksToPlot.length < limitedTasks.length) {
            console.warn(`Filtered out ${limitedTasks.length - tasksToPlot.length} tasks due to missing/invalid Start/Finish dates.`);
        }
        this.debugLog(`Tasks ready for plotting (with valid dates): ${tasksToPlot.length}`);

        tasksToPlot.sort((a, b) => (a.startDate?.getTime() ?? 0) - (b.startDate?.getTime() ?? 0));
        tasksToPlot.forEach((task, index) => { task.yOrder = index; });
        const tasksToShow = tasksToPlot;
        this.debugLog("Assigned yOrder to tasks for plotting.");
        this.applyTaskFilter(tasksToShow.map(t => t.id));

        // --- Calculate dimensions and scales ---
        const taskHeight = this.settings.taskAppearance.taskHeight.value;
        const taskPadding = this.settings.layoutSettings.taskPadding.value;
        const taskCount = tasksToShow.length;
        const chartContentHeight = Math.max(50, taskCount * (taskHeight + taskPadding));
        const totalSvgHeight = chartContentHeight + this.margin.top + this.margin.bottom;

        const scaleSetupResult = this.setupTimeBasedSVGAndScales(
            { width: viewportWidth, height: totalSvgHeight },
            tasksToShow
        );
        this.xScale = scaleSetupResult.xScale;
        this.yScale = scaleSetupResult.yScale;
        const chartWidth = scaleSetupResult.chartWidth;
        const calculatedChartHeight = scaleSetupResult.calculatedChartHeight;

        if (!this.xScale || !this.yScale) {
            this.displayMessage("Could not create time/band scale. Check Start/Finish dates."); 
            return;
        }
        this.debugLog(`Chart width: ${chartWidth}, Calculated chart height (used by yScale): ${calculatedChartHeight}`);

        // --- Set SVG dimensions ---
        this.mainSvg.attr("width", viewportWidth);
        this.mainSvg.attr("height", totalSvgHeight);
        this.headerSvg.attr("width", viewportWidth);

        // --- Apply transforms ---
        this.mainGroup.attr("transform", `translate(${this.margin.left}, ${this.margin.top})`);
        this.headerGridLayer.attr("transform", `translate(${this.margin.left}, 0)`);

        // --- Scrolling logic ---
        const availableContentHeight = viewportHeight - this.headerHeight;
        if (totalSvgHeight > availableContentHeight && taskCount > 1) {
            this.debugLog("Enabling vertical scroll.");
            this.scrollableContainer.style("height", `${availableContentHeight}px`)
                                .style("overflow-y", "scroll");
        } else {
            this.debugLog("Disabling vertical scroll.");
            this.scrollableContainer.style("height", `${Math.min(totalSvgHeight, availableContentHeight)}px`)
                                .style("overflow-y", "hidden");
        }

        // Setup virtual scrolling
        this.debugLog("Setting up virtual scrolling...");
        this.setupVirtualScroll(tasksToShow, taskHeight, taskPadding);

        // Get only visible tasks for first draw
        const visibleTasks = tasksToShow.slice(this.viewportStartIndex, this.viewportEndIndex + 1);
        this.debugLog(`Drawing ${visibleTasks.length} of ${tasksToShow.length} tasks initially visible`);

        this.debugLog("Drawing visual elements...");
        this.drawVisualElements(visibleTasks, this.xScale, this.yScale, chartWidth, calculatedChartHeight);
        
        const renderEndTime = performance.now();
        this.debugLog(`Total render time: ${renderEndTime - this.renderStartTime}ms`);
        this.debugLog("Drawing complete.");

    } catch (error) {
        console.error("--- ERROR during visual update ---", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.displayMessage(`Error: ${errorMessage}`);
        this.isInitialLoad = true;
        this.forceFullUpdate = false; // Ensure flag is reset on error
    } finally {
        this.isUpdating = false;
        
        // Re-enable scroll handler after update completes
        if (this.scrollHandlerBackup && this.scrollableContainer) {
            // Use setTimeout to ensure DOM updates are complete
            setTimeout(() => {
                if (this.scrollableContainer && this.scrollHandlerBackup) {
                    this.scrollableContainer.on("scroll", this.scrollHandlerBackup);
                    this.scrollHandlerBackup = null;
                }
            }, 0);
        }
    }
    this.debugLog("--- Visual Update End ---");
}

    private handleViewportOnlyUpdate(options: VisualUpdateOptions): void {
        this.debugLog("Performing viewport-only update");
        const viewportWidth = options.viewport.width;
        const viewportHeight = options.viewport.height;
        
        // Update buttons and header elements
        this.createOrUpdateToggleButton(viewportWidth);
        this.drawHeaderDivider(viewportWidth);
        this.createConnectorLinesToggleButton(viewportWidth);
        
        // Recalculate chart dimensions
        const chartWidth = Math.max(10, viewportWidth - this.settings.layoutSettings.leftMargin.value - this.margin.right);
        const availableContentHeight = viewportHeight - this.headerHeight;
        const totalSvgHeight = this.taskTotalCount * this.taskElementHeight + 
                             this.margin.top + this.margin.bottom;
        
        // Update scroll container
        if (totalSvgHeight > availableContentHeight) {
            this.scrollableContainer.style("height", `${availableContentHeight}px`)
                                  .style("overflow-y", "scroll");
        } else {
            this.scrollableContainer.style("height", `${Math.min(totalSvgHeight, availableContentHeight)}px`)
                                  .style("overflow-y", "hidden");
        }
        
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
        
        if (showHorzGridLines && this.yScale) {
            const currentLeftMargin = this.settings.layoutSettings.leftMargin.value;
            const visibleTasks = this.allTasksToShow.slice(this.viewportStartIndex, this.viewportEndIndex + 1);
            this.drawHorizontalGridLines(visibleTasks, this.yScale, chartWidth, currentLeftMargin, 
                                        this.yScale.range()[1]);
        }
        
        if (showVertGridLines && this.xScale) {
            this.drawVerticalGridLines(this.xScale, this.yScale.range()[1], 
                                      this.gridLayer, this.headerGridLayer);
        }
        
        // Redraw visible tasks with updated dimensions
        if (this.xScale && this.yScale) {
            const visibleTasks = this.allTasksToShow.slice(this.viewportStartIndex, this.viewportEndIndex + 1);
            this.drawVisualElements(
                visibleTasks,
                this.xScale,
                this.yScale,
                chartWidth,
                this.yScale.range()[1]
            );
        }
        
        this.debugLog("--- Visual Update End (Viewport Only) ---");
    }

    private handleSettingsOnlyUpdate(options: VisualUpdateOptions): void {
        this.debugLog("Performing settings-only update");
        
        // Update settings
        this.settings = this.formattingSettingsService.populateFormattingSettingsModel(
            VisualSettings, options.dataViews[0]);
        
        // Only redraw visual elements, not data processing
        const visibleTasks = this.allTasksToShow.slice(this.viewportStartIndex, this.viewportEndIndex + 1);
        
        // Clear and redraw with new settings
        this.clearVisual();
        this.createOrUpdateToggleButton(options.viewport.width);
        this.drawHeaderDivider(options.viewport.width);
        this.createConnectorLinesToggleButton(options.viewport.width);
        
        // Redraw with updated settings
        if (this.xScale && this.yScale) {
            this.drawVisualElements(
                visibleTasks,
                this.xScale,
                this.yScale,
                this.xScale.range()[1],
                this.yScale.range()[1]
            );
        }
        
        this.debugLog("--- Visual Update End (Settings Only) ---");
    }

    private clearVisual(): void {
            this.gridLayer?.selectAll("*").remove();
            this.arrowLayer?.selectAll("*").remove();
            this.taskLayer?.selectAll("*").remove();
            this.mainSvg?.select("defs").remove();
        
            this.headerGridLayer?.selectAll("*").remove();
            this.headerSvg?.selectAll(".divider-line").remove();
            this.headerSvg?.selectAll(".connector-toggle-group").remove(); // Clear connector toggle
            this.stickyHeaderContainer?.selectAll(".visual-title").remove();
        
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
        this.headerSvg.append("line")
            .attr("class", "divider-line")
            .attr("x1", 0)
            .attr("y1", this.headerHeight - 1) // Will now be at 59px
            .attr("x2", viewportWidth)
            .attr("y2", this.headerHeight - 1)
            .attr("stroke", "#e0e0e0") // Lighter color
            .attr("stroke-width", 1);
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
        
        // Create critical path marker with simpler definition
        defs.append("marker")
            .attr("id", "arrowhead-critical")
            .attr("viewBox", "0 0 10 10")
            .attr("refX", 9)
            .attr("refY", 5)
            .attr("markerWidth", arrowSize)
            .attr("markerHeight", arrowSize)
            .attr("orient", "auto")
            .append("polygon")
                .attr("points", "0,0 10,5 0,10")
                .style("fill", criticalColor);
    
        // Create normal marker with simpler definition
        defs.append("marker")
            .attr("id", "arrowhead")
            .attr("viewBox", "0 0 10 10")
            .attr("refX", 9)
            .attr("refY", 5)
            .attr("markerWidth", arrowSize)
            .attr("markerHeight", arrowSize)
            .attr("orient", "auto")
            .append("polygon")
                .attr("points", "0,0 10,5 0,10")
                .style("fill", connectorColor);
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

        const taskCount = tasksToShow.length;
        const calculatedChartHeight = Math.max(50, taskCount * (taskHeight + taskPadding));
        const chartWidth = Math.max(10, svgWidth - currentLeftMargin - this.margin.right);

        const startTimestamps = tasksToShow.map(d => d.startDate?.getTime()).filter(t => t != null && !isNaN(t)) as number[];
        const endTimestamps = tasksToShow.map(d => d.finishDate?.getTime()).filter(t => t != null && !isNaN(t)) as number[];

        if (startTimestamps.length === 0 || endTimestamps.length === 0) {
             console.warn("No valid Start/Finish dates found among tasks to plot. Cannot create time scale.");
             return { xScale: null, yScale: null, chartWidth, calculatedChartHeight };
        }

        const minTimestamp = Math.min(...startTimestamps);
        const maxTimestamp = Math.max(...endTimestamps);

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
             const domainPaddingMilliseconds = Math.max((maxTimestamp - minTimestamp) * 0.05, 86400000);
             domainMinDate = new Date(minTimestamp - domainPaddingMilliseconds);
             domainMaxDate = new Date(maxTimestamp + domainPaddingMilliseconds);
         }

        return this.createScales(
            domainMinDate, domainMaxDate,
            chartWidth, tasksToShow, calculatedChartHeight,
            taskHeight, taskPadding
        );
    }

private setupVirtualScroll(tasks: Task[], taskHeight: number, taskPadding: number): void {
    this.allTasksToShow = [...tasks];
    this.taskTotalCount = tasks.length;
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
    
    // Calculate initial visible range
    this.calculateVisibleTasks();
}

// Add this helper method for canvas mouse coordinates
private getCanvasMouseCoordinates(event: MouseEvent): { x: number, y: number } {
    if (!this.canvasElement) return { x: 0, y: 0 };
    
    const rect = this.canvasElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    // Account for DPR only if canvas is scaled
    const scaleX = this.canvasElement.width / rect.width;
    const scaleY = this.canvasElement.height / rect.height;
    
    return {
        x: (event.clientX - rect.left) * scaleX / dpr,
        y: (event.clientY - rect.top) * scaleY / dpr
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
        .text(`Mode: ${mode === 'floatBased' ? 'Float-Based' : 'Longest Path (CPM)'}`);

    // Status
    modeInfo.append("div").append("strong").style("color", "#555").text("Status: ")
        .select<HTMLElement>(function() { return this.parentNode as HTMLElement; })
        .append("span")
        .style("color", function() {
            if (task.internalId === this.selectedTaskId) return selectionHighlightColor;
            if (task.isCritical) return criticalColor;
            if (task.isNearCritical) return "#F7941F";
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
    if (task.tooltipData && task.tooltipData.size > 0) {
        const customInfo = tooltip.append("div")
            .classed("tooltip-custom-info", true)
            .style("margin-top", "8px")
            .style("border-top", "1px solid #eee")
            .style("padding-top", "8px");
            
        customInfo.append("div")
            .style("font-weight", "bold")
            .style("margin-bottom", "4px")
            .text("Additional Information:");
        
        task.tooltipData.forEach((value, key) => {
            let formattedValue = "";
            if (value instanceof Date) {
                formattedValue = this.formatDate(value);
            } else if (typeof value === 'number') {
                formattedValue = value.toLocaleString();
            } else {
                formattedValue = String(value);
            }
            
            customInfo.append("div")
                .append("strong").text(`${key}: `)
                .select<HTMLElement>(function() { return this.parentNode as HTMLElement; })
                .append("span").text(formattedValue);
        });
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

// Add this helper method for header updates
private updateHeaderElements(viewportWidth: number): void {
    // Check if elements need updating
    const currentToggleText = this.toggleButtonGroup?.select("text").text();
    const expectedToggleText = this.showAllTasksInternal ? "Show Critical" : "Show All";
    
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
    this.createConnectorLinesToggleButton(viewportWidth);
    this.createOrUpdateVisualTitle();
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
        
        // Only redraw if the visible range has changed
        if (oldStart !== this.viewportStartIndex || oldEnd !== this.viewportEndIndex) {
            this.redrawVisibleTasks();
        }
    }
    
private redrawVisibleTasks(): void {
    if (!this.xScale || !this.yScale || !this.allTasksToShow) {
        console.warn("Cannot redraw: Missing scales or task data");
        return;
    }
    
    const visibleTasks = this.allTasksToShow.slice(this.viewportStartIndex, this.viewportEndIndex + 1);
    const shouldUseCanvas = visibleTasks.length > this.CANVAS_THRESHOLD;
    
    // Only switch rendering mode if it actually changed
    if (shouldUseCanvas !== this.useCanvasRendering) {
        this.useCanvasRendering = shouldUseCanvas;
        
        // Hide both layers during transition
        if (this.canvasElement) this.canvasElement.style.visibility = 'hidden';
        this.taskLayer?.style("visibility", "hidden");
        this.arrowLayer?.style("visibility", "hidden");
        
        // Clear the previous renderer
        if (this.useCanvasRendering) {
            this.taskLayer?.selectAll("*").remove();
            this.arrowLayer?.selectAll("*").remove();
        } else {
            if (this.canvasContext && this.canvasElement) {
                this.canvasContext.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
            }
        }
    } else {
        // Just clear existing elements
        this.arrowLayer?.selectAll("*").remove();
        this.taskLayer?.selectAll("*").remove();
    }
    
    if (this.useCanvasRendering) {
        // --- Canvas Rendering Path ---
        this.taskLayer.style("display", "none");
        this.arrowLayer.style("display", "none");
        
        // Position the canvas element
        if (this.canvasElement) {
            this.canvasElement.style.display = 'block';
            this.canvasElement.style.visibility = 'visible';
            this.canvasElement.style.left = `${this.margin.left}px`;
            this.canvasElement.style.top = `${this.margin.top}px`;
        }

        const chartWidth = this.xScale.range()[1];
        const chartHeight = this.yScale.range()[1];

        // Use the new helper to size, clear, and scale the canvas
        if (this._setupCanvasForDrawing(chartWidth, chartHeight)) {
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
        }
    } else {
        // --- SVG Rendering Path ---
        if (this.canvasElement) {
            this.canvasElement.style.display = 'none';
        }
        this.taskLayer.style("display", "block");
        this.taskLayer.style("visibility", "visible");
        this.arrowLayer.style("display", "block");
        this.arrowLayer.style("visibility", "visible");
        
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
    }
    
    // Redraw project end line if needed
    if (this.settings.projectEndLine.show.value) {
        this.drawProjectEndLine(
            this.xScale.range()[1], 
            this.xScale, 
            visibleTasks, 
            this.allTasksToShow, 
            this.yScale.range()[1], 
            this.gridLayer, 
            this.headerGridLayer
        );
    }
}
    
    private performRedrawVisibleTasks(): void {
            // Clear existing task elements
            this.taskLayer?.selectAll("*").remove();
            this.arrowLayer?.selectAll("*").remove();
            
            // Get visible subset of tasks
            const visibleTasks = this.allTasksToShow.slice(this.viewportStartIndex, this.viewportEndIndex + 1);
            
            // Only redraw horizontal grid lines for visible tasks
            if (this.settings.gridLines.showGridLines.value) {
                this.gridLayer?.selectAll(".grid-line.horizontal").remove();
                this.drawHorizontalGridLines(
                    visibleTasks,
                    this.yScale!,
                    this.xScale!.range()[1],
                    this.settings.layoutSettings.leftMargin.value,
                    this.yScale!.range()[1]
                );
            }
            
            // Only draw visible tasks
            if (this.xScale && this.yScale) {
                // NEW: Check if we should use canvas
                this.useCanvasRendering = visibleTasks.length > this.CANVAS_THRESHOLD;
                
            if (this.useCanvasRendering) {
                // Canvas rendering
                this.taskLayer.style("display", "none");
                this.arrowLayer.style("display", "none");
                
                if (this.canvasElement) {
                    this.canvasElement.style.display = 'block';
                    this.canvasElement.style.left = `${this.margin.left}px`;
                    this.canvasElement.style.top = `${this.margin.top}px`;
                    this.canvasElement.width = this.xScale.range()[1];
                    this.canvasElement.height = this.yScale.range()[1];
                    
                    this.canvasContext = this.canvasElement.getContext('2d');
                }
                    
                    // Draw on canvas
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
                    
                    if (this.showConnectorLinesInternal) {
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
                } else {
                    // SVG rendering
                    this.canvasLayer.style("display", "none");
                    this.taskLayer.style("display", "block");
                    this.arrowLayer.style("display", "block");
                    
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
                    
                    // Draw tasks
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
                }
                
                // Draw project end line if enabled, using all tasks for calculation
                if (this.settings.projectEndLine.show.value) {
                    this.drawProjectEndLine(
                        this.xScale.range()[1],
                        this.xScale,
                        visibleTasks,
                        this.allTasksToShow,
                        this.yScale.range()[1],
                        this.gridLayer!,
                        this.headerGridLayer!
                    );
                }
            }
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

        const yDomain = tasksToShow.map((d: Task) => d.yOrder?.toString() ?? '').filter(id => id !== '');

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
        const showProjectEndLine = this.settings.projectEndLine.show.value;
        
        // Decide whether to use Canvas or SVG based on task count
        this.useCanvasRendering = tasksToShow.length > this.CANVAS_THRESHOLD;
        this.debugLog(`Rendering mode: ${this.useCanvasRendering ? 'Canvas' : 'SVG'} for ${tasksToShow.length} tasks`);
        
        if (showHorzGridLines) {
            const currentLeftMargin = this.settings.layoutSettings.leftMargin.value;
            this.drawHorizontalGridLines(tasksToShow, yScale, chartWidth, currentLeftMargin, chartHeight);
        }
        if (showVertGridLines) {
            this.drawVerticalGridLines(xScale, chartHeight, this.gridLayer, this.headerGridLayer);
        }
        
        if (this.useCanvasRendering) {
            // --- Canvas Rendering Path ---
            this.taskLayer.style("display", "none");
            this.arrowLayer.style("display", "none");
            
            // Position the canvas element
            if (this.canvasElement) {
                this.canvasElement.style.display = 'block';
                this.canvasElement.style.left = `${this.margin.left}px`;
                this.canvasElement.style.top = `${this.margin.top}px`;
            }
            
            // Use the new helper to size, clear, and scale the canvas
            if (this._setupCanvasForDrawing(chartWidth, chartHeight)) {
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
            }
            this.taskLayer.style("display", "block");
            this.arrowLayer.style("display", "block");
            
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
        }
        
        if (showProjectEndLine) {
            this.drawProjectEndLine(chartWidth, xScale, tasksToShow, this.allTasksToShow, chartHeight, 
                                    this.gridLayer, this.headerGridLayer);
        }
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

        const lineData = tasks.slice(1);

        this.gridLayer.selectAll(".grid-line.horizontal")
            .data(lineData, (d: Task) => d.internalId)
            .enter()
            .append("line")
            .attr("class", "grid-line horizontal")
            .attr("x1", -currentLeftMargin)
            .attr("x2", chartWidth)
            .attr("y1", (d: Task) => yScale(d.yOrder?.toString() ?? '') ?? 0)
            .attr("y2", (d: Task) => yScale(d.yOrder?.toString() ?? '') ?? 0)
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
        const lineStyle = settings.lineStyle.value.value;
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
    const nearCriticalColor = "#F7941F"; // Yellow for near-critical tasks
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

    // --- Draw Baseline Bars ---
    const showBaseline = this.settings.taskAppearance.showBaseline.value;
    if (showBaseline) {
        const baselineColor = this.settings.taskAppearance.baselineColor.value.value;
        const baselineHeight = this.settings.taskAppearance.baselineHeight.value;
        const baselineOffset = this.settings.taskAppearance.baselineOffset.value;

        allTaskGroups.selectAll(".baseline-bar").remove(); // Clear old bars

        allTaskGroups.filter((d: Task) =>
            d.baselineStartDate instanceof Date && !isNaN(d.baselineStartDate.getTime()) &&
            d.baselineFinishDate instanceof Date && !isNaN(d.baselineFinishDate.getTime()) &&
            d.baselineFinishDate >= d.baselineStartDate
        )
        .append("rect")
            .attr("class", "baseline-bar")
            .attr("x", (d: Task) => xScale(d.baselineStartDate!))
            .attr("y", taskHeight + baselineOffset)
            .attr("width", (d: Task) => {
                const startPos = xScale(d.baselineStartDate!);
                const finishPos = xScale(d.baselineFinishDate!);
                return Math.max(this.minTaskWidthPixels, finishPos - startPos);
            })
            .attr("height", baselineHeight)
            .style("fill", baselineColor);
    } else {
        allTaskGroups.selectAll(".baseline-bar").remove(); // Ensure bars are hidden
    }
    
    // --- Draw Task Bars ---
    // First remove any existing bars to redraw them (simpler than updating positions)
    allTaskGroups.selectAll(".task-bar, .milestone").remove();
    
    // Draw bars for normal tasks
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
        .attr("rx", Math.min(3, taskHeight * 0.1)).attr("ry", Math.min(3, taskHeight * 0.1))
        .style("fill", (d: Task) => {
            if (d.internalId === this.selectedTaskId) return selectionHighlightColor;
            if (d.isCritical) return criticalColor;
            if (d.isNearCritical) return nearCriticalColor;
            return taskColor;
        })
        .style("stroke", (d: Task) => d.internalId === this.selectedTaskId ? selectionHighlightColor : "#333")
        .style("stroke-width", (d: Task) => d.internalId === this.selectedTaskId ? selectionStrokeWidth : 0.5);

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
            if (d.internalId === this.selectedTaskId) return selectionHighlightColor;
            if (d.isCritical) return criticalColor;
            if (d.isNearCritical) return nearCriticalColor;
            return milestoneColor;
        })
        .style("stroke", (d: Task) => d.internalId === this.selectedTaskId ? selectionHighlightColor : "#000")
        .style("stroke-width", (d: Task) => d.internalId === this.selectedTaskId ? selectionStrokeWidth : 1);

    // --- Update Task Labels ---
    // First remove existing labels to avoid updating complex wrapped text
    allTaskGroups.selectAll(".task-label").remove();
    
    // Draw task labels
    const taskLabels = allTaskGroups.append("text")
        .attr("class", "task-label")
        .attr("x", -currentLeftMargin + this.labelPaddingLeft)
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
            let tspan = textElement.text(null).append("tspan").attr("x", x).attr("y", y).attr("dy", dy + "em");
            let lineCount = 1;
            const maxLines = 2;

            while (word = words.pop()) {
                line.push(word);
                tspan.text(line.join(" "));
                try {
                    const node = tspan.node();
                    if (node && node.getComputedTextLength() > labelAvailableWidth && line.length > 1) {
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
            if (!textElement || textElement.getAttribute("x") === null || !textElement.textContent) {
                group.remove(); return;
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
                        .attr("rx", 3).attr("ry", 3)
                        .style("fill", dateBackgroundColor)
                        .style("fill-opacity", dateBackgroundOpacity);
                }
            } catch (e) { console.warn(`Could not get BBox for date text on task ${d.internalId}`, e); }
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
                    d3.select(event.currentTarget as Element)
                        .style("stroke", "#333")
                        .style("stroke-width", "2px");
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
                        .text(`Mode: ${mode === 'floatBased' ? 'Float-Based' : 'Longest Path (CPM)'}`);

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
                    if (d.tooltipData && d.tooltipData.size > 0) {
                        const customInfo = tooltip.append("div")
                            .classed("tooltip-custom-info", true)
                            .style("margin-top", "8px")
                            .style("border-top", "1px solid #eee")
                            .style("padding-top", "8px");
                            
                        customInfo.append("div")
                            .style("font-weight", "bold")
                            .style("margin-bottom", "4px")
                            .text("Additional Information:");
                        
                        d.tooltipData.forEach((value, key) => {
                            let formattedValue = "";
                            if (value instanceof Date) {
                                formattedValue = self.formatDate(value);
                            } else if (typeof value === 'number') {
                                formattedValue = value.toLocaleString();
                            } else {
                                formattedValue = String(value);
                            }
                            
                            customInfo.append("div")
                                .append("strong").text(`${key}: `)
                                .select<HTMLElement>(function() { return this.parentNode as HTMLElement; })
                                .append("span").text(formattedValue);
                        });
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
                    d3.select(event.currentTarget as Element)
                        .style("stroke", "#333")
                        .style("stroke-width", "0.5");
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
    
    try {
        const showFinishDates = this.settings.textAndLabels.showFinishDates.value;
        const generalFontSize = this.settings.textAndLabels.fontSize.value;
        const taskNameFontSize = this.settings.textAndLabels.taskNameFontSize.value;
        const milestoneSizeSetting = this.settings.taskAppearance.milestoneSize.value;
        const currentLeftMargin = this.settings.layoutSettings.leftMargin.value;
        const nearCriticalColor = "#F7941F";
        const showBaseline = this.settings.taskAppearance.showBaseline.value;
        const baselineColor = this.settings.taskAppearance.baselineColor.value.value;
        const baselineHeight = this.settings.taskAppearance.baselineHeight.value;
        const baselineOffset = this.settings.taskAppearance.baselineOffset.value;
        
        // Set font for measurements
        ctx.font = `${taskNameFontSize}pt Segoe UI, sans-serif`;
        
        // Draw each task
        tasks.forEach((task: Task) => {
            const domainKey = task.yOrder?.toString() ?? '';
            const yPosition = yScale(domainKey);
            if (yPosition === undefined || isNaN(yPosition)) return;

            // --- Draw Baseline Bar on Canvas ---
            if (showBaseline && task.baselineStartDate && task.baselineFinishDate && task.baselineFinishDate >= task.baselineStartDate) {
                const x_base = xScale(task.baselineStartDate);
                const width_base = Math.max(1, xScale(task.baselineFinishDate) - x_base);
                const y_base = yPosition + taskHeight + baselineOffset;

                ctx.fillStyle = baselineColor;
                ctx.fillRect(x_base, y_base, width_base, baselineHeight);
            }
            
            // Determine task color
            let fillColor = taskColor;
            if (task.internalId === this.selectedTaskId) {
                fillColor = "#8A2BE2"; // Selection purple
            } else if (task.isCritical) {
                fillColor = criticalColor;
            } else if (task.isNearCritical) {
                fillColor = nearCriticalColor;
            }
            
            // Draw task or milestone
            if (task.type === 'TT_Mile' || task.type === 'TT_FinMile') {
                // Draw milestone diamond
                const milestoneDate = task.startDate || task.finishDate;
                if (milestoneDate) {
                    const x = xScale(milestoneDate);
                    const y = yPosition + taskHeight / 2;
                    const size = Math.max(4, Math.min(milestoneSizeSetting, taskHeight * 0.9));
                    
                    ctx.beginPath();
                    ctx.moveTo(x, y - size / 2);
                    ctx.lineTo(x + size / 2, y);
                    ctx.lineTo(x, y + size / 2);
                    ctx.lineTo(x - size / 2, y);
                    ctx.closePath();
                    
                    ctx.fillStyle = fillColor;
                    ctx.fill();
                    ctx.strokeStyle = task.internalId === this.selectedTaskId ? fillColor : "#000";
                    ctx.lineWidth = task.internalId === this.selectedTaskId ? 2.5 : 1;
                    ctx.stroke();
                }
            } else {
                // Draw regular task bar
                if (task.startDate && task.finishDate) {
                    const x = xScale(task.startDate);
                    const width = Math.max(1, xScale(task.finishDate) - x);
                    const y = yPosition;
                    const radius = Math.min(3, taskHeight * 0.1);
                    
                    // Draw rounded rectangle
                    ctx.beginPath();
                    ctx.moveTo(x + radius, y);
                    ctx.lineTo(x + width - radius, y);
                    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
                    ctx.lineTo(x + width, y + taskHeight - radius);
                    ctx.quadraticCurveTo(x + width, y + taskHeight, x + width - radius, y + taskHeight);
                    ctx.lineTo(x + radius, y + taskHeight);
                    ctx.quadraticCurveTo(x, y + taskHeight, x, y + taskHeight - radius);
                    ctx.lineTo(x, y + radius);
                    ctx.quadraticCurveTo(x, y, x + radius, y);
                    ctx.closePath();
                    
                    ctx.fillStyle = fillColor;
                    ctx.fill();
                    
                    if (task.internalId === this.selectedTaskId) {
                        ctx.strokeStyle = fillColor;
                        ctx.lineWidth = 2.5;
                        ctx.stroke();
                    }
                    
                    // Draw duration text if enabled
                    if (showDuration && task.duration > 0) {
                        const durationText = `${Math.round(task.duration)}d`;
                        ctx.font = `${Math.max(7, generalFontSize * 0.8)}pt Segoe UI, sans-serif`;
                        ctx.fillStyle = "white";
                        ctx.textAlign = "center";
                        ctx.textBaseline = "middle";
                        const centerX = x + width / 2;
                        const centerY = y + taskHeight / 2;
                        
                        // Only draw if text fits
                        const textWidth = ctx.measureText(durationText).width;
                        if (textWidth < width - 4) {
                            ctx.fillText(durationText, centerX, centerY);
                        }
                        
                        // Reset font for task names
                        ctx.font = `${taskNameFontSize}pt Segoe UI, sans-serif`;
                    }
                }
            }
            
            // Draw task name
            const labelX = -currentLeftMargin + this.labelPaddingLeft;
            const labelY = yPosition + taskHeight / 2;
            
            ctx.font = `${taskNameFontSize}pt Segoe UI, sans-serif`;
            ctx.fillStyle = task.internalId === this.selectedTaskId ? "#8A2BE2" : labelColor;
            ctx.textAlign = "start";
            ctx.textBaseline = "middle";
            
            // Simple text truncation for canvas
            const maxWidth = currentLeftMargin - this.labelPaddingLeft - 5;
            let taskName = task.name || "";
            const metrics = ctx.measureText(taskName);
            
            if (metrics.width > maxWidth) {
                // Truncate with ellipsis
                while (taskName.length > 0 && ctx.measureText(taskName + "...").width > maxWidth) {
                    taskName = taskName.slice(0, -1);
                }
                taskName += "...";
            }
            
            ctx.fillText(taskName, labelX, labelY);
            
            // Draw finish date if enabled
            if (showFinishDates && task.finishDate) {
                const dateText = this.formatDate(task.finishDate);
                const dateX = task.type === 'TT_Mile' || task.type === 'TT_FinMile'
                    ? xScale(task.startDate || task.finishDate) + milestoneSizeSetting / 2 + this.dateLabelOffset
                    : xScale(task.finishDate) + this.dateLabelOffset;
                    
                ctx.font = `${Math.max(8, generalFontSize * 0.85)}pt Segoe UI, sans-serif`;
                ctx.fillStyle = labelColor;
                ctx.textAlign = "start";
                ctx.textBaseline = "middle";
                
                // Draw background rectangle
                const textMetrics = ctx.measureText(dateText);
                const bgPadding = this.dateBackgroundPadding;
                
                ctx.fillStyle = dateBackgroundColor;
                ctx.globalAlpha = dateBackgroundOpacity;
                ctx.fillRect(
                    dateX - bgPadding.horizontal,
                    labelY - textMetrics.actualBoundingBoxAscent - bgPadding.vertical,
                    textMetrics.width + bgPadding.horizontal * 2,
                    textMetrics.actualBoundingBoxAscent + textMetrics.actualBoundingBoxDescent + bgPadding.vertical * 2
                );
                ctx.globalAlpha = 1.0;
                
                // Draw date text
                ctx.fillStyle = labelColor;
                ctx.fillText(dateText, dateX, labelY);
            }
        });
    } finally {
        // Always restore context state
        ctx.restore();
    }
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

    // Get the device pixel ratio, defaulting to 1.
    const dpr = window.devicePixelRatio || 1;

    // Set the CSS display size of the canvas.
    this.canvasElement.style.width = `${chartWidth}px`;
    this.canvasElement.style.height = `${chartHeight}px`;

    // Set the actual backing store size of the canvas to match the device's resolution.
    this.canvasElement.width = Math.round(chartWidth * dpr);
    this.canvasElement.height = Math.round(chartHeight * dpr);

    this.canvasContext = this.canvasElement.getContext('2d');
    if (!this.canvasContext) {
        console.error("Failed to get 2D context from canvas.");
        return false;
    }

    // Reset any previous transformations and clear the canvas completely.
    this.canvasContext.setTransform(1, 0, 0, 1, 0, 0);
    this.canvasContext.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);

    // Scale the context so that all drawing commands are in CSS pixels.
    // This makes drawing logic simpler, as you don't need to multiply every coordinate by dpr.
    this.canvasContext.scale(dpr, dpr);
    
    this.debugLog(`Canvas setup: DPR=${dpr}, Display=${chartWidth}x${chartHeight}, Actual=${this.canvasElement.width}x${this.canvasElement.height}`);
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
        
        // Draw each relationship
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
            const startGap = predIsMilestone ? (milestoneDrawSize / 2 + 2) : 2;
            const endGap = succIsMilestone ? (milestoneDrawSize / 2 + 2 + connectionEndPadding) : (2 + connectionEndPadding);
            
            let effectiveStartX = startX;
            let effectiveEndX = endX;
            
            if (relType === 'FS' || relType === 'FF') effectiveStartX += startGap;
            else effectiveStartX -= startGap;
            if (predIsMilestone && (relType === 'SS' || relType === 'SF')) effectiveStartX = startX + startGap;
            
            if (relType === 'FS' || relType === 'SS') effectiveEndX -= endGap;
            else effectiveEndX += endGap;
            if (succIsMilestone && (relType === 'FF' || relType === 'SF')) effectiveEndX = endX + endGap - connectionEndPadding;
            
            // Set line style
            ctx.strokeStyle = rel.isCritical ? criticalColor : connectorColor;
            ctx.lineWidth = rel.isCritical ? criticalConnectorWidth : connectorWidth;
            
            // Draw path
            ctx.beginPath();
            ctx.moveTo(effectiveStartX, predY);
            
            if (Math.abs(predY - succY) < 1) {
                // Horizontal line
                ctx.lineTo(effectiveEndX, succY);
            } else {
                // Draw appropriate connector based on type
                switch(relType) {
                    case 'FS':
                        ctx.lineTo(effectiveStartX, succY);
                        ctx.lineTo(effectiveEndX, succY);
                        break;
                    case 'SS':
                        const ssOffsetX = Math.min(effectiveStartX, effectiveEndX) - elbowOffset;
                        ctx.lineTo(ssOffsetX, predY);
                        ctx.lineTo(ssOffsetX, succY);
                        ctx.lineTo(effectiveEndX, succY);
                        break;
                    case 'FF':
                        const ffOffsetX = Math.max(effectiveStartX, effectiveEndX) + elbowOffset;
                        ctx.lineTo(ffOffsetX, predY);
                        ctx.lineTo(ffOffsetX, succY);
                        ctx.lineTo(effectiveEndX, succY);
                        break;
                    case 'SF':
                        const sfStartOffset = effectiveStartX - elbowOffset;
                        const sfEndOffset = effectiveEndX + elbowOffset;
                        const midY = (predY + succY) / 2;
                        ctx.lineTo(sfStartOffset, predY);
                        ctx.lineTo(sfStartOffset, midY);
                        ctx.lineTo(sfEndOffset, midY);
                        ctx.lineTo(sfEndOffset, succY);
                        ctx.lineTo(effectiveEndX, succY);
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
                this.arrowLayer.selectAll(".relationship-arrow").remove();
            }
            return;
        }

        if (!this.arrowLayer?.node() || !xScale || !yScale) {
            console.warn("Skipping arrow drawing: Missing layer or invalid scales.");
            return;
        }
        this.arrowLayer.selectAll(".relationship-arrow").remove();

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

        this.arrowLayer.selectAll(".relationship-arrow")
            .data(visibleRelationships, (d: Relationship) => `${d.predecessorId}-${d.successorId}`)
            .enter()
            .append("path")
            .attr("class", (d: Relationship) => `relationship-arrow ${d.isCritical ? "critical" : "normal"}`)
            .attr("fill", "none")
            .attr("stroke", (d: Relationship) => d.isCritical ? criticalColor : connectorColor)
            .attr("stroke-width", (d: Relationship) => d.isCritical ? criticalConnectorWidth : connectorWidth)
            // marker-end attribute removed
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
                const startGap = predIsMilestone ? (milestoneDrawSize / 2 + 2) : 2;
                // Use connectionEndPadding instead of arrowHeadVisibleLength
                const endGap = succIsMilestone ? (milestoneDrawSize / 2 + 2 + connectionEndPadding) : (2 + connectionEndPadding);

                let effectiveStartX = startX;
                let effectiveEndX = endX;
                
                if (relType === 'FS' || relType === 'FF') effectiveStartX += startGap;
                else effectiveStartX -= startGap;
                if (predIsMilestone && (relType === 'SS' || relType === 'SF')) effectiveStartX = startX + startGap;

                if (relType === 'FS' || relType === 'SS') effectiveEndX -= endGap;
                else effectiveEndX += endGap;
                // Use connectionEndPadding instead of arrowHeadVisibleLength
                if (succIsMilestone && (relType === 'FF' || relType === 'SF')) effectiveEndX = endX + endGap - connectionEndPadding;

                const pStartX = effectiveStartX;
                const pStartY = predY;
                const pEndX = effectiveEndX;
                const pEndY = succY;

                if (Math.abs(pStartX - pEndX) < elbowOffset && Math.abs(pStartY - pEndY) < 1) return null; // Skip tiny paths

                let pathData: string;
                
                // Check if tasks are at the same vertical level
                if (Math.abs(pStartY - pEndY) < 1) {
                    // Simple horizontal connection for all relationship types when tasks at same level
                    pathData = `M ${pStartX},${pStartY} H ${pEndX}`;
                } else {
                    // Different path creation based on relationship type
                    switch(relType) {
                        case 'FS': 
                            // Finish to Start: Vertical line down from end of predecessor, then horizontal to start of successor
                            pathData = `M ${pStartX},${pStartY} V ${pEndY} H ${pEndX}`;
                            break;
                            
                        case 'SS':
                            // Start to Start: Path connecting start points
                            const ssOffsetX = Math.min(pStartX, pEndX) - elbowOffset;
                            pathData = `M ${pStartX},${pStartY} H ${ssOffsetX} V ${pEndY} H ${pEndX}`;
                            break;
                            
                        case 'FF':
                            // Finish to Finish: Path connecting finish points
                            const ffOffsetX = Math.max(pStartX, pEndX) + elbowOffset;
                            pathData = `M ${pStartX},${pStartY} H ${ffOffsetX} V ${pEndY} H ${pEndX}`;
                            break;
                            
                        case 'SF':
                            // Start to Finish: Path connecting start to finish
                            // This is the least common relationship type
                            const sfStartOffset = pStartX - elbowOffset;
                            const sfEndOffset = pEndX + elbowOffset;
                            const midY = (pStartY + pEndY) / 2;
                            pathData = `M ${pStartX},${pStartY} H ${sfStartOffset} V ${midY} H ${sfEndOffset} V ${pEndY} H ${pEndX}`;
                            break;
                            
                        default:
                            // Fallback to FS style
                            pathData = `M ${pStartX},${pStartY} V ${pEndY} H ${pEndX}`;
                    }
                }
                return pathData;
            })
            .filter(function() { return d3.select(this).attr("d") !== null; });
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
        if (!mainGridLayer?.node() || !headerLayer?.node() || allTasks.length === 0 || !xScale) { return; }
    
        const settings = this.settings.projectEndLine;
        if (!settings.show.value) return;
    
        const lineColor = settings.lineColor.value.value;
        const lineWidth = settings.lineWidth.value;
        const lineStyle = settings.lineStyle.value.value;
        const generalFontSize = this.settings.textAndLabels.fontSize.value;
        let lineDashArray = "none";
        switch (lineStyle) { case "dashed": lineDashArray = "5,3"; break; case "dotted": lineDashArray = "1,2"; break; default: lineDashArray = "none"; }
    
        // Use allTasks instead of visibleTasks to calculate the latest finish date
        let latestFinishTimestamp: number | null = null;
        allTasks.forEach((task: Task) => {
             if (task.finishDate instanceof Date && !isNaN(task.finishDate.getTime())) {
                 const currentTimestamp = task.finishDate.getTime();
                 if (latestFinishTimestamp === null || currentTimestamp > latestFinishTimestamp) {
                     latestFinishTimestamp = currentTimestamp;
                 }
             }
         });
    
        if (latestFinishTimestamp === null) { console.warn("Cannot draw Project End Line: No valid finish dates."); return; }
    
        const latestFinishDate = new Date(latestFinishTimestamp);
        const endX = xScale(latestFinishDate);
    
        mainGridLayer.select(".project-end-line").remove();
        headerLayer.select(".project-end-label").remove();
    
        if (isNaN(endX) || !isFinite(endX)) { console.warn("Calculated project end line position is invalid:", endX); return; }
    
        // --- Draw the LINE in the MAIN grid layer ---
        mainGridLayer.append("line")
            .attr("class", "project-end-line")
            .attr("x1", endX).attr("y1", 0) // Adjusted y1 to start from top of content area
            .attr("x2", endX).attr("y2", chartHeight)
            .attr("stroke", lineColor)
            .attr("stroke-width", lineWidth)
            .attr("stroke-dasharray", lineDashArray)
            .style("pointer-events", "none");
    
    
        // --- Draw the LABEL in the HEADER layer ---
        const endDateText = `Finish: ${this.formatDate(latestFinishDate)}`;
        headerLayer.append("text")
              .attr("class", "project-end-label")
              .attr("x", endX + 5)
              .attr("y", this.headerHeight - 45) // Adjust Y pos within header
              .attr("text-anchor", "start")
              .style("fill", lineColor)
              .style("font-size", generalFontSize + "pt")
              .style("font-weight", "bold")
              .style("pointer-events", "none")
              .text(endDateText);
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
    
    // Reset criticality flags
    this.allTasksData.forEach(task => {
        task.isCritical = false;
        task.isCriticalByFloat = false;
        task.isCriticalByRel = false;
        task.isNearCritical = false;
        task.totalFloat = Infinity;
    });
    
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
    
    // Step 4: Select the longest chain
    const longestChain = this.selectLongestChain(drivingChains);
    
    if (longestChain) {
        // Mark tasks in the longest chain as critical
        longestChain.tasks.forEach(taskId => {
            const task = this.taskIdToTask.get(taskId);
            if (task) {
                task.isCritical = true;
                task.isCriticalByFloat = true;
                task.totalFloat = 0;
            }
        });
        
        // Mark relationships in the longest chain as critical
        longestChain.relationships.forEach(rel => {
            rel.isCritical = true;
        });
        
        this.debugLog(`Longest path: ${longestChain.tasks.size} tasks, duration ${longestChain.totalDuration}`);
    }
    
    // Apply near-critical logic if enabled
    if (this.showNearCritical && this.floatThreshold > 0) {
        this.identifyNearCriticalTasks();
    }
    
    const endTime = performance.now();
    this.debugLog(`P6 longest path completed in ${endTime - startTime}ms`);
}

/**
 * Identifies which relationships are driving based on minimum float
 */
private identifyDrivingRelationships(): void {
    // First, calculate relationship float for all relationships
    this.relationships.forEach(rel => {
        const pred = this.taskIdToTask.get(rel.predecessorId);
        const succ = this.taskIdToTask.get(rel.successorId);
        
        if (!pred || !succ || !pred.startDate || !pred.finishDate || 
            !succ.startDate || !succ.finishDate) {
            (rel as any).relationshipFloat = Infinity;
            (rel as any).isDriving = false;
            rel.isCritical = false;
            return;
        }
        
        const relType = rel.type || 'FS';
        const lag = rel.lag || 0;
        
        // Get dates in days since epoch
        const predStart = pred.startDate.getTime() / 86400000;
        const predFinish = pred.finishDate.getTime() / 86400000;
        const succStart = succ.startDate.getTime() / 86400000;
        const succFinish = succ.finishDate.getTime() / 86400000;
        
        let relFloat = 0;
        
        switch (relType) {
            case 'FS': relFloat = succStart - (predFinish + lag); break;
            case 'SS': relFloat = succStart - (predStart + lag); break;
            case 'FF': relFloat = succFinish - (predFinish + lag); break;
            case 'SF': relFloat = succFinish - (predStart + lag); break;
        }
        
        (rel as any).relationshipFloat = relFloat;
        (rel as any).isDriving = false;
        rel.isCritical = false;
    });
    
    // Group relationships by successor
    const successorGroups = new Map<string, Relationship[]>();
    this.relationships.forEach(rel => {
        if (!successorGroups.has(rel.successorId)) {
            successorGroups.set(rel.successorId, []);
        }
        successorGroups.get(rel.successorId)!.push(rel);
    });
    
    // For each successor, mark the predecessor(s) with minimum float as driving
    successorGroups.forEach((rels, successorId) => {
        let minFloat = Infinity;
        rels.forEach(rel => {
            const relFloat = (rel as any).relationshipFloat;
            if (relFloat < minFloat) {
                minFloat = relFloat;
            }
        });
        
        // Mark all relationships with minimum float as driving
        rels.forEach(rel => {
            const relFloat = (rel as any).relationshipFloat;
            if (Math.abs(relFloat - minFloat) <= this.floatTolerance) {
                (rel as any).isDriving = true;
            }
        });
    });
    
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
    totalDuration: number
}> {
    const chains: Array<{
        tasks: Set<string>,
        relationships: Relationship[],
        totalDuration: number
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
                totalDuration: totalDuration
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
                totalDuration: task.duration
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
    const longestChain = this.selectLongestChain(chains);
    
    if (longestChain) {
        longestChain.tasks.forEach(taskId => {
            const task = this.taskIdToTask.get(taskId);
            if (task) {
                task.isCritical = true;
                task.isCriticalByFloat = true;
                task.totalFloat = 0;
            }
        });
        
        longestChain.relationships.forEach(rel => {
            rel.isCritical = true;
        });
    }
    
    // Always mark target task as critical
    targetTask.isCritical = true;
    targetTask.isCriticalByFloat = true;
    
    this.debugLog(`P6 path to ${targetTaskId} with ${longestChain?.tasks.size || 0} tasks`);
}

private calculateCPMFromTask(sourceTaskId: string | null): void {
    this.debugLog(`Calculating P6 driving path from task: ${sourceTaskId || "None"}`);
    
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
    
    // Identify driving relationships
    this.identifyDrivingRelationships();
    
    // Find longest driving chain from source
    const visited = new Set<string>();
    let longestForwardChain: {
        tasks: Set<string>,
        relationships: Relationship[],
        totalDuration: number
    } | null = null;
    
    const findForwardChains = (taskId: string, currentChain: Set<string>, currentRels: Relationship[], currentDuration: number) => {
        if (visited.has(taskId)) return;
        
        const task = this.taskIdToTask.get(taskId);
        if (!task) return;
        
        currentChain.add(taskId);
        currentDuration += task.duration;
        
        const drivingSuccs = this.relationships.filter(rel => 
            rel.predecessorId === taskId && (rel as any).isDriving
        );
        
        if (drivingSuccs.length === 0) {
            if (!longestForwardChain || currentDuration > longestForwardChain.totalDuration) {
                longestForwardChain = {
                    tasks: new Set(currentChain),
                    relationships: [...currentRels],
                    totalDuration: currentDuration
                };
            }
        } else {
            for (const rel of drivingSuccs) {
                currentRels.push(rel);
                findForwardChains(rel.successorId, currentChain, currentRels, currentDuration);
                currentRels.pop();
            }
        }
        
        currentChain.delete(taskId);
    };
    
    findForwardChains(sourceTaskId, new Set(), [], 0);
    
    if (longestForwardChain) {
        longestForwardChain.tasks.forEach(taskId => {
            const task = this.taskIdToTask.get(taskId);
            if (task) {
                task.isCritical = true;
                task.isCriticalByFloat = true;
                task.totalFloat = 0;
            }
        });
        
        longestForwardChain.relationships.forEach(rel => {
            rel.isCritical = true;
        });
    }
    
    this.debugLog(`P6 path from ${sourceTaskId} with ${longestForwardChain?.tasks.size || 0} tasks`);
}

private identifyPredecessorTasksFloatBased(targetTaskId: string): Set<string> {
    // Simplified - no filtering needed
    const tasksInPath = new Set<string>();
    tasksInPath.add(targetTaskId);
    
    const queue: string[] = [targetTaskId];
    const visited = new Set<string>();
    visited.add(targetTaskId);
    
    while (queue.length > 0) {
        const currentTaskId = queue.shift()!;
        const task = this.taskIdToTask.get(currentTaskId);
        if (!task) continue;
        
        for (const predId of task.predecessorIds) {
            if (!visited.has(predId)) {
                tasksInPath.add(predId);
                visited.add(predId);
                queue.push(predId);
            }
        }
    }
    
    this.debugLog(`Float-Based backward trace from ${targetTaskId}: found ${tasksInPath.size} tasks`);
    return tasksInPath;
}

private identifySuccessorTasksFloatBased(sourceTaskId: string): Set<string> {
    // Simplified - no filtering needed
    const tasksInPath = new Set<string>();
    tasksInPath.add(sourceTaskId);
    
    const queue: string[] = [sourceTaskId];
    const visited = new Set<string>();
    visited.add(sourceTaskId);
    
    while (queue.length > 0) {
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
    
    this.debugLog(`Float-Based forward trace from ${sourceTaskId}: found ${tasksInPath.size} tasks`);
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
        tooltipData: tooltipData
    };
    
    return task;
}

/**
 * Extracts tooltip data from a row
 */
private extractTooltipData(row: any[], dataView: DataView): Map<string, PrimitiveValue> | undefined {
    const columns = dataView.metadata?.columns;
    if (!columns) return undefined;
    
    const tooltipData = new Map<string, PrimitiveValue>();
    let hasTooltipData = false;
    
    columns.forEach((column, index) => {
        if (column.roles?.tooltip) {
            const value = row[index];
            if (value !== null && value !== undefined) {
                // Check if this should be treated as a date
                if (column.type?.dateTime || this.mightBeDate(value)) {
                    const parsedDate = this.parseDate(value);
                    if (parsedDate) {
                        tooltipData.set(column.displayName || `Field ${index}`, parsedDate);
                        hasTooltipData = true;
                        return;
                    }
                }
                // Otherwise store original value
                tooltipData.set(column.displayName || `Field ${index}`, value);
                hasTooltipData = true;
            }
        }
    });
    
    return hasTooltipData ? tooltipData : undefined;
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

    if (!dataView.table?.rows || !dataView.metadata?.columns) {
        console.error("Data transformation failed: No table data or columns found.");
        return;
    }
    
    const rows = dataView.table.rows;
    const columns = dataView.metadata.columns;

    // Get column indices once
    const idIdx = this.getColumnIndex(dataView, 'taskId');
    if (idIdx !== -1) {
        this.taskIdQueryName = dataView.metadata.columns[idIdx].queryName || null;
        const match = this.taskIdQueryName ? this.taskIdQueryName.match(/([^\[]+)\[([^\]]+)\]/) : null;
        if (match) {
            this.taskIdTable = match[1];
            this.taskIdColumn = match[2];
        } else if (this.taskIdQueryName) {
            const parts = this.taskIdQueryName.split('.');
            this.taskIdTable = parts.length > 1 ? parts[0] : null;
            this.taskIdColumn = parts[parts.length - 1];
        } else {
            this.taskIdTable = null;
            this.taskIdColumn = null;
        }
    }
    const predIdIdx = this.getColumnIndex(dataView, 'predecessorId');
    const relTypeIdx = this.getColumnIndex(dataView, 'relationshipType');
    const relLagIdx = this.getColumnIndex(dataView, 'relationshipLag');

    if (idIdx === -1) {
        console.error("Data transformation failed: Missing Task ID column.");
        this.displayMessage("Missing essential data fields.");
        return;
    }

    // Single pass data structures
    const taskDataMap = new Map<string, {
        rows: any[],
        task: Task | null,
        relationships: Array<{
            predId: string,
            relType: string,
            lag: number | null
        }>
    }>();

    // SINGLE PASS: Group all rows by task ID
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex];
        const taskId = this.extractTaskId(row);
        if (!taskId) {
            console.warn(`Skipping row ${rowIndex}: Invalid or missing Task ID.`);
            continue;
        }

        // Get or create task data entry
        let taskData = taskDataMap.get(taskId);
        if (!taskData) {
            taskData = {
                rows: [],
                task: null,
                relationships: []
            };
            taskDataMap.set(taskId, taskData);
        }
        
        taskData.rows.push(row);

        // Extract relationship data if present
        if (predIdIdx !== -1 && row[predIdIdx] != null) {
            const predId = this.extractPredecessorId(row);
            if (predId && predId !== taskId) {
                // Parse relationship properties
                const relTypeRaw = (relTypeIdx !== -1 && row[relTypeIdx] != null) 
                    ? String(row[relTypeIdx]).trim().toUpperCase() 
                    : 'FS';
                const validRelTypes = ['FS', 'SS', 'FF', 'SF'];
                const relType = validRelTypes.includes(relTypeRaw) ? relTypeRaw : 'FS';

                let relLag: number | null = null;
                if (relLagIdx !== -1 && row[relLagIdx] != null) {
                    const parsedLag = Number(row[relLagIdx]);
                    if (!isNaN(parsedLag) && isFinite(parsedLag)) {
                        relLag = parsedLag;
                    }
                }

                // Check if this relationship already exists
                const existingRel = taskData.relationships.find(r => r.predId === predId);
                if (!existingRel) {
                    taskData.relationships.push({
                        predId: predId,
                        relType: relType,
                        lag: relLag
                    });
                }
            }
        }
    }

    // Process grouped data to create tasks and relationships
    const successorMap = new Map<string, Task[]>();
    
    taskDataMap.forEach((taskData, taskId) => {
        // Create task from first row (they should all have same task data)
        if (taskData.rows.length > 0 && !taskData.task) {
            taskData.task = this.createTaskFromRow(taskData.rows[0], 0);
        }
        
        if (!taskData.task) return;
        
        const task = taskData.task;
        
        // Build predecessor index
        if (!this.predecessorIndex.has(taskId)) {
            this.predecessorIndex.set(taskId, new Set());
        }
        
        // Apply relationships to task
        taskData.relationships.forEach(rel => {
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
            
            // Create relationship object (simplified - no free float)
            const relationship: Relationship = {
                predecessorId: rel.predId,
                successorId: taskId,
                type: rel.relType,
                freeFloat: null,  // No longer used
                lag: rel.lag,
                isCritical: false
            };
            this.relationships.push(relationship);
            
            // Add to relationship index
            if (!this.relationshipIndex.has(taskId)) {
                this.relationshipIndex.set(taskId, []);
            }
            this.relationshipIndex.get(taskId)!.push(relationship);
        });
        
        // Add task to collections
        this.allTasksData.push(task);
        this.taskIdToTask.set(taskId, task);
    });

    // Assign successors and predecessors with cached lookups
    this.allTasksData.forEach(task => {
        // Set successors from map
        task.successors = successorMap.get(task.internalId) || [];
        
        // Set predecessor task references
        task.predecessors = task.predecessorIds
            .map(id => this.taskIdToTask.get(id))
            .filter(t => t !== undefined) as Task[];
    });

    const endTime = performance.now();
    this.debugLog(`Data transformation complete in ${endTime - startTime}ms. ` +
                `Found ${this.allTasksData.length} tasks and ${this.relationships.length} relationships.`);
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
    
        // Re-sort the final limited set based on original yOrder
        tasksToShow.sort((a, b) => (a.yOrder ?? Infinity) - (b.yOrder ?? Infinity));
    
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
        const containerNode = this.scrollableContainer?.node();
        if (!containerNode || !this.mainSvg || !this.headerSvg) {
            console.error("Cannot display message, containers or svgs not ready.");
            return;
        }
        this.clearVisual();

        const width = containerNode?.clientWidth || 300;
        const height = containerNode?.clientHeight || Math.max(100, this.target.clientHeight - this.headerHeight); // Ensure min height

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

        // Redraw button and divider in header even when showing message
        const viewportWidth = this.lastUpdateOptions?.viewport.width || width;
        this.createOrUpdateToggleButton(viewportWidth);
        this.createOrUpdateVisualTitle();
        this.drawHeaderDivider(viewportWidth);
    }

private createTaskSelectionDropdown(): void {
    if (!this.dropdownContainer || !this.selectedTaskLabel) {
        console.warn("Dropdown elements not ready.");
        return;
    }

    const enableTaskSelection = this.settings.taskSelection.enableTaskSelection.value;
    const dropdownWidth = 200;
    const showSelectedTaskLabel = this.settings.taskSelection.showSelectedTaskLabel.value;

    // Show/hide dropdown based on settings
    this.dropdownContainer.style("display", enableTaskSelection ? "block" : "none");
    if (!enableTaskSelection) {
        this.selectedTaskLabel.style("display", "none");
        return;
    }

    // Remove existing input and list to recreate them
    this.dropdownContainer.selectAll("*").remove();
    
    // Position in second row of header
    this.dropdownContainer
        .style("position", "absolute")
        .style("top", "32px")    // Second row in header
        .style("left", "8px")     // Left side positioning
        .style("right", "auto")
        .style("transform", "none")
        .style("z-index", "20");
    
    // Create the input with enhanced styling
    this.dropdownInput = this.dropdownContainer.append("input")
        .attr("type", "text")
        .attr("class", "task-selection-input")
        .attr("placeholder", "Search for a task...")
        .style("width", `${dropdownWidth}px`)
        .style("height", "24px")  // Match other controls
        .style("padding", "4px 8px")
        .style("border", "1px solid #d0d0d0")
        .style("border-radius", "12px")
        .style("font-family", "Segoe UI, sans-serif")
        .style("font-size", "12px")
        .style("color", "#333")
        .style("box-sizing", "border-box")
        .style("outline", "none")
        .style("transition", "border-color 0.2s ease");

    // Add focus effects
    this.dropdownInput
        .on("focus", function() {
            d3.select(this).style("border-color", "#40a9ff");
        })
        .on("blur", function() {
            d3.select(this).style("border-color", "#d0d0d0");
        });

    // Create dropdown list with enhanced styling
    this.dropdownList = this.dropdownContainer.append("div")
        .attr("class", "task-selection-list")
        .style("position", "absolute")
        .style("top", "100%")
        .style("left", "0")
        .style("width", `${dropdownWidth}px`)
        .style("max-height", "200px")
        .style("margin-top", "4px")
        .style("overflow-y", "auto")
        .style("background", "white")
        .style("border", "1px solid #d0d0d0")
        .style("border-radius", "8px")
        .style("box-shadow", "0 2px 8px rgba(0,0,0,0.1)")
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
    
    // Sort tasks by name for better usability
    const sortedTasks = [...this.allTasksData].sort((a, b) => 
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
        .style("font-size", "11px")
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
    
    // Create dropdown items for tasks
    sortedTasks.forEach(task => {
        const taskName = task.name || `Task ${task.internalId}`;
        const item = this.dropdownList.append("div")
            .attr("class", "dropdown-item")
            .attr("data-task-id", task.internalId)
            .attr("data-task-name", taskName)
            .style("padding", "6px 10px")
            .style("cursor", "pointer")
            .style("border-bottom", "1px solid #f5f5f5")
            .style("white-space", "nowrap")
            .style("overflow", "hidden")
            .style("text-overflow", "ellipsis")
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

private createTraceModeToggle(): void {
    this.stickyHeaderContainer.selectAll(".trace-mode-toggle").remove();
    
    if (!this.settings.taskSelection.enableTaskSelection.value) return;
    
    const toggleContainer = this.stickyHeaderContainer.append("div")
        .attr("class", "trace-mode-toggle")
        .style("position", "absolute")
        .style("top", "32px")
        .style("left", "220px")
        .style("z-index", "20");
    
    const isDisabled = !this.selectedTaskId;
    
    // Enhanced toggle design
    const toggleWrapper = toggleContainer.append("div")
        .style("display", "flex")
        .style("align-items", "center")
        .style("gap", "6px");
    
    // Label
    toggleWrapper.append("span")
        .style("font-family", "Segoe UI, sans-serif")
        .style("font-size", "11px")
        .style("color", isDisabled ? "#999" : "#666")
        .style("white-space", "nowrap")
        .text("Trace:");
    
    // Toggle buttons container
    const toggleButtons = toggleWrapper.append("div")
        .style("display", "flex")
        .style("border", "1px solid #d0d0d0")
        .style("border-radius", "12px")
        .style("overflow", "hidden")
        .style("opacity", isDisabled ? "0.5" : "1")
        .style("height", "24px")
        .style("background", "white")
        .style("box-shadow", "0 1px 2px rgba(0,0,0,0.05)");
    
    // Backward Button with improved arrow
    const backwardButton = toggleButtons.append("div")
        .attr("class", "trace-mode-button backward")
        .style("padding", "0 12px")
        .style("cursor", isDisabled ? "not-allowed" : "pointer")
        .style("background-color", this.traceMode === "backward" ? "#1890ff" : "#ffffff")
        .style("border-right", "1px solid #d0d0d0")
        .style("display", "flex")
        .style("align-items", "center")
        .style("gap", "4px")
        .style("transition", "all 0.2s ease");
    
    // Improved backward arrow using SVG
    const backwardSvg = backwardButton.append("svg")
        .attr("width", "14")
        .attr("height", "14")
        .attr("viewBox", "0 0 14 14")
        .style("flex-shrink", "0");
    
    backwardSvg.append("path")
        .attr("d", "M 9 3 L 5 7 L 9 11")
        .attr("stroke", this.traceMode === "backward" ? "white" : "#666")
        .attr("stroke-width", "2")
        .attr("stroke-linecap", "round")
        .attr("stroke-linejoin", "round")
        .attr("fill", "none");
    
    backwardButton.append("span")
        .style("font-family", "Segoe UI, sans-serif")
        .style("font-size", "11px")
        .style("color", this.traceMode === "backward" ? "white" : "#666")
        .style("font-weight", this.traceMode === "backward" ? "500" : "400")
        .text("Back");
    
    // Forward Button with improved arrow
    const forwardButton = toggleButtons.append("div")
        .attr("class", "trace-mode-button forward")
        .style("padding", "0 12px")
        .style("cursor", isDisabled ? "not-allowed" : "pointer")
        .style("background-color", this.traceMode === "forward" ? "#1890ff" : "#ffffff")
        .style("display", "flex")
        .style("align-items", "center")
        .style("gap", "4px")
        .style("transition", "all 0.2s ease");
    
    forwardButton.append("span")
        .style("font-family", "Segoe UI, sans-serif")
        .style("font-size", "11px")
        .style("color", this.traceMode === "forward" ? "white" : "#666")
        .style("font-weight", this.traceMode === "forward" ? "500" : "400")
        .text("Forward");
    
    // Improved forward arrow using SVG
    const forwardSvg = forwardButton.append("svg")
        .attr("width", "14")
        .attr("height", "14")
        .attr("viewBox", "0 0 14 14")
        .style("flex-shrink", "0");
    
    forwardSvg.append("path")
        .attr("d", "M 5 3 L 9 7 L 5 11")
        .attr("stroke", this.traceMode === "forward" ? "white" : "#666")
        .attr("stroke-width", "2")
        .attr("stroke-linecap", "round")
        .attr("stroke-linejoin", "round")
        .attr("fill", "none");
    
    // Tooltip based on mode
    const tooltipText = isDisabled 
        ? "Select a task to enable tracing"
        : this.traceMode === "backward"
            ? "Showing predecessors leading to selected task"
            : "Showing successors from selected task";
    
    toggleContainer.append("title").text(tooltipText);
    
    if (!isDisabled) {
        const self = this;
        
        // Hover effects
        backwardButton
            .on("mouseover", function() {
                if (self.traceMode !== "backward") {
                    d3.select(this).style("background-color", "#f0f0f0");
                }
            })
            .on("mouseout", function() {
                if (self.traceMode !== "backward") {
                    d3.select(this).style("background-color", "#ffffff");
                }
            });
        
        forwardButton
            .on("mouseover", function() {
                if (self.traceMode !== "forward") {
                    d3.select(this).style("background-color", "#f0f0f0");
                }
            })
            .on("mouseout", function() {
                if (self.traceMode !== "forward") {
                    d3.select(this).style("background-color", "#ffffff");
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
                self.forceFullUpdate = true;
                if (self.lastUpdateOptions) {
                    self.update(self.lastUpdateOptions);
                }
            }
        });
    }
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

/**
 * Handles task selection and triggers recalculation
 */
private selectTask(taskId: string | null, taskName: string | null): void {
    // If same task clicked again, deselect it
    if (this.selectedTaskId === taskId) {
        taskId = null;
        taskName = null;
    }
    
    this.selectedTaskId = taskId;
    this.selectedTaskName = taskName;

    this.createOrUpdateVisualTitle();
    
    // Persist the selected task
    this.host.persistProperties({
        merge: [{
            objectName: "persistedState",
            properties: { selectedTaskId: this.selectedTaskId || "" },
            selector: null
        }]
    });
    
    // Update dropdown if exists
    if (!taskId && this.dropdownInput) {
        this.dropdownInput.property("value", "");
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
    
    // Update trace mode toggle
    this.createTraceModeToggle();
    
    // Ensure selected task is visible
    if (taskId) {
        this.ensureTaskVisible(taskId);
    }
    
    // ADDED: Force a full update for task selection change
    this.forceFullUpdate = true;
    
    // Trigger update
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
        return this.formattingSettingsService.buildFormattingModel(this.settings);
    }

    // Debug helper
    private debugLog(...args: unknown[]): void {
        if (this.debug) {
            console.log(...args);
        }
    }

} // End of Visual class