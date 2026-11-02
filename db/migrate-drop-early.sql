-- 2026-11-02 全站删除「早退」统计（用户确认：连数据库字段一起删）
-- 1) 先替换引用 early_count 的三个函数（record_submit / record_update / admin_record_update），去掉该字段；
-- 2) 再 DROP check_records.early_count，历史早退数据随之删除；
-- 3) 重授 EXECUTE 权限。可重复执行（字段已删时 DROP IF EXISTS 跳过）。

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
      expected_count, actual_count, late_count, absent_count, leave_count,
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
      coalesce((p_payload->>'late_count')::int,0),
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

CREATE OR REPLACE FUNCTION record_update(p_token text, p_id bigint, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; r check_records;
  v_old_classes jsonb; v_other int; v_other_act int;
  v_e jsonb; v_norm jsonb := '[]'::jsonb; v_exp int; v_act int; v_pa int;
  v_sum_exp int := 0; v_sum_act int := 0; v_has_cls boolean;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  PERFORM set_config('app.actor_id', u.id::text, true);

  SELECT coalesce(classes,'[]'::jsonb), coalesce(other_expected,0), coalesce(other_actual,0)
    INTO v_old_classes, v_other, v_other_act
    FROM check_records WHERE id = p_id AND owner_id = u.id;
  v_has_cls := jsonb_array_length(coalesce(v_old_classes,'[]'::jsonb)) > 0;

  IF v_has_cls THEN
    FOR v_e IN SELECT * FROM jsonb_array_elements(v_old_classes) LOOP
      v_exp := greatest(0, coalesce((v_e->>'expected')::int, 0));
      v_pa := NULL;
      SELECT nullif(x->>'actual','')::int INTO v_pa
        FROM jsonb_array_elements(coalesce(p_payload->'classes','[]'::jsonb)) x
       WHERE x->>'code' = v_e->>'code' LIMIT 1;
      v_act := coalesce(v_pa, nullif(v_e->>'actual','')::int, v_exp);
      IF v_act < 0 THEN v_act := 0; END IF;
      IF v_act > v_exp THEN RAISE EXCEPTION '实到人数不能大于应到人数（%）', v_e->>'code'; END IF;
      v_norm := v_norm || jsonb_build_object('code', v_e->>'code', 'expected', v_exp, 'actual', v_act);
      v_sum_exp := v_sum_exp + v_exp;
      v_sum_act := v_sum_act + v_act;
    END LOOP;
    v_other_act := greatest(0, coalesce(nullif(p_payload->>'other_actual','')::int, v_other_act));
    IF v_other_act > v_other THEN RAISE EXCEPTION '其他类实到不能大于应到'; END IF;
    v_sum_exp := v_sum_exp + v_other;
    v_sum_act := v_sum_act + v_other_act;
  END IF;

  UPDATE check_records SET
      course_name = coalesce(nullif(btrim(coalesce(p_payload->>'course_name','')),''), course_name),
      class_name = coalesce(nullif(btrim(coalesce(p_payload->>'class_name','')),''), class_name),
      teacher = nullif(btrim(coalesce(p_payload->>'teacher','')),''),
      room = nullif(btrim(coalesce(p_payload->>'room','')),''),
      classes = CASE WHEN v_has_cls THEN v_norm ELSE classes END,
      other_actual = CASE WHEN v_has_cls THEN v_other_act ELSE other_actual END,
      expected_count = CASE WHEN v_has_cls THEN v_sum_exp ELSE coalesce((p_payload->>'expected_count')::int, expected_count) END,
      actual_count = CASE WHEN v_has_cls THEN v_sum_act ELSE coalesce((p_payload->>'actual_count')::int, actual_count) END,
      late_count = coalesce((p_payload->>'late_count')::int, late_count),
      absent_count = coalesce((p_payload->>'absent_count')::int, absent_count),
      leave_count = coalesce((p_payload->>'leave_count')::int, leave_count),
      absent_students = coalesce(p_payload->'absent_students', absent_students),
      leave_students = coalesce(p_payload->'leave_students', leave_students),
      discipline_tags = ARRAY(SELECT jsonb_array_elements_text(coalesce(p_payload->'discipline_tags','[]'::jsonb))),
      discipline_note = nullif(btrim(coalesce(p_payload->>'discipline_note','')),''),
      remark = nullif(btrim(coalesce(p_payload->>'remark','')),''),
      correction_note = nullif(btrim(coalesce(p_payload->>'correction_note','')),'')
    WHERE id = p_id AND owner_id = u.id AND check_date >= current_week_start()
    RETURNING * INTO r;
  IF r.id IS NULL THEN RAISE EXCEPTION '只能修改本周的记录'; END IF;
  RETURN to_jsonb(r);
END $$;

CREATE OR REPLACE FUNCTION admin_record_update(p_token text, p_id bigint, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; r check_records; v_old jsonb; v_norm jsonb := '[]'::jsonb; v_e jsonb;
  v_other int := 0; v_oa int := 0; v_has boolean;
  v_date0 date; v_pf0 smallint; v_pt0 smallint; v_date date; v_pf smallint; v_pt smallint;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION '仅管理员可修正'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  IF coalesce(btrim(p_payload->>'correction_note'),'') = '' THEN RAISE EXCEPTION '请填写修正原因'; END IF;
  PERFORM set_config('app.actor_id', u.id::text, true);

  SELECT coalesce(classes,'[]'::jsonb), coalesce(other_expected,0), coalesce(other_actual,0),
         check_date, period_from, period_to
    INTO v_old, v_other, v_oa, v_date0, v_pf0, v_pt0
    FROM check_records WHERE id = p_id;
  IF v_date0 IS NULL THEN RAISE EXCEPTION '记录不存在'; END IF;

  v_date := coalesce(nullif(btrim(coalesce(p_payload->>'check_date','')),'')::date, v_date0);
  v_pf := coalesce((p_payload->>'period_from')::smallint, v_pf0);
  v_pt := coalesce((p_payload->>'period_to')::smallint, v_pt0);
  IF v_pf NOT BETWEEN 1 AND 12 OR v_pt NOT BETWEEN 1 AND 12 OR v_pt < v_pf THEN
    RAISE EXCEPTION '节次不正确';
  END IF;

  v_has := coalesce(jsonb_array_length(v_old),0) > 0;
  IF v_has THEN
    FOR v_e IN SELECT * FROM jsonb_array_elements(v_old) LOOP
      v_norm := v_norm || jsonb_build_object('code', v_e->>'code',
        'expected', coalesce((v_e->>'expected')::int,0),
        'actual', least(coalesce((v_e->>'expected')::int,0), greatest(0,
          coalesce((SELECT nullif(x->>'actual','')::int FROM jsonb_array_elements(coalesce(p_payload->'classes','[]'::jsonb)) x WHERE x->>'code'=v_e->>'code' LIMIT 1),
                   nullif(v_e->>'actual','')::int, (v_e->>'expected')::int, 0))));
    END LOOP;
    v_oa := least(v_other, greatest(0, coalesce((p_payload->>'other_actual')::int, v_oa)));
  END IF;

  UPDATE check_records SET
      course_name = CASE WHEN p_payload ? 'course_name' THEN coalesce(nullif(btrim(coalesce(p_payload->>'course_name','')),''), course_name) ELSE course_name END,
      teacher = CASE WHEN p_payload ? 'teacher' THEN nullif(btrim(coalesce(p_payload->>'teacher','')),'') ELSE teacher END,
      room = CASE WHEN p_payload ? 'room' THEN nullif(btrim(coalesce(p_payload->>'room','')),'') ELSE room END,
      check_date = v_date,
      period_from = v_pf,
      period_to = v_pt,
      classes = CASE WHEN v_has THEN v_norm ELSE classes END,
      other_actual = CASE WHEN v_has THEN v_oa ELSE other_actual END,
      expected_count = CASE WHEN v_has THEN (SELECT sum((e->>'expected')::int) FROM jsonb_array_elements(v_norm) e) + v_other ELSE coalesce((p_payload->>'expected_count')::int, expected_count) END,
      actual_count = CASE WHEN v_has THEN (SELECT sum((e->>'actual')::int) FROM jsonb_array_elements(v_norm) e) + v_oa ELSE coalesce((p_payload->>'actual_count')::int, actual_count) END,
      late_count = coalesce((p_payload->>'late_count')::int, late_count),
      absent_count = coalesce((p_payload->>'absent_count')::int, absent_count),
      leave_count = coalesce((p_payload->>'leave_count')::int, leave_count),
      remark = nullif(btrim(coalesce(p_payload->>'remark','')),''),
      discipline_note = nullif(btrim(coalesce(p_payload->>'discipline_note','')),''),
      correction_note = btrim(p_payload->>'correction_note')
    WHERE id = p_id RETURNING * INTO r;
  IF r.id IS NULL THEN RAISE EXCEPTION '记录不存在'; END IF;
  RETURN to_jsonb(r);
END $$;

ALTER TABLE check_records DROP COLUMN IF EXISTS early_count;

GRANT EXECUTE ON FUNCTION record_submit(text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION record_update(text, bigint, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_record_update(text, bigint, jsonb) TO anon, authenticated;
