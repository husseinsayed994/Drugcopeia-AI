/*
 * Dawaya AI - grounded retrieval.
 *
 * Step 4 of the pipeline and the only place facts enter the assistant. It searches the app's
 * own Egyptian medicines database first, then the locally stored trusted documents, keeps the
 * top records, and turns them into (a) the reference block handed to the model, (b) the sources
 * list, and (c) the fallback card the UI shows whenever the output guard rejects a generation.
 * Nothing here invents: every field is copied from a record, and every record carries its source.
 *
 * Exposed as DawayaAIRetrieval.
 */
(function (global) {
  'use strict';

  const T = () => global.DawayaAIText;
  const S = () => global.DawayaAISearchIndex;

  const MEDICINE_FIELDS = [
    { name: 'nameEn', weight: 8, nameish: true },
    { name: 'nameAr', weight: 8, nameish: true },
    { name: 'ingredient', weight: 6, nameish: true },
    { name: 'manufacturer', weight: 2 },
    { name: 'drugClass', weight: 2 },
    { name: 'route', weight: 1 }
  ];
  const DOCUMENT_FIELDS = [
    { name: 'title', weight: 6, nameish: true },
    { name: 'aliases', weight: 5, nameish: true },
    { name: 'body', weight: 1 }
  ];

  /* Function words and form words carry no medicine identity. Searching them makes "price" pull
     in every row whose name ends in "(HOSPITAL PRICE)" and hides the brand the user typed. */
  const DEFAULT_IGNORE_TERMS = {
    ar: [
      'ما', 'ماذا', 'ايه', 'ايش', 'هو', 'هي', 'هم', 'عن', 'في', 'من', 'على', 'الي', 'كام', 'كم',
      'بكام', 'سعر', 'سعره', 'سعرها', 'ثمن', 'اعراض', 'عرض', 'علامات', 'دواء', 'دوا', 'ادويه',
      'عقار', 'علاج', 'استخدام', 'استخدامات', 'معلومات', 'جانبيه', 'اثار', 'اثر', 'تاثير',
      'تاثيرات', 'جرعه', 'جرعات', 'تركيز', 'مكون', 'مكونات', 'ماده', 'فعاله', 'شركه', 'مصنع',
      'قولي', 'قولى', 'عايز', 'عاوز', 'محتاج', 'اعرف', 'ممكن', 'لو', 'سمحت', 'سؤال',
      /* What the medicine is for names no medicine: "لازيكس مدر للبول" is one brand plus an
         indication, and the indication must not pull in a row whose name merely rhymes. */
      'بول', 'البول', 'للبول', 'تبول', 'مدر', 'مدره', 'مدرة', 'ادرار', 'إدرار', 'ضغط',
      'سكر', 'حراره', 'حرارة', 'الم', 'ألم', 'وجع', 'صداع', 'حساسيه', 'حساسية', 'كحه',
      'كحة', 'سعال', 'برد', 'التهاب', 'عدوي', 'عدوى', 'سخونه', 'سخونة', 'اسهال', 'إسهال',
      'امساك', 'إمساك', 'غثيان', 'قيء', 'دوخه', 'دوخة',
      'ملجم', 'مجم', 'جم', 'جرام', 'مل', 'لتر', 'قرص', 'اقراص', 'كبسوله', 'كبسولات',
      'امبول', 'حقنه', 'شراب', 'مرهم', 'كريم', 'قطره', 'بخاخ', 'نقط', 'اكياس', 'تحاميل',
      'بيشتغل', 'يشتغل', 'جوه', 'جوا', 'داخل', 'الجسم', 'جسم', 'طريقه', 'عمل', 'اشرح', 'اشرحلي',
      'ازاي', 'كيف', 'ليه', 'هل', 'بتاثر', 'بيعمل'
    ],
    en: [
      'what', 'whats', 'is', 'are', 'was', 'were', 'the', 'of', 'for', 'to', 'in', 'on', 'about',
      'tell', 'me', 'please', 'my', 'have', 'has', 'does', 'do', 'can', 'should', 'could', 'would',
      'use', 'uses', 'used', 'using', 'information', 'info', 'side', 'sides', 'effect', 'effects',
      'price', 'prices', 'cost', 'costs', 'how', 'much', 'many', 'where', 'when', 'why', 'which',
      'medicine', 'medicines', 'medication', 'drug', 'drugs', 'tablet', 'tablets', 'tab', 'tabs',
      'mg', 'ml', 'gm', 'gram', 'grams', 'dose', 'dosage', 'ingredient', 'ingredients', 'active',
      'brand', 'name', 'product', 'detail', 'details', 'body', 'work', 'works', 'working', 'inside',
      'mechanism', 'action', 'explain', 'describe', 'it', 'its', 'this', 'that', 'take', 'taking', 'long'
    ]
  };

  let medicineIndex = null;
  let documentIndex = null;
  let data = null;
  let settings = null;
  let ignoreTerms = null;

  /* ---------- configuration ---------- */

  /* Takes the "retrieval" object of policy-config.json, not the whole file: handing it the file
     leaves every knob (maxDocumentChunks, minScore, sectionTags) unset and the code defaults
     quietly answer instead of the published policy. */
  function configure(retrievalPolicy) {
    settings = { ...(retrievalPolicy || {}) };
    ignoreTerms = null;
    return api;
  }

  function ignoredTokens() {
    if (ignoreTerms) return ignoreTerms;
    const configured = settings && settings.ignoreTerms;
    const source = configured && (configured.ar || configured.en) ? configured : DEFAULT_IGNORE_TERMS;
    ignoreTerms = {};
    for (const language of ['ar', 'en']) {
      const set = new Set();
      for (const term of source[language] || []) {
        const normalized = T().normalize(term);
        if (normalized) set.add(normalized);
      }
      ignoreTerms[language] = set;
    }
    return ignoreTerms;
  }

  /* Query text reduced to the words that can name a medicine. Longer ignore terms also drop
     their article and plural variants ("الآثار" against "اثار"). */
  function medicineQuery(question) {
    const lists = ignoredTokens();
    const words = [];
    for (const token of T().tokenize(question)) {
      if (token.length < 2) continue;
      /* A strength ("500", "1.5") narrows a name but never identifies one; it is applied to
         the results below instead of being searched, because thousands of rows carry it. */
      if (/^\d+([.,]\d+)?$/.test(token)) continue;
      let skip = lists.en.has(token) || lists.ar.has(token);
      if (!skip) {
        for (const list of [lists.ar, lists.en]) {
          for (const term of list) {
            if (term.length >= 4 && token.includes(term)) { skip = true; break; }
          }
          if (skip) break;
        }
      }
      if (!skip && !words.includes(token)) words.push(token);
    }
    return words.join(' ');
  }

  /* A strength the reader typed narrows the answer but does not search: thousands of rows carry
     "500". It ranks instead, so "بنادول 500" puts the 500 mg product before a same-brand variant
     whose name has no such number. Single digits are skipped because they read as ages and counts. */
  function strengthValues(question) {
    const values = [];
    const source = T().normalize(question);
    const pattern = /(^|[^\p{L}\p{N}])(\d{2,}(?:[.,]\d+)?|\d[.,]\d+)(?=$|[^\p{L}\p{N}])/gu;
    let match;
    while ((match = pattern.exec(source))) {
      const value = match[2].replace(',', '.');
      if (!values.includes(value)) values.push(value);
    }
    return values;
  }

  function nameCarriesStrength(record, values) {
    if (!values.length) return false;
    const text = T().normalize(`${record.commercial_name_en || ''} ${record.commercial_name_ar || ''}`);
    return values.some(value => new RegExp(`(^|[^\\d.,])${value.replace('.', '[.,]')}(?![\\d])`).test(text));
  }

  /*
   * The app owns its datasets, so it hands them over instead of this module re-fetching them.
   * provider: { drugs, conditions, knowledge, clinicalNotes, arabicClinical, interactions, datasetMeta }
   */
  function build(provider, options) {
    data = provider || {};
    const maxDocs = Number(options && options.maxDocuments) || 0;
    medicineIndex = S().createIndex({ fields: MEDICINE_FIELDS, ...(settings || {}) });
    const drugs = Array.isArray(data.drugs) ? data.drugs : [];
    for (let i = 0; i < drugs.length; i += 1) {
      const drug = drugs[i];
      if (!drug) continue;
      medicineIndex.add({
        id: medicineId(drug, i),
        record: drug,
        fields: {
          nameEn: drug.commercial_name_en || drug.nameEn || '',
          nameAr: drug.commercial_name_ar || drug.nameAr || '',
          ingredient: drug.scientific_name || drug.ingredient || '',
          manufacturer: drug.manufacturer || '',
          drugClass: drug.drug_class || drug.drugClass || '',
          route: drug.route || ''
        }
      });
    }
    medicineIndex.build();

    documentIndex = S().createIndex({ fields: DOCUMENT_FIELDS, ...(settings || {}) });
    const chunks = collectDocumentChunks(maxDocs);
    for (const chunk of chunks) documentIndex.add(chunk);
    documentIndex.build();
    return api;
  }

  function medicineId(drug, position) {
    const key = T().compact(`${drug.commercial_name_en || ''}|${drug.commercial_name_ar || ''}|${drug.scientific_name || ''}|${drug.price_egp || ''}`);
    return key || `drug-${position}`;
  }

  /* Trusted documents come from two places: the shipped knowledge index built by
     tools/ai/build_knowledge_index.py, and - only when that index does not already cover them -
     the condition topics bundled in the app (MedlinePlus, each with its url and retrieval date). */
  function collectDocumentChunks(maxLimit) {
    const chunks = [];
    const payload = data.knowledge || {};
    const entries = Array.isArray(payload) ? payload : (payload.entries || []);
    for (const entry of entries) {
      chunks.push({
        id: `doc:${entry.id}`,
        record: entry,
        meta: { kind: 'knowledge' },
        fields: {
          title: entry.title || '',
          aliases: (entry.aliases || []).join(' '),
          body: entry.text || ''
        }
      });
    }
    const coversConditions = !Array.isArray(payload) && payload.coversConditions === true;
    if (coversConditions) return maxLimit > 0 ? chunks.slice(0, maxLimit) : chunks;

    const aliasMap = (!Array.isArray(payload) && payload.conditionAliasesEnAr) || {};
    const topics = data.conditions && Array.isArray(data.conditions.topics) ? data.conditions.topics : [];
    const conditionsMeta = (data.conditions && data.conditions.meta) || {};
    for (const topic of topics) {
      if (!topic || !topic.summary) continue;
      const title = topic.title || topic.primaryName || '';
      const aliasEntry = aliasMap[title];
      const aliases = (Array.isArray(aliasEntry) ? aliasEntry : [aliasEntry || ''])
        .concat(topic.synonyms || []).filter(Boolean);
      chunks.push({
        id: `cond:${topic.id}`,
        record: {
          id: `cond-${topic.id}`,
          title,
          aliases,
          text: String(topic.summary).slice(0, 1400),
          source: {
            nameEn: conditionsMeta.source || 'MedlinePlus',
            nameAr: 'ميدلاين بلس — المكتبة الوطنية للطب (NIH)',
            url: topic.url || '',
            date: conditionsMeta.retrieved || '',
            language: conditionsMeta.language || 'en',
            license: 'public U.S. government health information',
            region: 'international'
          }
        },
        meta: { kind: 'condition' },
        fields: {
          title,
          aliases: aliases.join(' '),
          body: topic.summary
        }
      });
    }
    return maxLimit > 0 ? chunks.slice(0, maxLimit) : chunks;
  }

  /* ---------- step 4 ---------- */

  /* A passage knows which heading of its official page it came from (Symptoms, Diagnosis, ...).
     The words that ask for a section are ordinary language - "symptoms", "أعراض", "doctor" - so
     they are never indexed as matchable text: a question about a medicine that does not exist
     must not drag in some unrelated disease's symptom passage. They only choose between the
     passages of a page the question already matched, which is what a section boost does. */
  function intentSection(text) {
    const table = (settings && settings.sectionTags) || {};
    const wanted = new Set(T().tokenize(text));
    let best = '';
    let bestHits = 0;
    for (const section of Object.keys(table)) {
      if (section === 'comment') continue;
      const entry = table[section] || {};
      const words = (entry.ar || []).concat(entry.en || []);
      let hits = 0;
      for (const word of words) {
        for (const token of T().tokenize(word)) {
          if (token.length >= 3 && wanted.has(token)) hits += 1;
        }
      }
      if (hits > bestHits) {
        bestHits = hits;
        best = section;
      }
    }
    return best;
  }

  function retrieve(question, options) {
    if (!medicineIndex) build({});
    const opts = options || {};
    const limit = Number(opts.limit) || Number(settings.maxCombinedRecords) || 3;
    const minScore = Number(settings.minScore) || 0.6;
    const medLimit = Number(settings.maxMedicineRecords) || 2;
    const docLimit = Number(settings.maxDocumentChunks) || 2;

    const lookup = opts.documentsOnly ? '' : medicineQuery(question);
    /* The strength reorder below can only promote a row the search actually returned, so
       the scan goes wider than the two records the answer keeps: "Panadol 500" must reach
       PANADOL ADVANCE 500 MG even when same-brand variants score above it. */
    let rawMedicines = lookup
      ? medicineIndex.search(lookup, { limit: Math.max(medLimit * 6, 12), minScore: 1 })
      : [];
    /* When a word really names a medicine, the rows that carry that name are the answer;
       rows that only share "500" or "tablets" with the question must not push it out. Rows
       whose name merely rhymes with the word score far below the real ones, so the cut keeps
       everything close to the best name hit instead of everything flagged as one. */
    /* A fuzzy score alone is not proof of medicine identity: only a row the index marked
       exactName may be shown as an answer. exactName is the tier where the typed name is
       the same token, the same consonant skeleton ("بنادول" and "بانادول" are one name),
       a same-length spelling variant, or a one-edit typo - everything weaker is a rhyme,
       and a rhyme is a different medicine that must not be presented as the answer. */
    rawMedicines = rawMedicines.filter(hit => hit.exactName);
    const nameHits = rawMedicines.filter(hit => hit.exactName);
    if (nameHits.length) {
      const floor = nameHits[0].score * 0.75;
      const strong = nameHits.filter(hit => hit.score >= floor);
      if (strong.length) rawMedicines = strong;
    }
    const strengths = strengthValues(question);
    if (strengths.length) {
      const withStrength = [];
      const without = [];
      for (const hit of rawMedicines) {
        (nameCarriesStrength(hit.record, strengths) ? withStrength : without).push(hit);
      }
      rawMedicines = withStrength.concat(without);
    }
    const sectionIntent = intentSection(question);
    const sectionBoost = Number(settings.sectionBoost) || 1.4;
    const rawDocuments = documentIndex.search(lookup || medicineQuery(question), { limit: docLimit * 3, minScore: 1 })
      .map(hit => (sectionIntent && hit.record && hit.record.section === sectionIntent)
        ? { ...hit, score: hit.score * sectionBoost }
        : hit)
      .sort((a, b) => b.score - a.score);

    let medicines = rawMedicines
      .filter(hit => hit.score >= minScore || hit.exactName)
      .slice(0, medLimit)
      .map(hit => medicineResult(hit));
    const questionWords = ' ' + conditionKey(question) + ' ';
    const documents = rawDocuments
      .filter(hit => hit.exactName && hit.score >= minScore &&
        [hit.record.title, hit.record.primaryName].concat(hit.record.aliases || []).filter(Boolean).some(title => {
          const phrase = conditionKey(title);
          return phrase.length >= 4 && questionWords.includes(' ' + phrase + ' ');
        }))
      .slice(0, docLimit)
      .map(hit => documentResult(hit));

    // Exact complete condition names/aliases outrank incidental product-name tokens.
    if (documents.length) medicines = [];
    /* Egyptian data first, then the international documents. */
    let combined = settings.egyptianSourcesFirst === false ? documents.concat(medicines) : medicines.concat(documents);
    if (combined.length > limit) combined = combined.slice(0, limit);
    const conflict = false; // Co-occurrence does not demonstrate a factual disagreement.
    return {
      found: combined.length > 0,
      records: combined,
      medicines,
      documents,
      conflict,
      diagnostics: {
        medicineHits: rawMedicines.slice(0, 5).map(hit => ({ id: hit.id, score: Number(hit.score.toFixed(2)), matched: hit.matched.slice(0, 6) })),
        documentHits: rawDocuments.slice(0, 5).map(hit => ({ id: hit.id, score: Number(hit.score.toFixed(2)) }))
      }
    };
  }

  function medicineResult(hit) {
    const drug = hit.record;
    const ingredient = String(drug.scientific_name || '');
    const candidateNotes = clinicalFor(ingredient);
    const notes = candidateNotes && Array.isArray(candidateNotes.sources) && candidateNotes.sources.length ? candidateNotes : null;
    const interactions = interactionsFor(ingredient);
    const source = drugSource(drug);
    return {
      kind: 'medicine',
      id: hit.id,
      score: hit.score,
      exactName: hit.exactName,
      drug,
      fields: {
        tradeNameEn: drug.commercial_name_en || '',
        tradeNameAr: drug.commercial_name_ar || '',
        ingredient,
        manufacturer: drug.manufacturer || '',
        drugClass: drug.drug_class || '',
        route: drug.route || '',
        priceEgp: drug.price_egp === undefined || drug.price_egp === null ? '' : drug.price_egp
      },
      ingredientNotes: notes,
      interactions,
      source,
      text: formatMedicineForContext(hit.record, notes, interactions, source)
    };
  }

  function documentResult(hit) {
    const entry = hit.record;
    return {
      kind: 'document',
      id: hit.id,
      score: hit.score,
      exactName: hit.exactName,
      section: entry.section || '',
      fields: { title: entry.title || '', text: String(entry.text || '').slice(0, 1400) },
      source: entry.source || databaseSource(),
      text: `${entry.title || ''}\n${String(entry.text || '').slice(0, 1400)}`
    };
  }

  /* ---------- records to text ---------- */

  function formatMedicineForContext(drug, notes, interactions, source) {
    const lines = [];
    const add = (label, value) => {
      if (value === '' || value === undefined || value === null) return;
      lines.push(`${label}: ${value}`);
    };
    add('الاسم التجاري', drug.commercial_name_ar && drug.commercial_name_en
      ? `${drug.commercial_name_ar} (${drug.commercial_name_en})`
      : (drug.commercial_name_en || drug.commercial_name_ar));
    add('المادة الفعالة', drug.scientific_name);
    add('الشركة المصنعة', drug.manufacturer);
    add('المجموعة الدوائية', drug.drug_class);
    add('طريق الإعطاء', drug.route);
    if (drug.price_egp !== undefined && drug.price_egp !== null && drug.price_egp !== '') add('السعر بالجنيه المصري', drug.price_egp);
    if (notes && notes.mechanism) add('آلية العمل من مراجع التطبيق', notes.mechanism);
    if (notes && notes.uses) add('الاستخدام الطبي حسب المراجع', notes.uses);
    if (notes && notes.effects) add('الآثار الجانبية حسب المراجع', notes.effects);
    if (notes && notes.safety) add('تحذيرات حسب المراجع', notes.safety);
    for (const pair of (interactions || []).slice(0, 4)) {
      add(`تداخل دوائي (${pair.severity})`, `${pair.other}: ${pair.effect}`);
    }
    add('المصدر', sourceLabel(source));
    return lines.join('\n');
  }

  function clinicalFor(ingredient) {
    const wanted = T().normalize(ingredient || '');
    if (!wanted) return null;
    const parts = wanted.split(/[+,؛;]/).map(part => T().normalize(part.trim())).filter(Boolean);
    const pools = [].concat(data.clinicalNotes || [], data.arabicClinical || []);
    let best = null;
    for (const entry of pools) {
      const keys = (entry.keys || []).map(key => T().normalize(key));
      if (keys.includes(wanted)) return entry;
      const partial = keys.some(key => parts.includes(key) || (key.length > 5 && wanted.includes(key)));
      if (partial && !best) best = entry;
    }
    return best;
  }

  function interactionsFor(ingredient) {
    const library = Array.isArray(data.interactions) ? data.interactions : [];
    if (!library.length) return [];
    const slug = T().normalize(ingredient || '').replace(/\s+/g, ' ');
    if (!slug) return [];
    const ids = new Set(slug.split(/[+,;]/).map(part => part.trim()).filter(part => part.length > 3));
    const found = [];
    for (const pair of library) {
      const other = ids.has(pair.a) ? pair.b : ids.has(pair.b) ? pair.a : null;
      if (!other) continue;
      found.push({
        other,
        severity: pair.severity,
        effect: (pair.effect && (pair.effect.ar || pair.effect.en)) || '',
        management: (pair.management && (pair.management.ar || pair.management.en)) || '',
        sources: pair.sources || []
      });
    }
    const rank = { avoid: 0, major: 1, moderate: 2 };
    return found.sort((left, right) => (rank[left.severity] ?? 3) - (rank[right.severity] ?? 3)).slice(0, 6);
  }

  /* ---------- sources, per section 4 ---------- */

  function drugSource() {
    const meta = (data && data.datasetMeta) || {};
    return {
      nameEn: (meta.sourceNameEn) || 'Drugcopeia Egyptian medicines database',
      nameAr: (meta.sourceNameAr) || 'قاعدة بيانات الأدوية المصرية داخل التطبيق',
      url: meta.url || '',
      date: meta.date || '',
      version: meta.version || '',
      language: 'ar/en',
      license: meta.license || '',
      region: 'egypt',
      internalDatabase: true
    };
  }

  function databaseSource() {
    return drugSource();
  }

  /* A record without real source metadata is labelled as app data, with version and date. */
  function sourceLabel(source, language) {
    const english = language === 'en';
    if (!source || source.internalDatabase) {
      const meta = (data && data.datasetMeta) || {};
      const parts = [];
      if (meta.version) parts.push(english ? `version ${meta.version}` : `إصدار ${meta.version}`);
      if (meta.date) parts.push(english ? `dated ${meta.date}` : `تاريخ ${meta.date}`);
      return english
        ? `The app database${parts.length ? ` (${parts.join(', ')})` : ''}`
        : `قاعدة بيانات التطبيق${parts.length ? ` (${parts.join('، ')})` : ''}`;
    }
    const name = english
      ? (source.nameEn || source.nameAr || 'External source')
      : (source.nameAr || source.nameEn || 'مصدر خارجي');
    const stamp = source.date || source.updated || '';
    return stamp ? `${name} — ${stamp}` : String(name);
  }

  /* ---------- step 4 fallback: the card the UI shows instead of a generation ---------- */

  function buildCard(records, options) {
    const language = options && options.language;
    const medicines = (records || []).filter(record => record.kind === 'medicine');
    const documents = (records || []).filter(record => record.kind === 'document');
    return {
      kind: 'card',
      label: 'بطاقة الدواء من قاعدة البيانات',
      medicines: medicines.map(record => ({
        id: record.id,
        tradeNameAr: record.fields.tradeNameAr,
        tradeNameEn: record.fields.tradeNameEn,
        ingredient: record.fields.ingredient,
        manufacturer: record.fields.manufacturer,
        drugClass: record.fields.drugClass,
        route: record.fields.route,
        priceEgp: record.fields.priceEgp,
        notes: record.ingredientNotes ? {
          mechanism: record.ingredientNotes.mechanism,
          uses: record.ingredientNotes.uses,
          effects: record.ingredientNotes.effects,
          safety: record.ingredientNotes.safety
        } : null,
        interactions: (record.interactions || []).slice(0, 5).map(pair => ({ other: pair.other, severity: pair.severity, effect: pair.effect, sources: pair.sources })),
        flags: safetyFlags(record.text),
        sourceLabel: sourceLabel(record.source, language),
        source: record.source
      })),
      documents: documents.map(record => ({
        title: record.fields.title,
        excerpt: T().truncate(record.fields.text, 700),
        section: record.section || '',
        sourceLabel: sourceLabel(record.source, language),
        source: record.source
      })),
      flags: unionFlags(records),
      sources: collectSources(records, language)
    };
  }

  /* Section 5: flag the groups only when the retrieved record actually mentions them. */
  const FLAG_TERMS = {
    pregnancy: ['حمل', 'حامل', 'الحمل', 'pregnan', 'embry'],
    breastfeeding: ['رضاعة', 'مُرضع', 'مرضعة', 'breastfeed', 'lactat'],
    children: ['أطفال', 'طفل', 'رضيع', 'children', 'pediatric', 'infant'],
    elderly: ['كبار السن', 'المسنين', 'مسن', 'elderly', 'geriatric'],
    kidney: ['كلوى', 'الكلى', 'كلية', 'kidney', 'renal'],
    liver: ['كبد', 'الكبد', ' الكبدي', 'hepat', 'liver'],
    interactions: ['تداخل', 'interaction'],
    allergy: ['حساسية', 'تحسس', 'allerg']
  };

  function safetyFlags(text) {
    const haystack = T().normalize(text || '');
    const flags = [];
    for (const [key, terms] of Object.entries(FLAG_TERMS)) {
      if (terms.some(term => haystack.includes(T().normalize(term)))) flags.push(key);
    }
    return flags;
  }

  function unionFlags(records) {
    const set = new Set();
    for (const record of records || []) safetyFlags(record.text).forEach(flag => set.add(flag));
    return [...set];
  }

  function collectSources(records, language) {
    const out = [];
    const seen = new Set();
    for (const record of records || []) {
      const source = record.source || drugSource();
      const key = `${sourceLabel(source, language)}|${source.url || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        label: sourceLabel(source, language),
        nameAr: source.nameAr || '',
        nameEn: source.nameEn || '',
        url: source.url || '',
        date: source.date || source.updated || '',
        license: source.license || '',
        region: source.region || 'egypt',
        internal: Boolean(source.internalDatabase),
        for: record.kind === 'medicine' ? (record.fields.tradeNameAr || record.fields.tradeNameEn) : record.fields.title
      });
      /* Interaction rows keep their own official leaflet links; they belong under the answer. */
      for (const extra of (record.interactions || []).flatMap(pair => pair.sources || [])) {
        const extraKey = `${extra.en || extra.ar || ''}|${extra.url || ''}`;
        if (seen.has(extraKey)) continue;
        seen.add(extraKey);
        out.push({
          label: extra.ar || extra.en || '',
          nameAr: extra.ar || '',
          nameEn: extra.en || '',
          url: extra.url || '',
          date: extra.date || '',
          license: extra.license || '',
          region: 'international',
          internal: false,
          for: record.fields.tradeNameAr || record.fields.ingredient || ''
        });
      }
    }
    return out;
  }

  /* ---------- the reference block handed to the model ---------- */

  function buildContextPack(question, records, language) {
    const maxChars = Number(settings.contextMaxChars) || 2600;
    const list = records || [];
    const blocks = [];
    let used = 0;
    for (let i = 0; i < list.length; i += 1) {
      const block = `[${i + 1}] ${list[i].text}`;
      if (used + block.length > maxChars) break;
      blocks.push(block);
      used += block.length + 2;
    }
    const contextText = blocks.join('\n\n');
    return {
      question,
      records: list,
      contextText,
      sources: collectSources(list, language || ''),
      flags: unionFlags(list),
      conflict: false // A verified field-level discrepancy is needed before claiming conflict.
    };
  }

  /* ---------- entity dictionary for the output guard ---------- */

  const entities = {
    lookupNameToken(token) {
      return medicineIndex ? medicineIndex.lookupNameToken(token) : null;
    },
    lookupName(token) {
      const value = String(token || '');
      if (value.length < 3) return null;
      const hit = entities.lookupNameToken(value);
      if (!hit) return null;
      return {
        id: hit.id,
        field: hit.field,
        nameEn: hit.record.commercial_name_en || '',
        nameAr: hit.record.commercial_name_ar || ''
      };
    },
    /* Whole-name lookup so "بنادول أكتيفاست" resolves like the app's own search would. */
    lookupPhrase(phrase) {
      if (!medicineIndex) return null;
      const results = medicineIndex.search(phrase, { limit: 1, minScore: 1 });
      return results.length ? results[0] : null;
    },
    /* Condition titles and aliases come from the document index, so a question that names a
       disease ("الربو", "diabetes") is recognised as health evidence before retrieval runs. */
    lookupCondition(token) {
      if (!documentIndex) return null;
      const value = String(token || '');
      if (value.length < 3) return null;
      const hit = documentIndex.lookupNameToken(value);
      if (!hit) return null;
      return { id: hit.id, title: hit.record.title || hit.record.primaryName || '' };
    }
  };

  /* ---------- outside reading for a question the bundled data cannot answer ----------

     The assistant never fetches an answer over the network, but a health question that
     the on-device data cannot cover still deserves a way out: these are the search pages
     of the recognised international sources whose text is already bundled here
     (MedlinePlus / NIH, NHS, NCBI, WHO). Every URL was checked live before shipping;
     they open in the reader's own browser through the existing source link. */
  const REFERENCE_SITES = [
    { key: 'nhs', nameEn: 'NHS (United Kingdom)', nameAr: 'الخدمة الصحية الوطنية البريطانية', template: 'https://www.nhs.uk/search/results?q=' },
    { key: 'ncbi', nameEn: 'NIH National Library of Medicine', nameAr: 'المكتبة الوطنية للطب — NIH', template: 'https://www.ncbi.nlm.nih.gov/search/all/?term=' },
    { key: 'who', nameEn: 'World Health Organization', nameAr: 'منظمة الصحة العالمية', template: 'https://www.who.int/home/search-results?query=' }
  ];

  /* normalize() keeps ASCII punctuation, so "hypothyroidism?" never sits between spaces and the
     word scan below missed every question that ended in a question mark. */
  function conditionKey(value) {
    return T().normalize(value).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  }

  /* The bundled condition topics carry English titles only, so a question asked in Arabic never
     reaches them. The document index does hold the Arabic aliases, and its English title is what
     the international sources actually index, so it becomes the search query instead. */
  function topicFromAliases(needle) {
    if (!documentIndex || typeof documentIndex.lookupNameToken !== 'function') return null;
    const words = needle.split(' ').filter(word => /[\u0600-\u06ff]/.test(word) && word.length >= 4 && !['دواء','ادويه','الدواء','الادويه','سعر','السعر','ماده','الماده','الفعاله'].includes(word)).sort((a, b) => b.length - a.length);
    const topics = (data && data.conditions && Array.isArray(data.conditions.topics)) ? data.conditions.topics : [];
    for (const phrase of [needle].concat(words)) {
      const hit = documentIndex.lookupNameToken(phrase);
      const title = hit && hit.record && hit.record.title;
      if (!title || conditionKey(title) === needle) continue;
      /* The document record has no page address, but the topic list does — matching the English
         title back into it keeps the MedlinePlus link a real URL instead of a guess. */
      const wanted = conditionKey(title);
      const topic = topics.find(candidate => candidate && candidate.url && conditionKey(candidate.title || candidate.primaryName || '') === wanted);
      return topic || { title, primaryName: title, url: '' };
    }
    return null;
  }

  function conditionTopic(term) {
    const needle = conditionKey(String(term || ''));
    if (needle.length < 3) return null;    const topics = (data && data.conditions && Array.isArray(data.conditions.topics)) ? data.conditions.topics : [];
    const padded = ` ${needle} `;
    let partial = null;
    let contained = null;
    let containedLength = 0;
    const names = topic => [topic.title || '', topic.primaryName || ''].concat(topic.synonyms || []);
    for (const topic of topics) {
      if (!topic || !topic.url) continue;
      const title = conditionKey(topic.title || topic.primaryName || '');
      if (title === needle) return topic;
      if (!partial && title.length > 4 && (title.startsWith(needle) || needle.startsWith(title))) partial = topic;
      for (const name of names(topic)) {
        const value = conditionKey(name);
        if (!value) continue;
        if (value === needle) return topic;
        /* The longest name wins so "Hypothyroidism, Children" beats "Hypothyroidism". */
        if (value.length > 4 && padded.includes(` ${value} `) && value.length > containedLength) {
          contained = topic;
          containedLength = value.length;
        }
      }
    }
    return contained || partial || (/[^\x00-\x7F]/.test(needle) ? topicFromAliases(needle) : null);
  }

  /* A whole question makes a bad search query, so the topic name is used when the
     question names one and the interrogative words are dropped when it does not. */
  const QUESTION_WORDS = /^(what|whats|what's|which|who|how|why|is|are|was|tell|me|about|of|for|the|a|an|in|to|with|does|do|can|i|my|and)\b/i;
  /* Compared against the folded word, so "إيه" and "ايه" both land on the same entry. */
  const QUESTION_WORDS_AR = new Set(['ايه', 'يه', 'هو', 'هي', 'ده', 'دي', 'دول', 'هل', 'ما', 'ماذا', 'كيف', 'متي', 'ليه', 'ازاي', 'عن', 'في', 'من', 'علي', 'عند', 'انا', 'عندي', 'كان', 'لو', 'او', 'و']);

  function searchTerm(term, topic) {
    if (topic) return topic.title || topic.primaryName || term;
    const kept = String(term || '')
      .split(/\s+/)
      .map(word => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
      .filter(word => word && !QUESTION_WORDS.test(word) && !QUESTION_WORDS_AR.has(conditionKey(word)));
    return kept.length ? kept.join(' ') : String(term || '').trim();
  }

  function referenceLinks(term) {
    const cleaned = String(term || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    if (cleaned.length < 2) return [];
    const topic = conditionTopic(cleaned);
    const subject = searchTerm(cleaned, topic);
    const encoded = encodeURIComponent(subject);
    const meta = (data && data.conditions && data.conditions.meta) || {};
    const links = [];
    if (topic) {
      links.push({
        label: meta.source || 'MedlinePlus',
        nameEn: meta.source || 'MedlinePlus',
        nameAr: 'ميدلاين بلس — NIH',
        url: topic.url || 'https://medlineplus.gov/healthtopics.html',
        title: topic.title || topic.primaryName || subject,
        region: 'international',
        exact: Boolean(topic.url)
      });
    } else {
      links.push({
        label: meta.source || 'MedlinePlus',
        nameEn: meta.source || 'MedlinePlus',
        nameAr: 'ميدلاين بلس — NIH',
        url: 'https://medlineplus.gov/healthtopics.html',
        title: subject,
        region: 'international',
        exact: false
      });
    }
    for (const site of REFERENCE_SITES) {
      links.push({
        label: site.nameEn,
        nameEn: site.nameEn,
        nameAr: site.nameAr,
        url: site.template + encoded,
        title: subject,
        region: 'international',
        exact: false
      });
    }
    return links;
  }

  /* The official authorities offered with every medicine answer, so the reader can verify
     registration, price and ingredient information against a government source. The app
     never fetches these itself: the links open in the reader's browser, and every template
     was fetched live before it was allowed into the policy file. */
  function ingredientSearchTerm(ingredient) {
    const first = String(ingredient || '').split(/[+,؛;]/)[0] || '';
    return first.replace(/\([^)]*\)/g, '').trim().replace(/\s+/g, ' ');
  }

  function officialLinks(question, records) {
    const cfg = (settings && settings.verificationLinks) || {};
    const links = [];
    const medicines = (records || []).filter(record => record.kind === 'medicine');
    if (!medicines.length) return links;
    const ingredient = ingredientSearchTerm(medicines[0].fields && medicines[0].fields.ingredient);
    const product = medicines[0].fields && (medicines[0].fields.tradeNameEn || medicines[0].fields.tradeNameAr);
    for (const site of cfg.egypt || []) {
      if (!site.url) continue;
      links.push({
        label: site.nameEn,
        nameEn: site.nameEn,
        nameAr: site.nameAr,
        url: site.url,
        title: product || '',
        region: 'egypt',
        exact: false
      });
    }
    for (const site of cfg.international || []) {
      const subject = ingredient || product || '';
      if (!site.searchTemplate || !subject) continue;
      links.push({
        label: site.nameEn,
        nameEn: site.nameEn,
        nameAr: site.nameAr,
        url: site.searchTemplate + encodeURIComponent(subject),
        title: subject,
        region: 'international',
        exact: false
      });
    }
    return links;
  }

  function stats() {
    return {
      medicines: medicineIndex ? medicineIndex.stats() : null,
      documents: documentIndex ? documentIndex.stats() : null
    };
  }

  /* ---------- focused smart-search answers ---------- */

  /* The action chips under a card and the reader's own words ask for one aspect of a
     medicine (its alternatives, its interactions, its dose, pregnancy safety). Without a
     model the pipeline shows the database card; the focus tells it which aspect of the
     card is the answer, instead of repeating the same full card for every question. */
  function intentFocus(text) {
    const hay = ' ' + T().normalize(text || '') + ' ';
    const any = words => words.some(word => hay.includes(T().normalize(word)));
    if (any(['بدائل', 'بديل', 'مثيل', 'مرادف', 'جنيس']) || any(['alternative', 'substitut', 'equivalent', 'generic'])) return 'alternatives';
    if (any(['تفاعل', 'تداخل']) || any(['interact'])) return 'interactions';
    if (any(['حمل', 'حامل', 'رضاع', 'مرضع']) || any(['pregnan', 'breastfeed', 'lactat', 'nursing'])) return 'pregnancy';
    if (any(['جرع']) || any(['dose', 'dosage', 'how much', 'how many'])) return 'dose';
    /* "What is it for" and "what does it damage" ask for one note of the card, not the card. */
    if (any(['استخدام', 'بيستخدم', 'بيستخدمو', 'فايدة', 'فايده', 'فوائد', 'فائدة', 'بيفيد في ايه'])
      || any(['used for', 'what is it for', ' uses', ' use of', 'benefit', 'indication'])) return 'uses';
    if (any(['اضرار', 'أضرار', 'اعراض جانبية', 'أعراض جانبية', 'اثار جانبية', 'آثار جانبية', 'تأثيرات جانبية', 'ضرر'])
      || any(['side effect', 'adverse'])) return 'effects';
    return '';
  }

  /* Same-spec alternatives from the app's own price comparison (same ingredient, strength,
     form and route; anything that cannot prove a field is dropped). Price comparison only. */
  let specIndex = null;
  let specIndexLen = -1;
  function alternativesFor(records, options) {
    const SS = global.DawayaSameSpec;
    const drugs = Array.isArray(data.drugs) ? data.drugs : [];
    const meds = (records || []).filter(record => record.kind === 'medicine' && record.drug).slice(0, 3);
    if (!SS || !meds.length || !drugs.length) return null;
    if (!specIndex || specIndexLen !== drugs.length) {
      specIndex = SS.buildIndex(drugs);
      specIndexLen = drugs.length;
    }
    /* The top hit can be a vial or a pack the comparison cannot read; try the next hits. */
    let result = null;
    let askedDrug = null;
    for (const med of meds) {
      const attempt = SS.compare(med.drug, specIndex);
      if (attempt && attempt.status === 'ok' && attempt.rows.length) {
        result = attempt;
        askedDrug = med.drug;
        break;
      }
    }
    if (!result) return null;
    const asked = T().compact(`${askedDrug.commercial_name_en || ''}|${askedDrug.commercial_name_ar || ''}`);
    const limit = (options && options.limit) || 8;
    return result.rows
      .filter(row => T().compact(`${row.drug.commercial_name_en || ''}|${row.drug.commercial_name_ar || ''}`) !== asked)
      .slice(0, limit)
      .map(row => ({
        tradeNameAr: row.drug.commercial_name_ar || '',
        tradeNameEn: row.drug.commercial_name_en || '',
        ingredient: row.drug.scientific_name || '',
        manufacturer: row.drug.manufacturer || '',
        drugClass: row.drug.drug_class || '',
        route: row.drug.route || '',
        priceEgp: row.drug.price_egp === undefined || row.drug.price_egp === null ? '' : row.drug.price_egp,
        notes: null,
        interactions: [],
        sourceLabel: sourceLabel(drugSource(row.drug), options && options.language),
        source: drugSource(row.drug)
      }));
  }

  /* Sourced per-ingredient monographs (U.S. FDA labels via openFDA/DailyMed), the same
     bundle the medicines directory shows. Loaded once, on demand. */
  let monoCache = null;
  let monoPromise = null;
  function loadMonographs() {
    if (monoCache) return Promise.resolve(monoCache);
    if (!monoPromise) {
      monoPromise = fetch('assets/monographs.json', { cache: 'force-cache' })
        .then(response => (response.ok ? response.json() : null))
        .then(payload => { monoCache = payload && payload.items ? payload : null; return monoCache; })
        .catch(() => null);
    }
    return monoPromise;
  }
  function monoClean(value) {
    return String(value || '').toLowerCase().replace(/[+/,;._()\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  async function monographsFor(records) {
    const mono = await loadMonographs();
    const out = new Map();
    if (!mono) return out;
    for (const record of records || []) {
      if (record.kind !== 'medicine') continue;
      const parts = String(record.fields.ingredient || '').split(/[+,;]/);
      const found = [];
      const seen = new Set();
      for (const part of parts) {
        for (const variant of [part, String(part).replace(/\([^)]*\)/g, ' ')]) {
          const hit = mono.index[monoClean(variant)];
          if (hit !== undefined && !seen.has(hit)) {
            seen.add(hit);
            found.push(mono.items[hit]);
          }
        }
      }
      if (found.length) out.set(record.id, found.slice(0, 3));
    }
    return out;
  }

  /* Curated pregnancy/breastfeeding preview (assets/data/pregnancy-safety.json), the same
     lookup the medicines directory uses: exact or alias name, salt words dropped. */
  const PREG_SALTS = ['HYDROCHLORIDE', 'HCL', 'SODIUM', 'POTASSIUM', 'CALCIUM', 'MAGNESIUM', 'SULFATE', 'SULPHATE', 'PHOSPHATE', 'MALEATE', 'FUMARATE', 'TARTRATE', 'MESYLATE', 'BESYLATE', 'ACETATE', 'SUCCINATE', 'NITRATE', 'DIHYDRATE', 'MONOHYDRATE', 'TRIHYDRATE', 'HYDRATE', 'BASE', 'SALT'];
  let pregCache = null;
  let pregPromise = null;
  let pregMap = null;
  function pregNorm(value) {
    return String(value || '').toUpperCase().replace(/\(.*?\)/g, ' ').replace(/[^A-Z0-9+\s.-]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function loadPregnancy() {
    if (pregCache) return Promise.resolve(pregCache);
    if (!pregPromise) {
      pregPromise = fetch('assets/data/pregnancy-safety.json', { cache: 'force-cache' })
        .then(response => (response.ok ? response.json() : null))
        .then(payload => { pregCache = payload && payload.entries ? payload : null; return pregCache; })
        .catch(() => null);
    }
    return pregPromise;
  }
  function pregFind(name) {
    if (!pregCache) return null;
    if (!pregMap) {
      pregMap = new Map();
      Object.keys(pregCache.entries).forEach(key => {
        const entry = pregCache.entries[key];
        pregMap.set(pregNorm(key), entry);
        (entry.aliases || []).forEach(alias => { if (!pregMap.has(pregNorm(alias))) pregMap.set(pregNorm(alias), entry); });
      });
    }
    const n = pregNorm(name);
    if (!n) return null;
    if (pregMap.has(n)) return pregMap.get(n);
    const words = n.split(' ');
    while (words.length > 1 && PREG_SALTS.indexOf(words[words.length - 1]) >= 0) {
      words.pop();
      if (pregMap.has(words.join(' '))) return pregMap.get(words.join(' '));
    }
    return null;
  }
  async function pregnancyFor(records) {
    const preg = await loadPregnancy();
    const out = new Map();
    if (!preg) return out;
    for (const record of records || []) {
      if (record.kind !== 'medicine') continue;
      const parts = String(record.fields.ingredient || '').split('+').map(part => String(part).replace(/\(.*?\)/g, '').trim()).filter(Boolean);
      const found = [];
      for (const part of parts) {
        const entry = pregFind(part);
        if (entry) found.push({ ingredient: part, entry });
      }
      if (found.length) out.set(record.id, { items: found, disclaimer: preg.disclaimer || null, updated: preg.updated || '' });
    }
    return out;
  }

  const api = {
    configure,
    build,
    retrieve,
    buildCard,
    buildContextPack,
    collectSources,
    sourceLabel,
    referenceLinks,
    safetyFlags,
    clinicalFor,
    interactionsFor,
    intentFocus,
    intentSection,
    alternativesFor,
    monographsFor,
    pregnancyFor,
    entities,
    officialLinks,
    stats,
    get indexes() {
      return { medicineIndex, documentIndex };
    }
  };
  global.DawayaAIRetrieval = api;
})(typeof window !== 'undefined' ? window : globalThis);
