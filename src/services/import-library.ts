import { LibraryError, type CloudBridge, type ImportLibraryRequest, type Library } from '@fyspoti/contracts';

const owners = new WeakMap<Library, string>();
export const importLibraryOwner = (library: Library) => owners.get(library);

/** The existing importer runs unchanged; tokens and authoritative ownership stay in main. */
export function createImportLibrary(bridge: CloudBridge, owner: string): Library {
  async function call<T>(request: ImportLibraryRequest): Promise<T> {
    const result = await bridge.importLibrary(request);
    if (!result.ok) throw new LibraryError(result.error.code === 'CANCELLED' ? 'UNAVAILABLE' : result.error.code, result.error.message, result.error.retryable);
    return result.value as T;
  }
  const library: Library = {
    createPlaylist: title => call({ operation: 'create', expectedAccountId: owner, title }),
    listPlaylists: cursor => call({ operation: 'playlists', expectedAccountId: owner, ...(cursor ? { cursor } : {}) }),
    getPlaylist: playlistId => call({ operation: 'playlist', expectedAccountId: owner, playlistId }),
    addPlaylistItem: (playlistId, item) => call({ operation: 'append', expectedAccountId: owner, playlistId, item }),
    listPlaylistItems: (playlistId, cursor) => call({ operation: 'items', expectedAccountId: owner, playlistId, ...(cursor ? { cursor } : {}) }),
  };
  owners.set(library, owner); return library;
}
