import { useEffect, useState } from 'react';
import type { AccountState, CloudBridge } from '@fyspoti/contracts';
import { useDialogFocus } from './useDialogFocus';
import './account-dialog.css';

export function AccountDialog({ bridge, account, close }: { bridge: CloudBridge; account: AccountState; close(): void }) {
  const dialogRef = useDialogFocus(true);
  const [email, setEmail] = useState(account.pendingEmail ?? '');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [clock, setClock] = useState(Date.now());
  useEffect(() => { const interval = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(interval); }, []);
  useEffect(() => { if (account.phase === 'authenticated') close(); }, [account.phase]);
  const awaiting = account.phase === 'awaiting-code' || account.phase === 'verifying';
  const busy = ['sending-code', 'verifying', 'restoring'].includes(account.phase);
  const remaining = Math.max(0, Math.ceil((account.resendAt - clock) / 1000));
  async function request() { setMessage(''); const result = await bridge.requestEmailCode(email); if (!result.ok) setMessage(result.error.message); }
  async function verify() { setMessage(''); const result = await bridge.verifyEmailCode(account.pendingEmail ?? email, code); if (!result.ok) setMessage(result.error.message); }
  return <div className="overlay"><section ref={dialogRef} className="dialog cloud-auth" role="dialog" aria-modal="true" aria-label="Sign in to Fyspoti" onKeyDown={event => { if (event.key === 'Escape' && !busy) close(); }}>
    <div className="panel-title"><h2>Sign in to Fyspoti</h2><button aria-label="Close sign in" onClick={close} disabled={busy}>×</button></div>
    <p>Use an email code to create or access your account. Prototype playlists stay separate.</p>
    <form onSubmit={event => { event.preventDefault(); void (awaiting ? verify() : request()); }}>
      <label>Email address<input autoFocus type="email" autoComplete="email" aria-label="Email address" required value={email} onChange={event => setEmail(event.target.value)} disabled={awaiting || busy}/></label>
      {awaiting && <label>Email code<input autoFocus aria-label="Email code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))}/></label>}
      {awaiting && <p role="status">Check {account.pendingEmail} for your six-digit code.</p>}
      {(message || account.error) && <p role="alert">{message || account.error?.message}</p>}
      <button className="save" type="submit" disabled={busy || (!awaiting && remaining > 0)}>{busy ? 'Please wait…' : awaiting ? 'Verify code' : remaining > 0 ? `Resend in ${remaining}s` : 'Send email code'}</button>
    </form>
    {awaiting && <div className="cloud-dialog-actions"><button disabled={busy || remaining > 0} onClick={request}>{remaining > 0 ? `Resend in ${remaining}s` : 'Resend code'}</button><button disabled={busy} onClick={async () => { await bridge.cancelEmailCode(); setCode(''); setMessage(''); }}>Use another email</button></div>}
    {account.error?.code === 'UNAVAILABLE' && <button onClick={() => bridge.retryRestore()}>Retry connection</button>}
  </section></div>;
}
