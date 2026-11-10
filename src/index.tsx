import { render } from 'preact';
import './style.css';
import { Forma } from "forma-embedded-view-sdk/auto";
import { useState, useEffect, useMemo, useRef } from "preact/hooks";
import {
    Assignments, Category, CategoryValue, UNASSIGNED_COLOR, defaultCategories, getProposalId,
    loadAssignments, loadCategories, newId, paletteColor, saveAssignments, saveCategories,
} from "./categories";
import { buildEnvelope, encodeGlb, translationMatrix } from "./envelope";
import {
    ImportPlan, buildExportRows, categoryValueName, decodeText, parseTable, planImport, toCsv, toTsv,
} from "./table";

// =============================================================
// TYPES
// =============================================================
interface RgbaColor {
    r: number;
    g: number;
    b: number;
    a: number;
}

interface BuildingData {
    path: string;
    /** Stable 1-based number in load order, used as the building's label. */
    number: number;
    height: number;
    footprintArea: number;
    volume: number;
    floorCount: number;
    /** Bounding-box centre and largest dimension, used to frame the camera. */
    centre: { x: number; y: number; z: number };
    size: number;
    north: number;
    south: number;
    east: number;
    west: number;
    totalFacadeArea: number;
    dominantOrientation: 'North' | 'South' | 'East' | 'West';
}

type ColorMode =
    | 'height' | 'area' | 'volume' | 'floors'
    | 'facadeDominant' | 'facadeMixed'
    | `category:${string}`;

const categoryMode = (id: string): ColorMode => `category:${id}`;

type SortKey = 'index' | 'height' | 'area' | 'floors';
type SortDir = 'asc' | 'desc';

// =============================================================
// COLOR SCHEMES & HELPERS
// =============================================================
/** Assumed floor-to-floor height used for floor-count estimates. */
const FLOOR_TO_FLOOR_M = 3.5;

const ORIENTATION_COLORS = {
    North: { r: 100, g: 149, b: 237, a: 1 },
    South: { r: 255, g: 140, b: 0, a: 1 },
    East: { r: 255, g: 215, b: 0, a: 1 },
    West: { r: 186, g: 85, b: 211, a: 1 },
};

const getColorByHeight = (height: number): RgbaColor => {
    if (height < 10) return { r: 33, g: 71, b: 55, a: 1 };
    if (height < 30) return { r: 85, g: 107, b: 47, a: 1 };
    if (height < 50) return { r: 189, g: 132, b: 59, a: 1 };
    return { r: 225, g: 169, b: 94, a: 1 };
};

const getColorByArea = (area: number): RgbaColor => {
    if (area < 100) return { r: 173, g: 216, b: 230, a: 1 };
    if (area < 500) return { r: 100, g: 149, b: 237, a: 1 };
    if (area < 1000) return { r: 65, g: 105, b: 225, a: 1 };
    return { r: 25, g: 25, b: 112, a: 1 };
};

const getColorByVolume = (volume: number): RgbaColor => {
    if (volume < 1000) return { r: 255, g: 182, b: 193, a: 1 };
    if (volume < 5000) return { r: 255, g: 105, b: 180, a: 1 };
    if (volume < 15000) return { r: 199, g: 21, b: 133, a: 1 };
    return { r: 139, g: 0, b: 139, a: 1 };
};

const getColorByFloorCount = (floors: number): RgbaColor => {
    if (floors < 3) return { r: 144, g: 238, b: 144, a: 1 };
    if (floors < 7) return { r: 34, g: 139, b: 34, a: 1 };
    if (floors < 15) return { r: 255, g: 140, b: 0, a: 1 };
    return { r: 178, g: 34, b: 34, a: 1 };
};

/** sRGB hex string, as expected by Forma.render.elementColors. */
const toHex = ({ r, g, b }: RgbaColor): string =>
    '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');

const calculatePolygonArea = (coordinates: [number, number][]): number => {
    let area = 0;
    const n = coordinates.length;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += coordinates[i][0] * coordinates[j][1];
        area -= coordinates[j][0] * coordinates[i][1];
    }
    return Math.abs(area / 2);
};

const calculateNormal = (
    v1: [number, number, number],
    v2: [number, number, number],
    v3: [number, number, number]
): [number, number, number] => {
    const edge1 = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]];
    const edge2 = [v3[0] - v1[0], v3[1] - v1[1], v3[2] - v1[2]];
    const nx = edge1[1] * edge2[2] - edge1[2] * edge2[1];
    const ny = edge1[2] * edge2[0] - edge1[0] * edge2[2];
    const nz = edge1[0] * edge2[1] - edge1[1] * edge2[0];
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (length === 0) return [0, 0, 0];
    return [nx / length, ny / length, nz / length];
};

const calculateTriangleArea = (
    v1: [number, number, number],
    v2: [number, number, number],
    v3: [number, number, number]
): number => {
    const edge1 = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]];
    const edge2 = [v3[0] - v1[0], v3[1] - v1[1], v3[2] - v1[2]];
    const crossX = edge1[1] * edge2[2] - edge1[2] * edge2[1];
    const crossY = edge1[2] * edge2[0] - edge1[0] * edge2[2];
    const crossZ = edge1[0] * edge2[1] - edge1[1] * edge2[0];
    return 0.5 * Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ);
};

const getOrientation = (normal: [number, number, number]): 'North' | 'South' | 'East' | 'West' | null => {
    const [nx, ny] = normal;
    const horizontalMagnitude = Math.sqrt(nx * nx + ny * ny);
    if (horizontalMagnitude < 0.5) return null;
    if (Math.abs(ny) > Math.abs(nx)) return ny > 0 ? 'North' : 'South';
    return nx > 0 ? 'East' : 'West';
};

