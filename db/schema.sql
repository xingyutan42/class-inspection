-- 学风查课 · 完整建库脚本（自建账号版，v2）
-- 适用于 PostgreSQL 14+。逐条执行，或整段在 SQL 编辑器里运行。
-- 依赖 pgcrypto（crypt / gen_salt / digest / gen_random_bytes）。
--
-- 安全模型：
--   浏览器不带平台会话，所有数据访问都走 SECURITY DEFINER 函数；
--   客户端必须在参数里带登录凭证 p_token，函数内部校验后才操作数据。
--   业务表对 anon / authenticated 不开放任何行（RLS 开启且无策略 = 全拒绝）。

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- 1. 账号 ----------
CREATE TABLE app_users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          TEXT NOT NULL,
  student_no    TEXT NOT NULL UNIQUE,
  title         TEXT,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  password_hash TEXT NOT NULL,
  must_change   BOOLEAN NOT NULL DEFAULT true,
  failed_cnt    SMALLINT NOT NULL DEFAULT 0,
  locked_until  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  own_class     TEXT,
  duty_grade    TEXT,
  duty_classes  TEXT
);
CREATE UNIQUE INDEX app_users_name_key ON app_users (lower(name));

CREATE TABLE app_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX app_sessions_user ON app_sessions(user_id);

CREATE TABLE password_requests (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  handled_at  TIMESTAMPTZ,
  handled_by  TEXT
);
CREATE INDEX pwreq_status ON password_requests(status, created_at DESC);

