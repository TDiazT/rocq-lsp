# Naming guide: coq-lsp and rocq-lsp

This document explains which name applies where, why both exist, and how to
install and configure the server under the current names.

## The short version

The project is mid-rename from `coq-lsp` to `rocq-lsp`. The rename is not
complete, so different layers use different names today:

| Layer | Current name |
|---|---|
| opam package | `coq-lsp` |
| Binary | `coq-lsp` |
| VS Code extension ID | `ejgallego.coq-lsp` |
| VS Code settings prefix | `coq-lsp.*` |
| Repository and documentation | `rocq-lsp` |
| Internal OCaml namespace (`coq/`) | `Coq.*` |

## Why both names exist

The Rocq Prover was renamed from Coq to Rocq in late 2024. This project
followed by renaming its repository and documentation from `coq-lsp` to
`rocq-lsp`, but the package, binary, extension ID, and settings keys have not
been renamed yet.

The reasons for the delay are practical:

- The opam package and binary name is a breaking change for every user, CI
  configuration, and editor setup that references `coq-lsp`. It requires
  coordination with the Rocq organization and a deprecation period.
- The VS Code settings prefix is similar: renaming `coq-lsp.*` to `rocq-lsp.*`
  silently breaks all existing user configurations unless aliases are maintained
  for a full release cycle.
- The internal `Coq.*` OCaml namespace (the `coq/` library) is high-churn with
  no user-visible benefit; it will be left until or unless upstream chooses to
  rename it.

The rename will proceed in steps, each with backward-compatible aliases and a
deprecation window, coordinated upstream. It is not a single cut-over.

## Installing the server

```sh
opam install coq-lsp
```

The binary installed is `coq-lsp`. For development installs, see
[CONTRIBUTING.md](../../CONTRIBUTING.md).

## Editor configuration

### VS Code

The extension is published as `ejgallego.coq-lsp` on the VS Code Marketplace.
All settings use the `coq-lsp.*` prefix (e.g., `coq-lsp.eager_diagnostics`).

### Neovim and Emacs

Both use `coq-lsp` as the server command. LSP client configurations that
reference `rocq-lsp` or `coq-lsp` as the binary name should use `coq-lsp`.

## For contributors

If you are writing documentation or code for this project, follow these
conventions until a rename is explicitly coordinated:

- Use `rocq-lsp` when referring to the project, repository, or documentation.
- Use `coq-lsp` when referring to the opam package, binary, extension ID, or
  settings keys.
- Do not rename `Coq.*` identifiers in the `coq/` library.
- Do not rename VS Code settings keys.
