ALTER TABLE suggestion ADD COLUMN category TEXT NOT NULL DEFAULT 'website';
ALTER TABLE suggestion ADD COLUMN production_title TEXT;
ALTER TABLE suggestion ADD COLUMN production_year INTEGER;

CREATE INDEX ix_suggestion_category_status ON suggestion(category, status, created_at);
