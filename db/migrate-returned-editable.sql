-- 2026-11-02 打回后可"修改原记录"（预填原数据、保留照片）
-- 1) record_return：打回时不再解绑 plan_id（成员改的是同一条记录，不需要腾出计划）
-- 2) record_of_plan：按计划查自己被打回的记录（供填写页预填）
-- 3) record_resubmit：更新被打回的那条记录并撤销 returned，计划恢复已提交
--    文本字段用「传了才改」策略（p_payload ? key），避免部分更新把原内容清空

CREATE OR REPLACE FUNCTION record_return(p_token text, p_id bigint, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; r check_records;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION '仅管理员可打回记录'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  PERFORM set_config('app.actor_id', u.id::text, true);
  SELECT * INTO r FROM check_records WHERE id = p_id AND coalesce(returned,false) = false;
  IF r.id IS NULL THEN RAISE EXCEPTION '记录不存在或已打回'; END IF;
  UPDATE check_records SET returned = true WHERE id = p_id;
  IF r.plan_id IS NOT NULL THEN
    UPDATE check_plans SET status = 'planned',
        note = coalesce(nullif(btrim(coalesce(p_reason,'')),''), '管理员打回记录，请修改后重新提交'),
        updated_at = now()
      WHERE id = r.plan_id AND status = 'submitted';
  END IF;
  RETURN jsonb_build_object('ok', true, 'plan_id', r.plan_id, 'course_name', r.course_name, 'owner_name', r.owner_name);
END $$;

CREATE OR REPLACE FUNCTION record_of_plan(p_token text, p_plan_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; r check_records; v_cnt int := 0;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  SELECT * INTO r FROM check_records
   WHERE plan_id = p_plan_id AND owner_id = u.id AND coalesce(returned,false) = true
   ORDER BY id DESC LIMIT 1;
  IF r.id IS NULL THEN
    RETURN jsonb_build_object('record', NULL, 'photo_count', 0);
  END IF;
  SELECT count(*) INTO v_cnt FROM check_record_photos WHERE record_id = r.id;
  RETURN jsonb_build_object('record', to_jsonb(r), 'photo_count', v_cnt);
END $$;

CREATE OR REPLACE FUNCTION record_resubmit(p_token text, p_id bigint, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; r check_records;
  v_cls jsonb; v_norm jsonb := '[]'::jsonb; v_e jsonb;
  v_other int := 0; v_other_act int := 0; v_has boolean;
  v_sum_exp int := 0; v_sum_act int := 0; v_exp int; v_act int; v_pa int;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  PERFORM set_config('app.actor_id', u.id::text, true);

  SELECT * INTO r FROM check_records WHERE id = p_id AND owner_id = u.id;
  IF r.id IS NULL THEN RAISE EXCEPTION '记录不存在或不属于你'; END IF;
  IF NOT coalesce(r.returned, false) THEN RAISE EXCEPTION '这条记录没有被打回，不能直接修改'; END IF;

  v_has := jsonb_array_length(coalesce(r.classes,'[]'::jsonb)) > 0;
  IF v_has THEN
    SELECT coalesce(classes,'[]'::jsonb), coalesce(other_expected,0) INTO v_cls, v_other
      FROM check_records WHERE id = p_id;
    FOR v_e IN SELECT * FROM jsonb_array_elements(v_cls) LOOP
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
    v_other_act := greatest(0, coalesce(nullif(p_payload->>'other_actual','')::int, r.other_actual, 0));
    IF v_other_act > v_other THEN RAISE EXCEPTION '其他类实到不能大于应到'; END IF;
    v_sum_exp := v_sum_exp + v_other;
    v_sum_act := v_sum_act + v_other_act;
  END IF;

  UPDATE check_records SET
      check_date = coalesce(nullif(btrim(coalesce(p_payload->>'check_date','')),'')::date, check_date),
      period_from = coalesce(nullif(p_payload->>'period_from','')::smallint, period_from),
      period_to = coalesce(nullif(p_payload->>'period_to','')::smallint, period_to),
      course_name = CASE WHEN p_payload ? 'course_name' THEN coalesce(nullif(btrim(coalesce(p_payload->>'course_name','')),''), course_name) ELSE course_name END,
      class_name = CASE WHEN p_payload ? 'class_name' THEN coalesce(nullif(btrim(coalesce(p_payload->>'class_name','')),''), class_name) ELSE class_name END,
      teacher = CASE WHEN p_payload ? 'teacher' THEN nullif(btrim(coalesce(p_payload->>'teacher','')),'') ELSE teacher END,
      room = CASE WHEN p_payload ? 'room' THEN nullif(btrim(coalesce(p_payload->>'room','')),'') ELSE room END,
      classes = CASE WHEN v_has THEN v_norm ELSE classes END,
      other_actual = CASE WHEN v_has THEN v_other_act ELSE other_actual END,
      expected_count = CASE WHEN v_has THEN v_sum_exp ELSE coalesce(nullif(p_payload->>'expected_count','')::int, expected_count) END,
      actual_count = CASE WHEN v_has THEN v_sum_act ELSE coalesce(nullif(p_payload->>'actual_count','')::int, actual_count) END,
      absent_count = coalesce(nullif(p_payload->>'absent_count','')::int, absent_count),
      leave_count = coalesce(nullif(p_payload->>'leave_count','')::int, leave_count),
      absent_students = coalesce(p_payload->'absent_students', absent_students),
      leave_students = coalesce(p_payload->'leave_students', leave_students),
      discipline_tags = CASE WHEN p_payload ? 'discipline_tags'
                             THEN ARRAY(SELECT jsonb_array_elements_text(coalesce(p_payload->'discipline_tags','[]'::jsonb)))
                             ELSE discipline_tags END,
      discipline_note = CASE WHEN p_payload ? 'discipline_note' THEN nullif(btrim(coalesce(p_payload->>'discipline_note','')),'') ELSE discipline_note END,
      remark = CASE WHEN p_payload ? 'remark' THEN nullif(btrim(coalesce(p_payload->>'remark','')),'') ELSE remark END,
      teacher_status = CASE WHEN p_payload ? 'teacher_status' THEN nullif(btrim(coalesce(p_payload->>'teacher_status','')),'') ELSE teacher_status END,
      phone_count = coalesce(nullif(p_payload->>'phone_count','')::int, phone_count),
      sleep_count = coalesce(nullif(p_payload->>'sleep_count','')::int, sleep_count),
      phone_10 = coalesce(nullif(p_payload->>'phone_10','')::int, phone_10),
      sleep_10 = coalesce(nullif(p_payload->>'sleep_10','')::int, sleep_10),
      phone_30 = coalesce(nullif(p_payload->>'phone_30','')::int, phone_30),
      sleep_30 = coalesce(nullif(p_payload->>'sleep_30','')::int, sleep_30),
      teacher_score = CASE WHEN nullif(p_payload->>'teacher_score','') IS NOT NULL
                           THEN least(10, greatest(9, round((p_payload->>'teacher_score')::numeric, 1)))
                           ELSE teacher_score END,
      student_score = CASE WHEN nullif(p_payload->>'student_score','') IS NOT NULL
                           THEN least(10, greatest(9, round((p_payload->>'student_score')::numeric, 1)))
                           ELSE student_score END,
      returned = false,
      submitted_at = now()
    WHERE id = p_id RETURNING * INTO r;

  IF r.plan_id IS NOT NULL THEN
    UPDATE check_plans SET status = 'submitted', note = NULL, updated_at = now() WHERE id = r.plan_id;
  END IF;
  RETURN to_jsonb(r);
END $$;

GRANT EXECUTE ON FUNCTION record_of_plan(text, bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION record_resubmit(text, bigint, jsonb) TO anon, authenticated;
