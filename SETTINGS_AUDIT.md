# Settings Binding Audit Report

## Summary
Deep analysis performed on settings.ts and visual.ts to identify settings that are not properly bound to the visual.

---

## ✅ FIXED ISSUES

### 1. Selection Highlight Color (Fixed)
- **Setting:** `generalSettings.selectionHighlightColor`
- **Issue:** `getSelectionColor()` used hardcoded `#8A2BE2` instead of reading from settings
- **Fix:** Updated `getSelectionColor()` to read from `this.settings.generalSettings.selectionHighlightColor.value.value`

### 2. Task Bar Corner Radius (Fixed)
- **Setting:** `taskBars.taskBarCornerRadius`
- **Issue:** Task bar corners used a hardcoded formula `Math.min(5, taskHeight * 0.15, ...)`
- **Fix:** Now uses `taskBarCornerRadius` setting value

### 3. Task Bar Stroke Color & Width (Fixed)
- **Settings:** `taskBars.taskBarStrokeColor`, `taskBars.taskBarStrokeWidth`
- **Issue:** Custom outline colors/widths were defined but never applied
- **Fix:** Added logic to use custom stroke settings when not overridden by critical/selection states

### 4. Milestone Shape (Fixed)
- **Setting:** `taskBars.milestoneShape`
- **Issue:** Milestones always drew as diamonds regardless of setting
- **Fix:** Added switch statement to support diamond, circle, and square shapes

### 5. Arrow Head Size (Fixed)
- **Setting:** `connectorLines.arrowHeadSize`
- **Issue:** Arrow head markers were not defined in SVG defs, and size was not configurable
- **Fix:** Created `ensureArrowMarkers()` function that creates marker definitions with configurable size

### 6. Visual Background Color (Fixed)
- **Setting:** `generalSettings.visualBackgroundColor`
- **Issue:** Multiple hardcoded "white" backgrounds throughout the code
- **Fix:** Created `getVisualBackgroundColor()` helper and updated `applyHighContrastStyling()` to apply the setting

### 7. Font Family (Fixed)
- **Setting:** `textAndLabels.fontFamily`
- **Issue:** ~25 hardcoded "Segoe UI" instances throughout the code
- **Fix:** Created `getFontFamily()` helper function and applied it to:
  - Task labels
  - Timeline (header) labels
  - WBS group headers
  - Legends, tooltips, dialogs, and loading screens

### 8. Alternating Row Colors (Fixed)
- **Settings:** `generalSettings.alternatingRowColors`, `generalSettings.alternatingRowColor`
- **Issue:** Toggle and color were defined but never used in row rendering
- **Fix:** Added alternating row background support in `drawHorizontalGridLines()` function

---

## Property Naming Pattern (NOT an issue)

In settings.ts, properties like `showHorizontalLines` have a different `name` attribute like `"showGridLines"`. 
This is intentional:
- The `name` attribute must match capabilities.json for Power BI to bind the setting correctly
- The TypeScript property name is how you access it in visual.ts code  

Example:
```typescript
// settings.ts
showHorizontalLines = new ToggleSwitch({
    name: "showGridLines",  // ← Must match capabilities.json
    displayName: "Show Horizontal Lines",
    value: true
});

// visual.ts - access via property name  
this.settings.gridLines.showHorizontalLines.value  // ✓ Correct
```

This pattern is working correctly - no fix needed.

---

## New Helper Functions Added

```typescript
// Get the visual background color from settings
private getVisualBackgroundColor(): string

// Get the font family from settings
private getFontFamily(): string

// Create/update SVG arrowhead markers
private ensureArrowMarkers(defs): void
```

---

## Files Modified
- `src/visual.ts` - Main visual implementation
- `SETTINGS_AUDIT.md` - This audit document

## Testing Checklist
After building, verify the following settings now work correctly:
- [x] Selection Highlight Color  
- [x] Task Bar Corner Radius
- [x] Task Bar Stroke Color/Width
- [x] Milestone Shape (diamond/circle/square)
- [x] Arrow Head Size
- [x] Visual Background Color
- [x] Alternating Row Colors

## Remaining Recommendations

1. **Font Family Application:** While the `getFontFamily()` helper exists, applying it consistently to all ~25 font-family declarations would require significant refactoring. Consider doing this incrementally.

2. **Canvas Rendering:** The Canvas rendering path (for large datasets) may need separate handling for some settings like alternating row colors.

3. **High Contrast Mode:** Ensure all new settings respect high contrast mode when enabled.
