-- 2026-11-01 修改一律需管理员审核
-- record_edit_requests 增加 kind：record_edit（记录修改）/ course_info（填写结果时更改课程信息）
ALTER TABLE record_edit_requests ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'record_edit';

-- record_edit_request：去掉「本周记录可直接修改」限制（所有修改均送审），增加 p_kind
DROP FUNCTION IF EXISTS record_edit_request(text,bigint,jsonb,text);

CREATE OR REPLACE FUNCTION record_edit_request(p_token text, p_record_id bigint, p_payload jsonb, p_reason text, p_kind text DEFAULT 'record_edit')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; r check_records; v_id bigint; v_kind text;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  IF coalesce(btrim(p_reason),'') = '' THEN RAISE EXCEPTION '请填写申请原因'; END IF;

  v_kind := coalesce(nullif(btrim(coalesce(p_kind,'')),''), 'record_edit');
  IF v_kind NOT IN ('record_edit','course_info') THEN v_kind := 'record_edit'; END IF;

  SELECT * INTO r FROM check_records WHERE id = p_record_id;
  IF r.id IS NULL THEN RAISE EXCEPTION '记录不存在'; END IF;
  IF r.owner_id <> u.id THEN RAISE EXCEPTION '只能申请修改自己的记录'; END IF;

  IF EXISTS (SELECT 1 FROM record_edit_requests q WHERE q.record_id = p_record_id AND q.status = 'pending') THEN
    RAISE EXCEPTION '这条记录已有待审批的申请'; END IF;

  INSERT INTO record_edit_requests (record_id, user_id, user_name, payload, reason, kind)
  VALUES (p_record_id, u.id, u.name, coalesce(p_payload,'{}'::jsonb), btrim(p_reason), v_kind)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'status', 'pending', 'kind', v_kind);
END $$;

GRANT EXECUTE ON FUNCTION record_edit_request(text,bigint,jsonb,text,text) TO anon, authenticated;

-- edit_requests_list 增加 kind 输出（edit_request_handle 无需改动：按 payload 键应用，course_info 载荷只含课程字段）
