/*global require */
var _ = require('./lodash')._;

var MAIN_LOOP_TIMEOUT = 2000;
var COOKIE_PREFIX = '_art_';
var REQUEST_TIMEOUT = 300;
var SESSION_DURATION = 1800 * 1000; // 30mins
var USER_DURATION = 63072000 + 1000; // 2 years

var PARAM_STR_LIMIT = 1024;
var SHORT_PARAM_STR_LIMIT = 255;
var TEXT_PARAM_STR_LIMIT = 64;

var REQ_CHUNK_LIMIT = 3900;

var CHANGE_NEW_USER = 0;
var CHANGE_NEW_SESSION = 1;
var CHANGE_NEW_VISIT = 2;

var pageChangeType = void 0;
var lastReqTime = void 0;
var lastSendReqs = (new Date).getTime();
var mainLoopStarted = false;
var isHttps = 'https:' === document.location.protocol;
var finalCb = void 0;
var config = _.extend({
  disableTextCapture: false,
  forceSSL: false,
  secureCookie: false
}, (window.art || {})['config']);

var IMG_REQUEST_RESOURCE = getUrl(config.requestUrl || 'cdn.1clickanalytics.ru/a.gif');
var idApi = getUrl(config.apiUrl || 'api.1clickanalytics.ru/identify');
var currentLocation = window.location.pathname + window.location.hash;
var currentDomain = document.domain;
var currentReferrer = document.referrer;
var sessParams = void 0;
var submitQueue = [];
var lastButton = void 0;
var lastTarget = void 0;
var appId = window.art.appId;
var networkErr = void 0;
var delayedEvs = [];
var customProps = {};

var oldIe = void 0;
var appVer;
if (window.navigator && (appVer = window.navigator.appVersion)) {
  if (appVer.indexOf('MSIE 6.') > -1) {
    oldIe = 6;
    REQ_CHUNK_LIMIT = 1700;
  } else if (appVer.indexOf('MSIE 7.') > -1) {
    oldIe = 7;
    REQ_CHUNK_LIMIT = 1900;
  } else if (appVer.indexOf('MSIE 8.') > -1) {
    oldIe = 8;
  }
}

function getTarget(ev) {
  return ev.target || ev.srcElement;
}

function getText(el) {
  return el.innerText || el.textContent;
}

function getClass(el) {
  var k = getAttr(el, 'class');
  return _.isObject(k) ? k.baseVal : k;
}

function getAttr(el, attr) {
  return el.getAttribute ? el.getAttribute(attr) || '' : el[attr];
}

function hasAttr(el, attr) {
  if (el.hasAttribute) {
    return el.hasAttribute(attr);
  } else {
    return (function() {
      var a = el.getAttributeNode(attr);
      return (a && (a.specified || a.nodeValue));
    } ());
  }
}

function getUrl(url) {
  return (isHttps || config.forceSSL ? 'https' : 'http') + '://' + url;
}

function getEventTargetPosition(ev) {
  var target = getTarget(ev);
  var rect = target.getBoundingClientRect();
  var isTop = ev.screenX === 0 && ev.screenY === 0;

  if (isTop) {
    return [0, 0];
  }

  var scrLeft = Math.floor(ev.clientX - rect.left);
  var scrTop = Math.floor(ev.clientY - rect.top);

  var left = (ev.offsetX === void 0) ? scrLeft : ev.offsetX;
  var top = (ev.offsetY === void 0) ? scrTop : ev.offsetY;

  return [left, top];
}

function getForm(el) {
  return el && document.getElementById(el.form) || (function () {
    for (var f = el; f && (typeof f.tagName === 'undefined' || f.tagName.toLowerCase() !== 'form'); ) {
      f = f.parentNode;
    }

    return f;
  } ());
}

function findEl(el, f) { //traverses DOM starting from el while f() is false
  return el && el.tagName !== 'BODY' && el.tagName !== 'HTML'
    ? f(el) ? el : findEl(el.parentElement, f)
    : null;
}

