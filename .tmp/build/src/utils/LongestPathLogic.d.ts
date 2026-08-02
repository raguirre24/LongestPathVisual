export type DrivingTraceDirection = "backward" | "forward";
export interface LongestPathTaskLike {
    internalId: string;
    finishDate?: Date | null;
    type?: string | null;
}
export interface LongestPathRelationshipLike {
    predecessorId: string;
    successorId: string;
    isDriving?: boolean | null;
}
export interface LongestPathMembership<TRelationship extends LongestPathRelationshipLike> {
    finishTaskIds: string[];
    taskIds: Set<string>;
    relationships: Set<TRelationship>;
}
export interface DrivingTraceMembership<TRelationship extends LongestPathRelationshipLike> {
    taskIds: Set<string>;
    relationships: Set<TRelationship>;
}
/**
 * Finds every latest-finish activity and traces all driving relationships back
 * to its driving roots. This deliberately does not use task-level terminal
 * degree, which is not reliable for SS and SF relationships.
 */
export declare function calculateLongestPathMembership<TTask extends LongestPathTaskLike, TRelationship extends LongestPathRelationshipLike>(tasks: Iterable<TTask>, relationships: Iterable<TRelationship>): LongestPathMembership<TRelationship>;
/**
 * Collects the complete driving closure for selected-task backward or forward
 * tracing. Every tied driving branch is retained.
 */
export declare function collectDrivingTraceMembership<TTask extends LongestPathTaskLike, TRelationship extends LongestPathRelationshipLike>(startTaskId: string, direction: DrivingTraceDirection, tasks: Iterable<TTask>, relationships: Iterable<TRelationship>): DrivingTraceMembership<TRelationship>;
