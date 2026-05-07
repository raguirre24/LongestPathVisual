import { describe, expect, it } from "vitest";

import {
    getRelationshipIdentityKey,
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

    it("keeps duplicate predecessor-successor visual keys distinct by type, lag, and float", () => {
        const relationships = [
            { predecessorId: "P|1", successorId: "S-1", type: "PR_FS", lag: 0, freeFloat: 0 },
            { predecessorId: "P|1", successorId: "S-1", type: "PR_FF", lag: 0, freeFloat: 0 },
            { predecessorId: "P|1", successorId: "S-1", type: "PR_FS", lag: 1, freeFloat: 0 },
            { predecessorId: "P|1", successorId: "S-1", type: "PR_FS", lag: 0, freeFloat: 4 }
        ];

        const keys = relationships.map(getRelationshipIdentityKey);

        expect(new Set(keys).size).toBe(relationships.length);
        expect(keys[0]).toContain("FS|0|0");
        expect(keys[1]).toContain("FF|0|0");
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
