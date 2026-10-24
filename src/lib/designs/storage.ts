import { MAX_DESIGNS, parseStoredDesigns, type SavedDesign } from "./model";

/**
 * Saved designs live in this browser's localStorage: free, no account, but only on this device
 * and lost if the browser's site data is cleared. Share links are the way to move a design.
 */
const KEY = "tks.designs.v1";

export function loadDesigns(): { designs: SavedDesign[]; error?: string } {
  try {
    const text = window.localStorage.getItem(KEY);
    if (!text) return { designs: [] };
    const { designs, skipped } = parseStoredDesigns(JSON.parse(text));
    return { designs, error: skipped ? `${skipped} saved design(s) were damaged and could not be opened.` : undefined };
  } catch {
    return { designs: [], error: "Saved designs could not be read in this browser (storage may be blocked, e.g. in a private window)." };
  }
}

/** Returns an error message when the write did not happen, so the UI never claims a save that failed. */
export function storeDesigns(designs: SavedDesign[]): string | null {
  if (designs.length > MAX_DESIGNS) return `You can keep up to ${MAX_DESIGNS} designs in this browser. Delete some first.`;
  try {
    const text = JSON.stringify(designs);
    window.localStorage.setItem(KEY, text);
    return window.localStorage.getItem(KEY) === text ? null : "The design could not be saved in this browser.";
  } catch {
    return "The design could not be saved in this browser (storage is full or blocked).";
  }
}
