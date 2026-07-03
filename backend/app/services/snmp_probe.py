"""SNMP 프로브 서비스 (RA-C10-A).

지원 OID:
  sysName    1.3.6.1.2.1.1.5.0
  sysDescr   1.3.6.1.2.1.1.1.0
  sysUpTime  1.3.6.1.2.1.1.3.0

라이브러리: pysnmp-lextudio 6.x (requirements.txt 등재).
graceful: 라이브러리 import 실패·대상 도달 불가·타임아웃 모두 예외를 잡아
  SnmpProbeResult.error 에 기록하고 반환. 앱은 절대 죽지 않음.

⚠️ 네트워크 의존 경고:
  실제 SNMP 응답을 얻으려면 대상 호스트가 UDP 161 포트에서
  SNMP v2c Community Public(또는 커스텀) 응답해야 한다.
  컨테이너 환경 내부에 실제 SNMP 에이전트가 없으면 timeout/error 반환이 정상.
  run status=failed + errors 기록으로 graceful 처리됨.
"""
from __future__ import annotations

import asyncio
import ipaddress
import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

# OID 상수
_OID_SYS_DESCR = "1.3.6.1.2.1.1.1.0"
_OID_SYS_UPTIME = "1.3.6.1.2.1.1.3.0"
_OID_SYS_NAME = "1.3.6.1.2.1.1.5.0"

# pysnmp-lextudio 동적 임포트 (없을 경우 graceful degradation)
try:
    from pysnmp.hlapi.asyncio import (  # type: ignore
        CommunityData,
        ContextData,
        ObjectIdentity,
        ObjectType,
        SnmpEngine,
        UdpTransportTarget,
        getCmd,
    )
    _PYSNMP_AVAILABLE = True
except ImportError:
    _PYSNMP_AVAILABLE = False
    logger.warning(
        "pysnmp-lextudio not available; SNMP discovery will return error. "
        "Install: pip install pysnmp-lextudio"
    )


@dataclass
class SnmpProbeResult:
    host: str
    success: bool = False
    sys_name: str | None = None
    sys_descr: str | None = None
    sys_uptime_ticks: int | None = None
    error: str | None = None


async def probe_host(
    host: str,
    community: str = "public",
    port: int = 161,
    timeout: float = 3.0,
    retries: int = 1,
) -> SnmpProbeResult:
    """단일 호스트 SNMP GET — sysName/sysDescr/sysUpTime.

    네트워크 도달 불가·타임아웃·라이브러리 미설치 모두 graceful error 반환.
    """
    if not _PYSNMP_AVAILABLE:
        return SnmpProbeResult(
            host=host,
            success=False,
            error="pysnmp-lextudio 라이브러리 미설치. pip install pysnmp-lextudio",
        )

    try:
        engine = SnmpEngine()
        # pysnmp-lextudio 6.x: UdpTransportTarget은 일반 생성자 (비동기 아님)
        transport = UdpTransportTarget(
            (host, port),
            timeout=timeout,
            retries=retries,
        )
        error_indication, error_status, error_index, var_binds = await getCmd(
            engine,
            CommunityData(community, mpModel=1),  # SNMPv2c
            transport,
            ContextData(),
            ObjectType(ObjectIdentity(_OID_SYS_NAME)),
            ObjectType(ObjectIdentity(_OID_SYS_DESCR)),
            ObjectType(ObjectIdentity(_OID_SYS_UPTIME)),
        )

        if error_indication:
            return SnmpProbeResult(
                host=host,
                success=False,
                error=f"SNMP 오류: {error_indication}",
            )
        if error_status:
            return SnmpProbeResult(
                host=host,
                success=False,
                error=f"SNMP 상태 오류: {error_status.prettyPrint()} at {error_index}",
            )

        result = SnmpProbeResult(host=host, success=True)
        for var_bind in var_binds:
            oid_str = str(var_bind[0])
            val = str(var_bind[1])
            if _OID_SYS_NAME in oid_str:
                result.sys_name = val.strip()
            elif _OID_SYS_DESCR in oid_str:
                result.sys_descr = val.strip()[:1000]
            elif _OID_SYS_UPTIME in oid_str:
                try:
                    result.sys_uptime_ticks = int(var_bind[1])
                except Exception:
                    pass
        return result

    except Exception as exc:
        return SnmpProbeResult(
            host=host,
            success=False,
            error=f"SNMP 프로브 실패: {exc!r}",
        )


def expand_targets(target: str) -> list[str]:
    """단일 호스트 또는 CIDR 범위를 개별 호스트 목록으로 변환.

    최대 254개(/24) 이상은 /24로 제한 — 디스커버리 남용 방지.
    """
    target = target.strip()
    try:
        network = ipaddress.ip_network(target, strict=False)
        if network.num_addresses > 256:
            raise ValueError(f"CIDR 범위가 너무 큼 ({network.num_addresses}개). /24 이하 사용.")
        # 네트워크/브로드캐스트 주소 제외
        hosts = [str(h) for h in network.hosts()]
        return hosts if hosts else [target]
    except ValueError:
        # CIDR 아님 → 단일 호스트
        return [target]


def map_to_ci_type(probe: SnmpProbeResult) -> str:
    """sysDescr 기반 CI 타입 추론 — 정확도보다 보수적 분류 우선."""
    if not probe.sys_descr:
        return "server"
    descr_lower = probe.sys_descr.lower()
    if any(k in descr_lower for k in ("router", "cisco ios", "juniper")):
        return "router_switch"
    if any(k in descr_lower for k in ("firewall", "asa", "fortigate", "paloalto")):
        return "firewall"
    if any(k in descr_lower for k in ("switch", "catalyst")):
        return "router_switch"
    if any(k in descr_lower for k in ("vmware", "esxi", "hypervisor", "xen", "kvm")):
        return "virtual_machine"
    if any(k in descr_lower for k in ("linux", "ubuntu", "centos", "debian", "red hat")):
        return "server"
    if any(k in descr_lower for k in ("windows", "microsoft")):
        return "server"
    return "server"
