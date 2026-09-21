const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { applyRules, mergeRares, shortName, NO_FILTER, ALLOWED } = require('./rules');

const ROOT = __dirname;
const API = process.env.VLM_API || 'http://127.0.0.1:8080/v1/chat/completions';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i === -1 ? d : argv[i + 1]; };
const has = n => argv.includes('--' + n);

const MAX = parseInt(arg('max', '22'), 10);
const PX = parseInt(arg('px', '448'), 10);
const FACEPX = parseInt(arg('facepx', '512'), 10);
const LIMIT = parseInt(arg('limit', '0'), 10);
const OUTARG = arg('out', 'cloth.json');
const OUT = path.isAbsolute(OUTARG) ? OUTARG : path.join(ROOT, OUTARG);
const GENDER = arg('gender', 'all');
const CATS_FILTER = arg('cat', null);
const FROM = parseInt(arg('from', '0'), 10);
const PAR = Math.max(1, parseInt(arg('jobs', '6'), 10));
const FORCE = has('force');

const CATS = {
  '1':  ['masque', 'un masque ou une cagoule porté sur le visage', 'cagoule, bandana, masque de hockey, respirateur, masque animal, foulard'],
  '2':  ['cheveux', 'une coiffure', 'coupe courte, crête, dreadlocks, chignon, queue de cheval, tresses, crâne rasé, frange'],
  '3':  ['bras', 'les bras et les manches du haut', 'manches longues, manches retroussées, bras nus, gants, mitaines, avant-bras bandés'],
  '4':  ['pantalon', 'un bas : pantalon, short ou jupe', 'jean slim, cargo, short, jupe crayon, jogging, pantalon de costume, leggings'],
  '5':  ['sac', 'un sac ou un parachute porté dans le dos', 'sac à dos, sacoche, parachute, sac de sport'],
  '6':  ['chaussures', 'une paire de chaussures', 'baskets montantes, bottes, talons, mocassins, tongs, rangers, escarpins'],
  '7':  ['accessoire', 'un accessoire de cou ou de torse', 'chaîne, collier, cravate, écharpe, bretelles, badge, holster'],
  '8':  ['sous-vêtement', 'un haut porté sous la veste', 'débardeur, tee-shirt, chemise, brassière, col roulé, torse nu'],
  '9':  ['gilet', 'un gilet pare-balles ou un harnais', 'gilet tactique, gilet léger, harnais'],
  '10': ['décal', 'un motif ou logo imprimé sur le torse', 'logo poitrine, imprimé dos, tache, éclaboussure'],
  '11': ['haut', 'un haut : tee-shirt, veste ou chemise', 'tee-shirt col V, veste en cuir, chemise ouverte, sweat à capuche, blazer, doudoune'],
  'prop_0': ['chapeau', 'un couvre-chef', 'casquette, bonnet, chapeau de cowboy, casque, casquette à l envers, borsalino'],
  'prop_1': ['lunettes', 'des lunettes', 'lunettes de soleil, aviateur, lunettes de vue, masque de ski, lunettes rondes'],
  'prop_2': ['oreilles', 'un accessoire d oreille', 'anneaux, clous, oreillette, pendantes, plusieurs piercings'],
  'prop_6': ['montre', 'une montre au poignet', 'montre de luxe, montre de sport, montre digitale, montre fine'],
  'prop_7': ['bracelet', 'un bracelet au poignet', 'bracelet de cuir, gourmette, perles, plusieurs bracelets'],
  'overlay_0':  ['imperfections', 'des imperfections de peau du visage', 'acné légère, boutons sur le front, cicatrices aux joues'],
  'overlay_1':  ['barbe', 'une pilosité faciale', 'barbe de 3 jours, bouc, moustache, barbe fournie, favoris, collier'],
  'overlay_2':  ['sourcils', 'des sourcils', 'sourcils épais, fins, arqués, broussailleux, rasés'],
  'overlay_3':  ['âge', 'un effet de vieillissement du visage', 'rides légères, rides marquées, traits creusés, cernes'],
  'overlay_4':  ['maquillage', 'un maquillage', 'smoky eyes, eyeliner, fards discrets, look gothique, contouring'],
  'overlay_5':  ['blush', 'un blush sur les joues', 'blush léger, blush pétant, pommettes marquées'],
  'overlay_6':  ['teint', 'un teint de peau', 'teint pâle, teint marqué, teint mat, peau nette'],
  'overlay_7':  ['soleil', 'un bronzage ou coup de soleil', 'bronzage léger, marques de lunettes, coup de soleil'],
  'overlay_8':  ['lèvres', 'un rouge à lèvres', 'lèvres brillantes, mates, gloss, lèvres soulignées'],
  'overlay_9':  ['grains de beauté', 'des grains de beauté ou taches de rousseur', 'taches de rousseur, grains de beauté, quelques points'],
  'overlay_10': ['poils torse', 'une pilosité de torse', 'torse glabre, poils légers, torse velu'],
  'overlay_11': ['marques', 'des marques sur le corps', 'cicatrices, éraflures, peau nette']
};

