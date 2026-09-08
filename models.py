# ============================================================
# models.py —— 定义数据库里的"表"长什么样
#
# 每个 class 代表一张表，class 里的属性（db.Column）代表表的每一列。
# 这叫 ORM（对象关系映射）：用 Python 代码描述表，SQLAlchemy
# 会自动翻译成 SQL 去 MySQL 里建表、读写数据。
# 以后查询数据也是操作这些 Python 对象，不用手写 SQL。
# ============================================================

from datetime import datetime    # Python 自带的时间类型，用于记录"创建时间"

from flask_sqlalchemy import SQLAlchemy   # Flask 操作数据库的扩展
from werkzeug.security import check_password_hash, generate_password_hash  # 密码加密/校验

# 一个"数据库操作对象"（相当于总遥控器）。
# 它先在 models.py 单独创建，最后在 app.py 用 db.init_app(app) 绑定到网站。
db = SQLAlchemy()

member_resource = db.Table(
    "member_resource",
    db.Column("member_id", db.Integer, db.ForeignKey("member.id"), primary_key=True),
    db.Column("resource_id", db.Integer, db.ForeignKey("resource.id"), primary_key=True),
)


class Flower(db.Model):
    """每次献花留一条记录，数据库保证同一账号每天只能送一次。"""
    __tablename__ = "flower"
    __table_args__ = (
        db.UniqueConstraint("user_id", "member_id", "sent_on", name="uq_flower_user_member_day"),
        db.Index("ix_flower_member", "member_id"),
    )

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    member_id = db.Column(db.Integer, db.ForeignKey("member.id"), nullable=False)
    sent_on = db.Column(db.Date, nullable=False)  # 北京时间的自然日


# ============================================================
# Member 表 —— 队员（名人堂核心数据）
# ============================================================

class Member(db.Model):
    __tablename__ = "member"        # 表名（在 MySQL 里叫 member）

    # ---- 每一列 ----
    id = db.Column(db.Integer, primary_key=True)          # 主键：每行数据的唯一编号
    name = db.Column(db.String(50), nullable=False)       # 姓名（最长50字，必填）
    bio = db.Column(db.Text, default="")                  # 简介（长文本，默认空）
    join_year = db.Column(db.Integer)                     # 入队年份
    cohort = db.Column(db.String(20), default="")         # 届别（如"2015 届"）
    works = db.Column(db.Text, default="")                # 代表作（演过/导演过的作品）
    photo = db.Column(db.String(255), default="")         # 头像文件名（存名字，不存图片本体）
    resources = db.relationship("Resource", secondary=member_resource, backref="members", order_by="Resource.id")

    def __repr__(self):
        # 调试时打印对象，显示成 <Member 张三 (2005)> 这样，方便看
        return f"<Member {self.name} ({self.join_year})>"


# ============================================================
# User 表 —— 网站账号（登录/权限用）
# ============================================================

class User(db.Model):
    __tablename__ = "user"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False)  # 用户名（唯一，不可重复）
    password_hash = db.Column(db.String(255), nullable=False)  # 密码的"密文"（绝不存明文！）
    email = db.Column(db.String(254), nullable=True, unique=True)  # 验证成功的邮箱
    pending_email = db.Column(db.String(254), nullable=True)  # 待验证，不可用于找回密码
    auth_version = db.Column(db.Integer, nullable=False, default=0, server_default="0")
    mail_sent_at = db.Column(db.DateTime, nullable=True)
    join_hint_seen = db.Column(db.Boolean, nullable=False, default=False, server_default=db.false())
    # 角色（三种身份，一眼看清）：
    #   "user"  普通用户（可浏览/下载/申请新增）
    #   "member" 已认证队员（在普通用户基础上还能申请修改队员、上传资源）
    #   "admin" 管理员（全权限）
    role = db.Column(db.String(20), default="user")
    status = db.Column(db.String(20), default="active")       # 状态："active"正常 / "disabled"禁用
    # 绑定的名人堂队员档案。unique=True 保证"一个队员只能被一个用户绑定"（一对一）
    member_id = db.Column(db.Integer, db.ForeignKey("member.id"), nullable=True, unique=True)
    member = db.relationship("Member")                        # 通过 user.member 拿到绑定的队员对象

    def set_password(self, password):
        """把用户输入的明文密码加密，存入 password_hash。
        加密后是乱码，即使数据库泄露也还原不出原密码。"""
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        """登录时校验：把输入的密码和库里存的密文比对，对就返回 True"""
        return check_password_hash(self.password_hash, password)

    @property
    def is_admin(self):
        """属性（像字段一样用）：是不是管理员？user.is_admin 直接返回 True/False"""
        return self.role == "admin"

    @property
    def is_member(self):
        """属性：是不是已认证队员？用 role == "member" 判断，和 is_admin 对齐"""
        return self.role == "member"

    @property
    def is_active(self):
        """账号是否正常（未被禁用）"""
        return self.status == "active"

    def __repr__(self):
        return f"<User {self.username} ({self.role})>"


# ============================================================
# JoinRequest 表 —— 入队申请（访客申请成为队员，管理员审核）
# 两种申请方式：
#   apply_type = "bind"  从"未绑定的队员"里选一个绑定（member_id 填目标队员）
#   apply_type = "new"   名单里没有自己，申请新建档案（name/bio/join_year/cohort 填资料）
# 管理员通过后：bind -> 把该用户绑定到目标队员；new -> 先创建队员档案再绑定。
# ============================================================

