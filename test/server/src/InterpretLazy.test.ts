import * as Protocol from "vscode-languageserver-protocol";
import * as LanguageServer from "./LanguageServer";
import { requestInterpret } from "./interpretHelpers";

// Under check_only_on_request the server elaborates nothing until a request
// demands it: the interpret response arriving at all proves request-driven
// (bounded) checking works.
async function startLazy() {
  const server = LanguageServer.start();
  await server.initialize({
    trace: "verbose",
    initializationOptions: { check_only_on_request: true },
  });
  return server;
}

async function openNoWait(server: LanguageServer.LanguageServer, filename: string) {
  const doc = LanguageServer.openFixture(filename);
  await server.sendNotification(
    Protocol.DidOpenTextDocumentNotification.type,
    { textDocument: doc },
  );
  return doc;
}

test("lazy: interpret forward drives checking of exactly the needed prefix", async () => {
  const server = await startLazy();
  try {
    const doc = await openNoWait(server, "interpret.v");
    // No diagnostics wait: the request itself must trigger checking up to
    // (and only through) `induction n.`.
    const result = (await requestInterpret(server, doc.uri, "forward", {
      line: 2,
      character: 6,
    })) as Record<string, unknown>;
    const range = result.range as { start: { line: number } };
    expect(range.start.line).toBe(3);
    expect(result.completed).toBe(false);
  } finally {
    await server.exit();
  }
});

test("lazy: interpret end checks the whole document", async () => {
  const server = await startLazy();
  try {
    const doc = await openNoWait(server, "interpret.v");
    const result = (await requestInterpret(server, doc.uri, "end")) as Record<
      string,
      unknown
    >;
    const range = result.range as { start: { line: number } };
    expect(range.start.line).toBe(12); // Abort.
    expect(result.completed).toBe(true);
  } finally {
    await server.exit();
  }
});
