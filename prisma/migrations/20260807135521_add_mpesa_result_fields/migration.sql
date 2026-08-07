-- AlterTable
ALTER TABLE `Order` ADD COLUMN `paymentResultCode` INTEGER NULL,
    ADD COLUMN `paymentResultDesc` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `EventRegistration` ADD COLUMN `paymentResultCode` INTEGER NULL,
    ADD COLUMN `paymentResultDesc` VARCHAR(191) NULL;
