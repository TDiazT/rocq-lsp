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

test("run_at_point executes Check and returns its feedback", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = await openFixtureAndWaitReady(server, "query.v");
    const result = await requestRunAtPoint(
      server,
      doc.uri,
      endOfDoc,
      "Check answer.",
    );
    expect(result.feedback).toHaveLength(1);
    expect(result.feedback[0][1]).toMatch(/answer/);
    expect(normalize(result)).toMatchSnapshot();
  } finally {
    await server.exit();
  }
});

// Unlike About, Check on an undefined identifier is a hard Coq user error
// (petanque/agent.ml's protect_to_result turns it into an RPC rejection, not
// successful feedback): a real, structural difference from About's "not a
// defined object." message, not a bug. See ADR-0006 point 4. The wire
// message carries an internal "Coq: " prefix (petanque/agent.ml's
// Error.to_string) that the query panel strips before display.
test("run_at_point Check on an unknown identifier rejects with a Coq error", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = await openFixtureAndWaitReady(server, "query.v");
    await expect(
      requestRunAtPoint(
        server,
        doc.uri,
        endOfDoc,
        "Check nonexistent_ident.",
      ),
    ).rejects.toMatchObject({
      code: -32003,
      message: expect.stringMatching(/^Coq: /),
    });
  } finally {
    await server.exit();
  }
});

test("run_at_point executes Locate and returns its feedback", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = await openFixtureAndWaitReady(server, "query.v");
    const result = await requestRunAtPoint(
      server,
      doc.uri,
      endOfDoc,
      "Locate answer.",
    );
    expect(result.feedback).toHaveLength(1);
    expect(result.feedback[0][1]).toMatch(/answer/);
    expect(normalize(result)).toMatchSnapshot();
  } finally {
    await server.exit();
  }
});

// Unlike Check/Print, Locate on an undefined identifier behaves like About:
// the request succeeds, carrying "No object of basename ..." as ordinary
// feedback rather than rejecting. Verified empirically, not assumed from
// Check's -32003 behavior: Locate's job is name-table lookup (closer to
// About's synterp-level nature), Check/Print's is elaborating the term,
// which is what actually fails hard. See ADR-0006 addendum.
test("run_at_point Locate on an unknown identifier succeeds with a not-found message", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = await openFixtureAndWaitReady(server, "query.v");
    const result = await requestRunAtPoint(
      server,
      doc.uri,
      endOfDoc,
      "Locate nonexistent_ident.",
    );
    expect(result.feedback).toHaveLength(1);
    expect(result.feedback[0][1]).toMatch(/No object of basename/);
  } finally {
    await server.exit();
  }
});

test("run_at_point executes Print and returns its feedback", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = await openFixtureAndWaitReady(server, "query.v");
    const result = await requestRunAtPoint(
      server,
      doc.uri,
      endOfDoc,
      "Print answer.",
    );
    expect(result.feedback).toHaveLength(1);
    expect(result.feedback[0][1]).toMatch(/answer/);
    expect(normalize(result)).toMatchSnapshot();
  } finally {
    await server.exit();
  }
});

// Print on an undefined identifier behaves like Check (-32003, not a
// successful message): both need to elaborate/resolve the reference, unlike
// About/Locate's name-table-only lookups. See ADR-0006 addendum.
test("run_at_point Print on an unknown identifier rejects with a Coq error", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = await openFixtureAndWaitReady(server, "query.v");
    await expect(
      requestRunAtPoint(
        server,
        doc.uri,
        endOfDoc,
        "Print nonexistent_ident.",
      ),
    ).rejects.toMatchObject({
      code: -32003,
      message: expect.stringMatching(/^Coq: /),
    });
  } finally {
    await server.exit();
  }
});
