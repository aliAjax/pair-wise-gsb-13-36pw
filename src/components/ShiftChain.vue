<script setup lang="ts">
import { computed } from "vue";
import { useShiftStore } from "../stores/shifts";
import { latestVersion } from "../domain/rules";

const store = useShiftStore();
const props = defineProps<{ selectedId: string | null }>();
const emit = defineEmits<{ (e: "select", id: string): void }>();

const chain = computed(() =>
  store.chain.map((shift, index) => {
    const v = latestVersion(shift);
    return { shift, index, v };
  })
);

function fmt(iso: string) {
  return iso.slice(5, 16).replace("T", " ");
}
</script>

<template>
  <section class="panel chain-panel">
    <h2>班次链</h2>
    <p class="hint">按开始时间排序，相邻班次同油枪结束泵码自动继承为下一班起始泵码。</p>
    <div class="chain-list">
      <button
        v-for="{ shift, index, v } in chain"
        :key="shift.id"
        type="button"
        class="chain-item"
        :class="{ active: shift.id === props.selectedId, reviewed: v.status === 'reviewed' }"
        @click="emit('select', shift.id)"
      >
        <span class="chain-no">#{{ index + 1 }}</span>
        <span class="chain-main">
          <strong>{{ shift.name }}</strong>
          <small>{{ fmt(shift.start) }} ~ {{ fmt(shift.end) }}</small>
        </span>
        <span class="chain-ver">v{{ v.versionNo }}</span>
        <span class="badge" :class="v.status">{{ v.status === "reviewed" ? "已复核" : "草稿" }}</span>
      </button>
      <div v-if="chain.length === 0" class="empty">暂无班次，点击“新增班次”创建。</div>
    </div>
  </section>
</template>

<style scoped>
.hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: #69758c;
  line-height: 1.6;
}
.chain-list {
  display: grid;
  gap: 8px;
}
.chain-item {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  gap: 10px;
  align-items: center;
  text-align: left;
  background: #fbfcfe;
  border: 1px solid #dfe7f1;
  color: #172033;
  padding: 10px 12px;
  border-radius: 8px;
}
.chain-item.active {
  border-color: #176b87;
  box-shadow: 0 0 0 2px rgba(23, 107, 135, 0.15);
}
.chain-no {
  color: #8a96a8;
  font-size: 12px;
  font-weight: 700;
}
.chain-main {
  display: grid;
  gap: 2px;
}
.chain-main small {
  color: #69758c;
  font-size: 12px;
}
.chain-ver {
  font-size: 12px;
  color: #445069;
  background: #eef2f7;
  border-radius: 6px;
  padding: 2px 7px;
}
</style>
