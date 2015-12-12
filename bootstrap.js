Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/AddonManager.jsm");

spellCheckEngines = {};
installedDictionaries = null;
windows = [];
blockers = {};

install = function () {};
uninstall = function () {};

startup = function () {
  resetState();

  var windowEnumerator = Services.wm.getEnumerator("navigator:browser");
  while(windowEnumerator.hasMoreElements()){
    register(windowEnumerator.getNext());
  }

  Services.ww.registerNotification(onWindow);
  AddonManager.addAddonListener(addonListener);
};

shutdown = function () {
  resetState();

  AddonManager.removeAddonListener(addonListener);
  Services.ww.unregisterNotification(onWindow);
};

resetState = function(){
  resetDictionaries();

  for(var i=0;i<windows.length;i++)
    unregister(windows[i]);
  windows = [];

  for(var i=0;i<blockers.length;i++)
    blockers.items[i].timer.cancel();
  blockers = [];
};

resetDictionaries = function(){
  installedDictionaries = null;
  spellCheckEngines = {};
};
  
onWindow = function(subject, topic){
  subject = subject.QueryInterface(Components.interfaces.nsIDOMWindow);
  if (topic=="domwindowclosed")
    unregister(subject);
  if (topic=="domwindowopened")
    register(subject);
};

refreshDictionaries = function() {
  if (installedDictionaries==null){
    installedDictionaries = [];
    var spellCheckEngine = Components.classes["@mozilla.org/spellchecker/engine;1"].getService(Components.interfaces.mozISpellCheckingEngine);
    spellCheckEngine.getDictionaryList(this.installedDictionaries, {});
    installedDictionaries = installedDictionaries.value.toString().split(",");
  }
};

addonListener = {//whenever an addon is enabled/disabled we refresh the set of dictionaries
  onEnabled : function(addon) { resetDictionaries(); },
  onDisalbed : function(addon) { resetDictionaries(); }
};

register = function(window){
  window.addEventListener("keypress", onKeyPress, false);
  windows.push(window);
};

unregister = function(window){
  window.removeEventListener("keypress", onKeyPress, false);
  windows=windows.filter(function(item){return item!=window;});
};

onKeyPress = function(e){
  var target = e.originalTarget;
  if (!target)
    return;     
  if (!target.value)
    return;

  check(target);
};

registerBlocker = function(target){
  blockers[target] = {
    observe: function(subject, topic, data){
      blocker = blockers[target];
      delete(blockers[target]);
      if (blocker.pending)
        check(target);
    },
    pending: false,
    timer: Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer),
  };
  blockers[target].timer.init(blockers[target], 500, Components.interfaces.nsITimer.TYPE_ONE_SHOT);
};

check = function(target){ 
  refreshDictionaries();

  if (!(target instanceof Components.interfaces.nsIDOMNSEditableElement))
    return;

  target = target.QueryInterface(Components.interfaces.nsIDOMNSEditableElement);
  var editor = target.editor;
  if (!editor)
    return;

  var spellChecker = editor.getInlineSpellChecker(false);
  if (!spellChecker)
    return;//spell checking was never enabled
  if (!spellChecker.enableRealTimeSpell)
    return;//spell checking is disabled

  if (blockers[target]){
    blockers[target].pending = true;
    return;
  }
  registerBlocker(target);

  var text = target.value;
  if (!text)
    return;

  // figure out the caret position so we only use the text in front of the caret
  var cutoffPosition;
  if (editor.selection.focusNode != editor.rootElement){
    cutoffPosition = editor.selection.focusOffset;
    // this is the caret position before the key press so it's potentially of by one
    cutoffPosition = cutoffPosition + 1;
  }else{
    // if the caret is at the end of the text, the focusNode has a strange value and the focusOffset is 2 (not sure if this can only happen in such a case)
    cutoffPosition = text.length;
  }
  
  if (cutoffPosition > text.length)
    cutoffPosition = text.length;

  text = text.substring(0,cutoffPosition).replace(/^\s\s*/, '').replace(/\s\s*$/, '').split(/[\s;:,.()\[\]¡!¿?]+/).slice(-10);//this is lame but \W will also throws out umlauts and all sorts of funny characters

  var errors = [];
  for(var i=0;i<installedDictionaries.length;i++){
    var spellCheckEngine = Components.classes["@mozilla.org/spellchecker/engine;1"].getService(Components.interfaces.mozISpellCheckingEngine);
    spellCheckEngine.dictionary = installedDictionaries[i];
    errors[i] = countErrors(spellCheckEngine,text);
  }

  var best = 0;
  for(var i=0;i<installedDictionaries.length;i++)
    if (errors[i]<errors[best])
      best=i;

  if (installedDictionaries[best]==spellChecker.spellChecker.GetCurrentDictionary())
    return;

  spellChecker.spellChecker.SetCurrentDictionary(installedDictionaries[best]);
  spellChecker.spellCheckRange(null);
};    
  
countErrors = function(engine, tokens) {
  var count=0;
  for(var i=0;i<tokens.length;i++)
    if(!engine.check(tokens[i]))
      count++;
  return count;
};
