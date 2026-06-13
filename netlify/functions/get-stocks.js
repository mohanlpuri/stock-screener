exports.handler = async function(event) {

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  }

  try {
    const body = JSON.parse(event.body)

    // ── Shared: Google auth ──────────────────────────────────────────────────
    async function getToken() {  
      const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL
      const PRIVATE_KEY  = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
      const crypto       = require('crypto')
      const header       = { alg: 'RS256', typ: 'JWT' }
      const now          = Math.floor(Date.now() / 1000)
      const claim        = {
        iss:   CLIENT_EMAIL,
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        aud:   'https://oauth2.googleapis.com/token',
        exp:   now + 3600,
        iat:   now
      }
      const encode   = obj => Buffer.from(JSON.stringify(obj)).toString('base64url')
      const unsigned = encode(header) + '.' + encode(claim)
      const sign     = crypto.createSign('RSA-SHA256')
      sign.update(unsigned)
      const jwt      = unsigned + '.' + sign.sign(PRIVATE_KEY, 'base64url')
      const res      = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt
      })
      const data = await res.json()
      return data.access_token 
    }

    //const SHEET_ID = process.env.GOOGLE_SHEET_ID_TICKERS
    const SHEET_ID = '1jEewUVyxHH-vA0qboYE7fGSn22UO7a5fMkwjZ7IXfOE'


    // ── Action: Save to Watchlist ────────────────────────────────────────────
    if (body.action === 'saveToWatchlist') {
      const stock = body.stock
      const token = await getToken()
      const today = new Date().toLocaleDateString('en-US')

      var pct52 = ''
      if (stock.week52High && stock.week52Low && stock.price && stock.week52High > stock.week52Low) {
        pct52 = Math.round(((stock.price - stock.week52Low) / (stock.week52High - stock.week52Low)) * 100) + '%'
      }

      const row = [
        today,
        stock.ticker,
        stock.name          || '',
        stock.price         != null ? stock.price.toFixed(2)       : '',
        stock.week52Low     != null ? stock.week52Low.toFixed(2)   : '',
        pct52,
        stock.week52High    != null ? stock.week52High.toFixed(2)  : '',
        stock.peRatio       != null ? stock.peRatio.toFixed(2)     : '',
        stock.pbRatio       != null ? stock.pbRatio.toFixed(2)     : '',
        stock.analystRating || '',
        stock.dividendYield != null ? stock.dividendYield.toFixed(2) + '%' : '',
        stock.score         != null ? String(stock.score)          : '',
        '',
        ''
      ]

      // Read existing WatchList rows to check for duplicates
      const readUrl  = 'https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID + '/values/WatchList!A:N'
      const readRes  = await fetch(readUrl, { headers: { 'Authorization': 'Bearer ' + token } })
      const readData = await readRes.json()
      const rows     = readData.values || []

      console.log('WatchList existing rows:', rows.length)

      const existingIdx = rows.findIndex(function(r, i) {
        return i > 0 && r[0] === today && r[1] === stock.ticker
      })

      if (existingIdx > 0) {
        // Overwrite existing row
        const rowNum = existingIdx + 1
        const putUrl = 'https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID + '/values/WatchList!A' + rowNum + ':N' + rowNum + '?valueInputOption=RAW'
        const putRes = await fetch(putUrl, {
          method: 'PUT',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [row] })
        })
        const putData = await putRes.json()
        console.log('WatchList updated row ' + rowNum + ' for ' + stock.ticker)
        console.log('Put response:', JSON.stringify(putData).slice(0, 200))
      }  else {
        // Write to next available row
        const nextRow   = rows.length + 1
        const writeUrl  = 'https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID + '/values/WatchList!A' + nextRow + ':N' + nextRow + '?valueInputOption=RAW'
        console.log('Write URL:', writeUrl)
        const writeRes  = await fetch(writeUrl, {
          method: 'PUT',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [row] })
        })
        const writeText = await writeRes.text()
        console.log('WatchList write status:', writeRes.status)
        console.log('WatchList write response:', writeText.slice(0, 200))
      }

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) }
    }

   

    // ── Main screener action ─────────────────────────────────────────────────
    const { maxPrice, marketCap, minVolume, customTickers, page } = body

    const FINNHUB_KEY = process.env.FINNHUB_API_KEY
    const currentPage = page || 0
    const PAGE_SIZE   = 8

    const volumeMap = { any: 0, '100k': 100000, '500k': 500000, '1m': 1000000, '5m': 5000000 }
    const minVol = volumeMap[minVolume] || 0

    let capMinM = 0
    let capMaxM = 99999999
    if (marketCap === 'small') { capMinM = 0;     capMaxM = 2000    }
    if (marketCap === 'mid')   { capMinM = 2000;  capMaxM = 10000   }
    if (marketCap === 'large') { capMinM = 10000; capMaxM = 99999999 }

    // Load tickers from Google Sheet via API
    let defaultTickers = []
    try {
      const token    = await getToken()
      const url      = 'https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID + '/values/tickers!A:A'
      const sheetRes = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
      const rawText  = await sheetRes.text()
      const data     = JSON.parse(rawText)
      const rows     = data.values || []

      defaultTickers = rows
        .map(function(row) { return (row[0] || '').trim().toUpperCase() })
        .filter(function(t) { return t.length > 0 && t !== 'TICKER' })
        .filter(function(v, i, a) { return a.indexOf(v) === i })

      console.log('Tickers from sheet:', defaultTickers.length)

    } catch(sheetErr) {
      console.log('Sheet fetch failed, using fallback:', sheetErr.message)
      defaultTickers = ['AAPL', 'MSFT', 'GOOGL']
    }

    const allTickers  = (customTickers && customTickers.length > 0) ? customTickers : defaultTickers
    const totalPages  = Math.ceil(allTickers.length / PAGE_SIZE)
    const start       = currentPage * PAGE_SIZE
    const pageTickers = allTickers.slice(start, start + PAGE_SIZE)

    console.log('Page ' + (currentPage + 1) + '/' + totalPages + ', tickers: ' + pageTickers.join(','))

    const results = await Promise.all(
      pageTickers.map(async function(ticker) {
        try {
          const base = 'https://finnhub.io/api/v1'

          const [quoteRes, metricsRes, profileRes, recRes] = await Promise.all([
            fetch(base + '/quote?symbol=' + ticker + '&token=' + FINNHUB_KEY),
            fetch(base + '/stock/metric?symbol=' + ticker + '&metric=all&token=' + FINNHUB_KEY),
            fetch(base + '/stock/profile2?symbol=' + ticker + '&token=' + FINNHUB_KEY),
            fetch(base + '/stock/recommendation?symbol=' + ticker + '&token=' + FINNHUB_KEY)
          ])

          console.log('Finnhub ' + ticker + ' quote: ' + quoteRes.status)

          const [quote, metricsData, profile, recData] = await Promise.all([
            quoteRes.json(),
            metricsRes.json(),
            profileRes.json(),
            recRes.json()
          ])

          const metrics    = metricsData.metric || {}
          const price      = quote.c || quote.pc || 0

          if (!price || price <= 0) {
            console.log(ticker + ': no price, skipping')
            return null
          }

          const marketCapM = profile.marketCapitalization || 0
          const volume     = quote.v || 0

          if (price > maxPrice) return null
          if (marketCapM > 0 && (marketCapM < capMinM || marketCapM > capMaxM)) return null
          if (minVol > 0 && volume > 0 && volume < minVol) return null

          const week52High = metrics['52WeekHigh'] || null
          const week52Low  = metrics['52WeekLow']  || null
          const peRatio    = metrics['peBasicExclExtraTTM'] || metrics['peAnnual'] || null
          const bookValue  = metrics['bookValuePerShareAnnual'] || metrics['bookValuePerShareQuarterly'] || null
          const pbRatio    = (price && bookValue && bookValue > 0) ? price / bookValue : null
          const divYield   = metrics['currentDividendYieldTTM'] || null

          let analystRating = null
          let analystCount  = null
          if (Array.isArray(recData) && recData.length > 0) {
            const latest     = recData[0]
            const totalCount = (latest.strongBuy || 0) + (latest.buy || 0) + (latest.hold || 0) + (latest.sell || 0) + (latest.strongSell || 0)
            const buyScore   = ((latest.strongBuy || 0) * 2 + (latest.buy || 0)) / Math.max(totalCount, 1)
            analystCount     = totalCount

            if (buyScore >= 1.2)      analystRating = '1 - Strong Buy'
            else if (buyScore >= 0.8) analystRating = '2 - Buy'
            else if (buyScore >= 0.4) analystRating = '3 - Hold'
            else                      analystRating = '4 - Sell'
          }

          return {
            ticker:        ticker,
            name:          profile.name || ticker,
            price:         price,
            marketCap:     marketCapM * 1000000,
            volume:        volume,
            sector:        profile.finnhubIndustry || 'Unknown',
            week52High:    week52High,
            week52Low:     week52Low,
            peRatio:       peRatio,
            bookValue:     bookValue,
            pbRatio:       pbRatio,
            analystRating: analystRating,
            analystCount:  analystCount,
            dividendYield: divYield
          }

        } catch(e) {
          console.log('Error fetching ' + ticker + ': ' + e.message)
          return null
        }
      })
    )

    const filteredResults = results.filter(Boolean)
    console.log('Results: ' + filteredResults.length + ' stocks on page ' + (currentPage + 1))

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        stocks:       filteredResults,
        page:         currentPage,
        totalPages:   totalPages,
        totalTickers: allTickers.length
      })
    }

  } catch(e) {
    console.log('Error:', e.message)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: e.message })
    }
  }
}
