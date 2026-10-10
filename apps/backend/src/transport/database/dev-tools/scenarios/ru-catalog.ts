import type { CatalogTerm } from './scenario-spec'

// Curated Russian terms for the dev scenarios (English native language).
// Every headword resolves to a single real lemma in the local kaikki load —
// the CLI checks that before seeding. Stress marks are written as explicit
// U+0301 escapes.

// --- word-family set: writer / reader / translator / safety / waterfall ----

export const писатель: CatalogTerm = {
  headword: 'писатель',
  sense: 'author',
  translation: 'writer',
  definition: 'Человек, который пишет книги или статьи.',
  targetExample: 'Мой любимый писатель живёт в Петербурге.',
  nativeExample: 'My favourite writer lives in St Petersburg.',
  surface: 'писатель',
  grammar: { pos: 'noun', display_form: 'писа́тель', gender: 'm' },
  zipf: 4.9,
  exercises: {
    cloze: {
      sentence: 'Писатель закончил последнюю главу романа и отправил рукопись в издательство.',
      answer: 'Писатель',
      distractors: ['Повар', 'Водитель', 'Сантехник'],
    },
    comprehension: {
      sentence: 'Молодой писатель каждое утро работает над своей первой книгой.',
      term: 'писатель',
      prompt: 'What does the young man do every morning?',
      options: ['Cooks breakfast for his family', 'Works on his first book', 'Drives to the office', 'Reads the news'],
      answerIndex: 1,
    },
  },
  insight: {
    parts: [
      { text: 'писать', isAffix: false },
      { text: '-тель', isAffix: true },
    ],
    partMeanings: ['to write', 'one who does the action'],
  },
}

export const читатель: CatalogTerm = {
  headword: 'читатель',
  sense: 'one who reads',
  translation: 'reader',
  definition: 'Человек, который читает книги, газеты или журналы.',
  targetExample: 'Каждый читатель найдёт в этой книге что-то своё.',
  nativeExample: 'Every reader will find something of their own in this book.',
  surface: 'читатель',
  grammar: { pos: 'noun', display_form: 'чита́тель', gender: 'm' },
  zipf: 4.6,
  exercises: {
    cloze: {
      sentence: 'Внимательный читатель сразу заметит ошибку в третьей главе.',
      answer: 'читатель',
      distractors: ['строитель', 'пловец', 'продавец'],
    },
    comprehension: {
      sentence: 'Этот читатель прочитал все романы автора за одно лето.',
      term: 'читатель',
      prompt: 'What did this person do over one summer?',
      options: ["Read all of the author's novels", 'Wrote a novel', 'Travelled abroad', 'Painted the house'],
      answerIndex: 0,
    },
  },
  insight: {
    parts: [
      { text: 'читать', isAffix: false },
      { text: '-тель', isAffix: true },
    ],
    partMeanings: ['to read', 'one who does the action'],
  },
}

export const переводчик: CatalogTerm = {
  headword: 'переводчик',
  sense: 'person who translates',
  translation: 'translator, interpreter',
  definition: 'Человек, который переводит тексты или речь с одного языка на другой.',
  targetExample: 'На переговорах нам помогал опытный переводчик.',
  nativeExample: 'An experienced interpreter helped us at the negotiations.',
  surface: 'переводчик',
  grammar: { pos: 'noun', display_form: 'перево́дчик', gender: 'm' },
  zipf: 4.3,
  exercises: {
    cloze: {
      sentence: 'Книгу перевёл с японского известный переводчик.',
      answer: 'переводчик',
      distractors: ['пекарь', 'электрик', 'почтальон'],
    },
    comprehension: {
      sentence: 'Без переводчика мы не смогли бы понять ни слова на этой встрече.',
      term: 'переводчика',
      prompt: 'What did they need to understand the meeting?',
      options: ['Someone translating for them', 'A bigger room', 'More time', 'A printed agenda'],
      answerIndex: 0,
    },
  },
  // водить is a depth-2 ancestor (via переводить) that would otherwise link
  // the word to every вод- word the user has (вода, водопад).
  insight: {
    parts: [
      { text: 'переводить', isAffix: false },
      { text: '-чик', isAffix: true },
    ],
    partMeanings: ['to translate', 'person who does it'],
    hiddenAncestors: ['водить'],
  },
}

