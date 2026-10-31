import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { DesktopSchemas, type AccountState, type AppError, type DesktopState, type LibraryAction, type MutationContext, type Profile, type Result } from '@fyspoti/contracts';
import { createLibraryApi, LibraryController, preparePlaylistQueue, type Database } from '@fyspoti/library';
import { SessionVault, type AuthStorage } from './vault.js';

export function accountFailure(error: unknown, codeAttempt = false): AppError {
  const source = error as { code?: string; status?: number } | null;
  if (source?.status === 429 || source?.code?.includes('rate_limit')) return { code: 'RATE_LIMITED', message: 'Please wait before requesting another code.', retryable: true, retryAfterMs: 60000 };
  if (source?.code === 'PT409') return { code: 'CONFLICT', message: 'The profile changed. Review the refreshed name before retrying.', retryable: false };
  if (source?.code === 'PT400' || source?.code === '22P02') return { code: 'INVALID_ARGUMENT', message: 'Check the supplied details.', retryable: false };
  if (source?.status === 401 || source?.status === 403 || source?.code === 'PT401' || source?.code === 'refresh_token_not_found'
    || source?.code === 'refresh_token_already_used' || source?.code === 'session_not_found' || source?.code === 'otp_expired'
    || (codeAttempt && source?.status === 400)) return { code: 'AUTH_REQUIRED', message: codeAttempt ? 'The code is incorrect or expired. Request a new code.' : 'Sign in again to continue.', retryable: false };
  return { code: 'UNAVAILABLE', message: 'The account service is unavailable. Please retry.', retryable: true };
}
const invalid = (message: string): Result<never> => ({ ok: false, error: { code: 'INVALID_ARGUMENT', message, retryable: false } });
const initial = (): AccountState => ({ phase: 'signed-out', userId: null, email: null, pendingEmail: null, resendAt: 0, persistent: false, storageNotice: null, error: null });

export interface AccountOptions {
  url: string;
  publishableKey: string;
  vault: SessionVault;
  now?: () => number;
  makeClient?: (storage: AuthStorage) => SupabaseClient<Database>;
}

