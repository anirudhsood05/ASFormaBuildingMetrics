import { render } from 'preact';
import './style.css';
import { Forma } from "forma-embedded-view-sdk/auto";
import { useState, useEffect } from "preact/hooks";
import { RgbaColor } from "powerful-color-picker";

// Unified building data interface
interface BuildingData {
    path: string;
    buildingName: string;
    // Massing metrics
    height: number;
    footprintArea: number;
    volume: number;
    floorCount: number;
    far: number;
    buildingUse: string;
    // Façade orientation metrics
    north: number;
    south: number;
    east: number;
    west: number;
    totalFacadeArea: number;
    dominantOrientation: 'North' | 'South' | 'East' | 'West';
}

// Cardinal direction color scheme
const ORIENTATION_COLORS = {
    North: { r: 100, g: 149, b: 237, a: 1 },      // Cornflower Blue
    South: { r: 255, g: 140, b: 0, a: 1 },        // Dark Orange
    East: { r: 255, g: 215, b: 0, a: 1 },         // Gold
    West: { r: 186, g: 85, b: 211, a: 1 },        // Medium Orchid
};

// Height-based color function
const getColorByHeight = (height: number): RgbaColor => {
    if (height < 10) return { r: 33, g: 71, b: 55, a: 1 };
    if (height < 30) return { r: 85, g: 107, b: 47, a: 1 };
    if (height < 50) return { r: 189, g: 132, b: 59, a: 1 };
    return { r: 225, g: 169, b: 94, a: 1 };
};

// Area-based color function
const getColorByArea = (area: number): RgbaColor => {
    if (area < 100) return { r: 173, g: 216, b: 230, a: 1 };
    if (area < 500) return { r: 100, g: 149, b: 237, a: 1 };
    if (area < 1000) return { r: 65, g: 105, b: 225, a: 1 };
    return { r: 25, g: 25, b: 112, a: 1 };
};

// Volume-based color function
const getColorByVolume = (volume: number): RgbaColor => {
    if (volume < 1000) return { r: 255, g: 182, b: 193, a: 1 };
    if (volume < 5000) return { r: 255, g: 105, b: 180, a: 1 };
    if (volume < 15000) return { r: 199, g: 21, b: 133, a: 1 };
    return { r: 139, g: 0, b: 139, a: 1 };
};

// Floor count-based color function
const getColorByFloorCount = (floors: number): RgbaColor => {
    if (floors < 3) return { r: 144, g: 238, b: 144, a: 1 };
    if (floors < 7) return { r: 34, g: 139, b: 34, a: 1 };
    if (floors < 15) return { r: 255, g: 140, b: 0, a: 1 };
    return { r: 178, g: 34, b: 34, a: 1 };
};

// FAR-based color function
const getColorByFAR = (far: number): RgbaColor => {
    if (far < 1.0) return { r: 255, g: 250, b: 205, a: 1 };
    if (far < 2.0) return { r: 255, g: 215, b: 0, a: 1 };
    if (far < 3.0) return { r: 255, g: 140, b: 0, a: 1 };
    if (far < 5.0) return { r: 255, g: 69, b: 0, a: 1 };
    return { r: 178, g: 34, b: 34, a: 1 };
};

// Building use-based color function
const getColorByUse = (use: string): RgbaColor => {
    const useLower = use.toLowerCase();
    if (useLower.includes('residential') || useLower.includes('apartments'))
        return { r: 144, g: 238, b: 144, a: 1 };
    if (useLower.includes('commercial') || useLower.includes('retail') || useLower.includes('shop'))
        return { r: 100, g: 149, b: 237, a: 1 };
    if (useLower.includes('office'))
        return { r: 186, g: 85, b: 211, a: 1 };
    if (useLower.includes('industrial') || useLower.includes('warehouse'))
        return { r: 169, g: 169, b: 169, a: 1 };
    if (useLower.includes('hospital') || useLower.includes('clinic'))
        return { r: 220, g: 20, b: 60, a: 1 };
    if (useLower.includes('school') || useLower.includes('university'))
        return { r: 255, g: 215, b: 0, a: 1 };
    if (useLower.includes('mixed'))
        return { r: 255, g: 140, b: 0, a: 1 };
    return { r: 211, g: 211, b: 211, a: 1 };
};

// Calculate polygon area using shoelace formula
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

// Calculate normal vector for a triangle
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

// Calculate triangle area
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

