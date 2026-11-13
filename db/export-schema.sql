-- ============================================================================
-- 结构导出脚本（只读）—— 用于把线上库的实际结构导出成可入库的 SQL 基线
-- 平台 SQL 编辑器通常一次只执行一条语句，请逐条运行并保存结果。
-- 全部只读，不会修改任何数据。
-- ============================================================================

-- ① 表与列（字段名、类型、默认值、是否可空）
SELECT table_name, ordinal_position, column_name, data_type,
       character_maximum_length, numeric_precision, numeric_scale,
       is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;

-- ② 约束（主键 / 唯一 / 外键 / CHECK）
SELECT conrelid::regclass AS table_name, conname, contype,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
ORDER BY conrelid::regclass::text, conname;

-- ③ 索引
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- ④ 触发器
SELECT event_object_table AS table_name, trigger_name, action_timing,
       event_manipulation, action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;

-- ⑤ 函数签名与属性（是否 SECURITY DEFINER / 参数）
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef AS security_definer,
       p.provolatile,
       pg_get_userbyid(p.proowner) AS owner
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
ORDER BY p.proname;

-- ⑥ 函数完整源码（最大的一块；如需分批，用下面的 WHERE 按名字过滤）
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.prokind = 'f'
ORDER BY p.proname;

-- ⑦ 表级权限（RLS 是否开启及授权情况）
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
       c.relacl::text AS acl
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;