// =============================================================
// SUMMARY STRIP
// GFA, site area and coverage are left to Forma's Area Metrics panel.
// =============================================================
function SummaryStrip({
    totalBuildings, avgHeight, maxHeight, facadeArea, isLoading,
}: {
    totalBuildings: number; avgHeight: number; maxHeight: number;
    facadeArea: number; isLoading: boolean;
}) {
    const fmt = (n: number) => {
        if (!isFinite(n) || isNaN(n)) return '—';
        if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
        if (n >= 10_000) return (n / 1000).toFixed(1) + 'k';
        return Math.round(n).toLocaleString();
    };
    const placeholder = isLoading ? '…' : null;

    return (
        <div class="summary-strip">
            <div class="summary-stat">
                <div class="summary-stat__label">Buildings</div>
                <div class="summary-stat__value">{placeholder ?? totalBuildings}</div>
            </div>
            <div class="summary-stat">
                <div class="summary-stat__label">Avg Height</div>
                <div class="summary-stat__value">
                    {placeholder ?? avgHeight.toFixed(1)}<span class="summary-stat__unit">m</span>
                </div>
            </div>
            <div class="summary-stat">
                <div class="summary-stat__label">Max Height</div>
                <div class="summary-stat__value">
                    {placeholder ?? maxHeight.toFixed(1)}<span class="summary-stat__unit">m</span>
                </div>
            </div>
            <div class="summary-stat">
                <div class="summary-stat__label">Façade Area</div>
                <div class="summary-stat__value">
                    {placeholder ?? fmt(facadeArea)}<span class="summary-stat__unit">m²</span>
                </div>
            </div>
        </div>
    );
}

// =============================================================
// ERROR BANNER
// =============================================================
function ErrorBanner({ message }: { message: string }) {
    return (
        <div class="error-banner">
            <span class="error-banner__icon">⚠</span>
            <span>{message}</span>
        </div>
    );
}

// =============================================================
// SORT CONTROLS
// =============================================================
function SortControls({
    sortKey, sortDir, setSortKey, setSortDir,
}: {
    sortKey: SortKey;
    sortDir: SortDir;
    setSortKey: (k: SortKey) => void;
    setSortDir: (d: SortDir) => void;
}) {
    return (
        <div class="sort-controls">
            <span class="sort-controls__label">Sort by</span>
            <select
                value={sortKey}
                onChange={(e) => setSortKey((e.target as HTMLSelectElement).value as SortKey)}
            >
                <option value="index">Default order</option>
                <option value="height">Height</option>
                <option value="area">Footprint area</option>
                <option value="floors">Floor count</option>
            </select>
            <button
                class="sort-dir-btn"
                onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
                title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
            >
                {sortDir === 'asc' ? '↑' : '↓'}
            </button>
        </div>
    );
}

