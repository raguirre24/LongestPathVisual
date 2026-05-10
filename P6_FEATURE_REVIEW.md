# P6 Feature Review: LongestPathVisual vs Primavera P6 Professional v26

Review date: 2026-05-10
Scope: code-level review only. No production code changes are included.
Baseline: Oracle Primavera P6 Professional v26 Activity Layout and Gantt behaviour.
Repo baseline: `VISUAL_ARCHITECTURE.md`, `capabilities.json`, `pbiviz.json`, `package.json`, `src/`, `style/`, `assets/`, `test/`, and `tests/`.

## Executive Summary

`LongestPathVisual` is already strong as a Power BI schedule review visual for P6-derived data. It is not a P6 layout clone, and it should not try to become a P6 scheduling engine. Its strongest fit is reviewing imported Primavera P6 activity, relationship, float, WBS, baseline, previous-update, and data-date data inside a Power BI report.

The current implementation is strongest in these areas:

- P6-oriented relationship handling: relationship type, lag, relationship free float, driving relationship flags, and FS/SS/FF/SF event scoring are all represented in code.
- Two analysis modes: Longest Path and Float-Based criticality.
- WBS grouping, grouped summaries, expand/collapse controls, WBS-only copy/export behaviour, and contextual WBS actions.
- Comparison overlays for baseline and previous update bars, plus finish/data-date/project-end line options.
- Look-ahead filtering/highlighting from the data date.
- Responsive header controls, task search, trace direction, legend filtering, export/copy/help workflows, virtual scrolling, canvas fallback, keyboard support, and high-contrast handling.

The largest P6 parity gaps are not basic Gantt drawing. They are the richer layout behaviours that P6 users expect around configurable bars, arbitrary activity table columns, activity-code/UDF grouping and filtering, progress line/spotlight, curtains, annotations, schedule checks, and field families such as actuals, remaining dates, percent complete, constraints, calendars, resources, and costs.

The most valuable improvements are:

1. Add a visible schedule health/data quality panel using existing `DataQualityInfo`.
2. Add a flexible display-column role so P6 Activity Table columns, activity codes, and UDFs can be shown and exported without adding one field role per P6 attribute.
3. Upgrade legend filtering into richer activity-code/UDF category filtering and colour rules.
4. Add relationship diagnostics for Trace Logic parity: type, lag, relationship free float, driving status, inferred-vs-field source, and predecessor/successor context.
5. Add progress/status roles as a foundation for P6-style progress line and progress spotlight behaviour.

## Status Definitions

- `Supported`: the current visual covers the capability directly for imported P6 data.
- `Partially supported`: the current visual covers the core review use case, but lacks important P6 layout options or field coverage.
- `Missing`: no meaningful current support was found in the repo.
- `Not applicable in Power BI`: the capability depends on editing or scheduling inside P6 and should not be reproduced as-is in a custom visual.
- `Better than P6 for this use case`: the visual adds Power BI-specific review value that is not the same as a native P6 layout capability.

## Review Basis

### Repo Evidence

Core files reviewed:

- `VISUAL_ARCHITECTURE.md`: architecture and feature map for Longest Path, Float-Based mode, WBS, comparisons, look-ahead, exports, and interaction design.
- `pbiviz.json`: visual identity and Power BI API version.
- `capabilities.json`: field wells, formatting objects, Power BI privileges, keyboard support, tooltip support, and the 30,000-row data reduction limit.
- `src/settings.ts`: formatting model cards for task bars, critical path, comparisons, connectors, text, columns, layout, line markers, look-ahead, path selection, WBS, legend, timeline zoom, and persisted state.
- `src/data/DataProcessor.ts` and `src/data/Interfaces.ts`: P6-shaped parsing, relationship extraction, WBS extraction, duplicate handling, synthetic predecessor tasks, data quality flags, and task/relationship model.
- `src/utils/RelationshipLogic.ts` and `src/utils/DrivingPathScoring.ts`: relationship normalisation, free-float driving logic, and start/finish event graph scoring across FS/SS/FF/SF relationships.
- `src/visual.ts`: rendering, interaction, mode switching, criticality calculation, task search, path tracing, WBS interaction, legend filtering, look-ahead, canvas/SVG rendering, export, accessibility, high contrast, and lifecycle handling.
- `src/components/Header.ts`: responsive header, action overflow, mode controls, WBS controls, look-ahead controls, copy/PDF/HTML/help actions, and ARIA attributes.
- `tests/`: data, settings, relationship, path scoring, header layout, column layout, visual state, integration, and stress coverage.

### Oracle P6 Professional v26 Evidence

Oracle documentation used as the comparison baseline:

