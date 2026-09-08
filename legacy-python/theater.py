"""剧团特色、作品归档和演职员管理。"""
from functools import wraps
import json
from page_content import PAGE_TEXTS, get_page_texts
from help_content import help_items, stored_texts
from datetime import datetime, timezone, timedelta

from flask import Blueprint, abort, current_app, flash, redirect, render_template, request, session, url_for, send_from_directory
from uploads import allowed_file, save_photo
from account import check_csrf, normalize_email
from models import db, Member, Production, ProductionCredit, Resource, SiteProfile

theater = Blueprint("theater", __name__)
RESOURCE_TYPES = {"script": "剧本", "prompt": "台本", "photo": "剧照", "video": "演出视频", "audio": "音频", "other": "其他文件"}


def cover_photo(production):
    if not production:
        return None
    query = Resource.query.filter_by(production_id=production.id, status='approved', res_type='photo')
    selected = query.filter_by(id=production.cover_id).first() if production.cover_id else None
    return selected or query.order_by(Resource.id).first()


@theater.route('/featured-cover')
def featured_cover():
    info = db.session.get(SiteProfile, 1)
    production = db.session.get(Production, info.featured_production_id) if info and info.featured_production_id else None
    photo = cover_photo(production)
    if not photo or not allowed_file(photo.filename):
        abort(404)
    response = send_from_directory(current_app.config['RESOURCE_FOLDER'], photo.filename)
    response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response


@theater.route("/help")
def help_page():
    if not session.get("user_id"):
        return redirect(url_for("login"))
    return render_template("help.html", admin_guide=False, items=help_items(db.session.get(SiteProfile, 1), "member"))


@theater.route("/help/admin")
def admin_help():
    if not session.get("user_id"):
        return redirect(url_for("login"))
    if session.get("role") != "admin":
        abort(403)
    return render_template("help.html", admin_guide=True, items=help_items(db.session.get(SiteProfile, 1), "admin"))


def require_roles(*roles):
    def decorator(func):
        @wraps(func)
        def wrapped(*args, **kwargs):
            if not session.get("user_id"):
                return redirect(url_for("login"))
            if roles and session.get("role") not in roles:
                abort(403)
            if request.method == "POST":
                check_csrf()
            return func(*args, **kwargs)
        return wrapped
    return decorator


@theater.app_context_processor
def theater_context():
    info = db.session.get(SiteProfile, 1)
    return {"troupe": info, "resource_types": RESOURCE_TYPES, "page_copy": get_page_texts(info), "cover_photo": cover_photo,
            "troupe_intro": info.introduction if info and info.introduction is not None else PAGE_TEXTS['contact_intro'][2],
            "contact_email": info.contact_email if info and info.contact_email is not None else current_app.config['CONTACT_EMAIL'],
            "contact_wechat": info.contact_wechat if info and info.contact_wechat is not None else current_app.config['CONTACT_WECHAT'],
            "current_year": datetime.now(timezone(timedelta(hours=8))).year,
            "pending_resources": Resource.query.filter_by(status="pending").count() if session.get("role") == "admin" else 0}


@theater.route("/productions")
@require_roles()
def productions():
    keyword = request.args.get("keyword", "").strip()
    query = Production.query
    if keyword:
        query = query.filter(Production.title.contains(keyword, autoescape=True))
    pagination = query.order_by(Production.year.desc(), Production.id.desc()).paginate(
        page=max(1, request.args.get("page", 1, type=int) or 1), per_page=9, error_out=False)
    # 仅为当前页批量获取第一张剧照，避免每个卡片单独查询。
    photos = {}
    for resource in Resource.query.filter(Resource.production_id.in_([p.id for p in pagination.items]), Resource.res_type == "photo", Resource.status == "approved").order_by(Resource.id).all():
        photos.setdefault(resource.production_id, resource)
        if any(p.id == resource.production_id and p.cover_id == resource.id for p in pagination.items):
            photos[resource.production_id] = resource
    return render_template("productions.html", pagination=pagination, keyword=keyword, photos=photos)