class EmailToken(db.Model):
    """只保存随机令牌的摘要，验证与重置均限时且只能使用一次。"""
    __tablename__ = "email_token"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    digest = db.Column(db.String(64), nullable=False, unique=True)
    purpose = db.Column(db.String(10), nullable=False)
    email = db.Column(db.String(254), nullable=False)
    auth_version = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    consumed = db.Column(db.Boolean, nullable=False, default=False, server_default=db.false())


class JoinRequest(db.Model):
    __tablename__ = "join_request"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)  # 谁申请的
    apply_type = db.Column(db.String(10), nullable=False)   # "bind" 选现有 / "new" 新建档案
    identity_note = db.Column(db.Text, default="")
    member_id = db.Column(db.Integer, db.ForeignKey("member.id"), nullable=True)  # bind 时填：要绑定的队员 id
    name = db.Column(db.String(50), default="")             # new 时填：姓名
    bio = db.Column(db.Text, default="")                    # new 时填：简介
    join_year = db.Column(db.Integer, nullable=True)        # new 时填：入队年份
    cohort = db.Column(db.String(20), default="")           # new 时填：届别
    status = db.Column(db.String(20), default="pending")    # pending待审 / approved通过 / rejected驳回
    admin_note = db.Column(db.Text, default="")             # 管理员驳回理由
    result_acknowledged = db.Column(db.Boolean, nullable=False, default=False, server_default=db.false())
    created_at = db.Column(db.DateTime, default=datetime.utcnow)  # 提交时间

    user = db.relationship("User", backref="join_requests")
    member = db.relationship("Member")   # bind 申请时，指向要绑定的队员（new 申请时为空）

    def __repr__(self):
        return f"<JoinRequest {self.apply_type} {self.name or self.member_id} ({self.status})>"


# ============================================================
# Announcement 表 —— 首页公告
# ============================================================

class Announcement(db.Model):
    __tablename__ = "announcement"

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(100), nullable=False)   # 公告标题
    content = db.Column(db.Text, default="")            # 公告内容
    created_at = db.Column(db.DateTime, default=datetime.utcnow)  # 发布时间

    def __repr__(self):
        return f"<Announcement {self.title}>"


# ============================================================
# Resource 表 —— 资源库（作品下载）
# ============================================================

class Resource(db.Model):
    __tablename__ = "resource"

    id = db.Column(db.Integer, primary_key=True)
    production_id = db.Column(db.Integer, db.ForeignKey("production.id"), nullable=True, index=True)
    status = db.Column(db.String(20), nullable=False, default="approved", server_default="approved")
    uploader_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    admin_note = db.Column(db.Text, default="")
    uploader = db.relationship("User", backref="uploaded_resources")
    title = db.Column(db.String(100), nullable=False)   # 资源标题
    res_type = db.Column(db.String(20), default="other")  # 类型：video视频/script剧本/photo剧照/audio音频/other
    description = db.Column(db.Text, default="")        # 资源说明
    filename = db.Column(db.String(255), nullable=False)      # 磁盘上的实际文件名（随机名，防冲突）
    original_name = db.Column(db.String(255), default="")     # 用户上传时的原名（下载时显示用）
    download_count = db.Column(db.Integer, default=0)         # 下载次数（每次下载 +1）
    created_at = db.Column(db.DateTime, default=datetime.utcnow)  # 上传时间

    def __repr__(self):
        return f"<Resource {self.title}>"


class Production(db.Model):
    """一部作品；其下可归档剧本、台本、剧照、视频等多个文件。"""
    __tablename__ = "production"
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(100), nullable=False)
    synopsis = db.Column(db.Text, default="")
    cover_id = db.Column(db.Integer, nullable=True)
    cover_ratio = db.Column(db.String(12), default="landscape")
    promo = db.Column(db.String(300), default="")
    feature_layout = db.Column(db.String(12), default="split")
    year = db.Column(db.Integer, nullable=True)
    resources = db.relationship("Resource", backref="production", order_by="Resource.id")
    credits = db.relationship("ProductionCredit", backref="production", cascade="all, delete-orphan", order_by="ProductionCredit.id")


class ProductionCredit(db.Model):
    __tablename__ = "production_credit"
    id = db.Column(db.Integer, primary_key=True)
    production_id = db.Column(db.Integer, db.ForeignKey("production.id"), nullable=False, index=True)
    member_id = db.Column(db.Integer, db.ForeignKey("member.id"), nullable=False, index=True)
    kind = db.Column(db.String(10), nullable=False)  # cast / crew
    role_name = db.Column(db.String(80), nullable=False)  # 角色名 / 技术分工
    member = db.relationship("Member", backref=db.backref("production_credits", cascade="all, delete-orphan"))


class SiteProfile(db.Model):
    """管理员维护的公开剧团信息；未填写的信息不对外编造。"""
    __tablename__ = "site_profile"
    id = db.Column(db.Integer, primary_key=True)
    troupe_name = db.Column(db.String(100), default="话剧队")
    introduction = db.Column(db.Text, nullable=True)
    contact_email = db.Column(db.String(254), nullable=True)
    contact_wechat = db.Column(db.String(100), nullable=True)
    recruitment_open = db.Column(db.Boolean, default=True)
    founded_year = db.Column(db.Integer, nullable=True)
    qq_group = db.Column(db.String(50), default="")
    public_account = db.Column(db.String(100), default="")
    recruitment = db.Column(db.Text, default="")
    requirements = db.Column(db.Text, default="")
    hero_photo = db.Column(db.String(255), default="")
    featured_production_id = db.Column(db.Integer, nullable=True)
    page_texts = db.Column(db.Text, nullable=False, default="{}")