// Les rayons du magasin.
//
// L ancienne liste melangeait trois axes — un style (casual, elegant), un
// contexte (party, beach, work) et un type de vetement (underwear, heist) —, et
// plusieurs etiquettes se recouvraient : `suit` etait un sous-ensemble de
// `elegant`, `gang` de `streetwear`, `work` de `tactical` pour un policier. Le
// modele devait trancher sans regle, donc il tranchait au hasard.
//
// Trois corrections :
//   `work`   -> `uniform`  : il se lit avec le champ `job`, pas contre lui.
//   `winter` -> `outdoor`  : `winter` DOUBLONNAIT le champ `season`. Un manteau
//                            de pluie n est pas d hiver, et une robe legere
//                            d ete n est pas un rayon.
//   `gang`   -> supprime   : la couleur est bannie des noms comme des tags, et
//                            sans elle un bandana de gang ne se distingue pas
//                            d un bandana de skate. On ne garde pas une
//                            etiquette qu on ne peut pas decider.
// La procedure de decision, DANS L ORDRE. C est le levier le plus efficace sur
// un petit modele : sans ordre, deux etiquettes plausibles se valent et le choix
// devient du bruit d une vignette a l autre.
//
// Une DONNEE et non un texte fige : chaque emplacement n accepte qu une partie
// des rayons, et lui lire les huit autres l invite a choisir une etiquette que
// le schema refusera.
const STYLES_REGLES = [
  ['uniform',    'tenue de metier reconnaissable : blouse medicale, tablier de cuisine, salopette de chantier, haute visibilite, livreur, mecanicien, detenu.'],
  ['tactical',   'equipement de combat ou de protection : gilet pare-balles, treillis, camouflage, holster, plaques, tenue de police ou militaire.'],
  ['heist',      'dissimule le visage ou sert un braquage : cagoule, passe-montagne, masque de hockey, respirateur.'],
  ['costume',    'deguisement : animal, clown, alien, squelette, mascotte, fete costumee.'],
  ['suit',       'costume trois pieces, smoking, tailleur, cravate, noeud papillon.'],
  ['party',      'tenue de sortie du soir : robe de soiree, paillettes, sequins, club.'],
  ['sport',      'fait pour l effort : survetement, maillot d equipe, running, fitness.'],
  ['outdoor',    'protege du froid ou de la pluie : doudoune, parka, fourrure, anorak, grosse maille, impermeable.'],
  ['beach',      'plage et piscine : maillot, short de bain, tongs, pareo, chemise hawaienne.'],
  ['biker',      'moto : perfecto, cuir cloute, blouson a patchs, bottes de motard.'],
  ['streetwear', 'urbain : capuche, sweat, oversize, skate, casquette, bandana, jogging de ville.'],
  ['elegant',    'belle piece, coupe soignee, mode, sans etre un costume complet.'],
  ['underwear',  'sous-vetement ou tenue de nuit : brassiere, boxer, pyjama, nuisette.'],
  ['casual',     'tout le reste : le vetement de tous les jours, simple.']
];

const STYLES = STYLES_REGLES.map(r => r[0]);

/**
 * La procedure reduite aux rayons ouverts a cet emplacement, renumerotee.
 * L ordre d origine est conserve : c est lui qui arbitre.
 */
function aideFor(permis) {
  const lignes = STYLES_REGLES
    .filter(r => permis.indexOf(r[0]) !== -1)
    .map((r, i) => (i + 1) + '. ' + r[0] + ' - ' + r[1]);

  return 'Applique la PREMIERE regle qui correspond, puis arrete-toi.\n'
    + lignes.join('\n')
    + '\nNe choisis PAS le rayon d apres le reste de la tenue : juge uniquement la piece decrite.';
}

