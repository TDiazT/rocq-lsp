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

// Waits for the diagnostics batch to settle: resolves with the last
// publishDiagnostics for `uri` after `quietMs` milliseconds of silence.
// Flèche may send multiple incremental batches before the document is
// fully checked; this captures the final result without a fixed sleep.
export function waitForFinalDiagnostics(
  server: LanguageServer,
  uri: string,
  quietMs = 500,
): Promise<Protocol.PublishDiagnosticsParams> {
  return new Promise((resolve, reject) => {
    let last: Protocol.PublishDiagnosticsParams | null = null;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    const deadline = setTimeout(
      () => {
        disposable.dispose();
        if (last !== null) {
          resolve(last);
        } else {
          reject(new Error(`Timed out waiting for diagnostics on ${uri}`));
        }
      },
      8000,
    );

    const settle = () => {
      clearTimeout(deadline);
      disposable.dispose();
      resolve(last!);
    };

    const disposable = server.onNotification(
      Protocol.PublishDiagnosticsNotification.type,
      (params) => {
        if (params.uri !== uri) return;
        last = params;
        if (debounce !== null) clearTimeout(debounce);
        debounce = setTimeout(settle, quietMs);
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

// Like openAndWaitForDiagnostics but uses the settling strategy.
// Use this for golden/snapshot tests where accuracy matters more than speed.
export async function openAndWaitForFinalDiagnostics(
  server: LanguageServer,
  textDocument: Types.TextDocumentItem,
): Promise<Protocol.PublishDiagnosticsParams> {
  const ready = waitForFinalDiagnostics(server, textDocument.uri);
  await server.sendNotification(
    Protocol.DidOpenTextDocumentNotification.type,
    { textDocument },
  );
  return ready;
}
