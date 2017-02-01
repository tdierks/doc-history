"use strict";

const DEBUG = true;

class DocsStorage {
  constructor() {
    this.MAX_DOCS = 100;
    this.docList = {};
  }

  addDoc(url, title, type, id, when, dirty = true) {
    var docEntry;
    if (id in this.docList) {
      docEntry = this.docList[id];
      // guard against old entries syncing when we have more recent access/info
      if (docEntry.when > when) {
        return docEntry;
      }
      // suppress extraneous storage writes for non-changes
      if (docEntry.title == title && docEntry.url == url && when - docEntry.when < 15000) {
        dirty = false;
      }
    } else {
      if (Object.keys(this.docList).length >= this.MAX_DOCS) {
        var oldestWhen = Date.now();
        var oldestId;
        for (var i in this.docList) {
          if (this.docList[i].when < oldestWhen) {
            oldestWhen = this.docList[i].when;
            oldestId = i;
          }
        }
        delete this.docList[oldestId];
      }
      docEntry = {};
      this.docList[id] = docEntry;
    }
    docEntry.url = url;
    docEntry.title = title;
    docEntry.type = type;
    docEntry.when = when;
    if (dirty) {
      this.storeEntry(id, docEntry);
    }
    return docEntry;
  }
  
  storeEntry(id, entry) {
    console.log("Storing", entry.title, "url", entry.url);
    const o = { };
    o[id] = entry;
    chrome.storage.sync.set(o);
  }

  loadFromStorage() {
    const now = Date.now();
    const thisDocs = this;
    chrome.storage.sync.get(null, function(items) {
      for (var id in items) {
        const qq = items[id];
        var when = qq.when;
        // guard against time travelers (would keep us from freshening, look too new)
        if (when > now) {
          when = now;
        }
        console.log("Adding", qq.title, "url", qq.url);
        thisDocs.addDoc(qq.url, qq.title, qq.type, id, when, false);
      }
    });
  }

  recentIds() {
    const docList = this.docList;
    const ids = Object.keys(docList);
    ids.sort(function descendingIndices(a,b){ return docList[b].when - docList[a].when; });
    return ids;
  }
}

const TITLE_PORTION_DOCS = new RegExp("^(.*?)( - Google [^ ]+)?$");

function stripTitle(title) {
  const m = TITLE_PORTION_DOCS.exec(title);
  if (m) {
    return m[1];
  } else {
    return title;
  }
}

function parseQuery(q) {
  return q.toLowerCase()
    .split(/\s+/)
    .map(function(term) {
      return new RegExp('(\\b|^|\\s)'+escapeRegExp(term))
    });
}

function entryMatchesQuery(entry, queryTerms) {
  const titleLC = entry.title.toLowerCase();
  // short-circuiting AND for "all terms match entry"
  return queryTerms.reduce(function(matchSoFar, qTerm) {
      return matchSoFar && qTerm.test(titleLC);
    }, true);
}

const docs = new DocsStorage();
docs.loadFromStorage();

const MAX_RESULTS = 5;

chrome.omnibox.onInputChanged.addListener(function inputChanged(text, suggest) {
  const parsedQuery = parseQuery(text);
  suggest(docs.recentIds()
    .map(function(id) { return docs.docList[id]; })
    .filter(function(entry) { return entryMatchesQuery(entry, parsedQuery); })
    .filter(function(entry, index) { return index < MAX_RESULTS; })
    .map(function(entry, index) {
        var t = escapeXml(entry.title);
        if (index > 0) {
          t = "<dim>" + t + "</dim>"
        }
        return {
          "content": entry.title,
          "description": t + " <url>" + escapeXml(entry.url) + "</url>"
        };
      })
    );
});

chrome.omnibox.onInputEntered.addListener(function inputEntered(text, disposition) {
  const parsedQuery = parseQuery(text);
  const matchingEntries = docs.recentIds()
    .map(function(id) { return docs.docList[id]; })
    .filter(function(entry) { return entryMatchesQuery(entry, parsedQuery); });
  if (matchingEntries.length == 0) {
    console.log("No match for", text);
    return;
  }
  const destEntry = matchingEntries[0];
  if (disposition == "currentTab") {
    chrome.tabs.update({"url": destEntry.url});
  } else {
    chrome.tabs.create({"active": (disposition=="newForegroundTab"), "url": destEntry.url});
  }
});

chrome.tabs.onUpdated.addListener(function tabUpdated(tabId, changeInfo, tab) {
  if ((changeInfo.status && changeInfo.status == "complete") || changeInfo.title) {
    addTab(tab.url, tab.title)
  }
});

// Group 1: document type (e.g. "document", "spreadsheets", "presentation")
// Group 2: document ID string (used for uniqueifying the map)
const MATCH_DOCS_URLS = new RegExp("^https://docs.google.com/([a-z]+)/d/([^/]+)/");

function addTab(url, title) {
  var m = MATCH_DOCS_URLS.exec(url);
  if (m) {
    console.log("Found doc with URL ", url, " title ", title);
    trackUrl(url, stripTitle(title), m[1], m[2], new Date())
  }
}

// Load all matching tabs at startup (mostly useful for during development)
function atStartup() {
  chrome.tabs.query({ "url": "*://docs.google.com/*" }, function(tabs) {
    tabs.forEach(function(tab) { addTab(tab.url, tab.title); });
  });
};
atStartup();

function trackUrl(url, title, type, id, when) {
  docs.addDoc(url, title, type, id, when);
  if (DEBUG) {
    updateDebugList();
  }
}

function updateDebugList() {
  const bkPage = chrome.extension.getBackgroundPage();
  const container = bkPage.document.getElementById("debug");
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
  const docList = docs.docList;
  docs.recentIds().forEach(function(id) {
    const entry = bkPage.document.createElement("div");
    const link = bkPage.document.createElement("a");
    link.setAttribute("href", docList[id].url);
    link.textContent = docList[id].title;
    entry.appendChild(link);
    container.appendChild(entry);
  });
}

function escapeXml(unsafe) {
  return unsafe.replace(/[<>&'"]/g, function (c) {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}

function escapeRegExp(string){
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

