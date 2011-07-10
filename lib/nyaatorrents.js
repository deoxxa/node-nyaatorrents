require("datejs");

function tagToText(tag) {
  if (tag.type == "text") {
    return tag.data;
  } else if (tag.children != undefined) {
    return tag.children.map(tagToText).join(" ");
  } else if (tag.type == "tag" && tag.name == "br") {
    return "\n";
  } else {
    return "";
  }
}

var Client = function(host, port, path) {
  this.host = host;
  this.port = port;
  this.path = path;
}

// http://www.nyaa.eu/?page=torrentinfo&tid=123456
Client.prototype.constructDetailsPath = function(id) {
  return this.path + "?page=torrentinfo&tid=" + encodeURIComponent(id);
}

Client.prototype.details = function(id, cb) {
  // Get htmlparser object
  var htmlparser = require("htmlparser");
  // Construct handler
  var detail_handler = new htmlparser.DefaultHandler(
    function(err, dom) {
      if (err) {
        cb({message: "Error parsing HTML: " + err.message}, null);
        return;
      }

      // Check for site-specific errors
      // @TODO: This needs more error cases!
      require("soupselect").select(detail_handler.dom, "div.content").forEach(function(el) {
        if (el.children != undefined && el.children.length == 1) {
          var text = tagToText(el);
          if (text.match(/Torrent you are looking for does not appear to be in our database/)) { err = {message: "Entry not found"}; }
        }
      });

      if (err) {
        cb({message: "NyaaTorrents error: " + err.message}, null);
        return;
      }

      // Parse details
      // There's an odd table here that has to be parsed in an annoying way.
      // Improvements here are welcomed.
      // This seems to be par for the course with anime torrent sites, saw a
      // similarly weird thing on Tokyo Toshokan...
      var details = {id: null, title: null, category: null, description: null, website: null, time: null, size: null, user: {id: null, title: null}, meta: {remake: false, trusted: false, aplus: false}};
      var current_detail = "";
      require("soupselect").select(detail_handler.dom, "table.tinfotable td").forEach(function(el) {
        if (el != undefined && el.attribs != undefined && el.attribs.class != undefined && el.attribs.class.match(/thead/)) {
          current_detail = tagToText(el).replace(/:/, "");
        } else {
          if (current_detail == "Name") {
            details.title = require("ent").decode(tagToText(el));
          } else if (current_detail == "Date") {
            details.time = Date.parse(tagToText(el));
          } else if (current_detail == "Submitter" && el.children != undefined && el.children.length > 0 && el.children[0].attribs != undefined && el.children[0].attribs.href != undefined) {
            details.user.id = el.children[0].attribs.href.replace(/^[^0-9]+/, "");
            details.user.title = require("ent").decode(tagToText(el));
          } else if (current_detail == "Information") {
            details.website = require("ent").decode(tagToText(el));
          } else if (current_detail == "File size") {
            details.size = require("ent").decode(tagToText(el));
          }
        }
      });

      // Get ID
      require("soupselect").select(detail_handler.dom, "div.tinfodownloadbutton a").forEach(function(el) {
        if (el != undefined && el.attribs != undefined && el.attribs.href != undefined) {
          details.id = el.attribs.href.replace(/^[^0-9]+/, "");
        }
      });

      // Get category
      // This will end up looping through all available categories until it gets
      // to the end, so will always end up with the last valid category.
      require("soupselect").select(detail_handler.dom, "td.tinfocategory a").forEach(function (el) {
        if (el != undefined && el.attribs != undefined && el.attribs.href != undefined) {
          var cats = el.attribs.href.match(/([0-9]+)_([0-9]+)/);
          details.category = {main: cats[1], sub: cats[2], name: tagToText(el)};
        }
      });

      // Get description
      require("soupselect").select(detail_handler.dom, "div.tinfodescription").forEach(function(el) {
        details.description = tagToText(el).replace(/^[\s\n]*(.+?)[\s\n]*$/, "$1");
      });

      // Find out if it's a remake
      if (require("soupselect").select(detail_handler.dom, "div.content.remake").length > 0) { details.meta.remake = true; }
      // Find out if it's trusted
      if (require("soupselect").select(detail_handler.dom, "div.content.trusted").length > 0) { details.meta.trusted = true; }
      // Find out if it's A+
      if (require("soupselect").select(detail_handler.dom, "div.content.aplus").length > 0) { details.meta.aplus = true; }

      cb(null, details);
    },
    {ignoreWhitespace: true, verbose: false}
  );
  // Construct parser
  var detail_parser  = new htmlparser.Parser(detail_handler);

  // Make request
  require("http").get({host: this.host, port: this.port, path: this.constructDetailsPath(id)}, function(res) {
    if (res.statusCode != 200) {
      cb({message: "Error retrieving page, expected 200 status code but got " + res.statusCode}, null);
      return;
    }

    var body = "";
    res.on("data", function(chunk) { body += chunk; });
    res.on("end", function() {
      // Parse HTML
      detail_parser.parseComplete(body);
    });
  });
}

// http://www.nyaa.eu/?page=search&term=search-string&cats=0_0&minage=0&maxage=0&minsize=0&maxsize=0
Client.prototype.constructSearchPath = function(options) {
  var parameters = [];
  for (var k in options) {
    if (k == "terms")
      parameters.push("term=" + encodeURIComponent(options[k]));
    if (k == "category")
      parameters.push("cats=" + encodeURIComponent(options[k]));
    if (k == "size_min")
      parameters.push("minsize=" + encodeURIComponent(options[k]));
    if (k == "size_max")
      parameters.push("maxsize=" + encodeURIComponent(options[k]));
    if (k == "age_min")
      parameters.push("minage=" + encodeURIComponent(options[k]));
    if (k == "age_max")
      parameters.push("maxage=" + encodeURIComponent(options[k]));
  }
  return this.path + "?page=search&" + parameters.join("&");
}

Client.prototype.search = function(options, cb) {
  if (cb == undefined) { cb = options; options = null; }
  if (options == null || options == undefined || !options) { options = {}; }

  var htmlparser = require("htmlparser");
  // Construct handler
  var search_handler = new htmlparser.DefaultHandler(
    function(err, dom) {
      if (err) {
        cb({message: "Error parsing HTML: " + err.message}, null);
      }

      // Get entry IDs
      var ids = [];
      require("soupselect").select(search_handler.dom, "table.tlist tr.tlistrow td.tlistname a").forEach(function(link) {
        if (link.attribs.href.match(/torrentinfo/)) {
          ids.push({id: link.attribs.href.replace(/^[^0-9]+/, ""), name: require("ent").decode(tagToText(link))});
        }
      });

      cb(null, ids);
    },
    {ignoreWhitespace: true, verbose: false}
  );
  // Construct parser
  var search_parser  = new htmlparser.Parser(search_handler);

  require("http").get({host: this.host, port: this.port, path: this.constructSearchPath(options)}, function(res) {
    var body = "";
    res.on("data", function(chunk) { body += chunk; });
    res.on("end", function() {
      // Parse HTML
      search_parser.parseComplete(body);
    });
  });
}

exports.Client = Client;
