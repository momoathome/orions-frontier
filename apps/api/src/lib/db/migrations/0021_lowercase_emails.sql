-- Signup and login lowercase emails now; an address that would collide keeps its case.
UPDATE users u SET email = lower(u.email)
WHERE u.email <> lower(u.email)
  AND NOT EXISTS (SELECT 1 FROM users o WHERE o.id <> u.id AND o.email = lower(u.email));
