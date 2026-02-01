/**
 * Centralized constants for the LongestPathVisual
 * Eliminates magic numbers and improves code maintainability
 */

// ============================================================================
// Time Constants
// ============================================================================
export const TIME_CONSTANTS = {
    MS_PER_SECOND: 1000,
    MS_PER_MINUTE: 60 * 1000,
    MS_PER_HOUR: 60 * 60 * 1000,
    MS_PER_DAY: 24 * 60 * 60 * 1000,
    MS_PER_WEEK: 7 * 24 * 60 * 60 * 1000,
} as const;

// ============================================================================
// Data Limits
// ============================================================================
export const DATA_LIMITS = {
    /** Maximum rows Power BI can return with 'top' algorithm */
    MAX_ROWS_POWER_BI: 30_000,
    /** Threshold for switching from SVG to Canvas rendering */
    CANVAS_RENDER_THRESHOLD: 200,
    /** Maximum number of legend categories to display */
    MAX_LEGEND_CATEGORIES: 20,
    /** Maximum WBS hierarchy depth */
    MAX_WBS_LEVELS: 10,
    /** Default debounce delay for general operations */
    DEBOUNCE_MS_DEFAULT: 150,
    /** Debounce delay for scroll events */
    DEBOUNCE_MS_SCROLL: 50,
    /** Debounce delay for zoom operations (~30fps) */
    DEBOUNCE_MS_ZOOM: 32,
    /** Debounce delay for search/filter operations */
    DEBOUNCE_MS_SEARCH: 300,
} as const;

// ============================================================================
// Layout Defaults
// ============================================================================
export const LAYOUT_DEFAULTS = {
    /** Default header height in pixels */
    HEADER_HEIGHT: 54,
    /** Default task bar height in pixels */
    TASK_HEIGHT: 24,
    /** Default padding between tasks */
    TASK_PADDING: 6,
    /** Minimum left margin width */
    LEFT_MARGIN_MIN: 50,
    /** Maximum left margin width */
    LEFT_MARGIN_MAX: 1000,
    /** Default left margin width */
    LEFT_MARGIN_DEFAULT: 280,
    /** Default right margin width */
    RIGHT_MARGIN_DEFAULT: 100,
    /** Left padding for task labels */
    LABEL_PADDING_LEFT: 10,
    /** Zoom slider height */
    ZOOM_SLIDER_HEIGHT: 32,
    /** Minimum zoom range (5% of timeline) */
    ZOOM_SLIDER_MIN_RANGE: 0.05,
    /** Legend footer height */
    LEGEND_FOOTER_HEIGHT: 40,
    /** Task label line height multiplier */
    TASK_LABEL_LINE_HEIGHT: 1.2,
    /** Minimum task width in pixels */
    MIN_TASK_WIDTH_PIXELS: 2,
    /** Resizer handle width */
    RESIZER_WIDTH: 8,
    /** WBS indent width per level */
    WBS_INDENT_WIDTH: 16,
} as const;

// ============================================================================
// Animation Timings
// ============================================================================
export const ANIMATION = {
    /** No animation */
    DURATION_INSTANT: 0,
    /** Fast animations (button feedback) */
    DURATION_FAST: 120,
    /** Normal animations (transitions) */
    DURATION_NORMAL: 200,
    /** Slow animations (complex transitions) */
    DURATION_SLOW: 350,
    /** Very slow animations (page transitions) */
    DURATION_SLOWER: 500,
    /** Canvas/SVG mode transition */
    MODE_TRANSITION_DURATION: 150,
    /** Tooltip show/hide delay */
    TOOLTIP_DELAY: 200,
    /** Loading overlay minimum display time */
    LOADING_MIN_DISPLAY: 300,
} as const;

// ============================================================================
// Rendering Constants
// ============================================================================
export const RENDERING = {
    /** Device pixel ratio default */
    DEFAULT_DPR: 1,
    /** PDF export scale factor */
    PDF_SCALE_FACTOR: 2,
    /** JPEG quality for exports */
    JPEG_QUALITY: 0.92,
    /** Minimum chart dimension */
    MIN_CHART_DIMENSION: 10,
    /** Buffer multiplier for virtual scroll */
    VIRTUAL_SCROLL_BUFFER: 0.5,
    /** Arrow head default size */
    ARROW_HEAD_SIZE: 6,
    /** Milestone shape size ratio */
    MILESTONE_SIZE_RATIO: 0.9,
} as const;

// ============================================================================
// Scroll Preservation
// ============================================================================
export const SCROLL_PRESERVATION = {
    /** Cooldown period after toggle operations (ms) */
    TOGGLE_COOLDOWN_MS: 500,
    /** Time window for considering WBS toggle as "recent" */
    WBS_TOGGLE_WINDOW_MS: 2000,
    /** Scroll throttle timeout */
    SCROLL_THROTTLE_MS: 50,
} as const;

// ============================================================================
// Keyboard Shortcuts
// ============================================================================
export const KEYBOARD_SHORTCUTS = {
    TOGGLE_CRITICAL: 'c',
    TOGGLE_BASELINE: 'b',
    TOGGLE_PREVIOUS_UPDATE: 'p',
    TOGGLE_CONNECTOR_LINES: 'l',
    RESET_ZOOM: 'r',
    CLEAR_SELECTION: 'Escape',
    EXPAND_ALL_WBS: 'e',
    COLLAPSE_ALL_WBS: 'w',
    FOCUS_SEARCH: '/',
} as const;

// ============================================================================
// Error Codes
// ============================================================================
export const ERROR_CODES = {
    // Data errors
    ERR_DATA_MISSING: 'ERR_DATA_MISSING',
    ERR_DATA_PROCESSING: 'ERR_DATA_PROCESSING',
    ERR_DATA_VALIDATION: 'ERR_DATA_VALIDATION',
    ERR_CIRCULAR_DEPENDENCY: 'ERR_CIRCULAR_DEPENDENCY',

    // Rendering errors
    ERR_RENDER_FAILED: 'ERR_RENDER_FAILED',
    ERR_CANVAS_CONTEXT: 'ERR_CANVAS_CONTEXT',
    ERR_SVG_CREATION: 'ERR_SVG_CREATION',
    ERR_SCALE_CREATION: 'ERR_SCALE_CREATION',

    // Export errors
    ERR_PDF_EXPORT: 'ERR_PDF_EXPORT',
    ERR_CLIPBOARD_EXPORT: 'ERR_CLIPBOARD_EXPORT',

    // Critical errors
    CRITICAL_NO_MEMORY: 'CRITICAL_NO_MEMORY',
    CRITICAL_BROWSER_COMPAT: 'CRITICAL_BROWSER_COMPAT',

    // Warnings
    WARN_TRUNCATED_DATA: 'WARN_TRUNCATED_DATA',
    WARN_MISSING_DATES: 'WARN_MISSING_DATES',
    WARN_INVALID_RELATIONSHIP: 'WARN_INVALID_RELATIONSHIP',
} as const;

// ============================================================================
// Validation Patterns
// ============================================================================
export const VALIDATION = {
    /** Valid relationship types */
    VALID_REL_TYPES: ['FS', 'SS', 'FF', 'SF'] as const,
    /** Default relationship type */
    DEFAULT_REL_TYPE: 'FS',
    /** Maximum safe integer for calculations */
    MAX_SAFE_DURATION: 999999,
    /** Minimum visible task width percentage */
    MIN_VISIBLE_TASK_PERCENT: 0.001,
} as const;
