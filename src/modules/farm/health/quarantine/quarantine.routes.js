'use strict';
const router = require('express').Router();
const validate = require('../../../../middlewares/validate');
const v = require('./quarantine.validation');
const c = require('./quarantine.controller');

router.get('/', validate({ query: v.list }), c.list);
router.post('/', validate({ body: v.start }), c.start);
router.get('/:id', validate({ params: v.idParam }), c.getById);
router.post('/:id/notes', validate({ params: v.idParam, body: v.addNote }), c.addNote);
router.post('/:id/end', validate({ params: v.idParam, body: v.end }), c.end);

module.exports = router;