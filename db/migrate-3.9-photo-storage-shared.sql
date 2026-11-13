-- ============================================================================
-- 迁移：新照片转「对象存储 + 只登记路径」· photo_add_storage 唯一权威定义
-- 日期：2026-11-12 ｜ 线上版本：3.8.5 → 3.9.0
-- ----------------------------------------------------------------------------
-- 【幂等】CREATE OR REPLACE + ADD COLUMN IF NOT EXISTS + GRANT，可重复执行
-- 【执行顺序】仅执行本文件；不要执行任何 3.6 的旧脚本
--   （旧脚本校验 users/<业务 id>/%、上限 3 张、无 SDK 身份校验，均已废弃）
-- 【前提】已存在 require_user()、current_week_start()、check_record_photos 表
-- 【回滚】DROP FUNCTION IF EXISTS public.photo_add_storage(
--           text, bigint, text, text, integer, text, timestamptz);
--         （仅删函数，不影响已写入的 storage_path 数据行；必须先回退前端）
-- ============================================================================

ALTER TABLE public.check_record_photos ADD COLUMN IF NOT EXISTS taken_at timestamptz;

CREATE OR REPLACE FUNCTION public.photo_add_storage(
  p_token        text,
  p_record_id    bigint,
  p_storage_path text,
  p_thumb_path   text DEFAULT '',
  p_bytes        integer DEFAULT 0,
  p_mime         text DEFAULT 'image/jpeg',
  p_taken_at     timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  u        app_users;
  r        check_records;
  v_cnt    int;
  v_path   text;
  v_tpath  text;
  v_mime   text;
  v_id     bigint;
  v_sdk    text;      -- 当前 JWT 的真实 SDK uid；代登录时仍是管理员，前端无法伪造
  v_prefix text;
BEGIN
  -- 首行鉴权。业务 owner 一律取自 require_user(p_token)，与 SDK uid 严格分离。
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;

  -- 沿用 photo_add 的业务规则（记录存在 / owner 或 admin / 只能给本周记录补照片）
  SELECT * INTO r FROM check_records WHERE id = p_record_id;
  IF r.id IS NULL THEN RAISE EXCEPTION '记录不存在'; END IF;
  IF r.owner_id <> u.id AND u.role <> 'admin' THEN RAISE EXCEPTION '无权上传这张记录的照片'; END IF;
  IF r.owner_id = u.id AND u.role <> 'admin' AND r.check_date < current_week_start() THEN
    RAISE EXCEPTION '只能给本周的记录补照片';
  END IF;

  -- 真实 SDK 身份取自 JWT，不取 app_users.sdk_uid（代登录时后者被改写/为空）
  v_sdk := coalesce(nullif(auth.uid()::text, 'anon'), '');
  IF v_sdk = '' OR v_sdk !~ '^[0-9]{10,32}$' THEN
    RAISE EXCEPTION '缺少有效的 SDK 登录态，请使用照片兜底通道';
  END IF;
  v_prefix := 'shared/' || v_sdk || '/checks/';

  -- 原图路径精确前缀 + 注入防护
  v_path := nullif(btrim(coalesce(p_storage_path, '')), '');
  IF v_path IS NULL THEN RAISE EXCEPTION '照片路径不能为空'; END IF;
  IF left(v_path, 1) = '/'
     OR position('..' in v_path) > 0
     OR position('//' in v_path) > 0
     OR position(chr(92) in v_path) > 0
     OR left(v_path, 6) = 'users/'
     OR length(v_path) > 300 THEN
    RAISE EXCEPTION '照片路径不合法';
  END IF;
  IF v_path NOT LIKE v_prefix || '%' THEN
    RAISE EXCEPTION '照片路径必须在 shared/<本人 SDK uid>/checks/ 下';
  END IF;

  -- 缩略图路径：可为空（降级），非空时同样校验
  v_tpath := nullif(btrim(coalesce(p_thumb_path, '')), '');
  IF v_tpath IS NOT NULL THEN
    IF left(v_tpath, 1) = '/' OR position('..' in v_tpath) > 0
       OR position('//' in v_tpath) > 0 OR position(chr(92) in v_tpath) > 0
       OR left(v_tpath, 6) = 'users/' OR length(v_tpath) > 300 THEN
      RAISE EXCEPTION '缩略图路径不合法';
    END IF;
    IF v_tpath NOT LIKE v_prefix || '%' THEN
      RAISE EXCEPTION '缩略图路径必须在 shared/<本人 SDK uid>/checks/ 下';
    END IF;
  END IF;

  v_mime := coalesce(nullif(btrim(p_mime), ''), 'image/jpeg');
  IF v_mime NOT LIKE 'image/%' THEN v_mime := 'image/jpeg'; END IF;

  -- 上限恒为 2 张（与前端 onPick / 现网 photo_add 一致）
  SELECT count(*) INTO v_cnt FROM check_record_photos WHERE record_id = p_record_id;
  IF v_cnt >= 2 THEN RAISE EXCEPTION '每节课最多 2 张照片'; END IF;

  -- 只登记路径：data / thumb 显式置 NULL，库内不再新增 base64
  INSERT INTO check_record_photos (record_id, owner_id, bytes, sort_no, mime,
      storage_path, thumb_path, taken_at, data, thumb)
  VALUES (p_record_id, u.id, greatest(0, coalesce(p_bytes, 0)), v_cnt, v_mime,
      v_path, v_tpath, coalesce(p_taken_at, now()), NULL, NULL)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'sort_no', v_cnt,
    'bytes', greatest(0, coalesce(p_bytes, 0)),
    'storage_path', v_path, 'thumb_path', v_tpath,
    'owner_id', u.id, 'uploader_sdk_uid', v_sdk);
END $function$;

GRANT EXECUTE ON FUNCTION public.photo_add_storage(text, bigint, text, text, integer, text, timestamptz) TO anon, authenticated;
