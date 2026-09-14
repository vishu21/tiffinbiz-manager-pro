-- Adds an optional free-text "Referred By" column to the customers table.
-- Values are free-form: an existing customer's name ("Supratim"), a channel
-- ("Instagram", "Facebook"), or any other referral source ("Flyer", "Word of mouth").
-- Older rows simply keep NULL (no backfill needed).
ALTER TABLE customers ADD COLUMN IF NOT EXISTS referred_by text DEFAULT NULL;
