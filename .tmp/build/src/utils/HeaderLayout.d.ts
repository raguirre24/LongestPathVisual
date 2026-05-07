export type HeaderLayoutMode = "wide" | "medium" | "narrow" | "compact" | "very-narrow";
export type HeaderMenuAction = "lookAhead" | "floatThreshold" | "baseline" | "previousUpdate" | "connectorLines" | "columns" | "wbsEnable" | "wbsExpand" | "wbsCollapse" | "html" | "pdf" | "help";
export interface HeaderDesiredControls {
    lookAhead: boolean;
    floatThreshold: boolean;
    baseline: boolean;
    previousUpdate: boolean;
    connectorLines: boolean;
    columns: boolean;
    wbsEnable: boolean;
    wbsExpand: boolean;
    wbsCollapse: boolean;
    copyButton: boolean;
    htmlExportButton: boolean;
    exportButton: boolean;
    helpButton: boolean;
}
export interface HeaderActiveControlState {
    lookAheadWindowDays: number;
    showBaseline: boolean;
    showPreviousUpdate: boolean;
    showConnectorLines: boolean;
    showExtraColumns: boolean;
    wbsEnabled: boolean;
}
export interface HeaderLayoutInput {
    viewportWidth: number;
    currentMode: string;
    showNearCritical: boolean;
    showPathInfoChip?: boolean;
    lookAheadActive?: boolean;
    desiredControls: HeaderDesiredControls;
}
export interface HeaderControlLayout {
    x: number;
    visible: boolean;
    width?: number;
    size?: number;
    iconOnly?: boolean;
    showText?: boolean;
    showFullLabels?: boolean;
}
export interface HeaderActionOverflowLayout extends HeaderControlLayout {
    size: number;
    hiddenActions: HeaderMenuAction[];
}
export interface HeaderButtonLayout {
    mode: HeaderLayoutMode;
    showAllCritical: HeaderControlLayout & {
        width: number;
        showText: boolean;
    };
    modeToggle: HeaderControlLayout & {
        width: number;
        showFullLabels: boolean;
    };
    lookAhead: HeaderControlLayout & {
        width: number;
    };
    colToggle: HeaderControlLayout & {
        size: number;
    };
    baseline: HeaderControlLayout & {
        width: number;
        iconOnly: boolean;
    };
    previousUpdate: HeaderControlLayout & {
        width: number;
        iconOnly: boolean;
    };
    connectorLines: HeaderControlLayout & {
        size: number;
    };
    wbsEnable: HeaderControlLayout & {
        width: number;
    };
    wbsExpandToggle: HeaderControlLayout & {
        size: number;
    };
    wbsCollapseToggle: HeaderControlLayout & {
        size: number;
    };
    copyButton: HeaderControlLayout & {
        size: number;
    };
    htmlExportButton: HeaderControlLayout & {
        size: number;
    };
    exportButton: HeaderControlLayout & {
        size: number;
    };
    helpButton: HeaderControlLayout & {
        size: number;
    };
    actionOverflowButton: HeaderActionOverflowLayout;
    gap: number;
    totalWidth: number;
}
export type HeaderSecondRowMode = "wide" | "medium" | "narrow";
export interface HeaderSecondRowLayoutInput {
    viewportWidth: number;
    mode: HeaderSecondRowMode;
    configuredDropdownWidth?: number;
    dropdownPosition?: string;
    traceVisible?: boolean;
}
export interface HeaderSecondRowLayout {
    dropdown: {
        width: number;
        left: number;
    };
    traceModeToggle: {
        left: number;
        width: number;
    };
    statusLabel: {
        left: number;
        width: number;
    };
    floatThreshold: {
        maxWidth: number;
    };
}
export declare function getExtendedHeaderLayoutMode(viewportWidth: number): HeaderLayoutMode;
export declare function shouldInlineHeaderFloatThreshold(viewportWidth: number, currentMode: string, showNearCritical: boolean): boolean;
export declare function getBaseHeaderRightReserved(mode: HeaderLayoutMode): number;
export declare function computeHeaderButtonLayout(input: HeaderLayoutInput): HeaderButtonLayout;
export declare function getLookAheadOptions(activeDays: number): Array<{
    value: number;
    label: string;
}>;
export declare function getActiveHiddenHeaderControlCount(actions: HeaderMenuAction[], state: HeaderActiveControlState): number;
export declare function computeSecondRowLayout(input: HeaderSecondRowLayoutInput): HeaderSecondRowLayout;
