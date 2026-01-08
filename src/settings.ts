// settings.ts - Reorganized Professional Grade Settings

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import powerbi from "powerbi-visuals-api";

import Model = formattingSettings.Model;
import Card = formattingSettings.SimpleCard;
import Slice = formattingSettings.Slice;
import ColorPicker = formattingSettings.ColorPicker;
import NumUpDown = formattingSettings.NumUpDown;
import ToggleSwitch = formattingSettings.ToggleSwitch;
import ItemDropdown = formattingSettings.ItemDropdown;
import TextInput = formattingSettings.TextInput;

// Shared options
const lineStyleItems: powerbi.IEnumMember[] = [
    { value: "solid", displayName: "Solid" },
    { value: "dashed", displayName: "Dashed" },
    { value: "dotted", displayName: "Dotted" }
];

const fontFamilyItems: powerbi.IEnumMember[] = [
    { value: "Segoe UI", displayName: "Segoe UI" },
    { value: "Arial", displayName: "Arial" },
    { value: "Calibri", displayName: "Calibri" },
    { value: "Verdana", displayName: "Verdana" },
    { value: "Tahoma", displayName: "Tahoma" }
];

// ============================================================================
// 1. GENERAL SETTINGS - Theme and performance
// ============================================================================
class GeneralSettingsCard extends Card {
    name: string = "generalSettings";
    displayName: string = "General";

    visualBackgroundColor = new ColorPicker({
        name: "visualBackgroundColor",
        displayName: "Background Color",
        description: "Background color of the visual",
        value: { value: "#FFFFFF" }
    });

    alternatingRowColors = new ToggleSwitch({
        name: "alternatingRowColors",
        displayName: "Alternating Row Colors",
        description: "Use alternating background colors for rows",
        value: false
    });

    alternatingRowColor = new ColorPicker({
        name: "alternatingRowColor",
        displayName: "Alternate Row Color",
        description: "Background color for alternate rows",
        value: { value: "#FAFAFA" }
    });

    selectionHighlightColor = new ColorPicker({
        name: "selectionHighlightColor",
        displayName: "Selection Highlight Color",
        description: "Color used to highlight selected tasks",
        value: { value: "#0078D4" }
    });

    showTooltips = new ToggleSwitch({
        name: "showTooltips",
        displayName: "Show Tooltips",
        value: true
    });

    slices: Slice[] = [
        this.visualBackgroundColor,
        this.alternatingRowColors,
        this.alternatingRowColor,
        this.selectionHighlightColor,
        this.showTooltips
    ];
}

// ============================================================================
// 2. TASK BARS - Core task and milestone appearance
// ============================================================================
class TaskBarsCard extends Card {
    name: string = "taskBars";
    displayName: string = "Task Bars";

    taskColor = new ColorPicker({
        name: "taskColor",
        displayName: "Non-Critical Task Color",
        value: { value: "#0078D4" }
    });

    milestoneColor = new ColorPicker({
        name: "milestoneColor",
        displayName: "Milestone Color",
        value: { value: "#555555" }
    });

    taskHeight = new NumUpDown({
        name: "taskHeight",
        displayName: "Task Height (px)",
        value: 18,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 5 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 40 }
        }
    });

    taskBarCornerRadius = new NumUpDown({
        name: "taskBarCornerRadius",
        displayName: "Corner Radius (px)",
        description: "Roundness of task bar corners",
        value: 3,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 10 }
        }
    });

    taskBarStrokeColor = new ColorPicker({
        name: "taskBarStrokeColor",
        displayName: "Bar Outline Color",
        description: "Border color for task bars (leave empty for no outline)",
        value: { value: "" }
    });

    taskBarStrokeWidth = new NumUpDown({
        name: "taskBarStrokeWidth",
        displayName: "Bar Outline Width (px)",
        value: 0,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 3 }
        }
    });

    milestoneSize = new NumUpDown({
        name: "milestoneSize",
        displayName: "Milestone Size (px)",
        value: 12,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 4 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 30 }
        }
    });

    milestoneShape = new ItemDropdown({
        name: "milestoneShape",
        displayName: "Milestone Shape",
        items: [
            { value: "diamond", displayName: "Diamond" },
            { value: "circle", displayName: "Circle" },
            { value: "square", displayName: "Square" }
        ],
        value: { value: "diamond", displayName: "Diamond" }
    });

    slices: Slice[] = [
        this.taskColor,
        this.milestoneColor,
        this.taskHeight,
        this.taskBarCornerRadius,
        this.taskBarStrokeColor,
        this.taskBarStrokeWidth,
        this.milestoneSize,
        this.milestoneShape
    ];
}

// ============================================================================
// 3. CRITICAL PATH - Criticality settings
// ============================================================================
class CriticalPathCard extends Card {
    name: string = "criticalPath";
    displayName: string = "Critical Path";

