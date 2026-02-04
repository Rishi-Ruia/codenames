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
 *   last_action TIMESTAMPTZ DEFAULT NOW()
 * );
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
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqcW1leGhqYWRzeXN2a29xbXZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzg2MjA4NzAsImV4cCI6MjA1NDE5Njg3MH0.T-s-GZwXRk3CXe0VDGeZQA_q2J4bLyu';

// Initialize Supabase client
let supabase = null;
let supabaseEnabled = false;

function initializeSupabase() {
    try {
        if (typeof window.supabase !== 'undefined' && window.supabase.createClient) {
            supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
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

// Initialize when the script loads
document.addEventListener('DOMContentLoaded', () => {
    // Small delay to ensure Supabase SDK is loaded
    setTimeout(initializeSupabase, 100);
});