const TIERS = ['basic', 'standard', 'premium', 'luxury'];
const SEASONS = ['all', 'summer', 'winter'];
const JOBS = ['none', 'police', 'medical', 'firefighter', 'mechanic', 'chef', 'construction', 'security', 'delivery', 'military', 'prison', 'athlete'];
const INTENSITY = ['none', 'light', 'medium', 'strong'];

const FACE = /^overlay_(0|1|2|3|4|5|6|7|8|9)$/;
const NO_STYLE = c => c.indexOf('overlay_') === 0;

const COLORS = /\b(rouges?|bleues?|bleus?|vertes?|verts?|jaunes?|noires?|noirs?|blanches?|blancs?|grises?|gris|roses?|violettes?|violets?|oranges?|marrons?|beiges?|dorées?|dorés?|argentées?|argentés?|turquoises?|bordeaux|kakis?|crème|fuchsia|pourpres?|brunes?|bruns?|clairs?|claires?|foncées?|foncés?|sombres?|pastel|bicolores?|multicolores?|colorées?|colorés?|red|blue|green|yellow|black|white|grey|gray|pink|purple|orange|brown|beige|golden|gold|silver|turquoise|khaki|cream|dark|light|colou?red|multicolou?red)\b/gi;

function toJpeg(file, cat) {
  const zoom = FACE.test(cat);
  const px = zoom ? FACEPX : PX;
  const pre = zoom ? '[0]crop=iw*0.62:ih*0.78:iw*0.19:ih*0.04,' : '[0]';
  const vf = pre + 'scale=' + px + ':' + px + ':force_original_aspect_ratio=decrease[s];color=white:s=' + px + 'x' + px + '[bg];[bg][s]overlay=(W-w)/2:(H-h)/2';
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', file,
      '-filter_complex', vf,
      '-frames:v', '1', '-q:v', '3', '-f', 'mjpeg', 'pipe:1'
    ], { maxBuffer: 32 * 1024 * 1024, encoding: 'buffer' },
    (err, stdout) => err ? reject(err) : resolve(stdout));
  });
}

const FIX_FR = {
  'tshirt': 't-shirt', 'tee shirt': 't-shirt', 'teeshirt': 't-shirt', 'tee-shirt': 't-shirt',
  'tank top': 'débardeur', 'crop top': 'haut court', 'hoodie': 'sweat à capuche',
  'sweatshirt': 'sweat', 'pull over': 'pull', 'jeans': 'jean', 'sneakers': 'baskets',
  'boots': 'bottes', 'cap': 'casquette', 'beanie': 'bonnet', 'sunglasses': 'lunettes de soleil',
  'ete': 'été', 'carre': 'carré', 'carree': 'carrée', 'cotele': 'côtelé', 'cotelee': 'côtelée',
  'delave': 'délavé', 'delavee': 'délavée', 'evase': 'évasé', 'evasee': 'évasée',
  'zippe': 'zippé', 'zippee': 'zippée', 'raye': 'rayé', 'rayee': 'rayée',
  'brode': 'brodé', 'brodee': 'brodée', 'imprime': 'imprimé', 'imprimee': 'imprimée',
  'decollete': 'décolleté', 'decolletee': 'décolletée', 'epaule': 'épaule', 'epaules': 'épaules',
  'epais': 'épais', 'epaisse': 'épaisse', 'leger': 'léger', 'legere': 'légère',
  'crete': 'crête', 'rase': 'rasé', 'rasee': 'rasée', 'cotes': 'côtes',
  'boutonne': 'boutonné', 'boutonnee': 'boutonnée', 'ferme': 'fermé', 'fermee': 'fermée',
  'resille': 'résille', 'matiere': 'matière', 'dechire': 'déchiré', 'dechiree': 'déchirée',
  'usee': 'usée', 'doublee': 'doublée', 'fourre': 'fourré', 'fourree': 'fourrée',
  'cintre': 'cintré', 'cintree': 'cintrée', 'plisse': 'plissé', 'plissee': 'plissée',
  'echarpe': 'écharpe', 'elegant': 'élégant', 'elegante': 'élégante',
  'deguisement': 'déguisement', 'tete': 'tête', 'ajuste': 'ajusté', 'ajustee': 'ajustée',
  'serre': 'serré', 'serree': 'serrée', 'perle': 'perlé', 'perlee': 'perlée',
  'decontracte': 'décontracté', 'decontractee': 'décontractée', 'medaille': 'médaille',
  'chaine': 'chaîne', 'a capuche': 'à capuche', 'a manches': 'à manches', 'a col': 'à col',
  'a boutons': 'à boutons', 'a fermeture': 'à fermeture', 'a lacets': 'à lacets',
  'a talons': 'à talons', 'a bretelles': 'à bretelles', 'a pois': 'à pois', 'a carreaux': 'à carreaux',
  'trois quarts': 'trois-quarts', 'mi longue': 'mi-longue', 'mi long': 'mi-long',
  'col v': 'col V', 'col en v': 'col V', 'queue de cheval': 'queue-de-cheval',
  'coupé ajusté': 'coupe ajustée', 'coupé ample': 'coupe ample', 'coupé droit': 'coupe droite',
  'coupé slim': 'coupe slim', 'coupé large': 'coupe large', 'coupé court': 'coupe courte',
  'coupé': 'coupe', 'lacer': 'lacets', 'lacé': 'lacets', 'sans manche': 'sans manches',
  'col ras du cou': 'col rond', 'matériaux synthétiques': 'synthétique',
  'matière synthétique': 'synthétique', 'longueur longue': 'long'
};

