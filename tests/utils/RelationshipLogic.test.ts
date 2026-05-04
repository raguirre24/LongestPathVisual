import { describe, expect, it } from "vitest";

import {
    markMinimumFloatDrivingRelationships,
    normalizeRelationshipType,
    type RelationshipDrivingLike
} from "../../src/utils/RelationshipLogic";

describe("RelationshipLogic", () => {
    it("normalises P6 PR_* relationship type prefixes", () => {
        expect(normalizeRelationshipType("PR_FS")).toBe("FS");
        expect(normalizeRelationshipType("PR_SS")).toBe("SS");
        expect(normalizeRelationshipType("PR_FF")).toBe("FF");
        expect(normalizeRelationshipType("PR_SF")).toBe("SF");
        expect(normalizeRelationshipType("invalid")).toBe("FS");
        expect(normalizeRelationshipType(null)).toBe("FS");
    });

    it("marks minimum finite relationship float as driving, including non-zero minima", () => {
        const relationships: RelationshipDrivingLike[] = [
            { relationshipFloat: 4 },
            { relationshipFloat: 2 },
            { relationshipFloat: 2 },
            { relationshipFloat: 8 }
        ];

        const drivingCount = markMinimumFloatDrivingRelationships(relationships, 1e-9);

        expect(drivingCount).toBe(2);
        expect(relationships.map(relationship => relationship.isDriving)).toEqual([
            false,
            true,
            true,
            false
        ]);
    });

    it("does not mark blank relationship floats as driving when finite floats exist", () => {
        const relationships: RelationshipDrivingLike[] = [
            { relationshipFloat: null },
            { relationshipFloat: undefined },
            { relationshipFloat: 0 },
            { relationshipFloat: Infinity }
        ];

        const drivingCount = markMinimumFloatDrivingRelationships(relationships, 1e-9);

        expect(drivingCount).toBe(1);
        expect(relationships.map(relationship => relationship.isDriving)).toEqual([
            false,
            false,
            true,
            false
        ]);
    });

    it("does not mark all-blank relationship floats as driving", () => {
        const relationships: RelationshipDrivingLike[] = [
            { relationshipFloat: null },
            { relationshipFloat: undefined },
            { relationshipFloat: Infinity }
        ];

        const drivingCount = markMinimumFloatDrivingRelationships(relationships, 1e-9);

        expect(drivingCount).toBe(0);
        expect(relationships.map(relationship => relationship.isDriving)).toEqual([
            false,
            false,
            false
        ]);
    });
});
