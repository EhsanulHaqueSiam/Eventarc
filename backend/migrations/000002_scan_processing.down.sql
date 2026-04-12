DROP INDEX IF EXISTS idx_entry_scans_guest_lookup;
DROP INDEX IF EXISTS idx_entry_scans_reconcile;
DROP INDEX IF EXISTS idx_entry_scans_event_guest;
ALTER TABLE entry_scans DROP COLUMN IF EXISTS guest_category;
