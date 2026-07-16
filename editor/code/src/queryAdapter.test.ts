import { describe, expect, test } from "vitest";
import {
  buildAboutCommand,
  parseRunAtPointFeedback,
  resolveQueryPosition,
} from "./queryAdapter";

describe("buildAboutCommand", () => {
  test("wraps a bare term as an About command", () => {
    expect(buildAboutCommand("nat")).toBe("About nat.");
  });

  test("trims surrounding whitespace", () => {
    expect(buildAboutCommand("  nat  ")).toBe("About nat.");
  });

  test("does not duplicate a trailing period the user already typed", () => {
    expect(buildAboutCommand("nat.")).toBe("About nat.");
  });

  test("returns null for an empty or whitespace-only term", () => {
    expect(buildAboutCommand("")).toBeNull();
    expect(buildAboutCommand("   ")).toBeNull();
  });
});

describe("resolveQueryPosition", () => {
  const documentEnd = { line: 10, character: 0 };

  test("uses the navigation checkpoint when one exists", () => {
    const checkpoint = { line: 3, character: 6 };
    expect(resolveQueryPosition(false, checkpoint, documentEnd)).toEqual(
      checkpoint,
    );
    expect(resolveQueryPosition(true, checkpoint, documentEnd)).toEqual(
      checkpoint,
    );
  });

  test("falls back to the end of the document when checking is not manual", () => {
    expect(resolveQueryPosition(false, undefined, documentEnd)).toEqual(
      documentEnd,
    );
  });

  // Regression: before this fix, About in manual mode with no checkpoint yet
  // fell back to documentEnd, which — if the file had been fully checked
  // *before* switching to manual mode — silently answered from that stale,
  // pre-manual-mode elaboration instead of refusing. Manual mode with no
  // checkpoint means "nothing confirmed yet," so it must resolve to before
  // the first sentence (which the server correctly rejects with
  // No_node_at_point), never to the document's end.
  test("resolves to before the first sentence in manual mode with no checkpoint yet", () => {
    expect(resolveQueryPosition(true, undefined, documentEnd)).toEqual({
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
