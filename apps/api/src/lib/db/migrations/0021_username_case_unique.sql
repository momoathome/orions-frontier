-- Bob and bob are one name; the case-insensitive index replaces the exact one.
ALTER TABLE users DROP CONSTRAINT users_username_unique;
CREATE UNIQUE INDEX users_username_lower_unique ON users (lower(username));
