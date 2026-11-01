-- 示例：辅导员-班级映射（演示数据，部署时替换为你自己的名单）
-- 真实映射含个人信息，请勿提交到公开仓库（本地文件已在 .gitignore 中）
CREATE TABLE IF NOT EXISTS counselor_map (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  class_code TEXT NOT NULL UNIQUE,
  counselors TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO counselor_map(class_code, counselors)
SELECT e.key, e.value FROM jsonb_each('{
  "04012401": "张老师",
  "04012501": "李老师、王老师",
  "04012601": "刘老师",
  "04682601": "陈老师",
  "13002401": "赵老师",
  "13002407": "孙老师",
  "13002501": "周老师",
  "13002510": "周老师、吴老师",
  "13002601": "郑老师",
  "13002608": "冯老师",
  "13902401": "赵老师"
}'::jsonb) e
ON CONFLICT (class_code) DO UPDATE SET counselors = EXCLUDED.counselors, updated_at = now();
