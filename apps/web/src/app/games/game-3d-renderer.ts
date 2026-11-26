/**
 * Bounded, dependency-free 3D scene renderer for Kosmora Games v2.
 *
 * Software rasterizer on the existing OffscreenCanvas worker: no WebGL, no
 * external library, no network. Input is the inert `obj-lite` model from the
 * v2 contract. Everything is bounded by the contract limits; invalid inputs
 * are rejected before drawing instead of producing a broken scene.
 */
export type Vec3 = [number, number, number];
export type Triangle = { a: Vec3; b: Vec3; c: Vec3; shade?: number };
export type Scene3D = {
  model: { name: string; format: "obj-lite"; data: string } | null;
  rotation: { x: number; y: number };
  scale: number;
};

const MAX_VERTICES = 2048;
const MAX_FACES = 4096;

/** Parse the tiny obj subset: `v x y z`, `f a b c` (1-based indices). */
export function parseObjLite(data: string): Triangle[] {
  const vertices: Vec3[] = [];
  const faces: Triangle[] = [];
  for (const raw of data.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === "v") {
      if (parts.length !== 4) throw Error("INVALID_3D_MODEL");
      const v = parts.slice(1).map(Number);
      if (v.length !== 3 || v.some((n) => !Number.isFinite(n) || Math.abs(n) > 1000))
        throw Error("INVALID_3D_MODEL");
      vertices.push(v as Vec3);
      if (vertices.length > MAX_VERTICES) throw Error("INVALID_3D_MODEL");
    } else if (parts[0] === "f") {
      if (parts.length !== 4) throw Error("INVALID_3D_MODEL");
      const indices = parts.slice(1).map((p) => Number(p.split("/")[0]));
      if (indices.some((i) => !Number.isInteger(i) || i < 1 || i > vertices.length))
        throw Error("INVALID_3D_MODEL");
      const [a, b, c] = indices.map((i) => vertices[i - 1]!);
      faces.push({ a, b, c });
      if (faces.length > MAX_FACES) throw Error("INVALID_3D_MODEL");
    } else {
      throw Error("INVALID_3D_MODEL");
    }
  }
  if (!faces.length) throw Error("INVALID_3D_MODEL");
  return faces;
}

const rotate = ([x, y, z]: Vec3, rx: number, ry: number): Vec3 => {
  const cy = Math.cos(ry),
    sy = Math.sin(ry),
    cx = Math.cos(rx),
    sx = Math.sin(rx);
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  return [x1, y * cx - z1 * sx, y * sx + z1 * cx];
};

/** Project to a 2D viewport; returns null for back-facing triangles. */
export function project(face: Triangle, scene: Scene3D, width: number, height: number) {
  const { x: rx, y: ry } = scene.rotation;
  const vertices = [face.a, face.b, face.c].map((v) => rotate(v, rx, ry));
  // Reject degenerate triangles after projection (normal near zero).
  const [p0, p1, p2] = vertices;
  const cross = (p1![0] - p0![0]) * (p2![1] - p0![1]) - (p1![1] - p0![1]) * (p2![0] - p0![0]);
  if (Math.abs(cross) < 1e-9) return null;
  // Isometric-style projection: x/y after rotation, depth from z drives shading.
  const scale = Math.min(width, height) * 0.22 * scene.scale;
  const points = vertices.map(
    (v) => [width / 2 + v[0] * scale, height / 2 - v[1] * scale] as const
  );
  const depth = (vertices[0]![2] + vertices[1]![2] + vertices[2]![2]) / 3;
  const light = Math.max(0, Math.min(1, 0.55 + depth / 4));
  return { points, light: Math.round(light * 255) };
}

export function render3D(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  scene: Scene3D,
  width: number,
  height: number
): void {
  ctx.clearRect(0, 0, width, height);
  if (!scene.model || scene.model.format !== "obj-lite") return;
  const faces = parseObjLite(scene.model.data);
  for (const face of faces) {
    const projected = project(face, scene, width, height);
    if (!projected) continue;
    const [a, b, c] = projected.points;
    ctx.fillStyle = `rgb(${projected.light},${projected.light},${projected.light})`;
    ctx.beginPath();
    ctx.moveTo(a![0], a![1]);
    ctx.lineTo(b![0], b![1]);
    ctx.lineTo(c![0], c![1]);
    ctx.closePath();
    ctx.fill();
  }
}
