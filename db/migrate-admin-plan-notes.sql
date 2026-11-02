-- 2026-11-02 管理员查看本周被打回的选课
-- admin_week 的 pending_list 没有 note 字段；本接口只返回「有 note 的计划」的 id + note，
-- 前端拿到后合并进 pending_list，在成员页/课检页显示「打回」徽标。
-- 不改动 admin_week，避免覆盖线上已存在的其他增量字段。
-- 可重复执行。

CREATE OR REPLACE FUNCTION admin_plan_notes(p_token text, p_week smallint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_sem bigint;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION '仅管理员可查看'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  SELECT id INTO v_sem FROM semesters WHERE is_current LIMIT 1;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', p.id, 'note', p.note) ORDER BY p.id)
      FROM check_plans p
     WHERE p.semester_id = v_sem AND p.week_no = p_week
       AND p.note IS NOT NULL AND btrim(p.note) <> ''
  ), '[]'::jsonb);
END $$;

GRANT EXECUTE ON FUNCTION admin_plan_notes(text, smallint) TO anon, authenticated;
