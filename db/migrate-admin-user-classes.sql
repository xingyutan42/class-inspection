-- 2026-11-02 管理员查看成员的负责班级（课检/成员页课程预览中把负责班级标红）
-- admin_week 的 users 里没有 duty_classes / own_class；本接口单独返回 id + 负责班级文本，
-- 前端拿到后按成员 id 建立映射，命中即标红。不改动 admin_week，避免覆盖线上已存在的增量字段。
-- 可重复执行。

CREATE OR REPLACE FUNCTION admin_user_classes(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION '仅管理员可查看'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  RETURN jsonb_build_object('users', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', a.id,
      'own_class', a.own_class,
      'duty_classes', a.duty_classes,
      'assigned_text', coalesce(nullif(btrim(coalesce(a.duty_classes, '')), ''), a.own_class, '')
    ) ORDER BY a.id)
      FROM app_users a
     WHERE a.status = 'active' AND a.role <> 'admin'
  ), '[]'::jsonb));
END $$;

REVOKE EXECUTE ON FUNCTION admin_user_classes(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_user_classes(text) TO anon, authenticated;