export const безопасность: CatalogTerm = {
  headword: 'безопасность',
  sense: 'freedom from danger',
  translation: 'safety, security',
  definition: 'Состояние, когда нет угрозы или опасности.',
  targetExample: 'Безопасность пассажиров — главная задача экипажа.',
  nativeExample: "Passenger safety is the crew's main task.",
  surface: 'Безопасность',
  grammar: { pos: 'noun', display_form: 'безопа́сность', gender: 'f' },
  zipf: 5.0,
  exercises: {
    cloze: {
      sentence: 'Ремень нужно пристегнуть ради вашей безопасности.',
      answer: 'безопасности',
      distractors: ['красоты', 'скуки', 'бедности'],
    },
    comprehension: {
      sentence: 'В этом районе полиция отвечает за безопасность жителей.',
      term: 'безопасность',
      prompt: 'What are the police responsible for?',
      options: ['Keeping residents safe', 'Cleaning the streets', 'Collecting taxes', 'Building houses'],
      answerIndex: 0,
    },
  },
  insight: {
    parts: [
      { text: 'безопасный', isAffix: false },
      { text: '-ость', isAffix: true },
    ],
    partMeanings: ['safe', 'the quality of being …'],
  },
}

export const водопад: CatalogTerm = {
  headword: 'водопад',
  sense: 'falling water',
  translation: 'waterfall',
  definition: 'Поток воды, падающий с высоты.',
  targetExample: 'Мы долго шли по лесу, пока не увидели водопад.',
  nativeExample: 'We walked through the forest for a long time until we saw the waterfall.',
  surface: 'водопад',
  grammar: { pos: 'noun', display_form: 'водопа́д', gender: 'm' },
  zipf: 3.9,
  exercises: {
    cloze: {
      sentence: 'Шум водопада был слышен за километр.',
      answer: 'водопада',
      distractors: ['ковра', 'шкафа', 'конверта'],
    },
    comprehension: {
      sentence: 'Туристы фотографировались у высокого водопада в горах.',
      term: 'водопада',
      prompt: 'Where did the tourists take photos?',
      options: ['Next to a tall waterfall', 'In a museum', 'At the train station', 'On a crowded beach'],
      answerIndex: 0,
    },
  },
  insight: {
    parts: [
      { text: 'вода', isAffix: false },
      { text: '-о-', isAffix: true },
      { text: 'падать', isAffix: false },
    ],
    partMeanings: ['water', 'linking vowel', 'to fall'],
    hiddenAncestors: ['водить'],
  },
}

// The saved relatives (anchors) of the set above.

export const читать: CatalogTerm = {
  headword: 'читать',
  sense: 'look at and understand text',
  translation: 'to read',
  definition: 'Воспринимать написанный текст.',
  targetExample: 'Я люблю читать перед сном.',
  nativeExample: 'I like reading before bed.',
  surface: 'читать',
  grammar: { pos: 'verb', display_form: 'чита́ть', aspect: 'impf' },
  zipf: 5.4,
}

export const перевод: CatalogTerm = {
  headword: 'перевод',
  sense: 'rendering in another language',
  translation: 'translation',
  definition: 'Текст, переданный на другом языке.',
  targetExample: 'Этот перевод очень точный.',
  nativeExample: 'This translation is very accurate.',
  surface: 'перевод',
  grammar: { pos: 'noun', display_form: 'перево́д', gender: 'm' },
  zipf: 4.9,
}

// Controls: opaque words with no relatives the user has — no family line.

const opaque = { parts: [], partMeanings: [] }

export const дюжина: CatalogTerm = {
  headword: 'дюжина',
  sense: 'twelve',
  translation: 'dozen',
  definition: 'Двенадцать штук чего-либо.',
  targetExample: 'Я купила дюжину яиц на рынке.',
  nativeExample: 'I bought a dozen eggs at the market.',
  surface: 'дюжину',
  grammar: { pos: 'noun', display_form: 'дю́жина', gender: 'f' },
  zipf: 3.9,
  exercises: {
    cloze: {
      sentence: 'В коробке лежала дюжина свежих яиц.',
      answer: 'дюжина',
      distractors: ['лужа', 'крыша', 'тишина'],
    },
    comprehension: {
      sentence: 'На столе стояла дюжина бутылок лимонада.',
      term: 'дюжина',
      prompt: 'How many bottles were on the table?',
      options: ['Two', 'Twelve', 'Twenty', 'A hundred'],
      answerIndex: 1,
    },
  },
  insight: opaque,
}

