import sharp from 'sharp';
import {mkdir} from 'node:fs/promises';

const width=1280,height=800;
const output='store/showcase';
await mkdir(output,{recursive:true});

const logo=await sharp('public/icons/logo.png').resize(68,68).png().toBuffer();
const slides=[
  {
    file:'01-protection-ru.png',source:'store/screenshots/connected-ru-fixture.png',side:'right',number:'01 / 05',eyebrow:'БЫСТРОЕ ПОДКЛЮЧЕНИЕ',
    title:['Защита браузера','в один клик'],description:['Подключайтесь к VPN и сразу видьте','скорость, время и расход трафика.'],
    pills:[['HTTPS-прокси',174],['RU / EN',126],['3 дня бесплатно',194]],accent:'#2f86ff',soft:'#dcecff'
  },
  {
    file:'02-locations-ru.png',source:'store/screenshots/locations-ru-fixture.png',side:'left',number:'02 / 05',eyebrow:'ЛОКАЦИИ',
    title:['Выбирайте сервер','под свою задачу'],description:['Доступные локации и состояние серверов','всегда находятся прямо в расширении.'],
    pills:[['Германия',142],['Финляндия',154],['Быстрый выбор',178]],accent:'#506ee8',soft:'#e3e8ff'
  },
  {
    file:'03-smart-routing-ru.png',source:'store/screenshots/sites-ru-fixture.png',side:'right',number:'03 / 05',eyebrow:'УМНЫЙ МАРШРУТ',
    title:['Сайты работают','по вашим правилам'],description:['Российские сайты открываются напрямую,','а исключения добавляются за пару секунд.'],
    pills:[['Поддомены',156],['Исключения',158],['Быстрое добавление',220]],accent:'#158bb8',soft:'#d9f1fa'
  },
  {
    file:'04-privacy-ru.png',source:'store/screenshots/settings-ru-fixture.png',side:'left',number:'04 / 05',eyebrow:'КОНТРОЛЬ ПРИВАТНОСТИ',
    title:['Настройки защиты','всегда под рукой'],description:['Защита от утечек WebRTC, удалённый DNS','и автоподключение при запуске браузера.'],
    pills:[['WebRTC',122],['Удалённый DNS',184],['Автозапуск',154]],accent:'#277bcf',soft:'#dcecff'
  },
  {
    file:'05-sign-in-ru.png',source:'store/screenshots/pairing-ru-fixture.png',side:'right',number:'05 / 05',eyebrow:'БЕЗОПАСНЫЙ ВХОД',
    title:['Подтверждение','через личный кабинет'],description:['Пароль остаётся на сайте Levik —','расширение получает только разрешённый доступ.'],
    pills:[['Без пароля в расширении',246],['Автовход',138]],accent:'#6466dd',soft:'#e7e5ff'
  }
];

const esc=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function background(slide){
  const screenshotX=slide.side==='right'?804:76,textX=slide.side==='right'?88:584,brandX=textX;
  const title=slide.title.map((line,index)=>`<tspan x="${textX}" dy="${index?62:0}">${esc(line)}</tspan>`).join('');
  const description=slide.description.map((line,index)=>`<tspan x="${textX}" dy="${index?34:0}">${esc(line)}</tspan>`).join('');
  let pillX=textX;const pills=slide.pills.map(([label,pillWidth])=>{const result=`<rect x="${pillX}" y="557" width="${pillWidth}" height="44" rx="14" fill="${slide.soft}"/><text x="${pillX+pillWidth/2}" y="585" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" font-weight="600" fill="${slide.accent}">${esc(label)}</text>`;pillX+=pillWidth+12;return result;}).join('');
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fbfdff"/><stop offset="1" stop-color="#edf4ff"/></linearGradient>
      <filter id="shadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="22" stdDeviation="24" flood-color="#31527c" flood-opacity=".16"/></filter>
    </defs>
    <rect width="1280" height="800" fill="url(#bg)"/>
    <circle cx="${slide.side==='right'?1190:90}" cy="730" r="390" fill="${slide.soft}" opacity=".72"/>
    <circle cx="${slide.side==='right'?1120:160}" cy="84" r="150" fill="#ffffff" opacity=".72"/>
    <g opacity=".42" fill="${slide.accent}"><circle cx="${slide.side==='right'?715:565}" cy="108" r="4"/><circle cx="${slide.side==='right'?741:539}" cy="108" r="4"/><circle cx="${slide.side==='right'?767:513}" cy="108" r="4"/></g>
    <text x="${textX}" y="82" font-family="Arial, sans-serif" font-size="15" font-weight="700" letter-spacing="2" fill="${slide.accent}">${slide.number}</text>
    <text x="${brandX+82}" y="143" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#101a33">Levik VPN</text>
    <text x="${textX}" y="220" font-family="Arial, sans-serif" font-size="17" font-weight="700" letter-spacing="1.6" fill="${slide.accent}">${esc(slide.eyebrow)}</text>
    <text x="${textX}" y="302" font-family="Arial, sans-serif" font-size="49" font-weight="500" letter-spacing="-1.2" fill="#14213d">${title}</text>
    <text x="${textX}" y="464" font-family="Arial, sans-serif" font-size="22" fill="#73829d">${description}</text>
    ${pills}
    <text x="${textX}" y="692" font-family="Arial, sans-serif" font-size="16" fill="#8b99b0">Расширение для Chrome · Русский и английский</text>
    <rect x="${screenshotX-12}" y="88" width="404" height="624" rx="28" fill="#ffffff" filter="url(#shadow)"/>
    <rect x="${screenshotX-6}" y="94" width="392" height="612" rx="23" fill="#dbe6f5" opacity=".7"/>
  </svg>`);
}

for(const slide of slides){
  const screenshotX=slide.side==='right'?804:76,textX=slide.side==='right'?88:584;
  const screenshot=await sharp(slide.source).resize(380,600).png().toBuffer();
  await sharp(background(slide)).composite([{input:screenshot,left:screenshotX,top:100},{input:logo,left:textX,top:94}]).flatten({background:'#f5f8fe'}).removeAlpha().png({compressionLevel:9}).toFile(`${output}/${slide.file}`);
}

console.log(`Created ${slides.length} showcase screenshots in ${output}/`);
