import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '../stores/user'

const HomePage = () => import('../pages/HomePage.vue')
const CanvasListPage = () => import('../pages/CanvasListPage.vue')
const CanvasEditorPage = () => import('../pages/CanvasEditorPage.vue')
const CanvasSharePage = () => import('../pages/CanvasSharePage.vue')
const EcommerceSetPage = () => import('../pages/EcommerceSetPage.vue')
const HistoryPage = () => import('../pages/HistoryPage.vue')
const ConsolePage = () => import('../pages/ConsolePage.vue')
const PointsPage = () => import('../pages/PointsPage.vue')
const PaymentResultPage = () => import('../pages/PaymentResultPage.vue')
const MockPayPage = () => import('../pages/MockPayPage.vue')
const DesignSystemPage = () => import('../pages/DesignSystemPage.vue')

const routes = [
  { path: '/', name: 'home', component: HomePage, meta: { public: true } },
  { path: '/login', redirect: '/' },
  { path: '/history', name: 'history', component: HistoryPage },
  { path: '/console', name: 'console', component: ConsolePage },
  { path: '/points', name: 'points', component: PointsPage },
  {
    path: '/payment-result',
    name: 'payment-result',
    component: PaymentResultPage,
    meta: { public: true },
  },
  { path: '/mock-pay', name: 'mock-pay', component: MockPayPage },
  {
    path: '/design-system',
    name: 'design-system',
    component: DesignSystemPage,
    meta: { public: true },
  },
  { path: '/canvas', name: 'canvas-list', component: CanvasListPage, meta: { public: true } },
  {
    path: '/canvas/:id',
    name: 'canvas-editor',
    component: CanvasEditorPage,
    props: true,
    meta: { public: true },
  },
  {
    path: '/ecommerce-set',
    name: 'ecommerce-set',
    component: EcommerceSetPage,
    meta: { public: true },
  },
  {
    path: '/canvas/share/:token',
    name: 'canvas-share',
    component: CanvasSharePage,
    props: true,
    meta: { public: true },
  },
  {
    path: '/reverse-prompt',
    name: 'reverse-prompt',
    component: CanvasEditorPage,
    props: { id: 'reverse-prompt' },
    meta: { public: true },
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

router.beforeEach((to) => {
  const user = useUserStore()
  if (!user.isAuthenticated) user.restoreSession()
  if (to.meta.public || user.isAuthenticated) return true
  user.openLogin()
  return {
    path: '/',
    query: to.fullPath !== '/' ? { redirect: to.fullPath } : {},
  }
})

export default router
