/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

const Fastfs = require('../fastfs');
const ModuleCache = require('../ModuleCache');
const Promise = require('promise');
const _ = require('underscore');
const crawl = require('../crawlers');
const debug = require('debug')('DependencyGraph');
const declareOpts = require('../utils/declareOpts');
const isAbsolutePath = require('absolute-path');
const path = require('path');
const util = require('util');

const validateOpts = declareOpts({
  roots: {
    type: 'array',
    required: true,
  },
  ignoreFilePath: {
    type: 'function',
    default: function(){}
  },
  providesModuleNodeModules: {
    type: 'array'
  },
});

class DependencyGraph {
  constructor(options) {
    this._opts = validateOpts(options);
    this._hasteMap = Object.create(null);
    this._immediateResolutionCache = Object.create(null);
    this.load();
  }

  load() {
    if (this._loading) {
      return this._loading;
    }

    var startTime = new Date;
    const allRoots = this._opts.roots;
    this._crawling = crawl(allRoots, {
      ignore: this._opts.ignoreFilePath,
      exts: ['js', 'json']
    });

    this._crawling.then((files) => console.log('Crawl:', (new Date - startTime) + 'ms'));

    this._fastfs = new Fastfs(this._opts.roots, {
      ignore: this._opts.ignoreFilePath,
      crawling: this._crawling,
    });

    this._fastfs.on('change', this._processFileChange.bind(this));

    this._moduleCache = new ModuleCache(this._fastfs);

    this._loading = Promise.all([
      this._fastfs.build().then(() => this._buildHasteMap())
    ]);

    return this._loading;
  }

  resolveDependency(fromModule, toModuleName) {
    if (fromModule._ref) {
      fromModule = fromModule._ref;
    }

    const resHash = resolutionHash(fromModule.path, toModuleName);

    if (this._immediateResolutionCache[resHash]) {
      return Promise.resolve(this._immediateResolutionCache[resHash]);
    }

    const cacheResult = (result) => {
      this._immediateResolutionCache[resHash] = result;
      return result;
    };

    const forgive = () => {
      console.warn(
        'Unable to resolve module %s from %s',
        toModuleName,
        fromModule.path
      );
      return null;
    };

    if (!this._isNodeModulesDir(fromModule.path)
        && toModuleName[0] !== '.' &&
        toModuleName[0] !== '/') {
      return this._resolveHasteDependency(fromModule, toModuleName).catch(
        () => this._resolveNodeDependency(fromModule, toModuleName)
      ).then(
        cacheResult,
        forgive
      );
    }

    return this._resolveNodeDependency(fromModule, toModuleName)
      .then(
        cacheResult,
        forgive
      );
  }

  getOrderedDependencies(entryPath) {
    return this.load().then(() => {
      const absPath = this._getAbsolutePath(entryPath);

      if (absPath == null) {
        throw new NotFoundError(
          'Could not find source file at %s',
          entryPath
        );
      }

      const absolutePath = path.resolve(absPath);

      if (absolutePath == null) {
        throw new NotFoundError(
          'Cannot find entry file %s in any of the roots: %j',
          entryPath,
          this._opts.roots
        );
      }

      const entry = this._moduleCache.getModule(absolutePath);
      const deps = [];
      const visited = Object.create(null);
      visited[entry.hash()] = true;

      const collect = (mod) => {
        deps.push(mod);
        return mod.getDependencies().then(
          depNames => Promise.all(
            depNames.map(name => this.resolveDependency(mod, name))
          ).then((dependencies) => [depNames, dependencies])
        ).then(([depNames, dependencies]) => {
          let p = Promise.resolve();
          dependencies.forEach((modDep, i) => {
            if (modDep == null) {
              debug(
                'WARNING: Cannot find required module `%s` from module `%s`',
                depNames[i],
                mod.path
              );
              return;
            }

            p = p.then(() => {
              if (!visited[modDep.hash()]) {
                visited[modDep.hash()] = true;
                return collect(modDep);
              }
              return null;
            });
          });

          return p;
        });
      };

      return collect(entry)
        .then(() => Promise.all(deps.map(dep => dep.getPlainObject())));
    });
  }

