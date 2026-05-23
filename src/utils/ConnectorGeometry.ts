import type { Relationship, Task } from "../data/Interfaces";
import { normalizeRelationshipType, RelationshipType } from "./RelationshipLogic";
import {
    CurrentBarDateMode,
    getCurrentTaskBarGeometry,
    isValidTaskDate,
    TaskBarSegment
} from "./TaskBarGeometry";

export type ConnectorSide = "start" | "finish";

export type ConnectorPoint = {
    x: number;
    y: number;
};

export type ConnectorAnchor = ConnectorPoint & {
    baseX: number;
    date: Date;
    side: ConnectorSide;
    isMilestone: boolean;
};

export type ConnectorRenderGeometry = {
    pathData: string;
    points: ConnectorPoint[];
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    sourceAnchor: ConnectorAnchor;
    targetAnchor: ConnectorAnchor;
    relationshipType: RelationshipType;
    arrowDirectionX: -1 | 1;
};

export type ConnectorGeometryOptions = {
    relationship: Pick<Relationship, "type">;
    predecessor: Task;
    successor: Task;
    predecessorY: number;
    successorY: number;
    xScale: (date: Date) => number;
    currentBarDateMode: CurrentBarDateMode;
    dataDate: Date | null | undefined;
    treatZeroDurationAsMilestone?: boolean;
    taskHeight: number;
    milestoneSize: number;
    elbowOffset: number;
    arrowHeadSize: number;
    chartWidth?: number;
};

const CONNECTOR_CORNER_TOLERANCE = 0.5;
const SOURCE_ENDPOINT_CLEARANCE = 0;

export function getConnectorRenderGeometry(options: ConnectorGeometryOptions): ConnectorRenderGeometry | null {
    const relationshipType = normalizeRelationshipType(options.relationship.type);
    const sourceSide = getRelationshipSourceSide(relationshipType);
    const targetSide = getRelationshipTargetSide(relationshipType);
    const targetClearance = getConnectorTargetEndpointClearance(options.arrowHeadSize);

    const sourceAnchor = getConnectorAnchor({
        task: options.predecessor,
        side: sourceSide,
        y: options.predecessorY,
        xScale: options.xScale,
        currentBarDateMode: options.currentBarDateMode,
        dataDate: options.dataDate,
        treatZeroDurationAsMilestone: options.treatZeroDurationAsMilestone,
        milestoneSize: options.milestoneSize,
        clearance: SOURCE_ENDPOINT_CLEARANCE
    });
    const targetAnchor = getConnectorAnchor({
        task: options.successor,
        side: targetSide,
        y: options.successorY,
        xScale: options.xScale,
        currentBarDateMode: options.currentBarDateMode,
        dataDate: options.dataDate,
        treatZeroDurationAsMilestone: options.treatZeroDurationAsMilestone,
        milestoneSize: options.milestoneSize,
        clearance: targetClearance
    });

    if (!sourceAnchor || !targetAnchor) {
        return null;
    }

    const route = routeConnector({
        start: sourceAnchor,
        end: targetAnchor,
        sourceSide,
        targetSide,
        elbowOffset: options.elbowOffset,
        taskHeight: options.taskHeight,
        chartWidth: options.chartWidth
    });

    if (route.length < 2) {
        return null;
    }

    const penultimatePoint = route[route.length - 2];
    const arrowDirectionX = targetAnchor.x >= penultimatePoint.x ? 1 : -1;

    return {
        pathData: pointsToPathData(route),
        points: route,
        startX: sourceAnchor.x,
        startY: sourceAnchor.y,
        endX: targetAnchor.x,
        endY: targetAnchor.y,
        sourceAnchor,
        targetAnchor,
        relationshipType,
        arrowDirectionX
    };
}

function getRelationshipSourceSide(type: RelationshipType): ConnectorSide {
    return type === "FS" || type === "FF" ? "finish" : "start";
}

function getRelationshipTargetSide(type: RelationshipType): ConnectorSide {
    return type === "FS" || type === "SS" ? "start" : "finish";
}

function getConnectorTargetEndpointClearance(arrowHeadSize: number): number {
    return Math.max(3, Math.min(6, arrowHeadSize * 0.5));
}

