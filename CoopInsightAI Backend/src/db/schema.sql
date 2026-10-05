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
     'approved','rejected','withdrawn','reversed'));

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

-- membership_exit_meetings — assembly kind, calls and reporting
ALTER TABLE membership_exit_meetings
  ADD COLUMN IF NOT EXISTS assembly_kind VARCHAR(20) NOT NULL DEFAULT 'extraordinary';
ALTER TABLE membership_exit_meetings
  ADD COLUMN IF NOT EXISTS call_number INT NOT NULL DEFAULT 1;
-- The first call this second call follows on from, so the pair reads as
-- one process rather than two unrelated meetings.
ALTER TABLE membership_exit_meetings
  ADD COLUMN IF NOT EXISTS follows_meeting_id UUID
    REFERENCES membership_exit_meetings(id) ON DELETE SET NULL;
ALTER TABLE membership_exit_meetings
  ADD COLUMN IF NOT EXISTS second_call_due_by DATE;
-- "If two calls fail to reach quorum, the matter goes to the National
-- Agency for direction."
ALTER TABLE membership_exit_meetings
  ADD COLUMN IF NOT EXISTS referred_to_agency_at TIMESTAMPTZ;
-- "The report goes to the Sector and District administrations ... within
-- 3 working days of the meeting, and to the National Agency within 7 days."
ALTER TABLE membership_exit_meetings
  ADD COLUMN IF NOT EXISTS report_due_local_at TIMESTAMPTZ;
ALTER TABLE membership_exit_meetings
  ADD COLUMN IF NOT EXISTS report_due_agency_at TIMESTAMPTZ;
ALTER TABLE membership_exit_meetings
  ADD COLUMN IF NOT EXISTS reported_local_at TIMESTAMPTZ;
ALTER TABLE membership_exit_meetings
  ADD COLUMN IF NOT EXISTS reported_agency_at TIMESTAMPTZ;
-- "The cooperative's Secretary records the minutes ... The Secretary and
-- the chair sign the minutes."
ALTER TABLE membership_exit_meetings
  ADD COLUMN IF NOT EXISTS chaired_by_name VARCHAR(150);
ALTER TABLE membership_exit_meetings
  ADD COLUMN IF NOT EXISTS minuted_by_name VARCHAR(150);
-- Above 100 members the assembly is delegates, not the whole register,
-- so what quorum was counted against has to be recorded explicitly.
ALTER TABLE membership_exit_meetings
  ADD COLUMN IF NOT EXISTS eligible_basis VARCHAR(20) NOT NULL DEFAULT 'members';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_exit_meeting_kind') THEN
    ALTER TABLE membership_exit_meetings ADD CONSTRAINT chk_exit_meeting_kind
      CHECK (assembly_kind IN ('ordinary','extraordinary'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_exit_meeting_call') THEN
    ALTER TABLE membership_exit_meetings ADD CONSTRAINT chk_exit_meeting_call
      CHECK (call_number IN (1,2));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_exit_meeting_basis') THEN
    ALTER TABLE membership_exit_meetings ADD CONSTRAINT chk_exit_meeting_basis
      CHECK (eligible_basis IN ('members','delegates'));
  END IF;
END $$;

-- A second call is a distinct meeting for the same request, so the
-- one-open-meeting index must key on the call as well.
DROP INDEX IF EXISTS idx_exit_meeting_one_open;
CREATE UNIQUE INDEX IF NOT EXISTS idx_exit_meeting_one_open
  ON membership_exit_meetings(exit_request_id, call_number) WHERE status = 'scheduled';

-- cooperatives.delegate_count (assemblies above 100 members)
-- "In a primary cooperative with more than 100 members, [the General
-- Assembly] is made up of delegates elected by their peers." The number
-- is set by the National Agency's instructions, so it cannot be derived
-- and has to be recorded against the cooperative.
ALTER TABLE cooperatives ADD COLUMN IF NOT EXISTS delegate_count INT;

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

-- messages — broadcast audience
ALTER TABLE messages ADD COLUMN IF NOT EXISTS audience_scope VARCHAR(20);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS audience_sector VARCHAR(50);
-- How many accounts the audience resolved to when it was sent. Stored
-- rather than recomputed, so a message sent to 40 people still says 40
-- after ten of them leave.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS audience_size INT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_messages_audience') THEN
    ALTER TABLE messages ADD CONSTRAINT chk_messages_audience
      CHECK (audience_scope IS NULL
             OR audience_scope IN ('district','sector','cooperative'));
  END IF;
END $$;

-- Existing broadcasts predate the column and were district-wide.
UPDATE messages SET audience_scope = 'district'
  WHERE type = 'broadcast' AND audience_scope IS NULL;
UPDATE messages SET audience_scope = 'cooperative'
  WHERE type = 'cooperative' AND audience_scope IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_audience ON messages(type, audience_scope);

-- cooperative_requests — RCA service types
DO $$
DECLARE cname text;
BEGIN
  SELECT con.conname INTO cname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
   WHERE rel.relname = 'cooperative_requests'
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) ILIKE '%formation%'
     AND pg_get_constraintdef(con.oid) ILIKE '%dissolution%'
     AND pg_get_constraintdef(con.oid) NOT ILIKE '%change_name%'
   LIMIT 1;
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE cooperative_requests DROP CONSTRAINT %I', cname);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_coop_request_type') THEN
    ALTER TABLE cooperative_requests ADD CONSTRAINT chk_coop_request_type
      CHECK (request_type IN ('formation','dissolution','change_objective',
                              'add_activity','change_name','duplicate_certificate'));
  END IF;
