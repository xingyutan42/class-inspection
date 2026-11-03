-- 2026-11-02 修复：app_boot 重新返回 counselor_map（辅导员映射）
-- 背景：审核功能清理时重建 app_boot，遗漏了 counselor_map 段，
--       导致前端 Store.counselorMap 恒为空，导出 Excel/记录详情的辅导员只能回退到提交时存的值。
-- 本脚本仅恢复该字段，其余返回结构保持不变。可重复执行。

CREATE OR REPLACE FUNCTION app_boot(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_sem jsonb; v_sem_id bigint; v_cfg jsonb; v_stats jsonb; v_map jsonb;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  SELECT to_jsonb(s), s.id INTO v_sem, v_sem_id FROM semesters s WHERE s.is_current LIMIT 1;
  SELECT to_jsonb(c) INTO v_cfg FROM app_config c LIMIT 1;
  SELECT coalesce(jsonb_object_agg(m.class_code, m.counselors), '{}'::jsonb) INTO v_map FROM counselor_map m;
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
    'stats', v_stats,
    'counselor_map', coalesce(v_map, '{}'::jsonb));
END $$;

GRANT EXECUTE ON FUNCTION app_boot(text) TO anon, authenticated;
