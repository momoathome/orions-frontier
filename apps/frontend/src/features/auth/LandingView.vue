<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, type Directive } from 'vue';
import CostList from '../../shared/ui/CostList.vue';
import { formatCountdown } from '../../shared/lib/format';
import Wordmark from './Wordmark.vue';

// The preview is a static scene; only its countdowns run, looping so it never shows 0:00.
const elapsed = ref(0);
const timer = window.setInterval(() => {
  elapsed.value++;
}, 1_000);
// Warehouse bars grow from empty once the preview is on screen.
const filled = ref(false);
onMounted(() => requestAnimationFrame(() => (filled.value = true)));

// Sections fade up once when they scroll into view; the value is a stagger delay in ms.
const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('revealed');
      observer.unobserve(entry.target);
    }
  },
  { threshold: 0.15 }
);
const vReveal: Directive<HTMLElement, number | undefined> = {
  mounted(el, { value }) {
    el.classList.add('reveal');
    if (value) el.style.transitionDelay = `${value}ms`;
    observer.observe(el);
  },
};

onBeforeUnmount(() => {
  window.clearInterval(timer);
  observer.disconnect();
});

// Stock grows at its real hourly rate, so the numbers tick like they do in the game.
const amount = (base: number, rate: number) =>
  Math.floor(base + (rate * elapsed.value) / 3_600).toLocaleString('en-US');
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

const steps = [
  {
    title: 'Mine',
    image: '/assets/spacecrafts/mole.webp',
    alt: 'A Mole drilling into an asteroid',
    crop: 'object-[70%_75%]',
    text: 'Send Moles to asteroids near your station. Each round trip hauls 100 of whatever the rock holds.',
    fact: 'About 15 min per round trip',
  },
  {
    title: 'Build',
    image: '/assets/buildings/core.webp',
    alt: 'A station core',
    crop: 'object-center',
    text: 'Spend the haul on the core, the warehouse and the shipyard. A bigger warehouse lets you stay away longer.',
    costs: coreLevel3Cost,
  },
  {
    title: 'Raid',
    image: '/assets/spacecrafts/javelin.webp',
    alt: 'A Javelin assault fighter',
    crop: 'object-center',
    text: "Send fighters and bombers at a neighbor's station. Every won battle wears its integrity down until it falls.",
    fact: 'New players start with 24 h of protection',
  },
  {
    title: 'Salvage',
    image: '/assets/spacecrafts/collector.webp',
    alt: 'A Collector salvage ship',
    crop: 'object-center',
    text: 'A fallen station leaves a debris field. Send Collectors to haul the wreckage home for the next build.',
    fact: 'Anyone in scanner range can claim it',
  },
];
const flowIcons = ['carbon', 'titanium', 'cobalt'];

// A day at a station whose warehouse is full after 9.1 h, like the preview card above.
const HOURS_TO_FULL = 9.1;
// Share left in the warehouse after a check-in spends the rest on builds.
const AFTER_CHECK_IN = 0.1;
const checkInHours = ref(3);
const schedule = [
  { hours: 0.5, when: 'Every 10–30 min', what: 'Raids, quick rebuilds, rerouting miners' },
  {
    hours: 3,
    when: 'Every 2–4 h',
    what: 'New targets when an asteroid runs dry, mid-size upgrades',
  },
  {
    hours: 12,
    when: 'Once or twice a day',
    what: 'Long upgrades and a warehouse that lasts the night',
  },
];
const intervalLabel = computed(() =>
  checkInHours.value < 1 ? `${checkInHours.value * 60} min` : `${checkInHours.value} h`
);
// Sawtooth of warehouse fill over 24 h in a 480×160 chart; full stretches are cargo lost.
const day = computed(() => {
  const x = (hour: number) => (hour / 24) * 480;
  const y = (fill: number) => 150 - fill * 130;
  let line = `M0 ${y(AFTER_CHECK_IN)}`;
  const full: string[] = [];
  const checkIns: number[] = [];
  let wastedHours = 0;
  for (let start = 0; start < 24; start += checkInHours.value) {
    const end = Math.min(start + checkInHours.value, 24);
    const fullAt = start + (1 - AFTER_CHECK_IN) * HOURS_TO_FULL;
    if (fullAt < end) {
      line += ` L${x(fullAt)} ${y(1)} L${x(end)} ${y(1)}`;
      full.push(`M${x(fullAt)} ${y(1)} L${x(end)} ${y(1)}`);
      wastedHours += end - fullAt;
    } else {
      line += ` L${x(end)} ${y(AFTER_CHECK_IN + (end - start) / HOURS_TO_FULL)}`;
    }
    if (end < 24) {
      line += ` L${x(end)} ${y(AFTER_CHECK_IN)}`;
      checkIns.push(x(end));
    }
  }
  return { line, area: `${line} L480 150 L0 150 Z`, full: full.join(' '), checkIns, wastedHours };
});