function isLeftButton(ev) {
  var btn = (ev.which || ev.button === void 0) ? ev.which : (ev.button & 1 ? 1 : 0);
  return (btn === 1);
}

function isPrevented(ev) {
  return ev.defaultPrevented || ev.defaultPrevented === void 0 && (ev.returnValue === false || ev.getPreventDefault && ev.getPreventDefault());
}

function preventDefault(ev) {
  ev.preventDefault ? ev.preventDefault() : ev.returnValue = false;
}

function addEventListener(element, eventName, cb, capture) {
  if (document.addEventListener) {
    element.addEventListener(eventName, cb, capture);
  } else if (document.attachEvent) {
    element.attachEvent('on' + eventName, function() {
      var event = window.event;
      event.currentTarget = element;
      event.target = event.srcElement;
      cb.call(element, event);
    });
  } else {
    element['on' + eventName] = cb;
  }
}

function removeEventListener(element, eventName, cb, capture) {
  if (element.removeEventListener) {
    element.removeEventListener(eventName, cb, capture);
    return true;
  } else if (element.detachEvent) {
    element.detachEvent('on' + eventName, cb);
  } else if (element['on' + eventName] === cb) {
    delete element['on' + eventName];
  }
}

function startMainLoop() {
  if (mainLoopStarted) {
    return false;
  }

  window.setTimeout(function () {
    mainLoopStarted = true;
    sendPageVisit();
    queue.startLoop();
    runDelayed(delayedEvs);
  }, 0);
  return true;
}

function onLoad() {
  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    startMainLoop();
  } else {
    if (document.addEventListener) {
      addEventListener(document, 'DOMContentLoaded', function f() {
        document.removeEventListener('DOMContentLoaded', f, false);
        startMainLoop();
      });
    } else {
      if (document.attachEvent) {
        document.attachEvent('onreadystatechange', function f() {
          if (document.readyState === 'complete') {
            document.detachEvent('onreadystatechange', f);
            startMainLoop();
          }
        });
      }
      
      addEventListener(window, 'load', startMainLoop, false);
    }
  }
}

function setCookie(name, value, expires, domain) {
  var expireTime;

  if (expires) {
    expireTime = new Date;
    expireTime.setTime(expireTime.getTime() + expires);
  }
  
  document.cookie = name + '=' + window.encodeURIComponent(value) +
    (expires ? ';expires=' + expireTime.toGMTString() : '') +
    (domain ? ';domain=.' + domain : '') + ';path=/' + (isHttps && config.secureCookie ? ';secure' : '');
}

function getCookie(name) {
  var reg = new RegExp('(^|;)[ ]*' + name + '=([^;]*)');
  var matches = reg.exec(document.cookie);
  return matches ? window.decodeURIComponent(matches[2]) : 0;
}

function getInnerCookieName(name) {
  return COOKIE_PREFIX + name + '.' + appId;
}

function setCookieId(userId, visitId, sessionId) {
  setCookie(getInnerCookieName('id'), userId + '.' + visitId + '.' + sessionId, USER_DURATION);
}

function setCookieSession() {
  setCookie(getInnerCookieName('session'), '*', SESSION_DURATION);
}

function setCookieProps(props) {
  setCookie(getInnerCookieName('props'), JSON.stringify(props), USER_DURATION);
}

function getCookieProps() {
  var cookie, props;
  try {
    cookie = getCookie(getInnerCookieName('props'));
    props = JSON.parse(cookie);
  } catch(e) {};

  return props || {};
}

function imgRequest(params, cb) {
  if (params && !networkErr) {
    var img = new Image(1, 1);
    img.onerror = function () {
      networkErr = true;
    };
    
    img.onload = function () {
      lastReqTime = 0;
      cb && cb();
    };

    img.src = IMG_REQUEST_RESOURCE + '?' + sessParams + '&' + params + '&tm=' + (new Date()).getTime();
    lastReqTime = (new Date()).getTime() + REQUEST_TIMEOUT;
  }
}

