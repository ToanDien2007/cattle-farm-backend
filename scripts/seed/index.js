'use strict';
const mongoose = require('mongoose');
const env = require('../../src/config/env');

(async () => {
  await mongoose.connect(env.MONGODB_URI);
  await require('./seedAdmin')();
  // TODO: seedLocations, seedShipping
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
