import { computed, ref, toRaw } from 'vue'
import { defineStore } from 'pinia'
import { CANVAS_V3_SCHEMA_VERSION, nodeSpec } from '../config/nodeSpecs'
import { NODE_CONTROLS, nodeSize } from '../config/nodeControls'

const HISTORY_LIMIT = 60
const PROTECTED_IMAGE_TASK_STATES = new Set([
  'preparing',
  'submitting',
  'queued',
  'running',
  'paused',
  'uncertain',
])

function clone(value) {
  return JSON.parse(JSON.stringify(toRaw(value)))
}

function uid(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
}

function graphSnapshot(nodes, edges) {
  return clone({ nodes, edges })
}

function isProtectedImageTaskNode(node) {
  if (node?.data?.kind !== 'image') return false
  const generation = node.data.generation
  return (
    PROTECTED_IMAGE_TASK_STATES.has(node.data.runState) ||
    Boolean(generation?.persistPending) ||
    Boolean(generation?.queryPending) ||
    Boolean(generation?.unresolvedTaskIds?.length)
  )
}

function makeNode(kind, index, position) {
  const spec = nodeSpec(kind)
  return {
    id: uid('node'),
    type: 'generator',
    selected: false,
    position: position || {
      x: 180 + (index % 3) * 390,
      y: 140 + Math.floor(index / 3) * 420,
    },
    data: {
      schemaVersion: CANVAS_V3_SCHEMA_VERSION,
      kind: spec.kind,
      title: spec.title,
      prompt: '',
      model: spec.model,
      mode: NODE_CONTROLS[kind]?.modes?.[0] || '',
      params: clone(NODE_CONTROLS[kind]?.defaults || {}),
      switches: {},
      summary: spec.summary,
      runState: 'idle',
      artifactStatus: 'empty',
      createdAt: Date.now(),
    },
  }
}

function findOpenPosition(nodes, desired, kind) {
  const size = nodeSize(kind)
  const offsets = [
    [0, 0],
    [800, 0],
    [-800, 0],
    [0, 500],
    [0, -500],
    [800, 500],
    [-800, 500],
    [800, -500],
    [-800, -500],
  ]
  const collides = (position) =>
    nodes.some(
      (node) =>
        position.x < node.position.x + nodeSize(node.data.kind, node.data).width + 40 &&
        position.x + size.width + 40 > node.position.x &&
        position.y < node.position.y + nodeSize(node.data.kind, node.data).height + 40 &&
        position.y + size.height + 40 > node.position.y,
    )
  return (
    offsets
      .map(([x, y]) => ({ x: desired.x + x, y: desired.y + y }))
      .find((position) => !collides(position)) || {
      x: desired.x + nodes.length * 34,
      y: desired.y + nodes.length * 34,
    }
  )
}

