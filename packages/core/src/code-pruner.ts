/**
 * AST & Syntactic Code Pruner for Kosmora Token Economy.
 */

export interface CodePruneOptions {
  stripComments?: boolean;
  collapseWhitespace?: boolean;
  preserveJsDoc?: boolean;
}

export interface CodePruneResult {
  content: string;
  originalBytes: number;
  prunedBytes: number;
  savedPercentage: number;
}

export function pruneCodeForContext(
  code: string,
  language = "typescript",
  options: CodePruneOptions = {}
): CodePruneResult {
  const {
    stripComments = true,
    collapseWhitespace = true,
    preserveJsDoc = false
  } = options;

  if (!code) {
    return { content: "", originalBytes: 0, prunedBytes: 0, savedPercentage: 0 };
  }

  const originalBytes = new TextEncoder().encode(code).length;
  let result = code;

  if (stripComments) {
    const isCStyle = ["javascript", "typescript", "js", "ts", "jsx", "tsx", "c", "cpp", "java", "go", "rust"].includes(
      language.toLowerCase()
    );
    const isPythonStyle = ["python", "py", "bash", "sh", "yaml", "yml", "ruby", "rb"].includes(
      language.toLowerCase()
    );

    if (isCStyle) {
      if (!preserveJsDoc) {
        result = result.replace(/\/\*[\s\S]*?\*\//gu, "");
      } else {
        result = result.replace(/\/\*(?!\*)[\s\S]*?\*\//gu, "");
      }
      result = result.replace(/(?<!:)\/\/(?![\w.-]+\/).*$/gmu, "");
    } else if (isPythonStyle) {
      result = result.replace(/^(?!#!)\s*#.*$/gmu, "");
    }
  }

  if (collapseWhitespace) {
    result = result.replace(/[ \t]+$/gmu, "");
    result = result.replace(/\n{3,}/gu, "\n\n");
    result = result.trim();
  }

  const prunedBytes = new TextEncoder().encode(result).length;
  const savedPercentage =
    originalBytes > 0 ? Math.max(0, Math.round(((originalBytes - prunedBytes) / originalBytes) * 100)) : 0;

  return {
    content: result,
    originalBytes,
    prunedBytes,
    savedPercentage
  };
}
