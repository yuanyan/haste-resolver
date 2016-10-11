'use strict';

const Module = require('./Module');
const getAssetDataFromName = require('./utils/getAssetDataFromName');

class AssetModule extends Module {
  constructor(...args) {
    super(...args);
    const { resolution, name, type } = getAssetDataFromName(this.path);
    this.resolution = resolution;
    this._name = name;
    this._type = type;
  }

  isHaste() {
    return Promise.resolve(false);
  }

  getDependencies() {
    return Promise.resolve([]);
  }

  read() {
    return Promise.resolve({});
  }

  getName() {
    return super.getName().then(
      id => id.replace(/\/[^\/]+$/, `/${this._name}.${this._type}`)
    );
  }

  hash() {
    return `AssetModule : ${this.path}`;
  }

  isJSON() {
    return false;
  }

  isAsset() {
    return true;
  }
}

module.exports = AssetModule;
