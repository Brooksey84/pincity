-- Street food and Takeaway; Delicatessens now covers butchers too.
INSERT INTO categories (slug, name, icon, color, sort_order, active) VALUES
  ('street-food', 'Street food', '🌮', '#f4a259', 1, true),
  ('takeaway', 'Takeaway', '🥡', '#c1121f', 1, true)
ON CONFLICT (slug) DO NOTHING;
UPDATE categories SET name = 'Deli/Butchers', icon = '🥩' WHERE slug = 'delicatessens' AND name = 'Delicatessens';