END $$;

-- Assembly evidence. Every certificate change needs three-quarters of the
-- eligible members to ATTEND and three-quarters of those present to vote
-- in favour, so attendance is recorded separately from the vote.
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS assembly_members_eligible INT;
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS assembly_members_present INT;
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS assembly_held_on DATE;
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS minutes_notarized BOOLEAN NOT NULL DEFAULT FALSE;

-- Shared administrative requirements.
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS certificate_returned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS fee_paid_rwf NUMERIC(15,2);
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS rra_clearance BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS creditors_notified BOOLEAN NOT NULL DEFAULT FALSE;
-- Everything the RCA receives goes through their CMIS portal.
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS cmis_reference VARCHAR(60);
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS share_capital_value NUMERIC(15,2);
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS share_unit_value NUMERIC(15,2);

-- Per-service payload.
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS proposed_new_name VARCHAR(200);
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS proposed_new_objective TEXT;
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS added_activities JSONB;
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS value_chain_justification TEXT;
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS loss_circumstances TEXT;
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS service_payload JSONB;

-- cooperative_requests — two-stage dissolution
-- Law No. 057/2024, Articles 132–142: dissolution runs in two stages, each
-- with its own General Assembly. The first decides and appoints; the
-- second distributes and closes.
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS dissolution_stage VARCHAR(20);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_dissolution_stage') THEN
    ALTER TABLE cooperative_requests ADD CONSTRAINT chk_dissolution_stage
      CHECK (dissolution_stage IS NULL
             OR dissolution_stage IN ('decision','distribution','complete'));
  END IF;
END $$;

-- Stage 1: who was appointed, and whether the RCA was told in time.
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS liquidator_name VARCHAR(150);
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS liquidator_qualification VARCHAR(60);
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS liquidator_is_member BOOLEAN;
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS liquidator_phone VARCHAR(30);
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS liquidator_email VARCHAR(150);
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS monitoring_committee JSONB;
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS decision_taken_at DATE;
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS rca_notified_at DATE;
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS asset_inventory_done BOOLEAN NOT NULL DEFAULT FALSE;

-- Stage 2: the liquidator's report and what became of the assets.
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS liquidator_report JSONB;
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS loans_recovered NUMERIC(15,2);
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS creditors_paid NUMERIC(15,2);
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS assets_distributed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS second_assembly_held_on DATE;

