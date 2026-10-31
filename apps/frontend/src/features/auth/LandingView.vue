<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import CostList from '../../shared/ui/CostList.vue';
import { formatCountdown } from '../../shared/lib/format';

// The preview is a static scene; only its countdowns run, looping so it never shows 0:00.
const elapsed = ref(0);
const timer = window.setInterval(() => {
  elapsed.value++;
}, 1_000);
onBeforeUnmount(() => {
  window.clearInterval(timer);
});

const left = (span: number) => span - (elapsed.value % span);
const countdown = (span: number) => formatCountdown(left(span) * 1_000, 0);
const progress = (span: number, total: number) => `${(1 - left(span) / total) * 100}%`;

const stock = [
  { key: 'carbon', name: 'Carbon', amount: 1_284, rate: 412 },
  { key: 'titanium', name: 'Titanium', amount: 642, rate: 208 },
];
const capacity = 5_000;
const coreLevel3Cost = [
  { resourceKey: 'carbon', amount: 338 },
  { resourceKey: 'titanium', amount: 225 },
];

const schedule = [
  { when: 'Every 10–30 min', what: 'Raids, quick rebuilds, rerouting miners' },
  { when: 'Every 2–4 h', what: 'New targets when an asteroid runs dry, mid-size upgrades' },
  { when: 'Once or twice a day', what: 'Long upgrades and a warehouse that lasts the night' },
];
</script>

