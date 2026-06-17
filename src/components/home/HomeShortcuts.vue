<script setup>
import { useRouter } from 'vue-router';
import { useUserStore } from '../../stores/user';

const router = useRouter();
const userStore = useUserStore();
const emit = defineEmits(['select']);

const shortcuts = [
  { title: '打开对话', desc: '打开对话分组', icon: 'chat' },
  { title: 'AI 详情页', desc: '一键生成详情长图', icon: 'detail' },
  { title: 'AI 主图', desc: '秒出爆款主图', icon: 'main' },
  { title: '竞品复刻', desc: '精准狙击竞品', icon: 'copy' },
  { title: '产品场景图', desc: '场景化产品展示', icon: 'camera' },
  { title: '反推提示词', desc: '图片反推可编辑提示词', icon: 'reverse-prompt' },
];

function handleShortcut(item) {
  if (item.icon === 'reverse-prompt') {
    router.push('/reverse-prompt');
    return;
  }
  if (!userStore.requireLogin()) return;
  if (item.icon === 'copy') {
    emit('select', item);
    return;
  }
  if (item.title === 'AI 详情页') router.push('/canvas');
}
</script>

<template>
  <section class="yh-shortcuts" aria-label="快捷功能">
    <button
      v-for="item in shortcuts"
      :key="item.title"
      class="yh-shortcut-card"
      type="button"
      @click="handleShortcut(item)"
    >
      <span class="yh-shortcut-default">
        <span class="yh-shortcut-icon" aria-hidden="true">
          <svg v-if="item.icon === 'chat'" viewBox="0 0 24 24">
            <path d="M6.2 18.1a7.2 7.2 0 1 1 2.2 1.5l-3.4.8 1.2-2.3Z" />
            <path d="M10 8.2v4.9h4.4" />
          </svg>
          <svg v-else-if="item.icon === 'detail'" viewBox="0 0 24 24">
            <rect x="6" y="4.8" width="12" height="14.4" rx="1.4" />
            <path d="M10.2 5.1v13.8M13.8 5.1v13.8" />
          </svg>
          <svg v-else-if="item.icon === 'main'" viewBox="0 0 24 24">
            <rect x="6" y="5" width="12" height="14" rx="1.5" />
            <rect x="9.2" y="8.2" width="5.6" height="5.6" rx="0.8" />
            <path d="M8.8 16.6h6.4" />
          </svg>
          <svg v-else-if="item.icon === 'copy'" viewBox="0 0 24 24">
            <rect x="8.2" y="8.2" width="10" height="10" rx="1.6" />
            <path d="M5.8 14.8V6.9c0-.6.5-1.1 1.1-1.1h7.9" />
          </svg>
          <svg v-else-if="item.icon === 'camera'" viewBox="0 0 24 24">
            <path d="M6 9.2h2.5l1.2-2h4.6l1.2 2H18c.7 0 1.2.5 1.2 1.2v6.4c0 .7-.5 1.2-1.2 1.2H6c-.7 0-1.2-.5-1.2-1.2v-6.4c0-.7.5-1.2 1.2-1.2Z" />
            <circle cx="12" cy="13.7" r="2.7" />
          </svg>
          <svg v-else viewBox="0 0 24 24">
            <path d="M8.2 5.6 5.1 8.2l2 3.1 1.7-1.1v8.2h6.4v-8.2l1.7 1.1 2-3.1-3.1-2.6-2.3 1.2h-3l-2.3-1.2Z" />
          </svg>
        </span>
        <span>
          <strong>{{ item.title }}</strong>
          <small>{{ item.desc }}</small>
        </span>
      </span>
      <span class="yh-shortcut-hover">{{ item.title }} &gt;</span>
    </button>
  </section>
</template>
