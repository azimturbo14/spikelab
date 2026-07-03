export type Lang = 'en' | 'ru' | 'uz'

export const LANG_LABELS: Record<Lang, string> = {
  en: 'Eng',
  ru: 'Рус',
  uz: 'Oʻzb',
}

export const LANG_FLAGS: Record<Lang, string> = {
  en: '🇬🇧',
  ru: '🇷🇺',
  uz: '🇺🇿',
}

/* ──────────────────────────────────────────────────────────── */

type Translations = typeof en

const en = {
  // Header
  header: {
    subtitle: 'Volleyball Spike Analysis',
    nav: {
      analyze: 'Analyze',
      features: 'Features',
      science: 'The Science',
    },
  },

  // Loading
  loading: 'Loading SpikeLab...',

  // Hero
  hero: {
    badge: 'Video-Powered Analysis',
    title1: 'Upload your spike.',
    titleHighlight: 'Get the truth.',
    description: 'AI watches your spike video and rates 15 biomechanical checkpoints. No guessing, no subjective sliders. Just real data from your real movement.',
    pill1: 'AI biomechanical audit',
    pill2: 'Strengths & weaknesses ranked',
    pill3: 'Personalized 4-week plan',
  },

  // Tabs
  tabs: {
    upload: '1. Upload Video',
    analysis: '2. Analysis',
    training: '3. Training Plan',
  },

  // Upload Tab
  upload: {
    profileTitle: 'Player Profile',
    profileDesc: 'Optional. Helps calibrate your results against position-level benchmarks.',
    nameLabel: 'Name / Nickname',
    namePlaceholder: 'Your name',
    positionLabel: 'Position',
    experienceLabel: 'Experience',
    videoTitle: 'Upload Your Spike Video',
    videoDesc: 'Record yourself performing a full spike approach and hit. Side angle works best.',
    tipsTitle: 'Tips for best results',
    tip1: 'Record from the side angle (perpendicular to the net)',
    tip2: 'Show the full approach and jump — not just the hit',
    tip3: 'Good lighting, steady camera',
    tip4: 'Wear contrasting clothing against the background',
    errorTitle: 'Analysis failed',
    analyzeBtn: 'Analyze My Spike',
    analyzingBtn: 'Analyzing...',
    resetBtn: 'Reset',
  },

  // Video Uploader
  uploader: {
    dropHere: 'Drop your spike video here',
    orBrowse: 'or click to browse',
    formats: 'MP4, MOV, AVI, WebM — up to 50MB',
    remove: 'Remove',
    readyToAnalyze: 'Ready to analyze',
    analyzing: 'Analyzing your spike with AI...',
    analyzingSub: 'YOLOv8 pose tracking every frame — about 5-15 seconds',
    errorNotVideo: 'This file is not a video. Please upload a video file (MP4, MOV, AVI, WebM).',
    errorTooLarge: 'Video file is too large. Maximum size is 50MB.',
    errorGeneric: 'Could not read this video file. Please try a different file.',
  },

  // Analysis Tab
  analysis: {
    emptyMsg: 'Upload and analyze a video first to see your results.',
    yourSpikeAnalysis: "Spike Analysis",
    allCheckpoints: 'All 16 Checkpoints',
    topStrengths: 'Top Strengths',
    topWeaknesses: 'Top Weaknesses',
    generateBtn: 'Generate 4-Week Training Plan',
    generatingBtn: 'Generating plan...',
    newAnalysisBtn: 'New Analysis',
    phaseApproach: 'Approach',
    phaseJump: 'Jump & Rotation',
    phaseContact: 'Arm Swing & Contact',
    phaseFollowThrough: 'Follow-Through & Landing',
    phaseLabelApproach: 'Approach',
    phaseLabelJump: 'Jump',
    phaseLabelContact: 'Contact',
    phaseLabelFollowThrough: 'Follow-Through',
  },

  // Training Tab
  training: {
    title: 'Your 4-Week Training Plan',
    emptyMsg: 'Complete the analysis first, then generate your training plan.',
    readyMsg: 'Your analysis is ready. Generate your personalized training plan.',
    generateBtn: 'Generate 4-Week Plan',
    generatingBtn: 'Generating plan...',
    week: 'Week',
    watch: 'Watch',
    hide: 'Hide',
    noEquipment: 'No equipment?',
    startOver: 'Start Over',
  },

  // Features Section
  features: {
    title: 'Everything you need to actually fix your spike',
    description: "No more guessing. The AI watches your video and tells you exactly what's happening — then builds a plan around your real weaknesses.",
    cards: [
      {
        title: 'Video-Powered Analysis',
        desc: 'Upload a video of your spike. The AI analyzes 15 biomechanical checkpoints from actual movement data — not subjective self-assessment.',
      },
      {
        title: 'AI Biomechanical Audit',
        desc: 'A vision model trained on sports biomechanics rates your approach, jump, contact, and landing with expert-level accuracy.',
      },
      {
        title: 'Strengths & Weaknesses Ranked',
        desc: "See what you're already doing well and what's killing your spike — in priority order. Stop fixing what isn't broken.",
      },
      {
        title: 'Personalized 4-Week Plan',
        desc: 'Daily drills with sets, reps, and coaching cues organized around your weakest phases. Built for actual athletes.',
      },
      {
        title: 'Phase-by-Phase Breakdown',
        desc: 'Separate scores for Approach, Jump, Contact, and Follow-Through. Know exactly which phase to attack first.',
      },
      {
        title: 'Injury-First Mindset',
        desc: 'Landing balance and follow-through are scored as hard as power. The best spike is one you can repeat injury-free.',
      },
    ],
  },

  // Science Section
  science: {
    title: 'The 4 phases of an elite spike',
    description: "Power in volleyball is not about arm strength — it's about the kinetic chain. Energy flows from the ground through the legs, hips, torso, shoulder, arm, and wrist into the ball.",
    phases: [
      {
        title: '1. The Approach',
        desc: 'A 3-step (or 4-step) approach where the last two steps are the longest and fastest. The second-to-last step converts horizontal momentum into vertical force.',
        items: ['Approach speed', 'Last step length', 'Approach angle', 'Footwork rhythm', 'Arm swing back'],
      },
      {
        title: '2. The Jump',
        desc: 'Maximized by hip-shoulder separation. The hips stay closed while the shoulders rotate, storing elastic energy in the core — the engine of spiking power.',
        items: ['Vertical jump conversion', 'Hip-shoulder rotation', 'Air body position'],
      },
      {
        title: '3. Arm Swing & Contact',
        desc: 'The hitting arm loads into a bow-and-arrow position, then whips through with internal shoulder rotation. Wrist snap generates topspin for a heavy, sharp ball.',
        items: ['Bow-and-arrow position', 'Arm swing speed', 'Contact point', 'Wrist snap', 'Contact height'],
      },
      {
        title: '4. Follow-Through & Landing',
        desc: 'The arm continues across the body to decelerate safely. A soft two-foot landing with knees bent protects joints and enables instant defensive transition.',
        items: ['Follow-through', 'Landing balance'],
      },
    ],
  },

  // Footer
  footer: {
    subtitle: 'Volleyball Spike Analysis & Training',
    disclaimer: 'Not a substitute for in-person coaching. Always warm up properly and consult a sports physiotherapist if you experience persistent pain.',
  },

  // Score Labels
  scoreLabels: {
    elite: 'Elite',
    excellent: 'Excellent',
    decent: 'Decent',
    needsWork: 'Needs Work',
    critical: 'Critical',
  },

  // Positions
  positions: [
    'Outside Hitter',
    'Opposite',
    'Middle Blocker',
    'Setter',
    'Libero',
    'Right Side',
  ],
  positionLabels: {
    'Outside Hitter': 'Outside Hitter',
    'Opposite': 'Opposite',
    'Middle Blocker': 'Middle Blocker',
    'Setter': 'Setter',
    'Libero': 'Libero',
    'Right Side': 'Right Side',
  },

  // Experience Levels
  experienceLevels: [
    'Beginner (< 2 years)',
    'Intermediate (2-5 years)',
    'Advanced (5-10 years)',
    'Elite (10+ years)',
  ],
  experienceLabels: {
    'Beginner (< 2 years)': 'Beginner (< 2 years)',
    'Intermediate (2-5 years)': 'Intermediate (2-5 years)',
    'Advanced (5-10 years)': 'Advanced (5-10 years)',
    'Elite (10+ years)': 'Elite (10+ years)',
  },

  // Checkpoint Labels
  checkpoints: {
    approach_speed: 'Approach Speed',
    approach_angle: 'Approach Angle',
    last_step_length: 'Last Step Length',
    footwork_rhythm: 'Footwork Rhythm',
    arms_swing_back: 'Arms Swing Back on Plant',
    vertical_jump_conversion: 'Vertical Jump Conversion',
    hip_shoulder_rotation: 'Hip-Shoulder Rotation',
    body_position_air: 'Body Position in Air',
    bow_and_arrow: 'Bow-and-Arrow Position',
    arm_swing_speed: 'Arm Swing Speed',
    contact_point: 'Contact Point',
    wrist_snap: 'Wrist Snap (Topspin)',
    contact_height: 'Contact Height',
    follow_through: 'Follow-Through',
    landing_balance: 'Landing Balance',
  },

  // Error messages
  errors: {
    analysisFailed: 'Analysis failed',
    unexpectedFormat: 'Unexpected response format from analysis',
    timeout: 'Analysis timed out. Please try with a shorter video.',
    somethingWentWrong: 'Something went wrong',
    planFailed: 'Plan generation failed',
    planGenerateFailed: 'Failed to generate plan',
  },
} as const

