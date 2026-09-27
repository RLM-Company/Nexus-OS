import type { SVGProps } from "react";

export type IconName =
  | "cosmora"
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
  | "apps"
  | "features"
  | "settings"
  | "owner"
  | "shield"
  | "search"
  | "arrow"
  | "download"
  | "copy"
  | "close"
  | "more"
  | "check";

const paths: Record<IconName, React.ReactNode> = {
  cosmora: (
    <>
      <path d="M17.8 5.4a8.5 8.5 0 1 0 0 13.2" />
      <ellipse cx="12" cy="12" rx="10" ry="3.6" transform="rotate(-40 12 12)" />
      <circle cx="18.6" cy="6.5" r="1.5" fill="currentColor" stroke="none" />
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
