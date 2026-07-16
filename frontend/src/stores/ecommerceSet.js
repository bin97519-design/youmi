import { defineStore } from 'pinia'
import { apiPath } from '../utils/apiBase'
import { useUserStore } from './user'

const API_PREFIX = '/api/v1/ecommerce-sets'
const DRAFT_KEY = 'youmi:ecommerce-set:draft'
const DRAFT_VERSION = 1

function createDefaultConfig() {
  return {
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
}

function requestHeaders() {
  return { 'Content-Type': 'application/json', ...useUserStore().authHeaders() }
}

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
    generationLoading: false,
    errorMessage: '',
    billing: { consumedMi: 0, balance: null },
    recentImages: [],

    // 配置相关
    config: createDefaultConfig(),

    // 进度相关
    progress: {
      status: '',
      completed: 0,
      failed: 0,
      finished: 0,
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
    persistDraft() {
      try {
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({
            version: DRAFT_VERSION,
            currentStep: this.currentStep,
            setId: this.setId,
            productImageUrl: this.productImageUrl,
            productDescription: this.productDescription,
            planningData: this.planningData,
            config: this.config,
            billing: this.billing,
          }),
        )
      } catch (err) {
        console.warn('[ecommerceSet] persist draft failed:', err)
      }
    },

    restoreDraft() {
      try {
        const raw = localStorage.getItem(DRAFT_KEY)
        if (!raw) return false
        const draft = JSON.parse(raw)
        if (draft.version !== DRAFT_VERSION) return false
        const defaults = createDefaultConfig()
        this.currentStep = ['config', 'generating', 'result'].includes(draft.currentStep)
          ? draft.currentStep
          : 'config'
        this.setId = draft.setId || null
        this.productImageUrl = draft.productImageUrl || ''
        this.productDescription = draft.productDescription || ''
        this.planningData = draft.planningData || null
        this.config = {
          ...defaults,
          ...draft.config,
          mainImage: { ...defaults.mainImage, ...draft.config?.mainImage },
          detailPage: { ...defaults.detailPage, ...draft.config?.detailPage },
        }
        this.billing = { ...this.billing, ...draft.billing }
        return true
      } catch (err) {
        localStorage.removeItem(DRAFT_KEY)
        console.warn('[ecommerceSet] restore draft failed:', err)
        return false
      }
    },

    async resumeDraft() {
      if (!this.restoreDraft() || !this.setId || this.currentStep === 'config') return
      const savedStep = this.currentStep
      const progress = await this.pollProgress()
      if (progress && savedStep === 'generating' && this.currentStep === 'generating') {
        this.startPolling()
      }
    },

    /**
     * 创建AI策划
     * POST /api/v1/ecommerce-sets/
     */
    async createPlanning() {
      this.planningLoading = true
      this.errorMessage = ''
      try {
        const res = await fetch(apiPath(API_PREFIX + '/planning'), {
          method: 'POST',
          headers: requestHeaders(),
          body: JSON.stringify({
            productImageUrl: this.productImageUrl,
            productDescription: this.productDescription,
          }),
        })
        const json = await res.json()
        if (json.code !== 0) {
          throw new Error(json.message || '策划创建失败')
        }
        this.setId = json.data.setId
        this.planningData = json.data.planning || json.data
        return json.data
      } catch (err) {
        console.error('[ecommerceSet] createPlanning error:', err)
        this.errorMessage = err.message || '策划创建失败'
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
          headers: requestHeaders(),
          body: JSON.stringify({ planningData: planningJson }),
        })
        const json = await res.json()
        if (json.code !== 0) {
          throw new Error(json.message || '策划更新失败')
        }
        this.planningData = json.data.planning || json.data
        return json.data
      } catch (err) {
        console.error('[ecommerceSet] updatePlanning error:', err)
        this.errorMessage = err.message || '策划更新失败'
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
        const res = await fetch(apiPath(`${API_PREFIX}/${this.setId}/confirm`), {
          method: 'POST',
          headers: requestHeaders(),
        })
        const json = await res.json()
        if (json.code !== 0) {
          throw new Error(json.message || '策划确认失败')
        }
        this.currentStep = 'config'
        return json.data
      } catch (err) {
        console.error('[ecommerceSet] confirmPlanning error:', err)
        this.errorMessage = err.message || '策划确认失败'
        throw err
      }
    },

    /**
     * 开始生图
     * POST /api/v1/ecommerce-sets/:id/generate
     */
    async startGeneration() {
      if (!this.setId) return
      if (this.generationLoading) return
      this.generationLoading = true
      this.errorMessage = ''
      try {
        const res = await fetch(apiPath(`${API_PREFIX}/${this.setId}/generate`), {
          method: 'POST',
          headers: requestHeaders(),
          body: JSON.stringify({
            platform: this.config.platform,
            model: this.config.model,
            textLanguage: this.config.language,
            mainImage: this.config.mainImage,
            detailPage: this.config.detailPage,
          }),
        })
        const json = await res.json()
        if (json.code !== 0) {
          throw new Error(json.message || '生图启动失败')
        }
        this.currentStep = 'generating'
        this.progress = {
          status: 'GENERATING',
          completed: 0,
          failed: 0,
          finished: 0,
          total: json.data.totalTasks || 0,
          items: json.data.items || [],
        }
        this.billing = {
          consumedMi: json.data.consumedMi || 0,
          balance: json.data.balance ?? null,
        }
        this.startPolling()
        return json.data
      } catch (err) {
        console.error('[ecommerceSet] startGeneration error:', err)
        this.errorMessage = err.message || '生图启动失败'
        throw err
      } finally {
        this.generationLoading = false
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
          headers: requestHeaders(),
        })
        const json = await res.json()
        if (json.code !== 0) {
          throw new Error(json.message || '进度查询失败')
        }
        this.progress = {
          status: json.data.status || this.progress.status,
          completed: json.data.completed ?? this.progress.completed,
          failed: json.data.failed ?? this.progress.failed,
          finished: json.data.finished ?? this.progress.finished,
          total: json.data.total ?? this.progress.total,
          items: json.data.items || this.progress.items,
        }
        if (['COMPLETED', 'PARTIAL_FAILED'].includes(this.progress.status)) {
          this.stopPolling()
          this.currentStep = 'result'
          await this.fetchResult()
        } else if (this.progress.status === 'FAILED') {
          this.stopPolling()
          this.currentStep = 'result'
          await this.fetchResult()
        }
        return json.data
      } catch (err) {
        console.error('[ecommerceSet] pollProgress error:', err)
        this.errorMessage = err.message || '进度查询失败，正在自动重试'
        return null
      }
    },

    /**
     * 开始轮询（3秒间隔）
     */
    startPolling() {
      this.stopPolling()
      void this.pollProgress()
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
          headers: requestHeaders(),
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
        this.errorMessage = err.message || '结果获取失败'
        throw err
      }
    },

    async retryImage(imageId) {
      this.errorMessage = ''
      try {
        const res = await fetch(apiPath(`${API_PREFIX}/${this.setId}/images/${imageId}/retry`), {
          method: 'POST',
          headers: requestHeaders(),
        })
        const json = await res.json()
        if (json.code !== 0) throw new Error(json.message || '重试失败')
        this.billing = {
          consumedMi: this.billing.consumedMi + (json.data.consumedMi || 0),
          balance: json.data.balance ?? this.billing.balance,
        }
        this.currentStep = 'generating'
        this.progress.status = 'GENERATING'
        this.startPolling()
        return json.data
      } catch (err) {
        this.errorMessage = err.message || '重试失败'
        throw err
      }
    },

    async retryFailedImages(imageIds) {
      const ids = [...new Set((imageIds || []).filter(Boolean))]
      if (!ids.length || this.generationLoading) return
      this.generationLoading = true
      this.errorMessage = ''
      this.stopPolling()
      let submitted = 0
      let consumedMi = 0
      let balance = this.billing.balance
      const errors = []
      try {
        for (const imageId of ids) {
          try {
            const res = await fetch(
              apiPath(`${API_PREFIX}/${this.setId}/images/${imageId}/retry`),
              { method: 'POST', headers: requestHeaders() },
            )
            const json = await res.json()
            if (json.code !== 0) throw new Error(json.message || '重试失败')
            submitted += 1
            consumedMi += json.data.consumedMi || 0
            balance = json.data.balance ?? balance
          } catch (err) {
            errors.push(err.message || '重试失败')
          }
        }
        if (!submitted) throw new Error(errors[0] || '批量重试失败')
        this.billing = {
          consumedMi: this.billing.consumedMi + consumedMi,
          balance,
        }
        this.currentStep = 'generating'
        this.progress.status = 'GENERATING'
        if (errors.length) this.errorMessage = `${errors.length} 张未能提交重试`
        this.startPolling()
        return { submitted, failed: errors.length }
      } catch (err) {
        this.errorMessage = err.message || '批量重试失败'
        throw err
      } finally {
        this.generationLoading = false
      }
    },

    async fetchRecentImages() {
      this.errorMessage = ''
      try {
        const res = await fetch(apiPath(`${API_PREFIX}/source-images?limit=24`), {
          headers: requestHeaders(),
        })
        const json = await res.json()
        if (json.code !== 0) throw new Error(json.message || '历史图片加载失败')
        this.recentImages = json.data || []
        return this.recentImages
      } catch (err) {
        this.errorMessage = err.message || '历史图片加载失败'
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

    async downloadImages(imageUrls) {
      const urls = [...new Set((imageUrls || []).filter(Boolean))]
      for (const url of urls) {
        await this.downloadImage(url)
        await new Promise((resolve) => setTimeout(resolve, 180))
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
      this.generationLoading = false
      this.errorMessage = ''
      this.billing = { consumedMi: 0, balance: null }
      this.recentImages = []
      this.config = createDefaultConfig()
      this.progress = {
        status: '',
        completed: 0,
        failed: 0,
        finished: 0,
        total: 0,
        items: [],
      }
      this.results = {
        mainImages: [],
        detailPages: [],
      }
      localStorage.removeItem(DRAFT_KEY)
    },
  },
})
