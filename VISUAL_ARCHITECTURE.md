# Longest Path Visual Architecture

This file is an agent-facing reference for the Power BI custom visual in this
repository. Use it to orient yourself before changing calculation, rendering,
field binding, export, or packaging behaviour.

The source of truth is still the code, `capabilities.json`, and tests. Treat
this document as a map, not as a replacement for inspection.

## Purpose and Features

`LongestPathVisual` is a Power BI custom visual for reviewing P6-style schedule
data in a Gantt-like task table and timeline.

The visual supports:

- Longest Path analysis using scheduled start/finish dates and relationship
  logic.
- Float-Based analysis using task total float.
- Relationship connector lines with driving/non-driving differentiation.
- Task selection and backward/forward trace behaviour.
- Show All versus critical/near-critical filtering.
- WBS grouping, expand/collapse, WBS-only copy, and grouped summaries.
- Baseline and previous-update comparison bars and finish markers.
- Start/Finish progress line using Data Date plus current dates versus
  Baseline or Previous Update dates, including visible WBS summary rows and
  delay-analysis legend/tooltips.
- Look-ahead filtering/highlighting and data-date visual cues.
- Legend colouring and legend filtering.
- Header controls, responsive overflow menu, task search, path navigation, help,
  PDF/HTML export, and copy-to-Excel clipboard output.

## Entry Points

| Area | File | Notes |
|---|---|---|
| Visual manifest | `pbiviz.json` | Declares `visualClassName: "Visual"`, API version, icon, style, resources, and `capabilities.json`. |
| Data roles and format pane | `capabilities.json` | Defines roles, table data mapping, formatting objects, persisted state, and `ExportContent` privilege. |
| Visual lifecycle and rendering | `src/visual.ts` | Main `IVisual` implementation. Handles update flow, state, calculation mode, rendering, interactions, export, and help. |
| Format pane model | `src/settings.ts` | Typed formatting settings and defaults. Keep this aligned with `capabilities.json`. |
| Parsed data model | `src/data/Interfaces.ts` | Shared `Task`, `Relationship`, `WBSGroup`, `DataQualityInfo`, and bound-field types. |
| Data conversion | `src/data/DataProcessor.ts` | Converts Power BI table rows into tasks, relationships, WBS groups, indexes, and data-quality warnings. |

Generated/package artefacts live under `.tmp/`, `dist/`, and
`webpack.statistics*.html`. Do not hand-edit generated package output unless the
user explicitly asks for release artefact repair.

## Data Flow

1. Power BI supplies a table-shaped `DataView` according to `capabilities.json`.
2. `Visual.update()` delegates to `updateInternal()` in `src/visual.ts`.
3. `DataProcessor.processData()` reads role-bound columns and creates:
   - `allTasksData`
   - `relationships`
   - `taskIdToTask`
   - `predecessorIndex`
   - `relationshipIndex`
   - `relationshipByPredecessor`
   - WBS group maps and legend maps
   - `dataQuality`
4. The visual stores those outputs on instance state, detects optional bound
   fields, then applies calculation mode and task filtering.
5. Rendering uses SVG or canvas depending on task count and viewport, with
   virtual scrolling for visible rows.
6. Export/copy functions use the current filtered/visible task state and WBS
   state, not a fresh data query.

Important indexes:

- `relationshipIndex`: successor task ID -> incoming relationships.
- `relationshipByPredecessor`: predecessor task ID -> outgoing relationships.
- `predecessorIndex`: predecessor task ID -> successor task IDs.
- `taskIdToTask`: internal task ID -> `Task`.

## Field Roles and Binding Expectations

The visual uses a table data mapping. Each row may represent a task row and, for
relationship-shaped exports, one predecessor relationship for that task.

Core roles:

| Role | Expected use |
|---|---|
| `taskId` | Required unique activity identifier. Also used for relationship joins and selection. |
| `taskName` | Display label. Defaults to `Task <id>` if missing. |
| `taskType` | Activity type such as `TT_Task`, `TT_Mile`, or `TT_FinMile`. Export milestone labels should prefer this over duration. |
| `duration` | Required in Longest Path mode. Milestone types are forced to duration `0`. |
| `startDate`, `finishDate` | Required plotted/calculation dates for Longest Path mode. |
| `manualStartDate`, `manualFinishDate` | Optional plotted dates. They do not replace CPM calculation dates. |
| `taskTotalFloat` | Required in Float-Based mode. Drives critical and near-critical classification. |
| `taskFreeFloat` | Optional task-level free float display/input. |
| `predecessorId` | Optional predecessor activity ID for relationship rows. |
| `relationshipType` | Optional relationship type. `PR_FS`, `PR_SS`, `PR_FF`, `PR_SF` are normalised to `FS`, `SS`, `FF`, `SF`. Invalid/missing values default to `FS`. |
| `relationshipLag` | Optional lag/lead in days. |
| `relationshipFreeFloat` | Optional P6 relationship free float. When any finite relationship free float exists, blank values are non-driving. |
| `baselineStartDate`, `baselineFinishDate` | Optional baseline comparison bars and export columns. Both roles need to be bound and contain data for full availability. |
| `previousUpdateStartDate`, `previousUpdateFinishDate` | Optional previous-update comparison bars and export columns. Both roles need to be bound and contain data for full availability. |
| `dataDate` | Optional status/data date. Latest valid value across rows is used. |
| `legend` | Optional category colour and filtering. Values are normalised for stable selection. |
| `wbsLevels` | Optional ordered WBS hierarchy. Field-well order matters. |
| `tooltip` | Optional extra tooltip fields. |

