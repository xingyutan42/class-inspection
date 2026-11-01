-- 2026-11-01 全员密码重置为各自学号 + 首登强制改密
-- ① 数据迁移：所有账号密码=学号（bcrypt），must_change=true，清失败计数/锁定
UPDATE app_users
   SET password_hash = crypt(student_no, gen_salt('bf', 10)),
       must_change = true, failed_cnt = 0, locked_until = NULL;
-- ② 踢掉全部在线会话（所有人需用学号重新登录并改密）
DELETE FROM app_sessions;
-- ③ 回放 resets_handle / staff_reset_password 为 schema.sql 目标版
--    （线上曾被改为「重置 000 且不强制改密」，此处恢复「重置为学号 + 强制改密」）

CREATE OR REPLACE FUNCTION resets_handle(p_token text, p_id bigint, p_approve boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; q password_requests; a app_users;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION '仅管理员可操作'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  SELECT * INTO q FROM password_requests WHERE id = p_id AND status = 'pending';
  IF q.id IS NULL THEN RAISE EXCEPTION '这条申请已处理过了'; END IF;
  IF p_approve THEN
    SELECT * INTO a FROM app_users WHERE id = q.user_id;
    UPDATE app_users SET password_hash = crypt(a.student_no, gen_salt('bf',10)),
        must_change = true, failed_cnt = 0, locked_until = NULL WHERE id = a.id;
    DELETE FROM app_sessions WHERE user_id = a.id;
  END IF;
  UPDATE password_requests SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      handled_at = now(), handled_by = u.name WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'approved', p_approve);
END $$;

CREATE OR REPLACE FUNCTION staff_reset_password(p_token text, p_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; t app_users;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION '仅管理员可操作'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  SELECT * INTO t FROM app_users WHERE id = p_id;
  IF t.id IS NULL THEN RAISE EXCEPTION '成员不存在'; END IF;
  IF t.id = u.id THEN RAISE EXCEPTION '不能重置自己的密码，请用「我的 → 修改密码」'; END IF;
  UPDATE app_users SET password_hash = crypt(t.student_no, gen_salt('bf', 10)),
    must_change = true, failed_cnt = 0, locked_until = NULL WHERE id = t.id;
  DELETE FROM app_sessions WHERE user_id = t.id;
  RETURN jsonb_build_object('ok', true, 'name', t.name, 'student_no', t.student_no);
END $$;
