/* ==========================================================================
   CATAT — history.js
   A small, DOM-agnostic undo/redo stack. The editor feeds it a getState()/
   applyState() pair and calls record() after each committed change.

   Granularity: every distinct edit becomes its own step (so typing "1" "2"
   "3" with no spaces and tapping "back" twice really does peel off "3" then
   "2", exactly like backspacing — no waiting for a pause, no word-grouping).
   The only coalescing is a tiny anti-flood window for same-millisecond
   programmatic bursts (IME composition, autocomplete). Deletions, pastes and
   toolbar actions always start a fresh step so a single undo restores
   exactly what was removed/changed.
   ========================================================================== */

export function createHistory({ getState, applyState, limit = 300, floodWindowMs = 60 }) {
  let past = [];
  let future = [];
  let baseline = null;
  let lastAt = 0;
  let suppressed = false;

  function statesEqual(a, b) { return !!a && !!b && a.title === b.title && a.html === b.html; }

  function init() {
    baseline = getState();
    past = []; future = []; lastAt = 0;
  }

  /** Call after every committed edit.
   *  @param {boolean} forceBreak - true for deletes/paste/format/structural
   *  changes so they never merge with an adjacent step. */
  function record(forceBreak = false) {
    if (suppressed) return;
    const now = Date.now();
    const current = getState();
    if (!baseline) { baseline = current; lastAt = now; return; }
    if (statesEqual(baseline, current)) return;

    // Same-tick programmatic burst (IME composition, autocomplete) — extend
    // the current step instead of creating a new one. Real keystrokes, even
    // fast ones, are essentially never <60ms apart, so normal typing always
    // gets its own step.
    if (!forceBreak && (now - lastAt) < floodWindowMs) {
      baseline = current;
      lastAt = now;
      return;
    }

    past.push(baseline);
    if (past.length > limit) past.shift();
    future = [];
    baseline = current;
    lastAt = now;
  }

  function canUndo() { return past.length > 0; }
  function canRedo() { return future.length > 0; }

  function undo() {
    if (!past.length) return null;
    future.push(getState());
    const prev = past.pop();
    suppressed = true;
    applyState(prev);
    suppressed = false;
    baseline = prev;
    lastAt = 0;
    return prev;
  }

  function redo() {
    if (!future.length) return null;
    past.push(getState());
    const next = future.pop();
    suppressed = true;
    applyState(next);
    suppressed = false;
    baseline = next;
    lastAt = 0;
    return next;
  }

  init();
  return { record, undo, redo, canUndo, canRedo, reset: init };
}
