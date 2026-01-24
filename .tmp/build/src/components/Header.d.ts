import { Selection } from "d3-selection";
import { VisualSettings } from "../settings";
export interface HeaderCallbacks {
    onToggleCriticalPath: () => void;
    onToggleBaseline: () => void;
    onTogglePreviousUpdate: () => void;
    onToggleConnectorLines: () => void;
    onToggleWbsExpand: () => void;
    onToggleWbsCollapse: () => void;
    onToggleMode: () => void;
    onToggleColumns: () => void;
    onToggleWbsEnable: () => void;
    onFloatThresholdChanged: (value: number) => void;
    onHelp: () => void;
    onExport: () => void;
    onCopy: () => void;
    onZoomIn?: () => void;
    onZoomOut?: () => void;
}
export interface HeaderState {
    showAllTasks: boolean;
    showBaseline: boolean;
    baselineAvailable: boolean;
    showPreviousUpdate: boolean;
    previousUpdateAvailable: boolean;
    showConnectorLines: boolean;
    wbsExpanded: boolean;
    wbsDataExists: boolean;
    wbsAvailableLevels: number[];
    wbsExpandToLevel?: number;
    wbsManualExpansionOverride: boolean;
    currentMode: string;
    floatThreshold: number;
    showNearCritical: boolean;
    showExtraColumns: boolean;
    wbsEnabled: boolean;
}
export declare class Header {
    private container;
    private svg;
    private callbacks;
    private toggleButtonGroup;
    private baselineToggleButtonGroup;
    private previousUpdateToggleButtonGroup;
    private currentSettings;
    private currentState;
    private currentViewportWidth;
    constructor(container: Selection<HTMLDivElement, unknown, null, undefined>, callbacks: HeaderCallbacks);
    private initialize;
    render(viewportWidth: number, settings: VisualSettings, state: HeaderState): void;
    private renderButtons;
    private lightenColor;
    setExporting(isExporting: boolean): void;
    private createOrUpdateToggleButton;
    private createOrUpdateBaselineToggleButton;
    private createOrUpdatePreviousUpdateToggleButton;
    /**
     * Extended layout mode determination
     */
    private getExtendedLayoutMode;
    /**
     * Returns button dimensions and positions based on current layout mode
     */
    private getHeaderButtonLayout;
    private createConnectorLinesToggleButton;
    private createWbsExpandCycleToggleButton;
    private createWbsCollapseCycleToggleButton;
    private createFloatThresholdControl;
    private createModeToggleButton;
    private createColumnDisplayToggleButton;
    private createWbsEnableToggleButton;
    private createCopyButton;
    private createExportButton;
    private createHelpButton;
}
