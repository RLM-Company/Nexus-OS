"use client";
import { issueInputSize, type IssueContext } from "./github-issues-client";
import styles from "./code-agent.module.css";
export function GithubIssueContextEditor(props: {
  task: string;
  context: IssueContext;
  disabled: boolean;
  onChange: (value: IssueContext | null) => void;
}) {
  const { context } = props;
  return (
    <div aria-label="Контекст GitHub issue">
      <p>
        Недоверенный контекст: {context.repository} #{context.number}. Измените задачу выше и
        фрагмент ниже перед отдельным запуском Code.
      </p>
      <label>
        Заголовок issue (данные)
        <input
          value={context.title}
          disabled={props.disabled}
          maxLength={512}
          onChange={(e) => props.onChange({ ...context, title: e.target.value })}
        />
      </label>
      <label>
        Описание issue (недоверенные данные)
        <textarea
          rows={6}
          value={context.body}
          disabled={props.disabled}
          maxLength={7000}
          onChange={(e) =>
            props.onChange({
              ...context,
              body: e.target.value,
              truncated: context.truncated || e.target.value.length < context.source_body_chars,
              truncation_approved: false
            })
          }
        />
      </label>
      <p>
        Задача и сериализованный контекст: {issueInputSize(props.task, context)} / 8000 символов.
        Оригинал описания: {context.source_body_chars} символов; сейчас: {context.body.length}.
      </p>
      {context.truncated && (
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            disabled={props.disabled}
            checked={context.truncation_approved}
            onChange={(e) => props.onChange({ ...context, truncation_approved: e.target.checked })}
          />
          Подтверждаю использование отредактированного фрагмента описания
        </label>
      )}
      <button disabled={props.disabled} onClick={() => props.onChange(null)}>
        Убрать контекст issue
      </button>
    </div>
  );
}
