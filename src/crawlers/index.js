'use strict';

const nodeCrawl = require('./node');

function crawl(roots, options) {
  return nodeCrawl(roots, options);
}

module.exports = crawl;
