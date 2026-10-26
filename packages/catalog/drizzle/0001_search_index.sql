-- Full-text search over tracks (M3). A derived index: the scanner rebuilds
-- it after every scan that changes tracks (src/db/search-index.ts), so it
-- holds no information of its own. rowid = tracks.id.
-- remove_diacritics 2 lets "sigur ros" match "Sigur Rós".
CREATE VIRTUAL TABLE `track_search` USING fts5(
	title,
	artist,
	album,
	genre,
	tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
-- Index whatever an existing catalog already holds.
INSERT INTO `track_search` (rowid, title, artist, album, genre)
SELECT
	t.id,
	coalesce(t.title, ''),
	trim(
		coalesce(t.display_artist, '') || ' ' ||
		coalesce((SELECT group_concat(ar.name, ' ') FROM track_artists ta
		          JOIN artists ar ON ar.id = ta.artist_id WHERE ta.track_id = t.id), '') || ' ' ||
		coalesce(aa.name, '')
	),
	coalesce(a.title, ''),
	coalesce((SELECT group_concat(g.name, ' ') FROM track_genres tg
	          JOIN genres g ON g.id = tg.genre_id WHERE tg.track_id = t.id), '')
FROM tracks t
LEFT JOIN albums a ON a.id = t.album_id
LEFT JOIN artists aa ON aa.id = a.album_artist_id;