CREATE INDEX IF NOT EXISTS idx_coop_requests_type ON cooperative_requests(request_type);

-- independent_auditors
-- "A person becomes an independent auditor of a cooperative only when
--  approved by the cooperative's General Assembly from the list of
--  independent auditors approved by RCA." Six circumstances disqualify
--  them outright; recording the engagement is what lets the system refuse
--  a conflicted appointment before the audit rather than after it.
CREATE TABLE IF NOT EXISTS independent_auditors (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                   VARCHAR(200) NOT NULL,
  firm                   VARCHAR(200),
  registration_number    VARCHAR(60),
  on_rca_approved_list   BOOLEAN NOT NULL DEFAULT FALSE,
  contact_email          VARCHAR(255),
  contact_phone          VARCHAR(20),
  active                 BOOLEAN NOT NULL DEFAULT TRUE,
  created_by             UUID REFERENCES users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name, firm)
);

CREATE TABLE IF NOT EXISTS auditor_engagements (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auditor_id           UUID NOT NULL REFERENCES independent_auditors(id) ON DELETE CASCADE,
  cooperative_id       UUID NOT NULL REFERENCES cooperatives(id) ON DELETE CASCADE,
  financial_year       VARCHAR(20) NOT NULL,
  approved_by_assembly BOOLEAN NOT NULL DEFAULT FALSE,
  assembly_held_on     DATE,
  agreed_fee           NUMERIC(15,2),
  -- Which of the six disqualifications the cooperative declared. An
  -- engagement with any of them recorded is refused.
  declared_conflicts   JSONB NOT NULL DEFAULT '[]'::jsonb,
  status               VARCHAR(20) NOT NULL DEFAULT 'proposed'
                         CHECK (status IN ('proposed','engaged','reported','terminated')),
  report_filed_at      TIMESTAMPTZ,
  report_url           TEXT,
  notes                TEXT,
  recorded_by          UUID REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cooperative_id, financial_year, auditor_id)
);

CREATE INDEX IF NOT EXISTS idx_auditor_engagements_coop ON auditor_engagements(cooperative_id);

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

