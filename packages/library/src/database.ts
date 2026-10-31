// M0 database boundary, intentionally separate from provider-independent contracts.
// Keep aligned with services/cloud/supabase/migrations; integration tests cover mapping.
export type PlaylistRow = {
  id: string;
  owner_id: string;
  title: string;
  visibility: 'private';
  created_at: string;
};

export type ItemRow = {
  id: string;
  playlist_id: string;
  track_id: string;
  ordering_key: number;
  snapshot_title: string;
  snapshot_artist_names: string[];
  snapshot_duration_ms: number;
};

export interface Database {
  public: {
    Tables: {
      playlists: {
        Row: PlaylistRow;
        Insert: { id?: string; owner_id?: string; title: string; visibility?: 'private'; created_at?: string };
        Update: Partial<PlaylistRow>;
        Relationships: [];
      };
      playlist_items: {
        Row: ItemRow;
        Insert: Omit<ItemRow, 'id'> & { id?: string };
        Update: Partial<ItemRow>;
        Relationships: [{
          foreignKeyName: 'playlist_items_playlist_id_fkey';
          columns: ['playlist_id'];
          isOneToOne: false;
          referencedRelation: 'playlists';
          referencedColumns: ['id'];
        }];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}
