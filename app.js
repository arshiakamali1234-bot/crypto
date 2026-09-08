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
// تایم‌فریم بالاتر برای تأیید چندتایم‌فریمی (Multi-Timeframe Confirmation)
const HTF_MAP = { '1m':'15m','5m':'1h','15m':'4h','30m':'4h','1h':'4h','4h':'1d','1d':'1w','1w':'1M' };

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
let chartReadyPromise = null;
function renderTVWidget(symbol, interval){
  document.getElementById('chart_container').innerHTML = '';
  let resolveReady;
  chartReadyPromise = new Promise(r => resolveReady = r);
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
    container_id: 'chart_container',
    // اندیکاتورهای هم‌راستا با موتور تحلیل، مستقیم روی نمودار زنده
    studies: [
      { id: 'MAExp@tv-basicstudies', inputs: { length: 20 } },
      { id: 'MAExp@tv-basicstudies', inputs: { length: 50 } },
      { id: 'MAExp@tv-basicstudies', inputs: { length: 200 } },
      { id: 'RSI@tv-basicstudies', inputs: { length: 14 } },
      { id: 'MACD@tv-basicstudies' },
      { id: 'BB@tv-basicstudies', inputs: { length: 20 } },
      { id: 'VWAP@tv-basicstudies' }
    ],
    studies_overrides: {}
  });
  try{
    tvWidget.onChartReady(() => resolveReady());
  }catch(e){ resolveReady(); }
}

