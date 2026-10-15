-- Imported places can wait for a category until an admin reviews them.
ALTER TABLE places ALTER COLUMN category_id DROP NOT NULL;

-- More categories, live straight away. The app only offers a category in a city once it has pins there.
INSERT INTO categories (slug, name, icon, color, sort_order, active) VALUES
  ('cafes', 'Cafes', '☕', '#8b5e3c', 6, true),
  ('bakeries', 'Bakeries', '🥐', '#d4a017', 7, true),
  ('delicatessens', 'Delicatessens', '🧀', '#e07a5f', 8, true),
  ('bottle-shops', 'Bottle shops', '🍾', '#3a5a40', 9, true),
  ('wine-merchants', 'Wine merchants', '🍷', '#800f2f', 10, true),
  ('tobacconists', 'Tobacconists', '🚬', '#6c584c', 11, true),
  ('bicycle-shops', 'Bicycle shops', '🚲', '#2a9d8f', 12, true),
  ('cinemas', 'Cinemas', '🎬', '#3d405b', 13, true),
  ('theatres', 'Theatres', '🎭', '#7b2cbf', 14, true),
  ('music-venues', 'Music venues', '🎵', '#ef476f', 15, true)
ON CONFLICT (slug) DO NOTHING;
