-- 2026-11-02 记录被打回后，给成员留一条「打回」提示
-- record_delete（管理员打回记录）会把选课计划退回 planned，但不写 note，
-- 成员首页的待查清单和「我的选课」就分不清是没查过还是被打回。
-- 本脚本在退回计划时写入 note，成员端即可显示「打回」徽标与原因；
-- 同时补填提交时清空 note，避免「已查课」的课程还挂着打回原因。
-- 可重复执行（CREATE OR REPLACE）。

CREATE OR REPLACE FUNCTION record_delete(p_token text, p_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; r check_records; v_plan bigint;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION '仅管理员可删除记录'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  SELECT * INTO r FROM check_records WHERE id = p_id;
  IF r.id IS NULL THEN RAISE EXCEPTION '记录不存在'; END IF;
  v_plan := r.plan_id;
  DELETE FROM check_record_photos WHERE record_id = p_id;
  DELETE FROM check_record_revisions WHERE record_id = p_id;
  DELETE FROM check_records WHERE id = p_id;
  IF v_plan IS NOT NULL THEN
    UPDATE check_plans
       SET status = 'planned',
           note = '管理员打回记录，请重新填报',
           updated_at = now()
     WHERE id = v_plan AND status = 'submitted';
  END IF;
  RETURN jsonb_build_object('ok', true, 'course_name', r.course_name, 'owner_name', r.owner_name, 'plan_id', v_plan);
END $$;

-- 补填提交后清空打回原因（触发器在插入 check_records 时执行）
CREATE OR REPLACE FUNCTION mark_plan_submitted() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.plan_id IS NOT NULL THEN
    UPDATE check_plans SET status = 'submitted', note = NULL, updated_at = now()
     WHERE id = NEW.plan_id AND status = 'planned';
  END IF;
  RETURN NULL;
END $$;

