// 三账差异归因规则引擎 —— 纯函数，不依赖存储与 UI
import type {
  AppState,
  Attribution,
  DiffKind,
  Fuel,
  FuelEntry,
  Nozzle,
  PaymentReading,
  PumpReading,
  Shift,
  ShiftVersion,
  TankReading,
} from "./types";

export const DIFF_KINDS: DiffKind[] = ["pump-tank", "pump-money", "tank-money"];

export const DIFF_LABELS: Record<DiffKind, string> = {
  "pump-tank": "油枪账 × 罐存账（体积）",
  "pump-money": "油枪账 × 收款账（金额）",
  "tank-money": "罐存账 × 收款账（金额）",
};

export const CAUSE_LABELS: Record<"meter" | "loss" | "cash", string> = {
  meter: "设备计量",
  loss: "库存损耗",
  cash: "收款差错",
};

/** 触发规则代码，冲突列表据此向用户解释 */
export type RuleCode =
  | "SOURCE_MISSING" // 来源缺失
  | "METER_WRAP_TWICE" // 跨日回绕超过一次
  | "SHIFT_OVERLAP" // 班次时段重叠
  | "TIME_INVALID" // 结束时间不晚于开始
  | "DIFF_UNATTRIBUTED" // 差异超阈值但未归因
  | "ATTRIBUTION_WITHOUT_DIFF" // 无差异却填了归因
  | "CORRECTION_REASON_REQUIRED"; // 更正版本缺少原因

export interface ValidationIssue {
  rule: RuleCode;
  message: string;
  /** 定位信息：班次 / 油品 / 油枪 */
  shiftId?: string;
  fuelId?: string;
  nozzleId?: string;
}

/** 单油品三账换算结果（元与 L） */
export interface EntryComputation {
  fuelId: string;
  fuelName: string;
  price: number;
  pumpVolume: number | null; // 油枪泵码增量合计 L
  tankVolume: number | null; // 罐存下降量 L
  money: number | null; // 收款合计 元
  moneyByPump: number | null; // 油枪体积 × 单价
  moneyByTank: number | null; // 罐存体积 × 单价
  diffs: Record<DiffKind, { value: number; unit: "L" | "元"; exceeds: boolean } | null>;
  missing: string[]; // 缺失来源说明
}

export interface NozzleDerived {
  /** 实际增量（已按回绕次数还原） */
  delta: number | null;
  missing: string[];
  wrapInvalid: boolean;
}

