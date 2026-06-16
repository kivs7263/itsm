# ADR-042: 외부 알림 채널 추상화

- **상태**: 승인
- **결정일**: 2026-06-16
- **결정자**: 제품팀 + 아키텍처팀

---

## 컨텍스트

티켓 생성/이관/해결 등 6개 이벤트 시점에 고객에게 외부 알림(이메일, 향후 SMS/카카오)을 발송해야 한다. 발송 실패 시 재시도가 필요하고, 발송 이력을 감사 목적으로 보존해야 한다.

**검토한 발송 방식**:
1. ITSM 백엔드 직접 발송 (aiosmtplib)
2. 기존 `mail-service` 재사용 (GW 메일 서비스)
3. 신규 `notification-service` 컨테이너 분리

**검토한 재시도 방식**:
1. Redis ZSET 기반 재시도 큐 (기존 SLA 워커 루프 활용)
2. Celery/ARQ 워커 신규 도입
3. DB 폴링 (cron)

## 결정

### 발송: ITSM 백엔드 직접 발송

`app/services/external_notif_service.py` 신규 모듈, `aiosmtplib` + `Jinja2` 템플릿.

**`mail-service` 기각 이유**:

| 항목 | mail-service | ITSM 직접 발송 |
|---|---|---|
| 인증 방식 | GW KC org JWT (`X-Tenant-Org-Id`) | ITSM 내부 서비스 호출 |
| 테넌트 모델 | GW 전용 (gw_tenant_id 기반) | ITSM tenant_id 기반 |
| 추가 컨테이너 | 불필요 (이미 있음) | 불필요 |
| 적합성 | ❌ 인증 구조 불일치 | ✅ |

**신규 컨테이너 기각 이유**: 현 트래픽 규모에서 과잉 설계. 분당 수십 건 이하의 외부 알림에 별도 컨테이너 운영 비용 불필요.

### 재시도: Redis ZSET 기반, 기존 SLA 워커 통합

```
키: itsm:ext_notif:retry
값: notification_log_id  /  score: next_retry_at(unix timestamp)
```

기존 `itsm_sla_worker`의 루프에 `ext_notif_retry_tick()` 추가. 신규 워커 컨테이너 없음.

**재시도 전략**:
- 0회차: 즉시 발송
- 1회차 실패: 2분 후
- 2회차 실패: 10분 후
- 3회차 실패: `status='failed'` + 내부 Slack 알림 (기존 채널)

### 채널 추상화: `BaseNotifChannel` 인터페이스

```python
class BaseNotifChannel(ABC):
    @abstractmethod
    async def send(self, recipient: str, subject: str, body: str, **kwargs) -> str:
        """외부 메시지 ID 반환"""
```

MVP: `EmailChannel` (aiosmtplib). Phase 2: `KakaoChannel`, `SmsChannel`.

### 이력: `external_notification_logs` 신규 테이블

기존 `notification_logs`는 내부(Slack/Teams) 전용이라 `email` 채널이 없음. 별도 테이블로 분리.

```
id, tenant_id, ticket_id(soft ref), escalation_id(soft ref),
channel(enum), event_type, recipient,
status(pending/sent/failed/retrying),
payload(JSONB), provider_ref, error_msg,
retry_count, next_retry_at, sent_at, created_at
```

**`ticket_id` soft ref** (FK 없음): 티켓 삭제 후에도 발송 이력 보존.

### 멱등성 키

`(ticket_id, event_type, channel)` 조합으로 동일 이벤트 중복 발송 방지. 에스컬레이션처럼 동일 이벤트가 반복될 수 있는 경우 `escalation_id`까지 포함.

### SMTP 설정: 테넌트별 `tenant_notification_configs`

기존 테이블에 컬럼 추가:

```
smtp_host, smtp_port(default 587), smtp_user,
smtp_password_enc(AES-256), smtp_from_email, smtp_from_name
```

비밀번호는 AES-256 암호화 후 저장, 복호화 키 = `ITSM_ENCRYPTION_KEY` 환경변수.

## 대안

| 대안 | 기각 이유 |
|---|---|
| Celery 도입 | 브로커(RabbitMQ 등) 추가 의존성, 현 규모 과잉 |
| DB 폴링 cron | 초 단위 재시도 어려움, DB 부하 |
| 카카오 알림톡 MVP 포함 | 템플릿 사전 심사 5~10영업일, 이메일 선 출시 후 Phase 2에서 추가 |

## 결과

- Migration 027: `external_notification_logs` 생성
- Migration 028: `tenant_notification_configs` SMTP/카카오 컬럼 추가
- `app/services/external_notif_service.py`: 채널 추상화 + EmailChannel 구현
- `itsm_sla_worker`: `ext_notif_retry_tick()` 통합
- Prometheus alert: `ExternalNotifyFailRate` (3회 연속 실패 시 알림)

## 이벤트 → 발송 매핑

| event_type | 발송 시점 | 수신자 |
|---|---|---|
| `ticket_created` | 티켓 생성 직후 | 티켓 고객 연락처 |
| `ticket_assigned` | 담당자 최초 배정 시 | 동일 |
| `ticket_escalated` | 에스컬레이션 확정 시 | 동일 |
| `comment_added` | `is_internal=False` 코멘트 작성 시 | 동일 |
| `ticket_resolved` | 상태 → resolved | 동일 |
| `sla_warning` | SLA 80% 도달 시 | 동일 |