-- ---------- 2. 业务表 ----------
CREATE TABLE semesters (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name         TEXT NOT NULL,
  start_monday DATE NOT NULL,
  total_weeks  SMALLINT NOT NULL CHECK (total_weeks BETWEEN 1 AND 30),
  is_current   BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX semesters_one_current ON semesters(is_current) WHERE is_current;

CREATE TABLE check_plans (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id    BIGINT NOT NULL,
  owner_name  TEXT,
  semester_id BIGINT NOT NULL REFERENCES semesters(id),
  week_no     SMALLINT NOT NULL,
  check_date  DATE NOT NULL,
  period_from SMALLINT NOT NULL CHECK (period_from BETWEEN 1 AND 12),
  period_to   SMALLINT NOT NULL CHECK (period_to BETWEEN 1 AND 12),
  course_name TEXT NOT NULL,
  class_name  TEXT NOT NULL,
  teacher     TEXT,
  room        TEXT,
  counselor   TEXT,
  status      TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','submitted','void')),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_to >= period_from)
);
CREATE INDEX plans_owner_week ON check_plans(owner_id, semester_id, week_no);
CREATE INDEX plans_sem_week_status ON check_plans(semester_id, week_no, status);

CREATE TABLE check_records (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_uuid   UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  plan_id       BIGINT UNIQUE REFERENCES check_plans(id),
  owner_id      BIGINT NOT NULL,
  owner_name    TEXT,
  semester_id   BIGINT NOT NULL REFERENCES semesters(id),
  week_no       SMALLINT NOT NULL,
  check_date    DATE NOT NULL,
  period_from   SMALLINT NOT NULL,
  period_to     SMALLINT NOT NULL,
  course_name   TEXT NOT NULL,
  class_name    TEXT NOT NULL,
  teacher       TEXT,
  room          TEXT,
  counselor     TEXT,
  is_extra      BOOLEAN NOT NULL DEFAULT false,
  expected_count INTEGER CHECK (expected_count IS NULL OR expected_count >= 0),
  actual_count   INTEGER CHECK (actual_count IS NULL OR actual_count >= 0),
  late_count     INTEGER NOT NULL DEFAULT 0 CHECK (late_count >= 0),
  absent_count   INTEGER NOT NULL DEFAULT 0 CHECK (absent_count >= 0),
  leave_count    INTEGER NOT NULL DEFAULT 0 CHECK (leave_count >= 0),
  discipline_tags TEXT[] NOT NULL DEFAULT '{}',
  discipline_note TEXT,
  remark          TEXT,
  correction_note TEXT,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  corrected_count SMALLINT NOT NULL DEFAULT 0,
  last_corrected_at TIMESTAMPTZ
);
CREATE INDEX rec_sem_week ON check_records(semester_id, week_no);
CREATE INDEX rec_owner ON check_records(owner_id, check_date);

-- 照片表保留：本期不启用上传，后续启用时无需改表
CREATE TABLE check_record_photos (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  record_id    BIGINT NOT NULL REFERENCES check_records(id) ON DELETE CASCADE,
  owner_id     BIGINT NOT NULL,
  storage_path TEXT NOT NULL,
  bytes        INTEGER,
  sort_no      SMALLINT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX photos_record ON check_record_photos(record_id);

CREATE TABLE check_record_revisions (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  record_id   BIGINT NOT NULL,
  editor_id   BIGINT,
  editor_role TEXT NOT NULL CHECK (editor_role IN ('member','leader')),
  action      TEXT NOT NULL CHECK (action IN ('member_self_edit','leader_correct')),
  reason      TEXT,
  before_row  JSONB,
  after_row   JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX rev_record ON check_record_revisions(record_id, created_at DESC);

CREATE TABLE app_config (
  id              SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  max_photos      SMALLINT NOT NULL DEFAULT 3,
  max_photo_kb    INTEGER NOT NULL DEFAULT 400,
  allow_backfill  BOOLEAN NOT NULL DEFAULT true,
  max_planned_weeks SMALLINT NOT NULL DEFAULT 4
);

-- ---------- 3. 周次与触发器 ----------
CREATE OR REPLACE FUNCTION current_week_start() RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT (date_trunc('week', (now() AT TIME ZONE 'Asia/Shanghai')))::date
$$;

CREATE OR REPLACE FUNCTION current_week_no(p_sem BIGINT) RETURNS smallint
LANGUAGE sql STABLE AS $$
  SELECT (((date_trunc('week', (now() AT TIME ZONE 'Asia/Shanghai')))::date - s.start_monday) / 7 + 1)::smallint
  FROM semesters s WHERE s.id = p_sem
$$;

CREATE OR REPLACE FUNCTION set_week_no() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_start date; v_total smallint; v_week integer;
BEGIN
  SELECT start_monday, total_weeks INTO v_start, v_total FROM semesters WHERE id = NEW.semester_id;
  IF v_start IS NULL THEN RAISE EXCEPTION '学期不存在'; END IF;
  v_week := (NEW.check_date - v_start) / 7 + 1;
  IF NEW.check_date < v_start OR v_week > v_total THEN RAISE EXCEPTION '查课日期不在学期范围内'; END IF;
  NEW.week_no := v_week;
  IF TG_TABLE_NAME = 'check_plans' THEN NEW.updated_at := now(); END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION mark_plan_submitted() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.plan_id IS NOT NULL THEN
    UPDATE check_plans SET status = 'submitted', updated_at = now()
     WHERE id = NEW.plan_id AND status = 'planned';
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION rec_stamp_correction() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.corrected_count := OLD.corrected_count + 1;
  NEW.last_corrected_at := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION rec_log_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor bigint; v_admin boolean; v_action text;
BEGIN
  -- 触发器在 SECURITY DEFINER 下拿不到调用方身份，由写记录的 RPC 通过 GUC 传入
  v_actor := coalesce(nullif(current_setting('app.actor_id', true), '')::bigint, NEW.owner_id);
  SELECT (role = 'admin') INTO v_admin FROM app_users WHERE id = v_actor;
  v_action := CASE WHEN coalesce(v_admin, false) AND v_actor IS DISTINCT FROM NEW.owner_id
                   THEN 'leader_correct' ELSE 'member_self_edit' END;
  INSERT INTO check_record_revisions(record_id, editor_id, editor_role, action, reason, before_row, after_row)
  VALUES (NEW.id, v_actor,
          CASE WHEN coalesce(v_admin, false) THEN 'leader' ELSE 'member' END,
          v_action, NEW.correction_note, to_jsonb(OLD), to_jsonb(NEW));
  RETURN NULL;
END $$;

CREATE TRIGGER trg_plans_week BEFORE INSERT OR UPDATE ON check_plans FOR EACH ROW EXECUTE FUNCTION set_week_no();
CREATE TRIGGER trg_rec_week BEFORE INSERT OR UPDATE ON check_records FOR EACH ROW EXECUTE FUNCTION set_week_no();
CREATE TRIGGER trg_rec_stamp BEFORE UPDATE ON check_records FOR EACH ROW EXECUTE FUNCTION rec_stamp_correction();
CREATE TRIGGER trg_rec_log AFTER UPDATE ON check_records FOR EACH ROW EXECUTE FUNCTION rec_log_revision();
CREATE TRIGGER trg_plan_submitted AFTER INSERT ON check_records FOR EACH ROW EXECUTE FUNCTION mark_plan_submitted();

-- ---------- 4. 会话校验 ----------
CREATE OR REPLACE FUNCTION require_user(p_token text) RETURNS app_users
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.* FROM app_users a
   WHERE a.id = (SELECT s.user_id FROM app_sessions s
                  WHERE s.token_hash = encode(digest(coalesce(p_token,''),'sha256'),'hex')
                    AND s.expires_at > now())
     AND a.status = 'active'
$$;

-- ---------- 5. 登录 / 改密 / 找回 ----------
CREATE OR REPLACE FUNCTION app_login(p_name text, p_password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_token text; v_name text := btrim(coalesce(p_name,''));
BEGIN
  IF v_name = '' OR coalesce(p_password,'') = '' THEN RAISE EXCEPTION '请输入姓名和密码'; END IF;
  PERFORM pg_sleep(0.25);
  SELECT * INTO u FROM app_users WHERE lower(name) = lower(v_name);
  IF u.id IS NULL THEN RAISE EXCEPTION '姓名或密码不正确'; END IF;
  IF u.status <> 'active' THEN RAISE EXCEPTION '账号已停用，请联系管理员'; END IF;
  IF u.locked_until IS NOT NULL AND u.locked_until > now() THEN RAISE EXCEPTION '尝试次数过多，请 15 分钟后再试'; END IF;
  IF u.password_hash <> crypt(p_password, u.password_hash) THEN
    UPDATE app_users SET failed_cnt = failed_cnt + 1,
      locked_until = CASE WHEN failed_cnt + 1 >= 3 THEN now() + interval '15 minutes' ELSE locked_until END
      WHERE id = u.id;
    RAISE EXCEPTION '姓名或密码不正确';
  END IF;
  UPDATE app_users SET failed_cnt = 0, locked_until = NULL, last_login_at = now() WHERE id = u.id;
  v_token := encode(gen_random_bytes(24), 'hex');
  INSERT INTO app_sessions(token_hash, user_id, expires_at)
  VALUES (encode(digest(v_token,'sha256'),'hex'), u.id, now() + interval '30 days');
  RETURN jsonb_build_object('token', v_token, 'id', u.id, 'name', u.name, 'student_no', u.student_no,
    'title', u.title, 'role', u.role, 'must_change', u.must_change);
END $$;

CREATE OR REPLACE FUNCTION app_logout(p_token text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM app_sessions WHERE token_hash = encode(digest(coalesce(p_token,''),'sha256'),'hex');
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION app_boot(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_sem jsonb; v_sem_id bigint; v_cfg jsonb; v_pending int := 0; v_stats jsonb;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  SELECT to_jsonb(s), s.id INTO v_sem, v_sem_id FROM semesters s WHERE s.is_current LIMIT 1;
  SELECT to_jsonb(c) INTO v_cfg FROM app_config c LIMIT 1;
  IF u.role = 'admin' THEN SELECT count(*) INTO v_pending FROM password_requests WHERE status = 'pending'; END IF;
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
    'pending_resets', v_pending,
    'stats', v_stats);
END $$;

CREATE OR REPLACE FUNCTION app_change_password(p_token text, p_old text, p_new text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  -- 首次登录（must_change）只设新密码，不再要求输入学号；主动改密仍校验原密码
  IF NOT u.must_change THEN
    IF u.password_hash <> crypt(coalesce(p_old,''), u.password_hash) THEN RAISE EXCEPTION '原密码不正确'; END IF;
  END IF;
  IF length(coalesce(p_new,'')) < 8 THEN RAISE EXCEPTION '新密码至少 8 位'; END IF;
  IF p_new ~ '^[0-9]+$' THEN RAISE EXCEPTION '新密码不能是纯数字，请混合字母'; END IF;
  IF p_new = u.student_no THEN RAISE EXCEPTION '新密码不能与学号相同'; END IF;
  UPDATE app_users SET password_hash = crypt(p_new, gen_salt('bf',10)), must_change = false WHERE id = u.id;
  DELETE FROM app_sessions WHERE user_id = u.id
    AND token_hash <> encode(digest(coalesce(p_token,''),'sha256'),'hex');
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION app_forgot_password(p_name text, p_student_no text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_open int;
BEGIN
  PERFORM pg_sleep(0.2);
  SELECT * INTO u FROM app_users
   WHERE lower(name) = lower(btrim(coalesce(p_name,''))) AND student_no = btrim(coalesce(p_student_no,''));
  IF u.id IS NULL THEN RAISE EXCEPTION '姓名与学号不匹配，请核对后重试'; END IF;
  IF u.status <> 'active' THEN RAISE EXCEPTION '账号已停用，请联系管理员'; END IF;
  SELECT count(*) INTO v_open FROM password_requests WHERE user_id = u.id AND status = 'pending';
  IF v_open = 0 THEN INSERT INTO password_requests(user_id, reason) VALUES (u.id, '自助申请'); END IF;
  RETURN jsonb_build_object('ok', true, 'already', v_open > 0);
END $$;

-- ---------- 6. 组员接口 ----------
CREATE OR REPLACE FUNCTION my_week(p_token text, p_week smallint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_sem bigint; v_plans jsonb; v_recs jsonb;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  SELECT id INTO v_sem FROM semesters WHERE is_current LIMIT 1;
  SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.check_date, p.period_from), '[]'::jsonb) INTO v_plans
    FROM check_plans p WHERE p.owner_id = u.id AND p.semester_id = v_sem AND p.week_no = p_week;
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.check_date, r.period_from), '[]'::jsonb) INTO v_recs
    FROM check_records r WHERE r.owner_id = u.id AND r.semester_id = v_sem AND r.week_no = p_week;
  RETURN jsonb_build_object('plans', v_plans, 'records', v_recs, 'week', p_week);
END $$;

CREATE OR REPLACE FUNCTION plan_get(p_token text, p_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v jsonb;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  SELECT to_jsonb(p) INTO v FROM check_plans p WHERE p.id = p_id AND (p.owner_id = u.id OR u.role = 'admin');
  IF v IS NULL THEN RAISE EXCEPTION '计划不存在'; END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION plan_save(p_token text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_id bigint; v_sem bigint; r check_plans;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  IF coalesce(p_payload->>'course_name','') = '' OR coalesce(p_payload->>'class_name','') = '' THEN
    RAISE EXCEPTION '请填写课程名称和被查班级';
  END IF;
  IF coalesce(p_payload->>'check_date','') = '' THEN RAISE EXCEPTION '请选择查课日期'; END IF;
  SELECT id INTO v_sem FROM semesters WHERE is_current LIMIT 1;
  IF v_sem IS NULL THEN RAISE EXCEPTION '还没有设置学期'; END IF;
  v_id := nullif(p_payload->>'id','')::bigint;
  IF v_id IS NULL THEN
    INSERT INTO check_plans(owner_id, owner_name, semester_id, week_no, check_date, period_from, period_to,
        course_name, class_name, teacher, room, counselor, note, status)
    VALUES (u.id, u.name, v_sem, 1, (p_payload->>'check_date')::date,
        coalesce((p_payload->>'period_from')::smallint,1), coalesce((p_payload->>'period_to')::smallint,2),
        btrim(p_payload->>'course_name'), btrim(p_payload->>'class_name'),
        nullif(btrim(coalesce(p_payload->>'teacher','')),''), nullif(btrim(coalesce(p_payload->>'room','')),''),
        nullif(btrim(coalesce(p_payload->>'counselor','')),''),
        nullif(btrim(coalesce(p_payload->>'note','')),''), 'planned')
    RETURNING * INTO r;
  ELSE
    UPDATE check_plans SET check_date = (p_payload->>'check_date')::date,
        period_from = coalesce((p_payload->>'period_from')::smallint,1),
        period_to = coalesce((p_payload->>'period_to')::smallint,2),
        course_name = btrim(p_payload->>'course_name'), class_name = btrim(p_payload->>'class_name'),
        teacher = nullif(btrim(coalesce(p_payload->>'teacher','')),''),
        room = nullif(btrim(coalesce(p_payload->>'room','')),''),
        counselor = nullif(btrim(coalesce(p_payload->>'counselor','')),''),
        note = nullif(btrim(coalesce(p_payload->>'note','')),''),
        owner_name = u.name
      WHERE id = v_id AND owner_id = u.id AND status = 'planned'
      RETURNING * INTO r;
    IF r.id IS NULL THEN RAISE EXCEPTION '这节课已填报或不属于你，无法修改'; END IF;
  END IF;
  RETURN to_jsonb(r);
END $$;

CREATE OR REPLACE FUNCTION plan_void(p_token text, p_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; r check_plans;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  UPDATE check_plans SET status = 'void'
   WHERE id = p_id AND (owner_id = u.id OR u.role = 'admin') AND status = 'planned'
   RETURNING * INTO r;
  IF r.id IS NULL THEN RAISE EXCEPTION '无法作废这节课'; END IF;
  RETURN to_jsonb(r);
END $$;

CREATE OR REPLACE FUNCTION record_submit(p_token text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_sem bigint; r check_records; v_plan bigint;
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
  END IF;
  INSERT INTO check_records(plan_id, owner_id, owner_name, semester_id, week_no, check_date,
      period_from, period_to, course_name, class_name, teacher, room, counselor, is_extra,
      expected_count, actual_count, late_count, absent_count, leave_count,
      absent_students, leave_students,
      discipline_tags, discipline_note, remark, client_uuid)
  VALUES (v_plan, u.id, u.name, v_sem, 1,
      (p_payload->>'check_date')::date,
      coalesce((p_payload->>'period_from')::smallint,1), coalesce((p_payload->>'period_to')::smallint,2),
      btrim(p_payload->>'course_name'), btrim(p_payload->>'class_name'),
      nullif(btrim(coalesce(p_payload->>'teacher','')),''), nullif(btrim(coalesce(p_payload->>'room','')),''),
      nullif(btrim(coalesce(p_payload->>'counselor','')),''),
      coalesce((p_payload->>'is_extra')::boolean, false),
      coalesce((p_payload->>'expected_count')::int,0), coalesce((p_payload->>'actual_count')::int,0),
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
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  PERFORM set_config('app.actor_id', u.id::text, true);
  UPDATE check_records SET
      course_name = coalesce(nullif(btrim(coalesce(p_payload->>'course_name','')),''), course_name),
      class_name = coalesce(nullif(btrim(coalesce(p_payload->>'class_name','')),''), class_name),
      teacher = nullif(btrim(coalesce(p_payload->>'teacher','')),''),
      room = nullif(btrim(coalesce(p_payload->>'room','')),''),
      expected_count = coalesce((p_payload->>'expected_count')::int, expected_count),
      actual_count = coalesce((p_payload->>'actual_count')::int, actual_count),
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

CREATE OR REPLACE FUNCTION record_get(p_token text, p_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_rec jsonb; v_revs jsonb; v_can boolean := false;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  SELECT to_jsonb(r) INTO v_rec FROM check_records r
   WHERE r.id = p_id AND (r.owner_id = u.id OR u.role = 'admin');
  IF v_rec IS NULL THEN RAISE EXCEPTION '记录不存在或无权查看'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.created_at DESC), '[]'::jsonb) INTO v_revs
    FROM check_record_revisions v WHERE v.record_id = p_id;
  v_can := (v_rec->>'owner_id')::bigint = u.id
           AND (v_rec->>'check_date')::date >= current_week_start()
           AND NOT u.must_change;
  RETURN jsonb_build_object('record', v_rec, 'revisions', v_revs, 'can_edit', v_can);
END $$;

-- ---------- 7. 管理员接口 ----------
CREATE OR REPLACE FUNCTION admin_week(p_token text, p_week smallint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_sem bigint; v_users jsonb; v_recs jsonb; v_stats jsonb;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION '仅管理员可查看'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  SELECT id INTO v_sem FROM semesters WHERE is_current LIMIT 1;

  SELECT coalesce(jsonb_agg(x ORDER BY x->>'name'), '[]'::jsonb) INTO v_users FROM (
    SELECT jsonb_build_object(
      'id', a.id, 'name', a.name, 'student_no', a.student_no, 'role', a.role, 'status', a.status,
      'planned', coalesce(pl.cnt,0), 'done', coalesce(pl.done,0),
      'pending', coalesce(pl.cnt,0) - coalesce(pl.done,0),
      'issues', coalesce(rc.issues,0),
      'pending_list', coalesce(pl.list, '[]'::jsonb)
    ) AS x
    FROM app_users a
    LEFT JOIN LATERAL (
      SELECT count(*) AS cnt,
             count(*) FILTER (WHERE p.status = 'submitted') AS done,
             coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'course_name', p.course_name,
               'class_name', p.class_name, 'check_date', p.check_date, 'period_from', p.period_from,
               'period_to', p.period_to, 'room', p.room, 'week_no', p.week_no)
               ORDER BY p.check_date, p.period_from) FILTER (WHERE p.status = 'planned'), '[]'::jsonb) AS list
        FROM check_plans p
       WHERE p.owner_id = a.id AND p.semester_id = v_sem AND p.week_no = p_week AND p.status <> 'void'
    ) pl ON true
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE array_length(r.discipline_tags,1) > 0) AS issues
        FROM check_records r
       WHERE r.owner_id = a.id AND r.semester_id = v_sem AND r.week_no = p_week
    ) rc ON true
    WHERE a.status = 'active'
  ) s;

  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.submitted_at DESC), '[]'::jsonb) INTO v_recs
    FROM check_records r WHERE r.semester_id = v_sem AND r.week_no = p_week;

  SELECT jsonb_build_object(
    'plans', (SELECT count(*) FROM check_plans WHERE semester_id = v_sem AND week_no = p_week AND status <> 'void'),
    'done', (SELECT count(*) FROM check_plans WHERE semester_id = v_sem AND week_no = p_week AND status = 'submitted'),
    'issues', (SELECT count(*) FROM check_records WHERE semester_id = v_sem AND week_no = p_week AND array_length(discipline_tags,1) > 0),
    'expected', (SELECT coalesce(sum(expected_count),0) FROM check_records WHERE semester_id = v_sem AND week_no = p_week),
    'actual', (SELECT coalesce(sum(actual_count),0) FROM check_records WHERE semester_id = v_sem AND week_no = p_week),
    'overdue', (SELECT count(*) FROM check_plans WHERE semester_id = v_sem AND status = 'planned' AND week_no < p_week)
  ) INTO v_stats;

  RETURN jsonb_build_object('users', v_users, 'records', v_recs, 'stats', v_stats);
END $$;

CREATE OR REPLACE FUNCTION admin_records(p_token text, p_filters jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_sem bigint; v_total bigint; v_rows jsonb;
  v_from smallint; v_to smallint; v_uid bigint; v_kw text; v_issue boolean; v_limit int; v_offset int;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION '仅管理员可查看'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  SELECT id INTO v_sem FROM semesters WHERE is_current LIMIT 1;
  v_from := coalesce((p_filters->>'week_from')::smallint,1);
  v_to := coalesce((p_filters->>'week_to')::smallint,30);
  v_uid := nullif(p_filters->>'user_id','')::bigint;
  v_kw := nullif(btrim(coalesce(p_filters->>'keyword','')),'');
  v_issue := coalesce((p_filters->>'only_issue')::boolean,false);
  v_limit := least(coalesce((p_filters->>'limit')::int,20),200);
  v_offset := greatest(coalesce((p_filters->>'offset')::int,0),0);

  SELECT count(*) INTO v_total FROM check_records r
   WHERE r.semester_id = v_sem AND r.week_no BETWEEN v_from AND v_to
     AND (v_uid IS NULL OR r.owner_id = v_uid)
     AND (v_kw IS NULL OR r.course_name ILIKE '%'||v_kw||'%' OR r.class_name ILIKE '%'||v_kw||'%' OR coalesce(r.room,'') ILIKE '%'||v_kw||'%')
     AND (NOT v_issue OR array_length(r.discipline_tags,1) > 0);

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.check_date DESC, x.id DESC), '[]'::jsonb) INTO v_rows FROM (
    SELECT r.* FROM check_records r
     WHERE r.semester_id = v_sem AND r.week_no BETWEEN v_from AND v_to
       AND (v_uid IS NULL OR r.owner_id = v_uid)
       AND (v_kw IS NULL OR r.course_name ILIKE '%'||v_kw||'%' OR r.class_name ILIKE '%'||v_kw||'%' OR coalesce(r.room,'') ILIKE '%'||v_kw||'%')
       AND (NOT v_issue OR array_length(r.discipline_tags,1) > 0)
     ORDER BY r.check_date DESC, r.id DESC LIMIT v_limit OFFSET v_offset
  ) x;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END $$;

CREATE OR REPLACE FUNCTION admin_record_get(p_token text, p_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_rec jsonb; v_revs jsonb;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION '仅管理员可查看'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  SELECT to_jsonb(r) INTO v_rec FROM check_records r WHERE r.id = p_id;
  IF v_rec IS NULL THEN RAISE EXCEPTION '记录不存在'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.created_at DESC), '[]'::jsonb) INTO v_revs
    FROM check_record_revisions v WHERE v.record_id = p_id;
  RETURN jsonb_build_object('record', v_rec, 'revisions', v_revs);
