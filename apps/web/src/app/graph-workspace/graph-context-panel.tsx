"use client";
import { useState } from "react";
import type {
  IntelligenceGraphContextPreview,
  IntelligenceGraphContextState,
  IntelligenceGraphModelContext
} from "@cosmora/contracts";

type Preview = IntelligenceGraphContextPreview & { state: IntelligenceGraphContextState };
const control = {
  border: "1px solid #aaa",
  borderRadius: 8,
  padding: 10,
  font: "inherit",
  background: "#fff",
  color: "#171717"
};
const hash = async (value: unknown) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)))
    )
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    ...(init?.body ? { headers: { "content-type": "application/json" } } : {})
  });
  if (!response.ok) {
    if (response.status === 409)
      throw new Error("Материалы проекта изменились. Проверьте текущее сохранение перед повтором.");
    if (response.status === 413)
      throw new Error(
        "Контекст не помещается целиком либо в материалах проекта нет места. Уточните запрос или освободите место в материалах."
      );
    if (response.status === 422)
      throw new Error("По этому запросу релевантных данных в графе не найдено. Уточните запрос.");
    if (response.status === 423)
      throw new Error("Изменения временно заблокированы операцией с данными аккаунта.");
    if (response.status === 404) throw new Error("Граф или проект недоступен.");
    if (response.status === 400) throw new Error("Запрос или проверенный хеш контекста не совпал.");
    throw new Error("Сервис контекста сейчас недоступен.");
  }
  return (await response.json()) as T;
}