export const собака: CatalogTerm = {
  headword: 'собака',
  sense: 'animal',
  translation: 'dog',
  definition: 'Домашнее животное, которое лает и охраняет дом.',
  targetExample: 'Каждое утро я гуляю с собакой в парке.',
  nativeExample: 'Every morning I walk the dog in the park.',
  surface: 'собакой',
  grammar: { pos: 'noun', display_form: 'соба́ка', gender: 'f' },
  zipf: 5.2,
  exercises: {
    cloze: {
      sentence: 'Соседская собака громко лаяла всю ночь.',
      answer: 'собака',
      distractors: ['кошка', 'корова', 'лошадь'],
    },
    comprehension: {
      sentence: 'Наша собака всегда встречает меня у двери и виляет хвостом.',
      term: 'собака',
      prompt: 'Who greets the speaker at the door?',
      options: ['Their pet dog', 'Their neighbour', 'A delivery driver', 'Their little brother'],
      answerIndex: 0,
    },
  },
  insight: opaque,
}

export const окно: CatalogTerm = {
  headword: 'окно',
  sense: 'opening in a wall',
  translation: 'window',
  definition: 'Отверстие в стене со стеклом для света и воздуха.',
  targetExample: 'Открой, пожалуйста, окно — здесь очень душно.',
  nativeExample: "Please open the window — it's very stuffy in here.",
  surface: 'окно',
  grammar: { pos: 'noun', display_form: 'окно́', gender: 'n' },
  zipf: 5.3,
  exercises: {
    cloze: {
      sentence: 'Мальчик разбил мячом окно на первом этаже.',
      answer: 'окно',
      distractors: ['облако', 'молоко', 'озеро'],
    },
    comprehension: {
      sentence: 'Из окна моей комнаты видно реку.',
      term: 'окна',
      prompt: 'How does the speaker see the river?',
      options: ['Through the window of their room', 'From a bridge', 'On television', 'From a boat'],
      answerIndex: 0,
    },
  },
  insight: opaque,
}

// --- general practice vocabulary ------------------------------------------

export const забывать: CatalogTerm = {
  headword: 'забывать',
  sense: 'fail to remember',
  translation: 'to forget',
  definition: 'Не помнить, переставать помнить.',
  targetExample: 'Я всё время забываю ключи дома.',
  nativeExample: 'I keep forgetting my keys at home.',
  surface: 'забываю',
  grammar: { pos: 'verb', display_form: 'забыва́ть', aspect: 'impf', aspect_pair_headword: 'забыть' },
  zipf: 4.8,
  exercises: {
    cloze: {
      sentence: 'Бабушка часто забывает, куда положила очки.',
      answer: 'забывает',
      distractors: ['обещает', 'решает', 'умеет'],
    },
    comprehension: {
      sentence: 'Он постоянно забывает пароль от почты и каждый раз его меняет.',
      term: 'забывает',
      prompt: 'Why does he keep changing his email password?',
      options: ['He keeps forgetting it', 'It gets hacked', 'His boss requires it', 'He likes new passwords'],
      answerIndex: 0,
    },
  },
}

export const внимательный: CatalogTerm = {
  headword: 'внимательный',
  sense: 'paying attention',
  translation: 'attentive, careful',
  definition: 'Сосредоточенный, замечающий детали.',
  targetExample: 'Будь внимательным на дороге.',
  nativeExample: 'Be careful on the road.',
  surface: 'внимательным',
  grammar: { pos: 'adjective', display_form: 'внима́тельный' },
  zipf: 4.4,
  exercises: {
    cloze: {
      sentence: 'Внимательный водитель заранее заметил пешехода.',
      answer: 'Внимательный',
      distractors: ['Ленивый', 'Сонный', 'Рассеянный'],
    },
    comprehension: {
      sentence: 'Учитель похвалил внимательного ученика, который нашёл ошибку.',
      term: 'внимательного',
      prompt: 'Why did the teacher praise the student?',
      options: ['He noticed a mistake', 'He arrived early', 'He sang well', 'He helped clean up'],
      answerIndex: 0,
    },
  },
}