    calculationMode = new ItemDropdown({
        name: "calculationMode",
        displayName: "Calculation Mode",
        description: "Choose between Longest Path (CPM) or Float-Based criticality",
        items: [
            { value: "longestPath", displayName: "Longest Path (CPM)" },
            { value: "floatBased", displayName: "Float-Based" }
        ],
        value: { value: "longestPath", displayName: "Longest Path (CPM)" }
    });

    criticalPathColor = new ColorPicker({
        name: "criticalPathColor",
        displayName: "Critical Path Color",
        description: "Color for critical task borders and glow",
        value: { value: "#E81123" }
    });

    criticalBorderWidth = new NumUpDown({
        name: "criticalBorderWidth",
        displayName: "Critical Border Width (px)",
        value: 2.5,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 10 }
        }
    });

    showNearCritical = new ToggleSwitch({
        name: "showNearCritical",
        displayName: "Highlight Near-Critical",
        value: true
    });

    nearCriticalColor = new ColorPicker({
        name: "nearCriticalColor",
        displayName: "Near-Critical Color",
        value: { value: "#F7941F" }
    });

    nearCriticalBorderWidth = new NumUpDown({
        name: "nearCriticalBorderWidth",
        displayName: "Near-Critical Border Width (px)",
        value: 2,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 10 }
        }
    });

    showFloatColumn = new ToggleSwitch({
        name: "showFloatColumn",
        displayName: "Show Float Column",
        description: "Display total float value next to task names",
        value: false
    });

    floatColumnWidth = new NumUpDown({
        name: "floatColumnWidth",
        displayName: "Float Column Width (px)",
        value: 40,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 25 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 80 }
        }
    });

    // Hidden property for persisting toggle state
    showAllTasks = new ToggleSwitch({
        name: "showAllTasks",
        displayName: "",
        value: false,
        visible: false
    });

    slices: Slice[] = [
        this.calculationMode,
        this.criticalPathColor,
        this.criticalBorderWidth,
        this.showNearCritical,
        this.nearCriticalColor,
        this.nearCriticalBorderWidth,
        this.showFloatColumn,
        this.floatColumnWidth,
        this.showAllTasks
    ];
}

// ============================================================================
// 4. COMPARISON BARS - Baseline and Previous Update
// ============================================================================
class ComparisonBarsCard extends Card {
    name: string = "comparisonBars";
    displayName: string = "Comparison Bars";

    showBaseline = new ToggleSwitch({
        name: "showBaseline",
        displayName: "Show Baseline",
        description: "Display baseline bars below the main task bars",
        value: true
    });

    baselineColor = new ColorPicker({
        name: "baselineColor",
        displayName: "Baseline Color",
        value: { value: "#2E8B57" }
    });

    baselineHeight = new NumUpDown({
        name: "baselineHeight",
        displayName: "Baseline Height (px)",
        value: 4,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 1 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 10 }
        }
    });

    baselineOffset = new NumUpDown({
        name: "baselineOffset",
        displayName: "Baseline Offset (px)",
        description: "Distance between task bar and baseline bar",
        value: 2,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 10 }
        }
    });

    showPreviousUpdate = new ToggleSwitch({
        name: "showPreviousUpdate",
        displayName: "Show Previous Update",
        description: "Display previous update bars below baseline bars",
        value: true
    });

    previousUpdateColor = new ColorPicker({
        name: "previousUpdateColor",
        displayName: "Previous Update Color",
        value: { value: "#9400D3" }
    });

    previousUpdateHeight = new NumUpDown({
        name: "previousUpdateHeight",
        displayName: "Previous Update Height (px)",
        value: 3,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 1 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 10 }
        }
    });

    previousUpdateOffset = new NumUpDown({
        name: "previousUpdateOffset",
        displayName: "Previous Update Offset (px)",
        value: 2,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 10 }
        }
    });

    slices: Slice[] = [
        this.showBaseline,
        this.baselineColor,
        this.baselineHeight,
        this.baselineOffset,
        this.showPreviousUpdate,
        this.previousUpdateColor,
        this.previousUpdateHeight,
        this.previousUpdateOffset
    ];
}

// ============================================================================
// 5. CONNECTOR LINES
// ============================================================================
class ConnectorLinesCard extends Card {
    name: string = "connectorLines";
    displayName: string = "Connector Lines";

    showConnectorToggle = new ToggleSwitch({
        name: "showConnectorToggle",
        displayName: "Show Toggle Button",
        description: "Show connector lines toggle in header",
        value: false
    });

    showConnectorLines = new ToggleSwitch({
        name: "showConnectorLines",
        displayName: "Show Connector Lines",
        value: true
    });

    connectorColor = new ColorPicker({
        name: "connectorColor",
        displayName: "Connector Color",
        value: { value: "#555555" }
    });

