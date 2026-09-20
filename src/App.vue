<script setup lang="ts">
import { computed, ref } from "vue";
import { useShiftStore } from "./stores/shifts";
import { latestVersion } from "./domain/rules";
import ShiftChain from "./components/ShiftChain.vue";
import ShiftDetail from "./components/ShiftDetail.vue";
import NewShiftForm from "./components/NewShiftForm.vue";
import ConflictPanel from "./components/ConflictPanel.vue";

const store = useShiftStore();
const selectedId = ref<string | null>(store.chain[0]?.id ?? null);
const tab = ref<"ledger" | "conflict">("ledger");

const metrics = computed(() => {
  const total = store.data.shifts.length;
  const frozen = store.data.shifts.filter((s) => latestVersion(s).status === "reviewed").length;
  const drafts = total - frozen;
  const corrected = store.data.shifts.filter((s) => s.versions.length > 1).length;
  return [
    { label: "班次总数", value: total },
    { label: "草稿 / 已冻结", value: `${drafts} / ${frozen}` },
    { label: "存在更正版本", value: corrected },
  ];
});

function selectShift(id: string) {
  selectedId.value = id;
  tab.value = "ledger";
}

function reset() {
  if (confirm("恢复为内置演示数据？当前所有录入与复核记录将被覆盖。")) {
    store.resetAll();
    selectedId.value = store.chain[0]?.id ?? null;
    tab.value = "ledger";
  }
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">加油站班次交接 · 三账差异归因台</p>
          <h1>油枪泵码账 × 罐存账 × 收款账</h1>
          <p class="subtitle">
            每班按油品录入油枪泵码增量、罐存变化与收款合计，起始泵码自动继承上一班结束泵码；
            来源缺失、跨日回绕超过一次或班次时段重叠时不能复核。三账换算差异超阈值必须归因，
            复核即冻结原始三账，更正只能带原因生成新版本。
          </p>
        </div>
        <div class="stack">
          <span class="tag">阈值：体积 ±{{ store.thresholds.volume }}L</span>
          <span class="tag">金额 ±{{ store.thresholds.money }}元</span>
          <button type="button" class="secondary mini" @click="reset">重置演示数据</button>
        </div>
      </header>

      <section class="metrics">
        <article v-for="m in metrics" :key="m.label" class="metric">
          <span>{{ m.label }}</span>
          <strong>{{ m.value }}</strong>
        </article>
      </section>

      <div class="tabs">
        <button type="button" :class="{ active: tab === 'ledger' }" @click="tab = 'ledger'">班次三账</button>
        <button type="button" :class="{ active: tab === 'conflict' }" @click="tab = 'conflict'">复核冲突</button>
      </div>

      <section v-show="tab === 'ledger'" class="workspace">
        <div class="left-col">
          <NewShiftForm @created="selectShift" />
          <ShiftChain :selected-id="selectedId" @select="selectShift" />
        </div>
        <ShiftDetail v-if="selectedId" :key="selectedId" :shift-id="selectedId" />
        <ShiftDetail v-else :shift-id="''" />
      </section>

      <section v-show="tab === 'conflict'" class="conflict-wrap">
        <ConflictPanel @locate="selectShift" />
      </section>
    </div>
  </main>
</template>

<style scoped>
.left-col {
  display: grid;
  gap: 14px;
  align-content: start;
}
.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}
.tabs button {
  background: #fff;
  color: #445069;
  border: 1px solid #dfe7f1;
}
.tabs button.active {
  background: #176b87;
  color: #fff;
  border-color: #176b87;
}
button.mini { padding: 6px 10px; font-size: 12px; }
.conflict-wrap { max-width: 860px; margin: 0 auto; }
</style>
