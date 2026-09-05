import type { CSSProperties, HTMLAttributes, ReactNode, Ref } from "react";

type SplitBentoStyle = CSSProperties & {
  "--split-bento-columns": string;
  "--split-bento-max-height": string;
};

export function SplitBento({
  children,
  columns = "minmax(620px, 1.5fr) minmax(300px, .72fr)",
  heightMode = "content",
  maxHeight = "clamp(320px, calc(100dvh - 240px), 700px)",
  className,
  containerRef,
  ...props
}: {
  children: ReactNode;
  columns?: string;
  heightMode?: "content" | "viewport" | "equal";
  maxHeight?: string;
  containerRef?: Ref<HTMLDivElement>;
} & HTMLAttributes<HTMLDivElement>) {
  const style: SplitBentoStyle = {
    ...props.style,
    "--split-bento-columns": columns,
    "--split-bento-max-height": maxHeight,
  };

  return (
    <div
      {...props}
      ref={containerRef}
      className={["split-bento", className].filter(Boolean).join(" ")}
      data-height-mode={heightMode}
      style={style}
    >
      {children}
    </div>
  );
}