If adding or renaming roles, update all of these together:

- `capabilities.json`
- `src/settings.ts` when format/persisted settings are involved
- `DataProcessor` role lookup and validation
- render/export logic that consumes the field
- tests that cover the role

## Calculation Modes

### Longest Path

Longest Path mode is selected by `criticalPath.calculationMode = longestPath`.
It requires `taskId`, `duration`, `startDate`, and `finishDate`.

Key behaviour:

- `identifyLongestPathFromP6()` clears old state, identifies driving
  relationships, finds terminal latest-finish tasks, builds driving chains, and
  marks the selected chain critical.
- `identifyDrivingRelationships()` uses P6 Relationship Free Float when present.
  The minimum finite free float per successor is driving.
- If relationship free float is not provided, the visual falls back to an
  approximate calculation from dates, relationship type, and lag.
- `DrivingPathScoring` builds an event graph using start/finish nodes. This is
  important: scoring is elapsed schedule span, not a simple sum of task
  durations.
- Relationship endpoints use type semantics:
  - `FS`: predecessor finish -> successor start
  - `SS`: predecessor start -> successor start
  - `FF`: predecessor finish -> successor finish
  - `SF`: predecessor start -> successor finish

Safety gates:

- Longest Path is disabled when CPM is unsafe.
- Unsafe conditions include possible 30,000-row truncation, circular
  dependencies, or invalid raw date ranges.
- Duplicate relationship rows are allowed when only relationship-level fields
  differ.
- Conflicting task-level duplicate rows are diagnostic-only. Longest Path uses
  one canonical row per Task ID, currently the first row in the grouped
  activity bucket, and keeps the inconsistent task-level fields in
  `conflictingTaskRows` without adding a visible warning.

Task type assumption:

- Longest Path analysis is intended for task and milestone activity types:
  `TT_Task`, `TT_Mile`, and `TT_FinMile`.
- LOE and WBS summary rows should be excluded from the schedule analysis
  dataset or verified carefully before being allowed into CPM logic.
- The CSV integration and stress tests use the task/milestone-only assumption.

### Float-Based

Float-Based mode is selected by `criticalPath.calculationMode = floatBased`.
It requires `taskId`, `taskTotalFloat`, `startDate`, and `finishDate`.

Key behaviour:

- `applyFloatBasedCriticality()` marks tasks critical when total float is `<= 0`.
- Near-critical tasks are marked when near-critical display is enabled and total
  float is greater than `0` and less than or equal to the threshold.
- Relationship criticality is not inferred from predecessor driving logic in
  Float-Based mode.
- Backward/forward trace uses predecessor/successor traversal and filters the
  rendered task set according to Show All versus critical-only display.

## Rendering and Interaction Structure

`src/visual.ts` is large. Prefer locating behaviour by subsystem:

| Subsystem | Main code areas |
|---|---|
| Lifecycle/update | Constructor, `update()`, `updateInternal()`, update type detection, resize handling. |
| Header controls | `Header` component plus `HeaderLayout` utilities. |
| Responsive layout | Header layout helpers, column layout helpers, viewport resize paths. |
| Task rendering | SVG/canvas task drawing, label drawing, virtual scroll, accessible canvas fallback. |
| Connector rendering | Relationship geometry, SVG/canvas arrows, driving/non-driving styles, hover states. |
| WBS | WBS grouping in `DataProcessor`, WBS state and rendering in `visual.ts`. |
| Path and trace UI | Task dropdown, trace toggle, path navigation, selected path chip. |
| Legend | Legend category state, persisted selections, renderable category filtering. |
| Export/help | Clipboard export, HTML/PDF export, help overlay, export metadata. |
| Accessibility/high contrast | Live region, focus handling, high contrast colour resolution, keyboard handlers. |

Rendering state is tightly coupled to persisted settings and current task filters.
When changing rendering, check both SVG and canvas branches if the feature is
visible in both.

## Utility Modules

