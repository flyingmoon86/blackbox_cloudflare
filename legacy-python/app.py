# ============================================================
# app.py —— 网站的"入口"和"总指挥"
# 所有"网址"（路由）都在这里定义：浏览器访问什么网址，
# 就执行下面哪个函数，函数负责读取数据库并返回网页。
# ============================================================

import os          # 操作系统功能：拼文件路径、判断文件是否存在等
import uuid        # 生成唯一字符串（uuid4），用于给上传文件起不重名的名字
import secrets
import posixpath
from datetime import datetime, timedelta, timezone
from sqlalchemy.exc import IntegrityError
from functools import wraps   # 写装饰器用的工具，能保留原函数的信息

from flask import (            # Flask 的核心功能
    Flask,                     #   创建网站应用的对象
    flash,
    abort,                     #   主动返回错误（比如 404/413）
    redirect,                  #   让浏览器跳转到另一个网址
    render_template,           #   渲染网页模板（HTML）
    request,                   #   接收用户请求里的数据（表单/网址参数）
    send_from_directory,       #   从服务器文件夹安全地发送文件给浏览器
    session,                   #   会话：记住"当前浏览器登录的用户是谁"
    url_for,                   #   根据函数名反推出网址（改路由时更安全）
)
from werkzeug.utils import secure_filename  # 把不可信的文件名清洗成安全文件名

from uploads import allowed_file, save_photo
from join_application import application_values
from config import Config                      # 我们自己的配置（数据库地址等）
from account import account, check_csrf, issue_email, normalize_email
from theater import theater, RESOURCE_TYPES
from models import (                           # 数据库里的表和 db 对象
    Announcement,
    Flower,
    EmailToken,
    Production,
    SiteProfile,
    ProductionCredit,
    JoinRequest,
    Member,
    Resource,
    User,
    db,
)


# ---------- 创建应用 ----------

# 创建一个 Flask 网站对象
app = Flask(__name__)
# 从 config.py 的 Config 类读取所有配置（数据库地址、上传目录、密钥等）
app.config.from_object(Config)
# 把数据库对象 db 正式绑定到这个网站应用上（之后才能用 db 操作数据库）
db.init_app(app)
app.register_blueprint(account)
app.register_blueprint(theater)


@app.before_request
def refresh_identity():
    """每次请求同步身份，让审核结果立即反映在导航和权限中。"""
    if "user_id" in session:
        user = db.session.get(User, session["user_id"])
        if not user or not user.is_active or session.get("auth_version", 0) != user.auth_version:
            session.clear()
        else:
            session.update(username=user.username, role=user.role, is_member=user.is_member)
    # 文件必须经过业务接口核对登录和审核状态，静态路径完全关闭。
    if request.endpoint == "static" and posixpath.normpath(request.view_args.get("filename", "").replace("\\", "/")).startswith(("resources/", "pending/")):
        abort(404)


@app.context_processor
def inject_pending_count():
    """给所有模板注入"待审核入队申请数"，供管理员导航红点显示。"""
    unread_results = []
    if session.get("user_id"):
        unread_results = JoinRequest.query.filter(
            JoinRequest.user_id == session["user_id"],
            JoinRequest.status.in_(["approved", "rejected"]),
            JoinRequest.result_acknowledged.is_(False),
        ).order_by(JoinRequest.id.desc()).all()
    user = db.session.get(User, session["user_id"]) if session.get("user_id") else None
    join_hint = bool(user and user.role == "user" and not user.join_hint_seen
                     and not JoinRequest.query.filter_by(user_id=user.id).first())
    return {"pending_join": pending_join_count(), "unread_results": unread_results, "join_hint": join_hint}


@app.context_processor
def inject_resource_choices():
    if request.endpoint in {"profile", "profile_edit_member", "profile_change_password", "member_new", "member_edit"}:
        return {"resource_choices": Resource.query.filter_by(status="approved").order_by(Resource.title, Resource.id).all()}
    if request.endpoint == "resource_upload":
        return {"productions": Production.query.order_by(Production.title).all()}
    return {}


def selected_resources():
    values = request.form.getlist("resource_ids")
    if len(values) > 200 or any(not v.isascii() or not v.isdigit() for v in values):
        abort(400)
    ids = {int(v) for v in values}
    resources = Resource.query.filter(Resource.id.in_(ids), Resource.status == "approved").all()
    if len(resources) != len(ids):
        abort(400)
    return resources


# ============================================================
# 工具函数（给路由用的"小帮手"）
# ============================================================

def flower_day():
    """统一按北京时间换日，不依赖部署服务器的本地时区。"""
    return datetime.now(timezone(timedelta(hours=8))).date()


