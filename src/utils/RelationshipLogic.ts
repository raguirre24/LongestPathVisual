export type RelationshipType = "FS" | "SS" | "FF" | "SF";

export const RELATIONSHIP_FLOAT_TOLERANCE = 1e-9;

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

export function tryNormalizeRelationshipType(value: string | null | undefined): RelationshipType | null {
    const rawValue = (value ?? "").trim().toUpperCase();
    if (!rawValue) {
        return null;
    }

    const normalizedValue = rawValue.startsWith("PR_")
        ? rawValue.slice(3)
        : rawValue;

    switch (normalizedValue) {
        case "FS":
        case "FINISH TO START":
        case "FINISH-TO-START":
            return "FS";
        case "SS":
        case "START TO START":
        case "START-TO-START":
            return "SS";
        case "FF":
        case "FINISH TO FINISH":
        case "FINISH-TO-FINISH":
            return "FF";
        case "SF":
        case "START TO FINISH":
        case "START-TO-FINISH":
            return "SF";
        default:
            return null;
    }
}

/**
 * Permissive normalisation retained for rendering and Visualiser mode. Strict
 * Longest Path validation uses tryNormalizeRelationshipType before this fallback.
 */
export function normalizeRelationshipType(value: string | null | undefined): RelationshipType {
    return tryNormalizeRelationshipType(value) ?? "FS";
}

export function getRelationshipIdentityKey(relationship: RelationshipIdentityLike): string {
    return [
        encodeRelationshipKeyPart(relationship.predecessorId),
        encodeRelationshipKeyPart(relationship.successorId),
        normalizeRelationshipType(relationship.type),
        getRelationshipNumberKey(relationship.lag),
        getRelationshipNumberKey(relationship.freeFloat ?? relationship.relationshipFloat)
    ].join("|");
}

export function markMinimumFloatDrivingRelationships<TRel extends RelationshipDrivingLike>(
    relationships: Iterable<TRel>,
    tolerance: number
): number {
    const relationshipList = Array.from(relationships);
    const finiteTolerance = Number.isFinite(tolerance) ? Math.max(0, tolerance) : 0;
    let minimumFloat = Infinity;

    for (const relationship of relationshipList) {
        const relationshipFloat = relationship.relationshipFloat;
        if (typeof relationshipFloat === "number" && Number.isFinite(relationshipFloat) && relationshipFloat < minimumFloat) {
            minimumFloat = relationshipFloat;
        }
    }

    let drivingCount = 0;
    for (const relationship of relationshipList) {
        const relationshipFloat = relationship.relationshipFloat;
        const hasFiniteFloat = typeof relationshipFloat === "number" &&
            Number.isFinite(relationshipFloat);
        const isDriving = hasFiniteFloat && Number.isFinite(minimumFloat)
            ? Math.abs(relationshipFloat - minimumFloat) <= finiteTolerance
            : null;

        relationship.isDriving = isDriving;
        relationship.hasNegativeFloat = hasFiniteFloat
            ? relationshipFloat < -finiteTolerance
            : null;
        if (isDriving) {
            drivingCount++;
        }
    }

    return drivingCount;
}

function encodeRelationshipKeyPart(value: string): string {
    return encodeURIComponent(value);
}

function getRelationshipNumberKey(value: number | null | undefined): string {
    return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}
