import { test } from "node:test";
import assert from "node:assert";
import { nozzleDelta, validateForReview, inheritedStartMeter, latestVersion, computeShift } from "../src/domain/rules";
import type { AppState } from "../src/domain/types";
import { createSeedState } from "../src/domain/seed";

test("泵码增量按回绕次数还原", () => {
  const nozzle = { id: "n1", fuelId: "f92" as const, code: "g", meterMax: 99999 };
  assert.equal(nozzleDelta({ nozzleId: "n1", start: 99950, end: 60, wrapCount: 1 }, nozzle).delta, 110);
  assert.equal(nozzleDelta({ nozzleId: "n1", start: 10, end: 20, wrapCount: 0 }, nozzle).delta, 10);
  assert.equal(nozzleDelta({ nozzleId: "n1", start: null, end: 20, wrapCount: 0 }, nozzle).delta, null);
  assert.equal(nozzleDelta({ nozzleId: "n1", start: 1, end: 2, wrapCount: 2 }, nozzle).wrapInvalid, true);
});

test("种子数据：s1 最新版本三账一致可复核，s2 差异未归因不可复核，s3 回绕阻塞，s4 重叠阻塞", () => {
  const state = createSeedState();
  const expectOk = (id: string, ok: boolean) => {
    const s = state.shifts.find((x) => x.id === id)!;
    const issues = validateForReview(s, latestVersion(s), state);
    assert.equal(issues.length === 0, ok, `${id}: ${issues.map((i) => i.message).join("; ")}`);
  };
  expectOk("s1", true);
  expectOk("s2", false);
  expectOk("s3", false);
  expectOk("s4", false);

  const s2 = state.shifts.find((x) => x.id === "s2")!;
  const issues2 = validateForReview(s2, latestVersion(s2), state);
  assert.ok(issues2.some((i) => i.rule === "DIFF_UNATTRIBUTED"));
  const s3 = state.shifts.find((x) => x.id === "s3")!;
  assert.ok(validateForReview(s3, latestVersion(s3), state).some((i) => i.rule === "METER_WRAP_TWICE"));
  const s4 = state.shifts.find((x) => x.id === "s4")!;
  assert.ok(validateForReview(s4, latestVersion(s4), state).some((i) => i.rule === "SHIFT_OVERLAP"));
});

test("s2 差异归因（库存损耗+依据、收款差错+依据）后可复核", () => {
  const state = createSeedState();
  const s2 = state.shifts.find((x) => x.id === "s2")!;
  const v = latestVersion(s2);
  const entry = v.entries.find((e) => e.fuelId === "f92")!;
  const comps = computeShift(v, state);
  const f92 = comps.find((c) => c.fuelId === "f92")!;
  assert.ok(f92.diffs["pump-tank"]?.exceeds);
  assert.ok(f92.diffs["tank-money"]?.exceeds);
  for (const a of entry.attributions) {
    if (a.kind === "pump-tank") {
      a.cause = "loss";
      a.evidence = "液位仪校罐记录 JL-0918，罐存温损 50.5L";
    }
    if (a.kind === "tank-money") {
      a.cause = "loss";
      a.evidence = "同属罐存损耗造成的金额差";
    }
  }
  const issues = validateForReview(s2, v, state);
  assert.equal(issues.length, 0, issues.map((i) => i.message).join("; "));
});

test("来源缺失不能复核；更正必须带原因且生成新版本草稿", () => {
  const state = createSeedState();
  const s1 = state.shifts.find((x) => x.id === "s1")!;
  const reviewed = latestVersion(s1);
  assert.equal(reviewed.status, "reviewed");
  // 模拟复制出更正草稿后清空一个收款字段
  const draft: AppState["shifts"][number]["versions"][number] = JSON.parse(JSON.stringify(reviewed));
  draft.id = "new";
  draft.status = "draft";
  draft.baseVersionId = reviewed.id;
  draft.reason = "补录";
  draft.versionNo = 3;
  draft.entries[0].payment.digital = null;
  s1.versions.push(draft);
  const issues = validateForReview(s1, draft, state);
  assert.ok(issues.some((i) => i.rule === "SOURCE_MISSING"));
});

test("起始泵码继承：s2 的 n1/n2 起始 = s1 v2 结束，新班次继承 s2 结束", () => {
  const state = createSeedState();
  const s2 = state.shifts.find((x) => x.id === "s2")!;
  assert.equal(inheritedStartMeter(state, "n1", { id: "new", start: "2026-09-18T23:00" }), 16340);
  assert.equal(inheritedStartMeter(state, "n2", { id: "new", start: "2026-09-18T23:00" }), 12521);
  assert.equal(inheritedStartMeter(state, "n1", s2), 14120.5);
});
