import * as THREE from "three";
import { parseObjLite } from "./game-3d-renderer";

/** Bounded, data-only scene descriptor. No arbitrary code, no URLs, no model fetch. */
export type SceneDescriptor = {
  rotation: { x: number; y: number };
  scale: number;
  camera: { x: number; y: number; z: number; fov: number };
  light: { x: number; y: number; z: number; intensity: number };
  material: { color: string; wireframe: boolean; metalness: number; roughness: number };
};

export const DEFAULT_SCENE: SceneDescriptor = {
  rotation: { x: 0.25, y: 0.45 },
  scale: 1,
  camera: { x: 0, y: 1.5, z: 5, fov: 50 },
  light: { x: 3, y: 4, z: 5, intensity: 2 },
  material: { color: "#62d9b0", wireframe: false, metalness: 0.1, roughness: 0.6 }
};

const bounded = (value: number, min: number, max: number, fallback: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const safeColor = (value: string) =>
  /^#[0-9a-fA-F]{6}$/.test(value) ? value : DEFAULT_SCENE.material.color;

/** Build a real three.js scene from inert data. Throws on invalid model input. */
export function buildThreeScene(objLite: string, descriptor: SceneDescriptor): THREE.Scene {
  const triangles = parseObjLite(objLite);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0c1118");

  const positions: number[] = [];
  for (const face of triangles)
    for (const point of [face.a, face.b, face.c]) positions.push(point[0], point[1], point[2]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: safeColor(descriptor.material.color),
    wireframe: Boolean(descriptor.material.wireframe),
    metalness: bounded(descriptor.material.metalness, 0, 1, 0.1),
    roughness: bounded(descriptor.material.roughness, 0, 1, 0.6)
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.set(
    bounded(descriptor.rotation.x, -Math.PI, Math.PI, 0),
    bounded(descriptor.rotation.y, -Math.PI, Math.PI, 0),
    0
  );
  mesh.scale.setScalar(bounded(descriptor.scale, 0.1, 10, 1));
  scene.add(mesh);

  const light = new THREE.DirectionalLight("#ffffff", bounded(descriptor.light.intensity, 0, 5, 1));
  light.position.set(
    bounded(descriptor.light.x, -20, 20, 3),
    bounded(descriptor.light.y, -20, 20, 4),
    bounded(descriptor.light.z, -20, 20, 5)
  );
  scene.add(light);
  scene.add(new THREE.AmbientLight("#ffffff", 0.35));
  return scene;
}

export function buildThreeCamera(descriptor: SceneDescriptor, width: number, height: number) {
  const camera = new THREE.PerspectiveCamera(
    bounded(descriptor.camera.fov, 10, 120, 50),
    Math.max(1, width) / Math.max(1, height),
    0.1,
    100
  );
  camera.position.set(
    bounded(descriptor.camera.x, -20, 20, 0),
    bounded(descriptor.camera.y, -20, 20, 1.5),
    bounded(descriptor.camera.z, -20, 20, 5)
  );
  camera.lookAt(0, 0, 0);
  return camera;
}
