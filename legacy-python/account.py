"""邮箱绑定与密码找回。没有配置 SMTP 时保留联系方式，但不发送或暴露验证链接。"""
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
import hashlib
import re
import secrets
import smtplib
import ssl
from urllib.parse import urlsplit

from flask import Blueprint, abort, current_app, flash, redirect, render_template, request, session, url_for
from sqlalchemy.exc import IntegrityError
from werkzeug.security import generate_password_hash
from models import db, EmailToken, User

account = Blueprint("account", __name__)


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def normalize_email(value):
    email = value.strip().lower()
    if len(email) > 254 or not re.fullmatch(r"[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+", email):
        return None
    return email


def mail_ready():
    config = current_app.config
    base = urlsplit(config["PUBLIC_BASE_URL"])
    safe_url = base.scheme == "https" or (base.scheme == "http" and base.hostname in ("localhost", "127.0.0.1"))
    return bool(safe_url and base.netloc and not base.username and not base.query and not base.fragment
                and all(config.get(key) for key in ("MAIL_HOST", "MAIL_USERNAME", "MAIL_PASSWORD", "MAIL_FROM")))


def csrf_token():
    if "account_token" not in session:
        session["account_token"] = secrets.token_hex(32)
    return session["account_token"]


def check_csrf():
    expected = session.get("account_token", "")
    if not expected or not secrets.compare_digest(expected.encode(), request.form.get("csrf_token", "").encode()):
        abort(400)


@account.app_context_processor
def account_context():
    return {"account_csrf": csrf_token, "mail_ready": mail_ready()}


def send_email(recipient, subject, body):
    """始终使用经过证书验证的 TLS，不在日志中打印邮件内容或授权码。"""
    config = current_app.config
    message = EmailMessage()
    message["From"] = config["MAIL_FROM"]
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(body)
    context = ssl.create_default_context()
    if config["MAIL_USE_SSL"]:
        server = smtplib.SMTP_SSL(config["MAIL_HOST"], config["MAIL_PORT"], timeout=10, context=context)
    else:
        server = smtplib.SMTP(config["MAIL_HOST"], config["MAIL_PORT"], timeout=10)
    with server:
        if not config["MAIL_USE_SSL"]:
            server.starttls(context=context)
        server.login(config["MAIL_USERNAME"], config["MAIL_PASSWORD"])
        server.send_message(message)


def issue_email(user, email, purpose):
    if not mail_ready():
        return "unavailable"
    now = utcnow()
    # 同一账号每分钟一次、每天最多十封。条件 UPDATE 保证并发请求不能穿透间隔。
    if EmailToken.query.filter(EmailToken.user_id == user.id, EmailToken.created_at > now - timedelta(days=1)).count() >= 10:
        return "limited"
    updated = User.query.filter(User.id == user.id, db.or_(User.mail_sent_at.is_(None), User.mail_sent_at <= now - timedelta(seconds=60))).update(
        {User.mail_sent_at: now}, synchronize_session=False)
    if not updated:
        db.session.rollback()
        return "limited"
    raw = secrets.token_urlsafe(32)
    token = EmailToken(user_id=user.id, digest=hashlib.sha256(raw.encode()).hexdigest(),
                       purpose=purpose, email=email, auth_version=user.auth_version,
                       created_at=now, expires_at=now + timedelta(minutes=30))
    db.session.add(token)
    db.session.commit()
    endpoint = "account.verify_email" if purpose == "verify" else "account.reset_password"
    link = current_app.config["PUBLIC_BASE_URL"].rstrip("/") + url_for(endpoint, token=raw)
    action = "验证邮箱" if purpose == "verify" else "重置密码"
    try:
        send_email(email, f"话剧队 · {action}", f"请打开下面的链接{action}（30 分钟内有效，仅可使用一次）：\n\n{link}\n\n如果不是你本人发起，请忽略本邮件。不要将链接转发给他人。")
    except (OSError, smtplib.SMTPException, ValueError):
        token.consumed = True
        db.session.commit()
        current_app.logger.warning("账号邮件发送失败，请检查邮件服务配置和网络连接。")
        return "failed"
    return "sent"


