// settings.ts

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import powerbi from "powerbi-visuals-api"; // For ValidatorType and IEnumMember

// Use aliases
import Model = formattingSettings.Model;
import Card = formattingSettings.SimpleCard;
import Slice = formattingSettings.Slice;
import ColorPicker = formattingSettings.ColorPicker;
import NumUpDown = formattingSettings.NumUpDown;
import ToggleSwitch = formattingSettings.ToggleSwitch;
import ItemDropdown = formattingSettings.ItemDropdown;
import TextInput = formattingSettings.TextInput;

// Shared line style options
const lineStyleItems: powerbi.IEnumMember[] = [
    { value: "solid", displayName: "Solid" },
    { value: "dashed", displayName: "Dashed" },
    { value: "dotted", displayName: "Dotted" }
];

// --- Formatting Card Definitions ---

class TaskAppearanceCard extends Card {
    name: string = "taskAppearance"; displayName: string = "Task Appearance";
    taskColor = new ColorPicker({ name: "taskColor", displayName: "Non-Critical Task Color", value: { value: "#0078D4" } }); // Blue color for non-critical tasks
    criticalPathColor = new ColorPicker({ name: "criticalPathColor", displayName: "Longest Path Color", description: "Color for critical task borders and glow", value: { value: "#E81123" } });
    nearCriticalColor = new ColorPicker({ name: "nearCriticalColor", displayName: "Near-Critical Color", description: "Color for near-critical task borders and glow", value: { value: "#F7941F" } });
    milestoneColor = new ColorPicker({ name: "milestoneColor", displayName: "Milestone Color", value: { value: "#555555" } });
    taskHeight = new NumUpDown({ name: "taskHeight", displayName: "Task Height (px)", value: 18, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 5 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 40 } } });
    milestoneSize = new NumUpDown({ name: "milestoneSize", displayName: "Milestone Size (px)", description: "Size of milestone markers (px)", value: 12, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 4 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 30 } } });
    criticalBorderWidth = new NumUpDown({ name: "criticalBorderWidth", displayName: "Critical Border Width (px)", description: "Border thickness for critical tasks", value: 2.5, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 10 } } });
    nearCriticalBorderWidth = new NumUpDown({ name: "nearCriticalBorderWidth", displayName: "Near-Critical Border Width (px)", description: "Border thickness for near-critical tasks", value: 2, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 10 } } });

    // --- NEW: Baseline Settings ---
    showBaseline = new ToggleSwitch({
        name: "showBaseline",
        displayName: "Show Baseline",
        description: "Display baseline bars below the main task bars",
        value: true 
    });
    baselineColor = new ColorPicker({
        name: "baselineColor",
        displayName: "Baseline Color",
        value: { value: "#2E8B57" } // A neutral gray
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
        displayName: "Baseline Vertical Offset (px)",
        description: "Distance between the main task bar and the baseline bar",
        value: 2,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 10 }
        }
    });
    showPreviousUpdate = new ToggleSwitch({
    name: "showPreviousUpdate",
    displayName: "Show Previous Update",
    description: "Display previous update bars below the baseline bars",
    value: true 
    });
    previousUpdateColor = new ColorPicker({
        name: "previousUpdateColor",
        displayName: "Previous Update Color",
        value: { value: "#9400D3" } // A golden/amber color to differentiate from baseline
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
        displayName: "Previous Update Vertical Offset (px)",
        description: "Distance between the baseline bar and the previous update bar",
        value: 2,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 10 }
        }
    });

    slices: Slice[] = [
        this.taskColor, this.criticalPathColor, this.nearCriticalColor, this.milestoneColor,
        this.taskHeight, this.milestoneSize,
        this.criticalBorderWidth, this.nearCriticalBorderWidth,
        this.showBaseline, this.baselineColor, this.baselineHeight, this.baselineOffset,
        this.showPreviousUpdate, this.previousUpdateColor, this.previousUpdateHeight, this.previousUpdateOffset
    ];
 }

 class ConnectorLinesCard extends Card {
    name: string = "connectorLines"; displayName: string = "Connector Lines";
    showConnectorToggle = new ToggleSwitch({
        name: "showConnectorToggle",
        displayName: "Show Connector Toggle Button",
        description: "Show or hide the connector lines toggle button in the header",
        value: false // Default to hidden
    });
    connectorColor = new ColorPicker({ name: "connectorColor", displayName: "Connector Color", value: { value: "#555555" } });
    connectorWidth = new NumUpDown({ name: "connectorWidth", displayName: "Connector Width (px)", value: 0.5, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0.5 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 5 } } });
    criticalConnectorWidth = new NumUpDown({ name: "criticalConnectorWidth", displayName: "Longest Path Width (px)", value: 0.5, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0.5 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 8 } } });
    // Remove arrowSize property
    elbowOffset = new NumUpDown({ 
        name: "elbowOffset", 
        displayName: "Elbow Offset (px)", 
        description: "Controls the distance of connector line bends",
        value: 15, 
        options: { 
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 5 }, 
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 50 } 
        } 
    });
    slices: Slice[] = [ this.showConnectorToggle, this.connectorColor, this.connectorWidth, this.criticalConnectorWidth, this.elbowOffset ];
}

