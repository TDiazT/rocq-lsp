/* -------------------------------------------------------------------------- */
/* Manual navigation mode: VsRocq-style stepping over `proof/interpret`.      */
/* See `etc/doc/PROTOCOL.md`, section `proof/interpret`, for the request      */
/* shape and the mode semantics (forward/backward/point/end) this drives.     */
/* -------------------------------------------------------------------------- */

import {
  commands,
  languages,
  window,
  workspace,
  ExtensionContext,
  Position,
  Range,
  Selection,
  StatusBarAlignment,
  StatusBarItem,
  TextDocument,
  TextEditor,
  TextEditorRevealType,
  ThemeColor,
} from "vscode";
import * as lsp from "vscode-languageserver-types";
import { BaseLanguageClient, RequestType } from "vscode-languageclient";
import { InfoPanel } from "./goals";
import { CoqSelector } from "./config";
import { CheckpointStore } from "./checkpointStore";
import {
  CoqLspClientConfig,
  GoalAnswer,
  BoxString,
  PpString,
} from "../lib/types";

// InterpretAnswer is a GoalsAnswer superset: it already carries the stepped
// sentence's goals/messages/error, so the panel renders it directly — no
// re-query, hence no race with the cursor-following goals update.
interface InterpretParams {
  textDocument: { uri: string; version: number };
  mode: "forward" | "backward" | "point" | "end";
  position?: lsp.Position;
  pp_format?: string;
}
interface InterpretAnswer extends GoalAnswer<BoxString, PpString> {
  range?: lsp.Range;
  completed: boolean;
}
const interpretReq = new RequestType<InterpretParams, InterpretAnswer, void>(
  "proof/interpret"
);

interface Deps {
  context: ExtensionContext;
  getClient: () => BaseLanguageClient;
  getInfoPanel: () => InfoPanel;
  getConfig: () => CoqLspClientConfig;
}

// Manual navigation manages no workspace setting on toggle.
//
// check_only_on_request (checking schedule) and check_on_scroll (viewport
// hint) are independent of the navigation driver (ADR-0004's "Resolution")
// — a user may want eager checking, or lazy-with-background-scrolling,
// while still stepping manually, so the toggle never touches either.
//
// show_goals_on (cursor stops choosing which goal is displayed) used to be
// forced through the settings system too, but that left a stuck
// workspace-level override behind if the window reloaded mid-session
// without an explicit toggle-off (found in QA, 2026-07-17). It's gated
// directly in memory instead, in client.ts's goalsCall, by checking
// isManualModeOn() — no setting to leak across reloads.

export interface ManualNavigation {
  getCheckpoint(uri: string): lsp.Position | undefined;
  // Whether manual stepping is currently on. The query panel (ADR-0005)
  // needs this in addition to the checkpoint: "no checkpoint" means two
  // different things depending on this flag (see resolveQueryPosition).
  isManualModeOn(): boolean;
}

