<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useShiftStore } from "../stores/shifts";
import { computeShift, latestVersion, validateForReview, type ValidationIssue } from "../domain/rules";
import type { ShiftVersion } from "../domain/types";
import FuelLedgerCard from "./FuelLedgerCard.vue";

const props = defineProps<{ shiftId: string }>();
const store = useShiftStore();

const shift = computed(() => store.getShift(props.shiftId));
const selectedVersionId = ref<string | null>(null);

watch(
  shift,
  (s) => {
    if (!s) {
      selectedVersionId.value = null;
      return;
    }
    // 新增更正版本或切换班次时，默认展示最新版本
    if (!selectedVersionId.value || !s.versions.some((v) => v.id === selectedVersionId.value)) {
      selectedVersionId.value = latestVersion(s).id;
    }
  },
  { immediate: true }
);

const version = computed<ShiftVersion | undefined>(() =>
  shift.value?.versions.find((v) => v.id === selectedVersionId.value) ?? (shift.value ? latestVersion(shift.value) : undefined)
);

const comps = computed(() => (version.value ? computeShift(version.value, store.data) : []));
const latest = computed(() => (shift.value ? latestVersion(shift.value) : undefined));
const editable = computed(() => version.value?.status === "draft" && version.value?.id === latest.value?.id);

const issues = computed<ValidationIssue[]>(() =>
  shift.value && latest.value?.status === "draft" ? validateForReview(shift.value, latest.value, store.data) : []
);

// 更正新版本
const correcting = ref(false);
const reason = ref("");
const correctionError = ref("");

function startCorrection() {
  correcting.value = true;
  reason.value = "";
  correctionError.value = "";
}

function confirmCorrection() {
  if (!shift.value) return;
  const result = store.correct(shift.value.id, reason.value);
  if (!result.ok) {
    correctionError.value = result.issues.map((i) => i.message).join("；");
    return;
  }
  correcting.value = false;
  const s = store.getShift(shift.value.id);
  if (s) selectedVersionId.value = latestVersion(s).id;
}

function doReview() {
  if (!shift.value) return;
  const result = store.review(shift.value.id);
  if (result.ok) {
    const s = store.getShift(shift.value.id);
    if (s) selectedVersionId.value = latestVersion(s).id;
  }
}

function removeShift() {
  if (shift.value && confirm(`确认删除草稿班次「${shift.value.name}」？`)) {
    store.deleteDraft(shift.value.id);
  }
}

function versionBaseLabel(v: ShiftVersion): string {
  if (!v.baseVersionId) return "初始版本";
  const base = shift.value?.versions.find((x) => x.id === v.baseVersionId);
  return base ? `更正自 v${base.versionNo}` : "更正自历史版本";
}
</script>

