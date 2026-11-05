import { useRef } from "react";

/** `value`, or while `waiting` for the next one the last it had. */
export function useHeld<T>(value: T | null, waiting: boolean) {
  const last = useRef(value);
  if (value) last.current = value;
  return value ?? (waiting ? last.current : null);
}