    connectorWidth = new NumUpDown({
        name: "connectorWidth",
        displayName: "Connector Width (px)",
        value: 0.5,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0.5 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 5 }
        }
    });

    criticalConnectorWidth = new NumUpDown({
        name: "criticalConnectorWidth",
        displayName: "Critical Path Width (px)",
        value: 0.5,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0.5 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 8 }
        }
    });

    elbowOffset = new NumUpDown({
        name: "elbowOffset",
        displayName: "Elbow Offset (px)",
        value: 15,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 5 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 50 }
        }
    });

    arrowHeadSize = new NumUpDown({
        name: "arrowHeadSize",
        displayName: "Arrow Head Size",
        description: "Size of arrow heads on connector lines",
        value: 6,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 3 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 15 }
        }
    });

    differentiateDrivers = new ToggleSwitch({
        name: "differentiateDrivers",
        displayName: "Differentiate Driving Lines",
        description: "Use different style for non-driving relationships",
        value: true
    });

    nonDrivingLineStyle = new ItemDropdown({
        name: "nonDrivingLineStyle",
        displayName: "Non-Driving Line Style",
        items: lineStyleItems,
        value: lineStyleItems.find(item => item.value === "dashed")
    });

    nonDrivingOpacity = new NumUpDown({
        name: "nonDrivingOpacity",
        displayName: "Non-Driving Opacity (%)",
        value: 40,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 10 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 100 }
        }
    });

    slices: Slice[] = [
        this.showConnectorToggle,
        this.showConnectorLines,
        this.connectorColor,
        this.connectorWidth,
        this.criticalConnectorWidth,
        this.elbowOffset,
        this.arrowHeadSize,
        this.differentiateDrivers,
        this.nonDrivingLineStyle,
        this.nonDrivingOpacity
    ];
}

// ============================================================================
// 6. TEXT & LABELS
// ============================================================================
class TextAndLabelsCard extends Card {
    name: string = "textAndLabels";
    displayName: string = "Text & Labels";

    fontFamily = new ItemDropdown({
        name: "fontFamily",
        displayName: "Font Family",
        items: fontFamilyItems,
        value: fontFamilyItems.find(item => item.value === "Segoe UI")
    });

    fontSize = new NumUpDown({
        name: "fontSize",
        displayName: "General Font Size (pt)",
        description: "Base font size for date labels and duration text",
        value: 9,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 6 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 16 }
        }
    });

    taskNameFontSize = new NumUpDown({
        name: "taskNameFontSize",
        displayName: "Task Name Font Size (pt)",
        value: 9,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 6 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 16 }
        }
    });

    labelColor = new ColorPicker({
        name: "labelColor",
        displayName: "Label Color",
        value: { value: "#252525" }
    });

    showDuration = new ToggleSwitch({
        name: "showDuration",
        displayName: "Show Duration",
        description: "Display duration text inside task bars",
        value: true
    });

    durationTextColor = new ColorPicker({
        name: "durationTextColor",
        displayName: "Duration Text Color",
        description: "Color for duration text (use 'Auto' for automatic contrast)",
        value: { value: "Auto" }
    });

    showFinishDates = new ToggleSwitch({
        name: "showFinishDates",
        displayName: "Show Finish Dates",
        value: true
    });

    dateBackgroundColor = new ColorPicker({
        name: "dateBackgroundColor",
        displayName: "Date Background Color",
        value: { value: "#FFFFFF" }
    });

    dateBackgroundTransparency = new NumUpDown({
        name: "dateBackgroundTransparency",
        displayName: "Date Background Transparency (%)",
        value: 20,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 100 }
        }
    });

    slices: Slice[] = [
        this.fontFamily,
        this.fontSize,
        this.taskNameFontSize,
        this.labelColor,
        this.showDuration,
        this.durationTextColor,
        this.showFinishDates,
        this.dateBackgroundColor,
        this.dateBackgroundTransparency
    ];
}

// ============================================================================
// 7. LAYOUT
// ============================================================================
class LayoutSettingsCard extends Card {
    name: string = "layoutSettings";
    displayName: string = "Layout";

    leftMargin = new NumUpDown({
        name: "leftMargin",
        displayName: "Left Margin (px)",
        value: 300,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 50 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 600 }
        }
    });

    taskPadding = new NumUpDown({
        name: "taskPadding",
        displayName: "Task Padding (px)",
        value: 12,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 30 }
        }
    });

    maxTasksToShow = new NumUpDown({
        name: "maxTasksToShow",
        displayName: "Max Tasks To Show",
        description: "Maximum tasks to display (prioritizes critical path)",
        value: 1000,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 5 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 30000 }
        }
    });

    headerHeight = new NumUpDown({
        name: "headerHeight",
        displayName: "Header Height (px)",
        description: "Height of the control header area",
        value: 110,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 80 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 150 }
        }
    });

    slices: Slice[] = [
        this.leftMargin,
        this.taskPadding,
        this.maxTasksToShow,
        this.headerHeight
    ];
}

// ============================================================================
// 8. GRID LINES - Combined horizontal and vertical
// ============================================================================
class GridLinesCard extends Card {
    name: string = "gridLines";
    displayName: string = "Grid Lines";