END $$;

CREATE OR REPLACE FUNCTION admin_record_update(p_token text, p_id bigint, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; r check_records;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION '仅管理员可修正'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  IF coalesce(btrim(p_payload->>'correction_note'),'') = '' THEN RAISE EXCEPTION '请填写修正原因'; END IF;
  PERFORM set_config('app.actor_id', u.id::text, true);
  UPDATE check_records SET
      expected_count = coalesce((p_payload->>'expected_count')::int, expected_count),
      actual_count = coalesce((p_payload->>'actual_count')::int, actual_count),
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

CREATE OR REPLACE FUNCTION admin_plans(p_token text, p_week smallint, p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_sem bigint; v_out jsonb;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION '仅管理员可查看'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  SELECT id INTO v_sem FROM semesters WHERE is_current LIMIT 1;
  SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.check_date, p.period_from), '[]'::jsonb) INTO v_out
    FROM check_plans p
   WHERE p.semester_id = v_sem AND p.week_no = p_week
     AND (coalesce(p_status,'') = '' OR p.status = p_status);
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION staff_list(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_out jsonb;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION '仅管理员可查看'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'name', a.name, 'student_no', a.student_no, 'title', a.title,
      'role', a.role, 'status', a.status, 'must_change', a.must_change,
      'last_login_at', a.last_login_at,
      'has_request', EXISTS (SELECT 1 FROM password_requests q WHERE q.user_id = a.id AND q.status = 'pending')
    ) ORDER BY CASE a.role WHEN 'admin' THEN 0 ELSE 1 END, a.name), '[]'::jsonb) INTO v_out
    FROM app_users a;
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION staff_update(p_token text, p_id bigint, p_status text, p_role text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; r app_users;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION '仅管理员可操作'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  IF p_id = u.id AND (coalesce(p_status,'') = 'disabled' OR coalesce(p_role,'') = 'member') THEN
    RAISE EXCEPTION '不能停用或降级自己的管理员账号';
  END IF;
  UPDATE app_users SET status = coalesce(nullif(p_status,''), status),
                       role = coalesce(nullif(p_role,''), role)
    WHERE id = p_id RETURNING * INTO r;
  IF r.id IS NULL THEN RAISE EXCEPTION '成员不存在'; END IF;
  IF r.status = 'disabled' THEN DELETE FROM app_sessions WHERE user_id = r.id; END IF;
  RETURN jsonb_build_object('id', r.id, 'status', r.status, 'role', r.role);
END $$;

CREATE OR REPLACE FUNCTION semester_list(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_out jsonb;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.start_monday DESC), '[]'::jsonb) INTO v_out FROM semesters s;
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION semester_save(p_token text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_id bigint; r semesters;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION '仅管理员可操作'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  IF coalesce(btrim(p_payload->>'name'),'') = '' OR coalesce(p_payload->>'start_monday','') = '' THEN
    RAISE EXCEPTION '请填写学期名称和第 1 周周一';
  END IF;
  v_id := nullif(p_payload->>'id','')::bigint;
  IF v_id IS NULL THEN
    INSERT INTO semesters(name, start_monday, total_weeks, is_current)
    VALUES (btrim(p_payload->>'name'), (p_payload->>'start_monday')::date,
            coalesce((p_payload->>'total_weeks')::smallint,18), false)
    RETURNING * INTO r;
  ELSE
    UPDATE semesters SET name = btrim(p_payload->>'name'),
        start_monday = (p_payload->>'start_monday')::date,
        total_weeks = coalesce((p_payload->>'total_weeks')::smallint, total_weeks)
      WHERE id = v_id RETURNING * INTO r;
    IF r.id IS NULL THEN RAISE EXCEPTION '学期不存在'; END IF;
  END IF;
  RETURN to_jsonb(r);
END $$;

CREATE OR REPLACE FUNCTION semester_set_current(p_token text, p_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION '仅管理员可操作'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  UPDATE semesters SET is_current = false WHERE is_current = true;
  UPDATE semesters SET is_current = true WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION resets_list(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_out jsonb;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION '仅管理员可查看'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', q.id, 'status', q.status, 'created_at', q.created_at,
      'handled_at', q.handled_at, 'handled_by', q.handled_by,
      'name', a.name, 'student_no', a.student_no, 'title', a.title
    ) ORDER BY q.created_at DESC), '[]'::jsonb) INTO v_out
    FROM password_requests q JOIN app_users a ON a.id = q.user_id
   WHERE q.status = 'pending' OR q.handled_at > now() - interval '7 days';
  RETURN v_out;
