'use strict';

const Promise = require('promise');
const docblock = require('./DependencyGraph/docblock');
const isAbsolutePath = require('absolute-path');
const path = require('path');

class Module {

  constructor(file, fastfs, moduleCache) {
    if (!isAbsolutePath(file)) {
      throw new Error('Expected file to be absolute path but got ' + file);
    }

    this.path = path.resolve(file);
    this.type = 'Module';

    this._fastfs = fastfs;
    this._moduleCache = moduleCache;
  }

  isHaste() {
    return this._read().then(data => !!data.id);
  }

  getName() {
    return this._read().then(data => {
      if (data.id) {
        return data.id;
      }

      const p = this.getPackage();

      if (!p) {
        // Name is full path
        return this.path;
      }

      return p.getName()
        .then(name => {
          if (!name) {
            return this.path;
          }

          return path.join(name, path.relative(p.root, this.path));
        });
    });
  }

  getPackage() {
    return this._moduleCache.getPackageForModule(this);
  }

  getDependencies() {
    return this._read().then(data => data.dependencies);
  }

  _read() {
    if (!this._reading) {
      this._reading = this._fastfs.readFile(this.path).then(content => {
        const data = {};
        const moduleDocBlock = docblock.parseAsObject(content);
        if (moduleDocBlock.providesModule || moduleDocBlock.provides) {
          data.id = /^(\S*)/.exec(
            moduleDocBlock.providesModule || moduleDocBlock.provides
          )[1];
        }

        return data;
      });
    }

    return this._reading;
  }

  getPlainObject() {
    return Promise.all([
      this.getName(),
      this.getDependencies(),
    ]).then(([name, dependencies]) => this.addReference({
      path: this.path,
      isJSON: path.extname(this.path) === '.json',
      resolution: undefined,
      id: name,
      dependencies
    }));
  }

  hash() {
    return `Module : ${this.path}`;
  }

  addReference(obj) {
    Object.defineProperty(obj, '_ref', { value: this });
    return obj;
  }
}

module.exports = Module;
