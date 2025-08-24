interface WorkerTask {
    internalId: string;
    duration: number;
    predecessorIds: string[];
    relationshipTypes: {
        [predId: string]: string;
    };
    relationshipLags: {
        [predId: string]: number | null;
    };
}
interface WorkerRelationship {
    predecessorId: string;
    successorId: string;
    type: string;
    freeFloat: number | null;
    lag: number | null;
    isCritical?: boolean;
}
interface WorkerInput {
    tasks: WorkerTask[];
    relationships: WorkerRelationship[];
    floatTolerance: number;
    floatThreshold: number;
}
declare class PriorityQueue<T> {
    private compare;
    private heap;
    constructor(compare?: (a: number, b: number) => boolean);
    enqueue(item: T, priority: number): void;
    dequeue(): T | undefined;
    size(): number;
    private bubbleUp;
    private bubbleDown;
}
declare function performCPMCalculation(tasks: WorkerTask[], relationships: WorkerRelationship[], floatTolerance: number, floatThreshold: number): {
    tasks: any[];
    relationships: {
        isCritical: boolean;
        predecessorId: string;
        successorId: string;
        type: string;
        freeFloat: number | null;
        lag: number | null;
    }[];
};
