<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import {
  ATTRIBUTION_TYPES,
  AMOUNT_THRESHOLD_YUAN,
  FUELS,
  METER_MAX,
  SHIFT_NAMES,
  VOLUME_THRESHOLD_L,
  evaluate,
  inheritPumpStart,
  latestVersions,
  reviewCheck,
  toInterval,
  versionsOf,
  type Attribution,
  type AttributionType,
  type ShiftEntry,
} from "./domain/attribution";
import { loadEntries, persist, resetEntries } from "./store/persistence";

const entries = ref<ShiftEntry[]>(loadEntries());

/* ---------- 班次链 / 版本关系（刷新后由持久化数据重建） ---------- */

const latestList = computed(() =>
  latestVersions(entries.value).sort((a, b) => toInterval(b).start - toInterval(a).start)
);

const fuelFilter = ref("全部油品");
const filteredList = computed(() =>
  fuelFilter.value === "全部油品" ? latestList.value : latestList.value.filter((e) => e.fuel === fuelFilter.value)
);

function peers(): ShiftEntry[] {
  return latestVersions(entries.value);
}

function checkFor(entry: ShiftEntry) {
  const draft = draftFor(entry);
  const attribution: Attribution | null =
    entry.status === "已复核"
      ? entry.attribution
      : draft.type
        ? { type: draft.type as AttributionType, basis: draft.basis }
        : null;
  return reviewCheck(entry, peers(), attribution);
}

function chainOf(entry: ShiftEntry) {
  return versionsOf(entries.value, entry.chainId);
}

/* ---------- 冲突列表：班次、油品、三账数值、触发规则 ---------- */

const conflictRows = computed(() =>
  latestList.value
    .map((entry) => ({ entry, result: evaluate(entry, peers()) }))
    .filter((row) => row.result.conflicts.length > 0)
);

/* ---------- 指标 ---------- */

const metrics = computed(() => {
  const latest = latestList.value;
  const pending = latest.filter((e) => e.status === "待复核").length;
  const needAttr = latest.filter((e) => e.status === "待复核" && checkFor(e).needsAttribution).length;
  return [latest.length, pending, needAttr, conflictRows.value.length];
});

const metricLabels = ["班次链", "待复核", "超阈值待归因", "冲突拦截"];

const chartRows = computed(() => {
  const latest = latestList.value;
  return [
    { label: "已复核冻结", value: latest.filter((e) => e.status === "已复核").length },
    { label: "待复核", value: latest.filter((e) => e.status === "待复核").length },
    { label: "冲突拦截", value: conflictRows.value.length },
  ];
});
const maxChart = computed(() => Math.max(1, ...chartRows.value.map((row) => row.value)));

/* ---------- 录入表单（新增班次 / 补充更正共用） ---------- */

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type NumField = number | "";
interface FormState {
  shiftName: string;
  fuel: string;
  date: string;
  startTime: string;
  endTime: string;
  manualStart: NumField; // 无上一班可继承时手动录入开班泵码
  pumpEnd: NumField;
  wraps: number;
  tankStart: NumField;
  tankEnd: NumField;
  payment: NumField;
  price: number;
}

function blankForm(): FormState {
  return {
    shiftName: "早班", fuel: "92#汽油", date: today(),
    startTime: "06:00", endTime: "14:00",
    manualStart: "", pumpEnd: "", wraps: 0,
    tankStart: "", tankEnd: "", payment: "", price: 7.85,
  };
}

const form = reactive<FormState>(blankForm());
const correcting = ref<ShiftEntry | null>(null); // 非空表示正在对某冻结班次做补充更正
const correctionReason = ref("");

const formStartMs = computed(() => new Date(`${form.date}T${form.startTime}:00`).getTime());

/** 继承上一班结束泵码：同油品、结束早于本班开始的最晚一班 */
const inheritedStart = computed(() =>
  correcting.value ? null : inheritPumpStart(entries.value, form.fuel, formStartMs.value)
);

const effectivePumpStart = computed(() =>
  correcting.value ? correcting.value.pumpStart : inheritedStart.value ?? num(form.manualStart)
);

function num(value: NumField): number | null {
  return value === "" || value == null ? null : Number(value);
}

function collectForm() {
  return {
    shiftName: form.shiftName,
    fuel: form.fuel,
    date: form.date,
    startTime: form.startTime,
    endTime: form.endTime,
    pumpStart: effectivePumpStart.value,
    pumpEnd: num(form.pumpEnd),
    wraps: Number(form.wraps) || 0,
    tankStart: num(form.tankStart),
    tankEnd: num(form.tankEnd),
    payment: num(form.payment),
    price: Number(form.price) || 0,
  };
}

