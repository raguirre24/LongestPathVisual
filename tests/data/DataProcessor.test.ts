/**
 * Unit tests for DataProcessor
 *
 * Strategy: We build mock Power BI DataView objects and pass them through
 * DataProcessor.processData() to validate the transformation logic.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DataProcessor, ProcessedData } from '../../src/data/DataProcessor';
import powerbi from 'powerbi-visuals-api';
import DataView = powerbi.DataView;

// ---------------------------------------------------------------------------
// Mock IVisualHost – minimal stub for DataProcessor's usage
// ---------------------------------------------------------------------------
function createMockHost(): powerbi.extensibility.visual.IVisualHost {
    return {
        createSelectionIdBuilder: () => ({
            withTable: () => ({
                createSelectionId: () => ({ getKey: () => 'mock-id' } as any),
            }),
            withCategory: () => ({ createSelectionId: () => ({} as any) }),
            withMeasure: () => ({ createSelectionId: () => ({} as any) }),
            withMatrixNode: () => ({ createSelectionId: () => ({} as any) }),
            withSeries: () => ({ createSelectionId: () => ({} as any) }),
            createSelectionId: () => ({} as any),
        } as any),
        colorPalette: {
            getColor: (value: string) => ({ value: '#cccccc' }),
        } as any,
        // Stubs for unused host methods
        createSelectionManager: () => ({} as any),
        hostCapabilities: {} as any,
        locale: 'en-US',
        allowInteractions: true,
        applyJsonFilter: () => { },
        persistProperties: () => { },
        tooltipService: {} as any,
        telemetry: {} as any,
        authenticationService: {} as any,
        storageService: {} as any,
        eventService: {} as any,
        displayWarningIcon: () => { },
        downloadService: {} as any,
        licenseManager: {} as any,
        storageV2Service: {} as any,
        switchFocusModeState: () => { },
        hostEnv: {} as any,
        drill: () => { },
        launchUrl: () => { },
        fetchMoreData: () => false,
        refreshHostData: () => { },
        createLocalizationManager: () => ({} as any),
        webAccessService: {} as any,
        acquireAADTokenService: {} as any,
        subSelectionService: {} as any,
        openModalDialog: () => ({} as any),
    } as any;
}

// ---------------------------------------------------------------------------
// DataView builder helpers
// ---------------------------------------------------------------------------

interface ColumnDef {
    displayName: string;
    queryName: string;
    roles: { [role: string]: boolean };
    type?: any;
    index?: number;
}

function buildDataView(columns: ColumnDef[], rows: any[][]): DataView {
    return {
        metadata: {
            columns: columns.map((col, idx) => ({
                displayName: col.displayName,
                queryName: col.queryName,
                roles: col.roles,
                type: col.type || {},
                index: col.index ?? idx,
            })),
        },
        table: {
            columns: columns.map((col, idx) => ({
                displayName: col.displayName,
                queryName: col.queryName,
                roles: col.roles,
                type: col.type || {},
                index: col.index ?? idx,
            })),
            rows: rows,
        },
    } as any;
}

/** Minimal settings stub */
function createMockSettings(): any {
    return {
        criticalPath: {
            calculationMode: { value: { value: 'longestPath' } },
        },
        legend: {
            sortOrder: { value: { value: 'none' } },
        },
        wbsGrouping: {
            defaultExpanded: { value: true },
            expandCollapseAll: { value: true },
        },
    };
}

