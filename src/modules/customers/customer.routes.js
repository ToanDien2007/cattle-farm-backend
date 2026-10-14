'use strict';
const router = require('express').Router();
const validate = require('../../middlewares/validate');
const v = require('./customer.validation');
const c = require('./customer.controller');

// Đã qua authenticate() + authorize(ADMIN) ở routes/admin.routes.js
router.get('/', validate({ query: v.list }), c.list);
router.get('/export', validate({ query: v.exportQuery }), c.export); // đặt trước /:id
router.get('/:id', validate({ params: v.idParam }), c.getById);
router.post('/:id/lock', validate({ params: v.idParam, body: v.lock }), c.lock);
router.post('/:id/unlock', validate({ params: v.idParam }), c.unlock);

module.exports = router;
