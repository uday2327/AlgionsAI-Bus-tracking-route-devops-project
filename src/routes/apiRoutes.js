const express = require('express');
const controller = require('../controllers/apiController');

const router = express.Router();
router.get('/routes', controller.routes);
router.get('/trips', controller.trips);
router.get('/trips/:id/seats', controller.seats);
router.post('/bookings', controller.createBooking);
router.get('/bookings/:pnr', controller.getBooking);
router.patch('/bookings/:pnr/cancel', controller.cancelBooking);

module.exports = router;
