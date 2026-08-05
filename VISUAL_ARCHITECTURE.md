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
- No Calculation visualiser mode for basic task/date schedules.
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
| `taskType` | Activity type such as `TT_Task`, `TT_Mile`, or `TT_FinMile`. Export milestone labels prefer this over duration except in No Calculation mode, where zero-duration tasks are visual milestones. |
| `duration` | Required in Longest Path mode, optional in No Calculation mode. When missing or blank in No Calculation mode, elapsed calendar days are calculated from `startDate` to `finishDate`. Milestone types are forced to duration `0`. |
| `startDate`, `finishDate` | Required plotted/calculation dates for all modes. In No Calculation mode they also provide the duration fallback. |
| `manualStartDate`, `manualFinishDate` | Optional plotted dates. They do not replace CPM calculation dates. |
| `taskTotalFloat` | Required in Float-Based mode. Drives critical and near-critical classification. |
| `taskFreeFloat` | Optional task-level free float display/input. |
| `predecessorId` | Optional predecessor activity ID for relationship rows. |
| `relationshipType` | Used for connector identity and endpoint geometry. `PR_FS`, `PR_SS`, `PR_FF`, `PR_SF` and P6 full names are normalised to `FS`, `SS`, `FF`, `SF`. Invalid or missing values default to `FS` and produce a Longest Path advisory. |
| `relationshipLag` | Optional lag/lead in days. |
| `relationshipFreeFloat` | Used for Longest Path. The lowest signed finite incoming value per successor and ties are driving. Every negative value is retained as a separate schedule-pressure status. Missing values are excluded with an advisory when other finite values exist; no finite relationship values remains a hard blocker. |
| `baselineStartDate`, `baselineFinishDate` | Optional baseline comparison bars and export columns. Calculated modes require both roles; No Calculation mode can use `baselineFinishDate` alone as a finish marker. |
| `previousUpdateStartDate`, `previousUpdateFinishDate` | Optional previous-update comparison bars and export columns. Calculated modes require both roles; No Calculation mode can use `previousUpdateFinishDate` alone as a finish marker. |
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

## WBS Grouping

`DataProcessor` builds real WBS groups only from contiguous populated
`wbsLevels` values. Once a blank WBS level is reached, lower-level values on
that row are ignored so the task belongs to the last populated parent. Tasks
without any WBS level remain real tasks with `wbsGroupId` unset.

Expanded WBS groups render direct tasks under the parent first, sorted by the
existing task date sort, then child WBS groups recursively. Export and copy use
the same visible order, so tasks with blank lower levels appear directly below
their last populated WBS parent instead of under the next child group.

The WBS header context menu also supports a persisted `Show only Level N`
display projection. The canonical hierarchy and task membership remain
unchanged: only groups at the selected level receive display rows. Expanding a
selected-level group flattens all of its filtered descendant activities beneath
that row using the existing task-date ordering, without rendering deeper WBS
headers. Duplicate visible group names gain their ancestor breadcrumb only when
needed for disambiguation. Screen rows, virtual scrolling, accessibility labels,
and visible exports share the same projection and view-relative indentation.

Activities whose WBS path ends before the selected level, including activities
with no WBS path, remain visible through a synthetic `No Level N WBS` group at
the bottom. This fallback uses the selected level's styling and the same
filtered summary calculations as other synthetic WBS groups.

In the standard show-through view, `visual.ts` adds an internal bottom-level
`Unassigned WBS` group for currently filtered tasks that do not have a WBS
path. This group is visual-only, participates in expand/collapse, visible
exports, and WBS summary display, and is removed when no unassigned tasks are
in the filtered scope.

The WBS Grouping format card controls summary row visibility, finish-only
summary style, summary colour, summary bar height, and finish-only summary
milestone size. A size/height value of `0` keeps the automatic scaling from the
task row height. Finish-only summary style defaults to milestone dots, but can
be changed to the regular summary bar.

Project, baseline, and previous-update finish lines use the filtered task scope
captured before WBS collapse. If that scope contains real WBS tasks, finish
lines are calculated from those real WBS tasks only; unassigned tasks do not
extend the WBS finish line. If the filtered scope contains only unassigned
tasks, the finish line falls back to those tasks so non-WBS-only filtered views
remain useful.

