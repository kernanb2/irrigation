-- Automation rules, set up from the dashboard's Automation panel (no cron expressions).
-- One row per rule kind. config holds the choices made on the page; state is the
-- rule's own bookkeeping (what it started, a drain position it's holding back, its
-- last action) so it only ever stops what it started.
CREATE TABLE automation_rules (
    id         INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    kind       VARCHAR(32) NOT NULL UNIQUE,
    enabled    BOOLEAN NOT NULL DEFAULT FALSE,
    config     JSON NOT NULL,
    state      JSON NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Pond level: when the pond is below_in inches below full, fill it from source until
-- it's back to full. Below low_mark_in the Pond Drain is closed so the tanks stop
-- taking pond water, unless allow_below_low is on.
INSERT INTO automation_rules (kind, enabled, config) VALUES
('pond_level', FALSE, '{"below_in": 1, "source": "pond_fill", "low_mark_in": 6, "allow_below_low": false}');

-- Timed runs: config = {"runs": [{"id", "enabled", "source", "minutes", "times": ["HH:MM"], "days": [0–6, 0 = Sunday]}]}
INSERT INTO automation_rules (kind, enabled, config) VALUES ('timed_runs', TRUE, '{"runs": []}');
