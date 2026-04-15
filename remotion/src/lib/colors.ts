export const BRAND_GOLD = "#D4920F";
export const BRAND_GOLD_BRIGHT = "#F5A623";
export const CAPTION_RED = "#FF3333";
export const CAPTION_WHITE = "#FFFFFF";

// Regex patterns for word coloring
export const GOLD_RE = /^\d[\d,.]*$|^(record|mvp|championship|all-star|hall)$/i;
export const RED_RE =
  /^(never|nobody|worst|banned|fired|died|forgotten|zero|nothing|none)$/i;

export function getWordColor(word: string): string {
  const clean = word.replace(/[.,!?;:'"()\-—]/g, "");
  if (GOLD_RE.test(clean)) return BRAND_GOLD_BRIGHT;
  if (RED_RE.test(clean)) return CAPTION_RED;
  return CAPTION_WHITE;
}