def flower_context(member_ids):
    """只聚合当前页的献花记录，避免每张卡片各查一次数据库。"""
    session.setdefault("flower_token", secrets.token_hex(32))
    counts = dict(db.session.query(Flower.member_id, db.func.count(Flower.id))
                  .filter(Flower.member_id.in_(member_ids)).group_by(Flower.member_id).all())
    sent = {row[0] for row in db.session.query(Flower.member_id).filter(
        Flower.member_id.in_(member_ids), Flower.user_id == session["user_id"],
        Flower.sent_on == flower_day()).all()}
    return {"flower_counts": counts, "flowers_sent": sent}


def allowed_resource_file(filename):
    """判断上传的文件扩展名是否属于"资源库允许的类型"（视频/文档/音频等）。
    用扩展名白名单判断，防止传 exe 等危险文件。"""
    return (
        "." in filename
        and filename.rsplit(".", 1)[1].lower() in app.config["RESOURCE_ALLOWED_EXTENSIONS"]
    )


def login_required(f):
    """装饰器（"门卫"）：要求"必须已登录"才能访问某个功能。
    用法：在路由函数上方加一行 @login_required"""
    @wraps(f)
    def wrapper(*args, **kwargs):
        if "user_id" not in session:   # session 里没有 user_id = 没登录
            return redirect(url_for("login"))   # 弹去登录页
        return f(*args, **kwargs)      # 已登录，正常执行原函数
    return wrapper


def admin_required(f):
    """装饰器：比 login_required 更严格，要求"必须是管理员"才能访问。"""
    @wraps(f)
    def wrapper(*args, **kwargs):
        if "user_id" not in session:                # 没登录
            return redirect(url_for("login"))
        user = db.session.get(User, session["user_id"])  # 从数据库查出当前用户
        if not user or not user.is_admin:           # 不是管理员
            return redirect(url_for("member_list")) # 弹回队员列表（无权访问）
        return f(*args, **kwargs)
    return wrapper


def member_required(f):
    """装饰器：比 login_required 多一步，要求是"已批准的队员"（或管理员）。
    用于：申请修改队员、申请上传资源（按业务规则仅队员可用）。"""
    @wraps(f)
    def wrapper(*args, **kwargs):
        if "user_id" not in session:                # 没登录
            return redirect(url_for("login"))
        user = db.session.get(User, session["user_id"])  # 从数据库查出当前用户
        # 不是队员也不是管理员 -> 无权
        if not user or not (user.is_member or user.is_admin):
            return redirect(url_for("member_list"))
        return f(*args, **kwargs)
    return wrapper


def unbound_members():
    """列出"尚未被任何用户绑定"的队员，供注册/个人中心申请时选择。
    排除两类：已被某用户绑定的、已有待审核 bind 申请占用的。"""
    bound_ids = {
        u.member_id for u in User.query.filter(User.member_id.isnot(None)).all()
    }
    pending_ids = {
        r.member_id
        for r in JoinRequest.query.filter(
            JoinRequest.apply_type == "bind",
            JoinRequest.status == "pending",
            JoinRequest.member_id.isnot(None),
        ).all()
    }
    taken = bound_ids | pending_ids
    query = Member.query.order_by(Member.join_year)
    if taken:
        query = query.filter(~Member.id.in_(taken))
    return query.all()


def member_is_taken(member_id):
    """判断某队员是否已被"占用"（已绑定，或已有待审核 bind 申请）。
    用于申请时防重复绑定；一对一约束的兜底。"""
    if User.query.filter(User.member_id == member_id).first():
        return True
    if JoinRequest.query.filter(
        JoinRequest.apply_type == "bind",
        JoinRequest.status == "pending",
        JoinRequest.member_id == member_id,
    ).first():
        return True
    return False


def bound_user_of(member_id):
    """返回绑定了某个队员的用户（已获准的队员用户），没有则返回 None。"""
    return User.query.filter_by(member_id=member_id, role="member").first()


def pending_join_count():
    """待审核的入队申请数量（供管理员导航红点显示）"""
    return JoinRequest.query.filter_by(status="pending").count()


# ============================================================
# 首页（公开，谁都能看）
# ============================================================

@app.route("/")          # 访问网址 "/"（就是根网址）时执行下面这个函数
def hello():
    # 查出最新 5 条公告，按发布时间倒序（created_at.desc() 新的在前），limit(5) 只要 5 条
    announcements = Announcement.query.order_by(Announcement.created_at.desc()).limit(5).all() if session.get("user_id") else []
    # 渲染 home.html 首页，把公告数据传进模板里显示
    info = db.session.get(SiteProfile, 1)
    featured = db.session.get(Production, info.featured_production_id) if info and info.featured_production_id else None
    return render_template("home.html", announcements=announcements, featured=featured)


