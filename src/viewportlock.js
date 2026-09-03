/**
 * NFR-10: the app is a fixed-scale surface.
 *
 * Three things zoom a PWA on a phone and each needs its own answer:
 *
 *  1. Focus zoom, which is the jarring one, because it fires on an ordinary
 *     tap into a text field and the page stays zoomed after the keyboard
 *     goes. Fixed in CSS by keeping every control at 16px or above.
 *  2. Double-tap zoom, fixed by `touch-action: manipulation` in index.html.
 *  3. Pinch. `user-scalable=no` in the viewport meta covers Android and
 *     desktop, but WebKit has ignored it for pinch since iOS 10, which is
 *     what this module is for.
 *
 * The WebKit-only `gesture*` events fire for a two-finger pinch and cancel
 * cleanly, so blocking them removes the zoom without touching scroll. The
 * touch handlers are a fallback for the same gesture where those events are
 * absent, and they only ever cancel a multi-touch move, so one-finger
 * panning and scrolling behave exactly as before.
 *
 * Deliberately not blocked: ctrl+wheel and keyboard zoom on desktop, where
 * zoom is not jarring and is the browser's own accessibility control. The
 * system text size still applies on mobile (text-size-adjust stays at 100%),
 * which is the accessibility route that stands in for pinch (NFR-4).
 */
export function lockViewportScale() {
  if (typeof document === "undefined") return;

  const stop = (e) => {
    if (e.cancelable) e.preventDefault();
  };

  // WebKit pinch. Named individually rather than in a loop so the set is
  // greppable and so gesturestart alone cannot be removed by accident.
  document.addEventListener("gesturestart", stop, { passive: false });
  document.addEventListener("gesturechange", stop, { passive: false });
  document.addEventListener("gestureend", stop, { passive: false });

  // Fallback for the same gesture. Only multi-touch is cancelled.
  document.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches && e.touches.length > 1) stop(e);
    },
    { passive: false }
  );

  // A pinch that has already scaled the page (a gesture begun before this
  // ran, or an accessibility zoom triggered elsewhere) is left alone rather
  // than forced back to 1: fighting a scale the user is holding produces a
  // worse judder than the zoom did.
}
