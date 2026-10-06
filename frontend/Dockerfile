# 开发与部署读同一份 package-lock.json：
# 依赖只在构建阶段按锁文件安装（npm ci），运行阶段只托管 vite build 出来的静态产物。
FROM node:20.20.2-alpine AS build
WORKDIR /srv/web
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20.20.2-alpine
WORKDIR /srv/web
ENV NODE_ENV=production
COPY --from=build /srv/web/node_modules ./node_modules
COPY --from=build /srv/web/package.json ./package.json
COPY --from=build /srv/web/dist ./dist
EXPOSE 5173
# vite preview 托管的是同一份锁文件依赖构建出的静态文件，不再走在线编译。
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "5173"]