// ---------- رسم تحلیل روی نمودار زنده (خطوط حمایت/مقاومت، فیبوناچی، ورود/حدضرر/حدسود) ----------
async function drawAnalysisOnChart(res){
  if(!tvWidget || !chartReadyPromise || res.insufficient) return;
  try{
    await chartReadyPromise;
    const chart = tvWidget.activeChart();
    // پاک‌کردن رسم‌های قبلی این سایت (اگر نمودار عوض شده باشد)
    try{ chart.removeAllShapes(); }catch(e){}

    const addHLine = (price, text, color, style='solid', width=1) => {
      try{
        chart.createShape({ time: Math.floor(Date.now()/1000), price }, {
          shape: 'horizontal_line',
          lock: true, disableSelection: true, disableSave: true,
          overrides: {
            linecolor: color, linewidth: width,
            linestyle: style==='dashed' ? 2 : 0,
            showLabel: true, textcolor: color, fontsize: 11,
            horzLabelsAlign: 'right', text
          }
        });
      }catch(e){}
    };

    // حمایت‌ها و مقاومت‌های استاتیک
    res.resistances.forEach(r => addHLine(r.price, `مقاومت (قدرت ${r.strength})`, '#ef5350', 'dashed'));
    res.supports.forEach(s => addHLine(s.price, `حمایت (قدرت ${s.strength})`, '#26a69a', 'dashed'));

    // سطوح فیبوناچی روی آخرین لگ سوینگ
    if(res.fib){
      Object.entries(res.fib.levels).forEach(([k,v]) => {
        addHLine(v, `Fib ${k}`, '#ffb800', 'dotted', 1);
      });
    }

    // نقطه ورود / حد ضرر / حد سود (فقط وقتی سیگنال قاطع است)
    if(res.risk){
      addHLine(res.risk.entry, '🎯 ورود', '#4a90e2', 'solid', 2);
      addHLine(res.risk.stopLoss, '🛑 حد ضرر', '#ef5350', 'solid', 2);
      addHLine(res.risk.takeProfit1, '✅ حد سود ۱', '#26a69a', 'solid', 2);
      addHLine(res.risk.takeProfit2, '✅ حد سود ۲', '#26a69a', 'solid', 1);
    }

    // بلاک سفارش (Order Block) در صورت شناسایی
    if(res.orderBlock){
      addHLine(res.orderBlock.high, `سقف Order Block (${res.orderBlock.dir==='bull'?'صعودی':'نزولی'})`, '#a78bfa', 'dashed');
      addHLine(res.orderBlock.low, `کف Order Block`, '#a78bfa', 'dashed');
    }
  }catch(e){
    console.warn('امکان رسم روی نمودار فراهم نشد:', e);
  }
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

// ---------- خلاصهٔ سریع روند برای هر تایم‌فریم (برای تحلیل چندتایم‌فریمی واقعی برای AI) ----------
function quickTrendSnapshot(candles){
  if(!candles || candles.length < 30) return { available:false };
  const closes = candles.map(c=>c.close);
  const ema20 = emaSeries(closes,20).at(-1);
  const ema50 = emaSeries(closes, Math.min(50, closes.length-1)).at(-1);
  const last = closes.at(-1);
  const rsiVal = closes.length>=15 ? rsi(closes,14) : null;
  const structure = marketStructure(candles);
  let trend = 'رنج/نامشخص';
  if(last > ema20 && ema20 > ema50) trend = 'صعودی';
  else if(last < ema20 && ema20 < ema50) trend = 'نزولی';
  return { available:true, trend, lastClose:last, ema20, ema50, rsi: rsiVal, structure: structure?.structure, bos: structure?.bos };
}

// تایم‌فریم‌های استاندارد برای تحلیل بالا-به-پایین (Top-Down) — ترتیب اهمیت: 1D → 4H → 1H → 15M → 5M
const MTF_STACK = ['1d','4h','1h','15m','5m'];
async function buildMultiTimeframeSnapshot(symbol){
  const snapshot = {};
  for(const tf of MTF_STACK){
    try{
      const candles = await fetchKlines(symbol, tf, 150);
      snapshot[tf] = quickTrendSnapshot(candles);
    }catch(e){
      snapshot[tf] = { available:false };
    }
  }
  return snapshot;
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
function stddev(arr, len){
  const slice = arr.slice(-len);
  const mean = slice.reduce((a,b)=>a+b,0)/len;
  return Math.sqrt(slice.reduce((a,b)=>a+(b-mean)**2,0)/len);
}
function bollinger(closes, len=20, mult=2){
  const mid = sma(closes, len);
  const sd = stddev(closes, len);
  return { mid, upper: mid+mult*sd, lower: mid-mult*sd, width: (mult*sd*2)/mid*100 };
}
function stochastic(candles, len=14, smoothK=3){
  const recent = candles.slice(-len);
  const highest = Math.max(...recent.map(c=>c.high));
  const lowest = Math.min(...recent.map(c=>c.low));
  const close = candles.at(-1).close;
  const kRaw = highest===lowest ? 50 : (close-lowest)/(highest-lowest)*100;
  // میانگین ساده روی چند مقدار K اخیر برای D
  const kVals=[];
  for(let i=candles.length-smoothK;i<candles.length;i++){
    const win = candles.slice(Math.max(0,i-len+1), i+1);
    const h=Math.max(...win.map(c=>c.high)), l=Math.min(...win.map(c=>c.low));
    kVals.push(h===l?50:(candles[i].close-l)/(h-l)*100);
  }
  return { k: kRaw, d: sma(kVals, kVals.length) };
}
// ADX ساده برای سنجش قدرت روند (نه جهت)
function adx(candles, len=14){
  let plusDM=[], minusDM=[], tr=[];
  for(let i=1;i<candles.length;i++){
    const up = candles[i].high - candles[i-1].high;
    const down = candles[i-1].low - candles[i].low;
    plusDM.push(up>down && up>0 ? up : 0);
    minusDM.push(down>up && down>0 ? down : 0);
    tr.push(Math.max(candles[i].high-candles[i].low, Math.abs(candles[i].high-candles[i-1].close), Math.abs(candles[i].low-candles[i-1].close)));
  }
  const atrN = sma(tr.slice(-len), len);
  const plusDI = 100 * sma(plusDM.slice(-len), len) / (atrN||1);
  const minusDI = 100 * sma(minusDM.slice(-len), len) / (atrN||1);
  const dx = 100 * Math.abs(plusDI-minusDI) / ((plusDI+minusDI)||1);
  return { adx: dx, plusDI, minusDI };
}
// واگرایی ساده RSI بین دو سوینگ اخیر قیمت
function detectRSIDivergence(candles, closes){
  const { lows, highs } = findSwingPoints(candles, 3);
  // اینجا فقط دو نقطهٔ کف/سقف آخر قیمت را با RSI متناظرشان مقایسه می‌کنیم (تقریبی ولی مبتنی بر داده واقعی)
  const n = closes.length;
  if(n < 30) return null;
  const lastLowIdx = candles.map((c,i)=>({i,l:c.low})).filter(x=>lows.includes(x.l)).at(-1);
  const prevLowIdx = candles.map((c,i)=>({i,l:c.low})).filter(x=>lows.includes(x.l)).at(-2);
  const lastHighIdx = candles.map((c,i)=>({i,h:c.high})).filter(x=>highs.includes(x.h)).at(-1);
  const prevHighIdx = candles.map((c,i)=>({i,h:c.high})).filter(x=>highs.includes(x.h)).at(-2);

  const rsiAt = (idx) => {
    const seg = closes.slice(0, idx+1);
    return seg.length>=15 ? rsi(seg,14) : null;
  };

  let bullishDiv=false, bearishDiv=false;
  if(lastLowIdx && prevLowIdx && lastLowIdx.l < prevLowIdx.l){
    const r1 = rsiAt(prevLowIdx.i), r2 = rsiAt(lastLowIdx.i);
    if(r1!=null && r2!=null && r2 > r1) bullishDiv = true; // کف پایین‌تر قیمت + کف بالاتر RSI
  }
  if(lastHighIdx && prevHighIdx && lastHighIdx.h > prevHighIdx.h){
    const r1 = rsiAt(prevHighIdx.i), r2 = rsiAt(lastHighIdx.i);
    if(r1!=null && r2!=null && r2 < r1) bearishDiv = true; // سقف بالاتر قیمت + سقف پایین‌تر RSI
  }
  return { bullishDiv, bearishDiv };
}

// ---------- فیبوناچی روی آخرین لگ سوینگ قابل توجه ----------
function fibonacci(candles, lookback=80){
  const win = candles.slice(-lookback);
  let hiIdx=0, loIdx=0;
  win.forEach((c,i)=>{ if(c.high>win[hiIdx].high) hiIdx=i; if(c.low<win[loIdx].low) loIdx=i; });
  const hi = win[hiIdx].high, lo = win[loIdx].low;
  const impulseUp = hiIdx > loIdx; // آخرین حرکت مهم صعودی بوده یا نزولی
  const diff = hi - lo;
  const ratios = [0.236,0.382,0.5,0.618,0.786];
  const levels = {};
  ratios.forEach(r=>{
    levels[r] = impulseUp ? hi - diff*r : lo + diff*r;
  });
  return { high:hi, low:lo, impulseUp, levels };
}

// ---------- VWAP (میانگین وزنی حجمی) روی بازهٔ دادهٔ دریافتی ----------
function vwap(candles){
  let cumPV=0, cumV=0;
  const series = candles.map(c=>{
    const typical = (c.high+c.low+c.close)/3;
    cumPV += typical*c.volume; cumV += c.volume;
    return cumV>0 ? cumPV/cumV : typical;
  });
  return series.at(-1);
}

// ---------- ساختار بازار: Break of Structure / Change of Character (سبک Smart Money) ----------
function marketStructure(candles){
  const { highs, lows } = findSwingPoints(candles, 3);
  if(highs.length<2 || lows.length<2) return null;
  const lastTwoHighs = highs.slice(-2);
  const lastTwoLows = lows.slice(-2);
  const higherHighs = lastTwoHighs[1] > lastTwoHighs[0];
  const higherLows = lastTwoLows[1] > lastTwoLows[0];
  let structure = 'رنج/نامشخص';
  if(higherHighs && higherLows) structure = 'صعودی (HH+HL)';
  else if(!higherHighs && !higherLows) structure = 'نزولی (LH+LL)';

  const lastClose = candles.at(-1).close;
  const prevSwingHigh = lastTwoHighs.at(-1);
  const prevSwingLow = lastTwoLows.at(-1);
  let bos = null; // Break of Structure
  if(structure.startsWith('نزولی') && lastClose > prevSwingHigh) bos = 'CHoCH صعودی — تغییر احتمالی روند از نزولی به صعودی';
  else if(structure.startsWith('صعودی') && lastClose < prevSwingLow) bos = 'CHoCH نزولی — تغییر احتمالی روند از صعودی به نزولی';
  else if(structure.startsWith('صعودی') && lastClose > prevSwingHigh) bos = 'BOS صعودی — ادامه روند صعودی تأیید شد';
  else if(structure.startsWith('نزولی') && lastClose < prevSwingLow) bos = 'BOS نزولی — ادامه روند نزولی تأیید شد';

  return { structure, bos };
}

// ---------- شناسایی سادهٔ Order Block (آخرین کندل مخالف قبل از حرکت ایمپالسیو) ----------
function findOrderBlock(candles, atrVal){
  const n = candles.length;
  for(let i=n-2; i>n-25 && i>2; i--){
    const c = candles[i], next = candles[i+1];
    const impulse = Math.abs(next.close-next.open) > atrVal*1.2;
    if(!impulse) continue;
    // بلاک سفارش صعودی: آخرین کندل نزولی قبل از یک کندل صعودی ایمپالسیو
    if(c.close < c.open && next.close > next.open && next.close > c.high){
      return { dir:'bull', high:c.high, low:c.low, index:i };
    }
    // بلاک سفارش نزولی: آخرین کندل صعودی قبل از یک کندل نزولی ایمپالسیو
    if(c.close > c.open && next.close < next.open && next.close < c.low){
      return { dir:'bear', high:c.high, low:c.low, index:i };
    }
  }
  return null;
}

// ---------- Fair Value Gap (FVG) — شکاف قیمتی بین سه کندل متوالی ----------
function findFVGs(candles, maxLookback=40){
  const fvgs=[];
  const start = Math.max(2, candles.length-maxLookback);
  for(let i=start; i<candles.length; i++){
    const c1 = candles[i-2], c3 = candles[i];
    if(c1.high < c3.low) fvgs.push({ dir:'bull', top:c3.low, bottom:c1.high, index:i });
    if(c1.low > c3.high) fvgs.push({ dir:'bear', top:c1.low, bottom:c3.high, index:i });
  }
  // فقط شکاف‌هایی که هنوز پر نشده‌اند (قیمت بعدی وارد محدوده نشده) را نگه دار
  const lastClose = candles.at(-1).close;
  return fvgs.filter(g => {
    const mid = (g.top+g.bottom)/2;
    return Math.abs(mid-lastClose)/lastClose*100 < 5; // فقط شکاف‌های نزدیک و مرتبط با قیمت فعلی
  }).slice(-3);
}

// ---------- Liquidity: Equal Highs/Lows و Liquidity Sweep ساده ----------
function findLiquidityPools(candles, lookback=60, tolerancePct=0.1){
  const win = candles.slice(-lookback);
  const { highs, lows } = findSwingPoints(win, 2);
  const eqHighs = clusterLevels(highs, tolerancePct).filter(c=>c.strength>=2);
  const eqLows = clusterLevels(lows, tolerancePct).filter(c=>c.strength>=2);
  // Liquidity Sweep: کندل اخیر فیتیله‌ای بالاتر از Equal High زده ولی بسته نشده بالای آن (جمع‌آوری نقدینگی)
  const last = candles.at(-1);
  let sweep = null;
  const nearestEqHigh = eqHighs[0]?.price;
  const nearestEqLow = eqLows[0]?.price;
  if(nearestEqHigh && last.high > nearestEqHigh && last.close < nearestEqHigh) sweep = 'Sweep بالای Equal High — احتمال جمع‌آوری نقدینگی خریداران و برگشت نزولی';
  if(nearestEqLow && last.low < nearestEqLow && last.close > nearestEqLow) sweep = 'Sweep زیر Equal Low — احتمال جمع‌آوری نقدینگی فروشندگان و برگشت صعودی';
  return { equalHighs: eqHighs.slice(0,2), equalLows: eqLows.slice(0,2), sweep };
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
function analyze(candles, htfCandles){
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
  const bb = bollinger(closes,20,2);
  const stoch = stochastic(candles,14,3);
  const adxVal = adx(candles,14);
  const divergence = detectRSIDivergence(candles, closes);
  const fib = fibonacci(candles, 80);
  const vwapVal = vwap(candles.slice(-Math.min(candles.length,200)));
  const structure = marketStructure(candles);
  const orderBlock = findOrderBlock(candles, atrVal);
  const fvgs = findFVGs(candles, 40);
  const liquidity = findLiquidityPools(candles, 60, 0.1);

  // روند تایم‌فریم بالاتر (Multi-Timeframe Confirmation)
  let htfTrend = null;
  if(htfCandles && htfCandles.length >= 60){
    const htfCloses = htfCandles.map(c=>c.close);
    const hEma20 = emaSeries(htfCloses,20).at(-1);
    const hEma50 = emaSeries(htfCloses,50).at(-1);
    const hLast = htfCloses.at(-1);
    htfTrend = hLast > hEma20 && hEma20 > hEma50 ? 'up' : (hLast < hEma20 && hEma20 < hEma50 ? 'down' : 'mixed');
  }

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

  // مومنتوم (RSI + MACD + Stochastic + واگرایی)
  let momScore = 0;
  if(rsiVal > 70){ momScore -= 1; notes.push(`RSI=${rsiVal.toFixed(1)} در ناحیه اشباع خرید`); }
  else if(rsiVal < 30){ momScore += 1; notes.push(`RSI=${rsiVal.toFixed(1)} در ناحیه اشباع فروش`); }
  else notes.push(`RSI=${rsiVal.toFixed(1)} خنثی`);
  if(macdVal.hist > 0 && macdVal.hist > macdVal.prevHist){ momScore += 1; notes.push('هیستوگرام MACD مثبت و در حال افزایش (مومنتوم صعودی)'); }
  else if(macdVal.hist < 0 && macdVal.hist < macdVal.prevHist){ momScore -= 1; notes.push('هیستوگرام MACD منفی و در حال افزایش فشار فروش'); }
  if(stoch.k < 20 && stoch.k > stoch.d){ momScore += 1; notes.push(`Stochastic (K=${stoch.k.toFixed(1)}) از ناحیه اشباع فروش برگشته`); }
  else if(stoch.k > 80 && stoch.k < stoch.d){ momScore -= 1; notes.push(`Stochastic (K=${stoch.k.toFixed(1)}) از ناحیه اشباع خرید برگشته`); }
  if(divergence?.bullishDiv){ momScore += 1; notes.push('واگرایی مثبت RSI شناسایی شد (کف قیمت پایین‌تر ولی RSI بالاتر) — هشدار برگشت صعودی'); }
  if(divergence?.bearishDiv){ momScore -= 1; notes.push('واگرایی منفی RSI شناسایی شد (سقف قیمت بالاتر ولی RSI پایین‌تر) — هشدار برگشت نزولی'); }
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

  // موقعیت نسبت به S/R و باند بولینگر
  let srScore = 0;
  const nearestRes = resistances[0]?.price;
  const nearestSup = supports.at(-1)?.price;
  if(nearestRes && (nearestRes-lastClose)/lastClose*100 < 0.5){ srScore -= 1; notes.push('قیمت نزدیک به مقاومت مهم — احتمال واکنش نزولی'); }
  if(nearestSup && (lastClose-nearestSup)/lastClose*100 < 0.5){ srScore += 1; notes.push('قیمت نزدیک به حمایت مهم — احتمال واکنش صعودی'); }
  if(lastClose <= bb.lower){ srScore += 1; notes.push(`قیمت به باند پایین بولینگر رسیده (${bb.lower.toFixed(4)}) — احتمال اشباع فروش کوتاه‌مدت`); }
  if(lastClose >= bb.upper){ srScore -= 1; notes.push(`قیمت به باند بالای بولینگر رسیده (${bb.upper.toFixed(4)}) — احتمال اشباع خرید کوتاه‌مدت`); }
  score += srScore;

  // قدرت روند (ADX) — فقط ضریب اطمینان را تغییر می‌دهد، نه جهت
  let trendStrengthNote = '';
  if(adxVal.adx >= 25){ trendStrengthNote = `ADX=${adxVal.adx.toFixed(1)} → روند قوی و قابل‌اتکا`; }
  else { trendStrengthNote = `ADX=${adxVal.adx.toFixed(1)} → روند ضعیف/بازار رنج، اعتبار سیگنال‌های روندی کمتر است`; }
  notes.push(trendStrengthNote);

  // تأیید چندتایم‌فریمی
  let htfScore = 0;
  if(htfTrend === 'up'){ htfScore = 1; notes.push('روند تایم‌فریم بالاتر نیز صعودی است (تأیید هم‌راستا)'); }
  else if(htfTrend === 'down'){ htfScore = -1; notes.push('روند تایم‌فریم بالاتر نیز نزولی است (تأیید هم‌راستا)'); }
  else if(htfTrend === 'mixed'){ notes.push('روند تایم‌فریم بالاتر مختلط/نامشخص است — احتیاط بیشتر'); }
  score += htfScore;

  // VWAP — سطح مرجع نهادی
  let vwapScore = 0;
  if(lastClose > vwapVal){ vwapScore = 1; notes.push(`قیمت بالای VWAP (${vwapVal.toFixed(4)}) — تمایل خریداران نهادی`); }
  else { vwapScore = -1; notes.push(`قیمت زیر VWAP (${vwapVal.toFixed(4)}) — تمایل فروشندگان نهادی`); }
  score += vwapScore;

  // ساختار بازار (Smart Money: BOS / CHoCH)
  let structureScore = 0;
  if(structure?.bos){
    if(structure.bos.includes('صعودی')){ structureScore = structure.bos.startsWith('CHoCH')?1:2; notes.push(structure.bos); }
    else { structureScore = structure.bos.startsWith('CHoCH')?-1:-2; notes.push(structure.bos); }
  } else if(structure){ notes.push(`ساختار بازار: ${structure.structure}`); }
  score += structureScore;

  // نزدیکی به فیبوناچی (سطح ۰.۵ / ۰.۶۱۸ به‌عنوان ناحیه طلایی)
  let fibScore = 0;
  if(fib){
    const golden = [fib.levels[0.5], fib.levels[0.618]];
    const near = golden.find(lv => Math.abs(lv-lastClose)/lastClose*100 < 0.4);
    if(near){
      fibScore = fib.impulseUp ? 1 : -1;
      notes.push(`قیمت در ناحیه طلایی فیبوناچی (۰.۵-۰.۶۱۸) نسبت به آخرین لگ قیمتی قرار دارد`);
    }
  }
  score += fibScore;

  // نزدیکی به Order Block
  let obScore = 0;
  if(orderBlock){
    const inZone = lastClose >= orderBlock.low && lastClose <= orderBlock.high;
    const nearZone = Math.abs(((orderBlock.high+orderBlock.low)/2)-lastClose)/lastClose*100 < 0.6;
    if(inZone || nearZone){
      obScore = orderBlock.dir==='bull' ? 1 : -1;
      notes.push(`قیمت در محدوده Order Block ${orderBlock.dir==='bull'?'صعودی (حمایتی)':'نزولی (مقاومتی)'} قرار دارد`);
    }
  }
  score += obScore;

  // نقدینگی: Liquidity Sweep نزدیک Equal High/Low
  let liqScore = 0;
  if(liquidity?.sweep){
    liqScore = liquidity.sweep.includes('صعودی') ? 1 : -1;
    notes.push(liquidity.sweep);
  }
  score += liqScore;

  // --- محاسبه سطح اطمینان (Confidence) ---
  const maxPossible = 20; // حداکثر تئوریک امتیاز با اسکیل‌های جدید
  let confidence = Math.min(95, Math.round((Math.abs(score)/maxPossible)*100));
  if(adxVal.adx < 20) confidence = Math.round(confidence*0.7); // روند ضعیف = اطمینان کمتر
  if(htfTrend === 'mixed') confidence = Math.round(confidence*0.85);
  confidence = Math.max(5, confidence);

  // --- تصمیم نهایی ---
  let verdict, verdictClass;
  const dataQualityOK = candles.length >= 100 && volAvg > 0;
  const htfConflict = (htfTrend==='up' && score<0) || (htfTrend==='down' && score>0);
  if(!dataQualityOK){
    verdict = 'داده کافی/باکیفیت نیست — بدون سیگنال'; verdictClass='v-none';
  } else if(htfConflict && Math.abs(score) < 5){
    verdict = 'HOLD — تناقض بین تایم‌فریم فعلی و تایم‌فریم بالاتر، ورود توصیه نمی‌شود'; verdictClass='v-hold';
  } else if(score >= 6){
    verdict = 'BUY (خرید) — همگرایی قوی سیگنال‌های صعودی'; verdictClass='v-buy';
  } else if(score <= -6){
    verdict = 'SELL (فروش) — همگرایی قوی سیگنال‌های نزولی'; verdictClass='v-sell';
  } else if(score >= 3){
    verdict = 'تمایل به BUY، اما با احتیاط — سیگنال‌ها هم‌جهت اما ضعیف'; verdictClass='v-hold';
  } else if(score <= -3){
    verdict = 'تمایل به SELL، اما با احتیاط — سیگنال‌ها هم‌جهت اما ضعیف'; verdictClass='v-hold';
  } else {
    verdict = 'HOLD — عدم قطعیت / سیگنال‌های متضاد، وارد پوزیشن نشوید'; verdictClass='v-hold';
  }

  // --- مدیریت ریسک: پیشنهاد حد ضرر/سود بر اساس ATR و نزدیک‌ترین S/R ---
  let risk = null;
  if(dataQualityOK && (verdictClass==='v-buy' || verdictClass==='v-sell')){
    const dir = verdictClass==='v-buy' ? 1 : -1;
    const slByATR = lastClose - dir*atrVal*1.5;
    const slBySR = dir===1 ? (nearestSup ?? slByATR) : (nearestRes ?? slByATR);
    const stopLoss = dir===1 ? Math.min(slByATR, slBySR) : Math.max(slByATR, slBySR);
    const riskAmount = Math.abs(lastClose - stopLoss);
    const takeProfit1 = lastClose + dir*riskAmount*1.5;
    const takeProfit2 = lastClose + dir*riskAmount*2.5;
    risk = {
      entry: lastClose, stopLoss, takeProfit1, takeProfit2,
      riskRewardTP1: 1.5, riskRewardTP2: 2.5
    };
  }

  return {
    lastClose, ema20, ema50, ema200, rsiVal, macdVal, atrVal, bb, stoch, adxVal, divergence, htfTrend,
    fib, vwapVal, structure, orderBlock, fvgs, liquidity,
    resistances, supports, patterns, notes, score, verdict, verdictClass, confidence, risk,
    trendScore, momScore, paScore, volScore, srScore, htfScore, vwapScore, structureScore, fibScore, obScore, liqScore
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
    ['scoreCard','srCard','indCard','paCard','reasonCard','riskCard','aiCard'].forEach(id=>document.getElementById(id).style.display='none');
    return;
  }

  els.verdictBox.className = 'verdict ' + res.verdictClass;
  els.verdictBox.innerHTML = res.verdict + `<br><span style="font-size:12px;font-weight:400">امتیاز: ${res.score} | سطح اطمینان: ${res.confidence}%</span>`;

  document.getElementById('scoreCard').style.display='block';
  document.getElementById('s_trend').innerHTML = label(res.trendScore);
  document.getElementById('s_mom').innerHTML = label(res.momScore);
  document.getElementById('s_pa').innerHTML = label(res.paScore);
  document.getElementById('s_vol').innerHTML = label(res.volScore);
  document.getElementById('s_sr').innerHTML = label(res.srScore);
  document.getElementById('s_vwap').innerHTML = label(res.vwapScore);
  document.getElementById('s_struct').innerHTML = label(res.structureScore) + (res.structure? ` <span class="muted">(${res.structure.structure})</span>` : '');
  document.getElementById('s_fib').innerHTML = label(res.fibScore);
  document.getElementById('s_ob').innerHTML = label(res.obScore);
  const htfRow = document.getElementById('s_htf_row');
  if(htfRow){
    htfRow.style.display = res.htfTrend ? 'flex' : 'none';
    document.getElementById('s_htf').innerHTML = res.htfTrend
      ? (res.htfTrend==='up' ? '<span class="tag tag-up">صعودی</span>' : res.htfTrend==='down' ? '<span class="tag tag-down">نزولی</span>' : '<span class="tag tag-neu">مختلط</span>')
      : '-';
  }

  const riskCard = document.getElementById('riskCard');
  if(res.risk){
    riskCard.style.display='block';
    document.getElementById('r_entry').textContent = res.risk.entry.toFixed(4);
    document.getElementById('r_sl').textContent = res.risk.stopLoss.toFixed(4);
    document.getElementById('r_tp1').textContent = `${res.risk.takeProfit1.toFixed(4)} (R:R ${res.risk.riskRewardTP1})`;
    document.getElementById('r_tp2').textContent = `${res.risk.takeProfit2.toFixed(4)} (R:R ${res.risk.riskRewardTP2})`;
  } else {
    riskCard.style.display='none';
  }

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
  const bbRow=document.getElementById('ind_bb_row'), stochRow=document.getElementById('ind_stoch_row'), adxRow=document.getElementById('ind_adx_row');
  if(bbRow){ bbRow.style.display='flex'; document.getElementById('ind_bb').textContent = `${res.bb.lower.toFixed(4)} / ${res.bb.mid.toFixed(4)} / ${res.bb.upper.toFixed(4)}`; }
  if(stochRow){ stochRow.style.display='flex'; document.getElementById('ind_stoch').textContent = `K=${res.stoch.k.toFixed(1)} D=${res.stoch.d.toFixed(1)}`; }
  if(adxRow){ adxRow.style.display='flex'; document.getElementById('ind_adx').textContent = `${res.adxVal.adx.toFixed(1)} (${res.adxVal.adx>=25?'روند قوی':'رنج/ضعیف'})`; }

  document.getElementById('paCard').style.display='block';
  document.getElementById('paPatterns').innerHTML = res.patterns.length
    ? res.patterns.map(p=>`<span class="tag ${p.dir==='up'?'tag-up':p.dir==='down'?'tag-down':'tag-neu'}">${p.name}</span>`).join(' ')
    : '<span class="muted">پترن قابل‌اتکایی در کندل‌های اخیر شناسایی نشد</span>';

  document.getElementById('reasonCard').style.display='block';
  document.getElementById('reasonText').innerHTML = '<ul>' + res.notes.map(n=>`<li>${n}</li>`).join('') + '</ul>';

  drawAnalysisOnChart(res);
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
  aiText.textContent = 'در حال دریافت داده چند تایم‌فریمی (1D → 4H → 1H → 15M → 5M) و تحلیل...';

  // تحلیل بالا-به-پایین واقعی: روند هر تایم‌فریم اصلی را جدا محاسبه و به AI می‌دهیم
  const mtf = await buildMultiTimeframeSnapshot(symbol);

  const dataSummary = {
    symbol, workingInterval: interval,
    lastClose: res.lastClose, ema20: res.ema20, ema50: res.ema50, ema200: res.ema200,
    rsi: res.rsiVal, macd: res.macdVal, atr: res.atrVal,
    bollinger: res.bb, stochastic: res.stoch, adx: res.adxVal, rsiDivergence: res.divergence,
    higherTimeframeTrend: res.htfTrend,
    multiTimeframeAnalysis: mtf, // روند/ساختار مستقل هر تایم‌فریم: 1d, 4h, 1h, 15m, 5m
    fibonacci: res.fib, vwap: res.vwapVal, marketStructure: res.structure,
    orderBlock: res.orderBlock, fairValueGaps: res.fvgs, liquidity: res.liquidity,
    resistances: res.resistances, supports: res.supports,
    patterns: res.patterns.map(p=>p.name),
    volumeNote: res.notes.find(n=>n.includes('حجم')),
    componentScores: {
      trend: res.trendScore, momentum: res.momScore, priceAction: res.paScore,
      volume: res.volScore, supportResistance: res.srScore, higherTimeframe: res.htfScore,
      vwap: res.vwapScore, marketStructure: res.structureScore, fibonacci: res.fibScore,
      orderBlock: res.obScore, liquiditySweep: res.liqScore
    },
    totalConfluenceScore: res.score,
    confidencePercent: res.confidence,
    ruleBasedVerdict: res.verdict,
    suggestedRiskManagement: res.risk,
    // داده‌هایی که این پلتفرم به آن‌ها دسترسی ندارد — AI موظف است برای همین موارد صراحتاً بگوید «داده در دسترس نیست»
    notAvailable: ['Order Flow', 'Open Interest', 'Funding Rate', 'Long/Short Ratio', 'اخبار/رویدادهای فاندامنتال']
  };

  aiText.textContent = 'در حال تحلیل توسط AI...';

  const prompt = `تو یک Senior Crypto Market Analyst و Professional Technical Trader هستی.

وظیفه‌ات تحلیل دقیق و چندلایه بازار ارز دیجیتال ${symbol} است، فقط و فقط بر اساس داده‌های JSON زیر که همگی از محاسبات واقعی روی کندل‌های زنده (Binance) به‌دست آمده‌اند — نه حدس، نه دانش عمومی قبلی، نه پیش‌بینی اخبار.

## قوانین اصلی (اجباری)
- هرگز صرفاً بر اساس یک اندیکاتور یا یک سیگنال نتیجه‌گیری نکن؛ ترکیب همه داده‌های زیر را در نظر بگیر: Market Structure، Price Action، Support/Resistance، Trend، Volume، Volatility، Liquidity، RSI، MACD، EMA، VWAP، Bollinger Bands، Fibonacci، Divergence، Candlestick Patterns، Fair Value Gap، Liquidity Sweep، Order Block.
- فیلد notAvailable در داده مشخص می‌کند این موارد (Order Flow، Open Interest، Funding Rate، Long/Short Ratio، اخبار) در دسترس نیستند — برای این موارد صراحتاً بنویس «داده در دسترس نیست» و هرگز حدس نزن یا ادعای Whale Activity/Smart Money بدون داده واقعی نکن.
- هیچ عدد، قیمت یا رویدادی که در JSON نیست اختراع نکن.

## تحلیل چند تایم‌فریمی (اجباری)
فیلد multiTimeframeAnalysis روند مستقل هر تایم‌فریم (1d, 4h, 1h, 15m, 5m) را می‌دهد. طبق ترتیب اهمیت 1D → 4H → 1H → 15M → 5M عمل کن: از تایم‌فریم‌های بالا روند اصلی، از تایم‌فریم‌های پایین‌تر (که workingInterval معمولاً بین آن‌هاست) نقطه ورود را استخراج کن. اگر تایم‌فریم پایین‌تر برخلاف تایم‌فریم بالاتر سیگنال داد، آن را سیگنال ضعیف‌تر در نظر بگیر و صریح اعلام کن.

## ساختار خروجی (دقیقاً به این ترتیب و به فارسی روان بنویس)
1. **Market Structure**: روند هر تایم‌فریم اصلی (از multiTimeframeAnalysis)، HH/HL یا LH/LL، آخرین BOS/CHoCH (از marketStructure)، و آیا شکست معتبر بوده یا احتمال Fake Breakout.
2. **حمایت و مقاومت کلیدی**: فقط سطوح مهم (از resistances/supports)، با قیمت دقیق و قدرت هر سطح.
3. **Price Action**: پترن‌های شناسایی‌شده (از patterns) را در Context ساختار بازار توضیح بده، نه فقط نام‌شان.
4. **اندیکاتورها**: خلاصه RSI (شامل rsiDivergence)، MACD، EMA/SMA (شیب و Cross)، Bollinger (Squeeze/Expansion) — همه از داده واقعی.
5. **Fibonacci**: سطوح کلیدی (fibonacci.levels) و هم‌پوشانی آن‌ها با S/R یا ساختار بازار.
6. **Volume & Momentum**: از volumeNote و componentScores.
7. **Liquidity & Smart Money**: از orderBlock، fairValueGaps، liquidity (Equal Highs/Lows، Sweep) — فقط با داده موجود، بدون ادعای بدون‌مبنا.
8. **سناریوهای معاملاتی**: حداقل دو سناریو (LONG و SHORT) با Entry Zone، Trigger، Confirmation، Stop Loss، TP1، TP2، Risk/Reward — این اعداد را فقط از suggestedRiskManagement و سطوح S/R/Fibonacci واقعی بردار، عدد جدید نساز. اگر confidencePercent پایین (زیر ۴۰) یا ruleBasedVerdict نامشخص/HOLD است، سناریوها را به‌صورت شرطی ("اگر قیمت X را بشکند...") بنویس، نه توصیه قطعی.
9. **جمع‌بندی نهایی**: یک جمله صریح — سیگنال معتبر و قابل‌اتکاست یا باید صبر کرد؟ و یادآوری کوتاه که این توصیه مالی قطعی نیست.

لحن: حرفه‌ای، دقیق، بدون اغراق یا شعار تبلیغاتی.

DATA:
${JSON.stringify(dataSummary)}`;

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
          max_tokens: 2200,
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
          max_tokens: 2200,
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
    let htfCandles = null;
    const htfInterval = HTF_MAP[interval];
    if(htfInterval){
      try{ htfCandles = await fetchKlines(symbol, htfInterval, 250); }catch(e){ /* اختیاری است، اگر نشد بدون تأیید چندتایم‌فریمی ادامه می‌دهیم */ }
    }
    const res = analyze(candles, htfCandles);
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
