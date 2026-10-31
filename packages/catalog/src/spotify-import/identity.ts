// Fixed for this app. Changing it would give every imported row a new identity.
const PROVISIONAL_NAMESPACE = 'c1f0a3de-7a54-4f26-9d0e-3b1f6e2a8c47';

const uuidBytes = (uuid: string): Uint8Array => Uint8Array.from(uuid.replaceAll('-', '').match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));

/** RFC 9562 UUIDv5. Web Crypto, so it runs in both Electron main and the renderer. */
export async function uuidV5(namespace: string, name: string): Promise<string> {
  const prefix = uuidBytes(namespace);
  const suffix = new TextEncoder().encode(name);
  const input = new Uint8Array(prefix.length + suffix.length);
  input.set(prefix);
  input.set(suffix, prefix.length);

  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', input)).slice(0, 16);
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A stable app-owned ID for a recording that has not been matched yet. The same
 * Spotify track always maps to the same ID, so duplicates stay recognizable and a
 * later catalog pass can replace it. It is not a canonical recording identity.
 */
export const provisionalTrackId = (spotifyUri: string): Promise<string> => uuidV5(PROVISIONAL_NAMESPACE, spotifyUri);