// What the preview station's rates bring in over 7 h 40 min away.
const awayHaul = stock.map((res) => ({
  resourceKey: res.key,
  amount: Math.floor(res.rate * (7 + 40 / 60)),
}));
</script>

<template>
  <div class="min-h-screen bg-ui-bg text-left text-ui-text">
    <section class="relative isolate">
      <header class="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Wordmark class="text-[13px] sm:text-[15px]" />
        <nav class="flex items-center gap-4 whitespace-nowrap sm:gap-6">
          <router-link
            to="/login"
            class="text-sm text-ui-soft transition-colors hover:text-ui-bright"
          >
            Log in
          </router-link>
          <router-link to="/register" class="ui-btn ui-btn-cta h-9">Play</router-link>
        </nav>
      </header>

      <div class="mx-auto flex max-w-6xl px-6 pt-16 md:pt-24">
        <div class="max-w-xl md:ml-auto md:max-w-[32rem]">
          <p class="enter text-[13px] font-semibold tracking-[0.3em] text-ui-amber uppercase">
            Persistent browser strategy
          </p>
          <h1
            class="[animation-delay:80ms] hero-title enter mt-4 text-[48px] leading-[0.95] font-semibold tracking-[0.02em] text-ui-bright uppercase md:text-[80px]"
          >
            Orion's Frontier
          </h1>
          <p
            class="[animation-delay:160ms] enter mt-6 text-[22px] leading-tight font-medium text-ui-text md:text-[26px]"
          >
            Claim asteroids, build stations, burn rival ones down.
          </p>
          <p
            class="[animation-delay:220ms] enter mt-4 max-w-[36rem] text-[17px] leading-7 text-ui-soft"
          >
            Your miners keep hauling while you're offline. You decide where they dig and whom to
            raid.
          </p>
          <div class="[animation-delay:280ms] enter mt-8 flex items-center gap-6">
            <router-link to="/register" class="ui-btn ui-btn-cta h-12 px-6 text-[15px]">
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
      <div class="stars absolute inset-0 -z-20" aria-hidden="true"></div>
      <div class="hero-scene relative -z-10 mt-8 w-full md:absolute md:top-0 md:-left-[8%] md:mt-0">
        <img
          src="/assets/spacecrafts/mole.webp"
          alt="A Mole mining ship cutting into an asteroid with an orange beam"
          width="3641"
          height="2048"
          fetchpriority="high"
          class="hero-image w-full"
        />
        <!-- Pulsing glow and sparks where the beam meets the rock. -->
        <div class="beam" aria-hidden="true">
          <span
            v-for="n in 6"
            :key="n"
            class="spark"
            :style="{ '--angle': `${n * 40 - 150}deg`, animationDelay: `${n * 0.31}s` }"
          ></span>
        </div>
      </div>

      <!-- Product preview: rises from the hero's bottom edge into the next section. -->
      <div
        class="enter relative mx-auto [animation-delay:360ms] -mt-16 -mb-32 max-w-5xl px-6 md:mt-32"
      >
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
                    {{ amount(res.amount, res.rate) }}
                    <span class="text-ui-muted">+{{ res.rate }}/h</span>
                  </span>
                </div>
                <div class="ui-bar">
                  <div
                    class="h-full bg-ui-soft transition-[width] duration-[1600ms] ease-out"
                    :style="{ width: filled ? `${(res.amount / capacity) * 100}%` : '0%' }"
                  ></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="mx-auto max-w-6xl px-6 pt-56 pb-24 md:pb-32">
      <h2 v-reveal class="text-[32px] leading-tight font-medium text-ui-bright">
        How a station grows
      </h2>

      <!-- The loop on wide screens: cargo runs through all four steps, salvage feeds the next build. -->
      <div v-reveal class="relative mt-10 hidden h-24 lg:block" aria-hidden="true">
        <svg
          class="absolute inset-x-0 top-0 h-16 w-full"
          viewBox="0 0 100 20"
          preserveAspectRatio="none"
        >
          <path
            class="loop-back"
            d="M87.5 20 C87.5 1 37.5 1 37.5 20"
            fill="none"
            stroke="#23344c"
            stroke-width="1.5"
            stroke-dasharray="5 5"
            vector-effect="non-scaling-stroke"
          />
        </svg>
        <span
          class="absolute top-1 left-[62.5%] -translate-x-1/2 bg-ui-bg px-2 font-mono text-xs text-ui-muted"
        >
          salvage pays for the next build
        </span>
        <div class="flow absolute top-16 right-[12.5%] left-[12.5%] h-px">
          <img
            v-for="(key, i) in flowIcons"
            :key="key"
            :src="`/assets/resources/${key}.png`"
            alt=""
            class="flow-icon"
            :style="{ animationDelay: `${i * 2.4}s` }"
          />
        </div>
        <div class="absolute inset-x-0 top-16 grid grid-cols-4">
          <span
            v-for="(step, i) in steps"
            :key="step.title"
            class="z-10 mx-auto flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-ui-amber bg-ui-bg font-mono text-xs text-ui-amber"
          >
            0{{ i + 1 }}
          </span>
        </div>
      </div>

      <div class="mt-10 grid gap-4 md:grid-cols-2 lg:mt-0 lg:grid-cols-4">
        <article
          v-for="(step, i) in steps"
          :key="step.title"
          v-reveal="i * 100"
          class="ui-card group gap-0 overflow-hidden rounded-xl p-0"
        >
          <div class="relative aspect-[16/10] overflow-hidden">
            <img
              :src="step.image"
              :alt="step.alt"
              loading="lazy"
              class="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
              :class="step.crop"
            />
            <div
              class="absolute inset-0 bg-gradient-to-t from-ui-card via-transparent to-transparent"
            ></div>
            <span class="absolute top-3 left-3 font-mono text-xs text-ui-amber lg:hidden">
              0{{ i + 1 }}
            </span>
          </div>
          <div class="flex flex-1 flex-col gap-3 p-5 pt-2">
            <h3 class="text-lg font-medium text-ui-bright">{{ step.title }}</h3>
            <p class="text-[15px] text-ui-soft">{{ step.text }}</p>
            <div v-if="step.costs" class="mt-auto flex flex-col gap-1.5 pt-3">
              <span class="text-[13px] text-ui-muted">Core level 3</span>
              <CostList :costs="step.costs" />
            </div>
            <p v-else class="ui-num mt-auto pt-3 text-[13px] text-ui-muted">{{ step.fact }}</p>
          </div>
        </article>
      </div>

      <blockquote v-reveal class="mt-20 border-l-2 border-ui-orange pl-6 md:pl-8">
        <p class="text-[28px] leading-tight font-medium text-ui-bright md:text-[40px]">
          Stations aren't captured. <span class="text-ui-orange">They're destroyed.</span>
        </p>
        <p class="mt-3 max-w-[36rem] text-[17px] text-ui-soft">
          Found a second one before your neighbors come for the first.
        </p>
      </blockquote>
    </section>

    <section class="border-t border-ui-line">
      <div
        class="mx-auto grid max-w-6xl items-start gap-12 px-6 py-24 md:grid-cols-[1fr_1.25fr] md:py-32"
      >
        <div v-reveal>
          <h2 class="text-[32px] leading-tight font-medium text-ui-bright">
            Play on your schedule
          </h2>
          <p class="mt-4 max-w-[32rem] text-[15px] text-ui-soft">
            Orders run on their own, online or not. Your warehouse decides how long you can stay
            away before cargo goes to waste.
          </p>

          <div class="ui-card mt-8 gap-3 rounded-xl p-5">
            <div class="flex items-baseline justify-between">
              <span class="font-medium text-ui-bright">Welcome back</span>
              <span class="ui-num text-xs text-ui-muted">Away 7 h 40 min</span>
            </div>
            <ul class="flex flex-col gap-2.5 text-sm">
              <li class="flex items-center justify-between gap-4">
                <span class="flex items-center gap-2">
                  <span class="h-1.5 w-1.5 rounded-full bg-ui-amber"></span>Hauled
                </span>
                <CostList :costs="awayHaul" />
              </li>
              <li class="flex items-center gap-2">
                <span class="h-1.5 w-1.5 rounded-full bg-ui-green"></span>Core reached level 3
              </li>
              <li class="flex items-center gap-2">
                <span class="h-1.5 w-1.5 rounded-full bg-ui-cyan"></span>2 Moles left the shipyard
              </li>
              <li class="flex items-center gap-2">
                <span class="h-1.5 w-1.5 rounded-full bg-ui-red"></span>Raid on Kestrel repelled
              </li>
            </ul>
          </div>
        </div>

        <div v-reveal="100" class="ui-card gap-4 rounded-2xl p-5 md:p-6">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <span class="font-medium text-ui-bright">A day at your warehouse</span>
            <span
              class="ui-num text-sm"
              :class="day.wastedHours ? 'text-ui-red' : 'text-ui-green'"
              aria-live="polite"
            >
              {{
                day.wastedHours
                  ? `Full for ${day.wastedHours.toFixed(1)} h, cargo lost`
                  : 'Nothing goes to waste'
              }}
            </span>
          </div>

          <div>
            <svg
              viewBox="0 0 480 160"
              class="w-full overflow-visible"
              role="img"
              :aria-label="`Warehouse fill over 24 hours when checking in every ${intervalLabel}`"
            >
              <defs>
                <linearGradient id="warehouse-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stop-color="#5fd6e6" stop-opacity="0.3" />
                  <stop offset="1" stop-color="#5fd6e6" stop-opacity="0" />
                </linearGradient>
              </defs>
              <line x1="0" x2="480" y1="20" y2="20" stroke="#23344c" stroke-dasharray="4 4" />
              <text x="476" y="14" text-anchor="end" class="fill-ui-muted font-mono text-[11px]">
                capacity
              </text>
              <path class="day-path" :d="day.area" fill="url(#warehouse-fill)" />
              <path
                class="day-path"
                :d="day.line"
                fill="none"
                stroke="#5fd6e6"
                stroke-width="1.5"
                stroke-linejoin="round"
              />
              <path class="day-path" :d="day.full" stroke="#f29a9a" stroke-width="3" />
              <circle v-for="cx in day.checkIns" :key="cx" :cx="cx" cy="150" r="3" fill="#f2bd55" />
            </svg>
            <div class="mt-2 flex justify-between font-mono text-[11px] text-ui-muted">
              <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span
              ><span>24:00</span>
            </div>
          </div>

          <label class="flex flex-col gap-2">
            <span class="flex justify-between text-sm">
              <span class="text-ui-soft">Check in every</span>
              <span class="ui-num text-ui-amber">{{ intervalLabel }}</span>
            </span>
            <input
              v-model.number="checkInHours"
              type="range"
              min="0.5"
              max="12"
              step="0.5"
              class="w-full accent-ui-amber"
              :aria-valuetext="intervalLabel"
            />
          </label>

          <ul class="flex flex-col border-t border-ui-line">
            <li v-for="row in schedule" :key="row.when">
              <button
                type="button"
                class="grid w-full gap-1 border-b border-ui-line py-3 text-left transition-colors hover:bg-ui-panel sm:grid-cols-[10rem_1fr] sm:gap-4"
                :aria-pressed="checkInHours === row.hours"
                @click="checkInHours = row.hours"
              >
                <span
                  class="ui-num text-sm"
                  :class="checkInHours === row.hours ? 'text-ui-amber' : 'text-ui-cyan'"
                  >{{ row.when }}</span
                >
                <span class="text-[15px] text-ui-soft">{{ row.what }}</span>
              </button>
            </li>
          </ul>
        </div>
      </div>
    </section>

    <section class="closing relative overflow-hidden border-t border-ui-line">
      <div v-reveal class="mx-auto flex max-w-6xl flex-col items-center px-6 py-24 text-center">
        <Wordmark class="text-[28px] md:text-[44px]" />
        <p class="mt-5 max-w-[32rem] text-[17px] text-ui-soft">
          The Belt is already being mined. Claim your first rock before your neighbors do.
        </p>
        <router-link to="/register" class="ui-btn ui-btn-cta mt-8 h-12 px-6 text-[15px]">
          Start your station
        </router-link>
      </div>
    </section>

    <footer class="border-t border-ui-line">
      <div
        class="mx-auto flex h-16 max-w-6xl items-center justify-between px-6 text-sm text-ui-muted"
      >
        <Wordmark class="text-[12px] text-ui-muted" />
        <router-link to="/login" class="transition-colors hover:text-ui-text">Log in</router-link>
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
.hero-title {
  text-shadow: 0 0 48px rgba(242, 189, 85, 0.18);
}
.hero-scene {
  animation: drift 8s ease-in-out infinite;
}
@keyframes drift {
  50% {
    transform: translate(-4px, -10px) rotate(-0.4deg);
  }
}