| Module | Responsibility |
|---|---|
| `src/utils/RelationshipLogic.ts` | Relationship type normalisation, relationship identity keys, minimum-float driving selection. |
| `src/utils/DrivingPathScoring.ts` | Event graph construction, longest-path distance calculation, tied sink selection, path expansion and truncation. |
| `src/utils/ClipboardExporter.ts` | Copy-to-clipboard TSV/HTML generation and clipboard fallbacks. |
| `src/utils/VisualState.ts` | Small state/export helpers: legend serialisation, export text sanitising, task type export labels, float text. |
| `src/utils/HeaderLayout.ts` | Header control placement and overflow decisions. |
| `src/utils/ColumnLayout.ts` | Left label column packing and auto-fit behaviour. |
| `src/utils/DataSignature.ts` | Data signature for update detection. |
| `src/utils/Theme.ts` | Shared theme constants. |

## Export Behaviour

There are two export/copy paths:

- Visual-level export in `src/visual.ts` for visible table/HTML/PDF flows.
- `ClipboardExporter` utility for clipboard TSV/HTML payloads.

Export task type labels should use `task.type` first:

- `TT_Mile` and `TT_FinMile` -> `Milestone`
- other nonblank task types, including zero-duration `TT_Task` -> `Activity`
- duration `0` is only a fallback when task type is missing or blank

When editing export:

- Keep TSV and HTML output aligned.
- Sanitise user text for tabs/newlines and HTML where appropriate.
- Preserve WBS-only export behaviour when no tasks are visible.
- Re-test copy-to-Excel behaviour for zero-duration tasks.

## Data Quality and Warnings

`DataProcessor.validateDataQuality()` produces `DataQualityInfo`.

Important warning classes:

- Missing required roles.
- Possible row truncation at 30,000 rows.
- Circular dependencies.
- Invalid raw start/finish ranges.
- Invalid visual/manual start/finish ranges.
- Missing relationship free float when relationships exist.

The visual uses `cpmSafe` to decide whether Longest Path can run. Do not bypass
this without replacing it with an equally explicit safety decision. Duplicate
task-row conflicts should remain available as diagnostics, but should not block
Longest Path or add visible warnings unless a separate structural graph blocker
is present.

## Tests and What They Cover

| Test file | Coverage |
|---|---|
| `tests/data/DataProcessor.test.ts` | DataView parsing, relationships, relationship type normalisation, duplicate rows, WBS, dates, validation, data date. |
| `tests/utils/RelationshipLogic.test.ts` | P6 relationship type normalisation, relationship identity keys, minimum finite float driving logic. |
| `tests/utils/DrivingPathScoring.test.ts` | FS/SS/FF/SF event scoring, lags, milestones, tied sinks, path truncation. |
| `tests/utils/VisualState.test.ts` | Legend serialisation, export sanitising, task type export labels, float text. |
| `tests/utils/HeaderLayout.test.ts` | Header responsiveness, overflow menu behaviour, trace/search layout. |
| `tests/utils/ColumnLayout.test.ts` | Label column packing and auto-fit. |
| `tests/utils/DataSignature.test.ts` | Data signature changes for bindings and row values. |
| `tests/settings/VisualSettings.test.ts` | Settings defaults and alignment with capability objects/help text. |
| `tests/integration/XerPredecessorCsv.test.ts` | CSV-derived open task/milestone Longest Path expectations from relationship free float. |
| `tests/stress/VisualStress.test.ts` | Large generated data, driving-chain scoring, path truncation, copy-to-Excel task type output. |

Standard commands:

```powershell
npx tsc -p tsconfig.json --noEmit
npm test
npm run lint
npx pbiviz package --verbose
```

Power BI Desktop validation is still required for actual field binding,
format-pane behaviour, visual rendering, and packaged `.pbiviz` import.

## Safe-Change Checklist for Agents

Before changing custom visual behaviour:

- Read this file, `AGENTS.md`, `pbiviz.json`, `capabilities.json`,
  `src/settings.ts`, and the relevant source module.
- Run `git status --short` and preserve unrelated user or generated changes.
- Keep `capabilities.json`, `settings.ts`, `DataProcessor`, rendering, export,
  and tests aligned when changing a field role or setting.
- For Longest Path changes, test relationship type semantics, relationship free
  float handling, duplicate/conflict detection, selected-task trace, tied paths,
  and path truncation.
- For Float-Based changes, test total float, near-critical threshold, selected
  task trace, and Show All versus critical-only behaviour.
- For rendering changes, check SVG and canvas paths, WBS mode, resize, high
  contrast, and accessibility/focus behaviour.
- For export changes, check both TSV and HTML output and copy-to-Excel behaviour.
- Do not claim Desktop/report validation from code tests alone. State what still
  requires Power BI Desktop verification.
