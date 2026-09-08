"""统一数据库升级入口；保留旧记录，不插入演示数据。"""
from sqlalchemy import inspect, text
from app import app
from models import db, Flower, EmailToken, member_resource, Production, ProductionCredit, SiteProfile


def upgrade_join_results():
    with app.app_context():
        inspector = inspect(db.engine)
        if not inspector.has_table("join_request"):
            db.create_all()
        elif "result_acknowledged" not in {
            column["name"] for column in inspector.get_columns("join_request")
        }:
            with db.engine.begin() as connection:
                connection.execute(text(
                    "ALTER TABLE join_request ADD COLUMN result_acknowledged "
                    "BOOLEAN NOT NULL DEFAULT FALSE"
                ))
        print("申请结果确认字段已就绪。")


def upgrade_flowers():
    with app.app_context():
        Flower.__table__.create(db.engine, checkfirst=True)
        print("献花表已就绪。")


def upgrade_priority3():
    with app.app_context():
        if not inspect(db.engine).has_table("user"):
            db.create_all()
        else:
            columns = {c["name"] for c in inspect(db.engine).get_columns("user")}
            with db.engine.begin() as connection:
                for name, definition in (
                    ("email", "VARCHAR(254) NULL"),
                    ("pending_email", "VARCHAR(254) NULL"),
                    ("auth_version", "INTEGER NOT NULL DEFAULT 0"),
                    ("mail_sent_at", "DATETIME NULL"),
                ):
                    if name not in columns:
                        connection.execute(text(f"ALTER TABLE user ADD COLUMN {name} {definition}"))
            inspector = inspect(db.engine)
            unique_sets = [item["column_names"] for item in inspector.get_unique_constraints("user")]
            unique_sets += [item["column_names"] for item in inspector.get_indexes("user") if item.get("unique")]
            if ["email"] not in unique_sets:
                with db.engine.begin() as connection:
                    connection.execute(text("CREATE UNIQUE INDEX uq_user_email ON user (email)"))
            EmailToken.__table__.create(db.engine, checkfirst=True)
            member_resource.create(db.engine, checkfirst=True)
        print("优先级 3 数据结构已就绪。")


def upgrade_theater():
    with app.app_context():
        Production.__table__.create(db.engine, checkfirst=True)
        SiteProfile.__table__.create(db.engine, checkfirst=True)
        columns = {c["name"] for c in inspect(db.engine).get_columns("user")}
        if "join_hint_seen" not in columns:
            with db.engine.begin() as connection:
                connection.execute(text("ALTER TABLE user ADD COLUMN join_hint_seen BOOLEAN NOT NULL DEFAULT FALSE"))
        columns = {c["name"] for c in inspect(db.engine).get_columns("resource")}
        with db.engine.begin() as connection:
            for name, definition in (("status", "VARCHAR(20) NOT NULL DEFAULT 'approved'"), ("uploader_id", "INTEGER NULL REFERENCES user(id)"), ("admin_note", "TEXT NULL")):
                if name not in columns:
                    connection.execute(text(f"ALTER TABLE resource ADD COLUMN {name} {definition}"))
        if "production_id" not in columns:
            with db.engine.begin() as connection:
                connection.execute(text("ALTER TABLE resource ADD COLUMN production_id INTEGER NULL REFERENCES production(id)"))
        inspector = inspect(db.engine)
        if db.engine.dialect.name == "mysql" and not any(fk["constrained_columns"] == ["uploader_id"] for fk in inspector.get_foreign_keys("resource")):
            with db.engine.begin() as connection:
                connection.execute(text("ALTER TABLE resource ADD CONSTRAINT fk_resource_uploader FOREIGN KEY (uploader_id) REFERENCES user(id)"))
        if db.engine.dialect.name == "mysql" and not any(fk["constrained_columns"] == ["production_id"] for fk in inspector.get_foreign_keys("resource")):
            with db.engine.begin() as connection:
                connection.execute(text("ALTER TABLE resource ADD CONSTRAINT fk_resource_production FOREIGN KEY (production_id) REFERENCES production(id)"))
        if not any(index["column_names"] == ["production_id"] for index in inspect(db.engine).get_indexes("resource")):
            with db.engine.begin() as connection:
                connection.execute(text("CREATE INDEX ix_resource_production_id ON resource (production_id)"))
        ProductionCredit.__table__.create(db.engine, checkfirst=True)
        upgrade_page_texts()
        upgrade_home_feature()
        upgrade_new_plan()
        if not db.session.get(SiteProfile, 1):
            db.session.add(SiteProfile(id=1, troupe_name="话剧队"))
            db.session.commit()
        print("特色升级完成：旧资料保留为未归类。")


def upgrade_page_texts():
    with app.app_context():
        if "page_texts" not in {c["name"] for c in inspect(db.engine).get_columns("site_profile")}:
            with db.engine.begin() as connection:
                connection.execute(text("ALTER TABLE site_profile ADD COLUMN page_texts TEXT NULL"))
                connection.execute(text("UPDATE site_profile SET page_texts = '{}' WHERE page_texts IS NULL"))
        print("页面文案字段已就绪。")


def upgrade_home_feature():
    with app.app_context():
        columns = {c['name'] for c in db.inspect(db.engine).get_columns('site_profile')}
        if 'featured_production_id' not in columns:
            with db.engine.begin() as connection:
                connection.execute(db.text('ALTER TABLE site_profile ADD COLUMN featured_production_id INTEGER NULL'))


def upgrade_new_plan():
    import json
    from page_content import PAGE_TEXTS
    changes = {
        'join_request': [('identity_note', 'TEXT NULL')],
        'production': [('cover_id', 'INTEGER NULL'), ('cover_ratio', "VARCHAR(12) DEFAULT 'landscape'"), ('promo', "VARCHAR(300) DEFAULT ''"), ('feature_layout', "VARCHAR(12) DEFAULT 'split'")],
        'site_profile': [('introduction', 'TEXT NULL'), ('contact_email', 'VARCHAR(254) NULL'), ('contact_wechat', 'VARCHAR(100) NULL'), ('recruitment_open', 'BOOLEAN DEFAULT TRUE')],
    }
    with app.app_context():
        for table, additions in changes.items():
            if not inspect(db.engine).has_table(table):
                continue
            columns = {c['name'] for c in inspect(db.engine).get_columns(table)}
            with db.engine.begin() as connection:
                for name, definition in additions:
                    if name not in columns:
                        connection.execute(text(f'ALTER TABLE {table} ADD COLUMN {name} {definition}'))
        if inspect(db.engine).has_table('site_profile'):
            upgrade_page_texts()
            with db.engine.begin() as connection:
                for row in connection.execute(text('SELECT id, introduction, page_texts FROM site_profile')).mappings():
                    if row['introduction'] is None:
                        try:
                            saved = json.loads(row['page_texts'] or '{}')
                        except (ValueError, TypeError):
                            saved = {}
                        intro = saved.get('contact_intro', PAGE_TEXTS['contact_intro'][2]) if isinstance(saved, dict) else PAGE_TEXTS['contact_intro'][2]
                        connection.execute(text('UPDATE site_profile SET introduction=:intro WHERE id=:id'), {'intro': intro, 'id': row['id']})


def migrate():
    with app.app_context():
        db.create_all()
        upgrade_new_plan()
        upgrade_join_results()
        upgrade_flowers()
        upgrade_priority3()
        upgrade_theater()
        print("全部数据库升级完成；未添加演示数据。")


if __name__ == "__main__":
    migrate()
