-- Pubs, separate from Bars.
INSERT INTO categories (slug, name, icon, color, sort_order, active) VALUES
  ('pubs', 'Pubs', '🍺', '#b5651d', 2, true)
ON CONFLICT (slug) DO NOTHING;
