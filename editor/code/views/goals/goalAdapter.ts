import type { GoalAnswer, Goal, Hyp, Message } from "../../lib/types";
import { normalizePp, VsRocqPp, WirePp } from "./ppNormalize";

// Structural mirrors of goal-view-ui's types. Kept local rather than
// imported from goal-view-ui/types: that module's PpString (pp-display's,
// re-exported) types its Box variant's block-mode tag as the PpMode string
// *enum*, while VsRocqPp (ppNormalize.ts) uses the plain string-literal
// WireBlockType. TS treats string-enum members as nominal, so a WireBlockType
// value is not assignable to BlockType even though both carry the same
// runtime strings (verified: `"Pp_hbox"` errors against `PpMode.horizontal`
// with TS2322). App.tsx casts at the PpDisplay boundary instead.
export interface CollapsibleGoal {
  id: string;
  goal: VsRocqPp;
  hypotheses: VsRocqPp[];
  isOpen: boolean;
  isContextHidden: boolean;
}
export type ProofViewGoals = {
  main: CollapsibleGoal[];
  shelved: CollapsibleGoal[];
  givenUp: CollapsibleGoal[];
  unfocused: CollapsibleGoal[];
} | null;
// [severity 1=error..4=hint, body]
export type ProofViewMessage = [number, VsRocqPp];

export type AdaptedView = {
  goals: ProofViewGoals;
  messages: ProofViewMessage[];
  error?: VsRocqPp;
};

type Wire = WirePp | string;

const str = (s: string): VsRocqPp => ["Ppcmd_string", s];
const glue = (l: VsRocqPp[]): VsRocqPp => ["Ppcmd_glue", l];

// VsRocq's server pre-renders each hypothesis as one Pp line; rocq-lsp sends
// them structured. Compose "n, m : nat" / "e := 0 : nat" in an hv box so
// pp-display can reflow long types.
function hypToPp(hyp: Hyp<Wire>): VsRocqPp {
  const names: VsRocqPp[] = [];
  hyp.names.forEach((n, i) => {
    if (i > 0) names.push(str(", "));
    names.push(normalizePp(n));
  });
  const parts: VsRocqPp[] = [...names];
  // The wire serializes OCaml's None as null, not as an absent key, so a
  // definition-less hypothesis arrives as `def: null` — check both.
  if (hyp.def != null) parts.push(str(" := "), normalizePp(hyp.def));
  parts.push(
    str(" :"),
    ["Ppcmd_print_break", 1, 2],
    normalizePp(hyp.ty)
  );
  return ["Ppcmd_box", ["Pp_hvbox", 0], glue(parts)];
}

function goalToView(
  goal: Goal<Wire>,
  index: number,
  open: boolean
): CollapsibleGoal {
  return {
    id: String(index),
    goal: normalizePp(goal.ty),
    hypotheses: (goal.hyps ?? []).map(hypToPp),
    isOpen: open,
    isContextHidden: index !== 0,
  };
}

export function adaptGoalAnswer(
  answer: GoalAnswer<unknown, Wire>
): AdaptedView {
  const messages: ProofViewMessage[] = (answer.messages ?? []).map((m) => {
    if (typeof m === "object" && m !== null && "text" in (m as object)) {
      const msg = m as Message<Wire>;
      const level =
        msg.level >= 1 && msg.level <= 4 ? msg.level : 3; // default: info
      return [level, normalizePp(msg.text)];
    }
    return [3, normalizePp(m as Wire)];
  });

  // Same None-as-null caveat as hyp.def above.
  const error = answer.error != null ? normalizePp(answer.error) : undefined;

  const cfg = answer.goals as
    | {
        goals: Goal<Wire>[];
        stack: [Goal<Wire>[], Goal<Wire>[]][];
        shelf: Goal<Wire>[];
        given_up: Goal<Wire>[];
      }
    | undefined;
  if (!cfg) return { goals: null, messages, error };

  const unfocusedRaw = (cfg.stack ?? []).flatMap(([l, r]) => [...l, ...r]);
  return {
    goals: {
      main: cfg.goals.map((g, i) => goalToView(g, i, true)),
      shelved: (cfg.shelf ?? []).map((g, i) => goalToView(g, i, true)),
      givenUp: (cfg.given_up ?? []).map((g, i) => goalToView(g, i, true)),
      unfocused: unfocusedRaw.map((g, i) => goalToView(g, i, false)),
    },
    messages,
    error,
  };
}
