<script setup>
const plans = [
  ['月度会员', '99', '每月 1200 米值，适合高频运营'],
  ['年度会员', '699', '全年 18000 米值，团队首选'],
  ['米值包', '39', '按量补充，随用随买'],
];
</script>

<template>
  <main class="simple-page">
    <header><RouterLink to="/">← 返回首页</RouterLink><h1>米值 / 会员</h1><p>会员套餐、米值充值和余额管理。</p></header>
    <section class="plan-grid">
      <article v-for="plan in plans" :key="plan[0]"><h2>{{ plan[0] }}</h2><strong>￥{{ plan[1] }}</strong><p>{{ plan[2] }}</p><RouterLink to="/mock-pay">立即开通</RouterLink></article>
    </section>
  </main>
</template>
