const crypto = require('node:crypto');
const prisma = require('../config/database');
const { HttpError } = require('../utils/errors');

function makePnr() {
  return crypto.randomBytes(5).toString('hex').toUpperCase();
}

async function createBooking(input) {
  const trip = await prisma.trip.findUnique({ where: { id: input.tripId }, include: { route: true } });
  if (!trip) throw new HttpError(404, 'Trip not found');
  if (new Date(`${input.travelDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== trip.travelDate.toISOString().slice(0, 10)) {
    throw new HttpError(400, 'Travel date does not match the selected trip');
  }
  if (input.boardingStop !== trip.route.boardingStop || input.dropStop !== trip.route.dropStop) {
    throw new HttpError(400, 'Boarding or drop stop is not valid for this route');
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const seat = await tx.seat.findFirst({ where: { id: input.seatId, tripId: input.tripId } });
      if (!seat) throw new HttpError(404, 'Seat not found for this trip');
      const reserved = await tx.seat.updateMany({
        where: { id: seat.id, tripId: input.tripId, status: 'AVAILABLE' },
        data: { status: 'BOOKED' }
      });
      if (reserved.count !== 1) throw new HttpError(409, 'Seat is already booked');
      return tx.booking.create({
        data: {
          pnr: makePnr(), tripId: input.tripId, seatId: seat.id,
          passengerName: input.passengerName.trim(), passengerPhone: input.passengerPhone,
          boardingStop: input.boardingStop, dropStop: input.dropStop
        },
        include: { seat: true, trip: { include: { route: true } } }
      });
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error.code === 'P2034') throw new HttpError(409, 'Seat was booked by another request; please retry');
    throw error;
  }
}

async function cancelBooking(pnr) {
  try {
    return await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({ where: { pnr } });
      if (!booking) throw new HttpError(404, 'Booking not found');
      const updated = await tx.booking.updateMany({ where: { id: booking.id, status: 'CONFIRMED' }, data: { status: 'CANCELLED' } });
      if (updated.count !== 1) throw new HttpError(409, 'Booking is already cancelled');
      const released = await tx.seat.updateMany({ where: { id: booking.seatId, tripId: booking.tripId, status: 'BOOKED' }, data: { status: 'AVAILABLE' } });
      if (released.count !== 1) throw new HttpError(409, 'The booked seat is not in a releasable state');
      return tx.booking.findUnique({ where: { id: booking.id }, include: { seat: true } });
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error.code === 'P2034') throw new HttpError(409, 'Booking changed during cancellation; please retry');
    throw error;
  }
}

module.exports = { createBooking, cancelBooking };
