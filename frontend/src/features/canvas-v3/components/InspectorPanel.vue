<script setup>
import { computed } from 'vue'
import { useCanvasV3GraphStore } from '../stores/graph'
import { nodeSpec } from '../config/nodeSpecs'

const graph = useCanvasV3GraphStore()
const activeNode = computed(() => graph.activeNode)
const spec = computed(() => (activeNode.value ? nodeSpec(activeNode.value.data.kind) : null))

function updateData(field, value) {
  if (!activeNode.value) return
  graph.updateNodeData(activeNode.value.id, { [field]: value })
}
</script>

<template>
  <aside class="cv3-inspector">
    <template v-if="activeNode">
      <div class="cv3-panel-heading">
        <div>
          <span class="cv3-eyebrow">INSPECTOR</span>
          <h2>节点设置</h2>
        </div>
        <span class="cv3-inspector-icon" :style="{ '--node-color': spec.color }">
          <i :class="spec.icon" />
        </span>
      </div>

      <label class="cv3-form-field">
        <span>节点名称</span>
        <input
          class="nodrag"
          :value="activeNode.data.title"
          @input="updateData('title', $event.target.value)"
        />
      </label>

      <label class="cv3-form-field">
        <span>模型</span>
        <button type="button" disabled>
          {{ activeNode.data.model || spec.model }}
          <i class="ri-arrow-down-s-line" />
        </button>
      </label>

      <div class="cv3-inspector-section">
        <span>运行状态</span>
        <div class="cv3-state-row">
          <i class="ri-checkbox-blank-circle-fill" />
          {{ activeNode.data.runState === 'idle' ? '未运行' : activeNode.data.runState }}
        </div>
      </div>

      <div class="cv3-inspector-section">
        <span>节点标识</span>
        <code>{{ activeNode.id }}</code>
      </div>
    </template>

    <template v-else>
      <div class="cv3-panel-heading">
        <div>
          <span class="cv3-eyebrow">PROJECT</span>
          <h2>画布概览</h2>
        </div>
      </div>
      <div class="cv3-overview-card">
        <i class="ri-node-tree" />
        <strong>{{ graph.nodes.length }}</strong>
        <span>节点</span>
      </div>
      <div class="cv3-overview-card">
        <i class="ri-git-merge-line" />
        <strong>{{ graph.edges.length }}</strong>
        <span>连线</span>
      </div>
      <p class="cv3-inspector-tip">选择一个节点后，可在这里查看和编辑详细参数。</p>
    </template>
  </aside>
</template>
