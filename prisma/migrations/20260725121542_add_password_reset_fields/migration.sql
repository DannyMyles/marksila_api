-- AlterTable
ALTER TABLE `User` ADD COLUMN `resetToken` VARCHAR(191) NULL,
    ADD COLUMN `resetTokenExpiry` DATETIME(3) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `User_resetToken_key` ON `User`(`resetToken`);