-- membership_exit_settlements (the member's assets, resolved)
-- A member who leaves is paid back their savings, their share capital and
-- their share of what the cooperative has accumulated, less what they
-- still owe it. That calculation was previously only ever SHOWN on
-- screen; this table is where the cooperative RECORDS what it actually
-- settled. Until a row exists here the exit cannot be completed, which
-- is what stops a member being struck off the register while the
-- cooperative still holds their money.
CREATE TABLE IF NOT EXISTS membership_exit_settlements (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  exit_request_id        UUID NOT NULL UNIQUE
                           REFERENCES membership_exit_requests(id) ON DELETE CASCADE,
  cooperative_id         UUID NOT NULL REFERENCES cooperatives(id) ON DELETE CASCADE,
  member_id              UUID REFERENCES members(id) ON DELETE SET NULL,

  -- The lines of the calculation, frozen at the moment of settlement.
  own_savings            NUMERIC(15,2) NOT NULL DEFAULT 0,
  share_capital          NUMERIC(15,2) NOT NULL DEFAULT 0,
  special_levies         NUMERIC(15,2) NOT NULL DEFAULT 0,
  share_of_net_worth     NUMERIC(15,2) NOT NULL DEFAULT 0,
  outstanding_loans      NUMERIC(15,2) NOT NULL DEFAULT 0,
  other_deductions       NUMERIC(15,2) NOT NULL DEFAULT 0,
  other_deductions_note  TEXT,
  gross_entitlement      NUMERIC(15,2) NOT NULL DEFAULT 0,
  net_payable            NUMERIC(15,2) NOT NULL DEFAULT 0,
  balance_owed_by_member NUMERIC(15,2) NOT NULL DEFAULT 0,

  -- How it was actually settled.
  settlement_method      VARCHAR(30) NOT NULL CHECK (settlement_method IN
                           ('mobile_money','bank_transfer','cash',
                            'donated_to_cooperative','offset_against_loan','nothing_due')),
  payment_reference      VARCHAR(120),
  amount_paid            NUMERIC(15,2) NOT NULL DEFAULT 0,
  settled_on             DATE NOT NULL DEFAULT CURRENT_DATE,
  notes                  TEXT,

  -- The whole computation as it stood, so the figures can be defended
  -- after the ledgers have moved on.
  computation            JSONB,
  -- Final once the member confirms receipt on their own portal.
  acknowledged_by_member BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged_at        TIMESTAMPTZ,

  recorded_by            UUID REFERENCES users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exit_settlements_coop   ON membership_exit_settlements(cooperative_id);
CREATE INDEX IF NOT EXISTS idx_exit_settlements_member ON membership_exit_settlements(member_id);

-- membership_certificates (written proof of past membership)
-- A member released by the general assembly is entitled to written proof
-- that they belonged to the cooperative, for how long, and what they
-- held. Without it they have nothing to show a bank, a new cooperative or
-- a court. The certificate is issued by the system at the moment the exit
-- is approved, so it cannot be forgotten or quietly withheld.
CREATE TABLE IF NOT EXISTS membership_certificates (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  certificate_number   VARCHAR(40) UNIQUE NOT NULL,
  cooperative_id       UUID NOT NULL REFERENCES cooperatives(id) ON DELETE CASCADE,
  member_id            UUID REFERENCES members(id) ON DELETE SET NULL,
  exit_request_id      UUID REFERENCES membership_exit_requests(id) ON DELETE SET NULL,
  -- The account it belongs to, so the holder can still open it after they
  -- have been taken off the register.
  issued_to_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,

  purpose              VARCHAR(30) NOT NULL DEFAULT 'exit'
                         CHECK (purpose IN ('exit','service','duplicate')),

  -- Everything printed on it is snapshotted, because the register rows it
  -- came from keep changing afterwards.
  member_name          VARCHAR(150) NOT NULL,
  national_id          VARCHAR(50),
  membership_number    VARCHAR(100),
  cooperative_name     VARCHAR(200) NOT NULL,
  registration_number  VARCHAR(100),
  joined_on            DATE,
  left_on              DATE,
  months_of_membership INT,
  roles_held           TEXT,
  total_contributions  NUMERIC(15,2),
  settlement_amount    NUMERIC(15,2),
  exit_ground          TEXT,
  assembly_held_on     DATE,
  assembly_resolution  TEXT,
  statement            TEXT NOT NULL,

  -- Printed on the certificate so a third party can check it is real.
  verification_code    VARCHAR(24) UNIQUE NOT NULL,
  issued_by            UUID REFERENCES users(id),
  issued_by_name       VARCHAR(150),
  issued_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at           TIMESTAMPTZ,
  revocation_reason    TEXT
);

CREATE INDEX IF NOT EXISTS idx_membership_certs_user   ON membership_certificates(issued_to_user_id);
CREATE INDEX IF NOT EXISTS idx_membership_certs_coop   ON membership_certificates(cooperative_id);
CREATE INDEX IF NOT EXISTS idx_membership_certs_member ON membership_certificates(member_id);

-- members — archived rather than silently soft-deleted
-- A departing member used to be marked inactive and soft-deleted, which
-- is indistinguishable from a record somebody deleted by mistake. An
-- archived member is a different thing: the assembly released them, the
-- cooperative settled with them, and their history stays readable.
ALTER TABLE members ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE members ADD COLUMN IF NOT EXISTS archive_reason TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS exit_request_id UUID
  REFERENCES membership_exit_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_members_archived ON members(cooperative_id, archived_at);

-- cooperative_requests — the RCA sees a dissolution from filing
-- A dissolution concerns the RCA from the moment it is filed, not only
-- when it reaches their desk two stages later. Recording when each level
-- was told lets the RCA watch a case travel up the chain.
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS rca_informed_at TIMESTAMPTZ;
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS district_informed_at TIMESTAMPTZ;

UPDATE cooperative_requests
   SET rca_informed_at = created_at, district_informed_at = created_at
 WHERE request_type = 'dissolution' AND rca_informed_at IS NULL;

-- cooperative_requests — issue reports from members
-- An ordinary member does not file a dissolution or a change of
-- certificate: those belong to the president, because they commit the
-- whole cooperative. But a member IS the person who first sees that
-- something is wrong — money missing, an election never held, a
-- committee that stopped meeting — and before this they had nowhere to
-- say so except to the very office they might be complaining about.
--
-- An issue report travels the same sector -> district -> RCA chain as
-- every other request, which is the point: it reuses the reviews, the
-- stage clock, the notifications and the decision machinery rather than
-- inventing a parallel one that would rot.
DO $$
DECLARE cname text;
BEGIN
  SELECT con.conname INTO cname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
   WHERE rel.relname = 'cooperative_requests'
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) ILIKE '%formation%'
     AND pg_get_constraintdef(con.oid) NOT ILIKE '%issue_report%'
   LIMIT 1;
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE cooperative_requests DROP CONSTRAINT %I', cname);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_coop_request_type_v2'
  ) THEN
    ALTER TABLE cooperative_requests ADD CONSTRAINT chk_coop_request_type_v2
      CHECK (request_type IN ('formation','dissolution','change_objective',
                              'add_activity','change_name','duplicate_certificate',
                              'issue_report'));
  END IF;
