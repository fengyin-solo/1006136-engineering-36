.PHONY: install frontend build seed seed-reset selfcheck

# 开发与部署读同一份 frontend/package-lock.json：统一 npm ci，不允许版本漂移。
install:
	cd frontend && npm ci

frontend:
	cd frontend && npm run dev

build:
	cd frontend && npm ci && npm run build

# 初始化脚本：一条灌样例，一条恢复到初始状态（Node 侧，落盘在 frontend/.data/）。
seed:
	cd frontend && npm run seed

seed-reset:
	cd frontend && npm run seed:reset

# 工程化自检：去重/断点续灌/回滚/越权/同源统计，不依赖浏览器。
selfcheck:
	cd frontend && npm run selfcheck
