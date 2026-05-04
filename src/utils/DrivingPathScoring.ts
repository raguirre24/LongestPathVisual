import { normalizeRelationshipType, type RelationshipType } from "./RelationshipLogic";

const DAY_IN_MS = 86400000;

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

export interface DrivingEventGraph<
    TTask extends ScheduleTaskLike,
    TRel extends ScheduleRelationshipLike
> {
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

export function getTaskEventNodeId(taskId: string, eventKind: ScheduleEventKind): string {
    return `${taskId}::${eventKind}`;
}

export function getTaskIdFromEventNodeId(nodeId: string): string {
    const separatorIndex = nodeId.lastIndexOf("::");
    return separatorIndex >= 0 ? nodeId.slice(0, separatorIndex) : nodeId;
}

export function buildDrivingEventGraph<
    TTask extends ScheduleTaskLike,
    TRel extends ScheduleRelationshipLike
>(
    tasksById: ReadonlyMap<string, TTask>,
    taskOrder: readonly string[],
    relationships: readonly TRel[]
): DrivingEventGraph<TTask, TRel> {
    const validTaskIds = new Set<string>();
    const nodeOrder: string[] = [];
    const nodeIndex = new Map<string, number>();
    const incoming = new Map<string, DrivingEventEdge<TRel>[]>();
    const outgoing = new Map<string, DrivingEventEdge<TRel>[]>();

    const ensureNode = (nodeId: string): void => {
        if (incoming.has(nodeId)) {
            return;
        }
        nodeIndex.set(nodeId, nodeOrder.length);
        nodeOrder.push(nodeId);
        incoming.set(nodeId, []);
        outgoing.set(nodeId, []);
    };

    const addEdge = (edge: DrivingEventEdge<TRel>): void => {
        incoming.get(edge.toNodeId)?.push(edge);
        outgoing.get(edge.fromNodeId)?.push(edge);
    };

    for (const taskId of taskOrder) {
        const task = tasksById.get(taskId);
        if (!hasValidTaskSchedule(task)) {
            continue;
        }

        validTaskIds.add(taskId);
        ensureNode(getTaskEventNodeId(taskId, "start"));
        ensureNode(getTaskEventNodeId(taskId, "finish"));
    }

    for (const taskId of taskOrder) {
        if (!validTaskIds.has(taskId)) {
            continue;
        }

        const task = tasksById.get(taskId)!;
        const startTime = getTaskEventTime(task, "start");
        const finishTime = getTaskEventTime(task, "finish");
        if (startTime === null || finishTime === null) {
            continue;
        }

        addEdge({
            id: `${taskId}|task`,
            kind: "task",
            taskId,
            fromNodeId: getTaskEventNodeId(taskId, "start"),
            toNodeId: getTaskEventNodeId(taskId, "finish"),
            weightDays: (finishTime - startTime) / DAY_IN_MS
        });
    }

    for (const relationship of relationships) {
        if (!validTaskIds.has(relationship.predecessorId) || !validTaskIds.has(relationship.successorId)) {
            continue;
        }

        const predecessor = tasksById.get(relationship.predecessorId);
        const successor = tasksById.get(relationship.successorId);
        if (!predecessor || !successor) {
            continue;
        }

        const relationshipType = normalizeRelationshipType(relationship.type);
        const fromEvent = relationshipType === "FS" || relationshipType === "FF" ? "finish" : "start";
        const toEvent = relationshipType === "FS" || relationshipType === "SS" ? "start" : "finish";
        const fromTime = getTaskEventTime(predecessor, fromEvent);
        const toTime = getTaskEventTime(successor, toEvent);

        if (fromTime === null || toTime === null) {
            continue;
        }

        addEdge({
            id: createRelationshipEdgeId(relationship, relationshipType),
            kind: "relationship",
            taskId: relationship.successorId,
            fromNodeId: getTaskEventNodeId(relationship.predecessorId, fromEvent),
            toNodeId: getTaskEventNodeId(relationship.successorId, toEvent),
            weightDays: (toTime - fromTime) / DAY_IN_MS,
            relationship
        });
    }

    const rootStartNodeIds = taskOrder
        .filter(taskId => validTaskIds.has(taskId))
        .map(taskId => getTaskEventNodeId(taskId, "start"))
        .filter(nodeId => (incoming.get(nodeId)?.length ?? 0) === 0);

    const terminalFinishNodeIds = taskOrder
        .filter(taskId => validTaskIds.has(taskId))
        .map(taskId => getTaskEventNodeId(taskId, "finish"))
        .filter(nodeId => (outgoing.get(nodeId)?.length ?? 0) === 0);

    return {
        nodeOrder,
        nodeIndex,
        incoming,
        outgoing,
        rootStartNodeIds,
        terminalFinishNodeIds,
        validTaskIds,
        tasksById
    };
}

export function calculateLongestDrivingPaths<TRel extends ScheduleRelationshipLike>(
    graph: DrivingEventGraph<ScheduleTaskLike, TRel>,
    sourceNodeIds: readonly string[],
    toleranceDays: number
): LongestPathCalculation<TRel> {
    const distances = new Map<string, number>();
    const bestIncoming = new Map<string, DrivingEventEdge<TRel>[]>();
    const sourceSet = new Set(sourceNodeIds);

    for (const sourceNodeId of sourceNodeIds) {
        if (graph.nodeIndex.has(sourceNodeId)) {
            distances.set(sourceNodeId, 0);
        }
    }

    for (const nodeId of graph.nodeOrder) {
        if (sourceSet.has(nodeId) && !bestIncoming.has(nodeId)) {
            bestIncoming.set(nodeId, []);
        }

        const currentDistance = distances.get(nodeId);
        if (currentDistance === undefined) {
            continue;
        }

        const nextEdges = graph.outgoing.get(nodeId) ?? [];
        for (const edge of nextEdges) {
            const candidateDistance = currentDistance + edge.weightDays;
            const existingDistance = distances.get(edge.toNodeId);

            if (
                existingDistance === undefined ||
                candidateDistance > existingDistance + toleranceDays
            ) {
                distances.set(edge.toNodeId, candidateDistance);
                bestIncoming.set(edge.toNodeId, [edge]);
            } else if (Math.abs(candidateDistance - existingDistance) <= toleranceDays) {
                const tiedEdges = bestIncoming.get(edge.toNodeId) ?? [];
                tiedEdges.push(edge);
                bestIncoming.set(edge.toNodeId, tiedEdges);
            }
        }
    }

    return { distances, bestIncoming };
}

export function selectBestSinkNodeIds(
    distances: ReadonlyMap<string, number>,
    sinkNodeIds: readonly string[],
    toleranceDays: number
): string[] {
    let bestDistance = -Infinity;
    const bestSinkNodeIds: string[] = [];

    for (const sinkNodeId of sinkNodeIds) {
        const distance = distances.get(sinkNodeId);
        if (distance === undefined) {
            continue;
        }

        if (distance > bestDistance + toleranceDays) {
            bestDistance = distance;
            bestSinkNodeIds.length = 0;
            bestSinkNodeIds.push(sinkNodeId);
        } else if (Math.abs(distance - bestDistance) <= toleranceDays) {
            bestSinkNodeIds.push(sinkNodeId);
        }
    }

    return bestSinkNodeIds;
}

export function expandBestDrivingPaths<TRel extends ScheduleRelationshipLike>(
    graph: DrivingEventGraph<ScheduleTaskLike, TRel>,
    bestIncoming: ReadonlyMap<string, DrivingEventEdge<TRel>[]>,
    distances: ReadonlyMap<string, number>,
    sinkNodeIds: readonly string[],
    limits: DrivingPathLimits
): ExpandedDrivingPathResult<TRel> {
    const maxPaths = Math.max(1, limits.maxPaths);
    const maxExpansions = Math.max(1, limits.maxExpansions);
    const paths: ExpandedDrivingPath<TRel>[] = [];
    const signatures = new Set<string>();
    let truncated = false;
    let truncatedByPathLimit = false;
    let truncatedByExpansionLimit = false;
    let expansionCount = 0;

    const appendPath = (
        sinkNodeId: string,
        reversedNodeIds: string[],
        reversedRelationships: TRel[]
    ): void => {
        const orderedNodeIds = [...reversedNodeIds].reverse();
        const orderedTaskIds: string[] = [];

        for (const nodeId of orderedNodeIds) {
            const taskId = getTaskIdFromEventNodeId(nodeId);
            if (orderedTaskIds[orderedTaskIds.length - 1] !== taskId) {
                orderedTaskIds.push(taskId);
            }
        }

        const orderedRelationships = [...reversedRelationships].reverse();
        const signature = `${orderedTaskIds.join(">")}::${orderedRelationships
            .map(rel => createRelationshipEdgeId(rel, normalizeRelationshipType(rel.type)))
            .join(">")}`;

        if (signatures.has(signature)) {
            return;
        }

        signatures.add(signature);
        paths.push({
            taskIds: orderedTaskIds,
            relationships: orderedRelationships,
            spanDays: distances.get(sinkNodeId) ?? 0,
            sinkNodeId
        });
    };

    const visit = (
        nodeId: string,
        sinkNodeId: string,
        reversedNodeIds: string[],
        reversedRelationships: TRel[]
    ): void => {
        if (paths.length >= maxPaths) {
            truncated = true;
            truncatedByPathLimit = true;
            return;
        }

        expansionCount++;
        if (expansionCount > maxExpansions) {
            truncated = true;
            truncatedByExpansionLimit = true;
            return;
        }

        reversedNodeIds.push(nodeId);
        const incomingEdges = [...(bestIncoming.get(nodeId) ?? [])].sort((a, b) =>
            compareIncomingEdges(graph.nodeIndex, a, b)
        );

        if (incomingEdges.length === 0) {
            appendPath(sinkNodeId, reversedNodeIds, reversedRelationships);
        } else {
            for (const edge of incomingEdges) {
                if (paths.length >= maxPaths) {
                    truncated = true;
                    truncatedByPathLimit = true;
                    break;
                }
                if (expansionCount >= maxExpansions) {
                    truncated = true;
                    truncatedByExpansionLimit = true;
                    break;
                }

                if (edge.kind === "relationship" && edge.relationship) {
                    reversedRelationships.push(edge.relationship);
                }

                visit(edge.fromNodeId, sinkNodeId, reversedNodeIds, reversedRelationships);

                if (edge.kind === "relationship" && edge.relationship) {
                    reversedRelationships.pop();
                }
            }
        }

        reversedNodeIds.pop();
    };

    const orderedSinkNodeIds = [...sinkNodeIds].sort((a, b) => {
        const aIndex = graph.nodeIndex.get(a) ?? Number.MAX_SAFE_INTEGER;
        const bIndex = graph.nodeIndex.get(b) ?? Number.MAX_SAFE_INTEGER;
        if (aIndex !== bIndex) {
            return aIndex - bIndex;
        }
        return a.localeCompare(b);
    });

    for (const sinkNodeId of orderedSinkNodeIds) {
        if (paths.length >= maxPaths || expansionCount >= maxExpansions) {
            truncated = true;
            truncatedByPathLimit = paths.length >= maxPaths;
            truncatedByExpansionLimit = expansionCount >= maxExpansions;
            break;
        }

        visit(sinkNodeId, sinkNodeId, [], []);
    }

    return {
        paths,
        truncated,
        truncatedByPathLimit,
        truncatedByExpansionLimit,
        expansionCount
    };
}

export function getTiedLatestFinishTaskIds<TTask extends ScheduleTaskLike>(
    tasksById: ReadonlyMap<string, TTask>,
    taskIds: Iterable<string>,
    toleranceDays: number
): string[] {
    let latestFinishTime = -Infinity;
    const tiedTaskIds: string[] = [];

    for (const taskId of taskIds) {
        const task = tasksById.get(taskId);
        const finishTime = getTaskEventTime(task, "finish");
        if (finishTime === null) {
            continue;
        }

        if (finishTime > latestFinishTime + toleranceDays * DAY_IN_MS) {
            latestFinishTime = finishTime;
            tiedTaskIds.length = 0;
            tiedTaskIds.push(taskId);
        } else if (Math.abs(finishTime - latestFinishTime) <= toleranceDays * DAY_IN_MS) {
            tiedTaskIds.push(taskId);
        }
    }

    return tiedTaskIds.sort((aId, bId) => compareTaskSchedules(tasksById.get(aId), tasksById.get(bId), aId, bId));
}

function hasValidTaskSchedule(task: ScheduleTaskLike | undefined): boolean {
    const startTime = getTaskEventTime(task, "start");
    const finishTime = getTaskEventTime(task, "finish");
    return startTime !== null && finishTime !== null && finishTime >= startTime;
}

function getTaskEventTime(
    task: ScheduleTaskLike | undefined,
    eventKind: ScheduleEventKind
): number | null {
    const date = eventKind === "start" ? task?.startDate : task?.finishDate;
    if (!(date instanceof Date)) {
        return null;
    }

    const time = date.getTime();
    return Number.isFinite(time) ? time : null;
}

function createRelationshipEdgeId(
    relationship: ScheduleRelationshipLike,
    relationshipType: RelationshipType
): string {
    return `${relationship.predecessorId}|${relationship.successorId}|${relationshipType}|${relationship.lag ?? ""}`;
}

function compareIncomingEdges<TRel extends ScheduleRelationshipLike>(
    nodeIndex: ReadonlyMap<string, number>,
    a: DrivingEventEdge<TRel>,
    b: DrivingEventEdge<TRel>
): number {
    const indexDelta = (nodeIndex.get(a.fromNodeId) ?? Number.MAX_SAFE_INTEGER)
        - (nodeIndex.get(b.fromNodeId) ?? Number.MAX_SAFE_INTEGER);
    if (indexDelta !== 0) {
        return indexDelta;
    }

    if (a.kind !== b.kind) {
        return a.kind.localeCompare(b.kind);
    }

    return a.id.localeCompare(b.id);
}

function compareTaskSchedules<TTask extends ScheduleTaskLike>(
    aTask: TTask | undefined,
    bTask: TTask | undefined,
    aId: string,
    bId: string
): number {
    const aStart = getTaskEventTime(aTask, "start") ?? Number.MAX_SAFE_INTEGER;
    const bStart = getTaskEventTime(bTask, "start") ?? Number.MAX_SAFE_INTEGER;
    if (aStart !== bStart) {
        return aStart - bStart;
    }

    const aFinish = getTaskEventTime(aTask, "finish") ?? Number.MAX_SAFE_INTEGER;
    const bFinish = getTaskEventTime(bTask, "finish") ?? Number.MAX_SAFE_INTEGER;
    if (aFinish !== bFinish) {
        return aFinish - bFinish;
    }

    return aId.localeCompare(bId);
}