/* ──────────────────────────────────────────────────────────── */

const ru: Translations = {
  header: {
    subtitle: 'Анализ нападающего удара по волейболу',
    nav: {
      analyze: 'Анализ',
      features: 'Возможности',
      science: 'Наука',
    },
  },
  loading: 'Загрузка SpikeLab...',
  hero: {
    badge: 'Видеоанализ',
    title1: 'Загрузите ваш удар.',
    titleHighlight: 'Узнайте правду.',
    description: 'ИИ анализирует ваше видео нападающего удара и оценивает 15 биомеханических показателей. Никаких догадок, никаких субъективных ползунков. Только реальные данные вашего движения.',
    pill1: 'ИИ биомеханический аудит',
    pill2: 'Сильные и слабые стороны по рангу',
    pill3: 'Персональный план на 4 недели',
  },
  tabs: {
    upload: '1. Загрузить видео',
    analysis: '2. Анализ',
    training: '3. Тренировочный план',
  },
  upload: {
    profileTitle: 'Профиль игрока',
    profileDesc: 'Необязательно. Помогает калибровать результаты по нормативам позиции.',
    nameLabel: 'Имя / Псевдоним',
    namePlaceholder: 'Ваше имя',
    positionLabel: 'Позиция',
    experienceLabel: 'Опыт',
    videoTitle: 'Загрузите видео нападающего удара',
    videoDesc: 'Запишите полный разбег и удар. Боковой угол лучше всего.',
    tipsTitle: 'Советы для лучшего результата',
    tip1: 'Снимайте сбоку (перпендикулярно сетке)',
    tip2: 'Покажите полный разбег и прыжок — не только удар',
    tip3: 'Хорошее освещение, устойчивая камера',
    tip4: 'Одежда должна контрастировать с фоном',
    errorTitle: 'Ошибка анализа',
    analyzeBtn: 'Анализировать мой удар',
    analyzingBtn: 'Анализ...',
    resetBtn: 'Сбросить',
  },
  uploader: {
    dropHere: 'Перетащите видео вашего удара сюда',
    orBrowse: 'или нажмите для выбора',
    formats: 'MP4, MOV, AVI, WebM — до 50 МБ',
    remove: 'Удалить',
    readyToAnalyze: 'Готово к анализу',
    analyzing: 'ИИ анализирует ваш удар...',
    analyzingSub: 'YOLOv8 отслеживание позы каждый кадр — около 5-15 секунд',
    errorNotVideo: 'Этот файл не является видео. Загрузите видеофайл (MP4, MOV, AVI, WebM).',
    errorTooLarge: 'Видеофайл слишком большой. Максимальный размер — 50 МБ.',
    errorGeneric: 'Не удалось прочитать этот видеофайл. Попробуйте другой файл.',
  },
  analysis: {
    emptyMsg: 'Сначала загрузите и проанализируйте видео, чтобы увидеть результаты.',
    yourSpikeAnalysis: 'Анализ нападающего удара',
    allCheckpoints: 'Все 16 показателей',
    topStrengths: 'Сильные стороны',
    topWeaknesses: 'Слабые стороны',
    generateBtn: 'Создать план на 4 недели',
    generatingBtn: 'Создание плана...',
    newAnalysisBtn: 'Новый анализ',
    phaseApproach: 'Разбег',
    phaseJump: 'Прыжок и вращение',
    phaseContact: 'Замах и контакт',
    phaseFollowThrough: 'Проводка и приземление',
    phaseLabelApproach: 'Разбег',
    phaseLabelJump: 'Прыжок',
    phaseLabelContact: 'Контакт',
    phaseLabelFollowThrough: 'Проводка',
  },
  training: {
    title: 'Ваш тренировочный план на 4 недели',
    emptyMsg: 'Сначала пройдите анализ, затем создайте тренировочный план.',
    readyMsg: 'Ваш анализ готов. Создайте персональный тренировочный план.',
    generateBtn: 'Создать план на 4 недели',
    generatingBtn: 'Создание плана...',
    week: 'Неделя',
    watch: 'Смотреть',
    hide: 'Скрыть',
    noEquipment: 'Нет инвентаря?',
    startOver: 'Начать заново',
  },
  features: {
    title: 'Всё, что нужно для реального улучшения вашего удара',
    description: 'Никаких догадок. ИИ смотрит ваше видео и говорит, что именно происходит — а затем строит план вокруг ваших реальных слабостей.',
    cards: [
      {
        title: 'Видеоанализ',
        desc: 'Загрузите видео вашего удара. ИИ анализирует 15 биомеханических показателей по реальным данным движения — без субъективной самооценки.',
      },
      {
        title: 'ИИ биомеханический аудит',
        desc: 'Модель компьютерного зрения обучена на спортивной биомеханике и оценивает разбег, прыжок, контакт и приземление с экспертной точностью.',
      },
      {
        title: 'Рейтинг сильных и слабых сторон',
        desc: 'Узнайте, что вы уже делаете хорошо, и что мешает вашему удару — в порядке приоритета. Не чините то, что не сломано.',
      },
      {
        title: 'Персональный план на 4 недели',
        desc: 'Ежедневные упражнения с подходами, повторениями и тренерскими подсказками, организованные вокруг ваших слабых фаз.',
      },
      {
        title: 'Анализ по фазам',
        desc: 'Отдельные оценки для разбега, прыжка, контакта и проводки. Точно знайте, какую фазу атаковать первой.',
      },
      {
        title: 'Приоритет безопасности',
        desc: 'Баланс при приземлении и проводка оцениваются так же строго, как сила. Лучший удар — тот, который можно повторить без травм.',
      },
    ],
  },
  science: {
    title: '4 фазы элитного нападающего удара',
    description: 'Сила в волейболе — это не сила рук. Это кинетическая цепь. Энергия проходит от земли через ноги, бёдра, корпус, плечо, руку и запястье в мяч.',
    phases: [
      {
        title: '1. Разбег',
        desc: '3-шаговый (или 4-шаговый) разбег, где последние два шага самые длинные и быстрые. Предпоследний шаг преобразует горизонтальный импульс в вертикальную силу.',
        items: ['Скорость разбега', 'Длина последнего шага', 'Угол разбега', 'Ритм шагов', 'Отведение рук назад'],
      },
      {
        title: '2. Прыжок',
        desc: 'Максимизируется за счёт разделения бёдер и плеч. Бёдра остаются закрытыми, а плечи вращаются, накапливая упругую энергию в корпусе — двигателе силы удара.',
        items: ['Вертикальное преобразование', 'Вращение бёдра-плеча', 'Положение тела в воздухе'],
      },
      {
        title: '3. Замах и контакт',
        desc: 'Бьющая рука нагружается в положение «лук и стрела», затем взмахивается с внутренним вращением плеча. Щелчок запястьем создаёт верхнее вращение для тяжёлого резкого мяча.',
        items: ['Положение «лук и стрела»', 'Скорость взмаха', 'Точка контакта', 'Щелчок запястьем', 'Высота контакта'],
      },
      {
        title: '4. Проводка и приземление',
        desc: 'Рука продолжает движение через корпус для безопасного замедления. Мягкое приземление на обе ноги с согнутыми коленями защищает суставы и обеспечивает мгновенный переход к защите.',
        items: ['Проводка', 'Баланс при приземлении'],
      },
    ],
  },
  footer: {
    subtitle: 'Анализ и тренировка нападающего удара по волейболу',
    disclaimer: 'Не заменяет очное обучение тренера. Всегда хорошо разогревайтесь и проконсультируйтесь со спортивным физиотерапевтом при постоянной боли.',
  },
  scoreLabels: {
    elite: 'Элита',
    excellent: 'Отлично',
    decent: 'Нормально',
    needsWork: 'Требует работы',
    critical: 'Критично',
  },
  positions: ['Outside Hitter', 'Opposite', 'Middle Blocker', 'Setter', 'Libero', 'Right Side'],
  positionLabels: {
    'Outside Hitter': 'Доигровщик',
    'Opposite': 'Нападающий',
    'Middle Blocker': 'Центральный блокирующий',
    'Setter': 'Связующий',
    'Libero': 'Либеро',
    'Right Side': 'Правый нападающий',
  },
  experienceLevels: ['Beginner (< 2 years)', 'Intermediate (2-5 years)', 'Advanced (5-10 years)', 'Elite (10+ years)'],
  experienceLabels: {
    'Beginner (< 2 years)': 'Новичок (до 2 лет)',
    'Intermediate (2-5 years)': 'Средний (2-5 лет)',
    'Advanced (5-10 years)': 'Продвинутый (5-10 лет)',
    'Elite (10+ years)': 'Элита (10+ лет)',
  },
  checkpoints: {
    approach_speed: 'Скорость разбега',
    approach_angle: 'Угол разбега',
    last_step_length: 'Длина последнего шага',
    footwork_rhythm: 'Ритм шагов',
    arms_swing_back: 'Отведение рук при постановке',
    vertical_jump_conversion: 'Вертикальное преобразование',
    hip_shoulder_rotation: 'Вращение бёдер-плеч',
    body_position_air: 'Положение тела в воздухе',
    bow_and_arrow: 'Положение «лук и стрела»',
    arm_swing_speed: 'Скорость взмаха',
    contact_point: 'Точка контакта',
    wrist_snap: 'Щелчок запястьем (верхнее вращение)',
    contact_height: 'Высота контакта',
    follow_through: 'Проводка',
    landing_balance: 'Баланс при приземлении',
  },
  errors: {
    analysisFailed: 'Ошибка анализа',
    unexpectedFormat: 'Неожиданный формат ответа анализа',
    timeout: 'Анализ превысил время. Попробуйте более короткое видео.',
    somethingWentWrong: 'Что-то пошло не так',
    planFailed: 'Ошибка создания плана',
    planGenerateFailed: 'Не удалось создать план',
  },
}

