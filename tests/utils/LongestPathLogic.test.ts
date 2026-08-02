import { describe, expect, it } from "vitest";

import {
    calculateLongestPathMembership,
    collectDrivingTraceMembership
} from "../../src/utils/LongestPathLogic";

const task = (internalId: string, finish: string) => ({
    internalId,
    finishDate: new Date(finish),
    type: "Task"
});

const relationship = (
    predecessorId: string,
    successorId: string,
    isDriving: boolean,
    hasNegativeFloat = false
) => ({
    predecessorId,
    successorId,
    isDriving,
    hasNegativeFloat
});

describe("LongestPathLogic", () => {
    it("selects every latest finish and unions all driving ancestry", () => {
        const tasks = [
            task("A", "2025-01-05"),
            task("B", "2025-01-06"),
            task("C", "2025-01-10"),
            task("D", "2025-01-10"),
            task("RISK", "2025-01-04")
        ];
        const aToC = relationship("A", "C", true);
        const bToC = relationship("B", "C", true);
        const negativeNonDriving = relationship("RISK", "C", false, true);

        const result = calculateLongestPathMembership(
            tasks,
            [aToC, bToC, negativeNonDriving]
        );

        expect(result.finishTaskIds).toEqual(["C", "D"]);
        expect([...result.taskIds].sort()).toEqual(["A", "B", "C", "D"]);
        expect(result.relationships).toEqual(new Set([aToC, bToC]));
        expect(result.taskIds.has("RISK")).toBe(false);
        expect(result.relationships.has(negativeNonDriving)).toBe(false);
    });

    it("uses latest Finish Date rather than task-terminal degree", () => {
        const tasks = [
            task("LATEST_WITH_SUCCESSOR", "2025-01-10"),
            task("EARLIER_SUCCESSOR", "2025-01-05")
        ];
        const ssOrSfLikeLink = relationship(
            "LATEST_WITH_SUCCESSOR",
            "EARLIER_SUCCESSOR",
            true
        );

        const result = calculateLongestPathMembership(tasks, [ssOrSfLikeLink]);

        expect(result.finishTaskIds).toEqual(["LATEST_WITH_SUCCESSOR"]);
        expect([...result.taskIds]).toEqual(["LATEST_WITH_SUCCESSOR"]);
        expect(result.relationships.size).toBe(0);
    });

    it("follows every tied driving branch in backward and forward traces", () => {
        const tasks = [
            task("P1", "2025-01-01"),
            task("P2", "2025-01-01"),
            task("M", "2025-01-02"),
            task("S1", "2025-01-03"),
            task("S2", "2025-01-03")
        ];
        const p1ToM = relationship("P1", "M", true);
        const p2ToM = relationship("P2", "M", true);
        const mToS1 = relationship("M", "S1", true);
        const mToS2 = relationship("M", "S2", true);
        const relationships = [p1ToM, p2ToM, mToS1, mToS2];

        const backward = collectDrivingTraceMembership("M", "backward", tasks, relationships);
        const forward = collectDrivingTraceMembership("M", "forward", tasks, relationships);

        expect([...backward.taskIds].sort()).toEqual(["M", "P1", "P2"]);
        expect(backward.relationships).toEqual(new Set([p1ToM, p2ToM]));
        expect([...forward.taskIds].sort()).toEqual(["M", "S1", "S2"]);
        expect(forward.relationships).toEqual(new Set([mToS1, mToS2]));
        expect(relationships.map(item => item.isDriving)).toEqual([true, true, true, true]);
    });

    it("does not traverse a negative relationship unless it is driving", () => {
        const tasks = [
            task("A", "2025-01-01"),
            task("B", "2025-01-02"),
            task("RISK", "2025-01-01")
        ];
        const driving = relationship("A", "B", true);
        const negativeNonDriving = relationship("RISK", "B", false, true);

        const backward = collectDrivingTraceMembership(
            "B",
            "backward",
            tasks,
            [driving, negativeNonDriving]
        );

        expect([...backward.taskIds].sort()).toEqual(["A", "B"]);
        expect(backward.relationships).toEqual(new Set([driving]));
    });
});
