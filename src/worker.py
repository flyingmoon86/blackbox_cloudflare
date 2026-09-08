"""阶段 0：验证 Flask、D1、Cookie/CSRF 和旧密码哈希兼容性。"""

import hashlib
import secrets

from flask import Flask, Response, jsonify, render_template_string, request, session
from pyodide.ffi import run_sync
from werkzeug.security import check_password_hash
from workers import wsgi


app = Flask(__name__)
# 只用于本地 PoC。部署前必须由 Cloudflare Secret 在每次请求中覆盖。
app.secret_key = "phase0-local-only-change-before-deploy"

TEST_HASH = (
    "scrypt:32768:8:1$phase0salt$"
    "a890e2f1dd05a29e1bbb5cf3eb2aa3b7e7d0b6dc516743896f6412565a663b62"
    "8ba3c727d8c746c5fb2075a2f5230e3d5e9160d5782ab2b0277aa9cac6650cb5"
)

PAGE = """<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>黑匣子 · Cloudflare 阶段 0</title>
  <link rel="stylesheet" href="/poc.css">
</head>
<body>
  <main>
    <p class="eyebrow">CLOUDFLARE 阶段 0</p>
    <h1>黑匣子迁移验证</h1>
    <p>这个页面只连接本地测试资源，不使用正式账号或资料。</p>
    <dl>
      <div><dt>Flask / Jinja</dt><dd>已渲染</dd></div>
      <div><dt>Cookie / CSRF</dt><dd>表单提交时验证</dd></div>
      <div><dt>D1</dt><dd>当前测试记录：{{ count }}</dd></div>
      <div><dt>旧密码格式</dt><dd><a href="/poc/password">运行兼容检查</a></dd></div>
    </dl>
    <form method="post" action="/poc/entry">
      <input type="hidden" name="csrf_token" value="{{ csrf_token }}">
      <label for="note">写一条本地测试记录</label>
      <input id="note" name="note" maxlength="80" required>
      <button type="submit">写入 D1</button>
    </form>
  </main>
</body>
</html>"""


def worker_env():
    return request.environ["workers.env"]


def db_call(operation):
    return run_sync(operation)


def csrf_token():
    if "csrf_token" not in session:
        session["csrf_token"] = secrets.token_hex(32)
    return session["csrf_token"]


@app.before_request
def load_runtime_secret():
    env = worker_env()
    configured = getattr(env, "SECRET_KEY", None)
    if configured:
        app.secret_key = str(configured)


@app.get("/health")
def health():
    return jsonify(ok=True, runtime="cloudflare-python", phase=0)


@app.get("/")
def index():
    row = db_call(worker_env().DB.prepare(
        "SELECT COUNT(*) AS total FROM poc_entry"
    ).first())
    count = int(row.total) if row else 0
    return render_template_string(PAGE, count=count, csrf_token=csrf_token())


@app.post("/poc/entry")
def create_entry():
    supplied = request.form.get("csrf_token", "")
    expected = session.get("csrf_token", "")
    if not expected or not secrets.compare_digest(supplied, expected):
        return jsonify(ok=False, error="CSRF 校验失败"), 400
    note = request.form.get("note", "").strip()
    if not 1 <= len(note) <= 80:
        return jsonify(ok=False, error="测试内容需为 1–80 字"), 400
    db_call(worker_env().DB.prepare(
        "INSERT INTO poc_entry (note) VALUES (?)"
    ).bind(note).run())
    return jsonify(ok=True), 201


@app.get("/poc/password")
def password_compatibility():
    try:
        scrypt_supported = check_password_hash(TEST_HASH, "phase0-test-password")
    except (AttributeError, ValueError):
        scrypt_supported = False
    return jsonify(
        ok=False,
        legacy_scrypt_supported=scrypt_supported,
        hashlib_scrypt_available=hasattr(hashlib, "scrypt"),
        hashlib_pbkdf2_available=hasattr(hashlib, "pbkdf2_hmac"),
        next_probe="typescript-node-crypto",
        password_hash_migration_required=not scrypt_supported,
        uses_test_data=True,
    )


@app.get("/<path:path>")
def static_assets(path):
    asset = db_call(worker_env().ASSETS.fetch(f"https://assets.local/{path}"))
    body = db_call(asset.bytes())
    return Response(body, status=asset.status, headers=asset.headers)


Default = wsgi.entrypoint(app)