const FIX_EN = {
  'tee shirt': 't-shirt', 'teeshirt': 't-shirt', 'tee-shirt': 't-shirt', 'tshirt': 't-shirt',
  'v neck': 'v-neck', 'vneck': 'v-neck', 'crew neck': 'crewneck', 'hood': 'hoodie',
  'sport shoes': 'sneakers', 'trainers': 'sneakers', 'trouser': 'trousers',
  'sleeveless top': 'tank top', 'jean': 'jeans', 'none': 'none'
};

const TAGS_BANNIS = /^(effet|visage|détail|détails|fond|forme|matière|matériau|équipement|tissu|vêtement|objet|élément|image|rendu|corps|personnage|style|apparence|texture|aspect|général|simple|normal|standard|classique|effect|face|detail|details|shape|material|equipment|fabric|clothing|item|render|body|character|appearance|look|general|plain)$/;

const REGLES = [
  [/blazer|costume|cravate|tailleur|smoking|veston|nœud papillon/, 'suit'],
  [/robe de soirée|robe longue|paillettes|sequins/, 'party'],
  [/maillot de bain|short de bain|tongs|hawaïenne|bikini|paréo/, 'beach'],
  [/doudoune|manteau|parka|fourrure|écharpe|moufles|anorak|imperméable/, 'outdoor'],
  [/blouson|motard|biker/, 'biker'],
  [/pare-balles|tactique|treillis|uniforme de police|militaire|holster/, 'tactical'],
  [/cagoule|masque de braqueur|masque de hockey|passe-montagne/, 'heist'],
  [/torse nu|brassière|culotte|string|soutien-gorge|pyjama|nuisette|caleçon|slip/, 'underwear'],
  [/jogging|survêtement|short de sport|maillot d'équipe/, 'sport'],
  [/salopette|blouse|tablier|haute visibilité|bleu de travail/, 'uniform']
];

function ortho(s, table) {
  for (const k in table) s = s.replace(new RegExp('(^|[\\s\\-])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[\\s\\-])', 'g'), (m, p) => p + table[k]);
  return s;
}

function clean(txt, fallback, en) {
  let s = String(txt || '').split('\n')[0].trim().toLowerCase();
  s = s.replace(/^["'«»\s\-•*]+/, '').replace(/["'«»\s\-•.!;,]+$/, '');
  s = s.replace(/^(un|une|des|le|la|les|c'est|il s'agit d'|image de|rendu de|a|an|the)\s+/i, '');
  s = s.replace(COLORS, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/\s+(de|du|des|d|à|a|au|aux|en|avec|sur|sous|et|le|la|les|un|une|pour|type|style|with|and|of|the)$/i, '').trim();
  s = ortho(s, en ? FIX_EN : FIX_FR);
  return s || fallback;
}

const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

/**
 * Les rayons possibles POUR CET EMPLACEMENT.
 *
 * C est la correction qui compte le plus. Avant, le modele choisissait parmi les
 * quatorze rayons, puis `applyRules` reclassait ce qui n avait pas de sens pour
 * l emplacement — une paire de chaussures rendue « heist », un masque rendu
 * « sport ». La reclassification tombait souvent sur le defaut, et c est ce
 * defaut qu on lisait ensuite dans la boutique.
 *
 * En posant la liste dans l enum du `json_schema` (`strict: true`), le modele ne
 * PEUT plus rendre un rayon hors sujet. Le filet de `rules.js` reste, mais il ne
 * sert plus qu aux vieilles entrees.
 */
function stylesFor(cat) {
  if (NO_FILTER.has(cat)) return ['none'];

  return ALLOWED[cat] || STYLES;
}

function schema(cat) {
  const p = {
    nom_fr: { type: 'string', maxLength: MAX + 8 },
    nom_en: { type: 'string', maxLength: MAX + 8 },
    tags_fr: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 },
    tags_en: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 }
  };
  if (NO_STYLE(cat)) {
    p.intensity = { type: 'string', enum: INTENSITY };
  } else {
    p.category = { type: 'string', enum: stylesFor(cat) };
    p.tier = { type: 'string', enum: TIERS };
    p.season = { type: 'string', enum: SEASONS };
    p.job = { type: 'string', enum: JOBS };
  }
  return { type: 'object', properties: p, required: Object.keys(p), additionalProperties: false };
}

function prompt(cat) {
  const base = 'Tu etiquettes des elements 3D de GTA V pour le catalogue d\'un magasin de vetements.\n'
    + '\n'
    + 'CE QUE TU REGARDES. Le rendu montre un personnage entier, mais tu ne decris QU UNE piece :\n'
    + 'celle annoncee ensuite. Ignore tout le reste de la tenue, le corps et le fond.\n'
    + 'Si cette piece est absente du rendu, ou si l on ne voit que la peau nue a sa place,\n'
    + 'alors nom_fr = aucun et nom_en = none. Ne devine jamais une piece que tu ne vois pas.\n'
    + '\n'
    + 'REGLE ABSOLUE : jamais de couleur, ni dans les noms ni dans les tags. Ni « noir », ni\n'
    + '« clair », ni « bicolore ». Decris la FORME, la COUPE, la MATIERE apparente et les DETAILS.\n'
    + '\n'
    + '"nom_fr" : ' + MAX + ' caracteres maximum, en minuscules, sans article, au singulier.\n'
    + '  Un groupe nominal, jamais une phrase, jamais de point final, jamais un mot coupe.\n'
    + '  Francais correct, tous les accents (e e a e c) et les bons accords.\n'
    + '  Prefere le mot juste au mot vague : « perfecto » plutot que « veste », « escarpin »\n'
    + '  plutot que « chaussure », « debardeur » plutot que « haut ».\n'
    + '  N invente aucune marque et ne cite aucun nom propre.\n'
    + '"nom_en" : la meme chose en anglais, pas une traduction mot a mot d un mot approximatif.\n'
    + '"tags_fr" / "tags_en" : 2 a 4 mots-cles de RECHERCHE, les memes dans les deux langues,\n'
    + '  dans le meme ordre. Un bon tag est ce qu un joueur taperait : « capuche », « manches\n'
    + '  longues », « col v », « cuir », « a lacets », « imprime ». Un mauvais tag repete le nom,\n'
    + '  ou reste general : « vetement », « style », « tissu », « detail ».\n';

  if (NO_STYLE(cat)) {
    return base
      + '"intensity" : a quel point l effet se voit sur le visage.\n'
      + '  none   = le visage est parfaitement net, aucun effet.\n'
      + '  light  = il faut chercher pour le voir.\n'
      + '  medium = visible au premier coup d oeil.\n'
      + '  strong = c est la premiere chose qu on voit.\n'
      + 'Si intensity = none, alors nom_fr = aucun et nom_en = none.';
  }

  const permis = stylesFor(cat);
  const rayon = permis.length === 1 && permis[0] === 'none'
    ? '"category" : cet emplacement n a pas de rayon. Rends toujours none.\n'
    : '"category" : le rayon du magasin. Choisis UNIQUEMENT parmi : ' + permis.join(', ') + '\n' + aideFor(permis) + '\n';

  return base
    + '\n' + rayon
    + '\n"tier" : la qualite VISIBLE de la piece, pas son prix suppose.\n'
    + '  basic    = coupe grossiere, tissu mat, use, delave, troue.\n'
    + '  standard = correct et ordinaire, ce que porte tout le monde.\n'
    + '  premium  = coupe nette, finitions soignees, matiere qui accroche la lumiere.\n'
    + '  luxury   = piece d exception : fourrure, soie, cuir travaille, broderie, bijou.\n'
    + '\n"season" : all par defaut. summer si la piece est legere ou decouvrante,\n'
    + '  winter si elle est epaisse, fourree ou matelassee. Une piece ordinaire est all.\n'
    + '\n"job" : le metier dont c est l uniforme, et seulement s il est reconnaissable\n'
    + '  sans hesitation. Dans le doute, none.';
}

async function ask(file, cat, meta, extra) {
  const b64 = (await toJpeg(file, cat)).toString('base64');
  const body = {
    messages: [
      { role: 'system', content: prompt(cat) },
      { role: 'user', content: [
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b64 } },
        { type: 'text', text: 'Ce rendu montre ' + meta[1] + '.\n'
          + 'Style de nom attendu : ' + meta[2] + '.\n'
          + 'Si l\'élément est absent du rendu, nom_fr = aucun et nom_en = none.' + (extra || '') }
      ] }
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'item', strict: true, schema: schema(cat) } },
    temperature: 0.15,
    top_p: 0.8,
    max_tokens: 200,
    stream: false
  };
  const j = await post(body);
  try { return JSON.parse(j.choices[0].message.content); } catch (e) { return { nom_fr: j.choices[0].message.content }; }
}

