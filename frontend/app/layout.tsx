import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { Toaster } from 'sonner';
import { Providers } from '@/components/providers';
import '@/app/globals.css';

/**
 * Pretendard 폰트 — 로컬 파일 사용 (외부 네트워크 의존성 없음)
 *
 * 폰트 파일 위치: public/fonts/PretendardVariable.woff2
 * GW에서 복사: /teamwork/groupware/frontend/public/fonts/PretendardVariable.woff2
 * (실제 파일 없이도 선언만으로 빌드 가능. 파일 없으면 fallback 폰트 사용)
 */
const pretendard = localFont({
  src: '../public/fonts/PretendardVariable.woff2',
  variable: '--font-pretendard',
  display: 'swap',
  weight: '100 900',
  preload: true,
});

export const metadata: Metadata = {
  title: {
    template: '%s | ITSM',
    default: 'ITSM — IT 서비스 관리',
  },
  description: 'IT 서비스 관리 시스템. 티켓, 자산, SLA, 고객 포털을 통합 관리.',
  applicationName: 'ITSM',
  authors: [{ name: 'ITSM' }],
  robots: { index: false, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#129B8E',
};

interface RootLayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className={`${pretendard.variable} font-sans antialiased`}>
        <Providers>
          {children}
          <Toaster richColors position="top-right" />
        </Providers>
      </body>
    </html>
  );
}
