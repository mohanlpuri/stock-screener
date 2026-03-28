exports.handler = async function(event) {

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  try {
    const body = JSON.parse(event.body)
    const { maxPrice, marketCap, minVolume } = body
    const token = process.env.FINNHUB_API_KEY

    // Build market cap filter values
    let marketCapMin = 0
    let marketCapMax = 99999999
    if (marketCap === 'small') { marketCapMin = 0; marketCapMax = 2000 }
    if (marketCap === 'mid')   { marketCapMin = 2000; marketCapMax = 10000 }
    if (marketCap === 'large') { marketCapMin = 10000; marketCapMax = 99999999 }

    // Build volume minimum
    const volumeMap = { any: 0, '100k': 100000, '500k': 500000, '1m': 1000000, '5m': 5000000 }
    const minVol = volumeMap[minVolume] || 0

    // Step 1 — Use Finnhub stock screener endpoint — one call returns filtered list
    const screenerUrl = 'https://finnhub.io/api/v1/stock/symbol?exchange=US&token=' + token
    const symbolsRes = await fetch(screenerUrl)
    const allSymbols = await symbolsRes.json()

    // Filter to common stocks only — skip ETFs, warrants etc.
    const stocks = allSymbols.filter(s =>
      s.type === 'Common Stock' &&
      s.symbol &&
      !s.symbol.includes('.') &&
      !s.symbol.includes('-')
    ).slice(0, 50)

    // Step 2 — Fetch all data in parallel — much faster than sequential
    const results = await Promise.all(
      stocks.map(async function(stock) {
        try {
          const [quoteRes, profileRes, finRes] = await Promise.all([
            fetch('https://finnhub.io/api/v1/quote?symbol=' + stock.symbol + '&token=' + token),
            fetch('https://finnhub.io/api/v1/stock/profile2?symbol=' + stock.symbol + '&token=' + token),
            fetch('https://finnhub.io/api/v1/stock/metric?symbol=' + stock.symbol + '&metric=all&token=' + token)
          ])

          const [quote, profile, fin] = await Promise.all([
            quoteRes.json(),
            profileRes.json(),
            finRes.json()
          ])

          const metrics = fin.metric || {}
          const price = quote.c
          const volume = quote.v || 0
          const cap = profile.marketCapitalization || 0

          // Apply filters
          if (!price || price <= 0) return null
          if (price > maxPrice) return null
          if (cap < marketCapMin || cap > marketCapMax) return null
          if (volume < minVol) return null

          return {
            ticker: stock.symbol,
            name: profile.name || stock.description || stock.symbol,
            price: price,
            marketCap: cap,
            volume: volume,
            sector: profile.finnhubIndustry || 'Unknown',
            week52High: metrics['52WeekHigh'] || null,
            week52Low: metrics['52WeekLow'] || null,
            peRatio: metrics['peBasicExclExtraTTM'] || null,
            bookValue: metrics['bookValuePerShareQuarterly'] || null
          }

        } catch(e) {
          return null
        }
      })
    )

    // Remove nulls and limit to 25
    const filtered = results.filter(Boolean).slice(0, 25)

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ stocks: filtered })
    }

  } catch(e) {
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