"use client";

import { useEffect, useRef, useState } from "react";
import {
  isValidChatAttachments,
  attachmentContextSize,
  sameChatAttachments,
  type ChatTextAttachment
} from "@cosmora/contracts/chat-attachments";
import {
  ChatAttachmentPicker,
  ChatMessageAttachments,
  useChatAttachments
} from "./chat-attachments";
import styles from "./project-context.module.css";
import { ProjectArtifactPicker } from "./project-artifact-picker";

type Materials = {
  project_id: string;
  version: number;
  instructions: string;
  attachments: ChatTextAttachment[];
  updated_at: string;
};
export function ProjectContextPanel({
  projectId,
  projectTitle,
  messageCount
}: {
  projectId: string;
  projectTitle: string;
  messageCount: number;
}) {
  const [saved, setSaved] = useState<Materials | null>(null);
  const [instructions, setInstructions] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const files = useChatAttachments(`project-materials:${projectId}`);
  const active = useRef(projectId);
  const operation = useRef(0);
  active.current = projectId;
  const load = async () => {
    const id = ++operation.current;
    setPending(true);
    setSaved(null);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/materials`, {
        cache: "no-store",
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error("Не удалось загрузить материалы проекта.");
      const value = (await response.json()) as Materials;
      if (
        value.project_id !== projectId ||
        typeof value.instructions !== "string" ||
        !Array.isArray(value.attachments) ||
        !Number.isInteger(value.version) ||
        !isValidChatAttachments(value.attachments)
      ) {
        throw new Error("Сервер вернул неверные материалы проекта.");
      }
      if (active.current !== projectId || id !== operation.current) return;
      setSaved(value);
      setInstructions(value.instructions);
      files.replace(value.attachments);
    } catch (cause) {
      if (active.current === projectId && id === operation.current)
        setError(cause instanceof Error ? cause.message : "Ошибка загрузки");
    } finally {
      if (active.current === projectId && id === operation.current) setPending(false);
    }
  };
  useEffect(() => {
    setInstructions("");
    void load();
    return () => {
      operation.current++;
    };
  }, [projectId]);
  const save = async () => {
    if (!saved || saved.project_id !== projectId) return;
    if (
      files.files.some((file) => !("content" in file)) ||
      !isValidChatAttachments(files.files) ||
      new TextEncoder().encode(instructions).length +
        files.files.reduce((sum, file) => sum + attachmentContextSize(file), 0) >
        24000
    ) {
      setError("Материалы проекта: текст, код, PDF и DOCX. Общий текст с требованиями — до 24 КБ.");
      return;
    }
    setPending(true);
    const id = ++operation.current;
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/materials`, {
        method: "PUT",
        signal: AbortSignal.timeout(15000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: saved.version, instructions, attachments: files.files })
      });
      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as {
          error?: { code?: string };
        } | null;
        throw new Error(
          detail?.error?.code === "PROJECT_MATERIALS_OWNER_FENCED"
            ? "Сохранение остановлено на время операции с данными владельца. Черновик оставлен в этом окне."
            : response.status === 409
              ? "Материалы изменились в другом окне. Загрузите сохранённую версию перед повторным сохранением."
              : "Не удалось сохранить материалы. Черновик оставлен в этом окне."
        );
      }
      const value = (await response.json()) as Materials;
      if (active.current !== projectId || id !== operation.current) return;
      setSaved(value);
      setNotice("Материалы сохранены. Они войдут в новые сообщения и задания проекта.");
    } catch (cause) {
      // A lost response must never cause an automatic second mutation.
      const canonical = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/materials`, {
        cache: "no-store",
        signal: AbortSignal.timeout(15000)
      })
        .then(async (response) => (response.ok ? ((await response.json()) as Materials) : null))
        .catch(() => null);
      if (active.current !== projectId || id !== operation.current) return;
      if (
        canonical?.version === saved.version + 1 &&
        canonical.project_id === projectId &&
        canonical.instructions === instructions &&
        Array.isArray(canonical.attachments) &&
        isValidChatAttachments(canonical.attachments) &&
        sameChatAttachments(canonical.attachments, files.files)
      ) {
        setSaved(canonical);
        setNotice("Материалы сохранены. Запись подтверждена чтением серверной версии.");
        return;
      }
      if (active.current === projectId && id === operation.current)
        setError(cause instanceof Error ? cause.message : "Ошибка сохранения");
    } finally {
      if (active.current === projectId && id === operation.current) setPending(false);
    }
  };
  return (
    <section className={styles.panel} role="tabpanel" aria-label="Контекст проекта">
      <header className={styles.header}>
        <div>
          <h2>Материалы проекта</h2>
          <p>
            {projectTitle} · {messageCount} сообщений в истории
          </p>
        </div>
      </header>
      <p className={styles.boundary}>
        Сохранённые требования и файлы используются в новых запросах этого проекта. Уже принятые
        задания сохраняют свою версию материалов.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!saved && !error && <p role="status">Загружаю материалы…</p>}
      <label>
        Требования к проекту
        <textarea
          aria-label="Требования к проекту"
          maxLength={4000}
          rows={8}
          value={instructions}
          disabled={pending || saved?.project_id !== projectId}
          onChange={(event) => {
            setInstructions(event.target.value);
            setNotice(null);
          }}
          style={{ width: "100%", resize: "vertical" }}
        />
      </label>
      <ChatAttachmentPicker
        textOnly
        files={files.files}
        reading={files.reading}
        error={files.error}
        disabled={pending || saved?.project_id !== projectId}
        onAdd={(selected) => void files.add(selected)}
        onRemove={(index) => {
          files.replace(files.files.filter((_, position) => position !== index));
          setNotice(null);
        }}
      />
      <p>
        Документы сохраняются как извлечённый текст. Изображения можно прикрепить к отдельному
        сообщению в чате.
      </p>
      <ChatMessageAttachments files={files.files} />
      <ProjectArtifactPicker
        key={projectId}
        projectId={projectId}
        disabled={pending || files.reading || saved?.project_id !== projectId}
        onAdd={(attachment) => {
          const next = [...files.files, attachment];
          if (
            files.files.some(
              (file) =>
                file.name === attachment.name &&
                "content" in file &&
                file.content === attachment.content
            )
          ) {
            setError("Этот снимок уже добавлен в форму.");
            return false;
          }
          if (
            !isValidChatAttachments(next) ||
            new TextEncoder().encode(instructions).length +
              next.reduce((sum, file) => sum + attachmentContextSize(file), 0) >
              24000
          ) {
            setError(
              "Снимок не помещается: не более 4 файлов и 24 КБ вместе с требованиями. Уменьшите фрагмент или удалите другой материал."
            );
            return false;
          }
          files.replace(next);
          setError(null);
          setNotice(
            "Снимок добавлен в форму. Нажмите «Сохранить материалы», чтобы использовать его в новых запросах."
          );
          return true;
        }}
      />
      <div className={styles.modalActions}>
        <button
          type="button"
          disabled={pending || files.reading || saved?.project_id !== projectId}
          onClick={() => void save()}
        >
          Сохранить материалы
        </button>
        <button
          type="button"
          disabled={pending || files.reading}
          onClick={() => {
            const dirty =
              saved &&
              (saved.instructions !== instructions ||
                !sameChatAttachments(saved.attachments, files.files));
            if (
              !dirty ||
              window.confirm(
                "Заменить несохранённые требования и снимки сохранённой серверной версией?"
              )
            )
              void load();
          }}
        >
          Загрузить сохранённую версию
        </button>
      </div>
    </section>
  );
}
