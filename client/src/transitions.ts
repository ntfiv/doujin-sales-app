import { flushSync } from "react-dom";

/**
 * Same-document view transitions (modern-web-guidance: transitions).
 * Runs a state update inside document.startViewTransition so tab
 * switches and detail open/close cross-fade instead of cutting.
 * Falls back to a plain update when the API is unavailable or the
 * user prefers reduced motion. Kept deliberately subtle — the theme
 * caps the root cross-fade at 0.18s.
 */
export function withViewTransition(update: () => void): void {
  const doc = document as Document & {
    startViewTransition?: (callback: () => void) => unknown;
  };
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (typeof doc.startViewTransition === "function" && !reduced) {
    doc.startViewTransition(() => {
      flushSync(update);
    });
  } else {
    update();
  }
}
