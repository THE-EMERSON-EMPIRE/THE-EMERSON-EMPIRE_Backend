-- Local-only extra constraints. Never apply this file to a hosted database.
DO $local$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['core.users','epdg.users','epdg.companies','epdg.schools','public.leads'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=target::regclass AND conname='synthetic_email_only') THEN
      EXECUTE format('ALTER TABLE %s ADD CONSTRAINT synthetic_email_only CHECK (email IS NULL OR email ~* %L)',
        target, '^[a-z0-9._+-]+@[a-z0-9.-]+\.invalid$');
    END IF;
  END LOOP;
END;
$local$;
