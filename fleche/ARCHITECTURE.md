# Flèche architecture

Flèche is the incremental document engine at the core of rocq-lsp. It parses and elaborates Rocq source files sentence by sentence, caches results, and manages the lifecycle of open documents. Everything else (the LSP controller, Petanque, the batch compiler `fcc`, the WASM build) consumes Flèche as a library.

## Position in the build graph

```
lang/          -- abstract LSP types (Range, Point, Diagnostic, ...)
coq/           -- thin wrappers around the Rocq kernel and STM
  |
fleche/        -- this library
  |      \     \
controller/  petanque/  fcc/  (wasm)
```

`lang` and `coq` are the only direct dependencies of `fleche` (plus `unix`, `yojson`, and `fleche_waterproof`). Flèche never imports from `controller`.

## Module overview

| Module | Role |
|---|---|
| `Config` | Global runtime configuration (a mutable ref updated on LSP init/change) |
| `Contents` | Text processing: raw input, markdown stripping, line array |
| `Doc` | Document type, creation, incremental update, and the check loop |
| `Info` | Located queries against a document (node at point, goals, completion candidates) |
| `Memo` | Memoization tables for sentence execution |
| `Theory` | Multi-document manager: handles, check scheduling, request lifecycle |
| `Io` | IO callback record and logging utilities |
| `Perf` / `Stats` | Performance data structures sent to the client |
| `Progress` | Progress notification payload |
| `Debug` | Debug flags (controlled by `Config`) |

## Core data types

### `Contents.t`

Holds two versions of the document text:

- `raw`: the original bytes received from the client, including any markdown
- `text`: the text sent to the Rocq parser, with markdown stripped and encoded in UTF-8
- `lines`: `text` split into an array of lines, used for position arithmetic

`Contents.make` does the processing and returns a `Contents.R.t` (a lightweight result type) because markdown extraction can fail.

### `Node.t`

A single parsed and elaborated sentence. The document is a `Node.t list`.

```ocaml
type t = private {
  range    : Lang.Range.t;
  prev     : t option;           (* linked-list pointer to the preceding node *)
  ast      : Ast.t option;       (* parsed AST, None for the init-feedback node *)
  state    : Coq.State.t;        (* Rocq state *after* this sentence *)
  diags    : ... Lang.Diagnostic.t list;
  messages : Message.t list;     (* info/notice feedback not promoted to diags *)
  info     : Info.t;             (* timing, cache-hit stats *)
}
```

The `prev` pointer is used for proof-start search (`Analysis.find_proof_start`) and for recovery heuristics.

### `Doc.t`

The document itself. The most important fields:

- `nodes`: the list of elaborated sentences, in reverse order (most recent first)
- `completed`: check status (`Yes | Stopped | WorkspaceUpdated | Failed`)
- `root`: the Rocq state produced by applying the workspace environment to `Coq.State.init`; this is the starting state before the first sentence
- `env`: the external environment (`Doc.Env.t`) — initial Rocq state, workspace (load path, flags), and file index
- `toc`: a map from definition names to nodes, built incrementally

`completed` has four variants:

- `Yes range`: the whole document has been checked up to `range`
- `Stopped range`: checking stopped at `range` (either interrupted or hit a `Target`)
- `WorkspaceUpdated range`: the workspace changed while the document was being checked; a full recheck is needed from the beginning
- `Failed range`: a critical error (e.g., an anomaly during document initialization); the document is in a degraded state

### `Doc.Env.t`

Everything outside the document text that determines how the first sentence's state is built:

```ocaml
type t = {
  init      : Coq.State.t;      (* Rocq's global initial state *)
  workspace : Coq.Workspace.t;  (* load path, flags, prelude *)
  files     : Coq.Files.t;      (* index of .vo files on disk *)
}
```

When the workspace changes (e.g., a `.vo` file is rebuilt), `Theory.workspace_update` calls `Doc.update_env` on every open document, which sets `completed` to `WorkspaceUpdated` and triggers a full recheck.

## Incremental checking

The central property of Flèche is that editing a document does not restart checking from scratch. The mechanism is in `Doc.bump_version` and `Doc.check`.

### On edit (`Doc.bump_version`)

When the client sends a `textDocument/didChange` notification, `Theory.change` calls `Doc.bump_version`. This function:

1. Calls `Contents.make` to reprocess the new text.
2. Calls `compute_common_prefix`: compares the old `raw` text against the new `raw` text byte by byte to find the first differing offset.
3. Discards all nodes whose `range.end_.offset` is at or past that offset. Nodes before it are reused without re-checking.
4. Sets `completed` to `Stopped` at the range of the last retained node.

The document is now in a `Stopped` state with valid nodes up to the edit point. It is scheduled for checking.

### On check (`Doc.check`)