export const дорога: CatalogTerm = {
  headword: 'дорога',
  sense: 'way for travel',
  translation: 'road',
  definition: 'Полоса земли для движения транспорта и людей.',
  targetExample: 'Дорога до деревни заняла три часа.',
  nativeExample: 'The road to the village took three hours.',
  surface: 'Дорога',
  grammar: { pos: 'noun', display_form: 'доро́га', gender: 'f' },
  zipf: 5.4,
  exercises: {
    cloze: {
      sentence: 'Эта дорога ведёт прямо к морю.',
      answer: 'дорога',
      distractors: ['ложка', 'подушка', 'тарелка'],
    },
    comprehension: {
      sentence: 'После дождя дорога стала скользкой, и мы ехали медленно.',
      term: 'дорога',
      prompt: 'Why did they drive slowly?',
      options: ['The road was slippery after the rain', 'They were lost', 'The car was broken', 'They were early'],
      answerIndex: 0,
    },
  },
}

export const погода: CatalogTerm = {
  headword: 'погода',
  sense: 'atmospheric conditions',
  translation: 'weather',
  definition: 'Состояние атмосферы в данное время: температура, дождь, ветер.',
  targetExample: 'Какая сегодня погода?',
  nativeExample: "What's the weather like today?",
  surface: 'погода',
  grammar: { pos: 'noun', display_form: 'пого́да', gender: 'f' },
  zipf: 5.1,
  exercises: {
    cloze: {
      sentence: 'Если погода будет хорошей, мы поедем на пляж.',
      answer: 'погода',
      distractors: ['посуда', 'мебель', 'бумага'],
    },
    comprehension: {
      sentence: 'Из-за плохой погоды рейс задержали на два часа.',
      term: 'погоды',
      prompt: 'Why was the flight delayed?',
      options: ['Because of bad weather', 'A strike', 'A technical fault', 'A late pilot'],
      answerIndex: 0,
    },
  },
}

export const улица: CatalogTerm = {
  headword: 'улица',
  sense: 'road in a town',
  translation: 'street',
  definition: 'Дорога в городе между рядами домов.',
  targetExample: 'Мы живём на тихой улице.',
  nativeExample: 'We live on a quiet street.',
  surface: 'улице',
  grammar: { pos: 'noun', display_form: 'у́лица', gender: 'f' },
  zipf: 5.3,
  exercises: {
    cloze: {
      sentence: 'Мы долго гуляли по ночной улице.',
      answer: 'улице',
      distractors: ['кастрюле', 'подушке', 'тетради'],
    },
    comprehension: {
      sentence: 'Дети играли в футбол прямо на улице перед домом.',
      term: 'улице',
      prompt: 'Where were the children playing football?',
      options: ['Outside in front of the house', 'In a stadium', 'In the school gym', 'In the living room'],
      answerIndex: 0,
    },
  },
}

export const сосед: CatalogTerm = {
  headword: 'сосед',
  sense: 'person living nearby',
  translation: 'neighbour',
  definition: 'Человек, который живёт рядом.',
  targetExample: 'Мой сосед играет на пианино по вечерам.',
  nativeExample: 'My neighbour plays the piano in the evenings.',
  surface: 'сосед',
  grammar: { pos: 'noun', display_form: 'сосе́д', gender: 'm' },
  zipf: 4.9,
  exercises: {
    cloze: {
      sentence: 'Сосед помог нам донести диван до квартиры.',
      answer: 'Сосед',
      distractors: ['Зонтик', 'Камень', 'Стакан'],
    },
    comprehension: {
      sentence: 'Наш сосед часто поливает наши цветы, когда мы в отпуске.',
      term: 'сосед',
      prompt: "Who waters the flowers while they're on holiday?",
      options: ['The person living next door', 'Their grandmother', 'A gardener they hired', 'Nobody'],
      answerIndex: 0,
    },
  },
}

