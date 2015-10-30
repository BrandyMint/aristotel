window['art'] = window['art'] || [];
art.load = function (id, config) {
  art['appId'] = id;
  art['config'] = config = config || {};
  var isSSL = config.forceSSL || "https:" === document.location.protocol;
  var s = document.createElement("script");
  s.type = "text/javascript";
  s.async = true;
  s.src = ( isSSL ? "https:" : "http:") + "//3009.vkontraste.ru/art" + id + ".js";
  var el = document.getElementsByTagName("script")[0];
  el.parentNode.insertBefore(s, el);

  var f = function(fname) {
    return function() {
      art.push([fname].concat(Array.prototype.slice.call(arguments,0)));
    };
  };
  var funcs = ["clearEventProperties", "identify", "setEventProperties", "track", "unsetEventProperty"];
  for (var i=0; i < funcs.length; i++) {
    art[funcs[i]]=f(funcs[i]);
  }
};
art.load("333");