## Calculation Modes

The `criticalPath.calculationMode` setting has three values:

- `longestPath`: Longest Path (CPM)
- `floatBased`: Float-Based
- `none`: No Calculation (Visualiser)

The default remains `floatBased` for existing report compatibility.

### Longest Path

Longest Path mode is selected by `criticalPath.calculationMode = longestPath`.
It requires `taskId`, `duration`, `startDate`, and `finishDate`.

Key behaviour:

- `identifyLongestPathFromP6()` validates the full relationship dataset,
  identifies every activity tied at the latest Finish Date, and traces the
  complete driving ancestry without task-terminal filtering.
- `identifyDrivingRelationships()` uses the lowest signed finite Relationship
  Free Float entering each successor. All minima tied within `1e-9` are driving.
- Every relationship below `-1e-9` receives `hasNegativeFloat = true`.
  Negative status is a schedule-pressure indicator and does not by itself make a
  relationship driving or part of Longest Path.
- Missing or invalid relationship free float is excluded from driving ranking.
  Mixed finite and missing inputs remain internal diagnostics; if relationships
  exist but none has a finite value, Longest Path is not calculated. There is no
  date-and-lag approximation fallback.
- `Task.isLongestPath` and `Relationship.isDriving` are authoritative for the
  visual's documented minimum-float method. Existing `isCritical` state remains
  presentation state for the global or selected trace.
- Backward and forward selected-task traces collect the full reachable driving
  closure, including every tied branch, without changing authoritative status.
- `DrivingPathScoring` builds an event graph using start/finish nodes. This is
  important: scoring is elapsed schedule span, not a simple sum of task
  durations.
- The route-duration calculation uses a strict `1e-9` day tolerance. It does
  not reuse the `0.001` display float tolerance, so a route that is merely
  close in duration is not presented as an exact tie.
- Up to 10 maximum-duration Longest Path routes are presented using this order:
  latest finish, greatest elapsed span, earliest start, then stable task and
  relationship identity. Path 1 is the first-ranked route. All other calculated
  driving ancestry retains
  `Task.isLongestPath = true` and `Relationship.isDriving = true`, but does not
  receive the selected critical presentation.
- The Longest Path selector displays the selected route number, adds elapsed
  calendar span on medium and wide layouts, and adds activity count on wide
  layouts. Its hover and accessible descriptions include Early Start, Early
  Finish, activity count, relationship count, and the calculation criteria.
  Previous/next navigation is provided when more than one ranked route exists. Candidate
  generation remains bounded separately for network safety, then the agreed
  ranking is applied and the presented set is capped at 10.
- A clicked zero-based route index remains pending until Power BI returns the
  matching persisted one-based `selectedPathIndex`. This prevents an immediate
  update carrying stale visual metadata from reverting the selector to Path 1.
- The selector label's hover text explains the calculation criteria without
  showing warning or authoritative-status detail.
- Relationship endpoints use type semantics:
  - `FS`: predecessor finish -> successor start
  - `SS`: predecessor start -> successor start
  - `FF`: predecessor finish -> successor finish
  - `SF`: predecessor start -> successor finish

Safety gates:

- Longest Path is disabled globally only when Power BI reports more data than
  the visual can fetch, no real activity has a finite Finish Date, or
  relationships exist without any finite Relationship Free Float.
- Missing individual dates or floats, missing predecessors, invalid/defaulted
  relationship metadata, self-relationships, and conflicting duplicate dates
  remain internal diagnostics rather than project-wide blockers.
- Circular logic blocks only an affected calculated driving scope. A
  non-driving or disconnected cycle does not suppress an otherwise valid
  project Longest Path.
- Duplicate relationship rows are allowed when only relationship-level fields
  differ.
- Conflicting task-level duplicate rows remain diagnostic. When Start or
  Finish differs, the canonical row is used.
- Longest Path validation continues to gate unsafe calculations, but warning
  and status messages are intentionally not surfaced in the mode header.

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

### No Calculation (Visualiser)