export const пригород: CatalogTerm = {
  headword: 'пригород',
  sense: 'area outside a city',
  translation: 'suburb',
  definition: 'Населённый пункт рядом с большим городом.',
  targetExample: 'Они переехали в тихий пригород Москвы.',
  nativeExample: 'They moved to a quiet suburb of Moscow.',
  surface: 'пригород',
  grammar: { pos: 'noun', display_form: 'при́город', gender: 'm' },
  zipf: 3.9,
  exercises: {
    cloze: {
      sentence: 'Каждый день он ездит на работу из пригорода.',
      answer: 'пригорода',
      distractors: ['холодильника', 'карандаша', 'рюкзака'],
    },
    comprehension: {
      sentence: 'Жить в пригороде дешевле, но дорога в центр занимает час.',
      term: 'пригороде',
      prompt: 'What is the downside of living there?',
      options: ['A long commute to the centre', 'Noisy neighbours', 'No shops nearby', 'High rent'],
      answerIndex: 0,
    },
  },
}

export const мрачный: CatalogTerm = {
  headword: 'мрачный',
  sense: 'dark, cheerless',
  translation: 'gloomy',
  definition: 'Тёмный, невесёлый, вызывающий грусть.',
  targetExample: 'Утро было холодным и мрачным.',
  nativeExample: 'The morning was cold and gloomy.',
  surface: 'мрачным',
  grammar: { pos: 'adjective', display_form: 'мра́чный' },
  zipf: 4.2,
  exercises: {
    cloze: {
      sentence: 'После плохих новостей он весь вечер сидел мрачный и молчал.',
      answer: 'мрачный',
      distractors: ['весёлый', 'счастливый', 'довольный'],
    },
    comprehension: {
      sentence: 'Небо было мрачным, и все ждали грозы.',
      term: 'мрачным',
      prompt: 'What was the sky like?',
      options: ['Dark and threatening', 'Clear and blue', 'Bright and sunny', 'Pink at sunset'],
      answerIndex: 0,
    },
  },
}

export const скучный: CatalogTerm = {
  headword: 'скучный',
  sense: 'not interesting',
  translation: 'boring',
  definition: 'Неинтересный, вызывающий скуку.',
  targetExample: 'Фильм оказался очень скучным.',
  nativeExample: 'The film turned out to be very boring.',
  surface: 'скучным',
  grammar: { pos: 'adjective', display_form: 'ску́чный' },
  zipf: 4.5,
  exercises: {
    cloze: {
      sentence: 'Лекция была такой скучной, что половина студентов уснула.',
      answer: 'скучной',
      distractors: ['интересной', 'увлекательной', 'весёлой'],
    },
    comprehension: {
      sentence: 'Урок был скучным, и дети смотрели в окно.',
      term: 'скучным',
      prompt: 'Why were the children looking out of the window?',
      options: ['The lesson was dull', 'It was snowing', 'A bird was singing', 'They were told to'],
      answerIndex: 0,
    },
  },
}

export const промахнуться: CatalogTerm = {
  headword: 'промахнуться',
  sense: 'fail to hit',
  translation: 'to miss (a target)',
  definition: 'Не попасть в цель.',
  targetExample: 'Он выстрелил, но промахнулся.',
  nativeExample: 'He fired, but missed.',
  surface: 'промахнулся',
  grammar: { pos: 'verb', display_form: 'промахну́ться', aspect: 'pf', is_reflexive: true },
  zipf: 3.6,
  exercises: {
    cloze: {
      sentence: 'Футболист ударил по воротам, но промахнулся.',
      answer: 'промахнулся',
      distractors: ['улыбнулся', 'проснулся', 'вернулся'],
    },
    comprehension: {
      sentence: 'Охотник промахнулся, и заяц убежал в лес.',
      term: 'промахнулся',
      prompt: 'Why did the hare escape?',
      options: ['The hunter missed his shot', 'The dog was asleep', 'It was too dark', 'The hunter let it go'],
      answerIndex: 0,
    },
  },
}

export const подъехать: CatalogTerm = {
  headword: 'подъехать',
  sense: 'drive up to',
  translation: 'to drive up, to pull up',
  definition: 'Приехать близко к чему-либо.',
  targetExample: 'Такси подъехало к дому через пять минут.',
  nativeExample: 'The taxi pulled up at the house five minutes later.',
  surface: 'подъехало',
  grammar: { pos: 'verb', display_form: 'подъе́хать', aspect: 'pf' },
  zipf: 3.9,
  exercises: {
    cloze: {
      sentence: 'Автобус подъехал к остановке точно по расписанию.',
      answer: 'подъехал',
      distractors: ['уснул', 'заплакал', 'засмеялся'],
    },
    comprehension: {
      sentence: 'Машина подъехала к подъезду, и из неё вышла женщина.',
      term: 'подъехала',
      prompt: 'What did the car do?',
      options: ['Pulled up to the entrance', 'Broke down', 'Drove away fast', 'Got washed'],
      answerIndex: 0,
    },
  },
}

