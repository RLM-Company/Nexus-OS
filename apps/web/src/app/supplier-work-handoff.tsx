"use client";

import type { CreateSupplierWorkHandoff } from "@cosmora/contracts";
import type { ChatAttachment } from "@cosmora/contracts/chat-attachments";
import { useEffect, useRef, useState } from "react";

type Materials = {
  project_id: string;
  version: number;
  instructions: string;
  attachments: { name: string }[];
};
type Source = { id: string; content: string; attachments?: ChatAttachment[] };
type ProjectChoice = { id: string; title: string };

export function supplierWorkUrl(projectId: string, workId: string): string {
  return (
    "/?" +
    new URLSearchParams({ project: projectId, view: "plan", mode: "work", work: workId }).toString()
  );
}

function jsonFiles(message: Source) {
  return (message.attachments ?? []).flatMap((file, index) =>
    "content" in file && /\.json$/i.test(file.name) ? [{ name: file.name, index }] : []
  );
}

export function canStartSupplierWork(message: Source): boolean {
  return jsonFiles(message).length > 0 || /^\s*\{/.test(message.content);
}

export function SupplierWorkHandoff({
  chatId,
  message,
  projects,
  restrictedProjectId,
  onClose,
  disabled
}: {
  chatId: string;
  message: Source;
  projects: ProjectChoice[];
  restrictedProjectId: string | null;
  onClose: () => void;
  disabled: boolean;
}) {
  const files = jsonFiles(message);
  const [projectId, setProjectId] = useState(restrictedProjectId ?? "");
  const [indexes, setIndexes] = useState(() => files.map((file) => file.index));
  const [materials, setMaterials] = useState<Materials | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const newProject = useRef<string | null>(null);
  const request = useRef<{ signature: string; id: string } | null>(null);
  const submission = useRef<AbortController | null>(null);
  useEffect(() => () => submission.current?.abort(), []);

  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    void fetch("/api/v1/projects/" + encodeURIComponent(projectId) + "/materials", {
      cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)])
    })
      .then(async (response) => {
        if (!response.ok) throw Error("Не удалось загрузить инструкции проекта.");
        const value = (await response.json()) as Materials;
        if (value.project_id !== projectId) throw Error("Не удалось проверить проект.");
        if (!controller.signal.aborted) setMaterials(value);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Не удалось загрузить инструкции.");
      });
    return () => controller.abort();
  }, [projectId, revision]);

  const preview = projectId
    ? materials?.project_id === projectId
      ? materials
      : null
    : {
        version: 0,
        instructions: "",
        attachments: []
      };
  const excludedAttachments = (message.attachments ?? []).filter(
    (_, index) => !indexes.includes(index)
  );
  const hasInput = indexes.length > 0 || /^\s*\{/.test(message.content);
  const submit = async () => {
    if (lock.current || disabled || !preview || !hasInput) return;
    const controller = new AbortController();
    submission.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]);
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      let destination = projectId;
      if (!destination) {
        newProject.current ??= crypto.randomUUID();
        const response = await fetch("/api/v1/projects/empty", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: "Сравнение поставщиков",
            client_project_id: newProject.current
          }),
          signal
        });
        if (!response.ok) throw Error("Не удалось подготовить проект.");
        const body = (await response.json()) as { project: { id: string } };
        destination = body.project.id;
      }

      const selection = {
        chat_id: chatId,
        message_id: message.id,
        attachment_indexes: indexes.slice().sort((a, b) => a - b),
        materials_version: preview.version
      };
      const signature = JSON.stringify([destination, selection]);
      if (request.current?.signature !== signature)
        request.current = { signature, id: crypto.randomUUID() };
      const body: CreateSupplierWorkHandoff = {
        ...selection,
        client_request_id: request.current.id
      };
      const response = await fetch(
        "/api/v1/projects/" + encodeURIComponent(destination) + "/work/supplier-handoff",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal
        }
      );
      const work = (await response.json()) as { id?: string; error?: string };
      if (work.error === "STALE_SUPPLIER_MATERIALS") {
        setMaterials(null);
        setRevision((current) => current + 1);
        throw Error(
          "Материалы проекта изменились. Проверьте обновлённые инструкции перед повторным переносом."
        );
      }
      if (work.error === "INVALID_SUPPLIER_SOURCE")
        throw Error(
          "Выберите входные JSON-файлы со спецификацией и предложениями. Общий ввод — до 8 000 символов."
        );
      if (!response.ok || !work.id) throw Error("Не удалось перенести сообщение в Koswork.");
      if (!controller.signal.aborted) window.location.assign(supplierWorkUrl(destination, work.id));
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          signal.aborted
            ? "Ответ задерживается. Повторите с тем же выбором, чтобы найти созданную задачу."
            : cause instanceof Error
              ? cause.message
              : "Не удалось создать задачу."
        );
    } finally {
      lock.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  return (
    <section className="project-proposal" aria-label="Передача в Koswork">
      <div>
        <strong>Сравнение поставщиков в Koswork</strong>
        <label className="proposal-history">
          Проект
          <select
            value={projectId}
            disabled={busy || Boolean(restrictedProjectId)}
            onChange={(event) => {
              setProjectId(event.target.value);
              setMaterials(null);
              setError("");
            }}
          >
            {!restrictedProjectId && <option value="">Новый проект «Сравнение поставщиков»</option>}
            {projects
              .filter((project) => !restrictedProjectId || project.id === restrictedProjectId)
              .map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            {restrictedProjectId &&
              !projects.some((project) => project.id === restrictedProjectId) && (
                <option value={restrictedProjectId}>Проект исходного чата</option>
              )}
          </select>
        </label>
        <details open>
          <summary>Исходное сообщение</summary>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{message.content}</p>
        </details>
        {files.length > 0 && (
          <fieldset disabled={busy}>
            <legend>Входные JSON-файлы</legend>
            {files.map((file) => (
              <label key={file.index} className="proposal-history">
                <input
                  type="checkbox"
                  checked={indexes.includes(file.index)}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setIndexes((current) =>
                      checked
                        ? [...current, file.index]
                        : current.filter((index) => index !== file.index)
                    );
                  }}
                />
                {file.name}
              </label>
            ))}
          </fieldset>
        )}
        {excludedAttachments.length > 0 && (
          <p>Вложения вне расчёта — {excludedAttachments.map((file) => file.name).join(", ")}.</p>
        )}
        <details open>
          <summary>Инструкции и материалы проекта</summary>
          {preview ? (
            <>
              <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {preview.instructions || "Сохранённых инструкций нет."}
              </p>
              {preview.attachments.length > 0 && (
                <p>
                  Материалы проекта — {preview.attachments.map((file) => file.name).join(", ")}.
                </p>
              )}
            </>
          ) : (
            <p>Инструкции пока недоступны.</p>
          )}
          <p>
            Инструкции и материалы сохраняются в состоянии задачи. Расчёт использует только
            выбранные JSON-данные.
          </p>
        </details>
        <p>
          Переносится одно сообщение. Другие сообщения, память чата и его разрешения остаются в
          чате.
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="proposal-actions">
          <button
            type="button"
            disabled={busy || disabled || !preview || !hasInput}
            onClick={() => void submit()}
          >
            Создать задачу сравнения
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </section>
  );
}
