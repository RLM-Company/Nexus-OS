import type { SVGProps } from "react";

export function KosmoraBrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 64 64"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
      style={{ fill: "none", stroke: "currentColor", ...props.style }}
    >
      <path d="M18 41c-5-4-8-10-6-17 2-10 13-16 23-13 11 3 17 14 14 24-2 6-6 10-12 12" />
      <path d="M18 22c6-6 14-6 20-1 2 2 2 5 0 7l-4 4c-2 2-3 5-2 8l-9-3c-6-2-9-9-5-15Z" />
      <circle cx="42" cy="32" r="3.5" />
      <path d="m23 43 15 6-3 5-16-6 4-5Z" />
      <path d="M12 25C-5 18 2 32 28 42s42 8 24-4M49 30c17 7 12 14-7 10L18 31C2 25 1 19 15 22" />
    </svg>
  );
}
