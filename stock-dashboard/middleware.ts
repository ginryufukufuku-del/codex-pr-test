import { NextRequest, NextResponse } from "next/server";

// APP_PASSWORD 設定時のみ BASIC認証 (個人利用のため外部公開時の最低限の保護)
export function middleware(req: NextRequest) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return NextResponse.next();
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    const [, pass] = atob(auth.slice(6)).split(/:(.*)/s);
    if (pass === pw) return NextResponse.next();
  }
  return new NextResponse("Auth required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="stock-dashboard"' },
  });
}
