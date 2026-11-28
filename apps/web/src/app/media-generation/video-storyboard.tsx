import { useEffect, useRef, useState } from "react";
import type { StudioStoryboard, StudioStoryboardChange } from "@cosmora/contracts";
import styles from "./media-workbench.module.css";

const endpoint = "/api/v1/media/storyboard";
type Scene = StudioStoryboard["scenes"][number];

async function fetchBoard(signal?: AbortSignal): Promise<StudioStoryboard> {
  const response = await fetch(endpoint, {
    cache: "no-store",
    signal: signal ?? AbortSignal.timeout(8000)
  });
  if (!response.ok) throw Error("Не удалось открыть раскадровку.");
  return response.json() as Promise<StudioStoryboard>;
}

export function VideoStoryboard({
  description,
  duration,
  onSelect,
  onSelectClip
}: {
  description: string;
  duration: string;
  onSelect: (description: string, duration: string) => void;
  onSelectClip?: (
    scene: { id: string; version: number },
    description: string,
    seconds: number
  ) => void;
}) {
  const [board, setBoard] = useState<StudioStoryboard | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetchBoard(AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]))
      .then(setBoard)
      .catch(() => {
        if (!controller.signal.aborted) setMessage("Не удалось открыть раскадровку.");
      });
    return () => controller.abort();
  }, []);

  async function change(action: "add" | "revise" | "accept", scene?: Scene, revision?: number) {
    if (!board || inFlight.current) return;
    const operation_id = crypto.randomUUID();
    const expected_version = board.version;
    const duration_seconds = duration === "15" ? 15 : duration === "10" ? 10 : 5;
    let body: StudioStoryboardChange;
    if (action === "add")
      body = { action, operation_id, expected_version, description, duration_seconds };
    else if (action === "revise" && scene)
      body = {
        action,
        operation_id,
        expected_version,
        description,
        duration_seconds,
        scene_id: scene.id
      };
    else if (action === "accept" && scene && revision)
      body = { action, operation_id, expected_version, scene_id: scene.id, revision };
    else return;

    setSaving(true);
    setMessage("");
    inFlight.current = true;
    try {
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) throw Error();
      setBoard((await response.json()) as StudioStoryboard);
      setMessage("Раскадровка сохранена.");
    } catch {
      try {
        const current = await fetchBoard();
        setBoard(current);
        setMessage(
          current.last_operation_id === operation_id
            ? "Раскадровка сохранена."
            : "Сохранение не подтверждено. Сверьте версии перед повтором."
        );
      } catch {
        setMessage("Статус сохранения неизвестен. Обновите раскадровку перед повтором.");
        setBoard(null);
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  const current = board?.scenes.find(({ id }) => id === selected);
  return (
    <section className={styles.empty} aria-label="Раскадровка">
      <h3>Текстовая раскадровка</h3>
      <p>
        Сцены и версии можно сохранить и принять. Экспорт содержит JSON с описаниями и плановой
        длительностью.
      </p>
      {board ? (
        <>
          <button
            type="button"
            disabled={!description.trim() || saving || board.scenes.length >= 12}
            onClick={() => void change("add")}
          >
            Добавить сцену
          </button>
          {current && (
            <button
              type="button"
              disabled={!description.trim() || saving || current.revisions.length >= 12}
              onClick={() => void change("revise", current)}
            >
              Сохранить новую версию сцены
            </button>
          )}
          {board.scenes.length > 0 && (
            <>
              <ol>
                {board.scenes.map((scene, index) => (
                  <li key={scene.id}>
                    <button
                      type="button"
                      aria-pressed={selected === scene.id}
                      disabled={saving}
                      onClick={() => {
                        const latest = scene.revisions.at(-1)!;
                        setSelected(scene.id);
                        onSelect(latest.description, String(latest.duration_seconds));
                      }}
                    >
                      Сцена {index + 1}
                    </button>
                    {scene.accepted_version && (
                      <span> · принята версия {scene.accepted_version}</span>
                    )}
                    {selected === scene.id && (
                      <ol aria-label="Версии сцены">
                        {scene.revisions.map((revision) => (
                          <li key={revision.version}>
                            <p>
                              Версия {revision.version} · {revision.duration_seconds} с
                            </p>
                            <p>{revision.description}</p>
                            {onSelectClip && (
                              <button
                                type="button"
                                onClick={() =>
                                  onSelectClip(
                                    { id: scene.id, version: revision.version },
                                    revision.description,
                                    revision.duration_seconds
                                  )
                                }
                              >
                                Выбрать версию {revision.version} для клипа
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={saving || scene.accepted_version === revision.version}
                              onClick={() => void change("accept", scene, revision.version)}
                            >
                              Принять версию {revision.version}
                            </button>
                          </li>
                        ))}
                      </ol>
                    )}
                  </li>
                ))}
              </ol>
              <a href={endpoint + "?download=1"}>Скачать раскадровку JSON</a>
            </>
          )}
        </>
      ) : (
        <button
          type="button"
          onClick={() =>
            void fetchBoard()
              .then((current) => {
                setBoard(current);
                setMessage("");
              })
              .catch(() => setMessage("Не удалось открыть раскадровку."))
          }
        >
          Обновить раскадровку
        </button>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
