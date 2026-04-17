export const BRAND_GOLD = "#D4920F";
export const BRAND_GOLD_BRIGHT = "#F5A623";
export const CAPTION_RED = "#FF3333";
export const CAPTION_WHITE = "#FFFFFF";

// Regex patterns for word coloring
// GOLD: stats, records, accolades, superlatives (reverent, awe-inspiring)
// RED: drama, shock, negatives (weight, consequence)
// Tuned for documentary tone — roughly 7-10% of words should hit.
export const GOLD_RE =
  /^\d[\d,.]*$|^(record|mvp|championship|all-star|hall|rookie|finals|playoffs|draft|legend|legendary|goat|greatest|historic|elite|untouchable|unbreakable|dominant|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)$/i;
export const RED_RE =
  /^(never|nobody|worst|banned|fired|died|forgotten|zero|nothing|none|impossible|insane|gone|crushed|broken)$/i;

export function getWordColor(word: string): string {
  const clean = word.replace(/[.,!?;:'"()\-—]/g, "");
  if (GOLD_RE.test(clean)) return BRAND_GOLD_BRIGHT;
  if (RED_RE.test(clean)) return CAPTION_RED;
  return CAPTION_WHITE;
}