function submit() {
  if (correcting.value) {
    submitCorrection();
    return;
  }
  const entry: ShiftEntry = {
    ...collectForm(),
    id: crypto.randomUUID(),
    chainId: crypto.randomUUID(),
    version: 1,
    parentId: null,
    correctionReason: null,
    status: "待复核",
    attribution: null,
    createdAt: new Date().toISOString(),
  };
  entries.value = [entry, ...entries.value];
  Object.assign(form, blankForm());
  persist(entries.value);
}

/* ---------- 复核：通过后冻结原始三账 ---------- */

const attrDrafts = reactive<Record<string, { type: AttributionType | ""; basis: string }>>({});

function draftFor(entry: ShiftEntry) {
  if (!attrDrafts[entry.id]) attrDrafts[entry.id] = { type: "", basis: "" };
  return attrDrafts[entry.id];
}

function review(entry: ShiftEntry) {
  const check = checkFor(entry);
  if (!check.ok) return;
  const draft = draftFor(entry);
  entry.status = "已复核";
  entry.attribution = check.needsAttribution
    ? { type: draft.type as AttributionType, basis: draft.basis.trim() }
    : null;
  persist(entries.value);
}

function blockReason(entry: ShiftEntry): string {
  const check = checkFor(entry);
  if (check.ok) return "";
  const parts = check.conflicts.map((c) => `${c.code} ${c.label}`);
  if (check.needsAttribution && !check.attributionOk) parts.push("需选择归因类型并填写依据");
  return parts.join("；");
}

/* ---------- 补充更正：只能带原因生成新版本，原版本保持冻结 ---------- */

function startCorrection(entry: ShiftEntry) {
  correcting.value = entry;
  correctionReason.value = "";
  Object.assign(form, {
    shiftName: entry.shiftName,
    fuel: entry.fuel,
    date: entry.date,
    startTime: entry.startTime,
    endTime: entry.endTime,
    manualStart: entry.pumpStart ?? "",
    pumpEnd: entry.pumpEnd ?? "",
    wraps: entry.wraps,
    tankStart: entry.tankStart ?? "",
    tankEnd: entry.tankEnd ?? "",
    payment: entry.payment ?? "",
    price: entry.price,
  });
}

function cancelCorrection() {
  correcting.value = null;
  correctionReason.value = "";
  Object.assign(form, blankForm());
}

function submitCorrection() {
  const base = correcting.value;
  if (!base || !correctionReason.value.trim()) return;
  const entry: ShiftEntry = {
    ...collectForm(),
    id: crypto.randomUUID(),
    chainId: base.chainId,
    version: base.version + 1,
    parentId: base.id,
    correctionReason: correctionReason.value.trim(),
    status: "待复核",
    attribution: null,
    createdAt: new Date().toISOString(),
  };
  entries.value = [...entries.value, entry];
  cancelCorrection();
  persist(entries.value);
}

/** 撤回待复核版本：仅移除该版本，链上前一冻结版本自动恢复为当前版本 */
function removeVersion(entry: ShiftEntry) {
  entries.value = entries.value.filter((item) => item.id !== entry.id);
  persist(entries.value);
}

function resetAll() {
  entries.value = resetEntries();
  cancelCorrection();
}

/* ---------- 展示辅助 ---------- */

const fmt = (value: number | null, digits = 0) =>
  value == null ? "—" : value.toLocaleString("zh-CN", { maximumFractionDigits: digits });

