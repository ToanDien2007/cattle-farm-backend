'use strict';
const router = require('express').Router();
const ROLES = require('../constants/roles');
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorize');

router.use(authenticate(), authorize(ROLES.ADMIN)); // mọi route /admin/* chỉ dành cho ADMIN (phạm vi ALL)

router.use('/accounts', require('../modules/accounts/account.routes'));
router.use('/customers', require('../modules/customers/customer.routes'));
router.use('/farm/breeds', require('../modules/farm/breeds/breed.routes'));
router.use('/farm/pens', require('../modules/farm/pens/pen.routes'));
router.use('/farm/cattle', require('../modules/farm/cattle/cattle.routes'));
router.use('/farm/health-records', require('../modules/farm/health/health-records/healthRecord.routes'));
router.use('/farm/vaccinations', require('../modules/farm/health/vaccinations/vaccination.routes'));
router.use('/farm/quarantines', require('../modules/farm/health/quarantine/quarantine.routes'));
router.use('/farm/milk-records', require('../modules/farm/production/milk-records/milkRecord.routes'));
router.use('/farm/meat-records', require('../modules/farm/production/meat-records/meatRecord.routes'));
// TODO: farm/* (còn lại), shop/*, shipping/*, reports/*

module.exports = router;
