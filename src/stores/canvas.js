import { defineStore } from 'pinia';

const STORAGE_KEY = 'youmi_canvas_documents_v3';
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

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return Array.isArray(data) && data.length ? mergeSeedDocuments(data) : seed();
  } catch {
    return seed();
  }
}

function save(documents) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(documents));
}

export function layerName(index) {
  const names = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  return `图层${names[index] || index + 1}`;
}

export const useCanvasStore = defineStore('canvas', {
  state: () => ({
    documents: load(),
  }),
  actions: {
    persist() {
      save(this.documents);
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
        return next;
      });
      this.persist();
    },
    removeDocument(id) {
      this.documents = this.documents.filter((doc) => doc.id !== id);
      this.persist();
    },
    markOpened(id) {
      this.documents = this.documents.map((doc) => (doc.id === id ? { ...doc, lastOpenedAt: Date.now() } : doc));
      this.persist();
    },
  },
});
