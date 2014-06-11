// This is where all the fun happens. Please take a moment to read through this
// file to acquaint yourself with the functionality provided and the
// implementation thereof.

var cheerio = require("cheerio"),
    he = require("he"),
    filesize_parser = require("filesize-parser"),
    request = require("request"),
    url = require("url");

// Main entry point. This is the client class. It takes a single optional
// argument, being the base URL of the NyaaTorrents site you want to interact
// with. If left out, it will default to "http://www.nyaa.se/".
var NyaaTorrents = module.exports = function NyaaTorrents(options) {
  options = options || {};

  this.baseUrl = options.baseUrl || "http://www.nyaa.se/";
  this.username = options.username;
  this.password = options.password;

  this.cookies = request.jar();
};

NyaaTorrents.prototype.login = function login(cb) {
  var uri = url.parse(this.baseUrl, true);

  uri.query.page = "login";

  var options = {
    uri: url.format(uri),
    form: {
      method: 1,
      login: this.username,
      password: this.password,
      submit: "Submit",
    },
    jar: this.cookies,
  };

  request.post(options, function(err, res, data) {
    if (err) {
      return cb(err);
    }

    if (data.indexOf("Login successful") === -1) {
      return cb(Error("login was not successful"));
    }

    if (data.indexOf("Login failed!") !== -1) {
      return cb(Error("login failed; incorrect password?"));
    }

    return cb();
  });
};

NyaaTorrents.prototype.upload = function upload(options, cb) {
  if (!options.category) {
    return cb(Error("a category is required"));
  }

  if (options.category.match(/^\d+_\d+$/)) {
    options.catid = options.category;
  }

  var uri = url.parse(this.baseUrl, true);

  uri.query.page = "upload";

  var config = {
    uri: url.format(uri),
    jar: this.cookies,
  };

  var req = request.post(config, function(err, res, data) {
    if (err) {
      return cb(err);
    }

    if (res.statusCode < 200 || res.statusCode >= 300) {
      return cb(Error("invalid status code; expected 2xx but got " + res.statusCode));
    }

    if (!res.headers["record-id"]) {
      return cb(Error("couldn't find record-id header"));
    }

    return cb(null, {id: res.headers["record-id"]});
  });

  var form = req.form();

  form.append("rules", "1");
  form.append("submit", "Upload");

  ["name", "torrenturl", "catid", "info", "description"].forEach(function(k) {
    form.append(k, options[k] || "");
  });

  ["hidden", "remake", "anonymous"].forEach(function(k) {
    if (options[k]) {
      form.append(k, "1");
    }
  });

  if (options.torrent) {
    form.append("torrent", options.torrent, {
      filename: "uploaded.torrent",
      contentType: "application/x-bittorrent",
    });
  }
};

NyaaTorrents.prototype.manage = function manage(options, cb) {
  var uri = url.parse(this.baseUrl, true);

  uri.query.page = "manage";
  uri.query.op = 1;

  var form = {
    tid: options.id,
    mod: options.mod,
    submit: "Submit",
  };

  form[["tid", options.id].join("-")] = options.id;

  if (options.category) {
    form.move = options.category;
  }

  var config = {
    uri: url.format(uri),
    form: form,
    jar: this.cookies,
  };

  request.post(config, function(err, res, data) {
    if (err) {
      return cb(err);
    }

    if (res.statusCode !== 200) {
      return cb(Error("invalid status code; expected 200 but got " + res.statusCode));
    }

    var $ = cheerio.load(data);

    var content = $($(".content")[0]).text();

    if (content.indexOf("You will be redirected") === -1) {
      return cb(Error(content.trim()));
    }

    var message = content.replace(/You will be redirected.+$/, "").trim();

    if (message === "Access restricted.") {
      return cb(Error(message));
    }

    return cb(null, {message: message}, data);
  });
};

NyaaTorrents.prototype.remove = function remove(id, cb) {
  return this.manage({mod: 1, id: id}, cb);
};

NyaaTorrents.prototype.hide = function hide(id, cb) {
  return this.manage({mod: 2, id: id}, cb);
};

NyaaTorrents.prototype.unhide = function unhide(id, cb) {
  return this.manage({mod: 3, id: id}, cb);
};

NyaaTorrents.prototype.markRemake = function markRemake(id, cb) {
  return this.manage({mod: 4, id: id}, cb);
};

