exports.handler = async function(event) {

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  try {
    const body = JSON.parse(event.body)
    const { maxPrice, marketCap, minVolume } = body
    const token = process.env.FINNHUB_API_KEY

    // Volume minimum map
    const volumeMap = { any: 0, '100k': 100000, '500k': 500000, '1m': 1000000, '5m': 5000000 }
    const minVol = volumeMap[minVolume] || 0

    // Market cap range in millions
    let capMin = 0
    let capMax = 99999999
    if (marketCap === 'small') { capMin = 0;    capMax = 2000  }
    if (marketCap === 'mid')   { capMin = 2000;  capMax = 10000 }
    if (marketCap === 'large') { capMin = 10000; capMax = 99999999 }

    // Pre-built list of 80 well known US stocks across sectors
    // Covers a wide price range so filters work across all settings
    const universe = [
      { ticker: 'F',    name: 'Ford Motor Co',           sector: 'Consumer Cyclical',  cap: 45000  },
      { ticker: 'BAC',  name: 'Bank of America',         sector: 'Financial Services', cap: 304000 },
      { ticker: 'INTC', name: 'Intel Corp',              sector: 'Technology',         cap: 102000 },
      { ticker: 'T',    name: 'AT&T Inc',                sector: 'Communication',      cap: 120000 },
      { ticker: 'WBA',  name: 'Walgreens Boots Alliance',sector: 'Healthcare',         cap: 8000   },
      { ticker: 'AAL',  name: 'American Airlines',       sector: 'Industrials',        cap: 8500   },
      { ticker: 'CCL',  name: 'Carnival Corp',           sector: 'Consumer Cyclical',  cap: 22000  },
      { ticker: 'SNAP', name: 'Snap Inc',                sector: 'Technology',         cap: 18000  },
      { ticker: 'PLUG', name: 'Plug Power Inc',          sector: 'Energy',             cap: 2000   },
      { ticker: 'NOK',  name: 'Nokia Corp',              sector: 'Technology',         cap: 20000  },
      { ticker: 'VALE', name: 'Vale SA',                 sector: 'Basic Materials',    cap: 55000  },
      { ticker: 'PBR',  name: 'Petrobras',               sector: 'Energy',             cap: 80000  },
      { ticker: 'ITUB', name: 'Itau Unibanco',           sector: 'Financial Services', cap: 50000  },
      { ticker: 'GOLD', name: 'Barrick Gold',            sector: 'Basic Materials',    cap: 28000  },
      { ticker: 'NEM',  name: 'Newmont Corp',            sector: 'Basic Materials',    cap: 35000  },
      { ticker: 'KGC',  name: 'Kinross Gold',            sector: 'Basic Materials',    cap: 8000   },
      { ticker: 'ABEV', name: 'Ambev SA',                sector: 'Consumer Defensive', cap: 30000  },
      { ticker: 'RIG',  name: 'Transocean Ltd',          sector: 'Energy',             cap: 4000   },
      { ticker: 'GGAL', name: 'Grupo Financiero Galicia', sector: 'Financial Services',cap: 3000   },
      { ticker: 'ERIC', name: 'Ericsson',                sector: 'Technology',         cap: 18000  },
      { ticker: 'BB',   name: 'BlackBerry Ltd',          sector: 'Technology',         cap: 2000   },
      { ticker: 'SIRI', name: 'Sirius XM Holdings',      sector: 'Communication',      cap: 15000  },
      { ticker: 'NKLA', name: 'Nikola Corp',             sector: 'Industrials',        cap: 500    },
      { ticker: 'LCID', name: 'Lucid Group',             sector: 'Consumer Cyclical',  cap: 7000   },
      { ticker: 'RIVN', name: 'Rivian Automotive',       sector: 'Consumer Cyclical',  cap: 12000  },
      { ticker: 'PSNY', name: 'Polestar Automotive',     sector: 'Consumer Cyclical',  cap: 2000   },
      { ticker: 'NIO',  name: 'NIO Inc',                 sector: 'Consumer Cyclical',  cap: 10000  },
      { ticker: 'XPEV', name: 'XPeng Inc',               sector: 'Consumer Cyclical',  cap: 8000   },
      { ticker: 'LI',   name: 'Li Auto Inc',             sector: 'Consumer Cyclical',  cap: 20000  },
      { ticker: 'SOFI', name: 'SoFi Technologies',       sector: 'Financial Services', cap: 8000   },
      { ticker: 'OPEN', name: 'Opendoor Technologies',   sector: 'Real Estate',        cap: 1500   },
      { ticker: 'WISH', name: 'ContextLogic Inc',        sector: 'Consumer Cyclical',  cap: 200    },
      { ticker: 'CLOV', name: 'Clover Health',           sector: 'Healthcare',         cap: 800    },
      { ticker: 'WKHS', name: 'Workhorse Group',         sector: 'Industrials',        cap: 300    },
      { ticker: 'SPCE', name: 'Virgin Galactic',         sector: 'Industrials',        cap: 500    },
      { ticker: 'TLRY', name: 'Tilray Brands',           sector: 'Consumer Defensive', cap: 1500   },
      { ticker: 'CGC',  name: 'Canopy Growth Corp',      sector: 'Consumer Defensive', cap: 500    },
      { ticker: 'ACB',  name: 'Aurora Cannabis',         sector: 'Consumer Defensive', cap: 400    },
      { ticker: 'CRON', name: 'Cronos Group',            sector: 'Consumer Defensive', cap: 800    },
      { ticker: 'MARA', name: 'Marathon Digital',        sector: 'Technology',         cap: 4000   },
      { ticker: 'RIOT', name: 'Riot Platforms',          sector: 'Technology',         cap: 3000   },
      { ticker: 'CIFR', name: 'Cipher Mining',           sector: 'Technology',         cap: 500    },
      { ticker: 'HUT',  name: 'Hut 8 Corp',              sector: 'Technology',         cap: 600    },
      { ticker: 'BITF', name: 'Bitfarms Ltd',            sector: 'Technology',         cap: 400    },
      { ticker: 'CLSK', name: 'CleanSpark Inc',          sector: 'Technology',         cap: 1000   },
      { ticker: 'BTBT', name: 'Bit Digital',             sector: 'Technology',         cap: 300    },
      { ticker: 'MPW',  name: 'Medical Properties Trust',sector: 'Real Estate',        cap: 4000   },
      { ticker: 'IVR',  name: 'Invesco Mortgage Capital',sector: 'Real Estate',        cap: 500    },
      { ticker: 'NLY',  name: 'Annaly Capital Mgmt',     sector: 'Real Estate',        cap: 10000  },
      { ticker: 'AGNC', name: 'AGNC Investment Corp',    sector: 'Real Estate',        cap: 7000   },
      { ticker: 'TWO',  name: 'Two Harbors Investment',  sector: 'Real Estate',        cap: 1200   },
      { ticker: 'MFA',  name: 'MFA Financial',           sector: 'Real Estate',        cap: 1000   },
      { ticker: 'RC',   name: 'Ready Capital Corp',      sector: 'Real Estate',        cap: 1200   },
      { ticker: 'GPRO', name: 'GoPro Inc',               sector: 'Technology',         cap: 800    },
      { ticker: 'BBBY', name: 'Bed Bath Beyond',         sector: 'Consumer Cyclical',  cap: 100    },
      { ticker: 'GME',  name: 'GameStop Corp',           sector: 'Consumer Cyclical',  cap: 6000   },
      { ticker: 'AMC',  name: 'AMC Entertainment',       sector: 'Communication',      cap: 1500   },
      { ticker: 'KOSS', name: 'Koss Corp',               sector: 'Technology',         cap: 100    },
      { ticker: 'EXPR', name: 'Express Inc',             sector: 'Consumer Cyclical',  cap: 200    },
      { ticker: 'UWMC', name: 'UWM Holdings',            sector: 'Financial Services', cap: 3000   },
      { ticker: 'CURE', name: 'Direxion Daily Health',   sector: 'Healthcare',         cap: 500    },
      { ticker: 'DNA',  name: 'Ginkgo Bioworks',         sector: 'Healthcare',         cap: 1000   },
      { ticker: 'JOBY', name: 'Joby Aviation',           sector: 'Industrials',        cap: 4000   },
      { ticker: 'ARCHER',name:'Archer Aviation',         sector: 'Industrials',        cap: 1500   },
      { ticker: 'ACHR', name: 'Archer Aviation',         sector: 'Industrials',        cap: 1500   },
      { ticker: 'ASTS', name: 'AST SpaceMobile',         sector: 'Communication',      cap: 3000   },
      { ticker: 'SMMT', name: 'Summit Therapeutics',     sector: 'Healthcare',         cap: 8000   },
      { ticker: 'RXRX', name: 'Recursion Pharma',        sector: 'Healthcare',         cap: 2000   },
      { ticker: 'SANA', name: 'Sana Biotechnology',      sector: 'Healthcare',         cap: 500    },
      { ticker: 'BEAM', name: 'Beam Therapeutics',       sector: 'Healthcare',         cap: 1500   },
      { ticker: 'EDIT', name: 'Editas Medicine',         sector: 'Healthcare',         cap: 500    },
      { ticker: 'CRSP', name: 'CRISPR Therapeutics',     sector: 'Healthcare',         cap: 3000   },
      { ticker: 'NTLA', name: 'Intellia Therapeutics',   sector: 'Healthcare',         cap: 2000   },
      { ticker: 'FATE', name: 'Fate Therapeutics',       sector: 'Healthcare',         cap: 500    },
      { ticker: 'ARCT', name: 'Arctus Therapeutics',     sector: 'Healthcare',         cap: 400    },
      { ticker: 'VERV', name: 'Verve Therapeutics',      sector: 'Healthcare',         cap: 600    },
      { ticker: 'PTON', name: 'Peloton Interactive',     sector