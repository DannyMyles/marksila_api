ALTER TABLE `Training` CHANGE COLUMN `image` `imageUrl` VARCHAR(512) NULL;
ALTER TABLE `Training` ADD COLUMN `imageFilename` VARCHAR(191) NULL,
    ADD COLUMN `imageContentType` VARCHAR(191) NULL,
    ADD COLUMN `imageSize` INTEGER NULL;
