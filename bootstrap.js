Components.utils.import("resource://gre/modules/Services.jsm");

startup = function () {
	reload();

	var windowEnumerator = Services.wm.getEnumerator("navigator:browser");
	while(windowEnumerator.hasMoreElements()){
		var window = windowEnumerator.getNext();
		register(window);
	}

	Services.ww.registerNotification(onWindow);
};

shutdown = function () {
	Services.ww.unregisterNotification(onWindow);
	for(var i=0;i<windows.length;i++)
		unregister(windows[i]);
	for(var i=0;i<blockers.length;i++)
		blockers.items[i].timer.cancel();
};

spellCheckEngines = {};
installedDictionaries = [];
personalDictionary = null;
windows = [];
blockers = {};

onWindow = function(subject, topic){
	window = subject.QueryInterface(Components.interfaces.nsIDOMWindow);
	if (topic=="domwindowclosed")
		unregister(window);
	if (topic=="domwindowopened")
		register(window);
};

reload = function() { 
	var spellCheckEngine = Components.classes["@mozilla.org/spellchecker/engine;1"].createInstance(Components.interfaces.mozISpellCheckingEngine);
	spellCheckEngine.getDictionaryList(this.installedDictionaries, {});
	installedDictionaries = installedDictionaries.value.toString().split(",");

	for(var i=0;i<this.installedDictionaries.length;i++){
		spellCheckEngine = Components.classes["@mozilla.org/spellchecker/engine;1"].createInstance(Components.interfaces.mozISpellCheckingEngine);
		spellCheckEngine.dictionary = installedDictionaries[i];
		spellCheckEngines[installedDictionaries[i]] = spellCheckEngine;
	}

	personalDictionary = Components.classes["@mozilla.org/spellchecker/personaldictionary;1"].getService(Components.interfaces.mozIPersonalDictionary);
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
	text = text.replace(/^\s\s*/, '').replace(/\s\s*$/, '').split(/[\s;:,.()\[\]¡!¿?]+/).slice(-10);//this is lame but \W will also throw and out umlauts and all sorts of funny characters

	var errors = [];
	for(var i=0;i<installedDictionaries.length;i++)
		errors[i] = countErrors(spellCheckEngines[installedDictionaries[i]],text);

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
		if((!engine.check(tokens[i])) && (!personalDictionary.check(tokens[i],engine.dictionary)))
			count++;
	return count;
};