@theater.route("/admin/page-texts", methods=["GET", "POST"])
@require_roles("admin")
def page_texts():
    fields = {k: v for k, v in PAGE_TEXTS.items() if k not in ("contact_intro", "member_guide", "admin_guide")}
    info = db.session.get(SiteProfile, 1)
    selected_field = request.args.get("field")
    if selected_field not in fields:
        selected_field = None
    if request.method == "POST":
        values = {key: request.form.get(key, "").strip() for key in fields}
        if any(len(value) > 20000 for value in values.values()) or any(not values[key] for key in ("home_member", "home_visitor")):
            return render_template("page_texts.html", fields=fields, values=values, selected_field=selected_field, error="欢迎语不能为空；每项内容最多 20000 字。"), 400
        if not info:
            info = SiteProfile(id=1, troupe_name="黑匣子")
            db.session.add(info)
        data = stored_texts(info)
        data.update(values)
        info.page_texts = json.dumps(data, ensure_ascii=False)
        db.session.commit()
        flash("页面文案已保存。", "success")
        return redirect(url_for("theater.page_texts"))
    return render_template("page_texts.html", fields=fields, values=get_page_texts(info), selected_field=selected_field)


@theater.route("/productions/<int:production_id>")
@require_roles()
def production_detail(production_id):
    production = db.get_or_404(Production, production_id)
    return render_template("production_detail.html", production=production,
                           resources=Resource.query.filter_by(production_id=production.id, status="approved").order_by(Resource.id).all())


@theater.route('/productions/<int:production_id>/feature', methods=['POST'])
@require_roles('admin')
def feature_production(production_id):
    production = db.get_or_404(Production, production_id)
    info = db.session.get(SiteProfile, 1)
    if not info:
        info = SiteProfile(id=1, troupe_name='黑匣子')
        db.session.add(info)
    info.featured_production_id = None if request.form.get('remove') else production.id
    db.session.commit()
    flash('首页重点演出已更新。', 'success')
    return redirect(url_for('theater.production_edit', production_id=production.id))


@theater.route("/my-uploads")
@require_roles()
def my_uploads():
    resources = Resource.query.filter_by(uploader_id=session["user_id"]).order_by(Resource.id.desc()).all()
    return render_template("resource_reviews.html", resources=resources, reviewing=False)


@theater.route("/admin/resources")
@require_roles("admin")
def resource_reviews():
    resources = Resource.query.filter_by(status="pending").order_by(Resource.id).all()
    return render_template("resource_reviews.html", resources=resources, reviewing=True)


@theater.route("/admin/resources/<int:res_id>/review", methods=["POST"])
@require_roles("admin")
def review_resource(res_id):
    resource = db.get_or_404(Resource, res_id)
    action = request.form.get("action")
    note = request.form.get("note", "").strip()
    if action not in {"approve", "reject"} or (action == "reject" and not note):
        flash("请选择审核操作；驳回时必须填写理由。", "warning")
    else:
        updated = Resource.query.filter_by(id=resource.id, status="pending").update(
            {Resource.status: "approved" if action == "approve" else "rejected", Resource.admin_note: note}, synchronize_session=False)
        db.session.commit()
        flash("审核结果已保存。" if updated else "该资料已处理，请勿重复审核。", "success" if updated else "info")
    return redirect(url_for("theater.resource_reviews"))


def parse_production():
    title = request.form.get("title", "").strip()
    year = request.form.get("year", "").strip()
    if not 1 <= len(title) <= 100:
        raise ValueError("作品名称需为 1–100 字。")
    if year and (not year.isascii() or not year.isdigit() or not 1 <= int(year) <= 9999):
        raise ValueError("演出年份请填写 1–9999 的整数，未知可留空。")
    return dict(title=title, synopsis=request.form.get("synopsis", "").strip(), year=int(year) if year else None)


@theater.route("/productions/new", methods=["GET", "POST"])
@require_roles("admin")
def production_new():
    if request.method == "POST":
        try:
            values = parse_production()
        except ValueError as error:
            return render_template("production_form.html", production=None, error=str(error)), 400
        production = Production(**values)
        db.session.add(production)
        db.session.commit()
        flash("作品已创建，可以添加演职员和归档资料。", "success")
        return redirect(url_for("theater.production_edit", production_id=production.id))
    return render_template("production_form.html", production=None)


