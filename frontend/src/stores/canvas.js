import { defineStore } from 'pinia';
import { useUserStore } from './user';
import { apiPath } from '../utils/apiBase';

const STORAGE_KEY = 'youmi_canvas_documents_v3';
const OFFLINE_QUEUE_KEY = 'youmi_canvas_offline_queue_v1';
const PERSIST_DEBOUNCE_MS = 500;  // 服务器同步防抖，500ms 足够（localStorage 立即写）
let authFailed = false;  // 认证失败后静默，避免重复请求刷屏
const demoImages = [
  new URL('../assets/youqian/images/060-1780040674695_a003c35a-7592-42ae-9a69-bcae7156c3bf.png', import.meta.url).href,
  new URL('../assets/youqian/images/061-1780040584339_6fd15155-2051-4c0c-bf83-5e32fd8201a8.png', import.meta.url).href,
  new URL('../assets/youqian/images/062-1780040599143_7bd9c869-2fa9-48f7-9947-9dbf481a9686.png', import.meta.url).href,
];

function nowTitle() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `未命名画布 ${month}-${day} ${hour}:${minute}`;
}

export function makeCanvasDocument(id = String(Date.now()).slice(-4)) {
  const title = nowTitle();
  const stamp = Date.now();
  return {
    id,
    title,
    updatedAt: stamp,
    createdAt: stamp,
    lastOpenedAt: stamp,
    thumbnailUrl: '',
    payload: {
      schemaVersion: 1,
      view: { scale: 0.68, offset: { x: 0, y: 0 } },
      layers: [],
      chat: [],
      ui: { detectionVisible: true },
    },
  };
}

function seed() {
  const configs = [
    {
      id: '1904',
      title: '未命名画布 05-23 14:16',
      image: demoImages[1],
      layers: 5,
      age: '7 小时前',
    },
    {
      id: '2905',
      title: 'chat_image(5/29_14:58)',
      image: demoImages[0],
      layers: 1,
      age: '1 天前',
    },
    {
      id: '2201',
      title: '未命名画布 05-22 14:01',
      image: demoImages[2],
      layers: 2,
      age: '1 天前',
    },
    {
      id: '2309',
      title: '未命名画布 05-23 14:09',
      image: demoImages[1],
      layers: 1,
      age: '7 天前',
      editing: true,
    },
  ];

  return configs.map((config, docIndex) => {
    const doc = makeCanvasDocument(config.id);
    doc.title = config.title;
    doc.thumbnailUrl = config.image;
    doc.meta = {
      layerCount: config.layers,
      age: config.age,
      editing: Boolean(config.editing),
    };
    doc.payload.view.scale = config.id === '1904' ? 0.2 : 0.68;
    doc.payload.layers = Array.from({ length: config.layers }, (_, index) => ({
      id: `seed-${config.id}-${index + 1}`,
      name: layerName(index),
      url: demoImages[(docIndex + index) % demoImages.length],
      thumbnailUrl: demoImages[(docIndex + index) % demoImages.length],
      naturalWidth: 1080,
      naturalHeight: 1620,
      width: index % 2 === 0 ? 720 : 560,
      height: index % 2 === 0 ? 980 : 740,
      x: 620 + index * 420,
      y: 520 + (index % 2) * 110,
      zIndex: index + 1,
      visible: true,
      locked: false,
    }));
    doc.payload.chat = config.id === '1904'
      ? [
          { id: 'seed-chat-1', role: 'assistant', text: '3333', createdAt: Date.now() - 1000 * 60 * 60 * 7 },
          { id: 'seed-chat-2', role: 'assistant', text: '已提交对话修改任务，请等待生成结果（生成完成后会显示在画布中）。', createdAt: Date.now() - 1000 * 60 * 30 },
          { id: 'seed-chat-3', role: 'assistant', text: '已添加 2 张参考图到画布。', createdAt: Date.now() - 1000 * 60 * 20 },
        ]
      : [];
    return doc;
  });
}

