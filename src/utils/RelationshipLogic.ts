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

export function normalizeRelationshipType(value: string | null | undefined): RelationshipType {
    const rawValue = (value ?? "FS").trim().toUpperCase();
    const normalizedValue = rawValue.startsWith("PR_")
        ? rawValue.slice(3)
        : rawValue;

    switch (normalizedValue) {
        case "SS":
            return "SS";
        case "FF":
            return "FF";
        case "SF":
            return "SF";
        default:
            return "FS";
    }
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
        const isDriving = typeof relationshipFloat === "number" &&
            Number.isFinite(relationshipFloat) &&
            Math.abs(relationshipFloat - minimumFloat) <= finiteTolerance;

        relationship.isDriving = isDriving;
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
