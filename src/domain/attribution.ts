/**
 * 归因规则层：纯函数，不依赖 Vue / localStorage。
 * 负责三账换算、复核拦截规则（R1-R3）、超阈值归因要求（D1-D2）、班次链与版本关系。
 */

export type AttributionType = "设备计量" | "库存损耗" | "收款差错";
export const ATTRIBUTION_TYPES: readonly AttributionType[] = ["设备计量", "库存损耗", "收款差错"];

export const SHIFT_NAMES = ["早班", "中班", "晚班"] as const;
export const FUELS = ["92#汽油", "95#汽油", "0#柴油"] as const;

/** 泵码表头量程，回绕一次即累计一个量程 */
export const METER_MAX = 1_000_000;
/** 泵罐体积差阈值（升） */
export const VOLUME_THRESHOLD_L = 60;
/** 收款金额差阈值（元） */
export const AMOUNT_THRESHOLD_YUAN = 200;

export interface Attribution {
  type: AttributionType;
  basis: string;
}

export interface ShiftEntry {
  id: string;
  /** 同一班次所有更正版本共享的链 id */
  chainId: string;
  version: number;
  parentId: string | null;
  /** 更正版本必填的原因 */
  correctionReason: string | null;
  shiftName: string;
  fuel: string;
  date: string; // YYYY-MM-DD，班次开始日
  startTime: string; // HH:mm
  endTime: string; // HH:mm，不大于开始时间视为跨日
  pumpStart: number | null; // 继承上一班结束泵码
  pumpEnd: number | null;
  wraps: number; // 泵码跨日回绕次数
  tankStart: number | null;
  tankEnd: number | null;
  payment: number | null; // 收款合计（元）
  price: number; // 油品单价（元/升）
  status: "待复核" | "已复核";
  attribution: Attribution | null;
  createdAt: string;
}

export interface ThreeAccounts {
  pumpVolume: number | null; // 泵码账体积（升）
  tankVolume: number | null; // 罐存账体积（升）
  paymentAmount: number | null; // 收款账金额（元）
  paymentVolume: number | null; // 收款账折算体积（升）
  amountByPump: number | null; // 泵码账折算金额（元）
}

export interface Conflict {
  code: "R1" | "R2" | "R3";
  label: string;
  detail: string;
}

export interface DiffFlag {
  code: "D1" | "D2";
  label: string;
  value: number;
  threshold: number;
  unit: "L" | "元";
  suggest: AttributionType[];
}

export interface Evaluation {
  accounts: ThreeAccounts;
  conflicts: Conflict[];
  diffs: DiffFlag[];
}

export interface ReviewCheck extends Evaluation {
  needsAttribution: boolean;
  attributionOk: boolean;
  ok: boolean;
}

const DAY_MS = 24 * 3600 * 1000;

export interface Interval {
  start: number;
  end: number;
}

/** 班次时段；结束时间不大于开始时间按跨日处理。日期非法时返回 NaN。 */
export function toInterval(entry: Pick<ShiftEntry, "date" | "startTime" | "endTime">): Interval {
  const start = new Date(`${entry.date}T${entry.startTime}:00`).getTime();
  let end = new Date(`${entry.date}T${entry.endTime}:00`).getTime();
  if (!Number.isNaN(start) && !Number.isNaN(end) && end <= start) end += DAY_MS;
  return { start, end };
}

/** 泵码账体积：处理回绕；止数小于起数且未声明回绕时视为无效。 */
export function pumpVolumeOf(entry: Pick<ShiftEntry, "pumpStart" | "pumpEnd" | "wraps">): number | null {
  if (entry.pumpStart == null || entry.pumpEnd == null) return null;
  if (entry.pumpEnd < entry.pumpStart && entry.wraps === 0) return null;
  const delta = entry.pumpEnd - entry.pumpStart + entry.wraps * METER_MAX;
  return delta >= 0 ? delta : null;
}

/** 罐存账体积：罐存减少量即当班付出。 */
export function tankVolumeOf(entry: Pick<ShiftEntry, "tankStart" | "tankEnd">): number | null {
  if (entry.tankStart == null || entry.tankEnd == null) return null;
  return entry.tankStart - entry.tankEnd;
}

export function threeAccounts(entry: ShiftEntry): ThreeAccounts {
  const pumpVolume = pumpVolumeOf(entry);
  const tankVolume = tankVolumeOf(entry);
  const paymentAmount = entry.payment;
  const paymentVolume = entry.payment != null && entry.price > 0 ? entry.payment / entry.price : null;
  const amountByPump = pumpVolume != null && entry.price > 0 ? pumpVolume * entry.price : null;
  return { pumpVolume, tankVolume, paymentAmount, paymentVolume, amountByPump };
}

/**
 * 评估单条班次（peers 传全部链的最新版本即可，函数内部按 chainId 排除自身）。
 * R1 来源缺失 / R2 跨日回绕超过一次 / R3 班次时段重叠 → 不可复核；
 * D1 泵罐体积差、D2 收款金额差超阈值 → 必须归因。
 */
