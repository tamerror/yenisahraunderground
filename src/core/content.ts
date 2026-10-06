import type { PoiType } from './types';

export type ItemKind = 'collectible' | 'consumable' | 'powerup' | 'record';
export type Rarity = 'yaygın' | 'orta' | 'nadir' | 'efsane';

export interface ItemDef {
  id: string;
  name: string;
  emoji: string;
  points: number;
  /** Relative spawn weight among randomly spawning items (0 = never random). */
  weight: number;
  kind: ItemKind;
  rarity: Rarity;
  /** Primary colour used by 3D models and minimap dots. */
  color: string;
  /** POI types around which this item likes to appear. */
  nearPoi?: PoiType[];
  desc: string;
}

export const ITEMS: ItemDef[] = [
  { id: 'simit', name: 'Simit', emoji: '🥯', points: 10, weight: 26, kind: 'collectible', rarity: 'yaygın', color: '#c8843a', nearPoi: ['bakery', 'market'], desc: 'Susamlı, çıtır. Fırınların etrafında bolca bulunur.' },
  { id: 'cay', name: 'Çay', emoji: '🍵', points: 10, weight: 26, kind: 'collectible', rarity: 'yaygın', color: '#b3261e', nearPoi: ['cafe', 'food'], desc: 'İnce belli bardakta tavşan kanı. Kafelerin yakınında.' },
  { id: 'lokum', name: 'Lokum', emoji: '🍬', points: 20, weight: 12, kind: 'collectible', rarity: 'orta', color: '#f48fb1', nearPoi: ['market', 'shop'], desc: 'Güllü lokum. Dükkânların önünde.' },
  { id: 'kart', name: 'İstanbulkart', emoji: '💳', points: 25, weight: 9, kind: 'collectible', rarity: 'orta', color: '#1e88e5', nearPoi: ['bus', 'metro'], desc: 'Biri düşürmüş! Duraklara yakın yerlerde.' },
  { id: 'nazar', name: 'Nazar Boncuğu', emoji: '🧿', points: 50, weight: 4, kind: 'collectible', rarity: 'nadir', color: '#1565c0', desc: 'Kem gözlere şiş. Nadir bulunur.' },
  { id: 'altin', name: 'Altın', emoji: '🪙', points: 150, weight: 1.2, kind: 'collectible', rarity: 'efsane', color: '#ffc107', desc: 'Çeyrek altın! Çok nadir.' },
  { id: 'mama', name: 'Kedi Maması', emoji: '🐟', points: 5, weight: 10, kind: 'consumable', rarity: 'yaygın', color: '#4fc3f7', nearPoi: ['market', 'pet'], desc: 'Sokak kedilerini beslemek için. Çantanda en fazla 5 tane taşıyabilirsin.' },
  { id: 'miknatis', name: 'Mıknatıs', emoji: '🧲', points: 0, weight: 1.6, kind: 'powerup', rarity: 'nadir', color: '#e53935', desc: '20 saniye boyunca yakındaki her şeyi kendine çeker.' },
  { id: 'scooter', name: 'Scooter', emoji: '🛴', points: 0, weight: 1.6, kind: 'powerup', rarity: 'nadir', color: '#43a047', desc: '20 saniye boyunca çok daha hızlı gidersin.' },
  { id: 'pusula', name: 'Pusula', emoji: '🧭', points: 0, weight: 1.2, kind: 'powerup', rarity: 'nadir', color: '#8d6e63', desc: '45 saniye boyunca en yakın plağı ve nadir eşyaları gösterir.' },
  { id: 'plak', name: 'Underground Plak', emoji: '💿', points: 300, weight: 0, kind: 'record', rarity: 'efsane', color: '#212121', desc: 'Kayıp "Yenisahra Underground" plakları. Çıkmaz sokakların sonunda saklı.' },
];

export const ITEM_BY_ID: Record<string, ItemDef> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

export const RECORD_TITLES = [
  'Vol. 1 — Çıkmaz Sokak Blues',
  'Vol. 2 — E-5 Gecesi',
  'Vol. 3 — Metro Tüneli',
  'Vol. 4 — Simitçi Ritmi',
  'Vol. 5 — Kedi Patisi Dub',
  'Vol. 6 — Sahra Rüzgârı',
  'Vol. 7 — Son Durak',
];

