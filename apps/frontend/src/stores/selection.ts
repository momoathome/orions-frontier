import { defineStore } from 'pinia';
import { ref } from 'vue';

export type EntityType = 'asteroid' | 'station';

export interface SelectedEntity {
  type: EntityType;
  id: string;
}

export const useSelectionStore = defineStore('selection', () => {
  const selected = ref<SelectedEntity | null>(null);
  const hoveredId = ref<string | null>(null);

  function select(entity: SelectedEntity | null) {
    selected.value = entity;
  }

  function deselect() {
    selected.value = null;
  }

  function setHover(id: string | null) {
    hoveredId.value = id;
  }

  return { selected, hoveredId, select, deselect, setHover };
});