// Standard columns for most tests
const STANDARD_COLUMNS: ColumnDef[] = [
    { displayName: 'Task ID', queryName: 'Table[TaskID]', roles: { taskId: true } },
    { displayName: 'Task Name', queryName: 'Table[TaskName]', roles: { taskName: true } },
    { displayName: 'Duration', queryName: 'Table[Duration]', roles: { duration: true } },
    { displayName: 'Start Date', queryName: 'Table[StartDate]', roles: { startDate: true } },
    { displayName: 'Finish Date', queryName: 'Table[FinishDate]', roles: { finishDate: true } },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DataProcessor', () => {
    let processor: DataProcessor;
    let settings: any;

    beforeEach(() => {
        processor = new DataProcessor(createMockHost());
        settings = createMockSettings();
    });

    // -----------------------------------------------------------------------
    // Empty / edge-case data
    // -----------------------------------------------------------------------
    describe('empty and invalid data', () => {
        it('returns empty ProcessedData when dataView has no rows', () => {
            const dv = buildDataView(STANDARD_COLUMNS, []);
            const result = processor.processData(dv, settings, new Map(), new Set(), null, false, '#000');

            expect(result.allTasksData.length).toBe(0);
            expect(result.relationships.length).toBe(0);
            expect(result.taskIdToTask.size).toBe(0);
        });

        it('returns empty when Task ID column is missing', () => {
            const columns: ColumnDef[] = [
                { displayName: 'Name', queryName: 'T[Name]', roles: { taskName: true } },
            ];
            const dv = buildDataView(columns, [['Task A']]);
            const result = processor.processData(dv, settings, new Map(), new Set(), null, false, '#000');

            expect(result.allTasksData.length).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Single task parsing
    // -----------------------------------------------------------------------
    describe('single task parsing', () => {
        it('correctly parses a single task with all standard fields', () => {
            const startDate = new Date('2025-01-01');
            const finishDate = new Date('2025-01-10');
            const rows = [['T1', 'Foundation Work', 10, startDate, finishDate]];
            const dv = buildDataView(STANDARD_COLUMNS, rows);

            const result = processor.processData(dv, settings, new Map(), new Set(), null, false, '#000');

            expect(result.allTasksData.length).toBe(1);
            const task = result.allTasksData[0];
            expect(task.internalId).toBe('T1');
            expect(task.name).toBe('Foundation Work');
            expect(task.duration).toBe(10);
            expect(task.startDate?.toISOString()).toBe(startDate.toISOString());
            expect(task.finishDate?.toISOString()).toBe(finishDate.toISOString());
        });

        it('handles numeric task IDs', () => {
            const rows = [[42, 'Task Forty-Two', 5, new Date('2025-03-01'), new Date('2025-03-06')]];
            const dv = buildDataView(STANDARD_COLUMNS, rows);
            const result = processor.processData(dv, settings, new Map(), new Set(), null, false, '#000');

            expect(result.allTasksData.length).toBe(1);
            expect(result.allTasksData[0].internalId).toBe('42');
        });

        it('skips rows with null task ID', () => {
            const rows = [
                ['T1', 'Valid Task', 5, new Date('2025-01-01'), new Date('2025-01-06')],
                [null, 'Invalid Task', 3, new Date('2025-01-01'), new Date('2025-01-04')],
            ];
            const dv = buildDataView(STANDARD_COLUMNS, rows);
            const result = processor.processData(dv, settings, new Map(), new Set(), null, false, '#000');

            expect(result.allTasksData.length).toBe(1);
            expect(result.allTasksData[0].internalId).toBe('T1');
        });

        it('handles milestone tasks (duration 0)', () => {
            const rows = [['M1', 'Milestone A', 0, new Date('2025-06-01'), new Date('2025-06-01')]];
            const dv = buildDataView(STANDARD_COLUMNS, rows);
            const result = processor.processData(dv, settings, new Map(), new Set(), null, false, '#000');

            expect(result.allTasksData[0].duration).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Predecessor relationships
    // -----------------------------------------------------------------------
    describe('predecessor relationships', () => {
        const COLUMNS_WITH_PRED: ColumnDef[] = [
            ...STANDARD_COLUMNS,
            { displayName: 'Predecessor', queryName: 'Table[PredID]', roles: { predecessorId: true } },
            { displayName: 'Rel Type', queryName: 'Table[RelType]', roles: { relationshipType: true } },
            { displayName: 'Lag', queryName: 'Table[Lag]', roles: { relationshipLag: true } },
        ];

        it('creates a relationship between two tasks', () => {
            const rows = [
                ['T1', 'Task A', 5, new Date('2025-01-01'), new Date('2025-01-06'), null, null, null],
                ['T2', 'Task B', 3, new Date('2025-01-07'), new Date('2025-01-10'), 'T1', 'FS', 0],
            ];
            const dv = buildDataView(COLUMNS_WITH_PRED, rows);
            const result = processor.processData(dv, settings, new Map(), new Set(), null, false, '#000');

            expect(result.allTasksData.length).toBe(2);
            expect(result.relationships.length).toBe(1);
            expect(result.relationships[0].predecessorId).toBe('T1');
            expect(result.relationships[0].successorId).toBe('T2');
            expect(result.relationships[0].type).toBe('FS');
        });

        it('defaults relationship type to FS when not specified', () => {
            const rows = [
                ['T1', 'Task A', 5, new Date('2025-01-01'), new Date('2025-01-06'), null, null, null],
                ['T2', 'Task B', 3, new Date('2025-01-07'), new Date('2025-01-10'), 'T1', null, null],
            ];
            const dv = buildDataView(COLUMNS_WITH_PRED, rows);
            const result = processor.processData(dv, settings, new Map(), new Set(), null, false, '#000');

            expect(result.relationships[0].type).toBe('FS');
        });

        it('handles all four relationship types (FS, SS, FF, SF)', () => {
            const types = ['FS', 'SS', 'FF', 'SF'];
            for (const relType of types) {
                const rows = [
                    ['T1', 'Task A', 5, new Date('2025-01-01'), new Date('2025-01-06'), null, null, null],
                    ['T2', 'Task B', 3, new Date('2025-01-07'), new Date('2025-01-10'), 'T1', relType, 0],
                ];
                const dv = buildDataView(COLUMNS_WITH_PRED, rows);
                const result = processor.processData(dv, settings, new Map(), new Set(), null, false, '#000');

                expect(result.relationships[0].type).toBe(relType);
            }
        });

        it('defaults invalid relationship type to FS', () => {
            const rows = [
                ['T1', 'Task A', 5, new Date('2025-01-01'), new Date('2025-01-06'), null, null, null],
                ['T2', 'Task B', 3, new Date('2025-01-07'), new Date('2025-01-10'), 'T1', 'INVALID', null],
            ];
            const dv = buildDataView(COLUMNS_WITH_PRED, rows);
            const result = processor.processData(dv, settings, new Map(), new Set(), null, false, '#000');

            expect(result.relationships[0].type).toBe('FS');
        });

        it('parses relationship lag values', () => {
            const rows = [
                ['T1', 'Task A', 5, new Date('2025-01-01'), new Date('2025-01-06'), null, null, null],
                ['T2', 'Task B', 3, new Date('2025-01-07'), new Date('2025-01-10'), 'T1', 'FS', 2],
            ];
            const dv = buildDataView(COLUMNS_WITH_PRED, rows);
            const result = processor.processData(dv, settings, new Map(), new Set(), null, false, '#000');

            expect(result.relationships[0].lag).toBe(2);
        });

        it('deduplicates relationships when same predecessor appears in multiple rows', () => {
            // Two rows for T2, both referencing T1
            const rows = [
                ['T1', 'Task A', 5, new Date('2025-01-01'), new Date('2025-01-06'), null, null, null],
                ['T2', 'Task B', 3, new Date('2025-01-07'), new Date('2025-01-10'), 'T1', 'FS', 0],
                ['T2', 'Task B', 3, new Date('2025-01-07'), new Date('2025-01-10'), 'T1', 'FS', 0],
            ];
            const dv = buildDataView(COLUMNS_WITH_PRED, rows);
            const result = processor.processData(dv, settings, new Map(), new Set(), null, false, '#000');

            expect(result.relationships.length).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Synthetic tasks
    // -----------------------------------------------------------------------
    describe('synthetic tasks', () => {
        it('creates synthetic task for predecessors not in data', () => {
            const columns: ColumnDef[] = [
                ...STANDARD_COLUMNS,
                { displayName: 'Predecessor', queryName: 'Table[PredID]', roles: { predecessorId: true } },
            ];
            const rows = [
                ['T1', 'Task A', 5, new Date('2025-01-01'), new Date('2025-01-06'), 'EXTERNAL_PRED'],
            ];
            const dv = buildDataView(columns, rows);
            const result = processor.processData(dv, settings, new Map(), new Set(), null, false, '#000');

            // Should have 2 tasks: T1 (real) + EXTERNAL_PRED (synthetic)
            expect(result.allTasksData.length).toBe(2);
            const syntheticTask = result.taskIdToTask.get('EXTERNAL_PRED');
            expect(syntheticTask).toBeDefined();
            expect(syntheticTask!.type).toBe('Synthetic');
            expect(syntheticTask!.name).toBe('EXTERNAL_PRED');
        });
    });

    // -----------------------------------------------------------------------
    // WBS data
    // -----------------------------------------------------------------------
    describe('WBS data', () => {
        it('populates wbsLevels on tasks when WBS columns are present', () => {
            const columns: ColumnDef[] = [
                ...STANDARD_COLUMNS,
                { displayName: 'WBS L1', queryName: 'Table[WBS1]', roles: { wbsLevels: true } },
                { displayName: 'WBS L2', queryName: 'Table[WBS2]', roles: { wbsLevels: true } },
            ];
            const rows = [
                ['T1', 'Task A', 5, new Date('2025-01-01'), new Date('2025-01-06'), 'Phase 1', 'Subphase A'],
            ];
            const dv = buildDataView(columns, rows);
            const result = processor.processData(dv, settings, new Map(), new Set(), null, false, '#000');

            const task = result.allTasksData[0];
            expect(task.wbsLevels).toEqual(['Phase 1', 'Subphase A']);
            expect(task.wbsGroupId).toBe('L1:Phase 1|L2:Subphase A');
            expect(task.wbsIndentLevel).toBe(1);
        });

        it('sets wbsDataExists when tasks have WBS data', () => {
            const columns: ColumnDef[] = [
                ...STANDARD_COLUMNS,
                { displayName: 'WBS L1', queryName: 'Table[WBS1]', roles: { wbsLevels: true } },
            ];
            const rows = [
                ['T1', 'Task A', 5, new Date('2025-01-01'), new Date('2025-01-06'), 'Phase 1'],
            ];
            const dv = buildDataView(columns, rows);
            const result = processor.processData(dv, settings, new Map(), new Set(), null, false, '#000');

            expect(result.wbsDataExists).toBe(true);
            expect(result.wbsGroups.length).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Date parsing
    // -----------------------------------------------------------------------
    describe('date parsing', () => {
        it('parses Date objects', () => {
            const date = new Date('2025-06-15T00:00:00Z');
            expect(processor.parseDate(date)).toEqual(date);
        });

        it('parses ISO date strings', () => {
            const result = processor.parseDate('2025-06-15');
            expect(result).toBeInstanceOf(Date);
            expect(result!.getFullYear()).toBe(2025);
        });

        it('returns null for null/undefined', () => {
            expect(processor.parseDate(null as any)).toBeNull();
            expect(processor.parseDate(undefined as any)).toBeNull();
        });

        it('returns null for invalid date strings', () => {
            expect(processor.parseDate('not-a-date')).toBeNull();
        });

        it('handles numeric timestamps (milliseconds)', () => {
            const ts = new Date('2025-01-01').getTime();
            const result = processor.parseDate(ts);
            expect(result).toBeInstanceOf(Date);
            expect(result!.getFullYear()).toBe(2025);
        });
    });

    // -----------------------------------------------------------------------
    // Total float handling
    // -----------------------------------------------------------------------
    describe('total float', () => {
        it('captures user-provided total float', () => {
            const columns: ColumnDef[] = [
                ...STANDARD_COLUMNS,
                { displayName: 'Total Float', queryName: 'Table[TotalFloat]', roles: { taskTotalFloat: true } },
            ];
            const rows = [
                ['T1', 'Task A', 5, new Date('2025-01-01'), new Date('2025-01-06'), 3],
            ];
            const dv = buildDataView(columns, rows);
            const result = processor.processData(dv, settings, new Map(), new Set(), null, false, '#000');

            expect(result.allTasksData[0].userProvidedTotalFloat).toBe(3);
            expect(result.hasUserProvidedFloat).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Circular dependency detection
    // -----------------------------------------------------------------------
    describe('circular dependency detection', () => {
        it('detects a simple circular dependency', () => {
            const columns: ColumnDef[] = [
                ...STANDARD_COLUMNS,
                { displayName: 'Predecessor', queryName: 'Table[PredID]', roles: { predecessorId: true } },
            ];
            // T1 → T2 → T1 (cycle)
            const rows = [
                ['T1', 'Task A', 5, new Date('2025-01-01'), new Date('2025-01-06'), 'T2'],
                ['T2', 'Task B', 3, new Date('2025-01-07'), new Date('2025-01-10'), 'T1'],
            ];
            const dv = buildDataView(columns, rows);
            const result = processor.processData(dv, settings, new Map(), new Set(), null, false, '#000');

            const cycles = (processor as any).detectCircularDependencies(
                result.allTasksData,
                result.taskIdToTask
            );
            expect(cycles.length).toBeGreaterThan(0);
        });

        it('returns empty array when no cycles exist', () => {
            const columns: ColumnDef[] = [
                ...STANDARD_COLUMNS,
                { displayName: 'Predecessor', queryName: 'Table[PredID]', roles: { predecessorId: true } },
            ];
            // T1 → T2 → T3 (no cycle)
            const rows = [
                ['T1', 'Task A', 5, new Date('2025-01-01'), new Date('2025-01-06'), null],
                ['T2', 'Task B', 3, new Date('2025-01-07'), new Date('2025-01-10'), 'T1'],
                ['T3', 'Task C', 2, new Date('2025-01-11'), new Date('2025-01-13'), 'T2'],
            ];
            const dv = buildDataView(columns, rows);
            const result = processor.processData(dv, settings, new Map(), new Set(), null, false, '#000');

            const cycles = (processor as any).detectCircularDependencies(
                result.allTasksData,
                result.taskIdToTask
            );
            expect(cycles.length).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Data validation
    // -----------------------------------------------------------------------
    describe('validateDataView', () => {
        it('returns true for valid data with required columns', () => {
            const dv = buildDataView(STANDARD_COLUMNS, [
                ['T1', 'Task A', 5, new Date('2025-01-01'), new Date('2025-01-06')],
            ]);
            expect(processor.validateDataView(dv, settings)).toBe(true);
        });

        it('returns false when taskId column is missing', () => {
            const columns: ColumnDef[] = [
                { displayName: 'Name', queryName: 'T[N]', roles: { taskName: true } },
                { displayName: 'Duration', queryName: 'T[D]', roles: { duration: true } },
                { displayName: 'Start', queryName: 'T[S]', roles: { startDate: true } },
                { displayName: 'Finish', queryName: 'T[F]', roles: { finishDate: true } },
            ];
            const dv = buildDataView(columns, [['A', 5, new Date(), new Date()]]);
            expect(processor.validateDataView(dv, settings)).toBe(false);
        });

        it('returns false when duration is missing in longestPath mode', () => {
            const columns: ColumnDef[] = [
                { displayName: 'ID', queryName: 'T[ID]', roles: { taskId: true } },
                { displayName: 'Start', queryName: 'T[S]', roles: { startDate: true } },
                { displayName: 'Finish', queryName: 'T[F]', roles: { finishDate: true } },
            ];
            const dv = buildDataView(columns, [['T1', new Date(), new Date()]]);
            expect(processor.validateDataView(dv, settings)).toBe(false);
        });

        it('requires totalFloat instead of duration in floatBased mode', () => {
            const floatSettings = {
                ...settings,
                criticalPath: { calculationMode: { value: { value: 'floatBased' } } },
            };
            const columns: ColumnDef[] = [
                { displayName: 'ID', queryName: 'T[ID]', roles: { taskId: true } },
                { displayName: 'Start', queryName: 'T[S]', roles: { startDate: true } },
                { displayName: 'Finish', queryName: 'T[F]', roles: { finishDate: true } },
                { displayName: 'Float', queryName: 'T[Float]', roles: { taskTotalFloat: true } },
            ];
            const dv = buildDataView(columns, [['T1', new Date(), new Date(), 0]]);
            expect(processor.validateDataView(dv, floatSettings)).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Data date extraction
    // -----------------------------------------------------------------------
    describe('data date', () => {
        it('extracts the latest data date from rows', () => {
            const columns: ColumnDef[] = [
                ...STANDARD_COLUMNS,
                { displayName: 'Data Date', queryName: 'Table[DataDate]', roles: { dataDate: true } },
            ];
            const dd1 = new Date('2025-03-01');
            const dd2 = new Date('2025-04-15');
            const rows = [
                ['T1', 'A', 5, new Date('2025-01-01'), new Date('2025-01-06'), dd1],
                ['T2', 'B', 3, new Date('2025-01-07'), new Date('2025-01-10'), dd2],
            ];
            const dv = buildDataView(columns, rows);
            const result = processor.processData(dv, settings, new Map(), new Set(), null, false, '#000');

            expect(result.dataDate).toEqual(dd2);
        });
    });
});