function mergeSeedDocuments(documents) {
  const seeds = seed();
  const existingIds = new Set(documents.map((doc) => doc.id));
  return [...documents, ...seeds.filter((doc) => !existingIds.has(doc.id))];
}

function loadLocal() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return Array.isArray(data) && data.length ? mergeSeedDocuments(data) : seed();
  } catch {
    return seed();
  }
}

function saveLocal(documents) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(documents));
  } catch (e) {
    // 配额超出：尝试清理历史 generationHistory
    try {
      const slim = documents.map((doc) => {
        if (!doc?.payload) return doc;
        const layers = (doc.payload.layers || []).slice(-100);
        const history = (doc.payload.generationHistory || []).slice(0, 20);
        return { ...doc, payload: { ...doc.payload, layers, generationHistory: history } };
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
      console.warn('localStorage 配额不足，已自动裁剪 history');
    } catch (e2) {
      console.error('localStorage 写入失败：', e2);
    }
  }
}

function loadOfflineQueue() {
  try {
    const data = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveOfflineQueue(queue) {
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.warn('offline queue write failed:', e);
  }
}

function pushOfflineQueue(doc) {
  if (!doc) return;
  const queue = loadOfflineQueue();
  const filtered = queue.filter((item) => item.id !== doc.id);
  filtered.unshift({ id: doc.id, doc, enqueuedAt: Date.now() });
  saveOfflineQueue(filtered.slice(0, 30));
}

function getAuthHeaders() {
  try {
    const user = useUserStore();
    return user.authHeaders();
  } catch {
    return {};
  }
}

async function syncToServer(doc, { skipQueue = false } = {}) {
  if (authFailed) return;
  const headers = getAuthHeaders();
  if (!headers.Authorization) return;
  // 检查 localStorage 里是否已有离线队列（说明之前保存失败过），如果有就直接跳过避免刷屏
  if (!skipQueue && loadOfflineQueue().length > 0) return;
  try {
    const res = await fetch(apiPath('/api/canvas/save'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        docId: doc.id,
        title: doc.title,
        payload: doc.payload,
        thumbnailUrl: doc.thumbnailUrl || '',
        isReversePrompt: doc.id === 'reverse-prompt',
      }),
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) { authFailed = true; saveOfflineQueue([]); return; }
      try {
        const body = await res.json().catch(() => ({}));
        if (body.message === '未登录' || body.message === '登录已过期') { authFailed = true; saveOfflineQueue([]); return; }
      } catch {}
      if (!skipQueue) {
        pushOfflineQueue(doc);
      }
    }
  } catch (e) {
    console.warn('Sync canvas to server failed:', e);
    if (!skipQueue) pushOfflineQueue(doc);
  }
}

async function flushOfflineQueue() {
  if (authFailed) return;
  const queue = loadOfflineQueue();
  if (!queue.length) return;
  const headers = getAuthHeaders();
  if (!headers.Authorization) return;
  const remaining = [];
  for (const item of queue) {
    try {
      const res = await fetch(apiPath('/api/canvas/save'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          docId: item.doc.id,
          title: item.doc.title,
          payload: item.doc.payload,
          thumbnailUrl: item.doc.thumbnailUrl || '',
          isReversePrompt: item.doc.id === 'reverse-prompt',
        }),
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) { authFailed = true; saveOfflineQueue([]); continue; }
        try {
          const body = await res.json().catch(() => ({}));
          if (body.message === '未登录' || body.message === '登录已过期') { authFailed = true; saveOfflineQueue([]); continue; }
        } catch (_e) {
          // 静默：响应非 JSON 时忽略
          void _e
        }
        remaining.push(item);
      }
    } catch {
      remaining.push(item);
    }
  }
  saveOfflineQueue(remaining);
}