export const требовать: CatalogTerm = {
  headword: 'требовать',
  sense: 'ask forcefully',
  translation: 'to demand',
  definition: 'Настойчиво просить, считая это своим правом.',
  targetExample: 'Клиент требует вернуть деньги.',
  nativeExample: 'The customer is demanding a refund.',
  surface: 'требует',
  grammar: { pos: 'verb', display_form: 'тре́бовать', aspect: 'impf' },
  zipf: 4.9,
  exercises: {
    cloze: {
      sentence: 'Начальник требует, чтобы отчёт был готов к пятнице.',
      answer: 'требует',
      distractors: ['спит', 'плавает', 'чихает'],
    },
    comprehension: {
      sentence: 'Покупатель требует замены сломанного телефона.',
      term: 'требует',
      prompt: 'What does the customer want?',
      options: ['A replacement for the broken phone', 'A discount', 'Directions', 'A receipt'],
      answerIndex: 0,
    },
  },
}

export const объяснять: CatalogTerm = {
  headword: 'объяснять',
  sense: 'make clear',
  translation: 'to explain',
  definition: 'Делать понятным, рассказывая.',
  targetExample: 'Учитель объясняет новую тему.',
  nativeExample: 'The teacher is explaining the new topic.',
  surface: 'объясняет',
  grammar: { pos: 'verb', display_form: 'объясня́ть', aspect: 'impf', aspect_pair_headword: 'объяснить' },
  zipf: 4.7,
  exercises: {
    cloze: {
      sentence: 'Мама терпеливо объясняет сыну, как решать задачу.',
      answer: 'объясняет',
      distractors: ['запрещает', 'продаёт', 'ломает'],
    },
    comprehension: {
      sentence: 'Гид объясняет туристам историю старого замка.',
      term: 'объясняет',
      prompt: 'What is the guide doing?',
      options: [
        "Telling the tourists about the castle's history",
        'Selling tickets',
        'Taking photos',
        'Cleaning the castle',
      ],
      answerIndex: 0,
    },
  },
}

export const решение: CatalogTerm = {
  headword: 'решение',
  sense: 'choice made',
  translation: 'decision',
  definition: 'Выбор, сделанный после размышления.',
  targetExample: 'Это было трудное решение.',
  nativeExample: 'It was a difficult decision.',
  surface: 'решение',
  grammar: { pos: 'noun', display_form: 'реше́ние', gender: 'n' },
  zipf: 5.3,
  exercises: {
    cloze: {
      sentence: 'После долгих споров семья приняла решение переехать.',
      answer: 'решение',
      distractors: ['одеяло', 'молоко', 'зеркало'],
    },
    comprehension: {
      sentence: 'Её решение уволиться удивило всех коллег.',
      term: 'решение',
      prompt: 'What surprised her colleagues?',
      options: ['That she chose to quit', 'That she got promoted', 'That she was late', 'That she moved desks'],
      answerIndex: 0,
    },
  },
}

export const удобный: CatalogTerm = {
  headword: 'удобный',
  sense: 'pleasant to use',
  translation: 'comfortable, convenient',
  definition: 'Такой, которым легко и приятно пользоваться.',
  targetExample: 'Это очень удобный диван.',
  nativeExample: 'This is a very comfortable sofa.',
  surface: 'удобный',
  grammar: { pos: 'adjective', display_form: 'удо́бный' },
  zipf: 4.6,
  exercises: {
    cloze: {
      sentence: 'Мы купили удобный диван для гостиной.',
      answer: 'удобный',
      distractors: ['солёный', 'жидкий', 'кислый'],
    },
    comprehension: {
      sentence: 'Этот стул такой удобный, что я сижу на нём весь день.',
      term: 'удобный',
      prompt: 'Why does the speaker sit on the chair all day?',
      options: ['It is comfortable', 'It is new', 'It was a gift', "There's nowhere else to sit"],
      answerIndex: 0,
    },
  },
}

