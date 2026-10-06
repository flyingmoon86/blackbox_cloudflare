-- Match the detail page equality filters before its stable chronological order.
-- Keep existing indexes: other queries order by id or span multiple editions.
CREATE INDEX ix_resource_production_edition_order
ON resource(production_id,edition_id,status,created_at DESC,id DESC);
