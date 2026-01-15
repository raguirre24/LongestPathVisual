import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import Model = formattingSettings.Model;
import Card = formattingSettings.SimpleCard;
import Slice = formattingSettings.Slice;
declare class GeneralSettingsCard extends Card {
    name: string;
    displayName: string;
    visualBackgroundColor: formattingSettings.ColorPicker;
    alternatingRowColors: formattingSettings.ToggleSwitch;
    alternatingRowColor: formattingSettings.ColorPicker;
    selectionHighlightColor: formattingSettings.ColorPicker;
    showTooltips: formattingSettings.ToggleSwitch;
    showExportButton: formattingSettings.ToggleSwitch;
    slices: Slice[];
}
declare class TaskBarsCard extends Card {
    name: string;
    displayName: string;
    taskColor: formattingSettings.ColorPicker;
    milestoneColor: formattingSettings.ColorPicker;
    taskHeight: formattingSettings.NumUpDown;
    taskBarCornerRadius: formattingSettings.NumUpDown;
    taskBarStrokeColor: formattingSettings.ColorPicker;
    taskBarStrokeWidth: formattingSettings.NumUpDown;
    milestoneSize: formattingSettings.NumUpDown;
    milestoneShape: formattingSettings.ItemDropdown;
    slices: Slice[];
}
declare class CriticalPathCard extends Card {
    name: string;
    displayName: string;
    calculationMode: formattingSettings.ItemDropdown;
    criticalPathColor: formattingSettings.ColorPicker;
    criticalBorderWidth: formattingSettings.NumUpDown;
    showNearCritical: formattingSettings.ToggleSwitch;
    nearCriticalColor: formattingSettings.ColorPicker;
    nearCriticalBorderWidth: formattingSettings.NumUpDown;
    showAllTasks: formattingSettings.ToggleSwitch;
    slices: Slice[];
}
declare class ComparisonBarsCard extends Card {
    name: string;
    displayName: string;
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
    showConnectorLines: formattingSettings.ToggleSwitch;
    connectorColor: formattingSettings.ColorPicker;
    connectorWidth: formattingSettings.NumUpDown;
    criticalConnectorWidth: formattingSettings.NumUpDown;
    elbowOffset: formattingSettings.NumUpDown;
    arrowHeadSize: formattingSettings.NumUpDown;
    differentiateDrivers: formattingSettings.ToggleSwitch;
    nonDrivingLineStyle: formattingSettings.ItemDropdown;
    nonDrivingOpacity: formattingSettings.NumUpDown;
    slices: Slice[];
}
declare class TextAndLabelsCard extends Card {
    name: string;
    displayName: string;
    fontFamily: formattingSettings.ItemDropdown;
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
declare class ColumnsCard extends Card {
    name: string;
    displayName: string;
    enableColumnDisplay: formattingSettings.ToggleSwitch;
    showStartDate: formattingSettings.ToggleSwitch;
    startDateWidth: formattingSettings.NumUpDown;
    showFinishDate: formattingSettings.ToggleSwitch;
    finishDateWidth: formattingSettings.NumUpDown;
    showDuration: formattingSettings.ToggleSwitch;
    durationWidth: formattingSettings.NumUpDown;
    showTotalFloat: formattingSettings.ToggleSwitch;
    totalFloatWidth: formattingSettings.NumUpDown;
    slices: Slice[];
}
declare class LayoutSettingsCard extends Card {
    name: string;
    displayName: string;
    leftMargin: formattingSettings.NumUpDown;
    taskPadding: formattingSettings.NumUpDown;
    maxTasksToShow: formattingSettings.NumUpDown;
    headerHeight: formattingSettings.NumUpDown;
    slices: Slice[];
}
declare class GridLinesCard extends Card {
    name: string;
    displayName: string;
    showHorizontalLines: formattingSettings.ToggleSwitch;
    horizontalLineColor: formattingSettings.ColorPicker;
    horizontalLineWidth: formattingSettings.NumUpDown;
    horizontalLineStyle: formattingSettings.ItemDropdown;
    showVerticalLines: formattingSettings.ToggleSwitch;
    verticalLineColor: formattingSettings.ColorPicker;
    verticalLineWidth: formattingSettings.NumUpDown;
    verticalLineStyle: formattingSettings.ItemDropdown;
    showTimelineLabels: formattingSettings.ToggleSwitch;
    timelineLabelColor: formattingSettings.ColorPicker;
    timelineLabelFontSize: formattingSettings.NumUpDown;
    slices: Slice[];
}
declare class ProjectFinishLineCard extends Card {
    name: string;
    displayName: string;
    show: formattingSettings.ToggleSwitch;
    lineColor: formattingSettings.ColorPicker;
    lineWidth: formattingSettings.NumUpDown;
    lineStyle: formattingSettings.ItemDropdown;
    showLabel: formattingSettings.ToggleSwitch;
    labelColor: formattingSettings.ColorPicker;
    labelFontSize: formattingSettings.NumUpDown;
    showLabelPrefix: formattingSettings.ToggleSwitch;
    labelBackgroundColor: formattingSettings.ColorPicker;
    labelBackgroundTransparency: formattingSettings.NumUpDown;
    slices: Slice[];
}
declare class BaselineFinishLineCard extends Card {
    name: string;
    displayName: string;
    show: formattingSettings.ToggleSwitch;
    lineWidth: formattingSettings.NumUpDown;
    lineStyle: formattingSettings.ItemDropdown;
    showLabel: formattingSettings.ToggleSwitch;
    labelColor: formattingSettings.ColorPicker;
    labelFontSize: formattingSettings.NumUpDown;
    showLabelPrefix: formattingSettings.ToggleSwitch;
    labelBackgroundColor: formattingSettings.ColorPicker;
    labelBackgroundTransparency: formattingSettings.NumUpDown;
    slices: Slice[];
}
declare class PreviousUpdateFinishLineCard extends Card {
    name: string;
    displayName: string;
    show: formattingSettings.ToggleSwitch;
    lineWidth: formattingSettings.NumUpDown;
    lineStyle: formattingSettings.ItemDropdown;
    showLabel: formattingSettings.ToggleSwitch;
    labelColor: formattingSettings.ColorPicker;
    labelFontSize: formattingSettings.NumUpDown;
    showLabelPrefix: formattingSettings.ToggleSwitch;
    labelBackgroundColor: formattingSettings.ColorPicker;
    labelBackgroundTransparency: formattingSettings.NumUpDown;
    slices: Slice[];
}
declare class DataDateLineCard extends Card {
    name: string;
    displayName: string;
    show: formattingSettings.ToggleSwitch;
    lineColor: formattingSettings.ColorPicker;
    lineWidth: formattingSettings.NumUpDown;
    lineStyle: formattingSettings.ItemDropdown;
    showLabel: formattingSettings.ToggleSwitch;
    labelColor: formattingSettings.ColorPicker;
    labelFontSize: formattingSettings.NumUpDown;
    showLabelPrefix: formattingSettings.ToggleSwitch;
    labelBackgroundColor: formattingSettings.ColorPicker;
    labelBackgroundTransparency: formattingSettings.NumUpDown;
    slices: Slice[];
}
declare class PathSelectionCard extends Card {
    name: string;
    displayName: string;
    enableTaskSelection: formattingSettings.ToggleSwitch;
    dropdownWidth: formattingSettings.NumUpDown;
    dropdownPosition: formattingSettings.ItemDropdown;
    showSelectedTaskLabel: formattingSettings.ToggleSwitch;
    traceMode: formattingSettings.ItemDropdown;
    enableMultiPathToggle: formattingSettings.ToggleSwitch;
    selectedPathIndex: formattingSettings.NumUpDown;
    showPathInfo: formattingSettings.ToggleSwitch;
    slices: Slice[];
}
declare class WBSGroupingCard extends Card {
    name: string;
    displayName: string;
    enableWbsGrouping: formattingSettings.ToggleSwitch;
    defaultExpanded: formattingSettings.ToggleSwitch;
    expandCollapseAll: formattingSettings.ToggleSwitch;
    showWbsToggle: formattingSettings.ToggleSwitch;
    hideEmptyGroups: formattingSettings.ToggleSwitch;
    showGroupSummary: formattingSettings.ToggleSwitch;
    groupHeaderColor: formattingSettings.ColorPicker;
    groupSummaryColor: formattingSettings.ColorPicker;
    groupNameFontSize: formattingSettings.NumUpDown;
    groupNameColor: formattingSettings.ColorPicker;
    indentPerLevel: formattingSettings.NumUpDown;
    slices: Slice[];
}
declare class WbsLevelStylesCard extends Card {
    name: string;
    displayName: string;
    level1Background: formattingSettings.ColorPicker;
    level1Text: formattingSettings.ColorPicker;
    level2Background: formattingSettings.ColorPicker;
    level2Text: formattingSettings.ColorPicker;
    level3Background: formattingSettings.ColorPicker;
    level3Text: formattingSettings.ColorPicker;
    level4Background: formattingSettings.ColorPicker;
    level4Text: formattingSettings.ColorPicker;
    level5Background: formattingSettings.ColorPicker;
    level5Text: formattingSettings.ColorPicker;
    level6Background: formattingSettings.ColorPicker;
    level6Text: formattingSettings.ColorPicker;
    level7Background: formattingSettings.ColorPicker;
    level7Text: formattingSettings.ColorPicker;
    level8Background: formattingSettings.ColorPicker;
    level8Text: formattingSettings.ColorPicker;
    level9Background: formattingSettings.ColorPicker;
    level9Text: formattingSettings.ColorPicker;
    level10Background: formattingSettings.ColorPicker;
    level10Text: formattingSettings.ColorPicker;
    slices: Slice[];
}
declare class LegendCard extends Card {
    name: string;
    displayName: string;
    show: formattingSettings.ToggleSwitch;
    fontSize: formattingSettings.NumUpDown;
    showTitle: formattingSettings.ToggleSwitch;
    titleText: formattingSettings.TextInput;
    sortOrder: formattingSettings.ItemDropdown;
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
declare class TimelineZoomCard extends Card {
    name: string;
    displayName: string;
    enableZoomSlider: formattingSettings.ToggleSwitch;
    sliderHeight: formattingSettings.NumUpDown;
    sliderTrackColor: formattingSettings.ColorPicker;
    sliderSelectedColor: formattingSettings.ColorPicker;
    sliderHandleColor: formattingSettings.ColorPicker;
    showMiniChart: formattingSettings.ToggleSwitch;
    slices: Slice[];
}
declare class PersistedStateCard extends Card {
    name: string;
    displayName: string;
    visible: boolean;
    selectedTaskId: formattingSettings.TextInput;
    floatThreshold: formattingSettings.NumUpDown;
    traceMode: formattingSettings.TextInput;
    selectedLegendCategories: formattingSettings.TextInput;
    wbsExpandLevel: formattingSettings.NumUpDown;
    wbsExpandedState: formattingSettings.TextInput;
    wbsManualToggledGroups: formattingSettings.TextInput;
    zoomRangeStart: formattingSettings.NumUpDown;
    zoomRangeEnd: formattingSettings.NumUpDown;
    slices: Slice[];
}
export declare class VisualSettings extends Model {
    generalSettings: GeneralSettingsCard;
    taskBars: TaskBarsCard;
    criticalPath: CriticalPathCard;
    comparisonBars: ComparisonBarsCard;
    connectorLines: ConnectorLinesCard;
    textAndLabels: TextAndLabelsCard;
    columns: ColumnsCard;
    layoutSettings: LayoutSettingsCard;
    gridLines: GridLinesCard;
    projectEndLine: ProjectFinishLineCard;
    baselineFinishLine: BaselineFinishLineCard;
    previousUpdateFinishLine: PreviousUpdateFinishLineCard;
    dataDateLine: DataDateLineCard;
    pathSelection: PathSelectionCard;
    wbsGrouping: WBSGroupingCard;
    wbsLevelStyles: WbsLevelStylesCard;
    legend: LegendCard;
    legendColors: LegendColorsCard;
    timelineZoom: TimelineZoomCard;
    persistedState: PersistedStateCard;
    cards: Card[];
}
export {};
