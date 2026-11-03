# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，版本号沿用前端资源版本串（`index.html` 的 `?v=`）。

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