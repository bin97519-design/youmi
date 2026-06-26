<script setup>
import { onMounted } from 'vue';
import AuthLoginModal from './components/AuthLoginModal.vue';
import { useUserStore } from './stores/user';

const userStore = useUserStore();

onMounted(() => {
  userStore.restoreSession();
  userStore.fetchCurrentUser();
});
</script>

<template>
  <RouterView />
  <AuthLoginModal />
</template>
