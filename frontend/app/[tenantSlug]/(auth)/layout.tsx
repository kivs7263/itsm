/**
 * (auth)/layout.tsx — 인증 페이지 레이아웃
 * 로그인/크로스앱 등 인증 없이도 접근 가능한 페이지 공통 레이아웃
 */

interface AuthLayoutProps {
  children: React.ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-sm">
        {children}
      </div>
    </div>
  );
}
