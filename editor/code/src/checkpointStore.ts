import type { Position } from "vscode-languageserver-types";

// Per-document manual-navigation checkpoint (see CONTEXT.md "Checkpoint"):
// the exclusive end of the last sentence proof/interpret stepped to. Absent
// means "before the first sentence." Pure and vscode-free so it's testable
// without mocking the extension host, and so other features (the query
// panel, ADR-0005) can depend on navigation state without depending on
// check_only_on_request (see ADR-0004's "Known gap").
export class CheckpointStore {
  private checkpoints = new Map<string, Position>();

  get(uri: string): Position | undefined {
    return this.checkpoints.get(uri);
  }

  set(uri: string, position: Position): void {
    this.checkpoints.set(uri, position);
  }

  clear(): void {
    this.checkpoints.clear();
  }
}
