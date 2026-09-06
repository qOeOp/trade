"use client";

import { motion } from "framer-motion";
import { buttonHover, transition } from "../animations";
import styles from "../../schedule-calendar.module.css";

export function TodayButton({ onToday }: { onToday: () => void }) {
  const today = new Date();
  return <motion.button
    type="button"
    className={styles.todayCard}
    aria-label="Go to today"
    onClick={onToday}
    variants={buttonHover}
    whileHover="hover"
    whileTap="tap"
    transition={transition}
  >
    <motion.span
      initial={{ y: -10, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.1, ...transition }}
    >
      {today.toLocaleDateString("en", { month: "short", timeZone: "UTC" }).toUpperCase()}
    </motion.span>
    <motion.strong
      initial={{ y: 10, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.2, ...transition }}
    >
      {today.getUTCDate()}
    </motion.strong>
  </motion.button>;
}