    // Horizontal
    showHorizontalLines = new ToggleSwitch({
        name: "showGridLines",
        displayName: "Show Horizontal Lines",
        value: true
    });

    horizontalLineColor = new ColorPicker({
        name: "gridLineColor",
        displayName: "Horizontal Line Color",
        value: { value: "#e0e0e0" }
    });

    horizontalLineWidth = new NumUpDown({
        name: "gridLineWidth",
        displayName: "Horizontal Line Width (px)",
        value: 1,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0.5 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 5 }
        }
    });

    horizontalLineStyle = new ItemDropdown({
        name: "gridLineStyle",
        displayName: "Horizontal Line Style",
        items: lineStyleItems,
        value: lineStyleItems.find(item => item.value === "dashed")
    });

    // Vertical
    showVerticalLines = new ToggleSwitch({
        name: "showVerticalLines",
        displayName: "Show Vertical Lines",
        value: true
    });

    verticalLineColor = new ColorPicker({
        name: "verticalLineColor",
        displayName: "Vertical Line Color",
        value: { value: "#EAEAEA" }
    });

    verticalLineWidth = new NumUpDown({
        name: "verticalLineWidth",
        displayName: "Vertical Line Width (px)",
        value: 1,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0.5 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 5 }
        }
    });

    verticalLineStyle = new ItemDropdown({
        name: "verticalLineStyle",
        displayName: "Vertical Line Style",
        items: lineStyleItems,
        value: lineStyleItems.find(item => item.value === "dotted")
    });

    showTimelineLabels = new ToggleSwitch({
        name: "showMonthLabels",
        displayName: "Show Timeline Labels",
        value: true
    });

    timelineLabelColor = new ColorPicker({
        name: "timelineLabelColor",
        displayName: "Timeline Label Color",
        value: { value: "#888888" }
    });

    timelineLabelFontSize = new NumUpDown({
        name: "timelineLabelFontSize",
        displayName: "Timeline Label Font Size (pt)",
        value: 9,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 16 }
        }
    });

    slices: Slice[] = [
        this.showHorizontalLines,
        this.horizontalLineColor,
        this.horizontalLineWidth,
        this.horizontalLineStyle,
        this.showVerticalLines,
        this.verticalLineColor,
        this.verticalLineWidth,
        this.verticalLineStyle,
        this.showTimelineLabels,
        this.timelineLabelColor,
        this.timelineLabelFontSize
    ];
}

// ============================================================================
// 9. PROJECT FINISH LINE
// ============================================================================
class ProjectFinishLineCard extends Card {
    name: string = "projectEndLine";
    displayName: string = "Project Finish Line";

    show = new ToggleSwitch({ name: "show", displayName: "Show Line", value: true });
    lineColor = new ColorPicker({ name: "lineColor", displayName: "Line Color", value: { value: "#4CAF50" } });
    lineWidth = new NumUpDown({ name: "lineWidth", displayName: "Line Width (px)", value: 1.5, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0.5 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 5 } } });
    lineStyle = new ItemDropdown({ name: "lineStyle", displayName: "Line Style", items: lineStyleItems, value: lineStyleItems.find(item => item.value === "dashed") });
    showLabel = new ToggleSwitch({ name: "showLabel", displayName: "Show Label", value: true });
    labelColor = new ColorPicker({ name: "labelColor", displayName: "Label Color", value: { value: "#333333" } });
    labelFontSize = new NumUpDown({ name: "labelFontSize", displayName: "Label Font Size (pt)", value: 9, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 6 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 16 } } });
    showLabelPrefix = new ToggleSwitch({ name: "showLabelPrefix", displayName: "Show 'Finish:' Prefix", value: true });
    labelBackgroundColor = new ColorPicker({ name: "labelBackgroundColor", displayName: "Label Background", value: { value: "#FFFFFF" } });
    labelBackgroundTransparency = new NumUpDown({ name: "labelBackgroundTransparency", displayName: "Label Background Transparency (%)", value: 0, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 100 } } });

    slices: Slice[] = [this.show, this.lineColor, this.lineWidth, this.lineStyle, this.showLabel, this.labelColor, this.labelFontSize, this.showLabelPrefix, this.labelBackgroundColor, this.labelBackgroundTransparency];
}

// ============================================================================
// 10. BASELINE FINISH LINE
// ============================================================================
class BaselineFinishLineCard extends Card {
    name: string = "baselineFinishLine";
    displayName: string = "Baseline Finish Line";