export interface CatDef {
  id: string;
  name: string;
  /** body colour, secondary (stripes/patch) colour */
  colors: [string, string];
  desc: string;
}

export const CATS: CatDef[] = [
  { id: 'tekir', name: 'Tekir', colors: ['#9e8a6e', '#5d4f3c'], desc: 'Mahallenin muhtarı. Her şeyi bilir.' },
  { id: 'pamuk', name: 'Pamuk', colors: ['#f5f5f5', '#e0e0e0'], desc: 'Bembeyaz, biraz nazlı.' },
  { id: 'duman', name: 'Duman', colors: ['#78909c', '#546e7a'], desc: 'Gri ve gizemli. Gece gezer.' },
  { id: 'zeytin', name: 'Zeytin', colors: ['#212121', '#424242'], desc: 'Kapkara, uğur getirir.' },
  { id: 'karamel', name: 'Karamel', colors: ['#ef8f3a', '#c56a1d'], desc: 'Turuncu ve obur.' },
  { id: 'boncuk', name: 'Boncuk', colors: ['#fafafa', '#ef8f3a'], desc: 'Beyaz-turuncu, oyuncu.' },
  { id: 'pasa', name: 'Paşa', colors: ['#5d4037', '#3e2723'], desc: 'Kocaman, ağır abi.' },
  { id: 'fistik', name: 'Fıstık', colors: ['#d7ccc8', '#8d6e63'], desc: 'Minicik yavru.' },
  { id: 'misket', name: 'Misket', colors: ['#bdbdbd', '#212121'], desc: 'Gözleri yeşil misket gibi.' },
  { id: 'sultan', name: 'Sultan', colors: ['#fff3e0', '#6d4c41'], desc: 'Fırının önünden ayrılmaz.' },
];

export const LEVELS: { at: number; title: string }[] = [
  { at: 0, title: 'Yabancı' },
  { at: 300, title: 'Misafir' },
  { at: 1000, title: 'Komşu' },
  { at: 2500, title: 'Mahalleli' },
  { at: 5000, title: 'Esnaf' },
  { at: 9000, title: 'Muhtar' },
  { at: 15000, title: 'Mahalle Efsanesi' },
  { at: 25000, title: 'Semt Kahramanı' },
  { at: 40000, title: 'Underground Efsanesi' },
];

export function levelFor(score: number): { index: number; title: string; next: number | null; prev: number } {
  let i = 0;
  while (i + 1 < LEVELS.length && score >= LEVELS[i + 1].at) i++;
  return { index: i, title: LEVELS[i].title, prev: LEVELS[i].at, next: i + 1 < LEVELS.length ? LEVELS[i + 1].at : null };
}

export const POI_LABEL: Record<PoiType, { label: string; emoji: string }> = {
  bakery: { label: 'Fırın', emoji: '🥖' },
  cafe: { label: 'Kafe', emoji: '☕' },
  food: { label: 'Lokanta', emoji: '🍽️' },
  market: { label: 'Market', emoji: '🛒' },
  mosque: { label: 'Cami', emoji: '🕌' },
  school: { label: 'Okul', emoji: '🏫' },
  park: { label: 'Park', emoji: '🌳' },
  pharmacy: { label: 'Eczane', emoji: '💊' },
  pet: { label: 'Petshop', emoji: '🐾' },
  shop: { label: 'Dükkân', emoji: '🛍️' },
  bus: { label: 'Durak', emoji: '🚌' },
  metro: { label: 'Metro', emoji: 'Ⓜ️' },
};

/** Combo multiplier for a chain of n quick pickups. */
export function comboMultiplier(chain: number): number {
  if (chain >= 15) return 5;
  if (chain >= 10) return 4;
  if (chain >= 6) return 3;
  if (chain >= 3) return 2;
  return 1;
}

export const COMBO_WINDOW = 4.5;
export const MAX_MAMA = 5;
export const POWERUP_DURATION: Record<string, number> = { miknatis: 20, scooter: 20, pusula: 45 };
