Components.utils.import("resource://gre/modules/AddonManager.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "LanguageDetector",
  "resource:///modules/translation/LanguageDetector.jsm");

install = function () {};
uninstall = function () {};

startup = function () {
  switchAsIType.resetState();

  let windowEnumerator = Services.wm.getEnumerator("navigator:browser");
  while (windowEnumerator.hasMoreElements()) {
    switchAsIType.registerEventListener(windowEnumerator.getNext());
  }

  Services.ww.registerNotification(switchAsIType.onWindowOpened);
  AddonManager.addAddonListener(addonListener);
};

shutdown = function () {
  switchAsIType.resetState();

  AddonManager.removeAddonListener(addonListener);
  Services.ww.unregisterNotification(switchAsIType.onWindowClosed);
};

addonListener = {//whenever an addon is enabled/disabled we refresh the set of dictionaries
  onEnabled: function(addon) { switchAsIType.dictListUpToDate = false; },
  onDisabled: function(addon) { switchAsIType.dictListUpToDate = false; },
};

let switchAsIType = {
  kProcessWaitTime: 500, // wait time between two runs of the language detector in ms
  kTextLengthMax: 100, // maximum length of text passed to language detector

  checkJobs: new Map(),
  dictLanguages: new Map(),
  dictListUpToDate: false,
  windows: new Set(),

  getLanguage: function(target) {
    if (!(target instanceof Components.interfaces.nsIDOMNSEditableElement))
      return;

    target = target.QueryInterface(Components.interfaces.nsIDOMNSEditableElement);
    let editor = target.editor;
    if (!editor)
      return;

    let spellChecker = editor.getInlineSpellChecker(false);
    if (!spellChecker)
      return;//spell checking was never enabled
    if (!spellChecker.enableRealTimeSpell)
      return;//spell checking is disabled

    if (!target.value)
      return;

    let text = switchAsIType.getText(target.value, editor);

    if (!switchAsIType.dictListUpToDate) {
      switchAsIType.updateDictList();
      switchAsIType.dictListUpToDate = true;
    }

    LanguageDetector.detectLanguage(text).then(result => {
      // Bail if we're not confident.
      if (!result.confident) {
        return;
      }

      // The window might be gone by now.
      if (Components.utils.isDeadWrapper(editor)) {
        return;
      }

      // There is no dictionary available for the detected language.
      if (!switchAsIType.dictLanguages.has(result.language)) {
        return;
      }
      
      let languageID = switchAsIType.dictLanguages.get(result.language);
      if (languageID == spellChecker.spellChecker.GetCurrentDictionary()) {
        return;
      }

      spellChecker.spellChecker.SetCurrentDictionary(languageID);
    }).catch(function(error) {
      Components.utils.reportError("switchasitype: " + error);
    });
  },

  getText: function (text, editor) {
    // figure out the caret position so we only use the text in front of the caret
    let cutoffPosition;
    if (editor.selection.focusNode != editor.rootElement){
      cutoffPosition = editor.selection.focusOffset;
      // this is the caret position before the key press so it's potentially of by one
      cutoffPosition++;
    } else {
      // if the caret is at the end of the text, the focusNode has a strange value and the focusOffset is 2 (not sure if this can only happen in such a case)
      cutoffPosition = text.length;
    }

    if (cutoffPosition > text.length)
      cutoffPosition = text.length;

    text = text.substring(0, cutoffPosition)
               .trim()
               .split(/[\s;:,.()\[\]¡!¿?]+/) //this is lame but \W will also throws out umlauts and all sorts of funny characters
               .slice(-switchAsIType.kTextLengthMax);
    return text;
  },

  onInput: function (event) {
    let target = event.originalTarget;
    if (!target || !target.value) {
      return;
    }
    switchAsIType.registerJob(target);
  },

  onWindowClosed: function (subject, topic) {
    subject = subject.QueryInterface(Components.interfaces.nsIDOMWindow);
    switchAsIType.unregisterEventListener(subject);
  },

  onWindowOpened: function (subject, topic) {
    subject = subject.QueryInterface(Components.interfaces.nsIDOMWindow);
    switchAsIType.registerEventListener(subject);
  },

  registerEventListener: function (window) {
    window.addEventListener("input", switchAsIType.onInput, false);
    switchAsIType.windows.add(window);
  },

  registerJob: function (target) {
    if (switchAsIType.checkJobs.has(target)) {
      return;
    }
    switchAsIType.checkJobs.set(target, {
      observe: function(subject, topic, data) {
        switchAsIType.checkJobs.delete(target);
        switchAsIType.getLanguage(target);
      },
      timer: Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer),
    });
    let currentJob = switchAsIType.checkJobs.get(target);
    currentJob.timer.init(currentJob, switchAsIType.kProcessWaitTime, Components.interfaces.nsITimer.TYPE_ONE_SHOT);
  },

  resetState: function () {
    switchAsIType.dictListUpToDate = false;
    switchAsIType.dictLanguages.clear();

    for (let window of switchAsIType.windows) {
      switchAsIType.unregisterEventListener(window);
    }
    switchAsIType.windows.clear();

    for (let checkJob of switchAsIType.checkJobs.values()) {
      checkJob.timer.cancel();
    }
    switchAsIType.checkJobs.clear();
  },

  unregisterEventListener: function (window) {
    window.removeEventListener("input", switchAsIType.onInput, false);
    switchAsIType.windows.delete(window);
  },

  updateDictList: function () {
    let installedDictionaries = [];
    let spellCheckEngine = Components.classes["@mozilla.org/spellchecker/engine;1"]
                                     .getService(Components.interfaces.mozISpellCheckingEngine);
    spellCheckEngine.getDictionaryList(installedDictionaries, {});
    for (let languageID of installedDictionaries.value) {
      let languageCode = (languageID.split("-"))[0];
      if (!switchAsIType.dictLanguages.has(languageCode)) {
        switchAsIType.dictLanguages.set(languageCode, languageID);
      }
    }
  },
}