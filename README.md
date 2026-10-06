# 盾构隧道掘进施工管理平台

面向盾构机台账、掘进环次、管片拼装、同步注浆、渣土外运、地表沉降监测与轴线纠偏的一体化盾构隧道施工管理平台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 接手第一步：可复现环境

| 项 | 固定值 | 在哪里钉死 |
| --- | --- | --- |
| Node | `20.20.2` | `.nvmrc`、`frontend/Dockerfile`（`node:20.20.2-alpine`）、`package.json#engines` |
| npm | `>=10.8.2` | `package.json#engines`，`.npmrc` 开 `engine-strict` |
| 依赖版本 | 全部精确版本 + `package-lock.json`（lockfileVersion 3） | `frontend/package.json`、`frontend/package-lock.json` |

**开发与部署读同一份锁文件**：本机、CI、Docker 构建一律 `npm ci`，不允许 `npm install` 带出的
caret 漂移（这就是过去「依赖装不齐、初始化一跑就报错」的根因）。

```bash
nvm use            # 读 .nvmrc，切到 Node 20.20.2
make install       # = cd frontend && npm ci
make frontend      # 起开发服务 http://127.0.0.1:5173/
make build         # npm ci + 类型检查 + 生产构建
make selfcheck     # 灌样例引擎的工程化自检（不依赖浏览器）
```

容器部署：`docker compose up --build`。镜像多阶段构建，构建阶段 `npm ci` 装锁文件依赖并
`npm run build`，运行阶段只托管同一份依赖产出的静态文件（`vite preview`），端口同为 5173。

## 管线探查：两条初始化脚本

样例只有一份源头：`frontend/src/data/utility-sample.json`，Node 脚本、浏览器首启、容器环境
都认它。样例覆盖**待探查 / 已探明 / 迁改中 / 已恢复**四种状态，并故意包含 3 条异常行
（埋设深度非数字、管线编号为空、同编号重复报送）用于验证校验与异常单列。

| 目的 | 命令 | 说明 |
| --- | --- | --- |
| 灌样例 | `npm run seed`（或 `make seed`） | 可反复执行，**重复灌只生效一次** |
| 恢复初始状态 | `npm run seed:reset`（或 `make seed-reset`） | 清空管线表与批次状态后重新灌第一遍 |

CLI 参数：`--role admin|viewer`（默认 `admin`，或用环境变量 `SEED_ROLE`）、
`--store <path>`（默认 `frontend/.data/utility-store.json`）。
`viewer` 执行会被越权拦截、退出码为 1，数据不动。浏览器端在「管线探查」页有同名两个按钮，
顶栏可切到「只读」角色演示拦截。

### 灌入顺序（由引擎拍板，不靠人记）

实现在 `frontend/src/data/seed-engine.ts`，浏览器与 Node 共用：

1. **权限校验**：非 admin 一律拦下（越权改动一律拦下）。
2. **行级校验**：管线编号必填、探查状态必须合法、埋设深度/与隧道净距必须能转数字。
   数值统一强转为 `number`——修复「本地算出来是数字、容器里成了字符串」。异常行单独列出，
   报告里写清第几行、编号、原因，不入库。
3. **按管线编号去重**：样例内重复编号只认第一条（重复报送进异常清单）；库里已存在的编号
   幂等跳过。同一份样例反复灌不会多出一行。
4. **编号升序排序**：先后固定，结果可复现。
5. **断点续灌**：检查点（已提交编号）持久化在批次状态里。中途断掉重跑，已提交的跳过，
   从断掉的那一条接着走。
6. **逐行事务写入**：Node 端临时文件 + 同目录原子 `rename`；浏览器端快照 + 补偿。
   写库失败整笔回滚，故障行进异常清单后停止，检查点停在最后成功行。
7. **提交成功后才推进检查点**。
8. **待办/统计不另存**：读取时从同一份管线行现算。

灌完的结论落到「进度节点」页的**管线迁改进度待办**（已探明待迁改的管线自动进清单，可直接
安排迁改）。**待迁移管线数三处只认一份**：管线探查页卡片、进度节点页待办、运营概览卡片，
都由 `getUtilityMetrics()` 从管线表现算。

