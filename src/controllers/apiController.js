const prisma = require('../config/database');
const bookingService = require('../services/bookingService');
const { HttpError } = require('../utils/errors');

const asyncRoute = (handler) => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);

function validateBooking(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Request body must be a JSON object');
  const { tripId, seatId, passengerName, passengerPhone, travelDate, boardingStop, dropStop } = body;
  if (!Number.isInteger(tripId) || tripId < 1 || !Number.isInteger(seatId) || seatId < 1) throw new HttpError(400, 'tripId and seatId must be positive integers');
  if (typeof passengerName !== 'string' || passengerName.trim().length < 2 || passengerName.trim().length > 100) throw new HttpError(400, 'passengerName must contain 2 to 100 characters');
  if (typeof passengerPhone !== 'string' || !/^\+?[0-9]{7,15}$/.test(passengerPhone)) throw new HttpError(400, 'passengerPhone must contain 7 to 15 digits, optionally prefixed by +');
  if (typeof travelDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(travelDate) || Number.isNaN(Date.parse(`${travelDate}T00:00:00Z`)) || new Date(`${travelDate}T00:00:00Z`).toISOString().slice(0, 10) !== travelDate) throw new HttpError(400, 'travelDate must be a valid YYYY-MM-DD date');
  if (typeof boardingStop !== 'string' || typeof dropStop !== 'string' || !boardingStop.trim() || !dropStop.trim()) throw new HttpError(400, 'boardingStop and dropStop are required');
  return { tripId, seatId, passengerName, passengerPhone, travelDate, boardingStop: boardingStop.trim(), dropStop: dropStop.trim() };
}

const routes = asyncRoute(async (_req, res) => res.json(await prisma.route.findMany({ orderBy: { id: 'asc' } })));

const trips = asyncRoute(async (req, res) => {
  const where = {};
  if (req.query.routeId !== undefined) {
    const routeId = Number(req.query.routeId);
    if (!Number.isInteger(routeId) || routeId < 1) throw new HttpError(400, 'routeId must be a positive integer');
    where.routeId = routeId;
  }
  if (req.query.travelDate !== undefined) {
    const date = req.query.travelDate;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new HttpError(400, 'travelDate must be a valid YYYY-MM-DD date');
    where.travelDate = new Date(`${date}T00:00:00Z`);
  }
  res.json(await prisma.trip.findMany({ where, include: { route: true }, orderBy: [{ travelDate: 'asc' }, { id: 'asc' }] }));
});

const seats = asyncRoute(async (req, res) => {
  const tripId = Number(req.params.id);
  if (!Number.isInteger(tripId) || tripId < 1) throw new HttpError(400, 'Trip id must be a positive integer');
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) throw new HttpError(404, 'Trip not found');
  res.json(await prisma.seat.findMany({ where: { tripId }, orderBy: { seatNumber: 'asc' } }));
});

const createBooking = asyncRoute(async (req, res) => {
  const booking = await bookingService.createBooking(validateBooking(req.body));
  res.status(201).json(booking);
});

const getBooking = asyncRoute(async (req, res) => {
  const booking = await prisma.booking.findUnique({ where: { pnr: req.params.pnr.toUpperCase() }, include: { trip: { include: { route: true } }, seat: true } });
  if (!booking) throw new HttpError(404, 'Booking not found');
  res.json(booking);
});

const cancelBooking = asyncRoute(async (req, res) => res.json(await bookingService.cancelBooking(req.params.pnr.toUpperCase())));

module.exports = { asyncRoute, routes, trips, seats, createBooking, getBooking, cancelBooking };
