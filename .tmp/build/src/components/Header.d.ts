import { Selection } from "d3-selection";
import { VisualSettings } from "../settings";
import { HEADER_DOCK_TOKENS } from "../utils/Theme";
import { BoundFieldState } from "../data/Interfaces";
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
    onExportHtml: () => void;
    onCopy: () => void;
    onLookAheadWindowChanged: (days: number) => void;
    onZoomIn?: () => void;
    onZoomOut?: () => void;
}
export interface HeaderState {
    showAllTasks: boolean;
    showBaseline: boolean;
    baselineAvailable: boolean;
    showPreviousUpdate: boolean;
    previousUpdateAvailable: boolean;
    boundFields: BoundFieldState;
    showConnectorLines: boolean;
    wbsExpanded: boolean;
    wbsDataExists: boolean;
    wbsAvailableLevels: number[];
    wbsExpandToLevel?: number;
    wbsManualExpansionOverride: boolean;
    currentMode: string;
    modeStatusMessage?: string | null;
    modeWarningMessage?: string | null;
    showPathInfoChip?: boolean;
    floatThreshold: number;
    showNearCritical: boolean;
    showExtraColumns: boolean;
    wbsEnabled: boolean;
    lookAheadAvailable: boolean;
    lookAheadWindowDays: number;
    lookAheadDisplayMode: "filter" | "highlight";
}
export type HeaderPalette = Partial<typeof HEADER_DOCK_TOKENS> & {
    isHighContrast?: boolean;
};
export declare class Header {
    private static nextMenuOrdinal;
    private container;
    private svg;
    private callbacks;
    private exportButtonLoading;
    private copySuccessTimeout;
    private controlsMenuOpen;
    private currentLayout;
    private currentPalette;
    private readonly overflowMenuId;
    private readonly lookAheadListboxId;
    private overflowDocumentPointerDownHandler;
    private lookAheadDropdownOpen;
    private lookAheadDropdownActiveIndex;
    private lookAheadDocumentPointerDownHandler;
    private toggleButtonGroup;
    private currentSettings;
    private currentState;
    private currentViewportWidth;
    constructor(container: Selection<HTMLDivElement, unknown, null, undefined>, callbacks: HeaderCallbacks);
    private initialize;
    private renderDockChrome;
    private upsertButton;
    private upsertDiv;
    private hideControl;
    render(viewportWidth: number, settings: VisualSettings, state: HeaderState, palette?: HeaderPalette): void;
    destroy(): void;
    private getCurrentLayout;
    private getPaletteToken;
    private applyHeaderPaletteOverrides;
    private renderButtons;
    /**
     * Shows visual feedback on the copy button when copy succeeds.
     * Turns the button border green for 2 seconds.
     */
    showCopySuccess(): void;
    private lightenColor;
    private drawConnectorDependencyGlyph;
    private drawWbsHierarchyGlyph;
    private drawColumnVisibilityGlyph;
    setExporting(isExporting: boolean): void;
    private createOrUpdateToggleButton;
    private createOrUpdateBaselineToggleButton;
    private createOrUpdatePreviousUpdateToggleButton;
    /**
     * Extended layout mode determination
     */
    private getExtendedLayoutMode;
    private getBaseRightReserved;
    private shouldInlineFloatThreshold;
    private getTopRightControlWidthBudget;
    /**
     * Returns button dimensions and positions based on current layout mode
     */
    private getHeaderButtonLayout;
    private createConnectorLinesToggleButton;
    private createWbsExpandCycleToggleButton;
    private createWbsCollapseCycleToggleButton;
    private createFloatThresholdControl;
    private createModeToggleButton;
    private attachLookAheadOutsideClickHandler;
    private detachLookAheadOutsideClickHandler;
    private closeLookAheadDropdown;
    private openLookAheadDropdown;
    private focusLookAheadOption;
    private selectLookAheadWindow;
    private createLookAheadControl;
    private createColumnDisplayToggleButton;
    private createWbsEnableToggleButton;
    private createCopyButton;
    private createExportButton;
    private createExportHtmlButton;
    private createHelpButton;
    private attachOverflowOutsideClickHandler;
    private detachOverflowOutsideClickHandler;
    private closeControlsMenu;
    private focusFirstOverflowMenuItem;
    private focusOverflowMenuItem;
    private getOverflowFocusableItems;
    private handleOverflowMenuKeydown;
    private createActionOverflowButton;
    private getHeaderMenuItems;
    private getActiveHiddenControlCount;
    private renderActionOverflowMenu;
    private renderHeaderMenuItem;
    private renderLookAheadMenuItem;
    private renderFloatThresholdMenuItem;
}
