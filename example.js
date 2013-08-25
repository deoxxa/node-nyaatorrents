#!/usr/bin/env node

var NT = require("./");

var nt = new NT("http://www.nyaa.eu/");

// The "anonymous" user has ID 0

nt.search({term: "rozen maiden"}, function(err, res) {
  if (err) {
    return console.warn(err);
  }

  console.log(JSON.stringify(res, null, 2));
});
