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

-- ─── GENERATED FROM src/db/ddl.ts — DO NOT EDIT BELOW THIS LINE ──────────────
-- Run `pnpm sync-schema` after changing ddl.ts.

-- membership_exit_requests
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
  status              VARCHAR(20) NOT NULL DEFAULT 'pending',
  response_due_at     TIMESTAMPTZ NOT NULL,
  decision_note       TEXT,
  decided_by          UUID REFERENCES users(id),
  decided_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- users.oversight_level (sector / district / RCA hierarchy)
ALTER TABLE users ADD COLUMN IF NOT EXISTS oversight_level VARCHAR(20);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_oversight_level'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT chk_users_oversight_level
      CHECK (oversight_level IS NULL OR oversight_level IN ('sector','district','rca'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_users_oversight ON users(oversight_level);

-- cooperative_requests (formation & dissolution)
CREATE TABLE IF NOT EXISTS cooperative_requests (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_type            VARCHAR(20) NOT NULL CHECK (request_type IN ('formation','dissolution')),
  reference               VARCHAR(30) UNIQUE NOT NULL,

  submitted_by            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_name            VARCHAR(150) NOT NULL,
  contact_phone           VARCHAR(20) NOT NULL,
  contact_email           VARCHAR(255),

  sector                  VARCHAR(50) NOT NULL,
  cell                    VARCHAR(50),
  village                 VARCHAR(50),

  -- formation payload
  proposed_name           VARCHAR(200),
  proposed_type           VARCHAR(50),
  member_count            INT,
  share_capital           NUMERIC(15,2),
  purpose                 TEXT,

  -- dissolution payload
  cooperative_id          UUID REFERENCES cooperatives(id) ON DELETE CASCADE,
  dissolution_reason      TEXT,
  votes_for               INT,
  votes_against           INT,
  votes_abstain           INT,
  outstanding_liabilities NUMERIC(15,2),
  asset_disposal_plan     TEXT,

  -- workflow
  current_stage           VARCHAR(20) NOT NULL DEFAULT 'sector'
                            CHECK (current_stage IN ('sector','district','rca','closed')),
  status                  VARCHAR(30) NOT NULL DEFAULT 'pending_sector' CHECK (status IN
                            ('pending_sector','pending_district','pending_rca',
                             'approved','rejected','withdrawn')),
  ai_assessment           JSONB,
  response_due_at         TIMESTAMPTZ NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cooperative_request_reviews (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id   UUID NOT NULL REFERENCES cooperative_requests(id) ON DELETE CASCADE,
  stage        VARCHAR(20) NOT NULL CHECK (stage IN ('sector','district','rca')),
  decision     VARCHAR(20) NOT NULL CHECK (decision IN ('approved','rejected','returned')),
  note         TEXT,
  reviewed_by  UUID NOT NULL REFERENCES users(id),
  reviewed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cooperative_request_documents (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id   UUID NOT NULL REFERENCES cooperative_requests(id) ON DELETE CASCADE,
  criterion_id VARCHAR(60),
  name         VARCHAR(255) NOT NULL,
  type         VARCHAR(50) NOT NULL,
  url          TEXT NOT NULL,
  size_bytes   BIGINT,
  uploaded_by  UUID REFERENCES users(id),
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coop_requests_status ON cooperative_requests(status);
CREATE INDEX IF NOT EXISTS idx_coop_requests_sector ON cooperative_requests(sector);
CREATE INDEX IF NOT EXISTS idx_coop_request_reviews ON cooperative_request_reviews(request_id);
CREATE INDEX IF NOT EXISTS idx_coop_request_docs    ON cooperative_request_documents(request_id);

-- membership_exit_requests — meeting statuses
DO $$
DECLARE cname text;
BEGIN
  SELECT con.conname INTO cname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
   WHERE rel.relname = 'membership_exit_requests'
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) ILIKE '%under_review%'
   LIMIT 1;
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE membership_exit_requests DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE membership_exit_requests
  ADD CONSTRAINT chk_exit_request_status CHECK (status IN
    ('pending','under_review','meeting_scheduled','meeting_held',
     'approved','rejected','withdrawn'));

DROP INDEX IF EXISTS idx_exit_requests_one_open;
CREATE UNIQUE INDEX IF NOT EXISTS idx_exit_requests_one_open
  ON membership_exit_requests(requested_by)
  WHERE status IN ('pending','under_review','meeting_scheduled','meeting_held');
CREATE INDEX IF NOT EXISTS idx_exit_requests_coop   ON membership_exit_requests(cooperative_id);
CREATE INDEX IF NOT EXISTS idx_exit_requests_status ON membership_exit_requests(status);

-- membership_exit_meetings
CREATE TABLE IF NOT EXISTS membership_exit_meetings (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  exit_request_id     UUID NOT NULL REFERENCES membership_exit_requests(id) ON DELETE CASCADE,
  cooperative_id      UUID NOT NULL REFERENCES cooperatives(id) ON DELETE CASCADE,
  -- The meeting is also written into the activities calendar so it shows up
  -- alongside every other cooperative event rather than hiding in a silo.
  activity_id         UUID REFERENCES activities(id) ON DELETE SET NULL,
  scheduled_for       TIMESTAMPTZ NOT NULL,
  location            VARCHAR(255),
  agenda              TEXT NOT NULL,
  convened_by         UUID REFERENCES users(id),
  status              VARCHAR(20) NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN ('scheduled','held','cancelled')),

  -- outcome, recorded after the assembly sits
  members_eligible    INT,
  members_present     INT,
  quorum_required     INT,
  quorum_met          BOOLEAN,
  votes_for           INT,
  votes_against       INT,
  votes_abstain       INT,
  resolution          VARCHAR(20) CHECK (resolution IN ('approve_exit','reject_exit','deferred')),
  resolution_note     TEXT,
  minutes_url         TEXT,
  held_at             TIMESTAMPTZ,
  recorded_by         UUID REFERENCES users(id),
  cancellation_reason TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One meeting may be outstanding per request; a cancelled one may be replaced.
CREATE UNIQUE INDEX IF NOT EXISTS idx_exit_meeting_one_open
  ON membership_exit_meetings(exit_request_id) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_exit_meetings_request ON membership_exit_meetings(exit_request_id);
CREATE INDEX IF NOT EXISTS idx_exit_meetings_coop    ON membership_exit_meetings(cooperative_id);

-- cooperative_permits
CREATE TABLE IF NOT EXISTS cooperative_permits (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cooperative_id     UUID NOT NULL REFERENCES cooperatives(id) ON DELETE CASCADE,
  permit_number      VARCHAR(60) UNIQUE NOT NULL,
  permit_type        VARCHAR(20) NOT NULL CHECK (permit_type IN ('temporary','permanent')),
  term_years         INT NOT NULL CHECK (term_years > 0),
  issued_on          DATE NOT NULL DEFAULT CURRENT_DATE,
  expires_on         DATE NOT NULL,
  status             VARCHAR(20) NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','expired','superseded','revoked')),
  -- Why this term was granted, kept so the decision stays auditable years later.
  term_rule          VARCHAR(40),
  basis              TEXT,
  source_request_id  UUID REFERENCES cooperative_requests(id) ON DELETE SET NULL,
  issued_by          UUID REFERENCES users(id),
  revoked_at         TIMESTAMPTZ,
  revocation_reason  TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A cooperative holds exactly one permit that is in force at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_permits_one_active
  ON cooperative_permits(cooperative_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_permits_coop    ON cooperative_permits(cooperative_id);
CREATE INDEX IF NOT EXISTS idx_permits_expires ON cooperative_permits(expires_on);

-- rca_audits
CREATE TABLE IF NOT EXISTS rca_audits (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference           VARCHAR(30) UNIQUE NOT NULL,
  audit_type          VARCHAR(30) NOT NULL
                        CHECK (audit_type IN ('permit_maturity','dissolution','compliance')),
  cooperative_id      UUID NOT NULL REFERENCES cooperatives(id) ON DELETE CASCADE,
  permit_id           UUID REFERENCES cooperative_permits(id) ON DELETE SET NULL,
  request_id          UUID REFERENCES cooperative_requests(id) ON DELETE CASCADE,
  status              VARCHAR(20) NOT NULL DEFAULT 'scheduled' CHECK (status IN
                        ('scheduled','in_progress','passed','failed','deferred','cancelled')),
  due_on              DATE NOT NULL,
  scheduled_for       DATE,
  opened_by           UUID REFERENCES users(id),
  opened_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  concluded_by        UUID REFERENCES users(id),
  concluded_at        TIMESTAMPTZ,
  findings            TEXT,
  recommendation      VARCHAR(30) CHECK (recommendation IN
                        ('issue_permanent','extend_temporary','revoke',
                         'allow_dissolution','refuse_dissolution','none')),
  outcome_note        TEXT,
  score               NUMERIC(5,4),
  ai_assessment       JSONB,
  resulting_permit_id UUID REFERENCES cooperative_permits(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One audit of a given kind may be open against a cooperative at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rca_audits_one_open
  ON rca_audits(cooperative_id, audit_type)
  WHERE status IN ('scheduled','in_progress');
CREATE INDEX IF NOT EXISTS idx_rca_audits_coop    ON rca_audits(cooperative_id);
CREATE INDEX IF NOT EXISTS idx_rca_audits_request ON rca_audits(request_id);
CREATE INDEX IF NOT EXISTS idx_rca_audits_status  ON rca_audits(status);

-- cooperative_requests — president filing and dissolution SLA
-- Which office the person filing held. A dissolution may only be filed by
-- the president (or an administrator acting on the register's behalf), so
-- the claimed office is stored with the request.
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS filed_as_role VARCHAR(60);
-- End-to-end target for the whole request, distinct from the per-stage
-- clock in response_due_at. Dissolutions target two weeks.
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS target_completion_at TIMESTAMPTZ;
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS assembly_minutes_url TEXT;

-- cooperative_monthly_audits
CREATE TABLE IF NOT EXISTS cooperative_monthly_audits (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  period              DATE NOT NULL,
  cooperative_id      UUID NOT NULL REFERENCES cooperatives(id) ON DELETE CASCADE,
  functionality_score NUMERIC(5,2),
  engagement_score    NUMERIC(5,2),
  composite_score     NUMERIC(5,2),
  band                VARCHAR(20) NOT NULL
                        CHECK (band IN ('healthy','monitor','at_risk','critical')),
  visit_recommended   BOOLEAN NOT NULL DEFAULT FALSE,
  visit_priority      INT,
  -- The raw measurements, the plain-language reasons and what to do about
  -- them, all kept so an officer can defend the band to the cooperative.
  signals             JSONB,
  reasons             JSONB,
  recommended_actions JSONB,
  unmeasured          JSONB,
  model_name          VARCHAR(100),
  model_version       VARCHAR(50),
  generated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (period, cooperative_id)
);

CREATE INDEX IF NOT EXISTS idx_monthly_audits_period ON cooperative_monthly_audits(period DESC);
CREATE INDEX IF NOT EXISTS idx_monthly_audits_band   ON cooperative_monthly_audits(band);
CREATE INDEX IF NOT EXISTS idx_monthly_audits_coop   ON cooperative_monthly_audits(cooperative_id);

-- cooperative_field_visits
CREATE TABLE IF NOT EXISTS cooperative_field_visits (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cooperative_id  UUID NOT NULL REFERENCES cooperatives(id) ON DELETE CASCADE,
  audit_id        UUID REFERENCES cooperative_monthly_audits(id) ON DELETE SET NULL,
  period          DATE,
  priority        INT NOT NULL DEFAULT 3,
  reason          TEXT NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','scheduled','completed','cancelled')),
  assigned_to     UUID REFERENCES users(id),
  scheduled_for   DATE,
  visited_at      TIMESTAMPTZ,
  findings        TEXT,
  support_needed  TEXT,
  outcome         VARCHAR(40) CHECK (outcome IN
                    ('operating_normally','needs_support','referred_for_funding',
                     'recommended_for_dissolution','unreachable')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Re-running an audit for the same month must not stack duplicate visits.
CREATE UNIQUE INDEX IF NOT EXISTS idx_field_visits_open
  ON cooperative_field_visits(cooperative_id, period)
  WHERE status IN ('pending','scheduled');
CREATE INDEX IF NOT EXISTS idx_field_visits_status   ON cooperative_field_visits(status);
CREATE INDEX IF NOT EXISTS idx_field_visits_assignee ON cooperative_field_visits(assigned_to);

-- support_organizations
CREATE TABLE IF NOT EXISTS support_organizations (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              VARCHAR(200) UNIQUE NOT NULL,
  type              VARCHAR(40) NOT NULL CHECK (type IN
                      ('ngo','government_agency','development_partner','donor',
                       'private_sector','financial_institution','faith_based',
                       'cooperative_union')),
  country           VARCHAR(80),
  description       TEXT,
  -- Which cooperative specialisations and conditions this funder serves.
  focus_areas       JSONB NOT NULL DEFAULT '[]'::jsonb,
  support_types     JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_bands      JSONB NOT NULL DEFAULT '[]'::jsonb,
  min_amount        NUMERIC(15,2),
  max_amount        NUMERIC(15,2),
  eligibility_notes TEXT,
  contact_name      VARCHAR(150),
  contact_role      VARCHAR(100),
  phone             VARCHAR(20),
  email             VARCHAR(255),
  website           TEXT,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_orgs_type   ON support_organizations(type);
CREATE INDEX IF NOT EXISTS idx_support_orgs_active ON support_organizations(active);

-- cooperative_partnerships
CREATE TABLE IF NOT EXISTS cooperative_partnerships (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id       UUID NOT NULL REFERENCES support_organizations(id) ON DELETE CASCADE,
  cooperative_id        UUID NOT NULL REFERENCES cooperatives(id) ON DELETE CASCADE,
  status                VARCHAR(20) NOT NULL DEFAULT 'introduced'
                          CHECK (status IN ('introduced','active','completed','ended')),
  -- Who the cooperative actually deals with. Funding follows relationships,
  -- so the named contact is recorded rather than left implicit.
  liaison_name          VARCHAR(150),
  liaison_role          VARCHAR(100),
  liaison_phone         VARCHAR(20),
  relationship_strength INT NOT NULL DEFAULT 40
                          CHECK (relationship_strength BETWEEN 0 AND 100),
  since                 DATE,
  last_contact_on       DATE,
  notes                 TEXT,
  recorded_by           UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, cooperative_id)
);

CREATE INDEX IF NOT EXISTS idx_partnerships_coop ON cooperative_partnerships(cooperative_id);
CREATE INDEX IF NOT EXISTS idx_partnerships_org  ON cooperative_partnerships(organization_id);

-- funding_opportunities
CREATE TABLE IF NOT EXISTS funding_opportunities (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id           UUID NOT NULL REFERENCES support_organizations(id) ON DELETE CASCADE,
  title                     VARCHAR(255) NOT NULL,
  description               TEXT NOT NULL,
  support_type              VARCHAR(40) NOT NULL,
  amount_available          NUMERIC(15,2),
  currency                  VARCHAR(10) NOT NULL DEFAULT 'RWF',
  target_types              JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_sectors            JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_bands              JSONB NOT NULL DEFAULT '[]'::jsonb,
  min_members               INT,
  min_health_score          NUMERIC(5,2),
  requires_permanent_permit BOOLEAN NOT NULL DEFAULT FALSE,
  opens_on                  DATE,
  closes_on                 DATE,
  status                    VARCHAR(20) NOT NULL DEFAULT 'open'
                              CHECK (status IN ('draft','open','closed','fully_allocated')),
  created_by                UUID REFERENCES users(id),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_opportunities_org    ON funding_opportunities(organization_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_status ON funding_opportunities(status);

-- funding_requests & disbursements
CREATE TABLE IF NOT EXISTS funding_requests (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference              VARCHAR(30) UNIQUE NOT NULL,
  cooperative_id         UUID NOT NULL REFERENCES cooperatives(id) ON DELETE CASCADE,
  organization_id        UUID NOT NULL REFERENCES support_organizations(id) ON DELETE CASCADE,
  opportunity_id         UUID REFERENCES funding_opportunities(id) ON DELETE SET NULL,
  support_type           VARCHAR(40) NOT NULL,
  requested_amount       NUMERIC(15,2),
  purpose                TEXT NOT NULL,
  expected_beneficiaries INT,
  status                 VARCHAR(20) NOT NULL DEFAULT 'submitted' CHECK (status IN
                           ('submitted','under_review','approved','rejected',
                            'disbursed','withdrawn')),
  -- The match score at the moment of application, frozen with its reasons
  -- so a later decision can be read against what was known at the time.
  match_score            NUMERIC(5,4),
  match_explanation      JSONB,
  decision_note          TEXT,
  decided_by             UUID REFERENCES users(id),
  decided_at             TIMESTAMPTZ,
  submitted_by           UUID REFERENCES users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS funding_disbursements (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  funding_request_id UUID NOT NULL REFERENCES funding_requests(id) ON DELETE CASCADE,
  amount             NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  disbursed_on       DATE NOT NULL DEFAULT CURRENT_DATE,
  reference          VARCHAR(100),
  notes              TEXT,
  -- Money that lands is also posted to the cooperative's books, so the
  -- financials and the funding record can never disagree.
  transaction_id     UUID REFERENCES transactions(id) ON DELETE SET NULL,
  recorded_by        UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_funding_requests_coop   ON funding_requests(cooperative_id);
CREATE INDEX IF NOT EXISTS idx_funding_requests_org    ON funding_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_funding_requests_status ON funding_requests(status);
CREATE INDEX IF NOT EXISTS idx_disbursements_request   ON funding_disbursements(funding_request_id);
