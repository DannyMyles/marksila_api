-- Multi-tenant backend + WhatsApp checkout.
--
-- 1. Adds the `App` table (one row per connected frontend) and creates the
--    two current tenants: `fitness` (owns every existing row) and `sos`.
-- 2. Adds `appId` to every tenant-owned table, backfilled to `fitness`, and
--    turns global unique keys (slug, email, username) into per-app ones so
--    two apps can reuse the same slug/email without colliding.
-- 3. Removes the M-Pesa columns. Orders/bookings are confirmed on WhatsApp;
--    statuses are remapped (paid -> confirmed, pending_payment -> pending).

-- CreateTable
CREATE TABLE `App` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(40) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `adminKeyHash` CHAR(64) NULL,
    `whatsappNumber` VARCHAR(20) NULL,
    `contactEmail` VARCHAR(191) NULL,
    `contactPhone` VARCHAR(191) NULL,
    `location` VARCHAR(191) NULL,
    `notificationEmail` VARCHAR(191) NULL,
    `frontendUrl` VARCHAR(191) NULL,
    `orderPrefix` VARCHAR(10) NOT NULL DEFAULT 'ORD',
    `bookingPrefix` VARCHAR(10) NOT NULL DEFAULT 'BKG',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `App_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Seed tenants. Fitness takes id 1 so existing data can be backfilled to it.
INSERT INTO `App` (`id`, `key`, `name`, `whatsappNumber`, `contactEmail`, `contactPhone`, `location`, `frontendUrl`, `orderPrefix`, `bookingPrefix`, `updatedAt`) VALUES
  (1, 'fitness', 'MarkSila254', '254701437959', 'markotundo777@gmail.com', '+254 701 437 959', 'Nairobi, Kenya', 'http://localhost:3000', 'MK254', 'EVT', CURRENT_TIMESTAMP(3)),
  (2, 'sos', 'Source of Adventure', '254701437959', 'info@sourceofadventure.com', '+254 701 437 959', 'Nairobi, Kenya', 'http://localhost:3001', 'SOA', 'SOA', CURRENT_TIMESTAMP(3));

-- DropIndex
DROP INDEX `Blog_slug_key` ON `Blog`;

-- DropIndex
DROP INDEX `Category_slug_key` ON `Category`;

-- DropIndex
DROP INDEX `Event_slug_key` ON `Event`;

-- DropIndex
DROP INDEX `GalleryCategory_slug_key` ON `GalleryCategory`;

-- DropIndex
DROP INDEX `NewsletterSubscriber_email_key` ON `NewsletterSubscriber`;

-- DropIndex
DROP INDEX `Product_slug_key` ON `Product`;

-- DropIndex
DROP INDEX `Training_slug_key` ON `Training`;

-- DropIndex
DROP INDEX `User_email_key` ON `User`;

-- DropIndex
DROP INDEX `User_username_key` ON `User`;

-- Widen the status enums so old values can be remapped before narrowing.
ALTER TABLE `Order`
    MODIFY `status` ENUM('pending', 'paid', 'confirmed', 'shipped', 'delivered', 'cancelled') NOT NULL DEFAULT 'pending',
    MODIFY `paymentStatus` ENUM('pending', 'failed', 'unpaid', 'paid') NOT NULL DEFAULT 'unpaid';
UPDATE `Order` SET `status` = 'confirmed' WHERE `status` = 'paid';
UPDATE `Order` SET `paymentStatus` = 'unpaid' WHERE `paymentStatus` IN ('pending', 'failed');

ALTER TABLE `EventRegistration`
    MODIFY `status` ENUM('pending_payment', 'pending', 'confirmed', 'cancelled') NOT NULL DEFAULT 'pending';
UPDATE `EventRegistration` SET `status` = 'pending' WHERE `status` = 'pending_payment';

-- AlterTable
ALTER TABLE `Blog` ADD COLUMN `appId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `Category` ADD COLUMN `appId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `Event` ADD COLUMN `appId` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `category` VARCHAR(60) NULL,
    ADD COLUMN `difficulty` VARCHAR(40) NULL,
    ADD COLUMN `duration` VARCHAR(60) NULL;

-- AlterTable
ALTER TABLE `EventRegistration` DROP COLUMN `mpesaAmount`,
    DROP COLUMN `mpesaPhone`,
    DROP COLUMN `mpesaTransactionTime`,
    DROP COLUMN `paymentRef`,
    DROP COLUMN `paymentResultCode`,
    DROP COLUMN `paymentResultDesc`,
    ADD COLUMN `appId` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `attendeeEmail` VARCHAR(191) NULL,
    ADD COLUMN `notes` TEXT NULL,
    ADD COLUMN `participants` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `total` INTEGER NOT NULL DEFAULT 0,
    MODIFY `status` ENUM('pending', 'confirmed', 'cancelled') NOT NULL DEFAULT 'pending';

-- AlterTable
ALTER TABLE `GalleryCategory` ADD COLUMN `appId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `NewsletterSubscriber` ADD COLUMN `appId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `Order` DROP COLUMN `mpesaAmount`,
    DROP COLUMN `mpesaPhone`,
    DROP COLUMN `mpesaTransactionTime`,
    DROP COLUMN `paymentMethod`,
    DROP COLUMN `paymentRef`,
    DROP COLUMN `paymentResultCode`,
    DROP COLUMN `paymentResultDesc`,
    ADD COLUMN `appId` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `notes` TEXT NULL,
    MODIFY `customerEmail` VARCHAR(191) NULL,
    MODIFY `status` ENUM('pending', 'confirmed', 'shipped', 'delivered', 'cancelled') NOT NULL DEFAULT 'pending',
    MODIFY `paymentStatus` ENUM('unpaid', 'paid') NOT NULL DEFAULT 'unpaid';

-- AlterTable
ALTER TABLE `Product` ADD COLUMN `appId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `Testimonial` ADD COLUMN `appId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `Training` ADD COLUMN `appId` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `appId` INTEGER NOT NULL DEFAULT 1;

-- Backfill booking details from the existing rows.
UPDATE `EventRegistration` r JOIN `Event` e ON e.`id` = r.`eventId` SET r.`total` = e.`price` * r.`participants`;
UPDATE `EventRegistration` r JOIN `User` u ON u.`id` = r.`userId` SET r.`attendeeEmail` = u.`email` WHERE r.`attendeeEmail` IS NULL;

-- appId was defaulted only to backfill existing rows; new rows must set it explicitly.
ALTER TABLE `Blog` ALTER COLUMN `appId` DROP DEFAULT;
ALTER TABLE `Category` ALTER COLUMN `appId` DROP DEFAULT;
ALTER TABLE `Event` ALTER COLUMN `appId` DROP DEFAULT;
ALTER TABLE `EventRegistration` ALTER COLUMN `appId` DROP DEFAULT;
ALTER TABLE `GalleryCategory` ALTER COLUMN `appId` DROP DEFAULT;
ALTER TABLE `NewsletterSubscriber` ALTER COLUMN `appId` DROP DEFAULT;
ALTER TABLE `Order` ALTER COLUMN `appId` DROP DEFAULT;
ALTER TABLE `Product` ALTER COLUMN `appId` DROP DEFAULT;
ALTER TABLE `Testimonial` ALTER COLUMN `appId` DROP DEFAULT;
ALTER TABLE `Training` ALTER COLUMN `appId` DROP DEFAULT;
ALTER TABLE `User` ALTER COLUMN `appId` DROP DEFAULT;

-- CreateIndex
CREATE INDEX `Blog_appId_idx` ON `Blog`(`appId`);

-- CreateIndex
CREATE UNIQUE INDEX `Blog_appId_slug_key` ON `Blog`(`appId`, `slug`);

-- CreateIndex
CREATE INDEX `Category_appId_idx` ON `Category`(`appId`);

-- CreateIndex
CREATE UNIQUE INDEX `Category_appId_slug_key` ON `Category`(`appId`, `slug`);

-- CreateIndex
CREATE INDEX `Event_appId_idx` ON `Event`(`appId`);

-- CreateIndex
CREATE UNIQUE INDEX `Event_appId_slug_key` ON `Event`(`appId`, `slug`);

-- CreateIndex
CREATE INDEX `EventRegistration_appId_idx` ON `EventRegistration`(`appId`);

-- CreateIndex
CREATE INDEX `GalleryCategory_appId_idx` ON `GalleryCategory`(`appId`);

-- CreateIndex
CREATE UNIQUE INDEX `GalleryCategory_appId_slug_key` ON `GalleryCategory`(`appId`, `slug`);

-- CreateIndex
CREATE INDEX `NewsletterSubscriber_appId_idx` ON `NewsletterSubscriber`(`appId`);

-- CreateIndex
CREATE UNIQUE INDEX `NewsletterSubscriber_appId_email_key` ON `NewsletterSubscriber`(`appId`, `email`);

-- CreateIndex
CREATE INDEX `Order_appId_idx` ON `Order`(`appId`);

-- CreateIndex
CREATE INDEX `Product_appId_idx` ON `Product`(`appId`);

-- CreateIndex
CREATE UNIQUE INDEX `Product_appId_slug_key` ON `Product`(`appId`, `slug`);

-- CreateIndex
CREATE INDEX `Testimonial_appId_idx` ON `Testimonial`(`appId`);

-- CreateIndex
CREATE INDEX `Training_appId_idx` ON `Training`(`appId`);

-- CreateIndex
CREATE UNIQUE INDEX `Training_appId_slug_key` ON `Training`(`appId`, `slug`);

-- CreateIndex
CREATE INDEX `User_appId_idx` ON `User`(`appId`);

-- CreateIndex
CREATE UNIQUE INDEX `User_appId_email_key` ON `User`(`appId`, `email`);

-- CreateIndex
CREATE UNIQUE INDEX `User_appId_username_key` ON `User`(`appId`, `username`);

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_appId_fkey` FOREIGN KEY (`appId`) REFERENCES `App`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Blog` ADD CONSTRAINT `Blog_appId_fkey` FOREIGN KEY (`appId`) REFERENCES `App`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Testimonial` ADD CONSTRAINT `Testimonial_appId_fkey` FOREIGN KEY (`appId`) REFERENCES `App`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Training` ADD CONSTRAINT `Training_appId_fkey` FOREIGN KEY (`appId`) REFERENCES `App`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Category` ADD CONSTRAINT `Category_appId_fkey` FOREIGN KEY (`appId`) REFERENCES `App`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Product` ADD CONSTRAINT `Product_appId_fkey` FOREIGN KEY (`appId`) REFERENCES `App`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_appId_fkey` FOREIGN KEY (`appId`) REFERENCES `App`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NewsletterSubscriber` ADD CONSTRAINT `NewsletterSubscriber_appId_fkey` FOREIGN KEY (`appId`) REFERENCES `App`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Event` ADD CONSTRAINT `Event_appId_fkey` FOREIGN KEY (`appId`) REFERENCES `App`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GalleryCategory` ADD CONSTRAINT `GalleryCategory_appId_fkey` FOREIGN KEY (`appId`) REFERENCES `App`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EventRegistration` ADD CONSTRAINT `EventRegistration_appId_fkey` FOREIGN KEY (`appId`) REFERENCES `App`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
