"""工程整理与生产入口回归；仅用内存库。"""
import unittest
from config import Config
Config.SQLALCHEMY_DATABASE_URI = 'sqlite:///:memory:'
from app import app
from models import db, SiteProfile, User
from migrate import migrate
from serve import validate_production


class DeploymentTests(unittest.TestCase):
    def test_production_rejects_development_settings(self):
        for key, url in [('dev-secret-key', 'https://example.test'), ('x' * 32, 'http://example.test')]:
            with self.assertRaises(RuntimeError):
                validate_production({'SECRET_KEY': key, 'PUBLIC_BASE_URL': url})
        validate_production({'SECRET_KEY': 'x' * 32, 'PUBLIC_BASE_URL': 'https://example.test'})

    def test_unified_migration_fresh_and_legacy_site_profile(self):
        with app.app_context():
            db.drop_all()
            try:
                migrate()
                self.assertEqual(User.query.count(), 0)
                db.session.remove()
                SiteProfile.__table__.drop(db.engine)
                with db.engine.begin() as connection:
                    connection.execute(db.text("CREATE TABLE site_profile (id INTEGER PRIMARY KEY, troupe_name VARCHAR(100), founded_year INTEGER, qq_group VARCHAR(50), public_account VARCHAR(100), recruitment TEXT, requirements TEXT, hero_photo VARCHAR(255))"))
                    connection.execute(db.text("INSERT INTO site_profile (id, troupe_name, hero_photo) VALUES (1, '保留名称', 'existing.png')"))
                migrate()
                migrate()
                profile = db.session.get(SiteProfile, 1)
                self.assertEqual(profile.troupe_name, '保留名称')
                self.assertEqual(profile.hero_photo, 'existing.png')
                self.assertIsNone(profile.featured_production_id)
            finally:
                db.session.remove()
                db.drop_all()
