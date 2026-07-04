-- CreateTable
CREATE TABLE "PMTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "categoryId" TEXT NOT NULL,
    "taskCode" TEXT,
    "intervalHours" REAL NOT NULL,
    "intervalLabel" TEXT NOT NULL,
    "system" TEXT,
    "component" TEXT,
    "description" TEXT NOT NULL,
    "parts" TEXT,
    "skill" TEXT,
    "laborHours" REAL,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PMTask_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PMTask_categoryId_intervalHours_sortOrder_idx" ON "PMTask"("categoryId", "intervalHours", "sortOrder");