@app.route("/about")
def about():
    return redirect(url_for("contact"))


@app.route("/contact")
def contact():
    return render_template("contact.html")


@app.route("/announcements")
@login_required
def announcement_list():
    pagination = Announcement.query.order_by(Announcement.created_at.desc(), Announcement.id.desc()).paginate(
        page=max(1, request.args.get("page", 1, type=int) or 1), per_page=10, error_out=False)
    return render_template("announcements.html", pagination=pagination)


@app.route("/announcements/<int:ann_id>")
@login_required
def announcement_detail(ann_id):
    return render_template("announcement_detail.html", announcement=db.get_or_404(Announcement, ann_id))


# ============================================================
# 认证：注册 / 登录 / 登出（公开）
# ============================================================

@app.route("/register", methods=["GET", "POST"])
# GET = 打开注册页面；POST = 提交注册表单。一个网址两种用法靠 methods 区分
def register():
    # 拿"尚未被绑定"的队员名单，供注册时"我是队员"下拉选择要绑定哪位名人堂队员
    members = unbound_members()
    if request.method == "POST":          # 用户按了"注册"按钮提交表单
        check_csrf()
        username = request.form.get("username", "").strip()  # 拿表单里的用户名，去首尾空格
        password = request.form.get("password", "")          # 拿密码
        email_text = request.form.get("email", "").strip()
        email = normalize_email(email_text) if email_text else None
        if len(username) > 50 or not 8 <= len(password) <= 128 or password != request.form.get("confirm_password", ""):
            return render_template("register.html", members=members, error="用户名最多 50 字；密码需为 8–128 位，且两次输入一致。"), 400
        if email_text and not email:
            return render_template("register.html", members=members, error="请填写有效的邮箱地址。"), 400
        if not username or not password:  # 有空内容就提示错误
            return render_template("register.html", members=members, error="用户名和密码都不能为空")
        if User.query.filter_by(username=username).first():   # 查数据库：名字被占用了？
            return render_template("register.html", members=members, error="该用户名已被占用")
        join_values = None
        if request.form.get('want_member'):
            try:
                join_values = application_values(request.form)
            except ValueError as error:
                return render_template('register.html', members=members, error=str(error)), 400
        user = User(username=username, pending_email=email)    # 邮箱验证前只作待验证记录
        user.set_password(password)       # 加密密码后存入（绝不存明文）
        db.session.add(user)              # 先加入，好拿到 user.id
        db.session.flush()                # 立即写库拿 id（不 commit，和申请一起提交）
        if join_values:
            db.session.add(JoinRequest(user_id=user.id, **join_values))
        db.session.commit()               # 提交：用户 + 申请一起写库
        if email:
            result = issue_email(user, email, "verify")
            flash("注册成功，验证邮件已发送，请查看邮箱。" if result == "sent" else "注册成功，邮箱已保存为待验证；邮件暂未发出，请登录个人中心查看提示并重新发送。", "success" if result == "sent" else "warning")
        else:
            flash("注册成功！建议在个人中心绑定邮箱，方便以后找回密码。", "success")
        if user.join_requests:            # 提交了入队申请 -> 提示待审核
            return render_template("register_done.html", waiting_member=True)
        return redirect(url_for("login")) # 普通注册成功，跳去登录页
    return render_template("register.html", members=members)   # GET：直接显示注册表单


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":          # 提交了登录表单
        check_csrf()
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        user = User.query.filter_by(username=username).first()  # 按用户名查用户
        if user and user.check_password(password):  # 用户存在 且 密码比对正确
            if not user.is_active:        # 账号被管理员禁用了
                return render_template("login.html", error="该账号已被禁用，请联系管理员")
            session.clear()
            session["auth_version"] = user.auth_version
            session["user_id"] = user.id        # 记住"登录的是谁"（id）
            session["username"] = user.username # 记住用户名（显示用）
            session["role"] = user.role         # 记住角色（普通用户/管理员）
            session["is_member"] = user.is_member  # 记住是否队员（模板用来显示申请入口）
            production_id = request.args.get('production', type=int)
            if production_id and db.session.get(Production, production_id):
                return redirect(url_for('theater.production_detail', production_id=production_id))
            return redirect(url_for("member_list"))
        return render_template("login.html", error="用户名或密码错误")
    return render_template("login.html")  # GET：显示登录表单


@app.route("/logout")
def logout():
    session.clear()              # 清空会话 = 登出
    return redirect(url_for("member_list"))


