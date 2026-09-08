"""头像与公开首页背景共用的图片保存逻辑。"""
import os
import uuid
from flask import current_app


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in current_app.config['ALLOWED_EXTENSIONS']


def save_photo(file):
    if not file or not file.filename or not allowed_file(file.filename):
        return ''
    filename = uuid.uuid4().hex + '.' + file.filename.rsplit('.', 1)[1].lower()
    folder = current_app.config['UPLOAD_FOLDER']
    os.makedirs(folder, exist_ok=True)
    file.save(os.path.join(folder, filename))
    return filename