/* ──────────────────────────────────────────────────────────── */

const uz: Translations = {
  header: {
    subtitle: 'Voleybol hujum zarbasi tahlili',
    nav: {
      analyze: 'Tahlil',
      features: 'Imkoniyatlar',
      science: 'Fan',
    },
  },
  loading: 'SpikeLab yuklanmoqda...',
  hero: {
    badge: 'Video-tahlil',
    title1: 'Hujum zarbangizni yuklang.',
    titleHighlight: 'Haqiqatni bilib oling.',
    description: 'Sun\'iy intellekt hujum zarbasi videongizni ko\'radi va 15 biomekanik ko\'rsatkichni baholaydi. Hech qanday taxmin, hech qanday subyektiv slayderlar. Faqat haqiqiy harakatlaringizdan haqiqiy ma\'lumotlar.',
    pill1: 'SI biomekanik audit',
    pill2: 'Kuchli va zaif tomonlar reytingi',
    pill3: 'Shaxsiy 4 haftalik reja',
  },
  tabs: {
    upload: '1. Video yuklash',
    analysis: '2. Tahlil',
    training: '3. Mashg\'ulat rejasi',
  },
  upload: {
    profileTitle: 'O\'yinchining profili',
    profileDesc: 'Ixtiyoriy. Natijalaringizni pozitsiya darajasidagi me\'yorga moslashtirishga yordam beradi.',
    nameLabel: 'Ism / Taxallus',
    namePlaceholder: 'Ismingiz',
    positionLabel: 'Pozitsiya',
    experienceLabel: 'Tajriba',
    videoTitle: 'Hujum zarbasi videongizni yuklang',
    videoDesc: 'To\'liq yondashuv va zarba bajaring. Yon burchak eng yaxshi natija beradi.',
    tipsTitle: 'Eng yaxshi natija uchun maslahatlar',
    tip1: 'Yon burchakdan (to\'rga perpendikulyar) suratga oling',
    tip2: 'To\'liq yondashuv va sakrashni ko\'rsating — faqat zarbasini emas',
    tip3: 'Yaxshi yoritgich, barqaror kamera',
    tip4: 'Fonga qarshi farqli kiyim kiying',
    errorTitle: 'Tahlil xatosi',
    analyzeBtn: 'Zarbamni tahlil qilish',
    analyzingBtn: 'Tahlil...',
    resetBtn: 'Qayta boshlash',
  },
  uploader: {
    dropHere: 'Hujum zarbasi videongizni shu yerga tashlang',
    orBrowse: 'yoki tanlash uchun bosing',
    formats: 'MP4, MOV, AVI, WebM — 50 MB gacha',
    remove: 'O\'chirish',
    readyToAnalyze: 'Tahlilga tayyor',
    analyzing: 'Sun\'iy intellekt zarbangizni tahlil qilmoqda...',
    analyzingSub: 'YOLOv8 har bir kadrda pozitsiyani kuzatish — 5-15 soniya atrofida',
    errorNotVideo: 'Bu fayl video emas. Iltimos, video fayl yuklang (MP4, MOV, AVI, WebM).',
    errorTooLarge: 'Video fayli juda katta. Maksimal hajmi — 50 MB.',
    errorGeneric: 'Ushbu video faylini o\'qib bo\'lmadi. Boshqa faylni sinab ko\'ring.',
  },
  analysis: {
    emptyMsg: 'Natijalarni ko\'rish uchun avval video yuklang va tahlil qiling.',
    yourSpikeAnalysis: 'Hujum zarbasi tahlili',
    allCheckpoints: 'Barcha 16 ko\'rsatkich',
    topStrengths: 'Kuchli tomonlar',
    topWeaknesses: 'Zaif tomonlar',
    generateBtn: '4 haftalik mashg\'ulat rejasi yaratish',
    generatingBtn: 'Reja yaratilmoqda...',
    newAnalysisBtn: 'Yangi tahlil',
    phaseApproach: 'Yondashuv',
    phaseJump: 'Sakrash va burilish',
    phaseContact: 'Qo\'l urishi va kontakt',
    phaseFollowThrough: 'Bajarish va qo\'nish',
    phaseLabelApproach: 'Yondashuv',
    phaseLabelJump: 'Sakrash',
    phaseLabelContact: 'Kontakt',
    phaseLabelFollowThrough: 'Bajarish',
  },
  training: {
    title: 'Sizning 4 haftalik mashg\'ulat rejangiz',
    emptyMsg: 'Avval tahlildan o\'ting, keyin mashg\'ulat rejasi yarating.',
    readyMsg: 'Tahlingiz tayyor. Shaxsiy mashg\'ulat rejangizni yarating.',
    generateBtn: '4 haftalik reja yaratish',
    generatingBtn: 'Reja yaratilmoqda...',
    week: 'Hafta',
    watch: 'Ko\'rish',
    hide: 'Yashirish',
    noEquipment: 'Asbob-yoq?',
    startOver: 'Qayta boshlash',
  },
  features: {
    title: 'Hujum zarbangizni haqiqatan ham tuzatish uchun kerak bo\'lgan hamma narsa',
    description: 'Hech qanday taxmin yo\'q. SI videongizni ko\'radi va aynan nima sodir bo\'layotganini aytadi — keyin haqiqiy zaif tomonlaringiz atrofida reja tuzadi.',
    cards: [
      {
        title: 'Video-tahlil',
        desc: 'Hujum zarbasi videongizni yuklang. SI haqiqiy harakat ma\'lumotlaridan 15 biomekanik ko\'rsatkichni tahlil qiladi — subyektiv o\'zini-o\'zi baholash emas.',
      },
      {
        title: 'SI biomekanik audit',
        desc: 'Sport biomekanikasida o\'qitilgan ko\'rish modeli yondashuv, sakrash, kontakt va qo\'nishni ekspert darajasida baholaydi.',
      },
      {
        title: 'Kuchli va zaif tomonlar reytingi',
        desc: 'Nima yaxshi qilayotganingizni va nima zarbangizni buzayotganini bilib oling — ustunlik tartibida. Buza olmaydigan narsani tuzatmang.',
      },
      {
        title: 'Shaxsiy 4 haftalik reja',
        desc: 'Eng zaif fazalaringiz atrofida tashkil etilgan yondashuvlar, takroriyliklar va murabbiylik ko\'rsatmalari bilan kunlik mashqlar.',
      },
      {
        title: 'Fazalar bo\'yicha tahlil',
        desc: 'Yondashuv, sakrash, kontakt va bajarish uchun alohida ballar. Avval qaysi fazaga hujum qilishni aniq biling.',
      },
      {
        title: 'Xavfsizlik birinchi',
        desc: 'Qo\'nish balansi va bajarish kuchga qarab qattiq baholanadi. Eng yaxshi zarba — travmasiz takrorlash mumkin bo\'lgan zarba.',
      },
    ],
  },
  science: {
    title: 'Elita hujum zarbasining 4 fazasi',
    description: 'Voleybolda kuch qo\'l kuchi haqida emas — kinetik zanjir haqida. Energiya yerdan oyoqlar, sonlar, tananing o\'rtasi, yelka, qo\'l va bilak orqali to\'pga oqadi.',
    phases: [
      {
        title: '1. Yondashuv',
        desc: '3 qadamli (yoki 4 qadamli) yondashuv, oxirgi ikki qadam eng uzun va tezkor. Oxirgi oldingi qadam gorizontal impulsni vertikal kuchga aylantiradi.',
        items: ['Yondashuv tezligi', 'Oxirgi qadam uzunligi', 'Yondashuv burchagi', 'Qadam ritmi', 'Qo\'llarni orqaga urish'],
      },
      {
        title: '2. Sakrash',
        desc: 'Son-yelka ajralishi bilan maksimallashtiriladi. Sonlar yopiq holda qoladi, yelkalar buriladi, tananing o\'rtasida elastik energiya saqlanadi — zarba kuchi dvigateli.',
        items: ['Vertikal konversiya', 'Son-yelka burilishi', 'Havoda tana holati'],
      },
      {
        title: '3. Qo\'l urishi va kontakt',
        desc: 'Zarba qo\'li \"o\'q va kamon\" holatiga yuklanadi, keyin ichki yelka burilishi bilan tez uriladi. Bilak chertish og\'ir, keskin to\'p uchun yuqori aylanish yaratadi.',
        items: ['\"O\'q va kamon\" holati', 'Qo\'l urish tezligi', 'Kontakt nuqtasi', 'Bilak chertish', 'Kontakt balandligi'],
      },
      {
        title: '4. Bajarish va qo\'nish',
        desc: 'Qo\'l xavfsiz sekinlashish uchun tanadan o\'tishda davom etadi. Tizzalari egilgan ikki oyoqda yumshoq qo\'nish bo\'g\'imlarni himoya qiladi va mudofaa o\'tishiga imkon beradi.',
        items: ['Bajarish', 'Qo\'nish balansi'],
      },
    ],
  },
  footer: {
    subtitle: 'Voleybol hujum zarbasi tahlili va mashg\'ulat',
    disclaimer: 'Shaxsiy murabbiylik o\'rnini bosmaydi. Doimo yaxshi isitib oling va doimiy og\'riq bo\'lsa sport fizioterapevtiga murojaat qiling.',
  },
  scoreLabels: {
    elite: 'Elita',
    excellent: "A'lo",
    decent: 'Yaxshi',
    needsWork: 'Yaxshilash kerak',
    critical: 'Kritik',
  },
  positions: ['Outside Hitter', 'Opposite', 'Middle Blocker', 'Setter', 'Libero', 'Right Side'],
  positionLabels: {
    'Outside Hitter': 'O\'ng hujumchi',
    'Opposite': 'Chap hujumchi',
    'Middle Blocker': 'Markaziy bloker',
    'Setter': 'Pleyymeyker',
    'Libero': 'Libero',
    'Right Side': 'O\'ng tomon hujumchi',
  },
  experienceLevels: ['Beginner (< 2 years)', 'Intermediate (2-5 years)', 'Advanced (5-10 years)', 'Elite (10+ years)'],
  experienceLabels: {
    'Beginner (< 2 years)': 'Boshlang\'ich (2 yilgacha)',
    'Intermediate (2-5 years)': 'O\'rta (2-5 yil)',
    'Advanced (5-10 years)': 'Ilg\'or (5-10 yil)',
    'Elite (10+ years)': 'Elita (10+ yil)',
  },
  checkpoints: {
    approach_speed: 'Yondashuv tezligi',
    approach_angle: 'Yondashuv burchagi',
    last_step_length: 'Oxirgi qadam uzunligi',
    footwork_rhythm: 'Qadam ritmi',
    arms_swing_back: 'Qo\'llarni orqaga urish',
    vertical_jump_conversion: 'Vertikal konversiya',
    hip_shoulder_rotation: 'Son-yelka burilishi',
    body_position_air: 'Havoda tana holati',
    bow_and_arrow: '"O\'q va kamon" holati',
    arm_swing_speed: 'Qo\'l urish tezligi',
    contact_point: 'Kontakt nuqtasi',
    wrist_snap: 'Bilak chertish (yuqori aylanish)',
    contact_height: 'Kontakt balandligi',
    follow_through: 'Bajarish',
    landing_balance: 'Qo\'nish balansi',
  },
  errors: {
    analysisFailed: 'Tahlil xatosi',
    unexpectedFormat: 'Tahlildan kutilmagan javob formati',
    timeout: 'Tahlil vaqti tugadi. Qisqaroq video bilan urinib ko\'ring.',
    somethingWentWrong: 'Nimadir noto\'g\'ri bo\'ldi',
    planFailed: 'Reja yaratish xatosi',
    planGenerateFailed: 'Reja yaratilmadi',
  },
}

/* ──────────────────────────────────────────────────────────── */

export const translations: Record<Lang, Translations> = { en, ru, uz }