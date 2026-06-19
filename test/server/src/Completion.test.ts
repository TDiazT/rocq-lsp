import * as Protocol from "vscode-languageserver-protocol";
import * as LanguageServer from "./LanguageServer";
import { openAndWaitForFinalDiagnostics } from "./helpers";

// Completion responses can contain hundreds of stdlib items. We capture
// structure (isIncomplete flag, total count, shape of the first item) rather
// than the full list, so the snapshot is not brittle to stdlib changes.
function normalizeCompletion(
  result:
    | Protocol.CompletionItem[]
    | Protocol.CompletionList
    | null,
): unknown {
  if (result === null) return null;
  const items = Array.isArray(result) ? result : result.items;
  const isIncomplete = Array.isArray(result) ? false : result.isIncomplete;
  const first = items[0];
  return {
    isIncomplete,
    itemCount: items.length,
    firstItem: first
      ? {
          label: first.label,
          ...(first.kind !== undefined ? { kind: first.kind } : {}),
          ...(first.detail !== undefined ? { detail: first.detail } : {}),
        }
      : null,
  };
}

async function openFixtureAndWaitReady(
  server: LanguageServer.LanguageServer,
  filename: string,
) {
  const doc = LanguageServer.openFixture(filename);
  await openAndWaitForFinalDiagnostics(server, doc);
  return doc;
}

test("completion at an identifier position returns a non-empty list", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = await openFixtureAndWaitReady(server, "completion.v");
    // end of line 3: `Definition use := first_value.`
    //                                              ^30
    const result = await server.sendRequest(
      Protocol.CompletionRequest.type,
      {
        textDocument: { uri: doc.uri },
        position: { line: 3, character: 30 },
      },
    );
    expect(normalizeCompletion(result)).toMatchSnapshot();
  } finally {
    await server.exit();
  }
});

test("completion in a comment returns the same local candidates", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = await openFixtureAndWaitReady(server, "completion.v");
    // inside the comment on line 0
    const result = await server.sendRequest(
      Protocol.CompletionRequest.type,
      {
        textDocument: { uri: doc.uri },
        position: { line: 0, character: 5 },
      },
    );
    expect(normalizeCompletion(result)).toMatchSnapshot();
  } finally {
    await server.exit();
  }
});
