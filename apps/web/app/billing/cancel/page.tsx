import Link from 'next/link';
import { AuthCard } from '@/components/auth/auth-card';

export default function BillingCancelPage() {
  return (
    <AuthCard
      title="No charge was made"
      body={
        <>
          <p className="muted t-sm">Checkout was cancelled before payment.</p>
          <div className="row gap-2">
            <Link className="btn primary" href="/pricing">
              See plans
            </Link>
            <Link className="btn" href="/billing">
              Go to billing
            </Link>
          </div>
        </>
      }
    />
  );
}
