import { onBeforeUnmount, ref, toRaw, watch } from 'vue'
import { useCanvasStore } from '../../../stores/canvas'
import { useUserStore } from '../../../stores/user'
import { CANVAS_V3_SCHEMA_VERSION } from '../config/nodeSpecs'

function clone(value) {
  return JSON.parse(JSON.stringify(toRaw(value)))
}

function toGraphDocument(doc) {
  const meta = doc?.payload?.chatConfig?.canvasV3 || null
  const layers = Array.isArray(doc?.payload?.layers) ? doc.payload.layers : []
  const connections = Array.isArray(doc?.payload?.connections) ? doc.payload.connections : []
  const nodes = layers
    .filter((layer) => layer?.v3Data || String(layer?.type || '').startsWith('v3-'))
    .map((layer) => ({
      id: layer.id,
      type: layer.v3Data?.nodeType || 'generator',
      position: { x: Number(layer.x) || 0, y: Number(layer.y) || 0 },
      data: {
        ...clone(layer.v3Data || {}),
        schemaVersion: CANVAS_V3_SCHEMA_VERSION,
        kind: layer.v3Data?.kind || String(layer.type || '').replace(/^v3-/, '') || 'reference',
        title: layer.v3Data?.title || layer.name || '未命名节点',
        prompt: layer.v3Data?.prompt || '',
        model: layer.v3Data?.model || '',
        summary: layer.v3Data?.summary || '',
        runState: layer.v3Data?.runState || 'idle',
        artifactStatus: layer.v3Data?.artifactStatus || 'empty',
        createdAt: layer.v3Data?.createdAt || doc.createdAt || Date.now(),
      },
    }))
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = connections
    .filter(
      (edge) =>
        nodeIds.has(edge.fromLayerId || edge.source) && nodeIds.has(edge.toLayerId || edge.target),
    )
    .map((edge) => ({
      id: edge.id,
      source: edge.fromLayerId || edge.source,
      target: edge.toLayerId || edge.target,
      sourceHandle: edge.fromPort || edge.sourceHandle || 'output',
      targetHandle: edge.toPort || edge.targetHandle || 'input',
      type: 'default',
      data: clone(edge.v3Data || edge.data || { semantic: 'dependency' }),
    }))

  return {
    projectId: doc.id,
    title: meta?.initialized ? doc.title : '未命名工作区',
    nodes,
    edges,
    viewport: meta?.initialized
      ? {
          x: Number(doc.payload?.view?.offset?.x) || 0,
          y: Number(doc.payload?.view?.offset?.y) || 0,
          zoom: Number(doc.payload?.view?.scale) || 1,
        }
      : { x: 0, y: 0, zoom: 1 },
    revision: Number(meta?.revision) || 0,
    initialized: Boolean(meta?.initialized),
  }
}

function stripTransientData(data) {
  const copy = clone(data || {})
  if (typeof copy.error !== 'string') delete copy.error
  return copy
}

function writeGraphDocument(draft, graph) {
  draft.title = graph.title || '未命名画布'
  draft.payload ||= {}
  draft.payload.layers = graph.nodes.map((node, index) => ({
    id: node.id,
    name: node.data?.title || '未命名节点',
    x: Math.round(Number(node.position?.x) || 0),
    y: Math.round(Number(node.position?.y) || 0),
    width: Math.round(Number(node.dimensions?.width) || 332),
    height: Math.round(Number(node.dimensions?.height) || 360),
    zIndex: index + 1,
    visible: !node.hidden,
    locked: false,
    type: `v3-${node.data?.kind || 'reference'}`,
    status: node.data?.runState || 'idle',
    progress: 0,
    v3Data: {
      ...stripTransientData(node.data),
      schemaVersion: CANVAS_V3_SCHEMA_VERSION,
      nodeType: node.type || 'generator',
    },
  }))
  draft.payload.connections = graph.edges.map((edge) => ({
    id: edge.id,
    fromLayerId: edge.source,
    fromPort: edge.sourceHandle || 'output',
    toLayerId: edge.target,
    toPort: edge.targetHandle || 'input',
    type: 'default',
    v3Data: clone(edge.data || { semantic: 'dependency' }),
  }))
  draft.payload.view = {
    scale: graph.viewport.zoom,
    offset: { x: Math.round(graph.viewport.x), y: Math.round(graph.viewport.y) },
  }
  draft.payload.chat ||= []
  draft.payload.ui ||= {}
  draft.payload.chatConfig = {
    ...(draft.payload.chatConfig || {}),
    canvasV3: {
      schemaVersion: CANVAS_V3_SCHEMA_VERSION,
      initialized: true,
      revision: graph.revision,
    },
  }
  return draft
}

export function useCanvasV3Persistence(projectId, graph) {
  const canvas = useCanvasStore()
  const user = useUserStore()
  const saveStatus = ref(user.isAuthenticated ? 'saved' : 'local')
  const lastSavedAt = ref(null)
  let timer = null
  let disposed = false

  const doc = canvas.ensureDocument(projectId)
  const payload = toGraphDocument(doc)
  graph.hydrate(payload)
  if (!payload.initialized) graph.seedStarterGraph()
  canvas.markOpened(projectId)
  try {
    localStorage.setItem('youmi_canvas_v3_last_document', projectId)
  } catch {
    // Storage can be disabled in private contexts.
  }

  function flushLocal() {
    if (disposed) return
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    saveStatus.value = 'saving'
    canvas.updateDocument(projectId, (draft) => writeGraphDocument(draft, graph))
    lastSavedAt.value = Date.now()
    saveStatus.value = user.isAuthenticated ? 'saved' : 'local'
  }

  function scheduleSave() {
    if (!graph.hydrated) return
    saveStatus.value = 'saving'
    if (timer) clearTimeout(timer)
    timer = setTimeout(flushLocal, 650)
  }

  async function saveNow() {
    flushLocal()
    const ok = await canvas.flushNow(projectId)
    saveStatus.value = ok ? 'saved' : user.isAuthenticated ? 'offline' : 'local'
    return ok
  }

  watch(
    () => ({
      title: graph.title,
      nodes: graph.nodes,
      edges: graph.edges,
      viewport: graph.viewport,
      revision: graph.revision,
    }),
    scheduleSave,
    { deep: true },
  )

  onBeforeUnmount(() => {
    if (timer) {
      clearTimeout(timer)
      timer = null
      canvas.updateDocument(projectId, (draft) => writeGraphDocument(draft, graph))
    }
    disposed = true
  })

  return { saveStatus, lastSavedAt, saveNow }
}
