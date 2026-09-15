export function humanizeReasonCode(code: string): string {
  const words = code.toLowerCase().split("_").filter(Boolean);
  if (!words.length) return "Reason unavailable";
  const sentence = words.join(" ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}`;
}
