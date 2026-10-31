import type { TrackMetadataSnapshot } from '@fyspoti/contracts';

// Synthetic app-owned UUIDs for P4 contract review, not a separate catalog.
export const fixtureTracks: { id: string; metadataSnapshot: TrackMetadataSnapshot }[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    metadataSnapshot: { title: 'Fixture Sunrise', artistNames: ['Test Artist'], durationMs: 180000 },
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    metadataSnapshot: { title: 'Fixture Evening', artistNames: ['Test Ensemble'], durationMs: 240000 },
  },
];