export const медленно: CatalogTerm = {
  headword: 'медленно',
  sense: 'at low speed',
  translation: 'slowly',
  definition: 'С небольшой скоростью, не спеша.',
  targetExample: 'Говорите, пожалуйста, медленно.',
  nativeExample: 'Please speak slowly.',
  surface: 'медленно',
  grammar: { pos: 'adverb', display_form: 'ме́дленно' },
  zipf: 4.8,
  exercises: {
    cloze: {
      sentence: 'Старик медленно поднимался по лестнице.',
      answer: 'медленно',
      distractors: ['вкусно', 'сладко', 'солёно'],
    },
    comprehension: {
      sentence: 'Черепаха медленно ползла по дорожке.',
      term: 'медленно',
      prompt: 'How was the turtle moving?',
      options: ['Slowly', 'Very fast', 'Backwards', 'In circles'],
      answerIndex: 0,
    },
  },
}

export const сравнивать: CatalogTerm = {
  headword: 'сравнивать',
  sense: 'find likeness and difference',
  translation: 'to compare',
  definition: 'Находить сходство и различие.',
  targetExample: 'Не надо сравнивать себя с другими.',
  nativeExample: "Don't compare yourself with others.",
  surface: 'сравнивать',
  grammar: { pos: 'verb', display_form: 'сра́внивать', aspect: 'impf', aspect_pair_headword: 'сравнить' },
  zipf: 4.3,
}

// --- video vocabulary: words spoken, in their dictionary form, in the first
// five minutes of youtube.com/watch?v=UEwZLOt3HvM (ru-video-declaration) ----

export const церковь: CatalogTerm = {
  headword: 'церковь',
  sense: 'religious building',
  translation: 'church',
  definition: 'Здание, где проходят христианские богослужения.',
  targetExample: 'По воскресеньям бабушка ходит в церковь.',
  nativeExample: 'On Sundays grandma goes to church.',
  surface: 'церковь',
  grammar: { pos: 'noun', display_form: 'це́рковь', gender: 'f' },
  zipf: 4.9,
  exercises: {
    cloze: {
      sentence: 'На холме стоит старая церковь.',
      answer: 'церковь',
      distractors: ['площадь', 'кровать', 'тетрадь'],
    },
    comprehension: {
      sentence: 'В деревне построили новую церковь из белого камня.',
      term: 'церковь',
      prompt: 'What was built in the village?',
      options: ['A church', 'A school', 'A bridge', 'A shop'],
      answerIndex: 0,
    },
  },
}

export const ярмарка: CatalogTerm = {
  headword: 'ярмарка',
  sense: 'seasonal market',
  translation: 'fair',
  definition: 'Большой рынок, который устраивают в определённое время.',
  targetExample: 'Осенью в нашем городе проходит ярмарка мёда.',
  nativeExample: 'In autumn our town holds a honey fair.',
  surface: 'ярмарка',
  grammar: { pos: 'noun', display_form: 'я́рмарка', gender: 'f' },
  zipf: 3.9,
  exercises: {
    cloze: {
      sentence: 'На площади открылась книжная ярмарка.',
      answer: 'ярмарка',
      distractors: ['лестница', 'тарелка', 'подушка'],
    },
    comprehension: {
      sentence: 'Каждую субботу у вокзала работает ярмарка, где фермеры продают овощи.',
      term: 'ярмарка',
      prompt: 'What happens near the station every Saturday?',
      options: ['A concert', 'A market where farmers sell vegetables', 'A football match', 'Road repairs'],
      answerIndex: 1,
    },
  },
}

export const буфет: CatalogTerm = {
  headword: 'буфет',
  sense: 'snack counter',
  translation: 'snack bar',
  definition: 'Место, где продают закуски и напитки.',
  targetExample: 'В антракте мы пошли в буфет за чаем.',
  nativeExample: 'During the interval we went to the snack bar for tea.',
  surface: 'буфет',
  grammar: { pos: 'noun', display_form: 'буфе́т', gender: 'm' },
  zipf: 3.8,
  exercises: {
    cloze: {
      sentence: 'В школе на первом этаже есть буфет.',
      answer: 'буфет',
      distractors: ['билет', 'портрет', 'секрет'],
    },
    comprehension: {
      sentence: 'На вокзале был только маленький буфет с бутербродами.',
      term: 'буфет',
      prompt: 'Where could you get a sandwich at the station?',
      options: ['At a large restaurant', 'Nowhere', 'At a small snack bar', 'From a vending machine'],
      answerIndex: 2,
    },
  },
}

