'use strict';
const asyncHandler = require('../../../utils/asyncHandler');
const ApiError = require('../../../utils/ApiError');
const { ok } = require('../../../utils/response');
const svc = require('./cattle.service');
const status = require('./cattleStatus.service');
const pedigree = require('./pedigree.service');
const imp = require('./cattle.import');
const { exportCattle } = require('./cattle.export');

exports.list = asyncHandler(async (req, res) => ok(res, await svc.list(req.validatedQuery)));
exports.getById = asyncHandler(async (req, res) => ok(res, await svc.getById(req.params.id)));
exports.create = asyncHandler(async (req, res) => ok(res, await svc.create(req, req.body), 201));
exports.update = asyncHandler(async (req, res) => ok(res, await svc.update(req, req.params.id, req.body)));
exports.movePen = asyncHandler(async (req, res) => ok(res, await svc.movePen(req, req.params.id, req.body)));
exports.changeStatus = asyncHandler(async (req, res) => ok(res, await status.changeStatus(req, req.params.id, req.body)));
exports.setPedigree = asyncHandler(async (req, res) => ok(res, await pedigree.setPedigree(req, req.params.id, req.body)));
exports.getPedigree = asyncHandler(async (req, res) => ok(res, await pedigree.getTree(req.params.id, req.validatedQuery.depth)));
exports.export = asyncHandler(async (req, res) => exportCattle(req, res, req.validatedQuery));
exports.bulkRemove = asyncHandler(async (req, res) => ok(res, await svc.remove(req, req.body.ids)));
exports.remove = asyncHandler(async (req, res) => {
  const r = await svc.remove(req, [req.params.id]);
  if (r.failed.length) {
    const f = r.failed[0];
    throw f.code === 'CATTLE_NOT_FOUND' ? ApiError.notFound(f.reason, f.code) : ApiError.conflict(f.reason, f.code);
  }
  ok(res, r);
});

exports.importTemplate = asyncHandler(async (req, res) => imp.template(res));
exports.importPreview = asyncHandler(async (req, res) => ok(res, await imp.preview(req)));
exports.importConfirm = asyncHandler(async (req, res) => ok(res, await imp.confirm(req, req.body.sessionId)));
exports.importErrors = asyncHandler(async (req, res) => imp.errorFile(req, res, req.params.sessionId));
