/*
 * Dawaya AI - safety layer: input sanitization, topic gate, emergency rules, output guard.
 *
 * Everything here is code, not the model. The model can only be reached after sanitize(),
 * gateTopic() and detectEmergency() have all let the question through, and its text is thrown
 * away unless guardOutput() accepts it. Patterns come from assets/ai/policy-config.json.
 *
 * Exposed as DawayaAISafety.
 */
(function (global) {
  'use strict';

  const T = () => global.DawayaAIText;
  const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
  /* Zero width joiners and bidi overrides are how a right-to-left payload hides its real order. */
  const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;
  const REPEATED_CHAR = /(.)\1{6,}/g;
  const MAX_STRIP_SPANS = 12;

  let policy = null;
  let entities = null;

  function configure(next) {
    if (next && next.policy) policy = next.policy;
    if (next && next.entities) entities = next.entities;
    return api;
  }

  function requirePolicy() {
    if (!policy) throw new Error('DawayaAISafety needs configure({policy}) first');
    return policy;
  }

  function normalizePatternList() {
    return requirePolicy().injection.patterns || [];
  }

  /* The document index carries words out of page titles ("What is asthma?"), so an ordinary
     English word can look like a condition name to the token scan. policy-config.json keeps
     the list where every other gate rule lives. */
  let stopWordSource = null;
  let stopWords = new Set();
  function isStopword(token) {
    const cfg = requirePolicy().offTopic || {};
    const list = (cfg.stopWords && cfg.stopWords.en) || [];
    if (list !== stopWordSource) {
      stopWordSource = list;
      stopWords = new Set(list.map(word => T().normalize(word)));
    }
    return stopWords.has(T().normalize(token));
  }
  /* Everyday English words that also sit in the medicine and document index ("best", "free",
     "price", "world"). Alone they never prove the reader named a medicine. */
  let commonWordSource = null;
  let commonWords = new Set();
  function isCommonWord(token) {
    const cfg = requirePolicy().offTopic || {};
    const list = (cfg.commonWords && cfg.commonWords.en) || [];
    if (list !== commonWordSource) {
      commonWordSource = list;
      commonWords = new Set(list.map(word => T().normalize(word)));
    }
    return commonWords.has(T().normalize(token));
  }
  function gateToken(token) {
    return String(token || '').length >= 4 && !isStopword(token);
  }

  /* ---------- Step 1: input sanitization ---------- */

  function sanitize(raw) {
    const cfg = requirePolicy();
    const maxChars = Number(cfg.limits.maxInputChars) || 400;
    const source = String(raw == null ? '' : raw);
    let text = source.replace(CONTROL_CHARS, ' ').replace(INVISIBLE, '');
    text = text.replace(REPEATED_CHAR, '$1$1').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

    const lines = text.split(/\n+/).filter(line => line.trim()).slice(0, 6);
    text = lines.join(' ').trim();

    /* The flag answers "was the input over the limit", so it is set from the raw source too:
       collapsing a 900-character run of one letter must not hide that the question was cut. */
    const tooLong = source.length > maxChars || text.length > maxChars;
    if (text.length > maxChars) text = text.slice(0, maxChars);

    /* Strip injection spans instead of rejecting the whole message: a real question that
       carries an attack sentence still gets answered, an empty shell does not. */
    const stripped = [];
    let attempts = 0;
    let removedAny = false;
    while (attempts < MAX_STRIP_SPANS) {
      attempts += 1;
      let found = null;
      for (const pattern of normalizePatternList()) {
        if (!T().matchPattern(pattern, text)) continue;
        found = pattern;
        break;
      }
      if (!found) break;
      removedAny = true;
      stripped.push(String(found).replace(/^re:/, ''));
      text = removeSpan(text, found)
        .replace(CONTROL_CHARS, ' ')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
    }

    /* A padded payload ("الالال…") collapses into noise. It carries no question, so it is
       rejected rather than handed to the topic gate. A single repeated letter ("aaaa") is not
       enough: padding words with one character is something a real message may do. */
    const garbled = repeatedFiller(source);
    const obfuscated = garbled || obfuscationRatio(source) > Number(cfg.injection.maxObfuscationRatio || 0.55);
    /* When every matched span was an attack and nothing health-related survives, the message is
       an attack shell, not a question with an attack sentence inside it. */
    if (removedAny && text.length && !healthSignal(text)) text = '';
    const empty = !text.length;
    return {
      ok: !empty && !obfuscated,
      text,
      originalLength: source.length,
      truncated: tooLong,
      injectionDetected: removedAny,
      injectionSpans: stripped,
      reason: empty ? 'empty' : obfuscated ? 'obfuscated' : tooLong ? 'tooLong' : '',
      obfuscationRatio: obfuscationRatio(source)
    };
  }

  function repeatedFiller(value) {
    const text = String(value || '').replace(/\s+/g, ' ');
    const pattern = /(.{2,8})\1{5,}/g;
    let match;
    while ((match = pattern.exec(text))) {
      if (new Set(match[1]).size > 1) return true;
    }
    return false;
  }

  function healthSignal(text) {
    const cfg = policy;
    const normalized = T().normalize(text);
    const list = cfg.offTopic.healthKeywords || {};
    const vocabulary = (list.ar || []).concat(list.en || []);
    return vocabulary.some(term => normalized.includes(T().normalize(term)))
      || countHits(normalized, cfg.offTopic.symptomPhrases || []) > 0
      || conditionNames(text).size > 0;
  }

  /* A known disease name is health evidence on its own, even when the question carries none
     of the general health words ("إيه هو الربو" has no keyword from the list). */
  function conditionNames(text) {
    const found = new Set();
    if (!entities || typeof entities.lookupCondition !== 'function') return found;
    for (const token of T().tokenize(text)) {
      if (!gateToken(token)) continue;
      const hit = entities.lookupCondition(token);
      if (hit) found.add(hit.id);
    }
    return found;
  }

  function removeSpan(text, pattern) {
    if (String(pattern).startsWith('re:')) {
      try {
        return text.replace(new RegExp(String(pattern).slice(3), 'gi'), ' ');
      } catch (_) {
        return text;
      }
    }
    const needle = T().normalize(pattern);
    if (!needle) return text;
    /* Normalization changes length (tashkeel, letter folds, digits), so walk the raw text
       with an index map and cut exactly the matched window. Cutting a fixed number of
       characters mis-sliced mixed English/Arabic payloads and left fragments behind. */
    const folded = normalizeWithMap(text);
    const at = folded.text.indexOf(needle);
    if (at < 0) {
      if (!T().normalize(text).includes(needle)) return text;
      return text.replace(new RegExp(escapeRegExp(pattern), 'ig'), ' ');
    }
    const from = folded.map[at];
    const endIndex = at + needle.length;
    const to = endIndex < folded.map.length ? folded.map[endIndex] : text.length;
    return `${text.slice(0, from)} ${text.slice(to)}`;
  }

  function normalizeWithMap(value) {
    const text = String(value == null ? '' : value);
    let out = '';
    const map = [];
    let pendingSpace = -1;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (/\s/.test(char)) {
        if (pendingSpace < 0) pendingSpace = index;
        continue;
      }
      const piece = T().normalize(char);
      for (const normalizedChar of piece) {
        if (pendingSpace >= 0) {
          if (out.length) {
            out += ' ';
            map.push(pendingSpace);
          }
          pendingSpace = -1;
        }
        out += normalizedChar;
        map.push(index);
      }
    }
    return { text: out, map };
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* Ratio of characters that carry no letters or digits: a garbled payload is a strong attack signal. */
  function obfuscationRatio(value) {
    const text = String(value || '');
    if (text.length < 24) return 0;
    const noise = text.replace(/[\p{L}\p{N}\s.,!?؟]/gu, '').length;
    return noise / text.length;
  }

  /* ---------- Step 3 (consulted by the gate too): emergency rules ---------- */

  function detectEmergency(text) {
    const cfg = requirePolicy();
    const haystack = `${T().normalize(text)} ${T().compact(text)}`;
    const matches = [];
    for (const rule of cfg.emergency.rules || []) {
      if (rule.match === 'allGroups') {
        const groups = rule.groups || [];
        if (groups.length && groups.every(group => (group || []).some(term => hits(haystack, term)))) {
          matches.push(rule.id);
        }
        continue;
      }
      if ((rule.terms || []).some(term => hits(haystack, term))) matches.push(rule.id);
    }
    /* "ما هي أعراض الجلطة" names a stroke term but asks a textbook question. It is answered
       from the reference data with the doctor note; only a message about the reader's own body
       keeps the emergency path. */
    if (matches.length && educationalQuestion(text)) {
      return { matched: false, ruleIds: matches, educational: true };
    }
    return { matched: matches.length > 0, ruleIds: matches, educational: false };
  }

  function educationalQuestion(text) {
    const cfg = requirePolicy();
    const educational = (cfg.emergency.educationalPatterns || []).some(pattern => T().matchPattern(pattern, text));
    if (!educational) return false;
    return !(cfg.emergency.personalPatterns || []).some(term => hits(T().normalize(text), term));
  }

  function hits(haystack, term) {
    const value = T().normalize(term);
    if (!value) return false;
    /* Two or three letters sit inside unrelated Arabic words ("سم" in "السابقة"), so short
       terms only count as whole words. Longer terms keep substring recall. */
    if (value.length <= 3) {
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u').test(haystack);
    }
    return haystack.includes(value) || haystack.includes(T().compact(term));
  }

  /* ---------- Step 2: topic gate ---------- */

  function gateSignals(text) {
    const cfg = requirePolicy();
    const normalized = T().normalize(text);
    /* Three-letter Arabic words (مين، كسب) collide with manufacturer or ingredient tokens;
       only 4+ letter tokens count as drug-name evidence. Ordinary English function words are
       dropped too - the document index has them in page titles, and a reader asking "what can
       you do" must not be scored as asking about a disease. */
    const tokens = T().tokenize(text).filter(gateToken);
    const knownNames = new Set();
    if (entities && typeof entities.lookupName === 'function') {
      for (const token of tokens) {
        if (isCommonWord(token)) continue;
        const hit = entities.lookupName(token);
        if (hit) knownNames.add(hit.id);
      }
      /* Multi-word Egyptian trade names ("panadol actifast") only match as a bigram. */
      for (let i = 0; i < tokens.length - 1; i += 1) {
        const pair = `${tokens[i]} ${tokens[i + 1]}`;
        const hit = entities.lookupName(pair);
        if (hit) knownNames.add(hit.id);
      }
    }

    const healthList = cfg.offTopic.healthKeywords || {};
    const healthHits = countHits(normalized, (healthList.ar || []).concat(healthList.en || []));
    const symptomHits = countHits(normalized, cfg.offTopic.symptomPhrases || []);
    const offHits = countHitsLoose(normalized, cfg.offTopic.patterns || []);
    const conditions = conditionNames(text);

    const nameScore = Math.min(1, knownNames.size * 0.55);
    const conditionScore = Math.min(1, conditions.size * 0.55);
    /* A complaint the reader describes in their own words ("اسمرار تحت الابطين") is the whole
       question, so one symptom hit has to clear `accept` on its own. At 0.3 it always landed in
       the clarify band and the assistant refused to talk about the body. */
    const healthScore = Math.min(1, healthHits * 0.28 + symptomHits * 0.6 + nameScore + conditionScore);
    const offScore = Math.min(1, offHits * 0.5);
    return { healthScore, offScore, knownNames: knownNames.size, conditions: conditions.size, healthHits, symptomHits, offHits, tokens };
  }

  function countHits(haystack, terms) {
    let count = 0;
    for (const term of terms || []) {
      if (term && haystack.includes(T().normalize(term))) count += 1;
    }
    return count;
  }

  function countHitsLoose(haystack, patterns) {
    let count = 0;
    for (const pattern of patterns || []) {
      if (T().matchPattern(pattern, haystack)) count += 1;
    }
    return count;
  }

  /* Greetings, thanks, "who are you" and goodbyes. A reader who says good morning and gets
     "I only answer health questions" stops using the assistant, so these get a reply.
     Single words compare whole tokens ("hi" must not match inside "this"), phrases with a
     space match as substrings, and any message that carries health vocabulary is not chat. */
  function conversationHit(message, terms) {
    const haystack = T().normalize(message);
    const tokens = T().tokenize(haystack);
    for (const term of terms || []) {
      const needle = T().normalize(term);
      if (!needle) continue;
      if (needle.includes(' ')) {
        if (haystack.includes(needle)) return true;
      } else if (tokens.includes(needle)) {
        return true;
      }
    }
    return false;
  }

  function conversationKind(text, signals) {
    const cfg = requirePolicy();
    const chat = cfg.conversation || {};
    const haystack = T().normalize(text);
    if (!haystack.length || haystack.length > Number(chat.maxQuestionChars || 48)) return null;
    if (signals && (signals.symptomHits || signals.conditions || signals.knownNames
      || signals.healthScore >= cfg.confidence.accept)) return null;
    if (conversationHit(haystack, chat.greetings && chat.greetings.ar) || conversationHit(haystack, chat.greetings && chat.greetings.en)) return 'greeting';
    if (conversationHit(haystack, chat.thanks && chat.thanks.ar) || conversationHit(haystack, chat.thanks && chat.thanks.en)) return 'thanks';
    if (conversationHit(haystack, chat.farewells && chat.farewells.ar) || conversationHit(haystack, chat.farewells && chat.farewells.en)) return 'farewell';
    if (conversationHit(haystack, chat.smallTalk && chat.smallTalk.ar) || conversationHit(haystack, chat.smallTalk && chat.smallTalk.en)) return 'smallTalk';
    return null;
  }

  /*
   * Order matters: an emergency is never refused as off-topic, so the emergency rules are
   * consulted before the gate is allowed to say no. The pipeline then re-reads the same
   * verdict at step 3 and stops generation there.
   */
  function gateTopic(text, options) {
    const cfg = requirePolicy();
    const opts = options || {};
    const thresholds = cfg.confidence;
    const emergency = detectEmergency(text);
    if (emergency.matched) {
      return Promise.resolve({ label: 'EMERGENCY', confidence: 1, via: 'rules', needsClarification: false, signals: { emergency: emergency.ruleIds } });
    }

    const signals = gateSignals(text);
    const injectionFree = String(text || '');
    if (injectionFree && !T().normalize(injectionFree).replace(/\s/g, '').length) {
      return Promise.resolve({ label: 'OFF_TOPIC', confidence: 1, via: 'rules', needsClarification: false, signals });
    }

    if (signals.healthScore >= thresholds.accept && signals.healthScore >= signals.offScore) {
      return Promise.resolve({ label: 'HEALTH', confidence: signals.healthScore, via: 'rules', needsClarification: false, signals });
    }
    if (signals.offScore >= thresholds.accept && signals.offScore > signals.healthScore) {
      return Promise.resolve({ label: 'OFF_TOPIC', confidence: signals.offScore, via: 'rules', needsClarification: false, signals });
    }

    /* A question with an off-topic term and nothing at all pointing at health (no medicine
       name, symptom, condition or health word) is off-topic even when only one term matched. */
    if (signals.offHits >= 1 && signals.healthScore === 0) {
      return Promise.resolve({ label: 'OFF_TOPIC', confidence: Math.max(signals.offScore, thresholds.accept), via: 'rules', needsClarification: false, signals });
    }

    /* Only a message the rules could not place reaches here, so a greeting never has to
       spend a classifier round-trip and never gets refused for naming no medicine. */
    const conversation = conversationKind(text, signals);
    if (conversation) {
      return Promise.resolve({ label: 'CHAT', confidence: 1, via: 'rules', needsClarification: false, signals, conversation });
    }

    const ruleGuess = signals.healthScore > signals.offScore ? 'HEALTH' : 'OFF_TOPIC';
    const ruleConfidence = Math.max(signals.healthScore, signals.offScore);

    if (typeof opts.classify !== 'function') {
      return Promise.resolve(decideWithoutModel(ruleGuess, ruleConfidence, signals, thresholds));
    }

    return Promise.resolve(opts.classify(String(text || ''))).then(raw => {
      const parsed = parseClassifier(raw);
      if (!parsed) return decideWithoutModel(ruleGuess, ruleConfidence, signals, thresholds);
      const agreesWithRules = parsed.label === ruleGuess;
      /* Inside the ambiguous band the classifier is the extra opinion that decides, so its label
         is used as long as the model is reasonably sure of itself. */
      if (parsed.confidence < thresholds.clarifyLow) {
        return { label: 'CLARIFY', confidence: parsed.confidence, via: 'llm', needsClarification: true, signals, classifier: parsed };
      }
      const confidence = Math.max(parsed.confidence, agreesWithRules ? Math.min(1, ruleConfidence) : 0);
      return { label: parsed.label, confidence, via: agreesWithRules ? 'rules+llm' : 'llm', needsClarification: false, signals, classifier: parsed };
    });
  }

  function decideWithoutModel(ruleGuess, ruleConfidence, signals, thresholds) {
    if (ruleConfidence <= thresholds.offTopicAtOrBelow) {
      return { label: 'CLARIFY', confidence: ruleConfidence, via: 'rules', needsClarification: true, signals };
    }
    return { label: ruleGuess, confidence: ruleConfidence, via: 'rules', needsClarification: false, signals };
  }

  /* The classifier must answer with strict JSON; anything else is a failed classification. */
  function parseClassifier(raw) {
    if (raw && typeof raw === 'object') {
      const label = String(raw.label || '').toUpperCase();
      const confidence = Number(raw.confidence);
      if (!['HEALTH', 'EMERGENCY', 'OFF_TOPIC'].includes(label)) return null;
      if (!Number.isFinite(confidence)) return null;
      return { label, confidence: Math.min(1, Math.max(0, confidence)) };
    }
    const match = /\{[\s\S]*\}/.exec(String(raw == null ? '' : raw));
    if (!match) return null;
    try {
      return parseClassifier(JSON.parse(match[0]));
    } catch (_) {
      return null;
    }
  }

  /* ---------- Step 6: output guard ---------- */

  /* A word only counts as a product-name claim when it could actually be a brand. Egyptian
     pack names are full of ordinary English words - "pain", "fever", "used" - so a short Latin
     word is not evidence that the model recommended something, while Arabic trade names
     ("بنادول", "بانادول") start at four letters. */
  function isNameClaim(token) {
    if (!token || token.length < 4) return false;
    /* An ordinary English word is not a brand claim, however long it is: Egyptian pack
       names collide with common words ("before" reaches BEFORE-S), and without this the
       guard throws away correct answers for carrying everyday vocabulary. */
    if (isStopword(token) || isCommonWord(token)) return false;
    return T().arabicRatio(token) > 0 ? true : token.length >= 6;
  }

  /*
   * The guard is the reason a weak model cannot hurt anyone. It rejects an answer that
   * leaves the health topic, states a diagnosis, sets a personal dose, tells the user to
   * stop a prescription, is written in a different language than the one the prompt asked
   * for, or carries a number, a unit or a medicine name that is absent from the retrieved
   * records. pipeline.js then shows the database card.
   */
  /* The answer has to be in the language the question was answered in, otherwise a reader
     writing English gets Arabic back and the interface language becomes meaningless. */
  function languageReason(answer, language, guard) {
    const ratio = T().arabicRatio(answer);
    if (!String(answer || '').trim().length) return null;
    if (language === 'en') return ratio > 0.2 ? 'en' : null;
    if (language === 'ar') return ratio < 0.45 ? 'ar' : null;
    return guard.requireArabicAnswer && ratio < 0.45 ? 'ar' : null;
  }

  function guardOutput(answer, contextPack, options) {
    const cfg = requirePolicy();
    const guard = cfg.guard;
    const context = contextPack && contextPack.contextText ? contextPack.contextText : '';
    const answerNormalized = T().normalize(answer);
    const reasons = [];
    const fabricated = { numbers: [], units: [], names: [] };

    if (!answerNormalized.trim().length) {
      reasons.push({ code: 'empty' });
    }
    if (answerNormalized.trim().length < Number(guard.minAnswerChars || 40)) {
      reasons.push({ code: 'tooShort' });
    }
    const language = languageReason(answer, options && options.language, guard);
    if (language) reasons.push({ code: 'language' });

    const diagnosis = T().matchAny(guard.diagnosisPatterns, answerNormalized);
    if (diagnosis) reasons.push({ code: 'diagnosis', detail: diagnosis });
    const dose = T().matchAny(guard.personalDosePatterns, answerNormalized);
    if (dose) reasons.push({ code: 'dose', detail: dose });
    const stop = T().matchAny(guard.stopTreatmentPatterns, answerNormalized);
    if (stop) reasons.push({ code: 'stop', detail: stop });

    /* Health-relatedness of the answer: either a health keyword, or it talks about the records. */
    const healthList = (cfg.offTopic.healthKeywords || {});
    const healthVocabulary = (healthList.ar || []).concat(healthList.en || []);
    const answerIsHealth = healthVocabulary.some(term => answerNormalized.includes(T().normalize(term)))
      || T().tokenize(answer).some(token => T().tokenize(context).includes(token));
    if (answerNormalized.length && !answerIsHealth) reasons.push({ code: 'offTopic' });

    const contextFolded = T().foldVerbalNumbers(context);
    const contextCompact = T().compact(context);
    const contextUnits = new Set((guard.units || []).map(unit => T().normalize(unit)).filter(Boolean));
    /* Whole numbers only: "3" inside "30" is not evidence that the answer's 3 is grounded. */
    const contextNumbers = new Set((contextFolded.match(/\d+(?:[.,]\d+)?/g) || []).map(value => String(Number(value.replace(',', '.')))));

    for (const claim of T().numericClaims(answer)) {
      if (!contextNumbers.has(String(claim.value))) {
        fabricated.numbers.push(claim.raw);
      } else if (claim.unit && !contextFolded.includes(claim.unit) && !contextCompact.includes(T().compact(claim.unit)) && !contextUnits.has(claim.unit)) {
        fabricated.units.push(claim.raw);
      }
    }

    /* Only names the app actually knows are checked: an unknown word is not a fabricated drug.
       A name passes when the records carry it in any spelling the user might write: the same
       token, the same record name, the same consonant frame ("بنادول" / "بانادول"), or a
       transliteration within the configured distance ("باراسيتامول" / "paracetamol"). */
    if (entities && typeof entities.lookupName === 'function') {
      const answerTokens = T().tokenize(answer).filter(isNameClaim);
      const contextTokens = new Set(T().tokenize(context));
      const contextList = [...contextTokens];
      const contextSkeletons = new Set(contextList.map(token => T().nameSkeleton(token)).filter(value => value.length >= 4));
      const minNameMatch = Number(guard.nameMatchScore) || 0.62;
      const checked = new Set();
      for (const token of answerTokens) {
        if (checked.has(token)) continue;
        checked.add(token);
        const hit = entities.lookupName(token);
        if (!hit) continue;
        /* An English word that only rhymes with a pack name (same consonants, a typo away) is not a claim about that medicine. */
        if (T().arabicRatio(token) === 0 && (hit.field === 'fuzzy' || hit.field === 'skeleton')) continue;
        if (contextTokens.has(token) || contextCompact.includes(T().compact(hit.nameEn || '')) || contextCompact.includes(T().compact(hit.nameAr || ''))) continue;
        const skeleton = T().nameSkeleton(token);
        if (skeleton.length >= 4 && contextSkeletons.has(skeleton)) continue;
        if (contextList.some(candidate => T().nameTokenScore(token, candidate) >= minNameMatch)) continue;
        fabricated.names.push(hit.nameEn || hit.nameAr || token);
      }
    }
    if (fabricated.names.length) reasons.push({ code: 'fabricatedName', detail: fabricated.names.join(', ') });
    if (fabricated.numbers.length) reasons.push({ code: 'fabricatedNumber', detail: fabricated.numbers.join(', ') });
    if (fabricated.units.length) reasons.push({ code: 'fabricatedUnit', detail: fabricated.units.join(', ') });

    return { ok: reasons.length === 0, reasons, fabricated };
  }

  /* A general answer has no reference block to check itself against, so the guard checks what
     makes it dangerous instead of what makes it grounded: a dose, a diagnosis of this reader, a
     stop-order, or a length that means the model started inventing. Numbers only fail when they
     arrive with a unit, since "500 mg" and "كل ٨ ساعات" are exactly what nobody verified. */
  function guardGeneralOutput(answer, options) {
    const cfg = requirePolicy();
    const general = cfg.general || {};
    const guard = cfg.guard;
    const reasons = [];
    const answerNormalized = T().normalize(answer);
    const trimmed = answerNormalized.trim();

    if (!trimmed.length) reasons.push({ code: 'empty' });
    if (trimmed.length < Number(general.minAnswerChars || guard.minAnswerChars || 40)) reasons.push({ code: 'tooShort' });
    if (trimmed.length > Number(general.maxAnswerChars || 1100)) reasons.push({ code: 'tooLong' });

    const language = languageReason(answer, options && options.language, guard);
    if (language) reasons.push({ code: 'language' });
    const diagnosis = T().matchAny(guard.diagnosisPatterns, answerNormalized);
    if (diagnosis) reasons.push({ code: 'diagnosis', detail: diagnosis });
    const dose = T().matchAny(guard.personalDosePatterns, answerNormalized);
    if (dose) reasons.push({ code: 'dose', detail: dose });
    const stop = T().matchAny(guard.stopTreatmentPatterns, answerNormalized);
    if (stop) reasons.push({ code: 'stop', detail: stop });

    const healthList = (cfg.offTopic.healthKeywords || {});
    const healthVocabulary = (healthList.ar || []).concat(healthList.en || []);
    if (trimmed.length && !healthVocabulary.some(term => answerNormalized.includes(T().normalize(term)))) {
      reasons.push({ code: 'offTopic' });
    }

    /* A bare number ("اثنتين من الفيتامينات") reads as a count; a number carrying a unit reads
       as a dose, and the general route is the one route with nothing to verify it against. */
    const dosing = T().numericClaims(answer).filter(claim => claim.unit);
    if (dosing.length) reasons.push({ code: 'dose', detail: dosing.map(claim => claim.raw).join(', ') });

    return { ok: reasons.length === 0, reasons };
  }

  /* A conversational reply carries no medical content, so this guard is what keeps it that
     way: no number, no medicine name, no diagnosis wording, no advice. Anything else and
     pipeline.js falls back to the fixed greeting from the messages file. */
  function guardChatOutput(answer, options) {
    const cfg = requirePolicy();
    const chat = cfg.conversation || {};
    const guard = cfg.guard;
    const normalized = T().normalize(answer);
    const reasons = [];
    if (!normalized.trim().length) reasons.push({ code: 'empty' });
    if (normalized.length > Number(chat.maxAnswerChars || 220)) reasons.push({ code: 'tooLong' });
    if (/\d/.test(normalized)) reasons.push({ code: 'number' });
    const language = languageReason(answer, options && options.language, guard);
    if (language) reasons.push({ code: 'language' });
    const pairs = [['diagnosis', guard.diagnosisPatterns], ['dose', guard.personalDosePatterns], ['stop', guard.stopTreatmentPatterns]];
    for (const [code, patterns] of pairs) {
      const hit = T().matchAny(patterns, normalized);
      if (hit) reasons.push({ code, detail: hit });
    }
    if (entities && typeof entities.lookupName === 'function') {
      const named = T().tokenize(answer).filter(token => isNameClaim(token) && entities.lookupName(token));
      if (named.length) reasons.push({ code: 'fabricatedName', detail: named.join(', ') });
    }
    return { ok: reasons.length === 0, reasons };
  }

  /* Questions where a free-written sentence can hurt (pregnancy, breastfeeding, interactions,
     kidney or liver impairment, children, dose questions). The pipeline never lets the model
     write these from its own knowledge. */
  function highRiskIntent(text) {
    const cfg = requirePolicy();
    const terms = (((cfg.general || {}).blockedIntents) || {}).terms || [];
    const haystack = T().normalize(text);
    return terms.some(term => {
      const value = T().normalize(term);
      return value && (value.length <= 3 ? hits(haystack, term) : haystack.includes(value));
    });
  }

  const api = {
    configure,
    highRiskIntent,
    isCommonWord,
    isStopword,
    sanitize,
    detectEmergency,
    gateSignals,
    conversationKind,
    gateTopic,
    parseClassifier,
    guardOutput,
    guardGeneralOutput,
    guardChatOutput,
    obfuscationRatio,
    _internals: { hits, removeSpan }
  };
  global.DawayaAISafety = api;
})(typeof window !== 'undefined' ? window : globalThis);