END $$;

ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS issue_category VARCHAR(40);
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS issue_detail TEXT;
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS issue_severity VARCHAR(20);
-- A member reporting their own committee has an obvious reason to fear
-- being identified. Withholding the name from the cooperative is the
-- only thing that makes the channel usable; the officers still see who
-- filed it, because an anonymous report nobody can follow up is worth
-- little and is too easy to abuse.
ALTER TABLE cooperative_requests
  ADD COLUMN IF NOT EXISTS issue_confidential BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS issue_resolution TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_issue_severity') THEN
    ALTER TABLE cooperative_requests ADD CONSTRAINT chk_issue_severity
      CHECK (issue_severity IS NULL
             OR issue_severity IN ('low','medium','high','urgent'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_coop_requests_issues
  ON cooperative_requests(request_type, status)
  WHERE request_type = 'issue_report';

-- reports — store what was generated, so it can be downloaded
-- Reports were written with file_url = 'pending' and nothing ever
-- generated the file, so every View and Export button on the page led to
-- a dead end. The content is now built at generation time and stored
-- here, which is what lets the download endpoint actually serve
-- something — and lets a report opened six months later still show the
-- figures as they stood when it was run, rather than silently
-- recomputing against today's data.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS content JSONB;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS row_count INT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS period_from DATE;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS period_to DATE;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ;

-- The old rows point at a file that was never written. Marking them
-- failed is honest; leaving them as "pending" implies a queue that does
-- not exist and never did.
UPDATE reports SET file_url = 'unavailable'
 WHERE file_url = 'pending' AND content IS NULL;

-- monthly_audit_runs
-- Who ran the monthly audit, at which level of the oversight chain, and over
-- what scope. A sector officer audits their own sector; the district office
-- and the RCA audit the district or any one sector. Without this the standings
-- cannot say whether a sector was left out of a month or simply never run.
CREATE TABLE IF NOT EXISTS monthly_audit_runs (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  period                 DATE NOT NULL,
  scope                  VARCHAR(20) NOT NULL CHECK (scope IN ('district','sector')),
  sector                 VARCHAR(100),
  run_by                 UUID REFERENCES users(id) ON DELETE SET NULL,
  run_by_level           VARCHAR(20),
  cooperatives_assessed  INT NOT NULL DEFAULT 0,
  visits_raised          INT NOT NULL DEFAULT 0,
  model_version          VARCHAR(50),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_monthly_audit_runs_period ON monthly_audit_runs(period DESC);

-- cooperatives.district / cooperative_requests.district
-- The register was implicitly one district (Gasabo). The RCA supervises every
-- district, so each cooperative and each request now says which one it is in.
-- Existing rows are all in Gasabo, which is what the default records.
ALTER TABLE cooperatives ADD COLUMN IF NOT EXISTS district VARCHAR(100) NOT NULL DEFAULT 'Gasabo';
CREATE INDEX IF NOT EXISTS idx_cooperatives_district ON cooperatives(district);
ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS district VARCHAR(100) NOT NULL DEFAULT 'Gasabo';

-- users.member_id: a login tied to its member record for good, surviving an exit.
ALTER TABLE users ADD COLUMN IF NOT EXISTS member_id UUID REFERENCES members(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_member_id ON users(member_id);
UPDATE users u SET member_id = m.id
  FROM members m
 WHERE u.member_id IS NULL AND u.role = 'member'
   AND m.cooperative_id = u.cooperative_id
   AND ((u.national_id IS NOT NULL AND m.national_id = u.national_id)
        OR (u.phone IS NOT NULL AND m.phone = u.phone)
        OR LOWER(m.full_name) = LOWER(u.name));
UPDATE users u SET member_id = e.member_id
  FROM membership_exit_requests e
 WHERE u.member_id IS NULL AND e.requested_by = u.id
   AND e.member_id IS NOT NULL AND e.status = 'approved';

-- membership_exit_requests: an approved exit can be reversed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_exit_request_status') THEN
    ALTER TABLE membership_exit_requests DROP CONSTRAINT chk_exit_request_status;
  END IF;
END $$;
ALTER TABLE membership_exit_requests
  ADD CONSTRAINT chk_exit_request_status CHECK (status IN
    ('pending','under_review','meeting_scheduled','meeting_held',
     'approved','rejected','withdrawn','reversed'));
ALTER TABLE membership_exit_requests ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ;
ALTER TABLE membership_exit_requests ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES users(id);
ALTER TABLE membership_exit_requests ADD COLUMN IF NOT EXISTS reversal_reason TEXT;

-- cooperative_documents: a document may have no file yet (NULL, not a placeholder link).
ALTER TABLE cooperative_documents ALTER COLUMN url DROP NOT NULL;
UPDATE cooperative_documents SET url = NULL WHERE url LIKE '%storage-placeholder.com%';

-- cooperative_assemblies: assemblies called for a dissolution, each tied to its activity.
CREATE TABLE IF NOT EXISTS cooperative_assemblies (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cooperative_id  UUID NOT NULL REFERENCES cooperatives(id) ON DELETE CASCADE,
  purpose         VARCHAR(40) NOT NULL
                    CHECK (purpose IN ('dissolution_decision','dissolution_distribution')),
  request_id      UUID REFERENCES cooperative_requests(id) ON DELETE SET NULL,
  activity_id     UUID REFERENCES activities(id) ON DELETE SET NULL,
  assembly_kind   VARCHAR(20) NOT NULL DEFAULT 'extraordinary',
  scheduled_for   TIMESTAMPTZ NOT NULL,
  location        TEXT NOT NULL,
  agenda          TEXT NOT NULL,
  members_registered INT NOT NULL DEFAULT 0,
  convened_by     UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_coop_assemblies_coop ON cooperative_assemblies(cooperative_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- ONE SOURCE OF TRUTH FOR MEMBERS' MONEY
-- ─────────────────────────────────────────────────────────────────────────────
-- The same savings figure was stored three times — on each member
-- (members.total_savings), on each cooperative (cooperatives.total_savings) and
-- implied by the contributions ledger — and only the first two agreed. The
-- ledger held about half the balance (the seed wrote balances it never backed
-- with entries), total_contributions was 0 for almost everyone, and the cash
-- book's "member contributions" income bore no relation to what members paid.
-- So the dashboard, the Financials page and a member's own record could each
-- show a different number for the same money.
--
-- The ledger (member_contributions) is now the source of truth:
--   * members.total_savings       = SUM of the member's savings entries
--   * members.total_contributions = SUM of all the member's entries
--   * cooperatives.total_savings  = SUM of its current members' total_savings
-- kept true by triggers whatever code path writes the money, and
--   * the cash book's member-contribution income for each month equals what
--     members paid in that month, from the start of the cash book.
-- A balance the ledger cannot explain is recorded once as an explicit
-- "Opening balance (reconciliation)" savings entry rather than left implied.

CREATE OR REPLACE FUNCTION sync_member_money_totals(p_member uuid) RETURNS void AS $$
BEGIN
  UPDATE members m
     SET total_savings = COALESCE((SELECT SUM(amount) FROM member_contributions
                                    WHERE member_id = m.id AND type = 'savings'), 0),
         total_contributions = COALESCE((SELECT SUM(amount) FROM member_contributions
                                          WHERE member_id = m.id), 0)
   WHERE m.id = p_member;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_cooperative_savings(p_cooperative uuid) RETURNS void AS $$
BEGIN
  IF p_cooperative IS NULL THEN RETURN; END IF;
  UPDATE cooperatives c
     SET total_savings = COALESCE((SELECT SUM(m.total_savings) FROM members m
                                    WHERE m.cooperative_id = c.id AND m.deleted_at IS NULL), 0)
   WHERE c.id = p_cooperative;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_member_contributions_money() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN PERFORM sync_member_money_totals(OLD.member_id); END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN PERFORM sync_member_money_totals(NEW.member_id); END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_members_cooperative_savings() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN PERFORM sync_cooperative_savings(OLD.cooperative_id); END IF;
  IF TG_OP IN ('INSERT','UPDATE') AND (TG_OP = 'INSERT' OR NEW.cooperative_id IS DISTINCT FROM OLD.cooperative_id) THEN
    PERFORM sync_cooperative_savings(NEW.cooperative_id);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS member_contributions_money ON member_contributions;
CREATE TRIGGER member_contributions_money
  AFTER INSERT OR UPDATE OR DELETE ON member_contributions
  FOR EACH ROW EXECUTE FUNCTION trg_member_contributions_money();

DROP TRIGGER IF EXISTS members_cooperative_savings ON members;
CREATE TRIGGER members_cooperative_savings
  AFTER INSERT OR DELETE OR UPDATE OF total_savings, deleted_at, cooperative_id ON members
  FOR EACH ROW EXECUTE FUNCTION trg_members_cooperative_savings();

-- Brings existing data into line. Safe to run repeatedly: openings are only
-- written where a balance is unexplained, and the cash book only rewrites a
-- month whose total does not already match the ledger.
CREATE OR REPLACE FUNCTION reconcile_member_money(p_cash_book_start date DEFAULT DATE '2025-04-01')
RETURNS jsonb AS $$
DECLARE
  v_categories int;
  v_openings int;
  v_months int;
BEGIN
  -- 1. One vocabulary for categories: the codes the API validates against.
  UPDATE transactions SET category = CASE category
      WHEN 'Member Contributions' THEN 'member_contributions'
      WHEN 'Product Sales'        THEN 'product_sales'
      WHEN 'Produce Sales'        THEN 'product_sales'
      WHEN 'Fare Revenue'         THEN 'service_fees'
      WHEN 'Contract Revenue'     THEN 'service_fees'
      WHEN 'Service Revenue'      THEN 'service_fees'
      WHEN 'Operational Expense'  THEN 'operational_costs'
      ELSE category END
   WHERE category IN ('Member Contributions','Product Sales','Produce Sales','Fare Revenue',
                      'Contract Revenue','Service Revenue','Operational Expense');
  GET DIAGNOSTICS v_categories = ROW_COUNT;

  -- 2. A balance the ledger cannot explain becomes an explicit opening entry,
  --    dated when the member joined (or before their first recorded entry).
  INSERT INTO member_contributions (member_id, amount, type, date, notes, created_at)
  SELECT m.id,
         m.total_savings - s.ledger,
         'savings',
         COALESCE(LEAST(m.membership_date, s.first_entry), m.membership_date, s.first_entry, DATE '2025-01-01'),
         'Opening balance (reconciliation)',
         NOW()
    FROM members m
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(amount) FILTER (WHERE type = 'savings'), 0) AS ledger, MIN(date) AS first_entry
        FROM member_contributions WHERE member_id = m.id
    ) s
   WHERE m.total_savings > s.ledger
     AND NOT EXISTS (SELECT 1 FROM member_contributions o
                      WHERE o.member_id = m.id AND o.notes = 'Opening balance (reconciliation)');
  GET DIAGNOSTICS v_openings = ROW_COUNT;

  -- 3. Every stored total recomputed from the ledger.
  UPDATE members m
     SET total_savings = COALESCE((SELECT SUM(amount) FROM member_contributions
                                    WHERE member_id = m.id AND type = 'savings'), 0),
         total_contributions = COALESCE((SELECT SUM(amount) FROM member_contributions
                                          WHERE member_id = m.id), 0);
  UPDATE cooperatives c
     SET total_savings = COALESCE((SELECT SUM(m.total_savings) FROM members m
                                    WHERE m.cooperative_id = c.id AND m.deleted_at IS NULL), 0);

  -- 4. The cash book's member-contribution income, month by month, equals what
  --    members paid in that month. Entries the app recorded itself (they carry
  --    recorded_by) already post their own receipt and are left alone; the
  --    system-written monthly summaries are rebuilt only where they differ.
  WITH ledger AS (
    SELECT m.cooperative_id, DATE_TRUNC('month', mc.date)::date AS month, SUM(mc.amount) AS amount
      FROM member_contributions mc JOIN members m ON m.id = mc.member_id
     WHERE mc.recorded_by IS NULL AND mc.date >= p_cash_book_start
     GROUP BY 1, 2
  ),
  book AS (
    SELECT cooperative_id, DATE_TRUNC('month', date)::date AS month, SUM(amount) AS amount
      FROM transactions
     WHERE category = 'member_contributions' AND recorded_by IS NULL AND date >= p_cash_book_start
     GROUP BY 1, 2
  ),
  wrong AS (
    SELECT COALESCE(l.cooperative_id, b.cooperative_id) AS cooperative_id,
           COALESCE(l.month, b.month) AS month,
           l.amount AS expected
      FROM ledger l FULL JOIN book b ON b.cooperative_id = l.cooperative_id AND b.month = l.month
     WHERE l.amount IS DISTINCT FROM b.amount
  ),
  removed AS (
    DELETE FROM transactions t USING wrong w
     WHERE t.category = 'member_contributions' AND t.recorded_by IS NULL
       AND t.cooperative_id = w.cooperative_id AND DATE_TRUNC('month', t.date)::date = w.month
    RETURNING t.id
  ),
  added AS (
    INSERT INTO transactions (cooperative_id, type, category, amount, date, description,
                              payment_method, status, created_at, updated_at)
    SELECT w.cooperative_id, 'income', 'member_contributions', w.expected,
           LEAST((w.month + INTERVAL '1 month - 1 day')::date, CURRENT_DATE),
           'Member contributions collected in ' || TO_CHAR(w.month, 'FMMonth YYYY') ||
             ' (total of the member ledger for the month)',
           'cash', 'completed', NOW(), NOW()
      FROM wrong w WHERE w.expected IS NOT NULL
    RETURNING id
  )
  SELECT (SELECT COUNT(*) FROM wrong) INTO v_months;

  RETURN jsonb_build_object('categoriesNormalised', v_categories, 'openingBalances', v_openings,
                            'cashBookMonthsRewritten', v_months);
END $$ LANGUAGE plpgsql;

SELECT reconcile_member_money();
