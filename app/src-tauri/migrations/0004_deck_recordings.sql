-- A recording belongs to its PDF. Keep the denormalized course in sync in the
-- same SQLite statement/transaction, including older recordings and recovery.
UPDATE sessions
SET course_id = (SELECT course_id FROM decks WHERE decks.id = sessions.deck_id),
    dirty = 1
WHERE EXISTS (
  SELECT 1 FROM decks WHERE decks.id = sessions.deck_id
  AND decks.course_id <> sessions.course_id
);

CREATE TRIGGER IF NOT EXISTS deck_move_recordings
AFTER UPDATE OF course_id ON decks
WHEN OLD.course_id <> NEW.course_id
BEGIN
  UPDATE sessions SET course_id = NEW.course_id,
    updated_at = NEW.updated_at, dirty = 1
  WHERE deck_id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS recording_inherits_deck_course
AFTER INSERT ON sessions
WHEN EXISTS (SELECT 1 FROM decks WHERE id = NEW.deck_id AND course_id <> NEW.course_id)
BEGIN
  UPDATE sessions SET course_id = (SELECT course_id FROM decks WHERE id = NEW.deck_id)
  WHERE id = NEW.id;
END;