function num(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** 单枪泵码增量 = end - start + wrapCount × (meterMax + 1) */
export function nozzleDelta(reading: PumpReading, nozzle: Nozzle): NozzleDerived {
  const missing: string[] = [];
  if (!num(reading.start)) missing.push("起始泵码缺失");
  if (!num(reading.end)) missing.push("结束泵码缺失");
  if (reading.wrapCount < 0) missing.push("回绕次数非法");
  if (missing.length) return { delta: null, missing, wrapInvalid: reading.wrapCount > 1 };

  const period = nozzle.meterMax + 1;
  const delta = (reading.end as number) - (reading.start as number) + reading.wrapCount * period;
  return { delta: round2(delta), missing, wrapInvalid: reading.wrapCount > 1 };
}

/** 罐存发油量 = 起 - 止 */
export function tankVolume(tank: TankReading): number | null {
  if (!num(tank.start) || !num(tank.end)) return null;
  return round2(tank.start - tank.end);
}

/** 收款合计 */
export function paymentTotal(p: PaymentReading): number | null {
  if (!num(p.cash) || !num(p.digital)) return null;
  return round2(p.cash + p.digital);
}

function nozzleMap(nozzles: Nozzle[]) {
  return new Map(nozzles.map((n) => [n.id, n]));
}

/** 计算单油品三账换算与两两差异 */
export function computeEntry(
  entry: FuelEntry,
  fuel: Fuel,
  nozzles: Nozzle[],
  thresholds: { volume: number; money: number }
): EntryComputation {
  const map = nozzleMap(nozzles);
  const missing: string[] = [];

  let pumpVolume: number | null = 0;
  if (entry.pumps.length === 0) {
    pumpVolume = null;
    missing.push("未录入油枪泵码");
  }
  for (const r of entry.pumps) {
    const nozzle = map.get(r.nozzleId);
    if (!nozzle) continue;
    const d = nozzleDelta(r, nozzle);
    if (d.delta === null) {
      pumpVolume = null;
      missing.push(`${nozzle.code} ${d.missing.join("、") || "泵码数据无效"}`);
    } else if (pumpVolume !== null) {
      pumpVolume += d.delta;
    }
  }

  const tv = tankVolume(entry.tank);
  if (tv === null) missing.push("罐存起止值缺失");

  const money = paymentTotal(entry.payment);
  if (money === null) missing.push("现金或电子收款缺失");

  pumpVolume = pumpVolume === null ? null : round2(pumpVolume);
  const moneyByPump = pumpVolume === null ? null : round2(pumpVolume * fuel.price);
  const moneyByTank = tv === null ? null : round2(tv * fuel.price);

  const diff = (a: number | null, b: number | null, unit: "L" | "元", limit: number) => {
    if (a === null || b === null) return null;
    const value = round2(a - b);
    return { value, unit, exceeds: Math.abs(value) > limit };
  };

  return {
    fuelId: fuel.id,
    fuelName: fuel.name,
    price: fuel.price,
    pumpVolume,
    tankVolume: tv,
    money,
    moneyByPump,
    moneyByTank,
    diffs: {
      "pump-tank": diff(pumpVolume, tv, "L", thresholds.volume),
      "pump-money": diff(moneyByPump, money, "元", thresholds.money),
      "tank-money": diff(moneyByTank, money, "元", thresholds.money),
    },
    missing,
  };
}

export function computeShift(
  version: ShiftVersion,
  state: Pick<AppState, "fuels" | "nozzles" | "thresholds">
): EntryComputation[] {
  return version.entries.map((entry) => {
    const fuel = state.fuels.find((f) => f.id === entry.fuelId);
    if (!fuel) {
      // 主数据缺失时仍以占位油品返回，差异无法计算
      return {
        fuelId: entry.fuelId,
        fuelName: entry.fuelId,
        price: 0,
        pumpVolume: null,
        tankVolume: null,
        money: null,
        moneyByPump: null,
        moneyByTank: null,
        diffs: { "pump-tank": null, "pump-money": null, "tank-money": null },
        missing: ["油品主数据缺失"],
      };
    }
    return computeEntry(entry, fuel, state.nozzles, state.thresholds);
  });
}

function attributionByKind(entry: FuelEntry): Map<DiffKind, Attribution> {
  return new Map(entry.attributions.map((a) => [a.kind, a]));
}

/**
 * 复核前置校验：
 * 1) 来源缺失（三账任一来源未录全）
 * 2) 跨日回绕超过一次
 * 3) 班次时段重叠（与其他班次相交）
 * 4) 三账换算差异超阈值必须归因（设备计量/库存损耗/收款差错 + 依据）
 */
export function validateForReview(
  shift: Shift,
  version: ShiftVersion,
  state: AppState
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fuelMap = new Map(state.fuels.map((f) => [f.id, f]));
  const nozzleById = nozzleMap(state.nozzles);

  const startMs = Date.parse(shift.start);
  const endMs = Date.parse(shift.end);
  if (!(startMs < endMs)) {
    issues.push({
      rule: "TIME_INVALID",
      shiftId: shift.id,
      message: "班次结束时间必须晚于开始时间",
    });
  }

  // 班次时段重叠：与任何其他班次（含其全部版本时段一致）相交
  if (startMs < endMs) {
    for (const other of state.shifts) {
      if (other.id === shift.id) continue;
      const os = Date.parse(other.start);
      const oe = Date.parse(other.end);
      if (Number.isFinite(os) && Number.isFinite(oe) && startMs < oe && os < endMs) {
        issues.push({
          rule: "SHIFT_OVERLAP",
          shiftId: shift.id,
          message: `与班次「${other.name}」时段重叠（${other.start.slice(0, 16).replace("T", " ")} ~ ${other.end.slice(11, 16)}）`,
        });
      }
    }
  }

  for (const entry of version.entries) {
    const fuel = fuelMap.get(entry.fuelId);
    const fuelName = fuel ? fuel.name : entry.fuelId;

    if (entry.nozzleIds.length === 0 || entry.pumps.length === 0) {
      issues.push({
        rule: "SOURCE_MISSING",
        shiftId: shift.id,
        fuelId: entry.fuelId,
        message: `${fuelName}：未配置油枪泵码账`,
      });
    }

    for (const r of entry.pumps) {
      const nozzle = nozzleById.get(r.nozzleId);
      const code = nozzle ? nozzle.code : r.nozzleId;
      const derived = nozzle ? nozzleDelta(r, nozzle) : null;
      if (!derived || derived.delta === null) {
        issues.push({
          rule: "SOURCE_MISSING",
          shiftId: shift.id,
          fuelId: entry.fuelId,
          nozzleId: r.nozzleId,
          message: `${fuelName} / ${code}：${derived ? derived.missing.join("、") : "油枪不存在"}`,
        });
      }
      if (r.wrapCount > 1) {
        issues.push({
          rule: "METER_WRAP_TWICE",
          shiftId: shift.id,
          fuelId: entry.fuelId,
          nozzleId: r.nozzleId,
          message: `${fuelName} / ${code}：班内跨日回绕 ${r.wrapCount} 次，超过一次`,
        });
      }
    }

    if (tankVolume(entry.tank) === null) {
      issues.push({
        rule: "SOURCE_MISSING",
        shiftId: shift.id,
        fuelId: entry.fuelId,
        message: `${fuelName}：罐存账起始或结束罐存缺失`,
      });
    }
    if (paymentTotal(entry.payment) === null) {
      issues.push({
        rule: "SOURCE_MISSING",
        shiftId: shift.id,
        fuelId: entry.fuelId,
        message: `${fuelName}：收款账现金或电子支付缺失`,
      });
    }

    if (!fuel) continue;
    const comp = computeEntry(entry, fuel, state.nozzles, state.thresholds);
    const attrs = attributionByKind(entry);

    for (const kind of DIFF_KINDS) {
      const d = comp.diffs[kind];
      const attr = attrs.get(kind);
      if (d && d.exceeds) {
        if (!attr || !attr.cause) {
          issues.push({
            rule: "DIFF_UNATTRIBUTED",
            shiftId: shift.id,
            fuelId: entry.fuelId,
            message: `${fuelName}：${DIFF_LABELS[kind]}差异 ${d.value}${d.unit} 超阈值，必须选择差异原因`,
          });
        } else if (!attr.evidence.trim()) {
          issues.push({
            rule: "DIFF_UNATTRIBUTED",
            shiftId: shift.id,
            fuelId: entry.fuelId,
            message: `${fuelName}：${DIFF_LABELS[kind]}已归因「${CAUSE_LABELS[attr.cause]}」但未填写依据`,
          });
        }
      } else if (attr && (attr.cause || attr.evidence.trim())) {
        issues.push({
          rule: "ATTRIBUTION_WITHOUT_DIFF",
          shiftId: shift.id,
          fuelId: entry.fuelId,
          message: `${fuelName}：${DIFF_LABELS[kind]}未超阈值，不应填写归因`,
        });
      }
    }
  }

  return issues;
}

/** 校验“带原因生成新版本” */
export function validateCorrection(version: ShiftVersion, reason: string): ValidationIssue[] {
  if (version.status !== "reviewed") return [];
  if (!reason.trim()) {
    return [
      {
        rule: "CORRECTION_REASON_REQUIRED",
        message: "对已复核班次进行更正，必须填写更正原因",
      },
    ];
  }
  return [];
}

/**
 * 继承上一班结束泵码：
 * 同一油枪、按班次开始时间排序，取紧邻前序班次最新版本里的结束泵码。
 */
export function inheritedStartMeter(
  state: AppState,
  nozzleId: string,
  shift: Pick<Shift, "id" | "start">
): number | null {
  const prior = state.shifts
    .filter((s) => s.id !== shift.id && Date.parse(s.start) < Date.parse(shift.start))
    .sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  for (const s of prior) {
    const v = latestVersion(s);
    const entry = v.entries.find((e) => e.nozzleIds.includes(nozzleId));
    const reading = entry?.pumps.find((p) => p.nozzleId === nozzleId);
    if (reading && typeof reading.end === "number") return reading.end;
  }
  return null;
}

/** 班次链序号（按开始时间），用于展示 */
export function shiftChainIndex(state: AppState, shiftId: string): number {
  return [...state.shifts]
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .findIndex((s) => s.id === shiftId);
}

export function latestVersion(shift: Shift): ShiftVersion {
  return [...shift.versions].sort((a, b) => b.versionNo - a.versionNo)[0];
}

export function reviewedVersions(shift: Shift): ShiftVersion[] {
  return shift.versions.filter((v) => v.status === "reviewed");
}
