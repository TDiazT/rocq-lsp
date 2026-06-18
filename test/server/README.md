# rocq-lsp integration test suite

Integration tests that launch the `coq-lsp` binary over stdio and drive it via
the LSP protocol. They serve as the regression safety net at the protocol
boundary.

## Prerequisites

Build the server binary first:

```bash
# from the repo root
make build
# or equivalently:
dune build
```

The test runner expects the binary at `_build/install/default/bin/coq-lsp`.

## Running

```bash
# from the repo root (also runs make build first):
make test

# or directly from this directory:
npm test

# run a single test file:
npx jest src/Check.test.ts

# run with verbose output:
npx jest --verbose
```

## LSP feature coverage

| Feature | LSP method | Test file | Status |
|---|---|---|---|
| Lifecycle — startup/shutdown | `initialize`, `exit` | `Lifecycle.test.ts` | covered |
| Lifecycle — initialize with rootPath | `initialize` | `Lifecycle.test.ts` | covered |
| Lifecycle — initialize with rootUri | `initialize` | `Lifecycle.test.ts` | covered |
| Diagnostics — wrong URI | `textDocument/publishDiagnostics` | `Check.test.ts` | covered |
| Diagnostics — ephemeral file | `textDocument/publishDiagnostics` | `Check.test.ts` | covered |
| Diagnostics — existing file | `textDocument/publishDiagnostics` | `Check.test.ts` | covered |
| Diagnostics — valid file (snapshot) | `textDocument/publishDiagnostics` | `Diagnostics.test.ts` | covered |
| Diagnostics — type error (snapshot) | `textDocument/publishDiagnostics` | `Diagnostics.test.ts` | covered |
| Hover | `textDocument/hover` | — | not yet covered |
| Go to definition | `textDocument/definition` | — | not yet covered |
| Completion | `textDocument/completion` | — | not yet covered |
| Document symbols | `textDocument/documentSymbol` | — | not yet covered |
| Proof goals (extension) | `proof/goals` | — | not yet covered |
| File progress (extension) | `$/coq/fileProgress` | — | not yet covered |

## Adding tests

When adding a new characterization test:

1. Use `openAndWaitForDiagnostics(server, textDocument)` from `helpers.ts` to
   open a document and await diagnostics. This registers the listener before
   sending `DidOpen`, avoiding the race condition where a fast server response
   arrives before the listener is attached.

2. Use `LanguageServer.openFixture(filename)` for stable test fixtures under
   `test/server/fixtures/`, `LanguageServer.openExample(filename)` for files
   under `examples/`, or `LanguageServer.openExampleEphemeral(filename,
   contents)` for inline content.

3. For snapshot tests, use `openAndWaitForFinalDiagnostics` instead of
   `openAndWaitForDiagnostics`. It debounces multiple incremental batches from
   Flèche and resolves with the last one, so the snapshot captures the final
   server state.

4. Do not use `setTimeout` or `sleep`. If you need to wait for something, model
   it as a Promise that resolves on the relevant notification or response.

## Updating snapshots

If a server change intentionally alters LSP output, update the snapshots:

```bash
npx jest --updateSnapshot
```

Review each changed snapshot before committing — the diff is the record of what changed in the protocol.
