-- 2026-11-01 班级查课次数：
--   按成员「负责班级」（无则用「我的班级」）与本人提交的查课记录逐班匹配，
--   统计每个分配班级被该成员查过的次数、最近一次日期与覆盖情况。
-- 成员看自己，管理员看全部成员。执行方式：在 WorkBuddy 云数据库执行本文件。

CREATE OR REPLACE FUNCTION class_stats(p_token text, p_user_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_sem bigint; v_sem_name text; v_rows jsonb := '[]'::jsonb;
  a app_users; v_code text; v_cnt int; v_last date; v_classes jsonb;
  v_total int; v_covered int; v_assigned text; v_records int;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;

  SELECT id, name INTO v_sem, v_sem_name FROM semesters WHERE is_current LIMIT 1;
  IF v_sem IS NULL THEN RAISE EXCEPTION '还没有设置学期'; END IF;

  FOR a IN
    SELECT * FROM app_users x
     WHERE (u.role = 'admin' AND x.role <> 'admin' AND x.status = 'active'
            AND (p_user_id IS NULL OR x.id = p_user_id))
        OR (u.role <> 'admin' AND x.id = u.id)
     ORDER BY x.name
  LOOP
    v_assigned := coalesce(nullif(btrim(coalesce(a.duty_classes, '')), ''), a.own_class, '');
    v_classes := '[]'::jsonb;
    v_total := 0;
    v_covered := 0;

    FOR v_code IN
      SELECT DISTINCT btrim(t) FROM regexp_split_to_table(v_assigned, '[、,，/ ]+') t
       WHERE btrim(t) <> ''
    LOOP
      SELECT count(*), max(r.check_date) INTO v_cnt, v_last
        FROM check_records r
       WHERE r.owner_id = a.id AND r.semester_id = v_sem
         AND (
           EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(r.classes, '[]'::jsonb)) e
                    WHERE e->>'code' = v_code)
           OR (
             jsonb_array_length(coalesce(r.classes, '[]'::jsonb)) = 0
             AND position(v_code in coalesce(r.class_name, '')) > 0
           )
         );
      v_total := v_total + v_cnt;
      IF v_cnt > 0 THEN v_covered := v_covered + 1; END IF;
      v_classes := v_classes || jsonb_build_object('code', v_code, 'count', v_cnt, 'last_date', v_last);
    END LOOP;

    SELECT count(*) INTO v_records FROM check_records r
     WHERE r.owner_id = a.id AND r.semester_id = v_sem;

    v_rows := v_rows || jsonb_build_object(
      'id', a.id,
      'name', a.name,
      'student_no', a.student_no,
      'duty_grade', a.duty_grade,
      'own_class', a.own_class,
      'duty_classes', a.duty_classes,
      'assigned_text', v_assigned,
      'classes', v_classes,
      'total', v_total,
      'covered', v_covered,
      'records', v_records
    );
  END LOOP;

  RETURN jsonb_build_object(
    'is_admin', (u.role = 'admin'),
    'semester', jsonb_build_object('id', v_sem, 'name', v_sem_name),
    'members', v_rows
  );
END $$;

REVOKE EXECUTE ON FUNCTION class_stats(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION class_stats(text, bigint) TO anon, authenticated;
