import { describe, expect, it } from "vitest";
import {
    BASELINE_COMPARISON_GLYPH,
    CONNECTOR_DEPENDENCY_GLYPH,
    CRITICAL_ROUTE_GLYPH,
    glyphPolylinePath,
    PREVIOUS_UPDATE_GLYPH,
    WBS_DEPTH_GLYPH,
    WBS_HIERARCHY_GLYPH
} from "../../src/utils/HeaderGlyphGeometry";
import type {
    GlyphPoint,
    GlyphRect
} from "../../src/utils/HeaderGlyphGeometry";

function rectRight(rect: GlyphRect): number {
    return rect.x + rect.width;
}

function rectBottom(rect: GlyphRect): number {
    return rect.y + rect.height;
}

function pointInsideRectInterior(point: GlyphPoint, rect: GlyphRect): boolean {
    return point.x > rect.x
        && point.x < rectRight(rect)
        && point.y > rect.y
        && point.y < rectBottom(rect);
}

function axisAlignedSegmentCrossesRectInterior(
    start: GlyphPoint,
    end: GlyphPoint,
    rect: GlyphRect
): boolean {
    if (start.x === end.x) {
        const segmentTop = Math.min(start.y, end.y);
        const segmentBottom = Math.max(start.y, end.y);
        return start.x > rect.x
            && start.x < rectRight(rect)
            && segmentBottom > rect.y
            && segmentTop < rectBottom(rect);
    }

    if (start.y === end.y) {
        const segmentLeft = Math.min(start.x, end.x);
        const segmentRight = Math.max(start.x, end.x);
        return start.y > rect.y
            && start.y < rectBottom(rect)
            && segmentRight > rect.x
            && segmentLeft < rectRight(rect);
    }

    return false;
}

function rectanglesOverlap(first: GlyphRect, second: GlyphRect): boolean {
    return first.x < rectRight(second)
        && rectRight(first) > second.x
        && first.y < rectBottom(second)
        && rectBottom(first) > second.y;
}

