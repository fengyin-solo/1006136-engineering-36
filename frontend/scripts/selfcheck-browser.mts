#!/usr/bin/env node
/**
 * 浏览器适配器事务验证：给 globalThis 装一个 localStorage 桩，
 * 直接加载编译前的 TS（tsx），验证：
 *  - 首次灌入四状态入库，数值为 number
 *  - 灌到一半注入写入故障：管线表与批次状态同时回到快照（整笔撤销）
 *  - 故障恢复后续灌成功
 *  - reset 后数据与首灌一致
 */
// 极简 localStorage 桩：支持 setItem/getItem/removeItem，并可注入故障。
class LocalStorageStub {
  map = new Map()
  failOn = null
  setItem(k, v) {
    if (this.failOn && k === this.failOn.key) {
      if (this.failOn.allow > 0) {
        this.failOn.allow -= 1
      } else if (this.failOn.times > 0) {
        this.failOn.times -= 1
        throw new Error(`模拟 localStorage 写入失败：${k}`)
      }
    }
    this.map.set(k, String(v))
  }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null }
  removeItem(k) { this.map.delete(k) }
  clear() { this.map.clear() }
}

const ls = new LocalStorageStub()
globalThis.window = { localStorage: ls }

const { createBrowserSeedStore } = await import('../src/data/browser-seed-store.ts')
const { seedUtility, resetUtilitySeed } = await import('../src/data/seed-engine.ts')
const { invalidateCache } = await import('../src/data/local-store.ts')

let failures = 0
const check = (name, cond, detail = '') => {
  console.log(cond ? `  ✓ ${name}` : `  ✗ ${name}${detail ? ` —— ${detail}` : ''}`)
  if (!cond) failures += 1
}

console.log('1) 浏览器首灌')
{
  const store = createBrowserSeedStore()
  const report = seedUtility(store, { actor: { role: 'admin' } })
  check('成功完成', report.ok && report.finished)
  check('4 行入库', store.list().length === 4, `实际 ${store.list().length}`)
  check('埋深/净距为 number', store.list().every((r) => typeof r['埋设深度'] === 'number' && typeof r['与隧道净距'] === 'number'))
}

console.log('2) 写库失败整笔撤销（管线表 + 批次状态同时回滚）')
{
  // 制造「管线表提交写入失败」：读时播种空壳会先成功写一次，第 2 次（事务提交）才故障，
  // 补偿事务必须把已写的批次状态还原，且管线表不残留本笔行。
  ls.clear()
  invalidateCache()
  ls.failOn = { key: 'shield-tunnel-construction:entries:v2', times: 1, allow: 1 }
  const store = createBrowserSeedStore()
  const report = seedUtility(store, { actor: { role: 'admin' } })
  check('本次报告失败', !report.ok)
  check('管线表整笔回滚为 0 行', store.list().length === 0, `实际 ${store.list().length}`)
  check('批次状态也回滚为空', store.getState() === null)
}

console.log('3) 故障恢复后续灌')
{
  ls.failOn = null
  invalidateCache()
  const store = createBrowserSeedStore()
  const report = seedUtility(store, { actor: { role: 'admin' } })
  check('恢复后灌入完成', report.ok && store.list().length === 4, `实际 ${store.list().length}`)
}

console.log('4) 越权拦截 & reset')
{
  invalidateCache()
  const store = createBrowserSeedStore()
  const denied = seedUtility(store, { actor: { role: 'viewer' } })
  check('viewer 被拦', !denied.authorized)
  store.list().push({ id: 99, status: '待探查', pending: true, abnormal: false, '管线编号': 'UTIL-X' })
  const report = resetUtilitySeed(store, { actor: { role: 'admin' } })
  check('reset 完成且为 4 行', report.ok && store.list().length === 4)
}

if (failures) { console.error(`失败 ${failures} 项`); process.exit(1) }
console.log('浏览器适配器验证通过')
