/**
 * Centralized constants for the LongestPathVisual
 * Eliminates magic numbers and improves code maintainability
 */
export declare const TIME_CONSTANTS: {
    readonly MS_PER_SECOND: 1000;
    readonly MS_PER_MINUTE: number;
    readonly MS_PER_HOUR: number;
    readonly MS_PER_DAY: number;
    readonly MS_PER_WEEK: number;
};
export declare const DATA_LIMITS: {
    /** Maximum rows Power BI can return with 'top' algorithm */
    readonly MAX_ROWS_POWER_BI: 30000;
    /** Threshold for switching from SVG to Canvas rendering */
    readonly CANVAS_RENDER_THRESHOLD: 200;
    /** Maximum number of legend categories to display */
    readonly MAX_LEGEND_CATEGORIES: 20;
    /** Maximum WBS hierarchy depth */
    readonly MAX_WBS_LEVELS: 10;
    /** Default debounce delay for general operations */
    readonly DEBOUNCE_MS_DEFAULT: 150;
    /** Debounce delay for scroll events */
    readonly DEBOUNCE_MS_SCROLL: 50;
    /** Debounce delay for zoom operations (~30fps) */
    readonly DEBOUNCE_MS_ZOOM: 32;
    /** Debounce delay for search/filter operations */
    readonly DEBOUNCE_MS_SEARCH: 300;
};
export declare const LAYOUT_DEFAULTS: {
    /** Default header height in pixels */
    readonly HEADER_HEIGHT: 54;
    /** Default task bar height in pixels */
    readonly TASK_HEIGHT: 24;
    /** Default padding between tasks */
    readonly TASK_PADDING: 6;
    /** Minimum left margin width */
    readonly LEFT_MARGIN_MIN: 50;
    /** Maximum left margin width */
    readonly LEFT_MARGIN_MAX: 1000;
    /** Default left margin width */
    readonly LEFT_MARGIN_DEFAULT: 280;
    /** Default right margin width */
    readonly RIGHT_MARGIN_DEFAULT: 100;
    /** Left padding for task labels */
    readonly LABEL_PADDING_LEFT: 10;
    /** Zoom slider height */
    readonly ZOOM_SLIDER_HEIGHT: 32;
    /** Minimum zoom range (5% of timeline) */
    readonly ZOOM_SLIDER_MIN_RANGE: 0.05;
    /** Legend footer height */
    readonly LEGEND_FOOTER_HEIGHT: 40;
    /** Task label line height multiplier */
    readonly TASK_LABEL_LINE_HEIGHT: 1.2;
    /** Minimum task width in pixels */
    readonly MIN_TASK_WIDTH_PIXELS: 2;
    /** Resizer handle width */
    readonly RESIZER_WIDTH: 8;
    /** WBS indent width per level */
    readonly WBS_INDENT_WIDTH: 16;
};
export declare const ANIMATION: {
    /** No animation */
    readonly DURATION_INSTANT: 0;
    /** Fast animations (button feedback) */
    readonly DURATION_FAST: 120;
    /** Normal animations (transitions) */
    readonly DURATION_NORMAL: 200;
    /** Slow animations (complex transitions) */
    readonly DURATION_SLOW: 350;
    /** Very slow animations (page transitions) */
    readonly DURATION_SLOWER: 500;
    /** Canvas/SVG mode transition */
    readonly MODE_TRANSITION_DURATION: 150;
    /** Tooltip show/hide delay */
    readonly TOOLTIP_DELAY: 200;
    /** Loading overlay minimum display time */
    readonly LOADING_MIN_DISPLAY: 300;
};
export declare const RENDERING: {
    /** Device pixel ratio default */
    readonly DEFAULT_DPR: 1;
    /** PDF export scale factor */
    readonly PDF_SCALE_FACTOR: 2;
    /** JPEG quality for exports */
    readonly JPEG_QUALITY: 0.92;
    /** Minimum chart dimension */
    readonly MIN_CHART_DIMENSION: 10;
    /** Buffer multiplier for virtual scroll */
    readonly VIRTUAL_SCROLL_BUFFER: 0.5;
    /** Arrow head default size */
    readonly ARROW_HEAD_SIZE: 6;
    /** Milestone shape size ratio */
    readonly MILESTONE_SIZE_RATIO: 0.9;
};
export declare const SCROLL_PRESERVATION: {
    /** Cooldown period after toggle operations (ms) */
    readonly TOGGLE_COOLDOWN_MS: 500;
    /** Time window for considering WBS toggle as "recent" */
    readonly WBS_TOGGLE_WINDOW_MS: 2000;
    /** Scroll throttle timeout */
    readonly SCROLL_THROTTLE_MS: 50;
};
export declare const KEYBOARD_SHORTCUTS: {
    readonly TOGGLE_CRITICAL: "c";
    readonly TOGGLE_BASELINE: "b";
    readonly TOGGLE_PREVIOUS_UPDATE: "p";
    readonly TOGGLE_CONNECTOR_LINES: "l";
    readonly RESET_ZOOM: "r";
    readonly CLEAR_SELECTION: "Escape";
    readonly EXPAND_ALL_WBS: "e";
    readonly COLLAPSE_ALL_WBS: "w";
    readonly FOCUS_SEARCH: "/";
};
export declare const ERROR_CODES: {
    readonly ERR_DATA_MISSING: "ERR_DATA_MISSING";
    readonly ERR_DATA_PROCESSING: "ERR_DATA_PROCESSING";
    readonly ERR_DATA_VALIDATION: "ERR_DATA_VALIDATION";
    readonly ERR_CIRCULAR_DEPENDENCY: "ERR_CIRCULAR_DEPENDENCY";
    readonly ERR_RENDER_FAILED: "ERR_RENDER_FAILED";
    readonly ERR_CANVAS_CONTEXT: "ERR_CANVAS_CONTEXT";
    readonly ERR_SVG_CREATION: "ERR_SVG_CREATION";
    readonly ERR_SCALE_CREATION: "ERR_SCALE_CREATION";
    readonly ERR_PDF_EXPORT: "ERR_PDF_EXPORT";
    readonly ERR_CLIPBOARD_EXPORT: "ERR_CLIPBOARD_EXPORT";
    readonly CRITICAL_NO_MEMORY: "CRITICAL_NO_MEMORY";
    readonly CRITICAL_BROWSER_COMPAT: "CRITICAL_BROWSER_COMPAT";
    readonly WARN_TRUNCATED_DATA: "WARN_TRUNCATED_DATA";
    readonly WARN_MISSING_DATES: "WARN_MISSING_DATES";
    readonly WARN_INVALID_RELATIONSHIP: "WARN_INVALID_RELATIONSHIP";
};
export declare const VALIDATION: {
    /** Valid relationship types */
    readonly VALID_REL_TYPES: readonly ["FS", "SS", "FF", "SF"];
    /** Default relationship type */
    readonly DEFAULT_REL_TYPE: "FS";
    /** Maximum safe integer for calculations */
    readonly MAX_SAFE_DURATION: 999999;
    /** Minimum visible task width percentage */
    readonly MIN_VISIBLE_TASK_PERCENT: 0.001;
};
