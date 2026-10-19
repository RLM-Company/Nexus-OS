import type { SVGProps } from "react";

export function KosmoraBrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 64 64"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
      style={{ fill: "none", stroke: "currentColor", ...props.style }}
    >
      {/* Rear orbit ends at the helmet; it never cuts through the visor. */}
      <path d="M14 25C4 21 3 23 7 28M49 35c10 4 13 8 9 10" />
      <path d="M19 43a21 21 0 1 1 25-1" />
      <path d="M20 21c5-5 13-6 20-1l-1 12c-1 5-5 8-10 8h-5c-7-4-9-12-4-19Z" />
      <path d="M22 23c3-2 7-3 10-2" />
      <circle cx="44" cy="31" r="3" />
      <path d="m22 44 17 5-2 6-18-5 3-6Z" />
      {/* Front orbit is a single clean stroke, with no duplicate loops. */}
      <path d="M7 28c7 8 32 18 45 18 7 0 8-2 5-5" />
    </svg>
  );
}