function tagList(arr, nom, en) {
  return (Array.isArray(arr) ? arr : [])
    .map(t => clean(t, '', en))
    .filter(t => t && t.length > 2 && t.length <= 24 && t !== nom && !TAGS_BANNIS.test(t) && !/(^| )[a-z]( |$)/.test(t))
    .filter((t, i, a) => a.indexOf(t) === i).slice(0, 4);
}

// llama-server repond 503 { "message": "Loading model" } tant que le modele n est
// pas sur le GPU, et il le fait AUSSI pendant les trente secondes qui suivent son
// lancement. Avec seize requetes en parallele, cela se traduisait par seize
// vignettes definitivement perdues pour la passe : le catch de la boucle se
// contentait de les compter en echec et de passer a la suivante.
//
// Ces codes-la ne veulent pas dire « ta demande est mauvaise », ils veulent dire
// « pas maintenant ». Ils se reessaient. Un 400, lui, ne se reessaie pas : la
// meme requete rendra la meme erreur, et boucler dessus ne ferait que retarder
// le reste de la file.
const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRIES = parseInt(arg('retries', '8'), 10);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function post(body) {
  let wait = 800;

  for (let attempt = 1; ; attempt++) {
    let r, text;

    try {
      r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (e) {
      // Serveur pas encore a l ecoute, ou coupe en cours de route.
      if (attempt > RETRIES) throw new Error('reseau ' + e.message + ' apres ' + RETRIES + ' essais');
      await sleep(backoff(wait, attempt));
      continue;
    }

    if (r.ok) return r.json();

    text = (await r.text()).slice(0, 200);

    if (!RETRY_STATUS.has(r.status) || attempt > RETRIES) {
      throw new Error('HTTP ' + r.status + ' ' + text);
    }

    await sleep(backoff(wait, attempt));
  }
}

// Le doublement seul ferait repartir les seize ouvriers ensemble, a la
// milliseconde : ils se remarcheraient dessus a chaque palier. Le grain aleatoire
// les etale.
function backoff(base, attempt) {
  const grow = Math.min(base * Math.pow(2, attempt - 1), 15000);

  return Math.round(grow * (0.7 + Math.random() * 0.6));
}

async function describe(file, cat) {
  const meta = CATS[cat] || ['élément', 'un élément de personnage', 'court, long, simple'];
  let p = await ask(file, cat, meta);
  let fr = clean(p.nom_fr, meta[0], false);
  if (fr.length > MAX) {
    const p2 = await ask(file, cat, meta, '\nLes noms doivent tenir en ' + MAX + ' caractères : va droit au but, sans mot inutile.');
    const fr2 = clean(p2.nom_fr, meta[0], false);
    if (fr2.length <= fr.length) { fr = fr2; p = p2; }
  }
  const en = clean(p.nom_en, fr, true);
  const vide = /^(aucun|aucune|rien|neant)$/.test(fr) || /^(none|nothing|no item)$/.test(en);

  const out = {
    fr: vide ? 'Aucun' : cap(fr),
    en: vide ? 'None' : cap(en),
    tags_fr: vide ? [] : tagList(p.tags_fr, fr, false),
    tags_en: vide ? [] : tagList(p.tags_en, en, true)
  };

  shortName(out, cat);

  if (NO_STYLE(cat)) {
    out.intensity = vide ? 'none' : (INTENSITY.indexOf(p.intensity) === -1 ? 'medium' : p.intensity);
    return out;
  }
  if (vide) {
    out.category = 'none'; out.tier = 'basic'; out.season = 'all'; out.job = 'none';
    return out;
  }

  out.category = STYLES.indexOf(p.category) === -1 ? 'casual' : p.category;
  out.tier = TIERS.indexOf(p.tier) === -1 ? 'standard' : p.tier;
  out.season = SEASONS.indexOf(p.season) === -1 ? 'all' : p.season;
  out.job = JOBS.indexOf(p.job) === -1 ? 'none' : p.job;

  // Le rattrapage par mot-cle ne s applique plus qu au REPLI.
  //
  // Avant, il ecrasait la reponse du modele a chaque fois qu un mot du nom
  // correspondait : une « veste de costume » devenait `suit` meme quand le
  // modele avait vu, a raison, un blouson de motard. Maintenant que l enum du
  // schema borne les rayons possibles pour l emplacement, une reponse hors
  // sujet n existe plus — et `casual` est le seul cas ou le modele a renonce.
  if (out.category === 'casual') {
    const cherche = (fr + ' ' + out.tags_fr.join(' ')).toLowerCase();

    for (const [re, style] of REGLES) if (re.test(cherche)) { out.category = style; break; }
  }

  if (out.category === 'underwear' || out.category === 'beach' || out.category === 'costume') out.job = 'none';
  if (out.job !== 'none' && out.category === 'casual') {
    out.category = (out.job === 'police' || out.job === 'military' || out.job === 'security') ? 'tactical' : 'uniform';
  }

  // `outdoor` ne force plus la saison : un impermeable protege de la pluie en
  // aout. Seule la matiere epaisse dit l hiver, et c est le modele qui la voit.
  if (out.category === 'beach') out.season = 'summer';

  return applyRules(out, cat);

}

const data = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};

