"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { buildThreeCamera, buildThreeScene, type SceneDescriptor } from "./three-scene";

/**
 * Trusted WebGL view for inert v2 model data. No user code runs in the app origin:
 * only the fixed scene descriptor and obj-lite data are passed in.
 */
export function ThreeGameView({
  model,
  descriptor,
  running = true
}: {
  model: string | null;
  descriptor: SceneDescriptor;
  running?: boolean;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const frame = useRef<number | null>(null);
  const descriptorKey = JSON.stringify(descriptor);
  useEffect(() => {
    const node = host.current;
    if (!node || !model) return;
    let scene: THREE.Scene;
    try {
      scene = buildThreeScene(model, descriptor);
    } catch {
      return;
    }
    const width = 800,
      height = 500;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height, false);
    renderer.domElement.setAttribute("aria-label", "3D-сцена игры");
    node.append(renderer.domElement);
    const camera = buildThreeCamera(descriptor, width, height);
    const mesh = scene.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    const render = () => {
      if (mesh) mesh.rotation.y += descriptor.rotation.y ? 0.002 : 0;
      renderer.render(scene, camera);
      if (running) frame.current = requestAnimationFrame(render);
    };
    render();
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      renderer.dispose();
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const geometry = object.geometry as { dispose: () => void };
        geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) (material as { dispose: () => void }).dispose();
      });
      renderer.domElement.remove();
    };
  }, [model, descriptorKey, running]);
  if (!model) return <p>Модель сцены не добавлена.</p>;
  return <div ref={host} className="three-game-view" />;
}
