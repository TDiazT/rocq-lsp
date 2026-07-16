/* -------------------------------------------------------------------------- */
/* Query panel: About over petanque/run_at_point (ADR-0005, Phase E).         */
/* Ships About only; Check/Locate/Print/Search follow in later PRs, each      */
/* adding a keyword to the closed whitelist below.                           */
/* -------------------------------------------------------------------------- */

import {
  commands,
  ExtensionContext,
  languages,
  Uri,
  WebviewView,
  WebviewViewProvider,
  window,
} from "vscode";
import { BaseLanguageClient, RequestType } from "vscode-languageclient";
import { CoqSelector } from "./config";
import { ManualNavigation } from "./manualNavigation";
import {
  buildAboutCommand,
  parseRunAtPointFeedback,
  resolveQueryPosition,
  RunAtPointResult,
} from "./queryAdapter";

interface RunAtPointParams {
  textDocument: { uri: string; version: number };
  position: { line: number; character: number };
  command: string;
}
const runAtPointReq = new RequestType<
  RunAtPointParams,
  RunAtPointResult,
  void
>("petanque/run_at_point");

type HostMessage =
  | { method: "prefill"; params: { term: string } }
  | { method: "result"; params: { messages: string[] } }
  | { method: "error"; params: { message: string } };

type WebviewMessage =
  | { method: "runAbout"; params: { term: string } }
  | { method: "ready" };

interface Deps {
  context: ExtensionContext;
  getClient: () => BaseLanguageClient;
  getManualNavigation: () => ManualNavigation;
}

export class QueryPanel {
  private deps: Deps;
  private post: (message: HostMessage) => void = () => {};
  // The webview reloads its JS every time it's shown (no
  // retainContextWhenHidden), so a reveal() can race ahead of the new
  // instance's message listener attaching. Track readiness and replay the
  // last prefill once the webview confirms it's listening.
  private webviewReady = false;
  private pendingPrefill: string | undefined;

  constructor(deps: Deps) {
    this.deps = deps;
    const provider: WebviewViewProvider = {
      resolveWebviewView: (webviewView) => this.resolve(webviewView),
    };
    deps.context.subscriptions.push(
      window.registerWebviewViewProvider("coqQueryView", provider)
    );
  }

  private resolve(webviewView: WebviewView) {
    webviewView.webview.options = { enableScripts: true };

    const extensionUri = this.deps.context.extensionUri;
    const styleUri = webviewView.webview.asWebviewUri(
      Uri.joinPath(extensionUri, "out", "views", "query", "index.css")
    );
    const scriptUri = webviewView.webview.asWebviewUri(
      Uri.joinPath(extensionUri, "out", "views", "query", "index.js")
    );

    webviewView.webview.html = ` <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <link rel="stylesheet" type="text/css" href="${styleUri}">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script src="${scriptUri}" type="module"></script>
        <title>Rocq Query</title>
    </head>
    <body>
    <div id="root">
    </div>
    </body>
    </html>`;

    this.webviewReady = false;
    this.post = (message: HostMessage) =>
      void webviewView.webview.postMessage(message);

    webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => {
      if (message.method === "runAbout") {
        void this.runAbout(message.params.term);
      } else if (message.method === "ready") {
        this.webviewReady = true;
        if (this.pendingPrefill !== undefined) {
          this.post({ method: "prefill", params: { term: this.pendingPrefill } });
          this.pendingPrefill = undefined;
        }
      }
    });
  }

  // Reveals the query view and, if a term was detected (e.g. word under the
  // cursor), prefills it. The user still confirms/edits before it runs.
  async reveal(prefillTerm?: string) {
    await commands.executeCommand("coqQueryView.focus");
    if (prefillTerm === undefined) return;
    if (this.webviewReady) {
      this.post({ method: "prefill", params: { term: prefillTerm } });
    } else {
      this.pendingPrefill = prefillTerm;
    }
  }

  private async runAbout(term: string) {
    const command = buildAboutCommand(term);
    if (command === null) return;

    const editor = window.activeTextEditor;
    if (!editor || languages.match(CoqSelector.owned, editor.document) < 1) {
      this.post({
        method: "error",
        params: { message: "No active Rocq editor." },
      });
      return;
    }
    const client = this.deps.getClient();
    if (!client?.isRunning()) {
      this.post({
        method: "error",
        params: { message: "Rocq language server is not running." },
      });
      return;
    }

    const document = editor.document;
    const uri = document.uri.toString();
    const manualNavigation = this.deps.getManualNavigation();
    const checkpoint = manualNavigation.getCheckpoint(uri);
    const lastLine = document.lineAt(document.lineCount - 1);
    const documentEnd = {
      line: lastLine.range.end.line,
      character: lastLine.range.end.character,
    };
    const position = resolveQueryPosition(
      manualNavigation.isManualModeOn(),
      checkpoint,
      documentEnd,
    );

    try {
      const result = await client.sendRequest(runAtPointReq, {
        textDocument: { uri, version: document.version },
        position,
        command,
      });
      this.post({
        method: "result",
        params: { messages: parseRunAtPointFeedback(result) },
      });
    } catch (e: any) {
      // No_node_at_point (petanque/agent.ml's Error.to_code): expected in
      // manual mode before the first step, not a real failure. Rocq itself
      // answers a genuinely undefined term as "<term> not a defined
      // object." (plain feedback, not this catch); we mirror that phrasing
      // here for consistency, since from the user's question the two cases
      // read the same ("nat", answered or not), even though the underlying
      // cause differs (nothing checked yet vs. checked and not found).
      const message =
        e?.code === -32007
          ? `${term.trim()} not a defined object.\nStep forward, or turn off manual mode.`
          : (e?.message ?? String(e));
      this.post({ method: "error", params: { message } });
    }
  }
}

export function activateQueryPanel(deps: Deps): QueryPanel {
  const panel = new QueryPanel(deps);

  deps.context.subscriptions.push(
    commands.registerTextEditorCommand("coq-lsp.about", (editor) => {
      if (languages.match(CoqSelector.owned, editor.document) < 1) return;
      const wordRange = editor.document.getWordRangeAtPosition(
        editor.selection.active
      );
      const term = wordRange ? editor.document.getText(wordRange) : "";
      void panel.reveal(term);
    })
  );

  return panel;
}