@theater.route("/productions/<int:production_id>/edit", methods=["GET", "POST"])
@require_roles("admin")
def production_edit(production_id):
    production = db.get_or_404(Production, production_id)
    context = {"production": production, "members": Member.query.order_by(Member.name).all(), "cover_choices": Resource.query.filter_by(production_id=production.id, status='approved', res_type='photo').all()}
    if request.method == "POST":
        try:
            values = parse_production()
            if 'cover_id' in request.form:
                raw = request.form.get('cover_id', '')
                selected = next((r for r in context['cover_choices'] if str(r.id) == raw), None)
                if raw and not selected:
                    raise ValueError('封面必须选择本作品已审核的剧照。')
                ratio, layout = request.form.get('cover_ratio'), request.form.get('feature_layout')
                promo = request.form.get('promo', '').strip()
                if ratio not in ('landscape', 'portrait') or layout not in ('split', 'overlay') or len(promo) > 300:
                    raise ValueError('请选择有效展示样式，宣传简介最多 300 字。')
                values.update(cover_id=selected.id if selected else None, cover_ratio=ratio, feature_layout=layout, promo=promo)
        except ValueError as error:
            return render_template("production_form.html", **context, error=str(error)), 400
        for key, value in values.items():
            setattr(production, key, value)
        db.session.commit()
        flash("作品信息已保存。", "success")
        return redirect(url_for("theater.production_detail", production_id=production.id))
    return render_template("production_form.html", **context)


@theater.route("/productions/<int:production_id>/credits", methods=["POST"])
@require_roles("admin")
def add_credit(production_id):
    production = db.get_or_404(Production, production_id)
    member_id = request.form.get("member_id", type=int)
    member = db.get_or_404(Member, member_id) if member_id else None
    kind, role = request.form.get("kind"), request.form.get("role_name", "").strip()
    if not member or kind not in {"cast", "crew"} or not 1 <= len(role) <= 80:
        flash("请选择队员、演员/后台类型，并填写 1–80 字的角色或分工。", "warning")
    elif ProductionCredit.query.filter_by(production_id=production.id, member_id=member.id, kind=kind, role_name=role).first():
        flash("该演职员记录已存在。", "info")
    else:
        db.session.add(ProductionCredit(production=production, member=member, kind=kind, role_name=role))
        db.session.commit()
    return redirect(url_for("theater.production_edit", production_id=production.id))


@theater.route("/productions/<int:production_id>/credits/<int:credit_id>/delete", methods=["POST"])
@require_roles("admin")
def delete_credit(production_id, credit_id):
    credit = db.get_or_404(ProductionCredit, credit_id)
    if credit.production_id != production_id:
        abort(404)
    db.session.delete(credit)
    db.session.commit()
    return redirect(url_for("theater.production_edit", production_id=production_id))


@theater.route("/productions/<int:production_id>/delete", methods=["POST"])
@require_roles("admin")
def production_delete(production_id):
    production = db.get_or_404(Production, production_id)
    info = db.session.get(SiteProfile, 1)
    if info and info.featured_production_id == production.id:
        info.featured_production_id = None
    # ORM 将资源的 production_id 置空，文件回到“其他资料”，不删除文件。
    db.session.delete(production)
    db.session.commit()
    flash("作品已删除，所属文件已保留到其他资料。", "success")
    return redirect(url_for("theater.productions"))


