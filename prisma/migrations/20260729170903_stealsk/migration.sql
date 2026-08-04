-- CreateIndex
CREATE INDEX "Auction_status_startAt_idx" ON "Auction"("status", "startAt");

-- CreateIndex
CREATE INDEX "Auction_sellerId_idx" ON "Auction"("sellerId");

-- CreateIndex
CREATE INDEX "Auction_category_city_idx" ON "Auction"("category", "city");
