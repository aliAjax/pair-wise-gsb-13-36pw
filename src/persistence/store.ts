// 持久化层：localStorage 读写 + 结构校验/迁移，页面与规则不直接接触存储
import type { AppState } from "../domain/types";
import { createSeedState } from "../domain/seed";

const STORAGE_KEY = "gas-shift-reconcile-v1";

function isValidState(value: unknown): value is AppState {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return s.schemaVersion === 1 && Array.isArray(s.fuels) && Array.isArray(s.nozzles) && Array.isArray(s.shifts);
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seed = createSeedState();
      saveState(seed);
      return seed;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isValidState(parsed)) {
      // 结构损坏时重置为种子数据，避免页面崩溃
      const seed = createSeedState();
      saveState(seed);
      return seed;
    }
    return parsed;
  } catch {
    return createSeedState();
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("班次数据持久化失败", e);
  }
}

export function resetState(): AppState {
  const seed = createSeedState();
  saveState(seed);
  return seed;
}
