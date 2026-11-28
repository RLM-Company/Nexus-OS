import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildThreeCamera, buildThreeScene, DEFAULT_SCENE } from "./three-scene";

const model = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3";

describe("real three.js scene construction", () => {
  it("builds a scene with mesh, directional and ambient light from inert data", () => {
    const scene = buildThreeScene(model, DEFAULT_SCENE);
    const mesh = scene.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    expect(mesh).toBeDefined();
    expect(mesh!.geometry.getAttribute("position").count).toBe(3);
    expect(mesh!.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(scene.children.filter((child) => child instanceof THREE.DirectionalLight)).toHaveLength(
      1
    );
    expect(scene.children.filter((child) => child instanceof THREE.AmbientLight)).toHaveLength(1);
  });

  it("applies transform and material changes to the same model", () => {
    const changed = {
      ...DEFAULT_SCENE,
      rotation: { x: 1, y: 2 },
      scale: 2,
      material: { color: "#ff8800", wireframe: true, metalness: 0.5, roughness: 0.2 }
    };
    const scene = buildThreeScene(model, changed);
    const mesh = scene.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh)!;
    expect(mesh.rotation.x).toBe(1);
    expect(mesh.rotation.y).toBe(2);
    expect(mesh.scale.x).toBe(2);
    expect((mesh.material as THREE.MeshStandardMaterial).wireframe).toBe(true);
    expect((mesh.material as THREE.MeshStandardMaterial).color.getHexString()).toBe("ff8800");
    // Original vertices unchanged.
    expect(mesh.geometry.getAttribute("position").getX(1)).toBe(1);
  });

  it("bounds invalid camera/light/material values and rejects invalid models", () => {
    const camera = buildThreeCamera(
      { ...DEFAULT_SCENE, camera: { x: 999, y: -999, z: 0, fov: 999 } },
      800,
      500
    );
    expect(camera.position.x).toBe(20);
    expect(camera.fov).toBe(120);
    const scene = buildThreeScene(model, {
      ...DEFAULT_SCENE,
      light: { x: 999, y: -999, z: 1, intensity: 99 },
      material: { color: "javascript:alert(1)", wireframe: false, metalness: 99, roughness: -1 }
    });
    const material = scene.children.find(
      (child): child is THREE.Mesh => child instanceof THREE.Mesh
    )!.material as THREE.MeshStandardMaterial;
    expect(material.color.getHexString()).toBe(DEFAULT_SCENE.material.color.slice(1));
    expect(material.metalness).toBe(1);
    expect(material.roughness).toBe(0);
    expect(() => buildThreeScene("v 0 0\nf 1 2 3", DEFAULT_SCENE)).toThrow();
  });
});
