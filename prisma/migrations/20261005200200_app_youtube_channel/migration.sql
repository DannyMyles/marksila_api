-- Each app shows its own YouTube channel in its gallery (was one global env var).
ALTER TABLE `App` ADD COLUMN `youtubeChannelHandle` VARCHAR(100) NULL;
UPDATE `App` SET `youtubeChannelHandle` = 'marksila254' WHERE `key` = 'fitness';
