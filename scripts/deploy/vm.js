const
aws = require('./aws.js');
jsel = require('JSONSelect'),
key = require('./key.js'),
sec = require('./sec.js');

const BROWSERID_TEMPLATE_IMAGE_ID = 'ami-7fc21316';

function extractInstanceDeets(horribleBlob) {
  var instance = {};
  ["instanceId", "imageId", "instanceState", "dnsName", "keyName", "instanceType",
   "ipAddress"].forEach(function(key) {
     if (horribleBlob[key]) instance[key] = horribleBlob[key];
   });
  var name = jsel.match('.tagSet :has(.key:val("Name")) > .value', horribleBlob);
  if (name.length) instance.name = name[0];
  return instance;
}

exports.list = function(cb) {
  aws.call('DescribeInstances', {}, function(result) {
    var instances = [];
    jsel.forEach(
      '.instancesSet > .item:has(.instanceState .name:val("running"))',
      result, function(item) {
        instances.push(extractInstanceDeets(item));
      });
    cb(null, instances);
  });
};

function returnSingleImageInfo(result, cb) {
  if (!result) return cb('no results from ec2 api');
  try { return cb(result.Errors.Error.Message); } catch(e) {};
  try { 
    result = jsel.match('.instancesSet > .item', result)[0];
    cb(null, extractInstanceDeets(result));
  } catch(e) {
    return cb("couldn't extract new instance details from ec2 response: " + e);
  } 
}

exports.startImage = function(cb) {
  key.getName(function(err, keyName) {
    if (err) return cb(err);
    sec.getName(function(err, groupName) {
      if (err) return cb(err);
      aws.call('RunInstances', {
        ImageId: BROWSERID_TEMPLATE_IMAGE_ID,
        KeyName: keyName,
        SecurityGroup: groupName,
        InstanceType: 't1.micro',
        MinCount: 1,
        MaxCount: 1
      }, function (result) {
        returnSingleImageInfo(result, cb);
      });
    });
  });
};

exports.waitForInstance = function(id, cb) {
  aws.call('DescribeInstanceStatus', {
    InstanceId: id
  }, function(r) {
    if (!r) return cb('no response from ec2');
    if (!r.instanceStatusSet) return cb('malformed response from ec2');
    if (Object.keys(r.instanceStatusSet).length) {
      var deets = extractInstanceDeets(r.instanceStatusSet.item);
      if (deets && deets.instanceState && deets.instanceState.name === 'running') {
        return aws.call('DescribeInstances', { InstanceId: id }, function(result) {
          returnSingleImageInfo(result, cb);
        });
      }
    }
    setTimeout(function(){ exports.waitForInstance(id, cb); }, 1000);
  });
};

exports.setName = function(id, name, cb) {
  name = 'browserid deployment (' + name + ')';

  aws.call('CreateTags', {
    "ResourceId.0": id,
    "Tag.0.Key": 'Name',
    "Tag.0.Value": name
  }, function(result) {
    if (result && result.return === 'true') return cb(null);
    try { return cb(result.Errors.Error.Message); } catch(e) {};
    return cb('unknown error setting instance name');
  });
};