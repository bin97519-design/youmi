import { computed, ref, toRaw } from 'vue'
import { defineStore } from 'pinia'
import { CANVAS_V3_SCHEMA_VERSION, NODE_SPECS, nodeSpec } from '../config/nodeSpecs'
import { NODE_CONTROLS, nodeSize } from '../config/nodeControls'
import { videoModelControls } from '../config/videoModelParameters.js'
import { canvasSelectionLayout } from '../../../utils/canvasSelection.js'
import {
  DEFAULT_GROUP_COLOR,
  isGroupColor,
  normalizedGroupColor,
  isGroupPadding,
  normalizedGroupPadding,
} from '../config/groupAppearance.js'
import {
  createNodeClipboard,
  parseNodeClipboard,
  serializeNodeClipboard,
} from '../config/nodeClipboard.js'

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
  if (!['image', 'video'].includes(node?.data?.kind)) return false
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
  const controls =
    kind === 'video'
      ? { ...NODE_CONTROLS.video, ...videoModelControls(spec.model) }
      : NODE_CONTROLS[kind]
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
      mode: controls?.modes?.[0] || '',
      params: clone(controls?.defaults || {}),
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
  const selectionMutable = computed(
    () => selectedNodes.value.length >= 2 && !protectedImageTaskNodes(selectedNodes.value).length,
  )
  const selectedGroup = computed(() => {
    const selected = selectedNodes.value
    const groupId = selected[0]?.data?.groupId
    if (selected.length < 2 || !groupId || selected.some((node) => node.data.groupId !== groupId))
      return null
    const members = nodes.value.filter((node) => node.data?.groupId === groupId)
    if (members.length !== selected.length) return null
    return {
      id: groupId,
      name: selected[0].data.groupName || '分组',
      type: selected[0].data.groupType || 'normal',
    }
  })
  const selectedGroupAppearance = computed(() =>
    selectedGroup.value
      ? {
          color: normalizedGroupColor(selectedNodes.value[0].data.groupColor),
          padding: normalizedGroupPadding(selectedNodes.value[0].data.groupPadding),
        }
      : null,
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
        statusText: `${node.data.kind === 'video' ? '视频' : '图片'}任务仍在生成、持久化或等待确认，暂不能${action}。`,
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
    const previous = { ...node.data }
    if (
      ['video', 'audio'].includes(previous.kind) &&
      patch &&
      Object.hasOwn(patch, 'assetUrl') &&
      patch.assetUrl !== previous.assetUrl
    ) {
      // Actual duration belongs to this media URL, never a previous candidate
      // or generation. A patch carrying freshly measured duration may replace it.
      delete previous.mediaDuration
      delete previous.durationSeconds
    }
    node.data = { ...previous, ...patch, updatedAt: Date.now() }
    markChanged()
  }

  function addImageAssets(assets, anchor) {
    if (!assets.length) return []
    remember()
    nodes.value.forEach((node) => {
      node.selected = false
    })
    edges.value.forEach((edge) => {
      edge.selected = false
    })
    const created = assets.map((asset, index) => {
      const size = nodeSize('image', asset)
      const desired = {
        x: anchor.x - size.width / 2 + (index % 3) * 680,
        y: anchor.y - size.height / 2 + Math.floor(index / 3) * 410,
      }
      const node = makeNode('image', nodes.value.length, desired)
      node.selected = true
      Object.assign(node.data, asset, { mediaOrigin: 'upload', artifactStatus: 'ready' })
      nodes.value.push(node)
      return node
    })
    markChanged()
    return created
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

  /** Fan out real dependency edges from the selected group's members as one history edit. */
  function createGroupConnectedNode(kind, position, groupId) {
    if (
      typeof kind !== 'string' ||
      !Object.hasOwn(NODE_SPECS, kind) ||
      typeof groupId !== 'string' ||
      !groupId ||
      ![position?.x, position?.y].every(
        (number) =>
          typeof number === 'number' && Number.isFinite(number) && Math.abs(number) <= 1e7,
      )
    )
      return false
    const group = selectedGroup.value
    const members = nodes.value.filter((node) => node.data.groupId === groupId)
    if (
      !group ||
      group.id !== groupId ||
      members.length < 2 ||
      members.length !== selectedNodes.value.length
    )
      return false
    const blocked = members.filter((node) => {
      const data = node.data
      return (
        PROTECTED_IMAGE_TASK_STATES.has(data.runState) ||
        Boolean(
          data.generation?.persistPending ||
          data.generation?.queryPending ||
          data.generation?.unresolvedTaskIds?.length,
        )
      )
    })
    if (blocked.length) {
      markProtectedActionBlocked(blocked, '创建下游引用')
      markChanged()
      return false
    }
    const references = members.filter((node) =>
      ['image', 'video', 'audio', 'text'].includes(node.data.kind),
    )
    if (!references.length) return false
    const node = makeNode(kind, nodes.value.length, findOpenPosition(nodes.value, position, kind))
    if (['image', 'video', 'audio'].includes(kind)) {
      const label = { image: '图片节点', video: '视频节点', audio: '音频节点' }[kind]
      node.data.title = `${label} ${nodes.value.filter((item) => item.data.kind === kind).length + 1}`
    }
    remember()
    for (const member of nodes.value) member.selected = false
    for (const edge of edges.value) edge.selected = false
    node.selected = true
    nodes.value.push(node)
    for (const reference of references)
      edges.value.push({
        id: uid('edge'),
        source: reference.id,
        target: node.id,
        sourceHandle: 'output',
        targetHandle: 'input',
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
    const allProtectedIds = new Set(protectedImageTaskNodes().map((node) => node.id))
    const nodeIds = new Set(
      selectedNodes.value
        .filter((node) => !blockedNodeIds.has(node.id))
        // Deleting a reference node also deletes its edges. Do not indirectly cut an
        // active task's dependencies merely because VueFlow selected an incident edge.
        .filter(
          (node) =>
            !edges.value.some(
              (edge) =>
                (edge.source === node.id && allProtectedIds.has(edge.target)) ||
                (edge.target === node.id && allProtectedIds.has(edge.source)),
            ),
        )
        .map((node) => node.id),
    )
    const edgeIds = new Set(
      selectedEdges.value
        .filter((edge) => !allProtectedIds.has(edge.source) && !allProtectedIds.has(edge.target))
        .map((edge) => edge.id),
    )
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
    const snapshot = createNodeClipboard(clone(duplicableNodes), clone(edges.value))
    pasteNodeClipboard(snapshot, null, { offset: 44, suffix: ' 副本' })
    markProtectedActionBlocked(blockedNodes, '复制')
    return true
  }

  function arrangeSelected(mode) {
    if (selectedNodes.value.length < 2) return false
    const blocked = protectedImageTaskNodes(selectedNodes.value)
    if (blocked.length) {
      markProtectedActionBlocked(blocked, '排列')
      markChanged()
      return false
    }
    const positions = canvasSelectionLayout(
      selectedNodes.value.map((node) => ({
        id: node.id,
        x: node.position.x,
        y: node.position.y,
        ...nodeSize(node.data.kind, node.data),
      })),
      mode,
    )
    const changed = selectedNodes.value.filter((node) => {
      const position = positions.get(node.id)
      return position && (node.position.x !== position.x || node.position.y !== position.y)
    })
    if (!changed.length) return false
    remember()
    for (const node of changed) node.position = { ...positions.get(node.id) }
    markChanged()
    return true
  }

  /** Logical groups retain world coordinates; no VueFlow parent/child transforms. */
  function applySelectionGroup(
    groupId,
    groupName,
    groupType,
    action,
    groupColor = DEFAULT_GROUP_COLOR,
    groupPadding = normalizedGroupPadding(),
  ) {
    if (selectedNodes.value.length < 2) return false
    const selectedIds = new Set(selectedNodes.value.map((node) => node.id))
    const affectedGroups = new Set(
      selectedNodes.value.map((node) => node.data.groupId).filter(Boolean),
    )
    const nextGroups = new Map(
      nodes.value.map((node) => [
        node.id,
        selectedIds.has(node.id) ? groupId : node.data.groupId || '',
      ]),
    )
    const counts = new Map()
    for (const id of nextGroups.values()) if (id) counts.set(id, (counts.get(id) || 0) + 1)
    const patches = []
    for (const node of nodes.value) {
      let nextId = nextGroups.get(node.id)
      if (affectedGroups.has(nextId) && counts.get(nextId) < 2) nextId = ''
      const nextName = nextId
        ? selectedIds.has(node.id)
          ? groupName
          : node.data.groupName || ''
        : ''
      const nextType = nextId
        ? selectedIds.has(node.id)
          ? groupType
          : node.data.groupType || ''
        : ''
      const nextColor = nextId
        ? selectedIds.has(node.id)
          ? groupColor
          : node.data.groupColor
        : undefined
      const nextPadding = nextId
        ? selectedIds.has(node.id)
          ? groupPadding
          : node.data.groupPadding
        : undefined
      if (
        (node.data.groupId || '') !== nextId ||
        (node.data.groupName || '') !== nextName ||
        (node.data.groupType || '') !== nextType ||
        (node.data.groupColor || '') !== (nextColor || '') ||
        JSON.stringify(node.data.groupPadding) !== JSON.stringify(nextPadding)
      )
        patches.push({
          node,
          groupId: nextId,
          groupName: nextName,
          groupType: nextType,
          groupColor: nextColor,
          groupPadding: nextPadding,
        })
    }
    // Include any old group singleton being cleaned up, not just the explicit selection.
    const blocked = protectedImageTaskNodes([
      ...new Set([...selectedNodes.value, ...patches.map((patch) => patch.node)]),
    ])
    if (blocked.length) {
      markProtectedActionBlocked(blocked, action)
      markChanged()
      return false
    }
    if (!patches.length) return false
    remember()
    for (const patch of patches) {
      if (patch.groupId) {
        patch.node.data.groupId = patch.groupId
        patch.node.data.groupName = patch.groupName
        patch.node.data.groupType = patch.groupType
        if (patch.groupColor) patch.node.data.groupColor = patch.groupColor
        if (patch.groupPadding) patch.node.data.groupPadding = { ...patch.groupPadding }
      } else {
        delete patch.node.data.groupId
        delete patch.node.data.groupName
        delete patch.node.data.groupType
        delete patch.node.data.groupColor
        delete patch.node.data.groupPadding
      }
    }
    markChanged()
    return true
  }

  function groupSelected(name, variant = 'normal') {
    if (name != null && (typeof name !== 'string' || name.trim().length > 100))
      throw new Error('分组名称最多100个字符')
    if (!['normal', 'storyboard'].includes(variant)) throw new Error('分组类型无效')
    const usedNames = new Set(nodes.value.map((node) => node.data.groupName).filter(Boolean))
    const prefix = variant === 'storyboard' ? '分镜组' : '分组'
    let index = 1
    while (usedNames.has(`${prefix} ${index}`)) index += 1
    return applySelectionGroup(uid('group'), name?.trim() || `${prefix} ${index}`, variant, '分组')
  }

  function ungroupSelected() {
    return applySelectionGroup('', '', '', '取消分组')
  }

  /** Edits require exactly one complete group; partial selections cannot split its identity. */
  function updateSelectedGroup(patch, action) {
    const group = selectedGroup.value
    if (!group) return false
    return updateGroupMembers(selectedNodes.value, patch, action)
  }

  function updateGroupMembers(members, patch, action) {
    if (members.length < 2) return false
    const blocked = protectedImageTaskNodes(members)
    if (blocked.length) {
      markProtectedActionBlocked(blocked, action)
      markChanged()
      return false
    }
    if (
      !members.some((node) =>
        Object.entries(patch).some(([key, value]) =>
          typeof value === 'object'
            ? JSON.stringify(node.data[key]) !== JSON.stringify(value)
            : node.data[key] !== value,
        ),
      )
    )
      return false
    remember()
    for (const node of members)
      for (const [key, value] of Object.entries(patch))
        node.data[key] = value && typeof value === 'object' ? clone(value) : value
    markChanged()
    return true
  }

  /** A blur commit targets the group where editing began, even if selection has changed. */
  function renameGroup(groupId, name) {
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name.trim().length > 100 ||
      [...name].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    )
      throw new Error('分组名称须为1至100个字符')
    if (typeof groupId !== 'string' || !groupId) return false
    const members = nodes.value.filter((node) => node.data.groupId === groupId)
    return updateGroupMembers(members, { groupName: name.trim() }, '重命名分组')
  }

  function renameSelectedGroup(name) {
    return renameGroup(selectedGroup.value?.id, name)
  }

  function setSelectedGroupColor(color) {
    if (!isGroupColor(color)) throw new Error('分组颜色无效')
    return updateSelectedGroup({ groupColor: normalizedGroupColor(color) }, '修改分组颜色')
  }

  function setSelectedGroupPadding(padding) {
    if (!isGroupPadding(padding)) throw new Error('分组边距无效')
    return updateSelectedGroup({ groupPadding: normalizedGroupPadding(padding) }, '调整分组边界')
  }

  function convertSelectedGroup(type = 'storyboard') {
    if (!['normal', 'storyboard'].includes(type)) throw new Error('分组类型无效')
    return updateSelectedGroup({ groupType: type }, '转换分组')
  }

  function selectGroup(nodeId) {
    const groupId = nodes.value.find((node) => node.id === nodeId)?.data?.groupId
    if (!groupId) return false
    const members = nodes.value.filter((node) => node.data.groupId === groupId)
    if (members.length < 2) return false
    for (const node of nodes.value) node.selected = node.data.groupId === groupId
    for (const edge of edges.value) edge.selected = false
    return true
  }

  function pasteNodeClipboard(snapshot, anchor, { offset = 44, suffix = '' } = {}) {
    // Revalidate even internal snapshots: clipboard JSON is untrusted input.
    const safe = parseNodeClipboard(serializeNodeClipboard(clone(snapshot)))
    if (!safe) throw new Error('节点剪贴板数据无效')
    const minX = Math.min(...safe.nodes.map((node) => node.position.x))
    const minY = Math.min(...safe.nodes.map((node) => node.position.y))
    const dx = Number.isFinite(anchor?.x) ? anchor.x - minX : offset
    const dy = Number.isFinite(anchor?.y) ? anchor.y - minY : offset
    const ids = new Map(safe.nodes.map((node) => [node.id, uid('node')]))
    const groups = new Map(
      safe.nodes
        .filter((node) => node.data.groupId)
        .map((node) => [node.data.groupId, uid('group')]),
    )
    const copies = safe.nodes.map((node) => {
      const data = { ...node.data, createdAt: Date.now() }
      if (data.groupId) data.groupId = groups.get(data.groupId)
      if (suffix) data.title = `${data.title || '节点'}${suffix}`
      if (data.sourceImageNodeId) data.sourceImageNodeId = ids.get(data.sourceImageNodeId)
      for (const key of ['editTemplate', 'localEdit'])
        if (data[key]?.sourceNodeId) data[key].sourceNodeId = ids.get(data[key].sourceNodeId)
      return {
        ...node,
        id: ids.get(node.id),
        selected: true,
        position: { x: node.position.x + dx, y: node.position.y + dy },
        data,
      }
    })
    const copiedEdges = safe.edges.map((edge) => ({
      ...edge,
      id: uid('edge'),
      source: ids.get(edge.source),
      target: ids.get(edge.target),
      selected: false,
    }))
    remember()
    nodes.value.forEach((node) => (node.selected = false))
    edges.value.forEach((edge) => (edge.selected = false))
    nodes.value.push(...copies)
    edges.value.push(...copiedEdges)
    markChanged()
    return copies
  }

  function rateNode(nodeId, rating) {
    const node = nodes.value.find((item) => item.id === nodeId)
    if (!node || !Number.isInteger(rating) || rating < 0 || rating > 5) return false
    if ((node.data.rating || 0) === rating) return true
    remember()
    node.data.rating = rating
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
    selectionMutable,
    selectedGroup,
    selectedGroupAppearance,
    nodeCounts,
    canUndo,
    canRedo,
    hydrate,
    seedStarterGraph,
    remember,
    markChanged,
    addNode,
    updateNodeData,
    addImageAssets,
    connect,
    removeEdge,
    createConnectedNode,
    createGroupConnectedNode,
    applyQuickStart,
    createImageVariation,
    createImageOutputs,
    createDemoWorkflow,
    removeSelected,
    duplicateSelected,
    arrangeSelected,
    groupSelected,
    ungroupSelected,
    renameSelectedGroup,
    renameGroup,
    setSelectedGroupColor,
    setSelectedGroupPadding,
    convertSelectedGroup,
    selectGroup,
    pasteNodeClipboard,
    rateNode,
    autoLayout,
    clearGraph,
    undo,
    redo,
    setViewport,
  }
})
