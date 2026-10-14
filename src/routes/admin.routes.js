'use strict';
const router = require('express').Router();
const ROLES = require('../constants/roles');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');

router.use(authenticate(), authorize(ROLES.ADMIN)); // mọi route /admin/* chỉ dành cho ADMIN (phạm vi ALL)

router.use('/accounts', require('../modules/accounts/account.routes'));
router.use('/customers', require('../modules/customers/customer.routes'));
// TODO: farm/*, shop/*, shipping/*, reports/*

module.exports = router;
