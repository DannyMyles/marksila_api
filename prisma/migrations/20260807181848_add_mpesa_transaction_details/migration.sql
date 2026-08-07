ALTER TABLE `Order` ADD COLUMN `mpesaPhone` VARCHAR(191) NULL,
    ADD COLUMN `mpesaAmount` INTEGER NULL,
    ADD COLUMN `mpesaTransactionTime` DATETIME(3) NULL;

ALTER TABLE `EventRegistration` ADD COLUMN `mpesaPhone` VARCHAR(191) NULL,
    ADD COLUMN `mpesaAmount` INTEGER NULL,
    ADD COLUMN `mpesaTransactionTime` DATETIME(3) NULL;
