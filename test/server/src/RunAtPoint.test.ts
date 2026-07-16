import * as LanguageServer from "./LanguageServer";
import { openAndWaitForFinalDiagnostics } from "./helpers";
import { normalize, requestRunAtPoint } from "./runAtPointHelpers";

async function openFixtureAndWaitReady(
  server: LanguageServer.LanguageServer,
  filename: string,
) {
  const doc = LanguageServer.openFixture(filename);
  await openAndWaitForFinalDiagnostics(server, doc);
  return doc;
}

// End of `Definition answer : nat := 42.` (line 1, 0-indexed): the only
// elaborated point in the fixture.
const endOfDoc = { line: 1, character: 31 };

test("run_at_point executes About and returns its feedback", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = await openFixtureAndWaitReady(server, "query.v");
    const result = await requestRunAtPoint(
      server,
      doc.uri,
      endOfDoc,
      "About answer.",
    );
    expect(result.feedback).toHaveLength(1);
    expect(result.feedback[0][1]).toMatch(/answer/);
    expect(normalize(result)).toMatchSnapshot();
  } finally {
    await server.exit();
  }
});

// Rocq handles "not found" inside About itself: the request still succeeds,
// carrying the "not a defined object" text as ordinary feedback rather than
// rejecting. Unlike No_node_at_point (-32007), which IS a request-level
// error, the query panel must treat this as a message to display, not an
// exception to catch.
test("run_at_point on an unknown identifier succeeds with a not-found message", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = await openFixtureAndWaitReady(server, "query.v");
    const result = await requestRunAtPoint(
      server,
      doc.uri,
      endOfDoc,
      "About nonexistent_ident.",
    );
    expect(result.feedback).toHaveLength(1);
    expect(result.feedback[0][1]).toMatch(/not a defined object/);
  } finally {
    await server.exit();
  }
});

test("run_at_point before any elaborated node rejects with No_node_at_point", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = await openFixtureAndWaitReady(server, "query.v");
    await expect(
      requestRunAtPoint(
        server,
        doc.uri,
        { line: 0, character: 0 },
        "About answer.",
      ),
    ).rejects.toMatchObject({ code: -32007 });
  } finally {
    await server.exit();
  }
});
