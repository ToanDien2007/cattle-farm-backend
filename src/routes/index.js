'use strict';
const router = require('express').Router();

router.get('/health', (req, res) => res.json({ ok: true }));

router.use('/auth', require('../modules/auth/auth.routes'));

// TODO: mount theo pham vi du lieu
// router.use('/store', require('./public.routes'));      // PUBLIC
// router.use('/me', require('./customer.routes'));       // OWN  (CUSTOMER)
// router.use('/admin', require('./admin.routes'));       // ALL  (ADMIN)
// router.use('/webhooks', require('./webhook.routes'));  // cong thanh toan

module.exports = router;
