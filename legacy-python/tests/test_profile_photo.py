"""验证头像上传、跨页面展示和再次保存；仅使用内存库和临时目录。"""
import base64
import io
from pathlib import Path
import tempfile
import unittest

from config import Config

Config.SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
from app import app
from models import db, Member, User


PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGN8AAAAASUVORK5CYII="
)


class ProfilePhotoTests(unittest.TestCase):
    def setUp(self):
        self.files = tempfile.TemporaryDirectory()
        self.old_upload = app.config["UPLOAD_FOLDER"]
        self.old_static = app.static_folder
        app.static_folder = self.files.name
        app.config.update(TESTING=True, SECRET_KEY="test-key",
                          UPLOAD_FOLDER=str(Path(self.files.name) / "uploads"))
        self.context = app.app_context()
        self.context.push()
        db.create_all()
        self.member = Member(name="头像测试", bio="原简介")
        user = User(username="photo-user", role="member", member=self.member)
        user.set_password("test-password")
        db.session.add(user)
        db.session.commit()
        self.client = app.test_client()
        with self.client.session_transaction() as session:
            session["user_id"] = user.id

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        self.context.pop()
        app.config["UPLOAD_FOLDER"] = self.old_upload
        app.static_folder = self.old_static
        self.files.cleanup()

    def upload(self):
        response = self.client.post("/profile/edit_member", data={
            "bio": "新简介", "photo": (io.BytesIO(PNG), "我的头像.PNG"),
        }, follow_redirects=True)
        self.assertEqual(response.status_code, 200)
        db.session.expire_all()
        return self.member.photo, response.get_data(as_text=True)

    def test_upload_display_and_save_without_replacing(self):
        filename, page = self.upload()
        image_url = f"/static/uploads/{filename}"
        self.assertTrue(filename.endswith(".png"))
        self.assertEqual(page.count(f'src="{image_url}"'), 2)
        self.assertIn("资料已保存", page)
        image = self.client.get(image_url)
        self.assertEqual(image.status_code, 200)
        self.assertEqual(image.data, PNG)
        image.close()
        for route in ("/members", f"/members/{self.member.id}"):
            self.assertIn(image_url, self.client.get(route).get_data(as_text=True))
        response = self.client.post("/profile/edit_member", data={
            "bio": "再次修改", "photo": (io.BytesIO(b""), ""),
        }, follow_redirects=True)
        db.session.expire_all()
        self.assertEqual(self.member.photo, filename)
        self.assertEqual(self.member.bio, "再次修改")
        self.assertIn(image_url, response.get_data(as_text=True))
        new_filename, page = self.upload()
        self.assertNotEqual(new_filename, filename)
        self.assertIn(f'/static/uploads/{new_filename}', page)
        self.assertNotIn(image_url, page)

    def test_unsupported_file_keeps_saved_profile(self):
        filename, _ = self.upload()
        response = self.client.post("/profile/edit_member", data={
            "bio": "不应保存", "photo": (io.BytesIO(b"invalid"), "avatar.svg"),
        }, follow_redirects=True)
        db.session.expire_all()
        self.assertEqual(self.member.photo, filename)
        self.assertEqual(self.member.bio, "新简介")
        self.assertIn("头像格式不支持", response.get_data(as_text=True))

    def test_profile_without_photo_or_binding(self):
        page = self.client.get("/profile").get_data(as_text=True)
        self.assertNotIn('/static/uploads/', page)
        user = User.query.filter_by(username="photo-user").one()
        user.member = None
        user.role = "user"
        db.session.commit()
        self.assertEqual(self.client.get("/profile").status_code, 200)
