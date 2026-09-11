import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createDatabase, d1, loadModule } from "./harness.mjs";
const { reviewRequest } = await loadModule("src/services/reviews.ts");
function setup() {
  const db = createDatabase();
  db.exec(
    "INSERT INTO user(id,username,password_hash,role) VALUES(1,'admin','test','admin'),(2,'applicant','test','user'),(3,'other','test','user');INSERT INTO production(id,title,feature_layout) VALUES(90,'测试作品','overlay');",
  );
  return { db, DB: d1(db) };
}
const count = (db, table) => db.prepare("SELECT COUNT(*) n FROM " + table).get().n;
test("one successful review creates one member and one audit; duplicate/reversed review changes nothing", async () => {
  const { db, DB } = setup();
  db.exec("INSERT INTO join_request(id,user_id,apply_type,name) VALUES(10,2,'new','甲');");
  const results = await Promise.allSettled([
    reviewRequest(DB, "member", 10, 1, "approved"),
    reviewRequest(DB, "member", 10, 1, "approved"),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(count(db, "member"), 1);
  assert.equal(count(db, "review_history"), 1);
  assert.equal(
    db.prepare("SELECT member_id FROM user WHERE id=2").get().member_id,
    db.prepare("SELECT id FROM member").get().id,
  );
  assert.equal(db.prepare("SELECT auth_version FROM user WHERE id=2").get().auth_version, 1);
  await assert.rejects(reviewRequest(DB, "member", 10, 1, "rejected", "晚到的请求"), (e) => e.status === 409);
});
test("pending uniqueness and competing requests cannot bind one member to two accounts", async () => {
  const { db, DB } = setup();
  db.exec(
    "INSERT INTO member(id,name) VALUES(50,'已存在档案');INSERT INTO join_request(id,user_id,apply_type,member_id) VALUES(10,2,'bind',50),(11,3,'bind',50);",
  );
  assert.throws(() => db.exec("INSERT INTO join_request(user_id,apply_type,name) VALUES(2,'new','重复');"), /UNIQUE/);
  await reviewRequest(DB, "member", 10, 1, "approved");
  await assert.rejects(reviewRequest(DB, "member", 11, 1, "approved"), (e) => e.status === 409);
  assert.equal(db.prepare("SELECT status FROM join_request WHERE id=11").get().status, "pending");
  assert.equal(count(db, "member"), 1);
});
test("disabled applicant cannot be approved; trigger failure rolls back status and all effects", async () => {
  const { db, DB } = setup();
  db.exec(
    "INSERT INTO join_request(id,user_id,apply_type,name) VALUES(10,2,'new','甲');UPDATE user SET status='disabled' WHERE id=2;",
  );
  await assert.rejects(reviewRequest(DB, "member", 10, 1, "approved"), (e) => e.status === 409);
  assert.equal(count(db, "member"), 0);
  assert.equal(count(db, "review_history"), 0);
  assert.equal(db.prepare("SELECT status FROM join_request").get().status, "pending");
  db.exec(
    "UPDATE user SET status='active' WHERE id=2;CREATE TRIGGER fail_audit BEFORE INSERT ON review_history BEGIN SELECT RAISE(ABORT,'simulated-d1-fault');END;",
  );
  await assert.rejects(reviewRequest(DB, "member", 10, 1, "approved"), /simulated-d1-fault/);
  assert.equal(count(db, "member"), 0);
  assert.equal(db.prepare("SELECT role FROM user WHERE id=2").get().role, "user");
});
test("AB actors and several roles per actor remain valid; exact duplicates are prevented", async () => {
  const { db, DB } = setup();
  db.exec(
    "INSERT INTO member(id,name) VALUES(20,'甲'),(30,'乙');UPDATE user SET role='member',member_id=20 WHERE id=2;UPDATE user SET role='member',member_id=30 WHERE id=3;INSERT INTO production_join_request(id,user_id,member_id,production_id,kind,role_name) VALUES(10,2,20,90,'cast','主角'),(11,3,30,90,'cast','主角'),(12,2,20,90,'cast','路人');",
  );
  for (const id of [10, 11, 12]) await reviewRequest(DB, "production-join", id, 1, "approved");
  assert.equal(count(db, "production_credit"), 3);
  assert.throws(
    () => db.exec("INSERT INTO production_credit(production_id,member_id,kind,role_name) VALUES(90,20,'cast','主角');"),
    /UNIQUE/,
  );
  db.exec(
    "INSERT INTO production_join_request(id,user_id,member_id,production_id,kind,role_name) VALUES(13,2,20,90,'crew','灯光');UPDATE user SET role='user',member_id=NULL WHERE id=2;",
  );
  await assert.rejects(reviewRequest(DB, "production-join", 13, 1, "approved"), (e) => e.status === 409);
  assert.equal(count(db, "production_credit"), 3);
});
test("rejections require reasons; resource review and deleted-reviewer anonymization persist", async () => {
  const { db, DB } = setup();
  db.exec("INSERT INTO resource(id,title,status,filename) VALUES(70,'照片','pending','photo.jpg');");
  await assert.rejects(reviewRequest(DB, "resource", 70, 1, "rejected", ""), (e) => e.status === 400);
  await reviewRequest(DB, "resource", 70, 1, "rejected", "请补充来源");
  db.exec("DELETE FROM resource WHERE id=70;DELETE FROM user WHERE id=1;");
  const row = db.prepare("SELECT actor_id,note,entity_id,reviewed_at FROM review_history").get();
  assert.equal(row.actor_id, null);
  assert.equal(row.note, "请补充来源");
  assert.equal(row.entity_id, 70);
  assert.ok(row.reviewed_at);
});
test("upgrade preserves historic IDs, hashes, layouts and references; duplicate histories require manual resolution", () => {
  const db = createDatabase(8);
  db.exec(
    "INSERT INTO member(id,name) VALUES(987,'历史档案');INSERT INTO user(id,username,password_hash,role,member_id) VALUES(654,'historic','original-hash','member',987);INSERT INTO production(id,title,feature_layout) VALUES(321,'旧作品','overlay');INSERT INTO resource(id,title,filename,production_id) VALUES(432,'旧资料','historic/key.jpg',321);",
  );
  db.exec(readFileSync("migrations/0009_review_integrity.sql", "utf8"));
  assert.equal(db.prepare("SELECT password_hash FROM user WHERE id=654").get().password_hash, "original-hash");
  assert.equal(db.prepare("SELECT feature_layout FROM production WHERE id=321").get().feature_layout, "overlay");
  assert.equal(db.prepare("SELECT filename FROM resource WHERE id=432").get().filename, "historic/key.jpg");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  const conflicting = createDatabase(8);
  conflicting.exec(
    "INSERT INTO user(id,username,password_hash) VALUES(1,'one','hash');INSERT INTO join_request(user_id,apply_type,name) VALUES(1,'new','a'),(1,'new','b');",
  );
  assert.throws(() => conflicting.exec(readFileSync("migrations/0009_review_integrity.sql", "utf8")), /UNIQUE/);
  assert.equal(count(conflicting, "join_request"), 2);
});
