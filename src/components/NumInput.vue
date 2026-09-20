<script setup lang="ts">
// 受控数字输入：空串归一化为 null，便于“来源缺失”判定
const props = defineProps<{ value: number | null; disabled?: boolean; step?: string; title?: string }>();
const emit = defineEmits<{ (e: "update", value: number | null): void }>();

function onInput(event: Event) {
  const raw = (event.target as HTMLInputElement).value;
  if (raw.trim() === "") {
    emit("update", null);
    return;
  }
  const n = Number(raw);
  emit("update", Number.isFinite(n) ? n : null);
}
</script>

<template>
  <input
    type="number"
    :value="props.value ?? ''"
    :disabled="props.disabled"
    :step="props.step ?? '0.01'"
    :title="props.title"
    @input="onInput"
  />
</template>
