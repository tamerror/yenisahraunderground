import { CATS, RECORD_TITLES } from './content';
import type { Progress } from './progress';

export interface BadgeDef {
  id: string;
  name: string;
  emoji: string;
  desc: string;
  check(p: Progress, explorePct: number, totals: { streets: number; pois: number }): boolean;
}

const fedCount = (p: Progress) => Object.keys(p.fed).length;

export const BADGES: BadgeDef[] = [
  { id: 'ilk', name: 'İlk Adım', emoji: '👣', desc: 'İlk eşyanı topla.', check: (p) => Object.values(p.counts).some((n) => n > 0) },
  { id: 'simitci', name: 'Simitçi', emoji: '🥯', desc: '25 simit topla.', check: (p) => (p.counts.simit ?? 0) >= 25 },
  { id: 'caykolik', name: 'Çaykolik', emoji: '🍵', desc: '25 çay topla.', check: (p) => (p.counts.cay ?? 0) >= 25 },
  { id: 'nazarlik', name: 'Nazarlık', emoji: '🧿', desc: '5 nazar boncuğu topla.', check: (p) => (p.counts.nazar ?? 0) >= 5 },
  { id: 'zengin', name: 'Altın Günü', emoji: '🪙', desc: '3 altın bul.', check: (p) => (p.counts.altin ?? 0) >= 3 },
  { id: 'kedisever', name: 'Kedisever', emoji: '🐈', desc: 'Bir sokak kedisini besle.', check: (p) => fedCount(p) >= 1 },
  { id: 'kedidostu', name: 'Kedi Dostu', emoji: '😻', desc: '5 farklı kediyi besle.', check: (p) => fedCount(p) >= 5 },
  { id: 'kedibabasi', name: 'Mahallenin Kedi Babası', emoji: '🐾', desc: `${CATS.length} kedinin hepsini besle.`, check: (p) => fedCount(p) >= CATS.length },
  { id: 'plak1', name: 'Plak Avcısı', emoji: '💿', desc: 'İlk Underground plağını bul.', check: (p) => p.records.length >= 1 },
  { id: 'underground', name: 'Yenisahra Underground', emoji: '🎧', desc: `${RECORD_TITLES.length} plağın hepsini bul.`, check: (p) => p.records.length >= RECORD_TITLES.length },
  { id: 'metro', name: 'Yeraltına İniş', emoji: 'Ⓜ️', desc: 'Metro istasyonuna ulaş.', check: (p) => p.metro },
  { id: 'kasif10', name: 'Meraklı', emoji: '🔭', desc: 'Mahallenin %10\'unu keşfet.', check: (_p, e) => e >= 10 },
  { id: 'kasif25', name: 'Kâşif', emoji: '🗺️', desc: 'Mahallenin %25\'ini keşfet.', check: (_p, e) => e >= 25 },
  { id: 'kasif50', name: 'Gezgin', emoji: '🧭', desc: 'Mahallenin yarısını keşfet.', check: (_p, e) => e >= 50 },
  { id: 'kasif75', name: 'Sokak Ustası', emoji: '🏙️', desc: 'Mahallenin %75\'ini keşfet.', check: (_p, e) => e >= 75 },
  { id: 'kasif95', name: 'Her Taşın Altı', emoji: '🏆', desc: 'Mahallenin %95\'ini keşfet.', check: (_p, e) => e >= 95 },
  { id: 'sokak5', name: 'Sokak Sokak', emoji: '🚏', desc: '5 sokağı baştan sona yürü.', check: (p) => p.completedStreets.length >= 5 },
  { id: 'sokak25', name: 'Adres Defteri', emoji: '📒', desc: '25 sokağı baştan sona yürü.', check: (p) => p.completedStreets.length >= 25 },
  { id: 'mekan10', name: 'Müdavim', emoji: '🏪', desc: '10 mekân keşfet.', check: (p) => p.pois.length >= 10 },
  { id: 'mekan50', name: 'Esnafın Dostu', emoji: '🤝', desc: '50 mekân keşfet.', check: (p) => p.pois.length >= 50 },
  { id: 'kombo3', name: 'Seri', emoji: '⚡', desc: 'x3 kombo yap.', check: (p) => p.bestCombo >= 3 },
  { id: 'kombo5', name: 'Durdurulamaz', emoji: '🔥', desc: 'x5 kombo yap.', check: (p) => p.bestCombo >= 5 },
  { id: 'gorev10', name: 'Görev Adamı', emoji: '📜', desc: '10 görev tamamla.', check: (p) => p.questsDone >= 10 },
  { id: 'yurur1', name: 'Yürüyüşçü', emoji: '👟', desc: '1 km yürü.', check: (p) => p.distance >= 1000 },
  { id: 'yurur5', name: 'Maratoncu', emoji: '🏃', desc: '5 km yürü.', check: (p) => p.distance >= 5000 },
];

/** Returns badges that are newly earned (and records them in progress). */
export function checkBadges(p: Progress, explorePct: number, totals: { streets: number; pois: number }): BadgeDef[] {
  const out: BadgeDef[] = [];
  for (const b of BADGES) {
    if (p.badges.includes(b.id)) continue;
    if (b.check(p, explorePct, totals)) {
      p.badges.push(b.id);
      out.push(b);
    }
  }
  return out;
}
