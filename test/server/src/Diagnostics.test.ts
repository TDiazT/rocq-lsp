import * as Protocol from "vscode-languageserver-protocol";
import * as LanguageServer from "./LanguageServer";
import { openAndWaitForFinalDiagnostics } from "./helpers";

// Strip the absolute project path from URIs so snapshots are portable.
function normalizeUri(uri: string): string {
  return uri.replace(/^.*\/rocq-lsp\//, "<root>/");
}

function normalizeDiagnostics(
  params: Protocol.PublishDiagnosticsParams,
): object {
  return {
    uri: normalizeUri(params.uri),
    diagnostics: params.diagnostics.map((d) => ({
      range: d.range,
      severity: d.severity,
      message: d.message,
      ...(d.source !== undefined ? { source: d.source } : {}),
    })),
  };
}

test("publishDiagnostics: valid file produces no diagnostics", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = LanguageServer.openFixture("diagnostics_clean.v");
    const params = await openAndWaitForFinalDiagnostics(server, doc);
    expect(normalizeDiagnostics(params)).toMatchSnapshot();
  } finally {
    await server.exit();
  }
});

test("publishDiagnostics: type error produces error diagnostic", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = LanguageServer.openFixture("diagnostics_error.v");
    const params = await openAndWaitForFinalDiagnostics(server, doc);
    expect(normalizeDiagnostics(params)).toMatchSnapshot();
  } finally {
    await server.exit();
  }
});
