import { Assignments, Category, CategoryValue, newId, paletteColor } from "./categories";

// =============================================================
// EXPORT / IMPORT TABLE
// The exported table and the importer share these headers, so a file
// exported here can be edited in Excel and imported back.
// =============================================================

/** The fields of a building that the table needs. */
export interface TableBuilding {
    path: string;
    number: number;
    height: number;
    footprintArea: number;
    floorCount: number;
    volume: number;
    north: number;
    south: number;
    east: number;
    west: number;
    totalFacadeArea: number;
    dominantOrientation: string;
}

/** Measured columns: always exported, ignored on import. */
const METRIC_HEADER = [
    'Building', 'Height (m)', 'Footprint (m²)', 'Floors (est.)', 'Volume (est., m³)',
    'North façade (m²)', 'South façade (m²)', 'East façade (m²)', 'West façade (m²)',
    'Total façade (m²)', 'Dominant orientation',
];

/** Forma's internal building path; the import matches rows on it. */
export const ID_HEADER = 'Forma ID';

const area = (n: number) => n.toFixed(1);

/** Name of the building's value in a category, or '' when unassigned. */
export const categoryValueName = (cat: Category, assignments: Assignments, path: string): string => {
    const valueId = assignments[cat.id]?.[path];
    return cat.values.find((v) => v.id === valueId)?.name ?? '';
};

export const buildExportRows = (
    buildings: TableBuilding[], categories: Category[], assignments: Assignments,
): string[][] => [
    [...METRIC_HEADER, ...categories.map((cat) => cat.name), ID_HEADER],
    ...[...buildings].sort((a, b) => a.number - b.number).map((b) => [
        `Building ${b.number}`, b.height.toFixed(1), b.footprintArea.toFixed(1),
        String(b.floorCount), b.volume.toFixed(0),
        area(b.north), area(b.south), area(b.east), area(b.west),
        area(b.totalFacadeArea), b.dominantOrientation,
        ...categories.map((cat) => categoryValueName(cat, assignments, b.path)),
        b.path,
    ]),
];

export const toCsv = (rows: string[][]): string =>
    rows.map((r) => r.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join('\r\n');

// Tab-separated text pastes straight into Excel columns.
export const toTsv = (rows: string[][]): string => rows.map((r) => r.join('\t')).join('\n');

// =============================================================
// PARSING
// =============================================================

/**
 * File bytes as text. Excel's "CSV UTF-8" is UTF-8; its plain "CSV" is
 * Windows-1252, which would otherwise garble headers such as "m²".
 */
export const decodeText = (bytes: ArrayBuffer): string => {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        return new TextDecoder('windows-1252').decode(bytes);
    }
};

/** Parses CSV, semicolon-separated or tab-separated text (delimiter taken from the header line). */
export const parseTable = (text: string): string[][] => {
    const src = text.replace(/^﻿/, '');
    const headerLine = src.split(/\r?\n/, 1)[0] ?? '';
    const occurrences = (d: string) => headerLine.split(d).length - 1;
    const delimiter = ['\t', ';'].reduce((best, d) => (occurrences(d) > occurrences(best) ? d : best), ',');

    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (inQuotes) {
            if (ch !== '"') field += ch;
            else if (src[i + 1] === '"') { field += '"'; i++; }
            else inQuotes = false;
        } else if (ch === '"' && field === '') {
            inQuotes = true;
        } else if (ch === delimiter) {
            row.push(field);
            field = '';
        } else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && src[i + 1] === '\n') i++;
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else {
            field += ch;
        }
    }
    if (field !== '' || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
};

// =============================================================
// IMPORT PLAN - computed and shown before anything changes
// =============================================================
export interface ImportSummary {
    /** Rows whose Forma ID matched a building in this proposal. */
    matchedRows: number;
    /** Buildings whose category values will actually change. */
    changedBuildings: number;
    /** Existing categories in which at least one building's value changes. */
    updatedCategories: string[];
    /** New categories, with how many values each will start with. */
    newCategories: { name: string; values: number }[];
    /** New values added to existing categories, as "Category: Value". */
    newValues: string[];
    /** Rows that matched no building, by their Building label where present. */
    unmatched: string[];
    /** Rows repeating a Forma ID seen earlier in the file (the later row wins). */
    duplicateRows: number;
}

