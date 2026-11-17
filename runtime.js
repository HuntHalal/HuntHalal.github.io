/*
 * Hunt Halal website: a small page engine.
 * The page is written as a template with {{ value }} holes, <sc-for> loops and <sc-if> blocks.
 * This file fills the template from the Component's renderVals(), and updates the page in place
 * whenever setState() is called, so animations and typing are never interrupted.
 */
(function () {
  'use strict';

  // ---------- state ----------
  var handlers = [];
  var root, tpl, comp, scheduled = false;

  function lookup(path, scope) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    var parts = path.split('.');
    var v = scope;
    for (var i = 0; i < parts.length; i++) {
      if (v === null || v === undefined) return undefined;
      v = v[parts[i]];
    }
    return v;
  }

  var WHOLE = /^\s*\{\{([^}]+)\}\}\s*$/;
  var HOLE = /\{\{([^}]+)\}\}/g;
  function interp(str, scope) {
    return str.replace(HOLE, function (_, p) {
      var v = lookup(p, scope);
      return v === undefined || v === null ? '' : String(v);
    });
  }

  // ---------- build a fresh DOM tree from the template ----------
  function build(node, scope, out) {
    if (node.nodeType === 3) {
      out.appendChild(document.createTextNode(node.nodeValue.indexOf('{{') >= 0 ? interp(node.nodeValue, scope) : node.nodeValue));
      return;
    }
    if (node.nodeType !== 1) return;
    var tag = node.tagName.toLowerCase();
    if (tag === 'sc-for') {
      var m = WHOLE.exec(node.getAttribute('list') || '');
      var list = m ? lookup(m[1], scope) : null;
      var as = node.getAttribute('as') || 'item';
      if (list && list.length) {
        for (var i = 0; i < list.length; i++) {
          var s = Object.create(scope);
          s[as] = list[i];
          s.$index = i;
          for (var c = node.firstChild; c; c = c.nextSibling) build(c, s, out);
        }
      }
      return;
    }
    if (tag === 'sc-if') {
      var mm = WHOLE.exec(node.getAttribute('value') || '');
      if (mm && lookup(mm[1], scope)) for (var k = node.firstChild; k; k = k.nextSibling) build(k, scope, out);
      return;
    }
    var el = node.namespaceURI && node.namespaceURI !== 'http://www.w3.org/1999/xhtml'
      ? document.createElementNS(node.namespaceURI, node.localName)
      : document.createElement(tag);
    for (var a = 0; a < node.attributes.length; a++) {
      var at = node.attributes[a];
      var name = at.name;
      if (name.indexOf('hint-') === 0) continue;
      var whole = WHOLE.exec(at.value);
      if (/^on[a-z]+$/i.test(name) && whole) {
        var fn = lookup(whole[1], scope);
        if (typeof fn === 'function') {
          handlers.push(fn);
          el.setAttribute('data-on-' + name.slice(2).toLowerCase(), String(handlers.length - 1));
        }
        continue;
      }
      el.setAttribute(name, at.value.indexOf('{{') >= 0 ? interp(at.value, scope) : at.value);
    }
    var src = node.tagName === 'TEMPLATE' ? node.content : node;
    for (var ch = src.firstChild; ch; ch = ch.nextSibling) build(ch, scope, el);
    out.appendChild(el);
  }

  // ---------- update the live page to match the fresh tree ----------
  function morph(live, next) {
    if (live.nodeType !== next.nodeType || live.nodeName !== next.nodeName) {
      live.parentNode.replaceChild(next, live);
      return;
    }
    if (live.nodeType === 3) {
      if (live.nodeValue !== next.nodeValue) live.nodeValue = next.nodeValue;
      return;
    }
    if (live.nodeType !== 1) return;
    var i, name;
    for (i = live.attributes.length - 1; i >= 0; i--) {
      name = live.attributes[i].name;
      if (!next.hasAttribute(name)) live.removeAttribute(name);
    }
    for (i = 0; i < next.attributes.length; i++) {
      name = next.attributes[i].name;
      var v = next.attributes[i].value;
      if (live.getAttribute(name) !== v) live.setAttribute(name, v);
    }
    if (live.tagName === 'INPUT' && document.activeElement !== live) {
      var want = next.getAttribute('value') || '';
      if (live.value !== want) live.value = want;
    }
    morphChildren(live, next);
  }
  function morphChildren(live, next) {
    var a = live.firstChild, b = next.firstChild;
    while (b) {
      var nb = b.nextSibling;
      if (!a) live.appendChild(b);
      else {
        var na = a.nextSibling;
        morph(a, b);
        a = na;
      }
      b = nb;
    }
    while (a) {
      var n = a.nextSibling;
      live.removeChild(a);
      a = n;
    }
  }

  function render() {
    scheduled = false;
    handlers = [];
    var frag = document.createElement('div');
    var vals = comp.renderVals() || {};
    for (var c = tpl.content.firstChild; c; c = c.nextSibling) build(c, vals, frag);
    morphChildren(root, frag);
  }

  // ---------- events ----------
  function delegate(type) {
    document.addEventListener(type, function (e) {
      var el = e.target;
      while (el && el !== document) {
        if (el.getAttribute && el.hasAttribute('data-on-' + type)) {
          var fn = handlers[Number(el.getAttribute('data-on-' + type))];
          if (fn) {
            try { Object.defineProperty(e, 'currentTarget', { value: el, configurable: true }); } catch (x) {}
            fn(e);
          }
          return;
        }
        el = el.parentNode;
      }
    });
  }

  // ---------- the base class the page's code extends ----------
  window.DCLogic = function DCLogic(props) {
    this.props = props || {};
    this.state = {};
  };
  window.DCLogic.prototype.setState = function (patch) {
    var p = typeof patch === 'function' ? patch(this.state, this.props) : patch;
    for (var k in p) this.state[k] = p[k];
    if (!scheduled) {
      scheduled = true;
      (window.requestAnimationFrame || setTimeout)(render);
    }
  };
  window.DCLogic.prototype.forceUpdate = function () { this.setState({}); };

  window.startPage = function (Component, props) {
    root = document.getElementById('app');
    tpl = document.getElementById('page');
    comp = new Component(props || {});
    ['click', 'input', 'keydown', 'change'].forEach(delegate);
    render();
    if (comp.componentDidMount) comp.componentDidMount();
  };
})();