class TextAndLabelsCard extends Card {
    name: string = "textAndLabels"; displayName: string = "Text & Labels";
    fontSize = new NumUpDown({ name: "fontSize", displayName: "General Font Size (pt)", description: "Base font size for date labels and duration text", value: 9, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 6 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 16 } } });
    taskNameFontSize = new NumUpDown({ name: "taskNameFontSize", displayName: "Task Name Font Size (pt)", description: "Font size for task names in the left margin", value: 9, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 6 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 16 } } });
    labelColor = new ColorPicker({ name: "labelColor", displayName: "Label Color", value: { value: "#252525" } });
    showDuration = new ToggleSwitch({ name: "showDuration", displayName: "Show Duration (CPM)", description: "Display calculated CPM duration text inside task bars", value: true });
    durationTextColor = new ColorPicker({ name: "durationTextColor", displayName: "Duration Text Color", description: "Color for duration text inside bars (use 'Auto' for automatic contrast)", value: { value: "Auto" } });
    showFinishDates = new ToggleSwitch({ name: "showFinishDates", displayName: "Show Finish Dates", description: "Display finish date labels next to tasks/milestones", value: true });
    dateBackgroundColor = new ColorPicker({ name: "dateBackgroundColor", displayName: "Date Background Color", value: { value: "#FFFFFF" } });
    dateBackgroundTransparency = new NumUpDown({ name: "dateBackgroundTransparency", displayName: "Date Background Transparency (%)", value: 20, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 100 } } });
    slices: Slice[] = [ this.fontSize, this.taskNameFontSize, this.labelColor, this.showDuration, this.durationTextColor, this.showFinishDates, this.dateBackgroundColor, this.dateBackgroundTransparency ];
}

class LayoutSettingsCard extends Card {
    name: string = "layoutSettings"; displayName: string = "Layout";
    leftMargin = new NumUpDown({ name: "leftMargin", displayName: "Left Margin (px)", value: 300, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 50 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 600 } } });
    taskPadding = new NumUpDown({ name: "taskPadding", displayName: "Task Padding (px)", value: 12, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 30 } } });
    maxTasksToShow = new NumUpDown({ name: "maxTasksToShow", displayName: "Max Tasks To Show", description: "Maximum tasks to display (prioritizes critical path)", value: 1000, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 5 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 20000 } } });
    slices: Slice[] = [ this.leftMargin, this.taskPadding, this.maxTasksToShow ];
}

// Renamed existing gridlines card
class HorizontalGridLinesCard extends Card {
    name: string = "gridLines"; // Keep original name for compatibility
    displayName: string = "Horizontal Grid Lines"; // Updated display name