  _getAbsolutePath(filePath) {
    if (isAbsolutePath(filePath)) {
      return filePath;
    }

    for (let i = 0; i < this._opts.roots.length; i++) {
      const root = this._opts.roots[i];
      const absPath = path.join(root, filePath);
      if (this._fastfs.fileExists(absPath)) {
        return absPath;
      }
    }

    return null;
  }

  _resolveHasteDependency(fromModule, toModuleName) {
    toModuleName = normalizePath(toModuleName);

    let p = fromModule.getPackage();
    if (p) {
      p = p.redirectRequire(toModuleName);
    } else {
      p = Promise.resolve(toModuleName);
    }

    return p.then((realModuleName) => {
      let dep = this._hasteMap[realModuleName];

      if (dep && dep.type === 'Module') {
        return dep;
      }

      let packageName = realModuleName;

      while (packageName && packageName !== '.') {
        dep = this._hasteMap[packageName];
        if (dep && dep.type === 'Package') {
          break;
        }
        packageName = path.dirname(packageName);
      }

      if (dep && dep.type === 'Package') {
        const potentialModulePath = path.join(
          dep.root,
          path.relative(packageName, realModuleName)
        );
        return this._loadAsFile(potentialModulePath)
          .catch(() => this._loadAsDir(potentialModulePath));
      }

      throw new Error('Unable to resolve dependency');
    });
  }

  _redirectRequire(fromModule, modulePath) {
    return Promise.resolve(fromModule.getPackage()).then(p => {
      if (p) {
        return p.redirectRequire(modulePath);
      }
      return modulePath;
    });
  }

  _resolveNodeDependency(fromModule, toModuleName) {
    if (toModuleName[0] === '.' || toModuleName[1] === '/') {
      const potentialModulePath = isAbsolutePath(toModuleName) ?
              toModuleName :
              path.join(path.dirname(fromModule.path), toModuleName);
      return this._redirectRequire(fromModule, potentialModulePath).then(
        realModuleName => this._loadAsFile(realModuleName)
          .catch(() => this._loadAsDir(realModuleName))
      );
    } else {
      return this._redirectRequire(fromModule, toModuleName).then(
        realModuleName => {
          const searchQueue = [];
          for (let currDir = path.dirname(fromModule.path);
               currDir !== '/';
               currDir = path.dirname(currDir)) {
            searchQueue.push(
              path.join(currDir, 'node_modules', realModuleName)
            );
          }

          let p = Promise.reject(new Error('Node module not found'));
          searchQueue.forEach(potentialModulePath => {
            p = p.catch(
              () => this._loadAsFile(potentialModulePath)
            ).catch(
              () => this._loadAsDir(potentialModulePath)
            );
          });

          return p;
        });
    }
  }

  _loadAsFile(potentialModulePath) {
    return Promise.resolve().then(() => {

      let file;
      if (this._fastfs.fileExists(potentialModulePath)) {
        file = potentialModulePath;
      } else if (this._fastfs.fileExists(potentialModulePath + '.js')) {
        file = potentialModulePath + '.js';
      } else if (this._fastfs.fileExists(potentialModulePath + '.json')) {
        file = potentialModulePath + '.json';
      } else {
        throw new Error(`File ${potentialModulePath} doesnt exist`);
      }

      return this._moduleCache.getModule(file);
    });
  }