function jsonpRequest(api, params, cb) {
  var el, s;

  if (params) {
    params = params ? '&' + params : '';
    window._artjsonpcbfn = cb;
    el = document.head || document.getElementsByTagName('head')[0] || document.documentElement;
    s = document.createElement('script');
    s.async = 'async';
    s.src = api + '?' + sessParams + params + '&callback=_artjsonpcbfn';
    s.onload = s.onreadystatechange = function() {
      if (!s.readyState || /loaded|complete/.test(s.readyState)) {
        s.onload = s.onreadystatechange = null;
        if (el && s.parentNode) {
          el.removeChild(s);
        }
        s = void 0;
      }
    };
    el.insertBefore(s, el.firstChild);
  }
}

function runDelayed(evArr) {
  for(var i = 0; i > evArr.length; i++) {
    var fn = evArr[i][0];
    window.art[fn].apply(this, evArr[i].slice(1));
  }
}


function buildReq(fl) {
  var str = '';
  var arr = [];
  var count = 0;

  function getFragment(name, value) {
    return (_.isUndefined(value) || _.isNull(value) || value === '')
      ? ''
      : '&' + window.encodeURIComponent(name) + '=' + window.encodeURIComponent(value);
  }

  function buildFragment(props) {
    var result = '';
    var suffix = fl ? count++ : '';
    var key, val, i;
    
    for (key in props) {
      if (props.hasOwnProperty(key)) {
        val = props[key];
        if (_.isArray(val)) {
          for (i = 0; i < val.length; i++) {
            result += getFragment(key + suffix, val[i]);
          }
        } else {
          result += getFragment(key + suffix, val);
        }
      }
    }

    return result;
  }

  return ({
    add: function (props) {
      var fragment = buildFragment(props);
      if (str.length + fragment.length > REQ_CHUNK_LIMIT) {
        arr.push(str);
        str = '';
        count = 0;
        fragment = buildFragment(props);
      }
      
      str += fragment;
    },

    build: function(getArr) {
      if (!getArr) {
        return str.slice(1);
      }

      arr.push(str);
      for (var i = 0; i < arr.length; i++) {
        arr[i] = arr[i].slice(1);
      }
      return arr;
    }
  });
}

function sendReqs(reqs, cb) {
  var id = getCookie(getInnerCookieName('id'));

  if (reqs[0] && id) {
    var arr = id.split(".");
    var sessionExpired = lastSendReqs + SESSION_DURATION < (new Date).getTime();
    if (sessionExpired) {
      pageChangeType = CHANGE_NEW_SESSION;
      arr[1] = getRnd(32, 10);
      arr[2] = getRnd(32, 10);
      setSessionParams(arr);
      setCookieId(arr[0], arr[1], arr[2]);
      sendPageVisit();
    }

    lastSendReqs = (new Date).getTime();
    imgRequest(reqs[0], cb);
         
    for (var i = 1; i < reqs.length; i++) {
      (function(t, e) {
        window.setTimeout(function() {
          imgRequest(t);
        }, 10 * e);
      } (reqs[i], i));
    }
  } else {
    cb();
  }
}