NyaaTorrents.prototype.unmarkRemake = function unmarkRemake(id, cb) {
  return this.manage({mod: 5, id: id}, cb);
};

// 6 through 13 all return "access restricted" - I'm guessing they're for things
// like trusted status and other admin/moderator-only actions.

NyaaTorrents.prototype.move = function move(id, category, cb) {
  return this.manage({mod: 14, id: id, category: category}, cb);
};

NyaaTorrents.prototype.addComment = function addComment(id, content, cb) {
  var uri = url.parse(this.baseUrl, true);

  uri.query.page = "view";
  uri.query.tid = id;
  uri.query.post = 1;

  var config = {
    uri: url.format(uri),
    form: {
      message: content,
      submit: "Submit",
    },
    jar: this.cookies,
  };

  request.post(config, function(err, res, data) {
    if (err) {
      return cb(err);
    }

    if (res.statusCode !== 303) {
      return cb(Error("invalid status code; expected 303 but got " + res.statusCode));
    }

    if (!res.headers.location) {
      return cb(Error("couldn't find location header to get comment ID"));
    }

    if (!res.headers.location.match(/#/)) {
      return cb(Error("comment not posted; maybe duplicate?"));
    }

    var commentId = res.headers.location.split("#").pop();

    if (!commentId || !commentId.match(/^c\d+$/)) {
      return cb(Error("malformed location header; couldn't find comment ID"));
    }

    return cb(null, {
      commentId: commentId.replace(/^c/, ""),
    });
  });
};

// Search method. This maps pretty transparently to [the search page](http://www.nyaa.se/?page=search),
// passing through the `query` hash verbatim as url parameters. If the `query`
// argument is left out, you'll get a list of the latest torrents as you will
// have provided no filter arguments. The second argument is a callback that
// will be called on completion with `err` and `results` arguments. `err` will
// be null in the case of success.
NyaaTorrents.prototype.search = function search(query, cb) {
  var uri = url.parse(this.baseUrl, true);

  if (typeof query === "function") {
    cb = query;
    query = null;
  }

  query = query || {};

  for (var k in query) {
    uri.query[k] = query[k];
  }

  uri.query.page = "search";

  request({uri: url.format(uri), jar: this.cookies}, function(err, res, data) {
    if (err) {
      return cb(err);
    }

    var $ = cheerio.load(data);

    // Our results are found in a table with a predictable structure. Some of
    // this code might be fragile - expect updates here to improve performance
    // or stability. PATCHES WELCOME LOL.
    var torrents = Array.prototype.slice.apply($("table.tlist .tlistrow")).map(function(row) {
      var obj = {};

      // If we can't find the download link or the category image, we just give
      // up on this row. It shouldn't happen, but it might indicate bad markup
      // or unhandled stuff.

      var download_link = $(row).find(".tlistdownload a")[0];
      if (!download_link) {
        return null;
      }

      var category_image = $(row).find(".tlisticon a")[0];
      if (!category_image) {
        return null;
      }

      obj.id = parseInt(download_link.attribs.href.trim().replace(/^.+?(\d+)$/, "$1"), 10);
      obj.href = he.decode(download_link.attribs.href);
      obj.name = $(row).find(".tlistname").text().trim();
      obj.categories = he.decode(category_image.attribs.title).trim().split(/ >> /g).map(function(e) { return e.toLowerCase().trim().replace(/\s+/g, "-"); });
      obj.flags = row.attribs.class.split(/ /g).filter(function(e) { return e !== "tlistrow"; });
      obj.size = filesize_parser($(row).find(".tlistsize").text().trim());
      obj.seeds = parseInt($(row).find(".tlistsn").text().trim(), 10);
      obj.leeches = parseInt($(row).find(".tlistln").text().trim(), 10);
      obj.downloads = parseInt($(row).find(".tlistdn").text().trim(), 10);
      obj.comments = parseInt($(row).find(".tlistmn").text().trim(), 10);

      return obj;
    }).filter(function(e) {
      return e !== null;
    });

    return cb(null, torrents);
  });
};

// This method gets the information about a specific torrent, identified by ID.
// First argument is a number or a string containing the torrent ID, second is
// a callback to be called on completion with `err` and `result` arguments. As
// with the previous method, `err` will be null in the case of success.
NyaaTorrents.prototype.get = function get(id, cb) {
  var uri = url.parse(this.baseUrl, true);

  uri.query.page = "torrentinfo";
  uri.query.tid = id;

  request({uri: uri, jar: this.cookies}, function(err, res, data) {
    if (err) {
      return cb(err);
    }

    var $ = cheerio.load(data);

    var content = $(".content")[0];

    // When there's an error, it's displayed as text in the spot where the page
    // content would usually go. We pass that through as-is to the user.
    if (content.children.length === 1 && content.children[0].type === "text") {
      return cb(Error(he.decode(content.children[0].data).trim()));
    }

    var obj = {};

    // These are things like "trusted" or "remake". See [the NyaaTorrents manual](http://www.nyaa.se/?page=manual)
    // for more information.
    obj.flags = content.attribs.class.split(/ /g).filter(function(e) { return e !== "content"; });

    // Categories. Super simple stuff. These are lower-cased, hyphen-delimited,
    // human-readable strings.
    obj.categories = Array.prototype.slice.apply($(content).find("td.viewinfocategory a")).map(function(e) {
      return $(e).text().toLowerCase().trim().replace(/\s+/g, "-");
    });

    // The torrent details are displayed in a wonky table thing. Each field is
    // displayed as a pair of cells, with the former containing the field name
    // and the latter displaying the field value. Based on the name, we do some
    // field-specific transformations on some fields. Others just get passed on
    // through as text.
    var tds = $(content).find("table.viewtable tr > td");

    for (var i=0;i<tds.length;i+=2) {
      // This is the field name.
      var k = $(tds[i]).text().replace(/:$/, "").replace(/\s+/g, "_").trim().toLowerCase();

      switch (k) {
        // "information" is basically synonymous with "website"
        case "information":
          var link = $(tds[i+1]).find("a");
          if (link.length)
            obj.website = link[0].attribs.href;
          break;

        // "file_size" is exactly what it sounds like, and it has to be turned
        // into a real number.
        case "file_size":
          obj.size = filesize_parser($(tds[i+1]).text().trim());
          break;

        // This is the user that submitted the torrent. We parse it out into the
        // separate `id` and `name` values.
        case "submitter":
          obj.user = {
            id: parseInt($(tds[i+1]).find("a")[0].attribs.href.replace(/^.+?(\d+)$/, "$1"), 10),
            name: $(tds[i+1]).text(),
          };
          break;

        // This might not work on anything except V8. Will have to check that
        // if this ever works on anything except node.
        case "date":
          obj.date = new Date($(tds[i+1]).text());
          break;

        // The "stardom" field just displays the number of people who've set
        // themselves as "fans" of this torrent. I don't really know what the
        // deal is here.
        case "stardom":
          obj.fans = parseInt($(tds[i+1]).text().replace(/^.+(\d+).+$/, "$1"), 10);
          break;

        // All these need to be turned to real numbers instead of strings.
        case "seeders":
        case "leechers":
        case "downloads":
          obj[k] = parseInt($(tds[i+1]).text(), 10);
          break;

        // Anything not otherwise handled is just sent through as text.
        default:
          obj[k] = $(tds[i+1]).text();
      }
    }

    // This is the torrent ID... You already have it, but this seemed like a
    // good idea for completeness.
    obj.id = parseInt($(content).find("div.viewdownloadbutton a")[0].attribs.href.replace(/^.+?(\d+)$/, "$1"), 10);

    // This is a chunk of HTML. You'll probably want to turn it into some other
    // kind of markup.
    obj.description = $($(content).find("div.viewdescription")[0]).html();

    // Yay comments!
    obj.comments = [];

    var commentElements = $(content).find(".comment");

    // Each of these will have a blob of HTML as the "content". Same deal as
    // above with the description.
    for (var i=0;i<commentElements.length;++i) {
      obj.comments.push({
        id: parseInt(commentElements[i].attribs.id.replace(/[^0-9]/g, ""), 10),
        time: $(commentElements[i]).find(".chead").html().split(/<br>/).pop(),
        user: {
          id: parseInt($(commentElements[i]).find(".chead > a")[0].attribs.href.replace(/^.+?([0-9])$/, "$1"), 10),
          name: $(commentElements[i]).find(".chead > a > span").text(),
        },
        content: $(commentElements[i]).find(".cmain").html(),
      });
    }

    return cb(null, obj);
  });
};
