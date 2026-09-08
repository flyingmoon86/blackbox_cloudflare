"""使用内存数据库验证申请通知，不读写本地 MySQL 数据。"""
import unittest

from config import Config

Config.SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
from app import app
from models import db, User, Member, JoinRequest


class JoinResultTests(unittest.TestCase):
    def setUp(self):
        app.config.update(TESTING=True, SECRET_KEY="test-key")
        self.context = app.app_context()
        self.context.push()
        db.create_all()
        admin = User(username="admin", role="admin")
        visitor = User(username="visitor", role="user")
        other = User(username="other", role="user")
        for user in (admin, visitor, other):
            user.set_password("test-password")
        db.session.add_all([admin, visitor, other, Member(name="现有队员")])
        db.session.commit()
        self.admin_id, self.visitor_id, self.other_id = admin.id, visitor.id, other.id
        self.member_id = Member.query.first().id
        self.admin = self.client(self.admin_id)
        self.visitor = self.client(self.visitor_id)
        self.other = self.client(self.other_id)

    def client(self, user_id):
        client = app.test_client()
        with client.session_transaction() as session:
            session["user_id"] = user_id
        return client

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        self.context.pop()

    def apply(self, kind="new"):
        response = self.visitor.post("/profile/apply_member", data={
            "identity_note": "参与排练", "apply_type": kind, "name": "新队员", "bio": "原简介",
            "cohort": "2026 届", "join_year": "2026", "member_id": self.member_id,
        })
        self.assertEqual(response.status_code, 302)
        return JoinRequest.query.order_by(JoinRequest.id.desc()).first()

    def test_approval_persists_until_acknowledged(self):
        req = self.apply()
        self.admin.post(f"/admin/requests/{req.id}/approve")
        for _ in range(2):
            page = self.visitor.get("/profile").get_data(as_text=True)
            self.assertIn("入队申请已通过", page)
            self.assertIn("有未确认的申请结果", page)
        with self.visitor.session_transaction() as session:
            self.assertEqual(session["role"], "member")
            self.assertTrue(session["is_member"])
        count = Member.query.count()
        self.admin.post(f"/admin/requests/{req.id}/approve")
        self.admin.post(f"/admin/requests/{req.id}/reject", data={"note": "改判"})
        self.assertEqual(Member.query.count(), count)
        self.assertEqual(req.status, "approved")
        self.assertEqual(self.other.post(f"/profile/requests/{req.id}/acknowledge").status_code, 403)
        self.assertNotIn("入队申请已通过", self.other.get("/profile").get_data(as_text=True))
        self.visitor.post(f"/profile/requests/{req.id}/acknowledge")
        page = self.visitor.get("/profile").get_data(as_text=True)
        self.assertNotIn("入队申请已通过", page)
        self.assertNotIn("有未确认的申请结果", page)
        self.assertTrue(req.result_acknowledged)

    def test_reject_requires_reason_and_allows_switch(self):
        req = self.apply()
        self.admin.post(f"/admin/requests/{req.id}/reject", data={"note": "  "})
        self.assertEqual(req.status, "pending")
        self.admin.post(f"/admin/requests/{req.id}/reject", data={"note": "请核对届别"})
        page = self.visitor.get("/profile").get_data(as_text=True)
        self.assertIn("请核对届别", page)
        self.assertIn('value="新队员"', page)
        self.assertIn("原简介", page)
        self.visitor.post(f"/profile/requests/{req.id}/acknowledge")
        page = self.visitor.get("/profile").get_data(as_text=True)
        self.assertNotIn("请核对届别", page)
        self.assertNotIn("入队申请已驳回", page)
        self.assertIn("原简介", page)
        retry = self.apply("bind")
        self.assertNotEqual(req.id, retry.id)
        self.admin.post(f"/admin/requests/{retry.id}/approve")
        self.assertEqual(db.session.get(User, self.visitor_id).member_id, self.member_id)
        self.assertIn("入队申请已通过", self.visitor.get("/profile").get_data(as_text=True))

    def test_retry_edit_and_password_render(self):
        req = self.apply("bind")
        self.admin.post(f"/admin/requests/{req.id}/reject", data={"note": "请新建档案"})
        page = self.visitor.post("/profile/password", data={"old_password": "wrong"}).get_data(as_text=True)
        self.assertIn("请新建档案", page)
        self.visitor.post("/profile/apply_member", data={
            "identity_note": "排练经历", "apply_type": "new", "name": "修正姓名", "join_year": "2025", "bio": "修正简介",
        })
        retry = JoinRequest.query.order_by(JoinRequest.id.desc()).first()
        self.assertEqual(retry.name, "修正姓名")
        self.assertEqual(retry.status, "pending")
        # 再次申请不会制造第二条待审核记录，也不会自动清除旧结果提醒。
        self.apply()
        self.assertEqual(JoinRequest.query.filter_by(status="pending").count(), 1)
        self.assertFalse(req.result_acknowledged)

    def test_invalid_year_and_disabled_session(self):
        response = self.visitor.post("/profile/apply_member", data={
            "apply_type": "new", "name": "新队员", "join_year": "bad",
        })
        self.assertEqual(response.status_code, 302)
        self.assertEqual(JoinRequest.query.count(), 0)
        db.session.get(User, self.visitor_id).status = "disabled"
        db.session.commit()
        self.assertEqual(self.visitor.get("/profile").status_code, 302)


if __name__ == "__main__":
    unittest.main()
