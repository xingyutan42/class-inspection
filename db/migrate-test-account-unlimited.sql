-- 2026-11-02 测试账号（学号 TEST 开头 / 姓名以「测试」开头）提交不设限
-- 1) record_submit：跳过计划状态校验，可反复提交同一计划；plan_id 置空避免唯一约束冲突，提交后计划标记为已提交
-- 2) export_data：导出排除测试账号的记录，避免测试数据污染台账

CREATE OR REPLACE FUNCTION record_submit(p_token text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_sem bigint; r check_records; v_plan bigint; v_arrive text;
  v_plan_cls jsonb; v_norm jsonb := '[]'::jsonb; v_e jsonb;
  v_other int := 0; v_other_act int := 0; v_oe int := 0; v_oa int := 0;
  v_is_test boolean := false;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  SELECT id INTO v_sem FROM semesters WHERE is_current LIMIT 1;
  IF v_sem IS NULL THEN RAISE EXCEPTION '还没有设置学期'; END IF;
  v_plan := nullif(p_payload->>'plan_id','')::bigint;
  -- 测试账号：学号 TEST 开头或姓名以「测试」开头
  v_is_test := (u.student_no ILIKE 'TEST%') OR (u.name LIKE '测试%');
  IF v_plan IS NOT NULL THEN
    IF v_is_test THEN
      -- 测试账号不校验计划状态，允许对同一计划反复提交
      SELECT arrive_before INTO v_arrive FROM check_plans WHERE id = v_plan AND owner_id = u.id;
      IF NOT FOUND THEN RAISE EXCEPTION '计划不存在或不属于你'; END IF;
    ELSE
      PERFORM 1 FROM check_plans WHERE id = v_plan AND owner_id = u.id AND status = 'planned';
      IF NOT FOUND THEN RAISE EXCEPTION '这节课已在其他地方提交过了'; END IF;
      SELECT arrive_before INTO v_arrive FROM check_plans WHERE id = v_plan;
    END IF;
  END IF;
  IF v_plan IS NOT NULL AND (p_payload ? 'classes') THEN
    SELECT coalesce(classes,'[]'::jsonb), coalesce(other_expected,0) INTO v_plan_cls, v_other
      FROM check_plans WHERE id=v_plan;
    FOR v_e IN SELECT * FROM jsonb_array_elements(v_plan_cls) LOOP
      v_norm := v_norm || jsonb_build_object('code', v_e->>'code',
        'expected', coalesce((v_e->>'expected')::int,0),
        'actual', least(coalesce((v_e->>'expected')::int,0), greatest(0,
          coalesce((SELECT nullif(x->>'actual','')::int FROM jsonb_array_elements(coalesce(p_payload->'classes','[]'::jsonb)) x WHERE x->>'code'=v_e->>'code' LIMIT 1),
                   (v_e->>'expected')::int, 0))));
    END LOOP;
    v_other_act := least(v_other, greatest(0, coalesce((p_payload->>'other_actual')::int,0)));
  ELSE
    IF v_plan IS NOT NULL THEN
      SELECT coalesce(classes,'[]'::jsonb), coalesce(other_expected,0) INTO v_norm, v_other
        FROM check_plans WHERE id=v_plan;
    END IF;
    v_oe := greatest(0, coalesce((p_payload->>'expected_count')::int,0));
    v_oa := greatest(0, coalesce((p_payload->>'actual_count')::int,0));
  END IF;
  INSERT INTO check_records(plan_id, owner_id, owner_name, semester_id, week_no, check_date,
      period_from, period_to, course_name, class_name, teacher, room, counselor, classes, other_expected, other_actual, arrive_before, is_extra,
      expected_count, actual_count, late_count, absent_count, leave_count,
      absent_students, leave_students, discipline_tags, discipline_note, remark,
      teacher_status, phone_count, sleep_count, phone_10, sleep_10, phone_30, sleep_30, teacher_score, student_score,
      client_uuid)
  VALUES (CASE WHEN v_is_test THEN NULL ELSE v_plan END, u.id, u.name, v_sem, 1,
      (p_payload->>'check_date')::date,
      coalesce((p_payload->>'period_from')::smallint,1), coalesce((p_payload->>'period_to')::smallint,2),
      btrim(p_payload->>'course_name'), btrim(p_payload->>'class_name'),
      btrim(p_payload->>'teacher'), btrim(p_payload->>'room'),
      nullif(btrim(coalesce(p_payload->>'counselor','')),''),
      v_norm, v_other, v_other_act, v_arrive,
      coalesce((p_payload->>'is_extra')::boolean, false),
      CASE WHEN (p_payload ? 'classes') AND v_plan IS NOT NULL THEN coalesce((SELECT sum((e->>'expected')::int) FROM jsonb_array_elements(v_norm) e),0) + v_other ELSE v_oe END,
      CASE WHEN (p_payload ? 'classes') AND v_plan IS NOT NULL THEN coalesce((SELECT sum((e->>'actual')::int) FROM jsonb_array_elements(v_norm) e),0) + v_other_act ELSE v_oa END,
      coalesce((p_payload->>'late_count')::int,0),
      coalesce((p_payload->>'absent_count')::int,0), coalesce((p_payload->>'leave_count')::int,0),
      coalesce(p_payload->'absent_students','[]'::jsonb),
      coalesce(p_payload->'leave_students','[]'::jsonb),
      ARRAY(SELECT jsonb_array_elements_text(coalesce(p_payload->'discipline_tags','[]'::jsonb))),
      nullif(btrim(coalesce(p_payload->>'discipline_note','')),''),
      nullif(btrim(coalesce(p_payload->>'remark','')),''),
      nullif(btrim(coalesce(p_payload->>'teacher_status','')),''),
      coalesce((p_payload->>'phone_count')::int,0), coalesce((p_payload->>'sleep_count')::int,0),
      coalesce((p_payload->>'phone_10')::int,0), coalesce((p_payload->>'sleep_10')::int,0),
      coalesce((p_payload->>'phone_30')::int,0), coalesce((p_payload->>'sleep_30')::int,0),
      least(10, greatest(9, round(coalesce((p_payload->>'teacher_score')::numeric, 9.5), 1))),
      least(10, greatest(9, round(coalesce((p_payload->>'student_score')::numeric, 9.5), 1))),
      coalesce(nullif(p_payload->>'client_uuid','')::uuid, gen_random_uuid()))
  RETURNING * INTO r;
  -- 测试账号记录的 plan_id 为空（不占用计划），这里手动把计划标记为已提交，保持流程表现一致
  IF v_is_test AND v_plan IS NOT NULL THEN
    UPDATE check_plans SET status = 'submitted', updated_at = now() WHERE id = v_plan;
  END IF;
  RETURN to_jsonb(r);
END $$;

-- 导出排除测试账号记录（学号 TEST 开头 / 姓名以「测试」开头）
DO $$
DECLARE src text; before text;
BEGIN
  SELECT prosrc INTO src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'export_data';
  before := src;
  src := replace(src,
    'FROM check_records r WHERE r.semester_id = v_sem AND r.week_no BETWEEN p_from AND p_to AND coalesce(r.returned,false) = false',
    'FROM check_records r WHERE r.semester_id = v_sem AND r.week_no BETWEEN p_from AND p_to AND coalesce(r.returned,false) = false
      AND NOT EXISTS (SELECT 1 FROM app_users tu WHERE tu.id = r.owner_id
                      AND (tu.student_no ILIKE ''TEST%'' OR tu.name LIKE ''测试%''))');
  IF src = before THEN RAISE EXCEPTION 'export_data 未发生替换，已中止'; END IF;
  EXECUTE 'CREATE OR REPLACE FUNCTION export_data(p_token text, p_from smallint, p_to smallint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$' || src || '$f$';
END $$;

-- 3) admin_week：总览统计（计划数/已查数/应到/实到/纪律问题/逾期）排除测试账号
DO $$
DECLARE src text; before text;
BEGIN
  SELECT prosrc INTO src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_week';
  before := src;
  src := replace(src,
    'FROM check_plans WHERE semester_id = v_sem AND week_no = p_week AND status <> ''void''',
    'FROM check_plans WHERE semester_id = v_sem AND week_no = p_week AND status <> ''void'' AND owner_id NOT IN (SELECT id FROM app_users WHERE student_no ILIKE ''TEST%'' OR name LIKE ''测试%'')');
  src := replace(src,
    'FROM check_plans WHERE semester_id = v_sem AND week_no = p_week AND status = ''submitted''',
    'FROM check_plans WHERE semester_id = v_sem AND week_no = p_week AND status = ''submitted'' AND owner_id NOT IN (SELECT id FROM app_users WHERE student_no ILIKE ''TEST%'' OR name LIKE ''测试%'')');
  src := replace(src,
    'FROM check_records WHERE semester_id = v_sem AND week_no = p_week AND coalesce(returned,false) = false',
    'FROM check_records WHERE semester_id = v_sem AND week_no = p_week AND coalesce(returned,false) = false AND owner_id NOT IN (SELECT id FROM app_users WHERE student_no ILIKE ''TEST%'' OR name LIKE ''测试%'')');
  src := replace(src,
    'FROM check_plans WHERE semester_id = v_sem AND status = ''planned'' AND week_no < p_week',
    'FROM check_plans WHERE semester_id = v_sem AND status = ''planned'' AND week_no < p_week AND owner_id NOT IN (SELECT id FROM app_users WHERE student_no ILIKE ''TEST%'' OR name LIKE ''测试%'')');
  IF src = before THEN RAISE EXCEPTION 'admin_week 未发生替换，已中止'; END IF;
  EXECUTE 'CREATE OR REPLACE FUNCTION admin_week(p_token text, p_week smallint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$' || src || '$f$';
END $$;
