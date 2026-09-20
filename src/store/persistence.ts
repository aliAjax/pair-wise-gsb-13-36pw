/**
 * 持久化层：localStorage 读写 + 演示种子数据。
 * 只负责存取 ShiftEntry 数组，班次链 / 版本关系由归因规则层在加载后重建。
 */
import type { ShiftEntry } from "../domain/attribution";

const STORAGE_KEY = "dfwlfront-7-attribution";

const DAY_MS = 24 * 3600 * 1000;

function fmtDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function day(offset: number): string {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  return fmtDate(new Date(base.getTime() - offset * DAY_MS));
}

function iso(offsetDays: number, hour: number): string {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  return new Date(base.getTime() - offsetDays * DAY_MS + hour * 3600 * 1000).toISOString();
}

/** 种子数据：覆盖已复核冻结、版本更正、超阈值待归因、来源缺失、时段重叠、回绕超一次。 */
function seed(): ShiftEntry[] {
  return [
    // 链 A：92# 早班，v1 已复核（泵罐差 80L 超阈值，归因库存损耗）
    {
      id: "seed-a-v1", chainId: "seed-a", version: 1, parentId: null, correctionReason: null,
      shiftName: "早班", fuel: "92#汽油", date: day(2), startTime: "06:00", endTime: "14:00",
      pumpStart: 120000, pumpEnd: 128400, wraps: 0,
      tankStart: 32000, tankEnd: 23680, payment: 65940, price: 7.85,
      status: "已复核",
      attribution: { type: "库存损耗", basis: "罐区温度计故障，按经验损耗率核销" },
      createdAt: iso(2, 14),
    },
    // 链 A：v2 更正（罐存读数抄错），已复核，三账一致无需归因
    {
      id: "seed-a-v2", chainId: "seed-a", version: 2, parentId: "seed-a-v1",
      correctionReason: "罐存止数抄错，23680 更正为 23620",
      shiftName: "早班", fuel: "92#汽油", date: day(2), startTime: "06:00", endTime: "14:00",
      pumpStart: 120000, pumpEnd: 128400, wraps: 0,
      tankStart: 32000, tankEnd: 23620, payment: 65940, price: 7.85,
      status: "已复核", attribution: null,
      createdAt: iso(2, 18),
    },
    // 链 B：92# 中班，收款差 330 元超阈值，待归因
    {
      id: "seed-b-v1", chainId: "seed-b", version: 1, parentId: null, correctionReason: null,
      shiftName: "中班", fuel: "92#汽油", date: day(1), startTime: "14:00", endTime: "22:00",
      pumpStart: 128400, pumpEnd: 136200, wraps: 0,
      tankStart: 23620, tankEnd: 15850, payment: 60900, price: 7.85,
      status: "待复核", attribution: null,
      createdAt: iso(1, 22),
    },
    // 链 C：0# 晚班跨日，泵罐差 100L 超阈值，待归因
    {
      id: "seed-c-v1", chainId: "seed-c", version: 1, parentId: null, correctionReason: null,
      shiftName: "晚班", fuel: "0#柴油", date: day(1), startTime: "22:00", endTime: "06:00",
      pumpStart: 500000, pumpEnd: 508000, wraps: 0,
      tankStart: 41000, tankEnd: 33100, payment: 57600, price: 7.2,
      status: "待复核", attribution: null,
      createdAt: iso(0, 6),
    },
    // 链 D：95# 早班，收款合计缺失 → R1
    {
      id: "seed-d-v1", chainId: "seed-d", version: 1, parentId: null, correctionReason: null,
      shiftName: "早班", fuel: "95#汽油", date: day(0), startTime: "06:00", endTime: "14:00",
      pumpStart: 80000, pumpEnd: 84500, wraps: 0,
      tankStart: 25000, tankEnd: 20560, payment: null, price: 7.95,
      status: "待复核", attribution: null,
      createdAt: iso(0, 14),
    },
    // 链 E：95# 中班 12:00 开始，与链 D（06:00-14:00）时段重叠 → R3
    {
      id: "seed-e-v1", chainId: "seed-e", version: 1, parentId: null, correctionReason: null,
      shiftName: "中班", fuel: "95#汽油", date: day(0), startTime: "12:00", endTime: "20:00",
      pumpStart: 84500, pumpEnd: 87200, wraps: 0,
      tankStart: 20560, tankEnd: 17900, payment: 21465, price: 7.95,
      status: "待复核", attribution: null,
      createdAt: iso(0, 20),
    },
    // 链 F：0# 早班，泵码回绕 2 次 → R2
    {
      id: "seed-f-v1", chainId: "seed-f", version: 1, parentId: null, correctionReason: null,
      shiftName: "早班", fuel: "0#柴油", date: day(0), startTime: "06:00", endTime: "14:00",
      pumpStart: 998000, pumpEnd: 3000, wraps: 2,
      tankStart: 33100, tankEnd: 27200, payment: 42480, price: 7.2,
      status: "待复核", attribution: null,
      createdAt: iso(0, 14),
    },
  ];
}

export function loadEntries(): ShiftEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as ShiftEntry[];
    }
  } catch {
    // 数据损坏时回落到种子数据
  }
  const seeded = seed();
  persist(seeded);
  return seeded;
}

export function persist(entries: ShiftEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function resetEntries(): ShiftEntry[] {
  const seeded = seed();
  persist(seeded);
  return seeded;
}
