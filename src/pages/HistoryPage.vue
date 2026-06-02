<script setup>
const tasks = [
  ['详情页生成', '萌宠冻干排毛棒', '已完成', '6 张'],
  ['产品场景图', '植鞣牛皮包', '生成中', '3 张'],
  ['AI 主图', '全麦坚果欧包预拌粉', '已完成', '4 张'],
];
</script>

<template>
  <main class="simple-page">
    <header><RouterLink to="/">← 返回首页</RouterLink><h1>历史生成</h1><p>跟踪 AI 任务进度、结果和可复用素材。</p></header>
    <section class="table-card">
      <article v-for="task in tasks" :key="task[1]"><strong>{{ task[0] }}</strong><span>{{ task[1] }}</span><em>{{ task[2] }}</em><b>{{ task[3] }}</b></article>
    </section>
  </main>
</template>
