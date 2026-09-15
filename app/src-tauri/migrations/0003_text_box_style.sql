-- Text box frame (docs/SPEC.md 6.5.5): NULL = no border / no fill.
ALTER TABLE annotations ADD COLUMN border_color TEXT;
ALTER TABLE annotations ADD COLUMN fill_color TEXT;
