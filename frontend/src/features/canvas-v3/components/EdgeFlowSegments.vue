<script setup>
defineProps({
  path: { type: String, required: true },
  edgeId: { type: String, default: '' },
})
</script>

<template>
  <g
    class="cv3-edge-flow"
    :data-edge-flow="edgeId || undefined"
    fill="none"
    stroke="rgb(100, 180, 255)"
    aria-hidden="true"
  >
    <path
      :d="path"
      pathLength="300"
      stroke-dasharray="36 64"
      stroke-width="12"
      stroke-opacity="0.06"
      stroke-linecap="round"
    />
    <path
      :d="path"
      pathLength="300"
      stroke-dasharray="36 64"
      stroke-width="7"
      stroke-opacity="0.12"
      stroke-linecap="round"
    />
    <path
      :d="path"
      pathLength="300"
      stroke-dasharray="36 64"
      stroke-width="4"
      stroke-opacity="0.15"
      stroke-linecap="butt"
    />
    <path
      :d="path"
      pathLength="300"
      stroke-dasharray="0 6 30 64"
      stroke-width="4"
      stroke-opacity="0.17647058823529413"
      stroke-linecap="butt"
    />
    <path
      :d="path"
      pathLength="300"
      stroke-dasharray="0 12 24 64"
      stroke-width="4"
      stroke-opacity="0.2142857142857143"
      stroke-linecap="butt"
    />
    <path
      :d="path"
      pathLength="300"
      stroke-dasharray="0 18 18 64"
      stroke-width="4"
      stroke-opacity="0.2727272727272727"
      stroke-linecap="butt"
    />
    <path
      :d="path"
      pathLength="300"
      stroke-dasharray="0 24 12 64"
      stroke-width="4"
      stroke-opacity="0.375"
      stroke-linecap="butt"
    />
    <path
      :d="path"
      pathLength="300"
      stroke-dasharray="0 30 6 64"
      stroke-width="4"
      stroke-opacity="0.6"
      stroke-linecap="butt"
    />
  </g>
</template>
