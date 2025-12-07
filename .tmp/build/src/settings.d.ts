import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import Model = formattingSettings.Model;
import Card = formattingSettings.SimpleCard;
import Slice = formattingSettings.Slice;
declare class TaskAppearanceCard extends Card {
    name: string;
    displayName: string;
    taskColor: formattingSettings.ColorPicker;
    criticalPathColor: formattingSettings.ColorPicker;
    nearCriticalColor: formattingSettings.ColorPicker;
    milestoneColor: formattingSettings.ColorPicker;
    taskHeight: formattingSettings.NumUpDown;
    milestoneSize: formattingSettings.NumUpDown;
    criticalBorderWidth: formattingSettings.NumUpDown;
    nearCriticalBorderWidth: formattingSettings.NumUpDown;
    showBaseline: formattingSettings.ToggleSwitch;
    baselineColor: formattingSettings.ColorPicker;
    baselineHeight: formattingSettings.NumUpDown;
    baselineOffset: formattingSettings.NumUpDown;
    showPreviousUpdate: formattingSettings.ToggleSwitch;
    previousUpdateColor: formattingSettings.ColorPicker;
    previousUpdateHeight: formattingSettings.NumUpDown;
    previousUpdateOffset: formattingSettings.NumUpDown;
    slices: Slice[];
}
declare class ConnectorLinesCard extends Card {
    name: string;
    displayName: string;
    showConnectorToggle: formattingSettings.ToggleSwitch;
    connectorColor: formattingSettings.ColorPicker;
    connectorWidth: formattingSettings.NumUpDown;
    criticalConnectorWidth: formattingSettings.NumUpDown;
    elbowOffset: formattingSettings.NumUpDown;
    slices: Slice[];
}
declare class TextAndLabelsCard extends Card {
    name: string;
    displayName: string;
    fontSize: formattingSettings.NumUpDown;
    taskNameFontSize: formattingSettings.NumUpDown;
    labelColor: formattingSettings.ColorPicker;
    showDuration: formattingSettings.ToggleSwitch;
    durationTextColor: formattingSettings.ColorPicker;
    showFinishDates: formattingSettings.ToggleSwitch;
    dateBackgroundColor: formattingSettings.ColorPicker;
    dateBackgroundTransparency: formattingSettings.NumUpDown;
    slices: Slice[];
}
declare class LayoutSettingsCard extends Card {
    name: string;
    displayName: string;
    leftMargin: formattingSettings.NumUpDown;
    taskPadding: formattingSettings.NumUpDown;
    maxTasksToShow: formattingSettings.NumUpDown;
    slices: Slice[];
}
declare class HorizontalGridLinesCard extends Card {
    name: string;
    displayName: string;
    showGridLines: formattingSettings.ToggleSwitch;
    gridLineColor: formattingSettings.ColorPicker;
    gridLineWidth: formattingSettings.NumUpDown;
    gridLineStyle: formattingSettings.ItemDropdown;
    slices: Slice[];
}
declare class VerticalGridLinesCard extends Card {
    name: string;
    displayName: string;
    show: formattingSettings.ToggleSwitch;
    lineColor: formattingSettings.ColorPicker;
    lineWidth: formattingSettings.NumUpDown;
    lineStyle: formattingSettings.ItemDropdown;
    showMonthLabels: formattingSettings.ToggleSwitch;
    labelColor: formattingSettings.ColorPicker;
    labelFontSize: formattingSettings.NumUpDown;
    slices: Slice[];
}
declare class ProjectEndLineCard extends Card {
    name: string;
    displayName: string;
    show: formattingSettings.ToggleSwitch;
    lineColor: formattingSettings.ColorPicker;
    lineWidth: formattingSettings.NumUpDown;
    lineStyle: formattingSettings.ItemDropdown;
    slices: Slice[];
}
declare class DisplayOptionsCard extends Card {
    name: string;
    displayName: string;
    showTooltips: formattingSettings.ToggleSwitch;
    showNearCritical: formattingSettings.ToggleSwitch;
    showAllTasks: formattingSettings.ToggleSwitch;
    slices: Slice[];
}
declare class CriticalityModeCard extends Card {
    name: string;
    displayName: string;
    calculationMode: formattingSettings.ItemDropdown;
    slices: Slice[];
}
declare class TaskSelectionCard extends Card {
    name: string;
    displayName: string;
    enableTaskSelection: formattingSettings.ToggleSwitch;
    showSelectedTaskLabel: formattingSettings.ToggleSwitch;
    traceMode: formattingSettings.ItemDropdown;
    slices: Slice[];
}
declare class DrivingPathSelectionCard extends Card {
    name: string;
    displayName: string;
    enableMultiPathToggle: formattingSettings.ToggleSwitch;
    selectedPathIndex: formattingSettings.NumUpDown;
    showPathInfo: formattingSettings.ToggleSwitch;
    slices: Slice[];
}
declare class LegendCard extends Card {
    name: string;
    displayName: string;
    show: formattingSettings.ToggleSwitch;
    position: formattingSettings.ItemDropdown;
    fontSize: formattingSettings.NumUpDown;
    showTitle: formattingSettings.ToggleSwitch;
    titleText: formattingSettings.TextInput;
    sortOrder: formattingSettings.ItemDropdown;
    slices: Slice[];
}
declare class WBSGroupingCard extends Card {
    name: string;
    displayName: string;
    enableWbsGrouping: formattingSettings.ToggleSwitch;
    defaultExpanded: formattingSettings.ToggleSwitch;
    showGroupSummary: formattingSettings.ToggleSwitch;
    groupHeaderColor: formattingSettings.ColorPicker;
    groupSummaryColor: formattingSettings.ColorPicker;
    indentPerLevel: formattingSettings.NumUpDown;
    slices: Slice[];
}
declare class LegendColorsCard extends Card {
    name: string;
    displayName: string;
    color1: formattingSettings.ColorPicker;
    color2: formattingSettings.ColorPicker;
    color3: formattingSettings.ColorPicker;
    color4: formattingSettings.ColorPicker;
    color5: formattingSettings.ColorPicker;
    color6: formattingSettings.ColorPicker;
    color7: formattingSettings.ColorPicker;
    color8: formattingSettings.ColorPicker;
    color9: formattingSettings.ColorPicker;
    color10: formattingSettings.ColorPicker;
    color11: formattingSettings.ColorPicker;
    color12: formattingSettings.ColorPicker;
    color13: formattingSettings.ColorPicker;
    color14: formattingSettings.ColorPicker;
    color15: formattingSettings.ColorPicker;
    color16: formattingSettings.ColorPicker;
    color17: formattingSettings.ColorPicker;
    color18: formattingSettings.ColorPicker;
    color19: formattingSettings.ColorPicker;
    color20: formattingSettings.ColorPicker;
    slices: Slice[];
}
declare class PersistedStateCard extends Card {
    name: string;
    displayName: string;
    visible: boolean;
    selectedTaskId: formattingSettings.TextInput;
    floatThreshold: formattingSettings.NumUpDown;
    traceMode: formattingSettings.TextInput;
    slices: Slice[];
}
export declare class VisualSettings extends Model {
    taskAppearance: TaskAppearanceCard;
    connectorLines: ConnectorLinesCard;
    textAndLabels: TextAndLabelsCard;
    layoutSettings: LayoutSettingsCard;
    gridLines: HorizontalGridLinesCard;
    verticalGridLines: VerticalGridLinesCard;
    projectEndLine: ProjectEndLineCard;
    displayOptions: DisplayOptionsCard;
    criticalityMode: CriticalityModeCard;
    drivingPathSelection: DrivingPathSelectionCard;
    taskSelection: TaskSelectionCard;
    wbsGrouping: WBSGroupingCard;
    legend: LegendCard;
    legendColors: LegendColorsCard;
    persistedState: PersistedStateCard;
    cards: Card[];
}
export {};
