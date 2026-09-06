import type { Variants } from "framer-motion";

export const slideFromLeft: Variants = {
  initial: { x: -20, opacity: 0 },
  animate: { x: 0, opacity: 1 },
  exit: { x: 20, opacity: 0 },
};

export const slideFromRight: Variants = {
  initial: { x: 20, opacity: 0 },
  animate: { x: 0, opacity: 1 },
  exit: { x: -20, opacity: 0 },
};

export const transition = {
  type: "tween",
  duration: 0.3,
  ease: "easeOut",
} as const;

export const buttonHover: Variants = {
  hover: { scale: 1.05 },
  tap: { scale: 0.95 },
};
