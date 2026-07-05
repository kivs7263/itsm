/**
 * sidebarPins.ts — 사이드바 즐겨찾기(pin) API (ITSM-SIDEBAR-P1)
 *
 * GET /api/{tenantSlug}/sidebar/pins
 *   → { pinned_keys: string[] }  (NavItem.key — 사이드바 안정 key, href 아님)
 *
 * PUT /api/{tenantSlug}/sidebar/pins
 *   body: { pinned_keys: string[] }
 *   → upsert, 저장된 pinned_keys 반환
 *
 * SA Workspace lib/api/sidebarPins.ts 패턴 그대로 미러링.
 */

import { api } from '@/lib/api'

export interface SidebarPinsData {
  pinned_keys: string[]
}

export async function fetchSidebarPins(tenantSlug: string): Promise<SidebarPinsData> {
  const res = await api.get<SidebarPinsData>(`/${tenantSlug}/sidebar/pins`)
  return res.data
}

export async function saveSidebarPins(
  tenantSlug: string,
  data: SidebarPinsData,
): Promise<SidebarPinsData> {
  const res = await api.put<SidebarPinsData>(`/${tenantSlug}/sidebar/pins`, data)
  return res.data
}
