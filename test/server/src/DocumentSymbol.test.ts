import * as Protocol from "vscode-languageserver-protocol";
import * as LanguageServer from "./LanguageServer";
import { openAndWaitForFinalDiagnostics } from "./helpers";

function normalizeSymbol(
  sym: Protocol.DocumentSymbol | Protocol.SymbolInformation,
): unknown {
  if (Protocol.DocumentSymbol.is(sym)) {
    return {
      name: sym.name,
      kind: sym.kind,
      range: sym.range,
      selectionRange: sym.selectionRange,
      ...(sym.children?.length
        ? { children: sym.children.map(normalizeSymbol) }
        : {}),
    };
  }
  return {
    name: sym.name,
    kind: sym.kind,
    location: sym.location,
  };
}

function normalizeSymbols(
  result:
    | Protocol.DocumentSymbol[]
    | Protocol.SymbolInformation[]
    | null,
): unknown {
  if (result === null) return null;
  return result.map(normalizeSymbol);
}

async function openFixtureAndWaitReady(
  server: LanguageServer.LanguageServer,
  filename: string,
) {
  const doc = LanguageServer.openFixture(filename);
  await openAndWaitForFinalDiagnostics(server, doc);
  return doc;
}

test("documentSymbol lists all top-level definitions and lemmas", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = await openFixtureAndWaitReady(server, "document_symbol.v");
    const result = await server.sendRequest(
      Protocol.DocumentSymbolRequest.type,
      { textDocument: { uri: doc.uri } },
    );
    expect(normalizeSymbols(result)).toMatchSnapshot();
  } finally {
    await server.exit();
  }
});
