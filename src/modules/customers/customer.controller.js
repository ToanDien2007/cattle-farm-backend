'use strict';
const asyncHandler = require('../../utils/asyncHandler');
const { ok } = require('../../utils/response');
const svc = require('./customer.service');

exports.list = asyncHandler(async (req, res) => ok(res, await svc.list(req.validatedQuery)));
exports.getById = asyncHandler(async (req, res) => ok(res, await svc.getById(req.params.id)));
exports.export = asyncHandler(async (req, res) => svc.exportCustomers(req, res, req.validatedQuery));
exports.lock = asyncHandler(async (req, res) => ok(res, await svc.setLocked(req, req.params.id, true, req.body.reason)));
exports.unlock = asyncHandler(async (req, res) => ok(res, await svc.setLocked(req, req.params.id, false)));
