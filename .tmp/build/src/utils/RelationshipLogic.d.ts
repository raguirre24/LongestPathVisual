export type RelationshipType = "FS" | "SS" | "FF" | "SF";
export interface RelationshipDrivingLike {
    relationshipFloat?: number | null;
    isDriving?: boolean;
}
export interface RelationshipIdentityLike {
    predecessorId: string;
    successorId: string;
    type?: string | null;
    lag?: number | null;
    freeFloat?: number | null;
    relationshipFloat?: number | null;
}
export declare function normalizeRelationshipType(value: string | null | undefined): RelationshipType;
export declare function getRelationshipIdentityKey(relationship: RelationshipIdentityLike): string;
export declare function markMinimumFloatDrivingRelationships<TRel extends RelationshipDrivingLike>(relationships: Iterable<TRel>, tolerance: number): number;
