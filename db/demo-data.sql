-- 演示数据（Demo Data）· v20261102b
-- ---------------------------------------------------------------------------
-- 用途：全新部署后灌入一批虚构数据，快速体验各页面（含管理员视角）。
-- 前提：已执行 db/schema.sql 及最新 Release「迁移指引」中的增量脚本。
-- 声明：本文件全部数据均为虚构 —— 姓名、学号、班级号、课程均与任何真实
--       人员 / 班级无关；密码一律等于学号（must_change = false，登录即用）。
-- 执行：整段在新的空库 SQL 编辑器里运行一次即可（内置守卫，重复执行不叠加）。
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- 1. 学期（start_monday = 8 周前的周一，当前即第 9 周，共 20 周） ----------
INSERT INTO semesters (name, start_monday, total_weeks, is_current)
SELECT '2026-2027-1（演示）',
       date_trunc('week', now() AT TIME ZONE 'Asia/Shanghai')::date - (8 * 7),
       20, true
WHERE NOT EXISTS (SELECT 1 FROM semesters);

-- ---------- 2. 账号（密码 = 学号） ----------
INSERT INTO app_users (name, student_no, title, role, status, password_hash, must_change, own_class, duty_grade, duty_classes) VALUES
('林组长', '20990001', '组长',   'admin',  'active', crypt('20990001', gen_salt('bf', 10)), false, NULL,          '大三', '26002401、26002402'),
('李明',   '20990002', '组员',   'member', 'active', crypt('20990002', gen_salt('bf', 10)), false, '26002401',     '大三', '26002401'),
('王芳',   '20990003', '组员',   'member', 'active', crypt('20990003', gen_salt('bf', 10)), false, '26002402',     '大三', '26002402'),
('赵磊',   '20990004', '组员',   'member', 'active', crypt('20990004', gen_salt('bf', 10)), false, '26002403',     '大三', '26002403'),
('周敏',   '20990005', '组员',   'member', 'active', crypt('20990005', gen_salt('bf', 10)), false, NULL,          '大二', NULL),
('吴昊',   '20990006', '组员',   'member', 'active', crypt('20990006', gen_salt('bf', 10)), false, NULL,          '大二', '26002401'),
('郑婷',   '20990007', '组员',   'member', 'active', crypt('20990007', gen_salt('bf', 10)), false, '26002402',     '大二', '26002402'),
('孙悦',   '20990008', '组员',   'member', 'active', crypt('20990008', gen_salt('bf', 10)), false, NULL,          '大一', NULL),
('钱进',   '20990009', '组员',   'member', 'active', crypt('20990009', gen_salt('bf', 10)), false, '26002403',     '大一', '26002403'),
('测试甲', 'TEST001',  '测试',   'member', 'active', crypt('TEST001',   gen_salt('bf', 10)), false, NULL,          NULL,  NULL)
ON CONFLICT (student_no) DO NOTHING;

-- ---------- 3. 辅导员映射（虚构） ----------
INSERT INTO counselor_map (class_code, counselors) VALUES
('26002401', '张老师'),
('26002402', '李老师'),
('26002403', '王老师'),
('26002404', '张老师、李老师')
ON CONFLICT (class_code) DO NOTHING;

-- ---------- 4. 应用配置（默认值） ----------
INSERT INTO app_config (id, max_photos, max_photo_kb, allow_backfill, max_planned_weeks)
VALUES (1, 3, 400, true, 4)
ON CONFLICT (id) DO NOTHING;

-- ---------- 5. 选课计划（仅当库中尚无任何计划时灌入） ----------
INSERT INTO check_plans (owner_id, owner_name, semester_id, week_no, check_date,
                         period_from, period_to, course_name, class_name, teacher, room, counselor, status, note)
SELECT
  u.id, u.name,
  s.id, 1,
  monday + d.day_offset,
  p.period_from, p.period_to, p.course_name, p.class_name, p.teacher, p.room, p.counselor, p.status, p.note
