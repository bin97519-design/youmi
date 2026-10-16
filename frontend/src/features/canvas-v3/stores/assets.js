import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

export const useCanvasV3AssetStore = defineStore('canvas-v3-assets', () => {
  const assets = ref([])
  const filter = ref('all')
  const visibleAssets = computed(() =>
    filter.value === 'all'
      ? assets.value
      : assets.value.filter((asset) => asset.kind === filter.value),
  )

  function replace(nextAssets) {
    assets.value = Array.isArray(nextAssets) ? nextAssets : []
  }

  function upsert(asset) {
    if (!asset?.id) return
    const index = assets.value.findIndex((item) => item.id === asset.id)
    if (index >= 0) assets.value[index] = { ...assets.value[index], ...asset }
    else assets.value.unshift(asset)
  }

  return { assets, filter, visibleAssets, replace, upsert }
})
