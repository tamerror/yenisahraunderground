// Minimal fake of the Google Maps Street View API used in end-to-end tests.
(function () {
  const D = Math.PI / 180;
  function LatLng(lat, lng) { this._a = lat; this._b = lng; }
  LatLng.prototype.lat = function () { return this._a; };
  LatLng.prototype.lng = function () { return this._b; };
  const panos = {};
  let n = 0;
  const panoAt = (lat, lng) => { const id = 'p' + n++; panos[id] = { lat, lng }; return id; };
  const KEY = new URL(document.currentScript.src).searchParams.get('key');
  class StreetViewService {
    async getPanorama(req) {
      window.__svRequests = (window.__svRequests || []).concat([req]);
      if (KEY === 'NOSERVICE') throw Object.assign(new Error('StreetViewService.getPanorama: ZERO_RESULTS'), { code: 'ZERO_RESULTS' });
      if (KEY === 'DENIED') throw Object.assign(new Error('StreetViewService.getPanorama: REQUEST_DENIED'), { code: 'REQUEST_DENIED' });
      const id = panoAt(req.location.lat, req.location.lng);
      return { data: { location: { pano: id, latLng: new LatLng(req.location.lat, req.location.lng) } } };
    }
  }
  class StreetViewPanorama {
    constructor(el, opts) {
      this.el = el; this.l = {}; this.pov = opts.pov; this.zoom = opts.zoom ?? 1;
      el.style.background = 'linear-gradient(#8ec5ff, #d9d4c7 60%, #6b6b6b)';
      window.__svStub = this; window.__svSteps = 0;
      if (opts.pano) this.setPano(opts.pano);
      else if (opts.position) {
        this.status = KEY === 'DENIED' ? 'REQUEST_DENIED' : 'OK';
        if (this.status === 'OK') this.setPano(panoAt(opts.position.lat, opts.position.lng));
        setTimeout(() => this.fire('status_changed'), 10);
      }
    }
    getStatus() { return this.status || 'OK'; }
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
  const key = params.get('key');
  if (key === 'BAD') setTimeout(() => window.gm_authFailure && window.gm_authFailure(), 0);
  else if (key === 'REFERER')
    setTimeout(() => {
      console.error('Google Maps JavaScript API error: RefererNotAllowedMapError\nhttps://developers.google.com/maps/documentation/javascript/error-messages#referer-not-allowed-map-error');
      window.gm_authFailure && window.gm_authFailure();
    }, 0);
  else {
    setTimeout(() => window[params.get('callback')](), 0);
    // Google can also reject a key after the script has loaded
    if (key === 'LATE')
      setTimeout(() => {
        console.error('Google Maps JavaScript API error: ApiNotActivatedMapError');
        window.gm_authFailure && window.gm_authFailure();
      }, 1500);
  }
})();
