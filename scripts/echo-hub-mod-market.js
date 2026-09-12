app.initializers.add('echo-mod-market-nav', function () {
  var compat = (flarum.core && flarum.core.compat) || {};
  var extendMod = compat['flarum/common/extend'] || compat.extend;
  var extend = extendMod && extendMod.extend;
  var IndexPage =
    compat['flarum/forum/components/IndexPage'] ||
    compat['flarum/components/IndexPage'] ||
    compat['forum/components/IndexPage'] ||
    compat['components/IndexPage'];
  if (!extend || !IndexPage || !IndexPage.prototype) return;

  function marketHref() {
    var base = '';
    try {
      base = app.forum.attribute('baseUrl') || '';
    } catch (e) {}
    return String(base).replace(/\/$/, '') + '/mod-market/';
  }

  function marketLink() {
    return m(
      'a.TagLinkButton.hasIcon',
      {
        href: marketHref(),
        title: 'Mod 市场',
      },
      [m('i.icon.fas.fa-cubes.Button-icon', { 'aria-hidden': 'true' }), m('span.Button-label', 'Mod 市场')]
    );
  }

  if (typeof IndexPage.prototype.navItems === 'function') {
    extend(IndexPage.prototype, 'navItems', function (items) {
      if (items && items.has && items.has('modMarket')) return;
      items.add('modMarket', marketLink(), 95);
    });
  }
});