function getConnectorAnchor(input: {
    task: Task;
    side: ConnectorSide;
    y: number;
    xScale: (date: Date) => number;
    currentBarDateMode: CurrentBarDateMode;
    dataDate: Date | null | undefined;
    treatZeroDurationAsMilestone?: boolean;
    milestoneSize: number;
    clearance: number;
}): ConnectorAnchor | null {
    const geometry = getCurrentTaskBarGeometry(
        input.task,
        input.currentBarDateMode,
        input.dataDate,
        input.treatZeroDurationAsMilestone
    );
    const sideDirection = getSideDirection(input.side);
    let anchorDate: Date | null = null;
    let isMilestone = geometry.isMilestone;

    if (geometry.isMilestone) {
        anchorDate = geometry.milestoneDate;
    } else {
        const segment = getConnectorSegment(geometry.segments, input.currentBarDateMode);
        anchorDate = input.side === "start" ? segment?.start ?? null : segment?.finish ?? null;
        isMilestone = false;
    }

    if (!isValidTaskDate(anchorDate)) {
        return null;
    }

    const baseX = input.xScale(anchorDate);
    if (!Number.isFinite(baseX)) {
        return null;
    }

    const milestoneClearance = isMilestone ? input.milestoneSize / 2 : 0;
    const x = baseX + sideDirection * (milestoneClearance + input.clearance);

    return {
        x,
        y: input.y,
        baseX,
        date: anchorDate,
        side: input.side,
        isMilestone
    };
}

function getConnectorSegment(segments: TaskBarSegment[], mode: CurrentBarDateMode): TaskBarSegment | null {
    if (mode === "hybridActualEarly") {
        return segments.find(segment => segment.kind === "scheduled") ?? segments[0] ?? null;
    }

    return segments[0] ?? null;
}

function routeConnector(input: {
    start: ConnectorAnchor;
    end: ConnectorAnchor;
    sourceSide: ConnectorSide;
    targetSide: ConnectorSide;
    elbowOffset: number;
    taskHeight: number;
    chartWidth?: number;
}): ConnectorPoint[] {
    const start = input.start;
    const end = input.end;
    const sourceDirection = getSideDirection(input.sourceSide);
    const targetDirection = input.targetSide === "start" ? 1 : -1;
    const elbowOffset = Math.max(5, input.elbowOffset);
    const sourceExitX = clampRouteX(start.x + sourceDirection * elbowOffset, input.chartWidth);
    const targetApproachX = clampRouteX(end.x - targetDirection * elbowOffset, input.chartWidth);

    const sameRow = Math.abs(start.y - end.y) < 1;
    const directDirection = Math.sign(end.x - start.x);
    const canUseDirectSameRow =
        sameRow &&
        directDirection !== 0 &&
        directDirection === sourceDirection &&
        directDirection === targetDirection;

    if (canUseDirectSameRow) {
        return compactPoints([start, end]);
    }

    if (sameRow) {
        const laneOffset = Math.max(10, Math.min(24, input.taskHeight * 0.75));
        const laneY = start.y - laneOffset >= 0 ? start.y - laneOffset : start.y + laneOffset;
        return compactPoints([
            start,
            { x: sourceExitX, y: start.y },
            { x: sourceExitX, y: laneY },
            { x: targetApproachX, y: laneY },
            { x: targetApproachX, y: end.y },
            end
        ]);
    }

    const midY = (start.y + end.y) / 2;
    return compactPoints([
        start,
        { x: sourceExitX, y: start.y },
        { x: sourceExitX, y: midY },
        { x: targetApproachX, y: midY },
        { x: targetApproachX, y: end.y },
        end
    ]);
}

function getSideDirection(side: ConnectorSide): -1 | 1 {
    return side === "start" ? -1 : 1;
}

function clampRouteX(x: number, chartWidth: number | undefined): number {
    if (chartWidth === undefined || !Number.isFinite(chartWidth)) {
        return x;
    }

    return Math.max(0, Math.min(chartWidth, x));
}

function compactPoints(points: ConnectorPoint[]): ConnectorPoint[] {
    const compacted: ConnectorPoint[] = [];

    for (const point of points) {
        const previous = compacted[compacted.length - 1];
        if (
            previous &&
            Math.abs(previous.x - point.x) <= CONNECTOR_CORNER_TOLERANCE &&
            Math.abs(previous.y - point.y) <= CONNECTOR_CORNER_TOLERANCE
        ) {
            continue;
        }
        compacted.push(point);
    }

    return compacted;
}

function pointsToPathData(points: ConnectorPoint[]): string {
    return points
        .map((point, index) => `${index === 0 ? "M" : "L"} ${formatPathNumber(point.x)},${formatPathNumber(point.y)}`)
        .join(" ");
}

function formatPathNumber(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}
