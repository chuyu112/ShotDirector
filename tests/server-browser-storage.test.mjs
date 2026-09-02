import assert from "node:assert/strict";
import test from "node:test";
import { manjingBrowserStorageInternals, manjingServerScope } from "../app/manjing-browser-storage.mjs";

class MemoryStorage {
  constructor() { this.values = new Map(); }
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
}

test("browser drafts are isolated by user and project and clear only the active scope", () => {
  const storage = new MemoryStorage();
  const first = manjingBrowserStorageInternals.scopedStorage(storage, manjingServerScope("user-a", "project-1"));
  const second = manjingBrowserStorageInternals.scopedStorage(storage, manjingServerScope("user-a", "project-2"));
  const other = manjingBrowserStorageInternals.scopedStorage(storage, manjingServerScope("user-b", "project-1"));

  first.setItem("draft", "first");
  second.setItem("draft", "second");
  other.setItem("draft", "other");
  assert.equal(first.getItem("draft"), "first");
  assert.equal(second.getItem("draft"), "second");
  assert.equal(other.getItem("draft"), "other");

  second.clear();
  assert.equal(second.getItem("draft"), null);
  assert.equal(first.getItem("draft"), "first");
  assert.equal(other.getItem("draft"), "other");
});
