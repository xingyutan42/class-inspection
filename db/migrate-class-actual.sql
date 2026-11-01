-- 2026-10-31 逐班实到（对齐课检模板「课检班级」列的 实到/应到）
-- 1) check_records.classes 由 [{code,expected}] 升级为 [{code,expected,actual}]
-- 2) 新增 other_actual（"其他"类的实到人数）
-- 3) record_submit / record_update 以班级明细为准，自动汇总总应到、总实到

ALTER TABLE check_records ADD COLUMN IF NOT EXISTS other_actual INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION record_submit(p_token text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_sem bigint; r check_records; v_plan bigint;
  v_classes jsonb := '[]'::jsonb; v_other int := 0; v_other_act int := 0;
  v_norm jsonb := '[]'::jsonb; v_e jsonb; v_plan_classes jsonb;
  v_exp int; v_act int; v_pa int; v_sum_exp int := 0; v_sum_act int := 0;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  SELECT id INTO v_sem FROM semesters WHERE is_current LIMIT 1;
  IF v_sem IS NULL THEN RAISE EXCEPTION '还没有设置学期'; END IF;

  v_plan := nullif(p_payload->>'plan_id','')::bigint;
  IF v_plan IS NOT NULL THEN
    PERFORM 1 FROM check_plans WHERE id = v_plan AND owner_id = u.id AND status = 'planned';
    IF NOT FOUND THEN RAISE EXCEPTION '这节课已在其他地方提交过了'; END IF;
    SELECT coalesce(classes,'[]'::jsonb), coalesce(other_expected,0)
      INTO v_plan_classes, v_other FROM check_plans WHERE id = v_plan;

    -- 以选课时的班级为骨架，逐班取前端填的实到；缺省视为全到
    FOR v_e IN SELECT * FROM jsonb_array_elements(v_plan_classes) LOOP
      v_exp := greatest(0, coalesce((v_e->>'expected')::int, 0));
      v_pa := NULL;
      SELECT nullif(x->>'actual','')::int INTO v_pa
        FROM jsonb_array_elements(coalesce(p_payload->'classes','[]'::jsonb)) x
       WHERE x->>'code' = v_e->>'code' LIMIT 1;
      v_act := coalesce(v_pa, v_exp);
      IF v_act < 0 THEN v_act := 0; END IF;
      IF v_act > v_exp THEN RAISE EXCEPTION '实到人数不能大于应到人数（%）', v_e->>'code'; END IF;
      v_norm := v_norm || jsonb_build_object('code', v_e->>'code', 'expected', v_exp, 'actual', v_act);
      v_sum_exp := v_sum_exp + v_exp;
      v_sum_act := v_sum_act + v_act;
    END LOOP;

    v_other_act := greatest(0, coalesce(nullif(p_payload->>'other_actual','')::int, 0));
    IF v_other_act > v_other THEN RAISE EXCEPTION '其他类实到不能大于应到'; END IF;
    v_classes := v_norm;
    v_sum_exp := v_sum_exp + v_other;
    v_sum_act := v_sum_act + v_other_act;
  ELSE
    v_sum_exp := greatest(0, coalesce((p_payload->>'expected_count')::int, 0));
    v_sum_act := greatest(0, coalesce((p_payload->>'actual_count')::int, 0));
  END IF;

  INSERT INTO check_records(plan_id, owner_id, owner_name, semester_id, week_no, check_date,
      period_from, period_to, course_name, class_name, teacher, room, counselor, classes, other_expected, other_actual, is_extra,
      expected_count, actual_count, late_count, early_count, absent_count, leave_count,
      absent_students, leave_students,
      discipline_tags, discipline_note, remark, client_uuid)
  VALUES (v_plan, u.id, u.name, v_sem, 1,
      (p_payload->>'check_date')::date,
      coalesce((p_payload->>'period_from')::smallint,1), coalesce((p_payload->>'period_to')::smallint,2),
      btrim(p_payload->>'course_name'), btrim(p_payload->>'class_name'),
      btrim(p_payload->>'teacher'), btrim(p_payload->>'room'),
      nullif(btrim(coalesce(p_payload->>'counselor','')),''),
      v_classes, v_other, v_other_act,
      coalesce((p_payload->>'is_extra')::boolean, false),
      v_sum_exp, v_sum_act,
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
      early_count = coalesce((p_payload->>'early_count')::int, early_count),
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

-- 管理员修正：同样以班级明细为准，自动汇总
CREATE OR REPLACE FUNCTION admin_record_update(p_token text, p_id bigint, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; r check_records; v_old jsonb; v_norm jsonb := '[]'::jsonb; v_e jsonb;
  v_other int := 0; v_oa int := 0; v_has boolean;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION '仅管理员可修正'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  IF coalesce(btrim(p_payload->>'correction_note'),'') = '' THEN RAISE EXCEPTION '请填写修正原因'; END IF;
  PERFORM set_config('app.actor_id', u.id::text, true);
  SELECT coalesce(classes,'[]'::jsonb), coalesce(other_expected,0), coalesce(other_actual,0)
    INTO v_old, v_other, v_oa FROM check_records WHERE id=p_id;
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
      classes = CASE WHEN v_has THEN v_norm ELSE classes END,
      other_actual = CASE WHEN v_has THEN v_oa ELSE other_actual END,
      expected_count = CASE WHEN v_has THEN (SELECT sum((e->>'expected')::int) FROM jsonb_array_elements(v_norm) e) + v_other ELSE coalesce((p_payload->>'expected_count')::int, expected_count) END,
      actual_count = CASE WHEN v_has THEN (SELECT sum((e->>'actual')::int) FROM jsonb_array_elements(v_norm) e) + v_oa ELSE coalesce((p_payload->>'actual_count')::int, actual_count) END,
      late_count = coalesce((p_payload->>'late_count')::int, late_count),
      early_count = coalesce((p_payload->>'early_count')::int, early_count),
      absent_count = coalesce((p_payload->>'absent_count')::int, absent_count),
      leave_count = coalesce((p_payload->>'leave_count')::int, leave_count),
      remark = nullif(btrim(coalesce(p_payload->>'remark','')),''),
      discipline_note = nullif(btrim(coalesce(p_payload->>'discipline_note','')),''),
      correction_note = btrim(p_payload->>'correction_note')
    WHERE id = p_id RETURNING * INTO r;
  IF r.id IS NULL THEN RAISE EXCEPTION '记录不存在'; END IF;
  RETURN to_jsonb(r);
END $$;
