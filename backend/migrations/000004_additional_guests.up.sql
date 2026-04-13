-- Add additional_guests column to entry_scans for +N guest tracking
ALTER TABLE entry_scans ADD COLUMN IF NOT EXISTS additional_guests INTEGER NOT NULL DEFAULT 0;
