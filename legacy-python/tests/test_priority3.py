"""优先级 3 回归；内存数据库、模拟邮件，不向任何真实邮箱发信。"""
from datetime import timedelta
import re
import smtplib
import unittest
from unittest.mock import patch

from config import Config
Config.SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
from app import app
from account import issue_email, utcnow
from models import db, User, Member, Resource, Announcement, EmailToken
from migrate import upgrade_priority3 as migrate


class Priority3Tests(unittest.TestCase):
    def setUp(self):
        self.old_config = {key: app.config.get(key) for key in (
            "MAIL_HOST", "MAIL_PORT", "MAIL_USERNAME", "MAIL_PASSWORD", "MAIL_FROM", "MAIL_USE_SSL", "PUBLIC_BASE_URL")}
        app.config.update(TESTING=True, SECRET_KEY="test-key", MAIL_HOST="mail.example.test", MAIL_PORT=465,
                          MAIL_USERNAME="test", MAIL_PASSWORD="test-only", MAIL_FROM="team@example.test",
                          MAIL_USE_SSL=True, PUBLIC_BASE_URL="https://theatre.example.test")
        self.context = app.app_context()
        self.context.push()
        db.create_all()
        db.session.execute(db.text("PRAGMA foreign_keys=ON"))
        member = Member(id=1, name="队员甲", works="旧代表作")
        user = User(id=1, username="visitor", email="visitor@example.test")
        other = User(id=2, username="member", role="member", member=member)
        admin = User(id=3, username="admin", role="admin")
        for u in (user, other, admin):
            u.set_password("old-password")
        db.session.add_all([user, other, admin, Resource(id=1, title="演出录像", filename="test.mp4"),
                            Resource(id=2, title="剧本", filename="test.txt")])
        db.session.commit()
        self.client = app.test_client()
        self.client.get("/login")
        self.mail = patch("account.send_email").start()

    def tearDown(self):
        patch.stopall()
        db.session.remove()
        db.drop_all()
        self.context.pop()
        app.config.update(self.old_config)

    def login(self, user_id=1):
        with self.client.session_transaction() as session:
            session["user_id"] = user_id
            session["auth_version"] = db.session.get(User, user_id).auth_version

    def post(self, path, **data):
        with self.client.session_transaction() as session:
            data["csrf_token"] = session["account_token"]
        return self.client.post(path, data=data)

    def mail_path(self):
        body = self.mail.call_args.args[2]
        return re.search(r"https://theatre.example.test([^\s]+)", body).group(1)

    def test_public_pages_archive_and_safe_content(self):
        for i in range(12):
            db.session.add(Announcement(title=f"公告{i}", content="第一行\n<script>alert(1)</script>"))
        db.session.commit()
        for path in ("/", "/contact", "/login", "/register"):
            self.assertEqual(self.client.get(path).status_code, 200, path)
        self.assertIn("moonflying56@gmail.com", self.client.get("/contact").text)
        for path in ("/about", "/announcements", "/announcements/1", "/announcements?page=2"):
            self.assertEqual(self.client.get(path).status_code, 302)
        self.assertNotIn("公告0", self.client.get("/").text)
        self.login()
        self.assertEqual(self.client.get("/").text.count('class="news-item"'), 5)
        self.assertEqual(self.client.get("/announcements?page=2").text.count('class="news-item"'), 2)
        self.assertIn("&lt;script&gt;", self.client.get("/announcements/1").text)
        self.assertEqual(self.client.get("/announcements/999").status_code, 404)

    def test_registration_preserves_unverified_email(self):
        response = self.post("/register", username="new", email="NEW@EXAMPLE.TEST", password="new-password", confirm_password="new-password")
        self.assertEqual(response.status_code, 302)
        user = User.query.filter_by(username="new").one()
        self.assertIsNone(user.email)
        self.assertEqual(user.pending_email, "new@example.test")
        self.assertTrue(user.check_password("new-password"))
        path = self.mail_path()
        self.assertEqual(self.client.get(path).status_code, 200)
        self.assertIsNone(user.email)  # 邮件扫描器 GET 不会消费链接
        self.assertEqual(self.post(path).status_code, 302)
        self.assertEqual(user.email, "new@example.test")
        self.assertEqual(self.post(path).status_code, 400)

    def test_registration_and_login_validation(self):
        self.assertEqual(self.client.post("/register", data={}).status_code, 400)
        self.assertEqual(self.post("/register", username="new", password="short", confirm_password="short").status_code, 400)
        self.assertEqual(self.post("/register", username="new", email="bad", password="password", confirm_password="password").status_code, 400)
        self.assertEqual(self.client.post("/login", data={"username": "visitor", "password": "old-password"}).status_code, 400)
        self.assertEqual(self.post("/login", username="visitor", password="old-password").status_code, 302)

    def test_unconfigured_email_is_honest_and_still_records_contact(self):
        app.config["MAIL_HOST"] = ""
        self.login()
        self.post("/profile/email", email="later@example.test", password="old-password")
        self.assertEqual(db.session.get(User, 1).pending_email, "later@example.test")
        self.assertIn("邮件服务尚未启用", self.client.get("/profile").text)
        self.assertEqual(self.post("/forgot-password", email="visitor@example.test").status_code, 503)
        self.mail.assert_not_called()

    def test_binding_requires_password_and_does_not_replace_until_verified(self):
        self.login()
        self.post("/profile/email", email="new@example.test", password="wrong")
        self.assertIsNone(db.session.get(User, 1).pending_email)
        self.post("/profile/email", email="new@example.test", password="old-password")
        self.assertEqual(db.session.get(User, 1).email, "visitor@example.test")
        self.assertEqual(self.post(self.mail_path()).status_code, 302)
        self.assertEqual(db.session.get(User, 1).email, "new@example.test")
        self.assertIsNone(db.session.get(User, 1).pending_email)

    def test_verified_email_cannot_be_claimed_by_another_account(self):
        self.login(2)
        self.post("/profile/email", email="visitor@example.test", password="old-password")
        self.assertEqual(self.post(self.mail_path()).status_code, 409)
        self.assertIsNone(db.session.get(User, 2).email)

    def test_reset_single_use_and_revokes_old_sessions_and_other_links(self):
        self.login()
        first = self.post("/forgot-password", email="visitor@example.test")
        self.assertEqual(first.status_code, 200)
        path = self.mail_path()
        self.assertNotIn(path.split('/')[-1], EmailToken.query.one().digest)
        db.session.get(User, 1).mail_sent_at = utcnow() - timedelta(minutes=2)
        db.session.commit()
        self.post("/forgot-password", email="visitor@example.test")
        second_path = self.mail_path()
        old_client = app.test_client()
        with old_client.session_transaction() as session:
            session["user_id"] = 1
        self.assertEqual(self.post(path, password="new-password", confirm_password="different").status_code, 400)
        self.assertEqual(self.post(path, password="new-password", confirm_password="new-password").status_code, 302)
        self.assertTrue(db.session.get(User, 1).check_password("new-password"))
        self.assertEqual(old_client.get("/profile").status_code, 302)
        self.assertEqual(self.client.get(path).status_code, 400)
        self.assertEqual(self.client.get(second_path).status_code, 400)

    def test_expiry_purpose_disabled_and_old_password_links(self):
        self.post("/forgot-password", email="visitor@example.test")
        path = self.mail_path()
        self.assertEqual(self.client.get(path.replace("reset-password", "verify-email")).status_code, 400)
        token = EmailToken.query.one()
        token.expires_at = utcnow() - timedelta(seconds=1)
        db.session.commit()
        self.assertEqual(self.client.get(path).status_code, 400)
        token.expires_at = utcnow() + timedelta(minutes=30)
        db.session.get(User, 1).status = "disabled"
        db.session.commit()
        self.assertEqual(self.client.get(path).status_code, 400)
        db.session.get(User, 1).status = "active"
        db.session.commit()
        self.login()
        self.client.post("/profile/password", data={"old_password": "old-password", "new_password": "changed-password"})
        self.assertEqual(self.client.get(path).status_code, 400)

    def test_generic_response_throttle_and_transport_failure(self):
        known = self.post("/forgot-password", email="visitor@example.test").text
        unknown = self.post("/forgot-password", email="unknown@example.test").text
        self.assertEqual(known, unknown)
        self.post("/forgot-password", email="visitor@example.test")
        self.assertEqual(self.mail.call_count, 1)
        db.session.get(User, 1).mail_sent_at = utcnow() - timedelta(minutes=2)
        db.session.commit()
        self.mail.side_effect = smtplib.SMTPException("test failure")
        self.assertEqual(self.post("/forgot-password", email="visitor@example.test").text, known)
        self.assertTrue(EmailToken.query.order_by(EmailToken.id.desc()).first().consumed)

    def test_member_resource_links_permissions_and_cleanup(self):
        self.assertEqual(self.client.get("/resources/1").status_code, 302)
        self.login(1)
        self.assertEqual(self.client.post("/profile/edit_member", data={"resources_present": "1", "resource_ids": ["1"]}).status_code, 302)
        self.assertEqual(db.session.get(Member, 1).resources, [])
        self.login(2)
        response = self.client.post("/profile/edit_member", data={"resources_present": "1", "resource_ids": ["1", "2"], "works": "保留文字"})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(len(db.session.get(Member, 1).resources), 2)
        self.assertIn("演出录像", self.client.get("/members/1").text)
        self.assertIn("队员甲", self.client.get("/resources/1").text)
        self.assertEqual(self.client.post("/profile/edit_member", data={"resources_present": "1", "resource_ids": ["999"]}).status_code, 400)
        db.session.rollback()
        self.login(3)
        self.assertEqual(self.client.post("/resources/1/delete").status_code, 302)
        self.assertEqual([r.id for r in db.session.get(Member, 1).resources], [2])
        self.assertEqual(self.client.post("/members/1/delete").status_code, 302)
        self.assertEqual(db.session.execute(db.text("SELECT COUNT(*) FROM member_resource")).scalar(), 0)

    def test_migration_from_old_schema_and_repeat_run(self):
        db.session.remove()
        db.drop_all()
        Member.__table__.create(db.engine)
        Resource.__table__.create(db.engine)
        with db.engine.begin() as connection:
            connection.execute(db.text("CREATE TABLE user (id INTEGER PRIMARY KEY, username VARCHAR(50), password_hash VARCHAR(255), role VARCHAR(20), status VARCHAR(20), member_id INTEGER)"))
            connection.execute(db.text("INSERT INTO user (id, username, password_hash, role, status) VALUES (1, 'legacy', 'preserved', 'user', 'active')"))
        migrate()
        migrate()
        from migrate import upgrade_theater as migrate_theater
        migrate_theater()
        migrate_theater()
        user = db.session.get(User, 1)
        self.assertEqual(user.password_hash, "preserved")
        self.assertEqual(user.auth_version, 0)
        self.assertIsNone(user.email)
        self.assertTrue(db.inspect(db.engine).has_table("email_token"))
        self.assertTrue(db.inspect(db.engine).has_table("member_resource"))


if __name__ == "__main__":
    unittest.main()
