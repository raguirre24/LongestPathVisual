export type ScheduleEventKind = "start" | "finish";
export interface ScheduleTaskLike {
    internalId: string;
    startDate?: Date | null;
    finishDate?: Date | null;
}
export interface ScheduleRelationshipLike {
    predecessorId: string;
    successorId: string;
    type?: string | null;
    lag?: number | null;
}
export interface DrivingEventEdge<TRel extends ScheduleRelationshipLike> {
    id: string;
    kind: "task" | "relationship";
    taskId: string;
    fromNodeId: string;
    toNodeId: string;
    weightDays: number;
    relationship?: TRel;
}
export interface DrivingEventGraph<TTask extends ScheduleTaskLike, TRel extends ScheduleRelationshipLike> {
    nodeOrder: string[];
    nodeIndex: Map<string, number>;
    incoming: Map<string, DrivingEventEdge<TRel>[]>;
    outgoing: Map<string, DrivingEventEdge<TRel>[]>;
    rootStartNodeIds: string[];
    terminalFinishNodeIds: string[];
    validTaskIds: Set<string>;
    tasksById: ReadonlyMap<string, TTask>;
}
export interface LongestPathCalculation<TRel extends ScheduleRelationshipLike> {
    distances: Map<string, number>;
    bestIncoming: Map<string, DrivingEventEdge<TRel>[]>;
}
export interface DrivingPathLimits {
    maxPaths: number;
    maxExpansions: number;
}
export interface ExpandedDrivingPath<TRel extends ScheduleRelationshipLike> {
    taskIds: string[];
    relationships: TRel[];
    spanDays: number;
    sinkNodeId: string;
}
export interface ExpandedDrivingPathResult<TRel extends ScheduleRelationshipLike> {
    paths: ExpandedDrivingPath<TRel>[];
    truncated: boolean;
    truncatedByPathLimit: boolean;
    truncatedByExpansionLimit: boolean;
    expansionCount: number;
}
export declare function getTaskEventNodeId(taskId: string, eventKind: ScheduleEventKind): string;
export declare function getTaskIdFromEventNodeId(nodeId: string): string;
export declare function buildDrivingEventGraph<TTask extends ScheduleTaskLike, TRel extends ScheduleRelationshipLike>(tasksById: ReadonlyMap<string, TTask>, taskOrder: readonly string[], relationships: readonly TRel[]): DrivingEventGraph<TTask, TRel>;
export declare function calculateLongestDrivingPaths<TRel extends ScheduleRelationshipLike>(graph: DrivingEventGraph<ScheduleTaskLike, TRel>, sourceNodeIds: readonly string[], toleranceDays: number): LongestPathCalculation<TRel>;
export declare function selectBestSinkNodeIds(distances: ReadonlyMap<string, number>, sinkNodeIds: readonly string[], toleranceDays: number): string[];
export declare function expandBestDrivingPaths<TRel extends ScheduleRelationshipLike>(graph: DrivingEventGraph<ScheduleTaskLike, TRel>, bestIncoming: ReadonlyMap<string, DrivingEventEdge<TRel>[]>, distances: ReadonlyMap<string, number>, sinkNodeIds: readonly string[], limits: DrivingPathLimits): ExpandedDrivingPathResult<TRel>;
export declare function getTiedLatestFinishTaskIds<TTask extends ScheduleTaskLike>(tasksById: ReadonlyMap<string, TTask>, taskIds: Iterable<string>, toleranceDays: number): string[];
