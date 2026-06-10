# ADR-002: CrossApp iss 하드코딩 → 화이트리스트 전환

- **상태**: 승인
- **결정일**: 2026-06-10
- **결정자**: 백엔드팀

---

## 컨텍스트

SA `crossapp_auth.py`는 `iss != "gw"`, GW `crossapp_auth.py`는 `iss != "sa"` 방식으로 발급처를 하드코딩 검증했다. ITSM 추가 시 각 앱에 하드코딩 조건을 반복 추가하면 유지보수성이 떨어진다.

## 결정

`_ALLOWED_ISS = {"gw", "itsm"}` / `{"sa", "itsm"}` **집합 화이트리스트**로 전환한다.

```python
# SA crossapp_auth.py (redeem)
_ALLOWED_ISS = {"gw", "itsm"}
if iss not in _ALLOWED_ISS:
    raise HTTPException(...)

# GW crossapp_auth.py (redeem)
_ALLOWED_ISS = {"sa", "itsm"}
if iss not in _ALLOWED_ISS:
    raise HTTPException(...)
```

ITSM redeem 엔드포인트(Phase 1 구현 예정):
```python
_ALLOWED_ISS = {"sa", "gw"}
```

## 영향

| 파일 | 변경 |
|---|---|
| `sa-workspace/backend/app/routers/crossapp_auth.py` | `iss != "gw"` → `iss not in {"gw", "itsm"}` |
| `groupware/backend/app/routers/crossapp_auth.py` | `iss != "sa"` → `iss not in {"sa", "itsm"}` |
| `calendar-service/.../external.py` | `sources=["sa","gw"]` → `["sa","gw","itsm"]` |
| `calendar-service/.../calendar_service.py` | `_READONLY_SOURCES`, `delete_events_by_org` 소스 목록 확장 |

## 결과

ITSM CrossApp SSO 토큰이 SA/GW에서 정상 수락된다. 4번째 앱 추가 시 화이트리스트 1줄 수정만 필요.
