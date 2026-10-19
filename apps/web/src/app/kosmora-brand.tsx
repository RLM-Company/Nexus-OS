import type { SVGProps } from "react";
import { KOSMORA_SYMBOL_DATA_URL } from "./kosmora-brand.generated";

export function KosmoraBrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 64 64"
      width="24"
      height="24"
      fill="none"
      stroke="none"
      aria-hidden="true"
      {...props}
      style={{ fill: "none", stroke: "none", ...props.style }}
    >
      <image href={KOSMORA_SYMBOL_DATA_URL} width="64" height="64" />
    </svg>
  );
}
