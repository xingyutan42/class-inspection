-- 2026-11-02 彻底删除「发通知」功能对应的数据库对象
-- 背景：前端发通知入口、弹窗、调用已在 20261101z / 20261102b 移除；
--       db/schema.sql 中 notices 表与 notice_list / notice_post 两个函数也已删除。
-- 本脚本用于清理线上库的存量对象。
--
-- 注意：notices 表一旦 DROP，历史通知数据不可恢复。
--      如仍需保留历史内容，请先导出：COPY (SELECT * FROM notices) TO ...;
--
-- 执行方式：整段在 SQL 编辑器运行一次即可，可重复执行（IF EXISTS）。

BEGIN;

-- 1) 先撤授权（对象可能已不存在，逐个 IF EXISTS 判断）
DO $$
BEGIN
  IF to_regclass('public.notices') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE public.notices FROM anon, authenticated';
  END IF;
  IF to_regprocedure('public.notice_list(text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.notice_list(text) FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.notice_list(text) FROM PUBLIC';
  END IF;
  IF to_regprocedure('public.notice_post(text,text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.notice_post(text,text) FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.notice_post(text,text) FROM PUBLIC';
  END IF;
END $$;

-- 2) 删除接口函数
DROP FUNCTION IF EXISTS notice_list(text);
DROP FUNCTION IF EXISTS notice_post(text, text);

-- 3) 删除通知表（CASCADE 兜底清理依赖对象，如 RLS 策略、索引、触发器）
DROP TABLE IF EXISTS notices CASCADE;

COMMIT;

-- 验证（应全部返回 0 行）
--   SELECT * FROM pg_tables WHERE schemaname = 'public' AND tablename = 'notices';
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname IN ('notice_list', 'notice_post');
