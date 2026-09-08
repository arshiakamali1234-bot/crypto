/* =========================================================
   تحلیل‌گر تکنیکال هوشمند
   - نمودار زنده از TradingView (ویجت رسمی embeddable)
   - دادهٔ خام OHLC زنده از Binance (رایگان، بدون کلید) برای موتور تحلیل
   - موتور تحلیل تکنیکال قانون‌محور (بدون حدس؛ فقط ریاضیات واقعی)
   - لایهٔ اختیاری AI برای بازنویسی روایت، دقیقاً بر اساس اعداد محاسبه‌شده
   ========================================================= */

const els = {
  symbol: document.getElementById('symbolInput'),
  interval: document.getElementById('intervalSelect'),
  loadBtn: document.getElementById('loadBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  settingsPanel: document.getElementById('settingsPanel'),
  saveSettings: document.getElementById('saveSettings'),
  aiProvider: document.getElementById('aiProvider'),
  apiKey: document.getElementById('apiKey'),
  verdictBox: document.getElementById('verdictBox'),
};

const INTERVAL_MAP_TV = { '1m':'1','5m':'5','15m':'15','30m':'30','1h':'60','4h':'240','1d':'D','1w':'W' };

// ---------- تنظیمات محلی ----------
function loadSettings(){
  const s = JSON.parse(localStorage.getItem('ta_settings') || '{}');
  els.aiProvider.value = s.provider || 'none';
  els.apiKey.value = s.apiKey || '';
}
function saveSettings(){
  localStorage.setItem('ta_settings', JSON.stringify({
    provider: els.aiProvider.value,
    apiKey: els.apiKey.value
  }));
  els.settingsPanel.style.display = 'none';
}
els.settingsBtn.onclick = () => {
  els.settingsPanel.style.display = els.settingsPanel.style.display === 'none' ? 'block' : 'none';
};
els.saveSettings.onclick = saveSettings;
loadSettings();

// ---------- ویجت TradingView ----------
let tvWidget = null;
function renderTVWidget(symbol, interval){
  document.getElementById('chart_container').innerHTML = '';
  tvWidget = new TradingView.widget({
    autosize: true,
    symbol: 'BINANCE:' + symbol,
    interval: INTERVAL_MAP_TV[interval] || '60',
    timezone: 'Etc/UTC',
    theme: 'dark',
    style: '1',
    locale: 'fa_IR',
    toolbar_bg: '#161b22',
    enable_publishing: false,
    withdateranges: true,
    allow_symbol_change: true,
    container_id: 'chart_container'
  });
}

// ---------- دریافت داده خام از Binance ----------
async function fetchKlines(symbol, interval, limit=300){
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if(!res.ok) throw new Error('عدم دسترسی به داده بازار برای این نماد/تایم‌فریم');
  const raw = await res.json();
  return raw.map(k => ({
    time:k[0], open:+k[1], high:+k[2], low:+k[3], close:+k[4], volume:+k[5]
  }));
}

// ---------- ابزارهای ریاضی ----------
function sma(arr, len){ return arr.slice(-len).reduce((a,b)=>a+b,0)/len; }
function emaSeries(values, len){
  const k = 2/(len+1); let emaArr=[values[0]];
  for(let i=1;i<values.length;i++) emaArr.push(values[i]*k + emaArr[i-1]*(1-k));
  return emaArr;
}
function rsi(closes, len=14){
  let gains=0, losses=0;
  for(let i=closes.length-len; i<closes.length; i++){
    const diff = closes[i]-closes[i-1];
    if(diff>=0) gains+=diff; else losses-=diff;
  }
  const avgG=gains/len, avgL=losses/len;
  if(avgL===0) return 100;
  const rs=avgG/avgL;
  return 100 - (100/(1+rs));
}
function macd(closes){
  const ema12 = emaSeries(closes,12);
  const ema26 = emaSeries(closes,26);
  const macdLine = ema12.map((v,i)=>v-ema26[i]);
  const signal = emaSeries(macdLine,9);
  const hist = macdLine.map((v,i)=>v-signal[i]);
  return { macd: macdLine.at(-1), signal: signal.at(-1), hist: hist.at(-1), prevHist: hist.at(-2) };
}
function atr(candles, len=14){
  let trs=[];
  for(let i=1;i<candles.length;i++){
    const c=candles[i], p=candles[i-1];
    trs.push(Math.max(c.high-c.low, Math.abs(c.high-p.close), Math.abs(c.low-p.close)));
  }
  return sma(trs.slice(-len), len);
}

// ---------- شناسایی نقاط سوینگ برای حمایت/مقاومت استاتیک ----------
function findSwingPoints(candles, lookback=3){
  const highs=[], lows=[];
  for(let i=lookback;i<candles.length-lookback;i++){
    const win = candles.slice(i-lookback, i+lookback+1);
    const cur = candles[i];
    if(cur.high === Math.max(...win.map(c=>c.high))) highs.push(cur.high);
    if(cur.low === Math.min(...win.map(c=>c.low))) lows.push(cur.low);
  }
  return { highs, lows };
}
function clusterLevels(levels, tolerancePct=0.15){
  const sorted=[...levels].sort((a,b)=>a-b);
  const clusters=[];
  sorted.forEach(lv=>{
    const last=clusters.at(-1);
    if(last && Math.abs(lv-last.avg)/last.avg*100 < tolerancePct){
      last.vals.push(lv); last.avg = last.vals.reduce((a,b)=>a+b,0)/last.vals.length;
    } else clusters.push({vals:[lv], avg:lv});
  });
  return clusters.map(c=>({price:c.avg, strength:c.vals.length})).sort((a,b)=>b.strength-a.strength);
}

// ---------- تشخیص پترن‌های پرایس اکشن ----------
function detectPatterns(candles){
  const patterns=[];
  const n = candles.length;
  const c0 = candles[n-1], c1 = candles[n-2];
  const body = c => Math.abs(c.close-c.open);
  const range = c => c.high-c.low;
  const upperWick = c => c.high - Math.max(c.open,c.close);
  const lowerWick = c => Math.min(c.open,c.close) - c.low;

  // انگالفینگ
  if(c1 && body(c0) > body(c1)*1.05){
    if(c1.close < c1.open && c0.close > c0.open && c0.close >= c1.open && c0.open <= c1.close)
      patterns.push({name:'انگالفینگ صعودی (Bullish Engulfing)', dir:'up'});
    if(c1.close > c1.open && c0.close < c0.open && c0.open >= c1.close && c0.close <= c1.open)
      patterns.push({name:'انگالفینگ نزولی (Bearish Engulfing)', dir:'down'});
  }
  // پین‌بار / هامر / شوتینگ استار
  if(range(c0) > 0){
    if(lowerWick(c0) > body(c0)*2 && upperWick(c0) < body(c0))
      patterns.push({name:'هامر / پین‌بار صعودی', dir:'up'});
    if(upperWick(c0) > body(c0)*2 && lowerWick(c0) < body(c0))
      patterns.push({name:'شوتینگ‌استار / پین‌بار نزولی', dir:'down'});
  }
  // دوجی
  if(body(c0) < range(c0)*0.1 && range(c0) > 0)
    patterns.push({name:'دوجی (بلاتکلیفی بازار)', dir:'neutral'});

  return patterns;
}

// ---------- امتیازدهی و نتیجه‌گیری نهایی ----------
function analyze(candles){
  if(candles.length < 60){
    return { insufficient:true };
  }
  const closes = candles.map(c=>c.close);
  const volumes = candles.map(c=>c.volume);
  const lastClose = closes.at(-1);

  const ema20 = emaSeries(closes,20).at(-1);
  const ema50 = emaSeries(closes,50).at(-1);
  const ema200 = closes.length>=200 ? emaSeries(closes,200).at(-1) : null;
  const rsiVal = rsi(closes,14);
  const macdVal = macd(closes);
  const atrVal = atr(candles,14);

  const { highs, lows } = findSwingPoints(candles, 3);
  const resistances = clusterLevels(highs.filter(h=>h>lastClose)).slice(0,3);
  const supports = clusterLevels(lows.filter(l=>l<lastClose)).slice(0,3);

  const patterns = detectPatterns(candles);

  const volAvg = sma(volumes, 20);
  const volLast = volumes.at(-1);
  const volRising = volLast > volAvg * 1.15;

  // --- امتیازدهی confluence (هر بخش -2 تا +2) ---
  let score = 0;
  const notes = [];

  // روند
  let trendScore = 0;
  if(ema200){
    if(lastClose > ema20 && ema20 > ema50 && ema50 > ema200){ trendScore=2; notes.push('روند صعودی قوی: قیمت بالای EMA20 > EMA50 > EMA200'); }
    else if(lastClose < ema20 && ema20 < ema50 && ema50 < ema200){ trendScore=-2; notes.push('روند نزولی قوی: قیمت زیر EMA20 < EMA50 < EMA200'); }
    else if(lastClose > ema50){ trendScore=1; notes.push('روند میان‌مدت مثبت (بالای EMA50)'); }
    else { trendScore=-1; notes.push('روند میان‌مدت منفی (زیر EMA50)'); }
  } else {
    trendScore = lastClose > ema50 ? 1 : -1;
    notes.push('داده کافی برای EMA200 وجود ندارد؛ فقط روند کوتاه/میان‌مدت بررسی شد.');
  }
  score += trendScore;

  // مومنتوم
  let momScore = 0;
  if(rsiVal > 70){ momScore -= 1; notes.push(`RSI=${rsiVal.toFixed(1)} در ناحیه اشباع خرید`); }
  else if(rsiVal < 30){ momScore += 1; notes.push(`RSI=${rsiVal.toFixed(1)} در ناحیه اشباع فروش`); }
  else notes.push(`RSI=${rsiVal.toFixed(1)} خنثی`);
  if(macdVal.hist > 0 && macdVal.hist > macdVal.prevHist){ momScore += 1; notes.push('هیستوگرام MACD مثبت و در حال افزایش (مومنتوم صعودی)'); }
  else if(macdVal.hist < 0 && macdVal.hist < macdVal.prevHist){ momScore -= 1; notes.push('هیستوگرام MACD منفی و در حال افزایش فشار فروش'); }
  score += momScore;

  // پرایس اکشن
  let paScore = 0;
  patterns.forEach(p=>{ if(p.dir==='up') paScore+=1; if(p.dir==='down') paScore-=1; });
  score += paScore;

  // حجم
  let volScore = 0;
  if(volRising){
    volScore = (closes.at(-1) > closes.at(-2)) ? 1 : -1;
    notes.push('حجم معاملات بالاتر از میانگین ۲۰ کندل اخیر (تأیید حرکت)');
  } else notes.push('حجم معاملات عادی/پایین (بدون تأیید قوی)');
  score += volScore;

  // موقعیت نسبت به S/R
  let srScore = 0;
  const nearestRes = resistances[0]?.price;
  const nearestSup = supports.at(-1)?.price;
  if(nearestRes && (nearestRes-lastClose)/lastClose*100 < 0.5){ srScore -= 1; notes.push('قیمت نزدیک به مقاومت مهم — احتمال واکنش نزولی'); }
  if(nearestSup && (lastClose-nearestSup)/lastClose*100 < 0.5){ srScore += 1; notes.push('قیمت نزدیک به حمایت مهم — احتمال واکنش صعودی'); }
  score += srScore;

  // --- تصمیم نهایی ---
  let verdict, verdictClass;
  const dataQualityOK = candles.length >= 100 && volAvg > 0;
  if(!dataQualityOK){
    verdict = 'داده کافی/باکیفیت نیست — بدون سیگنال'; verdictClass='v-none';
  } else if(score >= 4){
    verdict = 'BUY (خرید) — همگرایی قوی سیگنال‌های صعودی'; verdictClass='v-buy';
  } else if(score <= -4){
    verdict = 'SELL (فروش) — همگرایی قوی سیگنال‌های نزولی'; verdictClass='v-sell';
  } else if(score >= 2){
    verdict = 'تمایل به BUY، اما با احتیاط — سیگنال‌ها هم‌جهت اما ضعیف'; verdictClass='v-hold';
  } else if(score <= -2){
    verdict = 'تمایل به SELL، اما با احتیاط — سیگنال‌ها هم‌جهت اما ضعیف'; verdictClass='v-hold';
  } else {
    verdict = 'HOLD — عدم قطعیت / سیگنال‌های متضاد، وارد پوزیشن نشوید'; verdictClass='v-hold';
  }

  return {
    lastClose, ema20, ema50, ema200, rsiVal, macdVal, atrVal,
    resistances, supports, patterns, notes, score, verdict, verdictClass,
    trendScore, momScore, paScore, volScore, srScore
  };
}

function label(scoreVal){
  if(scoreVal>0) return `<span class="tag tag-up">مثبت (+${scoreVal})</span>`;
  if(scoreVal<0) return `<span class="tag tag-down">منفی (${scoreVal})</span>`;
  return `<span class="tag tag-neu">خنثی (0)</span>`;
}

function renderResult(res, symbol, interval){
  if(res.insufficient){
    els.verdictBox.className = 'verdict v-none';
    els.verdictBox.textContent = 'داده کافی برای تحلیل معتبر وجود ندارد (حداقل ۶۰ کندل لازم است). به‌جای حدس زدن، تحلیلی ارائه نمی‌شود.';
    ['scoreCard','srCard','indCard','paCard','reasonCard'].forEach(id=>document.getElementById(id).style.display='none');
    return;
  }

  els.verdictBox.className = 'verdict ' + res.verdictClass;
  els.verdictBox.textContent = res.verdict + `  (امتیاز: ${res.score})`;

  document.getElementById('scoreCard').style.display='block';
  document.getElementById('s_trend').innerHTML = label(res.trendScore);
  document.getElementById('s_mom').innerHTML = label(res.momScore);
  document.getElementById('s_pa').innerHTML = label(res.paScore);
  document.getElementById('s_vol').innerHTML = label(res.volScore);
  document.getElementById('s_sr').innerHTML = label(res.srScore);

  document.getElementById('srCard').style.display='block';
  document.getElementById('staticSR').innerHTML =
    (res.resistances.length? '<b>مقاومت‌ها:</b><br>'+res.resistances.map(r=>`<span>🔴 ${r.price.toFixed(4)} <span class="badge" style="background:rgba(239,83,80,.2);color:var(--red)">قدرت ${r.strength}</span></span>`).join('') : '<span class="muted">مقاومتی شناسایی نشد</span>')
    + (res.supports.length? '<br><b>حمایت‌ها:</b><br>'+res.supports.map(s=>`<span>🟢 ${s.price.toFixed(4)} <span class="badge" style="background:rgba(38,166,154,.2);color:var(--green)">قدرت ${s.strength}</span></span>`).join('') : '<br><span class="muted">حمایتی شناسایی نشد</span>');
  document.getElementById('dynamicSR').innerHTML =
    `<span>EMA20: ${res.ema20.toFixed(4)}</span><span>EMA50: ${res.ema50.toFixed(4)}</span>` +
    (res.ema200 ? `<span>EMA200: ${res.ema200.toFixed(4)}</span>` : '<span class="muted">EMA200 نیاز به داده بیشتر دارد</span>');

  document.getElementById('indCard').style.display='block';
  document.getElementById('ind_rsi').textContent = res.rsiVal.toFixed(1);
  document.getElementById('ind_macd').textContent = `${res.macdVal.macd.toFixed(4)} / سیگنال ${res.macdVal.signal.toFixed(4)} / هیست ${res.macdVal.hist.toFixed(4)}`;
  document.getElementById('ind_ema').textContent = `${res.ema20.toFixed(4)} / ${res.ema50.toFixed(4)} / ${res.ema200? res.ema200.toFixed(4):'—'}`;
  document.getElementById('ind_atr').textContent = res.atrVal.toFixed(4);

  document.getElementById('paCard').style.display='block';
  document.getElementById('paPatterns').innerHTML = res.patterns.length
    ? res.patterns.map(p=>`<span class="tag ${p.dir==='up'?'tag-up':p.dir==='down'?'tag-down':'tag-neu'}">${p.name}</span>`).join(' ')
    : '<span class="muted">پترن قابل‌اتکایی در کندل‌های اخیر شناسایی نشد</span>';

  document.getElementById('reasonCard').style.display='block';
  document.getElementById('reasonText').innerHTML = '<ul>' + res.notes.map(n=>`<li>${n}</li>`).join('') + '</ul>';

  maybeCallAI(res, symbol, interval);
}

// ---------- لایه اختیاری AI (فقط بازنویسی روایت بر اساس داده واقعی) ----------
async function maybeCallAI(res, symbol, interval){
  const settings = JSON.parse(localStorage.getItem('ta_settings') || '{}');
  const aiCard = document.getElementById('aiCard');
  if(!settings.provider || settings.provider === 'none' || !settings.apiKey){
    aiCard.style.display = 'none';
    return;
  }
  aiCard.style.display = 'block';
  const aiText = document.getElementById('aiText');
  aiText.textContent = 'در حال دریافت روایت از هوش مصنوعی...';

  const dataSummary = {
    symbol, interval,
    lastClose: res.lastClose, ema20: res.ema20, ema50: res.ema50, ema200: res.ema200,
    rsi: res.rsiVal, macd: res.macdVal, atr: res.atrVal,
    resistances: res.resistances, supports: res.supports,
    patterns: res.patterns.map(p=>p.name), score: res.score, verdict: res.verdict
  };

  const prompt = `تو یک تحلیل‌گر تکنیکال حرفه‌ای در سبک تریدرهای برتر جهان (مثل روش‌های ترکیبی پرایس‌اکشن + Wyckoff + مدیریت ریسک) هستی. فقط و فقط بر اساس داده‌های JSON زیر (که از محاسبات واقعی روی نمودار ${symbol} تایم‌فریم ${interval} به‌دست آمده) یک تحلیل کوتاه، حرفه‌ای و روان به زبان فارسی بنویس. هیچ عدد یا فکت جدیدی که در داده نیست اضافه نکن و حدس نزن. اگر داده برای یک نتیجه‌گیری قطعی کافی نیست، صراحتاً همین را بگو.\n\nDATA:\n${JSON.stringify(dataSummary)}`;

  try{
    let text = '';
    if(settings.provider === 'anthropic'){
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'x-api-key': settings.apiKey,
          'anthropic-version':'2023-06-01',
          'anthropic-dangerous-direct-browser-access':'true'
        },
        body: JSON.stringify({
          model:'claude-sonnet-4-6',
          max_tokens: 700,
          messages:[{role:'user', content: prompt}]
        })
      });
      const d = await r.json();
      text = d?.content?.[0]?.text || JSON.stringify(d);
    } else if(settings.provider === 'openai'){
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+settings.apiKey },
        body: JSON.stringify({
          model:'gpt-4o-mini',
          messages:[{role:'user', content: prompt}]
        })
      });
      const d = await r.json();
      text = d?.choices?.[0]?.message?.content || JSON.stringify(d);
    }
    aiText.innerHTML = text.replace(/\n/g,'<br>');
  }catch(e){
    aiText.textContent = 'خطا در دریافت پاسخ از AI: ' + e.message;
  }
}

// ---------- اجرای اصلی ----------
async function run(){
  const symbol = els.symbol.value.trim().toUpperCase();
  const interval = els.interval.value;
  els.verdictBox.className = 'verdict v-none';
  els.verdictBox.textContent = 'در حال دریافت داده زنده...';

  renderTVWidget(symbol, interval);

  try{
    const candles = await fetchKlines(symbol, interval, 300);
    const res = analyze(candles);
    renderResult(res, symbol, interval);
  }catch(e){
    els.verdictBox.className='verdict v-none';
    els.verdictBox.textContent = 'خطا: ' + e.message + ' — نماد را طبق فرمت Binance وارد کن (مثل BTCUSDT, ETHUSDT).';
  }
}
els.loadBtn.onclick = run;

// نمادهای پیشنهادی
fetch('https://api.binance.com/api/v3/exchangeInfo').then(r=>r.json()).then(d=>{
  const list = document.getElementById('symbolList');
  d.symbols.filter(s=>s.quoteAsset==='USDT' && s.status==='TRADING').slice(0,150).forEach(s=>{
    const opt = document.createElement('option'); opt.value = s.symbol; list.appendChild(opt);
  });
}).catch(()=>{});

// بار اول
run();
