# rocq-lsp glossary

This document defines the terms used across the rocq-lsp codebase, issues,
and pull requests. It is aimed at contributors.

For a user-facing overview, see the [README](./README.md) and
[User Manual](./etc/doc/USER_MANUAL.md).

## Project-level terms

**rocq-lsp** — the repository and project name. The opam package and binary are
still named `coq-lsp` (mid-rename). See [etc/doc/NAMING.md](./etc/doc/NAMING.md)
for the full picture.

**Flèche** — the incremental document engine that forms the core of the server.
It parses and elaborates Rocq source files sentence by sentence, caches results,
and manages the lifecycle of open documents. Everything else (the LSP
controller, Petanque, fcc, the WASM build) consumes Flèche as a library. Source
in `fleche/`. Architecture documented in `fleche/ARCHITECTURE.md`.

**Petanque** — a low-latency API for direct interaction with Rocq's proof
engine. Intended for use by external tools and AI agents. Exposed as a separate
protocol alongside LSP. Source in `petanque/`.

**serlib** — utilities for serializing and deserializing Rocq's internal AST
types (using S-expression format via SerAPI). Source in `serlib/`.

**fcc** — an extensible command-line compiler built on top of Flèche. Batch
processes `.v` files without starting a full LSP server. Source in `compiler/`.

## Library layers

The build order is: `lang` → `coq` → `fleche` → `controller` → `lsp-server`.
Petanque, fcc, and the WASM build all sit directly above `fleche`.

**lang** — abstract LSP types with no Rocq dependency: `Range`, `Point`,
`Diagnostic`, `LUri`, and compatibility utilities. Source in `lang/`.

**coq** (the library) — a thin abstraction layer over the Rocq kernel and STM.
Reifies Rocq calls as a purely functional interface. Named `Coq.*` in OCaml
(e.g., `Coq.State`, `Coq.Ast`). Not the same thing as the Rocq prover itself.
Source in `coq/`.

**controller** — the platform-agnostic LSP controller. Translates incoming LSP
JSON messages into calls on `Fleche.Theory` and sends responses back. Contains
the per-request handlers (`rq_hover.ml`, `rq_goals.ml`, etc.). Source in
`controller/`.

**lsp-server** — the binary entry points for different platforms:
`native` (OCaml, used for Linux/macOS/Windows) and `jsoo` (compiled to
JavaScript via js_of_ocaml for the WASM/browser build). Source in
`lsp-server/`.

## Flèche concepts

**Node** (`Doc.Node.t`) — a single parsed and elaborated Rocq sentence. Carries
the source range, the AST, the Rocq state after the sentence, diagnostics,
feedback messages, and timing info. Nodes form a linked list via the `prev`
field.

**Doc** (`Doc.t`) — a Flèche document. Represented as a list of nodes plus
metadata: URI, version, `Contents.t`, completion status, table of contents, and
the external `Env.t`.

**Contents** (`Contents.t`) — the processed text of a document. Holds the
original `raw` bytes from the client, the `text` string sent to the Rocq parser
(markdown stripped, UTF-8), and a `lines` array for position arithmetic.

**Completion status** (`Doc.Completion.t`) — tracks how far checking has
progressed in a document. Four variants: `Yes` (fully checked), `Stopped`
(paused at a range, either by a `Target` or an edit), `WorkspaceUpdated`
(workspace changed mid-check, full recheck needed), `Failed` (critical error
during initialization).

**Env** (`Doc.Env.t`) — everything external to the document text that determines
the starting Rocq state: the global `init` state, the workspace (load path,
flags, prelude), and the file index.

**Workspace** (`Coq.Workspace.t`) — the load path and flags that determine which
`.vo` files are visible and how the Rocq kernel is configured. Derived from the
project's `_CoqProject` file.

**Theory** (`Theory` module) — the multi-document manager. Maintains the table
of open documents (`Handle.doc_table`), drives the check scheduler, and manages
the request lifecycle (which requests are waiting for which documents to reach
which state).

**Handle** (`Theory.Handle.t`) — the per-document state inside Theory. Holds the
current `Doc.t` plus the sets of pending requests (full-document and
point-based).

**Target** (`Doc.Target.t`) — specifies how far `Doc.check` should run before
stopping. Either `End` (check the whole document) or `Position (line, col)`
(stop when the check reaches that point).

**Memo tables** (`Memo` module) — hash tables that cache sentence execution
results. The key is `(Coq.State.t, Coq.Ast.t)` for vernacular commands; ASTs
are normalized to be location-independent so whitespace-only edits before a
sentence do not invalidate its cache entry.

**Common prefix** — the mechanism behind incremental checking on edit. When a
document is updated, Flèche compares the old and new `raw` text byte by byte
to find the first differing position. All nodes before that position are
retained; nodes at or after it are discarded. Checking resumes from the last
retained node.

## Request lifecycle terms

**cp_request** (completion-pending request) — a request that needs the full
document to be checked before it can be served (e.g., `textDocument/documentSymbol`
when a full-doc check is required). Stored in `Handle.cp_requests`.

**pt_request** (position request) — a request that needs checking to reach a
specific position before it can be served (e.g., `proof/goals` at a given
cursor location). Stored in `Handle.pt_requests`, sorted by position.

**Postpone** — the action returned by `Theory.Request.add` when a request
cannot be served immediately and has been queued to wait for checking progress.
The opposite is `Now doc` (serve immediately) or `Cancel` (will never be serveable).

## IO and notifications

**CallBack** (`Io.CallBack.t`) — the record of push functions that Flèche calls
during checking to send notifications to the client: diagnostics, file progress,
performance data, server status. Supplied by the controller; Flèche has no
dependency on JSON or the wire format.

**eager diagnostics** — when `Config.v.eager_diagnostics` is true, diagnostics
are sent after each sentence is checked rather than only at document completion.
Controlled by the `coq-lsp.eager_diagnostics` VS Code setting.

**perf data** — per-sentence timing and cache statistics sent to the client via
the `$/coq/filePerfData` notification. Used by the heatmap view in the VS Code
extension.

## Extension points

**Register.Completed** (`Theory.Register.Completed`) — a list of callbacks fired
when a document finishes checking. Default registrations send diagnostics and
perf data. Plugins can add their own callbacks.

**Register.InjectRequire** (`Theory.Register.InjectRequire`) — callbacks that
return extra `Require` statements to prepend when a document is opened. Used by
the Waterproof plugin to inject its standard library.