@account.route("/profile/email", methods=["POST"])
def profile_email():
    if "user_id" not in session:
        return redirect(url_for("login"))
    check_csrf()
    user = db.session.get(User, session["user_id"])
    email = normalize_email(request.form.get("email", ""))
    if not user.check_password(request.form.get("password", "")):
        flash("当前密码不正确，邮箱尚未修改。", "warning")
    elif not email:
        flash("请填写有效的邮箱地址。", "warning")
    elif user.email == email:
        flash("这个邮箱已经验证，可以用于找回密码。", "info")
    else:
        user.pending_email = email
        db.session.commit()
        result = issue_email(user, email, "verify")
        messages = {"sent": "验证邮件已发送，请在 30 分钟内打开邮件完成验证。",
                    "unavailable": "邮箱已保存为待验证。邮件服务尚未启用，启用后请在这里重新发送验证邮件。",
                    "limited": "邮箱已保存为待验证。发送太频繁，请稍后重试（每分钟一次、每天最多十封）。",
                    "failed": "邮箱已保存为待验证，但邮件发送失败，请稍后重试或联系管理员。"}
        flash(messages[result], "success" if result == "sent" else "warning")
    return redirect(url_for("profile"))


def find_token(raw, purpose):
    if len(raw) > 100:
        return None, None
    record = EmailToken.query.filter_by(digest=hashlib.sha256(raw.encode()).hexdigest(), purpose=purpose, consumed=False).first()
    if not record or record.expires_at <= utcnow():
        return None, None
    user = db.session.get(User, record.user_id)
    if not user or not user.is_active or user.auth_version != record.auth_version:
        return None, None
    if record.email != (user.pending_email if purpose == "verify" else user.email):
        return None, None
    return record, user


def consume(record):
    return EmailToken.query.filter_by(id=record.id, consumed=False).filter(EmailToken.expires_at > utcnow()).update(
        {EmailToken.consumed: True}, synchronize_session=False)


@account.route("/verify-email/<token>", methods=["GET", "POST"])
def verify_email(token):
    record, user = find_token(token, "verify")
    if not record:
        return render_template("account_action.html", mode="invalid"), 400
    if request.method == "POST":
        check_csrf()
        if not consume(record):
            db.session.rollback()
            return render_template("account_action.html", mode="invalid"), 400
        # 并发的邮箱修改或密码重置发生后，旧验证链接不应覆盖新状态。
        try:
            updated = User.query.filter_by(id=user.id, pending_email=record.email, auth_version=record.auth_version, status="active").update(
                {User.email: record.email, User.pending_email: None}, synchronize_session=False)
            if not updated:
                db.session.rollback()
                return render_template("account_action.html", mode="invalid"), 400
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            return render_template("account_action.html", mode="verify", error="此邮箱已绑定其他账号，请登录个人中心更换邮箱。"), 409
        flash("邮箱验证成功，现在可以通过这个邮箱找回密码。", "success")
        return redirect(url_for("profile" if session.get("user_id") == user.id else "login"))
    return render_template("account_action.html", mode="verify")


@account.route("/forgot-password", methods=["GET", "POST"])
def forgot_password():
    if request.method == "POST":
        check_csrf()
        if not mail_ready():
            return render_template("account_action.html", mode="forgot", error="邮件服务尚未启用，请联系管理员协助处理。"), 503
        email = normalize_email(request.form.get("email", ""))
        user = User.query.filter_by(email=email, status="active").first() if email else None
        if user:
            issue_email(user, user.email, "reset")
        # 有无账号、是否限流、是否发送失败均使用同一响应，避免泄露邮箱注册状态。
        return render_template("account_action.html", mode="requested")
    return render_template("account_action.html", mode="forgot")


@account.route("/reset-password/<token>", methods=["GET", "POST"])
def reset_password(token):
    record, user = find_token(token, "reset")
    if not record:
        return render_template("account_action.html", mode="invalid"), 400
    if request.method == "POST":
        check_csrf()
        password = request.form.get("password", "")
        if not 8 <= len(password) <= 128 or password != request.form.get("confirm_password", ""):
            return render_template("account_action.html", mode="reset", error="密码需为 8–128 位，且两次输入一致。"), 400
        if not consume(record):
            db.session.rollback()
            return render_template("account_action.html", mode="invalid"), 400
        updated = User.query.filter_by(id=user.id, auth_version=record.auth_version, email=record.email, status="active").update(
            {User.password_hash: generate_password_hash(password), User.auth_version: User.auth_version + 1}, synchronize_session=False)
        if not updated:
            db.session.rollback()
            return render_template("account_action.html", mode="invalid"), 400
        db.session.commit()
        session.clear()
        flash("密码已重置，请使用新密码登录。之前的登录状态已失效。", "success")
        return redirect(url_for("login"))
    return render_template("account_action.html", mode="reset")


@account.after_request
def private_account_pages(response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response
