// 应用状态编排：把领域规则与持久化层粘合起来，供页面调用
import { defineStore } from "pinia";
import type { AppState, Attribution, FuelEntry, PaymentReading, PumpReading, Shift, TankReading } from "../domain/types";
import {
  DIFF_KINDS,
  inheritedStartMeter,
  latestVersion,
  validateCorrection,
  validateForReview,
  type ValidationIssue,
} from "../domain/rules";
import { loadState, resetState, saveState } from "../persistence/store";

function blankAttributions(): Attribution[] {
  return DIFF_KINDS.map((kind) => ({ kind, cause: "", evidence: "" }));
}

interface State {
  data: AppState;
}

export const useShiftStore = defineStore("shifts", {
  state: (): State => ({ data: loadState() }),

  getters: {
    fuels: (s) => s.data.fuels,
    nozzles: (s) => s.data.nozzles,
    thresholds: (s) => s.data.thresholds,
    /** 按开始时间排序的班次链 */
    chain(state): Shift[] {
      return [...state.data.shifts].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    },
  },

  actions: {
    persist() {
      saveState(this.data);
    },

    resetAll() {
      this.data = resetState();
    },

    getShift(id: string): Shift | undefined {
      return this.data.shifts.find((s) => s.id === id);
    },

    latest(id: string): ShiftVersionLike | undefined {
      const shift = this.getShift(id);
      return shift ? latestVersion(shift) : undefined;
    },

    /** 新建班次：v1 草稿，起始泵码自动继承同枪上一班结束泵码 */
    createShift(name: string, start: string, end: string): { ok: boolean; issues: ValidationIssue[] } {
      const shift: Shift = {
        id: crypto.randomUUID(),
        name: name.trim() || "未命名班次",
        start,
        end,
        versions: [
          {
            id: crypto.randomUUID(),
            versionNo: 1,
            status: "draft",
            createdAt: new Date().toISOString(),
            reviewedAt: null,
            reason: "",
            baseVersionId: null,
            entries: [],
          },
        ],
      };
      shift.versions[0].entries = this.data.fuels.map((fuel) => {
        const nozzleIds = this.data.nozzles.filter((n) => n.fuelId === fuel.id).map((n) => n.id);
        const pumps: PumpReading[] = nozzleIds.map((nozzleId) => ({
          nozzleId,
          start: inheritedStartMeter(this.data, nozzleId, shift),
          end: null,
          wrapCount: 0,
        }));
        const entry: FuelEntry = {
          fuelId: fuel.id,
          nozzleIds,
          pumps,
          tank: { start: null, end: null },
          payment: { cash: null, digital: null },
          attributions: blankAttributions(),
        };
        return entry;
      });
      this.data.shifts.push(shift);
      this.persist();
      return { ok: true, issues: [] };
    },

    updateShiftMeta(id: string, patch: Pick<Shift, "name" | "start" | "end">) {
      const shift = this.getShift(id);
      if (!shift || latestVersion(shift).status === "reviewed") return;
      Object.assign(shift, patch);
      this.persist();
    },

    /** 仅草稿版本可改三账原始值；已复核版本冻结 */
    updatePump(shiftId: string, fuelId: string, nozzleId: string, patch: Partial<PumpReading>) {
      const entry = this.draftEntry(shiftId, fuelId);
      const reading = entry?.pumps.find((p) => p.nozzleId === nozzleId);
      if (reading) Object.assign(reading, patch);
      this.persist();
    },

    updateTank(shiftId: string, fuelId: string, patch: Partial<TankReading>) {
      const entry = this.draftEntry(shiftId, fuelId);
      if (entry) Object.assign(entry.tank, patch);
      this.persist();
    },

    updatePayment(shiftId: string, fuelId: string, patch: Partial<PaymentReading>) {
      const entry = this.draftEntry(shiftId, fuelId);
      if (entry) Object.assign(entry.payment, patch);
      this.persist();
    },

    setAttribution(shiftId: string, fuelId: string, kind: Attribution["kind"], patch: Partial<Attribution>) {
      const entry = this.draftEntry(shiftId, fuelId);
      const attr = entry?.attributions.find((a) => a.kind === kind);
      if (attr) Object.assign(attr, patch);
      this.persist();
    },

    /** 复核：全部规则通过才冻结当前版本的原始三账 */
    review(shiftId: string): { ok: boolean; issues: ValidationIssue[] } {
      const shift = this.getShift(shiftId);
      if (!shift) return { ok: false, issues: [{ rule: "SOURCE_MISSING", message: "班次不存在" }] };
      const version = latestVersion(shift);
      if (version.status === "reviewed") return { ok: false, issues: [] };
      const issues = validateForReview(shift, version, this.data);
      if (issues.length) return { ok: false, issues };
      version.status = "reviewed";
      version.reviewedAt = new Date().toISOString();
      this.persist();
      return { ok: true, issues: [] };
    },

    /** 补充更正：已冻结版本不可改，只能带原因生成新版本（草稿） */
    correct(shiftId: string, reason: string): { ok: boolean; issues: ValidationIssue[] } {
      const shift = this.getShift(shiftId);
      if (!shift) return { ok: false, issues: [{ rule: "SOURCE_MISSING", message: "班次不存在" }] };
      const base = latestVersion(shift);
      const reasonIssues = validateCorrection(base, reason);
      if (reasonIssues.length) return { ok: false, issues: reasonIssues };
      const copy: Shift["versions"][number] = JSON.parse(JSON.stringify(base));
      const next = {
        ...copy,
        id: crypto.randomUUID(),
        versionNo: base.versionNo + 1,
        status: "draft" as const,
        createdAt: new Date().toISOString(),
        reviewedAt: null,
        reason: reason.trim(),
        baseVersionId: base.id,
      };
      shift.versions.push(next);
      this.persist();
      return { ok: true, issues: [] };
    },

    deleteDraft(shiftId: string) {
      const shift = this.getShift(shiftId);
      if (!shift) return;
      if (shift.versions.some((v) => v.status === "reviewed")) return;
      this.data.shifts = this.data.shifts.filter((s) => s.id !== shiftId);
      this.persist();
    },

    draftEntry(shiftId: string, fuelId: string): FuelEntry | undefined {
      const shift = this.getShift(shiftId);
      if (!shift) return undefined;
      const version = latestVersion(shift);
      if (version.status === "reviewed") return undefined;
      return version.entries.find((e) => e.fuelId === fuelId);
    },
  },
});

type ShiftVersionLike = ReturnType<typeof latestVersion>;