// Determine orientation from normal vector
const getOrientation = (normal: [number, number, number]): 'North' | 'South' | 'East' | 'West' | null => {
    const [nx, ny, nz] = normal;

    const horizontalMagnitude = Math.sqrt(nx * nx + ny * ny);
    if (horizontalMagnitude < 0.5) return null;

    if (Math.abs(ny) > Math.abs(nx)) {
        return ny > 0 ? 'North' : 'South';
    } else {
        return nx > 0 ? 'East' : 'West';
    }
};

function App() {
    const [buildingData, setBuildingData] = useState<BuildingData[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isColoring, setIsColoring] = useState<boolean>(false);
    const [colorMode, setColorMode] = useState<'height' | 'area' | 'volume' | 'floors' | 'use' | 'far' | 'facadeDominant' | 'facadeMixed'>('height');
    const [selectedBuilding, setSelectedBuilding] = useState<string | null>(null);

    // Filter states
    const [minHeight, setMinHeight] = useState<number>(0);
    const [maxHeight, setMaxHeight] = useState<number>(1000);
    const [minArea, setMinArea] = useState<number>(0);
    const [maxArea, setMaxArea] = useState<number>(10000);
    const [minVolume, setMinVolume] = useState<number>(0);
    const [maxVolume, setMaxVolume] = useState<number>(100000);
    const [minFloors, setMinFloors] = useState<number>(0);
    const [maxFloors, setMaxFloors] = useState<number>(100);
    const [minFAR, setMinFAR] = useState<number>(0);
    const [maxFAR, setMaxFAR] = useState<number>(10);

    // Building use tagging states
    const [selectedUse, setSelectedUse] = useState<string>('residential');
    const [buildingUseTags, setBuildingUseTags] = useState<Map<string, string>>(new Map());

    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);
            try {
                const paths = await Forma.geometry.getPathsByCategory({ category: "building" });

                const dataPromises = paths.map(async (path, index) => {
                    const position = await Forma.geometry.getTriangles({ path });

                    // MASSING CALCULATIONS
                    const zValues = [];
                    for (let i = 2; i < position.length; i += 3) {
                        zValues.push(position[i]);
                    }
                    const minZ = Math.min(...zValues);
                    const maxZ = Math.max(...zValues);
                    const height = maxZ - minZ;

                    const footprint = await Forma.geometry.getFootprint({ path });
                    const footprintArea = footprint ? calculatePolygonArea(footprint.coordinates) : 0;

                    const volume = height * footprintArea;
                    const floorCount = Math.round(height / 3.5);
                    const gfa = volume / 3.5;
                    const far = footprintArea > 0 ? gfa / footprintArea : 0;

                    const buildingUse = buildingUseTags.get(path) || 'unknown';

                    // FAÇADE ORIENTATION CALCULATIONS
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
                        path,
                        buildingName: `Building ${index + 1}`,
                        height,
                        footprintArea,
                        volume,
                        floorCount,
                        far,
                        buildingUse,
                        north,
                        south,
                        east,
                        west,
                        totalFacadeArea,
                        dominantOrientation
                    };
                });

                const data = await Promise.all(dataPromises);
                setBuildingData(data);
            } catch (error) {
                console.error("Error fetching building data:", error);
            } finally {
                setIsLoading(false);
            }
        };
        fetchData();
    }, [buildingUseTags]);

    const tagSelectedBuildings = async () => {
        const selectedPaths = await Forma.selection.getSelection();
        const newTags = new Map(buildingUseTags);

        selectedPaths.forEach(path => {
            newTags.set(path, selectedUse);
        });

        setBuildingUseTags(newTags);
    };

    const colorBuildings = async () => {
        setIsColoring(true);
        const selectedPaths = await Forma.selection.getSelection();

        for (let path of selectedPaths) {
            const building = buildingData.find(b => b.path === path);
            if (!building) continue;

            // Check if building passes filters
            const passesHeightFilter = building.height >= minHeight && building.height <= maxHeight;
            const passesAreaFilter = building.footprintArea >= minArea && building.footprintArea <= maxArea;
            const passesVolumeFilter = building.volume >= minVolume && building.volume <= maxVolume;
            const passesFloorsFilter = building.floorCount >= minFloors && building.floorCount <= maxFloors;
            const passesFARFilter = building.far >= minFAR && building.far <= maxFAR;

            if (!passesHeightFilter || !passesAreaFilter || !passesVolumeFilter || !passesFloorsFilter || !passesFARFilter) continue;

            const position = await Forma.geometry.getTriangles({ path });
            const numTriangles = position.length / 9;
            const color = new Uint8Array(numTriangles * 4 * 3);

            let colorIndex = 0;

            // For façade modes, color per-triangle
            if (colorMode === 'facadeMixed') {
                for (let i = 0; i < position.length; i += 9) {
                    const v1: [number, number, number] = [position[i], position[i + 1], position[i + 2]];
                    const v2: [number, number, number] = [position[i + 3], position[i + 4], position[i + 5]];
                    const v3: [number, number, number] = [position[i + 6], position[i + 7], position[i + 8]];

                    const normal = calculateNormal(v1, v2, v3);
                    const orientation = getOrientation(normal);

                    const faceColor = orientation ? ORIENTATION_COLORS[orientation] : { r: 200, g: 200, b: 200, a: 1 };

                    for (let v = 0; v < 3; v++) {
                        color[colorIndex++] = faceColor.r;
                        color[colorIndex++] = faceColor.g;
                        color[colorIndex++] = faceColor.b;
                        color[colorIndex++] = Math.round(faceColor.a * 255);
                    }
                }
            } else {
                // Single color for entire building
                let buildingColor: RgbaColor;
                switch (colorMode) {
                    case 'height':
                        buildingColor = getColorByHeight(building.height);
                        break;
                    case 'area':
                        buildingColor = getColorByArea(building.footprintArea);
                        break;
                    case 'volume':
                        buildingColor = getColorByVolume(building.volume);
                        break;
                    case 'floors':
                        buildingColor = getColorByFloorCount(building.floorCount);
                        break;
                    case 'use':
                        buildingColor = getColorByUse(buildingUseTags.get(building.path) || 'unknown');
                        break;
                    case 'far':
                        buildingColor = getColorByFAR(building.far);
                        break;
                    case 'facadeDominant':
                        buildingColor = ORIENTATION_COLORS[building.dominantOrientation];
                        break;
                    default:
                        buildingColor = { r: 200, g: 200, b: 200, a: 1 };
                }

                for (let i = 0; i < numTriangles; i += 1) {
                    for (let v = 0; v < 3; v++) {
                        color[colorIndex++] = buildingColor.r;
                        color[colorIndex++] = buildingColor.g;
                        color[colorIndex++] = buildingColor.b;
                        color[colorIndex++] = Math.round(buildingColor.a * 255);
                    }
                }
            }

            const geometryData = { position, color };
            Forma.render.updateMesh({ id: path, geometryData });
        }
        setIsColoring(false);
    };

    const reset = () => {
        Forma.render.cleanup();
        setSelectedBuilding(null);
    };

    const selectBuilding = async (path: string) => {
        setSelectedBuilding(path);
        await Forma.selection.setSelection({ selection: [path] });
    };

    // Get filtered building list
    const filteredBuildings = buildingData.filter(b =>
        b.height >= minHeight &&
        b.height <= maxHeight &&
        b.footprintArea >= minArea &&
        b.footprintArea <= maxArea &&
        b.volume >= minVolume &&
        b.volume <= maxVolume &&
        b.floorCount >= minFloors &&
        b.floorCount <= maxFloors &&
        b.far >= minFAR &&
        b.far <= maxFAR
    );

    // Calculate façade totals
    const facadeTotals = buildingData.reduce((acc, b) => ({
        north: acc.north + b.north,
        south: acc.south + b.south,
        east: acc.east + b.east,
        west: acc.west + b.west,
        total: acc.total + b.totalFacadeArea
    }), { north: 0, south: 0, east: 0, west: 0, total: 0 });

    const formatArea = (area: number) => area.toFixed(1);
    const formatPercent = (area: number, total: number) =>
        total > 0 ? ((area / total) * 100).toFixed(1) : '0.0';

    return (
        <>
            <div class="section">
                <h2>Building Analysis Toolkit</h2>
                <p>Total buildings: {buildingData.length}</p>
                <p>Filtered buildings: {filteredBuildings.length}</p>
            </div>

            {isLoading && <div class="section"><p>Analyzing buildings...</p></div>}

            <div class="section">
                <h3>Visualization Mode:</h3>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                        onClick={() => setColorMode('height')}
                        style={{
                            fontWeight: colorMode === 'height' ? 'bold' : 'normal',
                            backgroundColor: colorMode === 'height' ? '#e0e0e0' : 'white'
                        }}
                    >
                        Height
                    </button>
                    <button
                        onClick={() => setColorMode('area')}
                        style={{
                            fontWeight: colorMode === 'area' ? 'bold' : 'normal',
                            backgroundColor: colorMode === 'area' ? '#e0e0e0' : 'white'
                        }}
                    >
                        Area
                    </button>
                    <button
                        onClick={() => setColorMode('volume')}
                        style={{
                            fontWeight: colorMode === 'volume' ? 'bold' : 'normal',
                            backgroundColor: colorMode === 'volume' ? '#e0e0e0' : 'white'
                        }}
                    >
                        Volume
                    </button>
                    <button
                        onClick={() => setColorMode('floors')}
                        style={{
                            fontWeight: colorMode === 'floors' ? 'bold' : 'normal',
                            backgroundColor: colorMode === 'floors' ? '#e0e0e0' : 'white'
                        }}
                    >
                        Floors
                    </button>
                    <button
                        onClick={() => setColorMode('far')}
                        style={{
                            fontWeight: colorMode === 'far' ? 'bold' : 'normal',
                            backgroundColor: colorMode === 'far' ? '#e0e0e0' : 'white'
                        }}
                    >
                        FAR
                    </button>
                    <button
                        onClick={() => setColorMode('use')}
                        style={{
                            fontWeight: colorMode === 'use' ? 'bold' : 'normal',
                            backgroundColor: colorMode === 'use' ? '#e0e0e0' : 'white'
                        }}
                    >
                        Use
                    </button>
                    <button
                        onClick={() => setColorMode('facadeDominant')}
                        style={{
                            fontWeight: colorMode === 'facadeDominant' ? 'bold' : 'normal',
                            backgroundColor: colorMode === 'facadeDominant' ? '#e0e0e0' : 'white'
                        }}
                    >
                        Facade (Dominant)
                    </button>
                    <button
                        onClick={() => setColorMode('facadeMixed')}
                        style={{
                            fontWeight: colorMode === 'facadeMixed' ? 'bold' : 'normal',
                            backgroundColor: colorMode === 'facadeMixed' ? '#e0e0e0' : 'white'
                        }}
                    >
                        Facade (Mixed)
                    </button>
                </div>
            </div>

            {/* LEGENDS - Show based on active mode */}
            {colorMode === 'height' && (
                <div class="section">
                    <h3>Height Legend:</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(33, 71, 55)' }}></div>
                            <span>Low (0-10m)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(85, 107, 47)' }}></div>
                            <span>Medium (10-30m)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(189, 132, 59)' }}></div>
                            <span>High (30-50m)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(225, 169, 94)' }}></div>
                            <span>Very High (50m+)</span>
                        </div>
                    </div>
                </div>
            )}

            {colorMode === 'area' && (
                <div class="section">
                    <h3>Area Legend:</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(173, 216, 230)' }}></div>
                            <span>Small (&lt;100m²)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(100, 149, 237)' }}></div>
                            <span>Medium (100-500m²)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(65, 105, 225)' }}></div>
                            <span>Large (500-1000m²)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(25, 25, 112)' }}></div>
                            <span>Very Large (1000m²+)</span>
                        </div>
                    </div>
                </div>
            )}

            {colorMode === 'volume' && (
                <div class="section">
                    <h3>Volume Legend:</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(255, 182, 193)' }}></div>
                            <span>Small (&lt;1000m³)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(255, 105, 180)' }}></div>
                            <span>Medium (1000-5000m³)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(199, 21, 133)' }}></div>
                            <span>Large (5000-15000m³)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(139, 0, 139)' }}></div>
                            <span>Very Large (15000m³+)</span>
                        </div>
                    </div>
                </div>
            )}

            {colorMode === 'floors' && (
                <div class="section">
                    <h3>Floor Count Legend:</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(144, 238, 144)' }}></div>
                            <span>Low-rise (1-2 floors)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(34, 139, 34)' }}></div>
                            <span>Mid-rise (3-6 floors)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(255, 140, 0)' }}></div>
                            <span>High-rise (7-14 floors)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(178, 34, 34)' }}></div>
                            <span>Tower (15+ floors)</span>
                        </div>
                    </div>
                </div>
            )}

            {colorMode === 'far' && (
                <div class="section">
                    <h3>FAR Legend:</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(255, 250, 205)' }}></div>
                            <span>Very Low (&lt;1.0)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(255, 215, 0)' }}></div>
                            <span>Low (1.0-2.0)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(255, 140, 0)' }}></div>
                            <span>Medium (2.0-3.0)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(255, 69, 0)' }}></div>
                            <span>High (3.0-5.0)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(178, 34, 34)' }}></div>
                            <span>Very High (5.0+)</span>
                        </div>
                    </div>
                </div>
            )}

            {colorMode === 'use' && (
                <div class="section">
                    <h3>Building Use Legend:</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(144, 238, 144)' }}></div>
                            <span>Residential</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(100, 149, 237)' }}></div>
                            <span>Commercial/Retail</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(186, 85, 211)' }}></div>
                            <span>Office</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(169, 169, 169)' }}></div>
                            <span>Industrial</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(220, 20, 60)' }}></div>
                            <span>Healthcare</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(255, 215, 0)' }}></div>
                            <span>Education</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(255, 140, 0)' }}></div>
                            <span>Mixed Use</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(211, 211, 211)' }}></div>
                            <span>Unknown/Other</span>
                        </div>
                    </div>
                </div>
            )}

            {(colorMode === 'facadeDominant' || colorMode === 'facadeMixed') && (
                <>
                    <div class="section">
                        <h3>Orientation Legend:</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(100, 149, 237)' }}></div>
                                <span>North</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(255, 140, 0)' }}></div>
                                <span>South</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(255, 215, 0)' }}></div>
                                <span>East</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <div style={{ width: '20px', height: '20px', backgroundColor: 'rgb(186, 85, 211)' }}></div>
                                <span>West</span>
                            </div>
                        </div>
                    </div>

                    <div class="section">
                        <h3>Overall Facade Statistics:</h3>
                        <div style={{ fontSize: '0.9em' }}>
                            <div><strong>North:</strong> {formatArea(facadeTotals.north)}Sq.m ({formatPercent(facadeTotals.north, facadeTotals.total)}%)</div>
                            <div><strong>South:</strong> {formatArea(facadeTotals.south)}Sq.m ({formatPercent(facadeTotals.south, facadeTotals.total)}%)</div>
                            <div><strong>East:</strong> {formatArea(facadeTotals.east)}Sq.m ({formatPercent(facadeTotals.east, facadeTotals.total)}%)</div>
                            <div><strong>West:</strong> {formatArea(facadeTotals.west)}Sq.m ({formatPercent(facadeTotals.west, facadeTotals.total)}%)</div>
                            <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #ccc' }}>
                                <strong>Total Facade Area:</strong> {formatArea(facadeTotals.total)}Sq.m
                            </div>
                        </div>
                    </div>
                </>
            )}

            {colorMode === 'use' && (
                <div class="section">
                    <h3>Tag Selected Buildings:</h3>
                    <select value={selectedUse} onChange={(e) => setSelectedUse((e.target as HTMLSelectElement).value)}>
                        <option value="residential">Residential</option>
                        <option value="commercial">Commercial/Retail</option>
                        <option value="office">Office</option>
                        <option value="industrial">Industrial</option>
                        <option value="hospital">Healthcare</option>
                        <option value="school">Education</option>
                        <option value="mixed">Mixed Use</option>
                    </select>
                    <button onClick={tagSelectedBuildings}>Tag Selected</button>
                    <p style={{ fontSize: '0.9em', color: '#666' }}>
                        Select buildings in Forma, choose use type, then click Tag Selected
                    </p>
                </div>
            )}

            {/* FILTERS */}
            <div class="section">
                <h3>Height Filter:</h3>
                <div style={{ display: 'flex', gap: '8px', flexDirection: 'column' }}>
                    <input
                        type="number"
                        placeholder="Min height (m)"
                        value={minHeight}
                        onInput={(e) => setMinHeight(Number((e.target as HTMLInputElement).value))}
                    />
                    <input
                        type="number"
                        placeholder="Max height (m)"
                        value={maxHeight}
                        onInput={(e) => setMaxHeight(Number((e.target as HTMLInputElement).value))}
                    />
                </div>
            </div>

            <div class="section">
                <h3>Footprint Area Filter:</h3>
                <div style={{ display: 'flex', gap: '8px', flexDirection: 'column' }}>
                    <input
                        type="number"
                        placeholder="Min area (Sq.m)"
                        value={minArea}
                        onInput={(e) => setMinArea(Number((e.target as HTMLInputElement).value))}
                    />
                    <input
                        type="number"
                        placeholder="Max area (Sq.m)"
                        value={maxArea}
                        onInput={(e) => setMaxArea(Number((e.target as HTMLInputElement).value))}
                    />
                </div>
            </div>

            <div class="section">
                <h3>Volume Filter:</h3>
                <div style={{ display: 'flex', gap: '8px', flexDirection: 'column' }}>
                    <input
                        type="number"
                        placeholder="Min volume (Cu.m)"
                        value={minVolume}
                        onInput={(e) => setMinVolume(Number((e.target as HTMLInputElement).value))}
                    />
                    <input
                        type="number"
                        placeholder="Max volume (Cu.m)"
                        value={maxVolume}
                        onInput={(e) => setMaxVolume(Number((e.target as HTMLInputElement).value))}
                    />
                </div>
            </div>

            <div class="section">
                <h3>Floor Count Filter:</h3>
                <div style={{ display: 'flex', gap: '8px', flexDirection: 'column' }}>
                    <input
                        type="number"
                        placeholder="Min floors"
                        value={minFloors}
                        onInput={(e) => setMinFloors(Number((e.target as HTMLInputElement).value))}
                    />
                    <input
                        type="number"
                        placeholder="Max floors"
                        value={maxFloors}
                        onInput={(e) => setMaxFloors(Number((e.target as HTMLInputElement).value))}
                    />
                </div>
            </div>

            <div class="section">
                <h3>FAR Filter:</h3>
                <div style={{ display: 'flex', gap: '8px', flexDirection: 'column' }}>
                    <input
                        type="number"
                        placeholder="Min FAR"
                        value={minFAR}
                        step="0.1"
                        onInput={(e) => setMinFAR(Number((e.target as HTMLInputElement).value))}
                    />
                    <input
                        type="number"
                        placeholder="Max FAR"
                        value={maxFAR}
                        step="0.1"
                        onInput={(e) => setMaxFAR(Number((e.target as HTMLInputElement).value))}
                    />
                </div>
                <p style={{ fontSize: '0.85em', color: '#666', marginTop: '4px' }}>
                    FAR = Gross Floor Area / Footprint Area
                </p>
            </div>

            <div class="section">
                <button
                    onClick={colorBuildings}
                    disabled={isLoading || isColoring}
                >
                    {isColoring ? 'Coloring...' : 'Apply Colors'}
                </button>
                <button onClick={reset}>Reset</button>
            </div>

            {/* BUILDING CARDS */}
            <div class="section">
                <h3>Building Details:</h3>
                <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
                    {buildingData.map((building) => (
                        <div
                            key={building.path}
                            onClick={() => selectBuilding(building.path)}
                            style={{
                                padding: '12px',
                                marginBottom: '8px',
                                backgroundColor: selectedBuilding === building.path ? '#e3f2fd' : '#f5f5f5',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                border: selectedBuilding === building.path ? '2px solid #2196f3' : '1px solid #ddd'
                            }}
                        >
                            <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>
                                {building.buildingName}
                            </div>
                            <div style={{ fontSize: '0.85em', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                                <div><strong>Height:</strong> {building.height.toFixed(1)}m</div>
                                <div><strong>Floors:</strong> {building.floorCount}</div>
                                <div><strong>Area:</strong> {building.footprintArea.toFixed(0)}Sq.m</div>
                                <div><strong>Volume:</strong> {building.volume.toFixed(0)}Cu.m</div>
                                <div><strong>FAR:</strong> {building.far.toFixed(2)}</div>
                                <div><strong>Use:</strong> {building.buildingUse}</div>
                            </div>
                            <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #ddd', fontSize: '0.85em' }}>
                                <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                                    Facade Orientation
                                    <span style={{
                                        marginLeft: '8px',
                                        padding: '2px 8px',
                                        borderRadius: '4px',
                                        fontSize: '0.9em',
                                        backgroundColor: `rgb(${ORIENTATION_COLORS[building.dominantOrientation].r}, ${ORIENTATION_COLORS[building.dominantOrientation].g}, ${ORIENTATION_COLORS[building.dominantOrientation].b})`,
                                        color: 'white'
                                    }}>
                                        {building.dominantOrientation}
                                    </span>
                                </div>
                                <div>N: {formatArea(building.north)}Sq.m ({formatPercent(building.north, building.totalFacadeArea)}%)</div>
                                <div>S: {formatArea(building.south)}Sq.m ({formatPercent(building.south, building.totalFacadeArea)}%)</div>
                                <div>E: {formatArea(building.east)}Sq.m ({formatPercent(building.east, building.totalFacadeArea)}%)</div>
                                <div>W: {formatArea(building.west)}Sq.m ({formatPercent(building.west, building.totalFacadeArea)}%)</div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </>
    );
}

render(<App />, document.getElementById('app'));