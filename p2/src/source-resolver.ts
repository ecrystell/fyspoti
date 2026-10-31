import type { LocalArtifact, PlayableSource, QueueItem, SourceResolver } from './contracts.ts';

export interface CatalogSourceAdapter {
  resolveStream(item: QueueItem, signal: AbortSignal): Promise<PlayableSource>;
}

export interface ArtifactLookup {
  getArtifact(trackId: string): Promise<LocalArtifact | undefined>;
  playbackUrl(artifactId: string): Promise<string>;
}

export class OfflineFirstResolver implements SourceResolver {
  private readonly artifacts: ArtifactLookup;
  private readonly catalog: CatalogSourceAdapter;
  constructor(artifacts: ArtifactLookup, catalog: CatalogSourceAdapter) { this.artifacts = artifacts; this.catalog = catalog; }
  async resolve(item: QueueItem, signal: AbortSignal): Promise<PlayableSource> {
    const artifact = await this.artifacts.getArtifact(item.trackId);
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (artifact) {
      try {
        const uri = await this.artifacts.playbackUrl(artifact.id);
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        return { uri, mimeType: artifact.mimeType, local: true, seekable: true };
      } catch (error) {
        if (signal.aborted) throw error;
      }
    }
    const source = await this.catalog.resolveStream(item, signal);
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (!/^https?:\/\//.test(source.uri)) throw new Error('Stream provider returned an unsupported URI');
    return source;
  }
}
