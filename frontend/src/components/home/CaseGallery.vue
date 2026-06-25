<script setup>
import ossImages from '../../assets/youqian/oss-images.json';

const caseNames = [
  '029-1.webp',
  '030-2.webp',
  '031-3.webp',
  '032-4.webp',
  '033-6.webp',
  '034-5.webp',
  '035-7.webp',
  '036-8.webp',
  '037-10.webp',
  '038-9.webp',
  '039-11.webp',
  '040-12.webp',
  '041-13.webp',
  '042-14.webp',
  '043-15.webp',
  '044-16.webp',
  '045-17.webp',
  '046-18.webp',
  '047-19.webp',
  '048-20.webp',
  '049-21.webp',
  '050-22.webp',
  '051-23.webp',
  '052-24.webp',
];

const ossImageMap = new Map(ossImages.map((item) => [item.name, item.url]));

const cases = caseNames
  .map((name) => ({
    name,
    src: ossImageMap.get(name),
  }))
  .filter((item) => item.src);
</script>

<template>
  <section class="yh-cases" aria-label="详情页案例">
    <header>
      <h2>详情页案例</h2>
      <p>所有案例为用户真实生成案例，无任何后期处理</p>
    </header>
    <div class="yh-case-grid">
      <article v-for="item in cases" :key="item.name" class="yh-case-card">
        <div class="yh-case-scroll">
          <img class="yh-case-image" :src="item.src" alt="详情页案例" loading="lazy" />
        </div>
        <span class="yh-case-hint">鼠标悬浮查看全图</span>
      </article>
    </div>
  </section>
</template>
