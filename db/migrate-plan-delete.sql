-- 2026-11-02 管理员：彻底删除未填报的选课（课检页「本周课程」的删除按钮）
-- 与 record_delete_hard 的区别：plan_delete 只处理「还没有查课记录」的选课，
-- 已有记录请走打回（record_delete）或彻底删除记录（record_delete_hard）。

CREATE OR REPLACE FUNCTION plan_delete(p_token text, p_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; p check_plans;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION '仅管理员可删除选课'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  SELECT * INTO p FROM check_plans WHERE id = p_id;
  IF p.id IS NULL THEN RAISE EXCEPTION '选课不存在'; END IF;
  IF p.status = 'submitted' OR EXISTS (SELECT 1 FROM check_records r WHERE r.plan_id = p_id) THEN
    RAISE EXCEPTION '这节课已提交查课记录，请用记录列表的「打回」或「删除」';
  END IF;
  DELETE FROM check_plans WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'course_name', p.course_name, 'owner_name', p.owner_name);
END $$;

GRANT EXECUTE ON FUNCTION plan_delete(text, bigint) TO anon, authenticated;