# ============================================================
# 个人资料页 + 修改密码（登录）
# ============================================================

@app.route("/profile")
@login_required
def profile():
    """显示当前登录用户的个人资料：
    用户名、角色、队员身份/申请状态、绑定的名人堂档案。
    非队员的普通用户可在此申请成为队员（选队员 or 新建档案）。"""
    user = db.session.get(User, session["user_id"])
    if not user.join_hint_seen:
        user.join_hint_seen = True
        db.session.commit()
    members = unbound_members()  # 供"申请成为队员"下拉选择
    # 当前用户是否有待审核的入队申请
    my_request = JoinRequest.query.filter_by(
        user_id=user.id, status="pending"
    ).first()
    return render_template("profile.html", user=user, members=members, my_request=my_request,
                           retry_request=latest_rejected_request(user.id))


def latest_rejected_request(user_id):
    """只将最近一次驳回的资料用作重填草稿，不展示历史记录。"""
    latest = JoinRequest.query.filter_by(user_id=user_id).order_by(JoinRequest.id.desc()).first()
    return latest if latest and latest.status == "rejected" else None


@app.route("/profile/requests/<int:req_id>/acknowledge", methods=["POST"])
@login_required
def acknowledge_result(req_id):
    req = db.get_or_404(JoinRequest, req_id)
    if req.user_id != session["user_id"]:
        abort(403)
    if req.status in ("approved", "rejected"):
        req.result_acknowledged = True
        db.session.commit()
    return redirect(url_for("profile"))


@app.route("/profile/apply_member", methods=["POST"])
@login_required
def profile_apply_member():
    """个人中心里提交"我是队员"申请。
    两种方式（apply_type）：
      bind = 从"未绑定队员"里选一个绑定
      new  = 名单里没有自己，申请新建档案
    """
    user = db.session.get(User, session["user_id"])
    # 已是队员或管理员，或有待审核申请，都不再受理
    if user.is_admin or user.is_member:
        return redirect(url_for("profile"))
    existing = JoinRequest.query.filter_by(user_id=user.id, status="pending").first()
    if existing:
        return redirect(url_for("profile"))

    try:
        values = application_values(request.form)
    except ValueError as error:
        flash(str(error), 'warning')
        return redirect(url_for('profile'))
    db.session.add(JoinRequest(user_id=user.id, **values))
    db.session.commit()
    return redirect(url_for("profile"))


@app.route('/profile/requests/<int:req_id>/identity', methods=['POST'])
@login_required
def supplement_identity(req_id):
    check_csrf()
    req = db.get_or_404(JoinRequest, req_id)
    if req.user_id != session['user_id']:
        abort(403)
    note = request.form.get('identity_note', '').strip()
    if req.status != 'pending' or not 1 <= len(note) <= 1000:
        abort(400)
    req.identity_note = note
    db.session.commit()
    flash('核对信息已保存，等待管理员审核。', 'success')
    return redirect(url_for('profile'))


@app.route("/profile/password", methods=["POST"])
@login_required
def profile_change_password():
    """修改密码：要求先验证旧密码正确，再把新密码加密保存。"""
    user = db.session.get(User, session["user_id"])
    old_password = request.form.get("old_password", "")
    new_password = request.form.get("new_password", "")
    members = unbound_members()
    retry_request = latest_rejected_request(user.id)
    my_request = JoinRequest.query.filter_by(user_id=user.id, status="pending").first()
    if not user.check_password(old_password):   # 旧密码不对
        return render_template("profile.html", user=user, members=members, my_request=my_request, retry_request=retry_request, pw_error="原密码不正确")
    if not new_password:                        # 新密码为空
        return render_template("profile.html", user=user, members=members, my_request=my_request, retry_request=retry_request, pw_error="新密码不能为空")
    user.set_password(new_password)             # 重新加密保存
    user.auth_version += 1
    db.session.commit()
    session["auth_version"] = user.auth_version
    return render_template("profile.html", user=user, members=members, my_request=my_request, retry_request=retry_request, pw_ok="密码修改成功")


@app.route("/profile/edit_member", methods=["POST"])
@member_required
def profile_edit_member():
    """队员直接修改"自己的"档案（仅能改自己绑定的那个队员，不能改别人）"""
    user = db.session.get(User, session["user_id"])
    member = user.member            # 自己绑定的档案
    if not member:                  # 没绑定档案 -> 无权限改
        return redirect(url_for("profile"))
    photo_file = request.files.get("photo")
    if photo_file and photo_file.filename and not allowed_file(photo_file.filename):
        flash("头像格式不支持，请选择 png / jpg / jpeg / gif / webp 图片。资料尚未保存。", "warning")
        return redirect(url_for("profile"))
    member.bio = request.form.get("bio", "").strip()
    if "resources_present" in request.form:
        member.resources = selected_resources()
    member.cohort = request.form.get("cohort", "").strip()
    member.works = request.form.get("works", "").strip()
    photo = save_photo(photo_file)   # 可选：换头像；没选新图片时保留原头像
    if photo:
        member.photo = photo
    db.session.commit()
    flash("资料已保存。", "success")
    return redirect(url_for("profile"))