function compte(t) {
  let n = 0;
  for (const g of Object.keys(t)) for (const c of Object.keys(t[g])) n += Object.keys(t[g][c]).length;
  return n;
}

// Ce que le fichier portait EN ARRIVANT. Cet outil n enleve jamais une entree :
// il en ajoute ou il en remplace. Une sauvegarde qui en compterait moins veut
// donc dire que quelque chose s est mal passe en amont.
//
// C est arrive : une passe ou toutes les requetes ont echoue a garde `data` vide
// et a ecrit `{}` par-dessus 6606 entrees. Le fichier faisait deux octets, et
// rien ne l a dit — ni pendant, ni apres.
const BASE = compte(data);

let dirty = 0;

const save = () => {
  const n = compte(data);
  const dest = n < BASE ? OUT + '.partiel' : OUT;

  // Une sauvegarde qui echoue ne doit PAS tuer la passe. Elle tombe toutes les
  // cinquante vignettes : mourir sur un fichier verrouille une seconde ferait
  // perdre la demi-heure de travail qui precede, et c est arrive.
  //
  // `dirty` n est remis a zero que sur un vrai succes : la prochaine sauvegarde
  // reessaie, avec tout ce qui s est accumule entre-temps.
  try {
    ecrire(dest, data);
    dirty = 0;
  } catch (e) {
    console.log('\n  sauvegarde impossible (' + (e.code || e.message) + ')');
    console.log('  Le travail reste en memoire, la prochaine sauvegarde reessaiera.\n');

    return;
  }

  if (dest !== OUT) {
    console.log('\n  REFUS D ECRIRE : ' + n + ' entree(s) contre ' + BASE + ' au chargement.');
    console.log('  ' + OUT + ' est laisse intact, le resultat partiel est dans ' + dest + '\n');
  }
};

