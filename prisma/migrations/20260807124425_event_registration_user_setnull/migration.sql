-- DropForeignKey
ALTER TABLE `EventRegistration` DROP FOREIGN KEY `EventRegistration_userId_fkey`;

-- AlterTable
ALTER TABLE `EventRegistration` MODIFY `userId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `EventRegistration` ADD CONSTRAINT `EventRegistration_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
