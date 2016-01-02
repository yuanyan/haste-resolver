/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

var path = require('path');
var DependencyGraph = require('./DependencyGraph');
var Promise = require('promise');

function HasteDependencyResolver({
  roots,
  blacklistRE,
  providesModuleNodeModules,
  platform,
  preferNativePlatform,
}) {

  this._depGraph = new DependencyGraph({
    roots: roots,
    ignoreFilePath: function(filepath) {
      return filepath.indexOf('__tests__') !== -1 ||
        (blacklistRE && blacklistRE.test(filepath));
    },
    providesModuleNodeModules: providesModuleNodeModules,
    platform: platform,
    preferNativePlatform, preferNativePlatform
  });
}

HasteDependencyResolver.prototype.getDependencies = function(main, options) {

  var depGraph = this._depGraph;
  var self = this;
  return depGraph.load().then(
    () => depGraph.getOrderedDependencies(main).then(
      dependencies => {
        const mainModuleId = dependencies[0].id;
        return {
          mainModuleId: mainModuleId,
          dependencies: dependencies
        };
      }
    )
  );
};

HasteDependencyResolver.prototype.getHasteMap = function(callback) {

  var depGraph = this._depGraph;

  if(depGraph.loaded){
    return callback(depGraph._hasteMap)
  }

  var self = this;
  return depGraph.load().then(() => {
    depGraph.loaded = true
    callback(depGraph._hasteMap)
  })

};

module.exports = HasteDependencyResolver;
