"""注册与个人中心共用的队员申请校验。"""
from models import db, Member, User, JoinRequest


def application_values(form):
    note = form.get('identity_note', '').strip()
    if not 1 <= len(note) <= 1000:
        raise ValueError('请填写一句台词，或后台分工、排练经历（最多 1000 字）。')
    kind = form.get('apply_type', 'bind')
    values = dict(apply_type=kind, identity_note=note)
    if kind == 'bind':
        raw = form.get('member_id', '')
        member = db.session.get(Member, int(raw)) if raw.isascii() and raw.isdigit() else None
        if not member or User.query.filter_by(member_id=member.id).first() or JoinRequest.query.filter_by(member_id=member.id, status='pending', apply_type='bind').first():
            raise ValueError('请选择未被占用的队员档案。')
        values['member_id'] = member.id
    elif kind == 'new':
        name, cohort, year = (form.get(k, '').strip() for k in ('name', 'cohort', 'join_year'))
        if not 1 <= len(name) <= 50 or len(cohort) > 20:
            raise ValueError('姓名必填且最多 50 字，届别最多 20 字。')
        if year and (not year.isascii() or not year.isdigit() or not 1 <= int(year) <= 9999):
            raise ValueError('入队年份请填写 1–9999 的整数。')
        values.update(name=name, cohort=cohort, join_year=int(year) if year else None, bio=form.get('bio', '').strip())
    else:
        raise ValueError('请选择申请方式。')
    return values
