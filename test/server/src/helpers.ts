import * as Protocol from "vscode-languageserver-protocol";
import * as Types from "vscode-languageserver-types";
import { LanguageServer } from "./LanguageServer";

// Registers the publishDiagnostics listener BEFORE the caller sends any
// notification. Resolves with the first diagnostics params whose URI matches.
// This eliminates the race condition where a fast server response arrives
// before the listener is attached.
export function waitForDiagnostics(
  server: LanguageServer,
  uri: string,
): Promise<Protocol.PublishDiagnosticsParams> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => {
        disposable.dispose();
        reject(new Error(`Timed out waiting for diagnostics on ${uri}`));
      },
      8000,
    );
    const disposable = server.onNotification(
      Protocol.PublishDiagnosticsNotification.type,
      (params) => {
        if (params.uri === uri) {
          clearTimeout(timer);
          disposable.dispose();
          resolve(params);
        }
      },
    );
  });
}

// Convenience: registers the listener, sends DidOpen, then awaits diagnostics.
// Callers cannot accidentally reverse the order.
export async function openAndWaitForDiagnostics(
  server: LanguageServer,
  textDocument: Types.TextDocumentItem,
): Promise<Protocol.PublishDiagnosticsParams> {
  const ready = waitForDiagnostics(server, textDocument.uri);
  await server.sendNotification(
    Protocol.DidOpenTextDocumentNotification.type,
    { textDocument },
  );
  return ready;
}
