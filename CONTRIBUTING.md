# 贡献指南

感谢关注本项目！这是一个**无构建**的纯静态项目，开发流程非常轻，但有几条**项目铁律**请务必遵守。

## 环境准备

```bash
git clone https://github.com/xingyutan42/class-inspection.git
cd class-inspection

# 1. 复制配置模板并填入你自己的云服务配置
cp src/config.example.js src/config.js
cp login-website/config.example.js login-website/config.js

# 2. 准备一个 PostgreSQL 数据库并建库（Supabase 或兼容服务均可）
psql "<你的连接串>" -f db/schema.sql

# 3. 本地预览
python -m http.server 8080
```

> 配置文件与数据库都请使用**你自己**的实例，不要也无法连接到他人的生产环境。

## 项目铁律

1. **禁止提交任何真实个人信息**
   真实姓名、学号、手机号、照片一律不得进入仓库。名单、辅导员映射等运营数据：
   - 本地文件放 `.gitignore` 保护（如 `counselor_map.json`）
   - 仓库里只保留 `*.example` 示例文件
   - 提交前请 `git diff --staged` 自查一遍

2. **无构建原则**
   不引入打包器（webpack/vite 等）、不新增 npm 依赖、不用 ES Module import。
   改完代码刷新即生效。第三方库继续走 `vendor/` 自托管。

3. **改前端必须 bump 版本号**
   修改任何前端文件后，把 `index.html` 里所有 `?v=` 的值换成新的字符串（如 `20261102a`），
   否则用户浏览器会继续用旧缓存，表现为「改了没生效」。

4. **数据库改动走增量脚本**
   新增/修改 RPC 或表结构：新建 `db/migrate-<主题>.sql` 增量脚本，并同步更新 `db/schema.sql`（保持幂等）。
   函数一律 `SECURITY DEFINER`，业务表保持「RLS 开启 + 零策略」。

5. **提交前跑测试**
   ```bash
   node tests/week.test.mjs
   ```

## 提交流程

1. Fork 仓库，从 `main` 拉出功能分支（如 `feat/photo-caption`）
2. 一个 PR 只做一件事，改动点在 PR 描述里写清楚（中文即可）
3. 确认 CI 绿灯，等待维护者 review

## 代码风格

- CSS：手写原生样式，组员端用 `hm-*` 前缀命名空间，管理端用 `adm-*`，避免污染全局
- 视图：每个页面一个组件对象，注册在 `src/app.js`，路由映射在 `src/store.js`
- SQL：函数体保持 `SET search_path = public`，异常消息用中文（前端直接展示）

## 维护者工作流（maintainer only）

GitHub 仓库是**唯一事实源（source of truth）**，但维护者的部署目录与仓库之间有一层隐私隔离：

- 维护者的工作目录是一个**本地 git 仓库（无远程）**，仅用于本地版本历史与回滚，不直接连接 GitHub；
- 工作目录中的真实运营数据（名单、辅导员映射、真实服务配置）被 `.gitignore` 永久排除，
  **不进入任何 git 历史**——无论本地仓库还是本仓库；
- 本地 → GitHub 的同步经由一个**脱敏中间副本**完成：复制 → 替换真实数据为 example → PII 扫描 → 提交推送；
- 合并他人 PR 的生效路径：`merge on GitHub` → 同步脚本拉取 → PII 扫描 → 应用到维护者工作目录 → 平台发布。
  因此从 PR 合并到线上生效存在短暂延迟，属正常现象；
- 给维护者自己的提醒：在本地工作目录改动后，先 `git commit` 留档，再走同步管线推送到 GitHub。
