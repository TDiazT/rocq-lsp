// Normalizes rocq-lsp's wire Pp dialect (serlib: "Pp_*" constructors, may
// contain Pp_sized_string, tags not regrouped) into the dialect pp-display
// consumes (Rocq's own "Ppcmd_*" constructors, VsRocq wire). See the Phase B
// analysis: same Pp.t AST on both sides, different serializers.

// Self-contained wire type: serlib/ser_pp.ml is the source of truth.
export type WireBlockType =
  | ["Pp_hbox"]
  | ["Pp_vbox", number]
  | ["Pp_hvbox", number]
  | ["Pp_hovbox", number];

export type WirePp =
  | ["Pp_empty"]
  | ["Pp_string", string]
  | ["Pp_sized_string", number, string]
  | ["Pp_glue", WirePp[]]
  | ["Pp_box", WireBlockType, WirePp]
  | ["Pp_tag", string, WirePp]
  | ["Pp_print_break", number, number]
  | ["Pp_force_newline"]
  | ["Pp_comment", string[]];

// Structurally identical to pp-display's PpString; Task 4 aliases them.
export type VsRocqPp =
  | ["Ppcmd_empty"]
  | ["Ppcmd_string", string]
  | ["Ppcmd_glue", VsRocqPp[]]
  | ["Ppcmd_box", WireBlockType, VsRocqPp]
  | ["Ppcmd_tag", string, VsRocqPp]
  | ["Ppcmd_print_break", number, number]
  | ["Ppcmd_force_newline"]
  | ["Ppcmd_comment", string[]];

export function normalizePp(pp: WirePp | string): VsRocqPp {
  // Defensive: the wire serializes OCaml's None as null; a nullable Pp field
  // reaching here must degrade to empty rather than crash the webview's
  // message handler (which would silently freeze the panel on its previous
  // state).
  if (pp == null) return ["Ppcmd_empty"];
  if (typeof pp === "string") return ["Ppcmd_string", pp];
  switch (pp[0]) {
    case "Pp_empty":
      return ["Ppcmd_empty"];
    case "Pp_string":
      return ["Ppcmd_string", pp[1]];
    case "Pp_sized_string":
      // VsRocq's server collapses Ppcmd_sized_string the same way
      // (protocol/printing.ml); the size is a UTF-16 hint we don't need.
      return ["Ppcmd_string", pp[2]];
    case "Pp_glue":
      return ["Ppcmd_glue", pp[1].map(normalizePp)];
    case "Pp_box":
      return ["Ppcmd_box", pp[1], normalizePp(pp[2])];
    case "Pp_tag": {
      const tag = pp[1];
      // Rocq emits paired start./end. marker tags in some printing paths;
      // VsRocq regroups them server-side into properly nested tags
      // (regroup_tags, printing.ml). rocq-lsp passes them through. Dropping
      // the marker keeps the content and avoids bogus CSS classes; proper
      // regrouping can be added here if real goals turn out to carry them.
      if (tag.startsWith("start.") || tag.startsWith("end."))
        return normalizePp(pp[2]);
      return ["Ppcmd_tag", tag, normalizePp(pp[2])];
    }
    case "Pp_print_break":
      return ["Ppcmd_print_break", pp[1], pp[2]];
    case "Pp_force_newline":
      return ["Ppcmd_force_newline"];
    case "Pp_comment":
      return ["Ppcmd_comment", pp[1]];
    default:
      return ["Ppcmd_string", JSON.stringify(pp)];
  }
}
