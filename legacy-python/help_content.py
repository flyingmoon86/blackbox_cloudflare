"""帮助条目与旧版整篇指南的兼容读取。"""
import json
from page_content import PAGE_TEXTS

DEFAULTS = {
 'member': [('30 秒上手', '登录后到名人堂找到熟悉的名字。\n打开戏剧作品，点击资料查看或下载。', 'theater.productions'),
 ('找到自己的档案', '注册时勾选“我是队员！”，或到个人中心申请。\n认领已有档案或申请新建，填写一句台词；幕后同学可写参与经历。\n旧待审申请记得补填，等待管理员审核。', 'profile'),
 ('把演出留下来', '上传时选好所属作品和类型。\n管理员审核通过后入库，在“我的上传”看进度。\n当前单次请求上限 200MB，大视频续传尚未实现。', 'theater.my_uploads'),
 ('让档案更像你', '认证后到个人中心更新头像和简介。\n不选新照片，就会保留原头像。', 'profile'),
 ('送一朵花', '打开名人堂，为队员献花。\n每位队员每天一次，北京时间零点刷新。', 'member_list'),
 ('账号别弄丢', '到个人中心绑定并验证邮箱。\n邮件服务未启用时联系管理员，不要分享密码或验证链接。', 'profile')],
 'admin': [('处理队员申请', '在用户管理核对台词或参与经历。\n未补填的旧申请不能通过，驳回请写清需要修改什么。', 'user_list'),
 ('给作品一张脸', '管理作品，从已审核剧照中选择封面。\n横竖比例和首页两种样式都能切换。\n设为首页演出后，封面和宣传简介将公开。', 'theater.productions'),
 ('资料入库前', '核对待审文件内容、类型和所属作品。\n确认后通过，不合适就填写理由驳回。', 'theater.resource_reviews'),
 ('招新与联系', '在剧团设置更新介绍、招新要求和联系方式。\n关闭招新开关，会隐藏要求和安排。', 'theater.site_settings'),
 ('写给队员的话', '欢迎语和页面说明在页面文案修改。\n帮助指南按条目编辑，功能入口由程序维护。', 'theater.page_texts'),
 ('删除前再看一眼', '删除作品会保留文件到参考资料。\n删除资料会删除文件，确认目标后再操作。', 'resource_list')]
}

def stored_texts(info):
    try:
        data = json.loads(info.page_texts or '{}') if info else {}
    except (ValueError, TypeError):
        return {}
    return data if isinstance(data, dict) else {}

def help_items(info, audience):
    data = stored_texts(info)
    saved = data.get('help_items_' + audience)
    if isinstance(saved, list) and saved and all(isinstance(x, dict) and isinstance(x.get('title'), str) and isinstance(x.get('body'), str) for x in saved):
        return saved
    old = data.get(audience + '_guide')
    if isinstance(old, str) and old != PAGE_TEXTS[audience + '_guide'][2]:
        sections = [part for part in old.split('\n\n') if part.strip()]
        return [dict(title=part.split('\n', 1)[0][:100] if '\n' in part else '原有指南', body=part, endpoint=None) for part in sections] or [dict(title='原有指南', body='', endpoint=None)]
    return [dict(title=t, body=b, endpoint=e) for t,b,e in DEFAULTS[audience]]
