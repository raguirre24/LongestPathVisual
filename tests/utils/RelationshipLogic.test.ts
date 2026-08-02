import { describe, expect, it } from "vitest";

import {
    getRelationshipIdentityKey,
    markMinimumFloatDrivingRelationships,
    normalizeRelationshipType,
    tryNormalizeRelationshipType,
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

    it("strictly recognises supported relationship type names without inventing invalid details", () => {
        expect(tryNormalizeRelationshipType("Finish to Start")).toBe("FS");
        expect(tryNormalizeRelationshipType("start-to-start")).toBe("SS");
        expect(tryNormalizeRelationshipType("PR_FF")).toBe("FF");
        expect(tryNormalizeRelationshipType("SF")).toBe("SF");
        expect(tryNormalizeRelationshipType("invalid")).toBeNull();
        expect(tryNormalizeRelationshipType(null)).toBeNull();
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
            null,
            null,
            true,
            null
        ]);
        expect(relationships.map(relationship => relationship.hasNegativeFloat)).toEqual([
            null,
            null,
            false,
            null
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
            null,
            null,
            null
        ]);
        expect(relationships.map(relationship => relationship.hasNegativeFloat)).toEqual([
            null,
            null,
            null
        ]);
    });

    it("marks only the lowest of two negative floats as driving", () => {
        const relationships: RelationshipDrivingLike[] = [
            { relationshipFloat: -8 },
            { relationshipFloat: -3 }
        ];

        expect(markMinimumFloatDrivingRelationships(relationships, 1e-9)).toBe(1);
        expect(relationships.map(relationship => relationship.isDriving)).toEqual([true, false]);
        expect(relationships.map(relationship => relationship.hasNegativeFloat)).toEqual([true, true]);
    });

    it("retains every tied negative minimum as driving", () => {
        const relationships: RelationshipDrivingLike[] = [
            { relationshipFloat: -8 },
            { relationshipFloat: -8 },
            { relationshipFloat: -3 }
        ];

        expect(markMinimumFloatDrivingRelationships(relationships, 1e-9)).toBe(2);
        expect(relationships.map(relationship => relationship.isDriving)).toEqual([true, true, false]);
        expect(relationships.map(relationship => relationship.hasNegativeFloat)).toEqual([true, true, true]);
    });

    it("uses the signed minimum for mixed and positive inputs", () => {
        const mixed: RelationshipDrivingLike[] = [
            { relationshipFloat: -8 },
            { relationshipFloat: 2 }
        ];
        const positive: RelationshipDrivingLike[] = [
            { relationshipFloat: 2 },
            { relationshipFloat: 4 }
        ];

        expect(markMinimumFloatDrivingRelationships(mixed, 1e-9)).toBe(1);
        expect(mixed.map(relationship => relationship.isDriving)).toEqual([true, false]);
        expect(mixed.map(relationship => relationship.hasNegativeFloat)).toEqual([true, false]);

        expect(markMinimumFloatDrivingRelationships(positive, 1e-9)).toBe(1);
        expect(positive.map(relationship => relationship.isDriving)).toEqual([true, false]);
        expect(positive.map(relationship => relationship.hasNegativeFloat)).toEqual([false, false]);
    });

    it("uses the calculation tolerance for driving ties and negative status", () => {
        const relationships: RelationshipDrivingLike[] = [
            { relationshipFloat: 0 },
            { relationshipFloat: 0.5e-9 },
            { relationshipFloat: -0.5e-9 }
        ];

        expect(markMinimumFloatDrivingRelationships(relationships, 1e-9)).toBe(3);
        expect(relationships.map(relationship => relationship.isDriving)).toEqual([true, true, true]);
        expect(relationships.map(relationship => relationship.hasNegativeFloat)).toEqual([false, false, false]);
    });
});