describe("HeaderGlyphGeometry", () => {
    it("uses the same current-bar geometry for both comparison controls", () => {
        expect(BASELINE_COMPARISON_GLYPH.currentBar)
            .toEqual(PREVIOUS_UPDATE_GLYPH.currentBar);
    });

    it("keeps both comparison bars below the shared current bar", () => {
        expect(BASELINE_COMPARISON_GLYPH.comparisonBar.y)
            .toBeGreaterThan(rectBottom(BASELINE_COMPARISON_GLYPH.currentBar));
        expect(PREVIOUS_UPDATE_GLYPH.comparisonBar.y)
            .toBeGreaterThan(rectBottom(PREVIOUS_UPDATE_GLYPH.currentBar));
    });

    it("distinguishes fixed baseline anchors from the previous-update chevron", () => {
        expect(BASELINE_COMPARISON_GLYPH.startAnchor.points[0].x)
            .toBe(BASELINE_COMPARISON_GLYPH.comparisonBar.x);
        expect(BASELINE_COMPARISON_GLYPH.finishAnchor.points[0].x)
            .toBe(rectRight(BASELINE_COMPARISON_GLYPH.comparisonBar));

        const chevronTip = PREVIOUS_UPDATE_GLYPH.previousChevron.points[1];
        expect(chevronTip.x).toBeLessThan(PREVIOUS_UPDATE_GLYPH.comparisonBar.x);
    });

    it("shows a solid critical branch alongside a separate non-critical branch", () => {
        expect(rectanglesOverlap(
            CRITICAL_ROUTE_GLYPH.criticalBar,
            CRITICAL_ROUTE_GLYPH.alternateBar
        )).toBe(false);
        expect(CRITICAL_ROUTE_GLYPH.criticalConnectors).toHaveLength(2);
        expect(CRITICAL_ROUTE_GLYPH.alternateConnectors).toHaveLength(2);
    });

    it("joins both critical-toggle branches to task-bar boundaries", () => {
        const sourceRight = rectRight(CRITICAL_ROUTE_GLYPH.sourceBar);
        const targetLeft = CRITICAL_ROUTE_GLYPH.targetBar.x;

        for (const connectors of [
            CRITICAL_ROUTE_GLYPH.criticalConnectors,
            CRITICAL_ROUTE_GLYPH.alternateConnectors
        ]) {
            expect(connectors[0].points[0]).toEqual({ x: sourceRight, y: 0 });
            expect(connectors[1].points.at(-1)).toEqual({ x: targetLeft, y: 0 });
        }

        expect(CRITICAL_ROUTE_GLYPH.criticalConnectors[0].points.at(-1)).toEqual({
            x: CRITICAL_ROUTE_GLYPH.criticalBar.x,
            y: CRITICAL_ROUTE_GLYPH.criticalBar.y + (CRITICAL_ROUTE_GLYPH.criticalBar.height / 2)
        });
        expect(CRITICAL_ROUTE_GLYPH.alternateConnectors[0].points.at(-1)).toEqual({
            x: CRITICAL_ROUTE_GLYPH.alternateBar.x,
            y: CRITICAL_ROUTE_GLYPH.alternateBar.y + (CRITICAL_ROUTE_GLYPH.alternateBar.height / 2)
        });
    });

    it("connects the predecessor and successor at their facing boundaries", () => {
        const route = CONNECTOR_DEPENDENCY_GLYPH.route.points;
        const first = route[0];
        const last = route[route.length - 1];
        const predecessor = CONNECTOR_DEPENDENCY_GLYPH.predecessorBar;
        const successor = CONNECTOR_DEPENDENCY_GLYPH.successorBar;

        expect(first).toEqual({
            x: rectRight(predecessor),
            y: predecessor.y + (predecessor.height / 2)
        });
        expect(last).toEqual({
            x: successor.x,
            y: successor.y + (successor.height / 2)
        });
    });

    it("keeps the connector route outside both task-bar interiors", () => {
        const bars = [
            CONNECTOR_DEPENDENCY_GLYPH.predecessorBar,
            CONNECTOR_DEPENDENCY_GLYPH.successorBar
        ];
        const route = CONNECTOR_DEPENDENCY_GLYPH.route.points;

        for (const point of route) {
            for (const bar of bars) {
                expect(pointInsideRectInterior(point, bar)).toBe(false);
            }
        }

        for (let index = 1; index < route.length; index++) {
            for (const bar of bars) {
                expect(axisAlignedSegmentCrossesRectInterior(route[index - 1], route[index], bar)).toBe(false);
            }
        }
    });

    it("points the arrowhead in the direction of the final connector segment", () => {
        const route = CONNECTOR_DEPENDENCY_GLYPH.route.points;
        const finalStart = route[route.length - 2];
        const finalEnd = route[route.length - 1];
        const [upperWing, tip, lowerWing] = CONNECTOR_DEPENDENCY_GLYPH.arrowhead.points;

        expect(finalEnd.x).toBeGreaterThan(finalStart.x);
        expect(tip).toEqual(finalEnd);
        expect(tip.x).toBeGreaterThan(upperWing.x);
        expect(tip.x).toBeGreaterThan(lowerWing.x);
    });

    it("uses equal WBS nodes, regular indentation, and non-overlapping labels", () => {
        const nodes = WBS_HIERARCHY_GLYPH.nodes;
        const labels = WBS_HIERARCHY_GLYPH.labelBars;

        expect(nodes.map(node => [node.width, node.height])).toEqual([
            [3, 3],
            [3, 3],
            [3, 3]
        ]);
        expect(nodes[1].x - nodes[0].x).toBe(3);
        expect(nodes[2].x - nodes[1].x).toBe(3);

        nodes.forEach((node, index) => {
            expect(rectanglesOverlap(node, labels[index])).toBe(false);
            expect(labels[index].x - rectRight(node)).toBe(1.5);
        });
    });

    it("joins WBS branches to parent bottoms and child left centres", () => {
        WBS_HIERARCHY_GLYPH.branches.forEach((branch, index) => {
            const parent = WBS_HIERARCHY_GLYPH.nodes[index];
            const child = WBS_HIERARCHY_GLYPH.nodes[index + 1];
            const first = branch.points[0];
            const last = branch.points[branch.points.length - 1];

            expect(first).toEqual({
                x: parent.x + (parent.width / 2),
                y: rectBottom(parent)
            });
            expect(last).toEqual({
                x: child.x,
                y: child.y + (child.height / 2)
            });
        });
    });

    it("keeps WBS depth chevrons separate from the compact hierarchy", () => {
        const hierarchyRight = Math.max(...WBS_DEPTH_GLYPH.nodes.map(rectRight));
        const expandLeft = Math.min(...WBS_DEPTH_GLYPH.expandChevron.points.map(point => point.x));
        const collapseLeft = Math.min(...WBS_DEPTH_GLYPH.collapseChevron.points.map(point => point.x));

        expect(expandLeft).toBeGreaterThan(hierarchyRight);
        expect(collapseLeft).toBeGreaterThan(hierarchyRight);
    });

    it("serialises glyph polylines into stable SVG path data", () => {
        expect(glyphPolylinePath(CONNECTOR_DEPENDENCY_GLYPH.route))
            .toBe("M-1.5,-5 L0,-5 L0,5 L1.5,5");
        expect(glyphPolylinePath({ points: [] })).toBe("");
    });
});
