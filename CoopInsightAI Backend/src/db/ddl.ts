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
           'approved','rejected','withdrawn'));

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
];
