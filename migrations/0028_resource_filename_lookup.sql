-- Exact object-key lookups are used by legacy upload recovery and shared-file cleanup.
-- Keep historical rows and duplicate/shared filenames; this index is not unique.
CREATE INDEX ix_resource_filename ON resource(filename);
