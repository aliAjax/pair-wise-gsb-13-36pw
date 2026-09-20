<script setup lang="ts">
import { computed } from "vue";
import type { EntryComputation } from "../domain/rules";
import { CAUSE_LABELS, DIFF_KINDS, DIFF_LABELS, nozzleDelta } from "../domain/rules";
import type { Attribution, Fuel, FuelEntry, Nozzle, ShiftVersion } from "../domain/types";
import { useShiftStore } from "../stores/shifts";
import NumInput from "./NumInput.vue";

const props = defineProps<{
  shiftId: string;
  fuel: Fuel;
  entry: FuelEntry;
  comp: EntryComputation;
  version: ShiftVersion;
  nozzles: Nozzle[];
}>();

const store = useShiftStore();
const editable = computed(() => props.version.status === "draft");
const nozzleRows = computed(() =>
  props.entry.pumps.map((p) => {
    const nozzle = props.nozzles.find((n) => n.id === p.nozzleId);
    return { reading: p, nozzle, derived: nozzle ? nozzleDelta(p, nozzle) : null };
  })
);

function num(v: number | null | undefined, digits = 2) {
  return v === null || v === undefined ? "—" : v.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

function onCauseChange(kind: (typeof DIFF_KINDS)[number], event: Event) {
  const cause = (event.target as HTMLSelectElement).value as Attribution["cause"];
  store.setAttribution(props.shiftId, props.fuel.id, kind, { cause });
}

function onEvidenceChange(kind: (typeof DIFF_KINDS)[number], event: Event) {
  store.setAttribution(props.shiftId, props.fuel.id, kind, {
    evidence: (event.target as HTMLInputElement).value,
  });
}

function onWrapChange(nozzleId: string, event: Event) {
  store.updatePump(props.shiftId, props.fuel.id, nozzleId, {
    wrapCount: Number((event.target as HTMLSelectElement).value),
  });
}

function hasAttribution(kind: (typeof DIFF_KINDS)[number]): boolean {
  const a = props.entry.attributions.find((x) => x.kind === kind);
  return !!a && (!!a.cause || !!a.evidence.trim());
}
</script>

<template>
  <article class="ledger">
    <header class="ledger-head">
      <h4>{{ fuel.name }}</h4>
      <span class="price">挂牌价 {{ fuel.price.toFixed(2) }} 元/L</span>
    </header>

    <!-- 油枪泵码账 -->
    <div class="ledger-block">
      <h5>① 油枪泵码账（L）</h5>
      <div class="pump-table" v-if="nozzleRows.length">
        <div class="pump-row pump-th">
          <span>油枪</span><span>起始泵码（继承上一班）</span><span>结束泵码</span><span>跨日回绕</span><span>增量</span>
        </div>
        <div v-for="row in nozzleRows" :key="row.reading.nozzleId" class="pump-row">
          <span class="nozzle-code">{{ row.nozzle?.code ?? row.reading.nozzleId }}</span>
          <NumInput
            :value="row.reading.start"
            :disabled="!editable"
            @update="(val) => store.updatePump(shiftId, fuel.id, row.reading.nozzleId, { start: val })"
          />
          <NumInput
            :value="row.reading.end"
            :disabled="!editable"
            @update="(val) => store.updatePump(shiftId, fuel.id, row.reading.nozzleId, { end: val })"
          />
          <select
            :value="row.reading.wrapCount"
            :disabled="!editable"
            :class="{ invalid: row.reading.wrapCount > 1 }"
            @change="onWrapChange(row.reading.nozzleId, $event)"
          >
            <option :value="0">0 次</option>
            <option :value="1">1 次</option>
            <option :value="2">2 次（超规）</option>
          </select>
          <strong :class="{ warn: row.derived?.wrapInvalid }">{{ num(row.derived?.delta ?? null, 1) }}</strong>
        </div>
      </div>
      <p v-else class="missing">该油品未配置油枪。</p>
      <p class="subtotal">泵码增量合计：<strong>{{ num(comp.pumpVolume, 1) }}</strong> L</p>
    </div>

    <!-- 罐存账 -->
    <div class="ledger-block">
      <h5>② 罐存账（L）</h5>
      <div class="two-col">
        <label>起始罐存
          <NumInput :value="entry.tank.start" :disabled="!editable"
            @update="(val) => store.updateTank(shiftId, fuel.id, { start: val })" />
        </label>
        <label>结束罐存
          <NumInput :value="entry.tank.end" :disabled="!editable"
            @update="(val) => store.updateTank(shiftId, fuel.id, { end: val })" />
        </label>
      </div>
      <p class="subtotal">罐存发油量（起 − 止）：<strong>{{ num(comp.tankVolume, 1) }}</strong> L</p>
    </div>

    <!-- 收款账 -->
    <div class="ledger-block">
      <h5>③ 收款账（元）</h5>
      <div class="two-col">
        <label>现金收款
          <NumInput :value="entry.payment.cash" :disabled="!editable"
            @update="(val) => store.updatePayment(shiftId, fuel.id, { cash: val })" />
        </label>
        <label>电子支付
          <NumInput :value="entry.payment.digital" :disabled="!editable"
            @update="(val) => store.updatePayment(shiftId, fuel.id, { digital: val })" />
        </label>
      </div>
      <p class="subtotal">收款合计：<strong>{{ num(comp.money, 2) }}</strong> 元</p>
    </div>

    <!-- 三账换算差异 -->
    <div class="ledger-block diff-block">
      <h5>三账换算差异</h5>
      <p class="hint-line">
        油枪应收 {{ num(comp.moneyByPump) }} 元 ｜ 罐存应收 {{ num(comp.moneyByTank) }} 元
      </p>
      <div
        v-for="kind in DIFF_KINDS"
        :key="kind"
        class="diff-row"
        :class="{ exceeds: comp.diffs[kind]?.exceeds, stale: !comp.diffs[kind]?.exceeds && hasAttribution(kind) }"
      >
        <div class="diff-info">
          <span class="diff-label">{{ DIFF_LABELS[kind] }}</span>
          <strong class="diff-value">
            {{ comp.diffs[kind] ? `${comp.diffs[kind]!.value > 0 ? "+" : ""}${comp.diffs[kind]!.value} ${comp.diffs[kind]!.unit}` : "来源缺失无法计算" }}
          </strong>
          <span v-if="comp.diffs[kind]?.exceeds" class="over-tag">超阈值，必须归因</span>
          <span v-else-if="hasAttribution(kind)" class="stale-tag">差异未超阈值，请清空归因</span>
        </div>
        <div class="attr">
          <select
            :value="entry.attributions.find(a => a.kind === kind)?.cause ?? ''"
            :disabled="!editable"
            @change="onCauseChange(kind, $event)"
          >
            <option value="">选择原因…</option>
            <option value="meter">{{ CAUSE_LABELS.meter }}</option>
            <option value="loss">{{ CAUSE_LABELS.loss }}</option>
            <option value="cash">{{ CAUSE_LABELS.cash }}</option>
          </select>
          <input
            type="text"
            placeholder="填写归因依据（必填）"
            :value="entry.attributions.find(a => a.kind === kind)?.evidence ?? ''"
            :disabled="!editable"
            @input="onEvidenceChange(kind, $event)"
          />
        </div>
      </div>
    </div>

    <!-- 来源缺失提示 -->
    <ul v-if="comp.missing.length" class="missing-list">
      <li v-for="m in comp.missing" :key="m">⚠ {{ m }}</li>
    </ul>
  </article>
</template>

<style scoped>
.ledger {
  border: 1px solid #dfe7f1;
  border-radius: 10px;
  padding: 14px 16px;
  background: #fbfcfe;
}
.ledger-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 10px;
}
h4 { margin: 0; font-size: 16px; }
h5 { margin: 0 0 8px; font-size: 13px; color: #445069; }
.price { font-size: 12px; color: #69758c; }
.ledger-block { padding: 10px 0; border-top: 1px dashed #dde4ee; }
.pump-table { display: grid; gap: 6px; }
.pump-row {
  display: grid;
  grid-template-columns: 110px 1fr 1fr 118px 84px;
  gap: 8px;
  align-items: center;
  font-size: 13px;
}
.pump-th { color: #69758c; font-size: 12px; }
.pump-th span { white-space: nowrap; }
.nozzle-code { font-weight: 700; }
.warn { color: #c84b31; }
select.invalid { border-color: #c84b31; background: #fdf1ee; }
.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
label { display: grid; gap: 4px; font-size: 12px; color: #69758c; }
.subtotal { margin: 8px 0 0; font-size: 13px; color: #445069; }
.subtotal strong { font-size: 15px; color: #176b87; }
.diff-block .hint-line { margin: 0 0 8px; font-size: 12px; color: #69758c; }
.diff-row {
  display: grid;
  grid-template-columns: minmax(200px, 1fr) minmax(260px, 1.3fr);
  gap: 10px;
  padding: 8px;
  border-radius: 8px;
  align-items: center;
}
.diff-row.exceeds { background: #fdf6ec; }
.diff-info { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; font-size: 13px; }
.diff-label { color: #445069; }
.diff-value { font-variant-numeric: tabular-nums; }
.exceeds .diff-value { color: #b8841f; font-weight: 800; }
.over-tag {
  font-size: 11px;
  background: #f7d9a8;
  color: #8a5a10;
  border-radius: 999px;
  padding: 2px 8px;
}
.attr { display: grid; grid-template-columns: 120px 1fr; gap: 8px; }
.diff-row.stale { background: #fdf1ee; }
.stale-tag {
  font-size: 11px;
  background: #f7d9d0;
  color: #a33a22;
  border-radius: 999px;
  padding: 2px 8px;
}
.missing-list {
  margin: 8px 0 0;
  padding: 8px 8px 8px 24px;
  background: #fdf1ee;
  border-radius: 8px;
  color: #b2442c;
  font-size: 12px;
}
.missing { color: #b2442c; font-size: 12px; margin: 4px 0; }
@media (max-width: 720px) {
  .pump-row { grid-template-columns: 1fr 1fr; }
  .pump-th { display: none; }
  .diff-row { grid-template-columns: 1fr; }
}
</style>
