"use client";

import { useMemo, useRef, useState } from "react";
import { WorkspaceIcon } from "../workspace-icons";
import styles from "./file-tree.module.css";

export type FileTreeEntry = { path: string };
type Node = { path: string; name: string; folder: boolean; level: number; parent: string | null };
export function buildFileTree(files: FileTreeEntry[]): Node[] {
  const nodes = new Map<string, Node>();
  for (const file of files) {
    const parts = file.path.split("/");
    if (parts.length > 64 || parts.some((part) => !part || part === "." || part === "..")) continue;
    for (let index = 0; index < parts.length; index++) {
      const path = parts.slice(0, index + 1).join("/");
      nodes.set(path, {
        path,
        name: parts[index]!,
        folder: index < parts.length - 1,
        level: index + 1,
        parent: index ? parts.slice(0, index).join("/") : null
      });
    }
  }
  const children = new Map<string | null, Node[]>();
  for (const node of nodes.values()) {
    const group = children.get(node.parent) ?? [];
    group.push(node);
    children.set(node.parent, group);
  }
  const result: Node[] = [];
  const visit = (parent: string | null) => {
    for (const node of (children.get(parent) ?? []).sort(
      (a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name)
    )) {
      result.push(node);
      if (node.folder) visit(node.path);
    }
  };
  visit(null);
  return result;
}

export function FileTree({
  files,
  selected,
  disabled,
  onSelect
}: {
  files: FileTreeEntry[];
  selected?: string | undefined;
  disabled?: boolean;
  onSelect: (path: string) => void;
}) {
  const all = useMemo(() => buildFileTree(files), [files]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const visible = all.filter((node) => {
    const parts = node.path.split("/");
    for (let depth = 1; depth < parts.length; depth++) {
      if (collapsed.has(parts.slice(0, depth).join("/"))) return false;
    }
    return true;
  });
  const focus = (path: string) => {
    setFocused(path);
    const index = visible.findIndex((node) => node.path === path);
    ref.current?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]')[index]?.focus();
  };
  const toggle = (path: string, close: boolean) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (close) next.add(path);
      else next.delete(path);
      return next;
    });
  return (
    <div ref={ref} className={styles.tree} role="tree" aria-label="Дерево файлов репозитория">
      {visible.map((node, index) => (
        <button
          type="button"
          key={node.path}
          role="treeitem"
          aria-label={node.path}
          aria-level={node.level}
          aria-selected={!node.folder && node.path === selected}
          aria-expanded={node.folder ? !collapsed.has(node.path) : undefined}
          tabIndex={
            (visible.some((item) => item.path === focused) ? focused === node.path : index === 0)
              ? 0
              : -1
          }
          disabled={disabled}
          style={{ paddingLeft: `${8 + Math.min(node.level - 1, 8) * 14}px` }}
          onFocus={() => setFocused(node.path)}
          onClick={() =>
            node.folder ? toggle(node.path, !collapsed.has(node.path)) : onSelect(node.path)
          }
          onKeyDown={(event) => {
            const key = event.key;
            if (["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"].includes(key))
              event.preventDefault();
            if (key === "ArrowDown") focus(visible[Math.min(index + 1, visible.length - 1)]!.path);
            if (key === "ArrowUp") focus(visible[Math.max(index - 1, 0)]!.path);
            if (key === "Home") focus(visible[0]!.path);
            if (key === "End") focus(visible[visible.length - 1]!.path);
            if (key === "ArrowRight" && node.folder) {
              if (collapsed.has(node.path)) toggle(node.path, false);
              else if (visible[index + 1]?.parent === node.path) focus(visible[index + 1]!.path);
            }
            if (key === "ArrowLeft") {
              if (node.folder && !collapsed.has(node.path)) toggle(node.path, true);
              else if (node.parent) focus(node.parent);
            }
          }}
        >
          <span className={styles.chevron} aria-hidden="true">
            {node.folder ? (collapsed.has(node.path) ? "›" : "⌄") : ""}
          </span>
          <WorkspaceIcon name={node.folder ? "projects" : "files"} aria-hidden="true" />
          <span className={styles.name}>{node.name}</span>
        </button>
      ))}
    </div>
  );
}
