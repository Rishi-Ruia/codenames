/**
 * CODENAMES - Supabase Configuration
 * Real-time multiplayer sync using Supabase
 * 
 * IMPORTANT: You need to create a 'games' table in Supabase with the following schema:
 * 
 * CREATE TABLE games (
 *   game_code TEXT PRIMARY KEY,
 *   revealed JSONB DEFAULT '[]',
 *   current_turn TEXT DEFAULT 'red',
 *   red_remaining INTEGER DEFAULT 9,
 *   blue_remaining INTEGER DEFAULT 8,
 *   game_over BOOLEAN DEFAULT false,
 *   winner TEXT,
 *   current_clue TEXT,
 *   current_clue_number INTEGER DEFAULT 0,
 *   guesses_remaining INTEGER DEFAULT 0,
 *   clue_history JSONB DEFAULT '[]',
 *   players JSONB DEFAULT '{}',
 *   chat_messages JSONB DEFAULT '[]',
 *   last_action TIMESTAMPTZ DEFAULT NOW(),
 *   new_game_redirect TEXT DEFAULT NULL
 * );
 *
 * -- If you already have the table, add the new columns:
 * ALTER TABLE games ADD COLUMN IF NOT EXISTS new_game_redirect TEXT DEFAULT NULL;
 * ALTER TABLE games ADD COLUMN IF NOT EXISTS clue_history JSONB DEFAULT '[]';
 * ALTER TABLE games ADD COLUMN IF NOT EXISTS players JSONB DEFAULT '{}';
 * ALTER TABLE games ADD COLUMN IF NOT EXISTS chat_messages JSONB DEFAULT '[]';
 * 
 * -- Enable Row Level Security
 * ALTER TABLE games ENABLE ROW LEVEL SECURITY;
 * 
 * -- Allow public read/write access
 * CREATE POLICY "Allow public access" ON games FOR ALL USING (true) WITH CHECK (true);
 * 
 * -- Enable Realtime
 * ALTER PUBLICATION supabase_realtime ADD TABLE games;
 */

// Supabase configuration
const SUPABASE_URL = 'https://qjqmexhjadsysvkoqmva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqcW1leGhqYWRzeXN2a29xbXZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAxNTAwMzYsImV4cCI6MjA4NTcyNjAzNn0.zpM6hi9-fBcNi_s94AsTCBQ4Kecrp__bO5iP4jTFQZc';

// Initialize Supabase client - use different variable name to avoid conflict with window.supabase
var supabaseClient = null;
var supabaseEnabled = false;

function initializeSupabase() {
    try {
        if (typeof window.supabase !== 'undefined' && window.supabase.createClient) {
            supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            supabaseEnabled = true;
            console.log("Supabase initialized successfully!");
            return true;
        } else {
            console.error("Supabase SDK not loaded");
            return false;
        }
    } catch (error) {
        console.error("Supabase initialization failed:", error);
        return false;
    }
}

// Initialize immediately (SDK should be loaded before this script)
initializeSupabase();
