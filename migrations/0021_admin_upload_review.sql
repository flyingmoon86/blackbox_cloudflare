-- New uploads from administrators are published under that administrator's identity.
-- Historical review records and resource status are not rewritten.
DROP TRIGGER IF EXISTS resource_auto_review_insert;
CREATE TRIGGER resource_admin_upload_review AFTER INSERT ON resource
WHEN NEW.status='approved' AND NEW.source_upload_task_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM user WHERE id=NEW.uploader_id AND role='admin' AND status='active')
BEGIN
 UPDATE resource SET reviewed_by=NEW.uploader_id,reviewed_at=CURRENT_TIMESTAMP WHERE id=NEW.id;
 INSERT INTO review_history(entity_type,entity_id,actor_id,decision,note)
 VALUES('resource',NEW.id,NEW.uploader_id,'approved','管理员上传直接发布；文件、权限和容量检查通过');
END;