END $$;

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

CREATE OR REPLACE FUNCTION export_data(p_token text, p_from smallint, p_to smallint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_sem bigint; v_recs jsonb; v_plans jsonb; v_users jsonb;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION '仅管理员可导出'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  SELECT id INTO v_sem FROM semesters WHERE is_current LIMIT 1;
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.week_no, r.check_date), '[]'::jsonb) INTO v_recs
    FROM check_records r WHERE r.semester_id = v_sem AND r.week_no BETWEEN p_from AND p_to;
  SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.week_no, p.check_date), '[]'::jsonb) INTO v_plans
    FROM check_plans p WHERE p.semester_id = v_sem AND p.week_no BETWEEN p_from AND p_to;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'student_no', a.student_no) ORDER BY a.name), '[]'::jsonb) INTO v_users
    FROM app_users a WHERE a.status = 'active';
  RETURN jsonb_build_object('records', v_recs, 'plans', v_plans, 'users', v_users);
END $$;

-- ---------- 8. 权限 ----------
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE semesters ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_record_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_record_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
-- 以上表均不创建策略、不授予 anon/authenticated → 直连一律拒绝，只能走下面的函数。

DO $$
DECLARE f text;
BEGIN
  FOR f IN SELECT unnest(ARRAY[
    'app_login(text,text)','app_logout(text)','app_boot(text)',
    'app_change_password(text,text,text)','app_forgot_password(text,text)',
    'my_week(text,smallint)','plan_get(text,bigint)','plan_save(text,jsonb)','plan_void(text,bigint)',
    'record_submit(text,jsonb)','record_update(text,bigint,jsonb)','record_get(text,bigint)',
    'admin_week(text,smallint)','admin_records(text,jsonb)','admin_record_get(text,bigint)',
    'admin_record_update(text,bigint,jsonb)','admin_plans(text,smallint,text)',
    'staff_list(text)','staff_update(text,bigint,text,text)',
    'semester_list(text)','semester_save(text,jsonb)','semester_set_current(text,bigint)',
    'resets_list(text)','resets_handle(text,bigint,boolean)','export_data(text,smallint,smallint)',
    'my_due(text)','my_history(text,integer)','notice_list(text)','notice_post(text,text)'
  ]) LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', f);
  END LOOP;
