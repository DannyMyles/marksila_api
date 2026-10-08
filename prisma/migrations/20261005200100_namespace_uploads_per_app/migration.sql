-- Uploaded files now live under uploads/<app key>/<kind>/ so each app's
-- files are stored apart. Every existing upload belongs to `fitness` and was
-- moved from uploads/<kind>/ to uploads/fitness/<kind>/; product images keep
-- their public URL in the database, so rewrite those paths to match.
UPDATE `ProductImage` SET `url` = CONCAT('/uploads/fitness/', SUBSTRING(`url`, LENGTH('/uploads/') + 1))
WHERE `url` LIKE '/uploads/%' AND `url` NOT LIKE '/uploads/fitness/%';
