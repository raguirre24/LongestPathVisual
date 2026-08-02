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
export declare function glyphPolylinePath(polyline: GlyphPolyline): string;
export declare const CONNECTOR_DEPENDENCY_GLYPH: {
    readonly predecessorBar: {
        readonly x: -7.5;
        readonly y: -6.5;
        readonly width: 6;
        readonly height: 3;
        readonly radius: 1.2;
    };
    readonly successorBar: {
        readonly x: 1.5;
        readonly y: 3.5;
        readonly width: 6;
        readonly height: 3;
        readonly radius: 1.2;
    };
    readonly route: {
        readonly points: readonly [{
            readonly x: -1.5;
            readonly y: -5;
        }, {
            readonly x: 0;
            readonly y: -5;
        }, {
            readonly x: 0;
            readonly y: 5;
        }, {
            readonly x: 1.5;
            readonly y: 5;
        }];
    };
    readonly arrowhead: {
        readonly points: readonly [{
            readonly x: -0.5;
            readonly y: 3.2;
        }, {
            readonly x: 1.5;
            readonly y: 5;
        }, {
            readonly x: -0.5;
            readonly y: 6.8;
        }];
    };
};
export declare const CRITICAL_ROUTE_GLYPH: {
    readonly sourceBar: {
        readonly x: -8;
        readonly y: -1.4;
        readonly width: 3.5;
        readonly height: 2.8;
        readonly radius: 0.8;
    };
    readonly criticalBar: {
        readonly x: -2.5;
        readonly y: -6.5;
        readonly width: 4.5;
        readonly height: 2.8;
        readonly radius: 0.8;
    };
    readonly alternateBar: {
        readonly x: -2.5;
        readonly y: 3.7;
        readonly width: 4.5;
        readonly height: 2.8;
        readonly radius: 0.8;
    };
    readonly targetBar: {
        readonly x: 4.5;
        readonly y: -1.4;
        readonly width: 3.5;
        readonly height: 2.8;
        readonly radius: 0.8;
    };
    readonly criticalConnectors: readonly [{
        readonly points: readonly [{
            readonly x: -4.5;
            readonly y: 0;
        }, {
            readonly x: -3.5;
            readonly y: 0;
        }, {
            readonly x: -3.5;
            readonly y: -5.1;
        }, {
            readonly x: -2.5;
            readonly y: -5.1;
        }];
    }, {
        readonly points: readonly [{
            readonly x: 2;
            readonly y: -5.1;
        }, {
            readonly x: 3.5;
            readonly y: -5.1;
        }, {
            readonly x: 3.5;
            readonly y: 0;
        }, {
            readonly x: 4.5;
            readonly y: 0;
        }];
    }];
    readonly alternateConnectors: readonly [{
        readonly points: readonly [{
            readonly x: -4.5;
            readonly y: 0;
        }, {
            readonly x: -3.5;
            readonly y: 0;
        }, {
            readonly x: -3.5;
            readonly y: 5.1;
        }, {
            readonly x: -2.5;
            readonly y: 5.1;
        }];
    }, {
        readonly points: readonly [{
            readonly x: 2;
            readonly y: 5.1;
        }, {
            readonly x: 3.5;
            readonly y: 5.1;
        }, {
            readonly x: 3.5;
            readonly y: 0;
        }, {
            readonly x: 4.5;
            readonly y: 0;
        }];
    }];
};
export declare const BASELINE_COMPARISON_GLYPH: {
    readonly currentBar: {
        readonly x: -7;
        readonly y: -5.5;
        readonly width: 14;
        readonly height: 3.5;
        readonly radius: 1.3;
    };
    readonly comparisonBar: {
        readonly x: -6;
        readonly y: 2;
        readonly width: 12;
        readonly height: 2.5;
        readonly radius: 0.8;
    };
    readonly startAnchor: {
        readonly points: readonly [{
            readonly x: -6;
            readonly y: 0.75;
        }, {
            readonly x: -6;
            readonly y: 5.75;
        }];
    };
    readonly finishAnchor: {
        readonly points: readonly [{
            readonly x: 6;
            readonly y: 0.75;
        }, {
            readonly x: 6;
            readonly y: 5.75;
        }];
    };
};
export declare const PREVIOUS_UPDATE_GLYPH: {
    readonly currentBar: {
        readonly x: -7;
        readonly y: -5.5;
        readonly width: 14;
        readonly height: 3.5;
        readonly radius: 1.3;
    };
    readonly comparisonBar: {
        readonly x: -3.5;
        readonly y: 2;
        readonly width: 10.5;
        readonly height: 2.5;
        readonly radius: 0.8;
    };
    readonly previousChevron: {
        readonly points: readonly [{
            readonly x: -4.75;
            readonly y: 0.75;
        }, {
            readonly x: -7;
            readonly y: 3.25;
        }, {
            readonly x: -4.75;
            readonly y: 5.75;
        }];
    };
};
export declare const COLUMN_TABLE_GLYPH: {
    readonly frame: {
        readonly x: -7;
        readonly y: -6;
        readonly width: 14;
        readonly height: 12;
        readonly radius: 1.5;
    };
    readonly dividers: readonly [-2.5, 2.5];
};
export declare const WBS_HIERARCHY_GLYPH: {
    readonly nodes: readonly [{
        readonly x: -7.5;
        readonly y: -7.5;
        readonly width: 3;
        readonly height: 3;
        readonly radius: 0.7;
    }, {
        readonly x: -4.5;
        readonly y: -1.5;
        readonly width: 3;
        readonly height: 3;
        readonly radius: 0.7;
    }, {
        readonly x: -1.5;
        readonly y: 4.5;
        readonly width: 3;
        readonly height: 3;
        readonly radius: 0.7;
    }];
    readonly labelBars: readonly [{
        readonly x: -3;
        readonly y: -7;
        readonly width: 8.5;
        readonly height: 2;
        readonly radius: 1;
    }, {
        readonly x: 0;
        readonly y: -1;
        readonly width: 7;
        readonly height: 2;
        readonly radius: 1;
    }, {
        readonly x: 3;
        readonly y: 5;
        readonly width: 5;
        readonly height: 2;
        readonly radius: 1;
    }];
    readonly branches: readonly [{
        readonly points: readonly [{
            readonly x: -6;
            readonly y: -4.5;
        }, {
            readonly x: -6;
            readonly y: 0;
        }, {
            readonly x: -4.5;
            readonly y: 0;
        }];
    }, {
        readonly points: readonly [{
            readonly x: -3;
            readonly y: 1.5;
        }, {
            readonly x: -3;
            readonly y: 6;
        }, {
            readonly x: -1.5;
            readonly y: 6;
        }];
    }];
};
export declare const WBS_DEPTH_GLYPH: {
    readonly nodes: readonly [{
        readonly x: -7;
        readonly y: -6;
        readonly width: 2.5;
        readonly height: 2.5;
        readonly radius: 0.6;
    }, {
        readonly x: -4;
        readonly y: -1.25;
        readonly width: 2.5;
        readonly height: 2.5;
        readonly radius: 0.6;
    }, {
        readonly x: -1;
        readonly y: 3.5;
        readonly width: 2.5;
        readonly height: 2.5;
        readonly radius: 0.6;
    }];
    readonly branches: readonly [{
        readonly points: readonly [{
            readonly x: -5.75;
            readonly y: -3.5;
        }, {
            readonly x: -5.75;
            readonly y: 0;
        }, {
            readonly x: -4;
            readonly y: 0;
        }];
    }, {
        readonly points: readonly [{
            readonly x: -2.75;
            readonly y: 1.25;
        }, {
            readonly x: -2.75;
            readonly y: 4.75;
        }, {
            readonly x: -1;
            readonly y: 4.75;
        }];
    }];
    readonly expandChevron: {
        readonly points: readonly [{
            readonly x: 3;
            readonly y: -1;
        }, {
            readonly x: 6;
            readonly y: 2;
        }, {
            readonly x: 9;
            readonly y: -1;
        }];
    };
    readonly collapseChevron: {
        readonly points: readonly [{
            readonly x: 3;
            readonly y: 2;
        }, {
            readonly x: 6;
            readonly y: -1;
        }, {
            readonly x: 9;
            readonly y: 2;
        }];
    };
};
