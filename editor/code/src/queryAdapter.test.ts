import { describe, expect, test } from "vitest";
import {
  buildQueryCommand,
  parseRunAtPointFeedback,
  resolveQueryPosition,
  stripCoqErrorPrefix,
} from "./queryAdapter";

describe("buildQueryCommand", () => {
  test("wraps a bare term as an About command", () => {
    expect(buildQueryCommand("About", "nat")).toBe("About nat.");
  });

  test("wraps a bare term as a Check command", () => {
    expect(buildQueryCommand("Check", "nat")).toBe("Check nat.");
  });

  test("wraps a bare term as a Locate command", () => {
    expect(buildQueryCommand("Locate", "nat")).toBe("Locate nat.");
  });

  test("wraps a bare term as a Print command", () => {
    expect(buildQueryCommand("Print", "nat")).toBe("Print nat.");
  });

  test("trims surrounding whitespace", () => {
    expect(buildQueryCommand("About", "  nat  ")).toBe("About nat.");
  });

  test("does not duplicate a trailing period the user already typed", () => {
    expect(buildQueryCommand("Check", "nat.")).toBe("Check nat.");
  });

  test("returns null for an empty or whitespace-only term", () => {
    expect(buildQueryCommand("About", "")).toBeNull();
    expect(buildQueryCommand("Check", "   ")).toBeNull();
  });
});

describe("stripCoqErrorPrefix", () => {
  test("strips the internal 'Coq: ' prefix", () => {
    expect(
      stripCoqErrorPrefix(
        "Coq: The reference nonexistent_ident was not found in the current environment.",
      ),
    ).toBe(
      "The reference nonexistent_ident was not found in the current environment.",
    );
  });

  test("leaves a message without the prefix untouched", () => {
    expect(stripCoqErrorPrefix("Interrupted")).toBe("Interrupted");
  });
});

describe("resolveQueryPosition", () => {
  const documentEnd = { line: 10, character: 0 };
  const checkpoint = { line: 3, character: 6 };

  // Eager checking short-circuits everything else: the whole file is always
  // elaborated, so a query always runs at document-end, even past a
  // checkpoint set early in the file, and even with no checkpoint at all
  // (ADR-0004's "Resolution"; a deliberate improvement over rocq.nvim's
  // Session:_query_position, which always prefers the checkpoint once set).
  test("under an eager schedule, always resolves to document-end, ignoring the checkpoint", () => {
    expect(resolveQueryPosition(true, true, checkpoint, documentEnd)).toEqual(
      documentEnd,
    );
    expect(
      resolveQueryPosition(true, false, checkpoint, documentEnd),
    ).toEqual(documentEnd);
    expect(
      resolveQueryPosition(true, true, undefined, documentEnd),
    ).toEqual(documentEnd);
  });

  test("under a lazy schedule, uses the navigation checkpoint when one exists", () => {
    expect(
      resolveQueryPosition(false, false, checkpoint, documentEnd),
    ).toEqual(checkpoint);
    expect(
      resolveQueryPosition(false, true, checkpoint, documentEnd),
    ).toEqual(checkpoint);
  });

  test("under a lazy schedule, falls back to the end of the document when checking is not manual", () => {
    expect(
      resolveQueryPosition(false, false, undefined, documentEnd),
    ).toEqual(documentEnd);
  });

  // Regression: before this fix, About in manual mode with no checkpoint yet
  // fell back to documentEnd, which — if the file had been fully checked
  // *before* switching to manual mode — silently answered from that stale,
  // pre-manual-mode elaboration instead of refusing. Manual mode with no
  // checkpoint means "nothing confirmed yet," so under a lazy schedule it
  // must resolve to before the first sentence (which the server correctly
  // rejects with No_node_at_point), never to the document's end.
  test("under a lazy schedule, resolves to before the first sentence in manual mode with no checkpoint yet", () => {
    expect(
      resolveQueryPosition(false, true, undefined, documentEnd),
    ).toEqual({
      line: 0,
      character: 0,
    });
  });
});

describe("parseRunAtPointFeedback", () => {
  test("extracts message text from each feedback entry", () => {
    const result = {
      st: null,
      hash: null,
      proof_finished: true,
      feedback: [[3, "answer : nat"]] as [number, string][],
    };
    expect(parseRunAtPointFeedback(result)).toEqual(["answer : nat"]);
  });

  test("preserves the order of multiple feedback entries", () => {
    const result = {
      st: null,
      hash: null,
      proof_finished: true,
      feedback: [
        [1, "first"],
        [2, "second"],
      ] as [number, string][],
    };
    expect(parseRunAtPointFeedback(result)).toEqual(["first", "second"]);
  });

  test("returns an empty list when there is no feedback", () => {
    const result = {
      st: null,
      hash: null,
      proof_finished: true,
      feedback: [] as [number, string][],
    };
    expect(parseRunAtPointFeedback(result)).toEqual([]);
  });
});