/* Sits on the drill tip in the 16:9 scene, so it follows the ship. */
.beam {
  position: absolute;
  left: 66%;
  top: 75%;
  width: 14%;
  aspect-ratio: 1;
  translate: -50% -50%;
  border-radius: 50%;
  background: radial-gradient(
    rgba(255, 170, 90, 0.55),
    rgba(240, 138, 75, 0.15) 45%,
    transparent 70%
  );
  mix-blend-mode: screen;
  animation: pulse 2.6s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.45;
    scale: 0.85;
  }
}
.spark {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: #ffd9a0;
  box-shadow: 0 0 6px #f08a4b;
  animation: spark 1.9s ease-out infinite both;
}
@keyframes spark {
  from {
    transform: rotate(var(--angle)) translateX(0);
    opacity: 1;
  }
  to {
    transform: rotate(var(--angle)) translateX(70px);
    opacity: 0;
  }
}

.stars,
.stars::after {
  background-image:
    radial-gradient(1px 1px at 20px 30px, rgba(255, 255, 255, 0.6), transparent),
    radial-gradient(1px 1px at 150px 90px, rgba(255, 255, 255, 0.45), transparent),
    radial-gradient(1.5px 1.5px at 260px 170px, rgba(255, 255, 255, 0.7), transparent),
    radial-gradient(1px 1px at 90px 230px, rgba(255, 255, 255, 0.4), transparent),
    radial-gradient(1px 1px at 330px 40px, rgba(190, 230, 255, 0.5), transparent);
  background-size: 360px 280px;
}
.stars::after {
  content: '';
  position: absolute;
  inset: 0;
  background-size: 470px 390px;
  background-position: 130px 70px;
  animation: twinkle 4s ease-in-out infinite alternate;
}
@keyframes twinkle {
  to {
    opacity: 0.15;
  }
}

