// Context-highlight envelope: pure geometry + GLB encoding (no Forma calls).
//
// The envelope is a stack of height bands. Each band is the convex hull of the geometry
// that reaches above its base, pushed outwards by a margin, so setbacks and lower blocks
// are followed instead of one hull being extruded to the full height. The top gets headroom.
// It is encoded as a binary glTF (GLB) so it can be uploaded as an element's `volumeMesh` representation.

export type Point = [number, number];

/** glTF is Y-up by specification; Forma is Z-up. Set false if the envelope appears lying on its side. */
export const GLB_Y_UP = true;

/** Envelope colour, linear RGBA 0–1 (red, semi-transparent). */
const ENVELOPE_RGBA: [number, number, number, number] = [0.9, 0.1, 0.1, 0.45];

const cross = (o: Point, a: Point, b: Point) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Convex hull (Andrew's monotone chain), counter-clockwise, no repeated end point. */
export const convexHull = (points: Point[]): Point[] => {
    const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (pts.length < 3) return pts;
    const lower: Point[] = [];
    for (const p of pts) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
        lower.push(p);
    }
    const upper: Point[] = [];
    for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
        upper.push(p);
    }
    lower.pop();
    upper.pop();
    return [...lower, ...upper];
};

/** Offsets a counter-clockwise convex polygon outwards by `distance` (mitred corners). */
export const offsetConvex = (hull: Point[], distance: number): Point[] => {
    const n = hull.length;
    if (n < 3 || distance === 0) return hull;
    // Outward unit normal of each edge i -> i+1 (for a CCW polygon it points to the right of travel).
    const normals = hull.map((p, i) => {
        const q = hull[(i + 1) % n];
        const dx = q[0] - p[0], dy = q[1] - p[1];
        const len = Math.hypot(dx, dy) || 1;
        return [dy / len, -dx / len] as Point;
    });
    return hull.map((p, i) => {
        const a = normals[(i + n - 1) % n], b = normals[i];
        const k = distance / Math.max(1 + a[0] * b[0] + a[1] * b[1], 0.2); // cap very sharp mitres
        return [p[0] + (a[0] + b[0]) * k, p[1] + (a[1] + b[1]) * k] as Point;
    });
};

export interface EnvelopeInput {
    /** Triangle positions (flat XYZ, 9 floats per triangle) of every selected building, scene metres. */
    meshes: Float32Array[];
    /** Sideways and upward clearance around the buildings, in metres. */
    margin: number;
    /** Roof levels closer together than this (metres) are treated as one step. */
    stepTolerance?: number;
}

export interface Envelope {
    /** Flat triangle list, XYZ per vertex, relative to `origin` (Forma Z-up). */
    positions: number[];
    /** Where `positions` are relative to; use as the element's translation. */
    origin: [number, number, number];
    /** Number of stacked height bands (1 = a plain extruded hull). */
    bands: number;
}

/** Roofs smaller than this (m²) do not create a step (plant rooms, parapets). */
const MIN_STEP_AREA = 4;

/**
 * Heights at which the buildings step: clusters of upward-facing (roof) triangles, merged within
 * `tolerance`, each represented by its highest point. The result always ends at `maxZ`.
 */
const stepLevels = (meshes: Float32Array[], minZ: number, maxZ: number, tolerance: number): number[] => {
    const roofs: { z: number; area: number }[] = [];
    for (const m of meshes) {
        for (let i = 0; i < m.length; i += 9) {
            const ux = m[i + 3] - m[i], uy = m[i + 4] - m[i + 1], uz = m[i + 5] - m[i + 2];
            const vx = m[i + 6] - m[i], vy = m[i + 7] - m[i + 1], vz = m[i + 8] - m[i + 2];
            const nz = ux * vy - uy * vx;
            const len = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, nz);
            if (len > 0 && nz / len > 0.5) roofs.push({ z: Math.max(m[i + 2], m[i + 5], m[i + 8]), area: nz / 2 });
        }
    }
    roofs.sort((a, b) => a.z - b.z);
    const levels: number[] = [];
    let cluster: { top: number; area: number; start: number } | null = null;
    const close = () => {
        if (cluster && cluster.area >= MIN_STEP_AREA && cluster.top > minZ + tolerance && cluster.top < maxZ - tolerance) {
            levels.push(cluster.top);
        }
    };
    for (const r of roofs) {
        if (cluster && r.z - cluster.start <= tolerance) {
            cluster.top = Math.max(cluster.top, r.z);
            cluster.area += r.area;
        } else {
            close();
            cluster = { top: r.z, area: r.area, start: r.z };
        }
    }
    close();
    return [...levels, maxZ];
};