    showGridLines = new ToggleSwitch({ name: "showGridLines", displayName: "Show Horizontal Lines", value: true });
    gridLineColor = new ColorPicker({ name: "gridLineColor", displayName: "Color", value: { value: "#e0e0e0" } });
    gridLineWidth = new NumUpDown({ name: "gridLineWidth", displayName: "Width (px)", value: 1, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0.5 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 5 } } });
    gridLineStyle = new ItemDropdown({ name: "gridLineStyle", displayName: "Style", items: lineStyleItems, value: lineStyleItems.find(item => item.value === "dashed") });
    slices: Slice[] = [ this.showGridLines, this.gridLineColor, this.gridLineWidth, this.gridLineStyle ];
}

// *** NEW CARD for Vertical Grid Lines ***
class VerticalGridLinesCard extends Card {
    name: string = "verticalGridLines"; // Matches capabilities object name
    displayName: string = "Vertical Grid Lines (Monthly)";

    show = new ToggleSwitch({
        name: "show", // Matches capabilities property name
        displayName: "Show Vertical Lines",
        value: true // Default to show
    });
    lineColor = new ColorPicker({
        name: "lineColor",
        displayName: "Color",
        value: { value: "#EAEAEA" } // Default color (light gray)
    });
    lineWidth = new NumUpDown({
        name: "lineWidth",
        displayName: "Width (px)",
        value: 1, // Default width
        options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0.5 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 5 } }
    });
    lineStyle = new ItemDropdown({
        name: "lineStyle",
        displayName: "Style",
        items: lineStyleItems, // Reuse the same items array
        value: lineStyleItems.find(item => item.value === "dotted") // Default style
    });
     showMonthLabels = new ToggleSwitch({
         name: "showMonthLabels",
         displayName: "Show Month Labels",
         value: true // Default to show labels
     });
     labelColor = new ColorPicker({
         name: "labelColor",
         displayName: "Label Color",
          description: "Color for month labels (uses line color if blank)",
         value: { value: "#888888" } // Default label color (darker gray)
     });
     labelFontSize = new NumUpDown({
         name: "labelFontSize",
         displayName: "Label Font Size (pt)",
         description: "Font size for month labels (uses General Font Size if 0)",
         value: 9, // Default font size
         options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 16 } }
     });

    // Define the slices for this card
    slices: Slice[] = [
        this.show, this.lineColor, this.lineWidth, this.lineStyle,
        this.showMonthLabels, this.labelColor, this.labelFontSize
    ];
}
// *** END NEW CARD ***

class ProjectEndLineCard extends Card {
    name: string = "projectEndLine"; displayName: string = "Project End Line";
    show = new ToggleSwitch({ name: "show", displayName: "Show Line", value: true });
    lineColor = new ColorPicker({ name: "lineColor", displayName: "Color", value: { value: "green" } });
    lineWidth = new NumUpDown({ name: "lineWidth", displayName: "Width (px)", value: 1.5, options: { minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0.5 }, maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 5 } } });
    lineStyle = new ItemDropdown({ name: "lineStyle", displayName: "Style", items: lineStyleItems, value: lineStyleItems.find(item => item.value === "dashed") });
    slices: Slice[] = [this.show, this.lineColor, this.lineWidth, this.lineStyle];
}

class DisplayOptionsCard extends Card {
    name: string = "displayOptions"; displayName: string = "Display Options";
    showTooltips = new ToggleSwitch({ name: "showTooltips", displayName: "Show Tooltips", value: true });

    showNearCritical = new ToggleSwitch({
        name: "showNearCritical",
        displayName: "Highlight Near Longest Path",
        value: true
    });

    // Hidden property used only for persisting the toggle state
    showAllTasks = new ToggleSwitch({
        name: "showAllTasks",
        displayName: "",
        description: "",
        value: false,
        visible: false
    });

    // Include hidden slice so formatting service reads persisted value
    slices: Slice[] = [this.showTooltips, this.showNearCritical, this.showAllTasks];
}

class CriticalityModeCard extends Card {
    name: string = "criticalityMode";
    displayName: string = "Criticality Mode";
    
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
    
    slices: Slice[] = [this.calculationMode];
}
class TaskSelectionCard extends Card {
    name: string = "taskSelection"; displayName: string = "Task Selection";
    
