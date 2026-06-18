import * as Types from "vscode-languageserver-types";
import * as LanguageServer from "./LanguageServer";
import { openAndWaitForDiagnostics } from "./helpers";

// Non-standard params: tests initialization with invalid rootUri and no workspaceFolders.
test("Open file with wrong URI", async () => {
  const server = LanguageServer.start();
  await server.initialize({
    rootPath: ".",
    rootUri: ".",
    trace: "verbose",
    workspaceFolders: null,
  });
  try {
    const textDocument = Types.TextDocumentItem.create(
      "wrong_file.v",
      "coq",
      0,
      "Definition a := 3.",
    );
    const diags = await openAndWaitForDiagnostics(server, textDocument);
    expect(diags.diagnostics).toHaveLength(0);
  } finally {
    await server.exit();
  }
});

test("Open non-existing file, with URI", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const textDocument = LanguageServer.openExampleEphemeral(
      "ephemeral.v",
      "Definition a := 3.",
    );
    const diags = await openAndWaitForDiagnostics(server, textDocument);
    expect(diags.diagnostics).toHaveLength(0);
  } finally {
    await server.exit();
  }
});

test("Fully checks ex1.v", async () => {
  const server = LanguageServer.start();
  await server.initialize({ trace: "verbose" });
  try {
    const textDocument = LanguageServer.openExample("ex1.v");
    const diags = await openAndWaitForDiagnostics(server, textDocument);
    expect(diags.diagnostics).toHaveLength(0);
  } finally {
    await server.exit();
  }
});
