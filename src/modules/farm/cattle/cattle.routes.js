'use strict';
const router = require('express').Router();
const validate = require('../../../middlewares/validate');
const { uploadSheet } = require('../../../middlewares/upload');
const v = require('./cattle.validation');
const c = require('./cattle.controller');

// Route tĩnh đặt trước /:id
router.get('/', validate({ query: v.list }), c.list);
router.post('/', validate({ body: v.create }), c.create);
router.get('/export', validate({ query: v.exportQuery }), c.export);
router.post('/bulk-delete', validate({ body: v.bulkDelete }), c.bulkRemove);

router.get('/import/template', c.importTemplate);
router.post('/import/preview', uploadSheet('file'), c.importPreview);
router.post('/import/confirm', validate({ body: v.importConfirm }), c.importConfirm);
router.get('/import/:sessionId/errors', validate({ params: v.sessionParam }), c.importErrors);

router.get('/:id', validate({ params: v.idParam }), c.getById);
router.patch('/:id', validate({ params: v.idParam, body: v.update }), c.update);
router.delete('/:id', validate({ params: v.idParam }), c.remove);
router.post('/:id/move-pen', validate({ params: v.idParam, body: v.movePen }), c.movePen);
router.post('/:id/status', validate({ params: v.idParam, body: v.changeStatus }), c.changeStatus);
router.get('/:id/pedigree', validate({ params: v.idParam, query: v.pedigreeTree }), c.getPedigree);
router.put('/:id/pedigree', validate({ params: v.idParam, body: v.pedigree }), c.setPedigree);

module.exports = router;
