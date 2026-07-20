import { reactive, ref } from 'vue';

export interface SelectedEntity {
  type: 'asteroid';
  id: string;
}

const selected = ref<SelectedEntity | null>(null);

const selectionStore = reactive({
  selected,
  select: (entity: SelectedEntity) => (selected.value = entity),
  deselect: () => (selected.value = null),
});

export const useSelectionStore = () => selectionStore;
