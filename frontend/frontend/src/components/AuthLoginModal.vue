<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '../stores/user'

const userStore = useUserStore()
const router = useRouter()
const route = useRoute()
const pending = ref(false)
const errorText = ref('')
const form = ref({
  account: '',
  password: '',
})

async function submitLogin() {
  errorText.value = ''
  pending.value = true

  try {
    await userStore.login(form.value)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : ''
    if (redirect && redirect !== route.fullPath) {
      router.replace(redirect)
    }
  } catch (error) {
    errorText.value = error.message || '登录失败，请稍后重试'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="userStore.loginModalOpen" class="yh-login-backdrop">
      <section class="yh-login-modal" role="dialog" aria-modal="true" aria-label="登录">
        <button
          class="yh-login-close"
          type="button"
          aria-label="关闭登录框"
          @click="userStore.closeLogin()"
        >
          ×
        </button>

        <div class="yh-login-left">
          <h2>电商AI，就用有米</h2>
          <strong>一个网站全搞定</strong>
          <div class="yh-login-tags">
            <span>◆ AI套图</span>
            <span>◆ AI设计</span>
            <span>◆ AI视频</span>
            <span>◆ AI运营</span>
          </div>
          <p>覆盖主流电商平台</p>
          <div class="yh-platforms">
            <span>1688</span>
            <span>Amazon</span>
            <span>eBay</span>
            <span>Shopify</span>
            <span>AliExpress</span>
            <span>SHEIN</span>
            <span>TAOBAO 淘宝</span>
            <span>TMALL 天猫</span>
            <span>JD.COM 京东</span>
            <span>PINDUODUO 拼多多</span>
          </div>
        </div>

        <form class="yh-login-right" @submit.prevent="submitLogin">
          <svg class="yh-login-logo" viewBox="0 0 122 34" aria-label="YOUMI">
            <path class="logo-stroke" d="M8 9.5c4.2 8 8 12 12.6 12.2 5.1.2 8.2-4.8 8.2-10.8" />
            <path class="logo-stroke" d="M20.3 21.6c-1.7 4.5-4.6 7.2-9.4 7.2" />
            <path
              class="logo-fill"
              d="M36.2 8.1c8.4 0 14.1 4.9 14.1 11.3 0 5.8-4.9 10.1-11.4 10.1-7.6 0-13.1-4.9-13.1-11.2 0-5.9 4.5-10.2 10.4-10.2Zm.8 6.3c-2.5 0-4.3 1.8-4.3 4.2 0 2.8 2.6 4.9 5.8 4.9 2.9 0 5-1.8 5-4.1 0-2.8-2.8-5-6.5-5Z"
            />
            <path
              class="logo-stroke"
              d="M51.7 10.2v9.4c0 6 3.3 9.6 9.1 9.6 5.8 0 9.5-3.8 9.5-9.8V10.2"
            />
            <path class="logo-stroke" d="M74.6 28.1V10.4l9.2 11.1 9.1-11.1v17.7" />
            <path class="logo-stroke" d="M101.3 10.4v17.7" />
            <path class="logo-stroke" d="M99.1 10.4h7.8" />
            <path class="logo-stroke" d="M99.1 28.1h8.1" />
          </svg>
          <h3>有米AI · 专为电商而生</h3>

          <label>
            <span>账号</span>
            <input
              v-model.trim="form.account"
              type="text"
              autocomplete="username"
              placeholder="手机号 / 登录账号"
            />
          </label>

          <label>
            <span>密码</span>
            <div class="yh-password-box">
              <input
                v-model="form.password"
                type="password"
                autocomplete="current-password"
                placeholder="请输入密码"
              />
              <button type="button">⊙</button>
            </div>
          </label>

          <p v-if="errorText" class="yh-login-error">{{ errorText }}</p>
          <button class="yh-login-submit" type="submit" :disabled="pending">
            {{ pending ? '登录中...' : '立即登录' }}
          </button>

          <div class="yh-login-links">
            <button type="button">密码登录</button>
            <button type="button">短信登录</button>
            <button type="button">注册账号</button>
            <button type="button">忘记密码</button>
          </div>
          <p class="yh-login-agreement">
            登录即表示阅读并同意《服务条款》《隐私政策》《AI 功能使用须知》
          </p>
        </form>
      </section>
    </div>
  </Teleport>
</template>
