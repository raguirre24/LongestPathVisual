import { describe, expect, it } from "vitest";

import {
    getCriticalStatusMarkerDescriptor,
    getCriticalTaskStatus,
    getSemanticTaskFillColorForStyle,
    normalizeCriticalBarStyle,
    shouldUseCriticalOutline
} from "../../src/utils/CriticalBarStyle";

describe("CriticalBarStyle", () => {
    it("defaults unknown persisted values to status stripe", () => {
        expect(normalizeCriticalBarStyle(undefined)).toBe("statusStripe");
        expect(normalizeCriticalBarStyle("statusStripe")).toBe("statusStripe");
        expect(normalizeCriticalBarStyle("fullFill")).toBe("fullFill");
        expect(normalizeCriticalBarStyle("outline")).toBe("outline");
    });

    it("prioritises critical status over near-critical status", () => {
        expect(getCriticalTaskStatus({ isCritical: true, isNearCritical: true })).toBe("critical");
        expect(getCriticalTaskStatus({ isCritical: false, isNearCritical: true })).toBe("nearCritical");
        expect(getCriticalTaskStatus({ isCritical: false, isNearCritical: false })).toBeNull();
    });

    it("keeps status stripe fill independent from criticality and legend categories", () => {
        expect(getSemanticTaskFillColorForStyle(
            { isCritical: true, legendColor: "#336699" },
            "statusStripe",
            true,
            "#0078D4",
            "#E81123",
            "#F7941F"
        )).toBe("#336699");

        expect(getSemanticTaskFillColorForStyle(
            { isCritical: true },
            "statusStripe",
            false,
            "#0078D4",
            "#E81123",
            "#F7941F"
        )).toBe("#0078D4");
    });

    it("supports full fill and legacy outline fill semantics", () => {
        expect(getSemanticTaskFillColorForStyle(
            { isCritical: true, legendColor: "#336699" },
            "fullFill",
            true,
            "#0078D4",
            "#E81123",
            "#F7941F"
        )).toBe("#E81123");

        expect(getSemanticTaskFillColorForStyle(
            { isNearCritical: true, legendColor: "#336699" },
            "outline",
            true,
            "#0078D4",
            "#E81123",
            "#F7941F"
        )).toBe("#336699");

        expect(getSemanticTaskFillColorForStyle(
            { isNearCritical: true },
            "outline",
            false,
            "#0078D4",
            "#E81123",
            "#F7941F"
        )).toBe("#F7941F");
        expect(shouldUseCriticalOutline("outline", { isCritical: true })).toBe(true);
        expect(shouldUseCriticalOutline("statusStripe", { isCritical: true })).toBe(false);
    });

    it("describes solid critical and near-critical markers", () => {
        const criticalMarker = getCriticalStatusMarkerDescriptor({
            task: { isCritical: true },
            style: "statusStripe",
            criticalColor: "#E81123",
            nearCriticalColor: "#F7941F",
            criticalThickness: 2.5,
            nearCriticalThickness: 2,
            isMilestone: false
        });
        const nearCriticalMarker = getCriticalStatusMarkerDescriptor({
            task: { isNearCritical: true },
            style: "statusStripe",
            criticalColor: "#E81123",
            nearCriticalColor: "#F7941F",
            criticalThickness: 2.5,
            nearCriticalThickness: 2,
            isMilestone: true
        });

        expect(criticalMarker).toMatchObject({
            status: "critical",
            color: "#E81123",
            dashed: false,
            target: "stripe"
        });
        expect(nearCriticalMarker).toMatchObject({
            status: "nearCritical",
            color: "#F7941F",
            dashed: false,
            target: "ring"
        });
        expect(nearCriticalMarker?.dashPattern.length).toBe(0);
    });
});
