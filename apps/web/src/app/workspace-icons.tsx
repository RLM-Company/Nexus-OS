import type { SVGProps } from "react";
import { KosmoraBrandMark } from "./kosmora-brand";

export type IconName =
  | "cosmora"
  | "research"
  | "presentations"
  | "sites"
  | "games"
  | "files"
  | "paperclip"
  | "chats"
  | "new-chat"
  | "projects"
  | "work"
  | "code"
  | "multi-agent"
  | "skills"
  | "studio"
  | "images"
  | "video"
  | "sound"
  | "microphone"
  | "headphones"
  | "apps"
  | "features"
  | "settings"
  | "bell"
  | "owner"
  | "shield"
  | "search"
  | "arrow"
  | "download"
  | "copy"
  | "close"
  | "more"
  | "check"
  | "pin"
  | "edit"
  | "link"
  | "archive"
  | "repeat"
  | "bolt"
  | "panel-close"
  | "panel-open"
  | "canvas"
  | "stop"
  | "trash";
// Shared action icons keep identical geometry across chat and composer.

const paths: Record<Exclude<IconName, "cosmora">, React.ReactNode> = {
  repeat: (
    <>
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M6.1 7a7 7 0 0 1 11.5-2L20 8M4 16l2.4 3A7 7 0 0 0 18 17" />
    </>
  ),
  bolt: <path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z" />,
  "panel-close": (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9 4v16m7-12-4 4 4 4" />
    </>
  ),
  "panel-open": (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9 4v16m3-12 4 4-4 4" />
    </>
  ),
  canvas: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="3" />
      <path d="M8 8h8m-8 4h8m-8 4h4" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  pin: <path d="m9 3 10 10-3 1-3 4-3-3-6 6m6-6-3-3 4-3 1-3Z" />,
  edit: (
    <>
      <path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14v6Z" />
    </>
  ),
  link: (
    <>
      <path d="m10 13 4-4M8 15l-2 2a3 3 0 0 0 4 4l4-4a3 3 0 0 0 0-4M16 9l2-2a3 3 0 0 0-4-4l-4 4a3 3 0 0 0 0 4" />
    </>
  ),
  archive: (
    <>
      <rect x="3" y="3" width="18" height="4" rx="1" />
      <path d="M5 7v13h14V7M9 11h6" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
    </>
  ),
  research: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5M7 10h7M10.5 6.5v7" />
    </>
  ),
  presentations: (
    <>
      <rect x="3" y="3" width="18" height="13" rx="2" />
      <path d="m8 21 4-5 4 5M8 8h8M8 11h5" />
    </>
  ),
  sites: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M7 6.5h.01M10 6.5h.01M7 13h10M7 16h6" />
    </>
  ),
  games: (
    <>
      <path d="M7 7h10c3 0 5 10 3 12-2 2-5-3-6-3h-4c-1 0-4 5-6 3-2-2 0-12 3-12Z" />
      <path d="M8 10v5m-2.5-2.5h5M16 11h.01M18 14h.01" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" />
      <path d="M10 21h4" />
    </>
  ),
  headphones: (
    <>
      <path d="M4 13v-2a8 8 0 0 1 16 0v2" />
      <rect x="3" y="12" width="4" height="8" rx="2" />
      <rect x="17" y="12" width="4" height="8" rx="2" />
    </>
  ),
  microphone: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11v1a6 6 0 0 0 12 0v-1M12 18v3M9 21h6" />
    </>
  ),
  paperclip: (
    <path d="m21 11.5-8.5 8.5a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8L15.5 6" />
  ),
  files: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6M8 13h8M8 17h5" />
    </>
  ),
  chats: <path d="M21 11.5a8 8 0 0 1-8 8H7l-4 2V11.5a9 9 0 0 1 18 0Z" />,
  "new-chat": (
    <>
      <path d="M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7" />
      <path d="m16 3 5 5-9 9-5 1 1-5 8-10Z" />
    </>
  ),
  projects: (
    <path d="M3 8V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z" />
  ),
  work: (
    <>
      <rect x="3" y="7" width="18" height="14" rx="3" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12c5 3 13 3 18 0M12 12v3" />
    </>
  ),
  code: (
    <>
      <path d="m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18" />
    </>
  ),
  "multi-agent": (
    <>
      <circle cx="9" cy="7" r="3" />
      <path d="M2 21v-2a7 7 0 0 1 14 0v2M17 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5v2" />
    </>
  ),
  skills: (
    <>
      <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
    </>
  ),
  studio: (
    <>
      <rect x="3" y="6" width="18" height="15" rx="3" />
      <path d="M7 3h10m-7 8 6 3-6 3v-6Z" />
    </>
  ),
  images: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8" cy="8" r="1.5" />
      <path d="m3 17 6-6 5 5 3-3 4 4" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="m10 8 6 4-6 4V8Z" />
    </>
  ),
  sound: <path d="M3 9v6m4-9v12m5-16v20m5-16v12m4-9v6" />,
  apps: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <path d="M14 17.5h7m-3.5-3.5v7" />
    </>
  ),
  features: (
    <>
      <path d="M4 5h16M4 12h16M4 19h16" />
      <circle cx="7" cy="5" r="1" fill="var(--icon-bg, white)" />
      <circle cx="14" cy="12" r="1" fill="var(--icon-bg, white)" />
      <circle cx="10" cy="19" r="1" fill="var(--icon-bg, white)" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h16M4 17h16" />
      <circle cx="9" cy="7" r="3" fill="var(--icon-bg, white)" />
      <circle cx="15" cy="17" r="3" fill="var(--icon-bg, white)" />
    </>
  ),
  owner: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 21v-2a7 7 0 0 1 14 0v2" />
    </>
  ),
  shield: (
    <>
      <path d="m12 3 8 3v5c0 5-3 8-8 10-5-2-8-5-8-10V6l8-3Z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="7" />
      <path d="m16 16 5 5" />
    </>
  ),
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />,
  copy: (
    <>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M16 8V3H3v13h5" />
    </>
  ),
  close: <path d="m6 6 12 12M6 18 18 6" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />
};

export function WorkspaceIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  if (name === "cosmora") return <KosmoraBrandMark width="20" height="20" {...props} />;
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
