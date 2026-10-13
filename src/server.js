'use strict';
const env = require('./config/env');
const { connectDB } = require('./config/db');
const app = require('./app');

(async () => {
  await connectDB();
  app.listen(env.PORT, () => console.log(`API listening on :${env.PORT}`));
})();
