import Ember from 'ember';
import DS from 'ember-data';
import createProj from '../utils/create';
import EmberValidations from 'ember-validations';

/**
  Base model that supports projections and validations.

  @module ember-flexberry-data
  @class Model
  @namespace Projection
  @extends DS.Model
  @uses EmberValidationsMixin
  @uses Ember.EventedMixin

  @event preSave
  @param {Object} event Event object
  @param {Promise[]} promises Array to which custom 'preSave' promises could be pushed

  @public
 */
var Model = DS.Model.extend(EmberValidations, Ember.Evented, {
  /**
    Stored canonical `belongsTo` relationships.

    @property _canonicalBelongsTo
    @type Object
    @private
  */
  _canonicalBelongsTo: Ember.computed(() => ({})),

  /**
    Model validation rules.

    @property validations
    @type Object
    @default {}
  */
  validations: {},

  /**
    Flag that indicates sync up process of model is processing.

    @property isSyncingUp
    @type Boolean
    @default false
  */
  isSyncingUp: false,

  /**
    Flag that indicates model is created during sync up process.

    @property isCreatedDuringSyncUp
    @type Boolean
    @default false
  */
  isCreatedDuringSyncUp: false,

  /**
    Flag that indicates model is updated last time during sync up process.

    @property isCreatedDuringSyncUp
    @type Boolean
    @default false
  */
  isUpdatedDuringSyncUp: false,

  /**
    Flag that indicates model is destroyed during sync up process.

    @property isCreatedDuringSyncUp
    @type Boolean
    @default false
  */
  isDestroyedDuringSyncUp: false,

  /**
    Checks that model satisfies validation rules defined in 'validations' property.

    @method validate
    @param {Object} [options] Method options
    @param {Boolean} [options.validateDeleted = true] Flag: indicates whether to validate model, if it is deleted, or not
    @return {Promise} A promise that will be resolved if model satisfies validation rules defined in 'validations' property
  */
  validate(options) {
    options = Ember.merge({ validateDeleted: true }, options || {});
    if (options.validateDeleted === false && this.get('isDeleted')) {
      // Return resolved promise, because validation is unnecessary for deleted model.
      return new Ember.RSVP.Promise((resolve) => {
        resolve();
      });
    }

    // Validate model.
    let validationPromises = {
      base: this._super(options)
    };

    let hasManyRelationships = Ember.A();
    this.eachRelationship((name, attrs) => {
      if (attrs.kind === 'hasMany') {
        hasManyRelationships.pushObject(attrs.key);
      }
    });

    // Validate hasMany relationships.
    hasManyRelationships.forEach((relationshipName) => {
      let details = this.get(relationshipName);
      if (!Ember.isArray(details)) {
        details = Ember.A();
      }

      details.forEach((detailModel, i) => {
        validationPromises[relationshipName + '.' + i] = detailModel.validate(options);
      });
    });

    return new Ember.RSVP.Promise((resolve, reject) => {
      Ember.RSVP.hash(validationPromises).then((hash) => {
        resolve(this.get('errors'));
      }).catch((reason) => {
        reject(this.get('errors'));
      });
    });
  },

  /**
    Triggers model's 'preSave' event & allows to execute some additional async logic before model will be saved.

    @method beforeSave

    @param {Object} [options] Method options
    @param {Boolean} [options.softSave = false] Flag: indicates whether following 'save' will be soft
    (without sending a request to server) or not
    @param {Promise[]} [options.promises] Array to which 'preSave' event handlers could add some asynchronous operations promises
    @return {Promise} A promise that will be resolved after all 'preSave' event handlers promises will be resolved
  */
  beforeSave(options) {
    options = Ember.merge({ softSave: false, promises: [] }, options || {});

    return new Ember.RSVP.Promise((resolve, reject) => {
      // Trigger 'preSave' event, and  give its handlers possibility to run some 'preSave' asynchronous logic,
      // by adding it's promises to options.promises array.
      this.trigger('preSave', options);

      // Promises array could be totally changed in 'preSave' event handlers, we should prevent possible errors.
      options.promises = Ember.isArray(options.promises) ? options.promises : [];
      options.promises = options.promises.filter(function(item) {
        return item instanceof Ember.RSVP.Promise;
      });

      Ember.RSVP.all(options.promises).then(values => {
        resolve(values);
      }).catch(reason => {
        reject(reason);
      });
    });
  },

  /**
    Validates model, triggers 'preSave' event, and finally saves model.

    @method save

    @param {Object} [options] Method options
    @param {Boolean} [options.softSave = false] Flag: indicates whether following 'save' will be soft
    (without sending a request to server) or not
    @return {Promise} A promise that will be resolved after model will be successfully saved
  */
  save(options) {
    options = Ember.merge({ softSave: false }, options || {});

    return new Ember.RSVP.Promise((resolve, reject) => {
      // If we are updating while syncing up then checking of validation rules should be skipped
      // because they can be violated by unfilled fields of model.
      let promise = this.get('isSyncingUp') && this.get('dirtyType') === 'updated' ?
        Ember.RSVP.resolve() : this.validate({ validateDeleted: false });
      promise.then(() => this.beforeSave(options)).then(() => {
        // Call to base class 'save' method with right context.
        // The problem is that call to current save method will be already finished,
        // and traditional _this._super will point to something else, but not to DS.Model 'save' method,
        // so there is no other way, except to call it through the base class prototype.
        if (!options.softSave) {
          return DS.Model.prototype.save.call(this, options);
        }
      }).then(value => {
        // Assuming that record is not updated during sync up;
        this.set('isUpdatedDuringSyncUp', false);

        // Model validation was successful (model is valid or deleted),
        // all 'preSave' event promises has been successfully resolved,
        // finally model has been successfully saved,
        // so we can resolve 'save' promise.
        resolve(value);
      }).catch(reason => {
        // Any of 'validate', 'beforeSave' or 'save' promises has been rejected,
        // so we should reject 'save' promise.
        reject(reason);
      });
    });
  },

  /**
    Turns model into 'updated.uncommitted' state.

    Transition into the `updated.uncommitted` state
    if the model in the `saved` state (no local changes).
    Alternative: this.get('currentState').becomeDirty();

    @method makeDirty
  */
  makeDirty() {
    this.send('becomeDirty');
  },

  /**
    Return object with changes.

    Object will have structure:
    * key - is name relationships that has changed
      * array - include two array, array with index `0` this old values, array with index `1` this new values.


    @example
      ```javascript
      {
        key: [
          [oldValues],
          [newValues],
        ],
      }
      ```

    @method changedHasMany
    @return {Object} Object with changes, empty object if no change.
  */
  changedHasMany() {
    let changedHasMany = {};
    this.eachRelationship((key, { kind }) => {
      if (kind === 'hasMany') {
        if (this.get(key).filterBy('hasDirtyAttributes', true).length) {
          changedHasMany[key] = [
            this.get(`${key}.canonicalState`).map(internalModel => internalModel ? internalModel.record : undefined),
            this.get(`${key}.currentState`).map(internalModel => internalModel ? internalModel.record : undefined),
          ];
        }
      }
    });
    return changedHasMany;
  },

  /**
    Rollback changes for `hasMany` relationships.

    @method rollbackHasMany
    @param {String} [forOnlyKey] If specified, it is rollback invoked for relationship with this key.
  */
  rollbackHasMany(forOnlyKey) {
    this.eachRelationship((key, { kind }) => {
      if (kind === 'hasMany' && (!forOnlyKey || forOnlyKey === key)) {
        if (this.get(key).filterBy('hasDirtyAttributes', true).length) {
          [this.get(`${key}.canonicalState`), this.get(`${key}.currentState`)].forEach((state, i) => {
            let records = state.map(internalModel => internalModel.record);
            records.forEach((record) => {
              record.rollbackAll();
            });
            if (i === 0) {
              this.set(key, records);
            }
          });
        }
      }
    });
  },

  /**
    Сheck whether there is a changed `belongsTo` relationships.

    @method hasChangedBelongsTo
    @return {Boolean} Returns `true` if `belongsTo` relationships have changed, else `false`.
  */
  hasChangedBelongsTo() {
    let hasChangedBelongsTo = false;
    let changedBelongsTo = this.changedBelongsTo();
    for (let changes in changedBelongsTo) {
      if (changedBelongsTo.hasOwnProperty(changes)) {
        let [oldValue, newValue] = changedBelongsTo[changes];
        let oldValueId = oldValue ? oldValue.get('id') : null;
        let newValueId = newValue ? newValue.get('id') : null;
        if (oldValue !== newValue || oldValueId !== newValueId) {
          hasChangedBelongsTo = true;
          break;
        }
      }
    }

    return hasChangedBelongsTo;
  },

  /**
    Return object with changes.

    Object will have structure:
    * key - is name relationships that has changed
      * array - include two items, old value, with index `0`, and new value, with index `1`.

    @example
      ```javascript
      {
        key: [oldValue, newValue],
      }
      ```

    @method changedBelongsTo
    @return {Object} Object with changes, empty object if no change.
  */
  changedBelongsTo() {
    let changedBelongsTo = {};
    this.eachRelationship((key, { kind }) => {
      if (kind === 'belongsTo') {
        let current = this.get(key);
        let canonical = this.get(`_canonicalBelongsTo.${key}`) || null;
        if (current !== canonical) {
          changedBelongsTo[key] = [canonical, current];
        }
      }
    });
    return changedBelongsTo;
  },

  /**
    Rollback changes for `belongsTo` relationships.

    @method rollbackBelongsTo
    @param {String} [forOnlyKey] If specified, it is rollback invoked for relationship with this key.
  */
  rollbackBelongsTo(forOnlyKey) {
    this.eachRelationship((key, { kind, options }) => {
      if (kind === 'belongsTo' && (!forOnlyKey || forOnlyKey === key)) {
        let current = this.get(key);
        let canonical = this.get(`_canonicalBelongsTo.${key}`) || null;
        if (current !== canonical) {
          if (options.inverse && options.inverse !== key) {
            if (current && current.rollbackBelongsTo) {
              current.rollbackBelongsTo(options.inverse);
            }

            if (canonical && canonical.rollbackBelongsTo) {
              canonical.rollbackBelongsTo(options.inverse);
            }
          }

          this.set(key, canonical);
        }
      }
    });
  },

  /**
    Rollback changes for all relationships.

    @method rollbackRelationships
  */
  rollbackRelationships() {
    this.rollbackBelongsTo();
    this.rollbackHasMany();
  },

  /**
    Rollback all changes.

    @method rollbackAll
  */
  rollbackAll() {
    this.rollbackRelationships();
    this.rollbackAttributes();
  },

  /**
    Initializes model.
  */
  init() {
    this._super(...arguments);

    // Attach validation observers for hasMany relationships.
    this.eachRelationship((name, attrs) => {
      if (attrs.kind !== 'hasMany') {
        return;
      }

      let detailsName = attrs.key;
      Ember.addObserver(this, `${detailsName}.[]`, this, this._onChangeHasManyRelationship);
      Ember.addObserver(this, `${detailsName}.@each.isDeleted`, this, this._onChangeHasManyRelationship);
    });
  },

  /**
    Fired when the record is loaded from the server.
    [More info](http://emberjs.com/api/data/classes/DS.Model.html#event_didLoad).

    @method didLoad
  */
  didLoad() {
    this._super(...arguments);
    this._saveCanonicalBelongsTo();
  },

  /**
    Fired when the record is updated.
    [More info](http://emberjs.com/api/data/classes/DS.Model.html#event_didUpdate).

    @method didUpdate
  */
  didUpdate() {
    this._super(...arguments);
    this._saveCanonicalBelongsTo();
  },

  /**
    Fired when the record is created.
    [More info](http://emberjs.com/api/data/classes/DS.Model.html#event_didCreate).

    @method didCreate
  */
  didCreate() {
    this._super(...arguments);
    this._saveCanonicalBelongsTo();
  },

  /**
    Destroys model.
  */
  willDestroy() {
    this._super(...arguments);

    // Attach validation observers for hasMany relationships.
    this.eachRelationship((name, attrs) => {
      if (attrs.kind !== 'hasMany') {
        return;
      }

      let detailsName = attrs.key;
      Ember.removeObserver(this, `${detailsName}.[]`, this, this._onChangeHasManyRelationship);
      Ember.removeObserver(this, `${detailsName}.@each.isDeleted`, this, this._onChangeHasManyRelationship);
    });
  },

  /**
    Observes & handles changes in each hasMany relationship.

    @method _onChangeHasManyRelationship
    @param {Object} changedObject Reference to changed object.
    @param {changedPropertyPath} changedPropertyPath Path to changed property.
    @private
  */
  _onChangeHasManyRelationship(changedObject, changedPropertyPath) {
    Ember.run.once(this, '_aggregateHasManyRelationshipValidationErrors', changedObject, changedPropertyPath);
  },

  /**
    Aggregates validation error messages for hasMany relationships.

    @method _aggregateHasManyRelationshipValidationErrors
    @param {Object} changedObject Reference to changed object.
    @param {changedPropertyPath} changedPropertyPath Path to changed property.
    @private
  */
  _aggregateHasManyRelationshipValidationErrors(changedObject, changedPropertyPath) {
    // Retrieve aggregator's validation errors object.
    let errors = Ember.get(this, 'errors');

    let detailsName = changedPropertyPath.split('.')[0];
    let details = Ember.get(this, detailsName);
    if (!Ember.isArray(details)) {
      return;
    }

    // Collect each detail's errors object into single array of error messages.
    let detailsErrorMessages = Ember.A();
    details.forEach((detail, i) => {
      let detailErrors = Ember.get(detail, 'errors');

      for (let detailPropertyName in detailErrors) {
        let detailPropertyErrorMessages = detailErrors[detailPropertyName];
        if (detailErrors.hasOwnProperty(detailPropertyName) && Ember.isArray(detailPropertyErrorMessages)) {
          detailPropertyErrorMessages.forEach((detailPropertyErrorMessage) => {
            Ember.removeObserver(this, `${detailsName}.@each.${detailPropertyName}`, this, this._onChangeHasManyRelationship);

            if (!Ember.get(detail, 'isDeleted')) {
              Ember.addObserver(this, `${detailsName}.@each.${detailPropertyName}`, this, this._onChangeHasManyRelationship);
              detailsErrorMessages.pushObject(detailPropertyErrorMessage);
            }
          });
        }
      }
    });

    // Remember array of error messages in aggregator's errors object.
    Ember.set(errors, detailsName, detailsErrorMessages);
  },

  /**
    Set each `belongsTo` relationship, observer, that save canonical state.

    @method _saveCanonicalBelongsTo
    @private
  */
  _saveCanonicalBelongsTo() {
    let _this = this;
    _this.eachRelationship((key, { kind, options }) => {
      if (kind === 'belongsTo') {
        if (options.async === false) {
          let belongsToValue = _this.get(key);
          if (belongsToValue || _this.get('_canonicalBelongsTo')[key]) {
            _this.get('_canonicalBelongsTo')[key] = belongsToValue;
          } else {
            _this.addObserver(key, _this, _this._saveBelongsToObserver);
          }
        } else {
          _this.get(key).then((record) => {
            _this.get('_canonicalBelongsTo')[key] = record;
          });
        }
      }
    });
  },

  /**
    Save canonical state for `belongsTo` relationships.

    @method _saveBelongsToObserver
    @private

    @param {DS.Model} sender
    @param {String} key
  */
  _saveBelongsToObserver(sender, key) {
    sender.get('_canonicalBelongsTo')[key] = sender.get(key);
    sender.removeObserver(key, this, this._saveBelongsToObserver);
  },
});

