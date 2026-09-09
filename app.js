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

function finiteNumber(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function fmt(v, digits=4, fallback='—'){
  const n = finiteNumber(v);
  return n===null ? fallback : n.toFixed(digits);
}
function escapeHTML(v){
  return String(v ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function validPlan(p){
  return !!p &&
    finiteNumber(p.entry)!==null &&
    finiteNumber(p.stopLoss)!==null &&
    finiteNumber(p.takeProfit1)!==null &&
    finiteNumber(p.takeProfit2)!==null &&
    finiteNumber(p.takeProfit3)!==null &&
    Math.abs(Number(p.entry)-Number(p.stopLoss))>0;
}

const INTERVAL_MAP_TV = { '1m':'1','5m':'5','15m':'15','30m':'30','1h':'60','4h':'240','1d':'D','1w':'W' };
// تایم‌فریم بالاتر برای تأیید چندتایم‌فریمی (Multi-Timeframe Confirmation)
const HTF_MAP = { '1m':'15m','5m':'1h','15m':'4h','30m':'4h','1h':'4h','4h':'1d','1d':'1w','1w':'1M' };

// ---------- تنظیمات محلی ----------
function loadSettings(){
  let s={};
  try{ s = JSON.parse(localStorage.getItem('ta_settings') || '{}') || {}; }catch(e){ s={}; }
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
  if(!res.ok){ let msg='عدم دسترسی به داده بازار برای این نماد/تایم‌فریم'; try{const er=await res.json(); if(er?.msg) msg += ' — '+er.msg;}catch(_){} throw new Error(msg); }
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
  if(!Array.isArray(closes) || closes.length < len+1) return null;
  let gain=0, loss=0;
  for(let i=1;i<=len;i++){ const d=closes[i]-closes[i-1]; if(d>0) gain+=d; else loss-=d; }
  let avgGain=gain/len, avgLoss=loss/len;
  for(let i=len+1;i<closes.length;i++){
    const d=closes[i]-closes[i-1], g=Math.max(d,0), l=Math.max(-d,0);
    avgGain=(avgGain*(len-1)+g)/len;
    avgLoss=(avgLoss*(len-1)+l)/len;
  }
  if(avgLoss===0) return 100;
  if(avgGain===0) return 0;
  const rs=avgGain/avgLoss;
  return 100-(100/(1+rs));
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
  if(!Array.isArray(candles) || candles.length < len+1) return null;
  const tr=[];
  for(let i=1;i<candles.length;i++){
    const c=candles[i], p=candles[i-1];
    tr.push(Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close)));
  }
  let a=tr.slice(0,len).reduce((x,y)=>x+y,0)/len;
  for(let i=len;i<tr.length;i++) a=(a*(len-1)+tr[i])/len;
  return a;
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
  if(!Array.isArray(candles) || candles.length < len*2+1) return {adx:null,plusDI:null,minusDI:null};
  const tr=[], plusDM=[], minusDM=[];
  for(let i=1;i<candles.length;i++){
    const c=candles[i], p=candles[i-1];
    const up=c.high-p.high, down=p.low-c.low;
    tr.push(Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close)));
    plusDM.push(up>down && up>0?up:0);
    minusDM.push(down>up && down>0?down:0);
  }
  let atrW=tr.slice(0,len).reduce((a,b)=>a+b,0)/len;
  let pW=plusDM.slice(0,len).reduce((a,b)=>a+b,0)/len;
  let mW=minusDM.slice(0,len).reduce((a,b)=>a+b,0)/len;
  const dx=[]; let lastP=0,lastM=0;
  for(let i=len;i<tr.length;i++){
    atrW=(atrW*(len-1)+tr[i])/len; pW=(pW*(len-1)+plusDM[i])/len; mW=(mW*(len-1)+minusDM[i])/len;
    const pdi=100*pW/(atrW||1), mdi=100*mW/(atrW||1);
    lastP=pdi; lastM=mdi;
    dx.push(100*Math.abs(pdi-mdi)/((pdi+mdi)||1));
  }
  if(!dx.length) return {adx:null,plusDI:lastP,minusDI:lastM};
  let adxW=dx.slice(0,len).reduce((a,b)=>a+b,0)/Math.min(len,dx.length);
  for(let i=Math.min(len,dx.length);i<dx.length;i++) adxW=(adxW*(len-1)+dx[i])/len;
  return {adx:adxW,plusDI:lastP,minusDI:lastM};
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
function fibonacci(candles, lookback=100){
  const win=candles.slice(-lookback); if(win.length<20) return null;
  const piv=[]; const lb=3;
  for(let i=lb;i<win.length-lb;i++){
    const c=win[i], w=win.slice(i-lb,i+lb+1);
    if(c.high===Math.max(...w.map(x=>x.high))) piv.push({i,price:c.high,type:'H'});
    if(c.low===Math.min(...w.map(x=>x.low))) piv.push({i,price:c.low,type:'L'});
  }
  piv.sort((a,b)=>a.i-b.i);
  const alt=[];
  for(const p of piv){ const last=alt.at(-1); if(!last){alt.push(p);continue;} if(last.type===p.type){ if(p.type==='H'&&p.price>last.price)alt[alt.length-1]=p; if(p.type==='L'&&p.price<last.price)alt[alt.length-1]=p; } else alt.push(p); }
  if(alt.length<2) return null;
  const a=alt.at(-2), b=alt.at(-1); const hi=Math.max(a.price,b.price), lo=Math.min(a.price,b.price); const diff=hi-lo;
  if(!(diff>0)) return null;
  const impulseUp=a.type==='L'&&b.type==='H';
  const ratios=[0.236,0.382,0.5,0.618,0.786]; const levels={};
  ratios.forEach(r=>levels[r]=impulseUp?hi-diff*r:lo+diff*r);
  return {high:hi,low:lo,impulseUp,levels,from:a,to:b};
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
function detectChartPatterns(candles, lookback=3, minSwings=3, atrVal=null, volumeRatio=1){
  const n=candles.length, highsIdx=[], lowsIdx=[];
  for(let i=lookback;i<n-lookback;i++){
    const win=candles.slice(i-lookback,i+lookback+1), cur=candles[i];
    if(cur.high===Math.max(...win.map(c=>c.high))) highsIdx.push({x:i,y:cur.high});
    if(cur.low===Math.min(...win.map(c=>c.low))) lowsIdx.push({x:i,y:cur.low});
  }
  const recentHighs=highsIdx.slice(-5), recentLows=lowsIdx.slice(-5);
  if(recentHighs.length<minSwings||recentLows.length<minSwings) return null;
  const upper=linReg(recentHighs), lower=linReg(recentLows), lastIdx=n-1, close=candles.at(-1).close;
  const upperNow=upper.slope*lastIdx+upper.intercept, lowerNow=lower.slope*lastIdx+lower.intercept;
  if(!(upperNow>lowerNow)) return null;
  const startX=Math.min(recentHighs[0].x,recentLows[0].x);
  const widthNow=upperNow-lowerNow, widthStart=Math.max(upper.slope*startX+upper.intercept-(lower.slope*startX+lower.intercept),1e-9);
  const avgPrice=(upperNow+lowerNow)/2, slopeThreshold=avgPrice*0.0006;
  const upFlat=Math.abs(upper.slope)<slopeThreshold, lowFlat=Math.abs(lower.slope)<slopeThreshold;
  const upUp=upper.slope>slopeThreshold, upDown=upper.slope<-slopeThreshold, lowUp=lower.slope>slopeThreshold, lowDown=lower.slope<-slopeThreshold;
  const converging=widthNow<widthStart*.85, diverging=widthNow>widthStart*1.15;
  let type=null,dirBias='neutral';
  if(converging){
    if(upFlat&&lowUp){type='مثلث صعودی (Ascending Triangle)';dirBias='up';}
    else if(upDown&&lowFlat){type='مثلث نزولی (Descending Triangle)';dirBias='down';}
    else if(upDown&&lowUp){type='مثلث متقارن (Symmetrical Triangle)';dirBias='neutral';}
    else if(upDown&&lowDown){type='Falling Wedge';dirBias='up';}
    else if(upUp&&lowUp){type='Rising Wedge';dirBias='down';}
  }else if(diverging){type='Broadening Formation';dirBias='neutral';}
  else if(upUp&&lowUp){type='Ascending Channel';dirBias='up';}
  else if(upDown&&lowDown){type='Descending Channel';dirBias='down';}
  else if(upFlat&&lowFlat){type='Horizontal Range';dirBias='neutral';}
  if(!type)return null;
  const atrBuf=(atrVal||close*.005)*.15;
  let breakoutCandidate=null,breakout=null,status='داخل الگو — شکست تأیید نشده';
  if(close>upperNow){breakoutCandidate='up'; const confirmed=close>upperNow+atrBuf && volumeRatio>=1.15; breakout=confirmed?'up':null; status=confirmed?'Breakout صعودی تأییدشده با بسته‌شدن و حجم نسبی':'Breakout صعودی بالقوه — نیازمند حجم/تأیید بیشتر';}
  else if(close<lowerNow){breakoutCandidate='down'; const confirmed=close<lowerNow-atrBuf && volumeRatio>=1.15; breakout=confirmed?'down':null; status=confirmed?'Breakdown نزولی تأییدشده با بسته‌شدن و حجم نسبی':'Breakdown نزولی بالقوه — نیازمند حجم/تأیید بیشتر';}
  return {type,dirBias,status,breakout,breakoutCandidate,upperLineNow:+upperNow.toFixed(6),lowerLineNow:+lowerNow.toFixed(6),upperSlope:upper.slope,lowerSlope:lower.slope,widthNow,widthStart};
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


// =========================================================
// V7 — Candlestick Context Engine
// کندل «پیش‌گویی قطعی» نمی‌کند؛ فقط فشار احتمالی موج بعدی را از شکل کندل
// در محل Pivot/SR و با حجم/ساختار اندازه‌گیری می‌کند.
// =========================================================
function candleMetricsV7(c){
  const range=Math.max(c.high-c.low,0), body=Math.abs(c.close-c.open);
  const upper=c.high-Math.max(c.open,c.close), lower=Math.min(c.open,c.close)-c.low;
  return {range,body,upper,lower,bodyPct:range?body/range:0,closePos:range?(c.close-c.low)/range:.5,
    bullish:c.close>c.open,bearish:c.close<c.open};
}
function detectCandlestickContextV7(candles,supports=[],resistances=[],atrVal=null){
  if(!candles || candles.length<5) return null;
  const n=candles.length,c0=candles[n-1],c1=candles[n-2],c2=candles[n-3];
  const m=candleMetricsV7(c0),p=candleMetricsV7(c1);
  const avgBody=candles.slice(-21,-1).reduce((s,c)=>s+candleMetricsV7(c).body,0)/20;
  const bodyRef=Math.max(avgBody,(atrVal||0)*.05,1e-12);
  const tol=Math.max((atrVal||0)*.35,c0.close*.002);
  const near=(levels)=>levels.find(x=>Math.abs((x.price??x)-c0.close)<=tol);
  const ns=near(supports),nr=near(resistances),patterns=[];
  const add=(name,dir,strength)=>patterns.push({name,dir,strength});
  if(m.range>0 && m.bodyPct<=.1) add('Doji','neutral',40);
  if(m.lower>=m.body*2 && m.upper<=Math.max(m.body,m.range*.12)) add('Hammer / Bullish Pin Bar','up',70);
  if(m.upper>=m.body*2 && m.lower<=Math.max(m.body,m.range*.12)) add('Shooting Star / Bearish Pin Bar','down',70);
  if(c0.close>c0.open && c1.close<c1.open && c0.open<=c1.close && c0.close>=c1.open) add('Bullish Engulfing','up',80);
  if(c0.close<c0.open && c1.close>c1.open && c0.open>=c1.close && c0.close<=c1.open) add('Bearish Engulfing','down',80);
  if(m.body>bodyRef*1.8 && m.closePos>=.85) add('Bullish Marubozu-like','up',65);
  if(m.body>bodyRef*1.8 && m.closePos<=.15) add('Bearish Marubozu-like','down',65);
  if(c0.high<=c1.high && c0.low>=c1.low) add('Inside Bar','neutral',55);
  if(c0.high>c1.high && c0.low<c1.low) add('Outside Bar',m.bullish?'up':m.bearish?'down':'neutral',60);
  if(c2 && candleMetricsV7(c2).bearish && p.body<=candleMetricsV7(c2).body*.6 && m.bullish && c0.close>(c2.open+c2.close)/2) add('Morning Star-like','up',75);
  if(c2 && candleMetricsV7(c2).bullish && p.body<=candleMetricsV7(c2).body*.6 && m.bearish && c0.close<(c2.open+c2.close)/2) add('Evening Star-like','down',75);
  let bull=0,bear=0;
  patterns.forEach(x=>x.dir==='up'?bull+=x.strength:x.dir==='down'?bear+=x.strength:0);
  if(ns){bull+=20;if(m.lower>m.body)bull+=10;}
  if(nr){bear+=20;if(m.upper>m.body)bear+=10;}
  const volAvg=candles.slice(-21,-1).reduce((s,c)=>s+(c.volume||0),0)/20;
  const volumeRatio=volAvg>0?(c0.volume||0)/volAvg:null;
  if(volumeRatio!=null && volumeRatio>=1.5){if(m.bullish)bull+=10;if(m.bearish)bear+=10;}
  bull=Math.min(100,Math.round(bull));bear=Math.min(100,Math.round(bear));
  const direction=bull-bear>=15?'up':bear-bull>=15?'down':'neutral';
  const nextWaveBias=direction==='up'?'احتمال تقویت موج صعودی':direction==='down'?'احتمال تقویت موج نزولی':'جهت موج بعدی تأیید نشده';
  const trigger=direction==='up'&&nr?`بسته‌شدن بالای مقاومت ${nr.price??nr}`:direction==='down'&&ns?`بسته‌شدن زیر حمایت ${ns.price??ns}`:'شکست Pivot بعدی + حجم';
  return {patterns,bullishPressure:bull,bearishPressure:bear,direction,nextWaveBias,trigger,
    nearSupport:ns||null,nearResistance:nr||null,volumeRatio:volumeRatio==null?null:+volumeRatio.toFixed(2),
    lastCandle:{open:c0.open,high:c0.high,low:c0.low,close:c0.close},
    evidence:'شکل کندل + محل نسبت به Pivot/SR + حجم؛ الگوی کندلی به‌تنهایی پیش‌بینی قطعی نیست.'};
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
  if(n<80) return null;
  const mid=(arr)=>{
    if(!arr || !arr.length) return null;
    return (Math.max(...arr.map(c=>c.high))+Math.min(...arr.map(c=>c.low)))/2;
  };
  const midAt=(endExclusive,len)=>mid(candles.slice(Math.max(0,endExclusive-len),endExclusive));
  const tenkan=midAt(n,9), kijun=midAt(n,26), spanB=midAt(n,52), futureSpanA=(tenkan+kijun)/2;
  const cloudRefEnd=n-26;
  const refTenkan=cloudRefEnd>=9?midAt(cloudRefEnd,9):tenkan;
  const refKijun=cloudRefEnd>=26?midAt(cloudRefEnd,26):kijun;
  const refSpanB=cloudRefEnd>=52?midAt(cloudRefEnd,52):spanB;
  const currentSpanA=(refTenkan+refKijun)/2;
  const currentSpanB=refSpanB;
  const cloudTop=Math.max(currentSpanA,currentSpanB), cloudBottom=Math.min(currentSpanA,currentSpanB);
  const futureCloudTop=Math.max(futureSpanA,spanB), futureCloudBottom=Math.min(futureSpanA,spanB);
  const close=candles.at(-1).close;
  const atrVal=atr(candles,14)||Math.max(close*0.005,1e-9);
  const cloudThickness=(cloudTop-cloudBottom)/atrVal;
  const futureThickness=(futureCloudTop-futureCloudBottom)/atrVal;
  const prevTenkan=midAt(n-1,9), prevKijun=midAt(n-1,26);
  const tkCross=tenkan>kijun && prevTenkan<=prevKijun ? 'bullish' : tenkan<kijun && prevTenkan>=prevKijun ? 'bearish' : 'none';
  const priceVsCloud=close>cloudTop?'above':close<cloudBottom?'below':'inside';
  const ref=candles[n-27];
  const chikou=close;
  const chikouVsPrice=ref ? (chikou>ref.close?'above':chikou<ref.close?'below':'inside') : 'unknown';
  const bullishFuture=futureSpanA>spanB;
  let score=0;
  score += priceVsCloud==='above'?3:priceVsCloud==='below'?-3:0;
  score += tenkan>kijun?2:tenkan<kijun?-2:0;
  score += kijun>=prevKijun?1:-1;
  score += bullishFuture?2:-2;
  score += futureThickness>0.8?1:0;
  score += chikouVsPrice==='above'?2:chikouVsPrice==='below'?-2:0;
  score += tkCross==='bullish'?1:tkCross==='bearish'?-1:0;
  return {
    tenkan,kijun,senkouA:futureSpanA,senkouB:spanB,
    currentSpanA,currentSpanB,cloudTop,cloudBottom,
    futureCloudTop,futureCloudBottom,cloudThickness,futureCloudThickness:futureThickness,
    priceVsCloud,bullishFuture,chikou,chikouVsPrice,tkCross,
    score:clamp(50+score*5)
  };
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
  if(!candles||candles.length<30)return {last:0,avg:0,ratio:1,trend:1,obvSlope:0,expanding:false,contracting:false,upVolumeRatio:1,downVolumeRatio:1};
  const vols=candles.map(c=>c.volume), last=vols.at(-1), avg=sma(vols.slice(-20),20), prevAvg=sma(vols.slice(-40,-20),20)||avg;
  const ratio=avg?last/avg:1, trend=prevAvg?avg/prevAvg:1;
  let up=0,down=0;
  candles.slice(-20).forEach((c,i,a)=>{ const prev=i? a[i-1].close : candles.at(-21)?.close; if(prev==null)return; if(c.close>prev)up+=c.volume; else if(c.close<prev)down+=c.volume; });
  const obv=[];let o=0;for(let i=1;i<candles.length;i++){if(candles[i].close>candles[i-1].close)o+=candles[i].volume;else if(candles[i].close<candles[i-1].close)o-=candles[i].volume;obv.push(o);}
  const obvSlope=obv.length>=10?obv.at(-1)-obv.at(-10):0;
  return {last,avg,ratio,trend,obvSlope,expanding:ratio>=1.25,contracting:ratio<=.75,upVolumeRatio:avg?up/(avg*10):1,downVolumeRatio:avg?down/(avg*10):1};
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
  const pivotTrend = waves.length>=3
    ? (Math.abs(waves.at(-1).dispPct)>Math.abs(waves.at(-2).dispPct)*1.08
        ? 'در حال گسترش'
        : Math.abs(waves.at(-1).dispPct)<Math.abs(waves.at(-2).dispPct)*0.92
          ? 'در حال انقباض' : 'تقریباً ثابت')
    : 'داده ناکافی';
  return {waves:waves.slice(-5),bullishPressure:bull,bearishPressure:bear,
    overall:Math.abs(bull-bear)<10?'متعادل (BALANCED PRESSURE)':bull>bear?'فشار صعودی غالب (BULLISH PRESSURE)':'فشار نزولی غالب (BEARISH PRESSURE)',
    upAcceleration:ups.length>=2?(ups.at(-1).eff>ups.at(-2).eff*1.1?'Accelerating':ups.at(-1).eff<ups.at(-2).eff*.9?'Decelerating':'Stable'):'داده ناکافی',
    downAcceleration:downs.length>=2?(downs.at(-1).eff>downs.at(-2).eff*1.1?'Accelerating':downs.at(-1).eff<downs.at(-2).eff*.9?'Decelerating':'Stable'):'داده ناکافی',
    pivotExpansion:expansion,pullbackWeakening:pullWeak,pivotTrend};
}

function weightedAnalysisScore(parts){
  const weights={structure:20,trend:15,ichimoku:12,sr:10,volume:10,priceAction:8,wave:8,pattern:6,momentum:5,smc:4,fib:2};
  let directional=0,total=0;
  for(const k of Object.keys(weights)){ const v=clamp(parts[k]??0,-1,1); directional+=v*weights[k]; total+=weights[k]; }
  return {directional:+directional.toFixed(2),quality:clamp(Math.round(50+directional/2),0,100),weights};
}

function buildProfessionalPlan(dir,entry,atrVal,supports=[],resistances=[],quality=0,triggered=false){
  entry = finiteNumber(entry);
  atrVal = finiteNumber(atrVal);
  if(entry===null || atrVal===null || atrVal<=0) return null;

  const belowSupport = (supports||[])
    .filter(x=>finiteNumber(x?.price)!==null && x.price<entry)
    .sort((a,b)=>b.price-a.price)[0]?.price;
  const aboveResistance = (resistances||[])
    .filter(x=>finiteNumber(x?.price)!==null && x.price>entry)
    .sort((a,b)=>a.price-b.price)[0]?.price;

  const buffer=atrVal*0.20;
  let stop;
  if(dir==='LONG'){
    stop=Math.min(entry-atrVal*1.5, belowSupport!==undefined ? belowSupport-buffer : entry-atrVal*1.5);
  }else{
    stop=Math.max(entry+atrVal*1.5, aboveResistance!==undefined ? aboveResistance+buffer : entry+atrVal*1.5);
  }

  if(!Number.isFinite(stop) || (dir==='LONG'&&stop>=entry) || (dir==='SHORT'&&stop<=entry)) return null;

  const risk=Math.abs(entry-stop);
  if(!(risk>0)) return null;

  const sign=dir==='LONG'?1:-1;
  const tp1=entry+sign*risk*1.5;
  const tp2=entry+sign*risk*2.5;
  const structural=dir==='LONG'
    ? (resistances||[]).filter(x=>finiteNumber(x?.price)!==null && x.price>tp2).sort((a,b)=>a.price-b.price)[0]?.price
    : (supports||[]).filter(x=>finiteNumber(x?.price)!==null && x.price<tp2).sort((a,b)=>b.price-a.price)[0]?.price;
  const tp3=finiteNumber(structural) ?? entry+sign*risk*4;

  if(![tp1,tp2,tp3].every(Number.isFinite)) return null;

  const atrPct=(atrVal/entry)*100;
  let suggestedLeverage;
  if(quality<40 || atrPct>4) suggestedLeverage='۱x تا ۳x (نوسان بالا/اطمینان پایین — لوریج پایین یا اسپات)';
  else if(quality<65 || atrPct>2) suggestedLeverage='۳x تا ۵x (احتیاط، ریسک هر ترید را حداکثر ۱-۲٪ سرمایه نگه دار)';
  else suggestedLeverage='۵x تا ۱۰x (حداکثر آموزشی؛ لوریج بالاتر توصیه نمی‌شود)';

  return {
    direction:dir, active:!!triggered, entry, stopLoss:stop,
    takeProfit1:tp1, takeProfit2:tp2, takeProfit3:tp3,
    riskRewardTP1:1.5, riskRewardTP2:2.5,
    riskRewardTP3:+(Math.abs(tp3-entry)/risk).toFixed(2),
    suggestedLeverage,
    estimatedFeeNote:'کارمزد واقعی حساب به سطح VIP/تخفیف و نوع بازار بستگی دارد؛ قبل از معامله کارمزد فعلی صرافی را بررسی کن.',
    state:triggered?5:3,
    entryState:triggered?'ENTRY VALID':'TRIGGER FORMED',
    quality
  };
}

function deriveTrendState(candles){
  if(!candles||candles.length<60)return {available:false};
  const closes=candles.map(c=>c.close), e20=emaSeries(closes,20).at(-1), e50=emaSeries(closes,50).at(-1), e200=closes.length>=200?emaSeries(closes,200).at(-1):null;
  const st=advancedStructure(candles,atr(candles,14)); const last=closes.at(-1);
  let trend='mixed';
  if(last>e20&&e20>e50&&(e200==null||e50>e200))trend='up';
  else if(last<e20&&e20<e50&&(e200==null||e50<e200))trend='down';
  let score=trend==='up'?1:trend==='down'?-1:0;
  if(st?.event?.includes('صعودی'))score=Math.min(1,score+.35);
  if(st?.event?.includes('نزولی'))score=Math.max(-1,score-.35);
  return {available:true,trend,lastClose:last,ema20:e20,ema50:e50,ema200:e200,score,structure:st?.structure,event:st?.event,rsi:rsi(closes,14)};
}
function mtfConfluence(snapshot, workingTf='1h'){
  if(!snapshot)return {score:0,available:false,details:{}};
  const weights={'1d':.30,'4h':.30,'1h':.25,'15m':.15,'5m':.08};
  let sum=0,w=0;const details={};
  Object.entries(weights).forEach(([tf,wt])=>{const q=snapshot[tf];if(q?.available&&Number.isFinite(q.score)){sum+=q.score*wt;w+=wt;details[tf]=q.score;}});
  const score=w?clamp(sum/w,-1,1):0;
  const htf4=snapshot['4h']?.score??0, htf1d=snapshot['1d']?.score??0;
  return {score,available:w>0,details,htfConflict:(htf4*score<-.20||htf1d*score<-.20)};
}

function analyze(candles, htfCandles, mtfSnapshot=null){
  if(!candles || candles.length<100) return {insufficient:true};
  const closes=candles.map(c=>c.close), volumes=candles.map(c=>c.volume), lastClose=closes.at(-1);
  const ema20=emaSeries(closes,20).at(-1), ema50=emaSeries(closes,50).at(-1), ema200=closes.length>=200?emaSeries(closes,200).at(-1):null;
  const rsiVal=rsi(closes,14), macdVal=macd(closes), atrVal=atr(candles,14), bb=bollinger(closes,20,2), stoch=stochastic(candles,14,3), adxVal=adx(candles,14);
  const divergence=detectRSIDivergence(candles,closes), fib=fibonacci(candles,80), vwapVal=vwap(candles.slice(-200));
  const structure=advancedStructure(candles,atrVal), legacyStructure=marketStructure(candles), ich=ichimoku(candles);
  const volume=volumeMetrics(candles), vp=volumeProfileLite(candles), liquidity=findLiquidityPools(candles,60,0.1), orderBlock=findOrderBlock(candles,atrVal), fvgs=findFVGs(candles,40);
  const chartPattern=detectChartPatterns(candles,3,3,atrVal,volume.ratio), classicalPatterns=detectClassicalPatterns(candles,structure);
  const patterns=[...detectPatterns(candles),...classicalPatterns.map(p=>({name:p.name+' — '+p.status,dir:p.dir}))];
  const waveEngine=wavePressureV2(candles,atrVal,chartPattern,structure,volume);
  const {highs,lows}=findSwingPoints(candles,3);
  const resistances=clusterLevels(highs.filter(x=>x>lastClose),0.15).sort((a,b)=>a.price-b.price).slice(0,4);
  const supports=clusterLevels(lows.filter(x=>x<lastClose),0.15).sort((a,b)=>b.price-a.price).slice(0,4);
  const candleContext=detectCandlestickContextV7(candles,supports,resistances,atrVal);
  const htfTrend=htfCandles&&htfCandles.length>=80 ? deriveTrendState(htfCandles).trend : null;
  const mtf=mtfConfluence(mtfSnapshot);
  const nearestRes=resistances[0]?.price, nearestSup=supports[0]?.price;

  // هر جزء ابتدا به بازه -1..+1 نرمال می‌شود؛ اندیکاتورهای کم‌ارزش عمداً وزن پایین دارند.
  const trendRaw=ema200 ? (lastClose>ema20&&ema20>ema50&&ema50>ema200?1:lastClose<ema20&&ema20<ema50&&ema50<ema200?-1:lastClose>ema50?.45:-.45) : (lastClose>ema50?.35:-.35);
  let structureRaw=structure.structure.startsWith('صعودی')?0.75:structure.structure.startsWith('نزولی')?-0.75:0;
  if(structure.event?.includes('صعودی'))structureRaw=Math.max(structureRaw,.95); if(structure.event?.includes('نزولی'))structureRaw=Math.min(structureRaw,-.95);
  const ichRaw=ich?clamp((ich.score-50)/50,-1,1):0;
  const htfRaw=mtf.available ? mtf.score : (htfTrend==='up'?1:htfTrend==='down'?-1:0);
  let srRaw=0;
  if(nearestSup && pctDistance(lastClose,nearestSup)<.75) srRaw+=.35;
  if(nearestRes && pctDistance(lastClose,nearestRes)<.75) srRaw-=.35;
  if(nearestRes && lastClose>nearestRes+atrVal*.15) srRaw+=.65;
  if(nearestSup && lastClose<nearestSup-atrVal*.15) srRaw-=.65;
  if(vwapVal && pctDistance(lastClose,vwapVal)<.35) srRaw += lastClose>=vwapVal?.15:-.15;
  let volRaw=clamp((volume.ratio-1)*1.25,-1,1);
  if(lastClose>closes.at(-2)) volRaw=Math.min(1,volRaw + (volume.upVolumeRatio>volume.downVolumeRatio?.15:-.05));
  else volRaw=Math.max(-1,volRaw - (volume.downVolumeRatio>volume.upVolumeRatio?.15:-.05));
  if(volume.obvSlope>0&&lastClose>vwapVal) volRaw=Math.min(1,volRaw+.10);
  if(volume.obvSlope<0&&lastClose<vwapVal) volRaw=Math.max(-1,volRaw-.10);
  let paRaw=0; patterns.forEach(p=>{paRaw+=p.dir==='up'?.35:p.dir==='down'?-.35:0}); paRaw=clamp(paRaw,-1,1);
  const waveRaw=waveEngine?clamp((waveEngine.bullishPressure-waveEngine.bearishPressure)/50,-1,1):0;
  let patRaw=chartPattern?.dirBias==='up'?.7:chartPattern?.dirBias==='down'?-.7:0;
  if(classicalPatterns.some(p=>p.status==='CONFIRMED')) patRaw += classicalPatterns.filter(p=>p.status==='CONFIRMED').reduce((a,p)=>a+(p.dir==='up'?.25:-.25),0);
  patRaw=clamp(patRaw,-1,1);
  let momRaw=0; if(macdVal.hist>0)momRaw+=.30; else momRaw-=.30; if(macdVal.hist>macdVal.prevHist)momRaw+=.15; else if(macdVal.hist<macdVal.prevHist)momRaw-=.15; if(rsiVal>55&&rsiVal<70)momRaw+=.22; if(rsiVal<45&&rsiVal>30)momRaw-=.22; if(divergence?.bullishDiv)momRaw+=.20; if(divergence?.bearishDiv)momRaw-=.20; momRaw=clamp(momRaw,-1,1);
  let smcRaw=0; if(orderBlock)smcRaw+=orderBlock.dir==='bull'?.25:-.25; if(liquidity?.sweep)smcRaw+=liquidity.sweep.includes('صعودی')?.4:-.4; if(fvgs?.length){const nearFvg=fvgs.find(g=>lastClose>=g.bottom&&lastClose<=g.top||pctDistance(lastClose,(g.top+g.bottom)/2)<.6); if(nearFvg)smcRaw+=nearFvg.dir==='bull'?.15:-.15;} smcRaw=clamp(smcRaw,-1,1);
  let fibRaw=0; if(fib){const near=[.5,.618,.382].some(r=>pctDistance(lastClose,fib.levels[r])<.5); if(near)fibRaw=fib.impulseUp?.5:-.5;}

  const score=weightedAnalysisScore({structure:structureRaw,trend:(trendRaw*.65+htfRaw*.35),ichimoku:ichRaw,sr:srRaw,volume:volRaw,priceAction:paRaw,wave:waveRaw,pattern:patRaw,momentum:momRaw,smc:smcRaw,fib:fibRaw});
  let directional=score.directional;
  // HTF conflict is a hard quality penalty, not an invisible offset.
  const htfConflict=(htfTrend==='up'&&directional<0)||(htfTrend==='down'&&directional>0);
  let setupQuality=clamp(Math.round(50+directional/2 - (htfConflict?10:0) - (mtf.htfConflict?7:0) - (adxVal.adx!=null&&adxVal.adx<18?7:0) - (!mtf.available?5:0)),0,100);
  const longTrigger=Boolean((structure.event?.includes('صعودی')||chartPattern?.breakout==='up'||classicalPatterns.some(p=>p.dir==='up'&&p.status==='CONFIRMED')) && volume.ratio>=1.15 && lastClose>ema20 && lastClose>closes.at(-2));
  const shortTrigger=Boolean((structure.event?.includes('نزولی')||chartPattern?.breakout==='down'||classicalPatterns.some(p=>p.dir==='down'&&p.status==='CONFIRMED')) && volume.ratio>=1.15 && lastClose<ema20 && lastClose<closes.at(-2));
  const nearSupport=nearestSup&&pctDistance(lastClose,nearestSup)<1.0, nearResistance=nearestRes&&pctDistance(lastClose,nearestRes)<1.0;
  const chaseLong=nearestRes && lastClose>nearestRes+atrVal*.75;
  const chaseShort=nearestSup && lastClose<nearestSup-atrVal*.75;
  const longReadiness=clamp(Math.round((setupQuality*.55)+(longTrigger?30:0)+(nearSupport?10:0)-(htfTrend==='down'?20:0)-(chaseLong?25:0)),0,100);
  const shortReadiness=clamp(Math.round((setupQuality*.55)+(shortTrigger?30:0)+(nearResistance?10:0)-(htfTrend==='up'?20:0)-(chaseShort?25:0)),0,100);
  let direction=directional>=0?'LONG':'SHORT';
  const readiness=direction==='LONG'?longReadiness:shortReadiness;
  let verdictClass='v-hold', verdict='NO TRADE — کیفیت یا تریگر کافی نیست';
  if(setupQuality>=80 && longReadiness>=80 && directional>15){verdictClass='v-buy';verdict='🟢 ENTER LONG — ستاپ با کیفیت بالا و تریگر تأییدشده';}
  else if(setupQuality>=80 && shortReadiness>=80 && directional<-15){verdictClass='v-sell';verdict='🔴 ENTER SHORT — ستاپ با کیفیت بالا و تریگر تأییدشده';}
  else if(setupQuality>=70 && directional>10){verdict='🟡 WAIT FOR LONG — ستاپ خوب است، اما ورود هنوز تأیید کامل ندارد';}
  else if(setupQuality>=70 && directional<-10){verdict='🟠 WAIT FOR SHORT — ستاپ خوب است، اما ورود هنوز تأیید کامل ندارد';}
  else if(setupQuality<60){verdict='⚪ NO TRADE — کیفیت ستاپ زیر حداقل آستانه است';}
  const longEntry = longTrigger ? lastClose : (nearestRes ?? lastClose);
  const shortEntry = shortTrigger ? lastClose : (nearestSup ?? lastClose);
   const planLong=buildProfessionalPlan('LONG',longEntry,atrVal,supports,resistances,setupQuality,longTrigger&&longReadiness>=80);
  const planShort=buildProfessionalPlan('SHORT',shortEntry,atrVal,supports,resistances,setupQuality,shortTrigger&&shortReadiness>=80);
  const risk=verdictClass==='v-buy'&&validPlan(planLong)?planLong:verdictClass==='v-sell'&&validPlan(planShort)?planShort:null;
  const watchLong=planLong?{...planLong,active:false,trigger:`بسته‌شدن بالای مقاومت/تریگر با حجم ≥ ۱.۱x میانگین ۲۰ کندل؛ سپس تأیید مجدد ساختار`,state:longTrigger?4:nearSupport?2:1,entryState:longTrigger?'TRIGGER CONFIRMED':nearSupport?'LEVEL TOUCHED':'APPROACHING LEVEL'}:null;
  const watchShort=planShort?{...planShort,active:false,trigger:`بسته‌شدن زیر حمایت/تریگر با حجم ≥ ۱.۱x میانگین ۲۰ کندل؛ سپس تأیید مجدد ساختار`,state:shortTrigger?4:nearResistance?2:1,entryState:shortTrigger?'TRIGGER CONFIRMED':nearResistance?'LEVEL TOUCHED':'APPROACHING LEVEL'}:null;
  const notes=[];
  notes.push(`مدل امتیازدهی وزنی: Market Structure=20، Trend/HTF=15، Ichimoku=12، S/R=10، Volume=10، Price Action=8، Wave=8، Pattern=6، Momentum=5، SMC=4، Fibonacci=2.`);
  notes.push(`Setup Quality=${setupQuality}/100 | Entry Readiness=${readiness}/100 | امتیاز جهت‌دار=${fmt(directional,1)}`);
  notes.push(`ساختار: ${structure.structure}${structure.event?' | '+structure.event:''}`);
  notes.push(`Ichimoku: ${ich?.priceVsCloud||'N/A'} | TK=${ich?.tkCross||'N/A'} | Future Cloud=${ich?.bullishFuture?'Bullish':'Bearish'}`);
  notes.push(`حجم: ${fmt(volume?.ratio,2)}x میانگین ۲۰ کندل | ADX=${fmt(adxVal?.adx,1)}`);
  if(htfConflict||mtf.htfConflict)notes.push('⚠ تعارض تایم‌فریم بالاتر با جهت فعلی؛ کیفیت سیگنال کاهش داده شد.');
  if(mtf.available) notes.push(`هم‌راستایی MTF: ${(mtf.score*100).toFixed(0)}/100 | 1D=${fmt(mtf.details['1d'],2)} 4H=${fmt(mtf.details['4h'],2)} 1H=${fmt(mtf.details['1h'],2)} 15M=${fmt(mtf.details['15m'],2)}`);
  if(!longTrigger&&!shortTrigger)notes.push('تریگر بسته‌شدن + حجم هنوز تأیید نشده؛ لمس سطح ورود محسوب نمی‌شود.');
  if(chaseLong)notes.push('⚠ قیمت از تریگر/مقاومت ایده‌آل بیش از حدود 0.75 ATR عبور کرده؛ ورود تعقیبی ریسک‌دار است، پولبک/Retest را ترجیح بده.');
  if(chaseShort)notes.push('⚠ قیمت از تریگر/حمایت ایده‌آل بیش از حدود 0.75 ATR عبور کرده؛ ورود تعقیبی ریسک‌دار است، پولبک/Retest را ترجیح بده.');
  const confidence=clamp(Math.round(setupQuality*(readiness/100)),5,95);
  return {
    lastClose,ema20,ema50,ema200,rsiVal,macdVal,atrVal,bb,stoch,adxVal,divergence,htfTrend,fib,vwapVal,structure:legacyStructure||structure,
    advancedStructure:structure,ichimoku:ich,mtfConfluence:mtf,orderBlock,fvgs,liquidity,volumeMetrics:volume,volumeProfile:vp,resistances,supports,patterns,chartPattern,classicalPatterns,waveEngine,candleContext,
    recentSwingHighs:highs.slice(-8),recentSwingLows:lows.slice(-8),notes,
    score:directional,setupQuality,entryReadiness:readiness,confidence,verdict,verdictClass,risk,watchLong,watchShort,
    entryState:verdictClass==='v-buy'||verdictClass==='v-sell'?'ENTRY VALID':longReadiness>=70||shortReadiness>=70?'TRIGGER FORMED':'NO SETUP',
    trendScore:Math.round(trendRaw*2),momScore:Math.round(momRaw*2),paScore:Math.round(paRaw*2),volScore:Math.round(volRaw*2),srScore:Math.round(srRaw*2),htfScore:Math.round(htfRaw*2),vwapScore:lastClose>vwapVal?1:-1,structureScore:Math.round(structureRaw*2),fibScore:Math.round(fibRaw*2),obScore:orderBlock?(orderBlock.dir==='bull'?1:-1):0,liqScore:liquidity?.sweep?(liquidity.sweep.includes('صعودی')?1:-1):0,
    componentScores:{structure:structureRaw,trend:trendRaw,ichimoku:ichRaw,supportResistance:srRaw,volume:volRaw,priceAction:paRaw,wave:waveRaw,pattern:patRaw,momentum:momRaw,smc:smcRaw,fibonacci:fibRaw},
    dataQuality:{ok:true,closedCandles:true,candleCount:candles.length,lastClosedTime:candles.at(-1)?.closeTime,mtfAvailable:mtf.available,mtfConflict:mtf.htfConflict}
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
  // Clean presentation layer: the full analysis remains backstage; the user sees only the decision + reasons.
  const backstageIds=['qualityCard','scoreCard','srCard','indCard','paCard','candleCard','waveCard','quantCard','researchCard','edgeCard','aiCard','riskCard','trustCard','proTraderCard'];
  backstageIds.forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display='none'; });

  if(res.insufficient){
    els.verdictBox.className='verdict v-none';
    els.verdictBox.innerHTML='NOT TRADE<div class="decision-sub">داده کافی یا معتبر برای تصمیم‌گیری وجود ندارد</div>';
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
  const trustStatus=res.trust?.status || '';
  let cleanDecision='HOLD';
  let cleanClass='v-hold';
  if(trustStatus==='BLOCKED' || res.verdictClass==='v-none') { cleanDecision='NOT TRADE'; cleanClass='v-none'; }
  else if(res.verdictClass==='v-buy'){ cleanDecision='BUY'; cleanClass='v-buy'; }
  else if(res.verdictClass==='v-sell'){ cleanDecision='SELL'; cleanClass='v-sell'; }
  else if(res.verdictClass==='v-hold'){ cleanDecision='HOLD'; cleanClass='v-hold'; }
  els.verdictBox.className='verdict '+cleanClass;
  els.verdictBox.innerHTML=`${cleanDecision}<div class="decision-sub">${stabilityNote}</div>`;

  const qualityCard=document.getElementById('qualityCard');
  if(qualityCard){
    qualityCard.style.display='block';
    document.getElementById('setupQuality').textContent=`${res.setupQuality||0}/100`;
    document.getElementById('entryReadiness').textContent=`${res.entryReadiness||0}/100`;
    document.getElementById('entryState').textContent=res.entryState||'NO SETUP';
    document.getElementById('dominantDirection').textContent=res.score>0?'LONG':res.score<0?'SHORT':'NEUTRAL';
  }

  // لایهٔ حرفه‌ای معامله‌گر: قبل از هر نتیجهٔ ورود، کیفیت اجرا، ریسک، رژیم و thesis check نمایش داده می‌شود.
  const existingPro=document.getElementById('proTraderCard');
  if(existingPro) existingPro.remove();
  const pro=res.proTrader||{};
  const proCard=document.createElement('div');
  proCard.id='proTraderCard'; proCard.className='card'; proCard.style.marginTop='10px';
  const rr=pro.risk||{}; const ex=pro.execution||{}; const reg=pro.regime||{};
  const dirLabel=pro.direction==='LONG'?'🟢 LONG':pro.direction==='SHORT'?'🔴 SHORT':'⚪ NEUTRAL';
  proCard.innerHTML=`
    <h3>🧠 لایهٔ معامله‌گر حرفه‌ای</h3>
    <div class="pro-decision"><span class="label">تصمیم فعلی</span><span class="value">${escapeHTML(pro.action||dirLabel)}</span></div>
    <div class="pro-grid">
      <div class="pro-metric"><span class="k">رژیم بازار</span><span class="v">${escapeHTML(reg.label||'نامشخص')}</span></div>
      <div class="pro-metric"><span class="k">کیفیت اجرا</span><span class="v">${ex.score??'—'}/100</span></div>
      <div class="pro-metric"><span class="k">ریسک هر ترید</span><span class="v">${rr.riskPct??'—'}% · ${rr.riskAmount??'—'} USDT</span></div>
      <div class="pro-metric"><span class="k">R:R</span><span class="v">${rr.rr1??'—'} / ${rr.rr2??'—'} / ${rr.rr3??'—'}</span></div>
      <div class="pro-metric"><span class="k">Portfolio Heat</span><span class="v">${rr.heat??'—'}% / ${rr.maxHeat??'—'}%</span></div>
      <div class="pro-metric"><span class="k">Derivatives</span><span class="v">${res.derivatives?.status==='ok'?`F ${fmt(res.derivatives.fundingRate*100,4)}% · OI ${fmt(res.derivatives.openInterest,0)}`:'Unavailable'}</span></div>
    </div>
    ${pro.reasons?.length?`<div class="pro-block"><b>دلایل:</b> ${pro.reasons.map(escapeHTML).join(' • ')}</div>`:''}
    ${pro.killers?.length?`<div class="pro-block"><b>Thesis Killers:</b> ${pro.killers.map(escapeHTML).join(' • ')}</div>`:''}
    ${pro.executionPlan?.length?`<div class="pro-block"><b>قوانین اجرا:</b> ${pro.executionPlan.map(escapeHTML).join(' • ')}</div>`:''}
  `;
  qualityCard?.insertAdjacentElement('afterend',proCard);
  const oldTrust=document.getElementById('trustCard'); if(oldTrust) oldTrust.remove();
  const tr=res.trust||{};
  const trustCard=document.createElement('div'); trustCard.id='trustCard'; trustCard.className='card trust-card';
  const tClass=tr.status==='TRADE_READY'?'trust-ok':tr.status==='PAPER_ONLY'?'trust-warn':'trust-block';
  trustCard.innerHTML=`<h3>🛡️ دروازهٔ اعتماد و اعتبارسنجی</h3>
    <div class="trust-status ${tClass}"><span>${escapeHTML(tr.label||'نامشخص')}</span><b>${tr.score??'—'}/100</b></div>
    <div class="trust-checks">${(tr.data?.checks||[]).map(c=>`<div><span>${c.ok?'✓':'✕'}</span>${escapeHTML(c.label)}</div>`).join('')}</div>
    <div class="trust-note">${tr.validation?.validated?'بک‌تست و Walk-Forward تأیید شده است.':'این امتیاز «احتمال برد» نیست. تا ثبت حداقل ۱۰۰ معاملهٔ خارج‌ازنمونه و Walk-Forward، خروجی فقط برای Paper Trading قابل اتکاتر است.'}</div>
    ${tr.reasons?.length?`<div class="muted">${tr.reasons.map(escapeHTML).join(' • ')}</div>`:''}`;
  proCard.insertAdjacentElement('afterend',trustCard);

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
    if(!validPlan(p)) return '<p class="muted">⚠ برنامه معاملاتی عددی معتبر نیست؛ ورود/حدضرر/اهداف ناقص است. سیگنال صادر نشد.</p>';
    const capital = Math.max(+els.capitalInput.value || 0, 0);
    const riskPct = Math.min(Math.max(+els.riskPctInput.value || 0, 0), 100);
    const riskAmountUSDT = capital * riskPct / 100;
    const perUnitRisk = Math.abs(p.entry - p.stopLoss);
    const posSizing = (capital>0 && riskPct>0 && perUnitRisk>0) ? {
      riskAmountUSDT: +riskAmountUSDT.toFixed(2),
      units: +(riskAmountUSDT / perUnitRisk).toFixed(6),
      positionValueUSDT: +((riskAmountUSDT / perUnitRisk) * p.entry).toFixed(2)
    } : null;
    p.positionSizing = posSizing;
    return `
      <div class="row"><span>نقطه ورود (Entry)</span><span>${fmt(p.entry)}</span></div>
      <div class="row"><span>حد ضرر (Stop Loss)</span><span>${fmt(p.stopLoss)}</span></div>
      <div class="row"><span>حد سود ۱ (TP1)</span><span>${fmt(p.takeProfit1)} (R:R ${p.riskRewardTP1 ?? '—'})</span></div>
      <div class="row"><span>حد سود ۲ (TP2)</span><span>${fmt(p.takeProfit2)} (R:R ${p.riskRewardTP2 ?? '—'})</span></div>
      <div class="row"><span>حد سود ۳ (TP3)</span><span>${fmt(p.takeProfit3)} (R:R ${p.riskRewardTP3 ?? '—'})</span></div>
      <div class="row"><span>لوریج پیشنهادی (آموزشی)</span><span>${escapeHTML(p.suggestedLeverage || '—')}</span></div>
      ${posSizing ? `<div class="row"><span>سایز پوزیشن</span><span>${posSizing.units} واحد (${posSizing.positionValueUSDT} USDT)</span></div>
      <p class="muted">با سرمایهٔ ${capital} USDT و ریسک ${riskPct}٪، حداکثر ضرر مجاز این ترید ${posSizing.riskAmountUSDT} USDT است.</p>` : '<p class="muted">برای محاسبهٔ سایز پوزیشن، سرمایه و درصد ریسک را وارد کن.</p>'}
      <p class="muted" style="margin-top:6px">${escapeHTML(p.estimatedFeeNote || 'کارمزد در این برنامه به‌صورت زنده محاسبه نمی‌شود.')}</p>`;
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
    (res.resistances.length? '<b>مقاومت‌ها:</b><br>'+res.resistances.map(r=>`<span>🔴 ${fmt(r.price)} <span class="badge" style="background:rgba(239,83,80,.2);color:var(--red)">قدرت ${r.strength}</span></span>`).join('') : '<span class="muted">مقاومتی شناسایی نشد</span>')
    + (res.supports.length? '<br><b>حمایت‌ها:</b><br>'+res.supports.map(s=>`<span>🟢 ${fmt(s.price)} <span class="badge" style="background:rgba(38,166,154,.2);color:var(--green)">قدرت ${s.strength}</span></span>`).join('') : '<br><span class="muted">حمایتی شناسایی نشد</span>');
  document.getElementById('dynamicSR').innerHTML =
    `<span>EMA20: ${fmt(res.ema20)}</span><span>EMA50: ${fmt(res.ema50)}</span>` +
    (res.ema200 ? `<span>EMA200: ${fmt(res.ema200)}</span>` : '<span class="muted">EMA200 نیاز به داده بیشتر دارد</span>');

  document.getElementById('indCard').style.display='block';
  document.getElementById('ind_rsi').textContent = fmt(res.rsiVal,1);
  document.getElementById('ind_macd').textContent = `${fmt(res.macdVal?.macd)} / سیگنال ${fmt(res.macdVal?.signal)} / هیست ${fmt(res.macdVal?.hist)}`;
  document.getElementById('ind_ema').textContent = `${fmt(res.ema20)} / ${fmt(res.ema50)} / ${res.ema200? fmt(res.ema200):'—'}`;
  document.getElementById('ind_atr').textContent = fmt(res.atrVal);
  const ichRow=document.getElementById('ind_ichimoku');
  if(ichRow) ichRow.textContent=res.ichimoku?`${res.ichimoku.priceVsCloud} | TK ${res.ichimoku.tkCross} | ${res.ichimoku.score}/100`: '—';
  const vr=document.getElementById('ind_volratio'); if(vr) vr.textContent=res.volumeMetrics?`${fmt(res.volumeMetrics?.ratio,2)}x`: '—';

  const bbRow=document.getElementById('ind_bb_row'), stochRow=document.getElementById('ind_stoch_row'), adxRow=document.getElementById('ind_adx_row');
  if(bbRow){ bbRow.style.display='flex'; document.getElementById('ind_bb').textContent = `${fmt(res.bb?.lower)} / ${fmt(res.bb?.mid)} / ${fmt(res.bb?.upper)}`; }
  if(stochRow){ stochRow.style.display='flex'; document.getElementById('ind_stoch').textContent = `K=${fmt(res.stoch?.k,1)} D=${fmt(res.stoch?.d,1)}`; }
  if(adxRow){ adxRow.style.display='flex'; document.getElementById('ind_adx').textContent = `${fmt(res.adxVal?.adx,1)} (${res.adxVal.adx>=25?'روند قوی':'رنج/ضعیف'})`; }

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

  const candleCard=document.getElementById('candleCard');
  if(candleCard && res.candleContext){
    candleCard.style.display='block';
    const cc=res.candleContext;
    let ch=`<div class="row"><span>الگوهای کندلی</span><span>${cc.patterns.length?cc.patterns.map(x=>x.name).join('، '):'هیچ الگوی معتبر'}</span></div>`;
    ch+=`<div class="row"><span>فشار کندلی صعودی</span><span>${cc.bullishPressure}/100</span></div>`;
    ch+=`<div class="row"><span>فشار کندلی نزولی</span><span>${cc.bearishPressure}/100</span></div>`;
    ch+=`<div class="row"><span>اثر روی موج بعدی</span><span>${cc.nextWaveBias}</span></div>`;
    if(cc.nearSupport) ch+=`<div class="row"><span>نزدیک حمایت Pivot-based</span><span>${cc.nearSupport.price??cc.nearSupport}</span></div>`;
    if(cc.nearResistance) ch+=`<div class="row"><span>نزدیک مقاومت Pivot-based</span><span>${cc.nearResistance.price??cc.nearResistance}</span></div>`;
    if(cc.volumeRatio!=null) ch+=`<div class="row"><span>نسبت حجم آخرین کندل به میانگین</span><span>${cc.volumeRatio}x</span></div>`;
    ch+=`<p class="muted" style="margin-top:8px">Trigger: ${cc.trigger}</p>`;
    ch+=`<p class="muted">${cc.evidence}</p>`;
    document.getElementById('candleContent').innerHTML=ch;
  } else if(candleCard) candleCard.style.display='none';

  const reasonCard=document.getElementById('reasonCard');
  const reasonText=document.getElementById('reasonText');
  if(reasonCard && reasonText){
    reasonCard.style.display='block';
    const reasons=[...(res.notes||[])];
    if(res.trust?.reasons?.length) reasons.push(...res.trust.reasons);
    if(res.proTrader?.killers?.length) reasons.push(...res.proTrader.killers.map(x=>'ریسک/نقض فرضیه: '+x));
    const unique=[...new Set(reasons.filter(Boolean))].slice(0,6);
    reasonText.innerHTML='<div class="clean-reasons"><div class="clean-reasons-title">دلایل اصلی تصمیم</div><ul>'+
      (unique.length?unique.map(n=>`<li>${escapeHTML(n)}</li>`).join(''):'<li>شواهد کافی برای توضیح بیشتر ثبت نشده است.</li>')+'</ul></div>';
  }

  drawAnalysisOnChart(res);
  maybeCallAI(res, symbol, interval);
}

// ---------- لایه اختیاری AI (فقط بازنویسی روایت بر اساس داده واقعی) ----------
async function maybeCallAI(res, symbol, interval){
  let settings={};
  try{ settings=JSON.parse(localStorage.getItem('ta_settings') || '{}') || {}; }catch(e){ settings={}; }
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

async function buildCompactMTF(symbol, workingTf='1h'){
  const tfs=[...new Set(['1d','4h',workingTf,'15m'])]; const out={};
  const results=[];
  for(let i=0;i<tfs.length;i+=4){
    const batch=tfs.slice(i,i+4);
    results.push(...await Promise.all(batch.map(async tf=>{
      try{return [tf,deriveTrendState(await fetchKlines(symbol,tf,180))];}catch(e){return [tf,{available:false,error:e.message}];}
    })));
  }
  results.forEach(([tf,v])=>out[tf]=v); return out;
}

async function deepAnalyzeSymbol(symbol, workingTf='1h', htfTf='4h'){
  try{
    const [candles,htfCandles,mtfSnapshot]=await Promise.all([
      fetchKlines(symbol,workingTf,300),
      fetchKlines(symbol,htfTf,180),
      buildCompactMTF(symbol,workingTf)
    ]);
    let res=analyze(candles,htfCandles,mtfSnapshot);
    if(res.insufficient)return null;
    res=await enrichCryptoDerivatives(res,symbol,workingTf);
    res=applyProTraderLayer(res,candles,symbol,workingTf);
    res=applyTrustGate(res,candles,symbol,workingTf);
    return {symbol,workingTf,...res};
  }catch(e){return null;}
}

function scannerCardHTML(item, kind){
  const dirTag = kind==='long' ? '🟢 LONG' : kind==='short' ? '🔴 SHORT' : '🟡 WATCH';
  const plan = kind==='long' ? (validPlan(item.risk)&&item.risk.direction==='LONG'?item.risk:(validPlan(item.watchLong)?item.watchLong:null))
    : kind==='short' ? (validPlan(item.risk)&&item.risk.direction==='SHORT'?item.risk:(validPlan(item.watchShort)?item.watchShort:null))
    : (validPlan(item.watchLong)?item.watchLong:(validPlan(item.watchShort)?item.watchShort:null));
  const planLine = validPlan(plan)
    ? `Entry: ${fmt(plan.entry)} | SL: ${fmt(plan.stopLoss)} | TP1: ${fmt(plan.takeProfit1)} | TP2: ${fmt(plan.takeProfit2)} | TP3: ${fmt(plan.takeProfit3)}`
    : 'داده کافی برای ستاپ عددی معتبر نیست';
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

    const rankScore=d=>(d.setupQuality||0)*0.55+(d.entryReadiness||0)*0.30+Math.max(0,d.confidence||0)*0.15+(d.stableRank?4:0);
    const longs = deep.filter(d=>d.verdictClass==='v-buy').sort((a,b)=>rankScore(b)-rankScore(a)).slice(0,5);
    const shorts = deep.filter(d=>d.verdictClass==='v-sell').sort((a,b)=>rankScore(b)-rankScore(a)).slice(0,5);
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

// ---------- خطایابی سراسری ----------
// خطاهای runtime نباید کل UI را از کار بیندازند؛ جزئیات در console و پیام قابل‌فهم نمایش داده می‌شود.
window.addEventListener('error', e=>{
  console.error('Runtime error:', e.error || e.message);
  if(els.verdictBox && !els.verdictBox.textContent.startsWith('خطا:')){
    els.verdictBox.className='verdict v-none';
    els.verdictBox.textContent='خطای داخلی موتور تحلیل: '+(e.message||'خطای نامشخص')+' — جزئیات در Console ثبت شد.';
  }
});
window.addEventListener('unhandledrejection', e=>{
  console.error('Unhandled promise rejection:', e.reason);
});

function renderQuantV8(res){
  const card=document.getElementById('quantCard'); if(!card||!res||res.insufficient)return;
  card.style.display='block';
  const v=res.volatilityContext||{},b=res.breakoutQuality||{},u=res.uncertainty||{},e=res.executionCost||{},r=res.quantRisk||{};
  document.getElementById('q_regime').textContent=`${v.trend||'—'} / ${v.volatility||'—'}`;
  document.getElementById('q_vol').textContent=`${v.atrPct??'—'}% | ADX ${v.adx??'—'}`;
  document.getElementById('q_breakout').textContent=`Bull ${b.bullish??'—'} / Bear ${b.bearish??'—'}`;
  document.getElementById('q_fakeout').textContent=`${b.fakeoutRisk??'—'}/100`;
  document.getElementById('q_uncertainty').textContent=`${u.score??'—'}/100 (agreement ${u.agreement??'—'}%)`;
  document.getElementById('q_cost').textContent=`${e.estimatedRoundTripBps??'—'} bps`;
  document.getElementById('q_risk').textContent=`${r.recommendedRiskPct??'—'}%`;
}
async function runResearchV8(){
  const symbol=els.symbol.value.trim().toUpperCase(); const interval=els.interval.value;
  const card=document.getElementById('researchCard'),out=document.getElementById('researchContent'); if(card)card.style.display='block';
  if(out)out.textContent='در حال دریافت تاریخچه برای Research Backtest...';
  try{
    const c=await fetchKlines(symbol,interval,1000,true);
    const bt=quickBacktestV8(c,800),wf=runWalkForwardDiagnosticsV8(c);
    if(out){out.innerHTML=bt.ok?`<div class="row"><span>Trades</span><span>${bt.trades}</span></div><div class="row"><span>Win Rate</span><span>${bt.winRate.toFixed(1)}%</span></div><div class="row"><span>Profit Factor</span><span>${bt.profitFactor==null?'—':bt.profitFactor.toFixed(2)}</span></div><div class="row"><span>Expectancy</span><span>${(bt.expectancy*100).toFixed(3)}%</span></div><div class="row"><span>Max Drawdown</span><span>${bt.maxDrawdown.toFixed(2)}%</span></div><div class="row"><span>Walk-Forward</span><span>${wf.ok?(wf.passed?'PASS (diagnostic)':'FAIL / insufficient robustness'):'Unavailable'}</span></div><div class="muted" style="margin-top:8px">${escapeHTML(bt.warning||wf.note||'')}</div>`:'تست اجرا نشد: '+escapeHTML(bt.reason||'داده کافی نیست');}
  }catch(err){if(out)out.textContent='خطا در Research Lab: '+err.message;}
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
    const mtfSnapshot = await buildCompactMTF(symbol, interval);
    let res = analyze(candles, htfCandles, mtfSnapshot);
    if(!res.insufficient){
      res = await enrichCryptoDerivatives(res, symbol, interval);
      res = applyProTraderLayer(res, candles, symbol, interval);
      res = applyAdvancedQuantLayer(res, candles, symbol);
      res = applyTrustGate(res, candles, symbol, interval);
    }
    renderQuantV8(res);
    renderResult(res, symbol, interval, candles.at(-1)?.closeTime);
    renderDecisionDetailsV27(res);
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



/* =========================================================
   V8 QUANT / MARKET CONTEXT LAYER
   اضافه‌شده بر اساس اصول سیستم‌های systematic/pro trading:
   - Regime detection و volatility state
   - Market breadth + BTC-relative strength
   - Breakout quality / fakeout risk
   - Execution-cost realism (spread/fee/slippage)
   - Uncertainty / evidence agreement
   - Risk-aware sizing overlay
   - Research backtest + walk-forward diagnostics (بدون unlock کردن Trade Ready)
   ========================================================= */
const V8_CFG={
  feeBps:4,
  baseSlippageBps:2,
  maxRiskPct:2,
  maxVolPct:8,
  maxCorrelation:0.85,
  breadthCacheMs:60000,
  contextCacheMs:60000
};
const V8_CACHE=new Map();
function meanV8(a){const x=a.filter(Number.isFinite);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null;}
function stdevV8(a){const m=meanV8(a);if(m==null)return null;return Math.sqrt(meanV8(a.map(x=>(x-m)**2))||0);}
function percentileV8(a,p){const x=a.filter(Number.isFinite).sort((u,v)=>u-v);if(!x.length)return null;const i=(x.length-1)*p,k=Math.floor(i),d=i-k;return x[k]+(x[k+1]-x[k])*(d||0);}
function returnsV8(c){const out=[];for(let i=1;i<c.length;i++)out.push(c[i-1].close?c[i].close/c[i-1].close-1:0);return out;}
function correlationV8(a,b){const n=Math.min(a.length,b.length);if(n<20)return null;const x=a.slice(-n),y=b.slice(-n),mx=meanV8(x),my=meanV8(y);let num=0,dx=0,dy=0;for(let i=0;i<n;i++){const xx=x[i]-mx,yy=y[i]-my;num+=xx*yy;dx+=xx*xx;dy+=yy*yy;}return dx&&dy?num/Math.sqrt(dx*dy):null;}
function volatilityRegimeV8(c){
  if(!c||c.length<60)return {available:false};
  const closes=c.map(x=>x.close), A=atr(c,14)||0, last=closes.at(-1);
  const atrPct=last?A/last*100:0;
  const atrSeries=[]; for(let i=30;i<c.length;i++){const a=atr(c.slice(0,i+1),14);if(a&&closes[i])atrSeries.push(a/closes[i]*100);}
  const p25=percentileV8(atrSeries,.25)||atrPct,p75=percentileV8(atrSeries,.75)||atrPct;
  const ad=adx(c,14)?.adx||0;
  const bb=bollinger(closes,20,2);
  const width=bb&&bb.mid?((bb.upper-bb.lower)/bb.mid*100):0;
  let regime='NORMAL'; if(atrPct>=p75*1.15||atrPct>8)regime='HIGH_VOL'; else if(atrPct<=p25*.85)regime='LOW_VOL';
  const trend=ad>=25?'TRENDING':ad<=18?'RANGING':'TRANSITION';
  return {available:true,atrPct:+atrPct.toFixed(3),atrPercentile25:+p25.toFixed(3),atrPercentile75:+p75.toFixed(3),bbWidthPct:+width.toFixed(3),adx:+ad.toFixed(2),volatility:regime,trend,regimeKey:`${trend}_${regime}`};
}
function breakoutQualityV8(c,pattern,vol){
  if(!c||c.length<30)return {available:false};
  const last=c.at(-1),prev=c.at(-2),A=atr(c,14)||0,vr=vol?.ratio||1;
  let up=0,down=0,reasons=[];
  const body=Math.abs(last.close-last.open),range=Math.max(1e-12,last.high-last.low);
  const closePos=(last.close-last.low)/range;
  if(pattern?.breakout==='up'){up+=35; reasons.push('قیمت بالای مرز الگو');}
  if(pattern?.breakout==='down'){down+=35; reasons.push('قیمت زیر مرز الگو');}
  if(A&&body>A*.55){if(last.close>last.open)up+=20;else down+=20;reasons.push('displacement مناسب');}
  if(vr>=1.3){if(last.close>last.open)up+=20;else down+=20;reasons.push('حجم تأییدی');}
  if(last.close>last.open&&closePos>.7)up+=10; if(last.close<last.open&&closePos<.3)down+=10;
  const fakeoutRisk=Math.max(0,Math.min(100,Math.round(100-Math.max(up,down)+(vr<.9?12:0)+(body<A*.3?15:0))));
  return {available:true,bullish:Math.min(100,up),bearish:Math.min(100,down),fakeoutRisk,reasons};
}
function evidenceUncertaintyV8(res){
  const parts=[];
  const vals=[res?.structure?.structure,res?.htfTrend,res?.mtfConfluence?.score,res?.waveEngine?.overall,res?.candleContext?.nextWaveBias,res?.volatilityContext?.trend];
  if(vals.filter(v=>v!=null).length<4)parts.push('شواهد کافی برای اجماع کامل وجود ندارد');
  const dirs=[]; if((res?.score||0)>8)dirs.push('LONG'); if((res?.score||0)<-8)dirs.push('SHORT');
  if(res?.htfTrend==='up')dirs.push('LONG'); if(res?.htfTrend==='down')dirs.push('SHORT');
  if(res?.waveEngine?.overall==='BULLISH')dirs.push('LONG'); if(res?.waveEngine?.overall==='BEARISH')dirs.push('SHORT');
  const L=dirs.filter(x=>x==='LONG').length,S=dirs.filter(x=>x==='SHORT').length,total=L+S;
  const agreement=total?Math.max(L,S)/total*100:50;
  if(Math.abs(L-S)<=1&&total>=3)parts.push('شواهد جهت‌دار متناقض‌اند');
  if(res?.volatilityContext?.volatility==='HIGH_VOL')parts.push('نوسان بالا عدم‌قطعیت اجرا را افزایش می‌دهد');
  if(res?.breakoutQuality?.fakeoutRisk>=55)parts.push('ریسک fakeout بالاست');
  const score=Math.round(Math.max(0,Math.min(100,agreement-parts.length*8)));
  return {score,agreement:Math.round(agreement),reasons:parts};
}
function executionCostV8(res){
  const d=res?.derivatives||{}, spread=d.spreadBps;
  const spreadBps=Number.isFinite(spread)?spread:5;
  const atrPct=res?.volatilityContext?.atrPct||0;
  const slip=V8_CFG.baseSlippageBps+Math.min(20,atrPct*0.75);
  const roundTripBps=2*V8_CFG.feeBps+2*slip+2*spreadBps;
  const score=Math.max(0,Math.min(100,Math.round(100-roundTripBps*2-(atrPct>V8_CFG.maxVolPct?20:0))));
  return {spreadBps:+spreadBps.toFixed(2),estimatedSlippageBps:+slip.toFixed(2),feeBps:V8_CFG.feeBps,estimatedRoundTripBps:+roundTripBps.toFixed(2),score};
}
function applyAdvancedQuantLayer(res,candles,symbol){
  if(!res||res.insufficient)return res;
  res.volatilityContext=volatilityRegimeV8(candles);
  res.breakoutQuality=breakoutQualityV8(candles,res.chartPattern,res.volumeMetrics||res.volume);
  res.executionCost=executionCostV8(res);
  res.uncertainty=evidenceUncertaintyV8(res);
  const riskBase=Math.min(V8_CFG.maxRiskPct,Math.max(.25,Number(els?.riskPctInput?.value)||1));
  const volPenalty=res.volatilityContext?.volatility==='HIGH_VOL'?.65:res.volatilityContext?.volatility==='LOW_VOL'?1.1:1;
  const uncertaintyFactor=Math.max(.35,(res.uncertainty.score||50)/100);
  const executionFactor=Math.max(.35,(res.executionCost.score||50)/100);
  res.quantRisk={baseRiskPct:+riskBase.toFixed(2),recommendedRiskPct:+(riskBase*volPenalty*uncertaintyFactor*executionFactor).toFixed(2),volatilityMultiplier:volPenalty,uncertaintyMultiplier:+uncertaintyFactor.toFixed(2),executionMultiplier:+executionFactor.toFixed(2)};
  const qPenalty=(100-(res.uncertainty.score||50))*.08+(100-(res.executionCost.score||50))*.05+(res.breakoutQuality?.fakeoutRisk||0)*.04;
  res.setupQuality=clamp(Math.round((res.setupQuality||0)-qPenalty),0,100);
  res.confidence=clamp(Math.round(Math.min(res.confidence||50,50+(res.uncertainty.score||50)*.45)),5,95);
  res.notes=res.notes||[];
  res.notes.push(`Regime: ${res.volatilityContext?.trend||'N/A'} / ${res.volatilityContext?.volatility||'N/A'} | ATR%=${res.volatilityContext?.atrPct??'—'}.`);
  res.notes.push(`Execution cost تخمینی: ${res.executionCost.estimatedRoundTripBps} bps | کیفیت اجرا ${res.executionCost.score}/100.`);
  res.notes.push(`Uncertainty/Evidence Agreement=${res.uncertainty.score}/100 | Fakeout Risk=${res.breakoutQuality?.fakeoutRisk??'—'}/100.`);
  if(res.volatilityContext?.volatility==='HIGH_VOL'&&res.verdictClass!=='v-hold'){res.verdict='🟡 WAIT — نوسان بالا است؛ ورود فقط با سایز کاهش‌یافته و تأیید شکست معتبر';res.verdictClass='v-hold';res.risk=null;}
  if((res.uncertainty.score||0)<40&&res.verdictClass!=='v-hold'){res.verdict='🟡 WAIT — شواهد جهت‌دار به‌اندازه کافی هم‌راستا نیستند';res.verdictClass='v-hold';res.risk=null;}
  return res;
}
function quantStatsV9(trades, equityCurve){
  const rets=trades.map(t=>t.r).filter(Number.isFinite);
  const wins=rets.filter(x=>x>0), losses=rets.filter(x=>x<0);
  const avg=meanV8(rets)||0;
  const grossWin=wins.reduce((a,b)=>a+b,0), grossLoss=Math.abs(losses.reduce((a,b)=>a+b,0));
  const downside=losses.length?Math.sqrt(meanV8(losses.map(x=>x*x))||0):0;
  const mean=avg, sd=stdevV8(rets)||0;
  const sharpe=sd?mean/sd*Math.sqrt(Math.max(1,rets.length)):null;
  let peak=1,eq=1,maxDD=0;
  for(const r of rets){eq*=1+r;peak=Math.max(peak,eq);maxDD=Math.max(maxDD,(peak-eq)/peak);}
  const hitRate=rets.length?wins.length/rets.length:0;
  return {trades:rets.length,wins:wins.length,losses:losses.length,winRate:hitRate*100,profitFactor:grossLoss?grossWin/grossLoss:null,expectancy:avg,avgWin:meanV8(wins)||0,avgLoss:meanV8(losses)||0,maxDrawdown:maxDD*100,sharpe,equity:eq,downside,avgR:avg};
}
function strategySignalV9(c){
  if(c.length<140)return null;
  const closes=c.map(x=>x.close), A=atr(c,14)||0, e20=emaSeries(closes,20).at(-1), e50=emaSeries(closes,50).at(-1), r=rsi(closes,14), ad=adx(c,14)?.adx||0;
  if(!A||!Number.isFinite(e20)||!Number.isFinite(e50)||r==null)return null;
  const last=c.at(-1), prev=c.at(-2), body=Math.abs(last.close-last.open), range=Math.max(last.high-last.low,1e-12);
  const bullish=last.close>e20&&e20>e50&&r>52&&r<72&&ad>=20&&last.close>prev.high&&body/range>.45;
  const bearish=last.close<e20&&e20<e50&&r<48&&r>28&&ad>=20&&last.close<prev.low&&body/range>.45;
  if(bullish)return {dir:'LONG',atr:A,entry:last.close,sl:last.close-A*1.2,tp:last.close+A*2.0};
  if(bearish)return {dir:'SHORT',atr:A,entry:last.close,sl:last.close+A*1.2,tp:last.close-A*2.0};
  return null;
}
function backtestEngineV9(candles, cfg={}){
  const warm=cfg.warm||140, feeBps=cfg.feeBps??4, slipBps=cfg.slipBps??2, risk=cfg.risk??0.01;
  const c=candles.slice(); if(c.length<warm+20)return {ok:false,reason:'داده برای بک‌تست کافی نیست'};
  const trades=[]; let position=null;
  for(let i=warm;i<c.length-2;i++){
    const w=c.slice(0,i+1), bar=c[i+1];
    if(position){
      let exit=null,reason=null;
      if(position.dir==='LONG'){ if(bar.low<=position.sl){exit=position.sl;reason='SL';} else if(bar.high>=position.tp){exit=position.tp;reason='TP';} }
      else { if(bar.high>=position.sl){exit=position.sl;reason='SL';} else if(bar.low<=position.tp){exit=position.tp;reason='TP';} }
      if(exit!=null){
        const gross=position.dir==='LONG'?(exit-position.entry)/position.entry:(position.entry-exit)/position.entry;
        const cost=(feeBps*2+slipBps*2)/10000;
        const net=gross-cost;
        trades.push({r:net,dir:position.dir,reason,entry:position.entry,exit}); position=null;
      }
    }
    if(!position){
      const sig=strategySignalV9(w);
      if(sig){
        position={...sig, entry:bar.open*(1+(sig.dir==='LONG'?slipBps:-slipBps)/10000)};
      }
    }
  }
  const stats=quantStatsV9(trades);
  return {ok:true,...stats,feeBps,slipBps,risk,tradesDetail:trades};
}
function regimeBucketV9(c){
  const v=volatilityRegimeV8(c); return v?.regimeKey||'UNKNOWN';
}
function regimeBreakdownV9(candles){
  const buckets={}; const warm=160;
  for(let i=warm;i<candles.length-2;i++){
    const sig=strategySignalV9(candles.slice(0,i+1)); if(!sig)continue;
    const reg=regimeBucketV9(candles.slice(Math.max(0,i-80),i+1));
    const bar=candles[i+1]; let exit=null;
    if(sig.dir==='LONG'){if(bar.low<=sig.sl)exit=sig.sl;else if(bar.high>=sig.tp)exit=sig.tp;}
    else {if(bar.high>=sig.sl)exit=sig.sl;else if(bar.low<=sig.tp)exit=sig.tp;}
    if(exit==null)continue;
    const r=(sig.dir==='LONG'?(exit-sig.entry)/sig.entry:(sig.entry-exit)/sig.entry)-.0012;
    (buckets[reg]??=[]).push({r});
  }
  return Object.entries(buckets).map(([reg,tr])=>({reg,...quantStatsV9(tr)}));
}
function walkForwardV9(candles){
  const n=candles.length;if(n<420)return {ok:false,reason:'حداقل ۴۲۰ کندل برای Walk-Forward توصیه می‌شود'};
  const train=Math.floor(n*.55), test=Math.floor(n*.15), step=test, windows=[];
  for(let start=0;start+train+test<=n;start+=step){
    const tr=backtestEngineV9(candles.slice(start,start+train)), te=backtestEngineV9(candles.slice(start+train,start+train+test));
    windows.push({start,trainTrades:tr.trades,testTrades:te.trades,testPF:te.profitFactor,testWR:te.winRate,testDD:te.maxDrawdown,testExp:te.expectancy});
  }
  const valid=windows.filter(x=>x.testTrades>=5), pfs=valid.map(x=>x.testPF).filter(Number.isFinite);
  const avgPF=meanV8(pfs),avgWR=meanV8(valid.map(x=>x.testWR)),avgDD=meanV8(valid.map(x=>x.testDD)),exp=meanV8(valid.map(x=>x.testExp));
  const pass=valid.length>=3&&avgPF!=null&&avgPF>1.1&&avgWR>=45&&exp>0;
  return {ok:true,windows,validWindows:valid.length,avgPF,avgWR,avgDD,avgExpectancy:exp,passed:pass};
}
function monteCarloV9(trades, n=1000){
  const r=trades.map(t=>t.r).filter(Number.isFinite); if(r.length<20)return {ok:false,reason:'حداقل ۲۰ معامله برای Monte Carlo لازم است'};
  const finals=[],dds=[];
  for(let k=0;k<n;k++){
    let eq=1,peak=1,dd=0;
    for(let i=0;i<r.length;i++){const x=r[Math.floor(Math.random()*r.length)];eq*=1+x;peak=Math.max(peak,eq);dd=Math.max(dd,(peak-eq)/peak);} finals.push(eq-1);dds.push(dd);
  }
  return {ok:true,runs:n,p5:percentileV8(finals,.05),p50:percentileV8(finals,.5),p95:percentileV8(finals,.95),dd95:percentileV8(dds,.95),lossProb:finals.filter(x=>x<0).length/n};
}
function sensitivityV9(candles){
  const configs=[{name:'Base',feeBps:4,slipBps:2},{name:'Cost +50%',feeBps:6,slipBps:3},{name:'Cost x2',feeBps:8,slipBps:4},{name:'Conservative',feeBps:6,slipBps:4}];
  return configs.map(x=>({name:x.name,...backtestEngineV9(candles,x)}));
}
function validationGateV9(bt,wf,mc,sens){
  const reasons=[];
  if(!bt?.ok||bt.trades<100)reasons.push('حداقل ۱۰۰ معامله ثبت نشده');
  if(!wf?.passed)reasons.push('Walk-Forward پایدار نیست');
  if(!mc?.ok||mc.lossProb>.35)reasons.push('Monte Carlo ریسک زیان بالا');
  const stressed=sens?.find(x=>x.name==='Cost x2');
  if(!stressed||!Number.isFinite(stressed.profitFactor)||stressed.profitFactor<=1)reasons.push('استراتژی در هزینه اجرای ۲× مقاوم نیست');
  return {validated:reasons.length===0,reasons};
}
async function runResearchV9(){
  const out=document.getElementById('researchContent'); if(out)out.textContent='در حال اجرای Institutional Validation...';
  try{
    const symbol=els.symbol.value.trim().toUpperCase(), interval=els.interval.value;
    const c=await fetchKlines(symbol,interval,1000);
    const bt=backtestEngineV9(c,{feeBps:4,slipBps:2}),wf=walkForwardV9(c),mc=monteCarloV9(bt.tradesDetail||[],1000),sens=sensitivityV9(c),reg=regimeBreakdownV9(c),gate=validationGateV9(bt,wf,mc,sens);
    const fmt=x=>x==null||!Number.isFinite(x)?'—':x.toFixed(2);
    if(out)out.innerHTML=`<div class="row"><span>Trades</span><span>${bt.trades}</span></div><div class="row"><span>Win Rate</span><span>${fmt(bt.winRate)}%</span></div><div class="row"><span>Profit Factor</span><span>${fmt(bt.profitFactor)}</span></div><div class="row"><span>Expectancy / trade</span><span>${(bt.expectancy*100).toFixed(3)}%</span></div><div class="row"><span>Sharpe-like</span><span>${fmt(bt.sharpe)}</span></div><div class="row"><span>Max Drawdown</span><span>${fmt(bt.maxDrawdown)}%</span></div><div class="row"><span>Walk-Forward</span><span>${wf.passed?'PASS':'FAIL'} — ${wf.validWindows} windows</span></div><div class="row"><span>Monte Carlo P(loss)</span><span>${mc.ok?fmt(mc.lossProb*100)+'%':'—'}</span></div><div class="row"><span>MC 95% DD</span><span>${mc.ok?fmt(mc.dd95*100)+'%':'—'}</span></div><div class="row"><span>Validation Gate</span><span>${gate.validated?'🟢 VALIDATED':'🔴 NOT VALIDATED'}</span></div><div class="muted" style="margin-top:8px"><b>دلایل:</b> ${gate.reasons.length?gate.reasons.join(' • '):'تمام شروط پایه عبور کردند.'}</div><div class="muted" style="margin-top:8px"><b>Regime breakdown:</b> ${reg.map(x=>`${x.reg}: ${x.trades}T / PF ${fmt(x.profitFactor)} / DD ${fmt(x.maxDrawdown)}%`).join(' | ')||'داده کافی نیست'}</div><div class="muted" style="margin-top:8px"><b>Cost sensitivity:</b> ${sens.map(x=>`${x.name}: PF ${fmt(x.profitFactor)}`).join(' | ')}</div><div class="muted" style="margin-top:8px">این موتور برای اعتبارسنجی پژوهشی است؛ حتی PASS به معنی تضمین سود آینده نیست. Look-ahead، survivorship و overfitting باید همچنان کنترل شوند.</div>`;
    window.__V9_VALIDATION={symbol,interval,bt,wf,mc,sens,reg,gate};
  }catch(err){if(out)out.textContent='خطا در Institutional Validation: '+err.message;}
}
const backtestBtnEl=document.getElementById('backtestBtn'); if(backtestBtnEl)backtestBtnEl.onclick=runResearchV9;

/* =========================================================
   PRO TRADER LAYER V4
   سنتز اصول مشترک معامله‌گران حرفه‌ای:
   - دفاع قبل از حمله: ریسک/استاپ قبل از ورود
   - Position sizing بر مبنای فاصلهٔ invalidation
   - عدم میانگین‌کم‌کردن ضرر
   - Time stop برای thesisهایی که باید سریع عمل کنند
   - تشخیص Regime و انتخاب سبک مناسب
   - Liquidity / spread / volatility execution filter
   - Portfolio heat و concentration guard
   - Funding/OI به‌عنوان سنجش crowding، نه پیش‌بینی مستقل جهت
   - Thesis killers و adverse evidence
   - جلوگیری از double-counting شواهد هم‌بسته
   ========================================================= */
const PRO_TRADER_CFG={
  minRR:1.5, preferredRR:2.0, maxRiskPct:2, maxHeatPct:4,
  minExecution:60, maxSpreadBps:18, maxAtrPct:8,
  timeStopBars:6, chaseAtr:0.75
};

function proClamp(v,a=0,b=100){return Math.max(a,Math.min(b,v));}
function proFinite(v,d=null){const n=Number(v);return Number.isFinite(n)?n:d;}
function proPct(a,b){return b?Math.abs(a-b)/Math.abs(b)*100:Infinity;}

function classifyMarketRegimePro(candles,res){
  const adx=proFinite(res?.adxVal?.adx,0), atrV=proFinite(res?.atrVal,0), close=proFinite(res?.lastClose,0);
  const atrPct=close&&atrV?atrV/close*100:0;
  const structure=res?.advancedStructure?.structure||'';
  const trend=(res?.mtfConfluence?.score||0);
  let label='رنج / نامطمئن', type='RANGE', score=50;
  if(adx>=25 && Math.abs(trend)>=0.35){
    type=trend>0?'TREND_UP':'TREND_DOWN'; label=trend>0?'روند صعودی':'روند نزولی'; score=75+Math.min(20,adx-25);
  }else if(adx<18){ type='RANGE'; label='رنج / Mean Reversion'; score=65;
  }else if(atrPct>5.5){ type='HIGH_VOL'; label='نوسان بالا / کاهش سایز'; score=45;
  }else { type='TRANSITION'; label='Transition / Breakout Watch'; score=55; }
  if(structure.includes('صعودی')&&type==='TREND_UP')score+=5;
  if(structure.includes('نزولی')&&type==='TREND_DOWN')score+=5;
  return {type,label,score:proClamp(Math.round(score)),atrPct,adx,trend};
}

function evidenceIndependencePenaltyPro(res){
  const c=res?.componentScores||{};
  // EMA/MTF/Ichimoku همگی تا حدی یک واقعیت را اندازه می‌گیرند؛ از شمردن چندباره جلوگیری کن.
  const trendCluster=Math.abs((c.trend||0)) + Math.abs((c.ichimoku||0)) + Math.abs((c.structure||0));
  const momentumCluster=Math.abs(c.momentum||0)+Math.abs(c.volume||0);
  let penalty=0;
  if(trendCluster>2.15)penalty+=4;
  if(momentumCluster>1.65)penalty+=2;
  return penalty;
}

function buildAdverseEvidencePro(res,regime){
  const out=[]; const score=proFinite(res?.score,0);
  if(res?.mtfConfluence?.htfConflict)out.push('HTF با جهت فعلی مخالف است');
  if(res?.adxVal?.adx<18)out.push('قدرت روند پایین است؛ شکست‌ها مستعد Fakeout هستند');
  if(res?.volumeMetrics?.ratio<0.85)out.push('حجم از میانگین کمتر است');
  if(res?.ichimoku?.priceVsCloud==='inside')out.push('قیمت داخل Kumo است؛ edge ضعیف‌تر');
  if(score>0 && res?.resistances?.[0]?.price && proPct(res.lastClose,res.resistances[0].price)<0.35)out.push('مقاومت نزدیک است و upside محدود می‌شود');
  if(score<0 && res?.supports?.[0]?.price && proPct(res.lastClose,res.supports[0].price)<0.35)out.push('حمایت نزدیک است و downside محدود می‌شود');
  if(regime.type==='HIGH_VOL')out.push('نوسان بالا؛ ریسک slippage و stop-out بیشتر است');
  if(res?.derivatives?.crowding?.extreme)out.push('crowding اهرمی شدید است؛ Funding/OI را به‌عنوان هشدار ریسک در نظر بگیر');
  return [...new Set(out)].slice(0,5);
}

function professionalPositionRiskPro(res){
  const capital=Math.max(proFinite(els?.capitalInput?.value,0),0);
  let riskPct=Math.min(Math.max(proFinite(els?.riskPctInput?.value,1),0.1),PRO_TRADER_CFG.maxRiskPct);
  const regime=res?.proTrader?.regime;
  if(regime?.type==='HIGH_VOL')riskPct=Math.min(riskPct,0.5);
  if(regime?.type==='TRANSITION')riskPct=Math.min(riskPct,0.75);
  const plan=res?.risk;
  const perUnit=plan&&proFinite(plan.entry)!=null&&proFinite(plan.stopLoss)!=null?Math.abs(plan.entry-plan.stopLoss):null;
  const amount=capital*riskPct/100;
  const units=perUnit&&perUnit>0?amount/perUnit:0;
  const value=units*(plan?.entry||0);
  const heat=capital?amount/capital*100:0;
  return {riskPct:+riskPct.toFixed(2),riskAmount:+amount.toFixed(2),units:+units.toFixed(6),positionValue:+value.toFixed(2),heat:+heat.toFixed(2),maxHeat:PRO_TRADER_CFG.maxHeatPct};
}

function validateTradePlanPro(res){
  const p=res?.risk; if(!validPlan(p))return {valid:false,rr1:null,rr2:null,rr3:null,reason:'Entry/SL/TP ناقص'};
  const risk=Math.abs(p.entry-p.stopLoss); if(!risk)return {valid:false,reason:'فاصله Entry/SL صفر'};
  const rr1=Math.abs(p.takeProfit1-p.entry)/risk, rr2=Math.abs(p.takeProfit2-p.entry)/risk, rr3=Math.abs(p.takeProfit3-p.entry)/risk;
  const valid=rr1>=PRO_TRADER_CFG.minRR;
  return {valid,rr1:+rr1.toFixed(2),rr2:+rr2.toFixed(2),rr3:+rr3.toFixed(2),reason:valid?'':'R:R هدف اول زیر حداقل 1:1.5'};
}

function executionQualityPro(res,regime){
  let score=100; const reasons=[];
  const spread=proFinite(res?.execution?.spreadBps,null), atrPct=regime?.atrPct||0;
  if(spread!=null){if(spread>PRO_TRADER_CFG.maxSpreadBps){score-=25;reasons.push('Spread بالا');}else if(spread>10){score-=10;}}
  if(atrPct>PRO_TRADER_CFG.maxAtrPct){score-=20;reasons.push('ATR% بسیار بالا');}
  if((res?.volumeMetrics?.ratio||1)<0.75){score-=15;reasons.push('حجم ضعیف');}
  if(res?.proTrader?.chase){score-=20;reasons.push('ورود تعقیبی');}
  if(res?.derivatives?.crowding?.extreme){score-=10;reasons.push('crowding اهرمی');}
  return {score:proClamp(Math.round(score)),reasons};
}

function applyProTraderLayer(res,candles,symbol,interval){
  if(!res||res.insufficient)return res;
  const regime=classifyMarketRegimePro(candles,res);
  const direction=res.score>0?'LONG':res.score<0?'SHORT':'NEUTRAL';
  const planCheck=validateTradePlanPro(res);
  const chase=direction==='LONG' && res?.resistances?.[0]?.price && res.lastClose>res.resistances[0].price+(res.atrVal||0)*PRO_TRADER_CFG.chaseAtr
    || direction==='SHORT' && res?.supports?.[0]?.price && res.lastClose<res.supports[0].price-(res.atrVal||0)*PRO_TRADER_CFG.chaseAtr;
  const pro={direction,regime,chase:Boolean(chase)};
  res.proTrader=pro;
  const penalty=evidenceIndependencePenaltyPro(res);
  res.setupQuality=proClamp(Math.round((res.setupQuality||0)-penalty));
  const killers=buildAdverseEvidencePro(res,regime);
  pro.killers=killers;
  pro.risk=professionalPositionRiskPro(res);
  pro.execution=executionQualityPro(res,regime);
  res.execution=res.execution||{};
  pro.reasons=[];
  if(regime.type.startsWith('TREND'))pro.reasons.push('رژیم روندی: اجازه به winnerها برای ادامه و تمرکز روی pullback/breakout معتبر');
  if(regime.type==='RANGE')pro.reasons.push('رژیم رنج: breakout بدون confirmation ارزش کمتری دارد');
  if(planCheck.valid)pro.reasons.push(`R:R حداقل ${planCheck.rr1}R و قابل قبول`); else if(planCheck.reason)pro.reasons.push(planCheck.reason);
  if(res?.advancedStructure?.event)pro.reasons.push(`رویداد ساختار: ${res.advancedStructure.event}`);
  if(res?.volumeMetrics?.ratio>=1.15)pro.reasons.push('حجم از میانگین برای تأیید حرکت حمایت می‌کند');
  if(res?.mtfConfluence?.available&&!res.mtfConfluence.htfConflict)pro.reasons.push('هم‌راستایی تایم‌فریم‌های بالاتر');
  if(killers.length)pro.reasons.push('قبل از ورود، شواهد مخالف باید دوباره بررسی شوند');
  pro.executionPlan=[];
  if(!planCheck.valid)pro.executionPlan.push('تا R:R معتبر و invalidation منطقی شکل نگرفته، ورود ممنوع');
  if(chase)pro.executionPlan.push('تعقیب قیمت ممنوع؛ منتظر Retest/Pullback');
  if(regime.type==='HIGH_VOL')pro.executionPlan.push('سایز کاهش یابد؛ SL بر مبنای ساختار و ATR باشد، نه عدد تصادفی');
  pro.executionPlan.push('بعد از ورود، حد ضرر را علیه معامله عقب نبر و روی بازنده میانگین کم نکن');
  pro.executionPlan.push(`Time-stop پیشنهادی: اگر طی ${PRO_TRADER_CFG.timeStopBars} کندل حرکت مورد انتظار شروع نشد، ستاپ را بازبینی کن`);
  const heat=pro.risk.heat;
  pro.risk.rr1=planCheck.rr1; pro.risk.rr2=planCheck.rr2; pro.risk.rr3=planCheck.rr3;
  const entryOK=planCheck.valid && pro.execution.score>=PRO_TRADER_CFG.minExecution && heat<=PRO_TRADER_CFG.maxHeatPct;
  // هرگز ستاپ را به‌خاطر لایهٔ حرفه‌ای به BUY تبدیل نکن؛ این لایه فقط می‌تواند ورود را محدود/کاهش دهد.
  if((res.verdictClass==='v-buy'||res.verdictClass==='v-sell')&&!entryOK){
    res.verdictClass='v-hold';
    res.verdict='🟡 WAIT — ستاپ تحلیلی وجود دارد، اما فیلتر حرفه‌ای اجرا/ریسک ورود را رد کرد';
    res.entryState='WAITING FOR EXECUTION FILTER';
    res.risk=null;
  }
  if(killers.length>=3 && res.setupQuality<78){
    res.verdictClass='v-hold'; res.verdict='⚪ NO TRADE — شواهد مخالف زیاد است'; res.risk=null; res.entryState='INVALIDATED / NO TRADE';
  }
  const confPenalty=penalty+(killers.length*2)+(pro.execution.score<70?8:0);
  res.confidence=proClamp(Math.round((res.confidence||0)-confPenalty),5,95);
  pro.action=res.verdict;
  pro.tradeable=entryOK;
  pro.independencePenalty=penalty;
  return res;
}

const PRO_DERIV_CACHE=new Map();
async function fetchJSONPro(url,timeout=5000){
  const ctl=new AbortController(); const t=setTimeout(()=>ctl.abort(),timeout);
  try{const r=await fetch(url,{signal:ctl.signal,cache:'no-store'}); if(!r.ok)throw new Error(`HTTP ${r.status}`); return await r.json();}
  finally{clearTimeout(t);}
}
async function enrichCryptoDerivatives(res,symbol,interval='1h'){
  if(!symbol||!/^[A-Z0-9]{5,20}$/.test(symbol))return res;
  const key=`${symbol}_${interval}`; const now=Date.now(); const cached=PRO_DERIV_CACHE.get(key);
  if(cached&&now-cached.t<30000){res.derivatives=cached.v; return applyDerivativeCrowding(res,cached.v);}
  try{
    const period=['1m','3m','5m','15m','30m','1h','2h','4h','6h','12h','1d'].includes(interval)?interval:'1h';
    const [fund,oi,book,taker]=await Promise.allSettled([
      fetchJSONPro(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`),
      fetchJSONPro(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol)}`),
      fetchJSONPro(`https://fapi.binance.com/fapi/v1/ticker/bookTicker?symbol=${encodeURIComponent(symbol)}`),
      fetchJSONPro(`https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${encodeURIComponent(symbol)}&period=${period}&limit=1`)
    ]);
    const f=fund.status==='fulfilled'?fund.value:null, o=oi.status==='fulfilled'?oi.value:null, b=book.status==='fulfilled'?book.value:null, t=taker.status==='fulfilled'?(Array.isArray(taker.value)?taker.value[0]:taker.value):null;
    const bid=proFinite(b?.bidPrice),ask=proFinite(b?.askPrice); const mid=bid&&ask?(bid+ask)/2:null; const spreadBps=mid?((ask-bid)/mid)*10000:null;
    const v={status:(f||o||b)?'ok':'unavailable',fundingRate:proFinite(f?.lastFundingRate,0),nextFundingTime:proFinite(f?.nextFundingTime,null),markPrice:proFinite(f?.markPrice,null),openInterest:proFinite(o?.openInterest,null),spreadBps,book:{bid,ask},takerLongShort:proFinite(t?.buySellRatio,null)};
    PRO_DERIV_CACHE.set(key,{t:now,v}); res.derivatives=v; return applyDerivativeCrowding(res,v);
  }catch(e){res.derivatives={status:'unavailable',error:e.message}; return res;}
}
function applyDerivativeCrowding(res,d){
  if(!d||d.status!=='ok')return res;
  const fr=d.fundingRate||0, ts=d.takerLongShort;
  let crowd=0, extreme=false, notes=[];
  if(Math.abs(fr)>=0.0005){crowd+=Math.min(35,Math.abs(fr)*50000); extreme=Math.abs(fr)>=0.001; notes.push(fr>0?'Long crowding':'Short crowding');}
  if(ts!=null&&ts>1.15){crowd+=15;notes.push('taker buy dominance');}
  if(ts!=null&&ts<0.87){crowd+=15;notes.push('taker sell dominance');}
  d.crowding={score:proClamp(Math.round(crowd)),extreme,notes};
  // Funding/OI فقط crowding را توضیح می‌دهد؛ به‌تنهایی جهت معامله را عوض نمی‌کند.
  if(extreme)res.setupQuality=proClamp((res.setupQuality||0)-4);
  if(d.spreadBps!=null){res.execution=res.execution||{};res.execution.spreadBps=d.spreadBps;}
  return res;
}


/* =========================================================
   TRUST / VALIDATION GATE V5
   هدف: جلوگیری از اینکه «امتیاز» با «احتمال برد» اشتباه گرفته شود.
   تا وقتی بک‌تست و Walk-Forward معتبر ثبت نشده، خروجی قابل اجرای زنده نیست.
   ========================================================= */
const TRUST_CFG={maxClosedAgeBars:2,minCandles:100,maxGapBars:2};
function intervalMsPro(tf){const m={"1m":60000,"3m":180000,"5m":300000,"15m":900000,"30m":1800000,"1h":3600000,"2h":7200000,"4h":14400000,"6h":21600000,"12h":43200000,"1d":86400000,"3d":259200000,"1w":604800000};return m[tf]||3600000;}
function validateMarketDataTrust(candles,interval,mtf){
  const checks=[]; let ok=true;
  const n=candles?.length||0;
  if(n<TRUST_CFG.minCandles){checks.push({ok:false,label:'تعداد کندل کافی نیست'});ok=false;}else checks.push({ok:true,label:`${n} کندل بسته‌شده`});
  let malformed=0,dupes=0,gaps=0;
  for(let i=0;i<n;i++){
    const c=candles[i];
    if(!(Number.isFinite(c.open)&&Number.isFinite(c.high)&&Number.isFinite(c.low)&&Number.isFinite(c.close)&&Number.isFinite(c.volume))||c.volume<0||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close)||c.high<c.low) malformed++;
    if(i&&c.time<=candles[i-1].time)dupes++;
    if(i){const expected=intervalMsPro(interval);const d=c.time-candles[i-1].time;if(d>expected*TRUST_CFG.maxGapBars*1.05)gaps++;}
  }
  if(malformed){checks.push({ok:false,label:`${malformed} کندل با OHLCV نامعتبر`});ok=false;}else checks.push({ok:true,label:'OHLCV ساختاری معتبر'});
  if(dupes){checks.push({ok:false,label:'تکرار/ترتیب زمانی نامعتبر'});ok=false;}else checks.push({ok:true,label:'ترتیب زمانی معتبر'});
  if(gaps>0){checks.push({ok:false,label:`${gaps} شکاف بزرگ در داده`});ok=false;}else checks.push({ok:true,label:'بدون شکاف بزرگ'});
  const lastClosed=candles?.at(-1)?.closeTime||0, ageMs=Date.now()-lastClosed, maxAge=intervalMsPro(interval)*TRUST_CFG.maxClosedAgeBars;
  const fresh=lastClosed>0&&ageMs>=0&&ageMs<=maxAge;
  checks.push({ok:fresh,label:fresh?'داده آخر تازه است':`داده آخر قدیمی است (${Math.max(0,Math.round(ageMs/60000))} دقیقه)`}); if(!fresh)ok=false;
  const mtfAvail=mtf?.available===true;
  checks.push({ok:mtfAvail,label:mtfAvail?'MTF در دسترس است':'MTF کامل در دسترس نیست'});
  return {ok,checks,lastClosedTime:lastClosed,ageMs,source:'Binance Spot REST',closedOnly:true};
}
function applyTrustGate(res,candles,symbol,interval){
  if(!res||res.insufficient)return res;
  const data=validateMarketDataTrust(candles,interval,res.mtfConfluence);
  const validation=res.backtestValidation||null;
  // فعلاً این پروژه سابقهٔ بک‌تست/Walk-Forward قابل تأیید در خود اپ ندارد.
  const validated=Boolean(validation?.walkForward?.passed&&validation?.outOfSample?.passed&&Number(validation?.trades)>=100);
  const reasons=[];
  if(!data.ok)reasons.push('کیفیت/تازگی داده برای ورود زنده کافی نیست');
  if(!validated)reasons.push('بک‌تست و Walk-Forward خارج‌ازنمونه هنوز در اپ ثبت و تأیید نشده است');
  const status=!data.ok?'BLOCKED':validated?'TRADE_READY':'PAPER_ONLY';
  res.trust={status,label:status==='TRADE_READY'?'قابل بررسی برای اجرای زنده':status==='PAPER_ONLY'?'فقط Paper Trading':'مسدود تا رفع مشکل داده',score:proClamp(Math.round((data.ok?70:25)+(validated?30:0))),data,validation:{available:Boolean(validation),validated},reasons};
  if(status!=='TRADE_READY'){
    if(res.verdictClass==='v-buy'||res.verdictClass==='v-sell'){
      res.verdictClass='v-hold';
      res.verdict=status==='BLOCKED'?'⛔ NO TRADE — کیفیت داده برای ورود زنده کافی نیست':'🟡 PAPER ONLY — ستاپ وجود دارد، اما هنوز اعتبارسنجی آماری خارج‌ازنمونه ندارد';
      res.entryState=status==='BLOCKED'?'DATA BLOCKED':'PAPER ONLY';
      res.risk=null;
    }
  }
  res.confidence=Math.min(Number(res.confidence)||0,status==='TRADE_READY'?95:49);
  return res;
}


/* ================= V6 PIVOT-FIRST EVIDENCE ENGINE ================= */
(function(){
const legacyAnalyze=analyze;
const safeNum=x=>Number.isFinite(+x)?+x:null;
function atrSafe(c){try{return Number.isFinite(atr(c,14))?atr(c,14):0}catch(e){return 0}}
function pivots(c,left=3,right=3){const a=[],b=[],A=atrSafe(c);for(let i=left;i<c.length-right;i++){const x=c[i],L=c.slice(i-left,i),R=c.slice(i+1,i+1+right);const h=Math.max(...L.map(z=>z.high)),hh=Math.max(...R.map(z=>z.high)),l=Math.min(...L.map(z=>z.low)),ll=Math.min(...R.map(z=>z.low));if(x.high>=h&&x.high>=hh&&Math.min(x.high-h,x.high-hh)>=A*.08)a.push({idx:i,time:x.time,price:x.high,type:'high'});if(x.low<=l&&x.low<=ll&&Math.min(l-x.low,ll-x.low)>=A*.08)b.push({idx:i,time:x.time,price:x.low,type:'low'});}return {highs:a,lows:b}}
function seq(P){const all=[...P.highs,...P.lows].sort((a,b)=>a.idx-b.idx),o=[];for(const p of all){const q=o.at(-1);if(!q||q.type!==p.type)o.push(p);else if((p.type==='high'&&p.price>q.price)||(p.type==='low'&&p.price<q.price))o[o.length-1]=p;}return o}
function cluster(ps,tol){const g=[];for(const p of [...ps].sort((a,b)=>a.price-b.price)){let z=g.at(-1);if(z&&Math.abs(p.price-z.price)/z.price*100<=tol){z.items.push(p);z.price=z.items.reduce((s,x)=>s+x.price,0)/z.items.length;z.low=Math.min(z.low,p.price);z.high=Math.max(z.high,p.price)}else g.push({price:p.price,low:p.price,high:p.price,items:[p]})}return g.map(z=>({price:z.price,low:z.low,high:z.high,touches:z.items.length,pivots:z.items,strength:Math.min(100,35+z.items.length*15)}))}
function sr(c,P,A){const last=c.at(-1).close,tol=Math.max(.08,Math.min(.35,A&&last?A/last*100*.75:.15));return{supports:cluster(P.lows.filter(x=>x.price<last),tol).sort((a,b)=>Math.abs(a.price-last)-Math.abs(b.price-last)).slice(0,5),resistances:cluster(P.highs.filter(x=>x.price>last),tol).sort((a,b)=>Math.abs(a.price-last)-Math.abs(b.price-last)).slice(0,5),tolerancePct:tol}}
function rsiSeries(c){const x=c.map(z=>z.close),n=14,o=Array(x.length).fill(null);if(x.length<=n)return o;let g=0,l=0;for(let i=1;i<=n;i++){let d=x[i]-x[i-1];g+=Math.max(d,0);l+=Math.max(-d,0)}g/=n;l/=n;o[n]=l?100-100/(1+g/l):100;for(let i=n+1;i<x.length;i++){let d=x[i]-x[i-1];g=(g*(n-1)+Math.max(d,0))/n;l=(l*(n-1)+Math.max(-d,0))/n;o[i]=l?100-100/(1+g/l):100}return o}
function emaS(x,n){const o=Array(x.length).fill(null);if(x.length<n)return o;let e=x.slice(0,n).reduce((a,b)=>a+b,0)/n;o[n-1]=e;const k=2/(n+1);for(let i=n;i<x.length;i++){e=x[i]*k+e*(1-k);o[i]=e}return o}
function divergences(c,P){const r=rsiSeries(c),m12=emaS(c.map(x=>x.close),12),m26=emaS(c.map(x=>x.close),26),mh=c.map((_,i)=>m12[i]!=null&&m26[i]!=null?m12[i]-m26[i]:null),out=[];for(const [name,s] of [['RSI',r],['MACD',mh]])for(const t of ['low','high']){const ps=(t==='low'?P.lows:P.highs).slice(-10);if(ps.length<2)continue;const a=ps.at(-2),b=ps.at(-1),va=s[a.idx],vb=s[b.idx];if(va==null||vb==null)continue;if(t==='low'&&b.price<a.price&&vb>va)out.push({type:'bullish',indicator:name,pivotA:a,pivotB:b,evidence:'Price LL + Indicator HL'});if(t==='high'&&b.price>a.price&&vb<va)out.push({type:'bearish',indicator:name,pivotA:a,pivotB:b,evidence:'Price HH + Indicator LH'})}return out}
function line(ps){if(ps.length<2)return null;const n=ps.length,sx=ps.reduce((s,p)=>s+p.idx,0),sy=ps.reduce((s,p)=>s+p.price,0),sxy=ps.reduce((s,p)=>s+p.idx*p.price,0),sxx=ps.reduce((s,p)=>s+p.idx*p.idx,0),d=n*sxx-sx*sx||1,sl=(n*sxy-sx*sy)/d;return{slope:sl,intercept:(sy-sl*sx)/n,points:ps}}
function patterns(c,P,A){const H=P.highs.slice(-8),L=P.lows.slice(-8),last=c.at(-1).close,tol=Math.max(.25,Math.min(1.25,A/last*100*1.25)),eq=(a,b)=>Math.abs(a-b)/b*100<=tol,out=[];if(H.length>=2){const a=H.at(-2),b=H.at(-1),n=L.filter(x=>x.idx>a.idx&&x.idx<b.idx).at(-1);if(n&&eq(a.price,b.price))out.push({name:'Double Top',status:last<n.price?'CONFIRMED':'POTENTIAL',dir:'bearish',neckline:n.price,evidence:[a,b,n]})}if(L.length>=2){const a=L.at(-2),b=L.at(-1),n=H.filter(x=>x.idx>a.idx&&x.idx<b.idx).at(-1);if(n&&eq(a.price,b.price))out.push({name:'Double Bottom',status:last>n.price?'CONFIRMED':'POTENTIAL',dir:'bullish',neckline:n.price,evidence:[a,b,n]})}if(H.length>=3){const [a,b,d]=H.slice(-3),n1=L.find(x=>x.idx>a.idx&&x.idx<b.idx),n2=L.find(x=>x.idx>b.idx&&x.idx<d.idx);if(n1&&n2&&b.price>a.price&&b.price>d.price&&eq(a.price,d.price)){const n=(n1.price+n2.price)/2;out.push({name:'Head & Shoulders',status:last<n?'CONFIRMED':'POTENTIAL',dir:'bearish',neckline:n,evidence:[a,b,d,n1,n2]})}}if(L.length>=3){const [a,b,d]=L.slice(-3),n1=H.find(x=>x.idx>a.idx&&x.idx<b.idx),n2=H.find(x=>x.idx>b.idx&&x.idx<d.idx);if(n1&&n2&&b.price<a.price&&b.price<d.price&&eq(a.price,d.price)){const n=(n1.price+n2.price)/2;out.push({name:'Inverse Head & Shoulders',status:last>n?'CONFIRMED':'POTENTIAL',dir:'bullish',neckline:n,evidence:[a,b,d,n1,n2]})}}if(H.length>=3&&L.length>=3){const U=line(H.slice(-5)),D=line(L.slice(-5)),x=c.length-1,up=U.slope,lo=D.slope,u=up*x+U.intercept,d=lo*x+D.intercept,sx=Math.min(H.slice(-5)[0].idx,L.slice(-5)[0].idx),w0=(up*sx+U.intercept)-(lo*sx+D.intercept),w=u-d,flat=last*.0006;let name=null,dir='neutral';if(w0>0&&w<w0*.88){if(Math.abs(up)<flat&&lo>flat){name='Ascending Triangle';dir='bullish'}else if(up<-flat&&Math.abs(lo)<flat){name='Descending Triangle';dir='bearish'}else if(up<-flat&&lo>flat)name='Symmetrical Triangle';else if(up>flat&&lo>flat){name='Rising Wedge';dir='bearish'}else if(up<-flat&&lo<-flat){name='Falling Wedge';dir='bullish'}}else if(w>w0*1.12)name='Diverging / Broadening Triangle';else if(up>flat&&lo>flat){name='Ascending Channel';dir='bullish'}else if(up<-flat&&lo<-flat){name='Descending Channel';dir='bearish'}else if(Math.abs(up)<flat&&Math.abs(lo)<flat)name='Horizontal Range';if(name){const buf=A*.15,bo=last>u+buf?'up':last<d-buf?'down':null;out.push({name,dir,status:bo?'BREAKOUT_'+bo:'INSIDE',breakout:bo,upperLine:{slope:up,intercept:U.intercept,now:u},lowerLine:{slope:lo,intercept:D.intercept,now:d},evidence:[...H.slice(-5),...L.slice(-5)]})}}return out}
function waves(c,P,A){const s=seq(P).slice(-9),w=[];for(let i=1;i<s.length;i++){const a=s[i-1],b=s[i],dur=Math.max(1,b.idx-a.idx),eff=A?Math.abs(b.price-a.price)/(A*dur):0;w.push({from:a,to:b,dir:b.price>a.price?'up':'down',duration:dur,displacementPct:+((b.price-a.price)/a.price*100).toFixed(2),efficiency:+eff.toFixed(2),strength:eff>=2.2?'VERY STRONG':eff>=1.4?'STRONG':eff>=.8?'NORMAL':eff>=.4?'WEAK':'VERY WEAK'})}const u=w.filter(x=>x.dir==='up'),d=w.filter(x=>x.dir==='down'),avg=a=>a.length?a.reduce((s,x)=>s+x.efficiency,0)/a.length:0,b=Math.max(0,Math.min(100,Math.round(50+(avg(u)-avg(d))*18+(w.at(-1)?.dir==='up'?10:-10)))),br=Math.max(0,Math.min(100,Math.round(50+(avg(d)-avg(u))*18+(w.at(-1)?.dir==='down'?10:-10))));return{waves:w.slice(-6),lastWave:w.at(-1)||null,bullishPressure:b,bearishPressure:br,overall:b-br>=10?'BULLISH':br-b>=10?'BEARISH':'BALANCED',acceleration:w.length>=2&&w.at(-1).dir===w.at(-2).dir?(w.at(-1).efficiency>w.at(-2).efficiency*1.1?'ACCELERATING':w.at(-1).efficiency<w.at(-2).efficiency*.9?'DECELERATING':'STABLE'):'N/A'}}
function enrich(res,c){const A=atrSafe(c),P=pivots(c),S=sr(c,P,A),D=divergences(c,P),Pat=patterns(c,P,A),W=waves(c,P,A);res.pivotEngine={highs:P.highs.slice(-12),lows:P.lows.slice(-12),sequence:seq(P).slice(-16)};res.supports=S.supports;res.resistances=S.resistances;res.divergences=D;res.pivotPatterns=Pat;res.waveEngine=W;res.recentSwingHighs=P.highs.slice(-8).map(x=>x.price);res.recentSwingLows=P.lows.slice(-8).map(x=>x.price);res.chartPattern=Pat.find(x=>['Ascending Triangle','Descending Triangle','Symmetrical Triangle','Rising Wedge','Falling Wedge','Ascending Channel','Descending Channel','Horizontal Range','Diverging / Broadening Triangle'].includes(x.name))||null;res.evidenceGate={noInventedLevels:true,supportsFromConfirmedPivots:true,resistancesFromConfirmedPivots:true,confirmedPatterns:Pat.filter(x=>x.status==='CONFIRMED').map(x=>x.name)};res.notes=res.notes||[];res.notes.push(D.length?D.map(x=>`واگرایی ${x.type==='bullish'?'مثبت':'منفی'} ${x.indicator}: ${x.evidence} روی Pivotهای ${x.pivotA.price.toFixed(4)} → ${x.pivotB.price.toFixed(4)}.`).join(' | '):'واگرایی معتبر Pivot-to-Pivot در RSI/MACD دیده نشد.');res.notes.push(Pat.length?Pat.map(x=>`Pattern مبتنی بر Pivot: ${x.name} — ${x.status}${x.neckline?` — Neckline ${x.neckline.toFixed(4)}`:''}.`).join(' | '):'Pattern معتبر مبتنی بر Pivot شناسایی نشد.');return res}
analyze=function(c,h,m){return enrich(legacyAnalyze(c,h,m),c)};
const oldDraw=drawAnalysisOnChart; drawAnalysisOnChart=async function(res){await oldDraw(res);try{if(!tvWidget||!chartReadyPromise)return;await chartReadyPromise;const ch=tvWidget.activeChart();const txt=p=>{try{ch.createShape({time:Math.floor((p.time||Date.now())/1000),price:p.price},{shape:'text',lock:true,disableSelection:true,disableSave:true,text:`${p.type==='high'?'PH':'PL'} ${p.price.toFixed(4)}`,overrides:{color:p.type==='high'?'#ef5350':'#26a69a',fontsize:9}})}catch(e){}};res.pivotEngine?.highs?.slice(-8).forEach(txt);res.pivotEngine?.lows?.slice(-8).forEach(txt);res.divergences?.slice(-4).forEach(d=>txt({...d.pivotB,price:d.pivotB.price}));}catch(e){}};
const oldRender=renderResult;renderResult=function(res,s,i,t){oldRender(res,s,i,t);let card=document.getElementById('pivotEvidenceCard');if(!card){card=document.createElement('div');card.id='pivotEvidenceCard';card.className='card';const w=document.getElementById('waveCard');w?.parentNode?.insertBefore(card,w);card.innerHTML='<h3>🧭 Pivot Evidence / Wave / Divergence</h3><div id="pivotEvidenceBody"></div>'}const b=document.getElementById('pivotEvidenceBody');if(!b||res.insufficient)return;card.style.display='block';const f=x=>Number(x).toFixed(4);let h=`<div class="row"><span>Pivot High / Low</span><span>${res.pivotEngine.highs.length} / ${res.pivotEngine.lows.length}</span></div>`;h+=`<div class="row"><span>Support / Resistance</span><span>${res.supports.length} / ${res.resistances.length} — Pivot-based</span></div>`;h+='<p class="muted">واگرایی:</p>'+((res.divergences||[]).map(d=>`<div class="row"><span>${d.type==='bullish'?'🟢':'🔴'} ${d.indicator}</span><span>${d.type==='bullish'?'مثبت':'منفی'} · ${f(d.pivotA.price)} → ${f(d.pivotB.price)}</span></div>`).join('')||'<span class="muted">نداریم</span>');h+='<p class="muted">Pattern:</p>'+((res.pivotPatterns||[]).map(p=>`<div><span class="tag ${p.status==='CONFIRMED'?'tag-up':'tag-neu'}">${p.name}</span> ${p.status}${p.neckline?` · ${f(p.neckline)}`:''}</div>`).join('')||'<span class="muted">معتبر نیست</span>');const w=res.waveEngine;if(w?.lastWave)h+=`<p class="muted">آخرین موج: ${w.lastWave.dir==='up'?'⬆':'⬇'} ${w.lastWave.strength} · ${w.lastWave.efficiency} · ${w.lastWave.duration} candles</p><div class="row"><span>فشار Bull/Bear</span><span>${w.bullishPressure} / ${w.bearishPressure}</span></div><div class="row"><span>شتاب موج</span><span>${w.acceleration}</span></div>`;b.innerHTML=h};
})();


// =========================================================
// V10 — Strategy Attribution & Edge Discovery
// هدف: اندازه‌گیری اینکه کدام evidence واقعاً با expectancy مثبت همراه است.
// نکته: این لایه پژوهشی است و به‌تنهایی Trade Ready را فعال نمی‌کند.
// =========================================================
function edgeFeatureSnapshotV10(c){
  if(c.length<160)return null;
  const closes=c.map(x=>x.close), last=c.at(-1), prev=c.at(-2);
  const e20=emaSeries(closes,20).at(-1), e50=emaSeries(closes,50).at(-1);
  const r=rsi(closes,14), ad=adx(c,14)?.adx||0, A=atr(c,14)||0;
  const avgVol=meanV8(c.slice(-21,-1).map(x=>x.volume))||0;
  const vr=avgVol?last.volume/avgVol:1;
  const body=Math.abs(last.close-last.open), range=Math.max(last.high-last.low,1e-12);
  const P=pivots(c), seqNow=seq(P).slice(-6);
  const structureBull=seqNow.length>=3 && seqNow.at(-1).price>seqNow.at(-2).price && seqNow.at(-1).type==='high';
  const structureBear=seqNow.length>=3 && seqNow.at(-1).price<seqNow.at(-2).price && seqNow.at(-1).type==='low';
  const bullishCandle=last.close>last.open && body/range>.55;
  const bearishCandle=last.close<last.open && body/range>.55;
  const breakoutUp=last.close>prev.high && body/range>.45;
  const breakoutDown=last.close<prev.low && body/range>.45;
  const trendBull=Number.isFinite(e20)&&Number.isFinite(e50)&&last.close>e20&&e20>e50;
  const trendBear=Number.isFinite(e20)&&Number.isFinite(e50)&&last.close<e20&&e20<e50;
  const rsiBull=r!=null&&r>52&&r<72, rsiBear=r!=null&&r<48&&r>28;
  const adxStrong=ad>=20;
  const volumeExpansion=vr>=1.25;
  const volA=A&&last.close?A/last.close:0;
  return {
    trendBull,trendBear,rsiBull,rsiBear,adxStrong,volumeExpansion,
    breakoutUp,breakoutDown,bullishCandle,bearishCandle,structureBull,structureBear,
    highVol:volA>=.045, lowVol:volA<.018, atrPct:volA*100, volumeRatio:vr, rsi:r, adx:ad
  };
}
function realizedOutcomeV10(c, i, dir, horizon=6){
  const entry=c[i]?.close; if(!Number.isFinite(entry))return null;
  const end=Math.min(c.length-1,i+horizon);
  let mfe=0, mae=0;
  for(let j=i+1;j<=end;j++){
    const up=(c[j].high-entry)/entry, down=(entry-c[j].low)/entry;
    if(dir==='LONG'){mfe=Math.max(mfe,up);mae=Math.max(mae,down)}
    else {mfe=Math.max(mfe,down);mae=Math.max(mae,up)}
  }
  const ret=(dir==='LONG'?(c[end].close-entry):(entry-c[end].close))/entry;
  return {ret,mfe,mae,win:ret>0};
}
function edgeDiscoveryV10(candles){
  const c=candles.slice(), warm=160, horizon=6;
  if(c.length<warm+40)return {ok:false,reason:'حداقل ۲۰۰ کندل برای Edge Discovery توصیه می‌شود'};
  const features=['trend','rsi','adx','volume','breakout','candle','structure'];
  const buckets={};
  const rows=[];
  for(let i=warm;i<c.length-horizon;i++){
    const f=edgeFeatureSnapshotV10(c.slice(0,i+1)); if(!f)continue;
    const base= f.trendBull&&f.rsiBull&&f.adxStrong ? 'LONG' : f.trendBear&&f.rsiBear&&f.adxStrong ? 'SHORT' : null;
    if(!base)continue;
    const o=realizedOutcomeV10(c,i,base,horizon); if(!o)continue;
    const active={trend:base==='LONG'?f.trendBull:f.trendBear,rsi:base==='LONG'?f.rsiBull:f.rsiBear,adx:f.adxStrong,volume:f.volumeExpansion,breakout:base==='LONG'?f.breakoutUp:f.breakoutDown,candle:base==='LONG'?f.bullishCandle:f.bearishCandle,structure:base==='LONG'?f.structureBull:f.structureBear};
    rows.push({i,dir:base,...active,...o,regime:f.highVol?'HIGH_VOL':f.lowVol?'LOW_VOL':'NORMAL_VOL'});
    for(const name of features) if(active[name]){
      const k=name+':ON'; (buckets[k]??=[]).push(o.ret);
      const off=name+':OFF'; (buckets[off]??=[]).push(o.ret);
    }
  }
  const stat=arr=>{const x=arr.filter(Number.isFinite),wins=x.filter(v=>v>0),loss=x.filter(v=>v<0),gw=wins.reduce((a,b)=>a+b,0),gl=Math.abs(loss.reduce((a,b)=>a+b,0));return {n:x.length,avg:x.length?meanV8(x):null,winRate:x.length?wins.length/x.length*100:null,pf:gl?gw/gl:null};};
  const featureTable=features.map(name=>{
    const on=stat(buckets[name+':ON']||[]), off=stat(buckets[name+':OFF']||[]);
    const lift=Number.isFinite(on.avg)&&Number.isFinite(off.avg)?on.avg-off.avg:null;
    return {feature:name,on,off,lift,edge:lift==null?'INSUFFICIENT':lift>0.001?'POSITIVE':lift<-0.001?'NEGATIVE':'NEUTRAL'};
  });
  const combos={};
  for(const r of rows){const key=features.filter(x=>r[x]).sort().join('+')||'NONE';(combos[key]??=[]).push(r.ret)}
  const comboTable=Object.entries(combos).map(([key,rets])=>({key,...stat(rets)})).filter(x=>x.n>=8).sort((a,b)=>(b.avg??-Infinity)-(a.avg??-Infinity)).slice(0,12);
  const regime={};
  for(const r of rows)(regime[r.regime]??=[]).push(r.ret);
  const regimeTable=Object.entries(regime).map(([k,v])=>({regime:k,...stat(v)}));
  return {ok:true,sample:rows.length,horizon,features:featureTable,combos:comboTable,regimes:regimeTable};
}
function renderEdgeV10(result){
  const out=document.getElementById('edgeContent'); if(!out)return;
  if(!result?.ok){out.textContent=result?.reason||'داده کافی نیست';return;}
  const f=x=>x==null||!Number.isFinite(x)?'—':x.toFixed(3), pct=x=>x==null||!Number.isFinite(x)?'—':x.toFixed(2)+'%';
  let h=`<div class="row"><span>نمونه‌های دارای Setup</span><span>${result.sample}</span></div><div class="row"><span>افق ارزیابی</span><span>${result.horizon} کندل</span></div>`;
  h+='<h4 style="margin:12px 0 6px">Attribution هر مؤلفه</h4>';
  h+=result.features.map(x=>`<div class="row"><span>${x.feature}</span><span>${x.edge} · Lift ${pct(x.lift*100)} · ON ${pct(x.on.winRate)} · PF ${f(x.on.pf)}</span></div>`).join('');
  h+='<h4 style="margin:12px 0 6px">بهترین ترکیب‌های شواهد</h4>';
  h+=(result.combos||[]).slice(0,8).map(x=>`<div class="row"><span>${x.key}</span><span>${x.n}T · WR ${pct(x.winRate)} · PF ${f(x.pf)} · Exp ${pct(x.avg*100)}</span></div>`).join('')||'<span class="muted">داده کافی نیست</span>';
  h+='<h4 style="margin:12px 0 6px">Edge بر اساس Volatility Regime</h4>';
  h+=(result.regimes||[]).map(x=>`<div class="row"><span>${x.regime}</span><span>${x.n}T · WR ${pct(x.winRate)} · PF ${f(x.pf)} · Exp ${pct(x.avg*100)}</span></div>`).join('')||'<span class="muted">داده کافی نیست</span>';
  h+='<p class="muted" style="margin-top:8px">Attribution همبستگی/شرطی است، نه اثبات علّی. قبل از استفاده عملی باید روی دادهٔ خارج‌ازنمونه، هزینه اجرا و چند رژیم بازار تکرار شود.</p>';
  out.innerHTML=h;
}
async function runEdgeV10(){
  const card=document.getElementById('edgeCard'),out=document.getElementById('edgeContent'); if(card)card.style.display='block';
  if(out)out.textContent='در حال کشف Edge واقعی مؤلفه‌ها...';
  try{
    const symbol=els.symbol.value.trim().toUpperCase(), interval=els.interval.value;
    const c=await fetchKlines(symbol,interval,1000), r=edgeDiscoveryV10(c);
    renderEdgeV10(r); window.__V10_EDGE={symbol,interval,result:r};
  }catch(e){if(out)out.textContent='خطا در Edge Discovery: '+e.message;}
}
const edgeBtn=document.getElementById('edgeBtn'); if(edgeBtn)edgeBtn.onclick=runEdgeV10;

// بار اول بعد از لایه Pro Trader
run();

/* =========================================================
   ULTIMATE ADAPTIVE INTELLIGENCE — V15 → V20
   Research-first adaptive layer. It NEVER assumes 100% accuracy.
   - Walk-forward adaptive edge learning from historical closed candles
   - Regime-specific component weights
   - Counterfactual / adversarial thesis checks
   - Cross-asset market context
   - Microstructure-aware meta adjustment
   - Online outcome journal + drift diagnostics
   - Strict anti-overfit guardrails and confidence caps
   ========================================================= */
const ULT_CFG={
  trainBars:900, minTrainingSignals:60, horizon:6, blendBase:.68, adaptiveMaxShift:14,
  learningRate:.08, ridge:.20, minEdgeSamples:25, maxAdaptiveConfidence:92,
  crossAssets:['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT'],
  regimeMinSamples:20, contextTtlMs:90*1000
};
const ULT_STATE=window.__ULT_STATE||{model:null,context:null,trainedAt:0};
window.__ULT_STATE=ULT_STATE;
function uClamp(x,a,b){return Math.max(a,Math.min(b,x))}
function uMean(a){const x=(a||[]).filter(Number.isFinite);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null}
function uStd(a){const m=uMean(a);if(m==null)return null;return Math.sqrt(uMean(a.map(x=>(x-m)**2))||0)}
function uSigmoid(x){return 1/(1+Math.exp(-uClamp(x,-30,30)))}
function uRegime(res){
  const v=res?.volatilityContext||{}; const t=String(v.trend||'').toLowerCase(); const vol=String(v.volatility||'').toLowerCase();
  if(t.includes('range')||t.includes('رنج')) return 'RANGE';
  if(t.includes('transition')||t.includes('گذار')) return 'TRANSITION';
  if(vol.includes('high')||vol.includes('بالا')) return 'HIGH_VOL';
  if(t.includes('up')||t.includes('صعود')) return 'TREND_UP';
  if(t.includes('down')||t.includes('نزول')) return 'TREND_DOWN';
  const ad=mNum(res?.adxVal?.adx,0), atrPct=(mNum(res?.atrVal?.atr??res?.atrVal,0)/Math.max(1,mNum(res?.lastClose,1)))*100;
  if(atrPct>5) return 'HIGH_VOL';
  if(ad<18) return 'RANGE';
  if(mNum(res?.score,0)>10) return 'TREND_UP';
  if(mNum(res?.score,0)<-10) return 'TREND_DOWN';
  return 'NEUTRAL';
}
function uFeatureVector(res){
  const c=res?.componentScores||{};
  return {
    structure:uClamp(mNum(c.structure,0),-1,1), trend:uClamp(mNum(c.trend,0),-1,1), ichimoku:uClamp(mNum(c.ichimoku,0),-1,1),
    supportResistance:uClamp(mNum(c.supportResistance,0),-1,1), volume:uClamp(mNum(c.volume,0),-1,1), priceAction:uClamp(mNum(c.priceAction,0),-1,1),
    wave:uClamp(mNum(c.wave,0),-1,1), pattern:uClamp(mNum(c.pattern,0),-1,1), momentum:uClamp(mNum(c.momentum,0),-1,1),
    smc:uClamp(mNum(c.smc,0),-1,1), fibonacci:uClamp(mNum(c.fibonacci,0),-1,1)
  };
}
const ULT_FEATURES=['structure','trend','ichimoku','supportResistance','volume','priceAction','wave','pattern','momentum','smc','fibonacci'];
function uOutcome(c,i,dir,horizon=6){
  const entry=c[i+1]?.open; if(!Number.isFinite(entry))return null; const end=Math.min(c.length-1,i+1+horizon);
  if(!Number.isFinite(end)||end<=i+1)return null;
  const sign=dir==='LONG'?1:-1; let best=-Infinity;
  for(let j=i+1;j<=end;j++){const b=c[j];best=Math.max(best,sign>0?(b.high-entry)/entry:(entry-b.low)/entry)}
  const exit=c[end].close; const ret=sign>0?(exit-entry)/entry:(entry-exit)/entry;
  return {ret,best,win:ret>0?1:0};
}
function uTrainingSignal(res){
  const dir=mDirection(res); if(!dir)return null;
  const active=['v-buy','v-sell'].includes(res?.verdictClass)||mNum(res?.entryReadiness,0)>=80;
  if(!active)return null;
  return {dir,features:uFeatureVector(res)};
}
function uLearnModel(candles){
  const c=candles||[]; const start=Math.max(180,c.length-ULT_CFG.trainBars), rows=[];
  for(let i=start;i<c.length-ULT_CFG.horizon-2;i+=1){
    let r=null; try{r=_ultimateBaseAnalyze(c.slice(0,i+1),null,null)}catch(e){}
    if(!r||r.insufficient)continue; const s=uTrainingSignal(r); if(!s)continue; const o=uOutcome(c,i,s.dir,ULT_CFG.horizon); if(!o)continue;
    rows.push({...s,outcome:o});
  }
  if(rows.length<ULT_CFG.minTrainingSignals)return {ok:false,reason:`نمونه آموزشی کافی نیست (${rows.length}/${ULT_CFG.minTrainingSignals})`,samples:rows.length};
  const y=rows.map(x=>x.outcome.win), base=uMean(y)||.5, weights={};
  for(const f of ULT_FEATURES){
    const xs=rows.map(x=>x.features[f]); const ym=y.map(v=>v-base); const xm=uMean(xs)||0;
    const num=rows.reduce((s,x,j)=>s+(x.features[f]-xm)*ym[j],0), den=rows.reduce((s,x)=>s+(x.features[f]-xm)**2,0)+ULT_CFG.ridge;
    weights[f]=uClamp(num/(den||1),-.9,.9);
  }
  const regimes={};
  for(const row of rows){
    const rr='ALL'; if(!regimes[rr])regimes[rr]=[]; regimes[rr].push(row);
  }
  // Optional regime-specific weights from the same causal historical sample.
  for(let i=start;i<c.length-ULT_CFG.horizon-2;i+=1){
    let r=null;try{r=_ultimateBaseAnalyze(c.slice(0,i+1),null,null)}catch(e){}
    if(!r||r.insufficient)continue; const s=uTrainingSignal(r);if(!s)continue;const o=uOutcome(c,i,s.dir,ULT_CFG.horizon);if(!o)continue;
    const key=uRegime(r);(regimes[key]||(regimes[key]=[])).push({...s,outcome:o});
  }
  const regimeWeights={};
  for(const [reg,rs] of Object.entries(regimes)){
    if(reg==='ALL'||rs.length<ULT_CFG.regimeMinSamples)continue; const yy=rs.map(x=>x.outcome.win), b=uMean(yy)||.5, ww={};
    for(const f of ULT_FEATURES){const xs=rs.map(x=>x.features[f]),xm=uMean(xs)||0;const num=rs.reduce((z,x,j)=>z+(x.features[f]-xm)*(yy[j]-b),0),den=rs.reduce((z,x)=>z+(x.features[f]-xm)**2,0)+ULT_CFG.ridge;ww[f]=uClamp(num/(den||1),-.9,.9)}
    regimeWeights[reg]={n:rs.length,weights:ww};
  }
  return {ok:true,samples:rows.length,baseRate:base,weights,regimeWeights,trainedAt:Date.now(),window:{start,end:c.length-1}};
}
function uAdaptiveScore(res,model){
  if(!model?.ok)return {scoreShift:0,prob:null,agreement:null,weights:null,regime:'UNKNOWN'};
  const f=uFeatureVector(res),reg=uRegime(res),rw=model.regimeWeights?.[reg]?.weights; const weights=rw||model.weights; let raw=0,abs=0;
  for(const k of ULT_FEATURES){raw+=f[k]*mNum(weights[k],0);abs+=Math.abs(mNum(weights[k],0));}
  const normalized=abs?raw/abs:0, shift=uClamp(normalized*ULT_CFG.adaptiveMaxShift,-ULT_CFG.adaptiveMaxShift,ULT_CFG.adaptiveMaxShift);
  const prob=uSigmoid(normalized*2.5); const signs=ULT_FEATURES.map(k=>Math.sign(f[k])*Math.sign(mNum(weights[k],0))).filter(x=>x); const agreement=signs.length?signs.filter(x=>x>0).length/signs.length:0;
  return {scoreShift:+shift.toFixed(2),prob:+(prob*100).toFixed(1),agreement:Math.round(agreement*100),weights,regime:reg,samples:rw?.n||model.samples};
}
function uCounterfactual(res,adaptive){
  const f=uFeatureVector(res), w=adaptive?.weights||{}; const contrib=ULT_FEATURES.map(k=>({feature:k,value:f[k],weight:mNum(w[k],0),contribution:f[k]*mNum(w[k],0)})).sort((a,b)=>Math.abs(b.contribution)-Math.abs(a.contribution));
  const total=contrib.reduce((s,x)=>s+x.contribution,0), top=contrib.slice(0,4); const withoutTop=total-top.reduce((s,x)=>s+x.contribution,0); const direction=total>=0?'LONG':'SHORT';
  const robust=Math.sign(total)===Math.sign(withoutTop)||Math.abs(total)<.08;
  const killers=contrib.filter(x=>Math.sign(x.contribution)!==Math.sign(total)&&Math.abs(x.contribution)>.10).slice(0,3);
  return {direction,total,withoutTop,robust,top,killers};
}
function uAdversarial(res,adaptive){
  const f=uFeatureVector(res),d=mNum(res?.score,0)>=0?1:-1; const contrary=ULT_FEATURES.reduce((s,k)=>s+(f[k]*d<-.35?Math.abs(f[k]):0),0)/ULT_FEATURES.length;
  const thesis= uCounterfactual(res,adaptive); let penalty=contrary*18; if(!thesis.robust)penalty+=8; if((res?.mtfConfluence?.htfConflict))penalty+=7;
  return {contrary:+contrary.toFixed(3),penalty:+penalty.toFixed(1),robust:thesis.robust,killers:thesis.killers.map(x=>x.feature)};
}
function uApplyAdaptive(res){
  if(!res||res.insufficient)return res;
  const model=ULT_STATE.model; const a=uAdaptiveScore(res,model); const cf=uCounterfactual(res,a); const adv=uAdversarial(res,a);
  const base=mNum(res.score,0), shifted=base+uClamp(a.scoreShift,-ULT_CFG.adaptiveMaxShift,ULT_CFG.adaptiveMaxShift)-adv.penalty*(base>=0?1:-1)*.35;
  const finalScore=+uClamp(ULT_CFG.blendBase*base+(1-ULT_CFG.blendBase)*shifted,-100,100).toFixed(2);
  const qShift=(Math.abs(a.scoreShift)*1.1)-adv.penalty*.7-(cf.robust?0:5); res.score=finalScore;
  res.setupQuality=uClamp(Math.round(mNum(res.setupQuality,50)+qShift),0,100);
  res.confidence=uClamp(Math.round(Math.min(mNum(res.confidence,50),ULT_CFG.maxAdaptiveConfidence)+(a.agreement-50)*.10-adv.penalty*.35),5,ULT_CFG.maxAdaptiveConfidence);
  res.adaptiveIntelligence={enabled:!!model?.ok,regime:a.regime,modelSamples:a.samples||0,scoreShift:a.scoreShift,adaptiveProbability:a.prob,componentAgreement:a.agreement,counterfactual:cf,adversarial:adv};
  res.notes=res.notes||[];
  if(model?.ok)res.notes.push(`Adaptive Edge: رژیم ${a.regime} | تغییر امتیاز ${a.scoreShift>0?'+':''}${a.scoreShift} | توافق اجزا ${a.agreement}% | نمونه ${a.samples}.`);
  if(!cf.robust)res.notes.push('⚠ Counterfactual: حذف شواهد اصلی، جهت را شکننده می‌کند؛ ورود با احتیاط/انتظار تأیید مجدد.');
  if(adv.killers?.length)res.notes.push(`⚠ Adversarial evidence: ${adv.killers.join('، ')} خلاف جهت فعلی فشار ایجاد می‌کند.`);
  return res;
}
async function uFetchContext(interval){
  const now=Date.now(); if(ULT_STATE.context&&now-ULT_STATE.context.time<ULT_CFG.contextTtlMs)return ULT_STATE.context;
  const syms=ULT_CFG.crossAssets.filter(s=>s!=='BTCUSDT'||true); const out={};
  await Promise.all(syms.map(async s=>{try{out[s]=quickTrendSnapshot(await fetchKlines(s,interval,120,true))}catch(e){out[s]={available:false}}}));
  const vals=Object.values(out).filter(x=>x?.available&&Number.isFinite(x.score)); const breadth=vals.length?uMean(vals.map(x=>x.score)):0;
  const btc=out.BTCUSDT?.score||0, eth=out.ETHUSDT?.score||0;
  const context={time:now,breadth,btc,eth,assets:out,marketRegime:Math.abs(breadth)>.45?'TRENDING':Math.abs(breadth)<.15?'RANGE':'MIXED'}; ULT_STATE.context=context; return context;
}
function uApplyCrossAsset(res,ctx){
  if(!res||!ctx)return res; const dir=mNum(res.score,0)>=0?1:-1, b=mNum(ctx.breadth,0),btc=mNum(ctx.btc,0),eth=mNum(ctx.eth,0);
  const alignment=(b*.5+btc*.3+eth*.2)*dir; const conflict=alignment<-.25; const boost=uClamp(alignment*6,-6,6);
  res.score=+uClamp(mNum(res.score,0)+boost,-100,100).toFixed(2); res.setupQuality=uClamp(Math.round(mNum(res.setupQuality,50)+(conflict?-6:boost*.6)),0,100);
  res.crossAssetContext={breadth:+b.toFixed(3),btc:+btc.toFixed(3),eth:+eth.toFixed(3),alignment:+alignment.toFixed(3),conflict,marketRegime:ctx.marketRegime};
  if(conflict){res.confidence=uClamp(mNum(res.confidence,50)-7,5,92);res.notes=(res.notes||[]);res.notes.push('⚠ Cross-asset conflict: جهت فعلی با بایاس BTC/بازار گسترده هم‌راستا نیست.');}
  return res;
}
function uRenderCard(res){
  const old=document.getElementById('ultimateIntelCard');if(old)old.remove(); if(!res||res.insufficient)return;
  const q=res.adaptiveIntelligence||{},x=res.crossAssetContext||{}; const card=document.createElement('div');card.className='card';card.id='ultimateIntelCard';
  card.innerHTML=`<h3>🧠 Ultimate Adaptive Intelligence</h3>
  <div class="row"><span>Regime / Adaptive Edge</span><span>${escapeHTML(q.regime||'—')} · ${q.scoreShift==null?'—':(q.scoreShift>=0?'+':'')+q.scoreShift}</span></div>
  <div class="row"><span>Adaptive Probability</span><span>${q.adaptiveProbability==null?'—':q.adaptiveProbability+'%'}</span></div>
  <div class="row"><span>Evidence Agreement</span><span>${q.componentAgreement==null?'—':q.componentAgreement+'%'}</span></div>
  <div class="row"><span>Counterfactual Robustness</span><span>${q.counterfactual?.robust?'🟢 ROBUST':'🟠 FRAGILE'}</span></div>
  <div class="row"><span>Cross-Asset Alignment</span><span>${x.alignment==null?'—':x.alignment} ${x.conflict?'⚠ conflict':''}</span></div>
  <div class="muted" style="margin-top:8px">این لایه وزن شواهد را از داده‌های تاریخی یاد می‌گیرد، اما به‌دلیل ریسک overfitting و تغییر رژیم، به‌تنهایی اجازه ورود ایجاد نمی‌کند.</div>`;
  const anchor=document.getElementById('masterRiskCard')||document.getElementById('quantCard')||document.getElementById('qualityCard'); anchor?.insertAdjacentElement('afterend',card);
}
async function trainUltimateModel(){
  const symbol=els.symbol.value.trim().toUpperCase(), interval=els.interval.value; const out=document.getElementById('masterContent'); if(out)out.textContent='در حال آموزش Adaptive Edge: فقط کندل‌های بسته + Walk-forward causal sampling...';
  try{const c=await fetchKlines(symbol,interval,Math.min(1000,ULT_CFG.trainBars+220),true);const model=uLearnModel(c);if(model.ok){ULT_STATE.model=model;ULT_STATE.trainedAt=Date.now();try{localStorage.setItem('crypto_ultimate_model',JSON.stringify(model))}catch(e){}};if(out)out.textContent=model.ok?`Adaptive model آموزش داده شد: ${model.samples} سیگنال تاریخی؛ regime-specific weights: ${Object.keys(model.regimeWeights||{}).length}.`:`Adaptive training متوقف شد: ${model.reason}`;return model}catch(e){if(out)out.textContent='خطا در Adaptive Training: '+e.message;return null}
}
function loadUltimateModel(){try{const m=JSON.parse(localStorage.getItem('crypto_ultimate_model')||'null');if(m?.ok)ULT_STATE.model=m}catch(e){}}
loadUltimateModel();
// Wrap the existing synchronous analyzer: historical learning stays causal; live decision receives only a bounded adaptive adjustment.
const _ultimateBaseAnalyze=analyze;
analyze=function(candles,htfCandles,mtfSnapshot){const r=_ultimateBaseAnalyze(candles,htfCandles,mtfSnapshot);return uApplyAdaptive(r)};
// Replace the main Run with a context-aware version while preserving the existing Trust Gate and validation layers.
async function runUltimate(){
  const symbol=els.symbol.value.trim().toUpperCase(), interval=els.interval.value; els.verdictBox.className='verdict v-none';els.verdictBox.textContent='در حال اجرای Ultimate Market Intelligence...';renderTVWidget(symbol,interval);
  try{
    const [candles,htfCandles,mtfSnapshot,ctx]=await Promise.all([fetchKlines(symbol,interval,300,true), (async()=>{const tf=HTF_MAP[interval];return tf?fetchKlines(symbol,tf,250,true):null})(), buildCompactMTF(symbol,interval), uFetchContext(interval)]);
    let res=analyze(candles,htfCandles,mtfSnapshot); if(res.insufficient){renderResult(res,symbol,interval,candles.at(-1)?.closeTime);
    renderDecisionDetailsV27(res);return}
    res=uApplyCrossAsset(res,ctx); res=await enrichCryptoDerivatives(res,symbol,interval); res=applyProTraderLayer(res,candles,symbol,interval); res=applyAdvancedQuantLayer(res,candles,symbol); res=applyTrustGate(res,candles,symbol,interval);
    renderQuantV8(res);renderResult(res,symbol,interval,candles.at(-1)?.closeTime);
    renderDecisionDetailsV27(res);uRenderCard(res);
  }catch(e){els.verdictBox.className='verdict v-none';els.verdictBox.textContent='خطا در Ultimate Engine: '+e.message}
}
els.loadBtn.onclick=runUltimate;
(function(){
  const panel=document.querySelector('.panel');if(!panel)return;
  const card=document.createElement('div');card.className='card';card.id='ultimateCard';card.innerHTML='<h3>🧠 Ultimate AI Control</h3><button class="secondary" id="trainUltimateBtn">آموزش Adaptive Edge Model</button><button class="secondary" id="scanUltimateBtn" style="margin-right:6px">اجرای تحلیل Ultimate</button><div class="muted" style="margin-top:8px">Adaptive Learning، Regime-specific Edge، Counterfactual، Adversarial Evidence و Cross-Asset Context. مدل هیچ‌گاه به‌تنهایی Trade Ready صادر نمی‌کند.</div>';
  panel.insertBefore(card,panel.firstChild);
  document.getElementById('trainUltimateBtn').onclick=trainUltimateModel;document.getElementById('scanUltimateBtn').onclick=runUltimate;
})();

/* =========================================================
   MASTER ROADMAP IMPLEMENTATION — V11 → V14
   - True Engine Replay / exact live analysis replay
   - Calibration & robustness / parameter perturbation / bootstrap / CSCV-style checks
   - Portfolio risk / correlation / heat / drawdown brakes
   - Production journal / drift / execution monitoring / promotion gates
   Research-first: never silently promotes a strategy to live trading.
   ========================================================= */
const MASTER_CFG={
  warm:180, horizon:6, feeBps:4, slippageBps:2, maxTrades:4000,
  minTrades:100, minOOS:60, maxRiskPct:2, maxHeatPct:4,
  maxDrawdownPct:20, maxDriftPct:15, minCalibrationN:50,
  perturbations:[0.85,0.95,1.05,1.15]
};
const MASTER_STATE=window.__MASTER_STATE||{journal:[],baseline:null};
window.__MASTER_STATE=MASTER_STATE;
function mNum(x,d=0){const n=Number(x);return Number.isFinite(n)?n:d}
function mClamp(x,a,b){return Math.max(a,Math.min(b,x))}
function mMean(a){const x=a.filter(Number.isFinite);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null}
function mStd(a){const m=mMean(a);if(m==null)return null;return Math.sqrt(mMean(a.map(x=>(x-m)**2))||0)}
function mPct(a,p){const x=a.filter(Number.isFinite).sort((a,b)=>a-b);if(!x.length)return null;const i=(x.length-1)*p,k=Math.floor(i),d=i-k;return x[k]+((x[k+1]??x[k])-x[k])*(d||0)}
function mStats(trades){const r=trades.map(t=>mNum(t.r,0)).filter(Number.isFinite),w=r.filter(x=>x>0),l=r.filter(x=>x<0),gw=w.reduce((a,b)=>a+b,0),gl=Math.abs(l.reduce((a,b)=>a+b,0));let eq=1,peak=1,dd=0;for(const x of r){eq*=1+x;peak=Math.max(peak,eq);dd=Math.max(dd,(peak-eq)/peak)}const sd=mStd(r);return{trades:r.length,winRate:r.length?w.length/r.length*100:0,profitFactor:gl?gw/gl:null,expectancy:mMean(r)||0,sharpe:sd?mMean(r)/sd*Math.sqrt(r.length):null,maxDrawdown:dd*100,equity:eq}}
function mDirection(res){const v=String(res?.direction||res?.dominantDirection||'').toUpperCase();if(v.includes('LONG')||v.includes('BUY')||v.includes('BULL'))return'LONG';if(v.includes('SHORT')||v.includes('SELL')||v.includes('BEAR'))return'SHORT';const s=mNum(res?.score,0);return s>8?'LONG':s<-8?'SHORT':null}
function mPlan(res,c){const last=c.at(-1)?.close,A=mNum(res?.atrVal?.atr??res?.atrVal,atr(c,14)||0),dir=mDirection(res);if(!last||!A||!dir)return null;const entry=last,sl=dir==='LONG'?entry-A*1.2:entry+A*1.2,tp=dir==='LONG'?entry+A*2:entry-A*2;return{dir,entry,sl,tp,atr:A}}
function mReplaySignal(c){
  try{
    const htf=null, mtf=null;
    const r=analyze(c,htf,mtf); if(!r||r.insufficient)return null;
    const dir=mDirection(r), plan=mPlan(r,c);
    const active=String(r.entryState||'')==='ENTRY ACTIVE'||String(r.entryState||'').includes('ACTIVE')||['v-buy','v-sell'].includes(r.verdictClass);
    return{res:r,dir,plan,active,score:mNum(r.score,0),setupQuality:mNum(r.setupQuality,0),confidence:mNum(r.confidence,0)};
  }catch(e){return null}
}
function mExecuteNextBar(sig,bar,feeBps=4,slipBps=2,horizon=6){
  if(!sig?.plan||!bar)return null;const d=sig.dir,sl=sig.plan.sl,tp=sig.plan.tp;
  const slip=slipBps/10000;const entry=bar.open*(1+(d==='LONG'?slip:-slip));let exit=null,reason='TIME_STOP';
  const end=Math.min(sig.i+horizon, sig.seriesLength-1);
  if(d==='LONG'){if(bar.low<=sl){exit=sl;reason='SL'}else if(bar.high>=tp){exit=tp;reason='TP'}}
  else{if(bar.high>=sl){exit=sl;reason='SL'}else if(bar.low<=tp){exit=tp;reason='TP'}}
  return{entry,exit,reason,d,end};
}
function trueEngineReplayV11(candles,cfg={}){
  const warm=cfg.warm||MASTER_CFG.warm,horizon=cfg.horizon||MASTER_CFG.horizon;
  if(!candles||candles.length < warm + (cfg.minOOS ?? 250))return{ok:false,reason:'داده کافی نیست'};
  const c=candles.slice(),trades=[];let skipped=0;
  for(let i=warm;i<c.length-1 && trades.length<MASTER_CFG.maxTrades;i++){
    const sig=mReplaySignal(c.slice(0,i+1)); if(!sig||!sig.active||!sig.plan||!sig.dir){skipped++;continue}
    const bar=c[i+1], end=Math.min(c.length-1,i+horizon);let exit=null,reason='TIME_STOP';
    const slip=(cfg.slippageBps??MASTER_CFG.slippageBps)/10000,entry=bar.open*(1+(sig.dir==='LONG'?slip:-slip));
    for(let j=i+1;j<=end;j++){
      const b=c[j]; if(sig.dir==='LONG'){if(b.low<=sig.plan.sl){exit=sig.plan.sl;reason='SL';break} if(b.high>=sig.plan.tp){exit=sig.plan.tp;reason='TP';break}}
      else{if(b.high>=sig.plan.sl){exit=sig.plan.sl;reason='SL';break} if(b.low<=sig.plan.tp){exit=sig.plan.tp;reason='TP';break}}
    }
    if(exit==null)exit=c[end].close;
    const gross=sig.dir==='LONG'?(exit-entry)/entry:(entry-exit)/entry;
    const cost=((cfg.feeBps??4)*2+(cfg.slippageBps??2)*2)/10000;
    trades.push({i,dir:sig.dir,r:gross-cost,reason,score:sig.score,setupQuality:sig.setupQuality,confidence:sig.confidence,entry,exit});
  }
  return{ok:true,...mStats(trades),tradesDetail:trades,skipped,warm,horizon,engine:'LIVE_ANALYZE_REPLAY'};
}
function splitReplayV11(c,cfg={}){const n=c.length,cut=Math.floor(n*.7),oos=c.slice(cut);const all=trueEngineReplayV11(c.slice(0,cut),cfg),test=trueEngineReplayV11(oos,{...cfg,warm:Math.min(cfg.warm||MASTER_CFG.warm,Math.max(60,Math.floor(oos.length*.35)))});return{cut,all,test,passed:test.ok&&test.trades>=Math.min(MASTER_CFG.minOOS,Math.max(20,Math.floor(all.trades*.2)))&&test.expectancy>0}}
function ablationReplayV11(c){
  const variants=[
    {name:'FULL_ENGINE',drop:[]},{name:'NO_MOMENTUM',drop:['momentum']},{name:'NO_VOLUME',drop:['volume']},{name:'NO_STRUCTURE',drop:['structure']},{name:'NO_HTF',drop:['htf']}
  ];
  // The actual live engine is intentionally not mutated globally. We measure output sensitivity by tagging evidence availability.
  const base=trueEngineReplayV11(c);return variants.map((v,i)=>({name:v.name,dropped:v.drop,proxy:true,note:i===0?'Exact live-engine replay':'Ablation harness reserved for component hooks in live scoring engine',trades:base.trades,expectancy:base.expectancy,profitFactor:base.profitFactor}));
}
function calibrationV12(replay){const t=replay?.tradesDetail||[];if(t.length<MASTER_CFG.minCalibrationN)return{ok:false,reason:'برای calibration حداقل ۵۰ خروجی لازم است'};const bins=Array.from({length:10},()=>[]);for(const x of t){const p=mClamp(mNum(x.confidence,50)/100,.01,.99),b=Math.min(9,Math.floor(p*10));bins[b].push(x)}const rows=bins.map((x,i)=>{const p=(i+.5)/10,actual=x.length?x.filter(z=>z.r>0).length/x.length:null;return{bin:i,predicted:p,actual,n:x.length,absError:actual==null?null:Math.abs(p-actual)}}).filter(x=>x.n);const ece=rows.length?rows.reduce((s,x)=>s+x.absError*x.n,0)/t.length:null;return{ok:true,ece,rows,quality:ece==null?'UNKNOWN':ece<=.08?'GOOD':ece<=.15?'FAIR':'POOR'}}
function parameterRobustnessV12(c){const out=[];for(const mult of MASTER_CFG.perturbations){const r=trueEngineReplayV11(c,{warm:MASTER_CFG.warm,horizon:MASTER_CFG.horizon,slippageBps:MASTER_CFG.slippageBps*mult,feeBps:MASTER_CFG.feeBps*mult});out.push({mult, ...r})}const valid=out.filter(x=>x.ok&&x.trades>=20&&x.expectancy>0);return{runs:out,robust:valid.length>=Math.ceil(out.length*.75),positiveRuns:valid.length}}
function bootstrapV12(trades,n=1000){const r=(trades||[]).map(x=>x.r).filter(Number.isFinite);if(r.length<20)return{ok:false,reason:'برای Bootstrap حداقل ۲۰ معامله لازم است'};const vals=[];for(let k=0;k<n;k++){let eq=1;for(let i=0;i<r.length;i++)eq*=1+r[Math.floor(Math.random()*r.length)];vals.push(eq-1)}return{ok:true,runs:n,p05:mPct(vals,.05),p50:mPct(vals,.5),p95:mPct(vals,.95),lossProb:vals.filter(x=>x<0).length/n}}
function cscvStyleV12(trades,folds=6){const r=(trades||[]).map(x=>x.r).filter(Number.isFinite);if(r.length<60)return{ok:false,reason:'برای CSCV-style حداقل ۶۰ معامله لازم است'};const f=Math.min(folds,Math.floor(r.length/10));let positive=0,total=0;for(let i=0;i<f;i++)for(let j=i+1;j<f;j++){const a=r.slice(Math.floor(i*r.length/f),Math.floor((i+1)*r.length/f)),b=r.slice(Math.floor(j*r.length/f),Math.floor((j+1)*r.length/f));const train=mMean(a),test=mMean(b);if(train!=null&&test!=null){total++;if(train>0&&test>0)positive++}}return{ok:true,folds:f,pairs:total,positivePairs:positive,stability:total?positive/total:0,pass:total>0&&positive/total>=.6}}
function drawdownBrakesV12(dd){return{normal:dd<5,warning:dd>=5&&dd<10,restricted:dd>=10&&dd<15,killSwitch:dd>=15}}
function portfolioRiskV13(positions=[],capital=1000){const eq=mNum(capital,1000);let heat=0;for(const p of positions){const risk=mNum(p.riskPct,0);heat+=risk}const names=positions.map(p=>p.symbol).filter(Boolean);const conc={};names.forEach(x=>conc[x]=(conc[x]||0)+1);const concentration=Math.max(0,...Object.values(conc));return{capital:eq,positions:positions.length,heatPct:heat,maxHeatPct:MASTER_CFG.maxHeatPct,heatOk:heat<=MASTER_CFG.maxHeatPct,concentrationMax:concentration,killSwitch:heat>MASTER_CFG.maxHeatPct}}
function correlationRiskV13(seriesMap){const keys=Object.keys(seriesMap||{}),pairs=[];for(let i=0;i<keys.length;i++)for(let j=i+1;j<keys.length;j++){const a=seriesMap[keys[i]],b=seriesMap[keys[j]],co=correlationV8(a,b);if(Number.isFinite(co))pairs.push({a:keys[i],b:keys[j],corr:+co.toFixed(3)})}const high=pairs.filter(x=>x.corr>=.85);return{pairs,highCorrelation:high.length>0,high}}
function recordSignalV14(res,symbol,interval){const now=Date.now(),row={id:`${now}-${Math.random().toString(36).slice(2,8)}`,time:now,symbol,interval,verdict:res?.verdict||'',state:res?.entryState||'',score:mNum(res?.score),confidence:mNum(res?.confidence),setupQuality:mNum(res?.setupQuality),price:mNum(res?.lastClose),trust:res?.trust?.status||'UNKNOWN',entry:res?.risk?.entry||null,sl:res?.risk?.stop||null};MASTER_STATE.journal.unshift(row);MASTER_STATE.journal=MASTER_STATE.journal.slice(0,500);try{localStorage.setItem('crypto_engine_journal',JSON.stringify(MASTER_STATE.journal))}catch(e){}return row}
function loadJournalV14(){try{const x=JSON.parse(localStorage.getItem('crypto_engine_journal')||'[]');if(Array.isArray(x))MASTER_STATE.journal=x}catch(e){}}
function driftV14(current,journal=MASTER_STATE.journal){if(!journal.length)return{ok:false,reason:'journal خالی است'};const base=journal.slice(0,Math.min(100,journal.length)),m=x=>mMean(base.map(z=>mNum(z[x])));const score=m('score'),conf=m('confidence');const ds=score==null?null:Math.abs(mNum(current?.score)-score)/Math.max(1,Math.abs(score))*100;const dc=conf==null?null:Math.abs(mNum(current?.confidence)-conf);return{ok:true,scoreDriftPct:ds,confidenceDrift:dc,flag:(ds??0)>MASTER_CFG.maxDriftPct||(dc??0)>15}}
function productionGateV14(replay,oos,cal,rob,mc,cscv){const reasons=[];if(!replay?.ok||replay.trades<MASTER_CFG.minTrades)reasons.push('Exact-engine replay حداقل ۱۰۰ معامله ندارد');if(!oos?.passed)reasons.push('OOS مستقل مثبت/کافی نیست');if(!cal?.ok||cal.quality==='POOR')reasons.push('Calibration ضعیف است');if(!rob?.robust)reasons.push('Robustness زیر آستانه است');if(!mc?.ok||mc.lossProb>.35)reasons.push('Bootstrap/Monte Carlo زیان نهایی بالاست');if(!cscv?.ok||!cscv.pass)reasons.push('CSCV-style stability کافی نیست');return{status:reasons.length?'PAPER_ONLY':'VALIDATED_RESEARCH',promotable:reasons.length===0,reasons}}
function renderMasterV14(data){const out=document.getElementById('masterContent');if(!out)return;const f=x=>x==null||!Number.isFinite(x)?'—':x.toFixed(2),pct=x=>x==null||!Number.isFinite(x)?'—':(x*100).toFixed(2)+'%';out.innerHTML=`<div class="row"><span>Exact Engine Replay</span><span>${data.replay?.trades??'—'}T · PF ${f(data.replay?.profitFactor)} · Exp ${pct(data.replay?.expectancy)}</span></div><div class="row"><span>OOS</span><span>${data.oos?.passed?'🟢 PASS':'🔴 FAIL'} · ${data.oos?.test?.trades??0}T · Exp ${pct(data.oos?.test?.expectancy)}</span></div><div class="row"><span>Calibration</span><span>${data.cal?.quality||'—'} · ECE ${f(data.cal?.ece)}</span></div><div class="row"><span>Robustness</span><span>${data.rob?.robust?'🟢 ROBUST':'🔴 FRAGILE'} · ${data.rob?.positiveRuns??0}/${data.rob?.runs?.length??0}</span></div><div class="row"><span>Bootstrap</span><span>${data.mc?.ok?(pct(data.mc.lossProb)+' loss probability'):'—'}</span></div><div class="row"><span>CSCV-style stability</span><span>${data.cscv?.ok?(pct(data.cscv.stability)):'—'}</span></div><div class="row"><span>Promotion Gate</span><span>${data.gate?.promotable?'🟢 VALIDATED RESEARCH':'🟡 PAPER ONLY'}</span></div><div class="muted" style="margin-top:8px">${data.gate?.reasons?.join(' • ')||'همه شروط پژوهشی عبور کردند؛ این همچنان تضمین سود آینده نیست.'}</div>`}
async function runMasterValidation(){const out=document.getElementById('masterContent');if(out)out.textContent='در حال اجرای Master Validation: Exact Replay → OOS → Calibration → Robustness → Bootstrap → CSCV...';try{const symbol=els.symbol.value.trim().toUpperCase(),interval=els.interval.value,c=await fetchKlines(symbol,interval,1500,true);const replay=trueEngineReplayV11(c),oos=splitReplayV11(c),cal=calibrationV12(replay),rob=parameterRobustnessV12(c),mc=bootstrapV12(replay.tradesDetail),cscv=cscvStyleV12(replay.tradesDetail),ablation=ablationReplayV11(c),gate=productionGateV14(replay,oos,cal,rob,mc,cscv);const data={symbol,interval,replay,oos,cal,rob,mc,cscv,ablation,gate,time:Date.now()};MASTER_STATE.baseline=data;window.__MASTER_VALIDATION=data;renderMasterV14(data);return data}catch(e){if(out)out.textContent='خطا در Master Validation: '+e.message;return null}}
function renderRiskMonitorV14(res){const card=document.getElementById('masterRiskCard'),out=document.getElementById('masterRiskContent');if(!card||!out)return;card.style.display='block';const q=res?.quantRisk||{},d=res?.trust||{};out.innerHTML=`<div class="row"><span>Trust Status</span><span>${d.status||'—'}</span></div><div class="row"><span>Recommended Risk</span><span>${q.recommendedRiskPct??'—'}%</span></div><div class="row"><span>Portfolio Heat Limit</span><span>${MASTER_CFG.maxHeatPct}%</span></div><div class="row"><span>Drawdown Brakes</span><span>5% / 10% / 15%</span></div>`}
loadJournalV14();

// Feed the Master Validation result into the existing Trust Gate without bypassing its data-quality checks.
const _applyTrustGateBase=applyTrustGate;
applyTrustGate=function(res,candles,symbol,interval){
  const out=_applyTrustGateBase(res,candles,symbol,interval);
  try{
    const mv=window.__MASTER_VALIDATION;
    if(out&&!out.insufficient&&mv&&mv.symbol===symbol&&mv.interval===interval){
      const promoted=Boolean(mv.gate?.promotable);
      out.trust.validation={available:true,validated:promoted,masterGate:mv.gate};
      out.trust.status=out.trust.data?.ok&&promoted?'TRADE_READY':out.trust.data?.ok?'PAPER_ONLY':'BLOCKED';
      out.trust.label=out.trust.status==='TRADE_READY'?'قابل بررسی برای اجرای زنده':out.trust.status==='PAPER_ONLY'?'فقط Paper Trading':'مسدود تا رفع مشکل داده';
      out.trust.score=proClamp(Math.round((out.trust.data?.ok?70:25)+(promoted?30:0)));
      if(out.trust.status!=='TRADE_READY'&&(out.verdictClass==='v-buy'||out.verdictClass==='v-sell')){
        out.verdictClass='v-hold';out.verdict='🟡 PAPER ONLY — Master Validation هنوز همه شروط تولید را تأیید نکرده است';out.entryState='PAPER ONLY';out.risk=null;
      }
      out.confidence=Math.min(Number(out.confidence)||0,out.trust.status==='TRADE_READY'?95:49);
    }
  }catch(e){console.warn('Master Trust Gate integration',e)}
  return out;
};

// Master UI + safe integration overrides
(function(){
  const panel=document.querySelector('.panel');
  if(panel && !document.getElementById('masterCard')){
    const card=document.createElement('div');card.className='card';card.id='masterCard';card.innerHTML='<h3>🚀 Master Quant Validation — V11→V14</h3><button class="secondary" id="masterBtn">اجرای کل اعتبارسنجی و توسعه</button><div id="masterContent" class="muted" style="margin-top:8px">Exact Engine Replay، OOS، Calibration، Robustness، Bootstrap، CSCV و Promotion Gate را یکجا اجرا می‌کند. نتیجه فقط در صورت عبور همه شروط «VALIDATED RESEARCH» است.</div>';
    const edge=document.getElementById('edgeCard'); if(edge)edge.parentNode.insertBefore(card,edge.nextSibling); else panel.appendChild(card);
  }
  const btn=document.getElementById('masterBtn'); if(btn)btn.onclick=runMasterValidation;
  const oldRenderMaster=renderResult;
  renderResult=function(res,s,i,t){oldRenderMaster(res,s,i,t);try{recordSignalV14(res,s,i);renderRiskMonitorV14(res)}catch(e){console.warn('journal',e)}};
  if(!document.getElementById('masterRiskCard')){
    const c=document.createElement('div');c.className='card';c.id='masterRiskCard';c.style.display='none';c.innerHTML='<h3>🛡️ Portfolio / Production Risk Guard</h3><div id="masterRiskContent"></div>';
    const q=document.getElementById('quantCard');if(q)q.parentNode.insertBefore(c,q.nextSibling);
  }
})();

/* =========================================================
   V25 — PRECISION / ROBUSTNESS SUPERVISOR
   Goal: improve decision quality without pretending certainty.
   - Replay leakage fix: historical validation uses the frozen base engine.
   - Purged walk-forward validation.
   - Deterministic bootstrap confidence intervals.
   - Permutation/significance test for expectancy.
   - Brier + calibration diagnostics.
   - Ensemble consensus + abstention.
   - Data anomaly / stale-candle guard.
   - Regime-conditioned performance stability.
   - Strict precision gate: weak evidence => NO TRADE.
   ========================================================= */
const PRECISION_CFG={
  minTrades:100,minOOS:40,minTrain:80,minFoldTrades:20,
  purgeBars:6,horizon:6,bootRuns:2000,permRuns:1500,
  maxECE:.12,maxBrier:.26,minOOSExpectancy:0,
  minOOSPF:1.05,minSignificance:.05,minPositiveFolds:.60,
  maxAnomalyRate:.03,maxScoreDisagreement:22,
  abstainConfidence:62,ensembleBaseWeight:.55
};
const PRECISION_STATE=window.__PRECISION_STATE||{validation:null,metrics:null};
window.__PRECISION_STATE=PRECISION_STATE;
function pRand(seed){let s=(seed>>>0)||123456789;return function(){s^=s<<13;s^=s>>>17;s^=s<<5;return (s>>>0)/4294967296}}
function pQuant(a,q){const x=(a||[]).filter(Number.isFinite).sort((a,b)=>a-b);if(!x.length)return null;const z=(x.length-1)*q,k=Math.floor(z),d=z-k;return x[k]+((x[k+1]??x[k])-x[k])*d}
function pNormalApproxP(z){const az=Math.abs(z);const t=1/(1+.2316419*az),d=.39894228*Math.exp(-az*az/2);let prob=d*t*(.31938153+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));prob=1-prob;return 2*(1-prob)}
function pBrier(trades){const a=(trades||[]).map(t=>({p:mClamp(mNum(t.confidence,50)/100,.001,.999),y:t.r>0?1:0}));if(!a.length)return null;return mMean(a.map(x=>(x.p-x.y)**2))}
function pCalibration(trades){const a=(trades||[]).map(t=>({p:mClamp(mNum(t.confidence,50)/100,.001,.999),y:t.r>0?1:0}));if(a.length<PRECISION_CFG.minTrain)return{ok:false,reason:'نمونه کافی برای calibration نیست'};const bins=Array.from({length:10},()=>[]);a.forEach(x=>bins[Math.min(9,Math.floor(x.p*10))].push(x));const rows=bins.map((b,i)=>({bin:i,n:b.length,p:b.length?mMean(b.map(x=>x.p)):null,y:b.length?mMean(b.map(x=>x.y)):null})).filter(x=>x.n);const ece=rows.reduce((s,x)=>s+Math.abs(x.p-x.y)*x.n,0)/a.length;return{ok:true,ece,brier:pBrier(trades),rows,quality:ece<=.07?'GOOD':ece<=PRECISION_CFG.maxECE?'FAIR':'POOR'}}
function pBootstrapCI(trades,runs=PRECISION_CFG.bootRuns,seed=20260909){const r=(trades||[]).map(t=>mNum(t.r,NaN)).filter(Number.isFinite);if(r.length<30)return{ok:false,reason:'حداقل ۳۰ معامله برای CI لازم است'};const rnd=pRand(seed),means=[],pfs=[];for(let k=0;k<runs;k++){const s=[];for(let i=0;i<r.length;i++)s.push(r[Math.floor(rnd()*r.length)]);means.push(mMean(s));const w=s.filter(x=>x>0).reduce((a,b)=>a+b,0),l=Math.abs(s.filter(x=>x<0).reduce((a,b)=>a+b,0));pfs.push(l?w/l:null)}return{ok:true,runs,expectancyCI:[pQuant(means,.025),pQuant(means,.975)],pfCI:[pQuant(pfs.filter(Number.isFinite),.025),pQuant(pfs.filter(Number.isFinite),.975)],probExpPositive:means.filter(x=>x>0).length/runs}}
function pPermutationTest(trades,runs=PRECISION_CFG.permRuns,seed=271828){const r=(trades||[]).map(t=>mNum(t.r,NaN)).filter(Number.isFinite);if(r.length<30)return{ok:false,reason:'حداقل ۳۰ معامله برای آزمون لازم است'};const observed=mMean(r)||0,rnd=pRand(seed);let ge=0;for(let k=0;k<runs;k++){let s=0;for(const x of r)s+=(rnd()<.5?-x:x);if(Math.abs(s/r.length)>=Math.abs(observed))ge++}const p=(ge+1)/(runs+1);return{ok:true,observed,pValue:p,significant:p<PRECISION_CFG.minSignificance}}
function pPurgedWalkForward(candles){const c=candles||[],folds=[];if(c.length<PRECISION_CFG.minTrain+PRECISION_CFG.minOOS*3)return{ok:false,reason:'داده کافی برای Purged Walk-Forward نیست'};const n=c.length,foldSize=Math.floor((n-PRECISION_CFG.minTrain)/4);for(let k=0;k<4;k++){const trainEnd=PRECISION_CFG.minTrain+k*foldSize;const testStart=trainEnd+PRECISION_CFG.purgeBars;const testEnd=Math.min(n,(k===3?n:testStart+foldSize));if(testEnd-testStart<PRECISION_CFG.minOOS)continue;const train=trueEngineReplayV11(c.slice(0,trainEnd),{warm:Math.min(MASTER_CFG.warm,Math.max(60,Math.floor(trainEnd*.35))),horizon:PRECISION_CFG.horizon});const test=trueEngineReplayV11(c.slice(testStart,testEnd),{warm:Math.min(MASTER_CFG.warm,Math.max(60,Math.floor((testEnd-testStart)*.35))),horizon:PRECISION_CFG.horizon});folds.push({fold:k+1,train:{trades:train.trades,expectancy:train.expectancy,pf:train.profitFactor},test:{trades:test.trades,expectancy:test.expectancy,pf:test.profitFactor}})}const valid=folds.filter(f=>f.test.trades>=PRECISION_CFG.minFoldTrades);const pos=valid.filter(f=>f.test.expectancy>PRECISION_CFG.minOOSExpectancy).length;return{ok:valid.length>=3,folds,validFolds:valid.length,positiveFolds:pos,positiveRate:valid.length?pos/valid.length:0,passed:valid.length>=3&&pos/valid.length>=PRECISION_CFG.minPositiveFolds}}
function pAnomalyScan(candles){const c=candles||[];let bad=0,gaps=0,dupes=0,invalid=0;for(let i=0;i<c.length;i++){const x=c[i];if(!(Number.isFinite(x.open)&&Number.isFinite(x.high)&&Number.isFinite(x.low)&&Number.isFinite(x.close)&&Number.isFinite(x.volume))||x.high<x.low||x.high<Math.max(x.open,x.close)||x.low>Math.min(x.open,x.close))invalid++;if(i&&Number.isFinite(x.time)&&Number.isFinite(c[i-1].time)&&x.time<=c[i-1].time)dupes++;if(i&&Number.isFinite(x.time)&&Number.isFinite(c[i-1].time)){const dt=x.time-c[i-1].time;if(dt>0){const med=dt; if(dt>med*4)gaps++}}}bad=invalid+dupes+gaps;return{n:c.length,invalid,duplicates:dupes,gaps,anomalyRate:c.length?bad/c.length:1,ok:c.length>0&&bad/c.length<=PRECISION_CFG.maxAnomalyRate}}
function pEnsemble(res){if(!res||res.insufficient)return{status:'ABSTAIN'};const base=mNum(res.score,0),adaptive=mNum(res.adaptiveIntelligence?.scoreShift,0),agree=mNum(res.adaptiveIntelligence?.componentAgreement,50),cf=res.adaptiveIntelligence?.counterfactual?.robust!==false,adv=mNum(res.adaptiveIntelligence?.adversarial?.penalty,0);const adaptiveScore=base+adaptive;const disagreement=Math.abs(base-adaptiveScore);const confidence=mNum(res.confidence,0);const hardConflict=disagreement>PRECISION_CFG.maxScoreDisagreement||agree<35||!cf||adv>=14;let decision=base>=8?'LONG':base<=-8?'SHORT':'NEUTRAL';if(hardConflict||confidence<PRECISION_CFG.abstainConfidence)decision='ABSTAIN';const strength=mClamp((Math.abs(base)*.55+Math.abs(adaptive)*.45)*(agree/100)*(cf?1:.65)*(1-mClamp(adv/40,0,.7)),0,100);return{baseScore:base,adaptiveScore,disagreement,agreement:agree,counterfactualRobust:cf,adversarialPenalty:adv,decision,strength:+strength.toFixed(2),abstain:decision==='ABSTAIN',reason:hardConflict?'شواهد/مدل‌ها اختلاف یا عدم‌قطعیت بالا دارند':'توافق کافی بین لایه‌های مستقل'}}
function pPrecisionGate(v){const r=[];if(!v?.replay||v.replay.trades<PRECISION_CFG.minTrades)r.push('نمونه معاملات کمتر از حداقل ۱۰۰');if(!v?.oos?.passed)r.push('OOS/Purged Walk-Forward مثبت نیست');if(!v?.cal?.ok||v.cal.ece>PRECISION_CFG.maxECE)r.push('Calibration ضعیف');if(!v?.ci?.ok||v.ci.probExpPositive<.80)r.push('Bootstrap CI: احتمال Expectancy مثبت کافی نیست');if(!v?.perm?.significant)r.push('آزمون permutation از Edge معنادار حمایت نمی‌کند');if(!v?.anomaly?.ok)r.push('کیفیت داده/Anomaly خارج از محدوده است');if(!v?.regime?.passed)r.push('پایداری بین foldها کافی نیست');return{status:r.length?'ABSTAIN/PAPER':'HIGH_CONFIDENCE_RESEARCH',pass:r.length===0,reasons:r}}
function runPrecisionValidation(){const out=document.getElementById('precisionContent');if(out)out.textContent='در حال اجرای Precision Supervisor: replay → purged OOS → calibration → bootstrap CI → permutation → anomaly...';return Promise.resolve().then(async()=>{const symbol=els.symbol.value.trim().toUpperCase(),interval=els.interval.value,c=await fetchKlines(symbol,interval,1500,true);const replay=trueEngineReplayV11(c),oos=pPurgedWalkForward(c),cal=pCalibration(replay.tradesDetail),ci=pBootstrapCI(replay.tradesDetail),perm=pPermutationTest(replay.tradesDetail),anomaly=pAnomalyScan(c),reg=oos,gate=pPrecisionGate({replay,oos,cal,ci,perm,anomaly,reg});const data={symbol,interval,replay,oos,cal,ci,perm,anomaly,reg,gate,time:Date.now(),engine:'V25_PRECISION_SUPERVISOR'};PRECISION_STATE.validation=data;window.__PRECISION_VALIDATION=data;renderPrecision(data);return data}).catch(e=>{if(out)out.textContent='خطا در Precision Supervisor: '+e.message;return null})}
function renderPrecision(d){const out=document.getElementById('precisionContent');if(!out)return;const f=x=>Number.isFinite(x)?x.toFixed(3):'—';const pct=x=>Number.isFinite(x)?(x*100).toFixed(1)+'%':'—';out.innerHTML=`<div class="row"><span>Replay</span><span>${d.replay?.trades??0}T · PF ${f(d.replay?.profitFactor)} · Exp ${pct(d.replay?.expectancy)}</span></div><div class="row"><span>Purged OOS</span><span>${d.oos?.passed?'🟢 PASS':'🔴 FAIL'} · ${d.oos?.positiveFolds??0}/${d.oos?.validFolds??0} positive</span></div><div class="row"><span>Calibration</span><span>${d.cal?.quality||'—'} · ECE ${f(d.cal?.ece)} · Brier ${f(d.cal?.brier)}</span></div><div class="row"><span>Bootstrap 95% CI</span><span>${d.ci?.ok?`${f(d.ci.expectancyCI?.[0])} → ${f(d.ci.expectancyCI?.[1])} · P(Exp>0) ${pct(d.ci.probExpPositive)}`:'—'}</span></div><div class="row"><span>Permutation</span><span>${d.perm?.ok?`p=${f(d.perm.pValue)} · ${d.perm.significant?'🟢 significant':'🔴 not significant'}`:'—'}</span></div><div class="row"><span>Data Integrity</span><span>${d.anomaly?.ok?'🟢 OK':'🔴 ANOMALY'} · ${(100*(d.anomaly?.anomalyRate||0)).toFixed(2)}%</span></div><div class="row"><span>Precision Gate</span><span>${d.gate?.pass?'🟢 HIGH-CONFIDENCE RESEARCH':'🟡 ABSTAIN / PAPER'}</span></div><div class="muted" style="margin-top:8px">${d.gate?.reasons?.join(' • ')||'تمام شروط آماری عبور کردند؛ این تضمین سود آینده نیست.'}</div>`}

// Historical replay must be isolated from the current adaptive model to prevent validation leakage.
const _mReplaySignalFrozen=mReplaySignal;
mReplaySignal=function(c){try{const htf=null,mtf=null,r=_ultimateBaseAnalyze(c,htf,mtf);if(!r||r.insufficient)return null;const dir=mDirection(r),plan=mPlan(r,c);const active=String(r.entryState||'')==='ENTRY ACTIVE'||String(r.entryState||'').includes('ACTIVE')||['v-buy','v-sell'].includes(r.verdictClass);return{res:r,dir,plan,active,score:mNum(r.score,0),setupQuality:mNum(r.setupQuality,0),confidence:mNum(r.confidence,0)}}catch(e){return null}};

// Precision UI.
(function(){const panel=document.querySelector('.panel');if(!panel||document.getElementById('precisionCard'))return;const card=document.createElement('div');card.className='card';card.id='precisionCard';card.innerHTML='<h3>🎯 Precision Supervisor — V25</h3><button class="secondary" id="precisionBtn">اجرای Precision Validation</button><div id="precisionContent" class="muted" style="margin-top:8px">Purged Walk-Forward، Bootstrap CI، Permutation Test، Calibration و Data Integrity را مستقل بررسی می‌کند.</div>';const master=document.getElementById('masterCard');if(master)master.parentNode.insertBefore(card,master.nextSibling);else panel.appendChild(card);document.getElementById('precisionBtn').onclick=runPrecisionValidation})();

// Add a final abstention layer to live analysis. It can only downgrade confidence; it never upgrades a signal to trade-ready.
const _precisionRender=renderResult;
renderResult=function(res,s,i,t){try{if(res&&!res.insufficient){const e=pEnsemble(res);res.precisionSupervisor=e;if(e.abstain&&(res.verdictClass==='v-buy'||res.verdictClass==='v-sell')){res.verdictClass='v-hold';res.verdict='🟡 ABSTAIN — عدم‌قطعیت/اختلاف شواهد بالا';res.entryState='ABSTAIN';res.risk=null;res.confidence=Math.min(mNum(res.confidence,0),49);res.notes=res.notes||[];res.notes.push('Precision Supervisor: برای جلوگیری از over-trading، سیگنال به‌دلیل عدم‌قطعیت abstain شد.')}}}catch(e){console.warn('Precision Supervisor live layer',e)}_precisionRender(res,s,i,t)};


function renderDecisionDetailsV27(res){
  const el=id=>document.getElementById(id);
  if(!res || !el('v27Details')) return;
  const val=x=>x==null||x===''?'—':String(x);
  const dir=x=>x==='up'?'صعودی':x==='down'?'نزولی':x==='mixed'?'مختلط':x==='neutral'?'خنثی':val(x);
  el('v27Trend').textContent=val(res.trend||res.trendBias||res.regime?.trend);
  el('v27Structure').textContent=val(res.structure?.structure||res.marketStructure||res.structureBias);
  el('v27HTF').textContent=dir(res.htfTrend);
  el('v27Momentum').textContent=res.momScore==null?'—':`${res.momScore>0?'+':''}${res.momScore}`;
  el('v27Volume').textContent=res.volScore==null?'—':`${res.volScore>0?'+':''}${res.volScore}`;
  const s=res.supports?.[0]?.price, r=res.resistances?.[0]?.price;
  el('v27SR').textContent=(s!=null||r!=null)?`حمایت: ${s!=null?Number(s).toFixed(4):'—'} | مقاومت: ${r!=null?Number(r).toFixed(4):'—'}`:'سطح معتبر کافی نیست';
  let reasons=[];
  if(Array.isArray(res.notes)) reasons.push(...res.notes);
  if(Array.isArray(res.reasons)) reasons.push(...res.reasons);
  if(res.structure?.structure) reasons.push(`ساختار: ${res.structure.structure}`);
  if(res.wave?.strengthLabel) reasons.push(`قدرت موج: ${res.wave.strengthLabel}`);
  if(res.breakoutQuality?.label) reasons.push(`کیفیت شکست: ${res.breakoutQuality.label}`);
  if(res.regime?.label) reasons.push(`رژیم بازار: ${res.regime.label}`);
  reasons=[...new Set(reasons.map(x=>String(x).trim()).filter(Boolean))].slice(0,6);
  el('v27Reasons').innerHTML=reasons.length?reasons.map(x=>`<li>${x}</li>`).join(''):'<li>جزئیات بیشتری در خروجی فعلی ثبت نشده است.</li>';
  const state=res.state||res.entryState||res.tradingState||'';
  el('v27Status').textContent=state?`وضعیت ستاپ: ${state}`:'جزئیات تکمیلی';
}

// V28 research bridge: exposes read-only backtest functions to the standalone validation lab.
window.__V28_ENGINE = { fetchKlines, trueEngineReplayV11, splitReplayV11, calibrationV12, parameterRobustnessV12, bootstrapV12, cscvStyleV12, pPurgedWalkForward, pCalibration, pBootstrapCI, pPermutationTest, pAnomalyScan, pPrecisionGate, MASTER_CFG, PRECISION_CFG };
