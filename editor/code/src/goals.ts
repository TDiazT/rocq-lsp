import { Uri, WebviewPanel, window, ViewColumn, commands } from "vscode";
import {
  BaseLanguageClient,
  RequestType,
  ResponseError,
  VersionedTextDocumentIdentifier,
} from "vscode-languageclient";
import {
  GoalRequest,
  GoalAnswer,
  PpString,
  BoxString,
  CoqMessagePayload,
  ErrorData,
} from "../lib/types";
import { configManager } from "./configManager";

import {
  URI,
  Position,
  TextDocumentIdentifier,
} from "vscode-languageserver-types";

export const goalReq = new RequestType<
  GoalRequest,
  GoalAnswer<BoxString, PpString>,
  void
>("proof/goals");

export class InfoPanel {
  private panel: WebviewPanel | null = null;
  private extensionUri: Uri;
  private listeners: Array<(goals: GoalAnswer<String, String>) => void> = [];

  // Coordinates the panel's two writers (cursor-follow goals-on-cursor
  // requests and manual-navigation stepping, see manualNavigation.ts):
  // whichever reserved the latest generation wins. A caller reserves one
  // with beginRender() before starting its async work, and passes it back
  // to requestSent/requestDisplay/requestError; a response for an older
  // reservation that resolves late is dropped instead of overwriting a
  // fresher render (a race found in QA, 2026-07-17: a stale goals-on-cursor
  // response for a not-yet-elaborated position landed after a correct
  // manual-stepping answer and blanked the panel).
  private generation = 0;

  beginRender(): number {
    return ++this.generation;
  }

  private isStale(generation: number): boolean {
    return generation !== this.generation;
  }

  constructor(extensionUri: Uri) {
    this.extensionUri = extensionUri;

    // We don't create the panel until we actually try to show
    // something on it; this will fix the panel appearing when the
    // extension is actived but actually chooses not to handle a file, cc #737

    // this.panelFactory();
  }

  dispose() {
    this.panel?.dispose();
  }

  registerObserver(fn: (goals: GoalAnswer<String, String>) => void) {
    this.listeners.push(fn);
  }

  unregisterObserver(fn: (goals: GoalAnswer<String, String>) => void) {
    let index = this.listeners.indexOf(fn);
    if (index >= 0) {
      this.listeners.splice(index, 1);
    }
  }

  panelFactory() {
    let webviewOpts = { enableScripts: true, enableFindWidget: true };
    this.panel = window.createWebviewPanel(
      "goals",
      "Goals",
      { preserveFocus: true, viewColumn: ViewColumn.Two },
      webviewOpts
    );

    /**
     * Register the panel with the config manager:
     * Essentially, the goals panel needs to be apprised of all config changes so its children can receive config messages
     */
    configManager.registerWebview(this.panel);

    const styleUri = this.panel.webview.asWebviewUri(
      Uri.joinPath(this.extensionUri, "out", "views", "goals", "index.css")
    );

    const scriptUri = this.panel.webview.asWebviewUri(
      Uri.joinPath(this.extensionUri, "out", "views", "goals", "index.js")
    );

    this.panel.webview.html = ` <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <link rel="stylesheet" type="text/css" href="${styleUri}">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script src="${scriptUri}" type="module"></script>
        <title>Rocq goals</title>
    </head>
    <body>
    <div id="root">
    </div>
    </body>
    </html>`;

    // The panel was closed by the user, guard!
    this.panel.onDidDispose(() => {
      this.panel = null;
    });

    this.panel.webview.onDidReceiveMessage((msg) => {
      if (msg?.command === "openGoalSettings") {
        commands.executeCommand("workbench.action.openSettings", "coq-lsp");
      }
    });
  }

  ensurePanel() {
    if (!this.panel) {
      this.panelFactory();
    } else {
      if (!this.panel.visible) {
        // Otherwise we create a race with the active editor!
        // Careful about this.
        if (window.activeTextEditor?.viewColumn !== 2) {
          this.panel.reveal(2, true);
        }
      }
    }
  }
  postMessage({ method, params }: CoqMessagePayload) {
    this.ensurePanel();
    this.panel?.webview.postMessage({ method, params });
  }

  // notify the display that we are waiting for info. generation must come
  // from beginRender(), reserved before starting the request that will
  // eventually resolve into requestDisplay/requestError.
  requestSent(cursor: GoalRequest, generation: number) {
    if (this.isStale(generation)) return;
    this.postMessage({ method: "waitingForInfo", params: cursor });
  }

  // notify the info panel that we have fresh goals to render
  requestDisplay(goals: GoalAnswer<BoxString, PpString>, generation: number) {
    if (this.isStale(generation)) return;
    this.postMessage({ method: "renderGoals", params: goals });
  }

  // notify the info panel that we found an error
  requestError(e: ErrorData, generation: number) {
    if (this.isStale(generation)) return;
    this.postMessage({ method: "infoError", params: e });
  }

  notifyLackOfVSLS(
    textDocument: VersionedTextDocumentIdentifier,
    position: Position
  ) {
    let message =
      "Support for Goal Display is not available (yet) under Visual Studio Live Share";
    this.requestError({ textDocument, position, message }, this.beginRender());
  }

  // LSP Protocol extension for Goals. generation is shared with the sibling
  // updateAPIClientForCursor call for the same cursor event (both reserved
  // once by updateFromServer) — reserving separately per call would make
  // each call's own successful response look stale to the other.
  updateInfoPanelForCursor(
    client: BaseLanguageClient,
    params: GoalRequest,
    generation: number
  ) {
    params = { ...params, pp_format: "Pp" };
    this.requestSent(params, generation);
    client.sendRequest(goalReq, params).then(
      (goals) => this.requestDisplay(goals, generation),
      (error: ResponseError<void>) => {
        let textDocument = params.textDocument;
        let position = params.position;
        let message = error.message;
        this.requestError({ textDocument, position, message }, generation);
      }
    );
  }

  updateAPIClientForCursor(
    client: BaseLanguageClient,
    params: GoalRequest,
    generation: number
  ) {
    if (this.listeners.length > 0) {
      params.pp_format = "Str";
      client.sendRequest(goalReq, params).then(
        (goals) => {
          let goals_fn = goals as GoalAnswer<String, String>;
          this.listeners.forEach((fn) => fn(goals_fn));
        },
        // We should actually provide a better setup so we can pass
        // the rejection of the promise to our clients, YMMV tho.
        (error: ResponseError<void>) => {
          let textDocument = params.textDocument;
          let position = params.position;
          let message = error.message;
          this.requestError({ textDocument, position, message }, generation);
        }
      );
    }
  }

  // Protocol-level data
  updateFromServer(
    client: BaseLanguageClient,
    uri: URI,
    version: number,
    position: Position,
    pp_format: "Box" | "Pp" | "Str",
    compact: boolean
  ) {
    let textDocument = VersionedTextDocumentIdentifier.create(uri, version);

    // Example to test the `command` parameter
    // let command = "idtac.";
    // let cursor: GoalRequest = { textDocument, position, command };
    let cursor: GoalRequest = { textDocument, position, pp_format, compact };
    const generation = this.beginRender();
    this.updateInfoPanelForCursor(client, cursor, generation);
    this.updateAPIClientForCursor(client, cursor, generation);
  }
}
