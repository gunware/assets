'use strict';

/* ─────────────────────────────────────────────
 *  Tri manuel du catalogue genere par describe.js
 * ───────────────────────────────────────────── */

const NO_FILTER = new Set(['2', '9', '10', 'prop_2', 'prop_7']);

const ALLOWED = {
  '1': ['heist', 'costume', 'tactical', 'party', 'outdoor', 'streetwear'],
  '3': ['casual', 'uniform', 'streetwear', 'tactical', 'sport', 'outdoor', 'suit', 'elegant', 'biker'],
  '4': ['casual', 'streetwear', 'sport', 'elegant', 'suit', 'uniform', 'tactical', 'biker', 'beach', 'outdoor', 'underwear', 'costume', 'party'],
  '5': ['casual', 'sport', 'streetwear', 'tactical', 'uniform', 'biker'],
  '6': ['casual', 'sport', 'elegant', 'suit', 'streetwear', 'uniform', 'tactical', 'biker', 'beach', 'outdoor', 'costume'],
  '7': ['casual', 'elegant', 'suit', 'streetwear', 'tactical', 'outdoor', 'uniform', 'sport'],
  '8': ['casual', 'streetwear', 'sport', 'underwear', 'uniform', 'tactical', 'elegant', 'suit', 'outdoor', 'beach'],
  '11': ['casual', 'streetwear', 'sport', 'elegant', 'suit', 'party', 'uniform', 'tactical', 'biker', 'beach', 'outdoor', 'costume'],
  'prop_0': ['casual', 'streetwear', 'tactical', 'biker', 'costume', 'uniform', 'party', 'sport', 'elegant', 'outdoor'],
  'prop_1': ['casual', 'sport', 'elegant', 'party', 'tactical', 'streetwear', 'outdoor', 'biker'],
  'prop_6': ['elegant', 'sport', 'casual', 'streetwear', 'biker', 'suit']
};

const DEFAUT = { '1': 'costume', '6': 'casual', 'prop_6': 'casual' };

