"use client";

import { useMemo, useState } from "react";
import { applyV2FieldEdit, readV2Editable } from "./game-project-v2-edits";
import styles from "./game-source.module.css";

/** Minimal right-side workspace panel for addressable v2 scene/mechanic edits. */
export function V2ScenePanel({
  content,
  disabled,
  onChange
}: {
  content: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const editable = useMemo(() => readV2Editable(content), [content]);
  const [error, setError] = useState("");
  const [sceneId, setSceneId] = useState("");
  if (!editable.ok) return null;
  const { title, launch, scenes, transform, render, modelName } = editable;
  const current = scenes.find((scene) => scene.id === sceneId) ?? scenes[0];
  const apply = (edit: Parameters<typeof applyV2FieldEdit>[1]) => {
    const result = applyV2FieldEdit(content, edit);
    if (!result.ok) {
      setError(`Правка отклонена: ${result.error}`);
      return;
    }
    setError("");
    onChange(result.json);
  };
  return (
    <section className={styles.editor} aria-label="Сцена и механика игры">
      <h3>Сцена и механика</h3>
      <label>
        Название проекта
        <input
          value={title}
          disabled={disabled}
          onChange={(event) => apply({ field: "title", value: event.target.value })}
        />
      </label>
      <label>
        Среда запуска
        <select
          value={launch.runtime}
          disabled={disabled}
          onChange={(event) =>
            apply({
              field: "launch",
              value: {
                runtime: event.target.value as typeof launch.runtime,
                auto_start: launch.auto_start
              }
            })
          }
        >
          <option value="web3d_sandbox">3D-сцена (песочница)</option>
          <option value="canvas2d_worker">Игра на Canvas 2D</option>
        </select>
      </label>
      <label>
        Автозапуск
        <input
          type="checkbox"
          checked={launch.auto_start}
          disabled={disabled}
          onChange={(event) =>
            apply({ field: "launch", value: { ...launch, auto_start: event.target.checked } })
          }
        />
      </label>
      {current && (
        <div>
          <label>
            Сцена
            <select
              value={current.id}
              disabled={disabled}
              onChange={(event) => setSceneId(event.target.value)}
            >
              {scenes.map((scene) => (
                <option key={scene.id} value={scene.id}>
                  {scene.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Заголовок сцены
            <input
              value={current.title}
              disabled={disabled}
              onChange={(event) =>
                apply({
                  field: "scene",
                  id: current.id,
                  value: { title: event.target.value, html: current.html }
                })
              }
            />
          </label>
          <label>
            Разметка сцены
            <textarea
              value={current.html}
              disabled={disabled}
              onChange={(event) =>
                apply({
                  field: "scene",
                  id: current.id,
                  value: { title: current.title, html: event.target.value }
                })
              }
            />
          </label>
        </div>
      )}
      {transform && modelName && (
        <div>
          <p>Модель {modelName}: исходные вершины сохраняются.</p>
          <label>
            Поворот (x,y)
            <input
              value={transform.rotation}
              disabled={disabled}
              onChange={(event) =>
                apply({
                  field: "model_transform",
                  name: modelName,
                  value: { ...transform, rotation: event.target.value }
                })
              }
            />
          </label>
          <label>
            Масштаб
            <input
              value={transform.scale}
              disabled={disabled}
              onChange={(event) =>
                apply({
                  field: "model_transform",
                  name: modelName,
                  value: { ...transform, scale: event.target.value }
                })
              }
            />
          </label>
        </div>
      )}
      {render && modelName && (
        <div>
          <p>Камера, свет и материал — параметры рендера сцены.</p>
          <label>
            Камера (x,y,z,fov)
            <input
              value={render.camera}
              disabled={disabled}
              onChange={(event) =>
                apply({
                  field: "model_render",
                  name: modelName,
                  value: { ...render, camera: event.target.value }
                })
              }
            />
          </label>
          <label>
            Свет (x,y,z,intensity)
            <input
              value={render.light}
              disabled={disabled}
              onChange={(event) =>
                apply({
                  field: "model_render",
                  name: modelName,
                  value: { ...render, light: event.target.value }
                })
              }
            />
          </label>
          <label>
            Цвет материала
            <input
              type="color"
              value={render.color}
              disabled={disabled}
              onChange={(event) =>
                apply({
                  field: "model_render",
                  name: modelName,
                  value: { ...render, color: event.target.value }
                })
              }
            />
          </label>
          <label>
            Каркасный режим
            <input
              type="checkbox"
              checked={render.wireframe}
              disabled={disabled}
              onChange={(event) =>
                apply({
                  field: "model_render",
                  name: modelName,
                  value: { ...render, wireframe: event.target.checked }
                })
              }
            />
          </label>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
