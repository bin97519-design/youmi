<script setup>
import { computed, ref, useId } from 'vue'

const props = defineProps({
  active: Boolean,
  state: {
    type: String,
    default: 'static',
  },
  decorative: Boolean,
  size: {
    type: Number,
    default: 28,
  },
})
const emit = defineEmits(['click'])
const root = ref(null)

const validStates = new Set(['static', 'working', 'waiting-user-actions'])
const orbState = computed(() => (validStates.has(props.state) ? props.state : 'static'))
const filterId = `cv3-liquid-dissolve-${useId().replaceAll(':', '')}`
const liquidStyle = computed(() => ({
  '--liquid-display-scale': props.size / 82,
  width: `${props.size}px`,
  height: `${props.size}px`,
  flexBasis: `${props.size}px`,
}))

defineExpose({
  focus: () => root.value?.focus(),
})

const particles = [
  { size: 0.7, left: 41, delay: 1.25, duration: 2.647, drift: -4 },
  { size: 0.55, left: 58, delay: 0.221, duration: 3.529, drift: 6 },
  { size: 0.8, left: 23, delay: 2.132, duration: 3.015, drift: 3 },
  { size: 0.58, left: 67, delay: 0.662, duration: 3.824, drift: -7 },
  { size: 0.65, left: 34, delay: 1.544, duration: 2.868, drift: 5 },
  { size: 0.5, left: 51, delay: 2.5, duration: 3.309, drift: -2 },
  { size: 0.72, left: 18, delay: 0.882, duration: 3.676, drift: 8 },
  { size: 0.55, left: 62, delay: 1.838, duration: 2.721, drift: -5 },
]
</script>

