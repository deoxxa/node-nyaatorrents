NyaaTorrents for Node.JS
========================

About
-----

This is a light abstraction of the search and view functions of NyaaTorrents
(nyaa.eu, formerly nyaatorrents.info and nyaatorrents.org). It can currently
search the main site and the sukebei variant.

Features such as uploading or managing torrents are planned and will be added
after the read interface is stable.

Usage
-----

    #!/usr/bin/env node
    
    var nyaatorrents = new require("nyaatorrents").client("www.nyaa.eu", 80, "/");
    
    nyaatorrents.search({terms: "rozen maiden"}, function(err, ids) {
      if (err) {
        console.warn("[-] Error performing search: " + err.message);
        return;
      }
    
      ids.forEach(function(id) {
        tokyotosho.details(id, function(err, entry) {
          if (err) {
            console.warn("[-] Error fetching details for entry: " + err.message);
            return;
          }
    
          console.log(JSON.stringify(entry));
        });
      });
    });

U mad?
------

I can be contacted via email, github or a couple of different IRC networks. I
frequent some channels on rizon and freenode primarily, and if I'm not playing
silly games with my nick, you'll be able to find me there as "deoxxa".