  _loadAsDir(potentialDirPath) {
    return Promise.resolve().then(() => {
      if (!this._fastfs.dirExists(potentialDirPath)) {
        throw new Error(`Invalid directory ${potentialDirPath}`);
      }

      const packageJsonPath = path.join(potentialDirPath, 'package.json');
      if (this._fastfs.fileExists(packageJsonPath)) {
        return this._moduleCache.getPackage(packageJsonPath)
          .getMain().then(
            (main) => this._loadAsFile(main).catch(
              () => this._loadAsDir(main)
            )
          );
      }

      return this._loadAsFile(path.join(potentialDirPath, 'index'));
    });
  }

  _buildHasteMap() {
    let promises = this._fastfs.findFilesByExt('js', {
      ignore: (file) => this._isNodeModulesDir(file)
    }).map(file => this._processHasteModule(file));

    return Promise.all(promises);
  }

  _processHasteModule(file) {
    const module = this._moduleCache.getModule(file);
    return module.isHaste().then(
      isHaste => isHaste && module.getName()
        .then(name => this._updateHasteMap(name, module))
    );
  }

  _processHastePackage(file) {
    file = path.resolve(file);
    const p = this._moduleCache.getPackage(file, this._fastfs);
    return p.isHaste()
      .then(isHaste => isHaste && p.getName()
            .then(name => this._updateHasteMap(name, p)))
      .catch(e => {
        if (e instanceof SyntaxError) {
          // Malformed package.json.
          return;
        }
        throw e;
      });
  }

  _updateHasteMap(name, mod) {
    if (this._hasteMap[name]) {
      debug('WARNING: conflicting haste modules: ' + name);
      if (mod.type === 'Package' &&
          this._hasteMap[name].type === 'Module') {
        // Modules takes precendence over packages.
        return;
      }
    }
    this._hasteMap[name] = mod;
  }

  _isNodeModulesDir(file) {
    let parts = path.normalize(file).split(path.sep);
    const indexOfNodeModules = parts.lastIndexOf('node_modules');

    if (indexOfNodeModules === -1) {
      return false;
    }

    parts = parts.slice(indexOfNodeModules + 1);

    const dirs = this._opts.providesModuleNodeModules;

    if(!dirs){
      return false;
    }

    for (let i = 0; i < dirs.length; i++) {
      if (parts.indexOf(dirs[i]) > -1) {
        return false;
      }
    }

    return true;
  }

  _processFileChange(type, filePath, root, fstat) {
    // It's really hard to invalidate the right module resolution cache
    // so we just blow it up with every file change.
    this._immediateResolutionCache = Object.create(null);

    const absPath = path.join(root, filePath);
    if ((fstat && fstat.isDirectory()) ||
        this._opts.ignoreFilePath(absPath) ||
        this._isNodeModulesDir(absPath)) {
      return;
    }

    if (type === 'delete' || type === 'change') {
      _.each(this._hasteMap, (mod, name) => {
        if (mod.path === absPath) {
          delete this._hasteMap[name];
        }
      });

      if (type === 'delete') {
        return;
      }
    }

    if (extname(absPath) === 'js' || extname(absPath) === 'json') {
      this._loading = this._loading.then(() => {
        if (path.basename(filePath) === 'package.json') {
          return this._processHastePackage(absPath);
        } else {
          return this._processHasteModule(absPath);
        }
      });
    }
  }
}

function extname(name) {
  return path.extname(name).replace(/^\./, '');
}

function resolutionHash(modulePath, depName) {
  return `${path.resolve(modulePath)}:${depName}`;
}

function NotFoundError() {
  Error.call(this);
  Error.captureStackTrace(this, this.constructor);
  var msg = util.format.apply(util, arguments);
  this.message = msg;
  this.type = this.name = 'NotFoundError';
  this.status = 404;
}

function normalizePath(modulePath) {
  if (path.sep === '/') {
    modulePath = path.normalize(modulePath);
  } else if (path.posix) {
    modulePath = path.posix.normalize(modulePath);
  }

  return modulePath.replace(/\/$/, '');
}

util.inherits(NotFoundError, Error);

module.exports = DependencyGraph;
