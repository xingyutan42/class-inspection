# 学风建设 · 课堂检查统计

学院学风建设课堂检查小组的内部工具。组员周末登记下周要查的课，工作日填查课结果（出勤 + 纪律问题）；管理员看进度、修正、导出 Excel 台账。

- 线上地址：https://your-app.example.host/
- 应用 ID：`<你的应用 ID>`（云数据库与站点发布共用这一个身份，勿更换）

## 一、账号规则

| 项 | 规则 |
|---|---|
| 账号 | 姓名（唯一，重名时加序号，如「张伟01」） |
| 初始密码 | 学号 |
| 首次登录 | 强制修改密码，至少 8 位且必须含字母，不能与学号相同 |
| 忘记密码 | 登录页「忘记密码」填姓名+学号提交申请 → 管理员在「忘记密码审核」通过 → 密码重置为学号 → 登录后再改 |
| 管理员 | 由 `role='admin'` 决定，可审核重置、停用成员、设为管理员 |

账号不是自助注册的，由管理员按名单导入。

## 二、目录结构

```
index.html              入口（hash 路由）
app.css                 全部样式（移动优先，手写）
src/config.js           云服务 publicConfig
src/store.js            全局状态、路由、rpc 封装（带登录凭证）
src/lib/util.js         日期 / 周次 / 节次 / 出勤率 / 提示
src/lib/excel.js        Excel 台账导出（SheetJS 懒加载）
src/views/auth.js       登录 / 忘记密码 / 修改密码
src/views/member.js     组员：本周 / 计划列表 / 计划表单
src/views/fill.js       填报 / 记录详情 / 我的
src/views/leader.js     管理员：总览 / 计划管理 / 记录明细
src/views/leader2.js    管理员：记录修正 / 成员 / 学期 / 导出 / 重置审核
vendor/                 Vue 3、云 SDK、SheetJS（本地自托管）
db/schema.sql           完整建库脚本（v2，自建账号版）
db/schema-v1-legacy.sql 旧版（平台账号版）留档，不再使用
tests/week.test.mjs     周次与日期换算单元测试
```

无构建步骤：改完直接刷新，发布就是上传这个目录。

## 三、认证与权限模型

浏览器**不持有任何平台登录会话**。所有数据访问都走 `cloud.database.rpc()`：

1. `app_login(姓名, 密码)` 校验 bcrypt 口令 → 生成 32 字节随机 token，只把 SHA-256 摘要存进 `app_sessions`，有效期 30 天。
2. 前端把 token 存 localStorage，之后每次调用都把 `p_token` 带上。
3. 每个函数内部用 `require_user(p_token)` 换取当前用户；失效则抛「登录已失效」，前端自动回登录页。
4. 业务表全部开启 RLS 且**不建任何策略、不授权 anon/authenticated**，直连数据库一律拒绝。
5. 所有函数 `SECURITY DEFINER`，只有它们能读写表。

其他保护：登录失败 3 次锁 15 分钟；`must_change` 未解除前，除改密/启动接口外全部拒绝；改密或重置会踢掉该用户其它会话。

## 四、接口清单

| 分类 | 函数 |
|---|---|
| 认证 | `app_login` `app_logout` `app_boot` `app_change_password` `app_forgot_password` |
| 组员 | `my_week` `plan_get` `plan_save` `plan_void` `record_submit` `record_update` `record_get` |
| 管理员 | `admin_week` `admin_records` `admin_record_get` `admin_record_update` `admin_plans` |
| 成员 | `staff_list` `staff_update` |
| 学期 | `semester_list` `semester_save` `semester_set_current` |
| 重置 | `resets_list` `resets_handle` |
| 导出 | `export_data` |

## 五、业务规则

- **周次由数据库算**：触发器按 `check_date - start_monday` 回填 `week_no`，日期越界直接报错，前端不参与。
- **未交不做定时任务**：`status='planned' 且 week_no <= 当前周` 即未交。
- **提交即生效**：插入记录后触发器把对应计划置为 `submitted`。
- **本周内可改**：记录更新要求 `check_date >= 本周一`，跨周自动锁定（数据库层拦截）。
- **留痕不可绕过**：`check_record_revisions` 无策略无授权，只有触发器能写。留痕记录 `editor_id` / `editor_role` / `action`（`member_self_edit` 本人更正、`leader_correct` 管理员修正），操作人由写记录的 RPC 通过 GUC `app.actor_id` 传给触发器。
- **照片本期关闭**：`check_record_photos` 表保留，后续启用无需改表。

## 六、名单导入

按 `db/schema.sql` 末尾的模板逐行执行即可（姓名 / 学号 / 职务）：

```sql
INSERT INTO app_users (name, student_no, title, role, status, password_hash, must_change)
VALUES ('张三', '2026000001', '组长',
        CASE WHEN '组长' LIKE '%组长%' THEN 'admin' ELSE 'member' END,
        'active', crypt('2026000001', gen_salt('bf', 10)), true);
```

重名时把姓名改成「姓名+两位序号」，并在群里告知本人。职务含「组长/部长/负责人」的设为 `admin`。

## 七、重新部署

在 WorkBuddy 里对本目录执行发布即可，链接与域名不变（同一 `applicationId`）。只有改动云服务配置（endpoint / key）时才需要更新 `src/config.js`。

### 每次发布前：更新 index.html 的版本号

静态资源没有 `Cache-Control` 头，浏览器会按 `Last-Modified` 做启发式缓存，可能继续用旧的 `store.js` / 视图文件，表现为「页面按钮点了没反应」「新功能不出现」。

所以**每次改动前端文件后，发布前把 `index.html` 里所有 `?v=` 的值改成一个新字符串**（例如换成发布时的 `20261031b`）：

```
<link rel="stylesheet" href="app.css?v=20261031b">
<script src="src/store.js?v=20261031b"></script>
```

改完再发布。如果用户手机上仍旧是旧版，让他把链接后面临时加个参数强制刷新一次（例如 `...&r=2`），之后就会自动走新版本。

## 八、导出说明

四个工作表：查课明细、周汇总、成员周汇总、未交清单（可选）。导出的数据由 `export_data` 一次性返回，不存在分页截断问题。照片不在表格里（本期无照片功能）。
