import type { Position } from "vscode-languageserver-types";

// Closed whitelist of query keywords (see ADR-0005 point 5, ADR-0006 point 3).
// Search is out of scope (see ADR-0006 point 1): it is async/streaming in
// VsRocq, not a fit for this request/response shape.
export type QueryKeyword = "About" | "Check" | "Locate" | "Print";

// Wraps a user-typed term into a fixed "<Keyword> <term>." Vernacular command
// sent via petanque/run_at_point. The keyword is never user-chosen freely
// (closed whitelist above): only the term is free text.
export function buildQueryCommand(
  keyword: QueryKeyword,
  term: string,
): string | null {
  const trimmed = term.trim();
  if (trimmed === "") return null;
  const withPeriod = trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
  return `${keyword} ${withPeriod}`;
}

// petanque/agent.ml's Error.to_string prefixes a Coq user error (wire code
// -32003) with "Coq: " before it reaches the client. Check/Print hit this on
// an undefined identifier (elaborating/resolving the reference is what
// fails); About/Locate never do (name-table lookups that report "not found"
// as ordinary feedback instead, verified empirically in
// test/server/src/RunAtPoint.test.ts, not assumed uniform across keywords).
// ADR-0006 point 4 / addendum: render -32003 through the same result channel
// as ordinary feedback regardless of keyword, so strip the internal prefix.
export function stripCoqErrorPrefix(message: string): string {
  const prefix = "Coq: ";
  return message.startsWith(prefix) ? message.slice(prefix.length) : message;
}

// Where a query should run. Never the raw cursor: Flèche may not have
// elaborated that far yet (see ADR-0005).
//
// checkingIsEager short-circuits everything else (ADR-0004's "Resolution"):
// under an eager checking schedule the whole file is always fully
// elaborated, so a query always runs at document-end, ignoring the
// checkpoint entirely — otherwise a checkpoint early in the file would
// starve a query for a term defined later on, even though the server
// already knows about it. This is a deliberate improvement over
// rocq.nvim's `Session:_query_position` (`lua/rocq/core/session.lua:143`),
// which always prefers the checkpoint once one is set.
//
// Under a lazy schedule the pre-existing logic applies: the checkpoint wins
// when set (only what's been stepped through is guaranteed elaborated); with
// no checkpoint, manual mode resolves to before the first sentence (nothing
// confirmed yet — resolving to document-end here previously surfaced stale,
// pre-manual-mode elaboration, a bug found in QA, 2026-07-16), while
// non-manual navigation (no checkpoint concept) falls back to document-end.
export function resolveQueryPosition(
  checkingIsEager: boolean,
  manualModeOn: boolean,
  checkpoint: Position | undefined,
  documentEnd: Position,
): Position {
  if (checkingIsEager) return documentEnd;
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
