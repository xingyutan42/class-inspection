-- 2026-10-31 预计到岗时间（第一节课前 / 第二节课前）
-- check_plans.arrive_before 选课时填写；check_records 提交时快照

ALTER TABLE check_plans   ADD COLUMN IF NOT EXISTS arrive_before TEXT;
ALTER TABLE check_records ADD COLUMN IF NOT EXISTS arrive_before TEXT;

CREATE OR REPLACE FUNCTION plan_save(p_token text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_id bigint; v_sem bigint; r check_plans;
  v_classes jsonb; v_other int; v_sum text; v_arrive text;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;

  IF coalesce(btrim(p_payload->>'course_name'),'') = '' THEN RAISE EXCEPTION '请填写课程名称'; END IF;
  IF coalesce(btrim(p_payload->>'teacher'),'') = '' THEN RAISE EXCEPTION '请填写任课老师'; END IF;
  IF coalesce(btrim(p_payload->>'room'),'') = '' THEN RAISE EXCEPTION '请填写教室'; END IF;
  IF coalesce(btrim(p_payload->>'counselor'),'') = '' THEN RAISE EXCEPTION '请填写辅导员'; END IF;

  v_arrive := nullif(btrim(coalesce(p_payload->>'arrive_before','')),'');
  IF v_arrive IS NULL OR v_arrive NOT IN ('p1','p2') THEN RAISE EXCEPTION '请选择预计到岗时间'; END IF;

  v_classes := coalesce(p_payload->'classes', '[]'::jsonb);
  IF jsonb_array_length(v_classes) = 0 THEN RAISE EXCEPTION '请填写被查班级'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_classes) e
              WHERE coalesce(e->>'code','') !~ '^[0-9]{8}$') THEN
    RAISE EXCEPTION '班级号必须是 8 位数字';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_classes) e
              WHERE coalesce(e->>'expected','') = '') THEN
    RAISE EXCEPTION '请填写每个班的应到人数';
  END IF;
  v_other := coalesce((p_payload->>'other_expected')::int, 0);
  IF v_other < 0 THEN RAISE EXCEPTION '其他类人数不能为负'; END IF;

  SELECT string_agg(e->>'code', '、') INTO v_sum FROM jsonb_array_elements(v_classes) e;
  IF v_other > 0 THEN v_sum := v_sum || ' + 其他'; END IF;

  IF coalesce(p_payload->>'check_date','') = '' THEN RAISE EXCEPTION '请选择查课日期'; END IF;
  SELECT id INTO v_sem FROM semesters WHERE is_current LIMIT 1;
  IF v_sem IS NULL THEN RAISE EXCEPTION '还没有设置学期'; END IF;

  v_id := nullif(p_payload->>'id','')::bigint;
  IF v_id IS NULL THEN
    INSERT INTO check_plans(owner_id, owner_name, semester_id, week_no, check_date, period_from, period_to,
        course_name, class_name, teacher, room, counselor, classes, other_expected, arrive_before, note, status)
    VALUES (u.id, u.name, v_sem, 1, (p_payload->>'check_date')::date,
        coalesce((p_payload->>'period_from')::smallint,1), coalesce((p_payload->>'period_to')::smallint,2),
        btrim(p_payload->>'course_name'), v_sum,
        btrim(p_payload->>'teacher'), btrim(p_payload->>'room'), btrim(p_payload->>'counselor'),
        v_classes, v_other, v_arrive,
        nullif(btrim(coalesce(p_payload->>'note','')),''), 'planned')
    RETURNING * INTO r;
  ELSE
    UPDATE check_plans SET check_date = (p_payload->>'check_date')::date,
        period_from = coalesce((p_payload->>'period_from')::smallint,1),
        period_to = coalesce((p_payload->>'period_to')::smallint,2),
        course_name = btrim(p_payload->>'course_name'), class_name = v_sum,
        teacher = btrim(p_payload->>'teacher'), room = btrim(p_payload->>'room'),
        counselor = btrim(p_payload->>'counselor'),
        classes = v_classes, other_expected = v_other, arrive_before = v_arrive,
        note = nullif(btrim(coalesce(p_payload->>'note','')),''),
        owner_name = u.name
      WHERE id = v_id AND owner_id = u.id AND status = 'planned'
      RETURNING * INTO r;
    IF r.id IS NULL THEN RAISE EXCEPTION '这节课已填报或不属于你，无法修改'; END IF;
  END IF;
  RETURN to_jsonb(r);
END $$;