async function syncDeleteFromServer(docId) {
  const headers = getAuthHeaders();
  if (!headers.Authorization) return;
  try {
    await fetch(apiPath(`/api/canvas/${docId}`), {
      method: 'DELETE',
      headers: { ...headers },
    });
  } catch (e) {
    console.warn('Delete canvas from server failed:', e);
  }
}

async function loadFromServer() {
  const headers = getAuthHeaders();
  if (!headers.Authorization) return [];
  try {
    const response = await fetch(apiPath('/api/canvas/list'), { headers: { ...headers } });
    const payload = await response.json().catch(() => ({}));
    if (payload.code !== 0 || !Array.isArray(payload.data)) return [];
    // 并行请求每个文档的完整 payload（list 只返回 summary，不含 payload）
    const docs = await Promise.all(
      payload.data.map(async (item) => {
        let fullPayload = item.payload || null;
        if (!fullPayload) {
          try {
            const detailRes = await fetch(apiPath(`/api/canvas/${item.docId}`), { headers: { ...headers } });
            const detail = await detailRes.json().catch(() => ({}));
            fullPayload = detail.data?.payload || null;
          } catch {
            // 单个文档拉取失败不影响其他
          }
        }
        return {
          id: item.docId,
          title: item.title,
          updatedAt: item.updatedAt,
          createdAt: item.createdAt || item.updatedAt,
          lastOpenedAt: item.updatedAt,
          thumbnailUrl: item.thumbnailUrl || '',
          payload: fullPayload || { schemaVersion: 1, view: { scale: 0.68, offset: { x: 0, y: 0 } }, layers: [], chat: [] },
          meta: {},
        };
      })
    );
    return docs;
  } catch (e) {
    console.warn('Load canvas from server failed:', e);
    return [];
  }
}

export function layerName(index) {
  const names = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  return `图层${names[index] || index + 1}`;
}

