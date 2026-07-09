import { describe, it, expect } from "vitest";
import { normalizePp } from "./ppNormalize";

describe("normalizePp", () => {
  it("renames Pp_* constructors to Ppcmd_*", () => {
    expect(
      normalizePp(["Pp_glue", [["Pp_string", "nat"], ["Pp_print_break", 1, 2]]])
    ).toEqual([
      "Ppcmd_glue",
      [["Ppcmd_string", "nat"], ["Ppcmd_print_break", 1, 2]],
    ]);
  });

  it("keeps block_type verbatim inside boxes", () => {
    expect(
      normalizePp(["Pp_box", ["Pp_hvbox", 2], ["Pp_string", "x"]])
    ).toEqual(["Ppcmd_box", ["Pp_hvbox", 2], ["Ppcmd_string", "x"]]);
  });

  it("collapses Pp_sized_string to its string payload", () => {
    expect(normalizePp(["Pp_sized_string", 3, "nat"])).toEqual([
      "Ppcmd_string",
      "nat",
    ]);
  });

  it("wraps a plain string (pp_format: Str fallback)", () => {
    expect(normalizePp("Proof finished")).toEqual([
      "Ppcmd_string",
      "Proof finished",
    ]);
  });

  it("keeps ordinary tags, drops Rocq's start./end. marker tags", () => {
    expect(
      normalizePp(["Pp_tag", "constr.variable", ["Pp_string", "x"]])
    ).toEqual(["Ppcmd_tag", "constr.variable", ["Ppcmd_string", "x"]]);
    expect(
      normalizePp(["Pp_tag", "start.constr.notation", ["Pp_string", "+"]])
    ).toEqual(["Ppcmd_string", "+"]);
  });

  it("degrades unknown constructors to text instead of crashing", () => {
    expect(normalizePp(["Pp_future_thing", 42] as any)).toEqual([
      "Ppcmd_string",
      '["Pp_future_thing",42]',
    ]);
  });

  it("handles empty, newline and comment", () => {
    expect(normalizePp(["Pp_empty"])).toEqual(["Ppcmd_empty"]);
    expect(normalizePp(["Pp_force_newline"])).toEqual(["Ppcmd_force_newline"]);
    expect(normalizePp(["Pp_comment", ["c"]])).toEqual(["Ppcmd_comment", ["c"]]);
  });
});
