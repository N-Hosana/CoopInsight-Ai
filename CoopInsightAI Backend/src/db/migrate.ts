import { query } from "../config/db";
import dotenv from "dotenv";

dotenv.config();

/**
 * Idempotent DDL for tables added after the original schema.sql run. Every
 * statement is IF NOT EXISTS, so this is safe to run against an existing
 * database as many times as you like:  pnpm migrate
 *
 * schema.sql remains the source of truth for a fresh install; anything added
 * here must also be appended there.
 */
const MIGRATIONS: Array<{ name: string; sql: string }> = [
  {
    name: "membership_exit_requests",
    sql: `
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
    `,
  },
  {
    name: "membership_exit_requests indexes",
    sql: `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_exit_requests_one_open
        ON membership_exit_requests(requested_by)
        WHERE status IN ('pending','under_review');
      CREATE INDEX IF NOT EXISTS idx_exit_requests_coop   ON membership_exit_requests(cooperative_id);
      CREATE INDEX IF NOT EXISTS idx_exit_requests_status ON membership_exit_requests(status);
    `,
  },
  {
    name: "users.oversight_level (sector / district / RCA hierarchy)",
    sql: `
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
    `,
  },
  {
    name: "cooperative_requests (formation & dissolution)",
    sql: `
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
    `,
  },
];

async function migrate() {
  console.log("Running migrations…\n");
  for (const m of MIGRATIONS) {
    await query(m.sql);
    console.log(`✓ ${m.name}`);
  }
  console.log("\nMigrations complete.");
  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
