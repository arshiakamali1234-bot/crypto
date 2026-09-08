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
  scanBtn: document.getElementById('scanBtn'),
  scanCloseBtn: document.getElementById('scanCloseBtn'),
  scannerOverlay: document.getElementById('scannerOverlay'),
  scannerBody: document.getElementById('scannerBody'),
  capitalInput: document.getElementById('capitalInput'),
  riskPctInput: document.getElementById('riskPctInput'),
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
      addHLine(res.risk.takeProfit3, '✅ حد سود ۳', '#26a69a', 'dashed', 1);
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
async function fetchKlines(symbol, interval, limit=300, closedOnly=true){
  // یک کندل اضافه می‌گیریم تا اگر آخرین کندل هنوز بسته نشده، بعد از حذفش هم به تعداد limit کندلِ بسته‌شده برسیم
  const fetchLimit = closedOnly ? Math.min(limit+1, 1000) : limit;
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${fetchLimit}`;
  const res = await fetch(url);
  if(!res.ok) throw new Error('عدم دسترسی به داده بازار برای این نماد/تایم‌فریم');
  const raw = await res.json();
  let mapped = raw.map(k => ({
    time:k[0], closeTime:k[6], open:+k[1], high:+k[2], low:+k[3], close:+k[4], volume:+k[5]
  }));
  if(closedOnly && mapped.length){
    // کندل آخر اگر هنوز بسته نشده (closeTime در آینده است) کنار گذاشته می‌شود
    // تا سیگنال‌ها بر مبنای دادهٔ نیمه‌کاره و در حال تغییرِ کندل زنده نوسان نکنند
    const now = Date.now();
    if(mapped.at(-1).closeTime > now) mapped = mapped.slice(0, -1);
  }
  return mapped.slice(-limit);
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
  const snapshot={};
  const results=await Promise.all(MTF_STACK.map(async tf=>{
    try{ const candles=await fetchKlines(symbol,tf,180); const q=quickTrendSnapshot(candles); return [tf,{...q,ichimoku:ichimoku(candles),advancedStructure:advancedStructure(candles,atr(candles,14))}]; }
    catch(e){ return [tf,{available:false,error:e.message}]; }
  }));
  results.forEach(([tf,v])=>snapshot[tf]=v); return snapshot;
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

// ---------- رگرسیون خطی ساده (برای خطوط روند کانال/مثلث) ----------
function linReg(points){
  const n = points.length;
  const sumX = points.reduce((a,p)=>a+p.x,0);
  const sumY = points.reduce((a,p)=>a+p.y,0);
  const sumXY = points.reduce((a,p)=>a+p.x*p.y,0);
  const sumXX = points.reduce((a,p)=>a+p.x*p.x,0);
  const denom = (n*sumXX - sumX*sumX) || 1;
  const slope = (n*sumXY - sumX*sumY) / denom;
  const intercept = (sumY - slope*sumX) / n;
  return { slope, intercept };
}

// ---------- تشخیص کانال‌ها و مثلث‌ها (بر اساس خطوط برازش‌شده روی سوئینگ‌های اخیر) ----------
function detectChartPatterns(candles, lookback=3, minSwings=3){
  const n = candles.length;
  const highsIdx=[], lowsIdx=[];
  for(let i=lookback;i<n-lookback;i++){
    const win = candles.slice(i-lookback, i+lookback+1);
    const cur = candles[i];
    if(cur.high === Math.max(...win.map(c=>c.high))) highsIdx.push({x:i, y:cur.high});
    if(cur.low === Math.min(...win.map(c=>c.low))) lowsIdx.push({x:i, y:cur.low});
  }
  const recentHighs = highsIdx.slice(-5);
  const recentLows = lowsIdx.slice(-5);
  if(recentHighs.length < minSwings || recentLows.length < minSwings) return null;

  const upper = linReg(recentHighs);
  const lower = linReg(recentLows);
  const lastIdx = n-1;
  const lastClose = candles[n-1].close;
  const upperNow = upper.slope*lastIdx + upper.intercept;
  const lowerNow = lower.slope*lastIdx + lower.intercept;
  if(upperNow <= lowerNow) return null; // خطوط نامعتبر (تقاطع اشتباه)

  const widthNow = upperNow - lowerNow;
  const startX = Math.min(recentHighs[0].x, recentLows[0].x);
  const upperStart = upper.slope*startX + upper.intercept;
  const lowerStart = lower.slope*startX + lower.intercept;
  const widthStart = Math.max(upperStart - lowerStart, 1e-9);

  const avgPrice = (upperNow+lowerNow)/2;
  const slopeThreshold = avgPrice * 0.0006; // برای تشخیص «تقریباً افقی»

  const upFlat = Math.abs(upper.slope) < slopeThreshold;
  const lowFlat = Math.abs(lower.slope) < slopeThreshold;
  const upUp = upper.slope > slopeThreshold;
  const upDown = upper.slope < -slopeThreshold;
  const lowUp = lower.slope > slopeThreshold;
  const lowDown = lower.slope < -slopeThreshold;

  let type=null, dirBias='neutral';
  const converging = widthNow < widthStart*0.85;
  const diverging = widthNow > widthStart*1.15;

  if(converging){
    if(upFlat && lowUp){ type='مثلث صعودی (Ascending Triangle)'; dirBias='up'; }
    else if(upDown && lowFlat){ type='مثلث نزولی (Descending Triangle)'; dirBias='down'; }
    else if(upDown && lowUp){ type='مثلث متقارن (Symmetrical Triangle)'; dirBias='neutral'; }
    else if(upDown && lowDown){ type='کانال نزولی همگرا (Falling Wedge)'; dirBias='up'; }
    else if(upUp && lowUp){ type='کانال صعودی همگرا (Rising Wedge)'; dirBias='down'; }
  } else if(diverging){
    type='الگوی گسترش‌یابنده / بادبزنی (Broadening Formation)'; dirBias='neutral';
  } else {
    if(upUp && lowUp){ type='کانال صعودی (Ascending Channel)'; dirBias='up'; }
    else if(upDown && lowDown){ type='کانال نزولی (Descending Channel)'; dirBias='down'; }
    else if(upFlat && lowFlat){ type='کانال رنج / محدوده خنثی (Horizontal Range)'; dirBias='neutral'; }
  }
  if(!type) return null;

  let status, breakout=null;
  if(lastClose > upperNow){ status='شکست به بالای خط بالایی الگو (Breakout بالقوه — نیازمند تأیید کندل بسته و حجم)'; breakout='up'; }
  else if(lastClose < lowerNow){ status='شکست به پایین خط پایینی الگو (Breakdown بالقوه — نیازمند تأیید کندل بسته و حجم)'; breakout='down'; }
  else status='قیمت هنوز داخل الگو در حال نوسان است — بدون شکست تأییدشده';

  return {
    type, dirBias, status, breakout,
    upperLineNow: +upperNow.toFixed(6), lowerLineNow: +lowerNow.toFixed(6),
    upperSlope: upper.slope, lowerSlope: lower.slope
  };
}

// =========================================================
// ---------- موتور قدرت موج و فشار شکست (Wave Strength & Breakout Pressure Engine) ----------
// =========================================================
function buildPivotSequence(candles, lookback=3){
  const n = candles.length;
  const pts = [];
  for(let i=lookback;i<n-lookback;i++){
    const win = candles.slice(i-lookback, i+lookback+1);
    const cur = candles[i];
    if(cur.high === Math.max(...win.map(c=>c.high))) pts.push({ idx:i, price:cur.high, type:'high' });
    if(cur.low === Math.min(...win.map(c=>c.low))) pts.push({ idx:i, price:cur.low, type:'low' });
  }
  pts.sort((a,b)=>a.idx-b.idx);
  const alt = [];
  for(const p of pts){
    const last = alt.at(-1);
    if(!last){ alt.push(p); continue; }
    if(last.type === p.type){
      if(p.type==='high' && p.price > last.price) alt[alt.length-1] = p;
      if(p.type==='low' && p.price < last.price) alt[alt.length-1] = p;
    } else alt.push(p);
  }
  return alt;
}

function classifyWaveStrength(effNorm){
  if(effNorm >= 2.2) return 'خیلی قوی (VERY STRONG)';
  if(effNorm >= 1.4) return 'قوی (STRONG)';
  if(effNorm >= 0.8) return 'عادی (NORMAL)';
  if(effNorm >= 0.4) return 'ضعیف (WEAK)';
  return 'خیلی ضعیف (VERY WEAK)';
}

function analyzeWaveStrength(candles, atrVal){
  const pivots = buildPivotSequence(candles, 3);
  if(pivots.length < 4 || !atrVal) return null;
  const recentPivots = pivots.slice(-7);
  const waves = [];
  for(let i=1;i<recentPivots.length;i++){
    const a = recentPivots[i-1], b = recentPivots[i];
    const priceDispPct = (b.price - a.price) / a.price * 100;
    const duration = Math.max(b.idx - a.idx, 1);
    const efficiencyNorm = Math.abs(b.price - a.price) / (atrVal * duration);
    waves.push({
      dir: b.price > a.price ? 'up' : 'down',
      startPrice: a.price, endPrice: b.price,
      priceDispPct: +priceDispPct.toFixed(2),
      duration, efficiencyNorm: +efficiencyNorm.toFixed(2),
      strength: classifyWaveStrength(efficiencyNorm)
    });
  }
  if(waves.length < 2) return null;

  function accel(dir){
    const seq = waves.filter(w=>w.dir===dir).map(w=>w.efficiencyNorm);
    if(seq.length < 2) return 'داده ناکافی';
    const last = seq.at(-1), prev = seq.at(-2);
    if(last > prev*1.1) return 'شتاب‌گیرنده (Accelerating)';
    if(last < prev*0.9) return 'کاهش‌شونده (Decelerating)';
    return 'باثبات (Stable)';
  }
  const upAccel = accel('up');
  const downAccel = accel('down');

  const absDisp = waves.map(w=>Math.abs(w.priceDispPct));
  const pivotExpanding = absDisp.length>=3 && absDisp.at(-1) > absDisp.at(-2) && absDisp.at(-2) > absDisp.at(-3);
  const pivotContracting = absDisp.length>=3 && absDisp.at(-1) < absDisp.at(-2) && absDisp.at(-2) < absDisp.at(-3);

  const lastWave = waves.at(-1);
  const oppDir = lastWave.dir==='up' ? 'down' : 'up';
  const oppWaves = waves.filter(w=>w.dir===oppDir);
  const pullbackWeakening = oppWaves.length>=2 && Math.abs(oppWaves.at(-1).priceDispPct) < Math.abs(oppWaves.at(-2).priceDispPct);

  function pressureScore(dir){
    let s = 0;
    const dirWaves = waves.filter(w=>w.dir===dir);
    if(!dirWaves.length) return 5;
    const avgStrength = dirWaves.reduce((a,w)=>a+w.efficiencyNorm,0)/dirWaves.length;
    s += Math.min(avgStrength/2.2, 1) * 20;
    s += ((dir==='up'?upAccel:downAccel).includes('Accelerating') ? 15 : (dir==='up'?upAccel:downAccel).includes('Decelerating') ? 0 : 7);
    s += (pivotExpanding ? 15 : pivotContracting ? 0 : 7);
    const lastDirWave = dirWaves.at(-1);
    s += Math.min((lastDirWave?.efficiencyNorm||0)/2.2, 1) * 10;
    s += (lastWave.dir===dir && pullbackWeakening ? 10 : 5);
    s += 5; s += 5; s += 10; // Boundary/Volume/Structure — بدون داده اضافه، خنثی
    return Math.round(Math.min(s, 95));
  }
  const bullishPressure = pressureScore('up');
  const bearishPressure = pressureScore('down');
  let overall;
  if(Math.abs(bullishPressure-bearishPressure) < 10) overall = 'متعادل (BALANCED PRESSURE)';
  else overall = bullishPressure > bearishPressure ? 'فشار صعودی غالب (BULLISH BREAKOUT PRESSURE)' : 'فشار نزولی غالب (BEARISH BREAKOUT PRESSURE)';

  return {
    waves: waves.slice(-4),
    upAcceleration: upAccel, downAcceleration: downAccel,
    pivotTrend: pivotExpanding ? 'در حال انبساط' : pivotContracting ? 'در حال انقباض' : 'نامشخص',
    pullbackWeakening,
    bullishPressure, bearishPressure, overall
  };
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
/* =========================================================
   ANALYSIS ENGINE V2 — ساختارمحور، چندتایم‌فریمی، ضد نویز
   هدف: کیفیت ستاپ > تعداد سیگنال
   ========================================================= */
function clamp(v,a=0,b=100){ return Math.max(a,Math.min(b,v)); }
function safeNum(v,f=0){ return Number.isFinite(+v) ? +v : f; }
function pctDistance(a,b){ return b ? Math.abs(a-b)/Math.abs(b)*100 : Infinity; }
function signDir(v){ return v>0 ? 'up' : v<0 ? 'down' : 'neutral'; }

function ichimoku(candles){
  const n=candles.length;
  if(n<60) return null;
  const mid=(arr)=> (Math.max(...arr.map(c=>c.high))+Math.min(...arr.map(c=>c.low)))/2;
  const tenkan=mid(candles.slice(-9));
  const kijun=mid(candles.slice(-26));
  const spanB=mid(candles.slice(-52));
  const spanA=(tenkan+kijun)/2;
  const pastKijun = n>=27 ? mid(candles.slice(-27,-1)) : kijun;
  const prevTenkan = n>=10 ? mid(candles.slice(-10,-1)) : tenkan;
  const prevKijun = n>=27 ? mid(candles.slice(-27,-1)) : kijun;
  const cloudTop=Math.max(spanA,spanB), cloudBottom=Math.min(spanA,spanB);
  const close=candles.at(-1).close;
  const atrVal=atr(candles,14)||Math.max(close*0.005,1e-9);
  const cloudThickness=(cloudTop-cloudBottom)/atrVal;
  const tkCross = tenkan>kijun && prevTenkan<=prevKijun ? 'bullish' : tenkan<kijun && prevTenkan>=prevKijun ? 'bearish' : 'none';
  const priceVsCloud=close>cloudTop?'above':close<cloudBottom?'below':'inside';
  // Chikou is current close compared with price/cloud 26 periods back.
  const ref=n>=27 ? candles[n-27] : null;
  const chikou=close;
  const chikouVsPrice=ref ? (chikou>ref.close?'above':chikou<ref.close?'below':'inside') : 'unknown';
  const bullishFuture=spanA>spanB;
  let score=0;
  score += priceVsCloud==='above'?3:priceVsCloud==='below'?-3:0;
  score += tenkan>kijun?2:tenkan<kijun?-2:0;
  score += kijun>=pastKijun?1:-1;
  score += bullishFuture?2:-2;
  score += cloudThickness>0.8?1:0;
  score += chikouVsPrice==='above'?2:chikouVsPrice==='below'?-2:0;
  score += tkCross==='bullish'?1:tkCross==='bearish'?-1:0;
  return {tenkan,kijun,senkouA:spanA,senkouB:spanB,cloudTop,cloudBottom,cloudThickness,
    priceVsCloud,bullishFuture,chikou,chikouVsPrice,tkCross,score:clamp(50+score*5)};
}

function volumeProfileLite(candles,bins=24,lookback=120){
  const win=candles.slice(-lookback); if(win.length<20) return null;
  const lo=Math.min(...win.map(c=>c.low)), hi=Math.max(...win.map(c=>c.high));
  const step=(hi-lo)/(bins||1); if(step<=0) return null;
  const vol=Array(bins).fill(0);
  win.forEach(c=>{ const tp=(c.high+c.low+c.close)/3; const idx=Math.max(0,Math.min(bins-1,Math.floor((tp-lo)/step))); vol[idx]+=c.volume; });
  let maxI=0; vol.forEach((v,i)=>{if(v>vol[maxI])maxI=i;});
  const poc=lo+(maxI+0.5)*step;
  const total=vol.reduce((a,b)=>a+b,0), target=total*0.70;
  let cum=vol[maxI], l=maxI, r=maxI;
  while(cum<target && (l>0||r<bins-1)){ const lv=l>0?vol[l-1]:-1, rv=r<bins-1?vol[r+1]:-1; if(rv>=lv){r++;cum+=vol[r];}else{l--;cum+=vol[l];} }
  return {poc, valueAreaLow:lo+l*step, valueAreaHigh:lo+(r+1)*step, totalVolume:total};
}

function volumeMetrics(candles){
  const vols=candles.map(c=>c.volume), last=vols.at(-1), avg=sma(vols.slice(-20),20);
  const prevAvg=sma(vols.slice(-40,-20),20)||avg;
  const ratio=avg?last/avg:1;
  const trend=prevAvg?avg/prevAvg:1;
  const obv=[]; let o=0;
  for(let i=1;i<candles.length;i++){ if(candles[i].close>candles[i-1].close)o+=candles[i].volume; else if(candles[i].close<candles[i-1].close)o-=candles[i].volume; obv.push(o); }
  const obvSlope=obv.length>=10 ? obv.at(-1)-obv.at(-10) : 0;
  return {last,avg,ratio,trend,obvSlope,expanding:ratio>=1.25,contracting:ratio<=0.75};
}

function advancedStructure(candles, atrVal){
  const pts=[]; const lb=3;
  for(let i=lb;i<candles.length-lb;i++){
    const win=candles.slice(i-lb,i+lb+1), c=candles[i];
    if(c.high===Math.max(...win.map(x=>x.high))) pts.push({i,price:c.high,type:'H'});
    if(c.low===Math.min(...win.map(x=>x.low))) pts.push({i,price:c.low,type:'L'});
  }
  const piv=[]; for(const p of pts){const last=piv.at(-1); if(!last){piv.push(p);continue;} if(last.type===p.type){ if(p.type==='H'&&p.price>=last.price)piv[piv.length-1]=p; if(p.type==='L'&&p.price<=last.price)piv[piv.length-1]=p; } else piv.push(p);}
  const hs=piv.filter(p=>p.type==='H').slice(-4), ls=piv.filter(p=>p.type==='L').slice(-4);
  let hh=0,hl=0,lh=0,ll=0;
  if(hs.length>=2){hh=hs.at(-1).price>hs.at(-2).price?1:0;lh=hs.at(-1).price<hs.at(-2).price?1:0;}
  if(ls.length>=2){hl=ls.at(-1).price>ls.at(-2).price?1:0;ll=ls.at(-1).price<ls.at(-2).price?1:0;}
  let structure='رنج/انتقالی';
  if(hh&&hl)structure='صعودی (HH+HL)'; else if(lh&&ll)structure='نزولی (LH+LL)';
  const close=candles.at(-1).close, lastH=hs.at(-1)?.price, lastL=ls.at(-1)?.price;
  const buffer=(atrVal||close*0.005)*0.15;
  let event=null;
  if(lastH && close>lastH+buffer) event=structure.startsWith('صعودی')?'BOS صعودی':'CHoCH صعودی';
  else if(lastL && close<lastL-buffer) event=structure.startsWith('نزولی')?'BOS نزولی':'CHoCH نزولی';
  return {structure,event,hh:!!hh,hl:!!hl,lh:!!lh,ll:!!ll,pivots:piv.slice(-8),lastSwingHigh:lastH,lastSwingLow:lastL};
}

function detectClassicalPatterns(candles, structure){
  const out=[]; const hs=structure.pivots.filter(p=>p.type==='H').slice(-4), ls=structure.pivots.filter(p=>p.type==='L').slice(-4);
  const tol=0.012;
  if(hs.length>=2){
    const a=hs.at(-2),b=hs.at(-1); const between=ls.filter(x=>x.i>a.i&&x.i<b.i);
    if(Math.abs(a.price-b.price)/((a.price+b.price)/2)<tol && between.length){
      const neckline=Math.min(...between.map(x=>x.price));
      out.push({name:'Double Top',dir:'down',status:candles.at(-1).close<neckline?'CONFIRMED':'FORMING',neckline});
    }
  }
  if(ls.length>=2){
    const a=ls.at(-2),b=ls.at(-1); const between=hs.filter(x=>x.i>a.i&&x.i<b.i);
    if(Math.abs(a.price-b.price)/((a.price+b.price)/2)<tol && between.length){
      const neckline=Math.max(...between.map(x=>x.price));
      out.push({name:'Double Bottom',dir:'up',status:candles.at(-1).close>neckline?'CONFIRMED':'FORMING',neckline});
    }
  }
  if(hs.length>=3){
    const [a,b,c]=hs.slice(-3); if(b.price>a.price*(1+tol*.5)&&b.price>c.price*(1+tol*.5)&&Math.abs(a.price-c.price)/((a.price+c.price)/2)<tol){
      const mids=ls.filter(x=>x.i>a.i&&x.i<c.i); if(mids.length>=2){const neckline=(mids.at(-1).price+mids.at(-2).price)/2; out.push({name:'Head & Shoulders',dir:'down',status:candles.at(-1).close<neckline?'CONFIRMED':'FORMING',neckline});}
    }
  }
  if(ls.length>=3){ const [a,b,c]=ls.slice(-3); if(b.price<a.price*(1-tol*.5)&&b.price<c.price*(1-tol*.5)&&Math.abs(a.price-c.price)/((a.price+c.price)/2)<tol){
      const mids=hs.filter(x=>x.i>a.i&&x.i<c.i); if(mids.length>=2){const neckline=(mids.at(-1).price+mids.at(-2).price)/2; out.push({name:'Inverse Head & Shoulders',dir:'up',status:candles.at(-1).close>neckline?'CONFIRMED':'FORMING',neckline});}
    }}
  return out;
}

function wavePressureV2(candles,atrVal,pattern,structure,vol){
  const piv=structure?.pivots||[]; if(piv.length<4||!atrVal)return null;
  const waves=[]; for(let i=1;i<piv.length;i++){
    const a=piv[i-1],b=piv[i], dur=Math.max(1,b.i-a.i), disp=b.price-a.price;
    waves.push({dir:disp>0?'up':'down',dispPct:disp/a.price*100,duration:dur,eff:Math.abs(disp)/(atrVal*dur)});
  }
  const last=waves.at(-1); const ups=waves.filter(w=>w.dir==='up'), downs=waves.filter(w=>w.dir==='down');
  const avg=x=>x.length?x.reduce((a,b)=>a+b.eff,0)/x.length:0;
  const upEff=avg(ups), downEff=avg(downs);
  const expansion=waves.length>=3 ? Math.abs(waves.at(-1).dispPct)>Math.abs(waves.at(-2).dispPct) : false;
  const pullback=last?.dir==='up' ? downs : ups;
  const pullWeak=pullback.length>=2 && pullback.at(-1).eff<pullback.at(-2).eff;
  let bull=50 + clamp((upEff-downEff)*18,-25,25) + (last?.dir==='up'?7:-7) + (pullWeak&&last?.dir==='up'?8:0) + (expansion&&last?.dir==='up'?6:0);
  let bear=50 + clamp((downEff-upEff)*18,-25,25) + (last?.dir==='down'?7:-7) + (pullWeak&&last?.dir==='down'?8:0) + (expansion&&last?.dir==='down'?6:0);
  if(pattern?.breakout==='up') bull+=10; if(pattern?.breakout==='down') bear+=10;
  if(vol?.expanding && last){ if(last.dir==='up')bull+=6; else bear+=6; }
  bull=clamp(Math.round(bull)); bear=clamp(Math.round(bear));
  return {waves:waves.slice(-5),bullishPressure:bull,bearishPressure:bear,
    overall:Math.abs(bull-bear)<10?'متعادل (BALANCED PRESSURE)':bull>bear?'فشار صعودی غالب (BULLISH PRESSURE)':'فشار نزولی غالب (BEARISH PRESSURE)',
    upAcceleration:ups.length>=2?(ups.at(-1).eff>ups.at(-2).eff*1.1?'Accelerating':ups.at(-1).eff<ups.at(-2).eff*.9?'Decelerating':'Stable'):'داده ناکافی',
    downAcceleration:downs.length>=2?(downs.at(-1).eff>downs.at(-2).eff*1.1?'Accelerating':downs.at(-1).eff<downs.at(-2).eff*.9?'Decelerating':'Stable'):'داده ناکافی',
    pivotExpansion:expansion,pullbackWeakening:pullWeak};
}

function weightedAnalysisScore(parts){
  const weights={structure:20,trend:15,ichimoku:12,sr:10,volume:10,priceAction:8,wave:8,pattern:6,momentum:5,smc:4,fib:2};
  let directional=0,total=0;
  for(const k of Object.keys(weights)){ const v=clamp(parts[k]??0,-1,1); directional+=v*weights[k]; total+=weights[k]; }
  return {directional:+directional.toFixed(2),quality:clamp(Math.round(50+directional/2),0,100),weights};
}

function buildProfessionalPlan(dir,entry,atrVal,supports,resistances,quality,triggered=false){
  if(!entry||!atrVal)return null;
  const sup=supports?.filter(x=>x.price<entry).sort((a,b)=>b.price-a.price)[0]?.price;
  const res=resistances?.filter(x=>x.price>entry).sort((a,b)=>a.price-b.price)[0]?.price;
  const buffer=atrVal*0.20;
  let stop=dir==='LONG' ? Math.min(entry-atrVal*1.5,sup?sup-buffer:entry-atrVal*1.5) : Math.max(entry+atrVal*1.5,res?res+buffer:entry+atrVal*1.5);
  if((dir==='LONG'&&stop>=entry)||(dir==='SHORT'&&stop<=entry))return null;
  const risk=Math.abs(entry-stop);
  const tp1=entry+(dir==='LONG'?1:-1)*risk*1.5, tp2=entry+(dir==='LONG'?1:-1)*risk*2.5;
  const structural=dir==='LONG' ? resistances?.find(x=>x.price>tp2)?.price : supports?.slice().reverse().find(x=>x.price<tp2)?.price;
  const tp3=structural ?? entry+(dir==='LONG'?1:-1)*risk*4;
  return {direction:dir,active:triggered,entry,stopLoss:stop,takeProfit1:tp1,takeProfit2:tp2,takeProfit3:tp3,
    riskRewardTP1:1.5,riskRewardTP2:2.5,riskRewardTP3:+(Math.abs(tp3-entry)/risk).toFixed(2),
    state:triggered?5:3,entryState:triggered?'ENTRY VALID':'TRIGGER FORMED',quality};
}

function analyze(candles, htfCandles){
  if(!candles || candles.length<100) return {insufficient:true};
  const closes=candles.map(c=>c.close), volumes=candles.map(c=>c.volume), lastClose=closes.at(-1);
  const ema20=emaSeries(closes,20).at(-1), ema50=emaSeries(closes,50).at(-1), ema200=closes.length>=200?emaSeries(closes,200).at(-1):null;
  const rsiVal=rsi(closes,14), macdVal=macd(closes), atrVal=atr(candles,14), bb=bollinger(closes,20,2), stoch=stochastic(candles,14,3), adxVal=adx(candles,14);
  const divergence=detectRSIDivergence(candles,closes), fib=fibonacci(candles,80), vwapVal=vwap(candles.slice(-200));
  const structure=advancedStructure(candles,atrVal), legacyStructure=marketStructure(candles), ich=ichimoku(candles);
  const volume=volumeMetrics(candles), vp=volumeProfileLite(candles), liquidity=findLiquidityPools(candles,60,0.1), orderBlock=findOrderBlock(candles,atrVal), fvgs=findFVGs(candles,40);
  const chartPattern=detectChartPatterns(candles), classicalPatterns=detectClassicalPatterns(candles,structure);
  const patterns=[...detectPatterns(candles),...classicalPatterns.map(p=>({name:p.name+' — '+p.status,dir:p.dir}))];
  const waveEngine=wavePressureV2(candles,atrVal,chartPattern,structure,volume);
  const {highs,lows}=findSwingPoints(candles,3);
  const resistances=clusterLevels(highs.filter(x=>x>lastClose),0.15).sort((a,b)=>a.price-b.price).slice(0,4);
  const supports=clusterLevels(lows.filter(x=>x<lastClose),0.15).sort((a,b)=>b.price-a.price).slice(0,4);
  const htfTrend=htfCandles&&htfCandles.length>=80 ? (()=>{const hc=htfCandles.map(c=>c.close),e20=emaSeries(hc,20).at(-1),e50=emaSeries(hc,50).at(-1),l=hc.at(-1);return l>e20&&e20>e50?'up':l<e20&&e20<e50?'down':'mixed';})() : null;
  const nearestRes=resistances[0]?.price, nearestSup=supports[0]?.price;

  // هر جزء ابتدا به بازه -1..+1 نرمال می‌شود؛ اندیکاتورهای کم‌ارزش عمداً وزن پایین دارند.
  const trendRaw=ema200 ? (lastClose>ema20&&ema20>ema50&&ema50>ema200?1:lastClose<ema20&&ema20<ema50&&ema50<ema200?-1:lastClose>ema50?.45:-.45) : (lastClose>ema50?.35:-.35);
  let structureRaw=structure.structure.startsWith('صعودی')?0.75:structure.structure.startsWith('نزولی')?-0.75:0;
  if(structure.event?.includes('صعودی'))structureRaw=Math.max(structureRaw,.95); if(structure.event?.includes('نزولی'))structureRaw=Math.min(structureRaw,-.95);
  const ichRaw=ich?clamp((ich.score-50)/50,-1,1):0;
  const htfRaw=htfTrend==='up'?1:htfTrend==='down'?-1:0;
  let srRaw=0; if(nearestSup && pctDistance(lastClose,nearestSup)<1)srRaw+=.45; if(nearestRes && pctDistance(lastClose,nearestRes)<1)srRaw-=.45;
  if(lastClose>nearestRes)srRaw+=.8; if(lastClose<nearestSup)srRaw-=.8;
  let volRaw=clamp((volume.ratio-1)*1.5,-1,1); if(lastClose<closes.at(-2))volRaw=-Math.abs(volRaw); else volRaw=Math.abs(volRaw);
  let paRaw=0; patterns.forEach(p=>{paRaw+=p.dir==='up'?.35:p.dir==='down'?-.35:0}); paRaw=clamp(paRaw,-1,1);
  const waveRaw=waveEngine?clamp((waveEngine.bullishPressure-waveEngine.bearishPressure)/50,-1,1):0;
  let patRaw=chartPattern?.dirBias==='up'?.7:chartPattern?.dirBias==='down'?-.7:0;
  if(classicalPatterns.some(p=>p.status==='CONFIRMED')) patRaw += classicalPatterns.filter(p=>p.status==='CONFIRMED').reduce((a,p)=>a+(p.dir==='up'?.25:-.25),0);
  patRaw=clamp(patRaw,-1,1);
  let momRaw=0; if(macdVal.hist>0)momRaw+=.35; else momRaw-=.35; if(rsiVal>55&&rsiVal<70)momRaw+=.25; if(rsiVal<45&&rsiVal>30)momRaw-=.25; if(divergence?.bullishDiv)momRaw+=.25; if(divergence?.bearishDiv)momRaw-=.25; momRaw=clamp(momRaw,-1,1);
  let smcRaw=0; if(orderBlock)smcRaw+=orderBlock.dir==='bull'?.25:-.25; if(liquidity?.sweep)smcRaw+=liquidity.sweep.includes('صعودی')?.4:-.4; smcRaw=clamp(smcRaw,-1,1);
  let fibRaw=0; if(fib){const near=[.5,.618,.382].some(r=>pctDistance(lastClose,fib.levels[r])<.5); if(near)fibRaw=fib.impulseUp?.5:-.5;}

  const score=weightedAnalysisScore({structure:structureRaw,trend:(trendRaw*.65+htfRaw*.35),ichimoku:ichRaw,sr:srRaw,volume:volRaw,priceAction:paRaw,wave:waveRaw,pattern:patRaw,momentum:momRaw,smc:smcRaw,fib:fibRaw});
  let directional=score.directional;
  // HTF conflict is a hard quality penalty, not an invisible offset.
  const htfConflict=(htfTrend==='up'&&directional<0)||(htfTrend==='down'&&directional>0);
  let setupQuality=clamp(Math.round(50+directional/2 - (htfConflict?10:0) - (adxVal.adx<18?7:0)),0,100);
  const longTrigger=Boolean((structure.event?.includes('صعودی')||chartPattern?.breakout==='up'||classicalPatterns.some(p=>p.dir==='up'&&p.status==='CONFIRMED')) && volume.ratio>=1.1 && lastClose>ema20);
  const shortTrigger=Boolean((structure.event?.includes('نزولی')||chartPattern?.breakout==='down'||classicalPatterns.some(p=>p.dir==='down'&&p.status==='CONFIRMED')) && volume.ratio>=1.1 && lastClose<ema20);
  const nearSupport=nearestSup&&pctDistance(lastClose,nearestSup)<1.0, nearResistance=nearestRes&&pctDistance(lastClose,nearestRes)<1.0;
  const longReadiness=clamp(Math.round((setupQuality*.55)+(longTrigger?30:0)+(nearSupport?10:0)-(htfTrend==='down'?20:0)),0,100);
  const shortReadiness=clamp(Math.round((setupQuality*.55)+(shortTrigger?30:0)+(nearResistance?10:0)-(htfTrend==='up'?20:0)),0,100);
  let direction=directional>=0?'LONG':'SHORT';
  const readiness=direction==='LONG'?longReadiness:shortReadiness;
  let verdictClass='v-hold', verdict='NO TRADE — کیفیت یا تریگر کافی نیست';
  if(setupQuality>=80 && longReadiness>=80 && directional>15){verdictClass='v-buy';verdict='🟢 ENTER LONG — ستاپ با کیفیت بالا و تریگر تأییدشده';}
  else if(setupQuality>=80 && shortReadiness>=80 && directional<-15){verdictClass='v-sell';verdict='🔴 ENTER SHORT — ستاپ با کیفیت بالا و تریگر تأییدشده';}
  else if(setupQuality>=70 && directional>10){verdict='🟡 WAIT FOR LONG — ستاپ خوب است، اما ورود هنوز تأیید کامل ندارد';}
  else if(setupQuality>=70 && directional<-10){verdict='🟠 WAIT FOR SHORT — ستاپ خوب است، اما ورود هنوز تأیید کامل ندارد';}
  else if(setupQuality<60){verdict='⚪ NO TRADE — کیفیت ستاپ زیر حداقل آستانه است';}
  const planLong=buildProfessionalPlan('LONG',nearSupport||lastClose,atrVal,supports,resistances,setupQuality,longTrigger&&longReadiness>=80);
  const planShort=buildProfessionalPlan('SHORT',nearResistance||lastClose,atrVal,supports,resistances,setupQuality,shortTrigger&&shortReadiness>=80);
  const risk=verdictClass==='v-buy'?planLong:verdictClass==='v-sell'?planShort:null;
  const watchLong=planLong?{...planLong,active:false,trigger:`بسته‌شدن بالای مقاومت/تریگر با حجم ≥ ۱.۱x میانگین ۲۰ کندل؛ سپس تأیید مجدد ساختار`,state:longTrigger?4:nearSupport?2:1,entryState:longTrigger?'TRIGGER CONFIRMED':nearSupport?'LEVEL TOUCHED':'APPROACHING LEVEL'}:null;
  const watchShort=planShort?{...planShort,active:false,trigger:`بسته‌شدن زیر حمایت/تریگر با حجم ≥ ۱.۱x میانگین ۲۰ کندل؛ سپس تأیید مجدد ساختار`,state:shortTrigger?4:nearResistance?2:1,entryState:shortTrigger?'TRIGGER CONFIRMED':nearResistance?'LEVEL TOUCHED':'APPROACHING LEVEL'}:null;
  const notes=[];
  notes.push(`مدل امتیازدهی وزنی: Market Structure=20، Trend/HTF=15، Ichimoku=12، S/R=10، Volume=10، Price Action=8، Wave=8، Pattern=6، Momentum=5، SMC=4، Fibonacci=2.`);
  notes.push(`Setup Quality=${setupQuality}/100 | Entry Readiness=${readiness}/100 | امتیاز جهت‌دار=${directional.toFixed(1)}`);
  notes.push(`ساختار: ${structure.structure}${structure.event?' | '+structure.event:''}`);
  notes.push(`Ichimoku: ${ich?.priceVsCloud||'N/A'} | TK=${ich?.tkCross||'N/A'} | Future Cloud=${ich?.bullishFuture?'Bullish':'Bearish'}`);
  notes.push(`حجم: ${volume.ratio.toFixed(2)}x میانگین ۲۰ کندل | ADX=${adxVal.adx.toFixed(1)}`);
  if(htfConflict)notes.push('⚠ تعارض تایم‌فریم بالاتر با جهت فعلی؛ کیفیت سیگنال کاهش داده شد.');
  if(!longTrigger&&!shortTrigger)notes.push('تریگر بسته‌شدن + حجم هنوز تأیید نشده؛ لمس سطح ورود محسوب نمی‌شود.');
  const confidence=clamp(Math.round(setupQuality*(readiness/100)),5,95);
  return {
    lastClose,ema20,ema50,ema200,rsiVal,macdVal,atrVal,bb,stoch,adxVal,divergence,htfTrend,fib,vwapVal,structure:legacyStructure||structure,
    advancedStructure:structure,ichimoku:ich,orderBlock,fvgs,liquidity,volumeMetrics:volume,volumeProfile:vp,resistances,supports,patterns,chartPattern,classicalPatterns,waveEngine,
    recentSwingHighs:highs.slice(-8),recentSwingLows:lows.slice(-8),notes,
    score:directional,setupQuality,entryReadiness:readiness,confidence,verdict,verdictClass,risk,watchLong,watchShort,
    entryState:verdictClass==='v-buy'||verdictClass==='v-sell'?'ENTRY VALID':longReadiness>=70||shortReadiness>=70?'TRIGGER FORMED':'NO SETUP',
    trendScore:Math.round(trendRaw*2),momScore:Math.round(momRaw*2),paScore:Math.round(paRaw*2),volScore:Math.round(volRaw*2),srScore:Math.round(srRaw*2),htfScore:Math.round(htfRaw*2),vwapScore:lastClose>vwapVal?1:-1,structureScore:Math.round(structureRaw*2),fibScore:Math.round(fibRaw*2),obScore:orderBlock?(orderBlock.dir==='bull'?1:-1):0,liqScore:liquidity?.sweep?(liquidity.sweep.includes('صعودی')?1:-1):0,
    componentScores:{structure:structureRaw,trend:trendRaw,ichimoku:ichRaw,supportResistance:srRaw,volume:volRaw,priceAction:paRaw,wave:waveRaw,pattern:patRaw,momentum:momRaw,smc:smcRaw,fibonacci:fibRaw},
    dataQuality:{ok:true,closedCandles:true,candleCount:candles.length,lastClosedTime:candles.at(-1)?.closeTime}
  };
}

// ---------- Stability Engine V2: جلوگیری از flapping بین اسکن‌ها ----------
const STABILITY_V2={persistMs:15*60*1000,rankAdvantage:8,scoreDeltaKeep:5};
function applySignalStability(items,mode='scan'){
  const now=Date.now(), key='scanner_stability_v2'; let old={}; try{old=JSON.parse(localStorage.getItem(key)||'{}')}catch(e){}
  const out=items.map((x,i)=>{
    const id=x.symbol; const prev=old[id]; const current={symbol:id,score:x.score,quality:x.setupQuality,verdict:x.verdictClass,state:x.entryState,t:now};
    if(prev){
      const delta=Math.abs((x.score||0)-(prev.score||0));
      const sameDirection=(x.verdictClass===prev.verdict);
      const within=now-prev.t<STABILITY_V2.persistMs;
      x.stability={sameDirection,scoreDelta:+delta.toFixed(2),withinPersistence:within,changedReason:delta>15?'material score change':sameDirection?'NO MATERIAL CHANGE':'direction/state changed'};
      if(within && delta<STABILITY_V2.scoreDeltaKeep && prev.verdict!=='v-none') x.stableRank=true;
    }
    old[id]=current; return x;
  });
  try{localStorage.setItem(key,JSON.stringify(old));}catch(e){}
  out.sort((a,b)=>{
    const sa=(a.setupQuality||0)+(a.stableRank?4:0), sb=(b.setupQuality||0)+(b.stableRank?4:0);
    return sb-sa;
  });
  return out;
}

// ---------- پایداری سیگنال بین رفرش‌ها (جلوگیری از تغییر مکرر سیگنال به‌خاطر نوسان کندل زنده) ----------
// چون از این پس تحلیل فقط روی کندل‌های کاملاً بسته‌شده انجام می‌شود، بخش زیادی از تغییرات لحظه‌به‌لحظه
// خودبه‌خود حذف می‌شود. این تابع فقط یک لایهٔ اضافه است: نشان می‌دهد سیگنال فعلی از چند کندل بستهٔ اخیر
// پیوسته تکرار شده یا همین الان تغییر کرده (که باید با احتیاط بیشتری با آن برخورد شود).
function trackSignalStability(symbol, interval, verdictClass, lastClosedTime){
  const key = `sigHistory_${symbol}_${interval}`;
  let history = [];
  try{ history = JSON.parse(localStorage.getItem(key) || '[]'); }catch(e){ history = []; }
  if(!lastClosedTime){
    return { justChanged:false, stableCount:1 };
  }
  if(!history.length || history.at(-1).t !== lastClosedTime){
    history.push({ t: lastClosedTime, v: verdictClass });
    history = history.slice(-8);
    try{ localStorage.setItem(key, JSON.stringify(history)); }catch(e){}
  }
  let stableCount = 0;
  for(let i=history.length-1;i>=0;i--){
    if(history[i].v === verdictClass) stableCount++; else break;
  }
  const prevDifferent = history.length>=2 && history.at(-2).v !== verdictClass;
  return { justChanged: prevDifferent && stableCount===1, stableCount };
}

function label(scoreVal){
  if(scoreVal>0) return `<span class="tag tag-up">مثبت (+${scoreVal})</span>`;
  if(scoreVal<0) return `<span class="tag tag-down">منفی (${scoreVal})</span>`;
  return `<span class="tag tag-neu">خنثی (0)</span>`;
}

function renderResult(res, symbol, interval, lastClosedTime){
  if(res.insufficient){
    els.verdictBox.className = 'verdict v-none';
    els.verdictBox.textContent = 'داده کافی برای تحلیل معتبر وجود ندارد (حداقل ۶۰ کندل لازم است). به‌جای حدس زدن، تحلیلی ارائه نمی‌شود.';
    ['qualityCard','scoreCard','srCard','indCard','paCard','waveCard','reasonCard','riskCard','aiCard'].forEach(id=>document.getElementById(id).style.display='none');
    return;
  }

  const stability = trackSignalStability(symbol, interval, res.verdictClass, lastClosedTime);
  els.verdictBox.className = 'verdict ' + res.verdictClass;
  let stabilityNote;
  if(stability.justChanged){
    stabilityNote = `⚠ سیگنال همین کندل بسته‌شدهٔ اخیر تغییر کرده — هنوز فقط ۱ کندل آن را تأیید می‌کند، برای اطمینان بیشتر منتظر تأیید کندل بعدی هم بمان.`;
  } else if(stability.stableCount >= 2){
    stabilityNote = `پایداری سیگنال: همین وضعیت در ${stability.stableCount} کندل بستهٔ اخیر پیوسته تکرار شده (نوسان کاذب کمتر).`;
  } else {
    stabilityNote = `این اولین بار است که این وضعیت روی این نماد/تایم‌فریم ثبت می‌شود.`;
  }
  els.verdictBox.innerHTML = res.verdict + `<br><span style="font-size:12px;font-weight:400">امتیاز: ${res.score} | سطح اطمینان: ${res.confidence}%</span><br><span style="font-size:11px;font-weight:400;opacity:.85">${stabilityNote}</span>`;

  const qualityCard=document.getElementById('qualityCard');
  if(qualityCard){
    qualityCard.style.display='block';
    document.getElementById('setupQuality').textContent=`${res.setupQuality||0}/100`;
    document.getElementById('entryReadiness').textContent=`${res.entryReadiness||0}/100`;
    document.getElementById('entryState').textContent=res.entryState||'NO SETUP';
    document.getElementById('dominantDirection').textContent=res.score>0?'LONG':res.score<0?'SHORT':'NEUTRAL';
  }

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
  const riskContent = document.getElementById('riskContent');
  function planRows(p){
    const capital = Math.max(+els.capitalInput.value || 0, 0);
    const riskPct = Math.min(Math.max(+els.riskPctInput.value || 0, 0), 100);
    const riskAmountUSDT = capital * riskPct / 100;
    const perUnitRisk = Math.abs(p.entry - p.stopLoss);
    const posSizing = (capital>0 && riskPct>0 && perUnitRisk>0) ? {
      riskAmountUSDT: +riskAmountUSDT.toFixed(2),
      units: +(riskAmountUSDT / perUnitRisk).toFixed(6),
      positionValueUSDT: +((riskAmountUSDT / perUnitRisk) * p.entry).toFixed(2)
    } : null;
    p.positionSizing = posSizing; // برای گنجاندن در dataSummary ارسالی به AI
    return `
      <div class="row"><span>نقطه ورود (Entry)</span><span>${p.entry.toFixed(4)}</span></div>
      <div class="row"><span>حد ضرر (Stop Loss)</span><span>${p.stopLoss.toFixed(4)}</span></div>
      <div class="row"><span>حد سود ۱ (TP1)</span><span>${p.takeProfit1.toFixed(4)} (R:R ${p.riskRewardTP1})</span></div>
      <div class="row"><span>حد سود ۲ (TP2)</span><span>${p.takeProfit2.toFixed(4)} (R:R ${p.riskRewardTP2})</span></div>
      <div class="row"><span>حد سود ۳ (TP3)</span><span>${p.takeProfit3.toFixed(4)} (R:R ${p.riskRewardTP3})</span></div>
      <div class="row"><span>لوریج پیشنهادی (آموزشی)</span><span>${p.suggestedLeverage}</span></div>
      ${posSizing ? `<div class="row"><span>سایز پوزیشن (بر اساس سرمایه/ریسک واردشده)</span><span>${posSizing.units} واحد (${posSizing.positionValueUSDT} USDT)</span></div>
      <p class="muted">با سرمایهٔ ${capital} USDT و ریسک ${riskPct}٪، حداکثر ضرر مجاز این ترید ${posSizing.riskAmountUSDT} USDT است.</p>` : '<p class="muted">برای محاسبهٔ سایز پوزیشن، سرمایه و درصد ریسک را از هدر بالا وارد کن.</p>'}
      <p class="muted" style="margin-top:6px">${p.estimatedFeeNote}</p>`;
  }
  if(res.risk || res.watchLong || res.watchShort){
    riskCard.style.display='block';
    let html = '';
    if(res.risk){
      html += `<div class="verdict ${res.risk.direction==='LONG'?'v-buy':'v-sell'}" style="font-size:14px;padding:8px;margin-bottom:8px">
        🎯 ستاپ فعال — ${res.risk.direction} (STATE ${res.risk.state}: ${res.risk.entryState})</div>`;
      html += planRows(res.risk);
    } else {
      html += `<p class="muted" style="margin-bottom:8px">⚪ در حال حاضر سیگنال قاطعی صادر نشده (STATE 0-3: هنوز TRIGGER تأیید نشده) — بنابراین «ورود الان» توصیه نمی‌شود. سناریوهای شرطی زیر را زیر نظر بگیر:</p>`;
      if(res.watchLong){
        html += `<h3 style="margin-top:10px">🟡 سناریوی شرطی LONG (${res.watchLong.entryState})</h3>
          <p class="muted">تریگر لازم: ${res.watchLong.trigger}</p>` + planRows(res.watchLong);
      }
      if(res.watchShort){
        html += `<h3 style="margin-top:10px">🟠 سناریوی شرطی SHORT (${res.watchShort.entryState})</h3>
          <p class="muted">تریگر لازم: ${res.watchShort.trigger}</p>` + planRows(res.watchShort);
      }
      if(!res.watchLong && !res.watchShort){
        html += `<p class="muted">سطح حمایت/مقاومت معتبری برای تعریف سناریوی شرطی شناسایی نشد — داده ناکافی است.</p>`;
      }
    }
    riskContent.innerHTML = html;
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
  const ichRow=document.getElementById('ind_ichimoku');
  if(ichRow) ichRow.textContent=res.ichimoku?`${res.ichimoku.priceVsCloud} | TK ${res.ichimoku.tkCross} | ${res.ichimoku.score}/100`: '—';
  const vr=document.getElementById('ind_volratio'); if(vr) vr.textContent=res.volumeMetrics?`${res.volumeMetrics.ratio.toFixed(2)}x`: '—';

  const bbRow=document.getElementById('ind_bb_row'), stochRow=document.getElementById('ind_stoch_row'), adxRow=document.getElementById('ind_adx_row');
  if(bbRow){ bbRow.style.display='flex'; document.getElementById('ind_bb').textContent = `${res.bb.lower.toFixed(4)} / ${res.bb.mid.toFixed(4)} / ${res.bb.upper.toFixed(4)}`; }
  if(stochRow){ stochRow.style.display='flex'; document.getElementById('ind_stoch').textContent = `K=${res.stoch.k.toFixed(1)} D=${res.stoch.d.toFixed(1)}`; }
  if(adxRow){ adxRow.style.display='flex'; document.getElementById('ind_adx').textContent = `${res.adxVal.adx.toFixed(1)} (${res.adxVal.adx>=25?'روند قوی':'رنج/ضعیف'})`; }

  document.getElementById('paCard').style.display='block';
  const candleTags = res.patterns.map(p=>`<span class="tag ${p.dir==='up'?'tag-up':p.dir==='down'?'tag-down':'tag-neu'}">${p.name}</span>`).join(' ');
  const chartTag = res.chartPattern
    ? `<span class="tag ${res.chartPattern.dirBias==='up'?'tag-up':res.chartPattern.dirBias==='down'?'tag-down':'tag-neu'}" title="${res.chartPattern.status}">${res.chartPattern.type}</span>`
    : '';
  document.getElementById('paPatterns').innerHTML = (candleTags || chartTag)
    ? [chartTag, candleTags].filter(Boolean).join(' ')
    : '<span class="muted">پترن قابل‌اتکایی در کندل‌های اخیر شناسایی نشد</span>';

  const waveCard = document.getElementById('waveCard');
  if(res.waveEngine){
    waveCard.style.display='block';
    const we = res.waveEngine;
    let wh = `<div class="row"><span>فشار صعودی (Bullish Pressure)</span><span>${we.bullishPressure}/۱۰۰</span></div>`;
    wh += `<div class="row"><span>فشار نزولی (Bearish Pressure)</span><span>${we.bearishPressure}/۱۰۰</span></div>`;
    wh += `<div class="row"><span>نتیجهٔ کلی</span><span>${we.overall}</span></div>`;
    wh += `<div class="row"><span>شتاب موج صعودی</span><span>${we.upAcceleration}</span></div>`;
    wh += `<div class="row"><span>شتاب موج نزولی</span><span>${we.downAcceleration}</span></div>`;
    wh += `<div class="row"><span>روند فاصلهٔ پیوت‌ها</span><span>${we.pivotTrend}</span></div>`;
    wh += '<p class="muted" style="margin-top:8px">آخرین موج‌ها (جدیدترین در پایین):</p><ul>';
    we.waves.forEach(w=>{
      wh += `<li>${w.dir==='up'?'صعودی ⬆':'نزولی ⬇'} ${w.priceDispPct}% در ${w.duration} کندل — قدرت: ${w.strength} (بازده نرمال‌شده با ATR: ${w.efficiencyNorm})</li>`;
    });
    wh += '</ul><p class="muted">⚠ این فقط «فشار» جهت احتمالی شکست است، نه تأیید شکست؛ تا زمانی که کندل واقعاً بیرون از سطح/الگو بسته نشود، سیگنال ورود از این بخش استخراج نکن.</p>';
    document.getElementById('waveContent').innerHTML = wh;
  } else {
    waveCard.style.display='none';
  }

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
    symbol, workingInterval: interval, dataQuality: res.dataQuality,
    lastClose: res.lastClose, ema20: res.ema20, ema50: res.ema50, ema200: res.ema200,
    rsi: res.rsiVal, macd: res.macdVal, atr: res.atrVal,
    bollinger: res.bb, stochastic: res.stoch, adx: res.adxVal, rsiDivergence: res.divergence,
    higherTimeframeTrend: res.htfTrend,
    multiTimeframeAnalysis: mtf, // روند/ساختار مستقل هر تایم‌فریم: 1d, 4h, 1h, 15m, 5m
    fibonacci: res.fib, vwap: res.vwapVal, marketStructure: res.structure,
    orderBlock: res.orderBlock, fairValueGaps: res.fvgs, liquidity: res.liquidity,
    resistances: res.resistances, supports: res.supports,
    patterns: res.patterns.map(p=>p.name),
    chartPattern: res.chartPattern,
    setupQuality: res.setupQuality, entryReadiness: res.entryReadiness, entryState: res.entryState,
    componentScoresV2: res.componentScores, ichimoku: res.ichimoku, volumeMetrics: res.volumeMetrics, volumeProfile: res.volumeProfile, advancedStructure: res.advancedStructure, classicalPatterns: res.classicalPatterns,
    waveStrengthEngine: res.waveEngine, // موج‌های اخیر با قدرت/شتاب/فشار شکست صعودی و نزولی (0-100) // کانال/مثلث/گوه شناسایی‌شده روی سوئینگ‌های اخیر (یا null)
    recentSwingHighs: res.recentSwingHighs, // آخرین قله‌های سوئینگ واقعی (برای بررسی دبل‌تاپ/سر-و-شانه و... توسط AI)
    recentSwingLows: res.recentSwingLows,  // آخرین دره‌های سوئینگ واقعی (برای بررسی دبل‌باتم و...)
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
    suggestedRiskManagement: res.risk, // فقط وقتی سیگنال قاطع (STATE 5) است پر است
    watchLongScenario: res.watchLong,  // سناریوی شرطی صعودی (STATE 1 یا 2) با entry/SL/TP و trigger مورد نیاز
    watchShortScenario: res.watchShort, // سناریوی شرطی نزولی
    // داده‌هایی که این پلتفرم به آن‌ها دسترسی ندارد — AI موظف است برای همین موارد صراحتاً بگوید «داده در دسترس نیست»
    notAvailable: ['Order Flow', 'Open Interest', 'Funding Rate', 'Long/Short Ratio', 'اخبار/رویدادهای فاندامنتال']
  };

  aiText.textContent = 'در حال تحلیل توسط AI...';

  const prompt = `تو یک Senior Crypto Market Structure Analyst هستی که طبق یک چارچوب قانون‌محور و محافظه‌کارانه کار می‌کند. هدف تو پیش‌بینی بازار نیست؛ هدف، فیلتر کردن سیگنال‌های کم‌ابهام و رد کردن بقیه است. «WAIT / NO TRADE» یک نتیجهٔ کاملاً معتبر و اغلب ترجیحی است، نه شکست تحلیل.

## محدودیت حیاتی داده (اجباری، بدون استثنا)
تمام اعداد، سطوح، اندیکاتورها و پترن‌های زیر **از قبل روی کندل‌های واقعی و زندهٔ Binance محاسبه شده‌اند** و در JSON انتهای پیام (dataSummary) آمده‌اند.
- هیچ عدد/قیمت/سطح/رویدادی که در JSON نیست اختراع نکن.
- فیلد notAvailable نشان می‌دهد Order Flow، Open Interest، Funding Rate، Long/Short Ratio و اخبار فاندامنتال در دسترس نیستند — برای این موارد فقط بنویس «داده در دسترس نیست» و هرگز ادعای Whale Activity یا Smart Money بدون مبنای واقعی نکن.
- اگر dataQuality پرچم مشکل داشت یا اعداد به‌هم نمی‌خوردند، بنویس «DATA SYNCHRONIZATION ERROR» و به NO TRADE برو.
- تایم‌فریم کاری فعلی workingInterval است؛ داده مولتی‌تایم‌فریم در multiTimeframeAnalysis (1d/4h/1h/15m/5m در صورت وجود) آمده. هر عددی که از یک تایم‌فریم می‌آوری را برچسب‌گذاری کن، هرگز اندیکاتورهای تایم‌فریم‌های مختلف را بی‌برچسب قاطی نکن.

## موتور امتیازدهی V2 (اجباری)
- Setup Quality عدد ۰ تا ۱۰۰ برای کیفیت خود ستاپ است؛ Entry Readiness عدد ۰ تا ۱۰۰ برای آماده‌بودن ورود همین لحظه است. این دو را هرگز یکی فرض نکن.
- وزن‌ها: Market Structure 20، Trend/HTF 15، Ichimoku 12، Support/Resistance 10، Volume 10، Price Action 8، Wave 8، Chart Pattern 6، Momentum 5، SMC/Liquidity 4، Fibonacci 2.
- Market Structure و HTF نسبت به RSI/MACD اولویت دارند. یک اندیکاتور منفرد حق ساختن سیگنال ندارد.
- اگر HTF با جهت فعلی متعارض است، آن را Counter-trend اعلام کن و کیفیت را کاهش بده.
- فقط وقتی ENTER صادر کن که کیفیت بالا، جهت ساختاری روشن، تریگر بسته‌شدن و تأیید حجم/مومنتوم و R:R قابل‌قبول هم‌زمان وجود داشته باشد؛ در غیر این صورت WAIT/NO TRADE.

## اصل اصلی
سیگنال معتبر فقط وقتی صادر می‌شود که: Context بازار + ساختار بازار (marketStructure) + سطح کلیدی (resistances/supports/fibonacci) + پرایس‌اکشن (patterns) + الگوی نموداری (chartPattern: کانال/مثلث/گوه، در صورت وجود) + تریگر ورود + تأیید (حجم/مومنتوم) + ریسک به ریوارد قابل‌قبول همگی هم‌راستا باشند. اگر یکی از این‌ها ناقص یا متناقض بود → WAIT.

## نکات مهم برای الگوهای نموداری (کانال و مثلث)
فیلد chartPattern (اگر null نباشد) نتیجهٔ برازش خط روند روی سوئینگ‌های اخیر است: type (مثلاً «مثلث صعودی»، «کانال نزولی»، «Rising/Falling Wedge»، «Broadening Formation»)، dirBias (سوگیری جهتی الگو)، status (آیا هنوز داخل الگوست یا شکسته)، upperLineNow/lowerLineNow (قیمت لحظه‌ای دو خط روند).
- هرگز فقط لمس خط روند را «شکست» تلقی نکن؛ فقط وقتی status نشان‌دهندهٔ breakout/breakdown است می‌توانی به آن به‌عنوان تریگر احتمالی اشاره کنی، و باز هم باید با حجم/کندل بسته‌شده تأیید شود (که در dataSummary نیست، پس صراحتاً بنویس «نیازمند تأیید کندل بعدی/حجم»).
- مثلث‌ها و کانال‌های همگرا (Wedge) را با احتیاط بیشتری تحلیل کن؛ فقط چون قیمت نزدیک رأس مثلث است دلیل بر شکست قریب‌الوقوع در جهت خاص نیست.

## چارچوب تحلیل (این ترتیب را رعایت کن، در خروجی نهایی خلاصه‌شده و به فارسی روان بنویس)
1. **Market Regime**: بر اساس multiTimeframeAnalysis روند هر تایم‌فریم (4H بالاتر، سپس 1H، 15M، 5M/کاری) را جدا مشخص کن؛ ADX را فقط برای قدرت روند بخوان، نه جهت.
2. **Market Structure**: HH/HL یا LH/LL و آخرین BOS/CHoCH از marketStructure؛ آیا شکست تأییدشده است یا احتمال Fake Breakout.
3. **Key Levels**: فقط سطوح مهم resistances/supports با قیمت و قدرت (strength)، و هم‌پوشانی‌شان با fibonacci.levels یا vwap/emaها.
4. **Chart Pattern (کانال/مثلث)**: طبق بخش بالا.
5. **Price Action (کندلی)**: پترن‌های patterns را در بستر ساختار بازار توضیح بده، نه فقط اسم‌شان؛ یک کندل تنها بدون هم‌راستایی با ساختار = ضعیف.
6. **Indicators**: RSI (و rsiDivergence)، MACD، EMA20/50/200، VWAP، Bollinger، Stochastic، ADX — فقط تأیید هستند، هرگز به‌تنهایی سیگنال نمی‌سازند (RSI زیر ۳۰ خودکار BUY نیست، بالای ۷۰ خودکار SELL نیست).
7. **Liquidity/Smart Money**: از orderBlock، fairValueGaps، liquidity — فقط با داده موجود.
8. **Confluence Score**: از componentScores و totalConfluenceScore/confidencePercent استفاده کن؛ اگر پایین است (یا ruleBasedVerdict نامشخص/HOLD)، صراحتاً کیفیت را پایین اعلام کن.
9. **State**: وضعیت فعلی راه‌اندازی را یکی از این‌ها اعلام کن: NO SETUP / APPROACHING LEVEL / LEVEL TOUCHED / TRIGGER FORMED / ENTRY VALID / INVALIDATED. فقط TRIGGER FORMED به بالا مجاز است به سناریوی ورود اشاره کند؛ صرف لمس یک سطح یا خط کانال/مثلث هرگز ENTRY نیست.
10. **Trading Scenarios**: حداقل دو سناریوی شرطی (LONG/SHORT) با Entry Zone، Trigger، Invalidation/Stop، TP1، TP2، R:R — این اعداد را فقط از suggestedRiskManagement و سطوح واقعی S/R/Fibonacci/کانال بردار، هرگز عدد جدید نساز. اگر قیمت از ناحیهٔ ورود ایدئال دور افتاده، صراحتاً بنویس «دیر شده — منتظر پولبک بمان»، هرگز ورود دیرهنگام را توصیه نکن.
11. **Final Decision**: دقیقاً یکی: 🟢 ENTER LONG / 🔴 ENTER SHORT / 🟡 WAIT FOR LONG / 🟠 WAIT FOR SHORT / ⚪ NO TRADE.
12. **One-line Action**: یک جملهٔ عملیاتی صریح برای همین لحظه.

## موتور پیشرفتهٔ الگوهای نموداری کلاسیک (اجباری)
علاوه بر chartPattern (کانال/مثلث/گوه محاسبه‌شده)، با استفاده از recentSwingHighs و recentSwingLows (که مقادیر واقعی قله/درهٔ سوینگ‌های اخیر هستند، نه تخمین بصری) بررسی کن آیا الگوهای زیر با شواهد ساختاری کافی وجود دارند: دبل‌تاپ/دبل‌باتم، سر-و-شانه/سر-و-شانه معکوس، تریپل‌تاپ/باتم، فلگ/پنانت (نیازمند یک ایمپالس قبلی واضح در marketStructure)، مستطیل/رنج، کاپ-اند-هندل، بادبزنی.
قوانین سخت این بخش:
- هرگز الگو را فقط چون «شبیه» است تأیید نکن؛ حداقل شرایط ساختاری (مثلاً دو قله نزدیک به هم با یک نکلاین مشخص برای دبل‌تاپ) باید برقرار باشد.
- اگر شواهد کافی در recentSwingHighs/recentSwingLows/resistances/supports نبود، صراحتاً بنویس «PATTERN: NONE DETECTED» و ادامه نده.
- هر الگوی تأییدشده باید وضعیت FORMING / TRIGGERED / CONFIRMED / INVALIDATED بگیرد؛ فقط CONFIRMED (با بسته‌شدن کندل بیرون از نکلاین/الگو) می‌تواند در سناریوی معاملاتی قوی نقش داشته باشد.
- تارگت الگو را فقط با فرمول کلاسیک اندازه‌گیری‌شده (فاصلهٔ الگو تا نکلاین، تصویر شده در جهت شکست) حساب کن، نه عدد دلخواه؛ اگر نمی‌توانی این فاصله را از داده‌های موجود دقیق حساب کنی، بنویس «تارگت الگو قابل‌محاسبهٔ دقیق نیست، به سطوح S/R واقعی رجوع کن».
- اگر chartPattern (کانال/مثلث) و یک الگوی کلاسیک دیگر هم‌زمان با هم هم‌راستا بودند، آن را confluence مثبت اعلام کن؛ اگر متناقض بودند، صریحاً تناقض را بگو و اعتماد را کم کن.

## ستاپ ورود نهایی (اجباری — همیشه، فارغ از قاطع بودن یا نبودن سیگنال، این بخش باید در پاسخ باشد)
- اگر suggestedRiskManagement مقدار داشت (یعنی STATE=5، سیگنال قاطع BUY/SELL): این را «ستاپ فعال» بنویس با: جهت، Entry، کارمزد تخمینی (از estimatedFeeNote)، Stop Loss، TP1/TP2/TP3 با R:R هرکدام، لوریج پیشنهادی (از suggestedLeverage) — همراه با یادآوری که لوریج صرفاً آموزشی است و توصیهٔ مالی نیست.
- اگر suggestedRiskManagement خالی بود (سیگنال HOLD/ضعیف است): به‌جایش watchLongScenario و/یا watchShortScenario را به‌عنوان «سناریوی شرطی (PRIMARY/ALTERNATIVE)» با همان ساختار (Entry/SL/TP1/TP2/TP3/لوریج) به‌علاوهٔ فیلد trigger (شرط لازم برای معتبر شدن) و entryState (APPROACHING LEVEL یا LEVEL TOUCHED) بنویس. این را IF/THEN بنویس، مثلاً: «IF قیمت trigger را با کندل بسته و حجم تأیید کند THEN سناریو معتبر می‌شود، در غیر این صورت WAIT».
- در هیچ حالتی صفحه/پاسخ نباید بدون بخش «ستاپ» بماند — همیشه حداقل یک سناریوی شرطی (ولو ضعیف) یا دلیل روشن نبود آن (مثلاً نبود resistances/supports معتبر) باید ذکر شود.
- تمام اعداد این بخش را فقط از suggestedRiskManagement / watchLongScenario / watchShortScenario بردار، هرگز عدد جدید نساز. اگر قیمت از ناحیهٔ ورود ایدئال دور افتاده، بنویس «دیر شده — منتظر پولبک بمان»، هرگز ورود دیرهنگام را توصیه نکن.

## موتور قدرت موج (Wave Strength Engine)
فیلد waveStrengthEngine (اگر null نباشد) موج‌های اخیر قیمتی را با معیار عینی (جابه‌جایی قیمت٪، تعداد کندل، بازدهی نرمال‌شده با ATR) اندازه‌گیری کرده و دو عدد «فشار شکست صعودی/نزولی» (۰ تا ۱۰۰) داده است.
- این عدد «فشار» است، نه «تأیید شکست». هرگز فشار بالا را معادل ENTRY یا شکست تأییدشده معرفی نکن؛ فقط بگو کدام جهت مومنتوم قوی‌تری دارد و آیا این مومنتوم در حال شتاب‌گرفتن یا افت است.
- اگر قیمت مدام سقف بالاتر می‌سازد ولی efficiency/دامنهٔ موج‌ها رو به کاهش است (واگرایی قدرت موج از قیمت)، این را صراحتاً به‌عنوان هشدار ضعیف‌شدن روند/احتمال توزیع یا شکست ناموفق ذکر کن.

## موتور مدیریت ریسک حرفه‌ای (سایز پوزیشن)
اگر positionSizing در داده پر بود، سایز پوزیشن (مقدار واحد دارایی و ارزش دلاری) را دقیقاً از همان اعداد گزارش کن؛ این بر اساس سرمایه و درصد ریسک واردشدهٔ کاربر و فاصلهٔ Entry تا Stop Loss محاسبه شده، نه فرض دلخواه.

Harmonic Patterns (Gartley/Bat/Butterfly/Crab/...)، Elliott Wave، Volume Profile (POC/VAH/VAL)، Order Flow، Open Interest، Funding Rate، Liquidations، اخبار/فاندامنتال زنده و داده آن‌چین در این پلتفرم محاسبه نمی‌شوند. اگر کاربر این‌ها را خواست یا فکر کردی مرتبط است، فقط بنویس «این داده روی این پلتفرم در دسترس نیست» — هرگز مقدار نساز.


- هرگز نگو «۱۰۰٪ مطمئن»، «تضمینی» یا «بدون ریسک».
- هرگز oversold را مساوی صعودی، overbought را مساوی نزولی، ADX بالا را مساوی جهت صعودی نگیر.
- هرگز لمس یک سطح/خط روند/کانال را مساوی شکست یا برگشت تأییدشده نگیر.
- هرگز قیمتی را که خیلی از ناحیهٔ ورود دور شده چیس نکن.
- اگر شواهد متناقض بود (مثلاً تایم‌فریم پایین برخلاف تایم‌فریم بالا)، آن را «Counter-trend» برچسب بزن و اعتماد را کاهش بده، پنهانش نکن.
- در پایان یادآوری کوتاه کن که این تحلیل آموزشی است و توصیهٔ مالی قطعی نیست.

لحن: حرفه‌ای، دقیق، بدون اغراق یا شعار تبلیغاتی. فقط از داده‌های dataSummary زیر استفاده کن.

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
          model:'gpt-5-mini',
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

// =========================================================
// ---------- اسکنر بازار (Section 2-4، 20-22، 29-31 چارچوب کاربر) ----------
// اسکن Top USDT pairs بایننس، فیلتر نقدشوندگی، فیلتر BTC، رتبه‌بندی بهترین Setupهای Long/Short
// =========================================================
const LEVERAGED_RE = /(UP|DOWN|BULL|BEAR)USDT$/i;
const STABLE_QUOTE_RE = /^(USDC|BUSD|TUSD|FDUSD|DAI)USDT$/i;

async function fetchTop24hTickers(limit=30){
  const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
  if(!res.ok) throw new Error('عدم دسترسی به داده ۲۴ساعتهٔ بایننس');
  const all = await res.json();
  return all
    .filter(t => t.symbol.endsWith('USDT') && !LEVERAGED_RE.test(t.symbol) && !STABLE_QUOTE_RE.test(t.symbol))
    .map(t => ({ symbol:t.symbol, quoteVolume:+t.quoteVolume, priceChangePercent:+t.priceChangePercent, lastPrice:+t.lastPrice }))
    .filter(t => t.quoteVolume > 0)
    .sort((a,b)=>b.quoteVolume-a.quoteVolume)
    .slice(0, limit);
}

// فیلتر BTC (SECTION 4) — بایاس کلی بازار، هرگز به‌تنهایی BUY/SELL نمی‌سازد فقط وزن می‌دهد
async function getBTCBias(){
  try{
    const c1h = await fetchKlines('BTCUSDT','1h',150);
    const c4h = await fetchKlines('BTCUSDT','4h',150);
    const snap1h = quickTrendSnapshot(c1h);
    const snap4h = quickTrendSnapshot(c4h);
    let bias = 'مختلط/نامشخص';
    if(snap4h.trend==='صعودی' && snap1h.trend!=='نزولی') bias = 'صعودی';
    else if(snap4h.trend==='نزولی' && snap1h.trend!=='صعودی') bias = 'نزولی';
    return { bias, snap1h, snap4h };
  }catch(e){ return { bias:'نامشخص (خطا در دریافت)', snap1h:{available:false}, snap4h:{available:false} }; }
}

// فیلتر اول سریع (SECTION 3) روی تایم‌فریم ۱ساعته برای همهٔ کاندیدها، بدون تحلیل عمیق
async function quickFilterCandidates(tickers){
  const results = await Promise.all(tickers.map(async t=>{
    try{
      const candles = await fetchKlines(t.symbol, '1h', 120);
      const snap = quickTrendSnapshot(candles);
      if(!snap.available) return null;
      let momentum = 0;
      if(snap.rsi!=null){ if(snap.rsi>52 && snap.rsi<75) momentum+=1; if(snap.rsi<48 && snap.rsi>25) momentum-=1; }
      if(snap.trend==='صعودی') momentum += 1;
      if(snap.trend==='نزولی') momentum -= 1;
      if(snap.bos && snap.bos.includes('صعودی')) momentum += 1;
      if(snap.bos && snap.bos.includes('نزولی')) momentum -= 1;
      return { ...t, snap, momentum };
    }catch(e){ return null; }
  }));
  return results.filter(Boolean);
}

async function deepAnalyzeSymbol(symbol, workingTf='1h', htfTf='4h'){
  try{
    const candles = await fetchKlines(symbol, workingTf, 300);
    const htfCandles = await fetchKlines(symbol, htfTf, 150);
    const res = analyze(candles, htfCandles);
    if(res.insufficient) return null;
    return { symbol, workingTf, ...res };
  }catch(e){ return null; }
}

function scannerCardHTML(item, kind){
  const dirTag = kind==='long' ? '🟢 LONG' : kind==='short' ? '🔴 SHORT' : '🟡 WATCH';
  const plan = kind==='long' ? (item.risk?.direction==='LONG'?item.risk:item.watchLong) : kind==='short' ? (item.risk?.direction==='SHORT'?item.risk:item.watchShort) : (item.watchLong||item.watchShort);
  const planLine = plan ? `Entry: ${plan.entry.toFixed(4)} | SL: ${plan.stopLoss.toFixed(4)} | TP1: ${plan.takeProfit1.toFixed(4)} | TP2: ${plan.takeProfit2.toFixed(4)} | TP3: ${plan.takeProfit3.toFixed(4)}` : 'داده کافی برای ستاپ عددی نیست';
  const patternLine = item.chartPattern ? item.chartPattern.type : (item.patterns?.length ? item.patterns.map(p=>p.name).join('، ') : '—');
  return `<div class="card" style="margin-bottom:8px">
    <div class="row" style="border:none"><b>${item.symbol.replace('USDT','/USDT')}</b><span>${dirTag}</span></div>
    <div class="row"><span>امتیاز/اطمینان</span><span>${item.score} | ${item.confidence}%</span></div>
    <div class="row"><span>وضعیت</span><span>${item.verdict}</span></div>
    <div class="row"><span>الگو</span><span>${patternLine}</span></div>
    <p class="muted" style="margin:6px 0 0">${planLine}</p>${item.stability?`<p class="muted">پایداری: ${item.stability.changedReason}${item.stability.withinPersistence?' | در پنجره پایداری':''}</p>`:''}
  </div>`;
}

async function runMarketScan(){
  els.scannerOverlay.style.display='block';
  els.scannerBody.innerHTML = '<div class="loading">در حال دریافت لیست بازار Binance...</div>';
  try{
    const btc = await getBTCBias();
    els.scannerBody.innerHTML = `<div class="loading">بایاس BTC: ${btc.bias} — در حال اسکن نقدشونده‌ترین جفت‌ارزها (فیلتر اول)...</div>`;

    const tickers = await fetchTop24hTickers(40);
    const filtered = await quickFilterCandidates(tickers);

    // انتخاب کاندیدهای دسته A برای تحلیل عمیق: قوی‌ترین مومنتوم صعودی و نزولی (هرکدام تا ۶ نماد)
    const sortedUp = [...filtered].sort((a,b)=>b.momentum-a.momentum).slice(0,10);
    const sortedDown = [...filtered].sort((a,b)=>a.momentum-b.momentum).slice(0,10);
    const candidateSymbols = [...new Set([...sortedUp, ...sortedDown].map(c=>c.symbol))];

    els.scannerBody.innerHTML = `<div class="loading">بایاس BTC: ${btc.bias} — در حال تحلیل عمیق ${candidateSymbols.length} کاندیدای دستهٔ A (ساختار بازار، پترن، ریسک)...</div>`;

    let deep = (await Promise.all(candidateSymbols.map(s=>deepAnalyzeSymbol(s)))).filter(Boolean);
    deep = applySignalStability(deep,'scan');

    const longs = deep.filter(d=>d.verdictClass==='v-buy').sort((a,b)=>(b.setupQuality||0)-(a.setupQuality||0)).slice(0,5);
    const shorts = deep.filter(d=>d.verdictClass==='v-sell').sort((a,b)=>(b.setupQuality||0)-(a.setupQuality||0)).slice(0,5);
    const usedSymbols = new Set([...longs, ...shorts].map(d=>d.symbol));
    const watchlist = deep
      .filter(d=>!usedSymbols.has(d.symbol) && Math.abs(d.score)>=3 && (d.watchLong||d.watchShort))
      .sort((a,b)=>b.confidence-a.confidence)
      .slice(0,5);

    let html = `<div class="row" style="border:none"><span>Market Risk</span><span>${btc.bias==='نزولی' ? '🔴 بالا (BTC نزولی — احتیاط در Long آلت‌کوین)' : btc.bias==='صعودی' ? '🟢 پایین‌تر (BTC صعودی)' : '🟡 متوسط (BTC نامشخص)'}</span></div>`;
    html += `<div class="row"><span>BTC Bias (4H/1H)</span><span>${btc.bias}</span></div>`;
    html += `<div class="row" style="margin-bottom:10px"><span>تعداد کاندیدای دستهٔ A بررسی‌شده</span><span>${candidateSymbols.length} از ${tickers.length} جفت‌ارز پرحجم</span></div>`;

    html += '<h3 style="margin-top:14px">🟢 بهترین Setupهای LONG</h3>';
    html += longs.length ? longs.map(x=>scannerCardHTML(x,'long')).join('') : '<p class="muted">هیچ ستاپ LONG قاطعی در این لحظه پیدا نشد.</p>';

    html += '<h3 style="margin-top:14px">🔴 بهترین Setupهای SHORT</h3>';
    html += shorts.length ? shorts.map(x=>scannerCardHTML(x,'short')).join('') : '<p class="muted">هیچ ستاپ SHORT قاطعی در این لحظه پیدا نشد.</p>';

    html += '<h3 style="margin-top:14px">🟡 واچ‌لیست (در حال شکل‌گیری، هنوز Trigger نشده)</h3>';
    html += watchlist.length ? watchlist.map(x=>scannerCardHTML(x,'watch')).join('') : '<p class="muted">موردی برای واچ‌لیست شناسایی نشد.</p>';

    if(!longs.length && !shorts.length){
      html += `<p class="muted" style="margin-top:10px">⚪ NO TRADE در سطح کل بازار — هیچ نمادی از میان ${tickers.length} جفت‌ارز پرحجم، تمام شرایط (ساختار بازار + سطح کلیدی + پرایس‌اکشن + تریگر + حجم + ریسک/ریوارد قابل‌قبول) را هم‌زمان نداشت. این پیام‌رسان جعلی سیگنال نمی‌سازد.</p>`;
    }
    html += `<p class="muted" style="margin-top:12px">⚠ این اسکن فقط روی تایم‌فریم ۱ساعته (تأیید ۴ساعته) و صرفاً بر مبنای نقدشونده‌ترین جفت‌ارزهای اسپات بایننس اجرا شده؛ آموزشی است و توصیهٔ مالی محسوب نمی‌شود.</p>`;

    els.scannerBody.innerHTML = html;
  }catch(e){
    els.scannerBody.innerHTML = `<p class="muted">خطا در اسکن بازار: ${e.message}</p>`;
  }
}

els.scanBtn.onclick = runMarketScan;
els.scanCloseBtn.onclick = () => { els.scannerOverlay.style.display='none'; };

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
    renderResult(res, symbol, interval, candles.at(-1)?.closeTime);
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