No Calculation mode is selected by `criticalPath.calculationMode = none`.
It requires only `taskId` and `finishDate`. `startDate`, `duration`,
`taskTotalFloat`, `taskFreeFloat`, and relationship type are optional.

Key behaviour:

- No criticality, CPM, float-based, near-critical, driving, or Longest Path
  state is calculated.
- All plottable tasks are shown when no task is selected.
- When a task is selected and predecessor data exists, backward/forward trace
  shows the structural predecessor/successor path only. It does not mark tasks
  or relationships as critical or driving.
- Relationship parsing stays active. Missing, blank, or invalid relationship
  types default to `FS`, so connector arrows still have deterministic
  semantics.
- If `duration` is bound and finite, that value is used when Start Date is
  present. If it is missing or blank, duration is calculated as elapsed
  calendar days from Start Date to Finish Date. Invalid or negative calculated
  duration is clamped to `0`.
- If Start Date is not bound or is blank, a row with Finish Date is treated as
  a finish-only visualiser milestone. Any supplied duration is ignored for
  plotting and the milestone is drawn at Finish Date.
- In a finish-only visualiser dataset, the left-pane Start column is suppressed
  even if the column setting is enabled; the Finish column remains visible.
- Baseline and Previous Update comparison layers follow the same finish-only
  contract in No Calculation mode: a bound comparison Finish Date renders as a
  marker when the matching comparison Start Date is absent. Their Start label
  columns are suppressed unless start data is present.
- Manual Start/Finish override roles remain visual override fields; they do not
  replace the Start/Finish duration fallback.
- A calculated or supplied duration of `0` is treated as a visual milestone in
  rendering, in addition to `TT_Mile` and `TT_FinMile`.
- WBS summary rows keep their earliest/latest child finish summary dates for
  sorting, zoom extents, labels, exports, and progress-line logic. In
  finish-only visualiser data, the WBS Grouping `Finish-Only Summary Style`
  setting chooses whether the timeline row renders filtered descendant finish
  milestones as compact dots or uses the regular summary range bar.
- The header hides the Longest Path/Float-Based toggle, Show Critical/Show All
  toggle, and near-critical threshold controls. Other timeline, WBS, connector,
  column, copy/export, and help controls remain available.
- The left-pane Total Float column is suppressed in No Calculation mode even
  when the column setting is enabled.
- Built-in left-pane column headers can be overridden from the Columns format
  card. Blank header overrides preserve the default labels and abbreviated
  fallbacks used by the responsive column packing logic.

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
| Path and trace UI | Task dropdown, trace toggle, 10-route Longest Path selector, and criteria hover text. |
| Legend | Legend category state, persisted selections, renderable category filtering. |
| Export/help | Clipboard export, HTML/PDF export, help overlay, export metadata. |
| Accessibility/high contrast | Live region, focus handling, high contrast colour resolution, keyboard handlers. |

Rendering state is tightly coupled to persisted settings and current task filters.
When changing rendering, check both SVG and canvas branches if the feature is
visible in both.

Text sharpness is centralised in `RenderingSharpness`. SVG text and tspans use
complete cross-platform font stacks, `optimizeLegibility`, platform font
smoothing, and integer logical coordinates. Canvas surfaces use DPR-aware
backing buffers and snap text to the physical-pixel grid. The vertically
scrolling SVG and canvas body share a DPR- and host-scale-aware paint-origin
compensation, including containing-frame transforms where the host exposes
same-origin geometry. Native `scrollTop` remains unchanged for smooth scrolling,
virtualisation, and restoration. Significant viewport or Focus Mode changes wait
for stable dimensions, preserve both scroll axes, perform one full layout pass,
and reveal the wrapper on the following frame. Keep screen, mini-chart, visible
export, full export, and PDF raster paths aligned when changing these rules.

## Utility Modules

