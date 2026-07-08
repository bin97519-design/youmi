<script setup>
defineProps({ token: { type: String, required: true } });
</script>

<template>
  <main class="simple-page center-page">
    <h1>画布分享预览</h1>
    <p>分享 Token：{{ token }}</p>
    <RouterLink to="/canvas">打开我的画布</RouterLink>
  </main>
</template>
