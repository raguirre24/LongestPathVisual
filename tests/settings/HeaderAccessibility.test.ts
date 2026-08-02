import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function slice(source: string, startMarker: string, endMarker: string): string {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
}

describe("Header icon accessibility", () => {
    const headerSource = readFileSync("src/components/Header.ts", "utf8");

    it("uses stable accessible names for binary header toggles", () => {
        expect(headerSource).toContain('.attr("aria-label", "Critical path only")');
        expect(headerSource).toContain('.attr("aria-label", "Baseline comparison bars")');
        expect(headerSource).toContain('.attr("aria-label", "Previous update comparison bars")');
        expect(headerSource).toContain('.attr("aria-label", "Connector lines")');
        expect(headerSource).toContain('.attr("aria-label", "Data columns")');
        expect(headerSource).toContain('.attr("aria-label", "WBS grouping")');
        expect(headerSource).toContain('.attr("aria-label", "Progress line")');
        expect(headerSource).toContain('.attr("aria-label", "Progress-line variance labels")');
    });

    it("keeps pressed state off calculation-mode and WBS depth action buttons", () => {
        const modeSource = slice(
            headerSource,
            "private createModeToggleButton(): void",
            "private attachLookAheadOutsideClickHandler()"
        );
        const expandSource = slice(
            headerSource,
            "private createWbsExpandCycleToggleButton(): void",
            "private createWbsCollapseCycleToggleButton(): void"
        );
        const collapseSource = slice(
            headerSource,
            "private createWbsCollapseCycleToggleButton(): void",
            "private createFloatThresholdControl(): void"
        );

        expect(modeSource).not.toContain('attr("aria-pressed"');
        expect(expandSource).not.toContain('attr("aria-pressed"');
        expect(collapseSource).not.toContain('attr("aria-pressed"');
    });

    it("retains disabled comparison explanations and pressed state", () => {
        const baselineSource = slice(
            headerSource,
            "private createOrUpdateBaselineToggleButton(): void",
            "private createOrUpdatePreviousUpdateToggleButton(): void"
        );
        const previousSource = slice(
            headerSource,
            "private createOrUpdatePreviousUpdateToggleButton(): void",
            "private getExtendedLayoutMode("
        );

        for (const source of [baselineSource, previousSource]) {
            expect(source).toContain('.attr("aria-pressed"');
            expect(source).toContain('.attr("aria-disabled"');
            expect(source).toContain('.property("disabled", !isAvailable)');
        }
        expect(baselineSource).toContain("Add Baseline Finish Date data to enable");
        expect(previousSource).toContain("Add Previous Update Finish Date data to enable");
    });

    it("uses a visible non-colour marker and theme-aware focus colour", () => {
        const styleSource = readFileSync("style/visual.less", "utf8");
        const headerButtonStyle = slice(styleSource, ".header-toggle-button {", ".toggle-text {");

        expect(headerSource).toContain('"active-state-indicator"');
        expect(headerButtonStyle).toContain("var(--lpv-header-legend-active-color, #7CABFF)");
        expect(headerButtonStyle).not.toContain("outline: 2px solid #0078D4");
    });

    it("keeps high-contrast active and inactive colours distinct at render time", () => {
        const inactiveSource = slice(
            headerSource,
            "private getHeaderInactiveIconColor(): string",
            "private getHeaderActiveIconColor("
        );
        const activeSource = slice(
            headerSource,
            "private getHeaderActiveIconColor(",
            "private getHeaderHoverIconColor("
        );
        const paletteOverrideSource = slice(
            headerSource,
            "private applyHeaderPaletteOverrides(): void",
            "private renderButtons()"
        );

        expect(inactiveSource).toContain("this.getHeaderControlTextColor()");
        expect(activeSource).toContain("this.getHeaderPrimaryColor()");
        expect(paletteOverrideSource).not.toContain('"button.header-toggle-button svg path, button.header-toggle-button svg line"');
        expect(paletteOverrideSource).not.toContain('"button.header-toggle-button svg > rect:not(:first-child)"');
    });
});
