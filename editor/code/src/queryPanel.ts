/* -------------------------------------------------------------------------- */
/* Query panel: About/Check over petanque/run_at_point (ADR-0005, ADR-0006).  */
/* Locate/Print follow in a later PR; Search is out of scope (see ADR-0006):  */
/* each keyword joins the closed whitelist in queryAdapter.ts.               */
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
  buildQueryCommand,
  parseRunAtPointFeedback,
  QueryKeyword,
  resolveQueryPosition,
  RunAtPointResult,
  stripCoqErrorPrefix,
} from "./queryAdapter";

// Petanque error codes (petanque/agent.ml's Error.to_code) the panel treats
// specially; see ADR-0006 point 4.
const NoNodeAtPoint = -32007;
const CoqError = -32003;

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
  | { method: "prefill"; params: { term: string; keyword: QueryKeyword } }
  | { method: "result"; params: { messages: string[] } }
  | { method: "error"; params: { message: string } };

type WebviewMessage =
  | { method: "runQuery"; params: { keyword: QueryKeyword; term: string } }
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
  private pendingPrefill: { term: string; keyword: QueryKeyword } | undefined;

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
      if (message.method === "runQuery") {
        void this.runQuery(message.params.keyword, message.params.term);
      } else if (message.method === "ready") {
        this.webviewReady = true;
        if (this.pendingPrefill !== undefined) {
          this.post({ method: "prefill", params: this.pendingPrefill });
          this.pendingPrefill = undefined;
        }
      }
    });
  }

  // Reveals the query view, selects the given keyword in the dropdown, and,
  // if a term was detected (e.g. word under the cursor), prefills it. The
  // user still confirms/edits before it runs.
  async reveal(prefillTerm: string, keyword: QueryKeyword) {
    await commands.executeCommand("coqQueryView.focus");
    if (this.webviewReady) {
      this.post({ method: "prefill", params: { term: prefillTerm, keyword } });
    } else {
      this.pendingPrefill = { term: prefillTerm, keyword };
    }
  }

  private async runQuery(keyword: QueryKeyword, term: string) {
    const command = buildQueryCommand(keyword, term);
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
      if (e?.code === CoqError) {
        // Coq user error (e.g. Check on an undefined identifier): from the
        // user's point of view this IS the answer, just delivered as an RPC
        // rejection instead of successful feedback, unlike About (see
        // ADR-0006 point 4). Render it like an ordinary result, not a panel
        // error, and strip the internal "Coq: " prefix.
        this.post({
          method: "result",
          params: {
            messages: [stripCoqErrorPrefix(e?.message ?? String(e))],
          },
        });
        return;
      }
      // No_node_at_point: expected in manual mode before the first step, not
      // a real failure. This wording is deliberately keyword-neutral (About's
      // real "not a defined object." phrasing does not generalize to
      // Check/Locate/Print, whose real errors read differently).
      const message =
        e?.code === NoNodeAtPoint
          ? "Nothing checked here yet.\nStep forward, or turn off manual mode."
          : (e?.message ?? String(e));
      this.post({ method: "error", params: { message } });
    }
  }
}

export function activateQueryPanel(deps: Deps): QueryPanel {
  const panel = new QueryPanel(deps);

  function registerQueryCommand(command: string, keyword: QueryKeyword) {
    deps.context.subscriptions.push(
      commands.registerTextEditorCommand(command, (editor) => {
        if (languages.match(CoqSelector.owned, editor.document) < 1) return;
        const wordRange = editor.document.getWordRangeAtPosition(
          editor.selection.active
        );
        const term = wordRange ? editor.document.getText(wordRange) : "";
        void panel.reveal(term, keyword);
      })
    );
  }

  registerQueryCommand("coq-lsp.about", "About");
  registerQueryCommand("coq-lsp.check", "Check");

  return panel;
}
