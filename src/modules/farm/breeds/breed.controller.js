'use strict';
const asyncHandler = require('../../../utils/asyncHandler');
const ApiError = require('../../../utils/ApiError');
const { ok } = require('../../../utils/response');
const svc = require('./breed.service');

exports.list = asyncHandler(async (req, res) => ok(res, await svc.list(req.validatedQuery)));
exports.getById = asyncHandler(async (req, res) => ok(res, await svc.getById(req.params.id)));
exports.create = asyncHandler(async (req, res) => ok(res, await svc.create(req, req.body), 201));
exports.update = asyncHandler(async (req, res) => ok(res, await svc.update(req, req.params.id, req.body)));
exports.restore = asyncHandler(async (req, res) => ok(res, await svc.restore(req, req.params.id)));
exports.bulkRemove = asyncHandler(async (req, res) => ok(res, await svc.remove(req, req.body.ids)));

// Xóa 1 giống: thất bại thì trả lỗi 409/404 kèm lý do
exports.remove = asyncHandler(async (req, res) => {
  const r = await svc.remove(req, [req.params.id]);
  if (r.failed.length) {
    const f = r.failed[0];
    throw f.code === 'BREED_NOT_FOUND' ? ApiError.notFound(f.reason, f.code) : ApiError.conflict(f.reason, f.code);
  }
  ok(res, r);
});
