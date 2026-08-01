-- CreateTable
CREATE TABLE `Event` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `time` VARCHAR(191) NOT NULL,
    `location` VARCHAR(191) NOT NULL,
    `trainer` VARCHAR(191) NOT NULL,
    `image` VARCHAR(191) NOT NULL,
    `price` INTEGER NOT NULL,
    `maxSpots` INTEGER NOT NULL,
    `popular` BOOLEAN NOT NULL DEFAULT false,
    `published` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Event_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EventRegistration` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ticketNumber` VARCHAR(191) NOT NULL,
    `eventId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `attendeeName` VARCHAR(191) NOT NULL,
    `attendeePhone` VARCHAR(191) NOT NULL,
    `status` ENUM('pending_payment', 'confirmed', 'cancelled') NOT NULL DEFAULT 'pending_payment',
    `paymentRef` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `EventRegistration_ticketNumber_key`(`ticketNumber`),
    INDEX `EventRegistration_eventId_idx`(`eventId`),
    UNIQUE INDEX `EventRegistration_eventId_userId_key`(`eventId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `EventRegistration` ADD CONSTRAINT `EventRegistration_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EventRegistration` ADD CONSTRAINT `EventRegistration_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
