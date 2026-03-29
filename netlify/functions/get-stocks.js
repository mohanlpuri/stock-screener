const yahooFinance = require('yahoo-finance2').default

exports.handler = async function(event) {

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  try {
    const body = JSON.parse(event.body)
    const { maxPrice, marketCap, minVolume } = body

    // Volume minimum map
    const volumeMap = { any: 0, '100k': 100000, '500k': 500000, '1m': 1000000, '5m': 5000000 }
    const minVol = volumeMap[minVolume] || 0

    // Market cap range in actual dollars
    let capMin = 0
    let capMax = 99999999999999
    if (marketCap === 'small') { capMin = 0;             capMax = 2000000000   }
    if (marketCap === 'mid')   { capMin = 2000000000;    capMax = 10000000000  }
    if (marketCap === 'large') { capMin = 10000000000;   capMax = 99999999999999 }

    // Well known US stocks across sectors and price ranges
    const tickers = [
      'F','BAC','INTC','T','AAL','CCL','SNAP','NOK','VALE','PBR',
      'ITUB','GOLD','NEM','KGC','ABEV','RIG','ERIC','BB','SIRI',
      'LCID','RIVN','NIO','XPEV','SOFI','MARA','RIOT','PTON','NCLH',
      'MPW','NLY','AGNC','GME','AMC','TLRY','CGC','ACB','GPRO',
      'PLUG','SPCE','DNA','JOBY','ASTS','SMMT','RXRX','CRSP','NTLA',
      'BEAM','EDIT','WBA','UWMC','CLSK','HUT','BITF','RCL','NKLA',
      'LI','OPEN','CLOV','IVR','TWO','MFA','RC','WKHS','CIFR','ARCT',
      'VERV','FATE','BTBT','PSNY','SANA','BB','NOK','VALE','GOLD'
    ].filter((v, i, a) => a.indexOf(v) === i)

    // Fetch all quotes in one single call
    const quotes = await yahooFinance.quote(tickers)

    // Apply filters
    const results = quotes
      .filter(q => {
        if (!q) return false
        const price = q.regularMarketPrice
        const cap = q.marketCap || 0
        const vol = q.averageDailyVolume3Month || 0

        if (!price || price <= 0) return false
        if (price > maxPrice) return false
        if (cap < capMin || cap > capMax) return false
        if (vol < minVol) return false
        return true
      })
      .slice(0, 25)
      .map(q => ({
        ticker: q.symbol,
        name: q.shortName || q.symbol,
        price: q.regularMarketPrice,
        marketCap: q.marketCap,
        volume: q.averageDailyVolume3Month || 0,
        sector: q.sector || 'Unknown',
        week52High: q.fiftyTwoWeekHigh || null,
        week52Low: q.fiftyTwoWeekLow || null,
        peRatio: q.trailingPE || null,
        bookValue: q.bookValue || null
      }))

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ stocks: results })
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