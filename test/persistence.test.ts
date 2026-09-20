import { test, beforeEach } from "node:test";
import assert from "node:assert";
import { loadState, saveState, resetState } from "../src/persistence/store";
import { latestVersion, validateForReview } from "../src/domain/rules";
import type { AppState } from "../src/domain/types";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = memoryStorage();
});

test("首次加载写入种子；再次加载（模拟刷新）班次链/版本关系一致", () => {
  const first = loadState();
  assert.equal(first.shifts.length, 4);
  const s1 = first.shifts.find((s) => s.id === "s1")!;
  assert.equal(s1.versions.length, 2);
  assert.equal(s1.versions[1].baseVersionId, s1.versions[0].id);

  // 做一次复核动作后保存，再重新加载
  const s2 = first.shifts.find((s) => s.id === "s2")!;
  const v = latestVersion(s2);
  const f92 = v.entries.find((e) => e.fuelId === "f92")!;
  for (const a of f92.attributions) {
    if (a.kind === "pump-tank" || a.kind === "tank-money") {
      a.cause = "loss";
      a.evidence = "校罐记录 JL-0918";
    }
  }
  // s4 与 s3 重叠无法复核：删除 s4 后 s3 仍因回绕 2 次被阻塞
  first.shifts = first.shifts.filter((s) => s.id !== "s4");
  const s3 = first.shifts.find((s) => s.id === "s3")!;
  assert.ok(validateForReview(s3, latestVersion(s3), first).some((i) => i.rule === "METER_WRAP_TWICE"));
  const reviewIssues = validateForReview(s2, v, first);
  assert.equal(reviewIssues.length, 0);
  v.status = "reviewed";
  v.reviewedAt = "2026-09-18T23:10:00";
  saveState(first);

  // 模拟刷新
  const reloaded = loadState();
  assert.equal(reloaded.shifts.length, 3);
  const s2r = reloaded.shifts.find((s) => s.id === "s2")!;
  assert.equal(latestVersion(s2r).status, "reviewed");
  assert.equal(latestVersion(s2r).entries.find((e) => e.fuelId === "f92")!.attributions[0].evidence, "校罐记录 JL-0918");
  const s1r = reloaded.shifts.find((s) => s.id === "s1")!;
  assert.equal(s1r.versions[1].baseVersionId, s1r.versions[0].id);
});

test("存储结构损坏时回退种子数据", () => {
  localStorage.setItem("gas-shift-reconcile-v1", "{not-json");
  const state = loadState();
  assert.equal(state.shifts.length, 4);
});

test("resetState 恢复种子并持久化", () => {
  loadState();
  const state = resetState();
  assert.equal(state.shifts.length, 4);
  assert.ok(localStorage.getItem("gas-shift-reconcile-v1")!.includes("s1"));
});
