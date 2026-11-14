CREATE TYPE "SeatStatus" AS ENUM ('AVAILABLE', 'BOOKED');
CREATE TYPE "BookingStatus" AS ENUM ('CONFIRMED', 'CANCELLED');

CREATE TABLE "Route" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "boardingStop" TEXT NOT NULL,
    "dropStop" TEXT NOT NULL,
    CONSTRAINT "Route_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Trip" (
    "id" SERIAL NOT NULL,
    "routeId" INTEGER NOT NULL,
    "busName" TEXT NOT NULL,
    "travelDate" DATE NOT NULL,
    "departureTime" TEXT NOT NULL,
    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Seat" (
    "id" SERIAL NOT NULL,
    "tripId" INTEGER NOT NULL,
    "seatNumber" TEXT NOT NULL,
    "status" "SeatStatus" NOT NULL DEFAULT 'AVAILABLE',
    CONSTRAINT "Seat_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Booking" (
    "id" SERIAL NOT NULL,
    "pnr" TEXT NOT NULL,
    "tripId" INTEGER NOT NULL,
    "seatId" INTEGER NOT NULL,
    "passengerName" TEXT NOT NULL,
    "passengerPhone" TEXT NOT NULL,
    "boardingStop" TEXT NOT NULL,
    "dropStop" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Seat_tripId_seatNumber_key" ON "Seat"("tripId", "seatNumber");
CREATE UNIQUE INDEX "Booking_pnr_key" ON "Booking"("pnr");
CREATE UNIQUE INDEX "Route_source_destination_key" ON "Route"("source", "destination");
CREATE INDEX "Trip_routeId_travelDate_idx" ON "Trip"("routeId", "travelDate");
CREATE UNIQUE INDEX "Trip_routeId_travelDate_busName_key" ON "Trip"("routeId", "travelDate", "busName");
CREATE INDEX "Seat_tripId_status_idx" ON "Seat"("tripId", "status");
CREATE INDEX "Booking_tripId_status_idx" ON "Booking"("tripId", "status");
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "Seat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