# ============================================================
# 队员列表（需登录，含搜索/筛选/分页）
# ============================================================

@app.route("/members")
@login_required                 # 未登录不能看成员列表
def member_list():
    # request.args 读网址里的"查询参数"，如 /members?page=2&keyword=张&year=2015
    page = request.args.get("page", 1, type=int)      # 当前第几页，默认第 1 页
    keyword = request.args.get("keyword", "").strip() # 搜索关键字，默认空
    year = request.args.get("year", "").strip()       # 筛选年份，默认空

    query = Member.query                 # 先拿到"查全体队员"的查询对象
    if keyword:                          # 有搜索关键字就加过滤条件
        query = query.filter(            #   like = SQL 模糊匹配，% 通配任意字符
            Member.name.like(f"%{keyword}%")   # 姓名包含关键字
            | Member.bio.like(f"%{keyword}%")  # | 表示"或"，简介包含关键字也行
        )
    if year:
        if not year.isascii() or not year.isdigit() or not 1 <= int(year) <= 9999:
            abort(400)
        query = query.filter(Member.join_year == int(year))

    # 分页：每页显示 10 条。paginate 返回对象含：当前页数据 items、总页数等
    pagination = query.order_by(Member.join_year, Member.id).paginate(
        page=page, per_page=10, error_out=False   # error_out=False：页码越界也不报错
    )

    # 收集所有出现过的入队年份（去重、升序），供筛选下拉框用
    years = [
        y[0]
        for y in db.session.query(Member.join_year)  # 只查 join_year 这一列
        .distinct()                                  # 去重
        .order_by(Member.join_year)                  # 按年份排序
        .all()
        if y[0] is not None                          # 跳过空年份
    ]

    # 已绑定队员的 id 集合（列表页只显示"已绑定"标记，不显示账号名）
    bound_member_ids = {
        u.member_id
        for u in User.query.filter(User.member_id.isnot(None), User.role == "member").all()
    }

    return render_template(
        "list.html",
        pagination=pagination,   # 传给模板用于显示当前页和翻页按钮
        keyword=keyword,         # 传回去让搜索框里保留已输入的关键字
        year=year,
        years=years,
        bound_member_ids=bound_member_ids,   # 用于标记"已绑定"
        **flower_context([m.id for m in pagination.items]),
    )


@app.route("/members/<int:member_id>")   # <int:member_id> 是网址里的数字参数
@login_required                 # 未登录不能看队员详情
def member_detail(member_id):
    # 按 id 找队员，找不到自动返回 404 页面
    member = db.get_or_404(Member, member_id)
    # 查该队员是否已被某个账号绑定（用于详情页显示"已被 xxx 绑定"）
    bound_user = bound_user_of(member.id)
    return render_template("detail.html", member=member, bound_user=bound_user,
                           **flower_context([member.id]))


@app.route("/members/<int:member_id>/flowers", methods=["POST"])
@login_required
def send_flower(member_id):
    token = session.get("flower_token", "")
    if not token or not secrets.compare_digest(token.encode(), request.form.get("flower_token", "").encode()):
        abort(400)
    db.get_or_404(Member, member_id)
    identity = dict(user_id=session["user_id"], member_id=member_id, sent_on=flower_day())
    db.session.add(Flower(**identity))
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        # 只将确实存在的重复献花当作正常情况，其他约束错误继续抛出。
        if not Flower.query.filter_by(**identity).first():
            raise
        flash("今天已经献过花啦，明天再来吧。", "info")
    else:
        flash("鲜花已送达，谢谢你的支持！", "success")
    if request.form.get("return_to") == "list":
        return redirect(url_for("member_list", keyword=request.form.get("keyword", ""),
                                year=request.form.get("year", ""),
                                page=max(1, request.form.get("page", 1, type=int) or 1)))
    return redirect(url_for("member_detail", member_id=member_id))


# ============================================================
# 队员管理（仅管理员）：新增 / 编辑 / 删除
# ============================================================

