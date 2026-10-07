import type { AreaData } from '../core/types';

export interface BundledArea {
  slug: string;
  name: string;
  district: string;
  aliases: string[];
  /** Street the game starts on; it and its cross streets form the opening chapter. */
  focus?: string;
}

/** Neighbourhoods shipped with the game (built from Overture Maps by tools/extract_overture.py). */
export const BUNDLED: BundledArea[] = [
  { slug: 'yenisahra', name: 'Yenisahra', district: 'Ataşehir', aliases: ['yenisahra', 'yeni sahra'], focus: 'Atalay Caddesi' },
  { slug: 'sahrayicedit', name: 'Sahrayıcedit', district: 'Kadıköy', aliases: ['sahrayıcedit', 'sahrayicedit', 'sahrayı cedit', 'sahrayıcedid'] },
  { slug: 'kozyatagi', name: 'Kozyatağı', district: 'Kadıköy', aliases: ['kozyatağı', 'kozyatagi'] },
  { slug: 'caferaga', name: 'Moda (Caferağa)', district: 'Kadıköy', aliases: ['moda', 'caferağa', 'caferaga', 'moda (caferağa)'] },
  { slug: 'kuzguncuk', name: 'Kuzguncuk', district: 'Üsküdar', aliases: ['kuzguncuk'] },
  { slug: 'cihangir', name: 'Cihangir', district: 'Beyoğlu', aliases: ['cihangir'] },
];

export function normalizeName(s: string): string {
  return s
    .toLocaleLowerCase('tr-TR')
    .replace(/(^|\s)(mahallesi|mah\.?|mh\.?|semti)(?=\s|,|$)/g, ' ')
    .replace(/,.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findBundled(query: string): BundledArea | null {
  const q = normalizeName(query);
  return BUNDLED.find((b) => b.aliases.includes(q) || normalizeName(b.name) === q) ?? null;
}

export async function loadBundled(b: BundledArea): Promise<AreaData> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${b.slug}.json`);
  if (!res.ok) throw new Error(`Harita dosyası yüklenemedi (${res.status})`);
  return (await res.json()) as AreaData;
}

export function slugify(s: string): string {
  const map: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };
  return normalizeName(s)
    .replace(/[çğıöşüâîû]/g, (c) => map[c] ?? c)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
