"use strict";

const DEBUG = true;

class DocsStorage {
  constructor() {
    this.MAX_DOCS = 100;
    this.docList = {};
    this.nextIndex = 0;
  }

  // given a url, title, document type, and an ID, track based on ID
  // keep an index field, which is equivalent to "last accessed" counter
  // (incrementing instead of time so as not to be dependent on clock
  // sync with multiple machines).
  // When adding a doc, if we already have MAX_DOCS, delete the one with
  // lowest ("oldest") index
  addDoc(url, title, type, id) {
    var docEntry;
    if (id in this.docList) {
      docEntry = this.docList[id];
    } else {
      if (Object.keys(this.docList).length >= this.MAX_DOCS) {
        var oldestIndex = this.nextIndex;
        var oldestId;
        for (var i in this.docList) {
          if (this.docList[i].index < oldestIndex) {
            oldestIndex = this.docList[i].index;
            oldestId = i;
          }
        }
        delete this.docList[oldestId];
      }
      docEntry = {};
      this.docList[id] = docEntry;
    }
    docEntry.url = url;
    docEntry.title = stripTitle(title);
    docEntry.type = type;
    docEntry.id = id;
    docEntry.index = this.nextIndex;
    this.nextIndex += 1;
    return docEntry;
  }
  
  saveDocs() {
    
  }

  recentIds() {
    const docList = this.docList;
    const ids = Object.keys(docList);
    ids.sort(function descendingIndices(a,b){ return docList[b].index - docList[a].index; });
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

function entryMatchesQuery(entry, q) {
  const titleLC = entry.title.toLowerCase();
  const terms = q.toLowerCase().split(/\s+/);
  return terms.reduce(function(matchSoFar, term) {
      if (!matchSoFar) {
        return false;
      } else {
        return new RegExp('\\b'+escapeRegExp(term)).test(titleLC);
      }
    }, true);
}

const docs = new DocsStorage();

const MAX_RESULTS = 5;

chrome.omnibox.onInputChanged.addListener(function inputChanged(text, suggest) {
  suggest(docs.recentIds()
    .map(function(id) { return docs.docList[id]; })
    .filter(function(entry) { return entryMatchesQuery(entry, text); })
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
  const matchingEntries = docs.recentIds()
    .map(function(id) { return docs.docList[id]; })
    .filter(function(entry) { return entryMatchesQuery(entry, text); });
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
    trackUrl(url, title, m[1], m[2])
  }
}

// Load all matching tabs at startup (mostly useful for during development)
function atStartup() {
  chrome.tabs.query({ "url": "*://docs.google.com/*" }, function(tabs) {
    tabs.forEach(function(tab) { addTab(tab.url, tab.title); });
  });
};
atStartup();

function trackUrl(url, title, type, id) {
  docs.addDoc(url, title, type, id);
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

