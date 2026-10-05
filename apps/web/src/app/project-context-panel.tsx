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

type Materials = {
  project_id: string;
  version: number;
  instructions: string;
  attachments: ChatTextAttachment[];
  updated_at: string;
};
type Props = {
  projectId: string;
  projectTitle: string;
  messageCount: number;
};
const uncertainSaveMessage =
  "Не удалось подтвердить сохранение. Черновик оставлен в этом окне. Загрузите сохранённую версию, чтобы проверить результат перед новой записью.";

function parseMaterials(value: unknown, projectId: string): Materials {
  if (!value || typeof value !== "object") throw new Error("Invalid materials");
  const candidate = value as Materials;
  if (
    candidate.project_id !== projectId ||
    !Number.isSafeInteger(candidate.version) ||
    candidate.version < 0 ||
    typeof candidate.instructions !== "string" ||
    candidate.instructions.length > 4000 ||
    typeof candidate.updated_at !== "string" ||
    !Number.isFinite(Date.parse(candidate.updated_at)) ||
    !Array.isArray(candidate.attachments) ||
    !candidate.attachments.every(
      (file) =>
        file &&
        typeof file === "object" &&
        typeof file.name === "string" &&
        typeof file.content === "string" &&
        Object.keys(file).every((key) => ["name", "content", "source_type"].includes(key))
    ) ||
    !isValidChatAttachments(candidate.attachments) ||
    new TextEncoder().encode(candidate.instructions).length +
      candidate.attachments.reduce((sum, file) => sum + attachmentContextSize(file), 0) >
      24000
  ) {
    throw new Error("Invalid materials");
  }
  return candidate;
}

export function ProjectContextPanel(props: Props) {
  return <ProjectMaterialsEditor key={props.projectId} {...props} />;
}

function ProjectMaterialsEditor({ projectId, projectTitle, messageCount }: Props) {
  const [saved, setSaved] = useState<Materials | null>(null);
  const [instructions, setInstructions] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmReload, setConfirmReload] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const files = useChatAttachments(`project-materials:${projectId}`);
  const operation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const dirty =
    saved !== null &&
    (saved.instructions !== instructions || !sameChatAttachments(saved.attachments, files.files));
  const load = async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const id = ++operation.current;
    setPending(true);
    setConfirmReload(false);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/materials`, {
        cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6_000)])
      });
      if (!response.ok) throw new Error("Materials unavailable");
      const value = parseMaterials(await response.json(), projectId);
      if (controller.signal.aborted || id !== operation.current) return;
      setSaved(value);
      setInstructions(value.instructions);
      files.replace(value.attachments);
      setNeedsRefresh(false);
    } catch {
      if (!controller.signal.aborted && id === operation.current)
        setError(
          "Не удалось загрузить материалы проекта. Черновик не изменён. Повторите загрузку."
        );
    } finally {
      if (id === operation.current) setPending(false);
      if (request.current === controller) request.current = null;
    }
  };
  useEffect(() => {
    void load();
    return () => {
      operation.current++;
      request.current?.abort();
      request.current = null;
    };
  }, [projectId]);
  const save = async () => {
    if (
      !saved ||
      saved.project_id !== projectId ||
      request.current ||
      files.reading ||
      needsRefresh
    )
      return;
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
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    const id = ++operation.current;
    setConfirmReload(false);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/materials`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: saved.version, instructions, attachments: files.files }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6_000)])
      });
      if (controller.signal.aborted || id !== operation.current) return;
      if (!response.ok) {
        setNeedsRefresh(response.status === 409 || response.status >= 500);
        setError(
          response.status === 409
            ? "Материалы изменились в другом окне. Загрузите сохранённую версию перед повторным сохранением."
            : response.status >= 500
              ? uncertainSaveMessage
              : "Не удалось сохранить материалы. Черновик оставлен в этом окне."
        );
        return;
      }
      const value = parseMaterials(await response.json(), projectId);
      if (
        value.version !== saved.version + 1 ||
        value.instructions !== instructions ||
        !sameChatAttachments(value.attachments, files.files)
      )
        throw new Error("Unconfirmed materials write");
      if (controller.signal.aborted || id !== operation.current) return;
      setSaved(value);
      setNotice("Материалы сохранены. Они войдут в новые сообщения и задания проекта.");
    } catch {
      if (!controller.signal.aborted && id === operation.current) {
        setNeedsRefresh(true);
        setError(uncertainSaveMessage);
      }
    } finally {
      if (id === operation.current) setPending(false);
      if (request.current === controller) request.current = null;
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
        onAdd={(selected) => {
          setNotice(null);
          void files.add(selected);
        }}
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
      <div className={styles.modalActions}>
        <button
          type="button"
          disabled={pending || files.reading || saved?.project_id !== projectId || needsRefresh}
          onClick={() => void save()}
        >
          Сохранить материалы
        </button>
        <button
          type="button"
          disabled={pending || files.reading}
          onClick={() => {
            if (dirty) setConfirmReload(true);
            else void load();
          }}
        >
          Загрузить сохранённую версию
        </button>
      </div>
      {confirmReload && (
        <div role="group" aria-label="Замена черновика" className={styles.boundary}>
          <p>
            Заменить несохранённые требования и файлы версией с сервера? Черновик изменится только
            после успешной загрузки.
          </p>
          <button type="button" disabled={pending} onClick={() => void load()}>
            Заменить черновик
          </button>
          <button type="button" disabled={pending} onClick={() => setConfirmReload(false)}>
            Оставить черновик
          </button>
        </div>
      )}
    </section>
  );
}