<template>
  <button
    ref="root"
    class="cv3-agent-orb"
    :class="{
      'is-active': active,
      'is-working': orbState === 'working',
      'is-decorative': decorative,
    }"
    type="button"
    :disabled="decorative"
    :tabindex="decorative ? -1 : undefined"
    aria-label="创作助手"
    :aria-expanded="active"
    :aria-hidden="decorative ? 'true' : undefined"
    @click="emit('click')"
  >
    <span
      class="cv3-liquid-viewport"
      aria-hidden="true"
      :style="liquidStyle"
      :data-orb-state="orbState"
      :data-paused="orbState === 'static' ? 'true' : 'false'"
    >
      <span class="cv3-liquid-state-halo cv3-liquid-animated" />

      <svg class="cv3-liquid-filter" width="0" height="0" aria-hidden="true">
        <defs>
          <filter
            :id="filterId"
            x="-200%"
            y="-200%"
            width="500%"
            height="500%"
            color-interpolation-filters="sRGB"
            overflow="visible"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.0225"
              numOctaves="3"
              result="noise"
            />
            <feColorMatrix
              type="matrix"
              values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 40 -15"
              result="noisyAlpha"
            />
            <feComposite operator="in" in="SourceGraphic" in2="noisyAlpha" />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="300"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>

      <span class="cv3-liquid-surface cv3-liquid-animated">
        <span class="cv3-liquid-layer cv3-liquid-bottom-glow" />
        <span
          class="cv3-liquid-layer cv3-liquid-rotating-glow cv3-liquid-rotating-glow--slow cv3-liquid-motion"
        />
        <span
          class="cv3-liquid-layer cv3-liquid-rotating-glow cv3-liquid-rotating-glow--mid cv3-liquid-motion"
        />
        <span
          class="cv3-liquid-layer cv3-liquid-rotating-glow cv3-liquid-rotating-glow--core cv3-liquid-motion"
        />
        <span class="cv3-liquid-layer cv3-liquid-main-highlight cv3-liquid-animated" />
        <span class="cv3-liquid-layer cv3-liquid-deep" />
        <span class="cv3-liquid-layer cv3-liquid-blob cv3-liquid-blob--left cv3-liquid-motion" />
        <span class="cv3-liquid-layer cv3-liquid-blob cv3-liquid-blob--right cv3-liquid-motion" />
        <span class="cv3-liquid-layer cv3-liquid-wavy cv3-liquid-wavy--a cv3-liquid-motion" />
        <span class="cv3-liquid-layer cv3-liquid-wavy cv3-liquid-wavy--b cv3-liquid-motion" />
        <span class="cv3-liquid-layer cv3-liquid-band cv3-liquid-animated" />
        <span
          class="cv3-liquid-layer cv3-liquid-noise cv3-liquid-animated"
          :style="{ filter: `url(#${filterId}) blur(6px)` }"
        />
        <span class="cv3-liquid-layer cv3-liquid-wash cv3-liquid-animated" />
        <span class="cv3-liquid-layer cv3-liquid-shine cv3-liquid-shine--top cv3-liquid-animated" />
        <span class="cv3-liquid-layer cv3-liquid-shine cv3-liquid-shine--bottom" />
        <span class="cv3-liquid-layer cv3-liquid-shine cv3-liquid-shine--side" />
        <span class="cv3-liquid-layer cv3-liquid-rim cv3-liquid-animated" />
        <span class="cv3-liquid-layer cv3-liquid-cap cv3-liquid-animated" />

        <span
          v-for="(particle, index) in particles"
          :key="index"
          class="cv3-liquid-layer cv3-liquid-particle cv3-liquid-motion"
          :style="{
            '--particle-size': `${particle.size}px`,
            '--particle-left': `${particle.left}px`,
            '--particle-delay': `${particle.delay}s`,
            '--particle-duration': `${particle.duration}s`,
            '--particle-drift': `${particle.drift}px`,
          }"
        />

        <svg
          class="cv3-liquid-orbit cv3-liquid-orbit--outer"
          viewBox="0 0 90 90"
          aria-hidden="true"
        >
          <path
            class="cv3-liquid-orbit-path cv3-liquid-animated"
            d="M 8 45 A 34 34 0 0 1 82 45"
            fill="none"
            stroke="rgb(255 255 255 / var(--liquid-highlights))"
            stroke-width="1"
            stroke-linecap="round"
            transform="rotate(-30 45 45)"
          />
          <path
            class="cv3-liquid-orbit-path cv3-liquid-orbit-path--reverse cv3-liquid-animated"
            d="M 82 45 A 34 34 0 0 0 8 45"
            fill="none"
            stroke="rgb(255 255 255 / var(--liquid-highlights))"
            stroke-width="1"
            stroke-linecap="round"
            transform="rotate(150 45 45)"
          />
        </svg>
        <svg
          class="cv3-liquid-orbit cv3-liquid-orbit--inner"
          viewBox="0 0 90 90"
          aria-hidden="true"
        >
          <path
            class="cv3-liquid-orbit-path cv3-liquid-orbit-path--inner cv3-liquid-animated"
            d="M 15 70 A 40 40 0 0 1 75 20"
            fill="none"
            stroke="rgb(255 255 255 / var(--liquid-highlights))"
            stroke-width="1"
            stroke-linecap="round"
            transform="rotate(-15 45 45)"
          />
          <path
            class="cv3-liquid-orbit-path cv3-liquid-orbit-path--inner-reverse cv3-liquid-animated"
            d="M 15 20 A 40 40 0 0 0 75 70"
            fill="none"
            stroke="rgb(255 255 255 / var(--liquid-highlights))"
            stroke-width="1"
            stroke-linecap="round"
            transform="rotate(15 45 45)"
          />
        </svg>
      </span>
    </span>
    <span v-if="!decorative" class="cv3-agent-orb-label" aria-hidden="true">
      <span>TV Director</span>
    </span>
    <span v-if="!decorative" class="cv3-agent-orb-tooltip" role="tooltip">TV Director</span>
  </button>
</template>

<style scoped>
.cv3-agent-orb {
  position: relative;
  display: flex;
  width: 48px;
  height: 48px;
  min-width: 48px;
  flex: 0 0 48px;
  align-items: center;
  justify-content: center;
  padding: 0 9px;
  overflow: visible;
  border: 1px solid #363636;
  border-radius: 9999px;
  background: #262626;
  color: #f2f2f2;
  cursor: pointer;
  isolation: isolate;
  transition:
    background-color 150ms cubic-bezier(0.4, 0, 0.2, 1),
    border-color 150ms cubic-bezier(0.4, 0, 0.2, 1);
}

