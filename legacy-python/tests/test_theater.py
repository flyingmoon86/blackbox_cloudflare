"""特色功能与补充计划回归；仅使用内存库和临时上传目录。"""
import io
from pathlib import Path
import tempfile
import unittest

from config import Config
Config.SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
from app import app
from models import db, User, Member, JoinRequest, Resource, Production, ProductionCredit, SiteProfile
from migrate import upgrade_theater as migrate
from test_profile_photo import PNG


class TheaterTests(unittest.TestCase):
    def setUp(self):
        self.files = tempfile.TemporaryDirectory()
        self.old_folders = {k: app.config[k] for k in ("RESOURCE_FOLDER", "UPLOAD_FOLDER")}
        self.old_static = app.static_folder
        app.static_folder = self.files.name
        app.config.update(TESTING=True, SECRET_KEY="test-key", RESOURCE_FOLDER=str(Path(self.files.name) / "resources"), UPLOAD_FOLDER=str(Path(self.files.name) / "uploads"))
        Path(app.config["RESOURCE_FOLDER"]).mkdir()
        self.context = app.app_context()
        self.context.push()
        db.create_all()
        db.session.execute(db.text("PRAGMA foreign_keys=ON"))
        db.session.add_all([User(id=1, username="visitor", password_hash="unused"),
                            User(id=2, username="member", role="member", password_hash="unused"),
                            User(id=3, username="admin", role="admin", password_hash="unused"),
                            Member(id=1, name="演员甲"), Member(id=2, name="灯光乙"), Production(id=1, title="测试剧目", year=2026)])
        db.session.commit()
        self.visitor, self.member, self.admin = [self.client(i) for i in (1, 2, 3)]

    def client(self, user_id):
        client = app.test_client()
        with client.session_transaction() as session:
            session["user_id"] = user_id
        client.get("/")
        # 首页未必渲染表单，访问设置/登录表单来生成 CSRF 令牌。
        client.get("/login")
        return client

    def post(self, client, path, **data):
        with client.session_transaction() as session:
            data["csrf_token"] = session["account_token"]
        return client.post(path, data=data)

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        self.context.pop()
        app.config.update(self.old_folders)
        app.static_folder = self.old_static
        self.files.cleanup()

    def upload(self, client=None, **values):
        data = dict(title="待审剧照", res_type="photo", production_id="1", file=(io.BytesIO(PNG), "剧照.png"))
        data.update(values)
        response = self.post(client or self.member, "/resources/upload", **data)
        self.assertEqual(response.status_code, 302)
        return Resource.query.order_by(Resource.id.desc()).first()

    def test_hint_disappears_once_and_review_notice_stays(self):
        self.assertIn("首次入队申请提示", self.visitor.get("/").text)
        self.visitor.get("/profile")
        self.assertNotIn("首次入队申请提示", self.client(1).get("/").text)
        self.assertTrue(db.session.get(User, 1).join_hint_seen)
        db.session.add(JoinRequest(user_id=1, apply_type="new", name="甲", status="rejected", admin_note="核对资料"))
        db.session.commit()
        self.visitor.get("/profile")
        self.assertIn("有未确认的申请结果", self.visitor.get("/").text)
        self.assertNotIn("首次入队申请提示", self.member.get("/").text)

    def test_production_permissions_validation_and_credit_navigation(self):
        self.assertEqual(app.test_client().get("/productions").status_code, 302)
        self.assertEqual(self.member.get("/productions/new").status_code, 403)
        self.assertEqual(self.post(self.visitor, "/productions/new", title="非法").status_code, 403)
        self.assertEqual(self.post(self.admin, "/productions/new", title="", year="bad").status_code, 400)
        self.assertEqual(self.post(self.admin, "/productions/new", title="新作品", year="2025", synopsis="简介").status_code, 302)
        self.assertEqual(Production.query.count(), 2)
        for member_id, kind, role in ((1, "cast", "哈姆雷特"), (2, "crew", "灯光设计")):
            self.post(self.admin, "/productions/1/credits", member_id=str(member_id), kind=kind, role_name=role)
        page = self.visitor.get("/productions/1").text
        self.assertIn("哈姆雷特", page)
        self.assertIn("灯光设计", page)
        self.assertIn("测试剧目", self.visitor.get("/members/1").text)
        self.post(self.admin, "/productions/1/credits", member_id="1", kind="cast", role_name="哈姆雷特")
        self.assertEqual(ProductionCredit.query.count(), 2)
        credit_id = ProductionCredit.query.first().id
        self.assertEqual(self.post(self.admin, f"/productions/999/credits/{credit_id}/delete").status_code, 404)
        self.assertEqual(self.admin.get("/productions/1/edit").status_code, 200)

    def test_pending_files_are_private_until_approved(self):
        resource = self.upload()
        self.assertEqual(resource.status, "pending")
        self.assertIn("待审资料数量", self.admin.get("/").text)
        self.assertNotIn(resource.title, self.visitor.get("/productions/1").text)
        for suffix in ("", "/preview", "/download"):
            path = f"/resources/{resource.id}{suffix}"
            self.assertEqual(self.visitor.get(path).status_code, 404)
            response = self.member.get(path)
            self.assertEqual(response.status_code, 200)
            response.close()
            self.assertEqual(app.test_client().get(path).status_code, 302)
        for client in (app.test_client(), self.admin, self.member):
            for prefix in ("/static/resources/", "/static/./resources/", "/static/foo/../resources/"):
                self.assertEqual(client.get(prefix + resource.filename).status_code, 404)
        self.assertEqual(self.post(self.member, f"/admin/resources/{resource.id}/review", action="approve").status_code, 403)
        self.post(self.admin, f"/admin/resources/{resource.id}/review", action="approve")
        self.assertEqual(resource.status, "approved")
        self.assertIn(resource.title, self.visitor.get("/productions/1").text)
        response = self.visitor.get(f"/resources/{resource.id}/preview")
        self.assertEqual(response.data, PNG)
        self.assertEqual(response.headers["Cache-Control"], "private, no-store")
        response.close()
        self.post(self.admin, f"/admin/resources/{resource.id}/review", action="reject", note="不能改判")
        self.assertEqual(resource.status, "approved")

    def test_reject_requires_reason_and_uploader_can_see_it(self):
        resource = self.upload()
        self.post(self.admin, f"/admin/resources/{resource.id}/review", action="reject")
        self.assertEqual(resource.status, "pending")
        self.post(self.admin, f"/admin/resources/{resource.id}/review", action="reject", note="请换清晰的图片")
        self.assertEqual(resource.status, "rejected")
        self.assertIn("请换清晰的图片", self.member.get("/my-uploads").text)
        self.assertNotIn(resource.title, self.visitor.get("/my-uploads").text)

    def test_admin_upload_reclassification_and_delete_preserve_files(self):
        resource = self.upload(self.admin, title="已归档剧照")
        path = Path(app.config["RESOURCE_FOLDER"]) / resource.filename
        self.assertEqual(resource.status, "approved")
        self.assertNotIn(resource.title, self.visitor.get("/resources").text)
        self.post(self.admin, f"/resources/{resource.id}/edit", title="已归档剧照", res_type="photo", production_id="")
        self.assertIsNone(resource.production_id)
        self.assertIn(resource.title, self.visitor.get("/resources").text)
        self.post(self.admin, f"/resources/{resource.id}/edit", title="已归档剧照", res_type="photo", production_id="1")
        self.post(self.admin, "/productions/1/delete")
        self.assertIsNone(resource.production_id)
        self.assertTrue(path.exists())
        self.assertIn(resource.title, self.visitor.get("/resources").text)

    def test_site_settings_photo_and_optional_information(self):
        self.assertEqual(self.member.get("/admin/site").status_code, 403)
        self.assertEqual(self.admin.post("/admin/site", data={"troupe_name": "test"}).status_code, 400)
        self.post(self.admin, "/admin/site", troupe_name="测试艺术团", founded_year="2010", qq_group="123456", public_account="剧场记忆", requirements="表达欲\n责任心", recruitment="周五 19:00\n排练厅", hero_photo=(io.BytesIO(PNG), "背景.PNG"))
        info = db.session.get(SiteProfile, 1)
        first = info.hero_photo
        self.assertTrue((Path(app.config["UPLOAD_FOLDER"]) / first).exists())
        self.assertIn("hero-backdrop", self.visitor.get("/").text)
        self.assertIn("周五 19:00", self.visitor.get("/contact").text)
        self.assertIn("这里是黑匣子", self.visitor.get("/").text)
        self.post(self.admin, "/admin/site", troupe_name="测试艺术团")
        self.assertEqual(info.hero_photo, first)
        self.assertEqual(self.post(self.admin, "/admin/site", troupe_name="不应保存", hero_photo=(io.BytesIO(b"bad"), "x.svg")).status_code, 400)
        self.assertEqual(info.troupe_name, "测试艺术团")
        self.post(self.admin, "/admin/site", troupe_name="测试艺术团", remove_photo="on")
        self.assertNotIn("hero-backdrop", self.visitor.get("/").text)

    def test_deleted_member_releases_pending_request_and_credits(self):
        db.session.add_all([JoinRequest(user_id=1, member_id=1, apply_type="bind"), ProductionCredit(production_id=1, member_id=1, kind="cast", role_name="角色")])
        db.session.commit()
        self.assertEqual(self.admin.post("/members/1/delete").status_code, 302)
        self.assertEqual(ProductionCredit.query.count(), 0)
        req = JoinRequest.query.one()
        self.assertEqual(req.status, "rejected")
        self.assertIsNone(req.member_id)
        self.assertIn("目标队员档案已删除", self.visitor.get("/profile").text)

    def test_help_and_page_copy_permissions_and_persistence(self):
        from page_content import PAGE_TEXTS
        from migrate import upgrade_page_texts as migrate_texts
        anonymous = app.test_client()
        for path in ('/help', '/help/admin', '/admin/page-texts'):
            self.assertEqual(anonymous.get(path).status_code, 302)
        for client in (self.visitor, self.member):
            self.assertEqual(client.get('/help').status_code, 200)
            self.assertEqual(client.get('/help/admin').status_code, 403)
            self.assertEqual(client.get('/admin/page-texts').status_code, 403)
            self.assertEqual(self.post(client, '/admin/page-texts').status_code, 403)
        self.assertEqual(self.admin.get('/help/admin').status_code, 200)
        self.assertEqual(self.admin.get('/admin/page-texts').status_code, 200)
        self.assertEqual(self.admin.post('/admin/page-texts', data={}).status_code, 400)
        for client in (self.member, self.admin):
            self.assertIn('黑匣子永远是你的家', client.get('/').text)
        self.assertIn('这里是黑匣子', self.visitor.get('/').text)
        values = {key: item[2] for key, item in PAGE_TEXTS.items()}
        values.update(contact_intro='<script>alert(1)</script>', member_guide='新的队员指南', admin_guide='内部管理员指南', production_intro='')
        self.assertEqual(self.post(self.admin, '/admin/page-texts', **values).status_code, 302)
        migrate_texts()
        migrate_texts()
        self.post(self.admin, '/admin/site', troupe_name='黑匣子', introduction='<script>alert(1)</script>', contact_email='team@example.test', contact_wechat='', recruitment_open='1')
        from help_content import help_items
        for audience, body in [('member', '新的队员指南'), ('admin', '内部管理员指南')]:
            payload = {}
            for i, item in enumerate(help_items(db.session.get(SiteProfile, 1), audience)):
                payload['title_' + str(i)] = item['title']
                payload['body_' + str(i)] = body if i == 0 else item['body']
            self.assertEqual(self.post(self.admin, '/admin/help/' + audience, **payload).status_code, 302)
        self.assertIn('&lt;script&gt;', anonymous.get('/contact').text)
        self.assertNotIn('<script>alert(1)</script>', anonymous.get('/contact').text)
        self.assertIn('新的队员指南', self.member.get('/help').text)
        self.assertNotIn('内部管理员指南', self.member.get('/help').text)
        self.assertIn('内部管理员指南', self.admin.get('/help/admin').text)
        self.assertNotIn(PAGE_TEXTS['production_intro'][2], self.member.get('/productions').text)
        values['home_member'] = ''
        self.assertEqual(self.post(self.admin, '/admin/page-texts', **values).status_code, 400)
        self.assertIn('黑匣子永远是你的家', self.admin.get('/').text)

    def test_inline_copy_links_target_fields_and_only_show_for_admin(self):
        from html.parser import HTMLParser
        class Inputs(HTMLParser):
            def __init__(self, html):
                super().__init__()
                self.focused = []
                self.feed(html)
            def handle_starttag(self, tag, attrs):
                attrs = dict(attrs)
                if 'autofocus' in attrs:
                    self.focused.append(attrs.get('id'))
        targets = {'/': ['home_member', 'home_intro'],
                   '/members': ['member_intro'], '/productions': ['production_intro'],
                   '/resources': ['reference_intro'], '/login': ['login_intro'],
                   '/register': ['register_intro']}
        for path, keys in targets.items():
            page = self.admin.get(path)
            self.assertEqual(page.status_code, 200, path)
            for key in keys:
                url = f'/admin/page-texts?field={key}#copy-{key}'
                self.assertIn(url, page.text, path)
                self.assertEqual(Inputs(self.admin.get(url).text).focused, ['copy-' + key])
            for client in (self.visitor, self.member, app.test_client()):
                self.assertNotIn('class="copy-edit-link"', client.get(path).text)
        self.assertIn('编辑（添加文案）', self.admin.get('/login').text)
        self.assertEqual(Inputs(self.admin.get('/admin/page-texts?field=unknown').text).focused, [])

    def test_public_home_feature_navigation_and_login_return(self):
        from migrate import upgrade_home_feature as migrate_home
        anonymous = app.test_client()
        self.assertEqual(self.post(self.member, '/productions/1/feature').status_code, 403)
        self.assertEqual(self.admin.post('/productions/1/feature').status_code, 400)
        self.assertEqual(self.post(self.admin, '/productions/1/feature').status_code, 302)
        migrate_home()
        migrate_home()
        db.session.get(Production, 1).synopsis = '仅登录可见的完整简介'
        db.session.get(User, 1).set_password('test-password')
        db.session.commit()
        page = anonymous.get('/').text
        self.assertIn('测试剧目', page)
        self.assertIn('/login?production=1', page)
        self.assertNotIn('仅登录可见的完整简介', page)
        self.assertIn('id="contact"', page)
        for client in (anonymous, self.member, self.admin):
            navigation = client.get('/').text.split('</nav>', 1)[0]
            self.assertNotIn('联系我们', navigation)
            self.assertNotIn('上传资源', navigation)
            self.assertNotIn('href="/announcements"', navigation)
        self.assertIn('href="/announcements"', self.member.get('/').text)
        self.assertIn('上传资料', self.member.get('/productions').text)
        anonymous.get('/login?production=1')
        response = self.post(anonymous, '/login?production=1', username='visitor', password='test-password')
        self.assertTrue(response.location.endswith('/productions/1'))
        db.session.add(Production(id=2, title='第二部'))
        db.session.commit()
        self.post(self.admin, '/productions/2/feature')
        self.assertEqual(db.session.get(SiteProfile, 1).featured_production_id, 2)
        self.post(self.admin, '/productions/2/delete')
        self.assertIsNone(db.session.get(SiteProfile, 1).featured_production_id)
        self.post(self.admin, '/productions/1/feature')
        self.post(self.admin, '/productions/1/feature', remove='1')
        self.assertNotIn('featured-show', app.test_client().get('/').text)

    def test_new_registration_identity_and_legacy_supplement(self):
        anonymous = app.test_client()
        anonymous.get('/register')
        data = dict(username='new-member', password='safe-password', confirm_password='safe-password', want_member='1', apply_type='new', name='新队员')
        self.assertEqual(self.post(anonymous, '/register', **data).status_code, 400)
        self.assertIsNone(User.query.filter_by(username='new-member').first())
        data['identity_note'] = '负责灯光的那次排练'
        self.assertEqual(self.post(anonymous, '/register', **data).status_code, 200)
        req = JoinRequest.query.filter_by(identity_note=data['identity_note']).one()
        self.assertEqual(req.status, 'pending')
        self.assertNotIn(data['identity_note'], self.visitor.get('/').text)
        old = JoinRequest(user_id=1, apply_type='new', name='旧申请')
        db.session.add(old)
        db.session.commit()
        self.admin.post(f'/admin/requests/{old.id}/approve')
        self.assertEqual(old.status, 'pending')
        self.assertEqual(self.post(self.member, f'/profile/requests/{old.id}/identity', identity_note='冒填').status_code, 403)
        self.assertEqual(self.post(self.visitor, f'/profile/requests/{old.id}/identity', identity_note='旧申请补填').status_code, 302)
        self.admin.post(f'/admin/requests/{old.id}/approve')
        self.assertEqual(old.status, 'approved')

    def test_cover_public_scope_and_both_layouts(self):
        pending = self.upload()
        approved = self.upload(self.admin)
        payload = dict(title='公开演出', year='2026', synopsis='内部简介', cover_id=str(pending.id), cover_ratio='portrait', feature_layout='overlay', promo='公开宣传')
        self.assertEqual(self.post(self.admin, '/productions/1/edit', **payload).status_code, 400)
        payload['cover_id'] = str(approved.id)
        self.assertEqual(self.post(self.admin, '/productions/1/edit', **payload).status_code, 302)
        self.post(self.admin, '/productions/1/feature')
        db.session.add(ProductionCredit(production_id=1, member_id=1, kind='cast', role_name='保密角色'))
        db.session.commit()
        anonymous = app.test_client()
        page = anonymous.get('/').text
        self.assertIn('feature-overlay', page)
        self.assertIn('公开宣传', page)
        self.assertNotIn('内部简介', page)
        self.assertNotIn('保密角色', page)
        self.assertIn('<details class="mt-3">', self.member.get('/').text)
        response = anonymous.get('/featured-cover')
        self.assertEqual(response.data, PNG)
        response.close()
        self.assertEqual(anonymous.get(f'/resources/{approved.id}/preview').status_code, 302)
        payload.update(feature_layout='split', cover_ratio='landscape')
        self.post(self.admin, '/productions/1/edit', **payload)
        self.assertIn('feature-split', anonymous.get('/').text)
        self.post(self.admin, '/productions/1/feature', remove='1')
        self.assertEqual(anonymous.get('/featured-cover').status_code, 404)

    def test_site_intro_is_independent_and_help_preserved(self):
        import json
        self.post(self.admin, '/admin/site', troupe_name='剧团名字', introduction='剧团介绍', contact_email='new@example.test', contact_wechat='微信号', requirements='要求甲', recruitment='安排乙', recruitment_open='1')
        page = self.admin.get('/').text
        self.assertLess(page.index('剧团介绍'), page.index('招新与联系我们'))
        self.assertIn('要求甲', page)
        self.assertIn('/admin/site#introduction', page)
        self.assertNotIn('copy-contact_intro', self.admin.get('/admin/page-texts').text)
        self.post(self.admin, '/admin/site', troupe_name='剧团名字', introduction='剧团介绍', contact_email='new@example.test', contact_wechat='', requirements='要求甲', recruitment='安排乙')
        self.assertNotIn('要求甲', self.visitor.get('/').text)
        self.assertIn('new@example.test', self.visitor.get('/').text)
        info = db.session.get(SiteProfile, 1)
        info.page_texts = json.dumps({'member_guide': '用户自己写的指南'})
        db.session.commit()
        self.assertIn('用户自己写的指南', self.member.get('/help').text)
        self.assertEqual(self.member.get('/admin/help/member').status_code, 403)
        self.assertEqual(self.admin.post('/admin/help/member').status_code, 400)
        self.assertEqual(self.post(self.admin, '/admin/help/member', title_0='自定标题', body_0='<script>test</script>').status_code, 302)
        self.assertIn('&lt;script&gt;', self.member.get('/help').text)

    def test_migration_repeat_preserves_existing_data(self):
        resource = self.upload(self.admin, production_id="")
        migrate()
        migrate()
        self.assertEqual(Resource.query.count(), 1)
        self.assertEqual(resource.status, "approved")
        self.assertIsNone(resource.production_id)


if __name__ == "__main__":
    unittest.main()
