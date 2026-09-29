import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';

export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      navigate('/admin');
    } catch {
      setError('Incorrect password.');
      setBusy(false);
    }
  }

  return (
    <main className="dark bg-background grid min-h-dvh place-items-center p-5">
      <Card className="w-full max-w-sm p-7">
        <form onSubmit={submit}>
          <h1 className="text-lg font-semibold tracking-tight">Operations</h1>
          <p className="text-muted-foreground mt-0.5 mb-6 text-[13.5px]">
            Facility Issue Tracker
          </p>

          {error && (
            <div
              role="alert"
              className="border-destructive/30 bg-destructive/10 text-destructive mb-4 rounded-md border px-3.5 py-2.5 text-sm"
            >
              {error}
            </div>
          )}

          <Label htmlFor="password" className="text-muted-foreground mb-2 text-xs font-semibold tracking-[0.06em] uppercase">
            Password
          </Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            required
            autoComplete="current-password"
            className="mb-4"
          />
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </main>
  );
}