export const useCanvasV3GraphStore = defineStore('canvas-v3-graph', () => {
  const projectId = ref('')
  const title = ref('未命名画布')
  const nodes = ref([])
  const edges = ref([])
  const viewport = ref({ x: 0, y: 0, zoom: 0.82 })
  const revision = ref(0)
  const hydrated = ref(false)
  const undoStack = ref([])
  const redoStack = ref([])

  const selectedNodes = computed(() => nodes.value.filter((node) => node.selected))
  const selectedEdges = computed(() => edges.value.filter((edge) => edge.selected))
  const activeNode = computed(() =>
    selectedNodes.value.length === 1 ? selectedNodes.value[0] : null,
  )
  const nodeCounts = computed(() =>
    nodes.value.reduce((result, node) => {
      const kind = node.data?.kind || 'reference'
      result[kind] = (result[kind] || 0) + 1
      return result
    }, {}),
  )
  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)

  function protectedImageTaskNodes(candidates = nodes.value) {
    return candidates.filter(isProtectedImageTaskNode)
  }

  function markProtectedActionBlocked(candidates, action) {
    if (!candidates.length) return
    for (const node of candidates)
      node.data = {
        ...node.data,
        statusText: `图片任务仍在生成、持久化或等待确认，暂不能${action}。`,
        updatedAt: Date.now(),
      }
  }

  function hydrate(payload) {
    projectId.value = payload.projectId
    title.value = payload.title || '未命名画布'
    nodes.value = clone(payload.nodes || [])
    edges.value = clone(payload.edges || [])
    viewport.value = clone(payload.viewport || { x: 0, y: 0, zoom: 0.82 })
    revision.value = Number(payload.revision) || 0
    undoStack.value = []
    redoStack.value = []
    hydrated.value = true
  }

  function seedStarterGraph() {
    nodes.value = []
    edges.value = []
    revision.value += 1
  }

  function remember() {
    const snapshot = graphSnapshot(nodes.value, edges.value)
    const last = undoStack.value.at(-1)
    if (last && JSON.stringify(last) === JSON.stringify(snapshot)) return
    undoStack.value.push(snapshot)
    if (undoStack.value.length > HISTORY_LIMIT) undoStack.value.shift()
    redoStack.value = []
  }

  function markChanged() {
    revision.value += 1
  }

  function addNode(kind, position) {
    remember()
    const preferred = position || {
      x: 180 + (nodes.value.length % 2) * 390,
      y: 140 + Math.floor(nodes.value.length / 2) * 420,
    }
    const node = makeNode(kind, nodes.value.length, findOpenPosition(nodes.value, preferred, kind))
    nodes.value.forEach((item) => {
      item.selected = false
    })
    node.selected = true
    if (['image', 'video', 'audio'].includes(kind)) {
      const label = { image: '图片节点', video: '视频节点', audio: '音频节点' }[kind]
      node.data.title = `${label} ${nodes.value.filter((item) => item.data.kind === kind).length + 1}`
    }
    nodes.value.push(node)
    markChanged()
    return node
  }

  function updateNodeData(nodeId, patch) {
    const node = nodes.value.find((item) => item.id === nodeId)
    if (!node) return
    node.data = { ...node.data, ...patch, updatedAt: Date.now() }
    markChanged()
  }

  function connect(connection) {
    if (!connection.source || !connection.target || connection.source === connection.target) return
    const duplicate = edges.value.some(
      (edge) =>
        edge.source === connection.source &&
        edge.target === connection.target &&
        edge.sourceHandle === connection.sourceHandle &&
        edge.targetHandle === connection.targetHandle,
    )
    if (duplicate) return
    remember()
    edges.value.push({
      id: uid('edge'),
      ...connection,
      type: 'default',
      data: { semantic: 'dependency' },
    })
    markChanged()
  }

  function removeEdge(edgeId) {
    if (!edges.value.some((edge) => edge.id === edgeId)) return
    remember()
    edges.value = edges.value.filter((edge) => edge.id !== edgeId)
    markChanged()
  }

  function createConnectedNode(kind, position, connectionStart) {
    const anchor = nodes.value.find((node) => node.id === connectionStart?.nodeId)
    if (!anchor || !NODE_CONTROLS[kind]) return null
    remember()
    const node = makeNode(kind, nodes.value.length, findOpenPosition(nodes.value, position, kind))
    nodes.value.forEach((item) => {
      item.selected = false
    })
    node.selected = true
    if (['image', 'video', 'audio'].includes(kind)) {
      const label = { image: '图片节点', video: '视频节点', audio: '音频节点' }[kind]
      node.data.title = `${label} ${nodes.value.filter((item) => item.data.kind === kind).length + 1}`
    }
    nodes.value.push(node)
    const reversed = connectionStart.handleType === 'target'
    edges.value.push({
      id: uid('edge'),
      source: reversed ? node.id : anchor.id,
      target: reversed ? anchor.id : node.id,
      sourceHandle: reversed ? 'output' : connectionStart.handleId || 'output',
      targetHandle: reversed ? connectionStart.handleId || 'input' : 'input',
      type: 'default',
      data: { semantic: 'dependency' },
    })
    markChanged()
    return node
  }

  function applyQuickStart(nodeId, template) {
    const target = nodes.value.find((item) => item.id === nodeId)
    if (!target) return
    remember()
    if (target.data.kind === 'script') {
      const source = makeNode('text', nodes.value.length, {
        x: target.position.x - 470,
        y: target.position.y + 75,
      })
      source.data.prompt =
        '《清晨的第一束光》\n\n场景一：晨光穿过窗帘，洒在桌上的咖啡杯。\n场景二：主角推开窗户，城市慢慢苏醒。\n场景三：拿起相机，记录今天的第一个瞬间。'
      source.data.title = '示例剧本'
      nodes.value.push(source)
      edges.value.push({
        id: uid('edge'),
        source: source.id,
        target: nodeId,
        sourceHandle: 'output',
        targetHandle: 'input',
        type: 'default',
        data: { semantic: 'dependency' },
      })
      target.data.prompt = '根据引用的剧本生成分镜脚本，包含景别、运镜、画面描述与对白。'
    } else if (target.data.kind === 'video' && template.includes('帧')) {
      target.data.mode = template.includes('尾') ? '首尾帧' : '图生视频'
    } else if (target.data.kind === 'smartEdit') {
      target.data.mode = template
    } else {
      target.data.prompt ||= `${template}：描述你的创作想法，添加参考素材后继续。`
    }
    markChanged()
  }
  function createImageVariation(sourceId, preset) {
    const source = nodes.value.find((node) => node.id === sourceId)
    if (!source?.data.assetUrl) return null
    remember()
    const next = makeNode(
      'image',
      nodes.value.length,
      findOpenPosition(nodes.value, { x: source.position.x + 800, y: source.position.y }, 'image'),
    )
    next.data = {
      ...next.data,
      title: preset.title,
      prompt: preset.prompt,
      model: source.data.model,
      sourceImageNodeId: sourceId,
      params: { ...source.data.params, ...preset.params },
      ...(preset.editTemplate
        ? { editTemplate: { ...preset.editTemplate, sourceNodeId: sourceId } }
        : {}),
      ...(preset.stylePreset || source.data.stylePreset
        ? { stylePreset: clone(preset.stylePreset || source.data.stylePreset) }
        : {}),
    }
    nodes.value.forEach((node) => {
      node.selected = false
    })
    next.selected = true
    nodes.value.push(next)
    edges.value.push({
      id: uid('edge'),
      source: sourceId,
      target: next.id,
      sourceHandle: 'output',
      targetHandle: 'input',
      type: 'default',
      data: { semantic: 'dependency' },
    })
    if (preset.inheritReferences) {
      const inherited = new Set([sourceId])
      for (const edge of [...edges.value]) {
        if (edge.target !== sourceId || inherited.has(edge.source)) continue
        inherited.add(edge.source)
        edges.value.push({ ...clone(edge), id: uid('edge'), target: next.id })
      }
    }
    markChanged()
    return next
  }

  function createImageOutputs(sourceId, outputs, operation = '图片裁剪') {
    const source = nodes.value.find((node) => node.id === sourceId)
    if (!source?.data.assetUrl) return []
    // Validate the complete batch before changing the graph; never leave partial crops.
    if (
      !Array.isArray(outputs) ||
      !outputs.length ||
      outputs.length > 100 ||
      outputs.some(
        (output) =>
          typeof output?.url !== 'string' ||
          !output.url ||
          !Number.isInteger(output.width) ||
          output.width < 1 ||
          !Number.isInteger(output.height) ||
          output.height < 1,
      )
    )
      throw new Error('图片输出无效，原画布保持不变')
    remember()
    nodes.value.forEach((node) => {
      node.selected = false
    })
    const results = outputs.map((output, index) => {
      const next = makeNode(
        'image',
        nodes.value.length,
        findOpenPosition(
          nodes.value,
          {
            x: source.position.x + 800 + (index % 3) * 800,
            y: source.position.y + Math.floor(index / 3) * 500,
          },
          'image',
        ),
      )
      next.selected = index === 0
      next.data = {
        ...next.data,
        title: output.title || `${operation} ${index + 1}`,
        model: source.data.model,
        assetUrl: output.url,
        mediaWidth: output.width,
        mediaHeight: output.height,
        pixelSize: { width: output.width, height: output.height },
        artifactStatus: 'ready',
        runState: 'succeeded',
        progress: 100,
        localEdit: { operation, sourceNodeId: sourceId, region: output.region || null },
      }
      nodes.value.push(next)
      edges.value.push({
        id: uid('edge'),
        source: sourceId,
        target: next.id,
        sourceHandle: 'output',
        targetHandle: 'input',
        type: 'default',
        data: { semantic: 'dependency' },
      })
      return next
    })
    markChanged()
    return results
  }

  function createDemoWorkflow() {
    remember()
    const x0 = nodes.value.length
      ? Math.max(...nodes.value.map((n) => n.position.x + nodeSize(n.data.kind, n.data).width)) +
        200
      : 80
    const plan = [
      ['text', 0, 80, '创意简报', '为一款咖啡品牌制作清晨主题短片，画面简洁温暖，突出光线与香气。'],
      ['script', 470, 0, '脚本生成器', '将创意简报拆成 3 个镜头，给出画面、运镜和旁白。'],
      ['image', 950, 0, '图片节点 1', '清晨窗边的一杯咖啡，暖色阳光，柔和阴影，电影质感。'],
      ['video', 1750, 0, '视频节点 1', '镜头缓慢推进，咖啡热气在阳光中升起。'],
      ['audio', 1750, 520, '音频节点 1', '舒缓的钢琴和清晨鸟鸣，温暖自然，时长 8 秒。'],
      ['smartEdit', 2550, 0, '智能剪辑', '按镜头顺序编排视频，加入音乐和柔和转场。'],
    ]
    const batch = plan.map(([kind, x, y, title, prompt]) => {
      const node = makeNode(kind, nodes.value.length, { x: x0 + x, y: 80 + y })
      node.data = { ...node.data, title, prompt }
      return node
    })
    nodes.value.forEach((node) => {
      node.selected = false
    })
    nodes.value.push(...batch)
    for (const [source, target] of [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 5],
      [4, 5],
    ])
      edges.value.push({
        id: uid('edge'),
        source: batch[source].id,
        target: batch[target].id,
        sourceHandle: 'output',
        targetHandle: 'input',
        type: 'default',
        data: { semantic: 'dependency' },
      })
    markChanged()
  }

  function removeSelected() {
    const blockedNodes = protectedImageTaskNodes(selectedNodes.value)
    const blockedNodeIds = new Set(blockedNodes.map((node) => node.id))
    const nodeIds = new Set(
      selectedNodes.value.filter((node) => !blockedNodeIds.has(node.id)).map((node) => node.id),
    )
    const edgeIds = new Set(selectedEdges.value.map((edge) => edge.id))
    if (!nodeIds.size && !edgeIds.size) {
      markProtectedActionBlocked(blockedNodes, '删除')
      if (blockedNodes.length) markChanged()
      return false
    }
    remember()
    nodes.value = nodes.value.filter((node) => !nodeIds.has(node.id))
    edges.value = edges.value.filter(
      (edge) => !edgeIds.has(edge.id) && !nodeIds.has(edge.source) && !nodeIds.has(edge.target),
    )
    markProtectedActionBlocked(blockedNodes, '删除')
    markChanged()
    return true
  }

  function duplicateSelected() {
    if (!selectedNodes.value.length) return
    const blockedNodes = protectedImageTaskNodes(selectedNodes.value)
    const blockedNodeIds = new Set(blockedNodes.map((node) => node.id))
    const duplicableNodes = selectedNodes.value.filter((node) => !blockedNodeIds.has(node.id))
    if (!duplicableNodes.length) {
      markProtectedActionBlocked(blockedNodes, '复制')
      markChanged()
      return false
    }
    remember()
    const idMap = new Map()
    const copies = duplicableNodes.map((node) => {
      const nextId = uid('node')
      idMap.set(node.id, nextId)
      return {
        ...clone(node),
        id: nextId,
        selected: true,
        position: { x: node.position.x + 44, y: node.position.y + 44 },
        data: { ...clone(node.data), title: `${node.data.title} 副本`, createdAt: Date.now() },
      }
    })
    markProtectedActionBlocked(blockedNodes, '复制')
    nodes.value.forEach((node) => {
      node.selected = false
    })
    const copiedEdges = edges.value
      .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
      .map((edge) => ({
        ...clone(edge),
        id: uid('edge'),
        source: idMap.get(edge.source),
        target: idMap.get(edge.target),
      }))
    nodes.value.push(...copies)
    edges.value.push(...copiedEdges)
    markChanged()
    return true
  }

  function autoLayout() {
    if (!nodes.value.length) return
    remember()
    nodes.value.forEach((node, index) => {
      node.position = {
        x: 120 + (index % 3) * 800,
        y: 120 + Math.floor(index / 3) * 500,
      }
    })
    markChanged()
  }

  function clearGraph() {
    if (!nodes.value.length && !edges.value.length) return
    const blockedNodes = protectedImageTaskNodes()
    if (blockedNodes.length) {
      markProtectedActionBlocked(blockedNodes, '清空画布')
      markChanged()
      return false
    }
    remember()
    nodes.value = []
    edges.value = []
    markChanged()
    return true
  }

  function undo() {
    const blockedNodes = protectedImageTaskNodes()
    if (blockedNodes.length) {
      markProtectedActionBlocked(blockedNodes, '撤销')
      markChanged()
      return false
    }
    const snapshot = undoStack.value.pop()
    if (!snapshot) return
    redoStack.value.push(graphSnapshot(nodes.value, edges.value))
    nodes.value = clone(snapshot.nodes)
    edges.value = clone(snapshot.edges)
    markChanged()
    return true
  }

  function redo() {
    const blockedNodes = protectedImageTaskNodes()
    if (blockedNodes.length) {
      markProtectedActionBlocked(blockedNodes, '重做')
      markChanged()
      return false
    }
    const snapshot = redoStack.value.pop()
    if (!snapshot) return
    undoStack.value.push(graphSnapshot(nodes.value, edges.value))
    nodes.value = clone(snapshot.nodes)
    edges.value = clone(snapshot.edges)
    markChanged()
    return true
  }

  function setViewport(nextViewport) {
    if (!nextViewport) return
    viewport.value = {
      x: Number(nextViewport.x) || 0,
      y: Number(nextViewport.y) || 0,
      zoom: Number(nextViewport.zoom) || 1,
    }
  }

  return {
    projectId,
    title,
    nodes,
    edges,
    viewport,
    revision,
    hydrated,
    selectedNodes,
    selectedEdges,
    activeNode,
    nodeCounts,
    canUndo,
    canRedo,
    hydrate,
    seedStarterGraph,
    remember,
    markChanged,
    addNode,
    updateNodeData,
    connect,
    removeEdge,
    createConnectedNode,
    applyQuickStart,
    createImageVariation,
    createImageOutputs,
    createDemoWorkflow,
    removeSelected,
    duplicateSelected,
    autoLayout,
    clearGraph,
    undo,
    redo,
    setViewport,
  }
})
