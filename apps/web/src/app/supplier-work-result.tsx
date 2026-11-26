import type { ReactNode } from "react";
import type { SupplierWorkEvidence, SupplierWorkHandoff } from "@cosmora/contracts";
import { ProjectCorrectionRules } from "./project-correction-rules";
import { supplierWorkUrl } from "./supplier-work-handoff";

export function SupplierWorkResult({
  projectId,
  workId,
  source,
  instructions,
  evidence,
  children
}: {
  projectId: string;
  workId: string;
  source: SupplierWorkHandoff | undefined;
  instructions: string;
  evidence: string | undefined;
  children?: ReactNode;
}) {
  let result: SupplierWorkEvidence | null = null;
  if (evidence) {
    try {
      const value = JSON.parse(evidence) as SupplierWorkEvidence;
      if (value.format === "kosmora.supplier-comparison-evidence.v1") result = value;
    } catch {
      // A historical or unreadable receipt cannot be treated as a successful check.
    }
  }
  const sourceUrl = source
    ? "/?" +
      new URLSearchParams({
        chat: source.chat_id,
        message: source.message_id,
        mode: "kosmora"
      }).toString()
    : null;
  return (
    <section className="manager-work-plan" aria-label="Сдача сравнения поставщиков">
      <strong>Сравнение поставщиков</strong>
      <p>
        {sourceUrl && (
          <>
            <a href={sourceUrl}>Исходное сообщение Kosmora</a> ·{" "}
          </>
        )}
        <a href={supplierWorkUrl(projectId, workId)}>Постоянная ссылка на задачу</a>
      </p>
      {source && (
        <>
          <details>
            <summary>Сообщение и инструкции на момент запуска</summary>
            <blockquote style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {source.message}
            </blockquote>
            <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              Версия материалов проекта {source.materials_version}.{" "}
              {instructions || "Инструкций нет."}
            </p>
          </details>
          <p>
            <strong>Версии входных файлов</strong>
          </p>
          {source.inputs.length > 0 ? (
            <ul>
              {source.inputs.map((file, index) => (
                <li key={source.attachment_indexes[index]}>
                  {file.name} ·{" "}
                  <code style={{ overflowWrap: "anywhere" }}>SHA‑256 текста {file.sha256}</code>
                </li>
              ))}
            </ul>
          ) : (
            <p>Входные данные взяты из текста сообщения.</p>
          )}
        </>
      )}
      {result && (
        <>
          <p>
            <strong>Применённые правила</strong>
          </p>
          {(result.applied_rule_versions?.length ?? 0) > 0 ? (
            <ul>
              {result.applied_rule_versions?.map((rule) => (
                <li key={rule.id}>
                  {rule.name} · версия {rule.version}
                </li>
              ))}
            </ul>
          ) : (
            <p>К этому результату правила не применялись.</p>
          )}
          {!!result.conflicting_rules?.length && (
            <>
              <p>Конфликт формата доставки. Применён стандартный формат отчёта.</p>
              <ul>
                {result.conflicting_rules.map((rule) => (
                  <li key={rule.id}>
                    {rule.name} · версия {rule.version}
                  </li>
                ))}
              </ul>
            </>
          )}
          {result.ignored_rules?.map((rule) => (
            <p key={rule.id}>
              {rule.name} · версия {rule.version}. Автоматическое применение не поддерживается.
            </p>
          ))}
          <p>
            <strong>Выполненные проверки</strong>
          </p>
          <ul>
            {result.checks.map((check) => (
              <li key={check}>{check}</li>
            ))}
          </ul>
          <p>
            <strong>Спорные позиции</strong>
          </p>
          {result.disputes.length > 0 ? (
            <ul>
              {result.disputes.map((item, index) => (
                <li key={index}>
                  {item.supplier}
                  {item.item_id ? " · " + item.item_id : ""} · {item.reason}
                </li>
              ))}
            </ul>
          ) : (
            <p>Расхождений по проверенным полям не найдено.</p>
          )}
        </>
      )}
      {children}
      {result && <ProjectCorrectionRules projectId={projectId} />}
    </section>
  );
}
