-- 2026-11-02 删除全站审核功能（用户确认：1-4 全删，保留管理员重置成员密码）
-- 1) 重建不再引用审核表的函数：app_boot / staff_list / my_records；
-- 2) 删除忘记密码申请、记录修改申请相关函数；
-- 3) 删除 password_requests、record_edit_requests 表（历史申请数据一并删除）；
-- 4) 保留 staff_reset_password（管理员在成员管理中重置密码）。
-- 可重复执行。

CREATE OR REPLACE FUNCTION app_boot(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_sem jsonb; v_sem_id bigint; v_cfg jsonb; v_stats jsonb;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  SELECT to_jsonb(s), s.id INTO v_sem, v_sem_id FROM semesters s WHERE s.is_current LIMIT 1;
  SELECT to_jsonb(c) INTO v_cfg FROM app_config c LIMIT 1;
  SELECT jsonb_build_object(
    'week_records', (SELECT count(*) FROM check_records r WHERE r.owner_id = u.id AND r.semester_id = v_sem_id AND r.week_no = current_week_no(v_sem_id)),
    'total_records', (SELECT count(*) FROM check_records r WHERE r.owner_id = u.id),
    'total_plans', (SELECT count(*) FROM check_plans p WHERE p.owner_id = u.id AND p.status <> 'void')
  ) INTO v_stats;
  RETURN jsonb_build_object(
    'me', jsonb_build_object('id', u.id, 'name', u.name, 'student_no', u.student_no,
                             'title', u.title, 'role', u.role, 'must_change', u.must_change,
                             'own_class', u.own_class, 'duty_grade', u.duty_grade, 'duty_classes', u.duty_classes),
    'semester', coalesce(v_sem, 'null'::jsonb),
    'settings', coalesce(v_cfg, '{}'::jsonb),
    'stats', v_stats);
END $$;

CREATE OR REPLACE FUNCTION staff_list(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_out jsonb;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION '仅管理员可查看'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'name', a.name, 'student_no', a.student_no, 'title', a.title,
      'role', a.role, 'status', a.status, 'must_change', a.must_change,
      'last_login_at', a.last_login_at
    ) ORDER BY CASE a.role WHEN 'admin' THEN 0 ELSE 1 END, a.name), '[]'::jsonb) INTO v_out
    FROM app_users a;
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION my_records(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_sem bigint;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  SELECT id INTO v_sem FROM semesters WHERE is_current LIMIT 1;
  IF v_sem IS NULL THEN RAISE EXCEPTION '还没有设置学期'; END IF;

  RETURN coalesce((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.check_date DESC, x.period_from DESC, x.id DESC)
      FROM (
        SELECT r.id, r.course_name, r.class_name, r.check_date, r.week_no,
               r.period_from, r.period_to, r.teacher, r.room, r.arrive_before,
               r.expected_count, r.actual_count, r.absent_count, r.leave_count,
               r.classes, r.other_expected, r.other_actual,
               r.absent_students, r.leave_students,
               r.discipline_tags, r.discipline_note, r.remark, r.teacher_status,
               r.phone_count, r.sleep_count, r.phone_10, r.sleep_10, r.phone_30, r.sleep_30,
               r.is_extra, r.submitted_at, r.corrected_count,
               (r.check_date >= current_week_start()) AS can_edit
          FROM check_records r
         WHERE r.owner_id = u.id AND r.semester_id = v_sem
      ) x), '[]'::jsonb);
END $$;

DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('app_forgot_password','resets_list','resets_handle',
                         'record_edit_request','edit_requests_list','edit_request_handle')
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || f.sig || ' CASCADE';
  END LOOP;
END $$;

DROP TABLE IF EXISTS password_requests CASCADE;
DROP TABLE IF EXISTS record_edit_requests CASCADE;

GRANT EXECUTE ON FUNCTION app_boot(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION staff_list(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION my_records(text) TO anon, authenticated;