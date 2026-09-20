// 初始演示数据：覆盖一致、差异待归因、回绕阻塞、时段冲突、版本更正链等场景
import type { AppState, FuelEntry, Shift, ShiftVersion } from "./types";
import { DIFF_KINDS } from "./rules";

function blankAttributions() {
  return DIFF_KINDS.map((kind) => ({ kind, cause: "" as const, evidence: "" }));
}

function v(
  versionNo: number,
  status: "draft" | "reviewed",
  entries: FuelEntry[],
  extra: Partial<ShiftVersion> = {}
): ShiftVersion {
  return {
    id: crypto.randomUUID(),
    versionNo,
    status,
    createdAt: new Date().toISOString(),
    reviewedAt: status === "reviewed" ? new Date().toISOString() : null,
    reason: "",
    baseVersionId: null,
    entries,
    ...extra,
  };
}

const fuels = [
  { id: "f92" as const, name: "92#汽油", price: 7.62, tankCapacity: 30000 },
  { id: "f95" as const, name: "95#汽油", price: 8.11, tankCapacity: 20000 },
  { id: "f0" as const, name: "0#柴油", price: 7.28, tankCapacity: 30000 },
];

const nozzles = [
  { id: "n1", fuelId: "f92" as const, code: "92-1号枪", meterMax: 99999 },
  { id: "n2", fuelId: "f92" as const, code: "92-2号枪", meterMax: 99999 },
  { id: "n3", fuelId: "f95" as const, code: "95-1号枪", meterMax: 99999 },
  { id: "n4", fuelId: "f0" as const, code: "0-1号枪", meterMax: 99999 },
];

// 已复核班次：三账一致；v2 是带原因的更正版本（v1 电子支付尾数少录 20 元，差 20 元未超 100 阈值）
const s1Reviewed: Shift = {
  id: "s1",
  name: "09-18 早班",
  start: "2026-09-18T07:00",
  end: "2026-09-18T15:00",
  versions: [
    v(
      1,
      "reviewed",
      [
        {
          fuelId: "f92",
          nozzleIds: ["n1", "n2"],
          pumps: [
            { nozzleId: "n1", start: 12000, end: 14120.5, wrapCount: 0 },
            { nozzleId: "n2", start: 8400, end: 10510.0, wrapCount: 0 },
          ],
          tank: { start: 24800, end: 20569.5 },
          payment: { cash: 9860, digital: 22356.41 },
          attributions: blankAttributions(),
        },
        {
          fuelId: "f95",
          nozzleIds: ["n3"],
          pumps: [{ nozzleId: "n3", start: 21000, end: 22380, wrapCount: 0 }],
          tank: { start: 15600, end: 14220 },
          payment: { cash: 3100, digital: 8091.8 },
          attributions: blankAttributions(),
        },
      ],
      { createdAt: "2026-09-18T15:05:00", reviewedAt: "2026-09-18T15:20:00" }
    ),
    v(
      2,
      "reviewed",
      [
        {
          fuelId: "f92",
          nozzleIds: ["n1", "n2"],
          // 更正：电子支付尾数少录 20 元，补录后三账一致
          pumps: [
            { nozzleId: "n1", start: 12000, end: 14120.5, wrapCount: 0 },
            { nozzleId: "n2", start: 8400, end: 10510.0, wrapCount: 0 },
          ],
          tank: { start: 24800, end: 20569.5 },
          payment: { cash: 9860, digital: 22376.41 },
          attributions: blankAttributions(),
        },
        {
          fuelId: "f95",
          nozzleIds: ["n3"],
          pumps: [{ nozzleId: "n3", start: 21000, end: 22380, wrapCount: 0 }],
          tank: { start: 15600, end: 14220 },
          payment: { cash: 3100, digital: 8091.8 },
          attributions: blankAttributions(),
        },
      ],
      {
        createdAt: "2026-09-18T16:00:00",
        reviewedAt: "2026-09-18T16:10:00",
        reason: "财务对账发现92#电子支付尾数少录20元，补录后三账一致",
      }
    ),
  ],
};
s1Reviewed.versions[1].baseVersionId = s1Reviewed.versions[0].id;

// 待复核班次：92# 罐存少 50.5L（超体积阈值）、罐存折金额差 384.8 元，两处差异均待归因
const s2Draft: Shift = {
  id: "s2",
  name: "09-18 中班",
  start: "2026-09-18T15:00",
  end: "2026-09-18T23:00",
  versions: [
    v(1, "draft", [
      {
        fuelId: "f92",
        nozzleIds: ["n1", "n2"],
        // 起始泵码继承 s1 v2 结束泵码
        pumps: [
          { nozzleId: "n1", start: 14120.5, end: 16340.0, wrapCount: 0 },
          { nozzleId: "n2", start: 10510.0, end: 12521.0, wrapCount: 0 },
        ],
        tank: { start: 20569.5, end: 16389.5 },
        payment: { cash: 7200, digital: 25036.41 },
        attributions: blankAttributions(),
      },
      {
        fuelId: "f0",
        nozzleIds: ["n4"],
        pumps: [{ nozzleId: "n4", start: 30000, end: 31200, wrapCount: 0 }],
        tank: { start: 18900, end: 17700 },
        payment: { cash: 2600, digital: 6136 },
        attributions: blankAttributions(),
      },
    ]),
  ],
};

// 阻塞班次：92-2号枪班内回绕 2 次 → 不能复核
const s3Wrap: Shift = {
  id: "s3",
  name: "09-18 晚班",
  start: "2026-09-18T23:00",
  end: "2026-09-19T07:00",
  versions: [
    v(1, "draft", [
      {
        fuelId: "f92",
        nozzleIds: ["n1", "n2"],
        pumps: [
          { nozzleId: "n1", start: 16340, end: 17900, wrapCount: 0 },
          { nozzleId: "n2", start: 12521, end: 12560, wrapCount: 2 },
        ],
        tank: { start: 16389.5, end: 14650.5 },
        payment: { cash: 5100, digital: 11660 },
        attributions: blankAttributions(),
      },
    ]),
  ],
};

// 冲突班次：与 s3 时段重叠 → 不能复核
const s4Overlap: Shift = {
  id: "s4",
  name: "09-19 凌晨加班",
  start: "2026-09-19T02:00",
  end: "2026-09-19T09:00",
  versions: [
    v(1, "draft", [
      {
        fuelId: "f0",
        nozzleIds: ["n4"],
        pumps: [{ nozzleId: "n4", start: 31200, end: 31900, wrapCount: 0 }],
        tank: { start: 17700, end: 17000 },
        payment: { cash: 1800, digital: 3296 },
        attributions: blankAttributions(),
      },
    ]),
  ],
};

export function createSeedState(): AppState {
  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  return {
    schemaVersion: 1,
    fuels,
    nozzles,
    thresholds: { volume: 50, money: 100 },
    shifts: [clone(s1Reviewed), clone(s2Draft), clone(s3Wrap), clone(s4Overlap)],
  };
}
