-- CreateTable
CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `role` ENUM('user', 'admin') NOT NULL DEFAULT 'user',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_username_key`(`username`),
    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Blog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `excerpt` TEXT NOT NULL,
    `content` TEXT NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `author` VARCHAR(191) NOT NULL,
    `authorId` INTEGER NULL,
    `readTime` VARCHAR(191) NULL,
    `imageUrl` VARCHAR(512) NULL,
    `imageFilename` VARCHAR(191) NULL,
    `imageContentType` VARCHAR(191) NULL,
    `imageSize` INTEGER NULL,
    `featured` BOOLEAN NOT NULL DEFAULT false,
    `published` BOOLEAN NOT NULL DEFAULT true,
    `views` INTEGER NOT NULL DEFAULT 0,
    `likes` INTEGER NOT NULL DEFAULT 0,
    `tags` TEXT NULL,
    `metaTitle` VARCHAR(191) NULL,
    `metaDescription` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Blog_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Testimonial` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `company` VARCHAR(191) NULL,
    `content` TEXT NOT NULL,
    `rating` INTEGER NOT NULL,
    `image` VARCHAR(191) NULL,
    `avatarColor` VARCHAR(191) NOT NULL DEFAULT '#3b82f6',
    `featured` BOOLEAN NOT NULL DEFAULT true,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Training` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NULL,
    `description` TEXT NOT NULL,
    `features` TEXT NOT NULL,
    `price` VARCHAR(191) NOT NULL,
    `image` VARCHAR(191) NOT NULL,
    `icon` VARCHAR(191) NULL,
    `color` VARCHAR(191) NULL,
    `popular` BOOLEAN NOT NULL DEFAULT false,
    `order` INTEGER NOT NULL DEFAULT 0,
    `published` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Training_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
