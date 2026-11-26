import { describe, expect, test } from "vitest";
import { parseObjLite, project, render3D, type Scene3D } from "./game-3d-renderer";

const cube = ["v 0 0 0", "v 1 0 0", "v 1 1 0", "v 0 1 0", "f 1 2 3", "f 1 3 4"].join("\n");

const scene = (data = cube): Scene3D => ({
  model: { name: "cube.obj", format: "obj-lite", data },
  rotation: { x: 0.2, y: 0.4 },
  scale: 1
});

describe("obj-lite 3D renderer", () => {
  test("parses bounded obj-lite and rejects malformed/unbounded data", () => {
    expect(parseObjLite(cube)).toHaveLength(2);
    expect(() => parseObjLite("v 0 0 0\nf 1 2 9")).toThrow("INVALID_3D_MODEL");
    expect(() => parseObjLite("g other")).toThrow("INVALID_3D_MODEL");
    expect(() => parseObjLite("v 0 0 0")).toThrow("INVALID_3D_MODEL");
    expect(() => parseObjLite(`v 9999 0 0\nf 1 1 1`)).toThrow("INVALID_3D_MODEL");
  });

  test("projects triangles into the canvas viewport", () => {
    const projected = project(parseObjLite(cube)[0]!, scene(), 800, 500);
    expect(projected).not.toBeNull();
    for (const [x, y] of projected!.points) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(800);
    }
    expect(projected!.light).toBeGreaterThanOrEqual(0);
    expect(projected!.light).toBeLessThanOrEqual(255);
  });

  test("renders without throwing on a canvas-like context", () => {
    const calls: string[] = [];
    const ctx = {
      clearRect: () => calls.push("clear"),
      beginPath: () => calls.push("path"),
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      fill: () => calls.push("fill"),
      set fillStyle(_value: string) {}
    } as unknown as OffscreenCanvasRenderingContext2D;
    render3D(ctx, scene(), 800, 500);
    expect(calls.filter((c) => c === "fill")).toHaveLength(2);
    render3D(ctx, { ...scene(), model: null }, 800, 500);
  });

  test("rotation changes the projected image", () => {
    const face = parseObjLite(cube)[0]!;
    const a = project(face, scene(), 800, 500)!.points;
    const b = project(face, { ...scene(), rotation: { x: 1.2, y: 0.9 } }, 800, 500)!.points;
    expect(a).not.toEqual(b);
  });
});
