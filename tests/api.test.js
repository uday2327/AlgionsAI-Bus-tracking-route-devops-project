const request = require('supertest');
const app = require('../src/app');
const prisma = require('../src/config/database');

let route;
let trip;
let seat;

beforeEach(async () => {
  await prisma.booking.deleteMany();
  await prisma.seat.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.route.deleteMany();
  route = await prisma.route.create({ data: { source: 'Test City A', destination: 'Test City B', boardingStop: 'Test Board', dropStop: 'Test Drop' } });
  trip = await prisma.trip.create({ data: { routeId: route.id, busName: 'Test Coach', travelDate: new Date('2030-04-05T00:00:00.000Z'), departureTime: '09:00' } });
  seat = await prisma.seat.create({ data: { tripId: trip.id, seatNumber: 'T01' } });
  await prisma.seat.create({ data: { tripId: trip.id, seatNumber: 'T02' } });
});

afterAll(async () => prisma.$disconnect());

function bookingPayload(overrides = {}) {
  return {
    tripId: trip.id, seatId: seat.id, passengerName: 'Sample Passenger', passengerPhone: '+919876543210',
    travelDate: '2030-04-05', boardingStop: route.boardingStop, dropStop: route.dropStop, ...overrides
  };
}

test('health and database readiness endpoints report status', async () => {
  await request(app).get('/health').expect(200, { status: 'ok' });
  await request(app).get('/ready').expect(200, { status: 'ready', database: 'connected' });
});

test('lists routes and searches trips by route and date', async () => {
  const listedRoutes = await request(app).get('/api/routes').expect(200);
  expect(listedRoutes.body).toHaveLength(1);
  const listedTrips = await request(app).get(`/api/trips?routeId=${route.id}&travelDate=2030-04-05`).expect(200);
  expect(listedTrips.body).toHaveLength(1);
  expect(listedTrips.body[0].route.destination).toBe('Test City B');
});

test('shows seat availability', async () => {
  const response = await request(app).get(`/api/trips/${trip.id}/seats`).expect(200);
  expect(response.body).toEqual(expect.arrayContaining([expect.objectContaining({ seatNumber: 'T01', status: 'AVAILABLE' })]));
});

test('rejects invalid passenger and travel data', async () => {
  await request(app).post('/api/bookings').expect(400);
  await request(app).post('/api/bookings').set('Content-Type', 'application/json').send('[]').expect(400);
  await request(app).post('/api/bookings').set('Content-Type', 'application/json').send('null').expect(400);
  await request(app).post('/api/bookings').send(bookingPayload({ passengerName: 'A' })).expect(400);
  await request(app).post('/api/bookings').send(bookingPayload({ passengerPhone: 'not-a-phone' })).expect(400);
  await request(app).post('/api/bookings').send(bookingPayload({ travelDate: '2030-02-30' })).expect(400);
  await request(app).post('/api/bookings').send(bookingPayload({ boardingStop: 'Wrong stop' })).expect(400);
});

test('books a seat, retrieves by PNR, and cancellation releases the seat', async () => {
  const created = await request(app).post('/api/bookings').send(bookingPayload()).expect(201);
  expect(created.body.pnr).toMatch(/^[A-F0-9]{10}$/);
  expect(created.body.status).toBe('CONFIRMED');
  await request(app).get(`/api/bookings/${created.body.pnr}`).expect(200);
  const booked = await request(app).get(`/api/trips/${trip.id}/seats`).expect(200);
  expect(booked.body.find((item) => item.id === seat.id).status).toBe('BOOKED');
  await request(app).patch(`/api/bookings/${created.body.pnr}/cancel`).expect(200);
  const available = await request(app).get(`/api/trips/${trip.id}/seats`).expect(200);
  expect(available.body.find((item) => item.id === seat.id).status).toBe('AVAILABLE');
});

test('a second confirmed reservation for a booked seat returns conflict', async () => {
  await request(app).post('/api/bookings').send(bookingPayload()).expect(201);
  await request(app).post('/api/bookings').send(bookingPayload({ passengerName: 'Another Passenger' })).expect(409);
  expect(await prisma.booking.count({ where: { tripId: trip.id, seatId: seat.id, status: 'CONFIRMED' } })).toBe(1);
});

test('concurrent requests cannot reserve the same seat twice', async () => {
  const results = await Promise.all([
    request(app).post('/api/bookings').send(bookingPayload({ passengerName: 'Passenger One' })),
    request(app).post('/api/bookings').send(bookingPayload({ passengerName: 'Passenger Two' }))
  ]);
  expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
  expect(await prisma.booking.count({ where: { tripId: trip.id, seatId: seat.id, status: 'CONFIRMED' } })).toBe(1);
});
