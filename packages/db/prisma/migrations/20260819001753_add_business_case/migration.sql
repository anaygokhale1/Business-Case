-- CreateTable
CREATE TABLE "BusinessCase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectSlug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "BusinessCase_projectSlug_idx" ON "BusinessCase"("projectSlug");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessCase_projectSlug_name_key" ON "BusinessCase"("projectSlug", "name");
