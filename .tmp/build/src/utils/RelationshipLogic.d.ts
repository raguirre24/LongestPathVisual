export type RelationshipType = "FS" | "SS" | "FF" | "SF";
export declare const RELATIONSHIP_FLOAT_TOLERANCE = 1e-9;
export interface RelationshipDrivingLike {
    relationshipFloat?: number | null;
    isDriving?: boolean | null;
    hasNegativeFloat?: boolean | null;
}
export interface RelationshipIdentityLike {
    predecessorId: string;
    successorId: string;
    type?: string | null;
    lag?: number | null;
    freeFloat?: number | null;
    relationshipFloat?: number | null;
}
export declare function tryNormalizeRelationshipType(value: string | null | undefined): RelationshipType | null;
/**
 * Permissive normalisation retained for rendering and Visualiser mode. Strict
 * Longest Path validation uses tryNormalizeRelationshipType before this fallback.
 */
export declare function normalizeRelationshipType(value: string | null | undefined): RelationshipType;
export declare function getRelationshipIdentityKey(relationship: RelationshipIdentityLike): string;
export declare function markMinimumFloatDrivingRelationships<TRel extends RelationshipDrivingLike>(relationships: Iterable<TRel>, tolerance: number): number;