END $$;

-- ---------- 10. 通知与待查接口 ----------
CREATE TABLE IF NOT EXISTS notices (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  content TEXT NOT NULL,
  created_by BIGINT NOT NULL REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE notices ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION my_due(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_sem bigint; v_out jsonb;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  SELECT id INTO v_sem FROM semesters WHERE is_current LIMIT 1;
  SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.check_date, p.period_from), '[]'::jsonb) INTO v_out
    FROM check_plans p
   WHERE p.owner_id = u.id AND p.semester_id = v_sem AND p.status = 'planned';
  RETURN v_out;
END $$;

-- 我的查课历史（仅当前周，按日期倒序）
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
             r.period_from, r.period_to, r.room, r.teacher,
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

CREATE OR REPLACE FUNCTION notice_list(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', n.id, 'content', n.content,
      'created_at', n.created_at, 'author', a.name)
      ORDER BY n.id DESC) FROM notices n JOIN app_users a ON a.id = n.created_by), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION notice_post(p_token text, p_content text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; n notices;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION '仅管理员可发通知'; END IF;
  IF btrim(coalesce(p_content, '')) = '' THEN RAISE EXCEPTION '通知内容不能为空'; END IF;
  IF length(p_content) > 500 THEN RAISE EXCEPTION '通知不能超过 500 字'; END IF;
  INSERT INTO notices(content, created_by) VALUES (btrim(p_content), u.id) RETURNING * INTO n;
  RETURN to_jsonb(n);
END $$;

-- ---------- 初始数据 ----------
INSERT INTO app_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
INSERT INTO semesters (name, start_monday, total_weeks, is_current)
VALUES ('2026-2027 学年第一学期', DATE '2026-08-31', 18, true);

-- 初始管理员：账号=姓名，初始密码=学号，首次登录强制改密
-- INSERT INTO app_users (name, student_no, title, role, status, password_hash, must_change)
-- VALUES ('张三', '2026000001', '组长', 'admin', 'active',
--         crypt('2026000001', gen_salt('bf', 10)), true);

-- 批量导入名单（姓名/职务/学号）时，用下面这条模板逐行执行：
-- INSERT INTO app_users (name, student_no, title, role, status, password_hash, must_change)
-- VALUES ('姓名', '学号', '职务', CASE WHEN '职务' LIKE '%组长%' THEN 'admin' ELSE 'member' END,
--         'active', crypt('学号', gen_salt('bf', 10)), true);

-- ---------- 11. 增量：辅导员 / 多班级 / 每班应到 ----------
-- 说明：本节替代前面 plan_save / record_submit 的定义（后定义生效）。
ALTER TABLE check_plans   ADD COLUMN IF NOT EXISTS counselor      TEXT;
ALTER TABLE check_records ADD COLUMN IF NOT EXISTS counselor      TEXT;
ALTER TABLE check_plans   ADD COLUMN IF NOT EXISTS classes        JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE check_plans   ADD COLUMN IF NOT EXISTS other_expected INTEGER NOT NULL DEFAULT 0;
ALTER TABLE check_records ADD COLUMN IF NOT EXISTS classes        JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE check_records ADD COLUMN IF NOT EXISTS other_expected INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION plan_save(p_token text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_id bigint; v_sem bigint; r check_plans;
  v_classes jsonb; v_other int; v_sum text;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;

  IF coalesce(btrim(p_payload->>'course_name'),'') = '' THEN RAISE EXCEPTION '请填写课程名称'; END IF;
  IF coalesce(btrim(p_payload->>'teacher'),'') = '' THEN RAISE EXCEPTION '请填写任课老师'; END IF;
  IF coalesce(btrim(p_payload->>'room'),'') = '' THEN RAISE EXCEPTION '请填写教室'; END IF;
  IF coalesce(btrim(p_payload->>'counselor'),'') = '' THEN RAISE EXCEPTION '请填写辅导员'; END IF;

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
        course_name, class_name, teacher, room, counselor, classes, other_expected, note, status)
    VALUES (u.id, u.name, v_sem, 1, (p_payload->>'check_date')::date,
        coalesce((p_payload->>'period_from')::smallint,1), coalesce((p_payload->>'period_to')::smallint,2),
        btrim(p_payload->>'course_name'), v_sum,
        btrim(p_payload->>'teacher'), btrim(p_payload->>'room'), btrim(p_payload->>'counselor'),
        v_classes, v_other,
        nullif(btrim(coalesce(p_payload->>'note','')),''), 'planned')
    RETURNING * INTO r;
  ELSE
    UPDATE check_plans SET check_date = (p_payload->>'check_date')::date,
        period_from = coalesce((p_payload->>'period_from')::smallint,1),
        period_to = coalesce((p_payload->>'period_to')::smallint,2),
        course_name = btrim(p_payload->>'course_name'), class_name = v_sum,
        teacher = btrim(p_payload->>'teacher'), room = btrim(p_payload->>'room'),
        counselor = btrim(p_payload->>'counselor'),
        classes = v_classes, other_expected = v_other,
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
DECLARE u app_users; v_sem bigint; r check_records; v_plan bigint;
  v_classes jsonb := '[]'::jsonb; v_other int := 0;
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
      INTO v_classes, v_other FROM check_plans WHERE id = v_plan;
  END IF;
  INSERT INTO check_records(plan_id, owner_id, owner_name, semester_id, week_no, check_date,
      period_from, period_to, course_name, class_name, teacher, room, counselor, classes, other_expected, is_extra,
      expected_count, actual_count, late_count, absent_count, leave_count,
      absent_students, leave_students,
      discipline_tags, discipline_note, remark, client_uuid)
  VALUES (v_plan, u.id, u.name, v_sem, 1,
      (p_payload->>'check_date')::date,
      coalesce((p_payload->>'period_from')::smallint,1), coalesce((p_payload->>'period_to')::smallint,2),
      btrim(p_payload->>'course_name'), btrim(p_payload->>'class_name'),
      btrim(p_payload->>'teacher'), btrim(p_payload->>'room'),
      nullif(btrim(coalesce(p_payload->>'counselor','')),''),
      v_classes, v_other,
      coalesce((p_payload->>'is_extra')::boolean, false),
      coalesce((p_payload->>'expected_count')::int,0), coalesce((p_payload->>'actual_count')::int,0),
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


-- ---------- 12. 增量：旷课/请假名单 ----------
ALTER TABLE check_records ADD COLUMN IF NOT EXISTS absent_students JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE check_records ADD COLUMN IF NOT EXISTS leave_students  JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ---------- 13. 增量：成员自己的班级与负责班级 ----------
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS own_class    TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS duty_grade   TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS duty_classes TEXT;


-- ---------- 14. 增量：照片存库 / 管理员重置密码 / 删除记录 ----------
ALTER TABLE check_record_photos ADD COLUMN IF NOT EXISTS data TEXT;
ALTER TABLE check_record_photos ADD COLUMN IF NOT EXISTS mime TEXT NOT NULL DEFAULT 'image/jpeg';
ALTER TABLE check_record_photos ALTER COLUMN storage_path DROP NOT NULL;

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

CREATE OR REPLACE FUNCTION record_delete(p_token text, p_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; r check_records; v_plan bigint;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION '仅管理员可删除记录'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  SELECT * INTO r FROM check_records WHERE id = p_id;
  IF r.id IS NULL THEN RAISE EXCEPTION '记录不存在'; END IF;
  v_plan := r.plan_id;
  DELETE FROM check_record_photos WHERE record_id = p_id;
  DELETE FROM check_record_revisions WHERE record_id = p_id;
  DELETE FROM check_records WHERE id = p_id;
  IF v_plan IS NOT NULL THEN
    UPDATE check_plans SET status = 'planned', updated_at = now() WHERE id = v_plan AND status = 'submitted';
  END IF;
  RETURN jsonb_build_object('ok', true, 'course_name', r.course_name, 'owner_name', r.owner_name, 'plan_id', v_plan);
END $$;

CREATE OR REPLACE FUNCTION photo_add(p_token text, p_record_id bigint, p_data text, p_mime text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; r check_records; v_cnt int; v_len int; v_id bigint; v_mime text;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  SELECT * INTO r FROM check_records WHERE id = p_record_id;
  IF r.id IS NULL THEN RAISE EXCEPTION '记录不存在'; END IF;
  IF r.owner_id <> u.id AND u.role <> 'admin' THEN RAISE EXCEPTION '无权上传这张记录的照片'; END IF;
  IF r.owner_id = u.id AND u.role <> 'admin' AND r.check_date < current_week_start() THEN
    RAISE EXCEPTION '只能给本周的记录补照片'; END IF;
  v_len := length(coalesce(p_data, ''));
  IF v_len < 100 THEN RAISE EXCEPTION '照片数据为空'; END IF;
  IF v_len > 720000 THEN RAISE EXCEPTION '照片超过 500KB，请压缩后重试'; END IF;
  SELECT count(*) INTO v_cnt FROM check_record_photos WHERE record_id = p_record_id;
  IF v_cnt >= 3 THEN RAISE EXCEPTION '每节课最多 3 张照片'; END IF;
  v_mime := coalesce(nullif(btrim(p_mime), ''), 'image/jpeg');
  IF v_mime NOT LIKE 'image/%' THEN v_mime := 'image/jpeg'; END IF;
  INSERT INTO check_record_photos (record_id, owner_id, bytes, sort_no, data, mime)
  VALUES (p_record_id, u.id, round(v_len * 0.75)::int, v_cnt, p_data, v_mime)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'sort_no', v_cnt, 'bytes', round(v_len * 0.75)::int);
END $$;

CREATE OR REPLACE FUNCTION photo_list(p_token text, p_record_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; r check_records;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  SELECT * INTO r FROM check_records WHERE id = p_record_id;
  IF r.id IS NULL THEN RAISE EXCEPTION '记录不存在'; END IF;
  IF r.owner_id <> u.id AND u.role <> 'admin' THEN RAISE EXCEPTION '无权查看'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', p.id, 'bytes', p.bytes, 'mime', p.mime,
      'sort_no', p.sort_no, 'created_at', p.created_at, 'data', p.data) ORDER BY p.sort_no, p.id)
    FROM check_record_photos p WHERE p.record_id = p_record_id), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION photo_delete(p_token text, p_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; p check_record_photos; r check_records;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  SELECT * INTO p FROM check_record_photos WHERE id = p_id;
  IF p.id IS NULL THEN RAISE EXCEPTION '照片不存在'; END IF;
  SELECT * INTO r FROM check_records WHERE id = p.record_id;
  IF r.owner_id <> u.id AND u.role <> 'admin' THEN RAISE EXCEPTION '无权删除'; END IF;
  IF r.owner_id = u.id AND u.role <> 'admin' AND r.check_date < current_week_start() THEN
    RAISE EXCEPTION '只能删除本周记录的照片'; END IF;
  DELETE FROM check_record_photos WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION staff_reset_password(text,bigint), record_delete(text,bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION photo_add(text,bigint,text,text), photo_list(text,bigint), photo_delete(text,bigint) TO anon, authenticated;


-- ---------- 15. 增量：逐班实到（2026-10-31） ----------
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
      expected_count, actual_count, late_count, absent_count, leave_count,
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
      absent_count = coalesce((p_payload->>'absent_count')::int, absent_count),
      leave_count = coalesce((p_payload->>'leave_count')::int, leave_count),
      remark = nullif(btrim(coalesce(p_payload->>'remark','')),''),
      discipline_note = nullif(btrim(coalesce(p_payload->>'discipline_note','')),''),
      correction_note = btrim(p_payload->>'correction_note')
    WHERE id = p_id RETURNING * INTO r;
  IF r.id IS NULL THEN RAISE EXCEPTION '记录不存在'; END IF;
  RETURN to_jsonb(r);
END $$;


-- ---------- 16. 增量：预计到岗时间（2026-10-31） ----------
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


-- ---------- 17. 增量：辅导员-班级映射（2026-10-31） ----------
-- 2026-10-31 辅导员-班级映射（来源：辅导员联系方式及带班情况表.xlsx，范围已展开，共 68 个班）
CREATE TABLE IF NOT EXISTS counselor_map (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  class_code TEXT NOT NULL UNIQUE,
  counselors TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 种子数据示例（演示用）。真实映射含个人信息，不入库；部署时参考 db/migrate-counselor-map.example.sql
-- INSERT INTO counselor_map(class_code, counselors) VALUES
--   ('13002601', '张老师'),
--   ('13002501', '李老师、王老师'),
--   ('04012401', '刘老师')
-- ON CONFLICT (class_code) DO UPDATE SET counselors = EXCLUDED.counselors, updated_at = now();


-- ---------- 18. 增量：管理员编辑选课 / 修正课程信息（2026-10-31） ----------
-- 详细执行脚本同 db/migrate-admin-edit.sql

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

REVOKE EXECUTE ON FUNCTION admin_plan_get(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_plan_get(text, bigint) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_plan_update(text, bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_plan_update(text, bigint, jsonb) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_record_update(text, bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_record_update(text, bigint, jsonb) TO anon, authenticated;


-- ---------- 19. 增量：班级查课次数（2026-11-01） ----------
-- 详细执行脚本同 db/migrate-class-stats.sql

CREATE OR REPLACE FUNCTION class_stats(p_token text, p_user_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_sem bigint; v_sem_name text; v_rows jsonb := '[]'::jsonb;
  a app_users; v_code text; v_cnt int; v_last date; v_classes jsonb;
  v_total int; v_covered int; v_assigned text; v_records int;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;

  SELECT id, name INTO v_sem, v_sem_name FROM semesters WHERE is_current LIMIT 1;
  IF v_sem IS NULL THEN RAISE EXCEPTION '还没有设置学期'; END IF;

  FOR a IN
    SELECT * FROM app_users x
     WHERE (u.role = 'admin' AND x.role <> 'admin' AND x.status = 'active'
            AND (p_user_id IS NULL OR x.id = p_user_id))
        OR (u.role <> 'admin' AND x.id = u.id)
     ORDER BY x.name
  LOOP
    v_assigned := coalesce(nullif(btrim(coalesce(a.duty_classes, '')), ''), a.own_class, '');
    v_classes := '[]'::jsonb;
    v_total := 0;
    v_covered := 0;

    FOR v_code IN
      SELECT DISTINCT btrim(t) FROM regexp_split_to_table(v_assigned, '[、,，/ ]+') t
       WHERE btrim(t) <> ''
    LOOP
      SELECT count(*), max(r.check_date) INTO v_cnt, v_last
        FROM check_records r
       WHERE r.owner_id = a.id AND r.semester_id = v_sem
         AND (
           EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(r.classes, '[]'::jsonb)) e
                    WHERE e->>'code' = v_code)
           OR (
             jsonb_array_length(coalesce(r.classes, '[]'::jsonb)) = 0
             AND position(v_code in coalesce(r.class_name, '')) > 0
           )
         );
      v_total := v_total + v_cnt;
      IF v_cnt > 0 THEN v_covered := v_covered + 1; END IF;
      v_classes := v_classes || jsonb_build_object('code', v_code, 'count', v_cnt, 'last_date', v_last);
    END LOOP;

    SELECT count(*) INTO v_records FROM check_records r
     WHERE r.owner_id = a.id AND r.semester_id = v_sem;

    v_rows := v_rows || jsonb_build_object(
      'id', a.id,
      'name', a.name,
      'student_no', a.student_no,
      'duty_grade', a.duty_grade,
      'own_class', a.own_class,
      'duty_classes', a.duty_classes,
      'assigned_text', v_assigned,
      'classes', v_classes,
      'total', v_total,
      'covered', v_covered,
      'records', v_records
    );
  END LOOP;

  RETURN jsonb_build_object(
    'is_admin', (u.role = 'admin'),
    'semester', jsonb_build_object('id', v_sem, 'name', v_sem_name),
    'members', v_rows
  );
END $$;

REVOKE EXECUTE ON FUNCTION class_stats(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION class_stats(text, bigint) TO anon, authenticated;


-- ---------- 20. 增量：班级查课次数按周（2026-11-01） ----------
-- 详细执行脚本同 db/migrate-class-stats-week.sql

CREATE OR REPLACE FUNCTION class_stats_week(
  p_token text, p_user_id bigint,
  p_week_from smallint DEFAULT NULL, p_week_to smallint DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_sem bigint; v_sem_name text; v_total_weeks smallint;
  v_now smallint; v_from smallint; v_to smallint; v_tmp smallint;
  v_rows jsonb := '[]'::jsonb; a app_users;
  v_code text; v_grade text; v_cnt int; v_last date; v_classes jsonb;
  v_total int; v_covered int; v_assigned text; v_records int;
  v_all jsonb := '[]'::jsonb; v_cov jsonb := '[]'::jsonb;
  v_total_classes int; v_covered_classes int;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;

  SELECT id, name, total_weeks INTO v_sem, v_sem_name, v_total_weeks
    FROM semesters WHERE is_current LIMIT 1;
  IF v_sem IS NULL THEN RAISE EXCEPTION '还没有设置学期'; END IF;

  v_now := current_week_no(v_sem);
  IF v_now < 1 THEN v_now := 1; END IF;
  IF v_now > v_total_weeks THEN v_now := v_total_weeks; END IF;
  v_from := coalesce(p_week_from, 1::smallint);
  v_to := coalesce(p_week_to, v_now);
  IF v_from < 1 THEN v_from := 1; END IF;
  IF v_from > v_total_weeks THEN v_from := v_total_weeks; END IF;
  IF v_to < 1 THEN v_to := 1; END IF;
  IF v_to > v_total_weeks THEN v_to := v_total_weeks; END IF;
  IF v_from > v_to THEN v_tmp := v_from; v_from := v_to; v_to := v_tmp; END IF;

  FOR a IN
    SELECT * FROM app_users x
     WHERE (u.role = 'admin' AND x.role <> 'admin' AND x.status = 'active'
            AND (p_user_id IS NULL OR x.id = p_user_id))
        OR (u.role <> 'admin' AND x.id = u.id)
     ORDER BY x.name
  LOOP
    v_assigned := coalesce(nullif(btrim(coalesce(a.duty_classes, '')), ''), a.own_class, '');
    v_classes := '[]'::jsonb;
    v_total := 0;
    v_covered := 0;

    FOR v_code IN
      SELECT DISTINCT btrim(t) FROM regexp_split_to_table(v_assigned, '[、,，/ ]+') t
       WHERE btrim(t) <> ''
    LOOP
      SELECT count(*), max(r.check_date) INTO v_cnt, v_last
        FROM check_records r
       WHERE r.owner_id = a.id AND r.semester_id = v_sem
         AND r.week_no BETWEEN v_from AND v_to
         AND (
           EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(r.classes, '[]'::jsonb)) e
                    WHERE e->>'code' = v_code)
           OR (
             jsonb_array_length(coalesce(r.classes, '[]'::jsonb)) = 0
             AND position(v_code in coalesce(r.class_name, '')) > 0
           )
         );

      v_grade := CASE
        WHEN a.duty_grade = '大三' THEN '大三'
        WHEN substr(v_code, 5, 2) = '24' THEN '大三'
        WHEN substr(v_code, 5, 2) = '25' THEN '大二'
        WHEN substr(v_code, 5, 2) = '26' THEN '大一'
        WHEN a.duty_grade IN ('大一', '大二', '大三') THEN a.duty_grade
        ELSE NULL
      END;

      v_total := v_total + v_cnt;
      IF v_cnt > 0 THEN v_covered := v_covered + 1; END IF;
      v_classes := v_classes || jsonb_build_object(
        'code', v_code, 'grade', v_grade, 'count', v_cnt, 'last_date', v_last);
      v_all := v_all || to_jsonb(v_code);
      IF v_cnt > 0 THEN v_cov := v_cov || to_jsonb(v_code); END IF;
    END LOOP;

    SELECT count(*) INTO v_records FROM check_records r
     WHERE r.owner_id = a.id AND r.semester_id = v_sem
       AND r.week_no BETWEEN v_from AND v_to;

    v_rows := v_rows || jsonb_build_object(
      'id', a.id,
      'name', a.name,
      'student_no', a.student_no,
      'duty_grade', a.duty_grade,
      'own_class', a.own_class,
      'duty_classes', a.duty_classes,
      'assigned_text', v_assigned,
      'classes', v_classes,
      'total', v_total,
      'covered', v_covered,
      'records', v_records
    );
  END LOOP;

  SELECT count(DISTINCT value) INTO v_total_classes FROM jsonb_array_elements_text(v_all);
  SELECT count(DISTINCT value) INTO v_covered_classes FROM jsonb_array_elements_text(v_cov);

  RETURN jsonb_build_object(
    'is_admin', (u.role = 'admin'),
    'semester', jsonb_build_object('id', v_sem, 'name', v_sem_name),
    'week_from', v_from,
    'week_to', v_to,
    'total_weeks', v_total_weeks,
    'total_classes', v_total_classes,
    'covered_classes', v_covered_classes,
    'members', v_rows
  );
END $$;

REVOKE EXECUTE ON FUNCTION class_stats_week(text, bigint, smallint, smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION class_stats_week(text, bigint, smallint, smallint) TO anon, authenticated;


-- ---------- 18. 增量：管理员计划编辑 + 班级查课统计（2026-11-01） ----------
-- admin_plan_get(p_token, p_id) / admin_plan_update(p_token, p_id, p_payload) / class_stats(p_token, p_user_id)
-- 由 Agent 于 2026-11-01 直接在云端执行定义（与前端 stats.js、AdminPlanEdit 对接）：
--   admin_plan_get     仅管理员读计划整行
--   admin_plan_update  仅管理员改待填报计划（可改归属 owner_id、课程、班级、到岗），只允许 status='planned'
--   class_stats        班级查课次数：按 duty_classes 展开负责班级，统计每人每班被查次数（records.classes 或 class_name 包含）；
--                      管理员看全部课检员（不含管理员），成员只看自己；返回 {is_admin, semester, members:[{classes:[{code,count,last_date}],covered,total,records,...}]}


-- ---------- 19. 增量：管理员彻底删除（2026-11-01） ----------
-- 2026-11-01 管理员：真正的删除（连同选课计划一并删除）
-- record_delete 保持原语义（打回：记录删除、计划回到待填报）
CREATE OR REPLACE FUNCTION record_delete_hard(p_token text, p_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; r check_records; v_plan bigint;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.role <> 'admin' THEN RAISE EXCEPTION '仅管理员可删除记录'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  SELECT * INTO r FROM check_records WHERE id = p_id;
  IF r.id IS NULL THEN RAISE EXCEPTION '记录不存在'; END IF;
  v_plan := r.plan_id;
  DELETE FROM check_record_photos WHERE record_id = p_id;
  DELETE FROM check_record_revisions WHERE record_id = p_id;
  DELETE FROM check_records WHERE id = p_id;
  IF v_plan IS NOT NULL THEN
    DELETE FROM check_plans WHERE id = v_plan;
  END IF;
  RETURN jsonb_build_object('ok', true, 'course_name', r.course_name, 'owner_name', r.owner_name, 'plan_deleted', v_plan IS NOT NULL);
END $$;


-- ---------- 20. 增量：my_records 修复（2026-11-01） ----------
-- 2026-11-01 修复 my_records：原实现 jsonb_agg(x ORDER BY x.check_date) 中 x 是 jsonb 对象别名，
-- Postgres 把 x.check_date 解析为表 x 的列 → "missing FROM-clause entry for table x"。
-- 改为子查询选真实列（别名 x）再 to_jsonb(x)，ORDER BY 走真实列。
CREATE OR REPLACE FUNCTION my_records(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u app_users; v_sem bigint;
BEGIN
  SELECT * INTO u FROM require_user(p_token);
  IF u.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
  IF u.must_change THEN RAISE EXCEPTION '请先修改初始密码'; END IF;
  SELECT id INTO v_sem FROM semesters WHERE is_current LIMIT 1;
  IF v_sem IS NULL THEN RAISE EXCEPTION '还没有设置学期'; END IF;

  RETURN coalesce((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.check_date DESC, x.period_from DESC, x.id DESC)
      FROM (
        SELECT r.id, r.course_name, r.class_name, r.check_date, r.week_no,
               r.period_from, r.period_to, r.teacher, r.room, r.arrive_before,
               r.expected_count, r.actual_count, r.absent_count, r.leave_count,
               r.classes, r.other_expected, r.other_actual,
               r.absent_students, r.leave_students,
               r.discipline_tags, r.discipline_note, r.remark, r.teacher_status,
               r.phone_count, r.sleep_count, r.phone_10, r.sleep_10, r.phone_30, r.sleep_30,
               r.is_extra, r.submitted_at, r.corrected_count,
               (r.check_date >= current_week_start()) AS can_edit,
               EXISTS (SELECT 1 FROM record_edit_requests q
                        WHERE q.record_id = r.id AND q.status = 'pending') AS pending_request
          FROM check_records r
         WHERE r.owner_id = u.id AND r.semester_id = v_sem
      ) x), '[]'::jsonb);
END $$;


-- ---------- 21. 增量：修改一律需审核（2026-11-01） ----------
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
