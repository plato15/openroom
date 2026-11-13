-- Page shape of a PDF's first page, so the viewer can show slides wide and documents tall.
ALTER TABLE files ADD COLUMN orientation TEXT CHECK (orientation IN ('portrait', 'landscape'));
