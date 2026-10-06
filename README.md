# 盾构隧道掘进施工管理平台

面向盾构机台账、掘进环次、管片拼装、同步注浆、渣土外运、地表沉降监测与轴线纠偏的一体化盾构隧道施工管理平台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 新同事接手：环境与安装（可复现）

- Node 版本钉在 **20.20.2**（见 `frontend/.nvmrc`、`package.json` 的 `engines`、`frontend/Dockerfile`
  的基础镜像 `node:20.20.2-alpine3.21`），本地开发与容器部署是同一个大版本。
- 依赖版本由 **`frontend/package-lock.json` 这一份锁文件**说了算，开发（`npm ci`）与容器部署
  （Dockerfile 里也是 `npm ci`）读同一份。**不要用 `npm install` 交付**，它可能漂版本、漏装跨平台
  可选依赖（rollup 原生包就是这么在容器里装不齐的）。
- 锁文件里已包含 rollup 在 linux/darwin/win 各架构的可选原生包，换平台 `npm ci` 都装得齐。

```bash
cd frontend
npm ci            # 严格按锁文件安装
npm run dev       # 本地开发
npm run build     # 类型检查（浏览器 + 脚本两套 tsconfig）+ 生产构建
```

容器方式：

```bash
docker compose up --build      # 同样是 npm ci + 同一份锁文件
```

## 初始化脚本：一条灌样例，一条恢复初始状态

两条脚本与浏览器首次打开共用同一个灌入引擎
（`src/data/seed-engine.ts`），行为完全一致。数据落在 `frontend/data/` 下的 JSON 文件（已 gitignore）。

```bash
npm run db:seed     # 灌样例：按业务主键去重，可重复执行
npm run db:reset    # 恢复到初始状态（只含校验通过的基线行）
```

也可以用 Makefile：`make seed` / `make reset`（另有 `make ci`、`make build`）。

灌样例脚本支持演练参数：

```bash
npm run db:seed -- --role=viewer        # 非管理员：越权改动一律拦下
npm run db:seed -- --crash-after=20     # 处理到第 20 条后进程中断，再跑即从第 21 条续灌
npm run db:seed -- --fail-write         # 首次写库失败：整笔回滚，不留半截数据
```

灌入规则（页面按钮「灌样例 / 恢复初始数据」同口径，仅管理员可见可用）：

- **按管线编号（业务主键）去重**：已存在或同批重复都不再插入，反复灌不会多出重复行；
  灌入完成会清掉断点游标，重复灌只做检查、新增为 0。
- **断点续灌**：逐行整体快照落库，成功才推进游标（`data/seed-cursor.json`）；中途断掉，
  重跑从断掉的下一条接着走，已入行靠主键去重不重复。
- **异常行单列**：缺业务主键、数值字段不是数字、主键重复的行进 `seed-report.json`，
  并在页面「运营概览 → 上次初始化结论」表格里写明模块、编号与拒收原因，不进正式数据。
- **写库失败整笔回滚**：任何一次写入失败都恢复到灌入前快照；浏览器侧 localStorage 写入失败
  （配额满等）同样就地撤销。
- **越权拦截**：角色分观察员（只读）/ 值班员（登记、流转）/ 管理员（灌样例、恢复），
  顶栏可切换；越权操作在服务层与脚本层统一拦下。

## 管线探查：状态顺序、数值口径与待办同步

管线状态顺序由代码拍板，页面只能逐格往后走，跳格会被拦下：

```
待探查 → 已探明 → 迁改中 → 已恢复
```

样例覆盖全部四种情形（`src/data/seed.ts` 的 `utility`），另附 3 条故意的坏样例用于演示异常隔离。
`埋设深度 / 管线管径 / 与隧道净距` 是**数值字段**：灌入时非数字直接拒收，读取边界还会把
数字字符串归一回 number，杜绝「本地是数字、容器里变字符串」。

「**待迁移管线**」= 已探明 + 迁改中。三处只认 `src/data/pipeline-domain.ts` 这一份口径：

- 管线探查页统计卡；
- 进度节点页「待办清单 · 待迁移管线跟进」——灌完样例的结论落到这里；
- 运营概览页卡片与模块统计。

反复提交同一管线编号的登记也只入一条（幂等），写库失败就地回滚。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── scripts/              db-seed / db-reset 初始化脚本 + 文件存储适配器
│   ├── data/                 脚本产出的 JSON 数据（gitignore，不入库）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、登记、导出、初始化入口
│   ├── src/data/             模块元数据 / 示例数据 / 灌入引擎 / localStorage / 管线口径 / 类型
│   ├── src/stores/           会话、角色与权限
│   ├── package-lock.json     依赖锁文件（开发与部署同一份）
│   ├── .nvmrc                Node 运行时版本
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── Dockerfile（在 frontend/ 内，node:20.20.2-alpine3.21 + npm ci）
├── docker-compose.yml
└── Makefile
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
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`；跨页面的统计口径放 `frontend/src/data/*-domain.ts`，不许各算各的。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断；带 `orderedTransitions`
  的模块必须按状态数组顺序逐格流转。
- 想回到初始数据：浏览器里点管理员的「恢复初始数据」，或命令行 `npm run db:reset`；
  也可以清掉浏览器中 `shield-tunnel-construction:entries` 等键后刷新（会重新走灌入引擎）。
