require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const routeRows = [
    { source: 'Mumbai', destination: 'Pune', boardingStop: 'Dadar', dropStop: 'Pune Station' },
    { source: 'Bengaluru', destination: 'Mysuru', boardingStop: 'Majestic', dropStop: 'Mysuru Bus Stand' },
    { source: 'Delhi', destination: 'Jaipur', boardingStop: 'Kashmere Gate', dropStop: 'Sindhi Camp' }
  ];
  const routes = [];
  for (const route of routeRows) {
    routes.push(await prisma.route.upsert({
      where: { source_destination: { source: route.source, destination: route.destination } },
      update: route,
      create: route
    }));
  }
  const dates = [1, 2].map((days) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  });
  for (const [routeIndex, route] of routes.entries()) {
    for (const date of dates) {
      const busName = `Demo Coach ${routeIndex + 1}`;
      const travelDate = new Date(`${date}T00:00:00.000Z`);
      const trip = await prisma.trip.upsert({
        where: { routeId_travelDate_busName: { routeId: route.id, travelDate, busName } },
        update: { departureTime: '08:30' },
        create: { routeId: route.id, busName, travelDate, departureTime: '08:30' }
      });
      for (let seatNumber = 1; seatNumber <= 12; seatNumber += 1) {
        await prisma.seat.upsert({
          where: { tripId_seatNumber: { tripId: trip.id, seatNumber: `S${String(seatNumber).padStart(2, '0')}` } },
          update: {},
          create: { tripId: trip.id, seatNumber: `S${String(seatNumber).padStart(2, '0')}`, status: seatNumber === 12 ? 'BOOKED' : 'AVAILABLE' }
        });
      }
    }
  }
  console.log('Seed complete: 3 routes, 6 trips and 72 seats are available.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