    show = new ToggleSwitch({ name: "show", displayName: "Show Line", value: true });
    lineWidth = new NumUpDown({ name: "lineWidth", displayName: "Line Width (px)", value: 1.5, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0.5 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 5 } } });
    lineStyle = new ItemDropdown({ name: "lineStyle", displayName: "Line Style", items: lineStyleItems, value: lineStyleItems.find(item => item.value === "dashed") });
    showLabel = new ToggleSwitch({ name: "showLabel", displayName: "Show Label", value: true });
    labelColor = new ColorPicker({ name: "labelColor", displayName: "Label Color", value: { value: "#2E8B57" } });
    labelFontSize = new NumUpDown({ name: "labelFontSize", displayName: "Label Font Size (pt)", value: 9, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 6 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 16 } } });
    showLabelPrefix = new ToggleSwitch({ name: "showLabelPrefix", displayName: "Show 'Baseline Finish:' Prefix", value: true });
    labelBackgroundColor = new ColorPicker({ name: "labelBackgroundColor", displayName: "Label Background", value: { value: "#FFFFFF" } });
    labelBackgroundTransparency = new NumUpDown({ name: "labelBackgroundTransparency", displayName: "Label Background Transparency (%)", value: 0, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 100 } } });

    slices: Slice[] = [this.show, this.lineWidth, this.lineStyle, this.showLabel, this.labelColor, this.labelFontSize, this.showLabelPrefix, this.labelBackgroundColor, this.labelBackgroundTransparency];
}

// ============================================================================
// 11. PREVIOUS UPDATE FINISH LINE
// ============================================================================
class PreviousUpdateFinishLineCard extends Card {
    name: string = "previousUpdateFinishLine";
    displayName: string = "Previous Update Finish Line";

    show = new ToggleSwitch({ name: "show", displayName: "Show Line", value: true });
    lineWidth = new NumUpDown({ name: "lineWidth", displayName: "Line Width (px)", value: 1.5, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0.5 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 5 } } });
    lineStyle = new ItemDropdown({ name: "lineStyle", displayName: "Line Style", items: lineStyleItems, value: lineStyleItems.find(item => item.value === "dashed") });
    showLabel = new ToggleSwitch({ name: "showLabel", displayName: "Show Label", value: true });
    labelColor = new ColorPicker({ name: "labelColor", displayName: "Label Color", value: { value: "#9400D3" } });
    labelFontSize = new NumUpDown({ name: "labelFontSize", displayName: "Label Font Size (pt)", value: 9, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 6 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 16 } } });
    showLabelPrefix = new ToggleSwitch({ name: "showLabelPrefix", displayName: "Show 'Previous Finish:' Prefix", value: true });
    labelBackgroundColor = new ColorPicker({ name: "labelBackgroundColor", displayName: "Label Background", value: { value: "#FFFFFF" } });
    labelBackgroundTransparency = new NumUpDown({ name: "labelBackgroundTransparency", displayName: "Label Background Transparency (%)", value: 0, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 100 } } });

    slices: Slice[] = [this.show, this.lineWidth, this.lineStyle, this.showLabel, this.labelColor, this.labelFontSize, this.showLabelPrefix, this.labelBackgroundColor, this.labelBackgroundTransparency];
}

// ============================================================================
// 12. DATA DATE LINE
// ============================================================================
class DataDateLineCard extends Card {
    name: string = "dataDateLine";
    displayName: string = "Data Date Line";

    show = new ToggleSwitch({ name: "show", displayName: "Show Line", value: true });
    lineColor = new ColorPicker({ name: "lineColor", displayName: "Line Color", value: { value: "#7C3AED" } });
    lineWidth = new NumUpDown({ name: "lineWidth", displayName: "Line Width (px)", value: 1.5, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0.5 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 5 } } });
    lineStyle = new ItemDropdown({ name: "lineStyle", displayName: "Line Style", items: lineStyleItems, value: lineStyleItems.find(item => item.value === "dotted") });
    showLabel = new ToggleSwitch({ name: "showLabel", displayName: "Show Label", value: true });
    labelColor = new ColorPicker({ name: "labelColor", displayName: "Label Color", value: { value: "#333333" } });
    labelFontSize = new NumUpDown({ name: "labelFontSize", displayName: "Label Font Size (pt)", value: 9, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 6 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 16 } } });
    showLabelPrefix = new ToggleSwitch({ name: "showLabelPrefix", displayName: "Show 'Data Date:' Prefix", value: true });
    labelBackgroundColor = new ColorPicker({ name: "labelBackgroundColor", displayName: "Label Background", value: { value: "#FFFFFF" } });
    labelBackgroundTransparency = new NumUpDown({ name: "labelBackgroundTransparency", displayName: "Label Background Transparency (%)", value: 0, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 100 } } });

    slices: Slice[] = [this.show, this.lineColor, this.lineWidth, this.lineStyle, this.showLabel, this.labelColor, this.labelFontSize, this.showLabelPrefix, this.labelBackgroundColor, this.labelBackgroundTransparency];
}

// ============================================================================
// 13. PATH SELECTION - Task selection and multi-path
// ============================================================================
class PathSelectionCard extends Card {
    name: string = "pathSelection";
    displayName: string = "Path Selection";

    enableTaskSelection = new ToggleSwitch({
        name: "enableTaskSelection",
        displayName: "Enable Task Selection",
        value: true
    });