export function activateManualNavigation(deps: Deps): ManualNavigation {
  const { context } = deps;

  let manualOn = false;
  // checkpoint per document uri; absent = before the first sentence
  const checkpoints = new CheckpointStore();

  // Diagnostics channel: every interpret request/answer, retract, and mode
  // transition lands here ("Output" panel → "Rocq Manual Navigation").
  const log = window.createOutputChannel("Rocq Manual Navigation");
  context.subscriptions.push(log);
  const fmtPos = (p?: lsp.Position) => (p ? `${p.line}:${p.character}` : "∅");

  // The auto-enter notice is a real toast the first time (a status-bar
  // message alone is easy to miss); later transitions stay in the status bar.
  let autoEnterNoticeShown = false;

  const status: StatusBarItem = window.createStatusBarItem(
    StatusBarAlignment.Left,
    0
  );
  status.command = "coq-lsp.toggleManualMode";
  context.subscriptions.push(status);

  const checkedDecoration = window.createTextEditorDecorationType({
    backgroundColor: new ThemeColor("diffEditor.insertedTextBackground"),
    isWholeLine: false,
  });
  context.subscriptions.push(checkedDecoration);

  function renderStatus(editor?: TextEditor) {
    const uri = editor?.document.uri.toString();
    const cp = uri ? checkpoints.get(uri) : undefined;
    const pos = cp ? ` ▸ ${cp.line + 1}:${cp.character}` : "";
    status.text = manualOn
      ? `$(debug-pause) Rocq: Manual${pos}`
      : `$(run-all) Rocq: Auto`;
    status.show();
  }

  function renderDecoration(editor: TextEditor) {
    const uri = editor.document.uri.toString();
    const cp = checkpoints.get(uri);
    const ranges = cp
      ? [new Range(new Position(0, 0), new Position(cp.line, cp.character))]
      : [];
    editor.setDecorations(checkedDecoration, ranges);
  }

  async function toggleManual() {
    manualOn = !manualOn;
    // Manual = the cursor stops choosing which goal is displayed; stepping
    // does instead (enforced in memory, no settings read or written here —
    // see the comment above activateManualNavigation for why). Checking
    // schedule and viewport scrolling are the user's own independent
    // settings, untouched here (ADR-0004's "Resolution").
    if (manualOn) {
      log.appendLine("[toggle] manual ON");
      window.setStatusBarMessage("Manual mode ON (goal display no longer follows the cursor)", 3000);
    } else {
      log.appendLine("[toggle] manual OFF");
      window.setStatusBarMessage("Back to Auto (goal display follows the cursor again)", 3000);

      for (const editor of window.visibleTextEditors) {
        editor.setDecorations(checkedDecoration, []);
      }
      checkpoints.clear();
    }
    await commands.executeCommand("setContext", "coq-lsp.manualMode", manualOn);
    renderStatus(window.activeTextEditor);
  }

  async function interpret(
    editor: TextEditor,
    mode: "forward" | "backward" | "point" | "end"
  ) {
    if (languages.match(CoqSelector.owned, editor.document) < 1) return;
    const client = deps.getClient();
    if (!client?.isRunning()) return;

    // Reserved up front (before the toggleManual()/request awaits below) so
    // it beats any goals-on-cursor request already in flight from the
    // cursor move that positioned this very step — that request's own
    // generation was reserved earlier and is now stale, so its response
    // can no longer overwrite this step's render whenever it resolves (a
    // race found in QA, 2026-07-17; see goals.ts's InfoPanel.beginRender).
    const generation = deps.getInfoPanel().beginRender();

    // Stepping IS manual navigation: entering it via any stepping command
    // flips into manual mode (settings snapshot + cursor stops choosing the
    // displayed goal), so the panel has a single writer — otherwise the
    // cursor-following goals update races with the stepping one and the
    // panel flip-flops between the two query positions.
    if (!manualOn) {
      await toggleManual();
      if (!autoEnterNoticeShown) {
        autoEnterNoticeShown = true;
        void window.showInformationMessage(
          "Manual navigation on: the goals panel now follows your steps, " +
            "not the cursor. Toggle off from the “Rocq: Manual” status bar item."
        );
      }
    }

    const uri = editor.document.uri.toString();
    const version = editor.document.version;
    const cp = checkpoints.get(uri) ?? { line: 0, character: 0 };
    const position =
      mode === "point"
        ? client.code2ProtocolConverter.asPosition(editor.selection.active)
        : cp;

    const params: InterpretParams = {
      textDocument: { uri, version },
      mode,
      ...(mode === "end" ? {} : { position }),
      // The goals panel renders the Pp AST; the pp_type setting only
      // affects other consumers (see InfoPanel.updateInfoPanelForCursor).
      pp_format: "Pp",
    };

    log.appendLine(
      `[step] ${mode} @ ${fmtPos(position)} (cp ${fmtPos(
        checkpoints.get(uri)
      )}, v${version})`
    );
    let answer: InterpretAnswer;
    try {
      answer = await client.sendRequest(interpretReq, params);
    } catch (e: any) {
      log.appendLine(`[step] ${mode} FAILED: ${e?.message ?? e}`);
      window.showWarningMessage(`Manual navigation: interpret failed: ${e?.message ?? e}`);
      return;
    }
    log.appendLine(
      `[step] ${mode} → range ${fmtPos(answer.range?.start)}..${fmtPos(
        answer.range?.end
      )}, goals ${(answer.goals as any)?.goals?.length ?? "∅"}, completed ${
        answer.completed
      }`
    );

    // New checkpoint = end of the answered sentence; absent range means
    // retracted before the first sentence.
    const newCp: lsp.Position = answer.range
      ? answer.range.end
      : { line: 0, character: 0 };
    checkpoints.set(uri, newCp);

    // Surface the state: cursor follows the checkpoint (VsRocq moveCursor,
    // client-side), checked region highlight, status bar, goals panel.
    const vsPos = new Position(newCp.line, newCp.character);
    editor.selection = new Selection(vsPos, vsPos);
    editor.revealRange(
      new Range(vsPos, vsPos),
      TextEditorRevealType.InCenterIfOutsideViewport
    );
    renderDecoration(editor);
    renderStatus(editor);

    // Goals panel: the InterpretAnswer already carries the stepped
    // sentence's goals, messages and error (attributed to the node itself,
    // so the F5 boundary footgun doesn't apply) — display it directly.
    deps.getInfoPanel().requestDisplay(answer, generation);

    if (mode === "forward" && answer.completed) {
      window.setStatusBarMessage("End of document", 2000);
    }
  }

  const reg = (id: string, fn: (editor: TextEditor) => void) => {
    context.subscriptions.push(commands.registerTextEditorCommand(id, fn));
  };
  context.subscriptions.push(
    commands.registerCommand("coq-lsp.toggleManualMode", toggleManual)
  );
  reg("coq-lsp.stepForward", (e) => interpret(e, "forward"));
  reg("coq-lsp.stepBackward", (e) => interpret(e, "backward"));
  reg("coq-lsp.interpretToPoint", (e) => interpret(e, "point"));
  reg("coq-lsp.interpretToEnd", (e) => interpret(e, "end"));

  context.subscriptions.push(
    window.onDidChangeActiveTextEditor((e) => {
      if (e) {
        renderDecoration(e);
        renderStatus(e);
      }
    })
  );

  // Editing inside the checked region invalidates it from the edited
  // sentence onward. Retract to the sentence *preceding* the edit — a
  // backward interpret at the edit point, so sentence boundaries come from
  // the server, not from client-side guessing — and refresh the panel with
  // that answer. Debounced so a typing burst causes one request.
  async function retractTo(document: TextDocument, at: lsp.Position) {
    const client = deps.getClient();
    if (!client?.isRunning()) return;
    const generation = deps.getInfoPanel().beginRender();
    const uri = document.uri.toString();
    const params: InterpretParams = {
      textDocument: { uri, version: document.version },
      mode: "backward",
      position: at,
      pp_format: "Pp",
    };
    log.appendLine(`[retract] edit @ ${fmtPos(at)} (v${document.version})`);
    let answer: InterpretAnswer;
    try {
      answer = await client.sendRequest(interpretReq, params);
    } catch (e: any) {
      // Stale version or server busy — the next edit or step re-syncs.
      log.appendLine(`[retract] FAILED: ${e?.message ?? e}`);
      return;
    }
    log.appendLine(
      `[retract] → cp ${fmtPos(answer.range?.end)} (range start ${fmtPos(
        answer.range?.start
      )})`
    );
    const newCp: lsp.Position = answer.range
      ? answer.range.end
      : { line: 0, character: 0 };
    checkpoints.set(uri, newCp);
    for (const ed of window.visibleTextEditors) {
      if (ed.document.uri.toString() === uri) renderDecoration(ed);
    }
    renderStatus(window.activeTextEditor);
    deps.getInfoPanel().requestDisplay(answer, generation);
  }

  let retractTimer: ReturnType<typeof setTimeout> | undefined;
  context.subscriptions.push(
    workspace.onDidChangeTextDocument((ev) => {
      if (languages.match(CoqSelector.owned, ev.document) < 1) return;
      const uri = ev.document.uri.toString();
      const cp = checkpoints.get(uri);
      if (!cp || ev.contentChanges.length === 0) return;
      let earliest: Position | undefined;
      for (const change of ev.contentChanges) {
        const start = change.range.start;
        if (!earliest || start.isBefore(earliest)) earliest = start;
      }
      // Edits at or past the checkpoint (e.g. typing the next sentence at
      // the boundary) don't touch the checked region — leave it alone.
      if (!earliest || !earliest.isBefore(new Position(cp.line, cp.character)))
        return;
      const at = { line: earliest.line, character: earliest.character };
      if (retractTimer) clearTimeout(retractTimer);
      retractTimer = setTimeout(() => void retractTo(ev.document, at), 300);
    })
  );

  // The keybindings are always live in Rocq buffers (VsRocq precedent); the
  // context key is still published for users' own `when` clauses.
  void commands.executeCommand("setContext", "coq-lsp.manualMode", false);
  renderStatus(window.activeTextEditor);

  return {
    getCheckpoint: (uri: string) => checkpoints.get(uri),
    isManualModeOn: () => manualOn,
  };
}
