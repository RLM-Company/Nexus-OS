"use client";

import { useEffect, useId, useRef, useState, type ReactNode, type ComponentProps } from "react";
import { WorkspaceIcon } from "../workspace-icons";
import styles from "./workspace-kit.module.css";

export function ActionButton({
  children,
  variant = "outline",
  busy = false,
  disabled,
  className = "",
  type = "button",
  ...props
}: ComponentProps<"button"> & {
  variant?: "solid" | "outline" | "ghost";
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      type={type}
      className={`${styles.actionButton} ${className}`}
      data-variant={variant}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy && <span className={styles.buttonSpinner} aria-hidden="true" />}
      {children}
    </button>
  );
}

/** Native modal owns focus trapping, Escape and focus restoration. Hosts own mutations. */
export function SurfaceDialog({
  open,
  onClose,
  title,
  description,
  children
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) {
      if (dialog?.open) dialog.close();
      return;
    }
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      // React removes a conditional dialog before effect cleanup; native restoration then has no target.
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={id}
      aria-describedby={description ? `${id}-description` : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose();
      }}
    >
      <header className={styles.dialogHeader}>
        <div>
          <h3 id={id}>{title}</h3>
          {description && <p id={`${id}-description`}>{description}</p>}
        </div>
        <ActionButton variant="ghost" aria-label="Закрыть окно" onClick={onClose}>
          <span aria-hidden="true">×</span>
        </ActionButton>
      </header>
      <div className={styles.dialogBody}>{children}</div>
    </dialog>
  );
}

export function UploadDropzone({
  id,
  label,
  description,
  accept,
  multiple = false,
  disabled = false,
  onFiles
}: {
  id?: string;
  label: string;
  description: string;
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}) {
  const generated = useId();
  const inputId = id ?? generated;
  const [dragging, setDragging] = useState(false);
  const deliver = (files: File[]) => {
    if (!disabled && files.length) onFiles(multiple ? files : files.slice(0, 1));
  };
  return (
    <div
      className={styles.dropzone}
      data-dragging={dragging || undefined}
      data-disabled={disabled || undefined}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        deliver(Array.from(event.dataTransfer.files));
      }}
    >
      <span className={styles.uploadIcon} aria-hidden="true">
        <WorkspaceIcon name="upload" />
      </span>
      <div>
        <label htmlFor={inputId}>{label}</label>
        <p id={`${inputId}-hint`}>{description}</p>
      </div>
      <input
        className={styles.fileInput}
        id={inputId}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        aria-label={label}
        aria-describedby={`${inputId}-hint`}
        onChange={(event) => {
          deliver(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = "";
        }}
      />
    </div>
  );
}

export type FilterChip = { id: string; label: string; onRemove: () => void };
export function FilterChips({ chips, onClear }: { chips: FilterChip[]; onClear: () => void }) {
  if (!chips.length) return null;
  return (
    <div className={styles.filterChips} role="group" aria-label="Активные фильтры">
      <WorkspaceIcon name="search" />
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          onClick={chip.onRemove}
          aria-label={`Убрать фильтр: ${chip.label}`}
        >
          <span>{chip.label}</span>
          <span aria-hidden="true">×</span>
        </button>
      ))}
      <button type="button" className={styles.clearFilters} onClick={onClear}>
        Сбросить все
      </button>
    </div>
  );
}

export function CollectionToolbar({
  query,
  onQuery,
  label,
  count,
  children
}: {
  query: string;
  onQuery: (value: string) => void;
  label: string;
  count: string;
  children?: ReactNode;
}) {
  return (
    <div className={styles.collectionToolbar}>
      <label className={styles.search}>
        <WorkspaceIcon name="search" />
        <input
          type="search"
          aria-label={label}
          placeholder={label}
          value={query}
          maxLength={200}
          onChange={(event) => onQuery(event.target.value)}
        />
      </label>
      <span className={styles.collectionCount}>{count}</span>
      <div className={styles.toolbarActions}>{children}</div>
    </div>
  );
}

/** Sharing an existing owner-scoped URL never changes a file's access permissions. */
export function FileShareDialog({ name, path }: { name: string; path: string }) {
  const [open, setOpen] = useState(false);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const [url, setUrl] = useState("");
  const safePath = path.startsWith("/") && !path.startsWith("//") ? path : null;
  const show = () => {
    if (!safePath) return;
    setCopy("idle");
    setUrl(new URL(safePath, window.location.origin).href);
    setOpen(true);
  };
  return (
    <>
      <ActionButton
        className={styles.shareButton}
        aria-label={`Поделиться файлом ${name}`}
        title="Поделиться"
        onClick={show}
        disabled={!safePath}
      >
        <WorkspaceIcon name="share" />
      </ActionButton>
      {open && (
        <SurfaceDialog
          open={open}
          onClose={() => setOpen(false)}
          title="Поделиться файлом"
          description={name}
        >
          <div className={styles.accessNote}>
            <WorkspaceIcon name="shield" />
            <div>
              <strong>Доступ владельца</strong>
              <p>Ссылка открывается после входа в Kosmora. Права доступа к файлу сохраняются.</p>
            </div>
          </div>
          <label className={styles.linkField}>
            Ссылка на оригинал
            <input
              type="url"
              readOnly
              value={url}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <div className={styles.dialogActions}>
            <ActionButton
              variant="solid"
              className={styles.primary}
              onClick={() => {
                if (!navigator.clipboard) {
                  setCopy("failed");
                  return;
                }
                void navigator.clipboard.writeText(url).then(
                  () => setCopy("copied"),
                  () => setCopy("failed")
                );
              }}
            >
              <WorkspaceIcon name={copy === "copied" ? "check" : "copy"} />
              {copy === "copied" ? "Скопировано" : "Копировать ссылку"}
            </ActionButton>
            {safePath && (
              <a href={safePath} download>
                <WorkspaceIcon name="download" />
                Скачать файл
              </a>
            )}
          </div>
          <p className={styles.copyStatus} role={copy === "failed" ? "alert" : "status"}>
            {copy === "failed"
              ? "Не удалось скопировать. Выделите ссылку и скопируйте вручную."
              : copy === "copied"
                ? "Ссылка скопирована."
                : "Чтобы передать файл без входа, скачайте его и отправьте самостоятельно."}
          </p>
        </SurfaceDialog>
      )}
    </>
  );
}