export const учить: CatalogTerm = {
  headword: 'учить',
  sense: 'study, learn',
  translation: 'to learn',
  definition: 'Получать знания, запоминать что-либо.',
  targetExample: 'Я начал учить испанский два года назад.',
  nativeExample: 'I started learning Spanish two years ago.',
  surface: 'учить',
  grammar: { pos: 'verb', display_form: 'учи́ть', aspect: 'impf' },
  zipf: 4.9,
}

export const формат: CatalogTerm = {
  headword: 'формат',
  sense: 'form of presentation',
  translation: 'format',
  definition: 'Способ организации или подачи чего-либо.',
  targetExample: 'Нам нравится такой формат урока.',
  nativeExample: 'We like this lesson format.',
  surface: 'формат',
  grammar: { pos: 'noun', display_form: 'форма́т', gender: 'm' },
  zipf: 4.4,
  exercises: {
    cloze: {
      sentence: 'У этой передачи необычный формат.',
      answer: 'формат',
      distractors: ['гранат', 'халат', 'солдат'],
    },
    comprehension: {
      sentence: 'Организаторы изменили формат встречи: теперь она проходит онлайн.',
      term: 'формат',
      prompt: 'What did the organisers change?',
      options: ['The date of the meeting', 'The way the meeting is held', 'The guest list', 'The ticket price'],
      answerIndex: 1,
    },
  },
}

export const завтрак: CatalogTerm = {
  headword: 'завтрак',
  sense: 'morning meal',
  translation: 'breakfast',
  definition: 'Первая еда утром.',
  targetExample: 'На завтрак я обычно ем кашу.',
  nativeExample: 'I usually have porridge for breakfast.',
  surface: 'завтрак',
  grammar: { pos: 'noun', display_form: 'за́втрак', gender: 'm' },
  zipf: 4.6,
  exercises: {
    cloze: {
      sentence: 'В гостинице нас ждал горячий завтрак.',
      answer: 'завтрак',
      distractors: ['чердак', 'рюкзак', 'пиджак'],
    },
    comprehension: {
      sentence: 'Мама приготовила завтрак, пока дети ещё спали.',
      term: 'завтрак',
      prompt: 'What did mum make while the children slept?',
      options: ['Dinner', 'A cake', 'Breakfast', 'Sandwiches for school'],
      answerIndex: 2,
    },
  },
}

export const театр: CatalogTerm = {
  headword: 'театр',
  sense: 'place for plays',
  translation: 'theatre',
  definition: 'Здание, где показывают спектакли.',
  targetExample: 'В субботу мы идём в театр на новый спектакль.',
  nativeExample: "On Saturday we're going to the theatre to see a new play.",
  surface: 'театр',
  grammar: { pos: 'noun', display_form: 'теа́тр', gender: 'm' },
  zipf: 5.0,
  exercises: {
    cloze: {
      sentence: 'В центре города открылся новый театр.',
      answer: 'театр',
      distractors: ['ветер', 'метр', 'литр'],
    },
    comprehension: {
      sentence: 'Этот театр известен своими детскими спектаклями.',
      term: 'театр',
      prompt: 'What is the place known for?',
      options: ['Its plays for children', 'Its paintings', 'Its food', 'Its football team'],
      answerIndex: 0,
    },
  },
}

export const парк: CatalogTerm = {
  headword: 'парк',
  sense: 'public green space',
  translation: 'park',
  definition: 'Большой сад в городе для прогулок и отдыха.',
  targetExample: 'По вечерам мы гуляем в парке у реки.',
  nativeExample: 'In the evenings we walk in the park by the river.',
  surface: 'парке',
  grammar: { pos: 'noun', display_form: 'парк', gender: 'm' },
  zipf: 4.9,
  exercises: {
    cloze: {
      sentence: 'Рядом с нашим домом есть большой парк.',
      answer: 'парк',
      distractors: ['шкаф', 'мост', 'двор'],
    },
    comprehension: {
      sentence: 'Дети весь день катались на велосипедах в парке.',
      term: 'парке',
      prompt: 'Where did the children ride their bikes?',
      options: ['In the park', 'On the motorway', 'In the yard at school', 'At the stadium'],
      answerIndex: 0,
    },
  },
}
