(*************************************************************************)
(* Copyright 2025      CNRS                     -- LGPL 2.1+ / GPL3+     *)
(* Written by: coq-lsp contributors                                      *)
(*************************************************************************)
(* Rocq Language Server Protocol: Interpret (manual navigation) Request  *)
(*************************************************************************)

module Lsp = Fleche_lsp

type mode =
  | Forward
  | Backward
  | Point

(* (line, character) lexicographic comparison *)
let point_le (l1, c1) (l2, c2) = l1 < l2 || (l1 = l2 && c1 <= c2)
let point_lt (l1, c1) (l2, c2) = l1 < l2 || (l1 = l2 && c1 < c2)

let node_start n =
  let { Lang.Range.start; _ } = Fleche.Doc.Node.range n in
  (start.line, start.character)

let node_end n =
  let { Lang.Range.end_; _ } = Fleche.Doc.Node.range n in
  (end_.line, end_.character)

let rec last_opt = function
  | [] -> None
  | [ x ] -> Some x
  | _ :: tl -> last_opt tl

(* Flèche appends a synthetic EOF marker node (`ast = None`, zero-width range
   at the last token, see [Doc.unparseable_node] / [Doc.document_action]'s
   [EOF] case in fleche/doc.ml) as the final entry of [doc.nodes]. It is not a
   real sentence, so drop it before selecting: otherwise "end"/forward-at-EOF
   would answer with a zero-width range instead of the last real sentence. *)
let real_sentences nodes =
  List.filter (fun n -> node_start n <> node_end n) nodes

(* Sentence selection per spec: forward = first sentence ending strictly
   after the position (clamped to the last node when the position is at/past
   the end of the document, so "step at EOF" answers the last sentence, not
   null). At a sentence boundary — the normal stepping pattern — that is the
   next sentence; inside a sentence it is that sentence itself. This matches
   what the lazy scheduler's check target [(l, c+1)] actually checks, so the
   answer is identical whether the position has already been checked (eager)
   or is at the lazy-checking frontier (lazy). backward = last node ending
   strictly before it; point = last node starting at/before it (interprets
   *through* the sentence under the cursor). *)
let select ~mode ~position nodes =
  match mode with
  | Forward -> (
    match List.find_opt (fun n -> point_lt position (node_end n)) nodes with
    | Some n -> Some n
    | None -> last_opt nodes)
  | Backward ->
    List.filter (fun n -> point_lt (node_end n) position) nodes |> last_opt
  | Point ->
    List.filter (fun n -> point_le (node_start n) position) nodes |> last_opt

(* Duplicated from rq_goals.ml to keep this handler self-contained *)
let mk_messages node =
  Option.map Fleche.Doc.Node.messages node
  |> Stdlib.Option.fold
       ~some:(List.map Lsp.JFleche.Message.of_coq_message)
       ~none:[]

let mk_error node =
  let open Fleche in
  let open Lang in
  match List.filter Diagnostic.is_error node.Doc.Node.diags with
  | [] -> None
  | e :: _ -> Some e.Diagnostic.message

let pp_msgs ~pp_format =
  match pp_format with
  | Rq_goals.Str | Rq_goals.Box -> fun x -> `String (Coq.Pp_t.to_string x)
  | Rq_goals.Pp -> fun x -> Lsp.JCoq.Pp_t.to_yojson x

let same_node a b = node_start a = node_start b && node_end a = node_end b

let mk_answer ~pp_format ~token ~(doc : Fleche.Doc.t) ~sentences ~position
    ~node =
  let open Fleche in
  let uri, version = (doc.Doc.uri, doc.version) in
  let textDocument = Lsp.Doc.VersionedTextDocumentIdentifier.{ uri; version } in
  let position =
    Lang.Point.{ line = fst position; character = snd position; offset = -1 }
  in
  let completed =
    Doc.Completion.is_completed doc.completed
    &&
    (* Compare against the last *real* sentence, not [doc.nodes]'s raw last
       element (the EOF marker) — otherwise this would be permanently false
       once the EOF node is excluded from [select] but not from this check. *)
    match (node, last_opt sentences) with
    | Some n, Some l -> same_node n l
    | _ -> false
  in
  let pp_msg = pp_msgs ~pp_format in
  let mk ~range ~goals ~program ~messages ~error =
    Lsp.JFleche.InterpretAnswer.(
      to_yojson
        (fun x -> x)
        pp_msg
        { textDocument; position; range; goals; program; messages; error
        ; completed })
    |> Result.ok
  in
  match node with
  | None ->
    (* Retracted before the first sentence (or empty document) *)
    Coq.Protect.E.ok
      (mk ~range:None ~goals:None ~program:None ~messages:[] ~error:None)
  | Some node ->
    let st = Doc.Node.state node in
    let pr = Rq_goals.pp ~pp_format in
    let open Coq.Protect.E.O in
    let+ goals = Info.Goals.goals ~token ~pr ~compact:true ~st in
    let program = Some (Info.Goals.program ~st) in
    let range = Some (Doc.Node.range node) in
    let messages = mk_messages (Some node) in
    let error = mk_error node in
    mk ~range ~goals ~program ~messages ~error

let interpret ~pp_format ~node ~sentences ~position ~token ~doc =
  let lines = Fleche.Doc.lines doc in
  let f () = mk_answer ~pp_format ~token ~doc ~sentences ~position ~node in
  Request.R.of_execution ~lines ~name:"interpret" ~f ()

let request ~pp_format ~mode ~position () ~token ~doc ~point:_ =
  let sentences = real_sentences doc.Fleche.Doc.nodes in
  let node = select ~mode ~position sentences in
  interpret ~pp_format ~node ~sentences ~position ~token ~doc

let request_end ~pp_format () ~token ~doc =
  let sentences = real_sentences doc.Fleche.Doc.nodes in
  let node = last_opt sentences in
  let position =
    match node with
    | Some n -> node_end n
    | None -> (0, 0)
  in
  interpret ~pp_format ~node ~sentences ~position ~token ~doc