var queue = (function queue() {
  var tQueue = [];
  var started = false;

  function mainLoop() {
    mainWorker();
    window.setTimeout(mainLoop, MAIN_LOOP_TIMEOUT);
  }

  function mainWorker(cb) {
    var i, item;
    cb = cb || function () {};
    if (!started) {
      cb();
      return;
    }

    var reqBuilder = buildReq(true);
    for (i = 0; i < tQueue.length; i++) {
      item = tQueue[i];
      reqBuilder.add(item);
    }
    var reqs = reqBuilder.build(true);

    sendReqs(reqs, cb);
    tQueue = [];
  }

  function isTracked(ev) {
    var target = getTarget(ev);

    return oldIe && ev.srcElement !== ev.currentTarget
      ? false
      : target && target.tagName
        ? 3 === target.nodeType
          ? false
          : getAttr(target, 'art-ignore')
            ? false
            : ev.type === 'mousedown' || ev.type === 'mousemove'
              ? false
              : true
        : false;
  }

  function getHref(el) {
    for (var href = null ; el && el.tagName !== 'BODY' && el.tagName !== 'HTML'; ) {
      if ((href = getAttr(el, 'href'))) {
        return href;
      }
      el = el.parentElement;
    }
    return href;
  }

  function getElPath(el) {
    var path;
    var fragment;
    var id;
    var klass;
    for (path = ""; el && el.tagName !== 'BODY' && el.tagName !== 'HTML' &&
         (fragment = '@' + el.tagName.toLowerCase() + ';',
          id = getAttr(el, 'id'),
          id && (el += '#' + id.replace(/\s/g, '') + ';'),
          klass = getClass(el),
          klass && (fragment += '.' + klass.split(/\s+/).sort().join(';.') + ';'),
          fragment += '|',
          !(path.length + fragment.length > PARAM_STR_LIMIT)); ) {
      path = fragment + path;
      el = el.parentElement;
    }

    return path;
  }

  function getProps(ev) {
    ev = ev || window.event;
    var target = getTarget(ev);
    var klass = getClass(target);
    var type = ev.type === 'mouseup' ? 'click' : ev.type;
    var path = getElPath(target);

    var props = {
      t: truncate(type, SHORT_PARAM_STR_LIMIT),
      n: truncate(target.tagName.toLowerCase(), SHORT_PARAM_STR_LIMIT),
      l: truncate(truncateClasses(klass), SHORT_PARAM_STR_LIMIT),
      i: truncate(getAttr(target, 'id'), SHORT_PARAM_STR_LIMIT),
      f: truncate(getHref(target), PARAM_STR_LIMIT),
      w: path
    };
    
    if (!(config.disableTextCapture || type === 'change' ||
          target.isContentEditable || !_.isString(getText(target)))) {
      props.x = truncate(getText(target).replace(/^\s+|\s+$/g, ''), TEXT_PARAM_STR_LIMIT);
    }

    return props;
  }

  return {
    startLoop: function () {
      started = true;
      mainLoop();
    },

    clear: function() {
      tQueue = [];
    },

    flush: function(cb) {
      mainWorker(cb);
    },

    queueEvent: function (ev) {
      var e = ev || window.event;
      var props;
      if (isTracked(e)) {
        props = getProps(e);
        tQueue.push(props);
      }
    },

    queue: function (ev) {
      tQueue.push(ev);
    }
  };
}());

function truncate(str, limit) {
  return _.isString(str) ? str.slice(0, limit) : str;
}

