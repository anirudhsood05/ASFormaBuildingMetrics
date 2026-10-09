import { render } from 'preact';
import './style.css';
import { Forma } from "forma-embedded-view-sdk/auto";
import { useState, useEffect, useMemo } from "preact/hooks";

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
    height: number;
    footprintArea: number;
    volume: number;
    floorCount: number;
    buildingUse: string;
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
    | 'use' | 'facadeDominant' | 'facadeMixed';

type TabId = 'metrics' | 'analysis' | 'export';
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

const getColorByUse = (use: string): RgbaColor => {
    const u = use.toLowerCase();
    if (u.includes('residential') || u.includes('apartments')) return { r: 144, g: 238, b: 144, a: 1 };
    if (u.includes('commercial') || u.includes('retail') || u.includes('shop')) return { r: 100, g: 149, b: 237, a: 1 };
    if (u.includes('office')) return { r: 186, g: 85, b: 211, a: 1 };
    if (u.includes('industrial') || u.includes('warehouse')) return { r: 169, g: 169, b: 169, a: 1 };
    if (u.includes('hospital') || u.includes('clinic')) return { r: 220, g: 20, b: 60, a: 1 };
    if (u.includes('school') || u.includes('university')) return { r: 255, g: 215, b: 0, a: 1 };
    if (u.includes('mixed')) return { r: 255, g: 140, b: 0, a: 1 };
    return { r: 211, g: 211, b: 211, a: 1 };
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
// TAB BAR
// =============================================================
function TabBar({ activeTab, setActiveTab }: { activeTab: TabId; setActiveTab: (t: TabId) => void }) {
    const tabs: { id: TabId; label: string }[] = [
        { id: 'metrics', label: 'Metrics' },
        { id: 'analysis', label: 'Analysis' },
        { id: 'export', label: 'Export' },
    ];
    return (
        <div class="tab-bar">
            {tabs.map((t) => (
                <button
                    key={t.id}
                    class={`tab ${activeTab === t.id ? 'tab--active' : ''}`}
                    onClick={() => setActiveTab(t.id)}
                >
                    {t.label}
                </button>
            ))}
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
            {buildings.map((b, i) => (
                <div
                    key={b.path}
                    class={`building-row ${selectedPath === b.path ? 'building-row--selected' : ''}`}
                    onClick={() => onSelect(b)}
                    title="Move camera to this building"
                >
                    <div class="building-row__index">#{i + 1}</div>
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

// =============================================================
// MAIN APP
// =============================================================
function App() {
    const [buildingData, setBuildingData] = useState<BuildingData[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isColoring, setIsColoring] = useState<boolean>(false);
    const [colorMode, setColorMode] = useState<ColorMode>('height');
    const [selectedBuilding, setSelectedBuilding] = useState<string | null>(null);
    const [selectedUse, setSelectedUse] = useState<string>('residential');
    const [buildingUseTags, setBuildingUseTags] = useState<Map<string, string>>(new Map());

    const [activeTab, setActiveTab] = useState<TabId>('metrics');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    // NEW in Pass 2: sort state
    const [sortKey, setSortKey] = useState<SortKey>('index');
    const [sortDir, setSortDir] = useState<SortDir>('desc');

    // --------- ANALYSIS PIPELINE (unchanged) ---------
    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);
            setErrorMessage(null);
            try {
                const paths = await Forma.geometry.getPathsByCategory({ category: "building" });

                const dataPromises = paths.map(async (path): Promise<BuildingData> => {
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

                    const buildingUse = buildingUseTags.get(path) || 'unknown';

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
                        path, height, footprintArea, volume, floorCount, buildingUse,
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
    }, [buildingUseTags]);

    // --------- ACTIONS (unchanged) ---------
    const tagSelectedBuildings = async () => {
        try {
            const selectedPaths = await Forma.selection.getSelection();
            const newTags = new Map(buildingUseTags);
            selectedPaths.forEach(path => newTags.set(path, selectedUse));
            setBuildingUseTags(newTags);
        } catch (error) {
            console.error(error);
            setErrorMessage('Failed to tag selected buildings.');
        }
    };

    const getBuildingColor = (building: BuildingData): RgbaColor => {
        switch (colorMode) {
            case 'height': return getColorByHeight(building.height);
            case 'area': return getColorByArea(building.footprintArea);
            case 'volume': return getColorByVolume(building.volume);
            case 'floors': return getColorByFloorCount(building.floorCount);
            case 'use': return getColorByUse(buildingUseTags.get(building.path) || 'unknown');
            case 'facadeDominant': return ORIENTATION_COLORS[building.dominantOrientation];
            default: return { r: 200, g: 200, b: 200, a: 1 };
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
                    pathsToColor.set(building.path, toHex(getBuildingColor(building)));
                }
                await Forma.render.elementColors.set({ pathsToColor });
            }
        } catch (error) {
            console.error(error);
            setErrorMessage('Failed to apply colours to buildings.');
        } finally {
            setIsColoring(false);
        }
    };

    const reset = async () => {
        setSelectedBuilding(null);
        try {
            await Promise.all([Forma.render.elementColors.clearAll(), Forma.render.cleanup()]);
        } catch (error) {
            console.error(error);
            setErrorMessage('Failed to reset colours.');
        }
    };

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

    const formatArea = (area: number) => area.toFixed(1);
    const formatPercent = (area: number, total: number) =>
        total > 0 ? ((area / total) * 100).toFixed(1) : '0.0';

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

            <TabBar activeTab={activeTab} setActiveTab={setActiveTab} />

            {/* METRICS TAB */}
            {activeTab === 'metrics' && (
                <div>
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
                        <p class="muted">
                            Click a building to move the camera to it. Floors and volume are
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
                                        ['use', 'Use'],
                                        ['facadeDominant', 'Façade (Dominant)'],
                                        ['facadeMixed', 'Façade (Mixed)'],
                                    ] as [ColorMode, string][]).map(([mode, label]) => (
                                        <button
                                            key={mode}
                                            class={`button-ghost ${colorMode === mode ? 'is-active' : ''}`}
                                            onClick={() => setColorMode(mode)}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
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
                            {colorMode === 'use' && (
                                <>
                                    <div class="section">
                                        <h3>Building Use Legend</h3>
                                        <LegendSwatch color="rgb(144, 238, 144)" label="Residential" />
                                        <LegendSwatch color="rgb(100, 149, 237)" label="Commercial/Retail" />
                                        <LegendSwatch color="rgb(186, 85, 211)" label="Office" />
                                        <LegendSwatch color="rgb(169, 169, 169)" label="Industrial" />
                                        <LegendSwatch color="rgb(220, 20, 60)" label="Healthcare" />
                                        <LegendSwatch color="rgb(255, 215, 0)" label="Education" />
                                        <LegendSwatch color="rgb(255, 140, 0)" label="Mixed Use" />
                                        <LegendSwatch color="rgb(211, 211, 211)" label="Unknown/Other" />
                                    </div>
                                    <div class="section">
                                        <h3>Tag Selected Buildings</h3>
                                        <div class="row">
                                            <select
                                                value={selectedUse}
                                                onChange={(e) => setSelectedUse((e.target as HTMLSelectElement).value)}
                                            >
                                                <option value="residential">Residential</option>
                                                <option value="commercial">Commercial/Retail</option>
                                                <option value="office">Office</option>
                                                <option value="industrial">Industrial</option>
                                                <option value="hospital">Healthcare</option>
                                                <option value="school">Education</option>
                                                <option value="mixed">Mixed Use</option>
                                            </select>
                                            <button onClick={tagSelectedBuildings}>Tag Selected</button>
                                        </div>
                                        <p class="muted">
                                            Select buildings in Forma, choose use type, then click Tag Selected.
                                        </p>
                                    </div>
                                </>
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
                        </>
                    )}
                </div>
            )}

            {activeTab === 'analysis' && (
                <div class="section">
                    <h3>Analysis</h3>
                    <p class="muted">Visualization controls move here in Pass 3.</p>
                </div>
            )}

            {activeTab === 'export' && (
                <div class="section">
                    <h3>Export</h3>
                    <p class="muted">CSV export will land here in Pass 3.</p>
                </div>
            )}
        </>
    );
}

render(<App />, document.getElementById('app')!);