export class AccountService {
  readonly library: LibraryController;
  private client!: SupabaseClient<Database>;
  private subscription: { unsubscribe(): void } | null = null;
  private epoch = 0;
  private auth = initial();
  private profile: Profile | null = null;
  private readonly listeners = new Set<(state: DesktopState) => void>();
  private readonly requests = new Map<string, number>();
  private readonly now: () => number;
  private disposed = false;
  private version = 0;
  private resetting = false;
  private accessToken: string | null = null;
  constructor(private readonly options: AccountOptions) {
    // Reuse the public-client key guard before enabling session persistence.
    if (!options.publishableKey || options.publishableKey.startsWith('sb_secret_')) throw new Error('Configure a publishable key only.');
    if (options.publishableKey.split('.').length === 3) {
      const payload = JSON.parse(Buffer.from(options.publishableKey.split('.')[1]!, 'base64url').toString()) as { role?: string };
      if (payload.role !== 'anon') throw new Error('Configure a publishable or local anon key only.');
    }
    this.now = options.now ?? Date.now;
    this.library = new LibraryController(accountId => createLibraryApi(this.client, { accountId }));
    this.library.subscribe(() => this.emit());
  }
  snapshot(): DesktopState {
    return structuredClone({ version: this.version, account: { ...this.auth, persistent: this.options.vault.persistent, storageNotice: this.options.vault.notice }, profile: this.profile, library: this.library.snapshot() });
  }
  subscribe(listener: (state: DesktopState) => void): () => void { this.listeners.add(listener); listener(this.snapshot()); return () => { this.listeners.delete(listener); }; }
  private emit(): void { this.version++; for (const listener of this.listeners) listener(this.snapshot()); }
  private setAuth(patch: Partial<AccountState>): void { this.auth = { ...this.auth, ...patch }; this.emit(); }
  private detachClient(): void {
    this.subscription?.unsubscribe(); this.subscription = null;
    this.client?.auth.stopAutoRefresh();
  }
  private newClient(): void {
    const epoch = this.epoch;
    this.client = this.options.makeClient?.(this.options.vault.storage()) ?? createClient<Database>(this.options.url, this.options.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage: this.options.vault.storage() },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) }) },
    });
    const active = this.client;
    this.subscription = active.auth.onAuthStateChange((event, session) => {
      if (epoch !== this.epoch || this.disposed) return;
      if (session) this.accessToken = session.access_token;
      if (event === 'SIGNED_OUT') this.accessToken = null;
      // Never issue nested SDK auth calls inside its event callback.
      if (event === 'SIGNED_OUT' && this.auth.userId) {
        this.epoch++;
        this.profile = null; this.library.setAccount(null);
        this.setAuth({ ...initial(), phase: 'reauth-required' });
        void this.options.vault.clear().catch(() => { this.options.vault.notice = 'Saved sign-in could not be removed. Close the app and retry.'; this.emit(); });
      }
      if (event === 'TOKEN_REFRESHED' && session && this.auth.phase === 'authenticated') this.emit();
    }).data.subscription;
  }
  async initialize(): Promise<void> {
    await this.options.vault.initialize(); this.newClient(); await this.restore();
  }
  async restore(): Promise<Result<AccountState>> {
    if (this.resetting || ['sending-code', 'verifying'].includes(this.auth.phase)) return { ok: false, error: { code: 'CONFLICT', message: 'Finish the current account action first.', retryable: false } };
    const epoch = this.epoch; const client = this.client;
    this.setAuth({ phase: 'restoring', error: null });
    try {
      const session = await client.auth.getSession();
      if (session.error) throw session.error;
      if (epoch !== this.epoch) return this.stale();
      if (!session.data.session) { this.setAuth(initial()); return { ok: true, value: this.snapshot().account }; }
      await this.accept(client, epoch, session.data.session);
      return { ok: true, value: this.snapshot().account };
    } catch (error) { return this.authError(error, epoch); }
  }
  private async accept(client: SupabaseClient<Database>, epoch: number, _session: Session): Promise<void> {
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) throw error ?? { status: 401 };
    const result = await client.rpc('profile_mutate', { mutation_id: crypto.randomUUID(), expected_account: data.user.id, expected_revision: 0, display_name: 'Listener' }).retry(false);
    if (result.error) throw { ...result.error, status: result.status };
    if (epoch !== this.epoch || this.disposed) throw { status: 401 };
    this.profile = result.data as unknown as Profile;
    this.setAuth({ phase: 'authenticated', userId: data.user.id, email: data.user.email ?? null, pendingEmail: null, resendAt: 0, error: null });
    this.library.setAccount(data.user.id);
    await this.library.load();
  }
  private stale(): Result<never> { return { ok: false, error: { code: 'AUTH_REQUIRED', message: 'The account changed. Try again.', retryable: false } }; }
  private authError(error: unknown, epoch: number, codeAttempt = false): Result<never> {
    if (epoch !== this.epoch) return this.stale();
    const failure = accountFailure(error, codeAttempt);
    this.profile = null; this.library.setAccount(null);
    if (!codeAttempt && failure.code === 'AUTH_REQUIRED') {
      this.epoch++;
      this.accessToken = null;
      this.client.auth.stopAutoRefresh();
      void this.options.vault.clear().catch(() => { this.options.vault.notice = 'Saved sign-in could not be removed. Close the app and retry.'; this.emit(); });
    }
    this.setAuth({ userId: null, email: null, phase: codeAttempt ? 'awaiting-code' : failure.code === 'AUTH_REQUIRED' ? 'reauth-required' : 'unavailable', error: failure });
    return { ok: false, error: failure };
  }
  async requestEmailCode(email: string): Promise<Result<AccountState>> {
    const parsed = DesktopSchemas.email.safeParse(email);
    if (!parsed.success) return invalid('Enter a valid email address.');
    if (this.resetting || ['sending-code', 'verifying', 'restoring', 'authenticated'].includes(this.auth.phase)) return { ok: false, error: { code: 'CONFLICT', message: 'Finish the current account action first.', retryable: false } };
    const resendAt = this.requests.get(parsed.data) ?? 0;
    if (resendAt > this.now()) return { ok: false, error: { code: 'RATE_LIMITED', message: 'Please wait before requesting another code.', retryable: true, retryAfterMs: resendAt - this.now() } };
    this.detachClient(); this.accessToken = null; const epoch = ++this.epoch;
    this.setAuth({ ...initial(), phase: 'sending-code', pendingEmail: parsed.data });
    try {
      await this.options.vault.clear();
      if (epoch !== this.epoch) return this.stale();
      this.newClient();
      const { error } = await this.client.auth.signInWithOtp({ email: parsed.data, options: { shouldCreateUser: true } });
      if (error) throw error;
      if (epoch !== this.epoch) return this.stale();
      const next = this.now() + 60000; this.requests.set(parsed.data, next);
      this.setAuth({ phase: 'awaiting-code', resendAt: next, error: null });
      return { ok: true, value: this.snapshot().account };
    } catch (error) {
      const result = this.authError(error, epoch);
      if (!result.ok && result.error.code === 'RATE_LIMITED' && epoch === this.epoch) {
        const next = this.now() + 60000; this.requests.set(parsed.data, next); this.setAuth({ resendAt: next });
      }
      return result;
    }
  }
  async verifyEmailCode(email: string, code: string): Promise<Result<AccountState>> {
    const parsed = DesktopSchemas.verify.safeParse({ email, code });
    if (!parsed.success) return invalid('Enter the six-digit email code.');
    if (this.auth.phase !== 'awaiting-code' || parsed.data.email !== this.auth.pendingEmail) return invalid('Request a code for this email first.');
    const epoch = this.epoch; const client = this.client;
    this.setAuth({ phase: 'verifying', error: null });
    try {
      const { data, error } = await client.auth.verifyOtp({ email: parsed.data.email, token: parsed.data.code, type: 'email' });
      if (error || !data.session) throw error ?? { status: 401 };
      if (epoch !== this.epoch) return this.stale();
      await this.accept(client, epoch, data.session);
      return { ok: true, value: this.snapshot().account };
    } catch (error) { return this.authError(error, epoch, true); }
  }
  async signOut(): Promise<Result<AccountState>> {
    if (this.resetting) return { ok: true, value: this.snapshot().account };
    this.resetting = true;
    const previous = this.client;
    const accessToken = this.accessToken; this.accessToken = null;
    this.detachClient(); this.epoch++;
    this.profile = null; this.library.setAccount(null); this.setAuth(initial());
    try { await this.options.vault.clear(); }
    catch { this.options.vault.notice = 'Saved sign-in could not be removed. Close the app and retry.'; }
    this.newClient();
    this.resetting = false;
    const epoch = this.epoch;
    try {
      // The SDK's own signOut delegates to this user-JWT endpoint. Capture the
      // token before retiring storage so revocation does not lose its session.
      // This uses the ordinary publishable client, never privileged credentials.
      const { error } = accessToken ? await previous.auth.admin.signOut(accessToken, 'local') : { error: null };
      if (error && epoch === this.epoch) this.setAuth({ error: { code: 'UNAVAILABLE', message: 'Signed out on this device. Server session termination could not be confirmed.', retryable: true } });
    } catch {
      if (epoch === this.epoch) this.setAuth({ error: { code: 'UNAVAILABLE', message: 'Signed out on this device. Server session termination could not be confirmed.', retryable: true } });
    }
    return { ok: true, value: this.snapshot().account };
  }
  async cancelEmailCode(): Promise<Result<AccountState>> { return this.signOut(); }
  async updateDisplayName(displayName: string, context: MutationContext): Promise<Result<Profile>> {
    const parsed = DesktopSchemas.profile.safeParse({ displayName, context });
    if (!parsed.success) return invalid('Display name must contain 1–80 characters.');
    const owner = this.auth.userId; const epoch = this.epoch;
    if (!owner || this.auth.phase !== 'authenticated') return this.stale();
    try {
      const { data, error, status } = await this.client.rpc('profile_mutate', { mutation_id: context.mutationId, expected_account: owner, expected_revision: context.expectedRevision, display_name: parsed.data.displayName }).retry(false);
      if (error) {
        if (error.code === 'PT409') {
          const fresh = await this.client.from('profiles').select('*').eq('id', owner).single().retry(false);
          if (fresh.data && epoch === this.epoch) { this.profile = { id: fresh.data.id, displayName: fresh.data.display_name, revision: fresh.data.revision }; this.emit(); }
        }
        throw { ...error, status };
      }
      if (epoch !== this.epoch) return this.stale();
      this.profile = data as unknown as Profile; this.emit(); return { ok: true, value: this.profile };
    } catch (error) { return { ok: false, error: accountFailure(error) }; }
  }
  async load(playlistId?: string): Promise<Result<void>> {
    if (this.auth.phase !== 'authenticated') return this.stale();
    const epoch = this.epoch; await this.library.load(playlistId);
    if (epoch !== this.epoch) return this.stale();
    const state = this.library.snapshot(); return state.error ? { ok: false, error: state.error } : { ok: true, value: undefined };
  }
  async loadMore(kind: 'playlists' | 'likes' | 'items'): Promise<Result<void>> {
    if (this.auth.phase !== 'authenticated') return this.stale();
    const epoch = this.epoch; await this.library.loadMore(kind);
    if (epoch !== this.epoch) return this.stale();
    const state = this.library.snapshot(); return state.error ? { ok: false, error: state.error } : { ok: true, value: undefined };
  }
  async run(action: LibraryAction): Promise<Result<unknown>> { return this.auth.phase === 'authenticated' ? this.library.run(action) : this.stale(); }
  async retryConflict(): Promise<Result<unknown>> { return this.auth.phase === 'authenticated' ? this.library.retryConflict() : this.stale(); }
  async retryUncertain(): Promise<Result<unknown>> { return this.auth.phase === 'authenticated' ? this.library.retryUncertain() : this.stale(); }
  async prepareQueue(id: string) {
    if (this.auth.phase !== 'authenticated' || !this.auth.userId) return this.stale();
    const epoch = this.epoch;
    const response = await preparePlaylistQueue(createLibraryApi(this.client, { accountId: this.auth.userId }), id);
    return epoch === this.epoch ? response : this.stale();
  }
  async getTrackLike(trackId: string) {
    if (this.auth.phase !== 'authenticated' || !this.auth.userId) return this.stale();
    const epoch = this.epoch;
    const response = await createLibraryApi(this.client, { accountId: this.auth.userId }).getTrackLike(trackId);
    return epoch === this.epoch ? response : this.stale();
  }
  async close(): Promise<void> { this.disposed = true; this.epoch++; this.accessToken = null; this.detachClient(); this.library.setAccount(null); await this.options.vault.flush(); this.listeners.clear(); }
}
