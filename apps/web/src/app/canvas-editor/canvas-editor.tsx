"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  CANVAS_MAX_CONTENT_BYTES,
  CANVAS_MAX_TITLE_BYTES,
  canvasBytes,
  type CanvasArtifact,
  type CanvasFormat,
  type CanvasRevision,
  type CanvasSource
} from "@cosmora/contracts/canvas-artifacts";
import styles from "./canvas-editor.module.css";
import { canvasDraftKey, parseCanvasDraft, type CanvasDraft } from "./canvas-draft-storage";
import { CanvasPreview } from "./canvas-preview";
import { CanvasComparison, type CanvasComparisonSide } from "./canvas-comparison";
import { CANVAS_FILE_ACCEPT } from "./canvas-file-import";
import { readCanvasFile } from "./canvas-file";
import { createDocxReport, createPdfReport, downloadReport } from "../studio-files-report";
import { MarkdownToolbar } from "./markdown-toolbar";
import { CanvasSearch } from "./canvas-search";
import { SitePreview } from "../sites/site-preview";
import { ShiningText, SystemMessage } from "../ui/kosmora-controls";

type Full = { artifact: CanvasArtifact; revision: CanvasRevision };
type Meta = Omit<CanvasRevision, "content">;
type Candidate = {
  title: string;
  source: Exclude<
    CanvasSource,
    { kind: "manual" } | { kind: "restore" } | { kind: "data_workspace" }
  >;
};
type Draft = CanvasDraft;
export type CanvasSeed = {
  storageId: string;
  title: string;
  content: string;
  format: CanvasFormat;
};
type Review = {
  kind: "compare" | "restore" | "conflict";
  artifactId: string;
  baseVersion: number;
  sourceVersion?: number;
  before: CanvasComparisonSide;
  after: CanvasComparisonSide;
};
const revisionSide = (revision: CanvasRevision): CanvasComparisonSide => ({
  label: `Сохранённая v${revision.version}`,
  title: revision.title,
  format: revision.format,
  content: revision.content
});
const blank: Draft = { title: "Без названия", format: "markdown", content: "", baseVersion: 0 };
const blankSite: Draft = { ...blank, format: "html" };
const formats: CanvasFormat[] = ["markdown", "text", "code", "html"];
const names: Record<CanvasFormat, string> = {
  markdown: "Markdown",
  text: "Текст",
  code: "Код",
  html: "HTML (текст)"
};
const endpoint = (projectId: string) => `/api/v1/projects/${encodeURIComponent(projectId)}/canvas`;
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    ...options,
    signal: options?.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
    headers: {
      ...(options?.body ? { "content-type": "application/json" } : {}),
      ...options?.headers
    }
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as {
      error?: { code?: string; currentVersion?: number };
    } | null;
    const error = new Error(detail?.error?.code ?? `HTTP ${response.status}`) as Error & {
      currentVersion?: number;
    };
    if (detail?.error?.currentVersion !== undefined)
      error.currentVersion = detail.error.currentVersion;
    throw error;
  }
  const result = response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  if (options?.signal?.aborted) throw new DOMException("Canvas scope changed", "AbortError");
  return result;
}
const sanitizeName = (value: string, format: CanvasFormat): string => {
  const extension = { markdown: "md", text: "txt", code: "txt", html: "html" }[format];
  const base =
    Array.from(value, (character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? "_" : character
    )
      .join("")
      .trim()
      .replace(/[\\/<>:"|?*]/g, "_")
      .slice(0, 80) || "artifact";
  return `${base}.${extension}`;
};

export function CanvasEditor({
  projectId,
  initialArtifactId,
  initialDraft,
  sitePreview = false
}: {
  projectId: string;
  initialArtifactId?: string;
  initialDraft?: CanvasSeed;
  sitePreview?: boolean;
}) {
  const [scope, setScope] = useState<{ projectId: string; ownerScope: string } | null>(null);
  const [scopeError, setScopeError] = useState("");
  useEffect(() => {
    let active = true;
    setScope(null);
    setScopeError("");
    // Old unscoped drafts cannot be attributed to an owner, so never migrate their contents.
    try {
      const legacyPrefix = `kosmora:canvas:draft:${projectId}:`;
      for (const key of Object.keys(localStorage))
        if (key.startsWith(legacyPrefix)) localStorage.removeItem(key);
    } catch {
      /* Draft storage is optional. */
    }
    request<{ owner_scope: string }>(endpoint(projectId) + "/scope")
      .then((result) => {
        if (!/^[a-f0-9]{64}$/.test(result.owner_scope))
          throw new Error("Не удалось проверить аккаунт Canvas");
        if (active) setScope({ projectId, ownerScope: result.owner_scope });
      })
      .catch((error: unknown) => {
        if (active)
          setScopeError(error instanceof Error ? error.message : "Не удалось открыть Canvas");
      });
    return () => {
      active = false;
    };
  }, [projectId]);
  if (!scope || scope.projectId !== projectId)
    return (
      <section className={styles.root} aria-label="Редактор Canvas">
        {scopeError ? (
          <SystemMessage>{scopeError}</SystemMessage>
        ) : (
          <p role="status">
            <ShiningText>Загружаем Canvas…</ShiningText>
          </p>
        )}
      </section>
    );
  return (
    <ScopedCanvasEditor
      key={`${scope.ownerScope}:${projectId}`}
      projectId={projectId}
      ownerScope={scope.ownerScope}
      {...(initialArtifactId ? { initialArtifactId } : {})}
      {...(initialDraft ? { initialDraft } : {})}
      sitePreview={sitePreview}
    />
  );
}

function ScopedCanvasEditor({
  projectId,
  ownerScope,
  initialArtifactId,
  initialDraft,
  sitePreview = false
}: {
  projectId: string;
  ownerScope: string;
  initialArtifactId?: string;
  initialDraft?: CanvasSeed;
  sitePreview?: boolean;
}) {
  const lifecycle = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    return () => {
      controller.abort();
    };
  }, []);
  const scopedRequest = useCallback(async <T,>(url: string, options?: RequestInit): Promise<T> => {
    const controller = lifecycle.current;
    if (!controller || controller.signal.aborted)
      throw new DOMException("Canvas scope changed", "AbortError");
    return request<T>(url, { ...options, signal: controller.signal });
  }, []);
  const localKey = (projectId: string, id: string) =>
    canvasDraftKey(
      ownerScope,
      projectId,
      id === "new" ? (initialDraft?.storageId ?? (sitePreview ? "site-new" : "new")) : id
    );
  const textEditor = useRef<HTMLTextAreaElement>(null);
  const editorId = useId();
  const reportLinkKey = initialDraft
    ? canvasDraftKey(ownerScope, projectId, `${initialDraft.storageId}:saved`)
    : null;
  const parseDraft = parseCanvasDraft;
  const [items, setItems] = useState<CanvasArtifact[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [loaded, setLoaded] = useState<Full | null>(null);
  const emptyDraft = sitePreview ? blankSite : blank;
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [draftStorageReady, setDraftStorageReady] = useState(false);
  const [history, setHistory] = useState<Meta[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedSource, setSelectedSource] = useState("");
  const [revisionPreview, setRevisionPreview] = useState<CanvasRevision | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [compareFrom, setCompareFrom] = useState("");
  const [compareTo, setCompareTo] = useState("draft");
  const [conflict, setConflict] = useState<number | null>(null);
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const base = useMemo(() => endpoint(projectId), [projectId]);
  const readList = useCallback(async () => {
    const first = await scopedRequest<{ items: CanvasArtifact[] }>(base + "?limit=100");
    if (first.items.length < 100) return first.items;
    const second = await scopedRequest<{ items: CanvasArtifact[] }>(base + "?limit=100&offset=100");
    return [...first.items, ...second.items];
  }, [base, scopedRequest]);
  const dirty =
    Boolean(draft.createRequestId) ||
    (loaded
      ? draft.title !== loaded.revision.title ||
        draft.format !== loaded.revision.format ||
        draft.content !== loaded.revision.content ||
        draft.baseVersion !== loaded.artifact.version
      : draft.title !== emptyDraft.title || draft.format !== emptyDraft.format || !!draft.content);
  const reviewedDraftMatches =
    review?.kind === "conflict" &&
    draft.title === review.after.title &&
    draft.format === review.after.format &&
    draft.content === review.after.content;
  const refresh = useCallback(async () => {
    const [list, sources] = await Promise.all([
      readList(),
      scopedRequest<{ items: Candidate[] }>(base + "/sources")
    ]);
    setItems(list);
    setCandidates(sources.items);
  }, [base, readList, scopedRequest]);
  useEffect(() => {
    let active = true;
    setSelected("");
    setLoaded(null);
    let newDraft: Draft | null = null;
    try {
      newDraft = parseDraft(localStorage.getItem(localKey(projectId, "new")), 0);
    } catch {
      /* optional */
    }
    setDraft(
      newDraft ??
        (initialDraft
          ? {
              title: initialDraft.title,
              content: initialDraft.content,
              format: initialDraft.format,
              baseVersion: 0
            }
          : emptyDraft)
    );
    setDraftStorageReady(true);
    setConflict(null);
    setLoading(true);
    setError("");
    Promise.all([readList(), scopedRequest<{ items: Candidate[] }>(base + "/sources")])
      .then(([list, sources]) => {
        if (active) {
          setItems(list);
          setCandidates(sources.items);
          let linked: string | null = null;
          if (reportLinkKey) {
            try {
              linked = localStorage.getItem(reportLinkKey);
            } catch {
              /* Optional browser preference. */
            }
          }
          if (initialArtifactId) void open(initialArtifactId);
          else if (linked && list.some((item) => item.id === linked)) void open(linked);
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "Не удалось загрузить Canvas");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [base, readList, scopedRequest, initialArtifactId, initialDraft, reportLinkKey, emptyDraft]);
  useEffect(() => {
    // The initial blank render must not delete a restored draft before hydration
    // completes, including React Strict Mode's repeated mount effects.
    if (!draftStorageReady) return;
    const id = loaded?.artifact.id ?? "new";
    try {
      if (dirty) localStorage.setItem(localKey(projectId, id), JSON.stringify(draft));
      else localStorage.removeItem(localKey(projectId, id));
    } catch {
      /* Browser storage unavailable: current editor state is still kept. */
    }
  }, [draft, dirty, loaded, projectId, draftStorageReady]);
  const open = async (id: string, discard = false) => {
    if (working) return;
    if (id === selected && !discard) return;
    if (
      dirty &&
      !discard &&
      !window.confirm("Есть несохранённый текст. Он останется в черновиках браузера. Перейти?")
    )
      return;
    setWorking(true);
    setError("");
    setNotice("");
    setRevisionPreview(null);
    setReview(null);
    setCompareFrom("");
    setCompareTo("draft");
    setConflict(null);
    try {
      const next = await scopedRequest<Full>(`${base}/${encodeURIComponent(id)}`);
      if (next.revision.source.kind === "data_workspace")
        throw new Error(
          "Откройте таблицу в Studio: текстовый редактор Canvas не меняет табличные снимки."
        );
      const revisions = await scopedRequest<{ items: Meta[] }>(
        `${base}/${encodeURIComponent(id)}/revisions`
      );
      let local: Draft | null = null;
      try {
        if (discard) localStorage.removeItem(localKey(projectId, id));
        else
          local = parseDraft(localStorage.getItem(localKey(projectId, id)), next.artifact.version);
      } catch {
        /* Private browsing can disable storage. */
      }
      setLoaded(next);
      setSelected(id);
      setDraft(
        local ?? {
          title: next.revision.title,
          format: next.revision.format,
          content: next.revision.content,
          baseVersion: next.artifact.version
        }
      );
      setHistory(revisions.items);
      if (local && local.baseVersion !== next.artifact.version) setConflict(next.artifact.version);
      if (local)
        setNotice("Восстановлен локальный черновик. Проверьте изменения перед сохранением.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось открыть артефакт");
    } finally {
      setWorking(false);
    }
  };
  const applyResult = async (result: Full, consumeDraft: boolean) => {
    setSelected(result.artifact.id);
    setLoaded(result);
    setDraft({
      title: result.revision.title,
      format: result.revision.format,
      content: result.revision.content,
      baseVersion: result.artifact.version
    });
    setConflict(null);
    setRevisionPreview(null);
    setReview(null);
    setCompareFrom("");
    setCompareTo("draft");
    try {
      localStorage.removeItem(localKey(projectId, result.artifact.id));
      if (consumeDraft) localStorage.removeItem(localKey(projectId, selected || "new"));
      if (consumeDraft && reportLinkKey) localStorage.setItem(reportLinkKey, result.artifact.id);
    } catch {
      /* optional */
    }
    const [revisions, listing] = await Promise.allSettled([
      scopedRequest<{ items: Meta[] }>(
        `${base}/${encodeURIComponent(result.artifact.id)}/revisions`
      ),
      refresh()
    ]);
    if (revisions.status === "fulfilled") setHistory(revisions.value.items);
    else setHistory([]);
    if (listing.status === "rejected")
      setNotice("Сохранено. Список артефактов не обновился — нажмите «Обновить список».");
  };
  const perform = async (callback: () => Promise<Full>, message: string, consumeDraft = false) => {
    setWorking(true);
    setError("");
    setNotice("");
    try {
      const result = await callback();
      await applyResult(result, consumeDraft);
      setNotice(message);
    } catch (e) {
      const problem = e as Error & { currentVersion?: number };
      if (problem.currentVersion !== undefined) {
        setReview(null);
        setConflict(problem.currentVersion);
        setError(
          "Версия на сервере изменилась. Ваш черновик сохранён здесь: сравните, сохраните копию или подтвердите перезапись."
        );
      } else
        setError(
          problem.message === "CANVAS_REQUEST_CONFLICT"
            ? "Не удалось подтвердить предыдущее создание: с этим ключом уже сохранён другой текст. Обновите список и откройте сохранённый артефакт; черновик оставлен в браузере."
            : problem.message || "Не удалось сохранить"
        );
    } finally {
      setWorking(false);
    }
  };
  const save = (newCopy = false, override = false) => {
    if (working || loading) return;
    if (
      !draft.title.trim() ||
      canvasBytes(draft.title) > CANVAS_MAX_TITLE_BYTES ||
      canvasBytes(draft.content) > CANVAS_MAX_CONTENT_BYTES
    ) {
      setError("Название или текст превышают допустимый размер.");
      return;
    }
    const payload = { title: draft.title, format: draft.format, content: draft.content };
    // An unresolved copy must keep creating that copy on an explicit retry,
    // never update the source artifact which is still selected in this window.
    if (!selected || newCopy || draft.createRequestId) {
      const requestId = draft.createRequestId ?? crypto.randomUUID();
      const pendingDraft = { ...draft, createRequestId: requestId };
      setDraft(pendingDraft);
      try {
        // Persist before dispatch: a reload may happen before React's draft effect.
        localStorage.setItem(localKey(projectId, selected || "new"), JSON.stringify(pendingDraft));
      } catch {
        /* Browser storage is optional; this window retains the request ID. */
      }
      void perform(
        async () => {
          try {
            return await scopedRequest<Full>(base, {
              method: "POST",
              body: JSON.stringify({ ...payload, client_request_id: requestId })
            });
          } catch (error) {
            const canonical = await scopedRequest<Full>(
              `${base}/${encodeURIComponent(requestId)}`
            ).catch(() => null);
            if (
              canonical &&
              canonical.revision.source.kind !== "data_workspace" &&
              canonical.revision.content === payload.content &&
              canonical.artifact.title === payload.title &&
              canonical.artifact.format === payload.format
            )
              return canonical;
            throw error;
          }
        },
        newCopy ? "Копия создана, прежний артефакт не изменён." : "Артефакт создан.",
        true
      );
    } else if (
      (override &&
        conflict !== null &&
        review?.kind === "conflict" &&
        review.artifactId === selected &&
        reviewedDraftMatches &&
        review.baseVersion === conflict) ||
      (!override && conflict === null)
    ) {
      void perform(async () => {
        const baseVersion = override ? review!.baseVersion : draft.baseVersion;
        try {
          return await scopedRequest<Full>(`${base}/${encodeURIComponent(selected)}`, {
            method: "PUT",
            body: JSON.stringify({
              ...payload,
              baseVersion
            })
          });
        } catch (error) {
          const canonical = await scopedRequest<Full>(
            `${base}/${encodeURIComponent(selected)}`
          ).catch(() => null);
          if (
            canonical?.artifact.version === baseVersion + 1 &&
            canonical.revision.content === payload.content &&
            canonical.artifact.title === payload.title &&
            canonical.artifact.format === payload.format
          )
            return canonical;
          throw error;
        }
      }, "Сохранена новая версия.");
    }
  };
  const createNew = () => {
    if (
      dirty &&
      !window.confirm("Несохранённый текст останется в черновике браузера. Создать новый?")
    )
      return;
    setSelected("");
    setLoaded(null);
    setHistory([]);
    let local: Draft | null = null;
    try {
      local = parseDraft(localStorage.getItem(localKey(projectId, "new")), 0);
    } catch {
      /* optional */
    }
    setDraft(local ?? emptyDraft);
    setConflict(null);
    setError("");
    setNotice("");
    setRevisionPreview(null);
    setReview(null);
    setCompareFrom("");
    setCompareTo("draft");
  };
  const importSelected = () => {
    if (working || loading) return;
    const candidate = /^\d+$/.test(selectedSource) ? candidates[Number(selectedSource)] : undefined;
    if (!candidate) {
      setError("Выберите источник для импорта.");
      return;
    }
    if (
      dirty &&
      !window.confirm("Несохранённый текст останется в черновике браузера. Импортировать копию?")
    )
      return;
    void perform(
      () =>
        scopedRequest<Full>(base + "/import", {
          method: "POST",
          body: JSON.stringify({
            title:
              Array.from(candidate.title, (character) =>
                character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? " " : character
              )
                .join("")
                .trim()
                .slice(0, 60) || "Импорт",
            format: "markdown",
            source: candidate.source
          })
        }),
      "Импортирована независимая редакторская копия. Источник не изменён."
    );
  };
  const restore = () => {
    if (!loaded || working || review?.kind !== "restore" || review.artifactId !== selected) return;
    if (dirty) {
      setError(
        "Сначала сохраните черновик или создайте его копию: восстановление истории не должно стирать правки."
      );
      return;
    }
    void perform(
      () =>
        scopedRequest<Full>(`${base}/${encodeURIComponent(selected)}/restore`, {
          method: "POST",
          body: JSON.stringify({
            baseVersion: review.baseVersion,
            sourceVersion: review.sourceVersion
          })
        }),
      "Старая версия восстановлена как новая, история сохранена."
    );
  };
  const compare = async (kind: Review["kind"], sourceVersion?: number) => {
    if (working || !loaded) return;
    if (kind === "restore" && sourceVersion === undefined) return;
    if (kind === "restore" && dirty) {
      setError(
        "Сначала сохраните черновик или создайте его копию: восстановление истории не должно стирать правки."
      );
      return;
    }
    setWorking(true);
    setReview(null);
    setError("");
    try {
      const current = await scopedRequest<Full>(`${base}/${encodeURIComponent(selected)}`);
      const from =
        kind === "compare"
          ? Number(compareFrom || loaded.artifact.version)
          : current.artifact.version;
      const to =
        kind === "restore"
          ? sourceVersion
          : kind === "conflict" || compareTo === "draft"
            ? undefined
            : Number(compareTo);
      const [before, after] = await Promise.all([
        from === current.artifact.version
          ? current.revision
          : scopedRequest<CanvasRevision>(
              `${base}/${encodeURIComponent(selected)}/revisions/${from}`
            ),
        to === undefined
          ? Promise.resolve(null)
          : scopedRequest<CanvasRevision>(`${base}/${encodeURIComponent(selected)}/revisions/${to}`)
      ]);
      if (current.artifact.version !== loaded.artifact.version)
        setConflict(current.artifact.version);
      setReview({
        kind,
        artifactId: selected,
        baseVersion: current.artifact.version,
        ...(kind === "restore" && sourceVersion !== undefined ? { sourceVersion } : {}),
        before: revisionSide(before),
        after: after
          ? revisionSide(after)
          : {
              label: "Снимок черновика",
              title: draft.title,
              format: draft.format,
              content: draft.content
            }
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сравнить версии");
    } finally {
      setWorking(false);
    }
  };
  const remove = () => {
    if (!selected || !window.confirm("Удалить этот артефакт вместе с его историей?")) return;
    setWorking(true);
    scopedRequest<void>(`${base}/${encodeURIComponent(selected)}`, { method: "DELETE" })
      .then(async () => {
        try {
          localStorage.removeItem(localKey(projectId, selected));
        } catch {
          /* optional */
        }
        setSelected("");
        setLoaded(null);
        setDraft(emptyDraft);
        setHistory([]);
        setConflict(null);
        setRevisionPreview(null);
        setReview(null);
        setNotice("Артефакт удалён.");
        await refresh();
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Ошибка удаления"))
      .finally(() => setWorking(false));
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft.content);
      setNotice("Текст скопирован.");
    } catch {
      setError("Буфер обмена недоступен. Выделите текст вручную.");
    }
  };
  const exportPdf = async () => {
    if (exportingPdf) return;
    if (draft.content.length > 100_000) {
      setError(
        "PDF: максимум 100 000 символов. Для полного большого документа используйте Markdown или DOCX."
      );
      return;
    }
    setExportingPdf(true);
    const snapshot = { ...draft };
    try {
      const pdf = await createPdfReport(snapshot.content.split(/\r?\n/));
      if (lifecycle.current?.signal.aborted) return;
      downloadReport(pdf, sanitizeName(snapshot.title, "text").replace(/\.txt$/, ".pdf"));
      setNotice(
        "Скачан PDF с текущим текстом. Текст PDF растровый; для редактирования используйте Markdown или DOCX."
      );
    } catch {
      if (!lifecycle.current?.signal.aborted)
        setError("Не удалось подготовить PDF. Текст остаётся в редакторе.");
    } finally {
      if (!lifecycle.current?.signal.aborted) setExportingPdf(false);
    }
  };
  const download = () => {
    downloadSnapshot(draft);
    setNotice("Скачан текущий текст редактора (включая несохранённые правки).");
  };
  const downloadSnapshot = (snapshot: { title: string; content: string; format: CanvasFormat }) => {
    const blob = new Blob([snapshot.content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = sanitizeName(snapshot.title, snapshot.format);
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const openFile = async (file: File) => {
    if (working || loading) return;
    if (
      file.size > (file.name.toLowerCase().endsWith(".docx") ? 20000000 : CANVAS_MAX_CONTENT_BYTES)
    ) {
      setError("Файл превышает лимит: текст 512 КиБ, исходный DOCX 20 МБ.");
      return;
    }
    if (dirty) {
      setError("Сначала сохраните текущий черновик или его копию, затем откройте файл.");
      return;
    }
    try {
      if (selected && parseDraft(localStorage.getItem(localKey(projectId, "new")), 0)) {
        setError(
          "В браузере есть новый черновик. Откройте его кнопкой «+ Новый» и сохраните перед загрузкой файла."
        );
        return;
      }
    } catch {
      /* Draft storage is optional. */
    }
    setWorking(true);
    setError("");
    try {
      const signal = lifecycle.current?.signal;
      if (!signal) throw new Error("Редактор ещё загружается.");
      const content = await readCanvasFile(
        file,
        AbortSignal.any([signal, AbortSignal.timeout(60000)])
      );
      const next: Draft = { ...content, baseVersion: 0 };
      if (lifecycle.current?.signal.aborted) return;
      setSelected("");
      setLoaded(null);
      setHistory([]);
      setDraft(next);
      setConflict(null);
      setRevisionPreview(null);
      setReview(null);
      setCompareFrom("");
      setCompareTo("draft");
      setNotice(
        "Файл открыт в новом черновике. Проверьте текст и нажмите «Сохранить версию», чтобы создать артефакт."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось прочитать файл");
    } finally {
      setWorking(false);
    }
  };
  const preview = revisionPreview?.content ?? draft.content;
  const previewFormat = revisionPreview?.format ?? draft.format;
  const readHistory = async (version?: number) => {
    if (working || !selected) return;
    setWorking(true);
    try {
      if (version !== undefined) {
        const revision = await scopedRequest<CanvasRevision>(
          `${base}/${encodeURIComponent(selected)}/revisions/${version}`
        );
        setRevisionPreview(revision);
      } else {
        const page = await scopedRequest<{ items: Meta[] }>(
          `${base}/${encodeURIComponent(selected)}/revisions?limit=100&offset=${history.length}`
        );
        setHistory((current) => [...current, ...page.items]);
      }
    } catch {
      setError("Не удалось получить историю версий");
    } finally {
      setWorking(false);
    }
  };
  return (
    <section className={styles.root} aria-label="Редактор Canvas">
      <header className={styles.heading}>
        <div>
          <h2>{sitePreview ? "Редактор сайта" : "Canvas · Артефакты"}</h2>
          <small>
            {sitePreview
              ? "HTML и CSS · версии и сохранение в проекте"
              : "Текст, Markdown и код · хранение в проекте"}
          </small>
        </div>
        <button type="button" onClick={createNew} disabled={working}>
          + Новый
        </button>
      </header>
      <div className={styles.layout}>
        <nav className={styles.files} aria-label="Артефакты проекта">
          {loading && <p role="status">Загружаем артефакты…</p>}
          {!loading && !items.length && <p>В этом проекте пока нет артефактов.</p>}
          {items.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => void open(item.id)}
              aria-current={selected === item.id ? "page" : undefined}
              disabled={working}
            >
              <strong>{item.title}</strong>
              <small>
                {sitePreview && item.format === "html" ? "HTML / CSS" : names[item.format]} · v
                {item.version}
              </small>
            </button>
          ))}
          <div className={styles.import}>
            <label htmlFor={`${editorId}-file`}>Открыть документ</label>
            <input
              id={`${editorId}-file`}
              type="file"
              accept={CANVAS_FILE_ACCEPT + ",.docx"}
              disabled={working || loading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void openFile(file);
              }}
            />
            <small>
              Текст UTF-8 до 512 КиБ; DOCX до 20 МБ — без исходной вёрстки. Файл откроется в новом
              черновике.
            </small>
            <label htmlFor={`${editorId}-source`}>Импорт из Work и чатов</label>
            <select
              id={`${editorId}-source`}
              value={selectedSource}
              onChange={(e) => setSelectedSource(e.target.value)}
            >
              <option value="">Выберите завершённый результат</option>
              {candidates.map((item, index) => (
                <option key={index} value={String(index)}>
                  {item.source.kind === "work"
                    ? "Work"
                    : item.source.kind === "chat"
                      ? "Чат"
                      : "Чат проекта"}{" "}
                  · {item.title.slice(0, 64)}
                </option>
              ))}
            </select>
            <button type="button" onClick={importSelected} disabled={working || !selectedSource}>
              Импортировать копию
            </button>
            <button
              type="button"
              onClick={() => void refresh().catch(() => setError("Не удалось обновить источники"))}
              disabled={working}
            >
              Обновить список
            </button>
          </div>
        </nav>
        <div className={styles.editor}>
          <div className={styles.fields}>
            <label>
              Название
              <input
                value={draft.title}
                disabled={working || loading}
                maxLength={CANVAS_MAX_TITLE_BYTES}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              />
            </label>
            <label>
              Формат
              <select
                value={draft.format}
                disabled={working || loading}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, format: e.target.value as CanvasFormat }))
                }
              >
                {formats.map((f) => (
                  <option key={f} value={f}>
                    {sitePreview && f === "html" ? "HTML / CSS" : names[f]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className={styles.textLabel} htmlFor={`${editorId}-body`}>
            Содержимое
          </label>
          <CanvasSearch
            key={selected || initialDraft?.storageId || "new"}
            editor={textEditor}
            value={draft.content}
            disabled={working || loading}
            onChange={(content) => setDraft((d) => ({ ...d, content }))}
            onError={setError}
          />
          {draft.format === "markdown" && (
            <MarkdownToolbar
              editor={textEditor}
              value={draft.content}
              disabled={working || loading}
              onChange={(content) => setDraft((d) => ({ ...d, content }))}
              onError={setError}
            />
          )}
          <textarea
            ref={textEditor}
            id={`${editorId}-body`}
            spellCheck={draft.format !== "code"}
            className={styles.textarea}
            disabled={working || loading}
            value={draft.content}
            onChange={(e) => {
              const value = e.target.value;
              if (canvasBytes(value) > CANVAS_MAX_CONTENT_BYTES) {
                setError("Достигнут лимит 512 КиБ для текста.");
                return;
              }
              setDraft((d) => ({ ...d, content: value }));
            }}
          />
          <div className={styles.count}>
            {canvasBytes(draft.content).toLocaleString("ru")} /{" "}
            {CANVAS_MAX_CONTENT_BYTES.toLocaleString("ru")} байт
            {dirty ? " · Есть несохранённые изменения" : " · Сохранено"}
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              disabled={working || loading || conflict !== null}
              onClick={() => save()}
            >
              Сохранить версию
            </button>
            <button type="button" onClick={() => void copy()}>
              Копировать
            </button>
            <button type="button" onClick={download}>
              Скачать
            </button>
            {!sitePreview && (
              <>
                <button
                  type="button"
                  disabled={working || loading}
                  onClick={() => {
                    try {
                      downloadReport(
                        createDocxReport([draft.content]),
                        sanitizeName(draft.title, "text").replace(/\.txt$/, ".docx")
                      );
                      setNotice(
                        "Скачан DOCX с текущим текстом, включая несохранённые правки. Markdown и код сохранены как текст."
                      );
                    } catch {
                      setError("Не удалось подготовить DOCX. Текст остаётся в редакторе.");
                    }
                  }}
                >
                  Скачать DOCX
                </button>
                <button
                  type="button"
                  disabled={working || loading || exportingPdf}
                  onClick={() => void exportPdf()}
                >
                  {exportingPdf ? "Подготовка PDF…" : "Скачать PDF"}
                </button>
              </>
            )}
            {selected && (
              <button type="button" onClick={remove} disabled={working}>
                Удалить
              </button>
            )}
          </div>
          {conflict !== null && (
            <div className={styles.conflict} role="alert">
              <strong>Конфликт версий: на сервере v{conflict}</strong>
              <p>
                Ваш текст остался в редакторе. Создайте копию или сравните его с серверной версией
                перед сохранением.
              </p>
              <button type="button" onClick={() => save(true)} disabled={working}>
                Сохранить как копию
              </button>
              <button type="button" onClick={() => void compare("conflict")} disabled={working}>
                Сравнить с серверной версией
              </button>
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      "Удалить локальный черновик этого артефакта и открыть серверную версию?"
                    )
                  )
                    void open(selected, true);
                }}
                disabled={working}
              >
                Загрузить серверную версию
              </button>
            </div>
          )}
          {error && <SystemMessage>{error}</SystemMessage>}
          {notice && <SystemMessage kind="info">{notice}</SystemMessage>}
          <div className={styles.previewHead}>
            <h3>
              {revisionPreview ? `Просмотр версии ${revisionPreview.version}` : "Предпросмотр"}
            </h3>
            {revisionPreview && (
              <button type="button" onClick={() => setRevisionPreview(null)}>
                К текущему тексту
              </button>
            )}
          </div>
          <div className={styles.preview} aria-label="Безопасный предпросмотр">
            {sitePreview && previewFormat === "html" ? (
              <SitePreview content={preview} />
            ) : (
              <CanvasPreview content={preview} format={previewFormat} />
            )}
          </div>
          {previewFormat === "html" && !sitePreview && (
            <p className={styles.count}>
              HTML показан только как текст: скрипты и внешние ресурсы не выполняются.
            </p>
          )}
          {loaded && (
            <section className={styles.history}>
              <h3>История версий</h3>
              <div className={styles.comparisonControls}>
                <label>
                  Версия до
                  <select
                    aria-label="Версия до"
                    value={compareFrom || String(loaded.artifact.version)}
                    disabled={working}
                    onChange={(e) => setCompareFrom(e.target.value)}
                  >
                    {history.map((item) => (
                      <option key={item.version} value={String(item.version)}>
                        v{item.version}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Версия после
                  <select
                    aria-label="Версия после"
                    value={compareTo}
                    disabled={working}
                    onChange={(e) => setCompareTo(e.target.value)}
                  >
                    <option value="draft">Текст редактора</option>
                    {history.map((item) => (
                      <option key={item.version} value={String(item.version)}>
                        v{item.version}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" disabled={working} onClick={() => void compare("compare")}>
                  Сравнить версии
                </button>
              </div>
              {review && review.artifactId === selected && (
                <section className={styles.review} aria-label="Проверка изменений Canvas">
                  <CanvasComparison before={review.before} after={review.after} />
                  <button type="button" onClick={() => downloadSnapshot(review.before)}>
                    Скачать текст до
                  </button>
                  <button type="button" onClick={() => downloadSnapshot(review.after)}>
                    Скачать текст после
                  </button>
                  {review.kind === "restore" && (
                    <p>
                      После подтверждения будет создана новая версия на основе v{review.baseVersion}
                      . История сохранится.
                    </p>
                  )}
                  {review.kind === "conflict" && (
                    <p>
                      После подтверждения снимок вашего черновика станет новой версией поверх v
                      {review.baseVersion}.
                    </p>
                  )}
                  {review.kind === "restore" && (
                    <button type="button" disabled={working || dirty} onClick={restore}>
                      Подтвердить восстановление v{review.sourceVersion}
                    </button>
                  )}
                  {review.kind === "conflict" && (
                    <button
                      type="button"
                      disabled={working || !reviewedDraftMatches || conflict !== review.baseVersion}
                      onClick={() => save(false, true)}
                    >
                      Подтвердить новую версию
                    </button>
                  )}
                  {review.kind === "conflict" && !reviewedDraftMatches && (
                    <p>Черновик изменён после сравнения. Сравните его с сервером заново.</p>
                  )}
                  <button type="button" disabled={working} onClick={() => setReview(null)}>
                    Закрыть сравнение
                  </button>
                </section>
              )}
              <ol>
                {history.map((item) => (
                  <li key={item.version}>
                    <span>
                      v{item.version} · {new Date(item.created_at).toLocaleString("ru")} ·{" "}
                      {item.source.kind}
                    </span>
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => void readHistory(item.version)}
                    >
                      Посмотреть
                    </button>
                    <a
                      className={styles.revisionDownload}
                      href={`${base}/${encodeURIComponent(selected)}/revisions/${item.version}/download`}
                    >
                      Скачать v{item.version}
                    </a>
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => void compare("restore", item.version)}
                    >
                      Восстановить новой версией
                    </button>
                  </li>
                ))}
              </ol>
              {history.length >= 100 && history[history.length - 1]!.version > 1 && (
                <button type="button" disabled={working} onClick={() => void readHistory()}>
                  Показать ранние версии
                </button>
              )}
            </section>
          )}
        </div>
      </div>
    </section>
  );
}
