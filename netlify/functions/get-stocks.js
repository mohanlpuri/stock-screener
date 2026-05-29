exports.handler = async function(event) {

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  try {
    const body = JSON.parse(event.body)
    const { maxPrice, marketCap, minVolume, customTickers, page } = body

    const FINNHUB_KEY = process.env.FINNHUB_API_KEY
    const currentPage = page || 0   // 0-based page index
    const PAGE_SIZE   = 8

    // Volume minimum map
    const volumeMap = { any: 0, '100k': 100000, '500k': 500000, '1m': 1000000, '5m': 5000000 }
    const minVol = volumeMap[minVolume] || 0

    // Market cap range (in dollars — Finnhub returns marketCapitalization in millions)
    let capMinM = 0
    let capMaxM = 99999999
    if (marketCap === 'small') { capMinM = 0;     capMaxM = 2000    }   // < $2B
    if (marketCap === 'mid')   { capMinM = 2000;  capMaxM = 10000   }   // $2B - $10B
    if (marketCap === 'large') { capMinM = 10000; capMaxM = 99999999 }  // > $10B

    // --- Load tickers from Google Sheet (or fallback hardcoded list) ---
    // --- Load tickers from Google Sheet via API ---
    let defaultTickers = []
    try { 
      const SHEET_ID     = process.env.GOOGLE_SHEET_ID_TICKERS
      const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL
      const PRIVATE_KEY  = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n')

      // Build JWT
      const crypto   = require('crypto')
      const header   = { alg: 'RS256', typ: 'JWT' }
      const now      = Math.floor(Date.now() / 1000)
      const claim    = {
        iss:   CLIENT_EMAIL,
        scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
        aud:   'https://oauth2.googleapis.com/token',
        exp:   now + 3600,
        iat:   now
      }
      const encode   = obj => Buffer.from(JSON.stringify(obj)).toString('base64url')
      const unsigned = encode(header) + '.' + encode(claim)
      const sign     = crypto.createSign('RSA-SHA256')
      sign.update(unsigned)
      const jwt = unsigned + '.' + sign.sign(PRIVATE_KEY, 'base64url')

      // Get access token
      const tokenRes  = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt
      })
      const tokenData = await tokenRes.json()
      const token     = tokenData.access_token

      // Read tickers tab
      const url      = 'https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID + '/values/tickers!A:A'
      const sheetRes = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
      const rawText  = await sheetRes.text()
      console.log('Sheets API response:', rawText.slice(0, 300))
      const data     = JSON.parse(rawText)
      const rows     = data.values || []

      defaultTickers = rows
        .map(row => (row[0] || '').trim().toUpperCase())
        .filter(t => t.length > 0 && t !== 'TICKER')
        .filter((v, i, a) => a.indexOf(v) === i)

      console.log('Tickers from sheet:', defaultTickers.length)

    } catch(sheetErr) {
      console.log('Sheet fetch failed, using fallback:', sheetErr.message)
      defaultTickers = ['AAPL', 'MSFT', 'GOOGL']
    }

    const allTickers  = (customTickers && customTickers.length > 0) ? customTickers : defaultTickers
    const totalPages  = Math.ceil(allTickers.length / PAGE_SIZE)
    const start       = currentPage * PAGE_SIZE
    const pageTickers = allTickers.slice(start, start + PAGE_SIZE)

    console.log(`Page ${currentPage + 1}/${totalPages}, tickers: ${pageTickers.join(',')}`)

    // --- Fetch Finnhub data for each ticker (same 3 endpoints as StockValueSense) ---
    const results = await Promise.all(
      pageTickers.map(async (ticker) => {
        try {
          const base = 'https://finnhub.io/api/v1'

          // Same 3 calls as StockValueSense stock-lookup.js
          const [quoteRes, metricsRes, profileRes, recRes] = await Promise.all([
            fetch(`${base}/quote?symbol=${ticker}&token=${FINNHUB_KEY}`),
            fetch(`${base}/stock/metric?symbol=${ticker}&metric=all&token=${FINNHUB_KEY}`),
            fetch(`${base}/stock/profile2?symbol=${ticker}&token=${FINNHUB_KEY}`),
            fetch(`${base}/stock/recommendation?symbol=${ticker}&token=${FINNHUB_KEY}`)
          ])

          console.log(`Finnhub ${ticker} quote: ${quoteRes.status}`)

          const [quote, metricsData, profile, recData] = await Promise.all([
            quoteRes.json(),
            metricsRes.json(),
            profileRes.json(),
            recRes.json()
          ])

          const metrics = metricsData.metric || {}

          // Price — same field as StockValueSense: quote.c
          const price = quote.c || quote.pc || 0

          if (!price || price <= 0) {
            console.log(`${ticker}: no price, skipping`)
            return null
          }

          // Market cap (Finnhub returns in millions)
          const marketCapM = profile.marketCapitalization || 0
          const volume     = quote.v || 0

          // Apply filters
          if (price > maxPrice) return null
          if (marketCapM > 0 && (marketCapM < capMinM || marketCapM > capMaxM)) return null
          if (minVol > 0 && volume > 0 && volume < minVol) return null

          // --- Same fields as StockValueSense ---
          const week52High = metrics['52WeekHigh'] || null
          const week52Low  = metrics['52WeekLow']  || null
          const peRatio    = metrics['peBasicExclExtraTTM'] || metrics['peAnnual'] || null
          const bookValue  = metrics['bookValuePerShareAnnual'] || metrics['bookValuePerShareQuarterly'] || null
          const pbRatio    = (price && bookValue && bookValue > 0) ? price / bookValue : null
          const divYield   = metrics['currentDividendYieldTTM'] || null

          // Analyst rating — same logic as StockValueSense
          let analystRating = null
          let analystCount  = null
          if (Array.isArray(recData) && recData.length > 0) {
            const latest     = recData[0]
            const totalCount = (latest.strongBuy || 0) + (latest.buy || 0) + (latest.hold || 0) + (latest.sell || 0) + (latest.strongSell || 0)
            const buyScore   = ((latest.strongBuy || 0) * 2 + (latest.buy || 0)) / Math.max(totalCount, 1)
            analystCount     = totalCount

            if (buyScore >= 1.2)     analystRating = '1 - Strong Buy'
            else if (buyScore >= 0.8) analystRating = '2 - Buy'
            else if (buyScore >= 0.4) analystRating = '3 - Hold'
            else                      analystRating = '4 - Sell'
          }

          return {
            ticker:        ticker,
            name:          profile.name || ticker,
            price:         price,
            marketCap:     marketCapM * 1000000,   // convert millions → dollars for display
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
          console.log(`Error fetching ${ticker}:`, e.message)
          return null
        }
      })
    )

    const filteredResults = results.filter(Boolean)
    console.log(`Results: ${filteredResults.length} stocks on page ${currentPage + 1}`)

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
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
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: e.message })
    }
  }

}
