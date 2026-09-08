"""生产启动：仅监听本机，由 HTTPS 反向代理对外提供服务。"""
from app import app


def validate_production(config):
    if config['SECRET_KEY'] == 'dev-secret-key' or len(config['SECRET_KEY']) < 32:
        raise RuntimeError('生产环境必须设置至少 32 字符的随机 SECRET_KEY。')
    if not config['PUBLIC_BASE_URL'].startswith('https://'):
        raise RuntimeError('生产环境 PUBLIC_BASE_URL 必须是 HTTPS 网站地址。')


if __name__ == '__main__':
    from waitress import serve
    validate_production(app.config)
    app.config.update(DEBUG=False, SESSION_COOKIE_SECURE=True)
    serve(app, host='127.0.0.1', port=8080, threads=8,
          max_request_body_size=app.config['MAX_CONTENT_LENGTH'])
