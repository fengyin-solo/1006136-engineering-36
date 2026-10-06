<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
        <button class="btn" type="button" :disabled="!store.canAdmin" @click="reseed">灌样例</button>
        <button class="btn ghost" type="button" :disabled="!store.canAdmin" @click="restore">恢复初始数据</button>
      </div>
    </header>

    <p v-if="!store.canAdmin" class="page-desc">当前角色没有初始化权限：灌样例 / 恢复初始数据仅管理员可用，越权改动会被拦下。</p>

    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>

    <section v-if="report" class="todo-panel">
      <header class="todo-head">
        <h3>上次初始化结论</h3>
        <span class="todo-count">新增 {{ report.inserted }} · 跳过重复 {{ report.skipped }} · 异常 {{ report.rejected.length }}</span>
      </header>
      <table v-if="report.rejected.length" class="data-table">
        <thead>
          <tr><th>模块</th><th>业务编号</th><th>拒收原因</th></tr>
        </thead>
        <tbody>
          <tr v-for="(item, index) in report.rejected" :key="`${item.module}-${item.businessKey}-${index}`">
            <td>{{ item.module }}</td>
            <td>{{ item.businessKey }}</td>
            <td>{{ item.reasons.join('；') }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty-state">没有异常行</p>
    </section>

    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里；「待迁移管线」与管线探查页、进度节点待办是同一份口径。</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { lastSeedReport, loadOverview, restoreSampleData, seedSampleData } from '@/api/local-service'
import { useSessionStore } from '@/stores/session'
import type { OverviewResult, SeedReport } from '@/data/types'

const store = useSessionStore()
const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const report = ref<SeedReport | null>(null)

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  report.value = lastSeedReport()
}

function reseed() {
  report.value = seedSampleData(store.role)
  refresh()
}

function restore() {
  report.value = restoreSampleData(store.role)
  refresh()
}

onMounted(refresh)
</script>
