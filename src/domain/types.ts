// 三账差异归因台 —— 领域模型（与存储、页面无关）

export type FuelId = "f92" | "f95" | "f0";

/** 油品主数据 */
export interface Fuel {
  id: FuelId;
  name: string;
  /** 挂牌价 元/L，用于三账金额换算 */
  price: number;
  /** 罐容 L，仅展示用 */
  tankCapacity: number;
}

/** 油枪主数据 */
export interface Nozzle {
  id: string;
  fuelId: FuelId;
  code: string;
  /** 泵码字轮满度（如 99999），回绕周期 = meterMax + 1 */
  meterMax: number;
}

/** 油枪泵码账：本班起止累计泵码 + 班内回绕次数 */
export interface PumpReading {
  nozzleId: string;
  /** 起始泵码：继承上一班结束泵码（首班手工录入） */
  start: number | null;
  end: number | null;
  /** 跨日回绕次数：班内字轮归零次数，>1 不能复核 */
  wrapCount: number;
}

/** 罐存账：本班起止罐存液位 L */
export interface TankReading {
  start: number | null;
  end: number | null;
}

/** 收款账：现金 + 电子支付（元） */
export interface PaymentReading {
  cash: number | null;
  digital: number | null;
}

export type CauseCategory = "meter" | "loss" | "cash";
/** 差异类型：三账两两换算比较 */
export type DiffKind = "pump-tank" | "pump-money" | "tank-money";

export interface Attribution {
  kind: DiffKind;
  cause: CauseCategory | "";
  /** 归因依据，必填 */
  evidence: string;
}

/** 单油品在一个班次版本下的三账原始数据 */
export interface FuelEntry {
  fuelId: FuelId;
  nozzleIds: string[];
  pumps: PumpReading[];
  tank: TankReading;
  payment: PaymentReading;
  attributions: Attribution[];
}

export type ReviewStatus = "draft" | "reviewed";

/** 班次版本：一经复核即冻结，更正只能基于已冻结版本生成新版本 */
export interface ShiftVersion {
  id: string;
  versionNo: number;
  status: ReviewStatus;
  createdAt: string;
  reviewedAt: string | null;
  /** 新建为空；更正版本必须带原因 */
  reason: string;
  /** 更正来源版本 id，形成版本链 */
  baseVersionId: string | null;
  entries: FuelEntry[];
}

export interface Shift {
  id: string;
  name: string;
  /** ISO8601 带时区 */
  start: string;
  end: string;
  versions: ShiftVersion[];
}

export interface Thresholds {
  /** 体积差阈值 L */
  volume: number;
  /** 金额差阈值 元 */
  money: number;
}

export interface AppState {
  schemaVersion: 1;
  fuels: Fuel[];
  nozzles: Nozzle[];
  thresholds: Thresholds;
  shifts: Shift[];
}
