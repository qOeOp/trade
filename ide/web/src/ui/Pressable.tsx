import type { ComponentProps } from "react";

/** A button whose look is all its content's (a tile, a card, a hover action): the caller styles it whole. */
export const Pressable = (props: ComponentProps<"button">) => <button type="button" {...props} />;
