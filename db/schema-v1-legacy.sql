-- 学风查课 · 数据库结构与权限（PostgreSQL / 云数据库）
-- 用途：灾备重建、迁移、审计。逐条执行（云数据库的 exec_sql 每次只接受一条语句，
-- 或在 SQL 编辑器里整段执行）。
-- 依赖：auth.uid()（平台提供）、pgcrypto（CREATE EXTENSION IF NOT EXISTS pgcrypto）。

-- ---------- 1. 表 ----------
CREATE TABLE semesters (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  start_monday DATE NOT NULL,
  total_weeks SMALLINT NOT NULL CHECK (total_weeks BETWEEN 1 AND 30),
  is_current BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX semesters_one_current ON semesters(is_current) WHERE is_current;

CREATE TABLE members (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id TEXT NOT NULL UNIQUE DEFAULT auth.uid(),
  display_name TEXT NOT NULL,
  student_no TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('leader','member')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','disabled')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE check_plans (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT auth.uid(),
  owner_name TEXT,
  semester_id BIGINT NOT NULL REFERENCES semesters(id),
  week_no SMALLINT NOT NULL,
  check_date DATE NOT NULL,
  period_from SMALLINT NOT NULL CHECK (period_from BETWEEN 1 AND 12),
  period_to SMALLINT NOT NULL CHECK (period_to BETWEEN 1 AND 12),
  course_name TEXT NOT NULL,
  class_name TEXT NOT NULL,
  teacher TEXT,
  room TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','submitted','void')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_to >= period_from)
);
CREATE INDEX plans_owner_week ON check_plans(owner_id, semester_id, week_no);
CREATE INDEX plans_sem_week_status ON check_plans(semester_id, week_no, status);

CREATE TABLE check_records (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  plan_id BIGINT UNIQUE REFERENCES check_plans(id),
  owner_id TEXT NOT NULL DEFAULT auth.uid(),
  owner_name TEXT,
  semester_id BIGINT NOT NULL REFERENCES semesters(id),
  week_no SMALLINT NOT NULL,
  check_date DATE NOT NULL,
  period_from SMALLINT NOT NULL,
  period_to SMALLINT NOT NULL,
  course_name TEXT NOT NULL,
  class_name TEXT NOT NULL,
  teacher TEXT,
  room TEXT,
  is_extra BOOLEAN NOT NULL DEFAULT false,
  expected_count INTEGER CHECK (expected_count IS NULL OR expected_count >= 0),
  actual_count INTEGER CHECK (actual_count IS NULL OR actual_count >= 0),
  late_count INTEGER NOT NULL DEFAULT 0 CHECK (late_count >= 0),
  early_count INTEGER NOT NULL DEFAULT 0 CHECK (early_count >= 0),
  absent_count INTEGER NOT NULL DEFAULT 0 CHECK (absent_count >= 0),
  leave_count INTEGER NOT NULL DEFAULT 0 CHECK (leave_count >= 0),
  discipline_tags TEXT[] NOT NULL DEFAULT '{}',
  discipline_note TEXT,
  remark TEXT,
  correction_note TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  corrected_count SMALLINT NOT NULL DEFAULT 0,
  last_corrected_at TIMESTAMPTZ
);
CREATE INDEX rec_sem_week ON check_records(semester_id, week_no);
CREATE INDEX rec_owner ON check_records(owner_id, check_date);

CREATE TABLE check_record_photos (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  record_id BIGINT NOT NULL REFERENCES check_records(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL DEFAULT auth.uid(),
  storage_path TEXT NOT NULL,
  bytes INTEGER,
  sort_no SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX photos_record ON check_record_photos(record_id);

CREATE TABLE check_record_revisions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  record_id BIGINT NOT NULL,
  editor_id TEXT,
  editor_role TEXT NOT NULL CHECK (editor_role IN ('member','leader')),
  action TEXT NOT NULL CHECK (action IN ('member_self_edit','leader_correct')),
  reason TEXT,
  before_row JSONB,
  after_row JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX rev_record ON check_record_revisions(record_id, created_at DESC);

CREATE TABLE app_config (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  max_photos SMALLINT NOT NULL DEFAULT 3,
  max_photo_kb INTEGER NOT NULL DEFAULT 400,
  allow_backfill BOOLEAN NOT NULL DEFAULT true,
  max_planned_weeks SMALLINT NOT NULL DEFAULT 4
);

-- 学号 -> 平台手机号 的登录映射。该表不授予任何客户端角色，仅可由下面的
-- SECURITY DEFINER 函数访问；手机号永远不会暴露给浏览器。
CREATE TABLE login_index (
  student_no TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL UNIQUE,
  display_name TEXT,
  phone TEXT NOT NULL,
  pwd_hash TEXT NOT NULL,
  failed_cnt SMALLINT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 2. 判定函数 ----------
CREATE OR REPLACE FUNCTION is_leader() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT EXISTS (SELECT 1 FROM members WHERE owner_id = auth.uid() AND role = 'leader' AND status = 'active')
$$;

CREATE OR REPLACE FUNCTION is_active_member() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT EXISTS (SELECT 1 FROM members WHERE owner_id = auth.uid() AND status = 'active')
$$;

CREATE OR REPLACE FUNCTION current_week_start() RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT (date_trunc('week', (now() AT TIME ZONE 'Asia/Shanghai')))::date
$$;

CREATE OR REPLACE FUNCTION current_week_no(p_sem BIGINT) RETURNS smallint
LANGUAGE sql STABLE AS $$
  SELECT (((date_trunc('week', (now() AT TIME ZONE 'Asia/Shanghai')))::date - s.start_monday) / 7 + 1)::smallint
  FROM semesters s WHERE s.id = p_sem
$$;

-- ---------- 3. 触发器 ----------
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF NEW.plan_id IS NOT NULL THEN
    UPDATE check_plans SET status = 'submitted', updated_at = now() WHERE id = NEW.plan_id AND status = 'planned';
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE v_leader boolean := is_leader();
BEGIN
  INSERT INTO check_record_revisions(record_id, editor_id, editor_role, action, reason, before_row, after_row)
  VALUES (NEW.id, auth.uid(), CASE WHEN v_leader THEN 'leader' ELSE 'member' END,
          CASE WHEN v_leader THEN 'leader_correct' ELSE 'member_self_edit' END,
          NEW.correction_note, to_jsonb(OLD), to_jsonb(NEW));
  RETURN NULL;
END $$;

CREATE TRIGGER trg_plans_week BEFORE INSERT OR UPDATE ON check_plans FOR EACH ROW EXECUTE FUNCTION set_week_no();
CREATE TRIGGER trg_rec_week BEFORE INSERT OR UPDATE ON check_records FOR EACH ROW EXECUTE FUNCTION set_week_no();
CREATE TRIGGER trg_rec_stamp BEFORE UPDATE ON check_records FOR EACH ROW EXECUTE FUNCTION rec_stamp_correction();
CREATE TRIGGER trg_rec_log AFTER UPDATE ON check_records FOR EACH ROW EXECUTE FUNCTION rec_log_revision();
CREATE TRIGGER trg_plan_submitted AFTER INSERT ON check_records FOR EACH ROW EXECUTE FUNCTION mark_plan_submitted();

-- ---------- 4. 登录 / 注册 RPC ----------
CREATE OR REPLACE FUNCTION app_register_member(p_student_no text, p_name text, p_phone text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE v_uid text := auth.uid(); v_no text := btrim(p_student_no); v_first boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '请先完成短信验证'; END IF;
  IF v_no IS NULL OR v_no !~ '^[0-9A-Za-z]{4,20}$' THEN RAISE EXCEPTION '学号格式不正确'; END IF;
  IF p_name IS NULL OR length(btrim(p_name)) < 2 THEN RAISE EXCEPTION '请填写姓名'; END IF;
  IF p_phone IS NULL OR p_phone !~ '^1[0-9]{10}$' THEN RAISE EXCEPTION '手机号格式不正确'; END IF;
  IF p_password IS NULL OR length(p_password) < 8 THEN RAISE EXCEPTION '密码至少 8 位'; END IF;
  IF EXISTS (SELECT 1 FROM login_index WHERE student_no = v_no AND owner_id <> v_uid) THEN
    RAISE EXCEPTION '该学号已被其他账号注册';
  END IF;
  -- 系统里还没有在用组长时，第一个注册的人自动成为组长并直接通过审核
  SELECT NOT EXISTS (SELECT 1 FROM members WHERE role = 'leader' AND status = 'active') INTO v_first;
  INSERT INTO members(owner_id, display_name, student_no, role, status)
  VALUES (v_uid, btrim(p_name), v_no,
          CASE WHEN v_first THEN 'leader' ELSE 'member' END,
          CASE WHEN v_first THEN 'active' ELSE 'pending' END)
  ON CONFLICT (owner_id) DO UPDATE SET display_name = EXCLUDED.display_name, student_no = EXCLUDED.student_no;
  INSERT INTO login_index(student_no, owner_id, display_name, phone, pwd_hash, failed_cnt, locked_until)
  VALUES (v_no, v_uid, btrim(p_name), p_phone, crypt(p_password, gen_salt('bf', 10)), 0, NULL)
  ON CONFLICT (student_no) DO UPDATE
    SET phone = EXCLUDED.phone, pwd_hash = EXCLUDED.pwd_hash, display_name = EXCLUDED.display_name,
        failed_cnt = 0, locked_until = NULL
    WHERE login_index.owner_id = v_uid;
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION app_login_resolve(p_student_no text, p_password text)
RETURNS TABLE(bound_phone text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE v_row login_index%ROWTYPE;
BEGIN
  IF p_student_no IS NULL OR p_password IS NULL OR length(btrim(p_student_no)) < 3 THEN RETURN; END IF;
  PERFORM pg_sleep(0.3);
  SELECT * INTO v_row FROM login_index WHERE student_no = btrim(p_student_no);
  IF NOT FOUND THEN RETURN; END IF;
  IF v_row.locked_until IS NOT NULL AND v_row.locked_until > now() THEN RETURN; END IF;
  IF v_row.pwd_hash = crypt(p_password, v_row.pwd_hash) THEN
    UPDATE login_index SET failed_cnt = 0, locked_until = NULL WHERE student_no = v_row.student_no;
    RETURN QUERY SELECT v_row.phone;
  ELSE
    UPDATE login_index SET failed_cnt = v_row.failed_cnt + 1,
      locked_until = CASE WHEN v_row.failed_cnt + 1 >= 5 THEN now() + interval '15 minutes' ELSE v_row.locked_until END
      WHERE student_no = v_row.student_no;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app_update_local_password(p_old text, p_new text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE v_uid text := auth.uid(); v_hash text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  IF p_new IS NULL OR length(p_new) < 8 THEN RAISE EXCEPTION '新密码至少 8 位'; END IF;
  SELECT pwd_hash INTO v_hash FROM login_index WHERE owner_id = v_uid;
  IF v_hash IS NULL OR v_hash <> crypt(p_old, v_hash) THEN RAISE EXCEPTION '原密码不正确'; END IF;
  UPDATE login_index SET pwd_hash = crypt(p_new, gen_salt('bf', 10)) WHERE owner_id = v_uid;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION leader_member_phone(p_student_no text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF NOT is_leader() THEN RAISE EXCEPTION '仅组长可查看'; END IF;
  RETURN (SELECT phone FROM login_index WHERE student_no = btrim(p_student_no));
END $$;

REVOKE EXECUTE ON FUNCTION app_register_member(text,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_login_resolve(text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_update_local_password(text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION leader_member_phone(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_register_member(text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION app_login_resolve(text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION app_update_local_password(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION leader_member_phone(text) TO authenticated;

-- ---------- 5. RLS ----------
ALTER TABLE semesters ENABLE ROW LEVEL SECURITY;
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_record_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_record_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_index ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON TABLE public.semesters TO authenticated;
GRANT SELECT, UPDATE ON TABLE public.members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.check_plans TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.check_records TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.check_record_photos TO authenticated;
GRANT SELECT ON TABLE public.check_record_revisions TO authenticated;
GRANT SELECT, UPDATE ON TABLE public.app_config TO authenticated;

CREATE POLICY sem_read ON semesters FOR SELECT TO authenticated USING (true);
CREATE POLICY sem_insert ON semesters FOR INSERT TO authenticated WITH CHECK (is_leader());
CREATE POLICY sem_update ON semesters FOR UPDATE TO authenticated USING (is_leader()) WITH CHECK (is_leader());

CREATE POLICY mem_read ON members FOR SELECT TO authenticated USING (owner_id = auth.uid() OR is_leader());
CREATE POLICY mem_update_leader ON members FOR UPDATE TO authenticated USING (is_leader()) WITH CHECK (is_leader());

CREATE POLICY plan_read ON check_plans FOR SELECT TO authenticated USING (owner_id = auth.uid() OR is_leader());
CREATE POLICY plan_insert_own ON check_plans FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid() AND is_active_member() AND status = 'planned'
              AND week_no >= current_week_no(semester_id)
              AND week_no <= current_week_no(semester_id) + 4);
CREATE POLICY plan_update_own ON check_plans FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() AND status = 'planned' AND is_active_member())
  WITH CHECK (owner_id = auth.uid() AND status IN ('planned','void'));
CREATE POLICY plan_update_leader ON check_plans FOR UPDATE TO authenticated USING (is_leader()) WITH CHECK (is_leader());
CREATE POLICY plan_delete_own ON check_plans FOR DELETE TO authenticated
  USING (owner_id = auth.uid() AND status = 'planned' AND is_active_member());
CREATE POLICY plan_delete_leader ON check_plans FOR DELETE TO authenticated USING (is_leader());

CREATE POLICY rec_read ON check_records FOR SELECT TO authenticated USING (owner_id = auth.uid() OR is_leader());
CREATE POLICY rec_insert_own ON check_records FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid() AND is_active_member());
CREATE POLICY rec_update_own ON check_records FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() AND is_active_member() AND check_date >= current_week_start())
  WITH CHECK (owner_id = auth.uid() AND check_date >= current_week_start());
CREATE POLICY rec_update_leader ON check_records FOR UPDATE TO authenticated USING (is_leader()) WITH CHECK (is_leader());

CREATE POLICY photo_read ON check_record_photos FOR SELECT TO authenticated USING (owner_id = auth.uid() OR is_leader());
CREATE POLICY photo_insert_own ON check_record_photos FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid() AND is_active_member());
CREATE POLICY photo_delete_own ON check_record_photos FOR DELETE TO authenticated
  USING (owner_id = auth.uid() AND EXISTS (
    SELECT 1 FROM check_records r WHERE r.id = record_id AND r.owner_id = auth.uid() AND r.check_date >= current_week_start()));

CREATE POLICY rev_read ON check_record_revisions FOR SELECT TO authenticated
  USING (is_leader() OR EXISTS (
    SELECT 1 FROM check_records r WHERE r.id = record_id AND r.owner_id = auth.uid()));

CREATE POLICY cfg_read ON app_config FOR SELECT TO authenticated USING (true);
CREATE POLICY cfg_update_leader ON app_config FOR UPDATE TO authenticated USING (is_leader()) WITH CHECK (is_leader());

-- ---------- 6. 初始数据 ----------
INSERT INTO app_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
INSERT INTO semesters (name, start_monday, total_weeks, is_current) VALUES ('2026-2027 学年第一学期', DATE '2026-08-31', 18, true);

-- ---------- 7. 首个组长怎么产生 ----------
-- 规则：系统里还没有「在用组长」时，第一个完成注册的人自动成为组长并直接通过审核。
-- 所以务必由组长本人先注册，再把链接发给组员；否则第一个注册的组员会拿到组长权限。
--
-- 如果已经发错顺序，用下面这条 SQL 纠正（把两个学号换成实际的）：
--   UPDATE members SET role='leader', status='active' WHERE student_no='<组长的学号>';
--   UPDATE members SET role='member' WHERE student_no='<误成组长的学号>';
-- 建议设置 2 个组长，防止单账号出问题后无人可管。
