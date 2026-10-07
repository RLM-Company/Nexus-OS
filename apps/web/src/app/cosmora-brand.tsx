import type { SVGProps } from "react";
import { COSMORA_SYMBOL_PATH } from "./cosmora-brand.generated";

export function CosmoraBrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 64 64"
      width="24"
      height="24"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      {...props}
      style={{ fill: "currentColor", stroke: "none", ...props.style }}
    >
      <path d={COSMORA_SYMBOL_PATH} />
    </svg>
  );
}
