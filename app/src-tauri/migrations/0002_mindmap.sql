-- Mind map (MarginNote-style): one tree per deck; excerpt cards link back to annotations.
CREATE TABLE IF NOT EXISTS mindmap_nodes (
  id TEXT PRIMARY KEY,
  deck_id TEXT NOT NULL,
  parent_id TEXT,
  kind TEXT NOT NULL,                 -- 'root' | 'excerpt' | 'text'
  markdown TEXT NOT NULL DEFAULT '',  -- the user's note on the card
  annotation_id TEXT,                 -- excerpt: linked highlight / text box
  page_index INTEGER,
  order_index INTEGER NOT NULL DEFAULT 0,
  color TEXT,
  collapsed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_mindmap_deck ON mindmap_nodes(deck_id);
CREATE INDEX IF NOT EXISTS idx_mindmap_parent ON mindmap_nodes(parent_id);
