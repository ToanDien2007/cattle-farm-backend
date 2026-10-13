'use strict';
const ApiError = require('../utils/ApiError');

// validate({ body, query, params }) với zod schema. Query đã parse nằm ở req.validatedQuery.
module.exports = (schemas) => (req, res, next) => {
  const details = [];
  for (const key of ['params', 'query', 'body']) {
    if (!schemas[key]) continue;
    const input = key === 'body' ? (req.body ?? {}) : req[key];
    const result = schemas[key].safeParse(input);
    if (!result.success) {
      for (const i of result.error.issues) {
        details.push({ field: [key, ...i.path].join('.'), message: i.message });
      }
    } else if (key === 'query') {
      req.validatedQuery = result.data;
    } else {
      req[key] = result.data;
    }
  }
  if (details.length) return next(ApiError.unprocessable('Dữ liệu không hợp lệ', details));
  next();
};
