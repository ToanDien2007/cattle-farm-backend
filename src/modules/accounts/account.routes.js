'use strict';
const router = require('express').Router();
const validate = require('../../middlewares/validate');
const v = require('./account.validation');
const c = require('./account.controller');

// Đã qua authenticate() + authorize(ADMIN) ở routes/admin.routes.js
router.get('/', validate({ query: v.list }), c.list);
router.post('/', validate({ body: v.create }), c.create);
router.post('/bulk-delete', validate({ body: v.bulkDelete }), c.bulkRemove);
router.get('/:id', validate({ params: v.idParam }), c.getById);
router.patch('/:id', validate({ params: v.idParam, body: v.update }), c.update);
router.delete('/:id', validate({ params: v.idParam }), c.remove);

module.exports = router;
