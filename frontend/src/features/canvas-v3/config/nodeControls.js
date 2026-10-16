import { IMAGE_MODEL_CATALOG } from './modelCatalog'

export const NODE_CONTROLS = {
  image: {
    models: IMAGE_MODEL_CATALOG.map((model) => model.value),
    defaults: {
      ratio: '16:9',
      quality: '标准画质',
      resolution: '2K',
      background: '自动',
      count: '1张',
    },
    fields: {
      quality: ['画质', ['低画质', '标准画质', '高画质', '超高画质', '极致画质']],
      resolution: ['清晰度', ['1K', '2K', '4K']],
      background: ['背景', ['自动', '保留背景', '透明背景']],
      ratio: [
        '比例',
        [
          '1:1',
          '1:2',
          '2:1',
          '9:16',
          '16:9',
          '3:4',
          '4:3',
          '3:2',
          '2:3',
          '5:4',
          '4:5',
          '21:9',
          '9:21',
        ],
      ],
      count: ['生成数量', ['1张', '2张', '4张']],
    },
    switches: ['智能引用 AutoLink'],
  },
  video: {
    models: ['2.0', 'Seedance 1.5 Pro', 'Kling 3.0', 'HappyHorse 1.0'],
    modes: ['文生视频', '全能参考', '图生视频', '首尾帧', '图片参考'],
    defaults: { ratio: '16:9', resolution: '720P', duration: 5, count: '1个', audio: true },
    fields: {
      ratio: ['比例', ['Auto', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9']],
      resolution: ['清晰度', ['480P', '720P', '1080P', '4K']],
      duration: ['视频时长', 'number'],
      count: ['生成数量', ['1个', '2个', '4个']],
    },
    switches: ['生成音频', '联网搜索', '自动校验素材', '智能引用 AutoLink'],
  },
  audio: {
    models: ['Seed Audio 1.0'],
    defaults: { language: '中文', sampleRate: '24k', format: 'wav', speed: 1, pitch: 0, volume: 1 },
    fields: {
      language: ['语言', ['中文', '英语', '日语']],
      sampleRate: ['采样率', ['24k', '44.1k', '48k']],
      format: ['格式', ['wav', 'mp3']],
      speed: ['语速', 'number'],
      pitch: ['声调', 'number'],
      volume: ['音量', 'number'],
    },
    switches: [],
  },
  script: { models: ['GVLM 3.1'], defaults: {}, fields: {}, switches: [] },
  smartEdit: {
    models: [],
    modes: ['默认模式', '讲解视频', '批量广告', '口播视频', '素材混剪'],
    defaults: { ratio: '16:9', resolution: '720P', duration: 30 },
    fields: {
      ratio: ['比例', ['21:9', '16:9', '9:16', '1:1', '4:3', '3:4']],
      resolution: ['清晰度', ['480P', '720P', '1080P']],
      duration: ['视频时长', 'number'],
    },
    switches: [],
  },
}

export function parameterSummary(kind, params = {}) {
  if (kind === 'audio')
    return [params.language, params.sampleRate, params.format].filter(Boolean).join(' · ')
  return [
    params.ratio,
    params.quality,
    params.resolution,
    params.duration ? `${params.duration}s` : '',
    params.count,
  ]
    .filter(Boolean)
    .join(' · ')
}

export function nodeSize(kind) {
  return {
    width: ['image', 'video'].includes(kind) ? 624 : 350,
    height: ['text', 'reference'].includes(kind) ? 200 : 350,
  }
}
