-- AlterTable
ALTER TABLE `Event` ADD COLUMN `kind` VARCHAR(20) NOT NULL DEFAULT 'event';

-- CreateIndex
CREATE INDEX `Event_appId_kind_date_idx` ON `Event`(`appId`, `kind`, `date`);


-- Source of Adventure's existing trips are adventures; everything else stays "event".
UPDATE `Event` e JOIN `App` a ON a.id = e.appId SET e.kind = 'adventure' WHERE a.`key` = 'sos';