.cv3-agent-orb:focus-visible {
  outline: 2px solid #22c8f6;
  outline-offset: 2px;
}

.cv3-agent-orb.is-decorative {
  width: auto;
  height: auto;
  min-width: 0;
  flex: none;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: default;
  pointer-events: none;
}

.cv3-agent-orb-label {
  position: relative;
  z-index: 2;
  display: block;
  width: 0;
  overflow: hidden;
  opacity: 0;
}

.cv3-agent-orb-label > span {
  display: block;
  width: max-content;
  padding-right: 2px;
  padding-left: 6px;
  color: #f2f2f2;
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  white-space: nowrap;
}

.cv3-agent-orb-tooltip {
  position: absolute;
  z-index: 20;
  bottom: calc(100% + 7px);
  left: 50%;
  width: max-content;
  padding: 4px 8px;
  border: 0.5px solid #363636;
  border-radius: 8px;
  background: #000;
  box-shadow:
    0 8px 16px rgba(0, 0, 0, 0.18),
    0 2px 4px rgba(0, 0, 0, 0.2);
  color: #f7f7f7;
  font-size: 12px;
  font-weight: 400;
  line-height: normal;
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, 3px);
  transition:
    opacity 100ms ease,
    transform 100ms ease,
    visibility 0s linear 100ms;
  visibility: hidden;
}

.cv3-agent-orb-tooltip::after {
  position: absolute;
  bottom: -3px;
  left: 50%;
  width: 5px;
  height: 5px;
  border-right: 0.5px solid #363636;
  border-bottom: 0.5px solid #363636;
  background: #000;
  content: '';
  transform: translateX(-50%) rotate(45deg);
}

.cv3-agent-orb:hover .cv3-agent-orb-tooltip {
  opacity: 1;
  transform: translate(-50%, 0);
  transition-delay: 0s;
  visibility: visible;
}

.cv3-liquid-viewport {
  --liquid-display-scale: 0.3414634146;
  --liquid-primary: #00ffc1;
  --liquid-secondary: #007dff;
  --liquid-shell-glow: #a4fff3;
  --liquid-accent: #00e5ff;
  --liquid-bottom-glow: #e2fff6;
  --liquid-highlight: #00ffd5;
  --liquid-deep: #0063cc;
  --liquid-blob: #00fff7;
  --liquid-band: #007dff;
  --liquid-bottom-shine: #00ffc1;
  --liquid-side-shine: #00fff7;
  --liquid-glow: 0;
  --liquid-highlights: 0;
  --liquid-rim-highlights: calc(var(--liquid-highlights) * 0.5);
  --liquid-main-scale: 1;
  --liquid-blob-scale: 1.12;
  position: relative;
  display: block;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  overflow: visible;
  background: transparent;
}

.cv3-liquid-filter {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
}

.cv3-liquid-state-halo {
  position: absolute;
  inset: -7px;
  pointer-events: none;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(0, 229, 255, 0.55), transparent 70%);
  opacity: 0;
  transition: opacity 200ms ease-out;
}

.cv3-liquid-surface {
  position: relative;
  display: block;
  width: 82px;
  height: 82px;
  overflow: hidden;
  border-radius: 50%;
  background: radial-gradient(
    circle at 50% 30%,
    var(--liquid-primary) 0%,
    var(--liquid-secondary) 70%
  );
  box-shadow:
    0 5px 10px color-mix(in srgb, var(--liquid-secondary) 0%, transparent),
    inset 0 0 1px rgb(255 255 255 / 0),
    inset 0 1px 7px color-mix(in srgb, var(--liquid-shell-glow) 0%, transparent);
  isolation: isolate;
  transform: scale(var(--liquid-display-scale));
  transform-origin: 0 0;
}

.cv3-liquid-layer {
  position: absolute;
  pointer-events: none;
}

.cv3-liquid-bottom-glow {
  inset: 0;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 90%, var(--liquid-bottom-glow) 0%, transparent 70%);
}

