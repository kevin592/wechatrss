#!/bin/bash

# Vercel部署脚本
echo "Building application..."
cd apps/server

# 安装依赖
echo "Installing dependencies..."
pnpm install

# 生成Prisma Client
echo "Generating Prisma Client..."
pnpm prisma generate

# 构建应用
echo "Building NestJS application..."
pnpm build

# 复制前端资源到dist目录
echo "Copying frontend assets..."
mkdir -p dist/client
if [ -d "../../apps/web/dist" ]; then
  cp -r ../../apps/web/dist/* dist/client/
fi

echo "Build completed!"
