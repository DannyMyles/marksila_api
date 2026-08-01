-- AlterTable
ALTER TABLE `Order` ADD COLUMN `userId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `Order_userId_idx` ON `Order`(`userId`);

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE `NewsletterSubscriber` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `NewsletterSubscriber_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
