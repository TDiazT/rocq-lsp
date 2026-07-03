(*************************************************************************)
(* Copyright 2025      CNRS                     -- LGPL 2.1+ / GPL3+     *)
(* Written by: coq-lsp contributors                                      *)
(*************************************************************************)
(* Rocq Language Server Protocol: Interpret (manual navigation) Request  *)
(*************************************************************************)

(** Sentence-selection mode relative to the request position; the ["end"]
    mode is served via [request_end] as it needs the full document. *)
type mode =
  | Forward
  | Backward
  | Point

(** [request ~pp_format ~mode ~position ()] serves [proof/interpret] for the
    position-relative modes. The scheduler's [~point] is ignored: the caller
    passes the *check target* there (see [do_interpret] in [lsp_core.ml]);
    sentence selection always uses the client-supplied [position]. *)
val request :
     pp_format:Rq_goals.format
  -> mode:mode
  -> position:int * int
  -> unit
  -> (Yojson.Safe.t, string) Request.position

(** [request_end ~pp_format ()] serves [proof/interpret] with [mode = "end"]:
    selects the last sentence once the full document is checked. *)
val request_end :
  pp_format:Rq_goals.format -> unit -> (Yojson.Safe.t, string) Request.document