`Doc.check` is the main loop. It resumes from the current `completed` range, calling into the Rocq parser and elaborator one sentence at a time:

1. Parse the next sentence using `Coq.Parsing.parse`.
2. Evaluate it via `Memo.Interp.evalS` (or `Memo.Require.evalS` for `Require` commands). If the `(state, ast)` pair is in the cache, the Rocq kernel is not called.
3. Collect feedback (errors, warnings, info messages) and convert them to diagnostics and messages.
4. Build a `Node.t` and prepend it to `doc.nodes`.
5. If `Config.v.eager_diagnostics` is set, send the accumulated diagnostics immediately via `Io.Report.diagnostics`.
6. Check whether the `Target` has been reached; if so, set `completed` to `Stopped` and return.
7. Otherwise continue to the next sentence.

When the end of the document is reached, `completed` is set to `Yes` and `Theory.Register.Completed` callbacks are fired (which send final diagnostics and performance data).

### Memoization (`Memo`)

Four caches are maintained:

- `Memo.Init`: caches `(init_state, workspace, files, uri) -> root_state`. Avoids re-executing the prelude on every document open.
- `Memo.Interp`: caches `(Coq.State.t, Coq.Ast.t) -> Coq.State.t` for regular vernacular commands. The AST is normalized to be location-independent, so whitespace-only edits before a sentence do not invalidate its cache entry.
- `Memo.Require`: like `Memo.Interp` but for `Require` commands, which additionally depend on the file index.
- `Memo.Admit`: caches the admit operation used in Qed-failure recovery.

Cache hits are recorded in `Node.Info.t` and surfaced via the hover panel when `show_stats_on_hover` is enabled.

## Theory: multi-document management

`Theory` is the layer above `Doc`. It manages all open documents and drives the check loop.

### `Handle.t` and the document table

Each open document has a `Handle.t`:

```ocaml
type t = {
  doc         : Doc.t;
  cp_requests : IS.t;               (* pending full-document requests *)
  pt_requests : (int * (int * int)) list;  (* pending point requests, sorted *)
}
```

All handles are stored in `Handle.doc_table`, a hash table keyed by URI.

### Check scheduling

`Check.pending` is a list of URIs that need checking, maintained as a priority stack: the most recently scheduled URI is checked first. Deduplication ensures a URI appears at most once.

`Theory.Check.maybe_check` is called by the LSP event loop when there is no incoming request to handle. It picks the first URI from `pending` and calls `Doc.check` with the appropriate `Target`.

The `Target` for a given URI is determined by `get_check_target`: if there are pending point requests, the target is the earliest one; if not, and if `check_only_on_request` is false, the target is `End`.

### Request lifecycle

LSP requests that need document content (hover, definition, completion, etc.) go through `Theory.Request.add`. The three request kinds are:

- `Immediate`: served with whatever the document state currently is, no waiting
- `FullDoc`: requires `completed = Yes | Failed`; if not ready and `postpone = true`, attached to `cp_requests` and woken up when checking completes
- `PosInDoc point`: requires the check to have reached `point`; if not ready, attached to `pt_requests` (kept sorted by position) and woken up as checking advances

When `Doc.check` builds a node or completes, `Handle.do_requests` inspects the pending request lists and returns the IDs of requests that can now be served. The controller uses those IDs to dispatch the actual LSP response.

## IO callbacks

`Io.CallBack.t` is a record of push functions that Flèche calls during checking:

```ocaml
type t = {
  diagnostics : uri:... -> version:int -> ... list -> unit;
  fileProgress : uri:... -> version:int -> Progress.Info.t list -> unit;
  perfData     : uri:... -> version:int -> Perf.t -> unit;
  serverStatus : ServerInfo.Status.t -> unit;
  trace        : string -> ?verbose:string -> string -> unit;
  message      : lvl:Level.t -> message:string -> unit;
  execInfo     : uri:... -> version:int -> range:Lang.Range.t -> unit;
}
```

The controller supplies the concrete implementations, which serialize and send the corresponding LSP notifications. Flèche is not aware of JSON or the wire format.

## Extension points

`Theory.Register` provides two extension hooks:

- `Register.InjectRequire`: a list of callbacks, each returning extra `Require` statements to prepend when a document is opened. Used by the Waterproof plugin to inject its standard library.
- `Register.Completed`: a list of callbacks fired after a document finishes checking (with or without errors). The default registrations send diagnostics and performance data. Plugins can add their own.

## Configuration

`Config.v` is a global mutable ref of type `Config.t`. It is set by the controller on `initialize` and updated on `workspace/didChangeConfiguration`. Options include eager diagnostics, proof goal display behavior, message verbosity, performance reporting, and several hover debug flags. The full list with defaults is in `config.ml`.