    dropdownWidth = new NumUpDown({
        name: "dropdownWidth",
        displayName: "Dropdown Width (px)",
        value: 280,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 150 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 500 }
        }
    });

    dropdownPosition = new ItemDropdown({
        name: "dropdownPosition",
        displayName: "Dropdown Position",
        items: [
            { value: "left", displayName: "Left" },
            { value: "center", displayName: "Center" },
            { value: "right", displayName: "Right" }
        ],
        value: { value: "left", displayName: "Left" }
    });

    showSelectedTaskLabel = new ToggleSwitch({
        name: "showSelectedTaskLabel",
        displayName: "Show Selected Task Label",
        value: false
    });

    traceMode = new ItemDropdown({
        name: "traceMode",
        displayName: "Trace Mode",
        description: "Trace critical path backward to or forward from selected task",
        items: [
            { value: "backward", displayName: "Trace Backward" },
            { value: "forward", displayName: "Trace Forward" }
        ],
        value: { value: "backward", displayName: "Trace Backward" }
    });

    enableMultiPathToggle = new ToggleSwitch({
        name: "enableMultiPathToggle",
        displayName: "Enable Multi-Path Toggle",
        description: "Toggle between driving paths of equal duration",
        value: true
    });

    selectedPathIndex = new NumUpDown({
        name: "selectedPathIndex",
        displayName: "Selected Path",
        value: 1,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 1 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 100 }
        }
    });

    showPathInfo = new ToggleSwitch({
        name: "showPathInfo",
        displayName: "Show Path Information",
        value: true
    });

    slices: Slice[] = [
        this.enableTaskSelection,
        this.dropdownWidth,
        this.dropdownPosition,
        this.showSelectedTaskLabel,
        this.traceMode,
        this.enableMultiPathToggle,
        this.selectedPathIndex,
        this.showPathInfo
    ];
}

// ============================================================================
// 14. WBS GROUPING
// ============================================================================
class WBSGroupingCard extends Card {
    name: string = "wbsGrouping";
    displayName: string = "WBS Grouping";

    enableWbsGrouping = new ToggleSwitch({ name: "enableWbsGrouping", displayName: "Enable WBS Grouping", value: false });
    defaultExpanded = new ToggleSwitch({ name: "defaultExpanded", displayName: "Default Expanded", value: true });
    expandCollapseAll = new ToggleSwitch({ name: "expandCollapseAll", displayName: "Expand All Groups", value: true });
    showWbsToggle = new ToggleSwitch({ name: "showWbsToggle", displayName: "Show WBS Toggle Button", value: true });
    hideEmptyGroups = new ToggleSwitch({ name: "hideEmptyGroups", displayName: "Hide Empty Groups", value: true });
    showGroupSummary = new ToggleSwitch({ name: "showGroupSummary", displayName: "Show Group Summary Bar", value: true });
    groupHeaderColor = new ColorPicker({ name: "groupHeaderColor", displayName: "Group Header Background", value: { value: "#F0F0F0" } });
    groupSummaryColor = new ColorPicker({ name: "groupSummaryColor", displayName: "Group Summary Bar Color", value: { value: "#808080" } });
    groupNameFontSize = new NumUpDown({ name: "groupNameFontSize", displayName: "Group Name Font Size (pt)", value: 0, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 24 } } });
    groupNameColor = new ColorPicker({ name: "groupNameColor", displayName: "Group Name Color", value: { value: "#333333" } });
    indentPerLevel = new NumUpDown({ name: "indentPerLevel", displayName: "Indent Per Level (px)", value: 20, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 50 } } });

    slices: Slice[] = [this.enableWbsGrouping, this.defaultExpanded, this.expandCollapseAll, this.showWbsToggle, this.hideEmptyGroups, this.showGroupSummary, this.groupHeaderColor, this.groupSummaryColor, this.groupNameFontSize, this.groupNameColor, this.indentPerLevel];
}

// ============================================================================
// 15. WBS LEVEL STYLES
// ============================================================================
class WbsLevelStylesCard extends Card {
    name: string = "wbsLevelStyles";
    displayName: string = "WBS Level Styles";