    enableTaskSelection = new ToggleSwitch({
        name: "enableTaskSelection",
        displayName: "Enable Task Selection",
        value: true
    });

    showSelectedTaskLabel = new ToggleSwitch({
        name: "showSelectedTaskLabel",
        displayName: "Show Selected Task Label",
        value: false
    });

    traceMode = new ItemDropdown({
        name: "traceMode",
        displayName: "Trace Mode",
        description: "Select whether to trace the critical path backward to or forward from the selected task",
        items: [
            { value: "backward", displayName: "Trace Backward" },
            { value: "forward", displayName: "Trace Forward" }
        ],
        value: { value: "backward", displayName: "Trace Backward" }
    });

    slices: Slice[] = [
        this.enableTaskSelection,
        this.showSelectedTaskLabel,
        this.traceMode
    ];
}
class DrivingPathSelectionCard extends Card {
    name: string = "drivingPathSelection";
    displayName: string = "Driving Path Selection";

    enableMultiPathToggle = new ToggleSwitch({
        name: "enableMultiPathToggle",
        displayName: "Enable Multi-Path Toggle",
        description: "Allow toggling between all driving paths of equal or near-equal duration",
        value: true
    });

    selectedPathIndex = new NumUpDown({
        name: "selectedPathIndex",
        displayName: "Selected Path",
        description: "Index of the currently selected driving path (1-based)",
        value: 1,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 1 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 100 }
        }
    });

    showPathInfo = new ToggleSwitch({
        name: "showPathInfo",
        displayName: "Show Path Information",
        description: "Display path count and duration in the visual",
        value: true
    });

    slices: Slice[] = [this.enableMultiPathToggle, this.selectedPathIndex, this.showPathInfo];
}

class LegendCard extends Card {
    name: string = "legend";
    displayName: string = "Legend";

    show = new ToggleSwitch({
        name: "show",
        displayName: "Show Legend",
        description: "Display the legend when a legend field is added",
        value: true
    });

    position = new ItemDropdown({
        name: "position",
        displayName: "Position",
        items: [
            { value: "Top", displayName: "Top" },
            { value: "Bottom", displayName: "Bottom" },
            { value: "Left", displayName: "Left" },
            { value: "Right", displayName: "Right" }
        ],
        value: { value: "Top", displayName: "Top" }
    });

    fontSize = new NumUpDown({
        name: "fontSize",
        displayName: "Font Size (pt)",
        description: "Font size for legend text",
        value: 10,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 8 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 20 }
        }
    });

    showTitle = new ToggleSwitch({
        name: "showTitle",
        displayName: "Show Title",
        description: "Display the legend title (field name)",
        value: true
    });

    titleText = new TextInput({
        name: "titleText",
        displayName: "Title Text",
        description: "Custom title text (defaults to field name if empty)",
        value: "",
        placeholder: "Legend title..."
    });

    sortOrder = new ItemDropdown({
        name: "sortOrder",
        displayName: "Sort Order",
        description: "Sort legend items alphabetically",
        items: [
            { value: "none", displayName: "Data Order" },
            { value: "ascending", displayName: "Ascending (A-Z)" },
            { value: "descending", displayName: "Descending (Z-A)" }
        ],
        value: { value: "none", displayName: "Data Order" }
    });

    slices: Slice[] = [this.show, this.position, this.fontSize, this.showTitle, this.titleText, this.sortOrder];
}

class WBSGroupingCard extends Card {
    name: string = "wbsGrouping";
    displayName: string = "WBS Grouping";

    enableWbsGrouping = new ToggleSwitch({
        name: "enableWbsGrouping",
        displayName: "Enable WBS Grouping",
        description: "Group tasks by WBS hierarchy",
        value: false
    });

    defaultExpanded = new ToggleSwitch({
        name: "defaultExpanded",
        displayName: "Default Expanded",
        description: "Expand all WBS groups by default",
        value: true
    });

    showGroupSummary = new ToggleSwitch({
        name: "showGroupSummary",
        displayName: "Show Group Summary Bar",
        description: "Display a summary bar for each WBS group",
        value: true
    });

