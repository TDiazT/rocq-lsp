import * as LanguageServer from "./LanguageServer";
import { openAndWaitForFinalDiagnostics } from "./helpers";
import { normalize, requestInterpret } from "./interpretHelpers";

async function openFixtureAndWaitReady(
  server: LanguageServer.LanguageServer,
  filename: string,
) {
  const doc = LanguageServer.openFixture(filename);
  await openAndWaitForFinalDiagnostics(server, doc);
  return doc;
}

test("interpret forward from a checkpoint returns the next sentence", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = await openFixtureAndWaitReady(server, "interpret.v");
    // Checkpoint at the end of `Proof.` (2,6) → next sentence is
    // `induction n.` on line 3; goals must be its post-state (2 subgoals).
    const result = await requestInterpret(server, doc.uri, "forward", {
      line: 2,
      character: 6,
    });
    expect(normalize(result)).toMatchSnapshot();
  } finally {
    await server.exit();
  }
});

test("interpret backward from a checkpoint returns the previous sentence", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = await openFixtureAndWaitReady(server, "interpret.v");
    // Checkpoint at end of `induction n.` (3,14) → previous sentence is
    // `Proof.` on line 2, whose post-state has the original single goal.
    const result = await requestInterpret(server, doc.uri, "backward", {
      line: 3,
      character: 14,
    });
    expect(normalize(result)).toMatchSnapshot();
  } finally {
    await server.exit();
  }
});

test("interpret backward before the first sentence returns null range", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = await openFixtureAndWaitReady(server, "interpret.v");
    const result = await requestInterpret(server, doc.uri, "backward", {
      line: 0,
      character: 0,
    });
    expect(normalize(result)).toMatchSnapshot();
  } finally {
    await server.exit();
  }
});

test("interpret point inside a sentence interprets through it", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = await openFixtureAndWaitReady(server, "interpret.v");
    // Cursor inside `rewrite IHn.` (5,14) → answer is that sentence's
    // post-state (goal `S n + 0 = S n` rewritten), range on line 5.
    const result = await requestInterpret(server, doc.uri, "point", {
      line: 5,
      character: 14,
    });
    expect(normalize(result)).toMatchSnapshot();
  } finally {
    await server.exit();
  }
});

test("interpret end returns the last sentence with completed: true", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = await openFixtureAndWaitReady(server, "interpret.v");
    const result = await requestInterpret(server, doc.uri, "end");
    expect(normalize(result)).toMatchSnapshot();
  } finally {
    await server.exit();
  }
});

test("interpret forward at the end of the document returns the last sentence", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = await openFixtureAndWaitReady(server, "interpret.v");
    // Checkpoint at end of `Abort.` (12,6): there is no next sentence, so
    // per spec the answer is the last sentence with completed: true and the
    // client detects "no move" by the unchanged range.
    const result = await requestInterpret(server, doc.uri, "forward", {
      line: 12,
      character: 6,
    });
    expect(normalize(result)).toMatchSnapshot();
  } finally {
    await server.exit();
  }
});

test("interpret with an unknown mode answers InvalidParams", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = await openFixtureAndWaitReady(server, "interpret.v");
    await expect(
      requestInterpret(server, doc.uri, "sideways" as never, {
        line: 0,
        character: 0,
      }),
    ).rejects.toMatchObject({ code: -32602 });
  } finally {
    await server.exit();
  }
});

test("interpret chained stepping follows the real client loop", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = await openFixtureAndWaitReady(server, "interpret.v");
    // Simulate the client's checkpoint loop: each step's target is the
    // previous answer's range.end, exactly as a real editor would drive it.
    const r1 = (await requestInterpret(server, doc.uri, "forward", {
      line: 0,
      character: 0,
    })) as Record<string, { line: number; character: number }>;
    expect(r1.range).toBeTruthy();
    const range1 = r1.range as unknown as {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    expect(range1.start.line).toBe(1); // `Lemma add_zero ...`

    const r2 = (await requestInterpret(
      server,
      doc.uri,
      "forward",
      range1.end,
    )) as Record<string, unknown>;
    const range2 = r2.range as unknown as {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    expect(range2.start.line).toBe(2); // `Proof.`

    const r3 = (await requestInterpret(
      server,
      doc.uri,
      "forward",
      range2.end,
    )) as Record<string, unknown>;
    const range3 = r3.range as unknown as {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    expect(range3.start.line).toBe(3); // `induction n.`

    const r4 = (await requestInterpret(
      server,
      doc.uri,
      "backward",
      range3.end,
    )) as Record<string, unknown>;
    const range4 = r4.range as unknown as {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    expect(range4.start.line).toBe(2); // back to `Proof.`
  } finally {
    await server.exit();
  }
});

test("interpret forward onto a failing sentence carries its error (F5)", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = await openFixtureAndWaitReady(server, "interpret.v");
    // Checkpoint at end of `intros n.` (10,11) → next sentence is the
    // failing `reflexivity.` on line 11. The answer must include BOTH the
    // unchanged goal (post-state) and the unification error — the exact
    // combination proof/goals cannot deliver at an end boundary (F5).
    const result = (await requestInterpret(server, doc.uri, "forward", {
      line: 10,
      character: 11,
    })) as Record<string, unknown>;
    expect(result.error).not.toBeNull();
    expect(normalize(result)).toMatchSnapshot();
  } finally {
    await server.exit();
  }
});

test("interpret point beyond EOF clamps to the last sentence", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = await openFixtureAndWaitReady(server, "interpret.v");
    // Position far past the end of the 13-line fixture: per spec, point mode
    // clamps to the last sentence (`Abort.` on line 12) with completed: true.
    const result = await requestInterpret(server, doc.uri, "point", {
      line: 50,
      character: 0,
    });
    expect(normalize(result)).toMatchSnapshot();
  } finally {
    await server.exit();
  }
});
