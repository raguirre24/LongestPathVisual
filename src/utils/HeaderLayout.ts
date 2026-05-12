import { LAYOUT_BREAKPOINTS, UI_TOKENS } from "./Theme";

export type HeaderLayoutMode = "wide" | "medium" | "narrow" | "compact" | "very-narrow";

export type HeaderMenuAction =
    | "lookAhead"
    | "floatThreshold"
    | "baseline"
    | "previousUpdate"
    | "progressLine"
    | "connectorLines"
    | "columns"
    | "wbsEnable"
    | "wbsExpand"
    | "wbsCollapse"
    | "html"
    | "pdf"
    | "help";

export interface HeaderDesiredControls {
    lookAhead: boolean;
    floatThreshold: boolean;
    baseline: boolean;
    previousUpdate: boolean;
    progressLine: boolean;
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
    showProgressLine: boolean;
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
    showAllCritical: HeaderControlLayout & { width: number; showText: boolean };
    modeToggle: HeaderControlLayout & { width: number; showFullLabels: boolean };
    lookAhead: HeaderControlLayout & { width: number };
    colToggle: HeaderControlLayout & { size: number };
    baseline: HeaderControlLayout & { width: number; iconOnly: boolean };
    previousUpdate: HeaderControlLayout & { width: number; iconOnly: boolean };
    connectorLines: HeaderControlLayout & { size: number };
    wbsEnable: HeaderControlLayout & { width: number };
    wbsExpandToggle: HeaderControlLayout & { size: number };
    wbsCollapseToggle: HeaderControlLayout & { size: number };
    copyButton: HeaderControlLayout & { size: number };
    htmlExportButton: HeaderControlLayout & { size: number };
    exportButton: HeaderControlLayout & { size: number };
    helpButton: HeaderControlLayout & { size: number };
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
    dropdown: { width: number; left: number };
    traceModeToggle: { left: number; width: number };
    statusLabel: { left: number; width: number };
    floatThreshold: { maxWidth: number };
}

export function getExtendedHeaderLayoutMode(viewportWidth: number): HeaderLayoutMode {
    if (viewportWidth >= LAYOUT_BREAKPOINTS.wide) return "wide";
    if (viewportWidth >= LAYOUT_BREAKPOINTS.medium) return "medium";
    if (viewportWidth >= 500) return "narrow";
    if (viewportWidth >= 350) return "compact";
    return "very-narrow";
}

export function shouldInlineHeaderFloatThreshold(
    viewportWidth: number,
    currentMode: string,
    showNearCritical: boolean
): boolean {
    if (currentMode !== "floatBased" || !showNearCritical) {
        return false;
    }

    const mode = getExtendedHeaderLayoutMode(viewportWidth);
    return mode === "wide" || mode === "medium";
}

export function getBaseHeaderRightReserved(mode: HeaderLayoutMode): number {
    if (mode === "very-narrow") return 60;
    if (mode === "compact") return 100;
    if (mode === "narrow") return 150;
    return 260;
}

function getTopRightControlWidthBudget(input: HeaderLayoutInput): { maxWidth: number; mode: HeaderLayoutMode } {
    const mode = getExtendedHeaderLayoutMode(input.viewportWidth);

    if (shouldInlineHeaderFloatThreshold(input.viewportWidth, input.currentMode, input.showNearCritical)) {
        const maxWidth = mode === "very-narrow"
            ? 118
            : mode === "compact"
                ? 126
                : mode === "narrow"
                    ? 144
                    : mode === "medium"
                        ? 156
                        : 170;

        return { maxWidth, mode };
    }

    if (input.showPathInfoChip) {
        const maxWidth = mode === "very-narrow"
            ? 136
            : mode === "compact"
                ? 150
                : mode === "narrow"
                    ? 176
                    : mode === "medium"
                        ? 210
                        : 232;

        return { maxWidth, mode };
    }

    return { maxWidth: getBaseHeaderRightReserved(mode), mode };
}