/** Une attente BLOQUANTE de quelques dizaines de millisecondes. */
function attendreSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Ecriture ATOMIQUE : on ecrit a cote, puis on renomme. `writeFileSync` tronque
// le fichier AVANT d ecrire — une passe coupee au mauvais instant laisse donc un
// catalogue vide ou tronque. Le renommage, lui, est indivisible.
//
// Sous WINDOWS, ce renommage echoue en EPERM tant qu un autre processus tient la
// destination ouverte : l antivirus qui vient de scanner les deux megaoctets
// qu on a ecrits, l indexeur, un editeur, le serveur FiveM qui lit le catalogue.
// Le verrou dure quelques dizaines de millisecondes — on repasse plutot que de
// mourir dessus, ce que la premiere version faisait.
function ecrire(dest, table) {
  const temp = dest + '.tmp';
  const contenu = JSON.stringify(table, null, 1);

  fs.writeFileSync(temp, contenu, 'utf8');

  for (let essai = 1; essai <= 6; essai++) {
    try {
      fs.renameSync(temp, dest);

      return;
    } catch (e) {
      if (e.code !== 'EPERM' && e.code !== 'EACCES' && e.code !== 'EBUSY') throw e;

      attendreSync(60 * essai);
    }
  }

  // Le verrou tient bon. La fenetre de troncature d une ecriture directe est un
  // moindre mal : le contenu complet est deja sur le disque dans le .tmp, et il
  // y RESTE si celle-ci echoue a son tour.
  fs.writeFileSync(dest, contenu, 'utf8');

  try { fs.unlinkSync(temp); } catch (e) { /* il servira de copie */ }
}

