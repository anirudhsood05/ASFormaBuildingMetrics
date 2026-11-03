import { Forma } from "forma-embedded-view-sdk/auto";

// =============================================================
// USER-DEFINED CATEGORIES
// Category definitions are shared across the Forma project; building
// assignments are stored per proposal, since proposals hold different buildings.
// =============================================================
export interface CategoryValue {
    id: string;
    name: string;
    /** sRGB hex, e.g. "#ff8c00". */
    color: string;
}

export interface Category {
    id: string;
    name: string;
    values: CategoryValue[];
}

/** categoryId → building path → valueId */
export type Assignments = Record<string, Record<string, string>>;

export const UNASSIGNED_COLOR = '#c8c8c8';

/** Default colours offered for new values, in order. */
const VALUE_PALETTE = ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#b07aa1', '#edc948', '#76b7b2', '#9c755f'];

export const paletteColor = (index: number): string => VALUE_PALETTE[index % VALUE_PALETTE.length];

export const newId = (): string => Math.random().toString(36).slice(2, 10);

/** Seeded on a project with nothing saved yet; carries over the old fixed "Use" list and colours. */
export const defaultCategories = (): Category[] => [{
    id: 'use',
    name: 'Use',
    values: [
        { id: 'residential', name: 'Residential', color: '#90ee90' },
        { id: 'commercial', name: 'Commercial/Retail', color: '#6495ed' },
        { id: 'office', name: 'Office', color: '#ba55d3' },
        { id: 'industrial', name: 'Industrial', color: '#a9a9a9' },
        { id: 'healthcare', name: 'Healthcare', color: '#dc143c' },
        { id: 'education', name: 'Education', color: '#ffd700' },
        { id: 'mixed', name: 'Mixed Use', color: '#ff8c00' },
    ],
}];

// =============================================================
// STORAGE (Forma.extensions.storage, scoped to the current project)
// =============================================================
const CATEGORIES_KEY = 'categories.json';
const assignmentsKey = (proposalId: string) => `assignments-${proposalId}.json`;

/**
 * Stable identity of the open proposal. The root URN has the shape
 * urn:adsk-forma-elements:<system>:<authcontext>:<id>:<revision> and its
 * revision changes on every edit, so only <id> is used.
 */
export const getProposalId = async (): Promise<string> => {
    const urn: string = await Forma.udm.getRootUrn();
    const parts = urn.split(':');
    const id = parts.length >= 6 ? parts[4] : urn;
    // Storage keys allow only a limited character set.
    return id.replace(/[^a-zA-Z0-9_.-]/g, '_');
};

const readJson = async (key: string): Promise<unknown> => {
    const res = await Forma.extensions.storage.getTextObject({ key });
    return res ? JSON.parse(res.data) : undefined;
};

// Writes to the same key run one after another, so quick successive edits land in order.
const pendingWrites = new Map<string, Promise<void>>();

const writeJson = (key: string, value: unknown): Promise<void> => {
    const data = JSON.stringify(value);
    const previous = pendingWrites.get(key) ?? Promise.resolve();
    const write = previous.catch(() => undefined).then(() => Forma.extensions.storage.setObject({ key, data }));
    pendingWrites.set(key, write);
    return write;
};

const isCategory = (c: any): c is Category =>
    typeof c?.id === 'string' && typeof c?.name === 'string' && Array.isArray(c?.values) &&
    c.values.every((v: any) => typeof v?.id === 'string' && typeof v?.name === 'string' && typeof v?.color === 'string');

/** Returns undefined when nothing has been saved for this project yet. */
export const loadCategories = async (): Promise<Category[] | undefined> => {
    const stored = await readJson(CATEGORIES_KEY) as { categories?: unknown } | undefined;
    if (!stored) return undefined;
    return Array.isArray(stored.categories) ? stored.categories.filter(isCategory) : undefined;
};

export const saveCategories = (categories: Category[]) =>
    writeJson(CATEGORIES_KEY, { version: 1, categories });

export const loadAssignments = async (proposalId: string): Promise<Assignments | undefined> => {
    const stored = await readJson(assignmentsKey(proposalId)) as { assignments?: unknown } | undefined;
    const a = stored?.assignments;
    return a && typeof a === 'object' ? a as Assignments : undefined;
};

export const saveAssignments = (proposalId: string, assignments: Assignments) =>
    writeJson(assignmentsKey(proposalId), { version: 1, assignments });