export function GraphContextPanel({
  projectId,
  graphId,
  revision
}: {
  projectId: string;
  graphId: string;
  revision: number;
}) {
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [notice, setNotice] = useState("");
  const url = `/api/v1/projects/${encodeURIComponent(projectId)}/intelligence-graphs/${encodeURIComponent(graphId)}/context`;
  const body = preview
    ? (JSON.parse(preview.attachment.content) as IntelligenceGraphModelContext)
    : null;
  const load = async (q: string) => {
    const result = await request<Preview>(`${url}?q=${encodeURIComponent(q)}&revision=${revision}`);
    const content = JSON.parse(result.attachment.content) as IntelligenceGraphModelContext;
    if (
      content.format !== "kosmora.graph-context.v1" ||
      content.graph.id !== graphId ||
      content.graph.revision !== revision ||
      content.query !== q.trim() ||
      (await hash([
        result.attachment.name,
        result.attachment.content,
        result.attachment.source_type ?? null
      ])) !== result.sha256
    )
      throw new Error("Полученный снимок не совпал с выбранным графом, запросом или хешем.");
    setPreview(result);
    setReviewed(false);
    setUncertain(false);
    return result;
  };
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      await action();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Не удалось выполнить действие.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      aria-label="Контекст графа для модели"
      style={{ border: "1px solid #d1d1d1", borderRadius: 12, padding: 18, background: "#fff" }}
    >
      <h2>Контекст графа для модели</h2>
      <p>
        Соберите снимок ревизии {revision}, просмотрите источники и позиции, затем добавьте его в
        материалы проекта. Подготовка и сохранение не запускают модель.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await load(query);
          });
        }}
        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
      >
        <input
          aria-label="Запрос для контекста графа"
          style={{ ...control, flex: "1 1 220px" }}
          value={query}
          maxLength={500}
          disabled={busy || uncertain}
          required
          onChange={(e) => {
            setQuery(e.target.value);
            setPreview(null);
            setReviewed(false);
          }}
        />
        <button style={control} disabled={busy || uncertain || !query.trim()} type="submit">
          Подготовить контекст
        </button>
      </form>
      {notice && <p role="status">{notice}</p>}
      {preview && body && (
        <div>
          <p>
            Ревизия {body.graph.revision} · узлов: {preview.statistics.nodes} · связей:{" "}
            {preview.statistics.edges} · противоречий: {preview.statistics.conflicts}.
          </p>
          <p>
            Пропущено узлов: {preview.statistics.omitted_nodes}, связей:{" "}
            {preview.statistics.omitted_edges}.
            {preview.statistics.retrieval_truncated ? " Сам поиск также ограничен бюджетом." : ""}{" "}
            Каждый включённый разбор содержит все свои позиции.
          </p>
          <p>
            Существующие инструкции проекта и остальные файлы сохранятся. Других файлов:{" "}
            {preview.state.retained_files.length}.
          </p>
          {preview.state.retained_files.length > 0 && (
            <ul>
              {preview.state.retained_files.map((name, i) => (
                <li key={`${i}:${name}`}>{name}</li>
              ))}
            </ul>
          )}
          <pre
            style={{
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              maxHeight: 360,
              overflow: "auto",
              background: "#f4f4f4",
              padding: 12
            }}
          >
            {JSON.stringify(body, null, 2)}
          </pre>
          <p style={{ overflowWrap: "anywhere" }}>SHA-256: {preview.sha256}</p>
          {preview.state.already_applied ? (
            <p>Этот снимок уже добавлен в материалы проекта.</p>
          ) : (
            !preview.state.can_apply && (
              <p>
                Для снимка недостаточно места в материалах проекта. Существующие файлы не будут
                удалены автоматически.
              </p>
            )
          )}
          <label style={{ display: "block", marginBlock: 12 }}>
            <input
              type="checkbox"
              checked={reviewed}
              disabled={busy || uncertain}
              onChange={(e) => setReviewed(e.target.checked)}
            />{" "}
            Источники, непроверенные утверждения, противоречия и ограничения просмотрены
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              style={control}
              disabled={busy || uncertain || !reviewed || !preview.state.can_apply}
              type="button"
              onClick={() =>
                void run(async () => {
                  try {
                    const saved = await request<{
                      sha256: string;
                      state: IntelligenceGraphContextState;
                    }>(url, {
                      method: "PUT",
                      body: JSON.stringify({
                        q: body.query,
                        revision: body.graph.revision,
                        expected_sha256: preview.sha256,
                        expected_materials_version: preview.state.materials_version,
                        reviewed: true
                      })
                    });
                    if (saved.sha256 !== preview.sha256)
                      throw new Error("Ответ сохранения относится к другому снимку.");
                    setPreview({ ...preview, state: saved.state });
                    setReviewed(false);
                    setNotice(
                      "Снимок добавлен. Он будет доступен в будущих запросах этого проекта."
                    );
                  } catch (e) {
                    setUncertain(true);
                    throw e;
                  }
                })
              }
            >
              Добавить в материалы проекта
            </button>
            <button
              style={control}
              disabled={busy}
              type="button"
              onClick={() =>
                void run(async () => {
                  const current = await load(body.query);
                  setNotice(
                    current.state.already_applied
                      ? "Снимок сохранён; повторная запись не нужна."
                      : current.state.current_sha256
                        ? "В материалах сохранён другой снимок этого графа. Просмотрите новый контекст перед заменой."
                        : "Снимок этого графа отсутствует в материалах проекта."
                  );
                })
              }
            >
              Проверить сохранение
            </button>
            {preview.state.current_sha256 && (
              <button
                style={control}
                disabled={busy || uncertain}
                type="button"
                onClick={() => {
                  if (
                    !window.confirm(
                      "Убрать только снимок этого графа из будущих запросов проекта? Уже созданные запуски и история сохранят свои материалы."
                    )
                  )
                    return;
                  void run(async () => {
                    try {
                      await request(url, {
                        method: "DELETE",
                        body: JSON.stringify({
                          expected_sha256: preview.state.current_sha256,
                          expected_materials_version: preview.state.materials_version
                        })
                      });
                      await load(body.query);
                      setNotice("Снимок убран из будущих запросов проекта.");
                    } catch (e) {
                      setUncertain(true);
                      throw e;
                    }
                  });
                }}
              >
                Убрать снимок графа
              </button>
            )}
          </div>
          {uncertain && (
            <p>
              Результат записи не подтверждён. Нажмите «Проверить сохранение»: это только чтение,
              без повторной записи.
            </p>
          )}
          {preview.state.current_sha256 && !preview.state.already_applied && (
            <p>
              В материалах уже есть другой снимок этого графа. После подтверждения он будет заменён
              выбранным снимком; остальные файлы сохранятся.
            </p>
          )}
          <p>
            Новые правки графа не обновляют этот снимок автоматически. Удаление снимка не
            переписывает уже созданные запуски и историю ответов.
          </p>
        </div>
      )}
    </section>
  );
}
