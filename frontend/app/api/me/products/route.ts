/**
 * GET /api/me/products — SSO Portal /api/me/products 프록시
 *
 * SSO Portal 세션 쿠키(admin-portal-session)는 SSO Portal 도메인에만 설정되므로
 * 클라이언트에서 직접 cross-origin fetch 불가.
 * 이 route가 서버사이드에서 쿠키를 포함해 SSO Portal에 요청하는 proxy 역할.
 *
 * 응답: [{ slug, name, subscribed, isRequired }]
 * 실패 시: 200 + [] (fallback — 클라이언트가 하드코딩 목록으로 대체)
 */

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'

const SSO_PORTAL_INTERNAL = process.env.SSO_PORTAL_INTERNAL_URL || 'http://sso-admin-portal:3000'

export interface ProductEntry {
  slug: string
  name: string
  subscribed: boolean
  isRequired: boolean
}

export async function GET(_req: NextRequest) {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('admin-portal-session')

  if (!sessionCookie?.value) {
    return NextResponse.json([] as ProductEntry[], { status: 200 })
  }

  try {
    const res = await fetch(`${SSO_PORTAL_INTERNAL}/api/me/products`, {
      headers: {
        Cookie: `admin-portal-session=${sessionCookie.value}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      return NextResponse.json([] as ProductEntry[], { status: 200 })
    }

    const data = (await res.json()) as ProductEntry[]
    return NextResponse.json(data, { status: 200 })
  } catch {
    return NextResponse.json([] as ProductEntry[], { status: 200 })
  }
}
