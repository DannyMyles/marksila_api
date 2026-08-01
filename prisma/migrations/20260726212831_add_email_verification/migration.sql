-- AlterTable
ALTER TABLE `User` ADD COLUMN `emailVerified` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `verifyToken` VARCHAR(191) NULL,
    ADD COLUMN `verifyTokenExpiry` DATETIME(3) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `User_verifyToken_key` ON `User`(`verifyToken`);
