import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthCard } from './AuthCard';
import * as rbac from '@/services/rbac.service';
import type { InvitePreview } from '@/types';

/**
 * Invitation acceptance. Two shapes behind one screen:
 *   - no account yet → collect a name and password, which creates it;
 *   - account exists → nothing to collect, just confirm and sign in.
 *
 * The backend decides which, via `hasAccount` on the preview — the client must
 * not guess, or an existing user would be shown a password field that would
 * silently do nothing.
 */
export function AcceptInvite() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';

  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ fullName: '', password: '' });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('This link is missing its invitation token.');
      setLoading(false);
      return;
    }
    rbac
      .previewInvite(token)
      .then(setInvite)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'This invitation is not valid')
      )
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await rbac.acceptInvite({
        token,
        ...(invite && !invite.hasAccount
          ? { fullName: form.fullName.trim(), password: form.password }
          : {}),
      });
      setDone(true);
      // Straight to login rather than auto-signing them in: acceptance is not
      // authentication, and minting a session here would be a second token
      // path to keep correct.
      setTimeout(() => navigate('/login', { replace: true }), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept the invitation');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <AuthCard title="Invitation" description="Checking your invitation…">
        <p className="text-sm text-muted-foreground">One moment…</p>
      </AuthCard>
    );
  }

  if (error && !invite) {
    return (
      <AuthCard title="Invitation" description="We couldn't open this invitation">
        <p className="text-sm text-destructive">{error}</p>
        <p className="mt-4 text-sm text-muted-foreground">
          Invitations expire after 72 hours. Ask whoever invited you to send a new one.
        </p>
        <Link to="/login" className="mt-4 inline-block text-sm underline">
          Back to sign in
        </Link>
      </AuthCard>
    );
  }

  if (done) {
    return (
      <AuthCard title="You're in" description={`You've joined ${invite?.companyName}`}>
        <p className="text-sm text-muted-foreground">
          Taking you to the sign-in page…
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={`Join ${invite?.companyName}`}
      description={`You've been invited as a ${invite?.roleName}.`}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="invite-email">Email</Label>
          {/* Fixed: the invite is bound to this address, so it is not editable. */}
          <Input id="invite-email" value={invite?.email ?? ''} disabled readOnly />
        </div>

        {invite && !invite.hasAccount && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="invite-name">Full name</Label>
              <Input
                id="invite-name"
                required
                minLength={2}
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-password">Choose a password</Label>
              <Input
                id="invite-password"
                type="password"
                required
                minLength={8}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">At least 8 characters.</p>
            </div>
          </>
        )}

        {invite?.hasAccount && (
          <p className="text-sm text-muted-foreground">
            You already have a Khatavala account. Accept the invitation, then sign in
            as usual.
          </p>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Joining…' : 'Accept invitation'}
        </Button>
      </form>
    </AuthCard>
  );
}