@app.route("/members/new", methods=["GET", "POST"])
@admin_required            # 只有管理员能访问这组功能
def member_new():
    if request.method == "POST":           # 提交了新增表单
        name = request.form.get("name", "").strip()
        if not name:                       # 姓名为空 -> 报错并留在表单页
            return render_template("form.html", member=None, error="姓名不能为空")
        bio = request.form.get("bio", "").strip()
        join_year = request.form.get("join_year", "").strip()
        cohort = request.form.get("cohort", "").strip()
        works = request.form.get("works", "").strip()
        photo = save_photo(request.files.get("photo"))  # 保存头像文件，返回文件名（可为空）
        member = Member(                   # 组装一个"队员对象"
            name=name,
            bio=bio,
            join_year=int(join_year) if join_year else None,  # 空年份就存 None
            cohort=cohort,
            works=works,
            photo=photo,
        )
        db.session.add(member)             # 入队（草稿）
        if "resources_present" in request.form:
            member.resources = selected_resources()
        db.session.commit()                # 提交（真正写库）
        return redirect(url_for("member_detail", member_id=member.id))  # 跳去他的详情页
    return render_template("form.html", member=None)   # GET：显示空表单


@app.route("/members/<int:member_id>/edit", methods=["GET", "POST"])
@admin_required
def member_edit(member_id):
    member = db.get_or_404(Member, member_id)   # 先找到要改的队员
    if request.method == "POST":                # 提交了修改表单
        name = request.form.get("name", "").strip()
        if not name:
            return render_template("form.html", member=member, error="姓名不能为空")
        member.name = name              # 直接改对象属性
        if "resources_present" in request.form:
            member.resources = selected_resources()
        member.bio = request.form.get("bio", "").strip()
        join_year = request.form.get("join_year", "").strip()
        member.join_year = int(join_year) if join_year else None
        member.cohort = request.form.get("cohort", "").strip()
        member.works = request.form.get("works", "").strip()
        photo = save_photo(request.files.get("photo"))  # 上传了新头像才换
        if photo:
            member.photo = photo
        db.session.commit()             # 把改动提交写库（对象已存在，用 commit 即可）
        return redirect(url_for("member_detail", member_id=member.id))
    return render_template("form.html", member=member)   # GET：表单里预填当前数据


@app.route("/members/<int:member_id>/delete", methods=["POST"])
@admin_required
def member_delete(member_id):
    member = db.get_or_404(Member, member_id)
    # 若该队员被某用户绑定，先解除该用户的绑定（否则外键约束会报错 / 留下悬空引用）
    bound = User.query.filter_by(member_id=member.id).first()
    if bound:
        bound.member_id = None
        bound.role = "user"
    Flower.query.filter_by(member_id=member.id).delete()
    # 保留审核历史，去掉指向即将删除档案的外键；待审申请须驳回并说明原因。
    for req in JoinRequest.query.filter_by(member_id=member.id).all():
        req.member_id = None
        if req.status == "pending":
            req.status = "rejected"
            req.admin_note = "目标队员档案已删除，请重新申请或新建档案。"
            req.result_acknowledged = False
    db.session.delete(member)     # 删除对象
    db.session.commit()           # 提交（真正从库里删掉）
    return redirect(url_for("member_list"))


# ============================================================
# 用户管理（仅管理员）
# ============================================================

@app.route("/admin/users")
@admin_required
def user_list():
    """列出所有用户 + 待审核的入队申请，供管理员管理"""
    users = User.query.order_by(User.id).all()
    requests = JoinRequest.query.order_by(JoinRequest.created_at.desc()).all()
    pending_count = JoinRequest.query.filter_by(status="pending").count()
    return render_template(
        "user_list.html", users=users, requests=requests, pending_count=pending_count
    )


@app.route("/admin/users/<int:user_id>/toggle", methods=["POST"])
@admin_required
def user_toggle(user_id):
    """切换用户的启用/禁用状态"""
    user = db.get_or_404(User, user_id)
    if user.is_admin:            # 不能禁用管理员自己（防把自己锁死）
        return redirect(url_for("user_list"))
    # 三目运算：当前是正常 -> 变禁用；当前是禁用 -> 变正常
    user.status = "disabled" if user.is_active else "active"
    db.session.commit()
    return redirect(url_for("user_list"))


@app.route("/admin/users/<int:user_id>/delete", methods=["POST"])
@admin_required
def user_delete(user_id):
    """删除用户（连带删掉他的入队申请）"""
    user = db.get_or_404(User, user_id)
    if user.is_admin:            # 不能删管理员自己
        return redirect(url_for("user_list"))
    JoinRequest.query.filter_by(user_id=user.id).delete()  # 先删申请（外键）
    EmailToken.query.filter_by(user_id=user.id).delete()
    Flower.query.filter_by(user_id=user.id).delete()
    user.member_id = None        # 解除绑定（若有），避免外键悬空
    db.session.delete(user)      # 删用户
    db.session.commit()
    return redirect(url_for("user_list"))