FROM (VALUES
  ('20990002', 0, 1, 2, '高等数学',   '26002401', '张老师', '教1-302', '张老师', 'submitted', NULL),
  ('20990003', 0, 3, 4, '大学英语',   '26002402', '李老师', '教2-205', '李老师', 'submitted', NULL),
  ('20990004', 2, 5, 6, '计算机基础', '26002403', '王老师', '实验楼B-3', '王老师', 'submitted', NULL),
  ('20990005', 3, 1, 2, '线性代数',   '26002404', '刘老师', '教1-110', '张老师', 'planned',   NULL),
  ('20990006', 4, 7, 8, '大学物理',   '26002401', '陈老师', '教3-阶梯', '张老师', 'planned',   '课程时间有变，请先确认教室后重交')
) AS p(student_no, day_offset, period_from, period_to, course_name, class_name, teacher, room, counselor, status, note)
JOIN app_users u ON u.student_no = p.student_no
CROSS JOIN semesters s
CROSS JOIN LATERAL (SELECT date_trunc('week', now() AT TIME ZONE 'Asia/Shanghai')::date AS monday) d
WHERE s.is_current
  AND NOT EXISTS (SELECT 1 FROM check_plans);

-- ---------- 6. 查课记录（仅当库中尚无任何记录时灌入） ----------
-- 注意：应到 = 实到 + 旷课 + 请假（迟到不计入守恒）；week_no 由触发器按日期回填。
INSERT INTO check_records (plan_id, owner_id, owner_name, semester_id, week_no, check_date,
                           period_from, period_to, course_name, class_name, teacher, room, counselor,
                           expected_count, actual_count, late_count, absent_count, leave_count,
                           discipline_tags, discipline_note, remark, submitted_at)
SELECT
  pl.id, u.id, u.name,
  s.id, 1,
  d.monday + r.day_offset,
  r.period_from, r.period_to, r.course_name, r.class_name, r.teacher, r.room, r.counselor,
  r.expected, r.actual, r.late, r.absent, r.leave,
  r.tags, r.dnote, r.remark,
  (d.monday + r.day_offset)::timestamp + time '16:30'
FROM (VALUES
  ('PLAN_20990002_HS', '20990002', 0,  1, 2, '高等数学',   '26002401', '张老师', '教1-302',   '张老师', 40, 38, 1, 1, 1, '{玩手机}',              '后排一名同学玩手机',      '整体良好'),
  ('PLAN_20990003_DY', '20990003', 0,  3, 4, '大学英语',   '26002402', '李老师', '教2-205',   '李老师', 35, 35, 0, 0, 0, '{}',                     NULL,                      '课堂秩序良好'),
  ('PLAN_20990004_JSJ','20990004', 2,  5, 6, '计算机基础', '26002403', '王老师', '实验楼B-3', '王老师', 42, 40, 0, 2, 0, '{睡觉}',                 '靠窗一名同学睡觉',        '已口头提醒'),
  ('EXTRA_LAST_WEEK',  '20990002', -7, 1, 2, '高等数学',   '26002401', '张老师', '教1-302',   '张老师', 40, 40, 0, 0, 0, '{}',                     NULL,                      '上周补查（无计划）')
) AS r(plan_key, student_no, day_offset, period_from, period_to, course_name, class_name, teacher, room, counselor, expected, actual, late, absent, leave, tags, dnote, remark)
JOIN app_users u ON u.student_no = r.student_no
CROSS JOIN semesters s
CROSS JOIN LATERAL (SELECT date_trunc('week', now() AT TIME ZONE 'Asia/Shanghai')::date AS monday) d
LEFT JOIN check_plans pl ON pl.owner_id = u.id
  AND pl.course_name = r.course_name AND pl.class_name = r.class_name
  AND r.plan_key <> 'EXTRA_LAST_WEEK'
WHERE s.is_current
  AND NOT EXISTS (SELECT 1 FROM check_records);

-- ---------- 7. 验证 ----------
SELECT '账号一览' AS info;
SELECT name, student_no, role FROM app_users ORDER BY id;
SELECT count(*) AS 计划数 FROM check_plans;
SELECT count(*) AS 记录数 FROM check_records;