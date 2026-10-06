.PHONY: install ci frontend build seed reset

install:
	cd frontend && npm install

# 新同事接手 / 部署：严格按 package-lock.json 安装，版本可复现
ci:
	cd frontend && npm ci

frontend:
	cd frontend && npm run dev

build:
	cd frontend && npm run build

# 初始化脚本：一条灌样例，一条恢复到初始状态
seed:
	cd frontend && npm run db:seed

reset:
	cd frontend && npm run db:reset