<template>
  <section v-if="shift && version" class="panel detail">
    <header class="detail-head">
      <div class="meta-fields">
        <input
          class="shift-name"
          :value="shift.name"
          :disabled="!editable"
          @change="store.updateShiftMeta(shift.id, { name: ($event.target as HTMLInputElement).value, start: shift.start, end: shift.end })"
        />
        <div class="time-fields">
          <label>班次开始
            <input
              type="datetime-local"
              :value="shift.start"
              :disabled="!editable"
              @change="store.updateShiftMeta(shift.id, { name: shift.name, start: ($event.target as HTMLInputElement).value, end: shift.end })"
            />
          </label>
          <label>班次结束
            <input
              type="datetime-local"
              :value="shift.end"
              :disabled="!editable"
              @change="store.updateShiftMeta(shift.id, { name: shift.name, start: shift.start, end: ($event.target as HTMLInputElement).value })"
            />
          </label>
        </div>
      </div>
      <div class="head-actions">
        <button v-if="latest?.status === 'draft'" type="button" :disabled="issues.length > 0" @click="doReview">
          复核通过并冻结
        </button>
        <button v-else type="button" class="secondary" @click="startCorrection">补充更正（生成新版本）</button>
        <button v-if="latest?.status === 'draft'" type="button" class="danger ghost" @click="removeShift">删除草稿</button>
      </div>
    </header>

    <p v-if="latest?.status === 'reviewed'" class="frozen-note">
      🔒 当前班次已复核：原始三账已冻结。任何更正都必须点击“补充更正”并填写原因，生成新版本后再复核。
    </p>
    <p v-else-if="version.status === 'draft' && version.id !== latest.id" class="frozen-note dim">
      以下是历史草稿/已复核版本的只读视图。
    </p>

    <!-- 版本关系 -->
    <div class="versions">
      <button
        v-for="v in [...shift.versions].reverse()"
        :key="v.id"
        type="button"
        class="ver-tab"
        :class="{ active: v.id === version.id, reviewed: v.status === 'reviewed' }"
        @click="selectedVersionId = v.id"
      >
        <span class="ver-no">v{{ v.versionNo }}</span>
        <span class="ver-state">{{ v.status === "reviewed" ? "已冻结" : "草稿" }}</span>
        <span class="ver-base">{{ versionBaseLabel(v) }}</span>
      </button>
    </div>
    <div v-if="version.reason" class="reason-box">
      <strong>更正原因：</strong>{{ version.reason }}
    </div>
    <p v-if="version.reviewedAt" class="reviewed-at">复核时间：{{ new Date(version.reviewedAt).toLocaleString("zh-CN") }}</p>

    <!-- 更正原因输入 -->
    <div v-if="correcting" class="correct-box">
      <label>更正原因（必填，将随新版本保留）
        <textarea v-model="reason" placeholder="例如：液位仪校准误差，罐存起始值修正 60L；需留存校准记录编号" />
      </label>
      <p v-if="correctionError" class="error-text">{{ correctionError }}</p>
      <div class="correct-actions">
        <button type="button" :disabled="!reason.trim()" @click="confirmCorrection">生成 v{{ (latest?.versionNo ?? 0) + 1 }} 草稿</button>
        <button type="button" class="secondary" @click="correcting = false">取消</button>
      </div>
    </div>

    <!-- 复核前阻塞规则 -->
    <div v-if="latest?.status === 'draft' && version.id === latest.id && issues.length" class="block-box">
      <strong>不能复核（{{ issues.length }} 项）：</strong>
      <ul>
        <li v-for="(issue, i) in issues" :key="i">{{ issue.message }}</li>
      </ul>
    </div>

    <!-- 三账卡片 -->
    <div class="cards">
      <FuelLedgerCard
        v-for="(entry, i) in version.entries"
        :key="entry.fuelId + version.id"
        :shift-id="shift.id"
        :fuel="store.fuels.find(f => f.id === entry.fuelId) ?? store.fuels[i]"
        :entry="entry"
        :comp="comps[i]"
        :version="version"
        :nozzles="store.nozzles"
      />
    </div>
  </section>

  <section v-else class="panel empty-detail">
    <p>← 从左侧班次链选择一个班次，或新增班次开始三账交接。</p>
  </section>
</template>

<style scoped>
.detail { display: grid; gap: 14px; }
.detail-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.meta-fields { display: grid; gap: 8px; flex: 1; min-width: 260px; }
.shift-name {
  font-size: 20px;
  font-weight: 800;
  border-color: transparent;
  background: transparent;
  padding: 4px 8px;
}
.shift-name:not(:disabled) { background: #fbfcfe; border-color: #cfd8e5; }
.time-fields { display: flex; gap: 10px; flex-wrap: wrap; }
.time-fields label { font-size: 12px; color: #69758c; }
.head-actions { display: flex; gap: 8px; align-items: flex-start; }
button.ghost { background: transparent; color: #c84b31; border: 1px solid #eec4bb; }
.frozen-note {
  margin: 0;
  background: #eef2fb;
  border: 1px solid #d6dff0;
  color: #3c4f78;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
}
.frozen-note.dim { background: #f4f6f9; color: #69758c; border-color: #e3e8f0; }
.versions { display: flex; gap: 8px; flex-wrap: wrap; }
.ver-tab {
  background: #fbfcfe;
  color: #172033;
  border: 1px solid #dfe7f1;
  display: grid;
  grid-template-columns: auto auto;
  gap: 2px 10px;
  padding: 7px 12px;
  text-align: left;
}
.ver-tab .ver-base { grid-column: 1 / -1; font-size: 11px; color: #8a96a8; }
.ver-tab.active { border-color: #176b87; box-shadow: 0 0 0 2px rgba(23, 107, 135, .15); }
.ver-tab.reviewed .ver-state { color: #14724f; }
.reason-box {
  background: #f6f9fc;
  border-left: 3px solid #176b87;
  border-radius: 0 8px 8px 0;
  padding: 9px 12px;
  font-size: 13px;
  color: #445069;
}
.reviewed-at { margin: 0; font-size: 12px; color: #8a96a8; }
.correct-box {
  border: 1px dashed #176b87;
  border-radius: 10px;
  padding: 12px;
  display: grid;
  gap: 8px;
  background: #f6fafc;
}
.correct-box textarea { min-height: 64px; }
.correct-actions { display: flex; gap: 8px; }
.error-text { margin: 0; color: #c84b31; font-size: 12px; }
.block-box {
  background: #fdf1ee;
  border: 1px solid #f0d4cc;
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 13px;
  color: #a33a22;
}
.block-box ul { margin: 6px 0 0; padding-left: 20px; display: grid; gap: 4px; }
.cards { display: grid; gap: 12px; }
.empty-detail { color: #69758c; font-size: 14px; }
</style>
