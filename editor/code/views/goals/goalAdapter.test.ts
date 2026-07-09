import { describe, it, expect } from "vitest";
import { adaptGoalAnswer } from "./goalAdapter";

const td = { uri: "file:///a.v", version: 1 };
const pos = { line: 0, character: 0 };

describe("adaptGoalAnswer", () => {
  it("returns null goals when not in proof mode", () => {
    const out = adaptGoalAnswer({ textDocument: td, position: pos, messages: [] });
    expect(out.goals).toBeNull();
    expect(out.messages).toEqual([]);
  });

  it("adapts a goal: ty + hyps composed as 'names : ty'", () => {
    const out = adaptGoalAnswer({
      textDocument: td,
      position: pos,
      messages: [],
      goals: {
        goals: [
          {
            ty: ["Pp_string", "False"],
            hyps: [
              { names: [["Pp_string", "n"], ["Pp_string", "m"]], ty: ["Pp_string", "nat"] },
              { names: [["Pp_string", "e"]], def: ["Pp_string", "0"], ty: ["Pp_string", "nat"] },
            ],
          },
        ],
        stack: [],
        shelf: [],
        given_up: [],
      },
    } as any);
    const g = out.goals!.main[0];
    expect(g.id).toBe("0");
    expect(g.isOpen).toBe(true);
    expect(g.isContextHidden).toBe(false);
    expect(g.goal).toEqual(["Ppcmd_string", "False"]);
    // n, m : nat — names joined with ", ", then " :" plus a print break
    // (so pp-display can reflow long types), inside an hv box
    expect(JSON.stringify(g.hypotheses[0])).toContain('"n"');
    expect(JSON.stringify(g.hypotheses[0])).toContain('", "');
    expect(JSON.stringify(g.hypotheses[0])).toContain('" :"');
    expect(JSON.stringify(g.hypotheses[0])).toContain('"Ppcmd_print_break"');
    expect(JSON.stringify(g.hypotheses[0])).toContain('"Pp_hvbox"');
    // e := 0 : nat — definition bodies are included
    expect(JSON.stringify(g.hypotheses[1])).toContain('" := "');
  });

  it("maps stack to unfocused, shelf to shelved, given_up to givenUp", () => {
    const mk = (s: string) => ({ ty: ["Pp_string", s], hyps: [] });
    const out = adaptGoalAnswer({
      textDocument: td,
      position: pos,
      messages: [],
      goals: {
        goals: [mk("focused")],
        stack: [[[mk("l1")], [mk("r1")]]],
        shelf: [mk("sh")],
        given_up: [mk("gu")],
      },
    } as any);
    expect(out.goals!.unfocused.map((g) => g.goal)).toEqual([
      ["Ppcmd_string", "l1"],
      ["Ppcmd_string", "r1"],
    ]);
    expect(out.goals!.shelved).toHaveLength(1);
    expect(out.goals!.givenUp).toHaveLength(1);
    // only the first main goal shows its context by default
    expect(out.goals!.unfocused[0].isOpen).toBe(false);
  });

  it("handles def: null (the wire serializes None as null, not absence)", () => {
    // Regression: the real proof/interpret wire sends definition-less
    // hypotheses as `def: null`; treating that as present crashed the
    // webview handler and froze the panel (2026-07-10 QA).
    const out = adaptGoalAnswer({
      textDocument: td,
      position: pos,
      messages: [],
      error: null,
      goals: {
        goals: [
          {
            ty: ["Pp_string", "n + 0 = n"],
            info: { evar: ["Ser_Evar", 5], name: null },
            hyps: [{ names: ["n"], def: null, ty: ["Pp_string", "nat"] }],
          },
        ],
        stack: [],
        bullet: null,
        shelf: [],
        given_up: [],
      },
    } as any);
    const g = out.goals!.main[0];
    expect(JSON.stringify(g.hypotheses[0])).not.toContain('" := "');
    expect(out.error).toBeUndefined();
  });

  it("adapts messages in both wire shapes (bare Pp and Message objects)", () => {
    const out = adaptGoalAnswer({
      textDocument: td,
      position: pos,
      messages: [
        ["Pp_string", "bare"],
        { level: 1, text: ["Pp_string", "boom"] },
      ],
    } as any);
    expect(out.messages).toEqual([
      [3, ["Ppcmd_string", "bare"]],
      [1, ["Ppcmd_string", "boom"]],
    ]);
  });

  it("normalizes the error field when present", () => {
    const out = adaptGoalAnswer({
      textDocument: td,
      position: pos,
      messages: [],
      error: ["Pp_string", "oops"],
    } as any);
    expect(out.error).toEqual(["Ppcmd_string", "oops"]);
  });
});
