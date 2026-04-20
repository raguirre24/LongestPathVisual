import powerbi from "powerbi-visuals-api";
import DataView = powerbi.DataView;

function appendHash(hash: number, value: string): number {
    let next = hash;
    for (let i = 0; i < value.length; i++) {
        next ^= value.charCodeAt(i);
        next = Math.imul(next, 16777619);
    }

    next ^= 31;
    return Math.imul(next, 16777619);
}

function getRoleSignature(roles: { [role: string]: boolean } | undefined): string {
    if (!roles) {
        return "";
    }

    return Object.keys(roles)
        .filter(role => roles[role])
        .sort()
        .join(",");
}

function getColumnSignature(column: {
    queryName?: string;
    displayName?: string;
    roles?: { [role: string]: boolean };
    index?: number;
} | undefined, fallbackIndex: number): string {
    if (!column) {
        return `missing:${fallbackIndex}`;
    }

    return [
        column.queryName ?? "",
        column.displayName ?? "",
        getRoleSignature(column.roles),
        String(column.index ?? fallbackIndex)
    ].join("|");
}

function getCellSignature(value: unknown): string {
    if (value === null) {
        return "null";
    }

    if (value === undefined) {
        return "undefined";
    }

    if (value instanceof Date) {
        return `date:${value.getTime()}`;
    }

    const valueType = typeof value;
    if (valueType === "number") {
        const numericValue = value as number;

        if (Number.isNaN(numericValue)) {
            return "number:NaN";
        }

        if (!Number.isFinite(numericValue)) {
            return `number:${numericValue > 0 ? "Infinity" : "-Infinity"}`;
        }
    }

    return `${valueType}:${String(value)}`;
}

export function buildDataSignature(dataView: DataView): string {
    const metadataColumns = dataView.metadata?.columns ?? [];
    const tableColumns = dataView.table?.columns ?? [];
    const rows = dataView.table?.rows ?? [];

    let hash = 2166136261;

    hash = appendHash(hash, `metadata:${metadataColumns.length}`);
    metadataColumns.forEach((column, index) => {
        hash = appendHash(hash, getColumnSignature(column, index));
    });

    hash = appendHash(hash, `table:${tableColumns.length}`);
    tableColumns.forEach((column, index) => {
        hash = appendHash(hash, getColumnSignature(column, index));
    });

    hash = appendHash(hash, `rows:${rows.length}`);
    rows.forEach(row => {
        hash = appendHash(hash, `row:${row?.length ?? 0}`);
        row.forEach(cell => {
            hash = appendHash(hash, getCellSignature(cell));
        });
    });

    return `${rows.length}|${metadataColumns.length}|${tableColumns.length}|${(hash >>> 0).toString(16)}`;
}