export const useCanvasStore = defineStore('canvas', {
  state: () => ({
    documents: loadLocal(),
    serverSynced: false,
  }),
  actions: {
    persist() {
      // localStorage 立即同步写（防止意外关页面丢图）
      saveLocal(this.documents);
      // 服务器同步防抖，避免拖动 / 批量操作时打爆后端
      if (this._serverSyncTimer) {
        clearTimeout(this._serverSyncTimer);
      }
      this._serverSyncTimer = setTimeout(() => {
        this._serverSyncTimer = null;
        // 同步所有需要同步的画布（不仅第一个）
        for (const doc of this.documents) {
          if (doc && doc.payload) syncToServer(doc);
        }
        // 顺便尝试清空离线队列
        flushOfflineQueue();
      }, PERSIST_DEBOUNCE_MS);
    },

    async syncFromServer() {
      const serverDocs = await loadFromServer();
      if (!serverDocs.length) {
        this.serverSynced = true;
        return;
      }
      const merged = [...this.documents];
      let needFlush = false;
      for (const serverDoc of serverDocs) {
        const existingIndex = merged.findIndex((d) => d.id === serverDoc.id);
        if (existingIndex >= 0) {
          const localDoc = merged[existingIndex];
          const localLayerCount = (localDoc.payload?.layers || []).length;
          const serverLayerCount = (serverDoc.payload?.layers || []).length;

          // 保护：本地有图层但服务器是空的 → 保留本地，并触发一次同步
          if (localLayerCount > 0 && serverLayerCount === 0) {
            needFlush = true;
            continue;  // 不覆盖
          }

          // updatedAt 比较策略：谁更新就听谁的
          const localUpdatedAt = localDoc.updatedAt || 0;
          const serverUpdatedAt = serverDoc.updatedAt || 0;

          // 本地比服务器更新 → 保留本地，触发同步让服务器跟上
          if (localUpdatedAt > serverUpdatedAt && localLayerCount > 0) {
            needFlush = true;
            continue;
          }

          // 服务器有数据 → 覆盖本地；仅保留 detection 缓存
          const mergedDoc = { ...serverDoc };
          if (serverDoc.payload?.layers && localDoc.payload?.layers) {
            mergedDoc.payload = { ...serverDoc.payload };
            mergedDoc.payload.layers = serverDoc.payload.layers.map((sl, i) => {
              const ll = localDoc.payload.layers[i];
              if (sl && ll && ll.detection?.status === 'done' && !sl.detection) {
                return { ...sl, detection: ll.detection };
              }
              return sl;
            });
          }
          merged[existingIndex] = mergedDoc;
        } else {
          merged.push(serverDoc);
        }
      }
      this.documents = merged;
      saveLocal(this.documents);
      this.serverSynced = true;
      // 本地有数据但服务器缺失的 → 立即同步到服务器
      if (needFlush) {
        this.flushNow();
      }
    },

    createDocument() {
      const doc = makeCanvasDocument();
      this.documents.unshift(doc);
      this.persist();
      return doc;
    },
    ensureDocument(id) {
      let doc = this.documents.find((item) => item.id === id);
      if (!doc) {
        doc = makeCanvasDocument(id);
        this.documents.unshift(doc);
        this.persist();
      }
      return doc;
    },
    updateDocument(id, patcher) {
      this.documents = this.documents.map((doc) => {
        if (doc.id !== id) return doc;
        const next = patcher(JSON.parse(JSON.stringify(doc)));
        next.updatedAt = Date.now();
        next.thumbnailUrl = next.payload.layers[0]?.url || '';
        // 保留 generationHistory 的 imageUrl，不再清理
        return next;
      });
      this.persist();
    },
    removeDocument(id) {
      this.documents = this.documents.filter((doc) => doc.id !== id);
      saveLocal(this.documents);
      // 同步删除服务器记录（await 确保删除完成，避免刷新时又被拉回来）
      syncDeleteFromServer(id);
      // 从离线队列中也移除
      const queue = loadOfflineQueue().filter((item) => item.id !== id);
      saveOfflineQueue(queue);
    },

    /**
     * 删除画布（等待服务器删除完成后再返回，防止刷新后被拉回）
     */
    async removeDocumentAsync(id) {
      this.documents = this.documents.filter((doc) => doc.id !== id);
      saveLocal(this.documents);
      await syncDeleteFromServer(id);
      const queue = loadOfflineQueue().filter((item) => item.id !== id);
      saveOfflineQueue(queue);
    },
    markOpened(id) {
      this.documents = this.documents.map((doc) => (doc.id === id ? { ...doc, lastOpenedAt: Date.now() } : doc));
      this.persist();
    },

    // 立即刷写：场景：用户上传/AI 生图完成 → 立即同步服务器，不等防抖
    flushNow() {
      if (this._serverSyncTimer) {
        clearTimeout(this._serverSyncTimer);
        this._serverSyncTimer = null;
      }
      saveLocal(this.documents);
      for (const doc of this.documents) {
        if (doc && doc.payload) syncToServer(doc, { skipQueue: true });
      }
    },

    /**
     * 给指定画布指定图层跑视觉检测，识别到的框写到 layer.detection 并立即落库。
     * 幂等：同一 url 跨画布复用，已有 detection 且 status=done 则跳过。
     * @returns {Promise<{boxes: Array, status: string, errorMessage?: string}>}
     */
    async runDetection(docId, layerId, { force = false } = {}) {
      const doc = this.documents.find((d) => d.id === docId);
      if (!doc) return { boxes: [], status: 'failed', errorMessage: '画布不存在' };
      const layer = doc.payload.layers.find((l) => l.id === layerId);
      if (!layer || !layer.url) return { boxes: [], status: 'failed', errorMessage: '图层无 url' };

      // 已识别过：done 直接返回缓存；failed 在 force=false 时也不再重试
      if (!force && layer.detection) {
        if (layer.detection.status === 'done') {
          return { boxes: layer.detection.boxes || [], status: 'done' };
        }
        if (layer.detection.status === 'failed' && !force) {
          return { boxes: [], status: 'failed', errorMessage: layer.detection.errorMessage };
        }
      }

      // 跨画布去重：同 url 在别的画布已经识别过，直接复用
      if (!force) {
        for (const other of this.documents) {
          if (other.id === docId) continue;
          const ol = other.payload.layers.find((l) => l && l.url === layer.url && l.detection?.status === 'done');
          if (ol) {
            const reused = {
              status: 'done',
              boxes: ol.detection.boxes,
              cacheKey: layer.url,
              updatedAt: Date.now(),
            };
            this.updateDocument(docId, (d) => {
              const target = d.payload.layers.find((l) => l.id === layerId);
              if (target) target.detection = reused;
              return d;
            });
            this.flushNow();
            return { boxes: reused.boxes, status: 'done' };
          }
        }
      }

      // 标记 pending
      this.updateDocument(docId, (d) => {
        const target = d.payload.layers.find((l) => l.id === layerId);
        if (target) {
          target.detection = { status: 'pending', cacheKey: layer.url, boxes: [], updatedAt: Date.now() };
        }
        return d;
      });

      try {
        const headers = getAuthHeaders();
        const res = await fetch(apiPath('/api/image/detect-elements'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ imageUrl: layer.url, layerId }),
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = await res.json().catch(() => ({}));
        const imageInfo =
          json.data?.result?.imageInfo ||
          json.data?.imageInfo ||
          json.data?.element?.data?.images?.[0]?.data ||
          json.data ||
          [];
        const boxes = Array.isArray(imageInfo)
          ? imageInfo.map((el, idx) => {
              // 兼容字段名: box_2d / box.2d / bbox / box2d；值可能是字符串
              let bx = el.box_2d || el['box.2d'] || el.bbox_2d || el.box2d || el.bbox;
              if (typeof bx === 'string') {
                try { bx = JSON.parse(bx); } catch { bx = null; }
              }
              if (!Array.isArray(bx) || bx.length !== 4) bx = [0, 0, 100, 100];
              // Qwen 输出 [top, left, bottom, right] → swap 为 [left, top, right, bottom]
              // 即 [bx[1], bx[0], bx[3], bx[2]]
              bx = [bx[1], bx[0], bx[3], bx[2]];
              // 自适应归一化: 0-1 浮点 → ×1000 转 0-1000 整数
              const mx = Math.max(...bx.map((v) => Math.abs(v)));
              if (mx > 0 && mx <= 1.5) bx = bx.map((v) => v * 1000);
              bx = bx.map((v) => Math.max(0, Math.min(1000, Math.round(v))));
              return {
                name: el.object_name || el.name || `元素${idx + 1}`,
                box2d: bx,
              };
            })
          : [];
        // 落库：done
        this.updateDocument(docId, (d) => {
          const target = d.payload.layers.find((l) => l.id === layerId);
          if (target) {
            target.detection = {
              status: 'done',
              cacheKey: layer.url,
              boxes,
              updatedAt: Date.now(),
            };
          }
          return d;
        });
        this.flushNow();
        return { boxes, status: 'done' };
      } catch (err) {
        const msg = err?.message || String(err);
        this.updateDocument(docId, (d) => {
          const target = d.payload.layers.find((l) => l.id === layerId);
          if (target) {
            target.detection = {
              status: 'failed',
              cacheKey: layer.url,
              boxes: [],
              updatedAt: Date.now(),
              errorMessage: msg,
            };
          }
          return d;
        });
        this.flushNow();
        return { boxes: [], status: 'failed', errorMessage: msg };
      }
    },

    /** 切换视觉框开关（画布级，写到 doc.payload.ui.detectionVisible） */
    setDetectionVisible(docId, visible) {
      this.updateDocument(docId, (d) => {
        if (!d.payload.ui) d.payload.ui = { detectionVisible: true };
        d.payload.ui.detectionVisible = Boolean(visible);
        return d;
      });
    },
  },
});
