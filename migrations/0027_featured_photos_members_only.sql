-- Preserve the previous local draft and its audit values, but make the audience
-- explicit. Application reads always require a currently certified member/admin.
-- Renaming never copies legacy private photos or grants public access.
ALTER TABLE member_featured_photo RENAME COLUMN public_consent TO members_consent;
ALTER TABLE member_featured_photo_history RENAME COLUMN public_consent TO members_consent;
