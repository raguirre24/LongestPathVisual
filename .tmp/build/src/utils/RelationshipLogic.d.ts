export type RelationshipType = "FS" | "SS" | "FF" | "SF";
export interface RelationshipDrivingLike {
    relationshipFloat?: number | null;
    isDriving?: boolean;
}
export declare function normalizeRelationshipType(value: string | null | undefined): RelationshipType;
export declare function markMinimumFloatDrivingRelationships<TRel extends RelationshipDrivingLike>(relationships: Iterable<TRel>, tolerance: number): number;
