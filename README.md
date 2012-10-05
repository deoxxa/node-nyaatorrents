node-nyaatorrents
=================

Search and fetch torrent information from [NyaaTorrents](http://www.nyaa.eu/).

Overview
--------

This is a light abstraction of the search and view functions of NyaaTorrents
(nyaa.eu, formerly nyaatorrents.info and nyaatorrents.org). It can currently
search the main site and the sukebei variant.

Installation
------------

Available via [npm](http://npmjs.org/):

> $ npm install nyaatorrents

Or via git:

> $ git clone git://github.com/deoxxa/node-nyaatorrents.git node_modules/nyaatorrents

Usage
-----

```javascript
var NT = require("nyaatorrents"),
    nt = new NT("http://www.nyaa.eu");

nt.search({term: "rozen maiden"}, function(err, entries) {
  if (err) {
    return console.warn(err);
  }

  entries.forEach(function(entry) {
    nt.get(entry.id, function(err, entry) {
      if (err) {
        return console.warn(err);
      }

      console.log(JSON.stringify(entry));
    });
  });
});
```

License
-------

3-clause BSD. A copy is included with the source.

Contact
-------

* GitHub ([deoxxa](http://github.com/deoxxa))
* Twitter ([@deoxxa](http://twitter.com/deoxxa))
* ADN ([@deoxxa](https://alpha.app.net/deoxxa))
* Email ([deoxxa@fknsrs.biz](mailto:deoxxa@fknsrs.biz))
