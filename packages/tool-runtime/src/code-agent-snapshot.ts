import type { CodeAgentWorkspaceFile } from "./code-agent-workspace.js";

/** Archive only validated ordinary files; no links, devices, owners or host paths. */
export function codeAgentSnapshotArchive(files: readonly CodeAgentWorkspaceFile[]): Buffer {
  const chunks: Buffer[] = [];
  const entry = (name: string, data: Buffer, type: string, mode: number) => {
    const header = Buffer.alloc(512);
    header.write(name, 0, 100);
    const octal = (value: number, offset: number, width: number) =>
      header.write(value.toString(8).padStart(width - 1, "0") + "\0", offset, width);
    octal(mode, 100, 8);
    octal(65534, 108, 8);
    octal(65534, 116, 8);
    octal(data.length, 124, 12);
    octal(0, 136, 12);
    header.fill(32, 148, 156);
    header.write(type, 156, 1);
    header.write("ustar\0", 257, 6);
    header.write("00", 263, 2);
    const sum = header.reduce((n, byte) => n + byte, 0);
    header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
    chunks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  };
  entry("workspace/", Buffer.alloc(0), "5", 0o755);
  const directories = new Set<string>();
  let index = 0;
  for (const file of files) {
    const parts = file.path.split("/");
    for (let i = 1; i < parts.length; i++)
      directories.add("workspace/" + parts.slice(0, i).join("/") + "/");
  }
  const pathEntry = (path: string, data: Buffer, type: string, mode: number) => {
    const value = ` path=${path}\n`;
    let size = Buffer.byteLength(value) + 1;
    while (String(size).length + Buffer.byteLength(value) !== size)
      size = String(size).length + Buffer.byteLength(value);
    entry(`pax-${index}`, Buffer.from(`${size}${value}`), "x", 0o444);
    entry(`entry-${index++}`, data, type, mode);
  };
  for (const directory of [...directories].sort())
    pathEntry(directory, Buffer.alloc(0), "5", 0o755);
  for (const file of files)
    pathEntry("workspace/" + file.path, Buffer.from(file.content), "0", 0o444);
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

/** Remove terminal control sequences and common credential formats before storing/displaying. */
export function redactCodeAgentOutput(value: string): string {
  return (
    value
      // eslint-disable-next-line no-control-regex -- deliberately remove terminal controls
      .replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|$))/gu, "")
      // eslint-disable-next-line no-control-regex -- deliberately remove non-text controls
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/gu, "")
      .replace(
        /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/gu,
        "[REDACTED]"
      )
      .replace(
        /\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{10,})\b/gu,
        "[REDACTED]"
      )
      .replace(/\b(Bearer\s+)[^\s]+/giu, "$1[REDACTED]")
      .replace(
        /\b((?:api[_-]?key|access[_-]?token|password|secret)\s*[=:]\s*)[^\s,;]+/giu,
        "$1[REDACTED]"
      )
  );
}