export type ImportPlan =
    | { ok: true; categories: Category[]; assignments: Assignments; summary: ImportSummary }
    | { ok: false; error: string };

const norm = (s: string) => s.trim().toLowerCase();
const IGNORED_HEADERS = new Set(METRIC_HEADER.map(norm));

/**
 * Works out what importing `rows` would change. Category columns are matched
 * by name (an unknown column becomes a new category), cells by value name (an
 * unknown value is added). A blank cell clears the value; buildings missing
 * from the file are left as they are.
 */
export const planImport = (
    rows: string[][], buildings: { path: string }[], categories: Category[], assignments: Assignments,
): ImportPlan => {
    if (rows.length < 2) return { ok: false, error: 'The file has no data rows.' };
    const header = rows[0].map((h) => h.trim());
    const idCol = header.findIndex((h) => norm(h) === norm(ID_HEADER));
    if (idCol < 0) {
        return {
            ok: false,
            error: `No "${ID_HEADER}" column, so rows can't be matched to buildings. Export a fresh CSV from this panel, edit that, and import it.`,
        };
    }
    const labelCol = header.findIndex((h) => norm(h) === 'building');

    // Copies, so the plan never touches current state.
    const nextCategories: Category[] = categories.map((c) => ({ ...c, values: [...c.values] }));
    const columns: { col: number; category: Category }[] = [];
    const created = new Set<Category>();
    header.forEach((h, col) => {
        if (col === idCol || !h || IGNORED_HEADERS.has(norm(h))) return;
        let category = nextCategories.find((c) => norm(c.name) === norm(h));
        if (!category) {
            category = { id: newId(), name: h, values: [] };
            nextCategories.push(category);
            created.add(category);
        }
        if (!columns.some((c) => c.category === category)) columns.push({ col, category });
    });
    if (columns.length === 0) {
        return { ok: false, error: 'No category columns to import. Fill in a category column (for example "Phase") and try again.' };
    }

    const known = new Set(buildings.map((b) => b.path));
    const next: Assignments = { ...assignments };
    for (const { category } of columns) next[category.id] = { ...(assignments[category.id] ?? {}) };

    const newValues: string[] = [];
    const unmatched: string[] = [];
    const seen = new Set<string>();
    let duplicateRows = 0;
    for (const row of rows.slice(1)) {
        const path = (row[idCol] ?? '').trim();
        if (!known.has(path)) {
            unmatched.push((labelCol >= 0 ? row[labelCol]?.trim() : '') || path || '(no ID)');
            continue;
        }
        if (seen.has(path)) duplicateRows++;
        seen.add(path);
        for (const { col, category } of columns) {
            const cell = (row[col] ?? '').trim();
            if (!cell) {
                delete next[category.id][path];
                continue;
            }
            let value: CategoryValue | undefined = category.values.find((v) => norm(v.name) === norm(cell));
            if (!value) {
                value = { id: newId(), name: cell, color: paletteColor(category.values.length) };
                category.values.push(value);
                if (!created.has(category)) newValues.push(`${category.name}: ${cell}`);
            }
            next[category.id][path] = value.id;
        }
    }

    const changes = (category: Category, path: string) => assignments[category.id]?.[path] !== next[category.id][path];
    const changedBuildings = buildings.filter((b) => columns.some(({ category }) => changes(category, b.path))).length;

    return {
        ok: true,
        categories: nextCategories,
        assignments: next,
        summary: {
            matchedRows: seen.size,
            changedBuildings,
            updatedCategories: columns
                .filter(({ category }) => !created.has(category) && buildings.some((b) => changes(category, b.path)))
                .map(({ category }) => category.name),
            newCategories: [...created].map((c) => ({ name: c.name, values: c.values.length })),
            newValues,
            unmatched,
            duplicateRows,
        },
    };
};