CREATE OR REPLACE FUNCTION record_submit(p_token text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_sem bigint; r check_records; v_plan bigint; v_arrive text;
  v_plan_cls jsonb; v_norm jsonb := '[]'::jsonb; v_e jsonb;
  v_other int := 0; v_other_act int := 0; v_oe int := 0; v_oa int := 0;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  SELECT id INTO v_sem FROM semesters WHERE is_current LIMIT 1;
  IF v_sem IS NULL THEN RAISE EXCEPTION '还没有设置学期'; END IF;
  v_plan := nullif(p_payload->>'plan_id','')::bigint;
  IF v_plan IS NOT NULL THEN
    PERFORM 1 FROM check_plans WHERE id=v_plan AND owner_id=u.id AND status='planned';
    IF NOT FOUND THEN RAISE EXCEPTION '这节课已在其他地方提交过了'; END IF;
    SELECT arrive_before INTO v_arrive FROM check_plans WHERE id=v_plan;
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
      expected_count, actual_count, late_count, early_count, absent_count, leave_count,
      absent_students, leave_students, discipline_tags, discipline_note, remark, client_uuid)
  VALUES (v_plan, u.id, u.name, v_sem, 1,
      (p_payload->>'check_date')::date,
      coalesce((p_payload->>'period_from')::smallint,1), coalesce((p_payload->>'period_to')::smallint,2),
      btrim(p_payload->>'course_name'), btrim(p_payload->>'class_name'),
      btrim(p_payload->>'teacher'), btrim(p_payload->>'room'),
      nullif(btrim(coalesce(p_payload->>'counselor','')),''),
      v_norm, v_other, v_other_act, v_arrive,
      coalesce((p_payload->>'is_extra')::boolean, false),
      CASE WHEN (p_payload ? 'classes') AND v_plan IS NOT NULL THEN coalesce((SELECT sum((e->>'expected')::int) FROM jsonb_array_elements(v_norm) e),0) + v_other ELSE v_oe END,
      CASE WHEN (p_payload ? 'classes') AND v_plan IS NOT NULL THEN coalesce((SELECT sum((e->>'actual')::int) FROM jsonb_array_elements(v_norm) e),0) + v_other_act ELSE v_oa END,
      coalesce((p_payload->>'late_count')::int,0), coalesce((p_payload->>'early_count')::int,0),
      coalesce((p_payload->>'absent_count')::int,0), coalesce((p_payload->>'leave_count')::int,0),
      coalesce(p_payload->'absent_students','[]'::jsonb),
      coalesce(p_payload->'leave_students','[]'::jsonb),
      ARRAY(SELECT jsonb_array_elements_text(coalesce(p_payload->'discipline_tags','[]'::jsonb))),
      nullif(btrim(coalesce(p_payload->>'discipline_note','')),''),
      nullif(btrim(coalesce(p_payload->>'remark','')),''),
      coalesce(nullif(p_payload->>'client_uuid','')::uuid, gen_random_uuid()))
  RETURNING * INTO r;
  RETURN to_jsonb(r);
END $$;

CREATE OR REPLACE FUNCTION my_history(p_token text, p_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_sem bigint; v_week smallint; v_total bigint; v_rows jsonb; v_limit int;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  v_limit := least(greatest(coalesce(p_limit, 60), 1), 500);
  SELECT id INTO v_sem FROM semesters WHERE is_current LIMIT 1;
  v_week := current_week_no(v_sem);

  SELECT count(*) INTO v_total FROM check_records r
   WHERE r.owner_id = u.id AND r.semester_id = v_sem AND r.week_no = v_week;

  SELECT coalesce(jsonb_agg(x ORDER BY x.check_date DESC, x.period_from DESC, x.id DESC), '[]'::jsonb)
    INTO v_rows FROM (
      SELECT r.id, r.course_name, r.class_name, r.check_date, r.week_no,
             r.period_from, r.period_to, r.room, r.teacher, r.arrive_before,
             r.expected_count, r.actual_count, r.absent_count, r.leave_count,
             r.phone_count, r.sleep_count, r.is_extra, r.corrected_count,
             r.discipline_tags, r.submitted_at
        FROM check_records r
       WHERE r.owner_id = u.id AND r.semester_id = v_sem AND r.week_no = v_week
       ORDER BY r.check_date DESC, r.period_from DESC, r.id DESC
       LIMIT v_limit
    ) x;

  RETURN jsonb_build_object('total', v_total, 'week', v_week, 'rows', v_rows);
END $$;
