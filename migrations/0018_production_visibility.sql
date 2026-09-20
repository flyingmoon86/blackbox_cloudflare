ALTER TABLE production ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0, 1));
CREATE INDEX idx_production_visibility_year ON production(is_hidden, year DESC, id DESC);