function truncateClasses(klasses) {
  var str = klasses.toString();
  if (str.length > SHORT_PARAM_STR_LIMIT) {
    str = str.slice(0, SHORT_PARAM_STR_LIMIT)
      .split(' ')
      .slice(0, -1)
      .join(' ');
  }

  return str.replace(/[\(\)\!\@\#\$\%\^\&\*]/g, '');
}

function stripHash(str) {
  var reg = new RegExp('#.*');
  return str.replace(reg, '');
}

function getQueryParam(param, query) {
  query || (query = window.location.search);
  param = param.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
  var reg = new RegExp('[\\?&]' + param + '=([^&#]*)');
  var matches = reg.exec(query);
  return matches === null ? '' : window.decodeURIComponent(matches[1].replace(/\+/g, ' '));
}

function getSearchTerm(query) {
  //TODO:
  return '';
}

function prepareProps(props) {
  return _.isObject(props)
    ? _(props)
        .chain()
        .pick(function(val, key, obj) {
          return obj.hasOwnProperty(key) &&
            !(_.isUndefined(val) || _.isNull(val) || val === '');
        })
        .map(function(val, key) { return [key, val.toString()]; })
        .flatten()
        .value()
    : [];
}

function collectPageParams() {
  var referrer = stripHash(currentReferrer);
  var p = {
    t: pageChangeType,
    h: truncate(window.location.hash, PARAM_STR_LIMIT),
    p: truncate(window.location.pathname, PARAM_STR_LIMIT),
    q: truncate(window.location.search, PARAM_STR_LIMIT),
    d: truncate(window.location.hostname, PARAM_STR_LIMIT),
    g: truncate(document.title, SHORT_PARAM_STR_LIMIT),
    r: truncate(referrer, PARAM_STR_LIMIT),
    e: truncate(getSearchTerm(referrer), PARAM_STR_LIMIT),
    us: truncate(getQueryParam('utm_source'), PARAM_STR_LIMIT),
    um: truncate(getQueryParam('utm_medium'), PARAM_STR_LIMIT),
    ut: truncate(getQueryParam('utm_term'), PARAM_STR_LIMIT),
    uc: truncate(getQueryParam('utm_content'), PARAM_STR_LIMIT),
    ug: truncate(getQueryParam('utm_campaign'), PARAM_STR_LIMIT),
    k: prepareProps(customProps)
  };

  var params = buildReq();
  params.add(p);
  return params.build();
}

function getRnd(len, radix) {
  radix || (radix = 16);
  if (len === void 0) {
    len = 128;
  }

  if (len <= 0) {
    return '0';
  }
  
  var digits = Math.log(Math.pow(2, len)) / Math.log(radix);

  for (var r = 2; 1 / 0 === digits; r *= 2) {
    digits = Math.log(Math.pow(2, len / r)) / Math.log(radix) * r;
  }

  var extra = digits - Math.floor(digits);
  var result = "";
  
  for (r = 0; r < Math.floor(digits); r++) {
    var chr = Math.floor(Math.random() * radix).toString(radix);
    result = chr + result;
  }
  
  if (extra) {
    var n = Math.pow(radix, extra);
    var extraChar = Math.floor(Math.random() * n).toString(radix);
    result = extraChar + result;
  }
  
  var num = parseInt(result, radix);
  
  return 1 / 0 !== num && num >= Math.pow(2, len) ? getRnd(len, radix) : result;
}

function getSessionParams() {
  var id = getCookie(getInnerCookieName('id'));
  var session = getCookie(getInnerCookieName('session'));
  var hash = void 0;
  if (id) {
    hash = id.split('.');
    pageChangeType = CHANGE_NEW_VISIT;
    hash[1] = getRnd(32, 10);
    if (!session) {
      pageChangeType = CHANGE_NEW_SESSION;
      hash[2] = getRnd(32, 10);
    }
  } else {
    pageChangeType = CHANGE_NEW_USER;
    hash = [getRnd(53, 10), getRnd(32, 10), getRnd(32, 10)];
  }

  setCookieSession();
  setCookieId(hash[0], hash[1], hash[2]);
  return hash;
}

function setSessionParams(params) {
  window.art.userId = params[0];
  var s = {
    a: appId,
    u: params[0],
    v: params[1],
    s: params[2],
    m: 'web'
  };
  
  var p = buildReq();
  p.add(s);
  sessParams = p.build();
}

function initSessionData() {
  var params = getSessionParams();
  setSessionParams(params);
}

function sendPageVisit() {
  initSessionData();
  customProps = getCookieProps();
  var params = collectPageParams();
  imgRequest(params);
}

function runBeforeUnload(ev, cb) {
  var cbOnce = _.once(cb);
  queue.flush(cbOnce);
  preventDefault(ev);
  window.setTimeout(cbOnce, REQUEST_TIMEOUT);
  finalCb = cbOnce;
}

function sendEvent(ev) {
  queue.queueEvent(ev);
}

function handleBubbleEvent(ev, cb) {
  var handler = function(e) {
    removeEventListener(window, e.type, handler);
    if (e === ev && !isPrevented(e)) {
      cb(e);
    }
  };

  addEventListener(window, ev.type, handler);
}

function handleClick(ev) {
  ev = ev || window.event;
  var button = ev.which || ev.button;
  var target = getTarget(ev);

  if ((!oldIe || target === ev.currentTarget) && target && target.tagName) {
    if (ev.type === 'click') {
      sendEvent(ev);
      if (isLeftButton(ev)) {
        var cTarget = target;

        function isSubmit(el) {
          var tagName = el.tagName.toLowerCase();
          var type = _.isString(el.type) ? el.type.toLowerCase() : el.type;

          return getForm(el) !== null &&
            (tagName === 'input' && _.contains(['submit', 'image'], type) ||
             tagName === 'button' && !_.contains(['reset', 'button'], type));
        }
        var submitEl = findEl(cTarget, isSubmit);
        var isSubmitEl = submitEl !== null;
        var isWebComponents = ev.__impl4cf1e782hg__ !== void 0;
        
        if (isSubmitEl) {
          submitQueue.push([ev, submitEl]);
        } else if (!(isWebComponents || ev.metaKey || ev.shiftKey || ev.ctrlKey || ev.altKey)) {
          handleBubbleEvent(ev, function() {
            for(; cTarget && (typeof cTarget.tagName == 'undefined' || cTarget.tagName.toLowerCase() !== 'a' || !cTarget.href);) {
              cTarget = cTarget.parentNode;
            }

            if (cTarget && cTarget.href) {
              var isDl = hasAttr(cTarget, "download");
              var isSame = new RegExp("^\\s*(" + window.location.href.split(window.location.hash || "#")[0].replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&") + ")?#").test(cTarget.href);
              var isJs = /^\s*javascript:/.test(cTarget.href);
                            
              if (!(cTarget.isContentEditable || isDl || isSame || isJs)) {
                if (cTarget.target && cTarget.target.toLowerCase() !== '_self') {
                  cTarget.target.match(/^_(parent|top)$/i) &&
                    runBeforeUnload(ev, function() {
                      window.open(cTarget.href, cTarget.target);
                    });
                } else {
                  runBeforeUnload(ev, function() {
                    document.location.href = cTarget.href;
                  });
                }
              };
            }
          });
        }
      }
    } else {
      if (ev.type === 'mousedown') {
        if(button !== 1 && button !== 2 || !target) {
          lastButton = null;
          lastTarget = null;
        } else {
          lastButton = button;
          lastTarget = target;
        }
      } else if (ev.type === 'mouseup'){
        if (button === lastButton && target === lastTarget) {
          sendEvent(ev);
        }

        lastButton = null;
        lastTarget = null;
      }
    }
  }
}

function handleSubmit(ev) {
  var ev = ev || window.event;
  sendEvent(ev);

  if (!oldIe) {
    var form = getTarget(ev);
    var lastSubmit = _.findLast(submitQueue, function(e) {
      var el = e[1];
      return getForm(el) === form;
    });

    submitQueue = [];
    if (lastSubmit) {
      var submitEvent = lastSubmit[0];
      var submitElement = lastSubmit[1];
    }

    handleBubbleEvent(ev, function() {
      if (form.target !== '_blank') {
        runBeforeUnload(ev, function() {
          if (submitElement) {
            var tagName = submitElement.tagName.toLowerCase();
            var _type = getAttr(submitElement, 'type');
            var elType = _.isString(_type) ? _type.toLowerCase() : _type;
            if (tagName === 'input' && elType === 'image') {
              var pos = getEventTargetPosition(submitEvent);

              var inputX = document.createElement('input');
              inputX.type = 'hidden';
              inputX.name = submitElement.name + '.x';
              inputX.value = pos[0];

              var inputY = document.createElement('input');
              inputY.type = 'hidden';
              inputY.name = submitElement.name + '.y';
              inputY.value = pos[1];

              form.appendChild(inputX);
              form.appendChild(inputY);
            } else {
              var input = document.createElement('input');
              input.type = 'hidden';
              if (hasAttr(submitElement, 'name')) {
                input.name = submitElement.name;
              }
              if (hasAttr(submitElement, 'value')) {
                input.value = submitElement.value;
              }
              form.appendChild(input);
            }
          }

          var aForm = document.createElement('form');
          document.body.appendChild(aForm);
          aForm.submit.apply(form);
          document.body.removeChild(aForm);
          
          if (input) {
            form.removeChild(input);
          }
          
          if (inputX && inputY) {
            form.removeChild(inputX);
            form.removeChild(inputY);
          }          
        });
      }
    });
  }
}

function onBeforeUnload() {
  var t;

  queue.flush();
  if (lastReqTime) {
    do {
      t = new Date();
    } while (t.getTime() < lastReqTime);
  }

  finalCb && window.setTimeout(finalCb, 0);
  finalCb = null;
}


addEventListener(window, 'beforeunload', onBeforeUnload, true);

window.art || (window.art = []);
if (!window.art.loaded) {
  var oldArt = window.art;

  window.art = {
    appId: appId,
    config: config,
    loaded: true,
    identify: function (params) {
      var paramStr, pName, req, reqStr, pColl;

      if (!mainLoopStarted) {
        delayedEvs.push([ 'identify', params ]);
        return;
      }

      pColl = {};
      req = buildReq();

      if (_.isObject(params)) {
        for (pName in params) {
          if (params.hasOwnProperty(pName)) {
            if (!_.isObject(params[pName])) {
              paramStr = truncate(params[pName], SHORT_PARAM_STR_LIMIT);
              pColl[truncate(pName, SHORT_PARAM_STR_LIMIT)] = paramStr;
            }
          }
        }
        req.add(pColl);
        reqStr = req.build();
        jsonpRequest(idApi, reqStr, function (res) {
          var idCookie, ids;

          if (res && res.uid) {
            idCookie = getCookie(getInnerCookieName('id'));
            ids = idCookie.split('.');
            setCookieId(res.uid, ids[1], ids[2]);
            initSessionData();
          }
        });
      }
    },
    track: function (name, props) {
      if (_.isString(name)) {
        var data = {
          t: name,
          k: prepareProps(_.extend({}, customProps, props))
        };
        
        queue.queue(data);
        queue.flush();
      }
    },
    setEventProperties: function (props) {
      customProps = getCookieProps();
      _.exdend(customProps, props);
      setCookieProps(customProps);
    },
    unsetEventProperty: function (name) {
      customProps = getCookieProps();
      delete customProps[name];
      setCookieProps(customProps);
    },
    clearEventProperties: function () {
      customProps = {};
      setCookieProps(customProps);
    }
  };

  runDelayed(oldArt);

  addEventListener(window, 'click', handleClick, true);
  addEventListener(window, 'submit', handleSubmit, true);
}

if (window.history.pushState) {
  var tap = function(obj, func, tapFunc) {
    var oldFunc = obj[func];
    obj[func] = function() {
      var result = oldFunc.apply(obj, arguments);
      _.isFunction(obj[tapFunc]) && obj[tapFunc]();
      return result;
    };
  };

  tap(window.history, 'pushState', 'artpushstate'),
  tap(window.history, 'replaceState', 'artreplacestate');

  var onLocationChange = function() {
    var location = window.location.pathname + window.location.hash;
    if (currentLocation !== location) {
      currentLocation = location;
      queue.flush();
      sendPageVisit();
    }
  };

  window.history.artpushstate = window.history.artreplacestate = onLocationChange;
  window.addEventListener('popstate', onLocationChange, true);
  window.addEventListener('hashchange', onLocationChange, true);
}

onLoad();
