(() => {
  'use strict';

  const dm = (enName, arName, query) => ({
    en: `DailyMed · ${enName} labeling`,
    ar: `DailyMed · نشرة ${arName}`,
    url: `https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=${encodeURIComponent(query)}`
  });

  const sources = {
    fdaInteractions: {
      en: 'FDA · Drug interaction substrate/inhibitor/inducer table',
      ar: 'FDA · جدول المواد المتفاعلة والمثبطة والمحفزة للإنزيمات',
      url: 'https://www.fda.gov/drugs/drug-interactions-labeling/drug-development-and-drug-interactions-table-substrates-inhibitors-and-inducers'
    },
    whoPocketBook: {
      en: 'WHO · Pocket book of hospital care for children',
      ar: 'WHO · دليل رعاية الأطفال في المستشفيات',
      url: 'https://www.who.int/publications/i/item/978-92-4-154837-3'
    }
  };

  const doseMedicines = [
    {
      id: 'paracetamol',
      review: { status: 'unreviewed', source: 'see sources[] and the product label', reviewer: null, reviewedOn: null },
      en: 'Paracetamol (acetaminophen)',
      ar: 'باراسيتامول (أسيتامينوفين)',
      type: 'perDose',
      perDose: [10, 15],
      maxPerDose: 1000,
      dosesPerDay: 5,
      maxDoses: 5,
      maxDailyPerKg: 75,
      maxDaily: 4000,
      interval: { en: 'Every 4–6 hours as needed', ar: 'كل 4–6 ساعات عند الحاجة' },
      minAgeMonths: 24,
      ageWarning: {
        en: 'Under 2 years: use only with advice from a clinician or pharmacist.',
        ar: 'تحت سنتين: استخدم فقط بعد استشارة الطبيب أو الصيدلي.'
      },
      note: {
        en: 'Check the concentration on the exact bottle and use its dosing device. Do not give another paracetamol-containing cold or pain product at the same time.',
        ar: 'تحقق من التركيز على العبوة نفسها واستخدم أداة القياس المرفقة. لا تعطِ دواء زكام أو مسكنًا آخر يحتوي على الباراسيتامول في الوقت نفسه.'
      },
      warnings: [
        {
          en: 'Do not exceed 5 doses in 24 hours or 75 mg/kg/day (maximum 4 g/day).',
          ar: 'لا تتجاوز 5 جرعات خلال 24 ساعة أو 75 مجم/كجم/يوم (بحد أقصى 4 جم/يوم).'
        },
        {
          en: 'Liver disease, malnutrition, dehydration, or regular alcohol use increases the risk of liver injury.',
          ar: 'مرض الكبد أو سوء التغذية أو الجفاف أو الاستهلاك المنتظم للكحول يزيد خطر إصابة الكبد.'
        },
        {
          en: 'Suspected overdose needs urgent medical assessment even if the child looks well.',
          ar: 'الاشتباه بجرعة زائدة يستلزم تقييمًا طبيًا عاجلًا حتى لو بدا الطفل بحال جيدة.'
        }
      ],
      sources: [
        dm('Children’s Tylenol', 'شراب تايلينول للأطفال', 'childrens tylenol'),
        sources.whoPocketBook
      ]
    },
    {
      id: 'ibuprofen',
      review: { status: 'unreviewed', source: 'see sources[] and the product label', reviewer: null, reviewedOn: null },
      en: 'Ibuprofen',
      ar: 'إيبوبروفين',
      type: 'perDose',
      perDose: [5, 10],
      maxPerDose: 400,
      dosesPerDay: 4,
      maxDoses: 4,
      maxDailyPerKg: 40,
      maxDaily: 1200,
      interval: { en: 'Every 6–8 hours as needed', ar: 'كل 6–8 ساعات عند الحاجة' },
      minAgeMonths: 6,
      ageWarning: {
        en: 'Under 6 months: not recommended without a clinician’s direction.',
        ar: 'تحت 6 أشهر: لا يُنصح به دون توجيه من الطبيب.'
      },
      note: {
        en: 'Give with food or milk if possible. Do not combine with another NSAID. The 10 mg/kg dose is commonly used for pain; the product label may use 5 mg/kg for lower fever. The 1200 mg daily limit applies even when a 400 mg dose is allowed, so do not give 400 mg four times daily without clinical supervision.',
        ar: 'أعطه مع الطعام أو الحليب إن أمكن. لا تجمعه مع مضاد التهاب آخر. تُستخدم جرعة 10 مجم/كجم عادةً للألم، وقد تستخدم النشرة 5 مجم/كجم لحمّى أقل. ينطبق حد 1200 مجم يوميًا حتى عند السماح بجرعة 400 مجم، فلا تعطِ 400 مجم أربع مرات يوميًا دون إشراف طبي.'
      },
      warnings: [
        {
          en: 'Avoid during dehydration, persistent vomiting, or diarrhea because of kidney risk.',
          ar: 'تجنبه عند الجفاف أو القيء أو الإسهال المستمر بسبب خطر الكلى.'
        },
        {
          en: 'Ask a clinician first with kidney or heart disease, high blood pressure, stomach ulcer/bleeding, or NSAID-sensitive asthma.',
          ar: 'استشر الطبيب أولًا عند مرض الكلى أو القلب أو ارتفاع الضغط أو قرحة/نزف المعدة أو الربو المتحفز بمضادات الالتهاب.'
        },
        {
          en: 'Do not exceed 40 mg/kg/day or 1200 mg/day, whichever is lower, without clinical supervision.',
          ar: 'لا تتجاوز 40 مجم/كجم/يوم أو 1200 مجم/يوم، أيهما أقل، دون إشراف طبي.'
        }
      ],
      sources: [
        dm('Infants’ ibuprofen', 'قطرة إيبوبروفين للأطفال', 'infants ibuprofen'),
        dm('Children’s Motrin', 'شراب موترين للأطفال', 'childrens motrin')
      ]
    },
    {
      id: 'amoxicillin',
      review: { status: 'unreviewed', source: 'see sources[] and the product label', reviewer: null, reviewedOn: null },
      en: 'Amoxicillin',
      ar: 'أموكسيسيلين',
      type: 'perDay',
      perDay: [25, 45],
      dosesPerDay: 2,
      maxPerDose: 1000,
      maxDaily: 4000,
      interval: { en: 'Every 12 hours', ar: 'كل 12 ساعة' },
      minAgeMonths: 3,
      ageWarning: {
        en: 'Under 3 months: dosing differs and must be set by a clinician.',
        ar: 'تحت 3 أشهر: تختلف الجرعة ويجب أن يحددها الطبيب.'
      },
      note: {
        en: 'Prescription antibiotic only. The dose depends on the infection; some ear infections need a higher daily dose. Complete the course exactly as prescribed.',
        ar: 'مضاد حيوي بوصفة طبية فقط. تعتمد الجرعة على نوع العدوى؛ بعض حالات التهاب الأذن تحتاج جرعة يومية أعلى. أكمل المدة الموصوفة بدقة.'
      },
      warnings: [
        {
          en: 'Tell the prescriber about any penicillin or cephalosporin allergy and about kidney disease.',
          ar: 'أخبر الطبيب بأي حساسية للبنسلين أو السيفالوسبورين وبأي مرض كلوي.'
        },
        {
          en: 'Seek urgent care for facial swelling, breathing difficulty, or a severe skin reaction.',
          ar: 'اطلب رعاية عاجلة عند تورم الوجه أو صعوبة التنفس أو تفاعل جلدي شديد.'
        },
        {
          en: 'Persistent or severe diarrhea needs medical assessment.',
          ar: 'الإسهال المستمر أو الشديد يحتاج تقييمًا طبيًا.'
        }
      ],
      sources: [dm('Amoxil', 'أموكسيل', 'amoxil')]
    },
    {
      id: 'amoxicillin_clavulanate',
      review: { status: 'unreviewed', source: 'see sources[] and the product label', reviewer: null, reviewedOn: null },
      en: 'Amoxicillin + clavulanic acid',
      ar: 'أموكسيسيلين + حمض كلافولانيك',
      type: 'perDay',
      perDay: [25, 45],
      dosesPerDay: 2,
      maxPerDose: 1000,
      maxDaily: 4000,
      highDosePerDay: 90,
      interval: { en: 'Every 12 hours', ar: 'كل 12 ساعة' },
      minAgeMonths: 3,
      ageWarning: {
        en: 'Under 3 months: dosing differs and must be set by a clinician.',
        ar: 'تحت 3 أشهر: تختلف الجرعة ويجب أن يحددها الطبيب.'
      },
      note: {
        en: 'The dose is calculated on the amoxicillin component. 4:1, 7:1 and 14:1 formulations are not interchangeable. Some ear infections require 90 mg/kg/day of the amoxicillin component; that high-dose regimen is selected by the prescriber and must still stay within the product’s maximum daily dose.',
        ar: 'تُحسب الجرعة على مكوّن الأموكسيسيلين. تركيبات 4:1 و7:1 و14:1 ليست متكافئة. بعض حالات التهاب الأذن تحتاج 90 مجم/كجم/يوم من مكوّن الأموكسيسيلين؛ يحدد الطبيب هذا النظام عالي الجرعة ويجب ألا يتجاوز الحد الأقصى اليومي للمنتج.'
      },
      warnings: [
        {
          en: 'Prescription antibiotic only; the product ratio and the infection determine the correct course.',
          ar: 'مضاد حيوي بوصفة طبية فقط؛ تحدد نسبة التركيبة ونوع العدوى المدة والجرعة الصحيحتين.'
        },
        {
          en: 'Avoid without medical advice after a serious penicillin or cephalosporin reaction.',
          ar: 'تجنبه دون استشارة طبية بعد تفاعل شديد مع البنسلين أو السيفالوسبورين.'
        },
        {
          en: 'Seek urgent care for breathing difficulty, facial swelling, or severe persistent diarrhea.',
          ar: 'اطلب رعاية عاجلة عند صعوبة التنفس أو تورم الوجه أو الإسهال الشديد المستمر.'
        }
      ],
      sources: [dm('Augmentin', 'أوجمنتين', 'augmentin')]
    },
    {
      id: 'azithromycin',
      review: { status: 'unreviewed', source: 'see sources[] and the product label', reviewer: null, reviewedOn: null },
      en: 'Azithromycin',
      ar: 'أزيثرومايسين',
      type: 'phases',
      phases: [
        { en: 'Day 1', ar: 'اليوم الأول', mgPerKg: 10, maxMg: 500 },
        { en: 'Days 2–5', ar: 'الأيام 2–5', mgPerKg: 5, maxMg: 250 }
      ],
      alternative: {
        en: 'Some indications use 10 mg/kg once daily for 3 days (maximum 500 mg/day).',
        ar: 'بعض الدواعي تستخدم 10 مجم/كجم مرة يوميًا لمدة 3 أيام (بحد أقصى 500 مجم/يوم).'
      },
      interval: { en: 'Once daily', ar: 'مرة واحدة يوميًا' },
      minAgeMonths: 6,
      ageWarning: {
        en: 'Under 6 months: safety and dosing depend on the indication; follow the clinician’s plan.',
        ar: 'تحت 6 أشهر: تعتمد السلامة والجرعة على الداعي الطبي؛ اتبع خطة الطبيب.'
      },
      note: {
        en: 'Prescription antibiotic only. It does not treat viral colds or influenza. The common 5-day regimen is shown; the prescriber may choose a different course.',
        ar: 'مضاد حيوي بوصفة طبية فقط، ولا يعالج نزلات البرد أو الإنفلونزا الفيروسية. يظهر نظام 5 أيام الشائع، وقد يختار الطبيب نظامًا مختلفًا.'
      },
      warnings: [
        {
          en: 'Tell the prescriber about heart rhythm problems, fainting, low potassium or magnesium, or liver disease.',
          ar: 'أخبر الطبيب باضطراب نظم القلب أو الإغماء أو انخفاض البوتاسيوم أو المغنيسيوم أو مرض الكبد.'
        },
        {
          en: 'Seek urgent care for fainting, severe palpitations, breathing difficulty, or jaundice.',
          ar: 'اطلب رعاية عاجلة عند الإغماء أو الخفقان الشديد أو صعوبة التنفس أو اليرقان.'
        }
      ],
      sources: [dm('Zithromax', 'زيثروماكس', 'zithromax')]
    }
  ];

  const interactionGroups = [
    { id: 'clotting', en: 'Clotting and platelets', ar: 'التخثر والصفائح الدموية' },
    { id: 'pain', en: 'Pain, inflammation and gout', ar: 'الألم والالتهاب والنقرس' },
    { id: 'heart', en: 'Heart, blood pressure and cholesterol', ar: 'القلب وضغط الدم والكوليسترول' },
    { id: 'brain', en: 'Mental health and nervous system', ar: 'الصحة النفسية والجهاز العصبي' },
    { id: 'infection', en: 'Antibiotics and antifungals', ar: 'المضادات الحيوية ومضادات الفطريات' },
    { id: 'hormone', en: 'Stomach, thyroid and hormones', ar: 'المعدة والغدة والهرمونات' },
    { id: 'other', en: 'Other', ar: 'أخرى' }
  ];

  const interactionAgents = [
    { id: 'warfarin', group: 'clotting', en: 'Warfarin', ar: 'وارفارين', examples: { en: 'Marevan', ar: 'ماريفان' } },
    { id: 'clopidogrel', group: 'clotting', en: 'Clopidogrel', ar: 'كلوبيدوجريل', examples: { en: 'Plavix', ar: 'بلافيكس' } },
    { id: 'doac', group: 'clotting', en: 'Apixaban / rivaroxaban', ar: 'أبيكسابان / ريفاروكسابان', examples: { en: 'Eliquis, Xarelto', ar: 'إليكويس، زاريلتو' } },
    { id: 'aspirin_low', group: 'clotting', en: 'Low-dose aspirin', ar: 'أسبرين بجرعة منخفضة', examples: { en: '75–100 mg daily', ar: '75–100 مجم يوميًا' } },
    { id: 'nsaids', group: 'pain', en: 'NSAIDs', ar: 'مضادات الالتهاب غير الستيرويدية', examples: { en: 'Ibuprofen, diclofenac, naproxen', ar: 'إيبوبروفين، ديكلوفيناك، نابروكسين' } },
    { id: 'tramadol', group: 'pain', en: 'Tramadol', ar: 'ترامادول', examples: { en: 'Tramal', ar: 'ترامال' } },
    { id: 'triptan', group: 'pain', en: 'Triptans', ar: 'التريبتانات', examples: { en: 'Sumatriptan', ar: 'سوماتريبتان' } },
    { id: 'methotrexate', group: 'pain', en: 'Methotrexate', ar: 'ميثوتريكسات', examples: { en: 'Methotrexate', ar: 'ميثوتريكسات' } },
    { id: 'corticosteroid', group: 'pain', en: 'Corticosteroids', ar: 'الكورتيكوستيرويدات', examples: { en: 'Prednisolone', ar: 'بريدنيزولون' } },
    { id: 'allopurinol', group: 'pain', en: 'Allopurinol', ar: 'ألوبيورينول', examples: { en: 'Zyloric', ar: 'زايلوريك' } },
    { id: 'azathioprine', group: 'pain', en: 'Azathioprine', ar: 'آزاثيوبرين', examples: { en: 'Imuran', ar: 'إيموران' } },
    { id: 'amiodarone', group: 'heart', en: 'Amiodarone', ar: 'أميودارون', examples: { en: 'Cordarone', ar: 'كوردارون' } },
    { id: 'digoxin', group: 'heart', en: 'Digoxin', ar: 'ديجوكسين', examples: { en: 'Lanoxin', ar: 'لانوكسين' } },
    { id: 'verapamil', group: 'heart', en: 'Verapamil', ar: 'فيراباميل', examples: { en: 'Isoptin', ar: 'إيزوبتين' } },
    { id: 'acei_arb', group: 'heart', en: 'ACE inhibitors / ARBs', ar: 'مثبطات ACE / حاصرات ARB', examples: { en: 'Enalapril, losartan', ar: 'إينالابريل، لوسارتان' } },
    { id: 'spironolactone', group: 'heart', en: 'Spironolactone', ar: 'سبيرونولاكتون', examples: { en: 'Aldactone', ar: 'ألداكتون' } },
    { id: 'thiazide', group: 'heart', en: 'Thiazide diuretics', ar: 'مدرات الثيازيد', examples: { en: 'Hydrochlorothiazide', ar: 'هيدروكلوروثيازيد' } },
    { id: 'simvastatin', group: 'heart', en: 'Simvastatin', ar: 'سيمفاستاتين', examples: { en: 'Zocor', ar: 'زوكور' } },
    { id: 'nitrate', group: 'heart', en: 'Nitrates', ar: 'النترات', examples: { en: 'Nitroglycerin, isosorbide', ar: 'نيتروغليسرين، إيزوسوربيد' } },
    { id: 'ssri_snri', group: 'brain', en: 'SSRIs / SNRIs', ar: 'مضادات الاكتئاب SSRI / SNRI', examples: { en: 'Sertraline, fluoxetine, venlafaxine', ar: 'سيرترالين، فلوكستين، فينلافاكسين' } },
    { id: 'maoi', group: 'brain', en: 'MAO inhibitors', ar: 'مثبطات MAO', examples: { en: 'Phenelzine, tranylcypromine', ar: 'فينيلزين، ترانيلسيبرومين' } },
    { id: 'opioid', group: 'brain', en: 'Opioids', ar: 'الأفيونات', examples: { en: 'Morphine, codeine, oxycodone', ar: 'مورفين، كودايين، أوكسيكودون' } },
    { id: 'benzodiazepine', group: 'brain', en: 'Benzodiazepines', ar: 'البنزوديازيبينات', examples: { en: 'Diazepam, alprazolam', ar: 'ديازيبام، ألبرازولام' } },
    { id: 'lithium', group: 'brain', en: 'Lithium', ar: 'ليثيوم', examples: { en: 'Lithium carbonate', ar: 'كربونات الليثيوم' } },
    { id: 'carbamazepine', group: 'brain', en: 'Carbamazepine', ar: 'كاربامازيبين', examples: { en: 'Tegretol', ar: 'تيجريتول' } },
    { id: 'tizanidine', group: 'brain', en: 'Tizanidine', ar: 'تيزانيدين', examples: { en: 'Sirdalud', ar: 'سيردالود' } },
    { id: 'metronidazole', group: 'infection', en: 'Metronidazole', ar: 'ميترونيدازول', examples: { en: 'Flagyl', ar: 'فلاجيل' } },
    { id: 'macrolide_cyp', group: 'infection', en: 'Clarithromycin / erythromycin', ar: 'كلاريثروميسين / إريثروميسين', examples: { en: 'Klacid, Erythrocin', ar: 'كلاسيد، إريثروسين' } },
    { id: 'fluconazole', group: 'infection', en: 'Fluconazole', ar: 'فلوكونازول', examples: { en: 'Diflucan', ar: 'ديفلوكان' } },
    { id: 'tmp_smx', group: 'infection', en: 'Trimethoprim / sulfamethoxazole', ar: 'تريميثوبريم / سلفاميثوكسازول', examples: { en: 'Septrin, Bactrim', ar: 'سيبتريم، باكترِيم' } },
    { id: 'rifampin', group: 'infection', en: 'Rifampicin', ar: 'ريفامبيسين', examples: { en: 'Rifampicin', ar: 'ريفامبيسين' } },
    { id: 'ciprofloxacin', group: 'infection', en: 'Ciprofloxacin', ar: 'سيبروفلوكساسين', examples: { en: 'Cipro', ar: 'سيبرو' } },
    { id: 'tetracycline', group: 'infection', en: 'Tetracyclines', ar: 'التتراسيكلينات', examples: { en: 'Doxycycline, tetracycline', ar: 'دوكسيسيكلين، تتراسيكلين' } },
    { id: 'azithromycin', group: 'infection', en: 'Azithromycin', ar: 'أزيثرومايسين', examples: { en: 'Zithromax', ar: 'زيثروماكس' } },
    { id: 'strong_cyp3a4', group: 'infection', en: 'Strong CYP3A4 inhibitors', ar: 'مثبطات CYP3A4 القوية', examples: { en: 'Clarithromycin, itraconazole, ritonavir', ar: 'كلاريثروميسين، إيتراكونازول، ريتونافير' } },
    { id: 'antacids_minerals', group: 'hormone', en: 'Antacids, iron or calcium', ar: 'مضادات الحموضة أو الحديد أو الكالسيوم', examples: { en: 'Aluminium/magnesium antacids, ferrous sulfate, calcium carbonate', ar: 'مضادات حموضة ألومنيوم/مغنيسيوم، حديد، كربونات كالسيوم' } },
    { id: 'levothyroxine', group: 'hormone', en: 'Levothyroxine', ar: 'ليفوثيروكسين', examples: { en: 'Euthyrox, Eltroxin', ar: 'يوثيروكس، إلتروكسين' } },
    { id: 'ppis_omeprazole', group: 'hormone', en: 'Omeprazole / esomeprazole', ar: 'أوميبرازول / إيسوميبرازول', examples: { en: 'Losec, Nexium', ar: 'لوزيك، نيكسيوم' } },
    { id: 'ocp', group: 'hormone', en: 'Combined oral contraceptives', ar: 'حبوب منع الحمل المركبة', examples: { en: 'Ethinylestradiol + progestin', ar: 'إيثينيل إستراديول + بروجستين' } },
    { id: 'pde5', group: 'other', en: 'PDE5 inhibitors', ar: 'مثبطات PDE5', examples: { en: 'Sildenafil, tadalafil', ar: 'سيلدينافيل، تادالافيل' } }
  ];

  const daily = (en, ar, query) => dm(en, ar, query);

  const interactions = [
    {
      a: 'warfarin', b: 'nsaids', severity: 'major',
      effect: {
        en: 'Higher risk of serious gastrointestinal and other bleeding.',
        ar: 'زيادة خطر النزف الهضمي والنزف بشكل عام.'
      },
      mechanism: {
        en: 'NSAIDs injure the stomach lining and impair platelet function; some also increase warfarin exposure.',
        ar: 'تضر مضادات الالتهاب بطانة المعدة وتثبط وظائف الصفائح، وبعضها يزيد تعرض الجسم للوارفارين.'
      },
      management: {
        en: 'Avoid if possible. If unavoidable, use the shortest course, consider stomach protection, and monitor INR and bleeding.',
        ar: 'يُفضّل تجنّب الجمع. إذا كان لا بد منه، استخدم أقصر مدة، وفكّر في حماية المعدة، وراقب INR وعلامات النزف.'
      },
      sources: [daily('Warfarin', 'الوارفارين', 'warfarin'), daily('Ibuprofen', 'الإيبوبروفين', 'ibuprofen'), sources.fdaInteractions]
    },
    {
      a: 'warfarin', b: 'aspirin_low', severity: 'major',
      effect: {
        en: 'Additive bleeding risk, including gastrointestinal bleeding.',
        ar: 'زيادة تراكمية لخطر النزف، بما فيه النزف الهضمي.'
      },
      mechanism: {
        en: 'Aspirin blocks platelet aggregation while warfarin blocks clotting-factor synthesis; aspirin also irritates the stomach.',
        ar: 'يثبط الأسبرين تجمع الصفائح بينما يثبط الوارفارين تصنيع عوامل التخثر، كما يهيج الأسبرين المعدة.'
      },
      management: {
        en: 'Use together only for a clear clinical indication; monitor bleeding and consider gastroprotection.',
        ar: 'لا يُستخدمان معًا إلا لداعٍ سريري واضح؛ راقب النزف وفكّر في حماية المعدة.'
      },
      sources: [daily('Warfarin', 'الوارفارين', 'warfarin'), daily('Aspirin', 'الأسبرين', 'aspirin')]
    },
    {
      a: 'warfarin', b: 'amiodarone', severity: 'major',
      effect: {
        en: 'Rising INR and bleeding risk.',
        ar: 'ارتفاع INR وخطر النزف.'
      },
      mechanism: {
        en: 'Amiodarone inhibits CYP2C9 and CYP3A4, slowing warfarin metabolism.',
        ar: 'يثبط الأميودارون إنزيمي CYP2C9 وCYP3A4 فيبطئ استقلاب الوارفارين.'
      },
      management: {
        en: 'Reduce the warfarin dose and monitor INR more often when amiodarone starts, changes, or stops.',
        ar: 'خفّض جرعة الوارفارين وراقب INR بتكرار أكبر عند بدء الأميودارون أو تغيير جرعته أو إيقافه.'
      },
      sources: [daily('Warfarin', 'الوارفارين', 'warfarin'), daily('Amiodarone', 'الأميودارون', 'amiodarone'), sources.fdaInteractions]
    },
    {
      a: 'warfarin', b: 'metronidazole', severity: 'major',
      effect: {
        en: 'Rising INR and bleeding risk.',
        ar: 'ارتفاع INR وخطر النزف.'
      },
      mechanism: {
        en: 'Metronidazole inhibits CYP2C9, reducing warfarin clearance.',
        ar: 'يثبط الميترونيدازول إنزيم CYP2C9 فيقلل تصفية الوارفارين.'
      },
      management: {
        en: 'Monitor INR closely and reduce the warfarin dose if needed.',
        ar: 'راقب INR بدقة وخفّض جرعة الوارفارين عند الحاجة.'
      },
      sources: [daily('Warfarin', 'الوارفارين', 'warfarin'), daily('Metronidazole', 'الميترونيدازول', 'metronidazole'), sources.fdaInteractions]
    },
    {
      a: 'warfarin', b: 'tmp_smx', severity: 'major',
      effect: {
        en: 'Rising INR and bleeding risk.',
        ar: 'ارتفاع INR وخطر النزف.'
      },
      mechanism: {
        en: 'Trimethoprim/sulfamethoxazole inhibits CYP2C9 and can displace warfarin from protein binding.',
        ar: 'يثبط تريميثوبريم/سلفاميثوكسازول إنزيم CYP2C9 وقد يزحزح الوارفارين عن ارتباطه بالبروتين.'
      },
      management: {
        en: 'Monitor INR closely; an alternative antibiotic may be preferable.',
        ar: 'راقب INR بدقة، وقد يكون اختيار مضاد حيوي بديل أفضل.'
      },
      sources: [daily('Warfarin', 'الوارفارين', 'warfarin'), daily('Sulfamethoxazole/trimethoprim', 'سلفاميثوكسازول/تريميثوبريم', 'sulfamethoxazole trimethoprim')]
    },
    {
      a: 'warfarin', b: 'macrolide_cyp', severity: 'major',
      effect: {
        en: 'Rising INR and bleeding risk.',
        ar: 'ارتفاع INR وخطر النزف.'
      },
      mechanism: {
        en: 'Clarithromycin and erythromycin inhibit CYP3A4; clarithromycin can also inhibit CYP2C9.',
        ar: 'يثبط الكلاريثروميسين والإريثروميسين CYP3A4، وقد يثبط الكلاريثروميسين أيضًا CYP2C9.'
      },
      management: {
        en: 'Monitor INR and consider an antibiotic that does not inhibit these enzymes.',
        ar: 'راقب INR وفكّر في مضاد حيوي لا يثبط هذه الإنزيمات.'
      },
      sources: [daily('Warfarin', 'الوارفارين', 'warfarin'), daily('Clarithromycin', 'الكلاريثروميسين', 'clarithromycin'), sources.fdaInteractions]
    },
    {
      a: 'warfarin', b: 'fluconazole', severity: 'major',
      effect: {
        en: 'Rising INR and bleeding risk.',
        ar: 'ارتفاع INR وخطر النزف.'
      },
      mechanism: {
        en: 'Fluconazole inhibits CYP2C9, the main enzyme that clears warfarin.',
        ar: 'يثبط الفلوكونازول إنزيم CYP2C9 المسؤول أساسًا عن تصفية الوارفارين.'
      },
      management: {
        en: 'Monitor INR closely and adjust the warfarin dose as needed.',
        ar: 'راقب INR بدقة وعدّل جرعة الوارفارين حسب الحاجة.'
      },
      sources: [daily('Warfarin', 'الوارفارين', 'warfarin'), daily('Fluconazole', 'الفلوكونازول', 'fluconazole'), sources.fdaInteractions]
    },
    {
      a: 'warfarin', b: 'rifampin', severity: 'major',
      effect: {
        en: 'Reduced anticoagulant effect and higher clotting risk.',
        ar: 'انخفاض تأثير مضاد التخثر وزيادة خطر التجلط.'
      },
      mechanism: {
        en: 'Rifampicin strongly induces liver enzymes, increasing warfarin breakdown.',
        ar: 'يحفز الريفامبيسين إنزيمات الكبد بقوة فيزيد تكسر الوارفارين.'
      },
      management: {
        en: 'Monitor INR frequently; the effect can persist for 1–2 weeks after rifampicin stops.',
        ar: 'راقب INR بتكرار كبير؛ قد يستمر التأثير 1–2 أسبوع بعد إيقاف الريفامبيسين.'
      },
      sources: [daily('Warfarin', 'الوارفارين', 'warfarin'), daily('Rifampin', 'الريفامبيسين', 'rifampin'), sources.fdaInteractions]
    },
    {
      a: 'clopidogrel', b: 'ppis_omeprazole', severity: 'major',
      effect: {
        en: 'Reduced antiplatelet effect and potentially higher cardiovascular risk.',
        ar: 'انخفاض التأثير المضاد للصفائح واحتمال زيادة الخطر القلبي الوعائي.'
      },
      mechanism: {
        en: 'Omeprazole and esomeprazole inhibit CYP2C19, which is needed to activate clopidogrel.',
        ar: 'يثبط الأوميبرازول والإيسوميبرازول CYP2C19 اللازم لتحويل الكلوبيدوجريل إلى شكله الفعال.'
      },
      management: {
        en: 'Avoid omeprazole and esomeprazole; ask the prescriber about pantoprazole or another option.',
        ar: 'تجنب الأوميبرازول والإيسوميبرازول؛ اسأل الطبيب عن البانتوبرازول أو بديل آخر.'
      },
      sources: [daily('Plavix (clopidogrel)', 'بلافيكس (كلوبيدوجريل)', 'plavix'), sources.fdaInteractions]
    },
    {
      a: 'clopidogrel', b: 'nsaids', severity: 'major',
      effect: {
        en: 'Higher risk of gastrointestinal and other bleeding.',
        ar: 'زيادة خطر النزف الهضمي وغيره.'
      },
      mechanism: {
        en: 'Additive platelet inhibition plus NSAID-related stomach injury.',
        ar: 'تثبيط إضافي للصفائح مع إصابة المعدة المرتبطة بمضادات الالتهاب.'
      },
      management: {
        en: 'Avoid regular NSAID use. If unavoidable, use the shortest course, consider a PPI, and monitor bleeding.',
        ar: 'تجنب الاستخدام المنتظم لمضادات الالتهاب. إذا كان لا بد منه، استخدم أقصر مدة وفكّر في مثبط مضخة البروتون وراقب النزف.'
      },
      sources: [daily('Plavix (clopidogrel)', 'بلافيكس (كلوبيدوجريل)', 'plavix'), daily('Ibuprofen', 'الإيبوبروفين', 'ibuprofen')]
    },
    {
      a: 'doac', b: 'strong_cyp3a4', severity: 'major',
      effect: {
        en: 'Higher anticoagulant effect and bleeding risk.',
        ar: 'زيادة تأثير مضاد التخثر وخطر النزف.'
      },
      mechanism: {
        en: 'Strong CYP3A4/P-glycoprotein inhibitors can raise apixaban or rivaroxaban blood levels.',
        ar: 'قد ترفع مثبطات CYP3A4/P-gp القوية مستويات أبيكسابان أو ريفاروكسابان في الدم.'
      },
      management: {
        en: 'For rivaroxaban, avoid strong combined CYP3A4 and P-glycoprotein inhibitors such as clarithromycin, itraconazole, ketoconazole and ritonavir. For apixaban, some strong inhibitors require a lower dose or avoidance; check the apixaban label and reduce only as directed. Monitor kidney function and bleeding.',
        ar: 'مع ريفاروكسابان، تجنب مثبطات CYP3A4 وP-gp القوية المزدوجة مثل الكلاريثروميسين والإيتراكونازول والكيتوكونازول والريتونافير. ومع أبيكسابان، قد تستلزم بعض المثبطات القوية خفض الجرعة أو تجنبها؛ راجع نشرة أبيكسابان ولا تخفض الجرعة إلا وفقها. راقب وظائف الكلى والنزف.'
      },
      sources: [daily('Eliquis (apixaban)', 'إليكويس (أبيكسابان)', 'eliquis'), daily('Xarelto (rivaroxaban)', 'زاريلتو (ريفاروكسابان)', 'xarelto'), sources.fdaInteractions]
    },
    {
      a: 'doac', b: 'nsaids', severity: 'major',
      effect: {
        en: 'Higher risk of serious bleeding.',
        ar: 'زيادة خطر النزف الشديد.'
      },
      mechanism: {
        en: 'Anticoagulant effect plus NSAID-related platelet inhibition and stomach injury.',
        ar: 'تأثير مضاد التخثر مع تثبيط الصفائح وإصابة المعدة الناتجين عن مضادات الالتهاب.'
      },
      management: {
        en: 'Avoid if possible; consider gastroprotection and monitor for bleeding.',
        ar: 'يُفضّل التجنب؛ فكّر في حماية المعدة وراقب علامات النزف.'
      },
      sources: [daily('Eliquis (apixaban)', 'إليكويس (أبيكسابان)', 'eliquis'), daily('Ibuprofen', 'الإيبوبروفين', 'ibuprofen')]
    },
    {
      a: 'ssri_snri', b: 'nsaids', severity: 'major',
      effect: {
        en: 'Higher risk of gastrointestinal bleeding.',
        ar: 'زيادة خطر النزف الهضمي.'
      },
      mechanism: {
        en: 'SSRIs and SNRIs reduce platelet serotonin uptake, and NSAIDs injure the stomach lining.',
        ar: 'تقلل مضادات SSRI/SNRI امتصاص الصفائح للسيروتونين، وتضر مضادات الالتهاب بطانة المعدة.'
      },
      management: {
        en: 'Consider avoiding the combination, especially with prior ulcer or bleeding; use gastroprotection and monitor.',
        ar: 'فكّر في تجنب الجمع، خصوصًا مع تاريخ قرحة أو نزف؛ استخدم حماية للمعدة وراقب الحالة.'
      },
      sources: [daily('Sertraline', 'السيرترالين', 'sertraline'), daily('Ibuprofen', 'الإيبوبروفين', 'ibuprofen')]
    },
    {
      a: 'ssri_snri', b: 'aspirin_low', severity: 'moderate',
      effect: {
        en: 'Increased risk of gastrointestinal bleeding.',
        ar: 'زيادة خطر النزف الهضمي.'
      },
      mechanism: {
        en: 'Reduced platelet serotonin plus aspirin’s antiplatelet effect.',
        ar: 'انخفاض سيروتونين الصفائح مع تأثير الأسبرين المثبط للصفائح.'
      },
      management: {
        en: 'Monitor for bleeding; add gastroprotection when clinically appropriate.',
        ar: 'راقب علامات النزف؛ أضف حماية للمعدة عند وجود داعٍ سريري.'
      },
      sources: [daily('Sertraline', 'السيرترالين', 'sertraline'), daily('Aspirin', 'الأسبرين', 'aspirin')]
    },
    {
      a: 'ssri_snri', b: 'tramadol', severity: 'major',
      effect: {
        en: 'Risk of serotonin syndrome and seizures.',
        ar: 'خطر متلازمة السيروتونين والنوبات.'
      },
      mechanism: {
        en: 'Both increase serotonin activity; tramadol also lowers the seizure threshold.',
        ar: 'يزيد كلاهما نشاط السيروتونين، كما يخفض الترامادول عتبة النوبات.'
      },
      management: {
        en: 'Avoid if possible. If co-use is necessary, use the lowest dose and monitor for agitation, tremor, fever, or seizures.',
        ar: 'تجنب الجمع إن أمكن. إذا لزم، استخدم أقل جرعة وراقب الهياج أو الرعشة أو الحمى أو النوبات.'
      },
      sources: [daily('Sertraline', 'السيرترالين', 'sertraline'), daily('Tramadol', 'الترامادول', 'tramadol')]
    },
    {
      a: 'ssri_snri', b: 'triptan', severity: 'moderate',
      effect: {
        en: 'Uncommon but possible serotonin syndrome.',
        ar: 'احتمال نادر لمتلازمة السيروتونين.'
      },
      mechanism: {
        en: 'Both medicines increase serotonin signaling.',
        ar: 'يزيد الدواءان إشارات السيروتونين.'
      },
      management: {
        en: 'Co-use is sometimes appropriate for migraine; monitor for agitation, sweating, tremor, or fever.',
        ar: 'قد يكون الجمع مناسبًا لبعض حالات الشقيقة؛ راقب الهياج والتعرق والرعشة والحمى.'
      },
      sources: [daily('Sertraline', 'السيرترالين', 'sertraline'), daily('Sumatriptan', 'السوماتريبتان', 'sumatriptan')]
    },
    {
      a: 'ssri_snri', b: 'maoi', severity: 'avoid',
      effect: {
        en: 'Severe serotonin syndrome, which can be life-threatening.',
        ar: 'متلازمة سيروتونين شديدة قد تهدد الحياة.'
      },
      mechanism: {
        en: 'MAO inhibitors block serotonin breakdown while SSRIs/SNRIs increase serotonin activity.',
        ar: 'تثبط مثبطات MAO تكسر السيروتونين بينما تزيد مضادات SSRI/SNRI نشاطه.'
      },
      management: {
        en: 'Contraindicated. Allow a 14-day washout (5 weeks after fluoxetine) before switching between them.',
        ar: 'الجمع ممنوع. انتظر 14 يومًا (5 أسابيع بعد الفلوكستين) قبل التبديل بينهما.'
      },
      sources: [daily('Sertraline', 'السيرترالين', 'sertraline'), daily('Fluoxetine', 'الفلوكستين', 'fluoxetine'), daily('Phenelzine', 'الفينيلزين', 'phenelzine')]
    },
    {
      a: 'maoi', b: 'tramadol', severity: 'avoid',
      effect: {
        en: 'Serotonin syndrome and seizures.',
        ar: 'متلازمة السيروتونين والنوبات.'
      },
      mechanism: {
        en: 'MAO inhibition plus tramadol’s serotonergic and seizure-lowering effects.',
        ar: 'تثبيط MAO مع التأثير السيروتونيني للترامادول وخفضه عتبة النوبات.'
      },
      management: {
        en: 'Contraindicated. Allow an adequate washout and choose a different analgesic.',
        ar: 'الجمع ممنوع. انتظر المدة اللازمة قبل التبديل واختر مسكنًا آخر.'
      },
      sources: [daily('Phenelzine', 'الفينيلزين', 'phenelzine'), daily('Tramadol', 'الترامادول', 'tramadol')]
    },
    {
      a: 'opioid', b: 'benzodiazepine', severity: 'major',
      effect: {
        en: 'Profound sedation, respiratory depression, coma, and death.',
        ar: 'نعاس شديد وتثبيط تنفسي وغيبوبة وقد تصل إلى الوفاة.'
      },
      mechanism: {
        en: 'Both suppress the central nervous system and breathing.',
        ar: 'يثبط الدواءان الجهاز العصبي المركزي والتنفس.'
      },
      management: {
        en: 'Avoid. If unavoidable, use the lowest doses for the shortest time, monitor breathing, and discuss naloxone.',
        ar: 'تجنب الجمع. إذا كان لا بد منه، استخدم أقل جرعة وأقصر مدة وراقب التنفس وناقش استخدام النالوكسون.'
      },
      sources: [daily('Oxycodone', 'الأوكسيكودون', 'oxycodone'), daily('Diazepam', 'الديازيبام', 'diazepam')]
    },
    {
      a: 'nitrate', b: 'pde5', severity: 'avoid',
      effect: {
        en: 'Severe hypotension, fainting, and reduced blood flow to the heart.',
        ar: 'انخفاض شديد في ضغط الدم وإغماء ونقص تدفق الدم إلى القلب.'
      },
      mechanism: {
        en: 'Both increase nitric oxide/cGMP vasodilation.',
        ar: 'يزيد الدواءان توسع الأوعية عبر مسار أكسيد النيتريك/cGMP.'
      },
      management: {
        en: 'Contraindicated. No nitrates within 24 hours of sildenafil/vardenafil or 48 hours of tadalafil; emergency nitrates require urgent care.',
        ar: 'الجمع ممنوع. لا نترات خلال 24 ساعة من سيلدينافيل/فاردينافيل أو 48 ساعة من تادالافيل؛ استخدام النترات الطارئ يحتاج رعاية عاجلة.'
      },
      sources: [daily('Viagra (sildenafil)', 'فياجرا (سيلدينافيل)', 'viagra'), daily('Cialis (tadalafil)', 'سياليس (تادالافيل)', 'cialis'), daily('Levitra (vardenafil)', 'ليفيترا (فاردينافيل)', 'levitra'), daily('Nitroglycerin', 'النيتروغليسرين', 'nitroglycerin')]
    },
    {
      a: 'simvastatin', b: 'strong_cyp3a4', severity: 'avoid',
      effect: {
        en: 'Severe muscle injury and rhabdomyolysis.',
        ar: 'إصابة عضلية شديدة وانحلال الربيدات.'
      },
      mechanism: {
        en: 'Strong CYP3A4 inhibitors greatly increase simvastatin exposure.',
        ar: 'تزيد مثبطات CYP3A4 القوية تعرض الجسم للسيمفاستاتين بدرجة كبيرة.'
      },
      management: {
        en: 'Contraindicated with clarithromycin, itraconazole, ketoconazole, ritonavir and similar strong inhibitors. Hold the statin or use an alternative.',
        ar: 'الجمع ممنوع مع الكلاريثروميسين والإيتراكونازول والكيتوكونازول والريتونافير والمثبطات القوية المشابهة. أوقف الستاتين مؤقتًا أو استخدم بديلًا.'
      },
      sources: [daily('Zocor (simvastatin)', 'زوكور (سيمفاستاتين)', 'zocor'), daily('Clarithromycin', 'الكلاريثروميسين', 'clarithromycin'), sources.fdaInteractions]
    },
    {
      a: 'simvastatin', b: 'macrolide_cyp', severity: 'avoid',
      effect: {
        en: 'Severe muscle injury and rhabdomyolysis.',
        ar: 'إصابة عضلية شديدة وانحلال الربيدات.'
      },
      mechanism: {
        en: 'Clarithromycin and erythromycin inhibit CYP3A4, greatly increasing simvastatin exposure.',
        ar: 'يثبط الكلاريثروميسين والإريثروميسين CYP3A4، ما يزيد تعرض الجسم للسيمفاستاتين بدرجة كبيرة.'
      },
      management: {
        en: 'Contraindicated with clarithromycin or erythromycin. Hold simvastatin during the antibiotic course or choose an alternative statin or antibiotic.',
        ar: 'الجمع ممنوع مع الكلاريثروميسين أو الإريثروميسين. أوقف السيمفاستاتين خلال مدة المضاد الحيوي أو اختر ستاتينًا أو مضادًا حيويًا بديلًا.'
      },
      sources: [daily('Zocor (simvastatin)', 'زوكور (سيمفاستاتين)', 'zocor'), daily('Clarithromycin', 'الكلاريثروميسين', 'clarithromycin'), daily('Erythromycin', 'الإريثروميسين', 'erythromycin')]
    },
    {
      a: 'simvastatin', b: 'amiodarone', severity: 'major',
      effect: {
        en: 'Higher risk of muscle injury.',
        ar: 'زيادة خطر إصابة العضلات.'
      },
      mechanism: {
        en: 'Amiodarone inhibits CYP3A4 and raises simvastatin exposure.',
        ar: 'يثبط الأميودارون CYP3A4 فيرفع تعرض الجسم للسيمفاستاتين.'
      },
      management: {
        en: 'Limit simvastatin to 20 mg/day with amiodarone, or choose another statin; report muscle pain or dark urine.',
        ar: 'لا تتجاوز جرعة السيمفاستاتين 20 مجم/يوم مع الأميودارون، أو اختر ستاتينًا آخر؛ أبلغ عن ألم العضلات أو البول الداكن.'
      },
      sources: [daily('Zocor (simvastatin)', 'زوكور (سيمفاستاتين)', 'zocor'), daily('Amiodarone', 'الأميودارون', 'amiodarone')]
    },
    {
      a: 'digoxin', b: 'amiodarone', severity: 'major',
      effect: {
        en: 'Digoxin toxicity: nausea, visual changes, confusion, and abnormal heart rhythms.',
        ar: 'تسمم الديجوكسين: غثيان وتغيرات بصرية وارتباك واضطراب نظم القلب.'
      },
      mechanism: {
        en: 'Amiodarone inhibits P-glycoprotein and reduces digoxin clearance.',
        ar: 'يثبط الأميودارون P-gp ويقلل تصفية الديجوكسين.'
      },
      management: {
        en: 'Reduce the digoxin dose by about half when starting amiodarone and monitor digoxin level and ECG.',
        ar: 'خفّض جرعة الديجوكسين إلى نحو النصف عند بدء الأميودارون وراقب مستوى الديجوكسين وتخطيط القلب.'
      },
      sources: [daily('Digoxin', 'الديجوكسين', 'digoxin'), daily('Amiodarone', 'الأميودارون', 'amiodarone')]
    },
    {
      a: 'digoxin', b: 'verapamil', severity: 'major',
      effect: {
        en: 'Digoxin toxicity and slowed heart rate.',
        ar: 'تسمم الديجوكسين وبطء ضربات القلب.'
      },
      mechanism: {
        en: 'Verapamil inhibits P-glycoprotein and reduces digoxin clearance; both slow AV conduction.',
        ar: 'يثبط الفيراباميل P-gp ويقلل تصفية الديجوكسين، وكلاهما يبطئ التوصيل الأذيني البطيني.'
      },
      management: {
        en: 'Reduce the digoxin dose and monitor level, heart rate, and ECG.',
        ar: 'خفّض جرعة الديجوكسين وراقب مستواه ومعدل النبض وتخطيط القلب.'
      },
      sources: [daily('Digoxin', 'الديجوكسين', 'digoxin'), daily('Verapamil', 'الفيراباميل', 'verapamil')]
    },
    {
      a: 'acei_arb', b: 'spironolactone', severity: 'major',
      effect: {
        en: 'Potentially dangerous hyperkalemia and worsening kidney function.',
        ar: 'احتمال ارتفاع خطير في البوتاسيوم وتدهور وظائف الكلى.'
      },
      mechanism: {
        en: 'Both reduce potassium excretion.',
        ar: 'يقلل الدواءان إخراج البوتاسيوم.'
      },
      management: {
        en: 'Monitor potassium and creatinine shortly after starting or changing doses; avoid potassium supplements unless directed.',
        ar: 'راقب البوتاسيوم والكرياتينين بعد البدء أو تغيير الجرعة؛ تجنب مكملات البوتاسيوم إلا بتوجيه.'
      },
      sources: [daily('Spironolactone', 'السبيرونولاكتون', 'spironolactone'), daily('Enalapril', 'الإينالابريل', 'enalapril')]
    },
    {
      a: 'acei_arb', b: 'tmp_smx', severity: 'major',
      effect: {
        en: 'Hyperkalemia, especially in older adults or kidney disease.',
        ar: 'ارتفاع البوتاسيوم، خصوصًا لدى كبار السن أو مرضى الكلى.'
      },
      mechanism: {
        en: 'Trimethoprim reduces potassium excretion like a potassium-sparing diuretic.',
        ar: 'يقلل التريميثوبريم إخراج البوتاسيوم بطريقة تشبه مدرات البوتاسيوم الحافظة.'
      },
      management: {
        en: 'Monitor potassium; consider another antibiotic when possible.',
        ar: 'راقب البوتاسيوم؛ وفكّر في مضاد حيوي آخر عند الإمكان.'
      },
      sources: [daily('Enalapril', 'الإينالابريل', 'enalapril'), daily('Sulfamethoxazole/trimethoprim', 'سلفاميثوكسازول/تريميثوبريم', 'sulfamethoxazole trimethoprim')]
    },
    {
      a: 'acei_arb', b: 'nsaids', severity: 'moderate',
      effect: {
        en: 'Reduced blood-pressure control, kidney injury, and hyperkalemia.',
        ar: 'ضعف التحكم في الضغط وإصابة الكلى وارتفاع البوتاسيوم.'
      },
      mechanism: {
        en: 'NSAIDs reduce prostaglandin-mediated kidney blood flow; combined with ACE/ARB effects this can impair kidney function.',
        ar: 'تقلل مضادات الالتهاب تدفق الدم الكلوي المعتمد على البروستاغلاندينات، وقد يضعف الكلى عند الجمع مع مثبطات ACE/ARB.'
      },
      management: {
        en: 'Avoid long-term use, especially with a diuretic; monitor blood pressure, kidney function, and potassium.',
        ar: 'تجنب الاستخدام الطويل، خصوصًا مع مدر للبول؛ راقب الضغط ووظائف الكلى والبوتاسيوم.'
      },
      sources: [daily('Enalapril', 'الإينالابريل', 'enalapril'), daily('Ibuprofen', 'الإيبوبروفين', 'ibuprofen')]
    },
    {
      a: 'lithium', b: 'nsaids', severity: 'major',
      effect: {
        en: 'Lithium toxicity: tremor, vomiting, confusion, and kidney effects.',
        ar: 'تسمم الليثيوم: رعشة وقيء وارتباك وتأثيرات كلوية.'
      },
      mechanism: {
        en: 'NSAIDs reduce lithium clearance by the kidneys.',
        ar: 'تقلل مضادات الالتهاب تصفية الليثيوم عبر الكلى.'
      },
      management: {
        en: 'Monitor the lithium level and kidney function; avoid or adjust the NSAID.',
        ar: 'راقب مستوى الليثيوم ووظائف الكلى؛ تجنب مضاد الالتهاب أو عدّل جرعته.'
      },
      sources: [daily('Lithium', 'الليثيوم', 'lithium'), daily('Ibuprofen', 'الإيبوبروفين', 'ibuprofen')]
    },
    {
      a: 'lithium', b: 'acei_arb', severity: 'major',
      effect: {
        en: 'Lithium toxicity.',
        ar: 'تسمم الليثيوم.'
      },
      mechanism: {
        en: 'ACE inhibitors and ARBs can reduce kidney lithium clearance.',
        ar: 'قد تقلل مثبطات ACE وحاصرات ARB تصفية الليثيوم عبر الكلى.'
      },
      management: {
        en: 'Monitor lithium levels and renal function after starting or changing the dose.',
        ar: 'راقب مستويات الليثيوم ووظائف الكلى بعد البدء أو تغيير الجرعة.'
      },
      sources: [daily('Lithium', 'الليثيوم', 'lithium'), daily('Enalapril', 'الإينالابريل', 'enalapril')]
    },
    {
      a: 'lithium', b: 'thiazide', severity: 'major',
      effect: {
        en: 'Lithium toxicity.',
        ar: 'تسمم الليثيوم.'
      },
      mechanism: {
        en: 'Thiazides cause sodium loss, increasing lithium reabsorption in the kidney.',
        ar: 'تسبب الثيازيدات فقد الصوديوم فتزيد إعادة امتصاص الليثيوم في الكلى.'
      },
      management: {
        en: 'Monitor lithium levels and adjust the dose; maintain consistent salt and fluid intake.',
        ar: 'راقب مستويات الليثيوم وعدّل الجرعة؛ حافظ على ثبات الملح والسوائل.'
      },
      sources: [daily('Lithium', 'الليثيوم', 'lithium'), daily('Hydrochlorothiazide', 'الهيدروكلوروثيازيد', 'hydrochlorothiazide')]
    },
    {
      a: 'methotrexate', b: 'nsaids', severity: 'major',
      effect: {
        en: 'Methotrexate toxicity: low blood counts, mouth ulcers, liver and kidney injury.',
        ar: 'تسمم الميثوتريكسات: نقص خلايا الدم وتقرحات الفم وإصابة الكبد والكلى.'
      },
      mechanism: {
        en: 'NSAIDs can reduce methotrexate kidney clearance, especially with high-dose treatment.',
        ar: 'قد تقلل مضادات الالتهاب تصفية الميثوتريكسات عبر الكلى، خصوصًا في العلاج بالجرعات العالية.'
      },
      management: {
        en: 'Avoid with high-dose methotrexate. With low-dose therapy, monitor blood counts, kidney, and liver tests closely.',
        ar: 'تجنب الجمع مع جرعات الميثوتريكسات العالية. في الجرعات المنخفضة، راقب تعداد الدم ووظائف الكلى والكبد عن كثب.'
      },
      sources: [daily('Methotrexate', 'الميثوتريكسات', 'methotrexate'), daily('Ibuprofen', 'الإيبوبروفين', 'ibuprofen')]
    },
    {
      a: 'methotrexate', b: 'tmp_smx', severity: 'major',
      effect: {
        en: 'Severe bone-marrow suppression and low blood counts.',
        ar: 'تثبيط شديد لنخاع العظم وانخفاض خلايا الدم.'
      },
      mechanism: {
        en: 'Both medicines interfere with folate metabolism; trimethoprim also reduces methotrexate clearance.',
        ar: 'يؤثر الدواءان في أيض الفولات، كما يقلل التريميثوبريم تصفية الميثوتريكسات.'
      },
      management: {
        en: 'Avoid the combination when possible; choose another antibiotic and monitor blood counts.',
        ar: 'تجنب الجمع عند الإمكان؛ اختر مضادًا حيويًا آخر وراقب تعداد الدم.'
      },
      sources: [daily('Methotrexate', 'الميثوتريكسات', 'methotrexate'), daily('Sulfamethoxazole/trimethoprim', 'سلفاميثوكسازول/تريميثوبريم', 'sulfamethoxazole trimethoprim')]
    },
    {
      a: 'allopurinol', b: 'azathioprine', severity: 'major',
      effect: {
        en: 'Severe bone-marrow suppression.',
        ar: 'تثبيط شديد لنخاع العظم.'
      },
      mechanism: {
        en: 'Allopurinol blocks xanthine oxidase, shunting azathioprine toward its toxic active metabolite.',
        ar: 'يحصر الألوبيورينول إنزيم الزانثين أوكسيديز فيوجه الآزاثيوبرين نحو مستقلبه الفعال السام.'
      },
      management: {
        en: 'Avoid, or reduce azathioprine to one-third–one-quarter of the usual dose (a 67–75% reduction) under specialist supervision; monitor blood counts.',
        ar: 'تجنب الجمع، أو خفّض جرعة الآزاثيوبرين إلى الثلث–الربع من جرعته المعتادة (خفض بنسبة 67–75%) تحت إشراف مختص؛ راقب تعداد الدم.'
      },
      sources: [daily('Azathioprine', 'الآزاثيوبرين', 'azathioprine'), daily('Allopurinol', 'الألوبيورينول', 'allopurinol')]
    },
    {
      a: 'carbamazepine', b: 'ocp', severity: 'major',
      effect: {
        en: 'Contraceptive failure and unplanned pregnancy.',
        ar: 'فشل وسيلة منع الحمل وحدوث حمل غير مخطط.'
      },
      mechanism: {
        en: 'Carbamazepine induces liver enzymes and accelerates estrogen/progestin breakdown.',
        ar: 'يحفز الكاربامازيبين إنزيمات الكبد فيسرع تكسر الإستروجين والبروجستين.'
      },
      management: {
        en: 'Use an additional non-hormonal method or discuss a higher-dose/alternative contraceptive with the prescriber.',
        ar: 'استخدم وسيلة إضافية غير هرمونية أو ناقش وسيلة بجرعة أعلى أو بديلة مع الطبيب.'
      },
      sources: [daily('Tegretol (carbamazepine)', 'تيجريتول (كاربامازيبين)', 'tegretol'), daily('Combined oral contraceptives', 'حبوب منع الحمل المركبة', 'contraceptive')]
    },
    {
      a: 'rifampin', b: 'ocp', severity: 'major',
      effect: {
        en: 'Contraceptive failure and unplanned pregnancy.',
        ar: 'فشل وسيلة منع الحمل وحدوث حمل غير مخطط.'
      },
      mechanism: {
        en: 'Rifampicin strongly induces enzymes that break down contraceptive hormones.',
        ar: 'يحفز الريفامبيسين بقوة الإنزيمات التي تكسر هرمونات منع الحمل.'
      },
      management: {
        en: 'Use an additional non-hormonal method during treatment and for 4 weeks after stopping rifampicin.',
        ar: 'استخدم وسيلة إضافية غير هرمونية أثناء العلاج ولمدة 4 أسابيع بعد إيقاف الريفامبيسين.'
      },
      sources: [daily('Rifampin', 'الريفامبيسين', 'rifampin'), daily('Combined oral contraceptives', 'حبوب منع الحمل المركبة', 'contraceptive')]
    },
    {
      a: 'ciprofloxacin', b: 'tizanidine', severity: 'avoid',
      effect: {
        en: 'Low blood pressure, severe sleepiness, and slow heart rate.',
        ar: 'انخفاض ضغط الدم ونعاس شديد وبطء في ضربات القلب.'
      },
      mechanism: {
        en: 'Ciprofloxacin inhibits CYP1A2 and sharply raises tizanidine levels.',
        ar: 'يثبط السيبروفلوكساسين CYP1A2 فيرفع مستويات التيزانيدين بحدّة.'
      },
      management: {
        en: 'Contraindicated. Do not use together; choose another antibiotic or muscle relaxant.',
        ar: 'الجمع ممنوع. لا تستخدمهما معًا؛ اختر مضادًا حيويًا أو مرخيًا عضليًا آخر.'
      },
      sources: [daily('Tizanidine', 'التيزانيدين', 'tizanidine'), daily('Ciprofloxacin', 'السيبروفلوكساسين', 'ciprofloxacin')]
    },
    {
      a: 'ciprofloxacin', b: 'antacids_minerals', severity: 'moderate',
      effect: {
        en: 'Reduced antibiotic absorption and treatment failure.',
        ar: 'انخفاض امتصاص المضاد الحيوي واحتمال فشل العلاج.'
      },
      mechanism: {
        en: 'Ciprofloxacin binds aluminium, magnesium, iron, and calcium, reducing absorption.',
        ar: 'يرتبط السيبروفلوكساسين بالألومنيوم والمغنيسيوم والحديد والكالسيوم فيقل امتصاصه.'
      },
      management: {
        en: 'Take ciprofloxacin 2 hours before or 6 hours after these products; separate the doses.',
        ar: 'خذ السيبروفلوكساسين قبل هذه المنتجات بساعتين أو بعدها بـ6 ساعات؛ افصل الجرعات.'
      },
      sources: [daily('Ciprofloxacin', 'السيبروفلوكساسين', 'ciprofloxacin')]
    },
    {
      a: 'tetracycline', b: 'antacids_minerals', severity: 'moderate',
      effect: {
        en: 'Reduced antibiotic absorption and treatment failure.',
        ar: 'انخفاض امتصاص المضاد الحيوي واحتمال فشل العلاج.'
      },
      mechanism: {
        en: 'Tetracyclines chelate aluminium, magnesium, iron, and calcium.',
        ar: 'تشكل التتراسيكلينات معقدات مع الألومنيوم والمغنيسيوم والحديد والكالسيوم.'
      },
      management: {
        en: 'Separate antacids, iron, or calcium by at least 2–4 hours from the antibiotic.',
        ar: 'افصل مضادات الحموضة أو الحديد أو الكالسيوم عن المضاد الحيوي 2–4 ساعات على الأقل.'
      },
      sources: [daily('Tetracycline', 'التتراسيكلين', 'tetracycline'), daily('Doxycycline', 'الدوكسيسيكلين', 'doxycycline')]
    },
    {
      a: 'levothyroxine', b: 'antacids_minerals', severity: 'moderate',
      effect: {
        en: 'Reduced thyroid-hormone absorption and under-treated hypothyroidism.',
        ar: 'انخفاض امتصاص هرمون الغدة الدرقية وعدم كفاية علاج قصور الغدة.'
      },
      mechanism: {
        en: 'Calcium, iron, and antacids bind levothyroxine in the gut.',
        ar: 'يرتبط الكالسيوم والحديد ومضادات الحموضة بالليفوثيروكسين في الأمعاء.'
      },
      management: {
        en: 'Separate calcium or iron by 4 hours and antacids by 4 hours; recheck TSH after starting or stopping.',
        ar: 'افصل الكالسيوم أو الحديد 4 ساعات ومضادات الحموضة 4 ساعات؛ أعد فحص TSH بعد البدء أو الإيقاف.'
      },
      sources: [daily('Levothyroxine', 'الليفوثيروكسين', 'levothyroxine')]
    },
    {
      a: 'levothyroxine', b: 'ppis_omeprazole', severity: 'moderate',
      effect: {
        en: 'Reduced levothyroxine absorption and changes in thyroid control.',
        ar: 'انخفاض امتصاص الليفوثيروكسين وتغير التحكم في الغدة الدرقية.'
      },
      mechanism: {
        en: 'Higher stomach pH can reduce levothyroxine dissolution and absorption.',
        ar: 'قد تقلل حموضة المعدة الأعلى ذوبان الليفوثيروكسين وامتصاصه.'
      },
      management: {
        en: 'Monitor TSH after starting or stopping a PPI; the levothyroxine dose may need adjustment.',
        ar: 'راقب TSH بعد البدء أو الإيقاف؛ قد تحتاج جرعة الليفوثيروكسين إلى تعديل.'
      },
      sources: [daily('Levothyroxine', 'الليفوثيروكسين', 'levothyroxine'), daily('Omeprazole', 'الأوميبرازول', 'omeprazole')]
    },
    {
      a: 'corticosteroid', b: 'nsaids', severity: 'moderate',
      effect: {
        en: 'Higher risk of stomach ulcer and gastrointestinal bleeding.',
        ar: 'زيادة خطر قرحة المعدة والنزف الهضمي.'
      },
      mechanism: {
        en: 'Both medicines weaken stomach-lining defenses.',
        ar: 'يضعف الدواءان دفاعات بطانة المعدة.'
      },
      management: {
        en: 'Avoid when possible; use gastroprotection and monitor for stomach pain, black stools, or vomiting blood.',
        ar: 'تجنب الجمع عند الإمكان؛ استخدم حماية للمعدة وراقب ألم المعدة أو البراز الأسود أو القيء الدموي.'
      },
      sources: [daily('Prednisolone', 'البريدنيزولون', 'prednisolone'), daily('Ibuprofen', 'الإيبوبروفين', 'ibuprofen')]
    },
    {
      a: 'azithromycin', b: 'amiodarone', severity: 'major',
      effect: {
        en: 'Dangerous QT prolongation and abnormal heart rhythms.',
        ar: 'إطالة خطيرة لفترة QT واضطراب نظم القلب.'
      },
      mechanism: {
        en: 'Both medicines slow cardiac repolarization.',
        ar: 'يبطئ الدواءان إعادة استقطاب عضلة القلب.'
      },
      management: {
        en: 'Avoid if possible. If necessary, check ECG and electrolytes and monitor closely.',
        ar: 'تجنب الجمع إن أمكن. إذا لزم، افحص تخطيط القلب والأملاح وراقب عن كثب.'
      },
      sources: [daily('Zithromax (azithromycin)', 'زيثروماكس (أزيثرومايسين)', 'zithromax'), daily('Amiodarone', 'الأميودارون', 'amiodarone')]
    }
  ];

  window.DAWAYA_CLINICAL = {
    doseMedicines,
    interactionGroups,
    interactionAgents,
    interactions
  };
})();
