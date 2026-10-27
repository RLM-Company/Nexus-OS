import styles from "./code-text.module.css";

/** Lightweight neutral emphasis, not a parser. Text is escaped by React and never executed. */
export function CodeText({ text, language }: { text: string; language: string }) {
  if (text.length > 100_000 || !/^(?:[cm]?[jt]sx?|json|py|python|css|sh|bash)$/i.test(language))
    return <>{text}</>;
  const parts = text.split(
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|#[^\n]*|\b(?:const|let|var|export|import|from|return|async|await|function|class|if|else|for|while|def|True|False|None|true|false|null|new|throw|try|catch|type|interface)\b|\b\d+(?:\.\d+)?\b)/g
  );
  return (
    <>
      {parts.map((part, index) => {
        const kind =
          part.startsWith("//") || part.startsWith("#")
            ? "comment"
            : /^["']/.test(part)
              ? "string"
              : /^\d/.test(part)
                ? "number"
                : index % 2
                  ? "keyword"
                  : "plain";
        return kind === "plain" ? (
          part
        ) : (
          <span key={index} className={styles[kind]}>
            {part}
          </span>
        );
      })}
    </>
  );
}
