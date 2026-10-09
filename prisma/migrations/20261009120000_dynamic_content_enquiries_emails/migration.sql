-- AlterTable
ALTER TABLE `App` ADD COLUMN `enquiryPrefix` VARCHAR(10) NOT NULL DEFAULT 'ENQ',
    ADD COLUMN `settings` LONGTEXT NULL,
    ADD COLUMN `tagline` VARCHAR(255) NULL;

-- AlterTable
ALTER TABLE `Training` ADD COLUMN `audience` ENUM('individual', 'corporate', 'both') NOT NULL DEFAULT 'individual',
    ADD COLUMN `available` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `bookingRequirements` TEXT NULL,
    ADD COLUMN `category` VARCHAR(60) NULL,
    ADD COLUMN `duration` VARCHAR(60) NULL,
    ADD COLUMN `groupSize` VARCHAR(60) NULL,
    ADD COLUMN `level` VARCHAR(40) NULL,
    ADD COLUMN `location` VARCHAR(160) NULL,
    ADD COLUMN `maxParticipants` INTEGER NULL,
    ADD COLUMN `minParticipants` INTEGER NULL,
    ADD COLUMN `priceAmount` INTEGER NULL,
    ADD COLUMN `pricingType` ENUM('fixed', 'per_person', 'quote') NOT NULL DEFAULT 'fixed',
    ADD COLUMN `schedule` VARCHAR(120) NULL;

-- AlterTable
ALTER TABLE `EventRegistration` ADD COLUMN `requestId` VARCHAR(64) NULL,
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    MODIFY `status` ENUM('pending', 'confirmed', 'completed', 'cancelled') NOT NULL DEFAULT 'pending';

-- CreateTable
CREATE TABLE `ServicePackage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `trainingId` INTEGER NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` TEXT NULL,
    `priceAmount` INTEGER NULL,
    `pricingType` ENUM('fixed', 'per_person', 'quote') NOT NULL DEFAULT 'fixed',
    `priceLabel` VARCHAR(100) NULL,
    `minParticipants` INTEGER NULL,
    `maxParticipants` INTEGER NULL,
    `features` TEXT NULL,
    `popular` BOOLEAN NOT NULL DEFAULT false,
    `order` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ServicePackage_trainingId_idx`(`trainingId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Enquiry` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `appId` INTEGER NOT NULL,
    `reference` VARCHAR(30) NOT NULL,
    `type` ENUM('contact', 'booking', 'corporate', 'quote') NOT NULL,
    `status` ENUM('new', 'contacted', 'quoted', 'confirmed', 'completed', 'cancelled') NOT NULL DEFAULT 'new',
    `name` VARCHAR(100) NOT NULL,
    `phone` VARCHAR(20) NOT NULL,
    `email` VARCHAR(255) NULL,
    `company` VARCHAR(160) NULL,
    `participants` INTEGER NULL,
    `preferredDate` DATETIME(3) NULL,
    `location` VARCHAR(200) NULL,
    `trainingId` INTEGER NULL,
    `packageId` INTEGER NULL,
    `serviceName` VARCHAR(200) NULL,
    `packageName` VARCHAR(120) NULL,
    `estimate` INTEGER NULL,
    `quotedAmount` INTEGER NULL,
    `message` TEXT NULL,
    `adminNotes` TEXT NULL,
    `userId` INTEGER NULL,
    `requestId` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Enquiry_reference_key`(`reference`),
    INDEX `Enquiry_appId_status_idx`(`appId`, `status`),
    INDEX `Enquiry_appId_type_idx`(`appId`, `type`),
    INDEX `Enquiry_appId_createdAt_idx`(`appId`, `createdAt`),
    INDEX `Enquiry_trainingId_idx`(`trainingId`),
    INDEX `Enquiry_packageId_idx`(`packageId`),
    UNIQUE INDEX `Enquiry_appId_requestId_key`(`appId`, `requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Faq` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `appId` INTEGER NOT NULL,
    `question` VARCHAR(300) NOT NULL,
    `answer` TEXT NOT NULL,
    `category` VARCHAR(60) NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `published` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Faq_appId_order_idx`(`appId`, `order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Banner` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `appId` INTEGER NOT NULL,
    `placement` VARCHAR(40) NOT NULL DEFAULT 'home',
    `title` VARCHAR(160) NOT NULL,
    `subtitle` TEXT NULL,
    `badge` VARCHAR(60) NULL,
    `imageUrl` VARCHAR(512) NULL,
    `imageFilename` VARCHAR(191) NULL,
    `ctaLabel` VARCHAR(60) NULL,
    `ctaUrl` VARCHAR(512) NULL,
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Banner_appId_placement_idx`(`appId`, `placement`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `appId` INTEGER NOT NULL,
    `kind` VARCHAR(60) NOT NULL,
    `to` VARCHAR(255) NOT NULL,
    `subject` VARCHAR(255) NOT NULL,
    `status` ENUM('queued', 'sent', 'failed', 'skipped') NOT NULL DEFAULT 'queued',
    `error` TEXT NULL,
    `messageId` VARCHAR(255) NULL,
    `dedupeKey` VARCHAR(150) NULL,
    `entityType` VARCHAR(40) NULL,
    `entityId` INTEGER NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sentAt` DATETIME(3) NULL,

    INDEX `EmailLog_appId_createdAt_idx`(`appId`, `createdAt`),
    INDEX `EmailLog_appId_status_idx`(`appId`, `status`),
    INDEX `EmailLog_appId_entityType_entityId_idx`(`appId`, `entityType`, `entityId`),
    UNIQUE INDEX `EmailLog_appId_dedupeKey_key`(`appId`, `dedupeKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Training_appId_category_idx` ON `Training`(`appId`, `category`);

-- CreateIndex
CREATE INDEX `Training_appId_audience_idx` ON `Training`(`appId`, `audience`);

-- CreateIndex
CREATE INDEX `EventRegistration_appId_status_idx` ON `EventRegistration`(`appId`, `status`);

-- CreateIndex
CREATE UNIQUE INDEX `EventRegistration_appId_requestId_key` ON `EventRegistration`(`appId`, `requestId`);

-- AddForeignKey
ALTER TABLE `ServicePackage` ADD CONSTRAINT `ServicePackage_trainingId_fkey` FOREIGN KEY (`trainingId`) REFERENCES `Training`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Enquiry` ADD CONSTRAINT `Enquiry_appId_fkey` FOREIGN KEY (`appId`) REFERENCES `App`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Enquiry` ADD CONSTRAINT `Enquiry_trainingId_fkey` FOREIGN KEY (`trainingId`) REFERENCES `Training`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Enquiry` ADD CONSTRAINT `Enquiry_packageId_fkey` FOREIGN KEY (`packageId`) REFERENCES `ServicePackage`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Enquiry` ADD CONSTRAINT `Enquiry_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Faq` ADD CONSTRAINT `Faq_appId_fkey` FOREIGN KEY (`appId`) REFERENCES `App`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Banner` ADD CONSTRAINT `Banner_appId_fkey` FOREIGN KEY (`appId`) REFERENCES `App`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailLog` ADD CONSTRAINT `EmailLog_appId_fkey` FOREIGN KEY (`appId`) REFERENCES `App`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

