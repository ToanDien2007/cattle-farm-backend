'use strict';
const asyncHandler = require('../../../../utils/asyncHandler');
const ApiError = require('../../../../utils/ApiError');
const { ok } = require('../../../../utils/response');
const svc = require('./healthRecord.service');
const { exportHealthRecords } = require('./healthRecord.export');

exports.list = asyncHandler(async (req, res) => ok(res, await svc.list(req.validatedQuery)));
exports.getById = asyncHandler(async (req, res) => ok(res, await svc.getById(req.params.id)));
exports.create = asyncHandler(async (req, res) => ok(res, await svc.create(req, req.body), 201));
exports.update = asyncHandler(async (req, res) => ok(res, await svc.update(req, req.params.id, req.body)));
exports.export = asyncHandler(async (req, res) => exportHealthRecords(req, res, req.validatedQuery));
exports.bulkRemove = asyncHandler(async (req, res) => ok(res, await svc.remove(req, req.body.ids)));
exports.remove = asyncHandler(async (req, res) => {
  const r = await svc.remove(req, [req.params.id]);
  if (r.failed.length) throw ApiError.notFound(r.failed[0].reason, r.failed[0].code);
  ok(res, r);
});