// This is where all the fun happens. Please take a moment to read through this
// file to acquaint yourself with the functionality provided and the
// implementation thereof.

var cheerio = require("cheerio"),
    ent = require("ent"),
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

  uri.query.page = "torrents";

  request({uri: uri, jar: this.cookies}, function(err, res, data) {
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
      obj.href = ent.decode(download_link.attribs.href);
      obj.name = $(row).find(".tlistname").text().trim();
      obj.categories = ent.decode(category_image.attribs.title).trim().split(/ >> /g).map(function(e) { return e.toLowerCase().trim().replace(/\s+/g, "-"); });
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
      return cb(Error(ent.decode(content.children[0].data).trim()));
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
