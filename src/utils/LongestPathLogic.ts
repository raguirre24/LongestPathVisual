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
export function calculateLongestPathMembership<
    TTask extends LongestPathTaskLike,
    TRelationship extends LongestPathRelationshipLike
>(
    tasks: Iterable<TTask>,
    relationships: Iterable<TRelationship>
): LongestPathMembership<TRelationship> {
    const taskList = Array.from(tasks);
    const realTasks = taskList.filter(task => {
        const finishTime = task.finishDate?.getTime();
        return task.type !== "Synthetic" && typeof finishTime === "number" && Number.isFinite(finishTime);
    });

    if (realTasks.length === 0) {
        return {
            finishTaskIds: [],
            taskIds: new Set<string>(),
            relationships: new Set<TRelationship>()
        };
    }

    const latestFinish = Math.max(...realTasks.map(task => task.finishDate!.getTime()));
    const finishTaskIds = realTasks
        .filter(task => task.finishDate!.getTime() === latestFinish)
        .map(task => task.internalId)
        .sort((left, right) => left.localeCompare(right));

    const validTaskIds = new Set(taskList.map(task => task.internalId));
    const incoming = new Map<string, TRelationship[]>();
    for (const relationship of relationships) {
        if (relationship.isDriving !== true ||
            !validTaskIds.has(relationship.predecessorId) ||
            !validTaskIds.has(relationship.successorId)) {
            continue;
        }

        const successorRelationships = incoming.get(relationship.successorId) ?? [];
        successorRelationships.push(relationship);
        incoming.set(relationship.successorId, successorRelationships);
    }

    return collectDrivingMembership(
        finishTaskIds,
        "backward",
        validTaskIds,
        incoming,
        new Map<string, TRelationship[]>()
    );
}

/**
 * Collects the complete driving closure for selected-task backward or forward
 * tracing. Every tied driving branch is retained.
 */
export function collectDrivingTraceMembership<
    TTask extends LongestPathTaskLike,
    TRelationship extends LongestPathRelationshipLike
>(
    startTaskId: string,
    direction: DrivingTraceDirection,
    tasks: Iterable<TTask>,
    relationships: Iterable<TRelationship>
): DrivingTraceMembership<TRelationship> {
    const validTaskIds = new Set(Array.from(tasks, task => task.internalId));
    if (!validTaskIds.has(startTaskId)) {
        return {
            taskIds: new Set<string>(),
            relationships: new Set<TRelationship>()
        };
    }

    const incoming = new Map<string, TRelationship[]>();
    const outgoing = new Map<string, TRelationship[]>();
    for (const relationship of relationships) {
        if (relationship.isDriving !== true ||
            !validTaskIds.has(relationship.predecessorId) ||
            !validTaskIds.has(relationship.successorId)) {
            continue;
        }

        const successorRelationships = incoming.get(relationship.successorId) ?? [];
        successorRelationships.push(relationship);
        incoming.set(relationship.successorId, successorRelationships);

        const predecessorRelationships = outgoing.get(relationship.predecessorId) ?? [];
        predecessorRelationships.push(relationship);
        outgoing.set(relationship.predecessorId, predecessorRelationships);
    }

    const result = collectDrivingMembership(
        [startTaskId],
        direction,
        validTaskIds,
        incoming,
        outgoing
    );
    return {
        taskIds: result.taskIds,
        relationships: result.relationships
    };
}

function collectDrivingMembership<TRelationship extends LongestPathRelationshipLike>(
    startTaskIds: string[],
    direction: DrivingTraceDirection,
    validTaskIds: Set<string>,
    incoming: Map<string, TRelationship[]>,
    outgoing: Map<string, TRelationship[]>
): LongestPathMembership<TRelationship> {
    const taskIds = new Set<string>();
    const collectedRelationships = new Set<TRelationship>();
    const stack = [...startTaskIds];

    while (stack.length > 0) {
        const currentTaskId = stack.pop()!;
        if (!validTaskIds.has(currentTaskId) || taskIds.has(currentTaskId)) {
            continue;
        }

        taskIds.add(currentTaskId);
        const nextRelationships = direction === "backward"
            ? incoming.get(currentTaskId) ?? []
            : outgoing.get(currentTaskId) ?? [];

        for (const relationship of nextRelationships) {
            collectedRelationships.add(relationship);
            stack.push(direction === "backward"
                ? relationship.predecessorId
                : relationship.successorId);
        }
    }

    return {
        finishTaskIds: [...startTaskIds],
        taskIds,
        relationships: collectedRelationships
    };
}
