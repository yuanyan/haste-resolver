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
var declareOpts = require('./utils/declareOpts');
var Promise = require('promise');

var validateOpts = declareOpts({
  projectRoots: {
    type: 'array',
    required: true,
  },
  blacklistRE: {
    type: 'object', // typeof regex is object
  },
  nonPersistent: {
    type: 'boolean',
    default: false,
  },
  moduleFormat: {
    type: 'string',
    default: 'haste',
  },
  providesModuleNodeModules: {
    type: 'array',
    default: [
      'react-tools',
      'react-native',
      '@ali',
      '@alife'
    ],
  },
});

function HasteDependencyResolver(options) {
  var opts = validateOpts(options);

  this._depGraph = new DependencyGraph({
    roots: opts.projectRoots,
    ignoreFilePath: function(filepath) {
      return filepath.indexOf('__tests__') !== -1 ||
        (opts.blacklistRE && opts.blacklistRE.test(filepath));
    },
    providesModuleNodeModules: opts.providesModuleNodeModules,
  });
}

var getDependenciesValidateOpts = declareOpts({
  dev: {
    type: 'boolean',
    default: true,
  },
});

HasteDependencyResolver.prototype.getDependencies = function(main, options) {
  var opts = getDependenciesValidateOpts(options);

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
