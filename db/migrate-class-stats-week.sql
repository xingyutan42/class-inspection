-- 2026-11-01 班级查课次数（按周）：
--   在 class_stats 的基础上支持按周区间统计，并返回：
--   - 每个班级的年级标签（大三/大二/大一；代码无法判断时回退到成员负责年级）
--   - 去重后的总班级数 total_classes 与已覆盖班级数 covered_classes
-- 成员看自己，管理员看全部成员。执行方式：在 WorkBuddy 云数据库执行本文件。

CREATE OR REPLACE FUNCTION class_stats_week(
  p_token text, p_user_id bigint,
  p_week_from smallint DEFAULT NULL, p_week_to smallint DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_sem bigint; v_sem_name text; v_total_weeks smallint;
  v_now smallint; v_from smallint; v_to smallint; v_tmp smallint;
  v_rows jsonb := '[]'::jsonb; a app_users;
  v_code text; v_grade text; v_cnt int; v_last date; v_classes jsonb;
  v_total int; v_covered int; v_assigned text; v_records int;
  v_all jsonb := '[]'::jsonb; v_cov jsonb := '[]'::jsonb;
  v_total_classes int; v_covered_classes int;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;

  SELECT id, name, total_weeks INTO v_sem, v_sem_name, v_total_weeks
    FROM semesters WHERE is_current LIMIT 1;
  IF v_sem IS NULL THEN RAISE EXCEPTION '还没有设置学期'; END IF;

  v_now := current_week_no(v_sem);
  IF v_now < 1 THEN v_now := 1; END IF;
  IF v_now > v_total_weeks THEN v_now := v_total_weeks; END IF;
  v_from := coalesce(p_week_from, 1::smallint);
  v_to := coalesce(p_week_to, v_now);
  IF v_from < 1 THEN v_from := 1; END IF;
  IF v_from > v_total_weeks THEN v_from := v_total_weeks; END IF;
  IF v_to < 1 THEN v_to := 1; END IF;
  IF v_to > v_total_weeks THEN v_to := v_total_weeks; END IF;
  IF v_from > v_to THEN v_tmp := v_from; v_from := v_to; v_to := v_tmp; END IF;

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
         AND r.week_no BETWEEN v_from AND v_to
         AND (
           EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(r.classes, '[]'::jsonb)) e
                    WHERE e->>'code' = v_code)
           OR (
             jsonb_array_length(coalesce(r.classes, '[]'::jsonb)) = 0
             AND position(v_code in coalesce(r.class_name, '')) > 0
           )
         );

      v_grade := CASE
        WHEN a.duty_grade = '大三' THEN '大三'
        WHEN substr(v_code, 5, 2) = '24' THEN '大三'
        WHEN substr(v_code, 5, 2) = '25' THEN '大二'
        WHEN substr(v_code, 5, 2) = '26' THEN '大一'
        WHEN a.duty_grade IN ('大一', '大二', '大三') THEN a.duty_grade
        ELSE NULL
      END;

      v_total := v_total + v_cnt;
      IF v_cnt > 0 THEN v_covered := v_covered + 1; END IF;
      v_classes := v_classes || jsonb_build_object(
        'code', v_code, 'grade', v_grade, 'count', v_cnt, 'last_date', v_last);
      v_all := v_all || to_jsonb(v_code);
      IF v_cnt > 0 THEN v_cov := v_cov || to_jsonb(v_code); END IF;
    END LOOP;

    SELECT count(*) INTO v_records FROM check_records r
     WHERE r.owner_id = a.id AND r.semester_id = v_sem
       AND r.week_no BETWEEN v_from AND v_to;

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

  SELECT count(DISTINCT value) INTO v_total_classes FROM jsonb_array_elements_text(v_all);
  SELECT count(DISTINCT value) INTO v_covered_classes FROM jsonb_array_elements_text(v_cov);

  RETURN jsonb_build_object(
    'is_admin', (u.role = 'admin'),
    'semester', jsonb_build_object('id', v_sem, 'name', v_sem_name),
    'week_from', v_from,
    'week_to', v_to,
    'total_weeks', v_total_weeks,
    'total_classes', v_total_classes,
    'covered_classes', v_covered_classes,
    'members', v_rows
  );
END $$;

REVOKE EXECUTE ON FUNCTION class_stats_week(text, bigint, smallint, smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION class_stats_week(text, bigint, smallint, smallint) TO anon, authenticated;