// =============================================================
// BUILDING LIST - compact single-line rows
// =============================================================
function BuildingList({
    buildings, selectedPath, onSelect,
}: {
    buildings: BuildingData[];
    selectedPath: string | null;
    onSelect: (building: BuildingData) => void;
}) {
    if (buildings.length === 0) {
        return (
            <div class="building-list">
                <div style={{ padding: '1.5em', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No buildings found.
                </div>
            </div>
        );
    }

    return (
        <div class="building-list">
            {buildings.map((b) => (
                <div
                    key={b.path}
                    class={`building-row ${selectedPath === b.path ? 'building-row--selected' : ''}`}
                    onClick={() => onSelect(b)}
                    title={`Building ${b.number}: show details and move camera`}
                >
                    <div class="building-row__index">#{b.number}</div>
                    <div class="building-row__metric">
                        <span class="building-row__metric-label">H</span>
                        {b.height.toFixed(1)}m
                    </div>
                    <div class="building-row__metric">
                        <span class="building-row__metric-label">A</span>
                        {b.footprintArea.toFixed(0)} m²
                    </div>
                    <div class="building-row__metric">
                        <span class="building-row__metric-label">Fl</span>
                        {b.floorCount}
                    </div>
                </div>
            ))}
        </div>
    );
}

// =============================================================
// BUILDING LIST SKELETON
// =============================================================
function BuildingListSkeleton({ count = 8 }: { count?: number }) {
    return (
        <div class="building-list">
            {Array.from({ length: count }).map((_, i) => (
                <div key={i} class="skeleton-row skeleton-row--building" />
            ))}
        </div>
    );
}

// =============================================================
// LEGEND SWATCH (small helper)
// =============================================================
function LegendSwatch({ color, label }: { color: string; label: string }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <div style={{ width: '20px', height: '20px', backgroundColor: color, borderRadius: '2px' }}></div>
            <span>{label}</span>
        </div>
    );
}

const formatArea = (area: number) => area.toFixed(1);
const formatPercent = (area: number, total: number) =>
    total > 0 ? ((area / total) * 100).toFixed(1) : '0.0';

// =============================================================
// BUILDING DETAIL - every value for the selected building
// =============================================================
function BuildingDetail({ building, categories, assignments }: {
    building: BuildingData; categories: Category[]; assignments: Assignments;
}) {
    const b = building;
    const c = ORIENTATION_COLORS[b.dominantOrientation];
    const facade: [string, number][] = [
        ['North', b.north], ['South', b.south], ['East', b.east], ['West', b.west],
    ];
    return (
        <div class="building-detail">
            <h3>Building {b.number}</h3>
            <div class="building-detail__grid">
                <div><span class="muted">Height</span> {b.height.toFixed(1)} m</div>
                <div><span class="muted">Footprint</span> {b.footprintArea.toFixed(0)} m²</div>
                <div><span class="muted">Floors (est.)</span> {b.floorCount}</div>
                <div><span class="muted">Volume (est.)</span> {b.volume.toFixed(0)} m³</div>
                {categories.map((cat) => (
                    <div key={cat.id}>
                        <span class="muted">{cat.name}</span> {categoryValueName(cat, assignments, b.path) || '—'}
                    </div>
                ))}
                <div>
                    <span class="muted">Dominant façade</span>{' '}
                    <span class="orientation-chip" style={{ backgroundColor: `rgb(${c.r}, ${c.g}, ${c.b})` }}>
                        {b.dominantOrientation}
                    </span>
                </div>
            </div>
            <div class="building-detail__facade">
                {facade.map(([label, area]) => (
                    <div key={label}>
                        <span class="muted">{label}</span> {formatArea(area)} m² ({formatPercent(area, b.totalFacadeArea)}%)
                    </div>
                ))}
                <div><span class="muted">Total façade</span> {formatArea(b.totalFacadeArea)} m²</div>
            </div>
        </div>
    );
}

// =============================================================
// EXPORT HELPERS
// =============================================================
const downloadCsv = (csv: string) => {
    // The BOM makes Excel read m² and ç correctly.
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `building-metrics-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const copyText = async (text: string) => {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        // The Clipboard API is often blocked inside embedded iframes; fall back to execCommand.
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        textarea.remove();
        if (!ok) throw new Error('Copy command was rejected');
    }
};

// =============================================================
// CATEGORY PANEL - legend, editing and assignment for one category
// =============================================================
function CategoryPanel({
    category, counts, unassignedCount, editable, message,
    onRename, onDelete, onAddValue, onUpdateValue, onDeleteValue, onAssign, onClear,
}: {
    category: Category;
    counts: Record<string, number>;
    unassignedCount: number;
    editable: boolean;
    message: string | null;
    onRename: (name: string) => void;
    onDelete: () => void;
    onAddValue: (name: string, color: string) => void;
    onUpdateValue: (valueId: string, patch: Partial<Omit<CategoryValue, 'id'>>) => void;
    onDeleteValue: (valueId: string) => void;
    onAssign: (valueId: string) => void;
    onClear: () => void;
}) {
    const [newName, setNewName] = useState('');
    const [newColor, setNewColor] = useState(paletteColor(category.values.length));
    const [confirmDelete, setConfirmDelete] = useState(false);
    const inputValue = (e: Event) => (e.target as HTMLInputElement).value;

    const addValue = () => {
        const name = newName.trim();
        if (!name) return;
        onAddValue(name, newColor);
        setNewName('');
        setNewColor(paletteColor(category.values.length + 1));
    };

    return (
        <div class="section">
            {editable
                ? <input
                    class="category-title"
                    type="text"
                    value={category.name}
                    aria-label="Category name"
                    onChange={(e) => { const name = inputValue(e).trim(); if (name) onRename(name); }}
                />
                : <h3>{category.name}</h3>}

            {category.values.map((v) => (
                <div key={v.id} class="category-value">
                    {editable
                        ? <input
                            type="color"
                            value={v.color}
                            title="Change colour"
                            aria-label={`Colour for ${v.name}`}
                            onChange={(e) => onUpdateValue(v.id, { color: inputValue(e) })}
                        />
                        : <span class="category-value__swatch" style={{ backgroundColor: v.color }} />}
                    {editable
                        ? <input
                            type="text"
                            value={v.name}
                            aria-label="Value name"
                            onChange={(e) => { const name = inputValue(e).trim(); if (name) onUpdateValue(v.id, { name }); }}
                        />
                        : <span>{v.name}</span>}
                    <span class="category-value__count" title="Buildings with this value">{counts[v.id] ?? 0}</span>
                    {editable && (
                        <>
                            <button class="button-ghost" onClick={() => onAssign(v.id)} title="Assign the buildings selected in Forma">
                                Assign selected
                            </button>
                            <button class="button-ghost" onClick={() => onDeleteValue(v.id)} title={`Delete ${v.name}`} aria-label={`Delete ${v.name}`}>
                                ×
                            </button>
                        </>
                    )}
                </div>
            ))}
            <div class="category-value">
                <span class="category-value__swatch" style={{ backgroundColor: UNASSIGNED_COLOR }} />
                <span class="muted">Unassigned</span>
                <span class="category-value__count">{unassignedCount}</span>
            </div>

            {editable && (
                <>
                    <div class="category-value category-value--new">
                        <input
                            type="color"
                            value={newColor}
                            aria-label="Colour for new value"
                            onChange={(e) => setNewColor(inputValue(e))}
                        />
                        <input
                            type="text"
                            value={newName}
                            placeholder="New value, e.g. Phase 1"
                            onInput={(e) => setNewName(inputValue(e))}
                            onKeyDown={(e) => { if (e.key === 'Enter') addValue(); }}
                        />
                        <button onClick={addValue} disabled={!newName.trim()}>Add value</button>
                    </div>
                    <div class="row row--wrap" style={{ marginTop: '0.8em' }}>
                        <button class="button-ghost" onClick={onClear}>Clear selected</button>
                        <button
                            class="button-ghost"
                            onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
                            onBlur={() => setConfirmDelete(false)}
                        >
                            {confirmDelete ? `Click again to delete "${category.name}"` : 'Delete category'}
                        </button>
                    </div>
                </>
            )}
            <p class="muted">
                {message ?? (editable
                    ? 'Select buildings in Forma, then click Assign selected next to a value.'
                    : 'View only: edit access to this Forma project is needed to change categories.')}
            </p>
        </div>
    );
}

// =============================================================
// IMPORT PREVIEW - what an import will change, before it is applied
// =============================================================
function ImportPreview({ plan, onApply, onCancel }: {
    plan: ImportPlan; onApply: () => void; onCancel: () => void;
}) {
    if (!plan.ok) {
        return (
            <div class="import-preview import-preview--error">
                <p>{plan.error}</p>
                <button class="button-ghost" onClick={onCancel}>Close</button>
            </div>
        );
    }
    const s = plan.summary;
    const shown = s.unmatched.slice(0, 5).join(', ') + (s.unmatched.length > 5 ? ` and ${s.unmatched.length - 5} more` : '');
    return (
        <div class="import-preview">
            <h3>Import preview</h3>
            <ul>
                <li>{s.matchedRows} row{s.matchedRows === 1 ? '' : 's'} matched to buildings in this proposal</li>
                <li><strong>{s.changedBuildings} building{s.changedBuildings === 1 ? '' : 's'} will change</strong></li>
                {s.updatedCategories.length > 0 && <li>Categories updated: {s.updatedCategories.join(', ')}</li>}
                {s.newCategories.map((c) => (
                    <li key={c.name}>New category: {c.name} ({c.values} value{c.values === 1 ? '' : 's'})</li>
                ))}
                {s.newValues.length > 0 && <li>New values: {s.newValues.join(', ')}</li>}
                {s.unmatched.length > 0 && (
                    <li>{s.unmatched.length} row{s.unmatched.length === 1 ? '' : 's'} not matched and skipped: {shown}</li>
                )}
                {s.duplicateRows > 0 && (
                    <li>{s.duplicateRows} repeated row{s.duplicateRows === 1 ? '' : 's'} (the last one for each building is used)</li>
                )}
            </ul>
            <div class="row">
                <button onClick={onApply} disabled={s.changedBuildings === 0 && s.newCategories.length === 0 && s.newValues.length === 0}>
                    Apply
                </button>
                <button class="button-ghost" onClick={onCancel}>Cancel</button>
            </div>
        </div>
    );
}

// =============================================================
// MAIN APP
// =============================================================
function App() {
    const [buildingData, setBuildingData] = useState<BuildingData[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isColoring, setIsColoring] = useState<boolean>(false);
    const [colorMode, setColorMode] = useState<ColorMode>('height');
    const [selectedBuilding, setSelectedBuilding] = useState<string | null>(null);
    const [categories, setCategories] = useState<Category[]>(defaultCategories);
    const [assignments, setAssignments] = useState<Assignments>({});
    const [proposalId, setProposalId] = useState<string | null>(null);
    const [canEdit, setCanEdit] = useState<boolean>(false);
    const [categoriesReady, setCategoriesReady] = useState<boolean>(false);
    const [storageWarning, setStorageWarning] = useState<string | null>(null);
    const [categoryMessage, setCategoryMessage] = useState<string | null>(null);
    const [newCategoryName, setNewCategoryName] = useState<string>('');
    /** Mode last applied to the scene, so category edits can refresh the colours. */
    const [appliedMode, setAppliedMode] = useState<ColorMode | null>(null);

    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [exportMessage, setExportMessage] = useState<string | null>(null);
    /** Parsed rows of a file or paste waiting for the user to apply or cancel. */
    const [importRows, setImportRows] = useState<string[][] | null>(null);
    const [showPaste, setShowPaste] = useState<boolean>(false);
    const [pasteText, setPasteText] = useState<string>('');
    const [importMessage, setImportMessage] = useState<string | null>(null);
    const [envelopeMargin, setEnvelopeMargin] = useState<number>(1);
    const [isEnveloping, setIsEnveloping] = useState<boolean>(false);
    const [envelopeMessage, setEnvelopeMessage] = useState<string | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    // NEW in Pass 2: sort state
    const [sortKey, setSortKey] = useState<SortKey>('index');
    const [sortDir, setSortDir] = useState<SortDir>('asc');

    // --------- ANALYSIS PIPELINE (unchanged) ---------
    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);
            setErrorMessage(null);
            try {
                const paths = await Forma.geometry.getPathsByCategory({ category: "building" });

                const dataPromises = paths.map(async (path, index): Promise<BuildingData> => {
                    const position = await Forma.geometry.getTriangles({ path });

                    // Bounding box in one pass (spreading large vertex arrays into
                    // Math.min/max can overflow the call stack on detailed meshes).
                    let minX = Infinity, minY = Infinity, minZ = Infinity;
                    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
                    for (let i = 0; i < position.length; i += 3) {
                        const x = position[i], y = position[i + 1], z = position[i + 2];
                        if (x < minX) minX = x; if (x > maxX) maxX = x;
                        if (y < minY) minY = y; if (y > maxY) maxY = y;
                        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
                    }
                    const height = position.length > 0 ? maxZ - minZ : 0;
                    const centre = position.length > 0
                        ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 }
                        : { x: 0, y: 0, z: 0 };
                    const size = position.length > 0 ? Math.max(maxX - minX, maxY - minY, height) : 0;

                    const footprint = await Forma.geometry.getFootprint({ path });
                    const footprintArea = footprint ? calculatePolygonArea(footprint.coordinates) : 0;

                    // Estimates: extruded footprint and an assumed 3.5 m floor-to-floor height.
                    const volume = height * footprintArea;
                    const floorCount = Math.round(height / FLOOR_TO_FLOOR_M);

                    let north = 0, south = 0, east = 0, west = 0;
                    for (let i = 0; i < position.length; i += 9) {
                        const v1: [number, number, number] = [position[i], position[i + 1], position[i + 2]];
                        const v2: [number, number, number] = [position[i + 3], position[i + 4], position[i + 5]];
                        const v3: [number, number, number] = [position[i + 6], position[i + 7], position[i + 8]];
                        const normal = calculateNormal(v1, v2, v3);
                        const orientation = getOrientation(normal);
                        if (orientation) {
                            const area = calculateTriangleArea(v1, v2, v3);
                            switch (orientation) {
                                case 'North': north += area; break;
                                case 'South': south += area; break;
                                case 'East': east += area; break;
                                case 'West': west += area; break;
                            }
                        }
                    }

                    const totalFacadeArea = north + south + east + west;
                    let dominantOrientation: 'North' | 'South' | 'East' | 'West' = 'North';
                    let maxArea = north;
                    if (south > maxArea) { maxArea = south; dominantOrientation = 'South'; }
                    if (east > maxArea) { maxArea = east; dominantOrientation = 'East'; }
                    if (west > maxArea) { maxArea = west; dominantOrientation = 'West'; }

                    return {
                        path, number: index + 1, height, footprintArea, volume, floorCount,
                        centre, size,
                        north, south, east, west, totalFacadeArea, dominantOrientation
                    };
                });

                const data = await Promise.all(dataPromises);
                setBuildingData(data);
            } catch (error) {
                console.error("Error fetching building data:", error);
                setErrorMessage(
                    error instanceof Error
                        ? `Failed to load building data: ${error.message}`
                        : 'Failed to load building data. Check the console for details.'
                );
            } finally {
                setIsLoading(false);
            }
        };
        fetchData();
    }, []);

    // --------- CATEGORIES: load from the Forma project ---------
    useEffect(() => {
        const loadStoredCategories = async () => {
            try {
                const [editable, id] = await Promise.all([Forma.getCanEdit(), getProposalId()]);
                setCanEdit(editable);
                setProposalId(id);
                const [storedCategories, storedAssignments] = await Promise.all([loadCategories(), loadAssignments(id)]);
                if (storedCategories) setCategories(storedCategories);
                if (storedAssignments) setAssignments(storedAssignments);
            } catch (error) {
                console.error(error);
                setCanEdit(true);
                setStorageWarning('Categories could not be loaded from the Forma project, so changes will only last until the panel is closed.');
            } finally {
                setCategoriesReady(true);
            }
        };
        loadStoredCategories();
    }, []);

    // --------- CATEGORY ACTIONS (saved to the Forma project on every change) ---------
    const storageFailed = (error: unknown) => {
        console.error(error);
        setStorageWarning('Could not save to the Forma project, so recent changes will be lost when the panel closes.');
    };

    const updateCategories = (next: Category[]) => {
        setCategories(next);
        saveCategories(next).catch(storageFailed);
    };

    const updateAssignments = (next: Assignments) => {
        setAssignments(next);
        if (proposalId) saveAssignments(proposalId, next).catch(storageFailed);
    };

    const editCategory = (id: string, edit: (cat: Category) => Category) =>
        updateCategories(categories.map((cat) => (cat.id === id ? edit(cat) : cat)));

    const createCategory = () => {
        const name = newCategoryName.trim();
        if (!name) return;
        const category: Category = { id: newId(), name, values: [] };
        updateCategories([...categories, category]);
        setNewCategoryName('');
        setColorMode(categoryMode(category.id));
        setCategoryMessage(null);
    };

    const deleteCategory = (id: string) => {
        updateCategories(categories.filter((cat) => cat.id !== id));
        const { [id]: _removed, ...rest } = assignments;
        updateAssignments(rest);
        setColorMode('height');
    };

    const deleteValue = (categoryId: string, valueId: string) => {
        editCategory(categoryId, (cat) => ({ ...cat, values: cat.values.filter((v) => v.id !== valueId) }));
        const kept = Object.entries(assignments[categoryId] ?? {}).filter(([, v]) => v !== valueId);
        updateAssignments({ ...assignments, [categoryId]: Object.fromEntries(kept) });
    };

    /** Building paths for the current Forma selection (a selected child element counts as its building). */
    const selectedBuildingPaths = async (): Promise<string[]> => {
        const selection = await Forma.selection.getSelection();
        const paths = new Set<string>();
        for (const sel of selection) {
            const building = buildingData.find((b) => sel === b.path || sel.startsWith(b.path + '/'));
            if (building) paths.add(building.path);
        }
        return [...paths];
    };

    const assignSelected = async (categoryId: string, valueId: string | null) => {
        try {
            const paths = await selectedBuildingPaths();
            if (paths.length === 0) {
                setCategoryMessage('No buildings selected. Select buildings in Forma first.');
                return;
            }
            const forCategory = { ...(assignments[categoryId] ?? {}) };
            for (const path of paths) {
                if (valueId) forCategory[path] = valueId;
                else delete forCategory[path];
            }
            updateAssignments({ ...assignments, [categoryId]: forCategory });
            setCategoryMessage(`${valueId ? 'Assigned' : 'Cleared'} ${paths.length} building${paths.length === 1 ? '' : 's'}.`);
        } catch (error) {
            console.error(error);
            setErrorMessage('Failed to read the Forma selection.');
        }
    };

    /** Creates a red envelope element over the selected buildings. It is added to the proposal, so it persists. */
    const createEnvelope = async () => {
        setIsEnveloping(true);
        setEnvelopeMessage(null);
        try {
            const paths = await selectedBuildingPaths();
            if (paths.length === 0) {
                setEnvelopeMessage('No buildings selected. Select buildings in Forma first.');
                return;
            }
            const chosen = buildingData.filter((b) => paths.includes(b.path));
            const footprints = (await Promise.all(chosen.map((b) => Forma.geometry.getFootprint({ path: b.path }))))
                .flatMap((fp) => (fp ? [fp.coordinates as [number, number][]] : []));
            const envelope = buildEnvelope({
                footprints,
                minZ: Math.min(...chosen.map((b) => b.centre.z - b.height / 2)),
                maxZ: Math.max(...chosen.map((b) => b.centre.z + b.height / 2)),
                margin: envelopeMargin,
            });
            if (!envelope) {
                setEnvelopeMessage('The selected buildings have no usable footprint.');
                return;
            }
            const { blobId } = await Forma.integrateElements.uploadFile({ data: encodeGlb(envelope.positions) });
            const { urn } = await Forma.integrateElements.createElementV2({
                // virtual: analyses and metrics ignore the element, so it is purely illustrative.
                properties: { name: 'Context envelope', category: 'context-envelope', virtual: true },
                representations: { volumeMesh: { type: 'linked', blobId } },
            });
            const { path } = await Forma.elements.add({
                urn, name: 'Context envelope', transform: translationMatrix(envelope.origin),
            });
            // Red override in case the stored mesh drops its material.
            await Forma.render.elementColors.set({ pathsToColor: new Map([[path, '#e61a1a']]) });
            setEnvelopeMessage(`Envelope added over ${chosen.length} building${chosen.length === 1 ? '' : 's'}. Remove it from the Forma element list if it is no longer needed.`);
        } catch (error) {
            console.error(error);
            setEnvelopeMessage(error instanceof Error ? `Failed to create the envelope: ${error.message}` : 'Failed to create the envelope.');
        } finally {
            setIsEnveloping(false);
        }
    };

    const activeCategory = categories.find((cat) => categoryMode(cat.id) === colorMode);

    const getBuildingColor = (building: BuildingData): string => {
        if (activeCategory) {
            const valueId = assignments[activeCategory.id]?.[building.path];
            return activeCategory.values.find((v) => v.id === valueId)?.color ?? UNASSIGNED_COLOR;
        }
        switch (colorMode) {
            case 'height': return toHex(getColorByHeight(building.height));
            case 'area': return toHex(getColorByArea(building.footprintArea));
            case 'volume': return toHex(getColorByVolume(building.volume));
            case 'floors': return toHex(getColorByFloorCount(building.floorCount));
            case 'facadeDominant': return toHex(ORIENTATION_COLORS[building.dominantOrientation]);
            default: return UNASSIGNED_COLOR;
        }
    };

    // Colours every building in the proposal; no Forma selection needed.
    const colorBuildings = async () => {
        setIsColoring(true);
        setErrorMessage(null);
        try {
            if (colorMode === 'facadeMixed') {
                // Per-face colours need a coloured overlay mesh per building;
                // element colours only support one colour per building.
                await Forma.render.elementColors.clearAll();
                for (const building of buildingData) {
                    const position = await Forma.geometry.getTriangles({ path: building.path });
                    const color = new Uint8Array((position.length / 9) * 4 * 3);
                    let colorIndex = 0;
                    for (let i = 0; i < position.length; i += 9) {
                        const v1: [number, number, number] = [position[i], position[i + 1], position[i + 2]];
                        const v2: [number, number, number] = [position[i + 3], position[i + 4], position[i + 5]];
                        const v3: [number, number, number] = [position[i + 6], position[i + 7], position[i + 8]];
                        const orientation = getOrientation(calculateNormal(v1, v2, v3));
                        const faceColor = orientation ? ORIENTATION_COLORS[orientation] : { r: 200, g: 200, b: 200, a: 1 };
                        for (let v = 0; v < 3; v++) {
                            color[colorIndex++] = faceColor.r;
                            color[colorIndex++] = faceColor.g;
                            color[colorIndex++] = faceColor.b;
                            color[colorIndex++] = Math.round(faceColor.a * 255);
                        }
                    }
                    await Forma.render.updateMesh({ id: building.path, geometryData: { position, color } });
                }
            } else {
                await Forma.render.cleanup();
                const pathsToColor = new Map<string, string>();
                for (const building of buildingData) {
                    pathsToColor.set(building.path, getBuildingColor(building));
                }
                await Forma.render.elementColors.set({ pathsToColor });
            }
            setAppliedMode(colorMode);
        } catch (error) {
            console.error(error);
            setErrorMessage('Failed to apply colours to buildings.');
        } finally {
            setIsColoring(false);
        }
    };

    const reset = async () => {
        setSelectedBuilding(null);
        setAppliedMode(null);
        try {
            await Promise.all([Forma.render.elementColors.clearAll(), Forma.render.cleanup()]);
        } catch (error) {
            console.error(error);
            setErrorMessage('Failed to reset colours.');
        }
    };

    // Keep the scene in step when the category being shown is edited or reassigned.
    useEffect(() => {
        if (activeCategory && appliedMode === colorMode && !isColoring) colorBuildings();
    }, [categories, assignments]);

    // The SDK cannot set the Forma selection, so a row click frames the building instead.
    const focusBuilding = async (building: BuildingData) => {
        setSelectedBuilding(building.path);
        const { centre } = building;
        const distance = Math.max(building.size, 20) * 1.5;
        try {
            await Forma.camera.move({
                position: { x: centre.x - distance, y: centre.y - distance, z: centre.z + distance },
                target: centre,
                transitionTimeMs: 800,
            });
        } catch (error) {
            console.error(error);
            setErrorMessage('Failed to move the camera to the building.');
        }
    };

    // --------- DERIVED VALUES ---------
    const facadeTotals = useMemo(() => buildingData.reduce((acc, b) => ({
        north: acc.north + b.north, south: acc.south + b.south,
        east: acc.east + b.east, west: acc.west + b.west,
        total: acc.total + b.totalFacadeArea
    }), { north: 0, south: 0, east: 0, west: 0, total: 0 }), [buildingData]);

    const summary = useMemo(() => {
        const totalBuildings = buildingData.length;
        const avgHeight = totalBuildings > 0
            ? buildingData.reduce((acc, b) => acc + b.height, 0) / totalBuildings : 0;
        const maxHeight = buildingData.reduce((acc, b) => Math.max(acc, b.height), 0);
        return { totalBuildings, avgHeight, maxHeight };
    }, [buildingData]);

    // NEW: sorted building list (original order preserved in state)
    const sortedBuildings = useMemo(() => {
        if (sortKey === 'index') {
            return sortDir === 'asc' ? buildingData : [...buildingData].reverse();
        }
        const arr = [...buildingData];
        arr.sort((a, b) => {
            let av = 0, bv = 0;
            switch (sortKey) {
                case 'height': av = a.height; bv = b.height; break;
                case 'area': av = a.footprintArea; bv = b.footprintArea; break;
                case 'floors': av = a.floorCount; bv = b.floorCount; break;
            }
            return sortDir === 'asc' ? av - bv : bv - av;
        });
        return arr;
    }, [buildingData, sortKey, sortDir]);

    const selected = buildingData.find((b) => b.path === selectedBuilding);

    // Buildings per value in the category being shown; assignments to deleted buildings are ignored.
    const categoryCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        let unassigned = 0;
        const forCategory = activeCategory ? assignments[activeCategory.id] ?? {} : {};
        const valueIds = new Set(activeCategory?.values.map((v) => v.id));
        for (const b of buildingData) {
            const valueId = forCategory[b.path];
            if (valueId && valueIds.has(valueId)) counts[valueId] = (counts[valueId] ?? 0) + 1;
            else unassigned++;
        }
        return { counts, unassigned };
    }, [activeCategory, assignments, buildingData]);

    // --------- EXPORT ---------
    const exportCsv = () => {
        try {
            downloadCsv(toCsv(buildExportRows(buildingData, categories, assignments)));
            setExportMessage(`CSV with ${buildingData.length} buildings created. If no download appeared, use Copy Table.`);
        } catch (error) {
            console.error(error);
            setErrorMessage('Failed to create the CSV file. Try Copy Table instead.');
        }
    };

    const copyTable = async () => {
        try {
            await copyText(toTsv(buildExportRows(buildingData, categories, assignments)));
            setExportMessage(`Copied ${buildingData.length} buildings. Paste into Excel.`);
        } catch (error) {
            console.error(error);
            setErrorMessage('Copying to the clipboard was blocked. Try Download CSV instead.');
        }
    };

    // --------- IMPORT ---------
    // Planned against current state, so the preview stays right if categories change meanwhile.
    const importPlan = useMemo(
        () => (importRows ? planImport(importRows, buildingData, categories, assignments) : null),
        [importRows, buildingData, categories, assignments],
    );

    const startImport = (text: string) => {
        setImportMessage(null);
        setImportRows(parseTable(text));
    };

    const onFileChosen = async (e: Event) => {
        const input = e.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = ''; // so choosing the same file again still triggers a change
        if (!file) return;
        try {
            startImport(decodeText(await file.arrayBuffer()));
        } catch (error) {
            console.error(error);
            setErrorMessage('Could not read the file. Try Paste Table instead.');
        }
    };

    const applyImport = () => {
        if (!importPlan?.ok) return;
        updateCategories(importPlan.categories);
        updateAssignments(importPlan.assignments);
        const n = importPlan.summary.changedBuildings;
        setImportMessage(`Imported: ${n} building${n === 1 ? '' : 's'} updated.`);
        setImportRows(null);
        setShowPaste(false);
        setPasteText('');
    };

    // =========================================================
    // RENDER
    // =========================================================
    return (
        <>
            {errorMessage && <ErrorBanner message={errorMessage} />}

            <SummaryStrip
                totalBuildings={summary.totalBuildings}
                avgHeight={summary.avgHeight}
                maxHeight={summary.maxHeight}
                facadeArea={facadeTotals.total}
                isLoading={isLoading}
            />

            <div class="section">
                <h3>Buildings</h3>
                <SortControls
                    sortKey={sortKey} sortDir={sortDir}
                    setSortKey={setSortKey} setSortDir={setSortDir}
                />
                {isLoading
                    ? <BuildingListSkeleton count={8} />
                    : <BuildingList
                        buildings={sortedBuildings}
                        selectedPath={selectedBuilding}
                        onSelect={focusBuilding}
                    />
                }
                {selected && <BuildingDetail building={selected} categories={categories} assignments={assignments} />}
                <p class="muted">
                    Click a building to see its details and move the camera to it. Floors and volume are
                    estimates ({FLOOR_TO_FLOOR_M} m floor-to-floor, extruded footprint).
                    For GFA, site area and FAR use Forma's Area Metrics panel.
                </p>
            </div>

            {!isLoading && (
                <>
                    <div class="section">
                        <h3>Colour Mode</h3>
                        <div class="row row--wrap">
                            {([
                                ['height', 'Height'],
                                ['area', 'Footprint'],
                                ['volume', 'Volume (est.)'],
                                ['floors', 'Floors (est.)'],
                                ['facadeDominant', 'Façade (Dominant)'],
                                ['facadeMixed', 'Façade (Mixed)'],
                                ...categories.map((cat): [ColorMode, string] => [categoryMode(cat.id), cat.name]),
                            ] as [ColorMode, string][]).map(([mode, label]) => (
                                <button
                                    key={mode}
                                    class={`button-ghost ${colorMode === mode ? 'is-active' : ''}`}
                                    onClick={() => { setColorMode(mode); setCategoryMessage(null); }}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                        {canEdit && categoriesReady && (
                            <div class="row" style={{ marginTop: '0.8em' }}>
                                <input
                                    type="text"
                                    value={newCategoryName}
                                    placeholder="New category, e.g. Phase"
                                    onInput={(e) => setNewCategoryName((e.target as HTMLInputElement).value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') createCategory(); }}
                                />
                                <button class="button-ghost" onClick={createCategory} disabled={!newCategoryName.trim()}>
                                    Add category
                                </button>
                            </div>
                        )}
                        {storageWarning && <p class="muted">⚠ {storageWarning}</p>}
                    </div>

                    {colorMode === 'height' && (
                        <div class="section">
                            <h3>Height Legend</h3>
                            <LegendSwatch color="rgb(33, 71, 55)" label="Low (0–10m)" />
                            <LegendSwatch color="rgb(85, 107, 47)" label="Medium (10–30m)" />
                            <LegendSwatch color="rgb(189, 132, 59)" label="High (30–50m)" />
                            <LegendSwatch color="rgb(225, 169, 94)" label="Very High (50m+)" />
                        </div>
                    )}
                    {colorMode === 'area' && (
                        <div class="section">
                            <h3>Footprint Area Legend</h3>
                            <LegendSwatch color="rgb(173, 216, 230)" label="Small (<100 m²)" />
                            <LegendSwatch color="rgb(100, 149, 237)" label="Medium (100–500 m²)" />
                            <LegendSwatch color="rgb(65, 105, 225)" label="Large (500–1000 m²)" />
                            <LegendSwatch color="rgb(25, 25, 112)" label="Very Large (1000 m²+)" />
                        </div>
                    )}
                    {colorMode === 'volume' && (
                        <div class="section">
                            <h3>Volume Legend (estimated)</h3>
                            <LegendSwatch color="rgb(255, 182, 193)" label="Small (<1000 m³)" />
                            <LegendSwatch color="rgb(255, 105, 180)" label="Medium (1000–5000 m³)" />
                            <LegendSwatch color="rgb(199, 21, 133)" label="Large (5000–15000 m³)" />
                            <LegendSwatch color="rgb(139, 0, 139)" label="Very Large (15000 m³+)" />
                        </div>
                    )}
                    {colorMode === 'floors' && (
                        <div class="section">
                            <h3>Floor Count Legend (estimated)</h3>
                            <LegendSwatch color="rgb(144, 238, 144)" label="Low-rise (1–2 floors)" />
                            <LegendSwatch color="rgb(34, 139, 34)" label="Mid-rise (3–6 floors)" />
                            <LegendSwatch color="rgb(255, 140, 0)" label="High-rise (7–14 floors)" />
                            <LegendSwatch color="rgb(178, 34, 34)" label="Tower (15+ floors)" />
                        </div>
                    )}
                    {activeCategory && (
                        <CategoryPanel
                            key={activeCategory.id}
                            category={activeCategory}
                            counts={categoryCounts.counts}
                            unassignedCount={categoryCounts.unassigned}
                            editable={canEdit && categoriesReady}
                            message={categoryMessage}
                            onRename={(name) => editCategory(activeCategory.id, (cat) => ({ ...cat, name }))}
                            onDelete={() => deleteCategory(activeCategory.id)}
                            onAddValue={(name, color) => editCategory(activeCategory.id, (cat) => ({
                                ...cat, values: [...cat.values, { id: newId(), name, color }],
                            }))}
                            onUpdateValue={(valueId, patch) => editCategory(activeCategory.id, (cat) => ({
                                ...cat, values: cat.values.map((v) => (v.id === valueId ? { ...v, ...patch } : v)),
                            }))}
                            onDeleteValue={(valueId) => deleteValue(activeCategory.id, valueId)}
                            onAssign={(valueId) => assignSelected(activeCategory.id, valueId)}
                            onClear={() => assignSelected(activeCategory.id, null)}
                        />
                    )}
                    {(colorMode === 'facadeDominant' || colorMode === 'facadeMixed') && (
                        <>
                            <div class="section">
                                <h3>Orientation Legend</h3>
                                <LegendSwatch color="rgb(100, 149, 237)" label="North" />
                                <LegendSwatch color="rgb(255, 140, 0)" label="South" />
                                <LegendSwatch color="rgb(255, 215, 0)" label="East" />
                                <LegendSwatch color="rgb(186, 85, 211)" label="West" />
                            </div>
                            <div class="section">
                                <h3>Overall Façade Statistics</h3>
                                <div><strong>North:</strong> {formatArea(facadeTotals.north)} m² ({formatPercent(facadeTotals.north, facadeTotals.total)}%)</div>
                                <div><strong>South:</strong> {formatArea(facadeTotals.south)} m² ({formatPercent(facadeTotals.south, facadeTotals.total)}%)</div>
                                <div><strong>East:</strong> {formatArea(facadeTotals.east)} m² ({formatPercent(facadeTotals.east, facadeTotals.total)}%)</div>
                                <div><strong>West:</strong> {formatArea(facadeTotals.west)} m² ({formatPercent(facadeTotals.west, facadeTotals.total)}%)</div>
                                <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--border-subtle)' }}>
                                    <strong>Total Façade Area:</strong> {formatArea(facadeTotals.total)} m²
                                </div>
                            </div>
                        </>
                    )}

                    <div class="section">
                        <div class="row">
                            <button onClick={colorBuildings} disabled={isLoading || isColoring || buildingData.length === 0}>
                                {isColoring ? <><span class="spinner">⟳</span> Colouring…</> : 'Apply Colours to All Buildings'}
                            </button>
                            <button class="button-ghost" onClick={reset}>Reset</button>
                        </div>
                    </div>

                    {canEdit && (
                        <div class="section">
                            <h3>Context Envelope</h3>
                            <div class="row">
                                <label class="muted" for="envelope-margin">Margin (m)</label>
                                <input
                                    id="envelope-margin"
                                    type="number" min="0" step="0.5"
                                    value={envelopeMargin}
                                    onInput={(e) => setEnvelopeMargin(Math.max(0, Number((e.target as HTMLInputElement).value) || 0))}
                                />
                            </div>
                            <button onClick={createEnvelope} disabled={isLoading || isEnveloping || buildingData.length === 0}>
                                {isEnveloping ? <><span class="spinner">⟳</span> Creating…</> : 'Create Envelope over Selection'}
                            </button>
                            <p class="muted">
                                {envelopeMessage ?? 'Select buildings in Forma, then add a red volume enclosing them (convex hull of their footprints). It is saved in the proposal as a virtual element, so analyses ignore it.'}
                            </p>
                        </div>
                    )}

                    <div class="section">
                        <h3>Export</h3>
                        <div class="row">
                            <button onClick={exportCsv} disabled={buildingData.length === 0}>Download CSV</button>
                            <button class="button-ghost" onClick={copyTable} disabled={buildingData.length === 0}>
                                Copy Table
                            </button>
                        </div>
                        <p class="muted">
                            {exportMessage ?? 'One row per building. If the download does not start inside Forma, use Copy Table and paste into Excel.'}
                        </p>
                    </div>

                    {canEdit && categoriesReady && (
                        <div class="section">
                            <h3>Import Categories</h3>
                            <div class="row row--wrap">
                                <button class="button-ghost" onClick={() => fileInput.current?.click()}>Choose CSV…</button>
                                <button class="button-ghost" onClick={() => setShowPaste(!showPaste)}>Paste Table</button>
                                <input
                                    ref={fileInput}
                                    type="file"
                                    accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
                                    style={{ display: 'none' }}
                                    onChange={onFileChosen}
                                />
                            </div>
                            {showPaste && (
                                <div class="import-paste">
                                    <textarea
                                        value={pasteText}
                                        placeholder="Paste rows copied from Excel, including the header row"
                                        onInput={(e) => setPasteText((e.target as HTMLTextAreaElement).value)}
                                    />
                                    <button onClick={() => startImport(pasteText)} disabled={!pasteText.trim()}>Preview</button>
                                </div>
                            )}
                            {importPlan && (
                                <ImportPreview plan={importPlan} onApply={applyImport} onCancel={() => setImportRows(null)} />
                            )}
                            <p class="muted">
                                {importMessage ?? 'Edit the category columns of an exported CSV, then import it. Rows are matched by the Forma ID column. A blank cell clears the value, a new column creates a category, and buildings missing from the file are left unchanged.'}
                            </p>
                        </div>
                    )}
                </>
            )}
        </>
    );
}

render(<App />, document.getElementById('app')!);