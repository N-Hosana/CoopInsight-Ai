/**
 * Idempotent DDL for everything added after the original schema.sql run.
 *
 * `pnpm migrate` executes this list in order; `schema.sql` carries the same
 * statements at the end of the file so a fresh install and an upgraded one land
 * in the same place. Every statement is IF NOT EXISTS or guarded by a DO block,
 * so running it repeatedly is safe.
 *
 * Anything added here must also be appended to schema.sql.
 */
export interface Migration {
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
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
        status              VARCHAR(20) NOT NULL DEFAULT 'pending',
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

  // ───────────────────────────────────────────────────────────────────────────
  // GENERAL ASSEMBLY MEETING ON A MEMBER'S REQUEST TO LEAVE
  //
  // A member is not removed on the manager's signature. The request convenes a
  // general assembly, the members hear the reasons and vote, and only then is a
  // decision recorded. The two extra statuses below are the meeting being called
  // and the meeting having been held.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "membership_exit_requests — meeting statuses",
    sql: `
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
    `,
  },
  {
    name: "membership_exit_meetings",
    sql: `
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
    `,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // ASSEMBLY GOVERNANCE — RCA RULES
  //
  // The RCA brochure "Cooperative Organs: Their Powers and Responsibilities"
  // distinguishes ordinary from extraordinary assemblies, gives each a
  // different notice period and quorum, provides for a second call when the
  // first fails, escalates to the National Agency when two calls fail, and
  // attaches two reporting deadlines to every meeting held. None of that fits
  // in the single-meeting shape the table originally had.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "membership_exit_meetings — assembly kind, calls and reporting",
    sql: `
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
    `,
  },
  {
    name: "cooperatives.delegate_count (assemblies above 100 members)",
    sql: `
      -- "In a primary cooperative with more than 100 members, [the General
      -- Assembly] is made up of delegates elected by their peers." The number
      -- is set by the National Agency's instructions, so it cannot be derived
      -- and has to be recorded against the cooperative.
      ALTER TABLE cooperatives ADD COLUMN IF NOT EXISTS delegate_count INT;
    `,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // OPERATING PERMITS
  //
  // Registration issues a one-year temporary permit. A maturity audit before it
  // expires converts it to a permanent permit — 30 years normally, 50 for
  // industrial and rice-growing cooperatives. See services/permits.ts.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "cooperative_permits",
    sql: `
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
    `,
  },
  {
    name: "rca_audits",
    sql: `
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
    `,
  },
  {
    name: "cooperative_requests — president filing and dissolution SLA",
    sql: `
      -- Which office the person filing held. A dissolution may only be filed by
      -- the president (or an administrator acting on the register's behalf), so
      -- the claimed office is stored with the request.
      ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS filed_as_role VARCHAR(60);
      -- End-to-end target for the whole request, distinct from the per-stage
      -- clock in response_due_at. Dissolutions target two weeks.
      ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS target_completion_at TIMESTAMPTZ;
      ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS assembly_minutes_url TEXT;
    `,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // MONTHLY AI AUDIT AND THE FIELD-VISIT LIST
  //
  // Cooperatives do not usually announce that they have stopped working; they go
  // quiet and are discovered a year later. The monthly audit scores every
  // cooperative on whether it is functioning and whether its members are still
  // engaged, and turns the bottom of that list into visits for sector officers.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "cooperative_monthly_audits",
    sql: `
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
    `,
  },
  {
    name: "cooperative_field_visits",
    sql: `
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
    `,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // BROADCAST AUDIENCES
  //
  // `messages.type = 'broadcast'` originally meant "everyone", which is the only
  // thing an administrator ever needs. An RCA officer broadcasting to the whole
  // district and a sector officer broadcasting to their own sector are different
  // audiences, and a manager addressing their own cooperative is a third. The
  // audience has to be recorded on the message or the reader cannot work out
  // whether it was meant for them.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "messages — broadcast audience",
    sql: `
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
    `,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // RCA SERVICE REQUESTS
  //
  // Beyond forming and dissolving, a cooperative may ask the RCA to change its
  // objective, add activities to its certificate, change its name, or replace a
  // lost certificate. They share the sector → district → RCA chain that
  // cooperative_requests already models, so they extend that table rather than
  // starting a parallel one.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "cooperative_requests — RCA service types",
    sql: `
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
    `,
  },
  {
    name: "cooperative_requests — two-stage dissolution",
    sql: `
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
    `,
  },
  {
    name: "independent_auditors",
    sql: `
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
    `,
  },

  // ───────────────────────────────────────────────────────────────────────────
  // EXTERNAL SUPPORT — NGOs, DEVELOPMENT PARTNERS AND WHAT THEY FUND
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "support_organizations",
    sql: `
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
    `,
  },
  {
    name: "cooperative_partnerships",
    sql: `
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
    `,
  },
  {
    name: "funding_opportunities",
    sql: `
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
    `,
  },
  {
    name: "funding_requests & disbursements",
    sql: `
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
    `,
  },
  {
    name: "membership_exit_settlements (the member's assets, resolved)",
    sql: `
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
    `,
  },
  {
    name: "membership_certificates (written proof of past membership)",
    sql: `
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
    `,
  },
  {
    name: "members — archived rather than silently soft-deleted",
    sql: `
      -- A departing member used to be marked inactive and soft-deleted, which
      -- is indistinguishable from a record somebody deleted by mistake. An
      -- archived member is a different thing: the assembly released them, the
      -- cooperative settled with them, and their history stays readable.
      ALTER TABLE members ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
      ALTER TABLE members ADD COLUMN IF NOT EXISTS archive_reason TEXT;
      ALTER TABLE members ADD COLUMN IF NOT EXISTS exit_request_id UUID
        REFERENCES membership_exit_requests(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_members_archived ON members(cooperative_id, archived_at);
    `,
  },
  {
    name: "cooperative_requests — the RCA sees a dissolution from filing",
    sql: `
      -- A dissolution concerns the RCA from the moment it is filed, not only
      -- when it reaches their desk two stages later. Recording when each level
      -- was told lets the RCA watch a case travel up the chain.
      ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS rca_informed_at TIMESTAMPTZ;
      ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS district_informed_at TIMESTAMPTZ;

      UPDATE cooperative_requests
         SET rca_informed_at = created_at, district_informed_at = created_at
       WHERE request_type = 'dissolution' AND rca_informed_at IS NULL;
    `,
  },
  {
    name: "cooperative_requests — issue reports from members",
    sql: `
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
    `,
  },
  {
    name: "reports — store what was generated, so it can be downloaded",
    sql: `
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
    `,
  },
  {
    name: "monthly_audit_runs — who audited which scope, at which level",
    sql: `
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
    `,
  },
  {
    name: "cooperatives.district / cooperative_requests.district",
    sql: `
      -- The register was implicitly one district (Gasabo). The RCA supervises every
      -- district, so each cooperative and each request now says which one it is in.
      -- Existing rows are all in Gasabo, which is what the default records.
      ALTER TABLE cooperatives ADD COLUMN IF NOT EXISTS district VARCHAR(100) NOT NULL DEFAULT 'Gasabo';
      CREATE INDEX IF NOT EXISTS idx_cooperatives_district ON cooperatives(district);
      ALTER TABLE cooperative_requests ADD COLUMN IF NOT EXISTS district VARCHAR(100) NOT NULL DEFAULT 'Gasabo';
    `,
  },
  {
    name: "users.member_id — a login tied to its member record for good",
    sql: `
      -- A member's login was matched to their register entry by cooperative plus
      -- national id, phone or name. An approved exit clears the cooperative, so
      -- the match broke and the member lost sight of their own record — the one
      -- thing a departed member still needs. The link is now stored, and it
      -- survives the member leaving.
      ALTER TABLE users ADD COLUMN IF NOT EXISTS member_id UUID REFERENCES members(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_users_member_id ON users(member_id);

      -- Accounts still attached: match within their cooperative.
      UPDATE users u SET member_id = m.id
        FROM members m
       WHERE u.member_id IS NULL AND u.role = 'member'
         AND m.cooperative_id = u.cooperative_id
         AND ((u.national_id IS NOT NULL AND m.national_id = u.national_id)
              OR (u.phone IS NOT NULL AND m.phone = u.phone)
              OR LOWER(m.full_name) = LOWER(u.name));

      -- Accounts already detached by an approved exit: the request names the member.
      UPDATE users u SET member_id = e.member_id
        FROM membership_exit_requests e
       WHERE u.member_id IS NULL AND e.requested_by = u.id
         AND e.member_id IS NOT NULL AND e.status = 'approved';
    `,
  },
  {
    name: "membership_exit_requests — an approved exit can be reversed",
    sql: `
      -- A release approved in error (or in testing) left no way back but
      -- hand-editing the database. 'reversed' records that it was undone, by
      -- whom and why; the certificate is revoked, the settlement kept as history.
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
    `,
  },
  {
    name: "cooperative_documents — a document may have no file yet",
    sql: `
      -- The seed stored every document's url as a placeholder address that does
      -- not exist, so opening any of them showed "can't reach this page". A
      -- register entry whose original has not been uploaded is now NULL, which
      -- the page shows as "file not uploaded yet" and the manager can fill.
      ALTER TABLE cooperative_documents ALTER COLUMN url DROP NOT NULL;
      UPDATE cooperative_documents SET url = NULL WHERE url LIKE '%storage-placeholder.com%';
    `,
  },
  {
    name: "cooperative_assemblies — assemblies called for a dissolution",
    sql: `
      -- A dissolution needs two general assemblies: the one that resolves to
      -- dissolve and appoints the liquidator, and the one that receives the
      -- liquidator's report. Neither could be called from the system, so neither
      -- reached the members' calendars. Each call is recorded here against the
      -- activity it created.
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
    `,
  },
  {
    name: "member money — one source of truth (ledger, totals, cash book)",
    sql: `
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

    `,
  },
];
