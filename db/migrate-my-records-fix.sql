-- 2026-11-01 修复 my_records：原实现 jsonb_agg(x ORDER BY x.check_date) 中 x 是 jsonb 对象别名，
-- Postgres 把 x.check_date 解析为表 x 的列 → "missing FROM-clause entry for table x"。
-- 改为子查询选真实列（别名 x）再 to_jsonb(x)，ORDER BY 走真实列。
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
               (r.check_date >= current_week_start()) AS can_edit,
               EXISTS (SELECT 1 FROM record_edit_requests q
                        WHERE q.record_id = r.id AND q.status = 'pending') AS pending_request
          FROM check_records r
         WHERE r.owner_id = u.id AND r.semester_id = v_sem
      ) x), '[]'::jsonb);
END $$;
