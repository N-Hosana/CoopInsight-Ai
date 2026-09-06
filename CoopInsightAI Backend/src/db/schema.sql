-- CoopInsight AI — PostgreSQL Schema
-- Run once against a fresh database: psql -U postgres -d coopinsight_ai -f schema.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── USERS ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                  VARCHAR(150) NOT NULL,
  email                 VARCHAR(255) UNIQUE NOT NULL,
  password_hash         VARCHAR(255) NOT NULL,
  phone                 VARCHAR(20),
  role                  VARCHAR(30) NOT NULL CHECK (role IN ('admin','manager','generalManager','member','government','cooperative')),
  status                VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','suspended')),
  sector                VARCHAR(50),
  cell                  VARCHAR(50),
  cooperative_id        UUID,
  national_id           VARCHAR(50),
  email_verified        BOOLEAN NOT NULL DEFAULT FALSE,
  refresh_token         TEXT,
  failed_attempts       INT NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  last_login_at         TIMESTAMPTZ,
  last_password_changed_at TIMESTAMPTZ,
  suspension_reason     TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_verifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       VARCHAR(100) UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code        VARCHAR(6) NOT NULL,
  purpose     VARCHAR(30) NOT NULL DEFAULT 'login' CHECK (purpose IN ('login','2fa_setup','password_reset')),
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS password_resets (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email       VARCHAR(255) NOT NULL,
  code        VARCHAR(6) NOT NULL,
  token       VARCHAR(100) UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device          VARCHAR(255),
  ip_address      VARCHAR(45),
  user_agent      TEXT,
  last_active_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_settings (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                   UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  theme                     VARCHAR(10) NOT NULL DEFAULT 'light' CHECK (theme IN ('light','dark','system')),
  language                  VARCHAR(5) NOT NULL DEFAULT 'en' CHECK (language IN ('en','rw')),
  font_size                 VARCHAR(10) NOT NULL DEFAULT 'medium' CHECK (font_size IN ('small','medium','large')),
  compact_mode              BOOLEAN NOT NULL DEFAULT FALSE,
  email_notifications       BOOLEAN NOT NULL DEFAULT TRUE,
  sms_notifications         BOOLEAN NOT NULL DEFAULT FALSE,
  in_app_notifications      BOOLEAN NOT NULL DEFAULT TRUE,
  loan_due_reminders        BOOLEAN NOT NULL DEFAULT TRUE,
  activity_reminders        BOOLEAN NOT NULL DEFAULT TRUE,
  monthly_reports           BOOLEAN NOT NULL DEFAULT FALSE,
  compliance_alerts         BOOLEAN NOT NULL DEFAULT TRUE,
  new_member_alerts         BOOLEAN NOT NULL DEFAULT FALSE,
  login_notifications       BOOLEAN NOT NULL DEFAULT TRUE,
  reminder_days_before      INT NOT NULL DEFAULT 3,
  two_factor_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  session_timeout           INT NOT NULL DEFAULT 30,
  profile_visible_to_members BOOLEAN NOT NULL DEFAULT TRUE,
  share_data_with_government BOOLEAN NOT NULL DEFAULT TRUE,
  data_export_requested     BOOLEAN NOT NULL DEFAULT FALSE,
  data_export_requested_at  TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── COOPERATIVES ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cooperatives (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                  VARCHAR(200) NOT NULL,
  type                  VARCHAR(50) NOT NULL,
  status                VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','suspended')),
  sector                VARCHAR(50) NOT NULL,
  cell                  VARCHAR(50),
  village               VARCHAR(50),
  registration_number   VARCHAR(100) UNIQUE NOT NULL,
  registration_date     DATE,
  description           TEXT,
  phone                 VARCHAR(20),
  email                 VARCHAR(255),
  address               TEXT,
  health_score          NUMERIC(5,2) NOT NULL DEFAULT 0,
  total_savings         NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_loans           NUMERIC(15,2) NOT NULL DEFAULT 0,
  deleted_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD CONSTRAINT fk_users_cooperative
  FOREIGN KEY (cooperative_id) REFERENCES cooperatives(id) ON DELETE SET NULL
  NOT VALID;

CREATE TABLE IF NOT EXISTS cooperative_leadership (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cooperative_id  UUID NOT NULL REFERENCES cooperatives(id) ON DELETE CASCADE,
  name            VARCHAR(150) NOT NULL,
  role            VARCHAR(100) NOT NULL,
  phone           VARCHAR(20),
  email           VARCHAR(255),
  start_date      DATE,
  end_date        DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cooperative_documents (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cooperative_id  UUID NOT NULL REFERENCES cooperatives(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  type            VARCHAR(50) NOT NULL CHECK (type IN ('registration','financial','minutes','policy','report','other')),
  description     TEXT,
  url             TEXT NOT NULL,
  size_bytes      BIGINT,
  uploaded_by     UUID REFERENCES users(id),
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cooperative_health_scores (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cooperative_id          UUID NOT NULL REFERENCES cooperatives(id) ON DELETE CASCADE,
  overall_score           NUMERIC(5,2) NOT NULL,
  financial_health        NUMERIC(5,2) NOT NULL DEFAULT 0,
  member_engagement       NUMERIC(5,2) NOT NULL DEFAULT 0,
  activity_compliance     NUMERIC(5,2) NOT NULL DEFAULT 0,
  document_completeness   NUMERIC(5,2) NOT NULL DEFAULT 0,
  trend                   VARCHAR(20) NOT NULL DEFAULT 'stable' CHECK (trend IN ('improving','stable','declining')),
  recommendations         JSONB,
  model_version           VARCHAR(50),
  computed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── MEMBERS ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS members (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cooperative_id      UUID NOT NULL REFERENCES cooperatives(id) ON DELETE CASCADE,
  full_name           VARCHAR(150) NOT NULL,
  email               VARCHAR(255),
  phone               VARCHAR(20) NOT NULL,
  national_id         VARCHAR(50) UNIQUE NOT NULL,
  gender              VARCHAR(10) CHECK (gender IN ('male','female','other')),
  date_of_birth       DATE,
  address             TEXT,
  sector              VARCHAR(50),
  cell                VARCHAR(50),
  village             VARCHAR(50),
  photo_url           TEXT,
  membership_number   VARCHAR(100) UNIQUE NOT NULL,
  membership_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  role                VARCHAR(30) NOT NULL DEFAULT 'member' CHECK (role IN ('member','treasurer','secretary','chairperson')),
  status              VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','suspended')),
  total_savings       NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_contributions NUMERIC(15,2) NOT NULL DEFAULT 0,
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS member_status_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id   UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  old_status  VARCHAR(20) NOT NULL,
  new_status  VARCHAR(20) NOT NULL,
  reason      TEXT,
  changed_by  UUID REFERENCES users(id),
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS member_contributions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id   UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  amount      NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  type        VARCHAR(30) NOT NULL CHECK (type IN ('savings','share_capital','special_levy')),
  date        DATE NOT NULL,
  notes       TEXT,
  recorded_by UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loan_records (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id       UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  cooperative_id  UUID NOT NULL REFERENCES cooperatives(id),
  amount          NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  balance         NUMERIC(15,2) NOT NULL,
  purpose         TEXT NOT NULL,
  interest_rate   NUMERIC(5,2) NOT NULL DEFAULT 0,
  status          VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','repaid','overdue','written_off')),
  due_at          DATE NOT NULL,
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at       TIMESTAMPTZ,
  notes           TEXT,
  issued_by       UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loan_repayments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  loan_id     UUID NOT NULL REFERENCES loan_records(id) ON DELETE CASCADE,
  amount      NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  date        DATE NOT NULL,
  notes       TEXT,
  recorded_by UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dividend_records (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id       UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  cooperative_id  UUID NOT NULL REFERENCES cooperatives(id),
  amount          NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  period          VARCHAR(20) NOT NULL,
  paid_at         DATE,
  notes           TEXT,
  recorded_by     UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (member_id, period)
);

-- ─── TRANSACTIONS ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS financial_periods (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cooperative_id  UUID NOT NULL REFERENCES cooperatives(id) ON DELETE CASCADE,
  label           VARCHAR(100) NOT NULL,
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cooperative_id      UUID NOT NULL REFERENCES cooperatives(id) ON DELETE CASCADE,
  type                VARCHAR(10) NOT NULL CHECK (type IN ('income','expense')),
  category            VARCHAR(50) NOT NULL,
  amount              NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  date                DATE NOT NULL,
  description         TEXT NOT NULL,
  reference           VARCHAR(100),
  member_id           UUID REFERENCES members(id),
  payment_method      VARCHAR(30) CHECK (payment_method IN ('cash','bank_transfer','mobile_money','cheque')),
  mobile_money_ref    VARCHAR(100),
  bank_ref            VARCHAR(100),
  attachment_url      TEXT,
  notes               TEXT,
  status              VARCHAR(20) NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','cancelled','reversed')),
  cancellation_reason TEXT,
  recorded_by         UUID REFERENCES users(id),
  approved_by         UUID REFERENCES users(id),
  approved_at         TIMESTAMPTZ,
  period_id           UUID REFERENCES financial_periods(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS balance_sheets (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cooperative_id      UUID NOT NULL REFERENCES cooperatives(id) ON DELETE CASCADE,
  period_id           UUID REFERENCES financial_periods(id),
  period_start        DATE NOT NULL,
  period_end          DATE NOT NULL,
  cash                NUMERIC(15,2) NOT NULL DEFAULT 0,
  bank_balance        NUMERIC(15,2) NOT NULL DEFAULT 0,
  loans_outstanding   NUMERIC(15,2) NOT NULL DEFAULT 0,
  inventory           NUMERIC(15,2) NOT NULL DEFAULT 0,
  fixed_assets        NUMERIC(15,2) NOT NULL DEFAULT 0,
  member_savings      NUMERIC(15,2) NOT NULL DEFAULT 0,
  external_loans      NUMERIC(15,2) NOT NULL DEFAULT 0,
  accounts_payable    NUMERIC(15,2) NOT NULL DEFAULT 0,
  share_capital       NUMERIC(15,2) NOT NULL DEFAULT 0,
  retained_earnings   NUMERIC(15,2) NOT NULL DEFAULT 0,
  generated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── ACTIVITIES ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS activities (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cooperative_id  UUID NOT NULL REFERENCES cooperatives(id) ON DELETE CASCADE,
  title           VARCHAR(255) NOT NULL,
  type            VARCHAR(30) NOT NULL CHECK (type IN ('meeting','training','production','sales','distribution','planning')),
  status          VARCHAR(20) NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','ongoing','completed','cancelled')),
  date            DATE NOT NULL,
  start_time      TIME,
  end_time        TIME,
  location        VARCHAR(255),
  description     TEXT,
  objectives      JSONB,
  outcome         TEXT,
  impact          TEXT,
  budget          NUMERIC(15,2) NOT NULL DEFAULT 0,
  actual_cost     NUMERIC(15,2) NOT NULL DEFAULT 0,
  cancellation_reason TEXT,
  created_by      UUID REFERENCES users(id),
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity_participants (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  activity_id  UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  member_id    UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  role         VARCHAR(50),
  attended     BOOLEAN NOT NULL DEFAULT FALSE,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (activity_id, member_id)
);

CREATE TABLE IF NOT EXISTS activity_attachments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  activity_id  UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  name         VARCHAR(255) NOT NULL,
  url          TEXT NOT NULL,
  size_bytes   BIGINT,
  description  TEXT,
  uploaded_by  UUID REFERENCES users(id),
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── REPORTS & BUDGETS ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reports (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title           VARCHAR(255) NOT NULL,
  type            VARCHAR(50) NOT NULL,
  cooperative_id  UUID REFERENCES cooperatives(id),
  parameters      JSONB,
  content         JSONB,
  file_url        TEXT,
  format          VARCHAR(10) CHECK (format IN ('pdf','csv','xlsx','txt')),
  generated_by    UUID REFERENCES users(id),
  schedule_id     UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS report_schedules (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type            VARCHAR(50) NOT NULL,
  cooperative_id  UUID REFERENCES cooperatives(id),
  frequency       VARCHAR(20) NOT NULL CHECK (frequency IN ('daily','weekly','monthly','quarterly')),
  format          VARCHAR(10) NOT NULL,
  recipients      JSONB NOT NULL,
  title           VARCHAR(255),
  next_run_at     TIMESTAMPTZ,
  last_run_at     TIMESTAMPTZ,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS budgets (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cooperative_id  UUID NOT NULL REFERENCES cooperatives(id) ON DELETE CASCADE,
  title           VARCHAR(255) NOT NULL,
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  total_planned   NUMERIC(15,2) NOT NULL DEFAULT 0,
  status          VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','closed')),
  notes           TEXT,
  approved_by     UUID REFERENCES users(id),
  approved_at     TIMESTAMPTZ,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS budget_lines (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  budget_id       UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  category        VARCHAR(100) NOT NULL,
  description     TEXT,
  planned_amount  NUMERIC(15,2) NOT NULL CHECK (planned_amount > 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── MESSAGES ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type            VARCHAR(20) NOT NULL CHECK (type IN ('personal','broadcast','cooperative')),
  subject         VARCHAR(255) NOT NULL,
  body            TEXT NOT NULL,
  sender_id       UUID NOT NULL REFERENCES users(id),
  recipient_id    UUID REFERENCES users(id),
  cooperative_id  UUID REFERENCES cooperatives(id),
  read_at         TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS message_replies (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  sender_id   UUID NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── NOTIFICATIONS ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       VARCHAR(255) NOT NULL,
  message     TEXT NOT NULL,
  type        VARCHAR(50) NOT NULL,
  link        TEXT,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sms_logs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_ids   JSONB NOT NULL,
  message      TEXT NOT NULL,
  sent_by      UUID REFERENCES users(id),
  status       VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','failed')),
  provider_ref VARCHAR(100),
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── SECURITY ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_logs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category     VARCHAR(50) NOT NULL,
  action       VARCHAR(100) NOT NULL,
  resource     VARCHAR(100) NOT NULL,
  resource_id  UUID,
  status       VARCHAR(20) NOT NULL CHECK (status IN ('success','failure','warning')),
  user_id      UUID REFERENCES users(id),
  ip_address   VARCHAR(45),
  user_agent   TEXT,
  details      JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS login_activity (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID REFERENCES users(id),
  email        VARCHAR(255),
  status       VARCHAR(20) NOT NULL CHECK (status IN ('success','failed','locked')),
  ip_address   VARCHAR(45),
  user_agent   TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS security_anomalies (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type             VARCHAR(100) NOT NULL,
  severity         VARCHAR(20) NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  description      TEXT NOT NULL,
  affected_user_id UUID REFERENCES users(id),
  details          JSONB,
  resolved_at      TIMESTAMPTZ,
  resolved_by      UUID REFERENCES users(id),
  resolution       TEXT,
  notes            TEXT,
  detected_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── INTEGRATIONS ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS integration_configs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  integration_id  VARCHAR(50) NOT NULL,
  config          JSONB NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected','disconnected','error')),
  webhook_url     TEXT,
  error_message   TEXT,
  error_details   JSONB,
  last_synced_at  TIMESTAMPTZ,
  last_tested_at  TIMESTAMPTZ,
  connected_by    UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integration_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  integration_id  VARCHAR(50) NOT NULL,
  event           VARCHAR(100) NOT NULL,
  status          VARCHAR(20) NOT NULL CHECK (status IN ('success','error','warning')),
  details         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhooks (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  integration_id  VARCHAR(50) NOT NULL,
  event           VARCHAR(100) NOT NULL,
  url             TEXT NOT NULL,
  secret_hash     TEXT,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── AI ───────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_insights (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type              VARCHAR(30) NOT NULL CHECK (type IN ('insight','recommendation','anomaly','forecast')),
  severity          VARCHAR(20) CHECK (severity IN ('info','warning','critical')),
  title             VARCHAR(255) NOT NULL,
  summary           TEXT NOT NULL,
  detail            TEXT,
  cooperative_id    UUID REFERENCES cooperatives(id),
  affected_metric   VARCHAR(100),
  current_value     NUMERIC(15,2),
  expected_value    NUMERIC(15,2),
  deviation         NUMERIC(10,4),
  chart_data        JSONB,
  recommendations   JSONB,
  related_ids       JSONB,
  model_name        VARCHAR(100),
  confidence        NUMERIC(5,4),
  resolved          BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at       TIMESTAMPTZ,
  resolved_by       UUID REFERENCES users(id),
  resolution        TEXT,
  expires_at        TIMESTAMPTZ,
  generated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── INDEXES ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_users_email          ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_cooperative    ON users(cooperative_id);
CREATE INDEX IF NOT EXISTS idx_members_cooperative  ON members(cooperative_id);
CREATE INDEX IF NOT EXISTS idx_members_national_id  ON members(national_id);
CREATE INDEX IF NOT EXISTS idx_transactions_coop    ON transactions(cooperative_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date    ON transactions(date DESC);
CREATE INDEX IF NOT EXISTS idx_activities_coop      ON activities(cooperative_id);
CREATE INDEX IF NOT EXISTS idx_activities_date      ON activities(date DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user   ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_recipient   ON messages(recipient_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user      ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created   ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_insights_coop     ON ai_insights(cooperative_id);
CREATE INDEX IF NOT EXISTS idx_loan_records_member  ON loan_records(member_id);
CREATE INDEX IF NOT EXISTS idx_contributions_member ON member_contributions(member_id);

-- ─── MEMBERSHIP EXIT REQUESTS ──────────────────────────────────────

-- A member-initiated request to be removed from their cooperative. The member
-- files it themselves; the cooperative manager (or an admin) must respond before
-- response_due_at, which is stamped at submission from the published SLA.
CREATE TABLE IF NOT EXISTS membership_exit_requests (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cooperative_id      UUID NOT NULL REFERENCES cooperatives(id) ON DELETE CASCADE,
  member_id           UUID REFERENCES members(id) ON DELETE SET NULL,
  requested_by        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason_category     VARCHAR(50) NOT NULL CHECK (reason_category IN
                        ('relocation','financial_hardship','joining_another_cooperative',
                         'dissatisfied_with_management','health','retirement',
                         'business_closed','other')),
  reason_detail       TEXT NOT NULL,
  preferred_exit_date DATE,
  savings_instruction VARCHAR(30) NOT NULL DEFAULT 'refund_mobile_money' CHECK (savings_instruction IN
                        ('refund_mobile_money','refund_bank_transfer','refund_cash',
                         'donate_to_cooperative','no_savings_held')),
  contact_phone       VARCHAR(20),
  acknowledged_terms  BOOLEAN NOT NULL DEFAULT FALSE,
  status              VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN
                        ('pending','under_review','approved','rejected','withdrawn')),
  response_due_at     TIMESTAMPTZ NOT NULL,
  decision_note       TEXT,
  decided_by          UUID REFERENCES users(id),
  decided_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A member may only have one request awaiting a response at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_exit_requests_one_open
  ON membership_exit_requests(requested_by)
  WHERE status IN ('pending','under_review');

CREATE INDEX IF NOT EXISTS idx_exit_requests_coop   ON membership_exit_requests(cooperative_id);
CREATE INDEX IF NOT EXISTS idx_exit_requests_status ON membership_exit_requests(status);
