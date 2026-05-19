<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import type { BuildOrder } from '../lib/spacecraft-utils';
import { roleTheme, formatBuildTime } from '../lib/spacecraft-utils';

const props = defineProps<{
  orders: BuildOrder[];
}>();

const now = ref(new Date());
const interval = setInterval(() => {
  now.value = new Date();
}, 1000);
onUnmounted(() => clearInterval(interval));

// Items are hidden the moment their timer reaches 0 — the WS event + reload
// will remove them from the server data shortly after
const visibleOrders = computed(() =>
  props.orders.filter((o) => new Date(o.endsAt).getTime() > now.value.getTime()),
);

function timeUntil(isoStr: string): string {
  const ms = new Date(isoStr).getTime() - now.value.getTime();
  if (ms <= 0) return 'Done';
  return formatBuildTime(Math.ceil(ms / 1000));
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <span class="text-[9px] text-white/20 uppercase tracking-widest mb-0.5">Queue</span>
    <div v-if="visibleOrders.length === 0" class="flex items-center h-5">
      <span class="text-[10px] text-white/15">— idle</span>
    </div>
    <div v-for="(order, i) in visibleOrders" :key="order.id" class="flex items-center gap-1.5 h-5">
      <span
        class="w-1 h-1 rounded-full shrink-0"
        :class="i === 0 ? 'bg-amber-400 animate-pulse' : 'bg-white/15'"
      />
      <span
        class="text-[10px] truncate flex-1"
        :class="i === 0 ? 'text-white/60' : 'text-white/35'"
      >
        {{ order.spacecraftName }}
      </span>
      <span
        class="text-[10px] tabular-nums shrink-0"
        :class="roleTheme(order.spacecraftRole).amount"
        >×{{ order.amount }}</span
      >
      <span class="text-[10px] text-white/30 tabular-nums shrink-0 w-16 text-right">
        {{ timeUntil(order.endsAt) }}
      </span>
    </div>
  </div>
</template>
