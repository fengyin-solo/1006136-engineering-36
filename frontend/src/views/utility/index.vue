<template>
  <section class="page" data-module="utility">
    <header class="page-head">
      <div>
        <h2>管线探查管理</h2>
        <p class="page-desc">维护地下管线，围绕管线编号、管线类型、埋设深度、管线管径做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记地下管线</button>
        <button class="btn" type="button" @click="exportRows">导出管线探查清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <section class="seed-panel">
      <header class="seed-panel-head">
        <h3>样例灌入（可复现）</h3>
        <div class="seed-actions">
          <button class="btn" type="button" :disabled="!store.isAdmin" @click="runSeed">灌一遍样例</button>
          <button class="btn ghost" type="button" :disabled="!store.isAdmin" @click="runReset">恢复初始状态</button>
          <span class="seed-hint">重复灌只生效一次 · 按管线编号去重 · 断点可续灌 · 异常行单列</span>
        </div>
      </header>
      <div v-if="report" class="seed-report">
        <p :class="report.ok ? 'seed-ok' : 'seed-fail'">
          批次 {{ report.batchId || '—' }}　{{ report.resumed ? '（本次为断点续灌）' : '' }}　{{ report.message }}
        </p>
        <ul v-if="report.inserted.length" class="seed-list">
          <li v-for="row in report.inserted" :key="String(row.id)" class="seed-insert">
            新增 {{ row['管线编号'] }}（{{ row.status }}，埋深 {{ row['埋设深度'] }}m / 净距 {{ row['与隧道净距'] }}m）
          </li>
        </ul>
        <ul v-if="report.skipped.length" class="seed-list">
          <li v-for="(item, i) in report.skipped" :key="`s-${i}`" class="seed-skip">跳过 {{ item.code }}：{{ item.reason }}</li>
        </ul>
        <ul v-if="report.rejected.length" class="seed-list">
          <li v-for="(item, i) in report.rejected" :key="`r-${i}`" class="seed-reject">
            异常 · 第 {{ item.index + 1 }} 行 {{ item.code || '(无编号)' }}：{{ item.reason }}
          </li>
        </ul>
      </div>
      <p v-else class="seed-hint">灌入顺序固定：权限 → 校验 → 去重 → 排序 → 断点 → 逐行事务 → 检查点 → 待办/统计重算。</p>
    </section>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in availableActions(row.status)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无管线探查数据，可先灌样例或登记地下管线</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条管线探查记录 · 待迁移管线数与进度节点页、运营概览同源</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  getUtilityMetrics,
  listEntries,
  moduleMeta,
  resetUtilitySamples,
  runAction as applyAction,
  seedUtilitySamples,
} from '@/api/local-service'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'
import type { SeedReport } from '@/data/seed-engine'

const store = useSessionStore()
const meta = moduleMeta('utility')
const columns = ["管线编号", "管线类型", "埋设深度", "管线管径", "与隧道净距", "权属单位", "迁改方案", "探查状态"]
const actionByTarget: Record<string, string> = {
  "已探明": "提交探查",
  "迁改中": "安排迁改",
  "已恢复": "确认恢复",
}
const statuses = ["待探查", "已探明", "迁改中", "已恢复"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const report = ref<SeedReport | null>(null)
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

// 指标不再在页面里写死 0：全部走 local-service 的同源函数。
const stats = computed(() => {
  const m = getUtilityMetrics()
  return [
    { label: "待探查管线", value: m.待探查管线 },
    { label: "迁改中管线", value: m.迁改中管线 },
    { label: "已恢复管线", value: m.已恢复管线 },
    { label: "待迁移管线", value: m.待迁移管线 },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 谁先谁后由状态机拍板：每行只亮「推进到紧邻下一态」的那个动作。
function availableActions(status: string): string[] {
  const index = statuses.indexOf(status)
  const next = statuses[index + 1]
  return next && actionByTarget[next] ? [actionByTarget[next]] : []
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '地下管线登记入口尚未接入审批流'
}

function actor() {
  return { role: store.role }
}

function runSeed() {
  errorMessage.value = ''
  report.value = seedUtilitySamples(actor())
  if (!report.value.authorized) {
    errorMessage.value = report.value.message
  }
  reload()
}

function runReset() {
  errorMessage.value = ''
  report.value = resetUtilitySamples(actor())
  if (!report.value.authorized) {
    errorMessage.value = report.value.message
  }
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action, actor())
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '管线探查列表读取失败'
  }
}

onMounted(reload)
</script>
