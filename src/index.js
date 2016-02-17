/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Activity = require('./Activity');
const Cache = require('./Cache');
const DependencyGraph = require('./DependencyGraph');
const Promise = require('promise');
const Polyfill = require('./Polyfill');

class Resolver {
  constructor({
    roots,
    blacklistRE,
    providesModuleNodeModules = [],
    polyfillModuleNames = [],
    platforms,
    preferNativePlatform = true,
    assetExts,
    fileWatcher,
    resetCache,
    shouldThrowOnUnresolvedErrors
  }) {

    roots = roots.map(function(root){
      return path.resolve(root);
    });

    roots.forEach(verifyRootExists);

    this._depGraph = new DependencyGraph({
      activity: Activity,
      roots,
      assetExts,
      providesModuleNodeModules,
      platforms: platforms || ['ios', 'android', 'web', 'weex'],
      preferNativePlatform,
      fileWatcher,
      shouldThrowOnUnresolvedErrors,
      ignoreFilePath: function(filepath) {
        return filepath.indexOf('__tests__') !== -1 ||
          (blacklistRE && blacklistRE.test(filepath));
      },
      cache: new Cache({
        resetCache: resetCache,
        cacheKey: [
          'haste-resolver-cache',
          roots.join(',').split(path.sep).join('-')
        ].join('$'),
      }),
    });

    this._polyfillModuleNames = polyfillModuleNames || [];

    this._depGraph.load().catch(err => {
       console.error(err.message + '\n' + err.stack);
       process.exit(1);
     });
  }

  getDependencies(main, options) {

    return this._depGraph.getDependencies(
      main,
      options.platform,
      options.recursive,
    ).then(resolutionResponse => {
      this._getPolyfillDependencies().reverse().forEach(
        polyfill => resolutionResponse.prependDependency(polyfill)
      );

      return resolutionResponse.finalize();
    });
  }

  _getPolyfillDependencies() {
    const polyfillModuleNames = this._polyfillModuleNames;

    return polyfillModuleNames.map(
      (polyfillModuleName, idx) => new Polyfill({
        path: polyfillModuleName,
        id: polyfillModuleName,
        dependencies: polyfillModuleNames.slice(0, idx),
        isPolyfill: true,
      })
    );
  }

  getHasteMap() {
    var depGraph = this._depGraph;
    return depGraph.load().then(()=>{
      return depGraph._hasteMap;
    })
  }

  resolveRequires(resolutionResponse, module, code) {
    return Promise.resolve().then(() => {
      if (module.isPolyfill()) {
        return Promise.resolve({code});
      }

      const resolvedDeps = Object.create(null);
      const resolvedDepsArr = [];

      return Promise.all(
        resolutionResponse.getResolvedDependencyPairs(module).map(
          ([depName, depModule]) => {
            if (depModule) {
              return depModule.getName().then(name => {
                resolvedDeps[depName] = name;
                resolvedDepsArr.push(name);
              });
            }
          }
        )
      ).then(() => {
        const relativizeCode = (codeMatch, pre, quot, depName, post) => {
          const depId = resolvedDeps[depName];
          if (depId) {
            return pre + quot + depId + post;
          } else {
            return codeMatch;
          }
        };

        code = code
          .replace(replacePatterns.IMPORT_RE, relativizeCode)
          .replace(replacePatterns.EXPORT_RE, relativizeCode)
          .replace(replacePatterns.REQUIRE_RE, relativizeCode);

        return module.getName().then(name => {
          return {name, code};
        });
      });
    });
  }

  wrapModule(resolutionResponse, module, code) {
    if (module.isPolyfill()) {
      return Promise.resolve({
        code: definePolyfillCode(code),
      });
    }

    return this.resolveRequires(resolutionResponse, module, code).then(
      ({name, code}) => {
        return {name, code: defineModuleCode(name, code)};
      });
  }

}

function defineModuleCode(moduleName, code) {
  return [
    `__d(`,
    `'${moduleName}',`,
    'function(global, require, module, exports) {',
    `  ${code}`,
    '\n});',
  ].join('');
}

function definePolyfillCode(code) {
  return [
    '(function(global) {',
    code,
    `\n})(typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : this);`,
  ].join('');
}

function verifyRootExists(root) {
  // Verify that the root exists.
  assert(fs.statSync(root).isDirectory(), 'Root has to be a valid directory');
}

module.exports = Resolver;
