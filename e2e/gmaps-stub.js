// Minimal fake of the Google Maps Street View API used in end-to-end tests.
(function () {
  const D = Math.PI / 180;
  function LatLng(lat, lng) { this._a = lat; this._b = lng; }
  LatLng.prototype.lat = function () { return this._a; };
  LatLng.prototype.lng = function () { return this._b; };
  const panos = {};
  let n = 0;
  const panoAt = (lat, lng) => { const id = 'p' + n++; panos[id] = { lat, lng }; return id; };
  class StreetViewService {
    async getPanorama(req) {
      const id = panoAt(req.location.lat, req.location.lng);
      return { data: { location: { pano: id, latLng: new LatLng(req.location.lat, req.location.lng) } } };
    }
  }
  class StreetViewPanorama {
    constructor(el, opts) {
      this.el = el; this.l = {}; this.pov = opts.pov; this.zoom = opts.zoom ?? 1;
      el.style.background = 'linear-gradient(#8ec5ff, #d9d4c7 60%, #6b6b6b)';
      window.__svStub = this; window.__svSteps = 0;
      this.setPano(opts.pano);
    }
    addListener(ev, fn) { (this.l[ev] = this.l[ev] || []).push(fn); return { remove() {} }; }
    fire(ev) { (this.l[ev] || []).forEach((f) => f()); }
    setPano(id) { this.pano = id; window.__svSteps++; this.fire('position_changed'); }
    getPosition() { const p = panos[this.pano]; return p ? new LatLng(p.lat, p.lng) : null; }
    getPov() { return this.pov; }
    setPov(p) { this.pov = p; this.fire('pov_changed'); }
    getZoom() { return this.zoom; }
    getLinks() {
      const p = panos[this.pano];
      return [0, 90, 180, 270].map((h) => ({
        heading: h,
        pano: panoAt(p.lat + (Math.cos(h * D) * 10) / 111320, p.lng + (Math.sin(h * D) * 10) / (111320 * Math.cos(p.lat * D))),
      }));
    }
    setVisible() {}
  }
  window.google = { maps: { StreetViewService, StreetViewPanorama, StreetViewSource: { OUTDOOR: 'outdoor' }, StreetViewPreference: { NEAREST: 'nearest' } } };
  const src = document.currentScript && document.currentScript.src;
  const params = new URL(src).searchParams;
  if (params.get('key') === 'BAD') setTimeout(() => window.gm_authFailure && window.gm_authFailure(), 0);
  else setTimeout(() => window[params.get('callback')](), 0);
})();