/** Builds the stepped envelope mesh, or null when the geometry gives no usable area. */
export const buildEnvelope = ({ meshes, margin, stepTolerance = 1.5 }: EnvelopeInput): Envelope | null => {
    let minZ = Infinity, maxZ = -Infinity;
    const pts: [number, number, number][] = [];
    for (const m of meshes) {
        for (let i = 0; i < m.length; i += 3) {
            pts.push([m[i], m[i + 1], m[i + 2]]);
            if (m[i + 2] < minZ) minZ = m[i + 2];
            if (m[i + 2] > maxZ) maxZ = m[i + 2];
        }
    }
    if (pts.length === 0) return null;

    // Each band spans two step levels; its outline is the hull of the geometry reaching above its base.
    const tops = stepLevels(meshes, minZ, maxZ, stepTolerance);
    const bands: { bottom: number; top: number; ring: Point[] }[] = [];
    let bottom = minZ;
    for (const level of tops) {
        const first = bands.length === 0;
        const above = pts.filter((p) => (first ? p[2] >= bottom : p[2] > bottom + 1e-6)).map((p) => [p[0], p[1]] as Point);
        const hull = convexHull(above);
        if (hull.length >= 3) bands.push({ bottom, top: level, ring: offsetConvex(hull, margin) });
        bottom = level;
    }
    if (bands.length === 0) return null;
    bands[bands.length - 1].top += margin; // headroom above the tallest roof

    const base = bands[0].ring;
    const ox = base.reduce((s, p) => s + p[0], 0) / base.length;
    const oy = base.reduce((s, p) => s + p[1], 0) / base.length;
    const oz = minZ;

    const positions: number[] = [];
    const tri = (a: number[], b: number[], c: number[]) => positions.push(...a, ...b, ...c);
    bands.forEach((band, bi) => {
        const ring = band.ring.map((p) => [p[0] - ox, p[1] - oy] as Point);
        const lo = band.bottom - oz, hi = band.top - oz;
        const at = (p: Point, z: number) => [p[0], p[1], z];
        for (let i = 1; i < ring.length - 1; i++) {
            tri(at(ring[0], hi), at(ring[i], hi), at(ring[i + 1], hi)); // roof, faces up
            if (bi === 0) tri(at(ring[0], lo), at(ring[i + 1], lo), at(ring[i], lo)); // floor, faces down
        }
        for (let i = 0; i < ring.length; i++) {
            const p = ring[i], q = ring[(i + 1) % ring.length];
            tri(at(p, lo), at(q, lo), at(q, hi)); // walls, face outwards
            tri(at(p, lo), at(q, hi), at(p, hi));
        }
    });
    return { positions, origin: [ox, oy, oz], bands: bands.length };
};

/** Column-major 4x4 translation matrix, as `Forma.elements.add` expects. */
export const translationMatrix = ([x, y, z]: [number, number, number]) =>
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1] as [
        number, number, number, number, number, number, number, number,
        number, number, number, number, number, number, number, number,
    ];

/** Encodes a flat triangle list (Forma Z-up) as a binary glTF with flat normals and a red material. */
export const encodeGlb = (positionsZUp: number[]): ArrayBuffer => {
    const count = positionsZUp.length / 3;
    const pos = new Float32Array(positionsZUp.length);
    for (let i = 0; i < count; i++) {
        const x = positionsZUp[i * 3], y = positionsZUp[i * 3 + 1], z = positionsZUp[i * 3 + 2];
        // Z-up -> glTF Y-up is a rotation (x, z, -y), so winding is preserved.
        pos.set(GLB_Y_UP ? [x, z, -y] : [x, y, z], i * 3);
    }
    const nrm = new Float32Array(pos.length);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i += 3) {
        const [ax, ay, az] = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
        const [ux, uy, uz] = [pos[i * 3 + 3] - ax, pos[i * 3 + 4] - ay, pos[i * 3 + 5] - az];
        const [vx, vy, vz] = [pos[i * 3 + 6] - ax, pos[i * 3 + 7] - ay, pos[i * 3 + 8] - az];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        for (let v = 0; v < 3; v++) nrm.set([nx, ny, nz], (i + v) * 3);
    }
    for (let i = 0; i < count; i++) {
        for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], pos[i * 3 + k]);
            max[k] = Math.max(max[k], pos[i * 3 + k]);
        }
    }

    const byteLength = pos.byteLength + nrm.byteLength;
    const json = {
        asset: { version: '2.0', generator: 'ASFormaBuildingMetrics' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0, name: 'Context envelope' }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0 }] }],
        materials: [{
            name: 'Highlight',
            alphaMode: 'BLEND',
            doubleSided: true,
            pbrMetallicRoughness: { baseColorFactor: ENVELOPE_RGBA, metallicFactor: 0, roughnessFactor: 1 },
        }],
        accessors: [
            { bufferView: 0, componentType: 5126, count, type: 'VEC3', min, max },
            { bufferView: 1, componentType: 5126, count, type: 'VEC3' },
        ],
        bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: pos.byteLength, target: 34962 },
            { buffer: 0, byteOffset: pos.byteLength, byteLength: nrm.byteLength, target: 34962 },
        ],
        buffers: [{ byteLength }],
    };

    const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
    const jsonPadded = Math.ceil(jsonBytes.length / 4) * 4; // chunks are 4-byte aligned
    const total = 12 + 8 + jsonPadded + 8 + byteLength;
    const out = new ArrayBuffer(total);
    const view = new DataView(out);
    const bytes = new Uint8Array(out);
    view.setUint32(0, 0x46546c67, true); // "glTF"
    view.setUint32(4, 2, true);
    view.setUint32(8, total, true);
    view.setUint32(12, jsonPadded, true);
    view.setUint32(16, 0x4e4f534a, true); // "JSON"
    bytes.set(jsonBytes, 20);
    bytes.fill(0x20, 20 + jsonBytes.length, 20 + jsonPadded); // pad with spaces
    const binStart = 20 + jsonPadded;
    view.setUint32(binStart, byteLength, true);
    view.setUint32(binStart + 4, 0x004e4942, true); // "BIN\0"
    bytes.set(new Uint8Array(pos.buffer), binStart + 8);
    bytes.set(new Uint8Array(nrm.buffer), binStart + 8 + pos.byteLength);
    return out;
};
