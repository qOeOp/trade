"use client";

import { motion, useReducedMotion, type Transition, type Variants } from "motion/react";
import { usePathname } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";

type AnimationDirection = "up" | "down" | "left" | "right" | "none";

export type AnimateInProps = {
  children: ReactNode;
  delay?: number;
  baseDelay?: number;
  staggerInterval?: number;
  from?: AnimationDirection;
  distance?: number;
  duration?: number;
  className?: string;
  style?: CSSProperties;
};

function initialPosition(from: AnimationDirection, distance: number) {
  switch (from) {
    case "up": return { x: 0, y: distance };
    case "down": return { x: 0, y: -distance };
    case "left": return { x: distance, y: 0 };
    case "right": return { x: -distance, y: 0 };
    default: return { x: 0, y: 0 };
  }
}

export function AnimateIn({
  children,
  delay = 0,
  baseDelay = 0.05,
  staggerInterval = 0.08,
  from = "up",
  distance = 16,
  duration = 0.4,
  className,
  style,
}: AnimateInProps) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  const initial = initialPosition(from, distance);
  const variants: Variants = {
    hidden: { opacity: 0, x: initial.x, y: initial.y, scale: 0.98 },
    visible: { opacity: 1, x: 0, y: 0, scale: 1 },
  };
  const transition: Transition = {
    duration,
    delay: baseDelay + delay * staggerInterval,
    ease: [0.25, 0.1, 0.25, 1],
  };

  return (
    <motion.div
      key={`${pathname}-${delay}`}
      className={className}
      style={style}
      variants={variants}
      initial={reduceMotion ? false : "hidden"}
      animate="visible"
      transition={reduceMotion ? { duration: 0 } : transition}
      data-slot="animate-in"
    >
      {children}
    </motion.div>
  );
}
