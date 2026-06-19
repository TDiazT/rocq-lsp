import * as LanguageServer from "./LanguageServer";
import { openAndWaitForFinalDiagnostics } from "./helpers";

// proof/goals is a rocq-lsp extension method, not in vscode-languageserver-protocol.
const ProofGoalsMethod = "proof/goals";

function normalizeGoalsResponse(result: unknown): unknown {
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

async function requestGoals(
  server: LanguageServer.LanguageServer,
  uri: string,
  line: number,
  character: number,
): Promise<unknown> {
  return server.sendRequest(ProofGoalsMethod, {
    textDocument: { uri },
    position: { line, character },
    pp_format: "Str",
  });
}

async function openFixtureAndWaitReady(
  server: LanguageServer.LanguageServer,
  filename: string,
) {
  const doc = LanguageServer.openFixture(filename);
  await openAndWaitForFinalDiagnostics(server, doc);
  return doc;
}

// fixture layout (0-indexed):
//   line 2: Proof.
//   line 3:   induction n.          ← one goal: base + step
//   line 4:   - reflexivity.        ← after first bullet: step subgoal
//   line 5:   - simpl. rewrite ...  ← inside second bullet

test("proof/goals inside a proof returns the current goal state", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = await openFixtureAndWaitReady(server, "proof_goals.v");
    // After `induction n.` — two subgoals should be open
    const result = await requestGoals(server, doc.uri, 3, 14);
    expect(normalizeGoalsResponse(result)).toMatchSnapshot();
  } finally {
    await server.exit();
  }
});

test("proof/goals at Qed returns no goals", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = await openFixtureAndWaitReady(server, "proof_goals.v");
    // After `Qed.` — proof is complete, no goals
    const result = await requestGoals(server, doc.uri, 6, 4);
    expect(normalizeGoalsResponse(result)).toMatchSnapshot();
  } finally {
    await server.exit();
  }
});

test("proof/goals outside a proof returns no goals", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const doc = await openFixtureAndWaitReady(server, "proof_goals.v");
    // Line 0 is a comment, outside any proof
    const result = await requestGoals(server, doc.uri, 0, 0);
    expect(normalizeGoalsResponse(result)).toMatchSnapshot();
  } finally {
    await server.exit();
  }
});
