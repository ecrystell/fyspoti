// Database boundary, intentionally separate from provider-independent contracts.
// Keep aligned with services/cloud/supabase/migrations; integration tests cover mapping.
export type PlaylistRow = {
  id: string;
  owner_id: string;
  title: string;
  visibility: 'private';
  created_at: string;
  revision: number;
  deleted_at: string | null;
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

export type LikeRow = {
  id: string; owner_id: string; track_id: string; liked: boolean; revision: number;
  snapshot_title: string; snapshot_artist_names: string[]; snapshot_duration_ms: number;
};
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json | undefined };

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; display_name: string; revision: number };
        Insert: { id: string; display_name?: string; revision?: number };
        Update: { display_name?: string; revision?: number };
        Relationships: [];
      };
      track_likes: {
        Row: LikeRow;
        Insert: Omit<LikeRow, 'id'> & { id?: string };
        Update: Partial<LikeRow>;
        Relationships: [];
      };
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
    Functions: {
      profile_mutate: {
        Args: { mutation_id: string; expected_account: string; expected_revision: number; display_name: string };
        Returns: Json;
      };
      library_mutate: {
        Args: { operation: string; mutation_id: string; payload: Json };
        Returns: Json;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}
