-- AlterTable: add new columns first so existing data can be backfilled
ALTER TABLE `Event` ADD COLUMN `trainers` TEXT NULL,
    ADD COLUMN `imageUrl` VARCHAR(512) NULL,
    ADD COLUMN `imageFilename` VARCHAR(191) NULL,
    ADD COLUMN `imageContentType` VARCHAR(191) NULL,
    ADD COLUMN `imageSize` INTEGER NULL;

-- Backfill: single `trainer` string -> single-element JSON array; `image` -> `imageUrl`
UPDATE `Event` SET `trainers` = JSON_ARRAY(`trainer`) WHERE `trainer` IS NOT NULL;
UPDATE `Event` SET `imageUrl` = `image` WHERE `image` IS NOT NULL;

-- Now that every row has a value, make `trainers` required like the old `trainer` column was
ALTER TABLE `Event` MODIFY COLUMN `trainers` TEXT NOT NULL;

-- Drop the old columns
ALTER TABLE `Event` DROP COLUMN `trainer`,
    DROP COLUMN `image`;
