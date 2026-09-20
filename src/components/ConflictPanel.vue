<script setup lang="ts">
import { computed } from "vue";
import { useShiftStore } from "../stores/shifts";
import {
  computeShift,
  latestVersion,
  validateForReview,
  type EntryComputation,
  type RuleCode,
  type ValidationIssue,
} from "../domain/rules";
import type { FuelEntry, Shift, ShiftVersion } from "../domain/types";

const store = useShiftStore();
const emit = defineEmits<{ (e: "locate", shiftId: string): void }>();

const RULE_LABELS: Record<RuleCode, string> = {
  SOURCE_MISSING: "来源缺失",
  METER_WRAP_TWICE: "跨日回绕超过一次",
  SHIFT_OVERLAP: "班次时段重叠",
  TIME_INVALID: "班次时段非法",
  DIFF_UNATTRIBUTED: "差异超阈值未归因",
  ATTRIBUTION_WITHOUT_DIFF: "无超阈值差异却填写归因",
  CORRECTION_REASON_REQUIRED: "更正缺少原因",
};

interface Row {
  shift: Shift;
  version: ShiftVersion;
  issues: ValidationIssue[];
  entry?: FuelEntry;
  comp?: EntryComputation;
}

const rows = computed<Row[]>(() => {
  const out: Row[] = [];
  for (const shift of store.chain) {
    const version = latestVersion(shift);
    if (version.status === "reviewed") continue;
    const issues = validateForReview(shift, version, store.data);
    if (issues.length === 0) continue;
    const comps = computeShift(version, store.data);
    // 按油品归组问题；班次级问题（重叠/时段非法）附加到每个油品行
    const byFuel = new Map<string, ValidationIssue[]>();
    for (const entry of version.entries) byFuel.set(entry.fuelId, []);
    const shiftLevel: ValidationIssue[] = [];
    for (const issue of issues) {
      if (issue.fuelId) {
        const list = byFuel.get(issue.fuelId) ?? [];
        list.push(issue);
        byFuel.set(issue.fuelId, list);
      } else {
        shiftLevel.push(issue);
      }
    }
    for (const [fuelId, list] of byFuel) {
      // 班次级规则在每个油品行上重复展示，确保每行都带得齐“油品+三账+规则”
      const all = [...shiftLevel, ...list];
      if (all.length === 0) continue;
      const entry = version.entries.find((e) => e.fuelId === fuelId);
      const comp = comps.find((c) => c.fuelId === fuelId);
      if (entry && comp) out.push({ shift, version, issues: all, entry, comp });
    }
    // 班次没有任何油品录入时，仍展示班次级冲突
    if (version.entries.length === 0 && shiftLevel.length) {
      out.push({ shift, version, issues: shiftLevel });
    }
  }
  return out;
});

function fmtVolume(v: number | null): string {
  return v === null ? "缺失" : `${v.toLocaleString("zh-CN", { maximumFractionDigits: 1 })} L`;
}
function fmtMoney(v: number | null): string {
  return v === null ? "缺失" : `${v.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 元`;
}
function fuelName(id: string): string {
  return store.fuels.find((f) => f.id === id)?.name ?? id;
}
</script>

<template>
  <section class="panel conflict-panel">
    <h2>复核冲突清单 <span v-if="rows.length" class="count">{{ rows.length }}</span></h2>
    <p class="hint">以下问题会阻止“复核通过”。每条列出班次、油品与三账数值，以及触发的规则。</p>

    <div v-if="rows.length === 0" class="ok-line">✓ 全部草稿班次均满足复核条件</div>

    <div v-for="(row, i) in rows" :key="i" class="conflict">
      <button type="button" class="conflict-head" @click="emit('locate', row.shift.id)">
        <strong>{{ row.shift.name }}</strong>
        <span class="ver">v{{ row.version.versionNo }} 草稿</span>
        <span class="time">{{ row.shift.start.slice(5, 16).replace("T", " ") }} ~ {{ row.shift.end.slice(11, 16) }}</span>
        <span class="go">定位 →</span>
      </button>

      <div v-if="row.entry && row.comp" class="conflict-body">
        <div class="fuel-name">{{ fuelName(row.entry.fuelId) }}</div>
        <div class="three-books">
          <div>
            <span class="book-label">油枪泵码账</span>
            <strong :class="{ missing: row.comp.pumpVolume === null }">{{ fmtVolume(row.comp.pumpVolume) }}</strong>
          </div>
          <div>
            <span class="book-label">罐存账</span>
            <strong :class="{ missing: row.comp.tankVolume === null }">{{ fmtVolume(row.comp.tankVolume) }}</strong>
          </div>
          <div>
            <span class="book-label">收款账</span>
            <strong :class="{ missing: row.comp.money === null }">{{ fmtMoney(row.comp.money) }}</strong>
          </div>
        </div>
      </div>

      <ul class="rule-list">
        <li v-for="(issue, j) in row.issues" :key="j">
          <span class="rule-tag">{{ RULE_LABELS[issue.rule] }}</span>
          <span>{{ issue.message }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.hint { margin: 0 0 12px; font-size: 12px; color: #69758c; }
.count {
  display: inline-block;
  min-width: 20px;
  padding: 1px 7px;
  margin-left: 6px;
  border-radius: 999px;
  background: #c84b31;
  color: #fff;
  font-size: 12px;
}
.ok-line {
  background: #e8f4ef;
  color: #14724f;
  border-radius: 8px;
  padding: 12px;
  font-size: 13px;
}
.conflict {
  border: 1px solid #f0d4cc;
  border-radius: 10px;
  margin-bottom: 10px;
  overflow: hidden;
}
.conflict-head {
  width: 100%;
  display: flex;
  gap: 10px;
  align-items: center;
  background: #fdf1ee;
  color: #172033;
  border-radius: 0;
  padding: 9px 12px;
  font-size: 14px;
}
.ver { font-size: 11px; background: #eef2f7; padding: 2px 7px; border-radius: 6px; color: #445069; }
.time { font-size: 12px; color: #69758c; }
.go { margin-left: auto; font-size: 12px; color: #176b87; }
.conflict-body { padding: 10px 12px 0; }
.fuel-name { font-weight: 700; font-size: 13px; margin-bottom: 8px; }
.three-books { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.three-books > div {
  border: 1px solid #e3e9f2;
  border-radius: 8px;
  padding: 8px;
  display: grid;
  gap: 4px;
  background: #fff;
}
.book-label { font-size: 11px; color: #69758c; }
.three-books strong { font-size: 14px; font-variant-numeric: tabular-nums; }
.three-books strong.missing { color: #c84b31; }
.rule-list {
  list-style: none;
  margin: 10px 0 0;
  padding: 0 12px 12px;
  display: grid;
  gap: 6px;
}
.rule-list li { display: flex; gap: 8px; font-size: 12px; color: #445069; align-items: baseline; }
.rule-tag {
  flex: none;
  background: #f7d9d0;
  color: #a33a22;
  border-radius: 6px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 700;
}
</style>
