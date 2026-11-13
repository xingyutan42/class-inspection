# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式。v20261102 及之前使用日期串版本号（如 `20261102c`），**3.9.0 起改用语义化版本**。

## [3.9.0] - 2026-11-13

### 新增

- **照片转对象存储**：有平台身份（`sdk_uid`）的账号，新照片直接上传到 `shared/<uid>/checks/` 并以路径入库（新增 `photo_add_storage` RPC、`check_record_photos.taken_at` 列）；无身份的旧账号继续走 base64 兜底，两条路并存互不影响
- **Service Worker 离线缓存**：新增 `sw.js`，静态资源按 `xfc-<版本>` 缓存，弱网/断网时页面仍可打开
- **照片存储路由模块**：`src/lib/media.js`，统一决定走对象存储还是 base64

### 变更

- 版本号体系：日期串 → 语义化版本（`3.9.0`），`index.html` 的 `?v=`、`src/config.js` 的 `version`、`sw.js` 的 `CACHE_NAME` 三处同步
- 照片上传失败不再静默：逐张 toast 提示失败原因

### 修复

- 严格判断上传返回值 `{data, error}`，避免静默丢失照片

## [3.8.x] - 2026-11-08 ~ 2026-11-11

- 3.8.2：课程认领环节免旧密码校验
- 3.8.3：网络状态提示条 + 草稿保护完善
- 3.8.5：台账导入与回写的内部执行版本

## [v20261102c] - 2026-11-03

### 新增

- **草稿本机保存**：选课与填报表单中途被打断，内容自动存入本机 IndexedDB（不上云），下次进入一键恢复；保留 7 天、最多 12 份，提交成功立即清除。新增 `src/lib/draft.js`
- **照片水印**：拍摄时间与提交人姓名烧进照片像素（含缩略图），旧照片无法事后替换
- **开发者脚本**：`tests/audit.sh`（上线前语法 + 模板编译 + 事件处理器审计）、`tests/bump.sh`（一键替换 `index.html` 全部 `?v=` 版本号）

### 变更

- `dayTime` 时间格式化改用 `sv-SE` 区域，输出稳定的 `YYYY-MM-DD HH:mm`
- 前端版本串 `20261102by` → `20261102cc`

## [v20261102b] - 2026-11-02

### 新增

- **打回后修改原记录**：被打回不再删除重建——成员在原记录上修改（数据预填、照片保留、文本字段"传了才改"），重交后管理员端亮「重交」。新增 RPC：`record_of_plan` / `record_resubmit`，并调整 `record_return`
- **照片拍摄 / 提交时间**：新增 `photo_times`，只返回时间元数据（零图片流量），成员与管理员详情页均展示
- **测试账号机制**：学号 `TEST` 开头或姓名「测试」开头——提交不受限（可反复提交同计划）、不计入统计、导出 Excel 时自动排除，仅在成员管理中可见
- **演示数据**：新增 `db/demo-data.sql`，全部虚构数据（组长/组员/测试账号、本周与上周记录、打回演示），新部署灌入即可体验

### 修复

- `app_boot` 恢复返回 `counselor_map`（审核功能清理时遗漏，曾导致前端辅导员映射为空、导出与详情只能回退到提交时的旧值）
- `record_submit` / `record_update` 补回 `migrate-drop-early` 误删的 9 个字段（teacher_status / phone_count / sleep_count / phone_10 / sleep_10 / phone_30 / sleep_30 / teacher_score / student_score）
- 台账导出：班级号按学校样表格式输出（`13002609 → 130026||9`），恢复样表注意事项表头

### 变更

- 辅导员带班映射更新（运营数据，不入库：部署方使用自有名单导入）
- 前端版本串 `20261102au` → `20261102by`

## [v20261102] - 2026-11-02

### 新增

- **打回重交闭环**（替代审批制）：打回必附原因，成员端「打回」徽标，重交后管理员端「重交」标记
- 管理员：未填报选课可彻底删除（`plan_delete`）；负责班级标红（`admin_user_classes`）；带备注的打回计划一览（`admin_plan_notes`）；记录当场修正（`admin_record_update`）

### 移除

- 全站审核体系：`password_requests` / `record_edit_requests` 表及忘记密码、记录修改申请相关 RPC 与界面（保留管理员重置成员密码）
- 「早退」统计：`check_records.early_count` 字段与相关函数逻辑
- 「发通知」功能：`notices` 表与 `notice_list` / `notice_post`

### 修复

- 周次触发器等若干存量问题，详见对应 `db/migrate-*.sql` 注释