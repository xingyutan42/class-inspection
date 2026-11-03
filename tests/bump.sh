#!/usr/bin/env bash
# 统一替换 index.html 里的 ?v= 版本号
# 用法: bash tests/bump.sh 20261102cd
set -e
cd "$(dirname "$0")/.."
NEW="$1"
if [ -z "$NEW" ]; then echo "用法: bump.sh <新版本号>"; exit 1; fi
OLD=$(grep -o '?v=[a-z0-9]*' index.html | head -1 | cut -d= -f2)
if [ -z "$OLD" ]; then echo "❌ 未在 index.html 找到 ?v= 版本号"; exit 1; fi
sed -i "s/?v=$OLD/?v=$NEW/g" index.html
CNT=$(grep -o "?v=$NEW" index.html | wc -l | tr -d ' ')
echo "版本: $OLD -> $NEW"
echo "替换处数: $CNT"