| Module | Responsibility |
|---|---|
| `src/utils/RelationshipLogic.ts` | Relationship type normalisation, relationship identity keys, minimum-float driving selection. |
| `src/utils/DrivingPathScoring.ts` | Event graph construction, longest-path distance calculation, tied sink selection, path expansion and truncation. |
| `src/utils/ClipboardExporter.ts` | Legacy copy-to-clipboard TSV/HTML generation and clipboard fallbacks used by stress coverage. |
| `src/utils/VisualState.ts` | Small state/export helpers: legend serialisation, export text sanitising, legacy task type export labels, float text. |
| `src/utils/HeaderLayout.ts` | Header control placement and overflow decisions. |
| `src/utils/ColumnLayout.ts` | Left label column packing and auto-fit behaviour. |
| `src/utils/WbsDisplayProjection.ts` | Shared show-through/show-only WBS row projection, display indentation, duplicate-name disambiguation, and pending display-selection reconciliation. |
| `src/utils/DataSignature.ts` | Data signature for update detection. |
| `src/utils/RenderingSharpness.ts` | Font-stack normalisation, SVG/canvas text coordinate snapping, scroll-phase alignment, HiDPI canvas sizing, canvas text hints, and viewport stability checks. |
| `src/utils/Theme.ts` | Shared theme constants. |

## Export Behaviour

There are two export/copy paths:

- Visual-level export in `src/visual.ts` for visible table/HTML/PDF flows.
- `ClipboardExporter` utility for legacy clipboard TSV/HTML payload coverage.

The visual-level export/copy path mirrors the visible left-pane table columns
and visible WBS/task row structure, with an explicit `Activity Is Longest Path`
status column. Other hidden/internal fields such as Task ID, Task Type, Index,
Is Critical, Start, Duration, and Float are not exported unless they are
visible on screen. When WBS grouping is off, export appends WBS Level columns
after the visible columns so the hierarchy remains available.

When editing export:

- Keep TSV and HTML output aligned.
- Sanitise user text for tabs/newlines and HTML where appropriate.
- Preserve visible WBS group rows when tasks are collapsed.
- Re-test copy-to-Excel and HTML export with WBS on, WBS off, and finish-only
  Visualiser data.

## Data Quality and Calculation Safety

`DataProcessor.validateDataQuality()` produces `DataQualityInfo`.

Important diagnostic classes:

- Missing required roles.
- Possible incomplete data when Power BI reaches the fetch-more limit.
- Circular dependencies.
- Invalid raw start/finish ranges.
- Invalid visual/manual start/finish ranges.
- Missing or invalid relationship free float, type, or lag when relationships
  exist.
- Missing predecessors, self-relationships, conflicting schedule dates, and
  circular dependency paths. These are advisories unless they create a hard
  blocker or occur in the active calculated driving scope.

The visual uses `longestPathSafe` and `longestPathBlockers` for hard Longest
Path gating. Recoverable issues are retained in `longestPathAdvisories` and
calculation continues without surfacing advisory text in the Longest Path mode
header. `cpmSafe` remains the legacy general schedule-date/data-limit diagnostic
so Float-Based and Visualiser modes are not disabled by relationship-specific
issues. Do not bypass the mode-specific gate.

## Tests and What They Cover

| Test file | Coverage |
|---|---|
| `tests/data/DataProcessor.test.ts` | DataView parsing, relationships, relationship type normalisation, duplicate rows, WBS, dates, validation, data date. |
| `tests/utils/RelationshipLogic.test.ts` | P6 relationship type normalisation, relationship identity keys, minimum finite float driving logic. |
| `tests/utils/DrivingPathScoring.test.ts` | FS/SS/FF/SF event scoring, lags, milestones, strict duration ties, deterministic ranking, 10-route selector limiting, tied sinks, and path truncation. |
| `tests/utils/VisualState.test.ts` | Legend serialisation, export sanitising, task type export labels, float text. |
| `tests/utils/HeaderLayout.test.ts` | Header responsiveness, overflow menu behaviour, trace/search layout. |
| `tests/utils/ColumnLayout.test.ts` | Label column packing and auto-fit. |
| `tests/utils/WbsDisplayProjection.test.ts` | Exact-level WBS projection, flattened descendants, filtering, stable ordering, duplicate labels, fallback membership, and stale-host selection reconciliation. |
| `tests/utils/DataSignature.test.ts` | Data signature changes for bindings and row values. |
| `tests/utils/RenderingSharpness.test.ts` | Font-stack resolution, SVG and physical-pixel snapping, scroll-phase compensation, 100–200% DPR sizing, canvas text hints, and resize stability thresholds. |
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
