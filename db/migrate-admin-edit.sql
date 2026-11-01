-- 2026-10-31 管理员增强：
--   1) admin_plan_get / admin_plan_update：管理员查看、编辑任意待填报计划（含改归属成员）
--   2) admin_record_update：增加修改课程名称、任课老师、教室、查课日期、节次
-- 执行方式：在 WorkBuddy 云数据库按顺序执行本文件。

-- ---------- 1. 管理员读取单条选课计划 ----------
CREATE OR REPLACE FUNCTION admin_plan_get(p_token text, p_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_out jsonb;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION '仅管理员可查看'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  SELECT to_jsonb(p) INTO v_out FROM check_plans p WHERE p.id = p_id;
  IF v_out IS NULL THEN RAISE EXCEPTION '计划不存在'; END IF;
  RETURN v_out;
END $$;

-- ---------- 2. 管理员编辑选课计划（全部字段 + 归属成员） ----------
CREATE OR REPLACE FUNCTION admin_plan_update(p_token text, p_id bigint, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; r check_plans; v_owner bigint; v_owner_name text;
  v_classes jsonb; v_other int; v_sum text; v_arrive text; v_date date;
  v_pf smallint; v_pt smallint;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION '仅管理员可编辑选课'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;

  SELECT * INTO r FROM check_plans WHERE id = p_id;
  IF r.id IS NULL THEN RAISE EXCEPTION '计划不存在'; END IF;
  IF r.status <> 'planned' THEN RAISE EXCEPTION '只能编辑待填报的计划'; END IF;

  IF coalesce(btrim(p_payload->>'course_name'),'') = '' THEN RAISE EXCEPTION '请填写课程名称'; END IF;
  IF coalesce(btrim(p_payload->>'teacher'),'') = '' THEN RAISE EXCEPTION '请填写任课老师'; END IF;
  IF coalesce(btrim(p_payload->>'room'),'') = '' THEN RAISE EXCEPTION '请填写教室'; END IF;

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
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_classes) e
              WHERE coalesce((e->>'expected')::int, 0) < 0) THEN
    RAISE EXCEPTION '应到人数不能为负';
  END IF;

  v_other := coalesce((p_payload->>'other_expected')::int, 0);
  IF v_other < 0 THEN RAISE EXCEPTION '其他类人数不能为负'; END IF;

  v_arrive := nullif(btrim(coalesce(p_payload->>'arrive_before','')),'');
  IF v_arrive IS NULL OR v_arrive NOT IN ('p1','p2') THEN RAISE EXCEPTION '请选择预计到岗时间'; END IF;

  v_date := nullif(p_payload->>'check_date','')::date;
  IF v_date IS NULL THEN RAISE EXCEPTION '请选择查课日期'; END IF;

  v_pf := coalesce((p_payload->>'period_from')::smallint, 0);
  v_pt := coalesce((p_payload->>'period_to')::smallint, 0);
  IF v_pf NOT BETWEEN 1 AND 12 OR v_pt NOT BETWEEN 1 AND 12 OR v_pt < v_pf THEN
    RAISE EXCEPTION '节次不正确';
  END IF;

  v_owner := coalesce(nullif(p_payload->>'owner_id','')::bigint, r.owner_id);
  SELECT name INTO v_owner_name FROM app_users
   WHERE id = v_owner AND (status = 'active' OR v_owner = r.owner_id);
  IF v_owner_name IS NULL AND v_owner = r.owner_id THEN v_owner_name := r.owner_name; END IF;
  IF v_owner_name IS NULL THEN RAISE EXCEPTION '归属成员不存在或已停用'; END IF;

  SELECT string_agg(e->>'code', '、') INTO v_sum FROM jsonb_array_elements(v_classes) e;
  IF v_other > 0 THEN v_sum := v_sum || ' + 其他'; END IF;

  UPDATE check_plans SET
      owner_id = v_owner,
      owner_name = v_owner_name,
      check_date = v_date,
      period_from = v_pf,
      period_to = v_pt,
      course_name = btrim(p_payload->>'course_name'),
      class_name = v_sum,
      teacher = btrim(p_payload->>'teacher'),
      room = btrim(p_payload->>'room'),
      classes = v_classes,
      other_expected = v_other,
      arrive_before = v_arrive,
      note = CASE WHEN p_payload ? 'note' THEN nullif(btrim(coalesce(p_payload->>'note','')),'') ELSE note END
    WHERE id = p_id AND status = 'planned'
    RETURNING * INTO r;
  IF r.id IS NULL THEN RAISE EXCEPTION '计划已填报或已作废，无法编辑'; END IF;
  RETURN to_jsonb(r);
END $$;

-- ---------- 3. 管理员修正记录：增加课程信息 ----------
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

-- ---------- 4. 授权 ----------
REVOKE EXECUTE ON FUNCTION admin_plan_get(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_plan_get(text, bigint) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_plan_update(text, bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_plan_update(text, bigint, jsonb) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_record_update(text, bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_record_update(text, bigint, jsonb) TO anon, authenticated;
