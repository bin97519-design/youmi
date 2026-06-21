import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { initTheme } from './composables/useTheme'
import './assets/styles/tokens.css'
import './assets/styles/components.css'
import './assets/styles/main.css'

// 必须在 CSS 加载后、App mount 前执行，避免首屏闪烁
initTheme()

createApp(App).use(createPinia()).use(router).mount('#app')