### 状态流转顺序

`runAction()` 强制线性推进：只能从当前态到**紧邻的下一态**（待探查 → 已探明 → 迁改中 →
已恢复，其他模块同理按模块表状态序）。跳态、回头、停在同态反复点都会被拒绝——反复提交
只入一条。写库失败就地撤销。

## 目录结构

```text
.
├── .nvmrc                        Node 版本（开发/部署一致）
├── frontend/
│   ├── package-lock.json         可复现锁文件（唯一依赖事实源）
│   ├── .npmrc                    engine-strict / save-exact
│   ├── Dockerfile                多阶段：npm ci 构建 → vite preview 托管
│   ├── scripts/
│   │   ├── seed-utility.mts          初始化脚本：灌样例
│   │   ├── reset-utility.mts         初始化脚本：恢复初始状态
│   │   ├── file-seed-store.mts       Node 适配器（原子 rename 事务）
│   │   ├── selfcheck.mts             引擎保证自检（去重/断点/回滚/越权/同源）
│   │   └── selfcheck-browser.mts     浏览器适配器事务自检（localStorage 桩）
│   ├── src/data/
│   │   ├── utility-sample.json   管线样例唯一源头（四状态 + 3 异常行）
│   │   ├── seed-engine.ts        灌入引擎：顺序/校验/去重/断点/事务
│   │   ├── browser-seed-store.ts 浏览器适配器（补偿事务）
│   │   ├── seed.ts / modules.ts / local-store.ts / types.ts
│   ├── src/api/local-service.ts  列表、动作流转（顺序管控/越权拦截）、同源指标
│   └── src/views/utility|progress/ 管线探查页 / 进度节点页
└── docker-compose.yml
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 盾构机台账 | `shield` | 盾构机 | 盾构机编号、盾构机型号、开挖直径 |
| 掘进环次 | `ring` | 掘进环 | 环号、起始里程、掘进速度 |
| 管片拼装 | `segment` | 管片环 | 管片环号、管片型号、拼装点位 |
| 同步注浆 | `grouting` | 注浆记录 | 注浆编号、对应环号、浆液配比 |
| 渣土外运 | `muck` | 渣土运输单 | 运输单号、对应环号、渣土方量 |
| 地表沉降 | `settlement` | 沉降测点 | 测点编号、测点位置、初始高程 |
| 轴线偏差 | `axis` | 轴线测量 | 测量编号、对应环号、设计轴线 |
| 刀具磨损 | `cutter` | 刀具 | 刀具编号、刀盘位置、刀具类型 |
| 管片生产 | `segmentprod` | 管片 | 管片编号、管片型号、生产模具 |
| 浆液拌制 | `mortar` | 浆液批次 | 批次编号、浆液类型、水泥用量 |
| 洞内通风 | `ventilation` | 通风机组 | 机组编号、风筒长度、送风量 |
| 建筑监测 | `building` | 监测对象 | 对象编号、建筑物名称、结构类型 |
| 管线探查 | `utility` | 地下管线 | 管线编号、管线类型、埋设深度 |
| 进度节点 | `progress` | 进度节点 | 节点编号、节点名称、计划完成日 |
| 试验检测 | `testing` | 试验委托 | 委托编号、试样类型、检测项目 |
| 应急演练 | `drill` | 应急演练 | 演练编号、演练科目、演练日期 |
| 班组进场 | `crew` | 施工班组 | 班组编号、班组名称、主要工种 |
| 安全巡检 | `safety` | 巡检记录 | 巡检编号、巡检区域、巡检项目 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；样例源头在
  `frontend/src/data/utility-sample.json`（管线探查）。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：CLI 用 `npm run seed:reset`；浏览器在管线探查页点「恢复初始状态」，
  或清掉 `shield-tunnel-construction:entries:v2` 与
  `shield-tunnel-construction:utility-seed-state` 两个 localStorage 键后刷新。