- [P6 Professional User Guide v26 table of contents](https://docs.oracle.com/cd/G48902_01/English/User_Guides/p6_pro_user/toc.htm)
- [Define Activity Table columns](https://docs.oracle.com/cd/G48902_01/English/User_Guides/p6_pro_user/define_activity_table_columns.htm)
- [The Gantt Chart](https://docs.oracle.com/cd/G48902_01/English/User_Guides/p6_pro_user/the_gantt_chart.htm)
- [Change a bar in the Gantt Chart](https://docs.oracle.com/cd/G48902_01/English/User_Guides/p6_pro_user/change_a_bar_in_the_gantt_chart.htm)
- [Change a Gantt Chart bar's filter](https://docs.oracle.com/cd/G48902_01/English/User_Guides/p6_pro_user/change_a_gantt_chart_bars_filter_layouts.htm)
- [Change a Gantt Chart bar's style](https://docs.oracle.com/cd/G48902_01/English/User_Guides/p6_pro_user/change_a_gantt_chart_bars_style.htm)
- [Change a Gantt Chart bar's timescale](https://docs.oracle.com/cd/G48902_01/English/User_Guides/p6_pro_user/change_a_gantt_chart_bars_timescale.htm)
- [Apply a Progress Line to the Gantt Chart](https://docs.oracle.com/cd/G48902_01/English/User_Guides/p6_pro_user/applying_a_progress_line_to_the_gantt_chart.htm)
- [Progress Spotlight](https://docs.oracle.com/cd/G48902_01/English/User_Guides/p6_pro_user/progress_spotlight.htm)
- [Create a lookahead filter](https://docs.oracle.com/cd/G48902_01/English/User_Guides/p6_pro_user/create_a_lookahead_filter.htm)
- [Group activities by hierarchy](https://docs.oracle.com/cd/G48902_01/English/User_Guides/p6_pro_user/group_activities_by_hierarchy.htm)
- [Trace Logic](https://docs.oracle.com/cd/G48902_01/English/User_Guides/p6_pro_user/trace_logic.htm)
- [Display Trace Logic](https://docs.oracle.com/cd/G48902_01/English/User_Guides/p6_pro_user/display_trace_logic.htm)
- [Calculate multiple float paths](https://docs.oracle.com/cd/G48902_01/English/User_Guides/p6_pro_user/calculate_multiple_float_paths.htm)
- [Showing activity critical paths](https://docs.oracle.com/cd/G48902_01/English/User_Guides/p6_pro_user/level_resources_automatically.htm)
- [Checking schedules](https://docs.oracle.com/cd/G48902_01/English/User_Guides/p6_pro_user/101393.htm)
- [Check a schedule](https://docs.oracle.com/cd/G48902_01/English/User_Guides/p6_pro_user/101251.htm)

## Current Feature Inventory

### Manifest and Power BI Host Capabilities

`pbiviz.json` identifies the visual class as `Visual`, uses Power BI visuals API `5.11.0`, and package version `2.0.1.0`.

`capabilities.json` exposes only the `ExportContent` privilege and marks it non-essential. That is a good security posture for a visual that copies/exports rendered content but does not need network or storage privileges.

The manifest supports:

- Keyboard focus.
- Multi visual selection.
- Empty data views and landing page.
- Highlight and tooltip support.
- Table data mapping.
- A `dataReductionAlgorithm` top limit of 30,000 rows.

The 30,000-row limit is an important architectural boundary. When P6 XER or activity/relationship exports exceed that bound, the visual cannot guarantee complete path, WBS, relationship, or schedule quality results.

### Data Roles and P6 Field Coverage

The visual currently has strong coverage for the core schedule-review fields:

- Activity identity: `taskId`, `taskName`, `taskType`.
- Schedule dates: `startDate`, `finishDate`.
- Manual plotted dates: `manualStartDate`, `manualFinishDate`.
- Duration and float: `duration`, `taskTotalFloat`, `taskFreeFloat`.
- Relationship data: `predecessorId`, `relationshipType`, `relationshipLag`, `relationshipFreeFloat`.
- Comparison dates: `baselineStartDate`, `baselineFinishDate`, `previousUpdateStartDate`, `previousUpdateFinishDate`.
- Time reference: `dataDate`.
- Grouping and colouring: `wbsLevels`, `legend`.
- Extra tooltip values: `tooltip`.

Coverage gaps compared with a P6 Activity Table layout:

- No flexible display-column role for arbitrary P6 Activity Table columns.
- No first-class activity code or UDF roles beyond single-field `legend` and multi-field `wbsLevels`.
- No roles for actual start/finish, remaining start/finish, percent complete, physical percent complete, performance percent complete, status, early/late dates, constraints, calendar, resource, role, cost, expense, activity step, notebook, issue, risk, document, or levelling fields.
- The `tooltip` role can carry extra context, but those fields cannot currently drive columns, grouping, filters, bar definitions, schedule checks, or exports as structured data.

### Calculation Modes

#### Longest Path Mode

The current Longest Path mode is P6-aware rather than a generic topological sort:

- `DataProcessor` reads relationship type, lag, and relationship free float.
- `RelationshipLogic.normalizeRelationshipType` supports FS, SS, FF, and SF and normalises P6-style `PR_*` values.
- `DrivingPathScoring` builds a start/finish event graph so each relationship type connects the correct predecessor and successor event endpoints.
- `visual.ts` identifies driving relationships using relationship free float when supplied. If the field is missing, it falls back to an approximation using task dates, relationship type, and lag.
- The visual gates CPM confidence with `DataQualityInfo.cpmSafe`, including truncation, circular path, and invalid raw date checks.

This is one of the strongest parts of the implementation. The visual is aligned with how P6 users reason about relationship-driven paths, especially where relationship free float is available from the P6 export.

#### Float-Based Mode

Float-Based mode uses task total float:

- Critical tasks are those with total float less than or equal to zero.
- Near-critical highlighting is controlled by the near-critical threshold.
- Trace behaviour follows predecessor/successor chains and is bounded by defensive traversal limits.

This is useful when exported task total float is trusted or when the report consumer wants a simpler critical/near-critical view. It does not replace P6's schedule calculation.

### Data Processing and Quality

`DataProcessor` includes several defensive behaviours that matter for P6 exports:

- Groups duplicate task rows by Task ID.
- Extracts relationship rows from repeated predecessor rows.
- Parses data date and WBS level columns.
- Creates synthetic tasks for missing predecessors so dangling references can still be represented.
- Forces P6 milestone task types `TT_Mile` and `TT_FinMile` to zero duration.
- Detects duplicate/conflicting task rows, missing predecessors, relationship counts, relationship free-float availability, circular paths, invalid raw date ranges, invalid visual date ranges, and possible truncation.
- Tracks whether the data is CPM-safe for Longest Path analysis.

Opportunity: much of this quality information is available in code but is not yet surfaced as a full P6-style schedule health experience.

### Gantt Rendering

The visual already supports:

- Current activity bars using visual start/finish, including manual override dates.
- Milestone rendering.
- Baseline bars.
- Previous update bars.
- Baseline and previous-update finish markers.
- Data date, project finish, and comparison line options.
- Grid lines and timeline layout settings.
- Zoom slider and mini-chart-style timeline control.
- SVG and canvas rendering paths.
- Connector lines with critical/driving/non-driving styling.
- High-contrast-aware colour resolution.
- Responsive column layout with auto-hiding lower-priority fixed columns.

Important limitation: P6's Gantt bar model is more flexible. P6 lets users define multiple bars, assign each bar a timescale, filter, style, row position, collapsed behaviour, and labels. This visual has configured layers and fixed comparison types rather than a generic bar definition engine.

### Interactions

Current interaction support is strong for a Power BI visual:

- Header mode toggle for Longest Path vs Float-Based analysis.
- Critical/show-all toggle.
- Task search by ID/name.
- Selected task tracing backward or forward.
- Selected path index and multi-path toggles.
- Legend category filtering.
- WBS grouping, expand/collapse, WBS context menu, and WBS export handling.
- Look-ahead filter or highlight mode.
- Connector, baseline, previous-update, column, and export controls.
- Copy-to-Excel, HTML copy, PDF export, and help overlay.

P6 parity gaps are mostly about depth rather than absence:

- No Trace Logic bottom-pane equivalent with activity boxes and visible predecessor/successor network depth controls.
- No relationship diagnostics panel.
- No group-and-sort-by-any-field layout dialog.
- No arbitrary field filters like P6 user-defined filters.
- No direct activity editing, which is correct for Power BI.

### Accessibility and High Contrast

The visual has meaningful accessibility infrastructure:

- `supportsKeyboardFocus` in `capabilities.json`.
- ARIA labels and pressed/disabled/busy states on header controls.
- Combobox/listbox-style task search.
- Radio-style trace direction controls.
- Keyboard handling for help overlay and WBS context menu.
- Accessible canvas fallback list for tasks.
- High contrast palette handling.
- Live/status messaging.

Remaining validation requirement: accessibility behaviour must still be validated in Power BI Desktop and with the packaged `.pbiviz`, especially focus order, keyboard trapping/release, high contrast rendering, screen reader wording, and canvas fallback behaviour.

### Performance Architecture

The architecture has several performance-aware choices:

- Table data mapping with a clear row cap.
- Update-type detection for viewport-only and settings-only updates.
- Virtual scrolling.
- Canvas rendering path for larger viewports.
- Data signature and render-only paths.
- Defensive traversal limits for path tracing.
- Stress tests for large P6-shaped data.

The performance posture is appropriate for Power BI, but the 30,000-row limit remains a hard correctness boundary for P6 schedules where relationships can multiply rows.

## P6 Comparison Matrix

| P6 capability | Current status | Repo evidence | P6 baseline | Gap or opportunity | Priority |
| --- | --- | --- | --- | --- | --- |
| Activity ID, name, start, finish, duration, total float | Supported | `capabilities.json`; `DataProcessor`; fixed table columns in `visual.ts` | Activity Table columns can be selected and ordered | Core fields are present, but only fixed display columns are available | Now |
| Arbitrary Activity Table columns | Missing | No generic display-column role; `tooltip` only provides supplemental context | P6 Columns dialog lets users add, remove, and order selected columns | Add a flexible `displayColumns` role and export/render support | Now |
| Activity code/UDF values | Partially supported | Single `legend` role; multi-field `wbsLevels`; tooltip role | P6 supports activity codes and user-defined fields in columns, grouping, filters, and labels | Add category/filter roles or a flexible field model | Now |
| WBS grouping and hierarchy | Supported | `wbsLevels`, WBS grouping settings, WBS context menu, WBS tests | P6 supports WBS path/hierarchy grouping | Current support is good; add sort/group presets and export refinements | Next |
| Grouping by hierarchy other than WBS | Missing | No role for resource, role, cost account, activity code hierarchy | P6 can group hierarchical fields such as WBS, resources, roles, cost accounts, activity codes, resource codes, and project codes | Generalise grouping beyond WBS if users supply hierarchy/category fields | Later |
| Sorting by multiple fields | Partially supported | Current task order and WBS ordering are visual-controlled; no user multi-sort role | P6 layouts support one or more sort criteria | Add sort settings only after flexible display fields exist | Later |
| P6 user-defined filters | Partially supported | Show all/critical, legend filter, task search, WBS collapse, look-ahead | P6 supports named filters, combined filters, and bar-specific filters | Add filter chips/rules for activity codes, UDFs, float ranges, date windows, and status | Next |
| Look-ahead filter | Supported | `LookAheadCard`; `getLookAheadWindow`; filter/highlight mode | P6 can create lookahead filters relative to project/current dates | Current implementation is strong; add presets such as 2w/4w/6w/8w and export labelling | Now |
| Gantt current activity bars | Supported | SVG/canvas bars in `visual.ts`; task bar settings | P6 Activity Gantt displays current bars | Current support is good for review; no direct editing | Now |
| Multiple configurable Gantt bars | Partially supported | Fixed current/baseline/previous/manual layers; no generic bar definition list | P6 lets layouts add/change bars, assign timescales, filters, styles, rows, and labels | Add limited built-in bar definitions first; avoid a fully generic P6 clone initially | Next |
| Bar style: endpoints, body, patterns, height, row | Partially supported | Format cards expose colours/heights for fixed layers | P6 bar style options include endpoints, body, colour, pattern, row, and collapsed behaviour | Add shape/row/label settings only for supported built-in bar types | Next |
| Bar labels | Partially supported | Text/labels settings and fixed task label behaviour | P6 bar labels can be placed around bars and use selected fields/notebooks | Add field-driven label positions from display/tooltip fields | Next |
| Bar-specific filters | Missing | No per-bar filter model | P6 lets each bar represent a selected filter | Add only if configurable bars are implemented | Later |
| Bar rows and stacking | Missing | Fixed comparison offsets only | P6 bars can be positioned in rows to stack or overlap | Add row setting for built-in bar definitions | Later |
| Milestones | Supported | `TT_Mile` and `TT_FinMile` zero duration; milestone SVG/canvas rendering | P6 supports milestones and milestone bar/date behaviour | Current support is good; add richer milestone shape options if needed | Later |
| Relationship lines | Supported | `relationshipType`, `relationshipLag`, connector rendering, driving styling | P6 Gantt can show/hide relationship lines | Current support is strong; add diagnostics and filter controls | Now |
| Relationship type support FS/SS/FF/SF | Supported | `RelationshipLogic`; `DrivingPathScoring`; relationship tests | P6 supports relationship types and lag | Current support is strong | Now |
| Relationship free-float driving logic | Better than P6 for this use case | `relationshipFreeFloat`; `markMinimumFloatDrivingRelationships`; XER integration test | P6 multiple float path logic can use free float/total float | The visual exposes a focused review path inside Power BI; make source/quality visible | Now |
| Trace Logic | Partially supported | Task search, trace direction, `calculateCPMToTask`, `calculateCPMFromTask` | P6 has a Trace Logic bottom layout with activity boxes and preferences | Add depth controls, relationship diagnostics, and optional predecessor/successor side panel | Next |
| Activity critical paths to selected activity | Partially supported | Selected task trace backward/forward; path index | P6 can show backward, forward, whole, more/fewer paths, and path number columns | Add path list, depth/path count controls, and path number display/export | Next |
| Multiple float paths | Partially supported | Multi-path state and selected path index exist; tied path handling exists | P6 calculates a specified number of paths using total float or free float | Clarify algorithm limits; add path report/export and path count controls | Next |
| Critical path by total float | Supported | Float-Based mode and near-critical threshold | P6 can define critical activities by total float or longest path | Current support depends on supplied P6 total float | Now |
| Longest path | Supported | Longest Path mode with event scoring and driving relationship handling | P6 longest path traces driving relationships to project start, especially with free-float method | Current support is strong for imported data; show confidence indicators | Now |
| Data date line | Supported | `dataDate` role; `DataDateLineCard`; rendering in `visual.ts` | P6 can customise data date line | Current support is good; improve progress/spotlight link | Now |
| Progress before/after data date colouring | Partially supported | Data-date colour override exists | P6 uses progress/status concepts around the data date | Add actuals/remaining/status roles before making this a full progress check | Next |
| Progress Spotlight | Partially supported | Look-ahead window from data date approximates spotlight review | P6 highlights activities between the last data date and a moved/new data date for updating | Add explicit "progress spotlight" naming, preset windows, and status-field integration | Next |
| Progress Line | Partially supported | `progressLine` settings, `calculateFinishVarianceProgressPoint`, and `drawProgressLine` implement finish-variance points from Data Date using Finish versus Baseline Finish or Previous Update Finish, including visible WBS summaries | P6 progress line can show variance or progress points based on baseline, actuals, remaining duration, or percent complete | Current support is finish-variance only; progress-point modes still need actual/remaining/percent-complete roles | Next |
| Curtains | Missing | No curtain/annotation roles or rendering | P6 supports date-range curtain attachments in Gantt layouts | Add optional data-driven curtain role for outage/update windows | Later |
| Text attachments | Missing | No arbitrary chart annotation model | P6 supports foreground text attachments | Add data-driven annotations, not freeform visual editing | Later |
| Notebook items on bars | Missing | No notebook role | P6 can attach notebook items as bar labels | Support via field-driven labels/tooltips if users bind notebook text | Later |
| Baselines | Partially supported | Primary baseline start/finish bars and finish line | P6 supports project/primary/secondary/tertiary baselines and baseline comparison settings | Add secondary/tertiary baselines only if users need them; otherwise keep focused | Later |
| Previous update comparison | Better than P6 for this use case | Previous update start/finish fields and overlay | P6 baselines/reflections can compare schedules, but previous-update overlay is report-specific | Keep and extend with variance columns/export | Now |
| Timescale format | Partially supported | Timeline zoom, grid/line settings | P6 has configurable timescale intervals and bar timescales | Add preset date interval labels and calendar-aware tick options | Later |
| Calendar nonwork time and bar necking | Missing | No calendar role or nonwork interval rendering | P6 bar settings can show calendar nonwork and activity nonwork intervals | Avoid full calendar engine; optionally visualise supplied nonwork/shift fields | Later |
| Activity actuals, remaining, percent complete | Missing | No roles for actual/remaining/% complete | P6 has actual, remaining, percent complete, performance and progress fields | Add roles as foundation for progress line, spotlight, status, and actual/remain bars | Now |
| Constraints | Missing | No constraint type/date roles | P6 Check Schedule reports hard/soft constraints | Add optional roles and schedule health indicators; do not recalculate dates | Next |
| Calendar assignment | Missing | No calendar role | P6 activity calendars affect dates, nonwork, and schedule logic | Add calendar as display/filter/check field only; avoid recalculation | Later |
| Schedule quality checks | Partially supported | `DataQualityInfo` already tracks truncation, circular paths, invalid dates, missing predecessors, relationship free-float coverage | P6 Check Schedule checks logic, lags, constraints, float, durations, progress, resources/cost, baseline, closed-project links, out-of-sequence, dangling activities | Surface current checks now; add P6-like checks as fields become available | Now |
| Resources, roles, units, costs | Missing | No resource/cost data roles | P6 layouts include usage profiles/spreadsheets and resource/cost fields | Not core to Longest Path; add display-only fields through flexible columns first | Later |
| Activity steps | Missing | No step roles | P6 supports activity steps and weighted milestones | Display through flexible fields only unless a specific step visual is requested | Later |
| Issues, risks, thresholds, documents | Missing | No roles | P6 has issue/risk/document workflows | Avoid workflow replication; allow tooltip/display fields | Avoid |
| Direct editing of activity dates/durations/relationships | Not applicable in Power BI | Visual is read-only apart from visual state; no writeback privilege | P6 lets users edit schedule data | Do not implement direct P6 editing in this custom visual | Avoid |
| Layout save/import/export | Partially supported | Power BI formatting model and persisted state | P6 has saved/imported/exported layouts | Add visual presets, but rely on Power BI report/theme/bookmark persistence | Later |
| Copy/export | Supported | Clipboard exporter, HTML copy, PDF export, WBS export paths | P6 supports copying/exporting layouts and publishing | Current support is good; add diagnostics/path list to exports | Now |
| Accessibility and high contrast | Supported, pending Desktop validation | ARIA, keyboard, canvas fallback, high contrast handling | P6 documentation baseline is not an accessibility target for this custom visual | Validate packaged visual behaviour in Power BI Desktop | Now |
| Power BI cross-filtering and selection | Better than P6 for this use case | Selection manager and host tooltip integration | Native P6 layouts are not Power BI report visuals | Keep this advantage; ensure new roles do not break selection identity | Now |

## Improvement Backlog

### Now

#### 1. Surface Schedule Health and CPM Confidence

Current code already builds useful `DataQualityInfo`. The next step should be to expose it clearly in the UI.

Recommended behaviour:

- Add a schedule health badge in the header or status rail.
- Show row count, possible 30,000-row truncation, duplicate/conflicting task rows, missing predecessors, circular paths, invalid raw dates, invalid visual dates, relationship count, relationship free-float availability, and CPM-safe status.
- Explain when Longest Path is using relationship free float versus date-derived approximation.
- Add export metadata so copied/HTML/PDF outputs identify whether the path was CPM-safe.

Affected surfaces:

- `src/visual.ts`: UI status, tooltip/help content, export metadata.
- `src/components/Header.ts`: optional status badge.
- `src/data/Interfaces.ts`: possibly add severity/summary helpers.
- `tests/data/DataProcessor.test.ts`: extend quality scenarios if needed.
- `tests/settings/VisualSettings.test.ts` or component tests: header/help text.
- Manual validation: Power BI Desktop, empty data view, high contrast, keyboard focus, exports.

Risk: low. Most data exists already; the main risk is cluttering the header.

#### 2. Add Flexible P6 Display Columns

P6 Activity Table parity needs a generic way to show extra fields. Adding one role per P6 field would make `capabilities.json` heavy and still incomplete.

Recommended design:

- Add a `displayColumns` field well that accepts multiple grouping or measure fields.
- Preserve field order from the data view.
- Store display name, raw value, formatted value, type hint, and query name per task.
- Let users show/hide bound display fields in a format-pane list or simple priority order.
- Include these fields in copy/HTML/PDF exports.
- Use display fields as candidates for bar labels and relationship/tooltips later.

Affected surfaces:

- `capabilities.json`: new role and data mapping.
- `src/data/Interfaces.ts`: `Task.displayFields`.
- `src/data/DataProcessor.ts`: ordered field extraction and duplicate-row consolidation rules.
- `src/settings.ts`: display column settings and widths.
- `src/visual.ts`: column layout, cell rendering, export paths, tooltips.
- `tests/data/DataProcessor.test.ts`, `tests/utils/ColumnLayout.test.ts`, export tests.
- Manual validation: field-well persistence after adding/removing fields in Power BI Desktop.

Risk: medium. It touches data mapping, layout, export, and Power BI field persistence.

#### 3. Upgrade Activity Code/UDF Colouring and Filtering

The current `legend` role is useful but too narrow for P6-style layouts.

Recommended design:

- Keep `legend` as the simple colour-by role.
- Add optional category/filter fields through `displayColumns` or a dedicated `categoryFields` role.
- Allow multiple selected category values at once.
- Add quick filters for category, WBS, float band, look-ahead, and status when fields exist.
- Keep colour rules constrained: one active colour-by field at a time to avoid ambiguity.

Affected surfaces:

- `capabilities.json`: optional category fields if not covered by `displayColumns`.
- `src/data/DataProcessor.ts`: category extraction.
- `src/settings.ts`: colour-by and filter settings.
- `src/visual.ts`: legend/filter state, persisted state, filtering pipeline.
- `tests/utils/VisualState.test.ts`: persisted filter/category state.
- Manual validation: slicer interactions, bookmarks, report themes.

Risk: medium. Filtering state can become complex when combined with WBS collapse, task search, and selected path tracing.

#### 4. Add Relationship Diagnostics

Relationship diagnostics would close a major Trace Logic gap and help users trust Longest Path decisions.

Recommended behaviour:

- On connector hover or selected task, show predecessor ID/name, successor ID/name, relationship type, lag, relationship free float, inferred relationship float, driving/non-driving status, and whether free float was supplied or approximated.
- Add a relationship list for selected task: predecessors and successors grouped by driving status.
- Add warnings for missing relationship free float, missing predecessor task, invalid relationship type fallback, and unusually long/negative lag.

Affected surfaces:

- `src/data/Interfaces.ts`: relationship diagnostic fields.
- `src/data/DataProcessor.ts`: preserve source/raw values.
- `src/utils/RelationshipLogic.ts`: helper labels/severity.
- `src/visual.ts`: tooltips/panel/header message.
- Tests for relationship parsing and diagnostics.
- Manual validation: tooltip service in Power BI Desktop and high contrast.

Risk: low to medium. Most relationship fields are already in the model.

#### 5. Add Progress and Status Field Foundation

Progress line and progress spotlight need real progress data. Implement the field foundation before drawing new progress overlays.

Recommended roles:

- `actualStartDate`
- `actualFinishDate`
- `remainingStartDate`
- `remainingFinishDate`
- `percentComplete`
- `physicalPercentComplete`
- `status`
- `calendar`
- `constraintType`
- `constraintDate`

Start with parsing and display/check usage. Do not recalculate the schedule.

Affected surfaces:

- `capabilities.json`: roles and mappings.
- `src/data/Interfaces.ts`: task fields.
- `src/data/DataProcessor.ts`: parsing, validation, duplicate handling.
- `src/settings.ts`: optional display/check settings.
- `src/visual.ts`: tooltips, status indicators, optional columns.
- Tests: data parsing, duplicate row handling, export, visual settings.
- Manual validation: Power BI field binding, date formatting, null handling.

Risk: medium. More roles increase field-well complexity, but they unlock multiple P6 parity items.

### Next

#### 6. P6-Style Built-In Bar Definitions

Do not start with a fully generic P6 Bars dialog. Start with a constrained list of built-in bar types:

- Current.
- Critical.
- Near-critical.
- Baseline.
- Previous update.
- Actual.
- Remaining.
- Float/negative float indicator.

Recommended settings:

- Show/hide.
- Colour.
- Height.
- Vertical row/offset.
- Label position.
- Optional field-driven label.
- Include in collapsed WBS summary or not.

Affected surfaces: `capabilities.json`, `settings.ts`, `visual.ts`, rendering helpers, export, tests, and Desktop validation.

Risk: medium to high. Bar layering affects SVG, canvas, WBS summary, hit testing, labels, and exports.

#### 7. P6-Style Progress Line

Implemented first pass: finish-variance mode is now available without new data roles. It uses the existing Data Date, Finish, Baseline Finish, and Previous Update Finish fields.

Current behaviour:

- Reference source: Baseline Finish or Previous Update Finish.
- Formula: `progressLineDate = Data Date - (Finish - Reference Finish)`.
- Later-than-reference finishes bend left of the Data Date.
- Earlier-than-reference finishes bend right of the Data Date.
- Visible WBS summary rows can draw their own summary points from summary Finish versus summary Baseline/Previous Update Finish.
- The same overlay is drawn in SVG and canvas rendering modes.

Remaining P6 parity still needs progress/status fields.

Recommended options:

- Additional variance modes: current start versus baseline start.
- Progress point line: percent complete or remaining duration.
- Thickness and colour settings.
- Data-date reference label.
- Behind/on/ahead schedule interpretation in tooltip/help text.

Affected surfaces for remaining work: data model, rendering, tooltips, tests, high contrast, export.

Risk: medium. The first-pass finish-variance mode is bounded and does not recalculate the schedule, but progress-point interpretation can be misleading without complete progress fields.

#### 8. Progress Spotlight Mode

The visual already has look-ahead. A P6-style Progress Spotlight should be an explicit mode layered on top of it.

Recommended behaviour:

- Use data date as the start.
- Let the user choose next date/window.
- Highlight or filter activities due to start/finish within the update period.
- If actual/status fields exist, separate "requires update", "already updated", and "late" activities.

Affected surfaces: look-ahead settings, header control text, filtering pipeline, task styling, help content, tests.

Risk: low to medium if built on the existing look-ahead pipeline.

#### 9. Trace Logic Enhancements

Recommended additions:

- Depth limit: 1, 2, 3, all.
- Relationship type filters.
- Driving-only toggle.
- Predecessor/successor count chips.
- Path count selector with clear truncation messaging.
- Optional side panel for selected task logic.

Affected surfaces: path selection settings, header, visual filtering, connector rendering, diagnostics, tests.

Risk: medium. Trace filtering already combines with search, WBS, legend, and look-ahead.

#### 10. Multiple Float Path Report and Export

Recommended output:

- Path number.
- Terminal activity.
- Path span.
- Number of tasks and relationships.
- Whether path was selected by free float, total float, or longest elapsed span.
- Truncation and tie warnings.
- Export to copy/HTML/PDF.

Affected surfaces: path storage, header/panel, export, tests.

Risk: medium. Avoid claiming exact P6 equivalence unless the algorithm and inputs match P6's selected path option.

#### 11. Visual Presets

Recommended presets:

- Driving Path Review.
- P6 Classic.
- Look-Ahead Review.
- Baseline Variance.
- Previous Update Compare.
- Data Quality Review.

These should change formatting state only. They should not mutate report data.

Affected surfaces: settings, persisted state, header/help, tests, Desktop validation.

Risk: low to medium. The main risk is unexpected formatting changes in existing reports.

### Later

#### 12. Curtains and Time-Window Annotations

Recommended design:

- Data-driven curtain fields: label, start, finish, colour/category.
- No freeform drawing inside Power BI.
- Include in exports.

Use cases: possession windows, commissioning windows, shutdown periods, reporting periods, outage windows.

Risk: medium. Curtain rendering must not obscure dense schedules.

#### 13. Text and Notebook Annotations

Recommended design:

- Use bound data fields for annotation text.
- Allow label placement relative to the activity bar.
- Truncate safely with tooltip expansion.
- Include in accessible labels and exports.

Risk: medium. Dense annotation text can quickly make a schedule unreadable.

#### 14. Calendar-Aware Indicators

Recommended approach:

- Add display/filter/check support for calendar assignment.
- Optionally highlight mixed-calendar paths or calendar changes.
- Do not implement a working-time engine unless a proven library and complete calendar data are supplied.

Risk: high if positioned as schedule recalculation; medium if kept as an indicator.

#### 15. Constraint and Actual/Remaining Variance Overlays

Recommended behaviour:

- Constraint symbols or badges.
- Actual and remaining bars.
- Baseline variance labels.
- Late-start/late-finish indicators if supplied.

Risk: medium. Requires careful semantics and complete imported fields.

#### 16. Resource and Cost Context

Recommended approach:

- First support resources/costs as display columns/tooltips/export fields.
- Add simple category/group/colour support if users bind those fields.
- Avoid P6 resource usage histogram/spreadsheet replication unless explicitly requested.

Risk: medium to high if it expands beyond the Longest Path purpose.

### Avoid

Avoid these unless the product scope changes:

- Rebuilding P6's scheduling engine inside the visual.
- Direct P6 editing or writeback from Power BI.
- Reproducing the entire P6 Bars dialog as a fully generic engine before simpler built-in bar definitions prove useful.
- Adding dozens of one-off P6 field roles instead of a flexible display/category model.
- Adding external web or network dependencies.
- Claiming calendar-aware CPM results without complete calendar logic and validation.
- Hiding data-quality uncertainty when row truncation, missing predecessors, missing relationship free float, or circular paths are present.

## Recommended Roadmap

### Short Term: Parity Foundation and Trust

1. Surface schedule health and CPM confidence.
2. Add flexible display columns.
3. Add relationship diagnostics.
4. Tighten export metadata for path mode, selected path, visible filters, WBS state, and data-quality warnings.
5. Validate accessibility and high contrast in Power BI Desktop.

Expected value: users can compare the visual against P6 layouts with confidence and see why a path is being marked critical.

### Medium Term: P6-Style Review Enhancements

1. Add progress/status roles.
2. Add constrained built-in bar definitions.
3. Add progress spotlight mode.
4. Add progress line rendering.
5. Add Trace Logic depth/path controls.
6. Add path list/report/export.

Expected value: the visual moves from "critical path Gantt" to "P6 schedule review cockpit".

### Longer Term: Strategic Features

1. Data-driven curtains and annotations.
2. Calendar/constraint indicators.
3. Resource/cost display context.
4. Visual presets for common schedule review workflows.
5. Optional report-page integration patterns for detailed task/relationship drill-through.

Expected value: richer executive and planner review workflows without pretending to be P6 itself.

## Implementation Notes by Subsystem

### `capabilities.json`

Likely additions:

- `displayColumns`: multiple arbitrary P6 fields for table display/export/tooltips.
- `categoryFields` or reuse `displayColumns` for filterable categories.
- Progress/status roles: actuals, remaining, percent complete, status.
- Optional constraint/calendar roles.
- Optional curtain/annotation roles later.

Risks:

- Field-well complexity.
- Data view role ordering.
- Backwards compatibility with existing reports.
- Format-pane persistence after adding/removing fields.

Validation:

- Import packaged visual into Power BI Desktop.
- Bind/unbind/reorder fields.
- Save, close, reopen, and confirm field-well state persists.
- Confirm existing reports with old role bindings still load.

### `src/settings.ts`

Likely additions:

- Schedule health card.
- Display column settings.
- Relationship diagnostics settings.
- Progress line card.
- Progress spotlight card or extension of look-ahead.
- Bar definition card for constrained built-in bars.
- Annotation/curtain settings later.

Risks:

- Formatting model bloat.
- Too many controls in one pane.
- Hidden settings becoming stale when fields are not bound.

Validation:

- Unit tests for defaults and format model cards.
- Manual Desktop checks for visibility toggles and reset-to-default behaviour.

### `src/data/Interfaces.ts`

Likely additions:

- `Task.displayFields`.
- Progress/status properties.
- Constraint/calendar properties.
- Relationship diagnostic/source metadata.
- Curtain/annotation interfaces later.

Risks:

- Large task objects for big schedules.
- Export/render paths assuming fixed fields only.

Validation:

- Stress tests with many display fields and 30,000 rows.

### `src/data/DataProcessor.ts`

Likely additions:

- Generic ordered field extraction.
- Progress/status parsing.
- Constraint/calendar parsing.
- Richer schedule health checks.
- Relationship diagnostic source tracking.

Risks:

- Power BI metadata/table column drift.
- Duplicate task row consolidation rules for arbitrary fields.
- Numeric/date/string formatting consistency.

Validation:

- Unit tests with metadata drift, duplicate rows, null values, date values, numeric values, text values, and mixed types.

### `src/visual.ts`

Likely additions:

- Health badge/panel.
- Flexible table columns.
- Relationship diagnostics UI.
- Progress line and progress spotlight rendering.
- Built-in configurable bars.
- More export metadata.

Risks:

- Rendering complexity across SVG and canvas.
- Hit testing and accessible fallback drift.
- Header overcrowding.
- Combined filter state becoming difficult to reason about.

Validation:

- Unit tests where possible.
- Manual checks in Desktop for dense and sparse schedules, small and large viewports, high contrast, keyboard navigation, and export/copy output.

### `src/components/Header.ts`

Likely additions:

- Schedule health badge.
- Diagnostics entry point.
- Progress spotlight control.
- Path list/report entry point.

Risks:

- Responsive overflow regressions.
- ARIA/focus regressions.

Validation:

- Header layout tests.
- Keyboard and screen reader spot checks.

### `src/utils/*`

Likely additions:

- Schedule health check helpers.
- Relationship diagnostic formatting.
- Display field formatting helpers.
- Progress line geometry helpers.

Risks:

- Duplicating logic already in `visual.ts`.

Validation:

- Keep calculation-heavy logic in testable utilities rather than embedding everything in render code.

### Tests

Recommended test additions:

- DataProcessor tests for flexible display fields.
- DataProcessor tests for progress/status/constraint/calendar parsing.
- Relationship diagnostics tests.
- Schedule health threshold tests for P6 Check Schedule-inspired checks.
- VisualSettings tests for new format cards.
- ColumnLayout tests for dynamic display columns.
- HeaderLayout tests for any new controls.
- VisualState tests for persisted filters/path/diagnostic settings.
- Export tests for dynamic columns, diagnostics, and path metadata.
- Stress tests with many display fields and many relationships.

## P6 Check Schedule Opportunity

P6's Check Schedule report is a useful model, but not all checks are possible with current roles.

### Possible Now

These can be surfaced with current data:

- Possible row truncation.
- Missing predecessors.
- Circular path detection.
- Invalid raw and visual date ranges.
- Duplicate/conflicting task rows.
- Relationship count.
- Relationship free-float coverage.
- Negative lag.
- Positive lag.
- Long lag, using configurable threshold.
- Relationship type distribution.
- Large float, using configurable threshold when total float exists.
- Negative float when total float exists.
- Baseline missing when baseline roles are expected.
- Late finish versus baseline finish when both dates exist.
- Dangling starts and finishes, with caveats for project start/end and external links.

### Needs New Roles

These require new data fields before they can be credible:

- Hard constraints and soft constraints.
- Large remaining duration.
- Invalid progress before data date.
- Invalid progress after data date.
- Invalid progress dates.
- Out-of-sequence progress.
- Resource/cost missing.
- Links to closed projects.
- Baseline Execution Index.
- Calendar-related checks.

### Should Stay Out of Scope

These should not be implemented as full P6 equivalents:

- Rescheduling.
- Resource levelling.
- Calendar-based recalculation.
- Writing corrected logic back to P6.

## Power BI Constraint Notes

This visual should explicitly communicate these constraints:

- It consumes imported Power BI data. It does not edit P6.
- It is not a scheduling engine and should not recalculate the P6 schedule.
- Longest Path confidence depends on complete task and relationship rows, reliable relationship free float, valid dates, and no row truncation.
- The visual has a 30,000-row data mapping cap in `capabilities.json`.
- Format-pane and field-well changes must be validated in Power BI Desktop, not just TypeScript tests.
- SVG and canvas paths both need validation when rendering changes are made.
- Export/copy output represents the current visual state, not a native P6 layout export.

## Acceptance Criteria for Future Implementation

For each new feature, require:

- Role and format-pane alignment between `capabilities.json`, `settings.ts`, data parsing, rendering, and tests.
- Backwards compatibility with existing reports.
- Null/blank/malformed data handling.
- SVG and canvas rendering behaviour where applicable.
- Keyboard-accessible controls and high-contrast-safe colours.
- Export/copy coverage when the feature affects visible data.
- Desktop validation notes for field persistence, bookmarks, themes, and packaging.
- No claim of P6 schedule recalculation unless a real scheduling engine and complete calendar/constraint model exist.

## Validation Performed for This Review

Performed:

- `git status --short` before edits: clean.
- Static repository inspection of the files listed in this report.
- Targeted `rg` scans for data roles, settings cards, processing, Longest Path, relationship logic, look-ahead, WBS, exports, accessibility, and tests.
- Official Oracle P6 Professional v26 documentation review through Oracle documentation pages linked above.

Not performed:

- Power BI Desktop validation.
- `.pbiviz` package import validation.
- Browser/screenshot validation.
- Runtime rendering validation.
- Manual keyboard/screen reader validation.
- Manual comparison against a supplied company-specific P6 layout.

## Final Recommendation

Treat `LongestPathVisual` as a P6 schedule review and assurance visual, not as a P6 replacement. The current codebase already has the hard foundation: P6 relationship semantics, relationship free-float handling, WBS support, comparison bars, look-ahead, export, performance controls, and accessibility structure.

The best next investment is to make the visual more layout-aware and trust-aware:

1. Expose schedule health and CPM confidence.
2. Add flexible Activity Table-style display columns.
3. Add richer activity-code/UDF filtering and colour rules.
4. Add relationship diagnostics and Trace Logic depth controls.
5. Add progress/status fields, then progress spotlight and progress line.

That sequence closes the highest-value P6 parity gaps while staying inside Power BI custom visual constraints.
