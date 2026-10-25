// The model providers' own marks, from LobeHub's icon set (@lobehub/icons-static-svg, pinned in
// package.json; MIT, see NOTICE.md): filled shapes on a 24-unit grid in the current colour.
import anthropic from "@lobehub/icons-static-svg/icons/anthropic.svg?raw";
import deepseek from "@lobehub/icons-static-svg/icons/deepseek.svg?raw";
import openai from "@lobehub/icons-static-svg/icons/openai.svg?raw";
import type { BrandRole } from "../theme/roles";

export const BRANDS = { deepseek, openai, anthropic } as const satisfies Record<string, string>;

export type BrandName = keyof typeof BRANDS;

/** Each provider's own colour, for its mark where it names the agent (a card, the chosen provider). */
export const BRAND_TONE = {
  deepseek: "brand-deepseek", openai: "brand-openai", anthropic: "brand-anthropic",
} as const satisfies Record<BrandName, BrandRole>;