    groupHeaderColor = new ColorPicker({
        name: "groupHeaderColor",
        displayName: "Group Header Background",
        description: "Background color for WBS group headers",
        value: { value: "#F0F0F0" }
    });

    groupSummaryColor = new ColorPicker({
        name: "groupSummaryColor",
        displayName: "Group Summary Bar Color",
        description: "Color for WBS group summary bars",
        value: { value: "#808080" }
    });

    indentPerLevel = new NumUpDown({
        name: "indentPerLevel",
        displayName: "Indent Per Level (px)",
        description: "Indentation for each WBS level",
        value: 20,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 50 }
        }
    });

    hideEmptyGroups = new ToggleSwitch({
        name: "hideEmptyGroups",
        displayName: "Hide Empty Groups",
        description: "Hide WBS groups that have no visible/filtered tasks",
        value: true
    });

    expandCollapseAll = new ToggleSwitch({
        name: "expandCollapseAll",
        displayName: "Expand All Groups",
        description: "Toggle to expand or collapse all WBS groups at once",
        value: true
    });

    showWbsToggle = new ToggleSwitch({
        name: "showWbsToggle",
        displayName: "Show WBS Toggle Button",
        description: "Show or hide the Expand/Collapse WBS toggle button in the header",
        value: true
    });

    groupNameFontSize = new NumUpDown({
        name: "groupNameFontSize",
        displayName: "Group Name Font Size (pt)",
        description: "Font size for WBS group names (0 = use Task Name Font Size)",
        value: 0,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 24 }
        }
    });

    groupNameColor = new ColorPicker({
        name: "groupNameColor",
        displayName: "Group Name Color",
        description: "Text color for WBS group names",
        value: { value: "#333333" }
    });

    slices: Slice[] = [
        this.enableWbsGrouping,
        this.defaultExpanded,
        this.expandCollapseAll,
        this.showWbsToggle,
        this.hideEmptyGroups,
        this.showGroupSummary,
        this.groupHeaderColor,
        this.groupSummaryColor,
        this.groupNameFontSize,
        this.groupNameColor,
        this.indentPerLevel
    ];
}

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

class PersistedStateCard extends Card {
    name: string = "persistedState";
    displayName: string = "Persisted State";
    visible: boolean = false;
    selectedTaskId = new TextInput({
        name: "selectedTaskId",
        displayName: "",
        value: "",
        placeholder: "",
        visible: false
    });
    floatThreshold = new NumUpDown({
        name: "floatThreshold",
        displayName: "",
        value: 0,
        visible: false
    });
    traceMode = new TextInput({
        name: "traceMode",
        displayName: "",
        value: "backward",
        placeholder: "",
        visible: false
    });
    slices: Slice[] = [this.selectedTaskId, this.floatThreshold, this.traceMode];
}

export class VisualSettings extends Model {
    // Keep existing cards
    taskAppearance = new TaskAppearanceCard();
    connectorLines = new ConnectorLinesCard();
    textAndLabels = new TextAndLabelsCard();
    layoutSettings = new LayoutSettingsCard();
    gridLines = new HorizontalGridLinesCard();
    verticalGridLines = new VerticalGridLinesCard();
    projectEndLine = new ProjectEndLineCard();
    displayOptions = new DisplayOptionsCard();
    criticalityMode = new CriticalityModeCard();
    drivingPathSelection = new DrivingPathSelectionCard();
    taskSelection = new TaskSelectionCard();
    wbsGrouping = new WBSGroupingCard();
    legend = new LegendCard();
    legendColors = new LegendColorsCard();
    persistedState = new PersistedStateCard();

    // Update the cards array
    cards: Card[] = [
        this.taskAppearance,
        this.connectorLines,
        this.textAndLabels,
        this.layoutSettings,
        this.gridLines,
        this.verticalGridLines,
        this.projectEndLine,
        this.displayOptions,
        this.criticalityMode,
        this.drivingPathSelection,
        this.taskSelection,
        this.wbsGrouping,
        this.legend,
        this.legendColors,
        this.persistedState
    ];
}