<template>
  <div class="min-h-screen bg-ui-bg text-left text-ui-text">
    <section class="relative isolate">
      <header class="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <span class="text-[17px] font-medium text-ui-bright">Orion's Frontier</span>
        <nav class="flex items-center gap-6">
          <router-link
            to="/login"
            class="text-sm text-ui-soft transition-colors hover:text-ui-bright"
          >
            Log in
          </router-link>
          <router-link to="/register" class="ui-btn ui-btn-primary h-9">Play</router-link>
        </nav>
      </header>

      <div class="enter mx-auto flex max-w-6xl px-6 pt-16 md:pt-28">
        <div class="max-w-xl md:ml-auto md:max-w-[32rem]">
          <h1
            class="text-[40px] leading-[1.05] font-medium tracking-[-0.02em] text-ui-bright md:text-[56px] md:tracking-[-0.03em]"
          >
            Claim asteroids, build stations, burn rival ones down
          </h1>
          <p class="mt-6 max-w-[36rem] text-lg leading-7 text-ui-soft">
            A persistent strategy game in your browser. Your miners keep hauling while you're
            offline. You decide where they dig and whom to raid.
          </p>
          <div class="mt-8 flex items-center gap-6">
            <router-link to="/register" class="ui-btn ui-btn-primary h-12 px-5 text-[15px]">
              Start your station
            </router-link>
            <router-link
              to="/login"
              class="text-sm text-ui-soft transition-colors hover:text-ui-bright"
            >
              Log in
            </router-link>
          </div>
        </div>
      </div>

      <!-- Below the actions on phones, behind the headline on wide screens. -->
      <img
        src="/assets/spacecrafts/mole.webp"
        alt="A Mole mining ship cutting into an asteroid with an orange beam"
        width="3641"
        height="2048"
        fetchpriority="high"
        class="hero-image relative -z-10 mt-8 w-full md:absolute md:top-0 md:-left-[8%] md:mt-0"
      />

      <!-- Product preview: rises from the hero's bottom edge into the next section. -->
      <div class="enter enter-late relative mx-auto -mt-16 -mb-32 max-w-5xl px-6 md:mt-32">
        <div
          class="rounded-2xl border border-ui-line bg-ui-panel p-2 shadow-[0_24px_48px_rgba(0,0,0,0.5)]"
        >
          <div class="grid gap-2 md:grid-cols-3">
            <div class="ui-card gap-3 rounded-xl p-4">
              <div class="flex items-baseline justify-between">
                <span class="font-medium text-ui-bright">Kestrel</span>
                <span class="text-xs text-ui-muted">Station queue</span>
              </div>
              <div class="flex flex-col gap-1.5">
                <div class="flex justify-between text-sm">
                  <span>Core → level 3</span>
                  <span class="ui-num text-ui-cyan">{{ countdown(252) }}</span>
                </div>
                <div class="ui-bar">
                  <div class="h-full bg-ui-cyan" :style="{ width: progress(252, 900) }"></div>
                </div>
              </div>
              <div class="flex flex-col gap-1.5">
                <div class="flex justify-between text-sm">
                  <span>Shipyard · 2 Moles</span>
                  <span class="ui-num text-ui-soft">{{ countdown(698) }}</span>
                </div>
                <div class="ui-bar">
                  <div class="h-full bg-ui-dim" :style="{ width: progress(698, 1_200) }"></div>
                </div>
              </div>
            </div>

            <div class="ui-card gap-3 rounded-xl p-4">
              <div class="flex items-baseline justify-between">
                <span class="font-medium text-ui-bright">Asteroid C-117</span>
                <span class="text-xs text-ui-muted">3 Moles mining</span>
              </div>
              <div class="flex items-baseline justify-between">
                <span class="text-sm text-ui-soft">Next delivery</span>
                <span class="ui-num text-[22px] text-ui-amber">{{ countdown(425) }}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-ui-soft">Brings</span>
                <span class="ui-num">300 carbon</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-ui-soft">Rock lasts</span>
                <span class="ui-num">2.4 d</span>
              </div>
            </div>

            <div class="ui-card hidden gap-3 rounded-xl p-4 md:flex">
              <div class="flex items-baseline justify-between">
                <span class="font-medium text-ui-bright">Warehouse</span>
                <span class="text-xs text-ui-muted">Full in 9.1 h</span>
              </div>
              <div v-for="res in stock" :key="res.key" class="flex flex-col gap-1.5">
                <div class="flex justify-between text-sm">
                  <span>{{ res.name }}</span>
                  <span class="ui-num">
                    {{ res.amount.toLocaleString('en-US') }}
                    <span class="text-ui-muted">+{{ res.rate }}/h</span>
                  </span>
                </div>
                <div class="ui-bar">
                  <div
                    class="h-full bg-ui-soft"
                    :style="{ width: `${(res.amount / capacity) * 100}%` }"
                  ></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="mx-auto max-w-6xl px-6 pt-56 pb-24 md:pb-32">
      <h2 class="text-[32px] leading-tight font-medium text-ui-bright">How a station grows</h2>
      <div class="mt-10 grid gap-4 md:grid-cols-[1fr_1fr_1.4fr]">
        <article class="ui-card gap-3 rounded-xl p-6">
          <h3 class="text-lg font-medium text-ui-bright">Mine</h3>
          <p class="text-[15px] text-ui-soft">
            Send Moles to asteroids near your station. Each round trip hauls 100 of whatever the
            rock holds.
          </p>
          <p class="ui-num mt-auto pt-3 text-[13px] text-ui-muted">About 15 min per round trip</p>
        </article>
        <article class="ui-card gap-3 rounded-xl p-6">
          <h3 class="text-lg font-medium text-ui-bright">Build</h3>
          <p class="text-[15px] text-ui-soft">
            Spend the haul on the core, the warehouse and the shipyard. A bigger warehouse lets you
            stay away longer.
          </p>
          <div class="mt-auto flex flex-col gap-1.5 pt-3">
            <span class="text-[13px] text-ui-muted">Core level 3</span>
            <CostList :costs="coreLevel3Cost" />
          </div>
        </article>
        <article class="ui-card gap-3 rounded-xl p-6">
          <h3 class="text-lg font-medium text-ui-bright">Raid or defend</h3>
          <p class="text-[15px] text-ui-soft">
            Stations aren't captured, they're destroyed. Found a second one before your neighbors
            come for the first, and salvage the debris they leave behind.
          </p>
          <p class="ui-num mt-auto pt-3 text-[13px] text-ui-muted">
            New players start with 24 h of protection
          </p>
        </article>
      </div>
    </section>

    <section class="border-t border-ui-line">
      <div class="mx-auto grid max-w-6xl gap-10 px-6 py-24 md:grid-cols-2 md:py-32">
        <div>
          <h2 class="text-[32px] leading-tight font-medium text-ui-bright">
            Play on your schedule
          </h2>
          <p class="mt-4 max-w-[32rem] text-[15px] text-ui-soft">
            Orders run on their own, online or not. Your warehouse decides how long you can stay
            away before cargo goes to waste.
          </p>
        </div>
        <ul class="flex flex-col">
          <li
            v-for="row in schedule"
            :key="row.when"
            class="grid gap-1 border-b border-ui-line py-4 first:pt-0 sm:grid-cols-[11rem_1fr] sm:gap-6"
          >
            <span class="ui-num text-sm text-ui-cyan">{{ row.when }}</span>
            <span class="text-[15px] text-ui-soft">{{ row.what }}</span>
          </li>
        </ul>
      </div>
    </section>

    <footer class="border-t border-ui-line">
      <div
        class="mx-auto flex h-16 max-w-6xl items-center justify-between px-6 text-sm text-ui-muted"
      >
        <span>Orion's Frontier</span>
        <router-link to="/register" class="transition-colors hover:text-ui-text"
          >Start your station</router-link
        >
      </div>
    </footer>
  </div>
</template>

<style scoped>
.hero-image {
  mask-image: linear-gradient(to bottom, transparent, #000 20%, #000 65%, transparent);
}
/* On wide screens the scene keeps its 16:9 frame, so the ship stays left of the headline. */
@media (min-width: 768px) {
  .hero-image {
    mask-image:
      linear-gradient(to right, #000 45%, transparent 95%),
      linear-gradient(to bottom, #000 65%, transparent);
    mask-composite: intersect;
  }
}
.enter {
  animation: enter 400ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
.enter-late {
  animation-delay: 60ms;
}
@keyframes enter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .enter {
    animation: none;
  }
}
</style>
