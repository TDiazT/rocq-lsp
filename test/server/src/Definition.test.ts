import * as Protocol from "vscode-languageserver-protocol";
import * as LanguageServer from "./LanguageServer";
import { openAndWaitForFinalDiagnostics } from "./helpers";

function normalizeUri(uri: string): string {
  return uri.replace(/^.*\/rocq-lsp\//, "<root>/");
}

function normalizeLocation(
  result:
    | Protocol.Location
    | Protocol.Location[]
    | Protocol.LocationLink[]
    | null,
): unknown {
  if (result === null) return null;
  if (Array.isArray(result)) {
    return result.map((item) => {
      if (Protocol.LocationLink.is(item)) {
        return {
          originSelectionRange: item.originSelectionRange,
          targetUri: normalizeUri(item.targetUri),
          targetRange: item.targetRange,
          targetSelectionRange: item.targetSelectionRange,
        };
      }
      return { uri: normalizeUri(item.uri), range: item.range };
    });
  }
  return { uri: normalizeUri(result.uri), range: result.range };
}

async function openFixtureAndWaitReady(
  server: LanguageServer.LanguageServer,
  filename: string,
) {
  const doc = LanguageServer.openFixture(filename);
  await openAndWaitForFinalDiagnostics(server, doc);
  return doc;
}

// fixture layout (0-indexed lines):
//   line 1: Definition answer : nat := 42.
//   line 3: Definition double (n : nat) : nat := n + n.
//   line 5: Definition result : nat := double answer.
//                                      ^27    ^34

test("definition of `answer` usage jumps to its definition site", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = await openFixtureAndWaitReady(server, "definition.v");
    const result = await server.sendRequest(Protocol.DefinitionRequest.type, {
      textDocument: { uri: doc.uri },
      position: { line: 5, character: 34 },
    });
    expect(normalizeLocation(result)).toMatchSnapshot();
  } finally {
    await server.exit();
  }
});

test("definition of `double` usage jumps to its definition site", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = await openFixtureAndWaitReady(server, "definition.v");
    const result = await server.sendRequest(Protocol.DefinitionRequest.type, {
      textDocument: { uri: doc.uri },
      position: { line: 5, character: 27 },
    });
    expect(normalizeLocation(result)).toMatchSnapshot();
  } finally {
    await server.exit();
  }
});

test("definition on whitespace returns null", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = await openFixtureAndWaitReady(server, "definition.v");
    const result = await server.sendRequest(Protocol.DefinitionRequest.type, {
      textDocument: { uri: doc.uri },
      position: { line: 0, character: 0 },
    });
    expect(normalizeLocation(result)).toMatchSnapshot();
  } finally {
    await server.exit();
  }
});
