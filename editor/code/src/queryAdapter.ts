import type { Position } from "vscode-languageserver-types";

// Wraps a user-typed term into the fixed "About <term>." Vernacular command
// sent via petanque/run_at_point. The keyword is never user-chosen (closed
// whitelist, see ADR-0005): only the term is free text.
export function buildAboutCommand(term: string): string | null {
  const trimmed = term.trim();
  if (trimmed === "") return null;
  const withPeriod = trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
  return `About ${withPeriod}`;
}

// Where a query should run. Never the raw cursor: Flèche may not have
// elaborated that far yet (see ADR-0005). The checkpoint always wins when
// set. Otherwise: in manual mode, "no checkpoint" means nothing has been
// confirmed yet, so this resolves to before the first sentence, NOT the
// document end, which may hold stale elaboration from before manual mode
// was switched on (a full-check-then-switch-to-manual bug found in QA,
// 2026-07-16). Outside manual mode there's no checkpoint concept, so the
// document end (the whole file having been checked) is the right fallback.
export function resolveQueryPosition(
  manualModeOn: boolean,
  checkpoint: Position | undefined,
  documentEnd: Position,
): Position {
  if (checkpoint) return checkpoint;
  return manualModeOn ? { line: 0, character: 0 } : documentEnd;
}

// Shape of petanque/run_at_point's successful result (see
// test/server/src/runAtPointHelpers.ts for the server-side mirror of this).
export interface RunAtPointResult {
  st: null;
  hash: number | null;
  proof_finished: boolean;
  feedback: [number, string][];
}

// Request-level failures (e.g. No_node_at_point) arrive as a JSON-RPC
// rejection, not inside this result; callers handle those separately.
// A "not found" About, by contrast, is a *successful* result whose feedback
// carries the "not a defined object" text (verified in
// test/server/src/RunAtPoint.test.ts), so it renders as an ordinary message.
export function parseRunAtPointFeedback(result: RunAtPointResult): string[] {
  return result.feedback.map(([, message]) => message);
}