    level1Background = new ColorPicker({ name: "level1Background", displayName: "Level 1 Background", value: { value: "" } });
    level1Text = new ColorPicker({ name: "level1Text", displayName: "Level 1 Text", value: { value: "" } });
    level2Background = new ColorPicker({ name: "level2Background", displayName: "Level 2 Background", value: { value: "" } });
    level2Text = new ColorPicker({ name: "level2Text", displayName: "Level 2 Text", value: { value: "" } });
    level3Background = new ColorPicker({ name: "level3Background", displayName: "Level 3 Background", value: { value: "" } });
    level3Text = new ColorPicker({ name: "level3Text", displayName: "Level 3 Text", value: { value: "" } });
    level4Background = new ColorPicker({ name: "level4Background", displayName: "Level 4 Background", value: { value: "" } });
    level4Text = new ColorPicker({ name: "level4Text", displayName: "Level 4 Text", value: { value: "" } });
    level5Background = new ColorPicker({ name: "level5Background", displayName: "Level 5 Background", value: { value: "" } });
    level5Text = new ColorPicker({ name: "level5Text", displayName: "Level 5 Text", value: { value: "" } });
    level6Background = new ColorPicker({ name: "level6Background", displayName: "Level 6 Background", value: { value: "" } });
    level6Text = new ColorPicker({ name: "level6Text", displayName: "Level 6 Text", value: { value: "" } });
    level7Background = new ColorPicker({ name: "level7Background", displayName: "Level 7 Background", value: { value: "" } });
    level7Text = new ColorPicker({ name: "level7Text", displayName: "Level 7 Text", value: { value: "" } });
    level8Background = new ColorPicker({ name: "level8Background", displayName: "Level 8 Background", value: { value: "" } });
    level8Text = new ColorPicker({ name: "level8Text", displayName: "Level 8 Text", value: { value: "" } });
    level9Background = new ColorPicker({ name: "level9Background", displayName: "Level 9 Background", value: { value: "" } });
    level9Text = new ColorPicker({ name: "level9Text", displayName: "Level 9 Text", value: { value: "" } });
    level10Background = new ColorPicker({ name: "level10Background", displayName: "Level 10 Background", value: { value: "" } });
    level10Text = new ColorPicker({ name: "level10Text", displayName: "Level 10 Text", value: { value: "" } });

    slices: Slice[] = [
        this.level1Background, this.level1Text, this.level2Background, this.level2Text,
        this.level3Background, this.level3Text, this.level4Background, this.level4Text,
        this.level5Background, this.level5Text, this.level6Background, this.level6Text,
        this.level7Background, this.level7Text, this.level8Background, this.level8Text,
        this.level9Background, this.level9Text, this.level10Background, this.level10Text
    ];
}

// ============================================================================
// 16. LEGEND
// ============================================================================
class LegendCard extends Card {
    name: string = "legend";
    displayName: string = "Legend";

    show = new ToggleSwitch({ name: "show", displayName: "Show Legend", value: true });
    fontSize = new NumUpDown({ name: "fontSize", displayName: "Font Size (pt)", value: 10, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 8 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 20 } } });
    showTitle = new ToggleSwitch({ name: "showTitle", displayName: "Show Title", value: true });
    titleText = new TextInput({ name: "titleText", displayName: "Title Text", value: "", placeholder: "Legend title..." });
    sortOrder = new ItemDropdown({
        name: "sortOrder",
        displayName: "Sort Order",
        items: [
            { value: "none", displayName: "Data Order" },
            { value: "ascending", displayName: "Ascending (A-Z)" },
            { value: "descending", displayName: "Descending (Z-A)" }
        ],
        value: { value: "none", displayName: "Data Order" }
    });

    slices: Slice[] = [this.show, this.fontSize, this.showTitle, this.titleText, this.sortOrder];
}

// ============================================================================
// 17. LEGEND COLORS
// ============================================================================
class LegendColorsCard extends Card {
    name: string = "legendColors";
    displayName: string = "Legend Colors";

    color1 = new ColorPicker({ name: "color1", displayName: "Color 1", value: { value: "" } });
    color2 = new ColorPicker({ name: "color2", displayName: "Color 2", value: { value: "" } });
    color3 = new ColorPicker({ name: "color3", displayName: "Color 3", value: { value: "" } });
    color4 = new ColorPicker({ name: "color4", displayName: "Color 4", value: { value: "" } });
    color5 = new ColorPicker({ name: "color5", displayName: "Color 5", value: { value: "" } });
    color6 = new ColorPicker({ name: "color6", displayName: "Color 6", value: { value: "" } });
    color7 = new ColorPicker({ name: "color7", displayName: "Color 7", value: { value: "" } });
    color8 = new ColorPicker({ name: "color8", displayName: "Color 8", value: { value: "" } });
    color9 = new ColorPicker({ name: "color9", displayName: "Color 9", value: { value: "" } });
    color10 = new ColorPicker({ name: "color10", displayName: "Color 10", value: { value: "" } });
    color11 = new ColorPicker({ name: "color11", displayName: "Color 11", value: { value: "" } });
    color12 = new ColorPicker({ name: "color12", displayName: "Color 12", value: { value: "" } });
    color13 = new ColorPicker({ name: "color13", displayName: "Color 13", value: { value: "" } });
    color14 = new ColorPicker({ name: "color14", displayName: "Color 14", value: { value: "" } });
    color15 = new ColorPicker({ name: "color15", displayName: "Color 15", value: { value: "" } });
    color16 = new ColorPicker({ name: "color16", displayName: "Color 16", value: { value: "" } });
    color17 = new ColorPicker({ name: "color17", displayName: "Color 17", value: { value: "" } });
    color18 = new ColorPicker({ name: "color18", displayName: "Color 18", value: { value: "" } });
    color19 = new ColorPicker({ name: "color19", displayName: "Color 19", value: { value: "" } });
    color20 = new ColorPicker({ name: "color20", displayName: "Color 20", value: { value: "" } });