const genders = GENDER === 'all' ? ['male', 'female'] : GENDER.split(',');
const jobs = [];
for (const g of genders) {
  const gdir = path.join(ROOT, g);
  if (!fs.existsSync(gdir)) continue;
  for (const cat of fs.readdirSync(gdir)) {
    if (!fs.statSync(path.join(gdir, cat)).isDirectory()) continue;
    if (CATS_FILTER && CATS_FILTER.split(',').indexOf(cat) === -1) continue;
    const files = fs.readdirSync(path.join(gdir, cat))
      .filter(f => f.toLowerCase().endsWith('.webp'))
      .sort((a, b) => parseInt(a) - parseInt(b))
      .filter(f => parseInt(f) >= FROM);
    for (const f of files) jobs.push({ g: g, cat: cat, id: path.basename(f, '.webp'), file: path.join(gdir, cat, f) });
  }
}

const todo = jobs.filter(j => FORCE || !(data[j.g] && data[j.g][j.cat] && data[j.g][j.cat][j.id]));
const run = LIMIT > 0 ? todo.slice(0, LIMIT) : todo;

process.on('SIGINT', () => { save(); console.log('\ninterrompu, ' + OUT + ' sauvegarde'); process.exit(0); });

const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);

(async () => {
  console.log('\n  ' + run.length + ' image(s) a traiter   (' + jobs.length + ' au total, ' + (jobs.length - todo.length) + ' deja faites)');
  console.log('  ' + PAR + ' requetes en parallele  ->  ' + OUT + '\n');
  const t0 = Date.now();
  let next = 0, done = 0, fails = 0;

  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= run.length) return;
      const j = run[i];
      let item;
      try { item = await describe(j.file, j.cat); }
      catch (e) { fails++; done++; console.log('  ! ' + j.g + '/' + j.cat + '/' + j.id + ' -> ' + e.message); continue; }
      if (!data[j.g]) data[j.g] = {};
      if (!data[j.g][j.cat]) data[j.g][j.cat] = {};
      data[j.g][j.cat][j.id] = item;
      dirty++; done++;
      const info = item.category
        ? '[' + item.category + '/' + item.tier + (item.job !== 'none' ? '/' + item.job : '') + ']'
        : '[' + item.intensity + ']';
      console.log('  ' + pad(done + '/' + run.length, 12) + pad(j.g + '/' + j.cat + '/' + j.id, 22) + pad(item.fr, 26) + pad(item.en, 26) + info);
      if (done % 50 === 0) {
        const sec = (Date.now() - t0) / 1000;
        console.log('  ---- ' + done + ' faites  |  ' + (done / sec).toFixed(1) + ' img/s  |  ETA '
          + Math.round((run.length - done) / (done / sec) / 60) + ' min  |  ' + fails + ' erreur(s) ----');
      }
      if (dirty >= 20) save();
    }
  };

  await Promise.all(Array.from({ length: PAR }, worker));
  for (const g of Object.keys(data)) for (const f of Object.keys(data[g])) if (f.indexOf('overlay_') !== 0) mergeRares(data[g][f]);
  save();
  const min = ((Date.now() - t0) / 60000).toFixed(1);
  console.log('\n  termine en ' + min + ' min  ->  ' + OUT + (fails ? '  (' + fails + ' erreurs)' : '') + '\n');
})();
