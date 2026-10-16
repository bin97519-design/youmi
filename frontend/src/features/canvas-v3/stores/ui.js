import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useCanvasV3UiStore = defineStore('canvas-v3-ui', () => {
  const mode = ref('workflow')
  const activePanel = ref('')
  const inspectorOpen = ref(false)
  const minimapVisible = ref(false)
  const snapToGrid = ref(true)
  const tool = ref('select')

  function togglePanel(panel) {
    activePanel.value = activePanel.value === panel ? '' : panel
  }

  return {
    mode,
    activePanel,
    inspectorOpen,
    minimapVisible,
    snapToGrid,
    tool,
    togglePanel,
  }
})