.flow {
  background: repeating-linear-gradient(to right, #23344c 0 6px, transparent 6px 12px);
  background-size: 12px 1px;
  animation: dashes 0.8s linear infinite;
}
@keyframes dashes {
  to {
    background-position: 12px 0;
  }
}
.flow-icon {
  position: absolute;
  top: 0;
  width: 20px;
  height: 20px;
  translate: -50% -50%;
  animation: haul 7.2s linear infinite both;
}
@keyframes haul {
  from {
    left: 0;
    opacity: 0;
  }
  8%,
  92% {
    opacity: 1;
  }
  to {
    left: 100%;
    opacity: 0;
  }
}
.loop-back {
  animation: loop-back 1.2s linear infinite;
}
@keyframes loop-back {
  to {
    stroke-dashoffset: -10;
  }
}
.day-path {
  transition: d 400ms cubic-bezier(0.22, 1, 0.36, 1);
}

.closing {
  background: radial-gradient(60% 80% at 50% 100%, rgba(242, 189, 85, 0.08), transparent);
}

/* Longhands, so the [animation-delay:…] utilities on each element still apply. */
.enter {
  animation-name: enter;
  animation-duration: 700ms;
  animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  animation-fill-mode: both;
}
@keyframes enter {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
}
.reveal {
  opacity: 0;
  transform: translateY(24px);
  transition:
    opacity 700ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 700ms cubic-bezier(0.22, 1, 0.36, 1);
}
.reveal.revealed {
  opacity: 1;
  transform: none;
}

@media (prefers-reduced-motion: reduce) {
  .enter,
  .hero-scene,
  .beam,
  .spark,
  .stars::after,
  .flow,
  .loop-back {
    animation: none;
  }
  .spark,
  .flow-icon {
    display: none;
  }
  .reveal {
    opacity: 1;
    transform: none;
    transition: none;
  }
}
</style>
