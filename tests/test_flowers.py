"""献花权限、自然日限额、页面状态与迁移回归；仅使用内存数据库。"""
from datetime import date, datetime, timezone
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from config import Config
Config.SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
from app import app, flower_day
from models import db, Flower, Member, User
from migrate import upgrade_flowers as migrate


class FlowerTests(unittest.TestCase):
    def setUp(self):
        app.config.update(TESTING=True, SECRET_KEY="test-key")
        self.context = app.app_context()
        self.context.push()
        db.create_all()
        # SQLite 默认不检查外键，启用后能验证删除清理和 MySQL 一致。
        db.session.execute(db.text("PRAGMA foreign_keys=ON"))
        db.session.add_all([
            User(id=1, username="visitor", password_hash="unused"),
            User(id=2, username="other", password_hash="unused"),
            User(id=3, username="admin", role="admin", password_hash="unused"),
            Member(id=1, name="测试队员", join_year=2026, bio="舞台故事"),
            Member(id=2, name="另一位队员"),
        ])
        db.session.commit()
        self.visitor = self.client(1)

    def client(self, user_id):
        client = app.test_client()
        with client.session_transaction() as session:
            session["user_id"] = user_id
        client.get("/members")
        return client

    def send(self, client=None, member_id=1, **data):
        client = client or self.visitor
        with client.session_transaction() as session:
            data.setdefault("flower_token", session["flower_token"])
        return client.post(f"/members/{member_id}/flowers", data=data)

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        self.context.pop()

    def test_repeat_and_new_session_share_daily_limit(self):
        self.assertEqual(self.send().status_code, 302)
        self.send()
        self.send(self.client(1))
        self.assertEqual(Flower.query.count(), 1)
        for path in ("/members", "/members/1"):
            page = self.visitor.get(path).get_data(as_text=True)
            self.assertIn("今日已献花", page)
            self.assertIn('class="flower-count">1</span>', page)
        self.send(self.client(2))
        self.send(member_id=2)
        self.assertEqual(Flower.query.count(), 3)

    def test_next_day_and_beijing_midnight(self):
        with patch("app.flower_day", return_value=date(2026, 9, 7)):
            self.send()
        with patch("app.flower_day", return_value=date(2026, 9, 8)):
            self.assertNotIn("今日已献花", self.visitor.get("/members/1").get_data(as_text=True))
            self.send()
        self.assertEqual(Flower.query.count(), 2)
        for hour, minute, expected in ((15, 59, date(2026, 9, 7)), (16, 0, date(2026, 9, 8))):
            instant = datetime(2026, 9, 7, hour, minute, tzinfo=timezone.utc)
            with patch("app.datetime") as clock:
                clock.now.side_effect = lambda tz: instant.astimezone(tz)
                self.assertEqual(flower_day(), expected)

    def test_auth_token_missing_member_and_disabled_user(self):
        self.assertEqual(app.test_client().post("/members/1/flowers").status_code, 302)
        self.assertEqual(self.visitor.get("/members/1/flowers").status_code, 405)
        self.assertEqual(self.visitor.post("/members/1/flowers").status_code, 400)
        self.assertEqual(self.send(flower_token="wrong").status_code, 400)
        self.assertEqual(self.send(flower_token="错误令牌").status_code, 400)
        self.assertEqual(self.send(member_id=999).status_code, 404)
        db.session.get(User, 1).status = "disabled"
        db.session.commit()
        self.assertEqual(self.send().status_code, 302)
        self.assertEqual(Flower.query.count(), 0)

    def test_filter_pagination_return_and_empty_state(self):
        db.session.add_all([Member(name=f"测试队员{i}", join_year=2026) for i in range(12)])
        db.session.commit()
        page = self.visitor.get("/members?keyword=测试&year=2026&page=2").get_data(as_text=True)
        self.assertEqual(page.count('<article class="member-card">'), 3)
        response = self.send(return_to="list", keyword="测试", year="2026", page="2")
        self.assertEqual(parse_qs(urlsplit(response.location).query),
                         {"keyword": ["测试"], "year": ["2026"], "page": ["2"]})
        self.assertIn("没有找到匹配的队员", self.visitor.get("/members?keyword=不存在").get_data(as_text=True))
        self.assertTrue(self.send(return_to="https://example.com").location.startswith("/members/1"))

    def test_deletion_cleans_foreign_keys(self):
        self.send()
        self.send(member_id=2)
        admin = self.client(3)
        self.assertEqual(admin.post("/members/1/delete").status_code, 302)
        self.assertEqual(Flower.query.count(), 1)
        self.assertEqual(admin.post("/admin/users/1/delete").status_code, 302)
        self.assertEqual(Flower.query.count(), 0)

    def test_migration_is_repeatable_and_preserves_records(self):
        Flower.__table__.drop(db.engine)
        migrate()
        self.send()
        migrate()
        self.assertEqual(Flower.query.count(), 1)
        self.assertEqual(Member.query.count(), 2)


if __name__ == "__main__":
    unittest.main()