@theater.route("/resources/<int:res_id>/edit", methods=["GET", "POST"])
@require_roles("admin")
def resource_edit(res_id):
    resource = db.get_or_404(Resource, res_id)
    productions = Production.query.order_by(Production.title).all()
    if request.method == "POST":
        title, kind = request.form.get("title", "").strip(), request.form.get("res_type", "")
        production_text = request.form.get("production_id", "").strip()
        target = db.session.get(Production, int(production_text)) if production_text.isascii() and production_text.isdigit() else None
        if not 1 <= len(title) <= 100 or kind not in RESOURCE_TYPES or (production_text and not target) or (kind == "photo" and resource.filename.rsplit(".", 1)[-1].lower() not in current_app.config["ALLOWED_EXTENSIONS"]):
            return render_template("resource_edit.html", resource=resource, productions=productions, error="请核对标题、资料类型和所属作品。"), 400
        resource.title, resource.res_type = title, kind
        resource.description = request.form.get("description", "").strip()
        resource.production = target
        db.session.commit()
        flash("资料信息与归类已保存。", "success")
        return redirect(url_for("resource_detail", res_id=resource.id))
    return render_template("resource_edit.html", resource=resource, productions=productions)


@theater.route("/admin/site", methods=["GET", "POST"])
@require_roles("admin")
def site_settings():
    info = db.session.get(SiteProfile, 1)
    if request.method == "POST":
        values = {name: request.form.get(name, "").strip() for name in ("troupe_name", "qq_group", "public_account", "recruitment", "requirements")}
        year = request.form.get("founded_year", str(info.founded_year or '') if info else '').strip()
        if 'introduction' in request.form:
            email = request.form.get('contact_email', '').strip()
            if email and not normalize_email(email):
                return render_template('site_settings.html', info=info, error='请输入有效联系邮箱。'), 400
            values.update(introduction=request.form.get('introduction','').strip(), contact_email=email,
                          contact_wechat=request.form.get('contact_wechat','').strip(), recruitment_open=bool(request.form.get('recruitment_open')))
            if len(values['introduction']) > 20000 or len(values['contact_wechat']) > 100:
                return render_template('site_settings.html', info=info, error='介绍最多 20000 字，微信最多 100 字。'), 400
        photo = request.files.get("hero_photo")
        error = None
        if not 1 <= len(values["troupe_name"]) <= 100 or len(values["qq_group"]) > 50 or len(values["public_account"]) > 100:
            error = "请填写剧团名称（最多 100 字）；QQ群最多 50 字，公众号最多 100 字。"
        elif year and (not year.isascii() or not year.isdigit() or not 1 <= int(year) <= 9999):
            error = "成立年份请填写 1–9999 的整数，未知可留空。"
        elif photo and photo.filename and not allowed_file(photo.filename):
            error = "背景仅支持 png、jpg、jpeg、gif、webp 图片。"
        if error:
            return render_template("site_settings.html", info=info, error=error), 400
        filename = save_photo(photo)
        if not info:
            info = SiteProfile(id=1)
            db.session.add(info)
        for key, value in values.items():
            setattr(info, key, value)
        info.founded_year = int(year) if year else None
        if filename:
            info.hero_photo = filename
        elif request.form.get("remove_photo"):
            info.hero_photo = ""
        db.session.commit()
        flash("剧团信息已更新。", "success")
        return redirect(url_for("theater.site_settings"))
    return render_template("site_settings.html", info=info)


@theater.route('/admin/help/<audience>', methods=['GET', 'POST'])
@require_roles('admin')
def edit_help(audience):
    if audience not in ('member', 'admin'):
        abort(404)
    info = db.session.get(SiteProfile, 1)
    items = help_items(info, audience)
    if request.method == 'POST':
        updated = [dict(title=request.form.get(f'title_{i}', '').strip(), body=request.form.get(f'body_{i}', '').strip(), endpoint=item.get('endpoint')) for i, item in enumerate(items)]
        if any(not x['title'] or len(x['title']) > 100 or len(x['body']) > 20000 for x in updated):
            return render_template('help_edit.html', items=updated, audience=audience, error='标题必填且最多 100 字；内容最多 20000 字。'), 400
        if not info:
            info = SiteProfile(id=1, troupe_name='黑匣子')
            db.session.add(info)
        data = stored_texts(info)
        data['help_items_' + audience] = updated
        info.page_texts = json.dumps(data, ensure_ascii=False)
        db.session.commit()
        return redirect(url_for('theater.admin_help' if audience == 'admin' else 'theater.help_page'))
    return render_template('help_edit.html', items=items, audience=audience)
