export interface GlyphPoint {
    x: number;
    y: number;
}

export interface GlyphRect {
    x: number;
    y: number;
    width: number;
    height: number;
    radius: number;
}

export interface GlyphPolyline {
    points: readonly GlyphPoint[];
    closed?: boolean;
}

export function glyphPolylinePath(polyline: GlyphPolyline): string {
    const [firstPoint, ...remainingPoints] = polyline.points;
    if (!firstPoint) {
        return "";
    }

    const commands = [`M${firstPoint.x},${firstPoint.y}`];
    for (const point of remainingPoints) {
        commands.push(`L${point.x},${point.y}`);
    }
    if (polyline.closed) {
        commands.push("Z");
    }
    return commands.join(" ");
}

export const CONNECTOR_DEPENDENCY_GLYPH = {
    predecessorBar: { x: -7.5, y: -6.5, width: 6, height: 3, radius: 1.2 },
    successorBar: { x: 1.5, y: 3.5, width: 6, height: 3, radius: 1.2 },
    route: {
        points: [
            { x: -1.5, y: -5 },
            { x: 0, y: -5 },
            { x: 0, y: 5 },
            { x: 1.5, y: 5 }
        ]
    },
    arrowhead: {
        points: [
            { x: -0.5, y: 3.2 },
            { x: 1.5, y: 5 },
            { x: -0.5, y: 6.8 }
        ]
    }
} as const;

export const CRITICAL_ROUTE_GLYPH = {
    sourceBar: { x: -8, y: -1.4, width: 3.5, height: 2.8, radius: 0.8 },
    criticalBar: { x: -2.5, y: -6.5, width: 4.5, height: 2.8, radius: 0.8 },
    alternateBar: { x: -2.5, y: 3.7, width: 4.5, height: 2.8, radius: 0.8 },
    targetBar: { x: 4.5, y: -1.4, width: 3.5, height: 2.8, radius: 0.8 },
    criticalConnectors: [
        {
            points: [
                { x: -4.5, y: 0 },
                { x: -3.5, y: 0 },
                { x: -3.5, y: -5.1 },
                { x: -2.5, y: -5.1 }
            ]
        },
        {
            points: [
                { x: 2, y: -5.1 },
                { x: 3.5, y: -5.1 },
                { x: 3.5, y: 0 },
                { x: 4.5, y: 0 }
            ]
        }
    ],
    alternateConnectors: [
        {
            points: [
                { x: -4.5, y: 0 },
                { x: -3.5, y: 0 },
                { x: -3.5, y: 5.1 },
                { x: -2.5, y: 5.1 }
            ]
        },
        {
            points: [
                { x: 2, y: 5.1 },
                { x: 3.5, y: 5.1 },
                { x: 3.5, y: 0 },
                { x: 4.5, y: 0 }
            ]
        }
    ]
} as const;

const COMPARISON_CURRENT_BAR = {
    x: -7,
    y: -5.5,
    width: 14,
    height: 3.5,
    radius: 1.3
} as const;

export const BASELINE_COMPARISON_GLYPH = {
    currentBar: COMPARISON_CURRENT_BAR,
    comparisonBar: { x: -6, y: 2, width: 12, height: 2.5, radius: 0.8 },
    startAnchor: {
        points: [
            { x: -6, y: 0.75 },
            { x: -6, y: 5.75 }
        ]
    },
    finishAnchor: {
        points: [
            { x: 6, y: 0.75 },
            { x: 6, y: 5.75 }
        ]
    }
} as const;

export const PREVIOUS_UPDATE_GLYPH = {
    currentBar: COMPARISON_CURRENT_BAR,
    comparisonBar: { x: -3.5, y: 2, width: 10.5, height: 2.5, radius: 0.8 },
    previousChevron: {
        points: [
            { x: -4.75, y: 0.75 },
            { x: -7, y: 3.25 },
            { x: -4.75, y: 5.75 }
        ]
    }
} as const;

export const COLUMN_TABLE_GLYPH = {
    frame: { x: -7, y: -6, width: 14, height: 12, radius: 1.5 },
    dividers: [-2.5, 2.5]
} as const;

export const WBS_HIERARCHY_GLYPH = {
    nodes: [
        { x: -7.5, y: -7.5, width: 3, height: 3, radius: 0.7 },
        { x: -4.5, y: -1.5, width: 3, height: 3, radius: 0.7 },
        { x: -1.5, y: 4.5, width: 3, height: 3, radius: 0.7 }
    ],
    labelBars: [
        { x: -3, y: -7, width: 8.5, height: 2, radius: 1 },
        { x: 0, y: -1, width: 7, height: 2, radius: 1 },
        { x: 3, y: 5, width: 5, height: 2, radius: 1 }
    ],
    branches: [
        {
            points: [
                { x: -6, y: -4.5 },
                { x: -6, y: 0 },
                { x: -4.5, y: 0 }
            ]
        },
        {
            points: [
                { x: -3, y: 1.5 },
                { x: -3, y: 6 },
                { x: -1.5, y: 6 }
            ]
        }
    ]
} as const;

export const WBS_DEPTH_GLYPH = {
    nodes: [
        { x: -7, y: -6, width: 2.5, height: 2.5, radius: 0.6 },
        { x: -4, y: -1.25, width: 2.5, height: 2.5, radius: 0.6 },
        { x: -1, y: 3.5, width: 2.5, height: 2.5, radius: 0.6 }
    ],
    branches: [
        {
            points: [
                { x: -5.75, y: -3.5 },
                { x: -5.75, y: 0 },
                { x: -4, y: 0 }
            ]
        },
        {
            points: [
                { x: -2.75, y: 1.25 },
                { x: -2.75, y: 4.75 },
                { x: -1, y: 4.75 }
            ]
        }
    ],
    expandChevron: {
        points: [
            { x: 3, y: -1 },
            { x: 6, y: 2 },
            { x: 9, y: -1 }
        ]
    },
    collapseChevron: {
        points: [
            { x: 3, y: 2 },
            { x: 6, y: -1 },
            { x: 9, y: 2 }
        ]
    }
} as const;
