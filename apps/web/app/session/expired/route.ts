import { NextRequest, NextResponse } from 'next/server';
import { clearServerSession, safeNextPath } from '@/lib/session';

export async function GET(request: NextRequest) {
  await clearServerSession();
  const target = new URL('/login', request.url);
  target.searchParams.set('reason', request.nextUrl.searchParams.get('reason') === 'membership' ? 'membership' : 'expired');
  const next = safeNextPath(request.nextUrl.searchParams.get('next'));
  if (next) target.searchParams.set('next', next);
  return NextResponse.redirect(target);
}