Model.reopenClass({
  /**
   * Defined projections for current model type.
   *
   * @property projections
   * @type Ember.Object
   * @default null
   * @public
   * @static
   */
  projections: null,

  /**
    Flag that indicates model id type.

    @property isType
    @type string
    @default 'guid'
  */
  idType: 'guid',

  /**
    The namespace in which this model is defined.

    @property namespace
    @type string
    @default ''
    @static
  */
  namespace: '',

  /**
   * Defines idType for specified model type.
   *
   * @method defineIdType
   * @param {String} newIdType Model id type.
   * @public
   * @static
   */
  defineIdType: function (newIdType) {
    this.reopenClass({
      idType: newIdType,
    });
  },

  /**
   * Defines projection for specified model type.
   *
   * @method defineProjection
   * @param {String} projectionName Projection name, eg 'EmployeeE'.
   * @param {String} modelName The name of the model type.
   * @param {Object} attributes Projection attributes.
   * @return {Object} Created projection.
   * @public
   * @static
   */
  defineProjection: function (projectionName, modelName, attributes) {
    let proj = createProj(modelName, attributes, projectionName);

    if (!this.projections) {
      this.reopenClass({
        projections: Ember.Object.create({ modelName }),
      });
    } else if (this.projections.get('modelName') !== modelName) {
      let baseProjections = Ember.merge({}, this.projections);
      this.reopenClass({
        projections: Ember.Object.create(Ember.merge(baseProjections, { modelName })),
      });
    }

    this.projections.set(projectionName, proj);
    return proj;
  },

  /**
   * Parent model type name.
   *
   * @property _parentModelName
   * @type String
   * @default null
   * @private
   * @static
   */
  _parentModelName: null
});

export default Model;