export function computeHeaderButtonLayout(input: HeaderLayoutInput): HeaderButtonLayout {
    const { viewportWidth, desiredControls } = input;
    const mode = getExtendedHeaderLayoutMode(viewportWidth);
    const baseRightReserved = getBaseHeaderRightReserved(mode);
    const topRightBudget = getTopRightControlWidthBudget(input);
    const rightReserved = Math.max(baseRightReserved, topRightBudget.maxWidth + 24);
    const dockStartX = 16;
    const availableWidth = viewportWidth - rightReserved - dockStartX;

    const gap = mode === "wide" ? 8 : (mode === "medium" ? 6 : (mode === "narrow" ? 5 : 4));
    const iconButtonSize = UI_TOKENS.height.standard;
    const smallIconSize = UI_TOKENS.height.standard;

    const showAllWidth = iconButtonSize;
    const modeWidth = mode === "wide" ? 150 : (mode === "medium" ? 130 : iconButtonSize);
    const lookAheadWidth = mode === "wide" ? 88 : (mode === "medium" ? 82 : (mode === "narrow" ? 74 : 66));
    const baselineWidth = iconButtonSize;
    const prevWidth = iconButtonSize;
    const wbsEnableWidth = iconButtonSize;

    let visibleButtons = {
        showAll: true,
        modeToggle: true,
        lookAhead: desiredControls.lookAhead,
        baseline: desiredControls.baseline,
        previousUpdate: desiredControls.previousUpdate,
        connectorLines: desiredControls.connectorLines,
        colToggle: desiredControls.columns,
        wbsEnable: desiredControls.wbsEnable,
        wbsExpand: desiredControls.wbsExpand,
        wbsCollapse: desiredControls.wbsCollapse,
        copyButton: desiredControls.copyButton,
        htmlExportButton: false,
        exportButton: false,
        helpButton: false
    };

    // WBS hierarchy actions live in the controls menu; the inline WBS control only toggles grouping.
    visibleButtons.wbsExpand = false;
    visibleButtons.wbsCollapse = false;

    if (mode === "medium") {
        visibleButtons.wbsCollapse = false;
        visibleButtons.wbsExpand = false;
        visibleButtons.connectorLines = false;
        visibleButtons.colToggle = false;
    } else if (mode === "narrow") {
        visibleButtons.baseline = false;
        visibleButtons.previousUpdate = false;
        visibleButtons.connectorLines = false;
        visibleButtons.colToggle = false;
        visibleButtons.wbsEnable = false;
        visibleButtons.wbsExpand = false;
        visibleButtons.wbsCollapse = false;
    } else if (mode === "compact" || mode === "very-narrow") {
        visibleButtons.lookAhead = desiredControls.lookAhead && !!input.lookAheadActive;
        visibleButtons.baseline = false;
        visibleButtons.previousUpdate = false;
        visibleButtons.connectorLines = false;
        visibleButtons.colToggle = false;
        visibleButtons.wbsEnable = false;
        visibleButtons.wbsExpand = false;
        visibleButtons.wbsCollapse = false;
    } else if (viewportWidth < 1240) {
        visibleButtons.wbsCollapse = false;
        visibleButtons.wbsExpand = false;
    }

    const getHiddenControls = (): HeaderMenuAction[] => {
        const controls: HeaderMenuAction[] = [];
        if (desiredControls.lookAhead && !visibleButtons.lookAhead) controls.push("lookAhead");
        if (desiredControls.floatThreshold && !shouldInlineHeaderFloatThreshold(viewportWidth, input.currentMode, input.showNearCritical)) controls.push("floatThreshold");
        if (desiredControls.baseline && !visibleButtons.baseline) controls.push("baseline");
        if (desiredControls.previousUpdate && !visibleButtons.previousUpdate) controls.push("previousUpdate");
        if (desiredControls.progressLine) controls.push("progressLine");
        if (desiredControls.connectorLines && !visibleButtons.connectorLines) controls.push("connectorLines");
        if (desiredControls.columns && !visibleButtons.colToggle) controls.push("columns");
        if (desiredControls.wbsEnable && !visibleButtons.wbsEnable) controls.push("wbsEnable");
        if (desiredControls.wbsExpand && !visibleButtons.wbsExpand) controls.push("wbsExpand");
        if (desiredControls.wbsCollapse && !visibleButtons.wbsCollapse) controls.push("wbsCollapse");
        if (desiredControls.htmlExportButton && !visibleButtons.htmlExportButton) controls.push("html");
        if (desiredControls.exportButton && !visibleButtons.exportButton) controls.push("pdf");
        if (desiredControls.helpButton && !visibleButtons.helpButton) controls.push("help");
        return controls;
    };

    let actionOverflowVisible = getHiddenControls().length > 0;

    const calculateVisibleWidth = (): number => {
        let width = 0;
        let count = 0;
        if (visibleButtons.showAll) { width += showAllWidth; count++; }
        if (visibleButtons.modeToggle) { width += modeWidth; count++; }
        if (visibleButtons.lookAhead) { width += lookAheadWidth; count++; }
        if (visibleButtons.baseline) { width += baselineWidth; count++; }
        if (visibleButtons.previousUpdate) { width += prevWidth; count++; }
        if (visibleButtons.connectorLines) { width += iconButtonSize; count++; }
        if (visibleButtons.colToggle) { width += iconButtonSize; count++; }
        if (visibleButtons.wbsEnable) { width += wbsEnableWidth; count++; }
        if (visibleButtons.wbsExpand) { width += iconButtonSize; count++; }
        if (visibleButtons.wbsCollapse) { width += iconButtonSize; count++; }
        if (visibleButtons.copyButton) { width += smallIconSize; count++; }
        if (visibleButtons.htmlExportButton) { width += smallIconSize; count++; }
        if (visibleButtons.exportButton) { width += smallIconSize; count++; }
        if (visibleButtons.helpButton) { width += smallIconSize; count++; }
        if (actionOverflowVisible) { width += smallIconSize; count++; }
        return width + Math.max(0, count - 1) * gap;
    };

    const refreshActionOverflow = (): number => {
        actionOverflowVisible = getHiddenControls().length > 0;
        return calculateVisibleWidth();
    };

    let visibleWidth = calculateVisibleWidth();

    if (visibleWidth > availableWidth && visibleButtons.wbsCollapse) {
        visibleButtons.wbsCollapse = false;
        visibleWidth = refreshActionOverflow();
    }
    if (visibleWidth > availableWidth && visibleButtons.wbsExpand) {
        visibleButtons.wbsExpand = false;
        visibleWidth = refreshActionOverflow();
    }
    if (visibleWidth > availableWidth && visibleButtons.wbsEnable) {
        visibleButtons.wbsEnable = false;
        visibleWidth = refreshActionOverflow();
    }
    if (visibleWidth > availableWidth && visibleButtons.colToggle) {
        visibleButtons.colToggle = false;
        visibleWidth = refreshActionOverflow();
    }
    if (visibleWidth > availableWidth && visibleButtons.connectorLines) {
        visibleButtons.connectorLines = false;
        visibleWidth = refreshActionOverflow();
    }
    if (visibleWidth > availableWidth && visibleButtons.helpButton) {
        visibleButtons.helpButton = false;
        visibleWidth = refreshActionOverflow();
    }
    if (visibleWidth > availableWidth && visibleButtons.htmlExportButton) {
        visibleButtons.htmlExportButton = false;
        visibleWidth = refreshActionOverflow();
    }
    if (visibleWidth > availableWidth && visibleButtons.exportButton) {
        visibleButtons.exportButton = false;
        visibleWidth = refreshActionOverflow();
    }
    if (visibleWidth > availableWidth && visibleButtons.previousUpdate) {
        visibleButtons.previousUpdate = false;
        visibleWidth = refreshActionOverflow();
    }
    if (visibleWidth > availableWidth && visibleButtons.baseline) {
        visibleButtons.baseline = false;
        visibleWidth = refreshActionOverflow();
    }
    if (visibleWidth > availableWidth && visibleButtons.lookAhead && availableWidth < (showAllWidth + modeWidth + lookAheadWidth + gap * 2)) {
        visibleButtons.lookAhead = false;
        visibleWidth = refreshActionOverflow();
    }

    const hiddenActions = getHiddenControls();

    if (visibleWidth > availableWidth && actionOverflowVisible && hiddenActions.length === 0) {
        actionOverflowVisible = false;
        visibleWidth = calculateVisibleWidth();
    }

    let x = dockStartX;

    const showAllCritical = {
        x,
        width: showAllWidth,
        showText: false,
        visible: visibleButtons.showAll
    };
    if (visibleButtons.showAll) x += showAllWidth + gap;

    const modeToggle = {
        x,
        width: modeWidth,
        showFullLabels: mode === "wide",
        visible: visibleButtons.modeToggle
    };
    if (visibleButtons.modeToggle) x += modeWidth + gap;

    const lookAhead = {
        x,
        width: lookAheadWidth,
        visible: visibleButtons.lookAhead
    };
    if (visibleButtons.lookAhead) x += lookAheadWidth + gap;

    const baseline = {
        x,
        width: baselineWidth,
        iconOnly: true,
        visible: visibleButtons.baseline
    };
    if (visibleButtons.baseline) x += baselineWidth + gap;

    const previousUpdate = {
        x,
        width: prevWidth,
        iconOnly: true,
        visible: visibleButtons.previousUpdate
    };
    if (visibleButtons.previousUpdate) x += prevWidth + gap;

    const connectorLines = {
        x,
        size: iconButtonSize,
        visible: visibleButtons.connectorLines
    };
    if (visibleButtons.connectorLines) x += iconButtonSize + gap;

    const colToggle = {
        x,
        size: iconButtonSize,
        visible: visibleButtons.colToggle
    };
    if (visibleButtons.colToggle) x += iconButtonSize + gap;

    const wbsEnable = {
        x,
        width: wbsEnableWidth,
        visible: visibleButtons.wbsEnable
    };
    if (visibleButtons.wbsEnable) x += wbsEnableWidth + gap;

    const wbsExpandToggle = {
        x,
        size: iconButtonSize,
        visible: visibleButtons.wbsExpand
    };
    if (visibleButtons.wbsExpand) x += iconButtonSize + gap;

    const wbsCollapseToggle = {
        x,
        size: iconButtonSize,
        visible: visibleButtons.wbsCollapse
    };
    if (visibleButtons.wbsCollapse) x += iconButtonSize + gap;

    const copyButton = {
        x,
        size: smallIconSize,
        visible: visibleButtons.copyButton
    };
    if (visibleButtons.copyButton) x += smallIconSize + gap;

    const htmlExportButton = {
        x,
        size: smallIconSize,
        visible: visibleButtons.htmlExportButton
    };
    if (visibleButtons.htmlExportButton) x += smallIconSize + gap;

    const exportButton = {
        x,
        size: smallIconSize,
        visible: visibleButtons.exportButton
    };
    if (visibleButtons.exportButton) x += smallIconSize + gap;

    const helpButton = {
        x,
        size: smallIconSize,
        visible: visibleButtons.helpButton
    };
    if (visibleButtons.helpButton) x += smallIconSize + (actionOverflowVisible && hiddenActions.length > 0 ? gap : 0);

    const actionOverflowButton = {
        x,
        size: smallIconSize,
        visible: actionOverflowVisible && hiddenActions.length > 0,
        hiddenActions
    };
    if (actionOverflowButton.visible) x += smallIconSize;

    return {
        mode,
        showAllCritical,
        modeToggle,
        lookAhead,
        colToggle,
        baseline,
        previousUpdate,
        connectorLines,
        wbsEnable,
        wbsExpandToggle,
        wbsCollapseToggle,
        copyButton,
        htmlExportButton,
        exportButton,
        helpButton,
        actionOverflowButton,
        gap,
        totalWidth: x
    };
}

