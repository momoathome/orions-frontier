import { reactive, ref } from 'vue';
import type { VisibleStation } from '@orions-frontier/shared';

export type SelectedEntity =
  { type: 'asteroid'; id: string } | { type: 'station'; station: VisibleStation };

const selected = ref<SelectedEntity | null>(null);

const selectionStore = reactive({
  selected,
  select: (entity: SelectedEntity) => (selected.value = entity),
  deselect: () => (selected.value = null),
});

export const useSelectionStore = () => selectionStore;
