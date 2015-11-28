const AWS = require('aws-sdk');
AWS.config.region = 'us-east-1';

const Async = require('async');
const Assert = require('assert');
const Hoek = require('hoek');
const EC2 = new AWS.EC2();

var internals = {};

internals.findSnapshotsWithTag = (volumeTag, callback) => {

  //Get list of volumes to snapshot
  const params = {
    Filters: [
      {
        Name: 'tag:lambda-snapshot-volumeTag',
        Values: [volumeTag],
      }
    ]
  };

  EC2.describeSnapshots(params, (error, result) => {

    if(error){
      return callback(error);
    }

    return callback(null, result.Snapshots);
  });
};
internals.removeSnapshotById = (id, callback) => {

};

/**
 * Queries for all volumes with requested volumetag
 * and creates a snapshot.
 */
internals.run = (options, cb) => {

  if(typeof options === 'function'){
    cb = options;
    options = {};
  }

  if(!options.volumeTag){
    options.volumeTag = 'lambda-snapshot';
  }

  Async.waterfall([

    (callback) => {

      //Get list of volumes to snapshot
      const params = {
        Filters: [
          {
            Name: 'tag-key',
            Values: [options.volumeTag]
          }
        ]
      };

      EC2.describeVolumes(params, callback);
    },

    (result, callback) => {

      //For each volume to snapshot, create the snapshot with
      //appropriate volumeId & description (pulled from tag value)
      Async.map(result.Volumes, (volume, mapCb) => {

        const VolumeId = volume.VolumeId;
        const Description = (() => {

          //Find value of volumeTag to be used for snapshot description.
          var tags = volume.Tags.filter((tag) => tag.Key === options.volumeTag);
          return tags[0].Value;
        })();

        const params = {
          VolumeId,
          Description
        };

        EC2.createSnapshot(params, mapCb);
      }, callback);
    },

    (snapshots, callback) => {

      //If no snapshots were found...
      if(!snapshots || !snapshots.length){
        return callback(new Error(`No snapshots with volumeTag '${options.volumeTag}' found`));
      }

      //Tag new snapshots with creation timestamp for future
      //cleanup logic
      const now = (new Date()).toISOString();
      const Tags = [
        {
          Key: 'lambda-snapshot-created',
          Value: now
        },
        {
          Key: 'lambda-snapshot-info',
          Value: `Automatically created by lambda-snapshot on ${now}`
        },
        {
          Key: 'lambda-snapshot-volumeTag',
          Value: options.volumeTag
        }
      ];

      const params = {
        Resources: snapshots.map( (snapshot) => snapshot.SnapshotId),
        Tags
      };

      EC2.createTags(params, callback);
    }], cb);
};

/**
 * Cleanup routine that retains snapshots newer than
 * {age} for a given volume tag.
 */
internals.trim = (tag, age, cb) => {

};

/**
 * Cleanup routine that only retains the newest
 * {count} snapshots for a given volume tag.
 */
internals.keep = (tag, count, cb) => {

  Assert(tag, 'keep requires volume tag');
  Assert(typeof count === 'number', 'keep requires a valid count value');
  Assert(typeof cb === 'function', 'keep requires a callback function');

  Async.waterfall([
    (callback) => {

      internals.findSnapshotsWithTag(tag, callback);
    },
    (result, callback) => {

      //Sort and return any elements to be removed.
      var sorted = result.sort((a, b) => new Date(b.StartTime) - new Date(a.StartTime));
      return callback(null, sorted.slice(count));
    },
    (toRemove, callback) => {

    }

    ], cb);


};


exports.run = internals.run;
exports.trim = internals.trim;
exports.keep = internals.keep;

