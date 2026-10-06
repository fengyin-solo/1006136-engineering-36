# 运行时版本钉死：本地与容器同一个 Node 大版本（见 .nvmrc 与 package.json engines）
FROM node:20.20.2-alpine3.21
WORKDIR /srv/web

# 开发与部署读同一份锁文件：先拷 package.json + package-lock.json，用 npm ci 严格按锁安装
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
