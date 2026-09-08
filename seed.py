# ============================================================
# seed.py —— "种子数据"脚本
#
# 作用：一键完成两件事
#   1. 自动建表（如果数据库里还没有那些表）
#   2. 灌入一批演示用的队员数据，方便测试和展示
# 运行方式：python seed.py
# 注意：可以反复运行，不会重复插入同名队员（会先检查名字是否已存在）。
# ============================================================

from app import app                       # 引入 Flask 应用（拿到它的数据库配置）
from models import Member, db             # 引入 Member 表模型 和 数据库对象

# 要灌入的演示队员名单：每个是 (姓名, 入队年份, 简介) 一个元组
DEMO_MEMBERS = [
    ("张三", 2005, "2005 级老队员，话剧《雷雨》主演"),
    ("李四", 2015, "2015 级队员，擅长舞台灯光"),
    ("王五", 2022, "2022 级新队员，编剧方向"),
    ("赵六", 2010, "2010 级队员，舞台美术"),
    ("钱七", 2018, "2018 级队员，音效设计"),
    ("孙八", 2021, "2021 级队员，场记与统筹"),
    ("周九", 2012, "2012 级队长，指导多部大戏"),
    ("吴十", 2023, "2023 级新队员，表演方向"),
    ("郑十一", 2016, "2016 级队员，服化道负责人"),
    ("王十二", 2019, "2019 级队员，编剧与导演"),
]


def seed_members():
    """灌入演示队员：已存在的名字跳过，只插入名单里没有的队员"""
    # 先把库里所有队员的名字收集成一个集合 {"张三","李四",...}，用于判断是否存在
    existing = {m.name for m in Member.query.all()}
    for name, year, bio in DEMO_MEMBERS:
        if name not in existing:                  # 名字还没在库里才插入
            db.session.add(Member(name=name, bio=bio, join_year=year))
    db.session.commit()                           # 一次性提交所有新增


# app.app_context() 会临时进入 Flask 应用的"运行环境"。
# 数据库操作必须在这个环境内进行，否则会报"outside of application context"。
with app.app_context():
    # 1) 建表：按 models.py 里定义的所有表模型，在 MySQL 里自动创建缺失的表
    db.create_all()
    print("建表完成")

    # 2) 灌入演示数据
    seed_members()
    print("演示数据就绪")

    # 3) 打印当前所有队员，确认结果（按入队年份从早到晚排序）
    print("--- 当前所有队员 ---")
    for m in Member.query.order_by(Member.join_year).all():
        print(f"id={m.id} | 姓名={m.name} | 入队={m.join_year} | {m.bio}")
