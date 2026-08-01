-- CreateTable
CREATE TABLE `GalleryCategory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `GalleryCategory_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GalleryImage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(191) NULL,
    `filename` VARCHAR(191) NOT NULL,
    `contentType` VARCHAR(191) NOT NULL,
    `size` INTEGER NOT NULL,
    `categoryId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `GalleryImage_categoryId_idx`(`categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `GalleryImage` ADD CONSTRAINT `GalleryImage_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `GalleryCategory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
