import type { Relationship, Task } from "../data/Interfaces";
import { RelationshipType } from "./RelationshipLogic";
import { CurrentBarDateMode } from "./TaskBarGeometry";
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
    taskHeight: number;
    milestoneSize: number;
    elbowOffset: number;
    arrowHeadSize: number;
    chartWidth?: number;
};
export declare function getConnectorRenderGeometry(options: ConnectorGeometryOptions): ConnectorRenderGeometry | null;