.cv3-liquid-rotating-glow {
  inset: -8%;
  border-radius: 50%;
  background: radial-gradient(
    circle at 50% 22%,
    #adfff4 0%,
    rgba(0, 229, 255, 0.55) 42%,
    transparent 70%
  );
  filter: blur(3.5px);
  mask-image: radial-gradient(circle at 50% 78%, transparent 38%, #000 68%);
  mix-blend-mode: screen;
}

.cv3-liquid-rotating-glow--slow {
  opacity: 0.55;
  animation: cv3-liquid-spin-ccw 50s linear infinite;
}

.cv3-liquid-rotating-glow--mid {
  opacity: 0.7;
  background: radial-gradient(
    circle at 50% 18%,
    #33eaff 0%,
    rgba(0, 255, 193, 0.4) 48%,
    transparent 72%
  );
  animation: cv3-liquid-spin-cw 31.818s linear infinite;
}

.cv3-liquid-rotating-glow--core {
  inset: 6%;
  opacity: 0.85;
  background: radial-gradient(circle at 48% 28%, #fff 0%, #4dedff 28%, transparent 62%);
  filter: blur(3px);
  mask-image: radial-gradient(circle at 50% 70%, transparent 30%, #000 62%);
  animation: cv3-liquid-spin-cw 18.182s linear infinite;
}

.cv3-liquid-main-highlight {
  inset: 5px;
  border-radius: 50%;
  background: radial-gradient(
    circle at 33% 12%,
    rgb(254 245 254 / var(--liquid-highlights)) 0%,
    var(--liquid-highlight) 26%,
    transparent 63%
  );
  filter: blur(3px);
  transform-origin: 50% center;
  animation: cv3-liquid-main 9.091s linear infinite;
}

.cv3-liquid-deep {
  inset: 5px;
  border-radius: 50%;
  background: radial-gradient(
    circle at 31% 12%,
    transparent 0%,
    transparent 31%,
    var(--liquid-deep) 77%
  );
  filter: blur(1.5px);
  opacity: 0.65;
}

.cv3-liquid-blob {
  top: 24px;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  filter: blur(4.5px);
  mix-blend-mode: screen;
  animation: cv3-liquid-blob 2.614s ease-in-out infinite alternate;
}

.cv3-liquid-blob--left {
  left: 24px;
  background: linear-gradient(-36deg, transparent 12%, var(--liquid-blob) 36%, transparent 54%);
  opacity: 0.95;
}

.cv3-liquid-blob--right {
  left: 12px;
  background: linear-gradient(163deg, transparent 0%, var(--liquid-accent) 19%, transparent 50%);
  opacity: 0.95;
}

.cv3-liquid-wavy {
  width: 70%;
  height: 70%;
  border-radius: 46% 54% 58% 42% / 42% 48% 52% 58%;
  filter: blur(5.5px);
  mix-blend-mode: screen;
}

.cv3-liquid-wavy--a {
  top: 42%;
  left: 18%;
  background: radial-gradient(circle at 40% 35%, #b3f7ff 0%, transparent 68%);
  opacity: 0.55;
  animation: cv3-liquid-wavy-a 2.614s ease-in-out infinite alternate;
}

.cv3-liquid-wavy--b {
  top: -8%;
  left: 22%;
  background: radial-gradient(circle at 55% 40%, #8cffe3 0%, transparent 70%);
  opacity: 0.4;
  animation: cv3-liquid-wavy-b 3.529s ease-in-out infinite alternate;
}

.cv3-liquid-band {
  top: 30%;
  left: 10%;
  width: 80%;
  height: 40%;
  border-radius: 50%;
  background: var(--liquid-band);
  filter: blur(6px);
  opacity: 0.6;
  animation: cv3-liquid-band 2.045s ease-out infinite alternate;
}

.cv3-liquid-noise {
  top: 0;
  left: 0;
  width: 50%;
  height: 50%;
  background: rgba(0, 99, 204, 0.25);
  animation: cv3-liquid-noise 22.727s linear infinite alternate;
}

.cv3-liquid-wash {
  inset: 4px;
  border-radius: 50%;
  background: linear-gradient(rgb(255 255 255 / var(--liquid-highlights)), transparent);
  opacity: 0.16;
}

.cv3-liquid-shine {
  border-radius: 10px;
  filter: blur(6px);
}

.cv3-liquid-shine--top {
  top: 11px;
  left: 32px;
  width: 42px;
  height: 24px;
  background: linear-gradient(rgb(255 255 255 / var(--liquid-highlights)), transparent);
  transform: rotate(27deg);
}

.cv3-liquid-shine--bottom {
  top: 48px;
  left: 4px;
  width: 50px;
  height: 24px;
  background: linear-gradient(var(--liquid-bottom-shine), transparent);
  transform: rotate(-142deg);
}

.cv3-liquid-shine--side {
  top: 24px;
  left: 54px;
  width: 24px;
  height: 12px;
  background: linear-gradient(var(--liquid-side-shine), transparent);
  opacity: 0.8;
  transform: rotate(79deg);
}

.cv3-liquid-rim {
  inset: 0;
  border-radius: 50%;
  box-shadow:
    inset 0 -1px 6px 1px rgb(255 255 255 / var(--liquid-rim-highlights)),
    inset 0 3px 4px rgb(255 255 255 / var(--liquid-rim-highlights));
  opacity: 0.8;
}

.cv3-liquid-cap {
  top: 8px;
  left: 11px;
  width: 50px;
  height: 41px;
  border-radius: 22px;
  background: linear-gradient(rgb(255 255 255 / var(--liquid-highlights)), transparent);
  filter: blur(1.5px);
  opacity: 0.32;
  transform: rotate(-20deg);
}

.cv3-liquid-particle {
  z-index: 5;
  top: 24px;
  left: var(--particle-left);
  width: var(--particle-size);
  height: var(--particle-size);
  border-radius: 50%;
  background: #ebfdff;
  box-shadow:
    0 0 4px 1.25px rgba(0, 229, 255, 0.8),
    0 0 8px 2px rgba(255, 255, 255, 0.45);
  mix-blend-mode: plus-lighter;
  opacity: 0;
  animation: cv3-liquid-particle var(--particle-duration) linear var(--particle-delay) infinite;
}

.cv3-liquid-orbit {
  position: absolute;
  width: 90px;
  height: 90px;
  overflow: visible;
  pointer-events: none;
}

.cv3-liquid-orbit--outer {
  top: -12px;
  left: -12px;
}

.cv3-liquid-orbit--inner {
  top: 0;
  left: 0;
}

.cv3-liquid-orbit-path {
  opacity: 0;
  stroke-dasharray: 0 1 12 120;
  animation: cv3-liquid-orbit 5.795s linear 0s infinite;
}

.cv3-liquid-orbit-path--reverse {
  animation: cv3-liquid-orbit-reverse 6.818s linear 5.682s infinite;
}

.cv3-liquid-orbit-path--inner {
  animation-duration: 7.955s;
  animation-delay: 2.841s;
}

.cv3-liquid-orbit-path--inner-reverse {
  animation: cv3-liquid-orbit-reverse 6.136s linear 8.523s infinite;
}

.cv3-liquid-viewport[data-paused='true'] .cv3-liquid-animated {
  animation-play-state: paused !important;
}

.cv3-liquid-viewport[data-orb-state='waiting-user-actions'] .cv3-liquid-state-halo {
  inset: -11px;
  background: radial-gradient(
    circle,
    transparent 25%,
    rgba(0, 229, 255, 0.3) 32%,
    rgba(0, 229, 255, 0.58) 38%,
    rgba(60, 242, 246, 0.6) 46%,
    transparent 58%
  );
  filter: blur(9px);
  opacity: 0.7;
  animation: cv3-liquid-waiting-halo 8.5s ease-in-out infinite;
}

.cv3-liquid-viewport[data-orb-state='waiting-user-actions'] .cv3-liquid-surface {
  animation: cv3-liquid-waiting-hue 8.5s ease-in-out infinite;
}

.cv3-agent-orb.is-working::before {
  position: absolute;
  z-index: 1;
  inset: -1px;
  padding: 1.5px;
  border-radius: inherit;
  background: conic-gradient(
    from 0deg,
    transparent 0deg 195deg,
    rgba(0, 229, 255, 0.12) 235deg,
    rgba(0, 229, 255, 0.38) 285deg,
    #9fffff 315deg,
    rgba(0, 125, 255, 0.35) 340deg,
    transparent 360deg
  );
  content: '';
  filter: blur(0.8px);
  mask:
    linear-gradient(#fff 0 0) content-box exclude,
    linear-gradient(#fff 0 0);
  opacity: 0.62;
  pointer-events: none;
  animation: cv3-liquid-pill-orbit 900ms linear infinite;
}

.cv3-liquid-viewport[data-orb-state='working'] {
  --liquid-glow: 1;
  --liquid-highlights: 0.85;
}

@keyframes cv3-liquid-main {
  to {
    transform: rotate(360deg) scale(var(--liquid-main-scale));
  }
}

@keyframes cv3-liquid-blob {
  from {
    transform: scale(0.82) translate(-4%, 6%);
  }
  to {
    transform: scale(var(--liquid-blob-scale)) translate(6%, -8%);
  }
}

@keyframes cv3-liquid-wavy-a {
  from {
    border-radius: 46% 54% 58% 42% / 42% 48% 52% 58%;
    transform: translate(0) scale(0.92) rotate(-8deg);
  }
  to {
    border-radius: 58% 42% 44% 56% / 52% 40% 60% 48%;
    transform: translate(10%, -14%) scale(1.12) rotate(12deg);
  }
}

@keyframes cv3-liquid-wavy-b {
  from {
    border-radius: 42% 58% 50% 50% / 55% 45%;
    transform: translate(0) scale(1.05) rotate(10deg);
  }
  to {
    border-radius: 55% 45% 60% 40% / 45% 55% 42% 58%;
    transform: translate(-12%, 10%) scale(0.88) rotate(-14deg);
  }
}

@keyframes cv3-liquid-spin-cw {
  to {
    transform: rotate(360deg);
  }
}

@keyframes cv3-liquid-spin-ccw {
  to {
    transform: rotate(-360deg);
  }
}

@keyframes cv3-liquid-band {
  from {
    transform: scaleX(0.6);
  }
  to {
    transform: scaleX(1);
  }
}

@keyframes cv3-liquid-noise {
  to {
    transform: rotate(360deg);
  }
}

@keyframes cv3-liquid-particle {
  0% {
    opacity: 0;
    transform: translateY(84px) scale(1);
  }
  7% {
    opacity: 1;
    transform: translate(calc(var(--particle-drift) * 0.25), 70px) scale(1.3);
  }
  28% {
    opacity: 1;
    transform: translate(calc(var(--particle-drift) * 0.6), 30px) scale(1.15);
  }
  50%,
  100% {
    opacity: 0;
    transform: translate(var(--particle-drift), -26px) scale(1);
  }
}

@keyframes cv3-liquid-orbit {
  0% {
    opacity: 0;
    stroke-dashoffset: 200px;
  }
  50% {
    opacity: 0.67;
  }
  100% {
    opacity: 0;
    stroke-dashoffset: 0;
  }
}

@keyframes cv3-liquid-orbit-reverse {
  0% {
    opacity: 0;
    stroke-dashoffset: -200px;
  }
  50% {
    opacity: 0.67;
  }
  100% {
    opacity: 0;
    stroke-dashoffset: 0;
  }
}

@keyframes cv3-liquid-waiting-halo {
  0%,
  18%,
  36%,
  100% {
    opacity: 0.22;
  }
  9%,
  27% {
    opacity: 1;
  }
}

@keyframes cv3-liquid-waiting-hue {
  0%,
  18%,
  36%,
  100% {
    filter: hue-rotate(0deg);
  }
  9%,
  27% {
    filter: hue-rotate(10deg);
  }
}

@keyframes cv3-liquid-pill-orbit {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .cv3-agent-orb,
  .cv3-liquid-viewport * {
    animation: none !important;
    transition-duration: 0.01ms !important;
  }

  .cv3-liquid-state-halo,
  .cv3-liquid-particle,
  .cv3-liquid-orbit {
    display: none;
  }
}
</style>