@app.route("/admin/requests/<int:req_id>/approve", methods=["POST"])
@admin_required
def request_approve(req_id):
    """管理员通过一条入队申请：
    bind -> 把该用户绑定到目标队员（role=member, member_id）
    new  -> 先创建队员档案，再绑定"""
    req = db.get_or_404(JoinRequest, req_id)
    user = db.session.get(User, req.user_id)
    if req.status != "pending":
        flash("该申请已处理，请勿重复审核。", "warning")
        return redirect(url_for("user_list"))
    if not (req.identity_note or '').strip():
        flash('请先让申请人补填台词或参与经历，再通过申请。', 'warning')
        return redirect(url_for('user_list'))
    if not user or user.role != "user" or user.member_id is not None:
        flash("申请人的身份已变化，无法通过此申请。", "warning")
        return redirect(url_for("user_list"))
    if req.apply_type == "bind" and req.member_id:
        # 一对一校验：目标队员未被其他用户绑定
        conflict = User.query.filter(
            User.member_id == req.member_id, User.id != user.id
        ).first()
        if conflict:
            return redirect(url_for("user_list"))
        user.member_id = req.member_id
    elif req.apply_type == "new":
        # 新建档案
        member = Member(
            name=req.name,
            bio=req.bio,
            join_year=req.join_year,
            cohort=req.cohort,
        )
        db.session.add(member)
        db.session.flush()       # 拿到新队员的 id
        user.member_id = member.id
    else:
        return redirect(url_for("user_list"))
    user.role = "member"
    req.status = "approved"
    db.session.commit()
    return redirect(url_for("user_list"))


@app.route("/admin/requests/<int:req_id>/reject", methods=["POST"])
@admin_required
def request_reject(req_id):
    """管理员驳回一条入队申请，记录理由"""
    req = db.get_or_404(JoinRequest, req_id)
    if req.status != "pending":
        flash("该申请已处理，请勿重复审核。", "warning")
        return redirect(url_for("user_list"))
    note = request.form.get("note", "").strip()
    if not note:
        flash("请填写驳回理由，让申请者知道如何修改。", "warning")
        return redirect(url_for("user_list"))
    req.status = "rejected"
    req.admin_note = note
    db.session.commit()
    return redirect(url_for("user_list"))


@app.route("/admin/users/<int:user_id>/revoke_member", methods=["POST"])
@admin_required
def user_revoke_member(user_id):
    """管理员取消某用户的队员身份（回到普通用户，释放绑定的队员档案）"""
    user = db.get_or_404(User, user_id)
    if not user.is_admin:          # 不动管理员
        user.role = "user"
        user.member_id = None      # 释放绑定，让该队员可被其他人申请
        db.session.commit()
    return redirect(url_for("user_list"))


# ============================================================
# 公告（所有人能看；管理员才能发布/删除）
# ============================================================

@app.route("/announcements/new", methods=["GET", "POST"])
@admin_required
def announcement_new():
    if request.method == "POST":           # 提交发布公告表单
        title = request.form.get("title", "").strip()
        if not title or len(title) > 100:
            return render_template("announcement_form.html", error="标题需为 1–100 字。"), 400
        ann = Announcement(                # 建公告记录
            title=title, content=request.form.get("content", "").strip()
        )
        db.session.add(ann)
        db.session.commit()
        return redirect(url_for("hello"))  # 发布完回首页能看到
    return render_template("announcement_form.html")


@app.route("/announcements/<int:ann_id>/delete", methods=["POST"])
@admin_required
def announcement_delete(ann_id):
    ann = db.get_or_404(Announcement, ann_id)
    db.session.delete(ann)
    db.session.commit()
    return redirect(url_for("hello"))


# ============================================================
# 资源库（登录看/下载；队员和管理员上传；管理员删除）
# ============================================================

@app.route("/resources")
@login_required                    # 不登录看不到资源库
def resource_list():
    res_type = request.args.get("type", "").strip()   # 按类型筛选：?type=video 等
    query = Resource.query.filter_by(status="approved", production_id=None)
    if res_type:
        query = query.filter_by(res_type=res_type)
    resources = query.order_by(Resource.created_at.desc()).all()
    return render_template("resource_list.html", resources=resources, res_type=res_type)


@app.route("/resources/<int:res_id>")
@login_required
def resource_detail(res_id):
    resource = visible_resource(res_id)
    return render_template("resource_detail.html", resource=resource)


