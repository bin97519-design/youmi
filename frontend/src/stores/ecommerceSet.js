import { defineStore } from 'pinia'
import { apiPath } from '../utils/apiBase'

const API_PREFIX = '/api/v1/ecommerce-sets'

/**
 * 电商套图 Store
 * 管理电商套图的策划、配置、生成进度和结果全流程
 */
export const useEcommerceSetStore = defineStore('ecommerceSet', {
  state: () => ({
    // 当前步骤: 'config' | 'generating' | 'result'
    // 策划/优化作为 config 步骤内的可选动作，不再作为独立步骤
    currentStep: 'config',

    // 策划相关
    setId: null,
    productImageUrl: '',
    productDescription: '',
    planningData: null,
    planningLoading: false,

    // 配置相关
    config: {
      platform: '天猫',
      mainImage: {
        type: '品牌首图',
        count: 3,
        ratio: '1:1',
        sellingPoints: [],
      },
      detailPage: {
        mode: 'whole',
        ratio: '9:16',
        count: 1,
        style: '简约',
        notes: '',
      },
      // 画面文字语言（前端展示项，后端未使用该字段时仅作为备注随配置提交）
      language: '中文(简体)',
      model: 'agnes-image-2.1-flash',
    },

    // 进度相关
    progress: {
      status: '',
      completed: 0,
      total: 0,
      items: [],
    },
    pollingTimer: null,

    // 结果相关
    results: {
      mainImages: [],
      detailPages: [],
    },
  }),

  actions: {
    /**
     * 创建AI策划
     * POST /api/v1/ecommerce-sets/
     */
    async createPlanning() {
      this.planningLoading = true
      try {
        const res = await fetch(apiPath(API_PREFIX + '/'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productImageUrl: this.productImageUrl,
            productDescription: this.productDescription,
          }),
        })
        const json = await res.json()
        if (json.code !== 0) {
          throw new Error(json.message || '策划创建失败')
        }
        this.setId = json.data.id
        this.planningData = json.data.planning || json.data
        return json.data
      } catch (err) {
        console.error('[ecommerceSet] createPlanning error:', err)
        throw err
      } finally {
        this.planningLoading = false
      }
    },

    /**
     * 更新策划内容
     * PUT /api/v1/ecommerce-sets/:id/planning
     */
    async updatePlanning(planningJson) {
      if (!this.setId) return
      try {
        const res = await fetch(apiPath(`${API_PREFIX}/${this.setId}/planning`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planning: planningJson }),
        })
        const json = await res.json()
        if (json.code !== 0) {
          throw new Error(json.message || '策划更新失败')
        }
        this.planningData = json.data.planning || json.data
        return json.data
      } catch (err) {
        console.error('[ecommerceSet] updatePlanning error:', err)
        throw err
      }
    },

    /**
     * 确认策划，进入配置步骤
     * POST /api/v1/ecommerce-sets/:id/confirm-planning
     */
    async confirmPlanning() {
      if (!this.setId) return
      try {
        const res = await fetch(apiPath(`${API_PREFIX}/${this.setId}/confirm-planning`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
        const json = await res.json()
        if (json.code !== 0) {
          throw new Error(json.message || '策划确认失败')
        }
        this.currentStep = 'config'
        return json.data
      } catch (err) {
        console.error('[ecommerceSet] confirmPlanning error:', err)
        throw err
      }
    },

    /**
     * 开始生图
     * POST /api/v1/ecommerce-sets/:id/generate
     */
    async startGeneration() {
      if (!this.setId) return
      try {
        const res = await fetch(apiPath(`${API_PREFIX}/${this.setId}/generate`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config: this.config }),
        })
        const json = await res.json()
        if (json.code !== 0) {
          throw new Error(json.message || '生图启动失败')
        }
        this.currentStep = 'generating'
        this.progress = {
          status: 'GENERATING',
          completed: 0,
          total: json.data.total || 0,
          items: json.data.items || [],
        }
        this.startPolling()
        return json.data
      } catch (err) {
        console.error('[ecommerceSet] startGeneration error:', err)
        throw err
      }
    },

    /**
     * 轮询进度
     * GET /api/v1/ecommerce-sets/:id/progress
     */
    async pollProgress() {
      if (!this.setId) return
      try {
        const res = await fetch(apiPath(`${API_PREFIX}/${this.setId}/progress`), {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        })
        const json = await res.json()
        if (json.code !== 0) {
          throw new Error(json.message || '进度查询失败')
        }
        this.progress = {
          status: json.data.status || this.progress.status,
          completed: json.data.completed ?? this.progress.completed,
          total: json.data.total ?? this.progress.total,
          items: json.data.items || this.progress.items,
        }
        if (this.progress.status === 'COMPLETED') {
          this.stopPolling()
          this.currentStep = 'result'
          await this.fetchResult()
        } else if (this.progress.status === 'FAILED') {
          this.stopPolling()
        }
        return json.data
      } catch (err) {
        console.error('[ecommerceSet] pollProgress error:', err)
        throw err
      }
    },

    /**
     * 开始轮询（3秒间隔）
     */
    startPolling() {
      this.stopPolling()
      this.pollingTimer = setInterval(() => {
        this.pollProgress()
      }, 3000)
    },

    /**
     * 停止轮询
     */
    stopPolling() {
      if (this.pollingTimer) {
        clearInterval(this.pollingTimer)
        this.pollingTimer = null
      }
    },

    /**
     * 获取生成结果
     * GET /api/v1/ecommerce-sets/:id/result
     */
    async fetchResult() {
      if (!this.setId) return
      try {
        const res = await fetch(apiPath(`${API_PREFIX}/${this.setId}/result`), {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        })
        const json = await res.json()
        if (json.code !== 0) {
          throw new Error(json.message || '结果获取失败')
        }
        this.results = {
          mainImages: json.data.mainImages || [],
          detailPages: json.data.detailPages || [],
        }
        return json.data
      } catch (err) {
        console.error('[ecommerceSet] fetchResult error:', err)
        throw err
      }
    },

    /**
     * 导入图片到画布
     * 通过事件通知画布添加图层
     */
    async importToCanvas(imageUrl) {
      try {
        window.dispatchEvent(
          new CustomEvent('ecommerce-set:import-to-canvas', {
            detail: { imageUrl },
          }),
        )
      } catch (err) {
        console.error('[ecommerceSet] importToCanvas error:', err)
        throw err
      }
    },

    /**
     * 下载图片
     */
    async downloadImage(imageUrl) {
      try {
        const link = document.createElement('a')
        link.href = imageUrl
        link.target = '_blank'
        link.download = `ecommerce-${Date.now()}.png`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      } catch (err) {
        console.error('[ecommerceSet] downloadImage error:', err)
        throw err
      }
    },

    /**
     * 重置所有状态
     */
    reset() {
      this.stopPolling()
      this.currentStep = 'config'
      this.setId = null
      this.productImageUrl = ''
      this.productDescription = ''
      this.planningData = null
      this.planningLoading = false
      this.config = {
        platform: '天猫',
        mainImage: {
          type: '品牌首图',
          count: 3,
          ratio: '1:1',
          sellingPoints: [],
        },
        detailPage: {
          mode: 'whole',
          ratio: '9:16',
          count: 1,
          style: '简约',
          notes: '',
        },
        language: '中文(简体)',
        model: 'agnes-image-2.1-flash',
      }
      this.progress = {
        status: '',
        completed: 0,
        total: 0,
        items: [],
      }
      this.results = {
        mainImages: [],
        detailPages: [],
      }
    },
  },
})
