import * as LanguageServer from "./LanguageServer";

// petanque/run_at_point is a Petanque RPC (not Fleche-specific): runs an
// arbitrary Vernacular command string at a document point and returns its
// feedback. Backs the query panel's About/Check/Locate/Print/Search.
const RunAtPointMethod = "petanque/run_at_point";

export interface RunAtPointResult {
  st: null;
  hash: number | null;
  proof_finished: boolean;
  feedback: [number, string][];
}

// Coq's feedback text embeds the fixture's absolute filesystem path (e.g. in
// "Declared in File ..."); normalize it for stable snapshots across machines.
export function normalize(result: RunAtPointResult): RunAtPointResult {
  return {
    ...result,
    feedback: result.feedback.map(([level, msg]) => [
      level,
      msg.replace(/\/[^\s"]+\/rocq-lsp\//g, "<root>/"),
    ]),
  };
}

export async function requestRunAtPoint(
  server: LanguageServer.LanguageServer,
  uri: string,
  position: { line: number; character: number },
  command: string,
): Promise<RunAtPointResult> {
  return server.sendRequest(RunAtPointMethod, {
    textDocument: { uri, version: 0 },
    position,
    command,
  });
}