def visible_resource(res_id):
    resource = db.get_or_404(Resource, res_id)
    if resource.status != "approved" and session.get("role") != "admin" and resource.uploader_id != session.get("user_id"):
        abort(404)
    return resource


@app.route("/resources/<int:res_id>/preview")
@login_required
def resource_preview(res_id):
    resource = visible_resource(res_id)
    ext = resource.filename.rsplit(".", 1)[-1].lower()
    if resource.res_type != "photo" or ext not in app.config["ALLOWED_EXTENSIONS"]:
        abort(404)
    response = send_from_directory(app.config["RESOURCE_FOLDER"], resource.filename)
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.route("/resources/upload", methods=["GET", "POST"])
@member_required            # 队员上传需审核，管理员上传直接上架
def resource_upload():
    if request.method == "POST":           # 提交上传表单
        check_csrf()
        production_text = request.form.get("production_id", "").strip()
        production = db.get_or_404(Production, int(production_text)) if production_text.isascii() and production_text.isdigit() else None
        if production_text and not production:
            abort(400)
        title = request.form.get("title", "").strip()
        file = request.files.get("file")   # 取上传的文件
        if not 1 <= len(title) <= 100 or request.form.get("res_type", "other") not in RESOURCE_TYPES:
            return render_template("resource_upload.html", error="标题需为 1–100 字，请选择有效资料类型。"), 400
        if not file or not file.filename:
            return render_template("resource_upload.html", error="请选择文件")
        if not allowed_resource_file(file.filename):   # 文件类型不在允许名单里
            return render_template("resource_upload.html", error="不支持该文件类型")
        if request.form.get("res_type") == "photo" and not allowed_file(file.filename):
            return render_template("resource_upload.html", error="剧照请选择支持的图片文件。"), 400
        original_name = secure_filename(file.filename)  # 清洗成安全文件名（存原文件名备用）
        ext = file.filename.rsplit(".", 1)[-1].lower()  # 取后缀
        unique_name = f"{uuid.uuid4().hex}.{ext}"       # 磁盘上改用随机名，防冲突/防路径注入
        os.makedirs(app.config["RESOURCE_FOLDER"], exist_ok=True)  # 确保目录存在
        file.save(os.path.join(app.config["RESOURCE_FOLDER"], unique_name))  # 存文件
        res = Resource(                      # 管理员直接发布；队员提交待审核记录
            production=production,
            uploader_id=session["user_id"],
            status="approved" if session.get("role") == "admin" else "pending",
            title=title,
            res_type=request.form.get("res_type", "other"),
            description=request.form.get("description", "").strip(),
            filename=unique_name,            # 磁盘上的实际文件名（随机）
            original_name=original_name,     # 用户上传时的原名（下载时还原显示）
        )
        db.session.add(res)
        db.session.commit()
        flash("资料已发布。" if res.status == "approved" else "上传成功，等待管理员审核后入库。", "success")
        return redirect(url_for("resource_detail", res_id=res.id))
    return render_template("resource_upload.html")


@app.route("/resources/<int:res_id>/download")
@login_required                       # 不登录点不了下载
def resource_download(res_id):
    """给用户返回资源文件供下载，并记录一次下载次数"""
    res = visible_resource(res_id)
    res.download_count += 1           # 下载次数 +1
    db.session.commit()
    response = send_from_directory(       # 从服务器目录安全发送文件
        app.config["RESOURCE_FOLDER"],    # 去哪个文件夹找
        res.filename,                     # 磁盘上的随机文件名
        as_attachment=True,               # 以"附件下载"形式（否则视频会在浏览器里播放）
        download_name=res.original_name or res.filename,  # 下载保存时用回原来的文件名
    )
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.route("/resources/<int:res_id>/delete", methods=["POST"])
@admin_required
def resource_delete(res_id):
    """删除资源：先把磁盘上的文件删掉，再删数据库记录（仅管理员）"""
    res = db.get_or_404(Resource, res_id)
    path = os.path.join(app.config["RESOURCE_FOLDER"], res.filename)
    if os.path.exists(path):      # 文件存在才删
        os.remove(path)
    db.session.delete(res)
    db.session.commit()
    return redirect(url_for("resource_list"))


@app.errorhandler(413)
def file_too_large(e):
    """当上传文件超过 MAX_CONTENT_LENGTH（200MB）时，Flask 抛 413，这里转成友好提示"""
    return render_template("error.html", code=413, message="文件太大，单文件不能超过 200MB"), 413


# ============================================================
# 启动入口：直接运行本文件（python app.py）时执行
# ============================================================

if __name__ == "__main__":
    app.run(debug=True)   # debug=True：开发模式，改代码自动重启、报错显示详细信息
