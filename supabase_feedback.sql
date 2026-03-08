-- [v1.6.1] DoulGet Feedback System
-- Run this in Supabase SQL Editor

-- Create feedback table
CREATE TABLE IF NOT EXISTS feedback (
  id BIGSERIAL PRIMARY KEY,
  hwid TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  app_version TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- One feedback per HWID (prevent spam)
CREATE UNIQUE INDEX IF NOT EXISTS feedback_hwid_unique ON feedback(hwid);

-- Enable Row Level Security
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Allow insert for anyone (clients can submit feedback)
CREATE POLICY "Allow feedback insert" ON feedback
  FOR INSERT WITH CHECK (true);

-- Allow read only for service_role (admin reads via backend)
-- Clients cannot read other clients' feedback
