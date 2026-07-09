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

  // Messages posted between panel creation and the webview's "ready"
  // handshake would be dropped by the not-yet-listening webview; they wait
  // here and are flushed in creation order when "ready" arrives.
  private webviewReady = false;
  private pendingMessages: CoqMessagePayload[] = [];

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
    this.webviewReady = false;
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
      this.webviewReady = false;
      this.pendingMessages = [];
    });

    this.panel.webview.onDidReceiveMessage((msg) => {
      if (msg?.command === "ready") {
        // The webview drops messages posted before its script has
        // registered a listener, so everything sent since creation waits
        // in pendingMessages until this handshake arrives.
        this.webviewReady = true;
        const pending = this.pendingMessages;
        this.pendingMessages = [];
        for (const m of pending) {
          this.panel?.webview.postMessage(m);
        }
      } else if (msg?.command === "openGoalSettings") {
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
  postMessage(payload: CoqMessagePayload) {
    this.ensurePanel();
    if (!this.webviewReady) {
      // Panel just created (or still booting): the webview would silently
      // drop this message, so hold it until the "ready" handshake. Without
      // this, the first meaningful render of a session was lost and the
      // panel stayed on its initial empty state.
      this.pendingMessages.push(payload);
      return;
    }
    this.panel?.webview.postMessage(payload);
  }

  // notify the display that we are waiting for info
  requestSent(cursor: GoalRequest) {
    this.postMessage({ method: "waitingForInfo", params: cursor });
  }

  // notify the info panel that we have fresh goals to render
  requestDisplay(goals: GoalAnswer<BoxString, PpString>) {
    this.postMessage({ method: "renderGoals", params: goals });
  }

  // notify the info panel that we found an error
  requestError(e: ErrorData) {
    this.postMessage({ method: "infoError", params: e });
  }

  notifyLackOfVSLS(
    textDocument: VersionedTextDocumentIdentifier,
    position: Position
  ) {
    let message =
      "Support for Goal Display is not available (yet) under Visual Studio Live Share";
    this.requestError({ textDocument, position, message });
  }

  // LSP Protocol extension for Goals
  updateInfoPanelForCursor(client: BaseLanguageClient, params: GoalRequest) {
    params = { ...params, pp_format: "Pp" };
    this.requestSent(params);
    client.sendRequest(goalReq, params).then(
      (goals) => this.requestDisplay(goals),
      (error: ResponseError<void>) => {
        let textDocument = params.textDocument;
        let position = params.position;
        let message = error.message;
        this.requestError({ textDocument, position, message });
      }
    );
  }

  updateAPIClientForCursor(client: BaseLanguageClient, params: GoalRequest) {
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
          this.requestError({ textDocument, position, message });
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
    this.updateInfoPanelForCursor(client, cursor);
    this.updateAPIClientForCursor(client, cursor);
  }
}