    slices: Slice[] = [
        this.color1, this.color2, this.color3, this.color4, this.color5,
        this.color6, this.color7, this.color8, this.color9, this.color10,
        this.color11, this.color12, this.color13, this.color14, this.color15,
        this.color16, this.color17, this.color18, this.color19, this.color20
    ];
}

// ============================================================================
// 18. TIMELINE ZOOM SLIDER
// ============================================================================
class TimelineZoomCard extends Card {
    name: string = "timelineZoom";
    displayName: string = "Timeline Zoom";

    enableZoomSlider = new ToggleSwitch({ name: "enableZoomSlider", displayName: "Enable Zoom Slider", value: true });
    sliderHeight = new NumUpDown({ name: "sliderHeight", displayName: "Slider Height (px)", value: 32, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 24 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 60 } } });
    sliderTrackColor = new ColorPicker({ name: "sliderTrackColor", displayName: "Track Color", value: { value: "#E1DFDD" } });
    sliderSelectedColor = new ColorPicker({ name: "sliderSelectedColor", displayName: "Selected Range Color", value: { value: "#C8C6C4" } });
    sliderHandleColor = new ColorPicker({ name: "sliderHandleColor", displayName: "Handle Color", value: { value: "#605E5C" } });
    showMiniChart = new ToggleSwitch({ name: "showMiniChart", displayName: "Show Mini Preview", value: false });

    slices: Slice[] = [this.enableZoomSlider, this.sliderHeight, this.showMiniChart, this.sliderTrackColor, this.sliderSelectedColor, this.sliderHandleColor];
}

// ============================================================================
// 19. PERSISTED STATE (Hidden)
// ============================================================================
class PersistedStateCard extends Card {
    name: string = "persistedState";
    displayName: string = "Persisted State";
    visible: boolean = false;

    selectedTaskId = new TextInput({ name: "selectedTaskId", displayName: "", value: "", placeholder: "", visible: false });
    floatThreshold = new NumUpDown({ name: "floatThreshold", displayName: "", value: 0, visible: false });
    traceMode = new TextInput({ name: "traceMode", displayName: "", value: "backward", placeholder: "", visible: false });
    selectedLegendCategories = new TextInput({ name: "selectedLegendCategories", displayName: "", value: "", placeholder: "", visible: false });
    wbsExpandLevel = new NumUpDown({ name: "wbsExpandLevel", displayName: "", value: -2, visible: false });
    wbsExpandedState = new TextInput({ name: "wbsExpandedState", displayName: "", value: "", placeholder: "", visible: false });
    wbsManualToggledGroups = new TextInput({ name: "wbsManualToggledGroups", displayName: "", value: "", placeholder: "", visible: false });
    zoomRangeStart = new NumUpDown({ name: "zoomRangeStart", displayName: "", value: 0, visible: false });
    zoomRangeEnd = new NumUpDown({ name: "zoomRangeEnd", displayName: "", value: 1, visible: false });

    slices: Slice[] = [this.selectedTaskId, this.floatThreshold, this.traceMode, this.selectedLegendCategories, this.wbsExpandLevel, this.wbsExpandedState, this.wbsManualToggledGroups, this.zoomRangeStart, this.zoomRangeEnd];
}

// ============================================================================
// VISUAL SETTINGS EXPORT
// ============================================================================
export class VisualSettings extends Model {
    generalSettings = new GeneralSettingsCard();
    taskBars = new TaskBarsCard();
    criticalPath = new CriticalPathCard();
    comparisonBars = new ComparisonBarsCard();
    connectorLines = new ConnectorLinesCard();
    textAndLabels = new TextAndLabelsCard();
    layoutSettings = new LayoutSettingsCard();
    gridLines = new GridLinesCard();
    projectEndLine = new ProjectFinishLineCard();
    baselineFinishLine = new BaselineFinishLineCard();
    previousUpdateFinishLine = new PreviousUpdateFinishLineCard();
    dataDateLine = new DataDateLineCard();
    pathSelection = new PathSelectionCard();
    wbsGrouping = new WBSGroupingCard();
    wbsLevelStyles = new WbsLevelStylesCard();
    legend = new LegendCard();
    legendColors = new LegendColorsCard();
    timelineZoom = new TimelineZoomCard();
    persistedState = new PersistedStateCard();

    cards: Card[] = [
        this.generalSettings,
        this.taskBars,
        this.criticalPath,
        this.comparisonBars,
        this.connectorLines,
        this.textAndLabels,
        this.layoutSettings,
        this.gridLines,
        this.projectEndLine,
        this.baselineFinishLine,
        this.previousUpdateFinishLine,
        this.dataDateLine,
        this.pathSelection,
        this.wbsGrouping,
        this.wbsLevelStyles,
        this.legend,
        this.legendColors,
        this.timelineZoom,
        this.persistedState
    ];
}
