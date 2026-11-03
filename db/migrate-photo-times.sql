-- 2026-11-02 记录照片时间：只返回时间元数据（不含图片数据），成员/管理员详情页展示「拍摄 / 提交」时间
-- 说明：photo_list 会带 data（base64 图片），成员端为避免流量不调用；
-- 本接口只返回 count / 最早拍摄时间 / 最早上传时间，代价很小，两端都可调用。
-- 可重复执行。

CREATE OR REPLACE FUNCTION photo_times(p_token text, p_record_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; r check_records; v_taken timestamptz; v_created timestamptz; v_cnt int;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  SELECT * INTO r FROM check_records WHERE id = p_record_id;
  IF r.id IS NULL THEN RAISE EXCEPTION '记录不存在'; END IF;
  IF r.owner_id <> u.id AND u.role <> 'admin' THEN RAISE EXCEPTION '无权查看'; END IF;
  SELECT count(*), min(p.taken_at), min(p.created_at)
    INTO v_cnt, v_taken, v_created
    FROM check_record_photos p WHERE p.record_id = p_record_id;
  RETURN jsonb_build_object(
    'count', coalesce(v_cnt, 0),
    'taken_at', v_taken,
    'created_at', v_created
  );
END $$;

GRANT EXECUTE ON FUNCTION photo_times(text, bigint) TO anon, authenticated;
