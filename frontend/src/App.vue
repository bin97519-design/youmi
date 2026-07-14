<script setup>
import { onMounted, watch } from 'vue';
import AuthLoginModal from './components/AuthLoginModal.vue';
import { useCanvasStore } from './stores/canvas';
import { useUserStore } from './stores/user';

const userStore = useUserStore();
const canvasStore = useCanvasStore();

watch(
  () => userStore.profile?.id ?? null,
  () => canvasStore.reloadUserScope(),
  { flush: 'sync' },
);

onMounted(() => {
  userStore.restoreSession();
  userStore.fetchCurrentUser();
});
</script>

<template>
  <RouterView />
  <AuthLoginModal />
</template>
