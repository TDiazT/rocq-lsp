import * as LanguageServer from "./LanguageServer";

// proof/interpret is a rocq-lsp extension method (manual navigation).
const InterpretMethod = "proof/interpret";

// URIs embed the absolute repo path; normalize for stable snapshots.
export function normalize(result: unknown): unknown {
  if (result === null || typeof result !== "object") return result;
  const r = result as Record<string, unknown>;
  const out: Record<string, unknown> = { ...r };
  if (out.textDocument && typeof out.textDocument === "object") {
    const td = out.textDocument as Record<string, unknown>;
    out.textDocument = {
      ...td,
      uri:
        typeof td.uri === "string"
          ? td.uri.replace(/^.*\/rocq-lsp\//, "<root>/")
          : td.uri,
    };
  }
  return out;
}

export async function requestInterpret(
  server: LanguageServer.LanguageServer,
  uri: string,
  mode: "forward" | "backward" | "point" | "end",
  position?: { line: number; character: number },
): Promise<unknown> {
  return server.sendRequest(InterpretMethod, {
    textDocument: { uri },
    mode,
    ...(position ? { position } : {}),
    pp_format: "Str",
  });
}
