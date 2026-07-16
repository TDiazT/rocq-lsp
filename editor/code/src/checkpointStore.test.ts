import { describe, expect, test } from "vitest";
import { CheckpointStore } from "./checkpointStore";

describe("CheckpointStore", () => {
  test("has no checkpoint for a uri before any step", () => {
    const store = new CheckpointStore();
    expect(store.get("file:///a.v")).toBeUndefined();
  });

  test("returns the checkpoint set for a uri", () => {
    const store = new CheckpointStore();
    const pos = { line: 3, character: 6 };
    store.set("file:///a.v", pos);
    expect(store.get("file:///a.v")).toEqual(pos);
  });

  test("keeps checkpoints for different uris independent", () => {
    const store = new CheckpointStore();
    store.set("file:///a.v", { line: 1, character: 0 });
    store.set("file:///b.v", { line: 2, character: 0 });
    expect(store.get("file:///a.v")).toEqual({ line: 1, character: 0 });
    expect(store.get("file:///b.v")).toEqual({ line: 2, character: 0 });
  });

  test("clear removes checkpoints for all uris", () => {
    const store = new CheckpointStore();
    store.set("file:///a.v", { line: 1, character: 0 });
    store.clear();
    expect(store.get("file:///a.v")).toBeUndefined();
  });
});