export function evaluate(entry: ShiftEntry, peers: ShiftEntry[]): Evaluation {
  const conflicts: Conflict[] = [];

  const missing: string[] = [];
  if (!entry.date || !entry.startTime || !entry.endTime) missing.push("班次时段");
  if (entry.pumpStart == null) missing.push("泵码起数");
  if (entry.pumpEnd == null) missing.push("泵码止数");
  if (entry.tankStart == null) missing.push("罐存起数");
  if (entry.tankEnd == null) missing.push("罐存止数");
  if (entry.payment == null) missing.push("收款合计");
  if (!(entry.price > 0)) missing.push("油品单价");
  if (missing.length > 0) {
    conflicts.push({ code: "R1", label: "来源缺失", detail: `缺少：${missing.join("、")}` });
  }

  if (entry.pumpStart != null && entry.pumpEnd != null) {
    if (entry.pumpEnd < entry.pumpStart && entry.wraps === 0) {
      conflicts.push({
        code: "R2",
        label: "跨日回绕未声明",
        detail: `泵码止数 ${entry.pumpEnd} 小于起数 ${entry.pumpStart}，但回绕次数为 0`,
      });
    } else if (entry.wraps > 1) {
      conflicts.push({
        code: "R2",
        label: "跨日回绕超过一次",
        detail: `声明回绕 ${entry.wraps} 次，超过一次无法复核`,
      });
    }
  }

  const me = toInterval(entry);
  if (!Number.isNaN(me.start) && !Number.isNaN(me.end)) {
    for (const peer of peers) {
      if (peer.chainId === entry.chainId || peer.fuel !== entry.fuel) continue;
      const other = toInterval(peer);
      if (Number.isNaN(other.start) || Number.isNaN(other.end)) continue;
      if (me.start < other.end && other.start < me.end) {
        conflicts.push({
          code: "R3",
          label: "班次时段重叠",
          detail: `与「${peer.date} ${peer.shiftName}（${peer.startTime}-${peer.endTime}）」时段重叠`,
        });
      }
    }
  }

  const accounts = threeAccounts(entry);
  const diffs: DiffFlag[] = [];
  if (accounts.pumpVolume != null && accounts.tankVolume != null) {
    const value = Math.abs(accounts.pumpVolume - accounts.tankVolume);
    if (value > VOLUME_THRESHOLD_L) {
      diffs.push({ code: "D1", label: "泵罐体积差", value, threshold: VOLUME_THRESHOLD_L, unit: "L", suggest: ["设备计量", "库存损耗"] });
    }
  }
  if (accounts.amountByPump != null && accounts.paymentAmount != null) {
    const value = Math.abs(accounts.amountByPump - accounts.paymentAmount);
    if (value > AMOUNT_THRESHOLD_YUAN) {
      diffs.push({ code: "D2", label: "收款金额差", value, threshold: AMOUNT_THRESHOLD_YUAN, unit: "元", suggest: ["收款差错"] });
    }
  }

  return { accounts, conflicts, diffs };
}

/** 复核闸门：无拦截冲突，且超阈值差异已选择归因类型并填写依据。 */
export function reviewCheck(entry: ShiftEntry, peers: ShiftEntry[], attribution: Attribution | null): ReviewCheck {
  const evaluation = evaluate(entry, peers);
  const needsAttribution = evaluation.diffs.length > 0;
  const attributionOk =
    !needsAttribution ||
    (!!attribution &&
      ATTRIBUTION_TYPES.includes(attribution.type) &&
      attribution.basis.trim().length > 0);
  return {
    ...evaluation,
    needsAttribution,
    attributionOk,
    ok: evaluation.conflicts.length === 0 && attributionOk,
  };
}

/** 每条链取最高版本，得到当前班次链。 */
export function latestVersions(entries: ShiftEntry[]): ShiftEntry[] {
  const map = new Map<string, ShiftEntry>();
  for (const entry of entries) {
    const current = map.get(entry.chainId);
    if (!current || entry.version > current.version) map.set(entry.chainId, entry);
  }
  return [...map.values()];
}

/** 同一班次的版本链，按版本号倒序（当前版本在前）。 */
export function versionsOf(entries: ShiftEntry[], chainId: string): ShiftEntry[] {
  return entries.filter((entry) => entry.chainId === chainId).sort((a, b) => b.version - a.version);
}

/**
 * 继承上一班结束泵码：同油品、时段结束早于本班开始的最晚一班。
 * beforeStart 缺省时取全站同油品最晚一班。
 */
export function inheritPumpStart(entries: ShiftEntry[], fuel: string, beforeStart?: number): number | null {
  let best: { end: number; pumpEnd: number } | null = null;
  for (const entry of latestVersions(entries)) {
    if (entry.fuel !== fuel || entry.pumpEnd == null) continue;
    const interval = toInterval(entry);
    if (Number.isNaN(interval.end)) continue;
    if (beforeStart != null && !Number.isNaN(beforeStart) && interval.end > beforeStart) continue;
    if (!best || interval.end > best.end) best = { end: interval.end, pumpEnd: entry.pumpEnd };
  }
  return best ? best.pumpEnd : null;
}
