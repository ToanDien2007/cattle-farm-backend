'use strict';
const asyncHandler = require('../../../../utils/asyncHandler');
const { ok } = require('../../../../utils/response');
const svc = require('./quarantine.service');

exports.list = asyncHandler(async (req, res) => ok(res, await svc.list(req.validatedQuery)));
exports.getById = asyncHandler(async (req, res) => ok(res, await svc.getById(req.params.id)));
exports.start = asyncHandler(async (req, res) => ok(res, await svc.start(req, req.body), 201));
exports.addNote = asyncHandler(async (req, res) => ok(res, await svc.addNote(req, req.params.id, req.body)));
exports.end = asyncHandler(async (req, res) => ok(res, await svc.end(req, req.params.id, req.body)));