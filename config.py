# ============================================================
# config.py —— 网站的"配置中心"
#
# 集中管理所有环境相关的设置：数据库在哪、上传文件存哪、密钥是什么。
# 好处：改配置只动这一个文件，不用去翻代码。
# 密码等敏感信息不写死在这里，而是从 .env 文件读取（.env 已被 git 忽略不上传）。
# ============================================================

import os    # 用于拼文件路径
from urllib.parse import quote_plus

from dotenv import load_dotenv   # 用来读取 .env 文件里的变量

# 加载项目根目录下的 .env 文件，把里面的 DB_USER=root 之类读到环境变量里。
# 这样下面 os.getenv("DB_USER") 才能取到值。
load_dotenv()

# 项目根目录的绝对路径（config.py 所在文件夹），后面拼上传目录时用它做基准
BASE_DIR = os.path.abspath(os.path.dirname(__file__))


class Config:
    # 对外联系方式与邮件服务；真实值在本机 .env 中配置。
    CONTACT_EMAIL = os.getenv("CONTACT_EMAIL", "moonflying56@gmail.com")
    CONTACT_WECHAT = os.getenv("CONTACT_WECHAT", "")
    PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://127.0.0.1:5000")
    MAIL_HOST = os.getenv("MAIL_HOST", "")
    MAIL_PORT = int(os.getenv("MAIL_PORT", "465"))
    MAIL_USERNAME = os.getenv("MAIL_USERNAME", "")
    MAIL_PASSWORD = os.getenv("MAIL_PASSWORD", "")
    MAIL_FROM = os.getenv("MAIL_FROM", "")
    MAIL_USE_SSL = os.getenv("MAIL_USE_SSL", "true").lower() == "true"
    # ---- 安全密钥：session（登录状态）加密签名用的钥匙 ----
    # 生产环境应该换成一个复杂随机的长字符串
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key")

    # ---- 数据库连接地址（URI）----
    # 格式：mysql+pymysql://用户名:密码@主机:端口/库名?charset=utf8mb4
    # 各字段都从 .env 读取；charset=utf8mb4 保证中文不乱码
    SQLALCHEMY_DATABASE_URI = (
        f"mysql+pymysql://{quote_plus(os.getenv('DB_USER', ''))}:{quote_plus(os.getenv('DB_PASSWORD', ''))}"
        f"@{os.getenv('DB_HOST')}:{os.getenv('DB_PORT')}/{os.getenv('DB_NAME')}?charset=utf8mb4"
    )
    # 关闭 SQLAlchemy 的"每次改动都发通知"功能（省资源，对项目无影响）
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # ---- 上传文件存放目录 ----
    UPLOAD_FOLDER = os.path.join(BASE_DIR, "static", "uploads")     # 队员头像存这里
    RESOURCE_FOLDER = os.getenv("RESOURCE_FOLDER", os.path.join(BASE_DIR, "static", "resources"))
    PENDING_FOLDER = os.path.join(BASE_DIR, "static", "pending")    # 资源"待审核"文件存这里

    # ---- 允许上传的图片格式（黑名单之外的都会被拒绝）----
    ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}

    # ---- 资源上传限制 ----
    # 允许的资源文件类型（视频/文档/音频/压缩包等常用格式）
    RESOURCE_ALLOWED_EXTENSIONS = {
        "mp4", "mov", "avi", "mkv", "wmv",       # 视频
        "mp3", "wav", "flac", "aac",              # 音频
        "pdf", "doc", "docx", "txt", "md",        # 文档/剧本
        "png", "jpg", "jpeg", "gif", "webp",      # 图片/剧照
        "zip", "rar", "7z",                        # 压缩包
    }
    # 最大上传体积（200MB），超出会被拒绝（413 错误）
    MAX_CONTENT_LENGTH = 200 * 1024 * 1024
