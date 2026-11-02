-- 2026-11-02 成员重新提交后，管理员可见「重交」
-- 1) 选课计划增加 resubmitted_at：被打回（note 非空）后再次提交时记录时间；
-- 2) mark_plan_submitted 提交时清空 note，并在「原本有 note」的情况下写入 resubmitted_at；
-- 3) 新增 admin_week_resubmits：按周返回已重新提交的计划（plan_id + 时间），
--    前端按 record.plan_id 合并，在管理员课检/成员页标记「重交」。
-- 不改动 admin_week。可重复执行。

ALTER TABLE check_plans ADD COLUMN IF NOT EXISTS resubmitted_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION mark_plan_submitted() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.plan_id IS NOT NULL THEN
    UPDATE check_plans
       SET resubmitted_at = CASE
             WHEN note IS NOT NULL AND btrim(note) <> '' THEN now()
             ELSE resubmitted_at
           END,
           status = 'submitted',
           note = NULL,
           updated_at = now()
     WHERE id = NEW.plan_id AND status = 'planned';
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION admin_week_resubmits(p_token text, p_week smallint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_sem bigint;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION '仅管理员可查看'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  SELECT id INTO v_sem FROM semesters WHERE is_current LIMIT 1;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'plan_id', p.id,
      'owner_id', p.owner_id,
      'resubmitted_at', p.resubmitted_at
    ) ORDER BY p.id)
      FROM check_plans p
     WHERE p.semester_id = v_sem AND p.week_no = p_week
       AND p.status = 'submitted' AND p.resubmitted_at IS NOT NULL
  ), '[]'::jsonb);
END $$;

REVOKE EXECUTE ON FUNCTION admin_week_resubmits(text, smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_week_resubmits(text, smallint) TO anon, authenticated;
