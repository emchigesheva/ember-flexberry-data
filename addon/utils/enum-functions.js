/**
  @module ember-flexberry-data
*/

import Ember from 'ember';

/**
  Returns friezed object without prototype with own properties of parameter.

  @function createEnum
  @param {Object|Array} dictionary
  @return {Object}
*/
export function createEnum(dictionary) {
  let local = {};
  if (Ember.isArray(dictionary)) {
    dictionary.forEach(element => local[element] = element);
  } else {
    local = dictionary;
  }

  return Object.freeze(Ember.merge(Object.create(null), local));
}

/**
  Returns friezed inversed object without prototype.

  @function inverseEnum
  @param {Object} dictionary
  @return {Object}
*/
export function inverseEnum(dictionary) {
  let inverse = {};
  for (let key in dictionary) {
    inverse[dictionary[key]] = key;
  }

  return createEnum(inverse);
}

/**
  Returns object without null values.

  @function enumCaptions
  @param {Object} dictionary
  @return {Object}
*/
export function enumCaptions(dictionary) {
  let captions = {};

  for (let key in dictionary) {
    if (dictionary[key] === null) {
      captions[key] = '';
    } else {
      captions[key] = dictionary[key];
    }
  }

  return captions;
}
