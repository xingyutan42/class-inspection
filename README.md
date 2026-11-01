<div align="center">

# 🏫 学风建设 · 课堂检查统计站

**一套开箱即用的班级课堂检查管理系统 —— 组员登记选课、填报结果，管理员看进度、审修改、一键导出台账**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Vue 3](https://img.shields.io/badge/Vue-3.x-4FC08D?logo=vuedotjs&logoColor=white)](https://vuejs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14+-336791?logo=postgresql&logoColor=white)](https://postgresql.org)
[![No Build](https://img.shields.io/badge/build-none-orange)](#-快速开始)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/xingyutan42/class-inspection/pulls)
[![Stars](https://img.shields.io/github/stars/xingyutan42/class-inspection?style=social)](https://github.com/xingyutan42/class-inspection/stargazers)

*零构建 · 移动优先 · 数据库兜底的业务校验 · 源自真实生产环境*

</div>

---

## 📖 这是什么

学院学风建设课堂检查小组每周要做的事：

```
周末组员登记下周要查的课  →  工作日到教室查课并填报结果  →  管理员汇总、修正、导出 Excel 台账
```

这个系统把整条流程搬到了线上：**手机上点一点就能选课、填表、传照片**，管理员在总览页看清谁没交、谁查了多少，所有修正留痕可查，期末一键导出与学院模板完全一致的台账。

它源自一个真实在跑的生产环境（20+ 名课检员、20 周学期周期），为"非技术背景的学生组织如何低成本自建工具"提供了一份可直接抄的答案。

## ✨ 功能特性

**组员端**
- 📅 **我的查课** —— 本周待查大字计数、按课程时间排列，本周已查记录与实到/应到一目了然
- 🗓️ **新增选课** —— 教学周自动计算，星期/节次 chips 点选（1–12 节任意起止），预计到岗时间二选一
- 👥 **被查班级多行录入** —— 8 位班级号自动识别年级（26→大一 / 25→大二 / 24→大三），逐班填应到人数，"其他类"单独计数
- 📝 **填报结果** —— 应到/实到只读自动守恒（应到 = 实到 + 旷课 + 请假），旷课/请假逐人登记班级姓名，8 项纪律指标"确定键"防漏填，老师/学生评分（9.0–10.0）
- 📷 **现场照片** —— 前端压缩（≤500KB）+ 25KB 缩略图 + IndexedDB 本地缓存，看过的不走第二次流量
- 🔁 **修改走审批** —— 本周与往期记录一律提交"修改申请"，管理员通过后自动应用并留痕
- 🔔 **公告 / 设置** —— 管理员发公告首页直达，设置页改密、退出登录

**管理端**
- 📊 **总览仪表盘** —— 成员完成情况三态筛选（未查课 / 已完成 / 未选课）、本周工作合并已交与未交、记录照片直接内嵌
- 👥 **成员管理** —— 搜索 + 拼音 A–Z 字母索引跳转、一键重置密码（自动踢会话）
- ✅ **审核中心** —— 记录修改申请 + 课程信息修改申请 + 忘记密码申请，diff 展示、一键通过/拒绝
- 🗑️ **打回 / 彻底删除** —— 打回 = 记录清除、计划回"待填报"可重填；彻底删除 = 连计划一起删，不可恢复
- 📤 **Excel 台账导出** —— 按学院课检模板 24 列逐格对齐，大一/大二/大三三个工作表自动分年级，旷到率、红字标注、淡黄备注底色全部还原
- 📱 **响应式** —— 移动优先设计，宽屏表格 / 窄屏卡片（720px 断点），两端都好用

**数据与安全**
- 🔐 自建账号体系：姓名 + 学号登录，bcrypt 口令，首次登录强制改密，失败 3 次锁 15 分钟
- 🧾 会话只存 token 的 SHA-256 摘要，改密/重置自动踢掉其它会话
- 🛡️ 业务表 RLS 开启且**不建任何策略**——直连数据库一律拒绝，全部读写走 `SECURITY DEFINER` 函数
- 📌 周次由数据库触发器按 `check_date - 学期周一` 回填，前端不算周次，日期越界直接报错
- 🔍 修改留痕不可绕过：留痕表无写策略，只有触发器能写，操作人经 GUC `app.actor_id` 传入
- 🧑‍🏫 辅导员按班级号自动匹配（映射表可导入），导出与详情页自动带出

## 🏗️ 技术架构

```text
┌─────────────────────────────────────────────────┐
│  浏览器（移动优先）                                │
│  Vue 3 全局构建 · 手写 hash 路由 · 原生 CSS        │
│  IndexedDB 照片/记录缓存 · SheetJS 懒加载          │
└──────────────────────┬──────────────────────────┘
                       │ cloud.rpc(p_token, ...)
┌──────────────────────▼──────────────────────────┐
│  PostgreSQL（Supabase 风格云库）                   │
│  42 个 SECURITY DEFINER RPC · 全表 RLS 零策略      │
│  触发器算周次 / 自动留痕 · bcrypt 认证              │
└─────────────────────────────────────────────────┘
```

**为什么无构建？** 部署目标是纯静态托管：改完代码刷新即生效，发布就是上传目录，不存在"本地跑得起来、线上构建失败"的问题。全部第三方库（Vue、SDK、SheetJS）自托管在 `vendor/`，不依赖公网 CDN。

## 🚀 快速开始

### 准备

- 一个支持 PostgreSQL 与 RESTful RPC 的托管数据库（Supabase 或兼容服务）
- 任一静态站点托管（GitHub Pages / Vercel / Netlify / 对象存储均可）

### 1. 建库

```bash
psql "<你的数据库连接串>" -f db/schema.sql
```

`schema.sql` 幂等可重复执行，包含全部表、触发器与 42 个 RPC 函数；`db/migrate-*.sql` 为各次功能增量的独立脚本，仅新部署时无需逐个执行。

### 2. 导入名单与辅导员映射

```bash
# 名单导入模板见 schema.sql 末尾注释（姓名 / 学号 / 职务）
# 辅导员-班级映射示例（替换为你的真实数据，真实名单勿提交仓库）
psql "<连接串>" -f db/migrate-counselor-map.example.sql
```

### 3. 配置并启动

复制配置模板并填入你的服务地址与 publishable key（`config.js` 已被 `.gitignore` 忽略，真实配置不会进入仓库）：

```bash
cp src/config.example.js src/config.js
cp login-website/config.example.js login-website/config.js
```

```js
window.APP_CONFIG = {
  endpoint: 'https://your-project.example.host',
  oauthRelayBaseUrl: 'https://your-oauth-relay',
  publishableKey: 'wbpk_xxx',
}
```

本地预览：

```bash
python -m http.server 8080
# 打开 http://localhost:8080
```

### 4. 跑测试

```bash
node tests/week.test.mjs
```

> 💡 **发布前记得更新 `index.html` 里所有 `?v=` 版本号**——静态资源无 `Cache-Control`，靠版本串破缓存。详细运维经验见 [docs/OPERATIONS.md](docs/OPERATIONS.md)。

## 📁 目录结构

```
index.html                 入口（hash 路由 + 资源版本串）
app.css                    全部样式（移动优先，手写，hm-*/adm-* 命名空间）
src/
  config.example.js        云服务配置模板（复制为 config.js，不入库）
  store.js                 全局状态 / 路由解析 / rpc 封装（带登录凭证）
  app.js                   组件注册 / 底部导航显隐
  lib/
    util.js                日期 / 周次 / 节次 / 出勤 / 拼音排序 / 辅导员匹配
    excel.js               台账导出（xlsx-js-style，按年级分表）
    image.js               图片压缩
    photocache.js          照片 IndexedDB 缓存（LRU 500 张）
    recordcache.js         记录 IndexedDB 缓存（KEEP 300）
  views/
    auth.js                登录 / 忘记密码 / 修改密码
    member.js              组员首页仪表盘 / 选课 / 设置
    fill.js                填报 / 记录详情 / 我的 / 历史记录
    leader.js              管理员总览 / 记录详情
    leader2.js             审核中心 / 成员 / 学期 / 导出
    stats.js               班级查课次数统计
login-website/             独立登录落地页（忘记密码入口）
vendor/                    Vue 3 / 云 SDK / SheetJS（自托管）
db/
  schema.sql               完整建库脚本（幂等）
  migrate-*.sql            功能增量脚本
  migrate-counselor-map.example.sql  辅导员映射示例
docs/
  OPERATIONS.md            运维手册（账号规则 / 名单导入 / 发布经验）
tests/
  week.test.mjs            周次与日期换算单元测试
```

## 🗺️ Roadmap

- [ ] 课程卡片池 + 自助认领（谁先认领谁得，避免同班重复被查）
- [ ] 对接学院课表导入，选课自动带出教室/班级
- [ ] 「课检班级」逐班实到/应到完全对齐真实课检表的复合结构
- [ ] 组号支持（需「姓名→组号」名单）
- [ ] 每周自动备份到网盘

## 🤝 参与贡献

欢迎 Issue 与 PR！提交前请：

1. 保证 `node tests/week.test.mjs` 通过
2. 改动前端后更新 `index.html` 的 `?v=` 版本号
3. **不要提交任何真实姓名、学号、手机号**——名单与映射类数据一律走 `.gitignore` 保护的本地文件

## 📄 开源协议

[MIT](LICENSE) © 2026 class-inspection contributors

## 🙏 致谢

- [Vue.js](https://vuejs.org) —— 渐进式框架，全局构建版让"无构建"成为可能
- [SheetJS](https://sheetjs.com) / [xlsx-js-style](https://github.com/gitbrent/xlsx-js-style) —— 台账导出的样式还原
- [Supabase](https://supabase.com) 的 RLS 与 Postgres 函数设计思想 —— 本项目的安全模型深受启发

---

<div align="center">

**如果这个项目对你有帮助，欢迎点一个 Star ⭐**

</div>