export function getLookAheadOptions(activeDays: number): Array<{ value: number; label: string }> {
    const options = [
        { value: 0, label: "Off" },
        { value: 14, label: "2W" },
        { value: 21, label: "3W" },
        { value: 28, label: "4W" },
        { value: 42, label: "6W" },
        { value: 56, label: "8W" },
        { value: 84, label: "12W" }
    ];

    if (activeDays > 0 && !options.some(option => option.value === activeDays)) {
        options.push({ value: activeDays, label: `${activeDays}d` });
        options.sort((a, b) => a.value - b.value);
    }

    return options;
}

export function getActiveHiddenHeaderControlCount(
    actions: HeaderMenuAction[],
    state: HeaderActiveControlState
): number {
    return actions.reduce((count, action) => {
        switch (action) {
            case "lookAhead":
                return count + (state.lookAheadWindowDays > 0 ? 1 : 0);
            case "floatThreshold":
                return count + 1;
            case "baseline":
                return count + (state.showBaseline ? 1 : 0);
            case "previousUpdate":
                return count + (state.showPreviousUpdate ? 1 : 0);
            case "progressLine":
                return count + (state.showProgressLine ? 1 : 0);
            case "connectorLines":
                return count + (state.showConnectorLines ? 1 : 0);
            case "columns":
                return count + (state.showExtraColumns ? 1 : 0);
            case "wbsEnable":
                return count + (state.wbsEnabled ? 1 : 0);
            default:
                return count;
        }
    }, 0);
}

