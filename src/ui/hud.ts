import { BADGES } from '../core/badges';
import { CATS, ITEMS, MAX_MAMA, POI_LABEL, RECORD_TITLES } from '../core/content';
import type { Game, GameEvent } from '../core/game';
import type { GamePoi } from '../core/quests';
import { QUEST_COLORS } from '../render/minimap';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h} sa ${m} dk` : `${m} dk`;
}

function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

export interface HudCallbacks {
  onMenu(): void;
  onReset(): void;
  onToggleView(): void;
  onToggleMap(): void;
  onToggleMute(): boolean;
  onResume(): void;
  onPause(): void;
  onPlayRecord?(index: number): boolean;
  onCycleDay?(): string;
  dayLabel?(): string;
}

type Projector = (x: number, y: number, h?: number) => { x: number; y: number } | null;

/** All DOM overlays on top of the game view. */
export class Hud {
  readonly el: HTMLDivElement;
  readonly minimapSlot: HTMLDivElement;
  private readonly $ = <T extends HTMLElement>(sel: string) => this.el.querySelector(sel) as T;
  private last: Record<string, string> = {};
  private readonly modal: HTMLDivElement;
  modalOpen: 'album' | 'help' | 'pause' | null = null;
  private albumTab = 'items';
  projector: Projector | null = null;
  private pendingPois: GamePoi[] = [];
  private poiTimer = 0;

  constructor(parent: HTMLElement, private readonly game: Game, private readonly cb: HudCallbacks) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="panel stats">
        <div class="score"><span class="score-val" data-testid="score">0</span><small>puan</small></div>
        <div class="level"><span class="level-title"></span><div class="bar"><i class="level-bar"></i></div></div>
        <div class="explore"><span>🗺️ Keşif <b class="explore-val">0%</b></span><div class="bar"><i class="explore-bar"></i></div></div>
        <div class="combo hidden"><b class="combo-val">x2</b> KOMBO<div class="bar"><i class="combo-bar"></i></div></div>
      </div>
      <div class="street-pill"><span class="street-name">—</span></div>
      <div class="toasts"></div>
      <div class="right-col">
        <div class="buttons">
          <button data-act="map" title="Harita (M)">🗺️</button>
          <button data-act="album" title="Albüm (K)">📒</button>
          <button data-act="view" title="Kamera (V)">🎥</button>
          <button data-act="mute" title="Ses (N)" class="mute-btn">🔊</button>
          <button data-act="pause" title="Durdur (Esc)">⏸️</button>
        </div>
        <div class="minimap-slot"></div>
        <div class="panel quests"><div class="daily" title="Bugün bu eşya iki kat puan">Günün eşyası: ${game.dailyItem.emoji} ${game.dailyItem.name} <b>×2</b></div><h4>Görevler</h4><ol class="quest-list"></ol></div>
      </div>
      <div class="panel inventory">
        <span class="mama" title="Kedi maması">🐟 <b class="mama-val">0</b>/${MAX_MAMA}</span>
        <span class="cats-val" title="Beslenen kediler">🐈 0/${CATS.length}</span>
        <span class="records-val" title="Plaklar">💿 0/${RECORD_TITLES.length}</span>
        <span class="powerups"></span>
      </div>
      <div class="popups"></div>
      <div class="modal hidden"><div class="modal-card"></div></div>
    `;
    parent.appendChild(this.el);
    this.minimapSlot = this.$('.minimap-slot');
    this.modal = this.$('.modal');
    this.el.querySelectorAll<HTMLButtonElement>('.buttons button').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const a = b.dataset.act;
        if (a === 'map') cb.onToggleMap();
        if (a === 'album') this.toggleModal('album');
        if (a === 'view') cb.onToggleView();
        if (a === 'mute') this.setMuted(cb.onToggleMute());
        if (a === 'pause') this.toggleModal('pause');
        b.blur();
      }),
    );
    this.$('.quest-list').addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest('li[data-q]') as HTMLElement | null;
      if (li) game.track(Number(li.dataset.q));
    });
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.closeModal();
    });
    game.on((e) => this.onEvent(e));
  }

  setMuted(m: boolean): void {
    this.$('.mute-btn').textContent = m ? '🔇' : '🔊';
  }

  private set(key: string, sel: string, value: string, html = false): void {
    if (this.last[key] === value) return;
    this.last[key] = value;
    const el = this.$(sel);
    if (html) el.innerHTML = value;
    else el.textContent = value;
  }

  update(): void {
    const g = this.game;
    const p = g.progress;
    this.set('score', '.score-val', p.score.toLocaleString('tr-TR'));
    const lv = g.level;
    this.set('lt', '.level-title', `${lv.title}${lv.next ? ` → ${lv.next.toLocaleString('tr-TR')}` : ''}`);
    const lp = lv.next ? (p.score - lv.prev) / (lv.next - lv.prev) : 1;
    this.$('.level-bar').style.width = `${Math.min(100, lp * 100).toFixed(1)}%`;
    const ex = g.explorePct;
    this.set('ex', '.explore-val', `${ex.toFixed(1)}%`);
    this.$('.explore-bar').style.width = `${ex.toFixed(2)}%`;
    const combo = this.$('.combo');
    const showCombo = g.combo.mult > 1 && g.combo.timer > 0;
    combo.classList.toggle('hidden', !showCombo);
    if (showCombo) {
      this.set('cv', '.combo-val', `x${g.combo.mult}`);
      this.$('.combo-bar').style.width = `${(g.combo.timer / 4.5) * 100}%`;
    }
    const st = g.currentStreet;
    const pct = st && g.net.streets.has(st) ? g.streetPct(st) : null;
    this.set('st', '.street-name', st ? `📍 ${st}${pct !== null ? ` · ${pct === 100 ? '✔' : `%${pct}`}` : ''}` : `📍 ${g.area.name}`);
    this.set('mama', '.mama-val', String(p.mama));
    this.set('cats', '.cats-val', `🐈 ${Object.keys(p.fed).length}/${CATS.length}`);
    this.set('rec', '.records-val', `💿 ${p.records.length}/${RECORD_TITLES.length}`);
    const pu = Object.entries(g.powerups)
      .map(([id, t]) => `<span class="pu">${ITEMS.find((i) => i.id === id)?.emoji ?? ''} ${Math.ceil(t)}s</span>`)
      .join('');
    this.set('pu', '.powerups', pu, true);
    const qs = p.quests
      .map((q, i) => {
        const frac =
          q.type === 'explore'
            ? (q.progress - (q.base ?? 0)) / Math.max(1, q.goal - (q.base ?? 0))
            : q.type === 'combo'
              ? (q.progress - 1) / Math.max(1, q.goal - 1)
              : q.progress / q.goal;
        const pct = Math.max(0, Math.min(100, frac * 100));
        const prog = q.type === 'street' ? `${Math.round(pct)}%` : q.type === 'explore' ? `%${q.progress}` : q.type === 'combo' ? `x${q.progress}` : `${q.progress}/${q.goal}`;
        const tracked = g.guide?.questId === q.id;
        return `<li style="--qc:${QUEST_COLORS[i]}" data-q="${q.id}" class="${tracked ? 'tracked' : ''}" title="Yol tarifi için tıkla"><span class="q-title">${tracked ? '🧭 ' : ''}${esc(q.title)}</span><span class="q-meta"><span class="q-prog">${prog}</span><span class="q-rew">+${q.reward}</span></span><div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div></li>`;
      })
      .join('');
    this.set('q', '.quest-list', qs, true);
    if (this.modalOpen === 'album' && this.albumTab === 'stats') this.renderAlbum();
  }

  toast(text: string, kind: string = 'info', emoji = ''): void {
    const box = this.$('.toasts');
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.innerHTML = `${emoji ? `<span class="t-emoji">${emoji}</span>` : ''}<span>${esc(text)}</span>`;
    box.prepend(t);
    while (box.children.length > 4) box.lastElementChild!.remove();
    setTimeout(() => t.classList.add('out'), kind === 'badge' || kind === 'rare' ? 3800 : 2600);
    setTimeout(() => t.remove(), kind === 'badge' || kind === 'rare' ? 4300 : 3100);
  }

  private popup(x: number, y: number, text: string, color: string): void {
    const sp = this.projector?.(x, y, 1.6);
    const box = this.$('.popups');
    const el = document.createElement('div');
    el.className = 'popup';
    el.textContent = text;
    el.style.color = color;
    if (sp) {
      el.style.left = `${sp.x}px`;
      el.style.top = `${sp.y}px`;
    } else {
      el.style.left = '50%';
      el.style.top = '45%';
    }
    box.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }

  private onEvent(e: GameEvent): void {
    switch (e.type) {
      case 'collect': {
        const d = e.item.def;
        if (d.kind === 'powerup') {
          this.toast(`${d.name}! ${d.desc}`, 'rare', d.emoji);
          break;
        }
        this.popup(e.item.x, e.item.y, `+${e.points}${e.mult > 1 ? ` x${e.mult}` : ''}`, d.rarity === 'efsane' ? '#ffd54f' : d.rarity === 'nadir' ? '#ce93d8' : '#ffffff');
        if (d.kind === 'record' && e.item.record !== undefined)
          this.toast(`Plak bulundu: ${RECORD_TITLES[e.item.record]} (${this.game.progress.records.length}/${RECORD_TITLES.length})`, 'rare', '💿');
        else if (d.rarity === 'efsane' || d.rarity === 'nadir') this.toast(`${d.name} buldun! +${e.points}`, 'rare', d.emoji);
        else if ((this.game.progress.counts[d.id] ?? 0) === 1) this.toast(`Yeni eşya: ${d.name} — ${d.desc}`, 'good', d.emoji);
        break;
      }
      case 'feed':
        this.popup(e.cat.x, e.cat.y, `+${e.points} 💕`, '#ff80ab');
        this.toast(e.first ? `${e.cat.def.name} ile dost oldunuz! ${e.cat.def.desc}` : `${e.cat.def.name} karnını doyurdu, peşinden geliyor.`, 'good', '🐈');
        break;
      case 'toast':
        this.toast(e.text, e.kind, e.emoji);
        break;
      case 'badge':
        this.toast(`Rozet: ${e.badge.name} — ${e.badge.desc}`, 'badge', e.badge.emoji);
        break;
      case 'level':
        this.toast(`Seviye atladın: ${e.title}!`, 'badge', '⭐');
        break;
      case 'quest-done':
        this.toast(`Görev tamam: ${e.quest.title} +${e.quest.reward}`, 'quest', '✅');
        break;
      case 'street-done':
        this.toast(`${e.name} tamamen keşfedildi! +${e.points}`, 'good', '🏁');
        break;
      case 'poi':
        // dense shopping streets discover many places at once: batch them into one toast
        this.pendingPois.push(e.poi);
        if (!this.poiTimer)
          this.poiTimer = window.setTimeout(() => {
            const list = this.pendingPois;
            this.pendingPois = [];
            this.poiTimer = 0;
            if (list.length === 1) this.toast(`Mekân keşfedildi: ${list[0].name}`, 'info', POI_LABEL[list[0].type].emoji);
            else {
              const names = list.slice(0, 3).map((p) => p.name).join(', ');
              this.toast(`${list.length} mekân keşfedildi: ${names}${list.length > 3 ? ` +${list.length - 3}` : ''}`, 'info', '🏪');
            }
          }, 900);
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------- modals

  toggleModal(kind: 'album' | 'help' | 'pause'): void {
    if (this.modalOpen === kind) this.closeModal();
    else this.openModal(kind);
  }

  openModal(kind: 'album' | 'help' | 'pause'): void {
    this.modalOpen = kind;
    this.modal.classList.remove('hidden');
    this.cb.onPause();
    if (kind === 'album') this.renderAlbum();
    if (kind === 'help') this.renderHelp();
    if (kind === 'pause') this.renderPause();
  }

  closeModal(): void {
    if (!this.modalOpen) return;
    this.modalOpen = null;
    this.modal.classList.add('hidden');
    this.cb.onResume();
  }

  private card(): HTMLDivElement {
    return this.modal.querySelector('.modal-card') as HTMLDivElement;
  }

  private renderPause(): void {
    const c = this.card();
    c.innerHTML = `
      <h2>Durduruldu</h2>
      <div class="menu-col">
        <button class="btn primary" data-a="resume">▶ Devam et</button>
        <button class="btn" data-a="album">📒 Albüm</button>
        <button class="btn" data-a="help">🎮 Kontroller</button>
        ${this.cb.onCycleDay ? `<button class="btn" data-a="day">🌗 Gün döngüsü: <span class="day-label">${this.cb.dayLabel?.() ?? ''}</span></button>` : ''}
        <button class="btn" data-a="menu">🏠 Ana menü</button>
        <button class="btn danger" data-a="reset">♻️ Bu mahallenin ilerlemesini sıfırla</button>
      </div>`;
    c.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
      b.addEventListener('click', () => {
        const a = b.dataset.a;
        if (a === 'resume') this.closeModal();
        if (a === 'album') this.openModal('album');
        if (a === 'help') this.openModal('help');
        if (a === 'menu') this.cb.onMenu();
        if (a === 'day') c.querySelector('.day-label')!.textContent = this.cb.onCycleDay?.() ?? '';
        if (a === 'reset' && confirm('Tüm puan, koleksiyon ve keşif sıfırlansın mı?')) this.cb.onReset();
      }),
    );
  }

  private renderHelp(): void {
    const c = this.card();
    c.innerHTML = `
      <h2>Nasıl oynanır?</h2>
      <div class="help-grid">
        <div><kbd>W</kbd><kbd>↑</kbd> ileri · <kbd>S</kbd><kbd>↓</kbd> geri</div>
        <div><kbd>A</kbd><kbd>D</kbd> / <kbd>←</kbd><kbd>→</kbd> dön</div>
        <div><kbd>Shift</kbd> koş</div>
        <div><kbd>M</kbd> büyük harita · <kbd>K</kbd> albüm</div>
        <div><kbd>V</kbd> kamera · <kbd>N</kbd> ses · <kbd>Esc</kbd> durdur</div>
        <div>📱 Dokunmatik: sol alttaki joystick + 🏃</div>
      </div>
      <ul class="help-list">
        <li>🥯 🍵 🍬 💳 Sokaklardaki eşyaları üzerlerinden geçerek topla. Fırınların yanında simit, kafelerin yanında çay çıkar.</li>
        <li>⚡ Eşyaları art arda (4,5 sn içinde) toplarsan <b>kombo</b> çarpanı x5'e kadar çıkar.</li>
        <li>🗺️ Her yeni sokak parçası puan verir; bir sokağın tamamını yürümek bonus verir. Haritada keşfettiğin yerler parlar.</li>
        <li>🐟 Kedi maması topla, sokak kedilerinin yanına gidip besle. Doyan kedi bir süre peşinden gelir.</li>
        <li>💿 7 kayıp "Underground" plağı çıkmaz sokakların sonunda saklı. 🧭 Pusula sana yol gösterir.</li>
        <li>🧲 Mıknatıs eşyaları çeker, 🛴 scooter hızlandırır.</li>
        <li>📜 Sağdaki görevleri yap; renkli ışık sütunları ve haritadaki elmaslar hedefi gösterir.</li>
      </ul>
      <button class="btn primary" data-a="close">Tamam</button>`;
    c.querySelector('button')!.addEventListener('click', () => this.closeModal());
  }

  renderAlbum(): void {
    const g = this.game;
    const p = g.progress;
    const tabs: [string, string][] = [
      ['items', '🥯 Eşyalar'],
      ['cats', '🐈 Kediler'],
      ['records', '💿 Plaklar'],
      ['badges', '🏅 Rozetler'],
      ['places', '🏪 Mekânlar'],
      ['stats', '📊 İstatistik'],
    ];
    let body = '';
    if (this.albumTab === 'items') {
      body = `<div class="grid">${ITEMS.filter((d) => d.kind !== 'record')
        .map((d) => {
          const n = p.counts[d.id] ?? 0;
          return `<div class="tile ${n ? '' : 'locked'} r-${d.rarity}"><div class="t-big">${n ? d.emoji : '❔'}</div><b>${n ? d.name : '???'}</b><small>${d.rarity}${d.points ? ` · ${d.points} puan` : ''}</small><div class="t-count">×${n}</div>${n ? `<p>${d.desc}</p>` : ''}</div>`;
        })
        .join('')}</div>`;
    } else if (this.albumTab === 'cats') {
      body = `<div class="grid">${CATS.map((c) => {
        const n = p.fed[c.id] ?? 0;
        return `<div class="tile ${n ? '' : 'locked'}"><div class="cat-swatch" style="--c1:${c.colors[0]};--c2:${c.colors[1]}"></div><b>${n ? c.name : '???'}</b><small>${n ? `${n} kez beslendi` : 'Henüz tanışmadınız'}</small>${n ? `<p>${c.desc}</p>` : ''}</div>`;
      }).join('')}</div>`;
    } else if (this.albumTab === 'records') {
      body = `<div class="records">${RECORD_TITLES.map((t, i) => {
        const has = p.records.includes(i);
        return `<div class="record ${has ? '' : 'locked'}"><div class="vinyl"></div><span>${has ? esc(t) : `Vol. ${i + 1} — ???`}</span>${has && this.cb.onPlayRecord ? `<button class="btn play" data-rec="${i}">▶ Çal</button>` : ''}</div>`;
      }).join('')}</div><p class="muted">Plaklar ${esc(g.area.name)}'nın çıkmaz sokaklarının sonunda saklı.</p>`;
    } else if (this.albumTab === 'badges') {
      body = `<div class="grid">${BADGES.map((b) => {
        const has = p.badges.includes(b.id);
        return `<div class="tile ${has ? '' : 'locked'}"><div class="t-big">${has ? b.emoji : '🔒'}</div><b>${b.name}</b><small>${b.desc}</small></div>`;
      }).join('')}</div>`;
    } else if (this.albumTab === 'places') {
      const list = p.pois.map((i) => g.pois[i]).filter(Boolean);
      body = `<p class="muted">${list.length} / ${g.pois.length} mekân keşfedildi</p><ul class="places">${list
        .map((poi) => `<li>${POI_LABEL[poi.type].emoji} ${esc(poi.name)} <small>${POI_LABEL[poi.type].label}</small></li>`)
        .join('')}</ul>`;
    } else {
      const done = p.completedStreets.length;
      body = `<div class="stats-grid">
        <div><b>${p.score.toLocaleString('tr-TR')}</b><small>puan</small></div>
        <div><b>${g.level.title}</b><small>seviye</small></div>
        <div><b>${g.explorePct.toFixed(1)}%</b><small>keşif</small></div>
        <div><b>${fmtDist(p.distance)}</b><small>yürünen yol</small></div>
        <div><b>${fmtTime(p.playTime)}</b><small>oyun süresi</small></div>
        <div><b>${done} / ${g.net.streets.size}</b><small>tamamlanan sokak</small></div>
        <div><b>${p.questsDone}</b><small>görev</small></div>
        <div><b>x${p.bestCombo}</b><small>en iyi kombo</small></div>
        <div><b>${Object.values(p.counts).reduce((a, b) => a + b, 0)}</b><small>toplanan eşya</small></div>
      </div>
      ${done ? `<h4>Tamamlanan sokaklar</h4><p class="muted small">${p.completedStreets.map(esc).join(' · ')}</p>` : ''}`;
    }
    const c = this.card();
    c.innerHTML = `<h2>📒 ${esc(g.area.name)} Albümü</h2>
      <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${k === this.albumTab ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
      <div class="album-body">${body}</div>
      <button class="btn primary close-btn">Kapat</button>`;
    c.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) =>
      b.addEventListener('click', () => {
        this.albumTab = b.dataset.tab!;
        this.renderAlbum();
      }),
    );
    c.querySelectorAll<HTMLButtonElement>('.play').forEach((b) =>
      b.addEventListener('click', () => {
        const playing = this.cb.onPlayRecord?.(Number(b.dataset.rec));
        c.querySelectorAll<HTMLButtonElement>('.play').forEach((o) => (o.textContent = '▶ Çal'));
        if (playing) b.textContent = '⏹ Durdur';
      }),
    );
    c.querySelector('.close-btn')!.addEventListener('click', () => this.closeModal());
  }
}