const INDICES = [
  [/cagoule|passe-montagne|braqueur|hockey|balaclava|ski mask/, 'heist'],
  [/elfe|dinosaure|clown|citrouille|squelette|père noël|pere noel|animal|oiseau|déguisement|licorne|zombie|masque de fête/, 'costume'],
  [/tactique|militaire|camouflage|treillis|pare-balles|balistique|holster|police|sheriff|swat|gendarme|combat|sécurité|securite|gaz/, 'tactical'],
  [/écharpe|echarpe|bonnet|fourr|doudoune|parka|manteau|moufle|tricot|laine|polaire|anorak|cache-oreilles|imperméable|impermeable|ciré|cire/, 'outdoor'],
  [/costume|cravate|smoking|blazer|tailleur|veston|mocassin|chemise habillée|noeud papillon|nœud papillon/, 'suit'],
  [/escarpin|talon|soirée|soiree|paillette|sequin|robe longue|montre de luxe/, 'elegant'],
  [/tong|sandale|maillot de bain|bikini|paréo|pareo|hawa|nu-pieds/, 'beach'],
  [/boxer|culotte|soutien-gorge|string|brassière|brassiere|slip|caleçon|calecon|pyjama|nuisette|lingerie/, 'underwear'],
  [/motard|moto|biker|clouté|cloute|perfecto/, 'biker'],
  [/jogging|survêtement|survetement|basket|running|maillot d'équipe|short de sport|sportif|sportive|entraînement/, 'sport'],
  [/salopette|chantier|haute visibilité|réfléchissant|reflechissant|tablier|ouvrier|uniforme|bleu de travail|livreur|cuisine|blouse|infirmi|medical|médical/, 'uniform'],
  [/capuche|sweat|hoodie|baggy|skate|graffiti|casquette|streetwear|bandana/, 'streetwear']
];

/** Vignettes ou la piece est invisible : peau nue, pas un sous-vetement. */
const NU = /\b(nu|nue|nus|nues)\b/i;
const VIDE = /^(aucun|aucune|none)$/i;

/**
 * Tri manuel des categories : chaque emplacement n accepte que des rayons qui
 * ont un sens pour lui, le reste est reclasse par mot-cle puis par defaut.
 */
function applyRules(entry, folder) {
  if (!entry || typeof entry !== 'object' || typeof entry.category !== 'string') return entry;

  if (NO_FILTER.has(folder)) {
    entry.category = 'none';
    return entry;
  }

  const nom = String(entry.fr || '');
  if (VIDE.test(nom.trim()) || NU.test(nom)) {
    entry.category = 'none';
    return entry;
  }

  const permis = ALLOWED[folder];
  if (!permis || permis.indexOf(entry.category) !== -1) return entry;

  const cherche = (nom + ' ' + (entry.tags_fr || []).join(' ')).toLowerCase();
  for (const [re, style] of INDICES) {
    if (permis.indexOf(style) !== -1 && re.test(cherche)) {
      entry.category = style;
      return entry;
    }
  }

  entry.category = DEFAUT[folder] || (permis.indexOf('casual') !== -1 ? 'casual' : permis[0]);
  return entry;
}

/* ─────────────────────────────────────────────
 *  Rayons trop rares pour meriter un bouton
 * ───────────────────────────────────────────── */

const VOISIN = {
  suit: 'elegant', elegant: 'suit', party: 'elegant',
  heist: 'costume', costume: 'casual', beach: 'sport', outdoor: 'casual',
  biker: 'streetwear', tactical: 'uniform', uniform: 'casual', sport: 'casual',
  streetwear: 'casual', underwear: 'casual', casual: 'casual',

  // Les trois etiquettes retirees, gardees comme passerelles : le catalogue
  // deja en base les porte encore tant qu il n a pas ete refait.
  work: 'uniform', winter: 'outdoor', gang: 'streetwear'
};

const MIN = 3;

/**
 * Un rayon d une ou deux pieces n est pas un rayon : il est reverse vers son
 * voisin le plus proche, ou retire, pour que la barre de filtres reste lisible.
 */
function mergeRares(entries) {
  const compte = () => {
    const c = {};
    for (const key of Object.keys(entries)) {
      const cat = entries[key].category;
      if (cat && cat !== 'none') c[cat] = (c[cat] || 0) + 1;
    }
    return c;
  };

  let n = 0;

  for (let passe = 0; passe < 6; passe++) {
    const q = compte();
    const rares = Object.keys(q).filter((c) => q[c] < MIN);
    if (!rares.length) break;

    for (const c of rares) {
      const dest = VOISIN[c] || 'casual';
      const viable = (q[dest] || 0) >= MIN ? dest : 'none';

      for (const key of Object.keys(entries)) {
        if (entries[key].category === c) { entries[key].category = viable; n++; }
      }
    }
  }

  return n;
}

/* ─────────────────────────────────────────────
 *  Noms lisibles sous les vignettes
 * ───────────────────────────────────────────── */

/** Prefixes qui repetent le titre du groupe : "Coiffure courte" sous "Cheveux". */
const REDONDANT = {
  '2': [/^(coiffure|coupe de cheveux|coupe|cheveux)\s+/i, /^(hairstyle|haircut|hair)\s+/i],
  'overlay_0': [/^(peau avec des |peau avec |imperfections de la |imperfections de |imperfections |peau )/i, /^(skin with |skin |imperfections of |imperfections |blemishes )/i],
  'overlay_1': [/^barbe\s+(de\s+)?/i, /^(beard|stubble)\s+/i],
  'overlay_2': [/^sourcils\s+/i, /^eyebrows?\s+/i],
  'overlay_4': [/^maquillage\s+/i, /^(makeup|make-up)\s+/i],
  'overlay_5': [/^blush\s+/i, /^blush\s+/i],
  'overlay_6': [/^teint\s+/i, /^(complexion|skin tone)\s+/i],
  'overlay_8': [/^(rouge à lèvres|lèvres|levres)\s+/i, /^(lipstick|lips)\s+/i],
  'overlay_10': [/^(pilosité du torse|poils du torse|torse)\s+/i, /^chest\s+(hair\s+)?/i]
};

/** Le meme mot peut se cacher au milieu : "short haircut fringe". */
const MOT = {
  '2': [/\b(cheveux|coiffure)\b/gi, /\b(hairstyle|haircut|hair)\b/gi],
  'overlay_0': [/\b(peau)\b/gi, /\b(skin|imperfections|blemishes)\b/gi],
  'overlay_1': [/\b(barbe)\b/gi, /\b(beard)\b/gi],
  'overlay_2': [/\b(sourcils)\b/gi, /\b(eyebrows?)\b/gi],
  'overlay_4': [/\b(maquillage)\b/gi, /\b(makeup|make-up)\b/gi],
  'overlay_5': [/\b(blush)\b/gi, /\b(blush)\b/gi],
  'overlay_6': [/\b(teint)\b/gi, /\b(complexion)\b/gi],
  'overlay_8': [/\b(lèvres|levres)\b/gi, /\b(lipstick|lips)\b/gi],
  'overlay_10': [/\b(pilosité|poils|torse)(?=\s|$)/gi, /\b(chest|torso|hair)\b/gi]
};

/** Reste generique apres coupe : le nom ne dit plus rien de la piece. */
const GENERIQUE = /^(peau|skin|maquillage|makeup|cheveux|hair|coiffure|barbe|beard|sourcils|eyebrows?|blush|teint|complexion|lèvres|levres|lips|lipstick|torse|chest|imperfections|blemishes)$/i;

const PREPOSITION = /^(de |des |du |d'|à |a |en |la |le |les |of |with |the )/i;

/** Traductions ou le modele derape systematiquement. */
const FAUTES = [
  ['2', /^bouche\b/i, (fr) => fr.replace(/^bouche/i, 'Carré'), null],
  ['2', /^longs cheveux /i, (fr) => fr.replace(/^longs cheveux /i, 'Longs '), null],
  ['overlay_1', /gueule de bois/i, () => 'Moustache fournie', () => 'Full mustache'],
  ['overlay_1', /gueule de fou/i, (fr, en) => (/goatee/i.test(en) ? 'Bouc' : 'Fournie'), (en) => (/goatee/i.test(en) ? 'Goatee' : 'Full beard')],
  ['overlay_4', /^tattoo\b/i, (fr) => fr.replace(/^tattoo/i, 'Tatouage'), null],
  ['overlay_11', /pénétration|penetration/i, () => 'Impacts', () => 'Impact marks']
];

/**
 * Nom lisible sous une vignette : sans le mot que le groupe porte deja,
 * sans faute connue, assez court pour tenir sur deux lignes.
 */
function shortName(entry, folder) {
  if (!entry || typeof entry.fr !== 'string') return entry;
  if (VIDE.test(entry.fr.trim())) return entry;

  const coupe = REDONDANT[folder];

  if (coupe) {
    const mots = MOT[folder];

    const taille = (txt, prefixe, interne, repli) => {
      let v = String(txt).replace(prefixe, '');
      if (interne) v = v.replace(interne, ' ');
      v = v.replace(/\s{2,}/g, ' ').trim().replace(PREPOSITION, '').trim();
      if (!v || v.length < 2 || GENERIQUE.test(v)) return repli;
      return v.charAt(0).toUpperCase() + v.slice(1);
    };

    entry.fr = taille(entry.fr, coupe[0], mots && mots[0], 'Classique');
    entry.en = taille(entry.en, coupe[1], mots && mots[1], 'Classic');
  }

  for (const [dossier, re, fr, en] of FAUTES) {
    if (dossier !== folder || !re.test(entry.fr)) continue;
    const avant = entry.en;
    if (fr) entry.fr = fr(entry.fr, avant);
    if (en) entry.en = en(avant);
  }

  return entry;
}

module.exports = { applyRules, mergeRares, shortName, NO_FILTER, ALLOWED };