export function computeSecondRowLayout(input: HeaderSecondRowLayoutInput): HeaderSecondRowLayout {
    const { viewportWidth, mode } = input;
    const defaultWidth = mode === "wide" ? 350 : (mode === "medium" ? 280 : 200);
    const horizontalPadding = 10;
    const traceVisible = !!input.traceVisible;
    const traceButtonWidth = mode === "narrow" ? 30 : (mode === "medium" ? 68 : 92);
    const traceContainerWidth = (traceButtonWidth * 2) + 10;
    const traceGap = traceVisible ? 12 : 0;
    const statusGap = traceVisible ? 12 : 12;
    const reservedTraceWidth = traceVisible ? traceGap + traceContainerWidth + statusGap : 0;
    const availableForDropdown = Math.max(96, viewportWidth - horizontalPadding * 2 - reservedTraceWidth);
    const minWidth = Math.min(150, availableForDropdown);
    const configuredWidth = input.configuredDropdownWidth ?? defaultWidth;
    const dropdownWidth = Math.min(Math.max(configuredWidth, minWidth), availableForDropdown);

    const position = input.dropdownPosition || "left";
    const maxLeft = Math.max(horizontalPadding, viewportWidth - dropdownWidth - horizontalPadding - reservedTraceWidth);
    let dropdownLeft = horizontalPadding;

    if (position === "center") {
        dropdownLeft = (viewportWidth - dropdownWidth - reservedTraceWidth) / 2;
    } else if (position === "right") {
        dropdownLeft = viewportWidth - dropdownWidth - horizontalPadding - reservedTraceWidth;
    }

    dropdownLeft = Math.max(horizontalPadding, Math.min(dropdownLeft, maxLeft));

    const traceModeLeft = dropdownLeft + dropdownWidth + traceGap;
    const statusLeft = traceModeLeft + traceContainerWidth + statusGap;
    const statusWidth = Math.max(0, viewportWidth - statusLeft - horizontalPadding);
    const floatThresholdMaxWidth = mode === "narrow" ? 180 : 250;

    return {
        dropdown: { width: dropdownWidth, left: dropdownLeft },
        traceModeToggle: { left: traceModeLeft, width: traceContainerWidth },
        statusLabel: { left: statusLeft, width: statusWidth },
        floatThreshold: { maxWidth: floatThresholdMaxWidth }
    };
}
