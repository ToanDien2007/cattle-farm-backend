'use strict';
const asyncHandler = require('../../utils/asyncHandler');
const { ok } = require('../../utils/response');
const svc = require('./account.service');

exports.list = asyncHandler(async (req, res) => ok(res, await svc.list(req.validatedQuery)));
exports.getById = asyncHandler(async (req, res) => ok(res, await svc.getById(req.params.id)));
exports.create = asyncHandler(async (req, res) => ok(res, await svc.create(req, req.body), 201));
exports.update = asyncHandler(async (req, res) => ok(res, await svc.update(req, req.params.id, req.body)));
exports.remove = asyncHandler(async (req, res) => ok(res, await svc.remove(req, [req.params.id])));
exports.bulkRemove = asyncHandler(async (req, res) => ok(res, await svc.remove(req, req.body.ids)));