const fmtTime = (iso: string) => iso.slice(0, 16).replace("T", " ");
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业 · 班次交接复核</p>
          <h1>三账差异归因台</h1>
          <p class="subtitle">
            每班录入同油品的油枪泵码增量、罐存变化与收款合计，泵码起数自动继承上一班结束泵码。
            泵码账、罐存账、收款账换算后差异超过阈值（{{ VOLUME_THRESHOLD_L }}L / {{ AMOUNT_THRESHOLD_YUAN }}元）必须归因；
            来源缺失、跨日回绕超过一次、班次时段重叠时不可复核。复核后冻结原始三账，更正只能带原因生成新版本。
          </p>
        </div>
        <div class="stack">
          <span class="tag">泵码量程 {{ METER_MAX.toLocaleString() }}</span>
          <span class="tag">体积阈值 {{ VOLUME_THRESHOLD_L }}L</span>
          <span class="tag">金额阈值 {{ AMOUNT_THRESHOLD_YUAN }}元</span>
        </div>
      </header>

      <section class="metrics">
        <article v-for="(label, index) in metricLabels" :key="label" class="metric">
          <span>{{ label }}</span>
          <strong>{{ metrics[index] }}</strong>
        </article>
      </section>

      <section v-if="conflictRows.length > 0" class="panel conflict-panel">
        <h2>冲突拦截（不可复核）</h2>
        <table class="conflict-table">
          <thead>
            <tr>
              <th>班次</th>
              <th>油品</th>
              <th>泵码账</th>
              <th>罐存账</th>
              <th>收款账</th>
              <th>触发规则</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in conflictRows" :key="row.entry.id">
              <td>{{ row.entry.date }} {{ row.entry.shiftName }}<br />{{ row.entry.startTime }}-{{ row.entry.endTime }}</td>
              <td>{{ row.entry.fuel }}</td>
              <td>{{ fmt(row.result.accounts.pumpVolume) }} L</td>
              <td>{{ fmt(row.result.accounts.tankVolume) }} L</td>
              <td>{{ fmt(row.result.accounts.paymentAmount) }} 元</td>
              <td>
                <span v-for="conflict in row.result.conflicts" :key="conflict.code + conflict.detail" class="chip chip-danger"
                  :title="conflict.detail">
                  {{ conflict.code }} {{ conflict.label }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="workspace">
        <form class="panel" @submit.prevent="submit">
          <h2>{{ correcting ? `补充更正 → 生成 v${correcting.version + 1}` : "新增班次录入" }}</h2>
          <p v-if="correcting" class="hint">
            正在更正 {{ correcting.date }} {{ correcting.shiftName }}（{{ correcting.fuel }}）v{{ correcting.version }}，
            原版本保持冻结，本表单将生成新版本并重新待复核。
          </p>
          <div class="form-grid">
            <label>
              班次
              <select v-model="form.shiftName" required>
                <option v-for="name in SHIFT_NAMES" :key="name">{{ name }}</option>
              </select>
            </label>
            <label>
              油品
              <select v-model="form.fuel" required>
                <option v-for="fuel in FUELS" :key="fuel">{{ fuel }}</option>
              </select>
            </label>
            <label>
              班次日期
              <input v-model="form.date" type="date" required />
            </label>
            <div class="field-pair">
              <label>
                开始时间
                <input v-model="form.startTime" type="time" required />
              </label>
              <label>
                结束时间
                <input v-model="form.endTime" type="time" required />
              </label>
            </div>
            <label v-if="inheritedStart != null">
              泵码起数（继承上一班）
              <input :value="inheritedStart" type="number" disabled />
            </label>
            <label v-else-if="correcting">
              泵码起数（沿用上版）
              <input :value="correcting.pumpStart ?? '—'" disabled />
            </label>
            <label v-else>
              泵码起数（首班手动录入）
              <input v-model.number="form.manualStart" type="number" min="0" required placeholder="无上一班可继承" />
            </label>
            <label>
              泵码止数
              <input v-model.number="form.pumpEnd" type="number" min="0" required />
            </label>
            <label>
              跨日回绕次数
              <input v-model.number="form.wraps" type="number" min="0" max="5" required />
            </label>
            <div class="field-pair">
              <label>
                罐存起数 L
                <input v-model.number="form.tankStart" type="number" min="0" required />
              </label>
              <label>
                罐存止数 L
                <input v-model.number="form.tankEnd" type="number" min="0" required />
              </label>
            </div>
            <label>
              收款合计 元
              <input v-model.number="form.payment" type="number" min="0" step="0.01" required />
            </label>
            <label>
              油品单价 元/L
              <input v-model.number="form.price" type="number" min="0.01" step="0.01" required />
            </label>
            <label v-if="correcting">
              更正原因（必填）
              <textarea v-model="correctionReason" required placeholder="说明本次更正的依据" />
            </label>
            <button type="submit">{{ correcting ? "生成更正版本" : "保存班次" }}</button>
            <button v-if="correcting" type="button" class="secondary" @click="cancelCorrection">取消更正</button>
          </div>
        </form>

        <section class="list-panel">
          <div class="toolbar">
            <h2>班次链</h2>
            <select v-model="fuelFilter">
              <option>全部油品</option>
              <option v-for="fuel in FUELS" :key="fuel">{{ fuel }}</option>
            </select>
            <button type="button" class="secondary" @click="resetAll">重置演示数据</button>
          </div>

          <div class="record-grid">
            <div v-if="filteredList.length === 0" class="empty">暂无匹配班次</div>
            <article v-for="entry in filteredList" :key="entry.id" class="record">
              <div class="record-head">
                <p class="record-title">{{ entry.date }} {{ entry.shiftName }} · {{ entry.fuel }}</p>
                <span class="status" :class="entry.status === '已复核' ? 'status-frozen' : 'status-pending'">
                  {{ entry.status === "已复核" ? "已复核 · 已冻结" : "待复核" }} · v{{ entry.version }}
                </span>
              </div>

              <div class="details">
                <span>泵码账：{{ fmt(checkFor(entry).accounts.pumpVolume) }} L（{{ fmt(entry.pumpStart) }} → {{ fmt(entry.pumpEnd) }}<template v-if="entry.wraps > 0">，回绕 {{ entry.wraps }} 次</template>）</span>
                <span>罐存账：{{ fmt(checkFor(entry).accounts.tankVolume) }} L（{{ fmt(entry.tankStart) }} → {{ fmt(entry.tankEnd) }}）</span>
                <span>收款账：{{ fmt(entry.payment) }} 元 ≈ {{ fmt(checkFor(entry).accounts.paymentVolume, 1) }} L</span>
                <span>泵码折金额：{{ fmt(checkFor(entry).accounts.amountByPump) }} 元（单价 {{ entry.price }} 元/L）</span>
              </div>

              <div class="diff-line">
                <template v-if="checkFor(entry).accounts.pumpVolume != null && checkFor(entry).accounts.tankVolume != null">
                  <span class="chip" :class="Math.abs(checkFor(entry).accounts.pumpVolume! - checkFor(entry).accounts.tankVolume!) > VOLUME_THRESHOLD_L ? 'chip-danger' : 'chip-ok'">
                    泵罐差 {{ fmt(Math.abs(checkFor(entry).accounts.pumpVolume! - checkFor(entry).accounts.tankVolume!)) }} L / 阈值 {{ VOLUME_THRESHOLD_L }} L
                  </span>
                </template>
                <template v-if="checkFor(entry).accounts.amountByPump != null && checkFor(entry).accounts.paymentAmount != null">
                  <span class="chip" :class="Math.abs(checkFor(entry).accounts.amountByPump! - checkFor(entry).accounts.paymentAmount!) > AMOUNT_THRESHOLD_YUAN ? 'chip-danger' : 'chip-ok'">
                    收款差 {{ fmt(Math.abs(checkFor(entry).accounts.amountByPump! - checkFor(entry).accounts.paymentAmount!)) }} 元 / 阈值 {{ AMOUNT_THRESHOLD_YUAN }} 元
                  </span>
                </template>
                <span v-for="conflict in checkFor(entry).conflicts" :key="conflict.code" class="chip chip-danger" :title="conflict.detail">
                  {{ conflict.code }} {{ conflict.label }}
                </span>
              </div>

              <div v-if="entry.status === '待复核' && checkFor(entry).needsAttribution" class="attr-form">
                <p class="hint">差异超阈值，复核前必须归因（建议：{{ checkFor(entry).diffs.flatMap((d) => d.suggest).join(" / ") }}）</p>
                <div class="field-pair">
                  <select v-model="draftFor(entry).type">
                    <option value="">选择归因类型</option>
                    <option v-for="type in ATTRIBUTION_TYPES" :key="type">{{ type }}</option>
                  </select>
                  <input v-model="draftFor(entry).basis" placeholder="填写归因依据" />
                </div>
              </div>

              <p v-if="entry.attribution" class="note">
                归因：{{ entry.attribution.type }} —— {{ entry.attribution.basis }}
              </p>

              <p class="chain-line">
                版本链：
                <template v-for="(ver, i) in chainOf(entry)" :key="ver.id">
                  <span v-if="i > 0"> ← </span>
                  <span :class="{ 'chain-current': ver.id === entry.id }">
                    v{{ ver.version }}（{{ ver.status }}<template v-if="ver.correctionReason">，更正：{{ ver.correctionReason }}</template>）
                  </span>
                </template>
                · 录于 {{ fmtTime(entry.createdAt) }}
              </p>

              <div class="actions">
                <button v-if="entry.status === '待复核'" type="button" :disabled="!checkFor(entry).ok" :title="blockReason(entry)" @click="review(entry)">
                  复核并冻结
                </button>
                <button v-if="entry.status === '已复核'" type="button" class="secondary" @click="startCorrection(entry)">
                  补充更正
                </button>
                <button v-if="entry.status === '待复核'" type="button" class="danger" @click="removeVersion(entry)">
                  {{ entry.version > 1 ? "撤回该版本" : "删除" }}
                </button>
                <span v-if="entry.status === '待复核' && !checkFor(entry).ok" class="block-reason">{{ blockReason(entry) }}</span>
              </div>
            </article>
          </div>

          <div class="mini-chart">
            <div v-for="row in chartRows" :key="row.label" class="bar">
              <span>{{ row.label }}</span>
              <div class="bar-track"><div class="bar-fill" :style="{ width: `${(row.value / maxChart) * 100}%` }" /></div>
              <strong>{{ row.value }}</strong>
            </div>
          </div>
        </section>
      </section>
    </div>
  </main>
</template>
