<script setup lang="ts">
import { computed, ref } from "vue";
import { useShiftStore } from "../stores/shifts";

const store = useShiftStore();
const emit = defineEmits<{ (e: "created", shiftId: string): void }>();

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaults() {
  const last = store.chain[store.chain.length - 1];
  const start = last ? new Date(last.end) : new Date();
  const end = new Date(start.getTime() + 8 * 3600_000);
  const hour = start.getHours();
  const slot = hour < 9 ? "早班" : hour < 17 ? "中班" : "晚班";
  const name = `${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")} ${slot}`;
  return { name, start: toLocalInput(start), end: toLocalInput(end) };
}

const form = ref(defaults());
const error = ref("");

const canSubmit = computed(() => form.value.name.trim() && form.value.start && form.value.end);

function submit() {
  error.value = "";
  if (!canSubmit.value) return;
  if (new Date(form.value.end).getTime() <= new Date(form.value.start).getTime()) {
    error.value = "结束时间必须晚于开始时间";
    return;
  }
  const result = store.createShift(form.value.name, form.value.start, form.value.end);
  const created = store.chain.find(
    (s) => s.name === form.value.name.trim() && s.start === form.value.start
  );
  if (created) {
    emit("created", created.id);
    form.value = defaults();
  } else {
    error.value = result.issues.map((i) => i.message).join("；") || "创建失败";
  }
}
</script>

<template>
  <form class="panel new-form" @submit.prevent="submit">
    <h2>新增班次</h2>
    <label>班次名称
      <input v-model="form.name" required placeholder="如 09-19 早班" />
    </label>
    <label>班次开始
      <input v-model="form.start" type="datetime-local" required />
    </label>
    <label>班次结束
      <input v-model="form.end" type="datetime-local" required />
    </label>
    <p v-if="error" class="error">{{ error }}</p>
    <button type="submit">创建并继承上一班泵码</button>
  </form>
</template>

<style scoped>
.new-form { display: grid; gap: 10px; }
h2 { margin: 0; font-size: 18px; }
.error { margin: 0; color: #c84b31; font-size: 12px; }
</style>
