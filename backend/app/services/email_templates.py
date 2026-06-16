"""고객 외부 알림 이메일 템플릿 (ESC-3). Jinja2 Template — 6개 이벤트.

payload 키는 호출자(external_notif_service)가 채워 넣는다.
공통 키: ticket_number, ticket_title, customer_name
이벤트별 추가 키는 각 템플릿 주석 참조.
"""
from __future__ import annotations

from jinja2 import Template

_BASE_STYLE = """
<div style="font-family:-apple-system,'Malgun Gothic',sans-serif;max-width:560px;margin:0 auto;padding:24px;border:1px solid #eee;border-radius:8px;">
  <p style="color:#888;font-size:12px;margin:0 0 12px;">{{ ticket_number }}</p>
  <h2 style="margin:0 0 16px;color:#1A1A1A;">{{ heading }}</h2>
  <p style="color:#333;line-height:1.6;">{{ body_html | safe }}</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
  <p style="color:#999;font-size:12px;">본 메일은 발신 전용입니다. 문의사항은 담당 채널로 회신해 주세요.</p>
</div>
"""

_LAYOUT = Template(_BASE_STYLE)

_TEMPLATES: dict[str, dict[str, str]] = {
    # payload: customer_name, ticket_title
    "ticket_created": {
        "subject": "[접수 완료] {{ ticket_title }}",
        "heading": "문의가 접수되었습니다",
        "body": (
            "{{ customer_name }}님, 안녕하세요.<br>"
            "요청하신 문의 <b>'{{ ticket_title }}'</b>가 정상적으로 접수되었습니다.<br>"
            "담당자가 확인 후 순차적으로 처리해 드리겠습니다."
        ),
    },
    # payload: customer_name, ticket_title, assignee_name
    "ticket_assigned": {
        "subject": "[담당자 배정] {{ ticket_title }}",
        "heading": "담당자가 배정되었습니다",
        "body": (
            "{{ customer_name }}님, 안녕하세요.<br>"
            "문의하신 건 <b>'{{ ticket_title }}'</b>에 담당자({{ assignee_name }})가 배정되어 "
            "처리를 시작합니다."
        ),
    },
    # payload: customer_name, ticket_title, customer_summary
    "ticket_escalated": {
        "subject": "[처리 진행중] {{ ticket_title }}",
        "heading": "보다 전문적인 처리를 위해 담당팀이 변경되었습니다",
        "body": (
            "{{ customer_name }}님, 안녕하세요.<br>"
            "보다 신속하고 정확한 해결을 위해 전문 처리팀으로 인계되어 계속 진행 중입니다.<br>"
            "{% if customer_summary %}<b>진행 상황:</b> {{ customer_summary }}<br>{% endif %}"
            "계속해서 책임지고 처리해 드리겠습니다."
        ),
    },
    # payload: customer_name, ticket_title, comment_preview
    "comment_added": {
        "subject": "[답변 등록] {{ ticket_title }}",
        "heading": "새로운 답변이 등록되었습니다",
        "body": (
            "{{ customer_name }}님, 안녕하세요.<br>"
            "문의하신 건에 새로운 답변이 등록되었습니다.<br>"
            "{% if comment_preview %}<i>\"{{ comment_preview }}\"</i><br>{% endif %}"
            "자세한 내용은 포털에서 확인하실 수 있습니다."
        ),
    },
    # payload: customer_name, ticket_title
    "ticket_resolved": {
        "subject": "[처리 완료] {{ ticket_title }}",
        "heading": "문의가 해결되었습니다",
        "body": (
            "{{ customer_name }}님, 안녕하세요.<br>"
            "요청하신 <b>'{{ ticket_title }}'</b> 건이 처리 완료되었습니다.<br>"
            "추가 문의사항이 있으시면 언제든 말씀해 주세요."
        ),
    },
    # payload: customer_name, ticket_title
    "sla_warning": {
        "subject": "[처리중] {{ ticket_title }}",
        "heading": "문의를 계속 처리하고 있습니다",
        "body": (
            "{{ customer_name }}님, 안녕하세요.<br>"
            "문의하신 <b>'{{ ticket_title }}'</b> 건은 현재 담당팀에서 계속 확인 중입니다.<br>"
            "빠른 시일 내 답변 드리겠습니다."
        ),
    },
}


def render_email(event_type: str, payload: dict) -> tuple[str, str]:
    """event_type → (subject, html_body). 미지원 이벤트는 ValueError."""
    tpl = _TEMPLATES.get(event_type)
    if not tpl:
        raise ValueError(f"지원하지 않는 이벤트 타입: {event_type}")

    ctx = {"ticket_number": "", "customer_name": "고객", **payload}

    subject = Template(tpl["subject"]).render(**ctx)
    body_html = Template(tpl["body"]).render(**ctx)
    html = _LAYOUT.render(heading=tpl["heading"], body_html=body_html, **ctx)
    return subject, html
