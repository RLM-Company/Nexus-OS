import { useEffect, useRef, useState } from "react";
import type { GraphForComparison } from "./revision-diff";
import { sourceSelectionExcerpt, sourceSelectionText } from "./source-selection";
import {
  citationRefreshOperation,
  prepareCitationRefresh,
  type CitationRefreshOperation,
  type CitationRefreshPreview
} from "./citation-refresh";

const control = {
  border: "1px solid #aaa",
  borderRadius: 8,
  padding: 10,
  background: "#fff",
  color: "#171717",
  font: "inherit"
};
export function CitationRefreshReview({
  graph,
  edge,
  disabled,
  onApply,
  onClose,
  onReload
}: {
  graph: GraphForComparison;
  edge: { id: string; version: number };
  disabled: boolean;
  onApply: (operation: CitationRefreshOperation) => Promise<void>;
  onClose: () => void;
  onReload?: () => Promise<void>;
}) {
  const [location, setLocation] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [writing, setWriting] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [notice, setNotice] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [replacement, setReplacement] = useState<string | null>(null);
  const sourceText = useRef<HTMLTextAreaElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus();
  }, []);
  let preview: CitationRefreshPreview | null = null;
  let failure = "";
  try {
    preview = prepareCitationRefresh(graph, edge);
  } catch (error) {
    failure = error instanceof Error ? error.message : "Цитата недоступна.";
  }
  const current = preview;
  return (
    <section
      aria-label="Сверка новой версии источника"
      style={{
        border: "1px solid #999",
        borderRadius: 12,
        padding: 18,
        background: "#fff",
        overflowWrap: "anywhere"
      }}
    >
      <h2 ref={title} tabIndex={-1}>
        Сверка новой версии источника
      </h2>
      <p>
        Связь {edge.id}@{edge.version}. Старые версии и цитаты сохранятся в истории. Новая ссылка
        останется непроверенной: буквальное совпадение не подтверждает смысл или достоверность.
      </p>
      {failure && <p role="alert">{failure}</p>}
      {current && (
        <>
          <h3>Поддерживаемый узел</h3>
          <p>
            {current.target.label} · {current.target.ref.id}@{current.target.ref.version}
          </p>
          <p style={{ whiteSpace: "pre-wrap" }}>{current.target.text}</p>
          <h3>Сохранённая цитата</h3>
          <blockquote
            style={{
              whiteSpace: "pre-wrap",
              marginInline: 0,
              paddingLeft: 12,
              borderLeft: "2px solid #aaa"
            }}
          >
            {current.quote}
          </blockquote>
          <p>
            Прежний источник: {current.previous.label} · {current.previous.ref.id}@
            {current.previous.ref.version}
          </p>
          <details>
            <summary>Полный текст прежней версии</summary>
            <pre style={{ whiteSpace: "pre-wrap" }}>{current.previous.text}</pre>
          </details>
          {current.latest && (
            <>
              <h3>Действующая версия источника</h3>
              <p>
                {current.latest.label} · {current.latest.ref.id}@{current.latest.ref.version}
              </p>
              {!choosing && (
                <pre
                  aria-label="Текст действующей версии источника"
                  style={{ whiteSpace: "pre-wrap", background: "#f5f5f5", padding: 12 }}
                >
                  {current.latest.text}
                </pre>
              )}
            </>
          )}
          {current.state === "source_unavailable" && (
            <p>У источника нет действующей версии. Перенос недоступен.</p>
          )}
          {current.state === "already_current" && (
            <p>Цитата уже ссылается на действующую версию.</p>
          )}
          {current.state === "quote_missing" && (
            <p>
              Точная цитата отсутствует в новой версии. Выделите новый фрагмент и проверьте,
              поддерживает ли он утверждение.
            </p>
          )}
          {["ready", "quote_missing"].includes(current.state) && (
            <>
              {!choosing ? (
                <button
                  type="button"
                  style={control}
                  disabled={disabled || writing || blocked}
                  onClick={() => {
                    setChoosing(true);
                    setReplacement(null);
                    setLocation("");
                    setReviewed(false);
                    setNotice("");
                  }}
                >
                  Выбрать новый фрагмент
                </button>
              ) : (
                <>
                  <label style={{ display: "grid", gap: 6 }}>
                    Выделите новый фрагмент источника
                    <textarea
                      ref={sourceText}
                      style={control}
                      rows={10}
                      readOnly
                      value={sourceSelectionText(current.latest!.text)}
                      disabled={disabled || writing || blocked}
                      onSelect={() => {
                        setReplacement(null);
                        setLocation("");
                        setReviewed(false);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    style={{ ...control, marginTop: 8 }}
                    disabled={disabled || writing || blocked}
                    onClick={() => {
                      try {
                        const area = sourceText.current;
                        if (!area) return;
                        setReplacement(
                          sourceSelectionExcerpt(
                            current.latest!.text,
                            area.selectionStart,
                            area.selectionEnd
                          )
                        );
                        setLocation("");
                        setReviewed(false);
                        setNotice("");
                      } catch (error) {
                        setReplacement(null);
                        setReviewed(false);
                        setNotice(
                          error instanceof Error ? error.message : "Выделите фрагмент источника."
                        );
                      }
                    }}
                  >
                    Использовать выделенный фрагмент
                  </button>
                  <p>
                    Выделите текст мышью или клавиатурой, затем нажмите «Использовать выделенный
                    фрагмент». Сохранится точный исходный текст, включая переводы строк. До 1000
                    символов.
                  </p>
                  {replacement !== null && (
                    <>
                      <h3>Выбранная новая цитата</h3>
                      <blockquote
                        aria-label="Выбранная новая цитата"
                        style={{ whiteSpace: "pre-wrap" }}
                      >
                        {replacement}
                      </blockquote>
                    </>
                  )}
                  <button
                    type="button"
                    style={control}
                    disabled={disabled || writing || blocked}
                    onClick={() => {
                      setChoosing(false);
                      setReplacement(null);
                      setLocation("");
                      setReviewed(false);
                      setNotice("");
                    }}
                  >
                    Отменить выбор фрагмента
                  </button>
                </>
              )}
            </>
          )}
          {((current.state === "ready" && !choosing) || replacement !== null) && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (disabled || writing || blocked || !reviewed || !location.trim()) return;
                let operation: CitationRefreshOperation;
                try {
                  operation = citationRefreshOperation(
                    current,
                    location,
                    reviewed,
                    replacement ?? undefined
                  );
                } catch (error) {
                  setReviewed(false);
                  setNotice(
                    error instanceof Error ? error.message : "Проверьте место в источнике."
                  );
                  return;
                }
                setWriting(true);
                setNotice("");
                void (async () => {
                  try {
                    await onApply(operation);
                  } catch (error) {
                    setBlocked(true);
                    setReviewed(false);
                    setNotice(
                      (error instanceof Error ? error.message + " " : "") +
                        "Сохранение не подтверждено. Загрузите граф заново перед повтором; автоматической повторной записи нет."
                    );
                  } finally {
                    setWriting(false);
                  }
                })();
              }}
            >
              <p>
                {replacement === null
                  ? "Цитата буквально присутствует в новой версии."
                  : "Новый фрагмент выбран из действующей версии источника."}{" "}
                Проверьте её контекст и укажите новое место — прежние номера строк могли измениться.
              </p>
              <label style={{ display: "grid", gap: 6 }}>
                Место в новой версии источника
                <input
                  style={control}
                  value={location}
                  maxLength={256}
                  required
                  disabled={disabled || writing || blocked}
                  onChange={(event) => {
                    setLocation(event.target.value);
                    setReviewed(false);
                  }}
                />
              </label>
              <label style={{ display: "block", marginBlock: 12 }}>
                <input
                  type="checkbox"
                  checked={reviewed}
                  disabled={disabled || writing || blocked || !location.trim()}
                  onChange={(event) => setReviewed(event.target.checked)}
                />{" "}
                Сверил цитату, контекст и место в новой версии
              </label>
              <button
                type="submit"
                style={control}
                disabled={disabled || writing || blocked || !reviewed || !location.trim()}
              >
                Сохранить новую ссылку на источник
              </button>
            </form>
          )}
        </>
      )}
      {notice && <p role="alert">{notice}</p>}
      {blocked && onReload && (
        <button
          type="button"
          style={{ ...control, marginTop: 12 }}
          disabled={writing || disabled}
          onClick={() => void onReload()}
        >
          Загрузить состояние графа
        </button>
      )}
      {writing && <p role="status">Сохранение новой версии связи…</p>}
      <button
        type="button"
        style={{ ...control, marginTop: 12 }}
        disabled={writing}
        onClick={onClose}
      >
        Закрыть сверку
      </button>
    </section>
  );
}
