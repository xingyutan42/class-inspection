-- 2026-11-01 管理员：真正的删除（连同选课计划一并删除）
-- record_delete 保持原语义（打回：记录删除、计划回到待填报）
CREATE OR REPLACE FUNCTION record_delete_hard(p_token text, p_id bigint)
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
    DELETE FROM check_plans WHERE id = v_plan;
  END IF;
  RETURN jsonb_build_object('ok', true, 'course_name', r.course_name, 'owner_name', r.owner_name, 'plan_deleted', v_plan IS NOT NULL);
END $$;
