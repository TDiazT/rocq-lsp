import * as Protocol from "vscode-languageserver-protocol";
import * as LanguageServer from "./LanguageServer";
import { openAndWaitForFinalDiagnostics } from "./helpers";

// Strip the absolute project path from URIs so snapshots are portable.
function normalizeUri(uri: string): string {
  return uri.replace(/^.*\/rocq-lsp\//, "<root>/");
}

function normalizeHover(hover: Protocol.Hover | null): object | null {
  if (hover === null) return null;
  return {
    contents: hover.contents,
    ...(hover.range !== undefined ? { range: hover.range } : {}),
  };
}

async function openFixtureAndWaitReady(
  server: LanguageServer.LanguageServer,
  filename: string,
) {
  const doc = LanguageServer.openFixture(filename);
  // Wait for diagnostics to settle before sending hover requests —
  // the server only responds to hover after the document is checked.
  await openAndWaitForFinalDiagnostics(server, doc);
  return doc;
}

test("hover on a simple definition returns its type", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = await openFixtureAndWaitReady(server, "hover.v");
    const result = await server.sendRequest(Protocol.HoverRequest.type, {
      textDocument: { uri: doc.uri },
      // "answer" identifier, line 1 char 11
      position: { line: 1, character: 11 },
    });
    expect(normalizeHover(result)).toMatchSnapshot();
  } finally {
    await server.exit();
  }
});

test("hover on a function definition shows type signature and full path", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = await openFixtureAndWaitReady(server, "hover.v");
    const result = await server.sendRequest(Protocol.HoverRequest.type, {
      textDocument: { uri: doc.uri },
      // "id_nat" identifier, line 4 char 11
      position: { line: 4, character: 11 },
    });
    expect(normalizeHover(result)).toMatchSnapshot();
  } finally {
    await server.exit();
  }
});

test("hover on whitespace returns null", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = await openFixtureAndWaitReady(server, "hover.v");
    const result = await server.sendRequest(Protocol.HoverRequest.type, {
      textDocument: { uri: doc.uri },
      // blank comment line 0, char 0
      position: { line: 0, character: 0 },
    });
    expect(normalizeHover(result)).toMatchSnapshot();
  } finally {
    await server.exit();
  }
});
