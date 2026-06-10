import { NextRequest, NextResponse } from 'next/server';

/**
 * middleware.ts — 테넌트 slug 감지 및 itsm.last.tenant 쿠키 저장
 *
 * Next.js 미들웨어에서 slug를 추출하여 쿠키에 저장.
 * 이 쿠키를 RootPage와 Sidebar 등에서 fallback으로 사용.
 *
 * 주의: 포털 경로 (/portal/...) 는 slug 처리 제외 — 별도 쿠키 사용
 */

// API, Next.js 내부, 정적 파일 등 slug로 오인하면 안 되는 경로 세그먼트
const RESERVED = new Set([
  'api',
  '_next',
  'health',
  'auth',
  'login',
  'portal',    // 고객 포털 — slug 처리 제외
  'static',
  'assets',
  'favicon',
  'robots',
  'icons',
  'fonts',
  'images',
  'sw.js',
]);

// 유효한 slug 패턴: 소문자·숫자 시작, 3~30자, 하이픈 허용
const SLUG_REGEX = /^\/([a-z0-9][a-z0-9-]{2,29})(\/.*)?$/;

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 포털 경로는 slug 처리 완전 제외
  if (pathname.startsWith('/portal/')) {
    return NextResponse.next();
  }

  const match = SLUG_REGEX.exec(pathname);
  if (!match) return NextResponse.next();

  const slug = match[1];
  if (RESERVED.has(slug)) return NextResponse.next();

  // slug 감지 → itsm.last.tenant 쿠키 갱신
  const cookieDomain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN || undefined;
  const response = NextResponse.next();
  response.cookies.set('itsm.last.tenant', slug, {
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30일
    sameSite: 'lax',
    httpOnly: false, // 클라이언트 JS에서 읽기 위해 false
    secure: true,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/|icons/|fonts/|sw\\.js).*)'],
};
