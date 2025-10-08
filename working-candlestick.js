class WorkingCandlestickChart {
    constructor() {
        console.log('WorkingCandlestickChart starting...');
        this.chart = null;
        this.currentSymbol = 'BTCUSDT';
        this.currentInterval = '4h';
        this.chartData = [];
        this.isLoading = false;
        this.isLoadingMore = false;
        this.hasMoreData = true;
        
        // Add drag panning variables
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.panOffset = 0;
        this.visibleStartIndex = 0;
        this.visibleCount = 100;
        this.showUpgradeMessage = false;
    this.horizontalOverscroll = { left: 0, right: 0 };
    this.maxHorizontalOverscroll = 80; // Maximum extra candles worth of empty space when panning past edges
    this.baseRightPadCandles = 4; // Always keep a little empty room on the right for the live candle
    this.baseLeftPadCandles = 1;
        
        // TradingView-style zoom and scale variables
        this.minVisibleCount = 10;  // Minimum candles to show when zoomed in
        this.maxVisibleCount = 500; // Maximum candles to show when zoomed out
        this.zoomSensitivity = 0.1; // How much to zoom per wheel tick
        this.priceScale = 1;        // Y-axis scale factor
        this.isSpacePanning = false; // Space key held for panning mode
        this.isScalingY = false;    // Dragging on Y-axis
        this.isScalingX = false;    // Dragging on X-axis
        this.scaleStartY = 0;
        this.scaleStartX = 0;
        this.priceRangePadding = 0.1; // 10% padding
        this.customPriceRange = null; // Custom Y-axis range
        
        // Trade bubble settings
        this.tradeThreshold = 0.01; // Lower default for better 1m visibility
        this.showTrades = true;
        this.maxBubblesPerCandle = 15; // Limit to prevent clutter
        this.tradesData = {}; // Store trades by candle timestamp
        this.currentCandleTrades = []; // Live trades for current candle
        this.aggregateTradesUrl = 'https://api.binance.com/api/v3/aggTrades';
        this.btcPrice = 50000; // Default, will be updated with real BTC price
        
        // Footprint chart settings
    this.footprintMode = false; // Toggle for footprint view
    this.footprintLayers = 80; // Max price levels to render per candle (adjustable via slider)
    this.footprintMinCandleWidth = 60; // Min candle width to enable footprint
    this.footprintValueAreaPercent = 0.7; // 70% value area by default
    this.showVolumeDelta = true; // Show volume delta on top
    this.footprintData = {}; // Store footprint data by candle timestamp
    this.volumeDeltaData = {}; // Store footprint stats (delta, totals, etc.) by candle
        
        // API endpoints
        this.binanceUrl = 'https://api.binance.com/api/v3/klines';
        this.wsUrl = 'wss://stream.binance.com:9443/ws/';
        this.websocket = null;
        this.corsProxies = [
            'https://api.allorigins.win/get?url=',
            'https://cors-anywhere.herokuapp.com/',
            'https://api.codetabs.com/v1/proxy?quest='
        ];
        
        setTimeout(() => {
            this.initializeChart();
            this.setupEventListeners();
            this.loadRealData();
        }, 100);
    }

    async fetchBinanceData(symbol, interval, limit = 100) {
        console.log(`Attempting to fetch real data for ${symbol} ${interval}...`);
        
        const apiUrl = `${this.binanceUrl}?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        
        // Strategy 1: Try direct API call
        try {
            console.log('Trying direct API call...');
            const response = await fetch(apiUrl);
            if (response.ok) {
                const data = await response.json();
                console.log('✅ Direct API success!', data.length, 'candles');
                return this.formatBinanceData(data);
            }
            throw new Error(`Direct API failed: ${response.status}`);
        } catch (directError) {
            console.log('❌ Direct API failed:', directError.message);
        }

        // Strategy 2: Try CORS proxies
        for (let i = 0; i < this.corsProxies.length; i++) {
            try {
                console.log(`Trying CORS proxy ${i + 1}/${this.corsProxies.length}...`);
                
                let proxyUrl;
                let response;
                
                if (this.corsProxies[i].includes('allorigins')) {
                    proxyUrl = `${this.corsProxies[i]}${encodeURIComponent(apiUrl)}`;
                    response = await fetch(proxyUrl);
                    const proxyData = await response.json();
                    if (proxyData.contents) {
                        const data = JSON.parse(proxyData.contents);
                        console.log('✅ AllOrigins proxy success!', data.length, 'candles');
                        return this.formatBinanceData(data);
                    }
                } else {
                    proxyUrl = `${this.corsProxies[i]}${apiUrl}`;
                    response = await fetch(proxyUrl);
                    if (response.ok) {
                        const data = await response.json();
                        console.log(`✅ Proxy ${i + 1} success!`, data.length, 'candles');
                        return this.formatBinanceData(data);
                    }
                }
                
                throw new Error(`Proxy ${i + 1} failed`);
            } catch (proxyError) {
                console.log(`❌ Proxy ${i + 1} failed:`, proxyError.message);
                continue;
            }
        }

        // Strategy 3: Use alternative API (CoinGecko as fallback)
        try {
            console.log('Trying alternative API (CoinGecko)...');
            const coinGeckoSymbol = symbol.replace('USDT', '').toLowerCase();
            const response = await fetch(`https://api.coingecko.com/api/v3/coins/${coinGeckoSymbol === 'btc' ? 'bitcoin' : coinGeckoSymbol}/ohlc?vs_currency=usd&days=7`);
            
            if (response.ok) {
                const data = await response.json();
                console.log('✅ CoinGecko fallback success!', data.length, 'data points');
                return this.formatCoinGeckoData(data);
            }
        } catch (altError) {
            console.log('❌ Alternative API failed:', altError.message);
        }

        // Strategy 4: Demo data as last resort
        console.log('🔄 All APIs failed, using realistic demo data...');
        return this.generateRealisticDemoData(symbol);
    }

    formatBinanceData(rawData) {
        return rawData.map(kline => {
            const [openTime, open, high, low, close, volume] = kline;
            return {
                x: parseInt(openTime),
                o: parseFloat(open),
                h: parseFloat(high),
                l: parseFloat(low),
                c: parseFloat(close),
                v: parseFloat(volume)
            };
        });
    }

    async fetchCurrentBTCPrice() {
        try {
            const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
            if (response.ok) {
                const data = await response.json();
                this.btcPrice = parseFloat(data.price);
                console.log(`💰 BTC Price updated: $${this.btcPrice.toFixed(2)}`);
                return this.btcPrice;
            }
        } catch (error) {
            console.warn('⚠️ Could not fetch BTC price, using cached value:', this.btcPrice);
        }
        return this.btcPrice;
    }

    async fetchAggregateTradesForCandle(symbol, startTime, endTime) {
        try {
            console.log(`🔍 Fetching trades from API for ${symbol}...`);

            const aggregatedTrades = [];
            let pageStartTime = startTime;
            let lastAggregateId = null;
            let safetyCounter = 0;
            const MAX_PAGES = 12; // Prevent infinite loops while still allowing deep candles

            while (pageStartTime < endTime && safetyCounter < MAX_PAGES) {
                const url = new URL(this.aggregateTradesUrl);
                url.searchParams.append('symbol', symbol);
                url.searchParams.append('startTime', pageStartTime);
                url.searchParams.append('endTime', endTime);
                url.searchParams.append('limit', '1000');

                if (lastAggregateId !== null) {
                    // Continue from the next aggregate id to avoid duplicates
                    url.searchParams.append('fromId', (lastAggregateId + 1).toString());
                }

                const response = await fetch(url.toString());

                if (!response.ok) {
                    console.warn(`⚠️ API returned ${response.status} on page ${safetyCounter + 1}: Using mock data instead`);
                    return this.generateMockTrades(startTime, endTime);
                }

                const pageTrades = await response.json();

                if (!Array.isArray(pageTrades) || pageTrades.length === 0) {
                    break;
                }

                pageTrades.forEach(trade => {
                    aggregatedTrades.push({
                        price: parseFloat(trade.p),
                        quantity: parseFloat(trade.q),
                        rawPrice: trade.p,
                        rawQuantity: trade.q,
                        time: trade.T,
                        isBuyerMaker: trade.m,
                        isBuy: !trade.m,
                        aggregateId: trade.a,
                        firstTradeId: trade.f,
                        lastTradeId: trade.l
                    });
                });

                const lastTrade = pageTrades[pageTrades.length - 1];
                lastAggregateId = lastTrade.a;

                // If we received fewer than the limit or reached the candle end, exit loop
                if (pageTrades.length < 1000 || lastTrade.T >= endTime) {
                    break;
                }

                // Advance start time just beyond the last trade timestamp to avoid duplicates
                pageStartTime = lastTrade.T + 1;
                safetyCounter += 1;

                // Gentle throttle to respect Binance rate-limits when paginating
                await new Promise(resolve => setTimeout(resolve, 60));
            }

            if (aggregatedTrades.length === 0) {
                console.warn('⚠️ API returned empty or invalid data across all pages: Using mock data');
                return this.generateMockTrades(startTime, endTime);
            }

            aggregatedTrades.sort((a, b) => a.time - b.time);

            console.log(`✅ Fetched ${aggregatedTrades.length} aggregated trades from API (${safetyCounter + 1} request${safetyCounter === 0 ? '' : 's'})`);

            return aggregatedTrades;
        } catch (error) {
            console.error(`❌ API Error (${error.message}): Using mock data`);
            return this.generateMockTrades(startTime, endTime);
        }
    }

    generateMockTrades(startTime, endTime) {
        // Generate realistic mock trades for demonstration
    const trades = [];
    const duration = endTime - startTime;
    const numTrades = Math.floor(Math.random() * 80) + 60; // 60-140 trades per candle for richer footprint
        
        // Get base price from current candle if available
        const currentCandle = this.chartData.find(c => c.x === startTime);
        
        // If no candle data, don't generate mock trades
        if (!currentCandle) {
            console.log('No candle data available for mock trades');
            return [];
        }
        
        const high = currentCandle.h;
        const low = currentCandle.l;
        const midPrice = (high + low) / 2;
        
        // Determine if candle is bullish or bearish to bias the trades
        const isBullish = currentCandle.c > currentCandle.o;
        const buyBias = isBullish ? 0.7 : 0.3; // 70% buy for bullish, 30% for bearish
        
        for (let i = 0; i < numTrades; i++) {
            const time = startTime + Math.random() * duration;
            
            // IMPORTANT: Keep price WITHIN the candle's high/low range
            const priceWithinRange = low + Math.random() * (high - low);
            
            // Vary quantity based on asset type
            let quantity;
            if (midPrice > 1000) {
                // High-price assets like BTC: 0.01 to 1 units
                quantity = Math.random() * 1 + 0.01;
            } else if (midPrice > 100) {
                // Medium-price assets like ETH, SOL: 0.1 to 5 units  
                quantity = Math.random() * 5 + 0.1;
            } else if (midPrice > 1) {
                // Low-price assets like DOT, SUI: 1 to 20 units
                quantity = Math.random() * 20 + 1;
            } else {
                // Very low-price assets like DOGE: 10 to 500 units
                quantity = Math.random() * 500 + 10;
            }
            
            // Use bias to determine buy vs sell
            const isBuy = Math.random() < buyBias;
            
            trades.push({
                price: priceWithinRange,
                quantity: quantity,
                rawPrice: priceWithinRange.toFixed(8),
                rawQuantity: quantity.toFixed(8),
                time: time,
                isBuy: isBuy,
                isBuyerMaker: !isBuy,
                aggregateId: i,
                firstTradeId: i * 2,
                lastTradeId: i * 2 + 1
            });
        }
        
        return trades.sort((a, b) => a.time - b.time);
    }

    async fetchTradesForVisibleCandles() {
        // Fetch trades for short timeframes: 1m, 5m, 15m, 1h
        if (!['1m', '5m', '15m', '1h'].includes(this.currentInterval)) {
            return;
        }

        console.log('Fetching trades for visible candles...');
        const intervalMs = this.getIntervalMs(this.currentInterval);
        
        // Fetch trades for each visible candle
        for (let candle of this.chartData) {
            const startTime = candle.x;
            const endTime = startTime + intervalMs;
            
            if (!this.tradesData[startTime]) {
                this.tradesData[startTime] = await this.fetchAggregateTradesForCandle(
                    this.currentSymbol,
                    startTime,
                    endTime
                );
                
                // Build footprint data if in footprint mode
                if (this.footprintMode) {
                    this.buildFootprintData(startTime);
                }
            }
        }
        
        // Update chart to show trade bubbles or footprint
        if (this.chart) {
            this.chart.update('none');
        }
    }

    async fetchTradeDataForCandle(candleTime) {
        // Fetch trades for a single candle (used for live updates)
        if (!['1m', '5m', '15m', '1h'].includes(this.currentInterval)) {
            return;
        }

        const intervalMs = this.getIntervalMs(this.currentInterval);
        const startTime = candleTime;
        const endTime = startTime + intervalMs;
        
        if (!this.tradesData[startTime]) {
            console.log(`Fetching trades for closed candle at ${new Date(startTime).toLocaleString()}`);
            this.tradesData[startTime] = await this.fetchAggregateTradesForCandle(
                this.currentSymbol,
                startTime,
                endTime
            );
            
            // Build footprint data from trades
            if (this.footprintMode) {
                this.buildFootprintData(startTime);
            }
            
            // Update chart to show new trade bubbles
            if (this.chart) {
                this.chart.update('none');
            }
        }
    }
    
    buildFootprintData(candleTime) {
        const trades = this.tradesData[candleTime];
        if (!trades || trades.length === 0) {
            delete this.footprintData[candleTime];
            delete this.volumeDeltaData[candleTime];
            return;
        }

        const candle = this.chartData.find(c => c.x === candleTime);
        if (!candle) return;

        // Determine precision from raw trade data or fall back to candle decimals
        let pricePrecision = 0;
        trades.forEach(trade => {
            const raw = trade.rawPrice ?? trade.price;
            pricePrecision = Math.max(pricePrecision, this.countDecimals(raw));
        });

        if (pricePrecision === 0) {
            const referencePrice = Math.max(candle.o, candle.c, candle.h, candle.l);
            if (referencePrice >= 1000) pricePrecision = 2;
            else if (referencePrice >= 100) pricePrecision = 3;
            else if (referencePrice >= 1) pricePrecision = 4;
            else pricePrecision = 6;
        }

        pricePrecision = Math.min(pricePrecision, 8);

        // Aggregate trades by exact price level (tick precision)
        const priceLevelMap = new Map();

        trades.forEach(trade => {
            const precisePrice = typeof trade.rawPrice === 'string' ? parseFloat(trade.rawPrice) : trade.price;
            const priceKey = parseFloat(precisePrice.toFixed(pricePrecision));
            if (!priceLevelMap.has(priceKey)) {
                priceLevelMap.set(priceKey, {
                    price: priceKey,
                    priceHigh: precisePrice,
                    priceLow: precisePrice,
                    buyVolume: 0,
                    sellVolume: 0,
                    tradeCount: 0
                });
            }

            const bucket = priceLevelMap.get(priceKey);
            bucket.tradeCount += 1;
            bucket.priceHigh = Math.max(bucket.priceHigh, precisePrice);
            bucket.priceLow = Math.min(bucket.priceLow, precisePrice);
            if (trade.isBuy) {
                bucket.buyVolume += trade.quantity;
            } else {
                bucket.sellVolume += trade.quantity;
            }
        });

        let levels = Array.from(priceLevelMap.values())
            .map(level => ({
                ...level,
                totalVolume: level.buyVolume + level.sellVolume,
                delta: level.buyVolume - level.sellVolume
            }))
            .sort((a, b) => b.price - a.price); // Highest prices first

        if (levels.length === 0) {
            delete this.footprintData[candleTime];
            delete this.volumeDeltaData[candleTime];
            return;
        }

        // Condense levels if they exceed the configured maximum by merging contiguous ranges
        const maxLevels = Math.max(10, this.footprintLayers || 80);
        if (levels.length > maxLevels) {
            const groupSize = Math.ceil(levels.length / maxLevels);
            const condensed = [];

            for (let i = 0; i < levels.length; i += groupSize) {
                const slice = levels.slice(i, i + groupSize);
                const aggregate = {
                    price: 0,
                    priceHigh: slice[0].priceHigh,
                    priceLow: slice[slice.length - 1].priceLow,
                    buyVolume: 0,
                    sellVolume: 0,
                    totalVolume: 0,
                    delta: 0,
                    tradeCount: 0,
                    merged: slice.length > 1
                };

                let weightedPriceSum = 0;
                slice.forEach(level => {
                    aggregate.buyVolume += level.buyVolume;
                    aggregate.sellVolume += level.sellVolume;
                    aggregate.totalVolume += level.totalVolume;
                    aggregate.delta += level.delta;
                    aggregate.tradeCount += level.tradeCount;
                    weightedPriceSum += level.price * level.totalVolume;
                });

                aggregate.price = aggregate.totalVolume > 0
                    ? parseFloat((weightedPriceSum / aggregate.totalVolume).toFixed(pricePrecision))
                    : parseFloat(((slice[0].price + slice[slice.length - 1].price) / 2).toFixed(pricePrecision));

                condensed.push(aggregate);
            }

            levels = condensed;
        }

        let totalBuyVolume = 0;
        let totalSellVolume = 0;
        let totalTrades = 0;
        let pocIndex = 0;
        let pocVolume = -Infinity;

        levels = levels.map((level, index) => {
            const totalVolume = level.totalVolume;
            const buyVolume = level.buyVolume;
            const sellVolume = level.sellVolume;
            const tradeCount = level.tradeCount;
            const delta = buyVolume - sellVolume;
            const buyRatio = totalVolume > 0 ? buyVolume / totalVolume : 0;

            totalBuyVolume += buyVolume;
            totalSellVolume += sellVolume;
            totalTrades += tradeCount;

            if (totalVolume > pocVolume) {
                pocVolume = totalVolume;
                pocIndex = index;
            }

            return {
                ...level,
                totalVolume,
                delta,
                buyRatio,
                sellRatio: totalVolume > 0 ? sellVolume / totalVolume : 0,
                tradeCount
            };
        });

        const totalVolume = totalBuyVolume + totalSellVolume;

        if (totalVolume === 0) {
            delete this.footprintData[candleTime];
            delete this.volumeDeltaData[candleTime];
            return;
        }

        // Determine value area via symmetric expansion from POC until 70% volume is included
        const targetVolume = totalVolume * this.footprintValueAreaPercent;
        let cumulativeVolume = levels[pocIndex]?.totalVolume || 0;
        let upperIndex = pocIndex - 1; // Higher prices
        let lowerIndex = pocIndex + 1; // Lower prices
        let vahIndex = pocIndex;
        let valIndex = pocIndex;

        while (cumulativeVolume < targetVolume && (upperIndex >= 0 || lowerIndex < levels.length)) {
            const upperVolume = upperIndex >= 0 ? levels[upperIndex].totalVolume : -1;
            const lowerVolume = lowerIndex < levels.length ? levels[lowerIndex].totalVolume : -1;

            if (upperVolume >= lowerVolume) {
                if (upperVolume > -1) {
                    cumulativeVolume += upperVolume;
                    vahIndex = upperIndex;
                    upperIndex -= 1;
                } else if (lowerVolume > -1) {
                    cumulativeVolume += lowerVolume;
                    valIndex = lowerIndex;
                    lowerIndex += 1;
                } else {
                    break;
                }
            } else {
                if (lowerVolume > -1) {
                    cumulativeVolume += lowerVolume;
                    valIndex = lowerIndex;
                    lowerIndex += 1;
                } else if (upperVolume > -1) {
                    cumulativeVolume += upperVolume;
                    vahIndex = upperIndex;
                    upperIndex -= 1;
                } else {
                    break;
                }
            }
        }

        const minVAIndex = Math.min(vahIndex, valIndex);
        const maxVAIndex = Math.max(vahIndex, valIndex);

        levels = levels.map((level, index) => {
            let priceLabel;
            if (level.merged && level.priceHigh !== level.priceLow) {
                const centerPrice = (level.priceHigh + level.priceLow) / 2;
                priceLabel = centerPrice.toFixed(pricePrecision);
            } else {
                priceLabel = level.price.toFixed(pricePrecision);
            }

            return {
                ...level,
                isPOC: index === pocIndex,
                inValueArea: index >= minVAIndex && index <= maxVAIndex,
                isVAHigh: index === minVAIndex,
                isVALow: index === maxVAIndex,
                priceLabel
            };
        });

        const stats = {
            buyVolume: totalBuyVolume,
            sellVolume: totalSellVolume,
            totalVolume,
            delta: totalBuyVolume - totalSellVolume,
            tradeCount: totalTrades,
            pocPrice: levels[pocIndex]?.price ?? null,
            pocVolume,
            vahPrice: levels[minVAIndex]?.priceHigh ?? levels[minVAIndex]?.price ?? null,
            valPrice: levels[maxVAIndex]?.priceLow ?? levels[maxVAIndex]?.price ?? null,
            pricePrecision,
            levelCount: levels.length
        };

        this.footprintData[candleTime] = {
            levels,
            stats
        };

        this.volumeDeltaData[candleTime] = stats;

        console.log(`📊 Built footprint for candle: ${levels.length} price levels, Δ${stats.delta.toFixed(4)} (${totalTrades} trades)`);
    }

    countDecimals(value) {
        if (value === null || value === undefined) return 0;

        const stringValue = value.toString();

        if (stringValue.includes('e-')) {
            const [, exponent] = stringValue.split('e-');
            return parseInt(exponent, 10);
        }

        const parts = stringValue.split('.');
        if (parts.length === 1) return 0;

        return parts[1].replace(/0+$/, '').length;
    }

    formatCoinGeckoData(rawData) {
        return rawData.slice(-100).map((ohlc, index) => {
            const [timestamp, open, high, low, close] = ohlc;
            return {
                x: timestamp,
                o: open,
                h: high,
                l: low,
                c: close,
                v: Math.random() * 1000 // CoinGecko doesn't provide volume in OHLC
            };
        });
    }

    generateRealisticDemoData(symbol) {
        console.log(`Generating realistic demo data for ${symbol}...`);
        const data = [];
        const now = new Date();
        
        // Set realistic starting prices based on symbol
        const basePrices = {
            'BTCUSDT': 43000,
            'ETHUSDT': 2300,
            'SUIUSDT': 3.45,
            'ADAUSDT': 0.35,
            'DOGEUSDT': 0.08,
            'SOLUSDT': 140,
            'DOTUSDT': 4.2
        };
        
        let price = basePrices[symbol] || 45000;
        
        for (let i = 99; i >= 0; i--) {
            const time = new Date(now.getTime() - i * this.getIntervalMs(this.currentInterval));
            const open = price;
            
            // More realistic price movements
            const trend = Math.sin(i / 10) * 0.02; // Slight trend
            const volatility = (Math.random() - 0.5) * 0.03; // ±1.5% volatility
            const change = open * (trend + volatility);
            const close = open + change;
            
            const spread = Math.abs(change) * (1 + Math.random());
            const high = Math.max(open, close) + spread * Math.random();
            const low = Math.min(open, close) - spread * Math.random();
            
            data.push({
                x: time.getTime(),
                o: parseFloat(open.toFixed(symbol.includes('USDT') && open < 1 ? 6 : 2)),
                h: parseFloat(high.toFixed(symbol.includes('USDT') && high < 1 ? 6 : 2)),
                l: parseFloat(low.toFixed(symbol.includes('USDT') && low < 1 ? 6 : 2)),
                c: parseFloat(close.toFixed(symbol.includes('USDT') && close < 1 ? 6 : 2)),
                v: Math.random() * 10000
            });
            
            price = close;
        }
        
        console.log('Generated realistic demo data:', data.length, 'candles');
        return data;
    }

    getIntervalMs(interval) {
        const intervals = {
            '1m': 60 * 1000,
            '5m': 5 * 60 * 1000,
            '15m': 15 * 60 * 1000,
            '1h': 60 * 60 * 1000,
            '4h': 4 * 60 * 60 * 1000,
            '1d': 24 * 60 * 60 * 1000,
            '1w': 7 * 24 * 60 * 60 * 1000
        };
        return intervals[interval] || intervals['4h'];
    }

    async loadMoreHistoricalData() {
        if (this.isLoadingMore || !this.hasMoreData || this.chartData.length === 0) {
            return;
        }

        console.log('📈 Loading more historical data...');
        this.isLoadingMore = true;
        this.setLoadingState(true, 'Loading more historical data...');

        try {
            // Get the timestamp of the oldest candle
            const oldestTime = this.chartData[0].x;
            const endTime = oldestTime - 1; // End before the oldest candle
            
            // Fetch 50 more candles when user needs them
            const olderData = await this.fetchBinanceDataWithTime(
                this.currentSymbol, 
                this.currentInterval, 
                50, 
                null, 
                endTime
            );

            if (olderData && olderData.length > 0) {
                console.log(`✅ Loaded ${olderData.length} more historical candles`);
                
                // Prepend the older data to the beginning
                this.chartData = [...olderData, ...this.chartData];
                
                // Update the chart
                this.updateChart();
                
                // Check if we got less data than requested (might be at the beginning)
                if (olderData.length < 50) {
                    this.hasMoreData = false;
                    console.log('📊 Reached the beginning of available data - upgrade message will show at limit');
                }
            } else {
                this.hasMoreData = false;
                console.log('📊 No more historical data available - upgrade message will show');
            }

        } catch (error) {
            console.error('❌ Error loading more historical data:', error);
        } finally {
            this.isLoadingMore = false;
            this.setLoadingState(false);
        }
    }

    async fetchBinanceDataWithTime(symbol, interval, limit = 100, startTime = null, endTime = null) {
        console.log(`Fetching data for ${symbol} ${interval} with time constraints...`);
        
        let apiUrl = `${this.binanceUrl}?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        
        if (startTime) {
            apiUrl += `&startTime=${startTime}`;
        }
        if (endTime) {
            apiUrl += `&endTime=${endTime}`;
        }

        // Try the same strategies as before but with time parameters
        try {
            const response = await fetch(apiUrl);
            if (response.ok) {
                const data = await response.json();
                return this.formatBinanceData(data);
            }
        } catch (error) {
            console.log('Direct API failed, trying proxies...');
        }

        // Try CORS proxies
        for (const proxy of this.corsProxies) {
            try {
                let proxyUrl;
                if (proxy.includes('allorigins')) {
                    proxyUrl = `${proxy}${encodeURIComponent(apiUrl)}`;
                    const response = await fetch(proxyUrl);
                    const proxyData = await response.json();
                    if (proxyData.contents) {
                        const data = JSON.parse(proxyData.contents);
                        return this.formatBinanceData(data);
                    }
                } else {
                    proxyUrl = `${proxy}${apiUrl}`;
                    const response = await fetch(proxyUrl);
                    if (response.ok) {
                        const data = await response.json();
                        return this.formatBinanceData(data);
                    }
                }
            } catch (error) {
                continue;
            }
        }

        throw new Error('All API methods failed for historical data');
    }

    async loadBackBuffer() {
        if (!this.hasMoreData || this.chartData.length === 0) return;
        
        console.log('� Loading 30 candles behind current view for drag-back...');
        
        try {
            const oldestTime = this.chartData[0].x;
            const endTime = oldestTime - 1;
            
            // Load exactly 30 candles behind for drag-back functionality
            const bufferData = await this.fetchBinanceDataWithTime(
                this.currentSymbol, 
                this.currentInterval, 
                30, 
                null, 
                endTime
            );

            if (bufferData && bufferData.length > 0) {
                console.log(`✅ Added ${bufferData.length} candles behind for drag-back`);
                this.chartData = [...bufferData, ...this.chartData];
                
                // Adjust visible start index to show the same view (now with buffer behind)
                this.setVisibleStartIndex(bufferData.length);
                
                // If we got less than 30, we're near the limit
                if (bufferData.length < 30) {
                    this.hasMoreData = false;
                    console.log('📊 Close to historical data limit');
                }
            } else {
                this.hasMoreData = false;
            }
        } catch (error) {
            console.log('⚠️ Buffer load failed:', error.message);
            this.hasMoreData = false;
        }
    }

    initializeChart() {
        console.log('Initializing working candlestick chart...');
        
        const ctx = document.getElementById('candlestickChart').getContext('2d');
        
        // Create the chart with a simple approach - use scatter plot with custom drawing
        this.chart = new Chart(ctx, {
            type: 'scatter',
            data: {
                datasets: [{
                    label: `${this.currentSymbol} ${this.currentInterval}`,
                    data: [],
                    showLine: false,
                    pointRadius: 0, // Hide the default points
                    pointHoverRadius: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: {
                            color: '#ffffff'
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        titleColor: '#ffffff',
                        bodyColor: '#ffffff',
                        borderColor: '#555555',
                        borderWidth: 1,
                        filter: function(tooltipItem) {
                            return tooltipItem.dataIndex < this.chartData.length;
                        }.bind(this),
                        callbacks: {
                            title: function(context) {
                                const index = context[0].dataIndex;
                                if (this.chartData[index]) {
                                    return new Date(this.chartData[index].x).toLocaleString();
                                }
                                return '';
                            }.bind(this),
                            label: function(context) {
                                const index = context.dataIndex;
                                const dataToRender = this.visibleChartData || this.chartData;
                                const candle = dataToRender[index];
                                if (candle) {
                                    const formatVolume = (vol) => {
                                        if (vol >= 1000000) return `${(vol/1000000).toFixed(2)}M`;
                                        if (vol >= 1000) return `${(vol/1000).toFixed(2)}K`;
                                        return vol.toFixed(2);
                                    };
                                    
                                    const labels = [
                                        `Open: $${candle.o.toFixed(2)}`,
                                        `High: $${candle.h.toFixed(2)}`,
                                        `Low: $${candle.l.toFixed(2)}`,
                                        `Close: $${candle.c.toFixed(2)}`,
                                        `Volume: ${formatVolume(candle.v)}`
                                    ];
                                    
                                    // Add trade info if available
                                    if (this.showTrades && ['1m', '5m', '15m', '1h'].includes(this.currentInterval)) {
                                        const trades = this.tradesData[candle.x];
                                        if (trades && trades.length > 0) {
                                            // Calculate threshold in USD using current BTC price
                                            const thresholdUSD = this.tradeThreshold * this.btcPrice;
                                            
                                            // Filter by USD threshold
                                            const significantTrades = trades.filter(t => (t.quantity * t.price) >= thresholdUSD);
                                            if (significantTrades.length > 0) {
                                                const totalQty = significantTrades.reduce((sum, t) => sum + t.quantity, 0);
                                                const buyQty = significantTrades.filter(t => t.isBuy).reduce((sum, t) => sum + t.quantity, 0);
                                                const sellQty = totalQty - buyQty;
                                                
                                                labels.push(''); // Empty line
                                                labels.push(`Trades: ${significantTrades.length}`);
                                                labels.push(`Buy Vol: ${formatVolume(buyQty)}`);
                                                labels.push(`Sell Vol: ${formatVolume(sellQty)}`);
                                                labels.push(`Total Trade Vol: ${formatVolume(totalQty)}`);
                                            }
                                        }
                                    }
                                    
                                    return labels;
                                }
                                return '';
                            }.bind(this)
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'linear',
                        position: 'bottom',
                        grid: {
                            color: '#404040'
                        },
                        ticks: {
                            color: '#ffffff',
                            callback: function(value) {
                                return new Date(value).toLocaleDateString();
                            }
                        }
                    },
                    y: {
                        grid: {
                            color: '#404040'
                        },
                        ticks: {
                            color: '#ffffff',
                            callback: function(value) {
                                return '$' + value.toFixed(0);
                            }
                        }
                    }
                },
                onHover: (event, activeElements) => {
                    const rect = event.native.target.getBoundingClientRect();
                    const hoverX = event.native.clientX - rect.left;
                    
                    // Check if hovering over upgrade message area
                    if (this.showUpgradeMessage && hoverX < rect.width * 0.3) {
                        event.native.target.style.cursor = 'pointer';
                    } else if (activeElements.length > 0) {
                        event.native.target.style.cursor = 'crosshair';
                    } else {
                        event.native.target.style.cursor = this.isDragging ? 'grabbing' : 'default';
                    }
                }
            },
            plugins: [{
                id: 'candlestickDrawer',
                afterDatasetsDraw: (chart) => {
                    this.drawCandlesticks(chart);
                }
            }]
        });

        // Add mouse drag functionality
        this.addDragFunctionality();
        
        // Start animation loop for current candle pulse effect
        this.startAnimationLoop();
        
        console.log('Chart initialized successfully');
    }
    
    startAnimationLoop() {
        // Continuous animation for live trade bubbles on current candle
        const animate = () => {
            if (this.chart && this.showTrades && this.chartData.length > 0) {
                const lastCandle = this.chartData[this.chartData.length - 1];
                
                // Only animate if we're showing the latest data and candle is live
                const isShowingLatest = this.visibleStartIndex + this.visibleCount >= this.chartData.length;
                
                if (isShowingLatest && lastCandle.isLive && this.currentCandleTrades.length > 0) {
                    this.chart.update('none'); // Redraw for pulse animation
                }
            }
            
            this.animationFrame = requestAnimationFrame(animate);
        };
        
        animate();
    }

    addDragFunctionality() {
        const canvas = document.getElementById('candlestickChart');
        
        // Track if we're in a pinch gesture
        let isPinching = false;
        let lastPinchDistance = 0;
        
        // ===== WHEEL EVENT (Mouse Wheel + Trackpad Support) =====
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseXRatio = mouseX / rect.width; // Position of mouse on chart (0-1)
            
            // Detect trackpad pinch-to-zoom (ctrlKey is set on trackpad pinch)
            if (e.ctrlKey) {
                // TRACKPAD PINCH-TO-ZOOM
                const zoomIn = e.deltaY < 0;
                const zoomFactor = 1 + (zoomIn ? -this.zoomSensitivity * 2 : this.zoomSensitivity * 2);
                
                const newVisibleCount = Math.round(this.visibleCount * zoomFactor);
                const clampedCount = Math.max(this.minVisibleCount, Math.min(this.maxVisibleCount, newVisibleCount));
                
                // Adjust start index to keep the candle under the cursor in place
                const countDiff = clampedCount - this.visibleCount;
                const newStartIndex = Math.round(this.visibleStartIndex - countDiff * mouseXRatio);
                
                this.visibleCount = clampedCount;
                this.setVisibleStartIndex(newStartIndex);
                
                this.updateVisibleChart();
            }
            // Detect horizontal scroll (shift key or deltaX)
            else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
                // HORIZONTAL PAN (Trackpad two-finger horizontal swipe or Shift+Wheel)
                const panAmount = Math.round((e.deltaX || e.deltaY) * 0.05);
                this.panByAmount(panAmount);
            }
            // Regular vertical scroll
            else if (Math.abs(e.deltaY) > 0) {
                // Check if deltaY is very small (trackpad-like) or large (mouse wheel)
                const isTrackpad = Math.abs(e.deltaY) < 50;
                
                if (isTrackpad) {
                    // TRACKPAD TWO-FINGER VERTICAL SCROLL = Horizontal Pan
                    const panAmount = Math.round(e.deltaY * 0.1);
                    this.panByAmount(panAmount);
                } else {
                    // MOUSE WHEEL = Zoom
                    const zoomIn = e.deltaY < 0;
                    const zoomFactor = 1 + (zoomIn ? -this.zoomSensitivity : this.zoomSensitivity);
                    
                    const newVisibleCount = Math.round(this.visibleCount * zoomFactor);
                    const clampedCount = Math.max(this.minVisibleCount, Math.min(this.maxVisibleCount, newVisibleCount));
                    
                    const countDiff = clampedCount - this.visibleCount;
                    const newStartIndex = Math.round(this.visibleStartIndex - countDiff * mouseXRatio);
                    
                    this.visibleCount = clampedCount;
                    this.setVisibleStartIndex(newStartIndex);
                    
                    this.updateVisibleChart();
                }
            }
        }, { passive: false });
        
        // ===== KEYBOARD SHORTCUTS (TradingView style) =====
        document.addEventListener('keydown', (e) => {
            // Space key for pan mode
            if (e.code === 'Space' && !this.isSpacePanning) {
                this.isSpacePanning = true;
                canvas.style.cursor = 'grab';
                e.preventDefault();
            }
            
            // + or = key for zoom in
            if ((e.code === 'Equal' || e.code === 'NumpadAdd') && !e.shiftKey) {
                this.zoomAtCenter(true);
                e.preventDefault();
            }
            
            // - or _ key for zoom out
            if ((e.code === 'Minus' || e.code === 'NumpadSubtract') && !e.shiftKey) {
                this.zoomAtCenter(false);
                e.preventDefault();
            }
            
            // Arrow keys for panning
            if (e.code === 'ArrowLeft') {
                this.panByAmount(-10);
                e.preventDefault();
            }
            if (e.code === 'ArrowRight') {
                this.panByAmount(10);
                e.preventDefault();
            }
            if (e.code === 'ArrowUp') {
                this.adjustPriceScale(0.1);
                e.preventDefault();
            }
            if (e.code === 'ArrowDown') {
                this.adjustPriceScale(-0.1);
                e.preventDefault();
            }
        });
        
        document.addEventListener('keyup', (e) => {
            if (e.code === 'Space') {
                this.isSpacePanning = false;
                if (!this.isDragging) {
                    canvas.style.cursor = 'crosshair';
                }
            }
        });
        
        // ===== DOUBLE-CLICK TO AUTO-FIT =====
        canvas.addEventListener('dblclick', (e) => {
            this.autoFitChart();
            e.preventDefault();
        });
        
        // ===== MOUSE DRAG PANNING =====
        canvas.addEventListener('mousedown', (e) => {
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            // Check if clicking on right Y-axis area (last 60px)
            if (mouseX > rect.width - 60) {
                this.isScalingY = true;
                this.scaleStartY = e.clientY;
                canvas.style.cursor = 'ns-resize';
                e.preventDefault();
                return;
            }
            
            // Check if clicking on bottom X-axis area (last 30px)
            if (mouseY > rect.height - 30) {
                this.isScalingX = true;
                this.scaleStartX = e.clientX;
                canvas.style.cursor = 'ew-resize';
                e.preventDefault();
                return;
            }
            
            // Normal panning (with or without space key)
            if (this.isSpacePanning || e.button === 0) {
                this.isDragging = true;
                this.dragStartX = e.clientX;
                this.dragStartY = e.clientY;
                canvas.style.cursor = 'grabbing';
                e.preventDefault();
            }
        });

        canvas.addEventListener('mousemove', (e) => {
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            // Handle Y-axis scaling
            if (this.isScalingY) {
                const deltaY = this.scaleStartY - e.clientY;
                this.adjustPriceScale(deltaY * 0.002);
                this.scaleStartY = e.clientY;
                return;
            }
            
            // Handle X-axis scaling (zoom)
            if (this.isScalingX) {
                const deltaX = e.clientX - this.scaleStartX;
                const zoomFactor = 1 - (deltaX * 0.002);
                const newVisibleCount = Math.round(this.visibleCount * zoomFactor);
                this.visibleCount = Math.max(this.minVisibleCount, Math.min(this.maxVisibleCount, newVisibleCount));
                this.setVisibleStartIndex(this.visibleStartIndex, { preserveOverscroll: false });
                this.scaleStartX = e.clientX;
                this.updateVisibleChart();
                return;
            }
            
            // Handle normal panning
            if (this.isDragging) {
                const deltaX = e.clientX - this.dragStartX;
                const deltaY = e.clientY - this.dragStartY;
                if (Math.abs(deltaX) >= 1) {
                    this.handleDrag(deltaX);
                }
                if (Math.abs(deltaY) >= 1) {
                    this.handleVerticalPan(deltaY);
                }
                this.dragStartX = e.clientX;
                this.dragStartY = e.clientY;
                return;
            }
            
            // Update cursor based on position
            if (!this.isDragging && !this.isScalingY && !this.isScalingX) {
                if (mouseX > rect.width - 60) {
                    canvas.style.cursor = 'ns-resize';
                } else if (mouseY > rect.height - 30) {
                    canvas.style.cursor = 'ew-resize';
                } else if (this.isSpacePanning) {
                    canvas.style.cursor = 'grab';
                } else {
                    canvas.style.cursor = 'crosshair';
                }
            }
        });

        canvas.addEventListener('mouseup', () => {
            this.isDragging = false;
            this.isScalingY = false;
            this.isScalingX = false;
            canvas.style.cursor = this.isSpacePanning ? 'grab' : 'crosshair';
        });

        canvas.addEventListener('mouseleave', () => {
            this.isDragging = false;
            this.isScalingY = false;
            this.isScalingX = false;
            canvas.style.cursor = 'crosshair';
        });

        // ===== TOUCH EVENTS FOR MOBILE & TABLETS =====
        let touchStartDistance = 0;
        let touchCenterX = 0;
        let lastTouchCount = 0;
        
        canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                // Single finger = pan
                this.isDragging = true;
                this.dragStartX = e.touches[0].clientX;
                this.dragStartY = e.touches[0].clientY;
                e.preventDefault();
            } else if (e.touches.length === 2) {
                // Two fingers = pinch to zoom
                this.isDragging = false; // Stop panning
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                touchStartDistance = Math.sqrt(dx * dx + dy * dy);
                
                // Calculate center point of pinch
                const rect = canvas.getBoundingClientRect();
                touchCenterX = ((e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left) / rect.width;
                
                lastTouchCount = 2;
                e.preventDefault();
            }
        });

        canvas.addEventListener('touchmove', (e) => {
            if (this.isDragging && e.touches.length === 1) {
                // Single finger pan
                const deltaX = e.touches[0].clientX - this.dragStartX;
                const deltaY = e.touches[0].clientY - this.dragStartY;
                if (Math.abs(deltaX) >= 1) {
                    this.handleDrag(deltaX);
                }
                if (Math.abs(deltaY) >= 1) {
                    this.handleVerticalPan(deltaY);
                }
                this.dragStartX = e.touches[0].clientX;
                this.dragStartY = e.touches[0].clientY;
                e.preventDefault();
            } else if (e.touches.length === 2) {
                // Two finger pinch zoom
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (touchStartDistance > 0) {
                    // Calculate zoom factor
                    const scale = distance / touchStartDistance;
                    const newVisibleCount = Math.round(this.visibleCount / scale);
                    const clampedCount = Math.max(this.minVisibleCount, Math.min(this.maxVisibleCount, newVisibleCount));
                    
                    // Zoom around the center point of the pinch
                    const countDiff = clampedCount - this.visibleCount;
                    const newStartIndex = Math.round(this.visibleStartIndex - countDiff * touchCenterX);
                    
                    this.visibleCount = clampedCount;
                    this.setVisibleStartIndex(newStartIndex);
                    this.updateVisibleChart();
                }
                
                touchStartDistance = distance;
                e.preventDefault();
            }
        });

        canvas.addEventListener('touchend', (e) => {
            if (e.touches.length === 0) {
                this.isDragging = false;
                touchStartDistance = 0;
            } else if (e.touches.length === 1) {
                // Switched from pinch to pan
                this.isDragging = true;
                this.dragStartX = e.touches[0].clientX;
                this.dragStartY = e.touches[0].clientY;
                touchStartDistance = 0;
            }
        });
        
        canvas.addEventListener('touchcancel', () => {
            this.isDragging = false;
            touchStartDistance = 0;
        });

        // Click handler for upgrade message
        canvas.addEventListener('click', (e) => {
            if (this.showUpgradeMessage) {
                const rect = canvas.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                
                // Check if click is in the upgrade message area (left 30%)
                if (clickX < rect.width * 0.3) {
                    this.handleUpgradeClick();
                }
            }
        });
        
        // Set initial cursor
        canvas.style.cursor = 'crosshair';
    }
    
    // Helper function to zoom at center
    zoomAtCenter(zoomIn) {
        const zoomFactor = 1 + (zoomIn ? -this.zoomSensitivity : this.zoomSensitivity);
        const newVisibleCount = Math.round(this.visibleCount * zoomFactor);
        const clampedCount = Math.max(this.minVisibleCount, Math.min(this.maxVisibleCount, newVisibleCount));
        
        // Keep center candle in place
        const countDiff = clampedCount - this.visibleCount;
        const newStartIndex = Math.round(this.visibleStartIndex - countDiff * 0.5);
        
        this.visibleCount = clampedCount;
        this.setVisibleStartIndex(newStartIndex);
        
        this.updateVisibleChart();
    }
    
    // Helper function to pan by amount
    panByAmount(candleCount) {
        if (candleCount === 0) return;

        const desiredStartIndex = this.visibleStartIndex + candleCount;
        if (desiredStartIndex < 0) {
            this.showUpgradeMessage = !this.hasMoreData;
        } else {
            this.showUpgradeMessage = false;
        }

        this.setVisibleStartIndex(desiredStartIndex);

        if (
            candleCount < 0 &&
            this.visibleStartIndex <= 5 &&
            this.horizontalOverscroll.left === 0 &&
            this.hasMoreData &&
            !this.isLoadingMore
        ) {
            this.loadMoreHistoricalData();
        }

        this.updateVisibleChart();
    }
    
    // Helper function to adjust price scale
    adjustPriceScale(delta) {
        if (!this.customPriceRange) {
            // Initialize custom range from current range
            const visibleData = this.getVisibleData();
            const prices = visibleData.flatMap(c => [c.h, c.l]);
            const minPrice = Math.min(...prices);
            const maxPrice = Math.max(...prices);
            const center = (minPrice + maxPrice) / 2;
            const range = maxPrice - minPrice;
            
            this.customPriceRange = {
                min: center - range / 2,
                max: center + range / 2
            };
        }
        
        // Adjust range
        const center = (this.customPriceRange.min + this.customPriceRange.max) / 2;
        const currentRange = this.customPriceRange.max - this.customPriceRange.min;
        const newRange = currentRange * (1 - delta);
        
        this.customPriceRange.min = center - newRange / 2;
        this.customPriceRange.max = center + newRange / 2;
        
        this.updateVisibleChart();
    }
    
    // Helper function to auto-fit chart
    autoFitChart() {
        // Reset zoom to show reasonable amount of data
        this.visibleCount = 100;
        this.setVisibleStartIndex(Math.max(0, this.chartData.length - this.visibleCount));
        this.customPriceRange = null; // Reset custom price range
        this.priceScale = 1;
        this.updateVisibleChart();
    }
    
    // Helper function to get visible data
    getVisibleData() {
        const endIndex = Math.min(this.visibleStartIndex + this.visibleCount, this.chartData.length);
        return this.chartData.slice(this.visibleStartIndex, endIndex);
    }

    getMaxStartIndex() {
        return Math.max(0, this.chartData.length - this.visibleCount);
    }

    resetHorizontalOverscroll() {
        this.horizontalOverscroll.left = 0;
        this.horizontalOverscroll.right = 0;
    }

    setVisibleStartIndex(desiredStartIndex, { preserveOverscroll = false } = {}) {
        const maxStartIndex = this.getMaxStartIndex();

        if (desiredStartIndex < 0) {
            this.visibleStartIndex = 0;
            this.horizontalOverscroll.left = Math.min(this.maxHorizontalOverscroll, Math.abs(desiredStartIndex));
            this.horizontalOverscroll.right = 0;
        } else if (desiredStartIndex > maxStartIndex) {
            this.visibleStartIndex = maxStartIndex;
            this.horizontalOverscroll.right = Math.min(this.maxHorizontalOverscroll, desiredStartIndex - maxStartIndex);
            this.horizontalOverscroll.left = 0;
        } else {
            this.visibleStartIndex = desiredStartIndex;
            if (!preserveOverscroll) {
                this.resetHorizontalOverscroll();
            }
        }
    }

    handleUpgradeClick() {
        // Show upgrade modal or redirect to upgrade page
        const upgradeModal = confirm(
            '🚀 Upgrade to Pro for Unlimited Historical Data!\n\n' +
            '✨ Features:\n' +
            '• Unlimited historical candles\n' +
            '• Advanced technical indicators\n' +
            '• Export data functionality\n' +
            '• Priority support\n\n' +
            'Would you like to learn more?'
        );
        
        if (upgradeModal) {
            // In a real app, this would redirect to your upgrade page
            console.log('🎯 User interested in upgrade!');
            window.open('https://your-upgrade-page.com', '_blank');
        }
    }

    handleDrag(deltaX) {
        const sensitivity = 2; // Adjust this to make dragging more/less sensitive
        const candleMove = Math.round(deltaX / sensitivity);
        
        if (Math.abs(candleMove) >= 1) {
            const desiredStartIndex = this.visibleStartIndex - candleMove;
            const maxStartIndex = this.getMaxStartIndex();

            if (desiredStartIndex < 0) {
                this.showUpgradeMessage = !this.hasMoreData;
            } else {
                this.showUpgradeMessage = false;
            }

            this.setVisibleStartIndex(desiredStartIndex);

            // Only load more data when pulling left near the beginning and no overscroll space remaining
            if (
                candleMove > 0 &&
                this.visibleStartIndex <= 5 &&
                this.horizontalOverscroll.left === 0 &&
                this.hasMoreData &&
                !this.isLoadingMore
            ) {
                this.loadMoreHistoricalData();
            }
            
            // Update the visible chart data
            this.updateVisibleChart();
        }
    }

    handleVerticalPan(deltaY) {
        if (!this.chart) return;

        const chartArea = this.chart.chartArea;
        if (!chartArea) return;

        const visibleData = this.getVisibleData();
        if (visibleData.length === 0) return;

        if (!this.customPriceRange) {
            const prices = visibleData.flatMap(c => [c.h, c.l]);
            const minPrice = Math.min(...prices);
            const maxPrice = Math.max(...prices);
            const padding = (maxPrice - minPrice) * this.priceRangePadding;
            this.customPriceRange = {
                min: minPrice - padding,
                max: maxPrice + padding
            };
        }

        const currentRange = this.customPriceRange.max - this.customPriceRange.min;
        if (currentRange <= 0) return;

        const pricePerPixel = currentRange / chartArea.height;
        const priceShift = deltaY * pricePerPixel;

        this.customPriceRange.min += priceShift;
        this.customPriceRange.max += priceShift;

        this.updateVisibleChart();
    }

    updateVisibleChart() {
        if (this.chartData.length === 0) return;
        
        // Get the visible portion of data
        const endIndex = Math.min(this.visibleStartIndex + this.visibleCount, this.chartData.length);
        const visibleData = this.chartData.slice(this.visibleStartIndex, endIndex);
        
        if (visibleData.length > 0) {
            // Update chart with visible data only
            const scatterData = visibleData.map(candle => ({
                x: candle.x,
                y: (candle.h + candle.l) / 2
            }));

            this.chart.data.datasets[0].data = scatterData;
            
            // Store visible data for drawing candles
            this.visibleChartData = visibleData;
            
            // Update X-axis bounds with overscroll/padding
            const intervalMs = this.getIntervalMs(this.currentInterval);
            const firstX = visibleData[0].x;
            const lastX = visibleData[visibleData.length - 1].x;
            const leftPadCandles = this.baseLeftPadCandles + this.horizontalOverscroll.left;
            const rightPadCandles = this.baseRightPadCandles + this.horizontalOverscroll.right;
            this.chart.options.scales.x.min = firstX - intervalMs * leftPadCandles;
            this.chart.options.scales.x.max = lastX + intervalMs * rightPadCandles;
            
            // Update scales with custom range if available
            if (this.customPriceRange) {
                this.chart.options.scales.y.min = this.customPriceRange.min;
                this.chart.options.scales.y.max = this.customPriceRange.max;
            } else {
                // Auto-calculate price range
                const prices = visibleData.flatMap(c => [c.h, c.l]);
                const minPrice = Math.min(...prices);
                const maxPrice = Math.max(...prices);
                const padding = (maxPrice - minPrice) * this.priceRangePadding;
                
                this.chart.options.scales.y.min = minPrice - padding;
                this.chart.options.scales.y.max = maxPrice + padding;
            }
            
            this.chart.update('none'); // Use 'none' for better performance during dragging
            
            console.log(`📊 Showing candles ${this.visibleStartIndex} to ${endIndex} of ${this.chartData.length}`);
        }
    }

    drawCandlesticks(chart) {
        const { ctx, chartArea, scales } = chart;
        
        // Use visible data for drawing, fallback to all data
        const dataToRender = this.visibleChartData || this.chartData;
        if (!dataToRender || dataToRender.length === 0) return;
        
        ctx.save();
        
        // Calculate actual candle width (no max limit when checking for footprint)
        const rawCandleWidth = chartArea.width / dataToRender.length * 0.6;
        const candleWidth = Math.max(3, rawCandleWidth);
        
        // Auto-enable footprint mode when zoomed in enough
        const shouldShowFootprint = this.footprintMode && candleWidth >= this.footprintMinCandleWidth;
        
        // Add debug logging
        if (this.footprintMode) {
            console.log(`🔍 Footprint check: candleWidth=${candleWidth.toFixed(1)}px, min=${this.footprintMinCandleWidth}px, active=${shouldShowFootprint}`);
        }
        
        if (shouldShowFootprint) {
            // Draw footprint charts (use full width)
            console.log(`📊 Drawing FOOTPRINT charts (${dataToRender.length} candles)`);
            this.drawFootprintCharts(chart, dataToRender, candleWidth);
        } else {
            // Draw normal candlesticks (cap width for normal view)
            const normalCandleWidth = Math.min(20, candleWidth);
            this.drawNormalCandlesticks(chart, dataToRender, normalCandleWidth);
        }
        
        ctx.restore();
    }
    
    drawNormalCandlesticks(chart, dataToRender, candleWidth) {
        const { ctx, chartArea, scales } = chart;
        
        // Calculate volume data for scaling
        const volumes = dataToRender.map(c => c.v);
        const maxVolume = Math.max(...volumes);
        const minVolume = Math.min(...volumes);
        
        // Reserve bottom 25% of chart area for volume bars
        const priceAreaHeight = chartArea.height * 0.75;
        const volumeAreaHeight = chartArea.height * 0.25;
        const volumeAreaTop = chartArea.top + priceAreaHeight;
        
        dataToRender.forEach((candle, index) => {
            const x = scales.x.getPixelForValue(candle.x);
            
            // Adjust price coordinates to use only top 75% of chart
            const yHigh = chartArea.top + ((scales.y.getPixelForValue(candle.h) - chartArea.top) * 0.75);
            const yLow = chartArea.top + ((scales.y.getPixelForValue(candle.l) - chartArea.top) * 0.75);
            const yOpen = chartArea.top + ((scales.y.getPixelForValue(candle.o) - chartArea.top) * 0.75);
            const yClose = chartArea.top + ((scales.y.getPixelForValue(candle.c) - chartArea.top) * 0.75);
            
            // Skip if outside chart area
            if (x < chartArea.left || x > chartArea.right) return;
            
            const isGreen = candle.c >= candle.o;
            const color = isGreen ? '#26a69a' : '#ef5350';
            
            // === DRAW PRICE CANDLE ===
            
            // Draw the wicks (thin lines from high to body and body to low)
            const bodyTop = Math.min(yOpen, yClose);
            const bodyBottom = Math.max(yOpen, yClose);
            
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            
            // Upper wick (from high to top of body)
            if (yHigh < bodyTop) {
                ctx.beginPath();
                ctx.moveTo(x, yHigh);
                ctx.lineTo(x, bodyTop);
                ctx.stroke();
            }
            
            // Lower wick (from bottom of body to low)
            if (yLow > bodyBottom) {
                ctx.beginPath();
                ctx.moveTo(x, bodyBottom);
                ctx.lineTo(x, yLow);
                ctx.stroke();
            }
            
            // Draw the body (open-close rectangle)
            const bodyHeight = Math.abs(yClose - yOpen);
            
            if (bodyHeight > 0) {
                // Both green and red candles are now filled
                ctx.fillStyle = color;
                ctx.fillRect(x - candleWidth/2, bodyTop, candleWidth, bodyHeight);
                
                // Add a border to make them look more professional
                ctx.strokeStyle = color;
                ctx.lineWidth = 1;
                ctx.strokeRect(x - candleWidth/2, bodyTop, candleWidth, bodyHeight);
                
                // Add pulsing border for live candles
                if (candle.isLive && index === dataToRender.length - 1) {
                    ctx.strokeStyle = isGreen ? 'rgba(38, 166, 154, 0.8)' : 'rgba(239, 83, 80, 0.8)';
                    ctx.lineWidth = 2;
                    ctx.strokeRect(x - candleWidth/2 - 1, bodyTop - 1, candleWidth + 2, bodyHeight + 2);
                }
            } else {
                // Doji candle (open = close) - draw a horizontal line
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(x - candleWidth/2, yOpen);
                ctx.lineTo(x + candleWidth/2, yOpen);
                ctx.stroke();
            }
            
            // === DRAW VOLUME BAR ===
            
            // Calculate volume bar height (scale volume to available area)
            const volumeRatio = (candle.v - minVolume) / (maxVolume - minVolume) || 0;
            const volumeBarHeight = volumeRatio * volumeAreaHeight * 0.9; // Use 90% of volume area
            
            // Volume bar position (from bottom of volume area upwards)
            const volumeBarTop = chartArea.bottom - volumeBarHeight;
            const volumeBarWidth = candleWidth * 0.8; // Slightly thinner than candle
            
            // Volume bar color (same as candle but more transparent)
            ctx.fillStyle = isGreen ? 'rgba(38, 166, 154, 0.6)' : 'rgba(239, 83, 80, 0.6)';
            ctx.fillRect(x - volumeBarWidth/2, volumeBarTop, volumeBarWidth, volumeBarHeight);
            
            // Volume bar border
            ctx.strokeStyle = isGreen ? 'rgba(38, 166, 154, 0.8)' : 'rgba(239, 83, 80, 0.8)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x - volumeBarWidth/2, volumeBarTop, volumeBarWidth, volumeBarHeight);
        });
        
        // Draw separator line between price and volume areas
        ctx.strokeStyle = '#404040';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(chartArea.left, volumeAreaTop);
        ctx.lineTo(chartArea.right, volumeAreaTop);
        ctx.stroke();
        
        // Add volume label
        ctx.fillStyle = '#888888';
        ctx.font = '12px Arial';
        ctx.textAlign = 'left';
        ctx.fillText('Volume', chartArea.left + 5, volumeAreaTop + 15);
        
        // Draw upgrade message if at the beginning of data
        if (this.showUpgradeMessage && this.visibleStartIndex === 0) {
            this.drawUpgradeMessage(ctx, chartArea);
        }
        
        // Draw trade bubbles for short timeframes (1m, 5m, 15m, 1h)
        if (this.showTrades && ['1m', '5m', '15m', '1h'].includes(this.currentInterval)) {
            this.drawTradeBubbles(chart, dataToRender, candleWidth);
        }
    }
    
    drawFootprintCharts(chart, dataToRender, candleWidth) {
        const { ctx, chartArea, scales } = chart;

        const assetSymbol = this.currentSymbol.replace('USDT', '').replace('BUSD', '');

        console.log(`📊 drawFootprintCharts called: ${dataToRender.length} candles, width=${candleWidth.toFixed(1)}px`);

        ctx.save();
        ctx.beginPath();
        ctx.rect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
        ctx.clip();

        const formatVolume = (volume) => {
            if (!Number.isFinite(volume) || volume === 0) return '0';
            if (Math.abs(volume) >= 1_000_000) return `${(volume / 1_000_000).toFixed(2)}M`;
            if (Math.abs(volume) >= 1_000) return `${(volume / 1_000).toFixed(2)}K`;
            if (Math.abs(volume) >= 1) return volume.toFixed(2);
            return volume.toFixed(4);
        };

        const formatPrice = (value, precision) => {
            if (value === null || value === undefined) return '--';
            return value.toFixed(Math.min(Math.max(precision, 0), 8));
        };

        const formatVolumeWithUnits = (volume) => `${formatVolume(volume)} ${assetSymbol}`;

        let candlesWithFootprint = 0;
        let candlesWithoutFootprint = 0;

        dataToRender.forEach(candle => {
            const x = scales.x.getPixelForValue(candle.x);
            if (x < chartArea.left || x > chartArea.right) return;

            let footprintEntry = this.footprintData[candle.x];
            if ((!footprintEntry || !footprintEntry.levels) && this.tradesData[candle.x]) {
                this.buildFootprintData(candle.x);
                footprintEntry = this.footprintData[candle.x];
            }

            if (!footprintEntry || !footprintEntry.levels || footprintEntry.levels.length === 0) {
                candlesWithoutFootprint += 1;
                return;
            }

            candlesWithFootprint += 1;
            const { levels, stats } = footprintEntry;

            const yHigh = scales.y.getPixelForValue(candle.h);
            const yLow = scales.y.getPixelForValue(candle.l);
            const candleHeight = yLow - yHigh;

            const candleZoneWidth = Math.max(12, candleWidth * 0.28);
            const footprintZoneWidth = candleWidth - candleZoneWidth;
            const layoutLeft = x - candleWidth / 2;
            const candleCenterX = layoutLeft + candleZoneWidth / 2;
            const footprintLeft = layoutLeft + candleZoneWidth;
            const footprintRight = footprintLeft + footprintZoneWidth;

            const isGreen = candle.c >= candle.o;
            const yOpen = scales.y.getPixelForValue(candle.o);
            const yClose = scales.y.getPixelForValue(candle.c);
            const bodyTop = Math.min(yOpen, yClose);
            const bodyBottom = Math.max(yOpen, yClose);
            const bodyHeight = Math.max(1, bodyBottom - bodyTop);

            ctx.strokeStyle = isGreen ? '#2ecc71' : '#ff5c5c';
            ctx.lineWidth = Math.max(2, candleWidth / 42);
            ctx.beginPath();
            ctx.moveTo(candleCenterX, yHigh);
            ctx.lineTo(candleCenterX, yLow);
            ctx.stroke();

            const bodyWidth = Math.max(10, candleZoneWidth * 0.68);
            ctx.fillStyle = isGreen ? 'rgba(46, 204, 113, 0.95)' : 'rgba(255, 92, 92, 0.95)';
            ctx.fillRect(candleCenterX - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);
            ctx.strokeRect(candleCenterX - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);

            const levelCount = levels.length;
            const rowHeight = candleHeight / levelCount;
            const minRowForText = 11;
            const labelEvery = rowHeight < 12 ? Math.ceil(12 / Math.max(rowHeight, 1)) : 1;

            const maxBuyVolume = Math.max(...levels.map(layer => layer.buyVolume));
            const maxSellVolume = Math.max(...levels.map(layer => layer.sellVolume));
            const maxTotalVolume = Math.max(...levels.map(layer => layer.totalVolume));

            const priceColumnWidth = footprintZoneWidth * 0.30;
            const dataColumnWidth = footprintZoneWidth - priceColumnWidth;
            const centerX = footprintLeft + priceColumnWidth + dataColumnWidth / 2;

            // Header stats above candle
            if (this.showVolumeDelta && stats) {
                const headerFont = Math.max(11, Math.min(15, candleWidth / 5));
                const secondaryFont = Math.max(10, headerFont - 2);
                const headerLeft = footprintLeft + 4;
                const headerBottom = yHigh - 6;

                ctx.fillStyle = 'rgba(14, 16, 24, 0.85)';
                const headerHeight = headerFont + secondaryFont * 3 + 12;
                ctx.fillRect(headerLeft - 4, headerBottom - headerHeight, footprintZoneWidth - 8, headerHeight);

                ctx.fillStyle = stats.delta >= 0 ? '#41f191' : '#ff6b6b';
                ctx.font = `bold ${headerFont}px "Inter", Arial`;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'bottom';
                const deltaSign = stats.delta >= 0 ? '+' : '-';
                ctx.fillText(`${deltaSign}${formatVolume(Math.abs(stats.delta))} ${assetSymbol}`, headerLeft, headerBottom);

                ctx.fillStyle = '#bfc7d9';
                ctx.font = `${secondaryFont}px "Inter", Arial`;
                ctx.textBaseline = 'top';
                const headerLine = `Vol ${formatVolumeWithUnits(stats.totalVolume)} • Trades ${stats.tradeCount}`;
                const pocLine = `POC ${formatPrice(stats.pocPrice, stats.pricePrecision)} (${formatVolumeWithUnits(stats.pocVolume)})`;
                const vahLine = `VAH ${formatPrice(stats.vahPrice, stats.pricePrecision)} • VAL ${formatPrice(stats.valPrice, stats.pricePrecision)}`;

                ctx.fillText(headerLine, headerLeft, headerBottom - headerFont - 4);
                ctx.fillText(pocLine, headerLeft, headerBottom - headerFont - secondaryFont - 6);
                ctx.fillText(vahLine, headerLeft, headerBottom - headerFont - secondaryFont * 2 - 8);
            }

            levels.forEach((layer, index) => {
                const rowTop = yHigh + index * rowHeight;
                const rowBottom = rowTop + rowHeight;
                const rowMiddle = (rowTop + rowBottom) / 2;

                if (layer.inValueArea) {
                    ctx.fillStyle = layer.isPOC ? 'rgba(255, 215, 0, 0.18)' : 'rgba(255, 255, 255, 0.06)';
                    ctx.fillRect(footprintLeft, rowTop, footprintZoneWidth, rowHeight);
                }

                if (layer.isVAHigh || layer.isVALow) {
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([4, 4]);
                    ctx.beginPath();
                    ctx.moveTo(footprintLeft, layer.isVAHigh ? rowTop : rowBottom);
                    ctx.lineTo(footprintRight, layer.isVAHigh ? rowTop : rowBottom);
                    ctx.stroke();
                    ctx.setLineDash([]);
                }

                const showLabels = rowHeight >= 12 || index % labelEvery === 0;
                // Price labels hidden during testing per user request

                const sellRatio = maxSellVolume > 0 ? layer.sellVolume / maxSellVolume : 0;
                const buyRatio = maxBuyVolume > 0 ? layer.buyVolume / maxBuyVolume : 0;

                const sellBarWidth = dataColumnWidth * 0.42 * sellRatio;
                const buyBarWidth = dataColumnWidth * 0.42 * buyRatio;

                const barHeight = Math.max(rowHeight * 0.55, 4);
                const barTop = rowMiddle - barHeight / 2;

                if (sellBarWidth > 0) {
                    ctx.fillStyle = `rgba(255, 99, 99, ${0.2 + layer.sellRatio * 0.6})`;
                    ctx.fillRect(centerX - sellBarWidth, barTop, sellBarWidth, barHeight);
                    ctx.strokeStyle = 'rgba(255, 99, 99, 0.7)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(centerX - sellBarWidth, barTop, sellBarWidth, barHeight);
                }

                if (buyBarWidth > 0) {
                    ctx.fillStyle = `rgba(74, 222, 128, ${0.2 + layer.buyRatio * 0.6})`;
                    ctx.fillRect(centerX, barTop, buyBarWidth, barHeight);
                    ctx.strokeStyle = 'rgba(74, 222, 128, 0.7)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(centerX, barTop, buyBarWidth, barHeight);
                }

                if (rowHeight >= minRowForText && showLabels) {
                    ctx.font = `${Math.max(11, Math.min(15, candleWidth / 6))}px "Inter", Arial`;
                    ctx.textBaseline = 'middle';

                    if (layer.sellVolume > 0) {
                        ctx.fillStyle = '#ff8484';
                        ctx.textAlign = 'right';
                        ctx.fillText(formatVolume(layer.sellVolume), centerX - sellBarWidth - 6, rowMiddle);
                    }

                    if (layer.buyVolume > 0) {
                        ctx.fillStyle = '#4ae080';
                        ctx.textAlign = 'left';
                        ctx.fillText(formatVolume(layer.buyVolume), centerX + buyBarWidth + 6, rowMiddle);
                    }

                    if (layer.tradeCount > 0 && maxTotalVolume > 0 && rowHeight >= 18) {
                        ctx.fillStyle = '#9fa9c6';
                        ctx.textAlign = 'center';
                        ctx.font = `${Math.max(9, Math.min(11, candleWidth / 8))}px "Inter", Arial`;
                        ctx.fillText(`${layer.tradeCount}t`, centerX, rowMiddle + barHeight / 2 + 6);
                    }
                }

                ctx.strokeStyle = 'rgba(120, 130, 150, 0.25)';
                ctx.lineWidth = 0.5;
                ctx.beginPath();
                ctx.moveTo(footprintLeft, rowBottom);
                ctx.lineTo(footprintRight, rowBottom);
                ctx.stroke();
            });
        });

        console.log(`✅ Footprint render complete: ${candlesWithFootprint} with data, ${candlesWithoutFootprint} without`);

        ctx.restore();
    }

    drawUpgradeMessage(ctx, chartArea) {
        ctx.save();
        
        // Semi-transparent overlay on the left side
        const overlayWidth = chartArea.width * 0.3; // 30% of chart width
        
        // Gradient background
        const gradient = ctx.createLinearGradient(chartArea.left, 0, chartArea.left + overlayWidth, 0);
        gradient.addColorStop(0, 'rgba(0, 0, 0, 0.8)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0.2)');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(chartArea.left, chartArea.top, overlayWidth, chartArea.height);
        
        // Border line
        ctx.strokeStyle = '#404040';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(chartArea.left + overlayWidth, chartArea.top);
        ctx.lineTo(chartArea.left + overlayWidth, chartArea.bottom);
        ctx.stroke();
        
        // Message text
        const centerX = chartArea.left + overlayWidth / 2;
        const centerY = chartArea.top + chartArea.height / 2;
        
        // Main message
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('📈 More History Available', centerX, centerY - 20);
        
        // Upgrade text
        ctx.fillStyle = '#0078d4';
        ctx.font = 'bold 14px Arial';
        ctx.fillText('🚀 Upgrade for More Candles', centerX, centerY + 10);
        
        // Subtitle
        ctx.fillStyle = '#cccccc';
        ctx.font = '12px Arial';
        ctx.fillText('Get unlimited historical data', centerX, centerY + 35);
        
        // Pro badge with rounded corners effect
        ctx.fillStyle = '#26a69a';
        ctx.font = 'bold 10px Arial';
        const badgeText = 'PRO FEATURE';
        const textWidth = ctx.measureText(badgeText).width;
        const badgeX = centerX - textWidth / 2 - 5;
        const badgeY = centerY + 55;
        
        // Badge background with glow effect
        ctx.shadowColor = '#26a69a';
        ctx.shadowBlur = 10;
        ctx.fillStyle = '#26a69a';
        ctx.fillRect(badgeX, badgeY - 10, textWidth + 10, 15);
        
        // Reset shadow
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        
        // Badge text
        ctx.fillStyle = '#ffffff';
        ctx.fillText(badgeText, centerX, badgeY);
        
        // Add click hint
        ctx.fillStyle = '#888888';
        ctx.font = '10px Arial';
        ctx.fillText('Click to learn more', centerX, centerY + 80);
        
        ctx.restore();
    }

    drawTradeBubbles(chart, dataToRender, candleWidth) {
        const { ctx, chartArea, scales } = chart;
        
        ctx.save();
        
        // Process each candle to draw trade bubbles
        dataToRender.forEach((candle, index) => {
            // Check if this is the current/live candle
            const isCurrentCandle = (index === dataToRender.length - 1) && candle.isLive;
            
            const trades = this.tradesData[candle.x];
            if (!trades || trades.length === 0) return;
            
            const x = scales.x.getPixelForValue(candle.x);
            
            // Skip if outside chart area
            if (x < chartArea.left || x > chartArea.right) return;
            
            // Calculate threshold in USD terms using CURRENT BTC PRICE (dynamic!)
            // Example: If BTC is $62,000 and slider is 0.1, threshold = $6,200 USD
            const thresholdUSD = this.tradeThreshold * this.btcPrice;
            
            // Calculate dynamic price grouping based on asset price
            // Higher priced assets (BTC) need wider grouping than low priced ones (DOGE)
            const assetPrice = candle.c;
            let priceGroupingFactor;
            if (assetPrice > 10000) {
                // BTC: Group within $10
                priceGroupingFactor = 10;
            } else if (assetPrice > 1000) {
                // ETH: Group within $1
                priceGroupingFactor = 1;
            } else if (assetPrice > 100) {
                // SOL: Group within $0.10
                priceGroupingFactor = 0.1;
            } else if (assetPrice > 1) {
                // DOT, ADA: Group within $0.01
                priceGroupingFactor = 0.01;
            } else {
                // DOGE: Group within $0.001
                priceGroupingFactor = 0.001;
            }
            
            // Filter trades by threshold and aggregate by price level
            const priceGroups = {};
            
            trades.forEach(trade => {
                // Calculate trade value in USD
                const tradeValueUSD = trade.quantity * trade.price;
                
                // Apply universal USD threshold across all assets
                if (tradeValueUSD < thresholdUSD) return;
                
                // Smarter price grouping - group nearby trades together
                const priceKey = Math.round(trade.price / priceGroupingFactor) * priceGroupingFactor;
                
                if (!priceGroups[priceKey]) {
                    priceGroups[priceKey] = {
                        price: priceKey,
                        totalQuantity: 0,
                        buyQuantity: 0,
                        sellQuantity: 0,
                        tradeCount: 0,
                        totalValueUSD: 0,
                        trades: []
                    };
                }
                
                priceGroups[priceKey].totalQuantity += trade.quantity;
                priceGroups[priceKey].tradeCount++;
                priceGroups[priceKey].totalValueUSD += tradeValueUSD;
                priceGroups[priceKey].trades.push(trade);
                
                if (trade.isBuy) {
                    priceGroups[priceKey].buyQuantity += trade.quantity;
                } else {
                    priceGroups[priceKey].sellQuantity += trade.quantity;
                }
            });
            
            // Draw bubbles for each price group
            // First, prepare all bubble data and filter out neutral trades
            const bubbleData = Object.values(priceGroups).map(group => {
                const buyRatio = group.buyQuantity / group.totalQuantity;
                
                // Skip neutral trades (45%-55% range) - don't draw yellow bubbles
                if (buyRatio >= 0.45 && buyRatio <= 0.55) {
                    return null; // Skip this bubble
                }
                
                // Adjust Y coordinate to use only top 75% of chart (matching candle drawing)
                const rawY = scales.y.getPixelForValue(group.price);
                const y = chartArea.top + ((rawY - chartArea.top) * 0.75);
                
                // Skip if outside price area
                if (y < chartArea.top || y > chartArea.top + chartArea.height * 0.75) return null;
                
                // Use the pre-calculated totalValueUSD from the group
                const tradeValueUSD = group.totalValueUSD;
                
                // Smaller bubbles - reduced by ~30% for cleaner look
                const minRadius = 3;
                const maxRadius = 25;
                
                // Calculate radius with LINEAR scaling for clear size differences
                let radius;
                if (tradeValueUSD < 100) {
                    // Tiny trades: 3-4px
                    radius = 3 + (tradeValueUSD / 100) * 1;
                } else if (tradeValueUSD < 500) {
                    // Very small: 4-6px
                    const ratio = (tradeValueUSD - 100) / 400;
                    radius = 4 + (ratio * 2);
                } else if (tradeValueUSD < 1000) {
                    // Small: 6-8px
                    const ratio = (tradeValueUSD - 500) / 500;
                    radius = 6 + (ratio * 2);
                } else if (tradeValueUSD < 2500) {
                    // Medium-small: 8-11px
                    const ratio = (tradeValueUSD - 1000) / 1500;
                    radius = 8 + (ratio * 3);
                } else if (tradeValueUSD < 5000) {
                    // Medium: 11-14px
                    const ratio = (tradeValueUSD - 2500) / 2500;
                    radius = 11 + (ratio * 3);
                } else if (tradeValueUSD < 10000) {
                    // Medium-large: 14-17px
                    const ratio = (tradeValueUSD - 5000) / 5000;
                    radius = 14 + (ratio * 3);
                } else if (tradeValueUSD < 25000) {
                    // Large: 17-21px
                    const ratio = (tradeValueUSD - 10000) / 15000;
                    radius = 17 + (ratio * 4);
                } else {
                    // Huge: 21-25px
                    const ratio = Math.min(1, (tradeValueUSD - 25000) / 75000);
                    radius = 21 + (ratio * 4);
                }
                
                radius = Math.max(minRadius, Math.min(maxRadius, radius));
                
                // Determine bubble color - only green or red (no yellow)
                let bubbleColor, borderColor;
                
                if (buyRatio > 0.55) {
                    // Predominantly buy - GREEN
                    const intensity = Math.min(1, (buyRatio - 0.55) / 0.45 + 0.5);
                    bubbleColor = `rgba(38, 166, 154, ${0.4 + intensity * 0.3})`;
                    borderColor = `rgba(38, 166, 154, ${0.8 + intensity * 0.2})`;
                } else {
                    // Predominantly sell - RED (buyRatio < 0.45)
                    const sellRatio = 1 - buyRatio;
                    const intensity = Math.min(1, (sellRatio - 0.55) / 0.45 + 0.5);
                    bubbleColor = `rgba(239, 83, 80, ${0.4 + intensity * 0.3})`;
                    borderColor = `rgba(239, 83, 80, ${0.8 + intensity * 0.2})`;
                }
                
                return {
                    x, y, radius, tradeValueUSD, bubbleColor, borderColor, group
                };
            }).filter(b => b !== null); // Remove skipped bubbles
            
            // === SMART BUBBLE LIMITING ===
            // Limit maximum bubbles per candle to prevent visual clutter
            const MAX_BUBBLES_PER_CANDLE = this.maxBubblesPerCandle;
            
            if (bubbleData.length > MAX_BUBBLES_PER_CANDLE) {
                // Sort by trade value (most significant first)
                bubbleData.sort((a, b) => b.tradeValueUSD - a.tradeValueUSD);
                
                // Keep only the top N most significant trades
                bubbleData.splice(MAX_BUBBLES_PER_CANDLE);
                
                // Log when limiting occurs (for debugging)
                if (index < 3) {
                    console.log(`⚠️ Limited candle #${index} to ${MAX_BUBBLES_PER_CANDLE} bubbles (had ${Object.keys(priceGroups).length} price groups)`);
                }
            }
            
            // Sort bubbles by size (largest first) so smaller bubbles are drawn on top
            bubbleData.sort((a, b) => b.radius - a.radius);
            
            // Now draw all bubbles in order (largest to smallest)
            bubbleData.forEach(bubble => {
                const { x, y, radius, tradeValueUSD, bubbleColor, borderColor } = bubble;
                
                // Draw bubble shadow for depth
                ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
                ctx.shadowBlur = 4;
                ctx.shadowOffsetX = 1;
                ctx.shadowOffsetY = 1;
                
                // Draw bubble
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, 2 * Math.PI);
                ctx.fillStyle = bubbleColor;
                ctx.fill();
                
                // Reset shadow for border
                ctx.shadowColor = 'transparent';
                ctx.shadowBlur = 0;
                
                // Draw border (thicker for current candle)
                ctx.strokeStyle = borderColor;
                ctx.lineWidth = isCurrentCandle ? 2 : 1.5;
                ctx.stroke();
                
                // Add pulsing ring for current candle bubbles
                if (isCurrentCandle) {
                    const pulsePhase = (Date.now() % 1500) / 1500; // 1.5 second cycle
                    const pulseRadius = radius + 2 + (pulsePhase * 4);
                    const pulseOpacity = 0.6 - (pulsePhase * 0.6);
                    
                    ctx.beginPath();
                    ctx.arc(x, y, pulseRadius, 0, 2 * Math.PI);
                    ctx.strokeStyle = borderColor.replace(/[\d.]+\)$/g, `${pulseOpacity})`);
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
                
                // Enhanced pulse effect for large trades
                const largeTradeThrsehold = this.tradeThreshold * this.btcPrice * 5;
                const hugeTradeThrsehold = this.tradeThreshold * this.btcPrice * 20;
                
                if (tradeValueUSD > largeTradeThrsehold && !isCurrentCandle) {
                    // First pulse ring
                    ctx.beginPath();
                    ctx.arc(x, y, radius + 3, 0, 2 * Math.PI);
                    ctx.strokeStyle = borderColor.replace(/[\d.]+\)$/g, '0.4)');
                    ctx.lineWidth = 2;
                    ctx.stroke();
                    
                    // Second pulse ring for very large trades
                    if (tradeValueUSD > hugeTradeThrsehold) {
                        ctx.beginPath();
                        ctx.arc(x, y, radius + 6, 0, 2 * Math.PI);
                        ctx.strokeStyle = borderColor.replace(/[\d.]+\)$/g, '0.2)');
                        ctx.lineWidth = 1.5;
                        ctx.stroke();
                    }
                }
            });
        });
        
        ctx.restore();
    }

    setupEventListeners() {
        // Symbol selector
        document.getElementById('symbol-select').addEventListener('change', async (e) => {
            this.currentSymbol = e.target.value;
            await this.refreshData();
        });

        // Timeframe buttons
        document.querySelectorAll('.timeframe-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                document.querySelector('.timeframe-btn.active').classList.remove('active');
                e.target.classList.add('active');
                this.currentInterval = e.target.dataset.interval;
                await this.refreshData();
            });
        });

        // Control buttons
        document.getElementById('refresh-data').addEventListener('click', async () => {
            await this.refreshData();
        });

        document.getElementById('load-more').addEventListener('click', async () => {
            await this.loadMoreHistoricalData();
        });

        document.getElementById('zoom-in').addEventListener('click', () => {
            this.zoomAtCenter(true);
        });

        document.getElementById('zoom-out').addEventListener('click', () => {
            this.zoomAtCenter(false);
            // Load more data when zooming out to show more history
            setTimeout(() => this.loadMoreHistoricalData(), 300);
        });

        document.getElementById('reset-zoom').addEventListener('click', () => {
            this.autoFitChart();
            // Load more data when resetting zoom
            setTimeout(() => this.loadMoreHistoricalData(), 300);
        });

        // Help button
        const helpBtn = document.getElementById('help-btn');
        const helpOverlay = document.getElementById('help-overlay');
        let helpVisible = false;
        
        if (helpBtn && helpOverlay) {
            helpBtn.addEventListener('click', () => {
                helpVisible = !helpVisible;
                helpOverlay.classList.toggle('visible', helpVisible);
            });
            
            // Also toggle help with 'H' key
            document.addEventListener('keydown', (e) => {
                if (e.code === 'KeyH' && !e.ctrlKey && !e.metaKey) {
                    helpVisible = !helpVisible;
                    helpOverlay.classList.toggle('visible', helpVisible);
                    e.preventDefault();
                }
            });
            
            // Close help when clicking outside
            document.addEventListener('click', (e) => {
                if (helpVisible && !helpOverlay.contains(e.target) && e.target !== helpBtn) {
                    helpVisible = false;
                    helpOverlay.classList.remove('visible');
                }
            });
        }

        // Trade bubble controls
        const thresholdSlider = document.getElementById('trade-threshold');
        const thresholdValue = document.getElementById('threshold-value');
        const showTradesCheckbox = document.getElementById('show-trades');

        if (thresholdSlider) {
            thresholdSlider.addEventListener('input', (e) => {
                this.tradeThreshold = parseFloat(e.target.value);
                const thresholdUSD = this.tradeThreshold * this.btcPrice;
                
                // Format large numbers nicely with FIXED WIDTH to prevent jumping
                let formattedUSD;
                if (thresholdUSD >= 10000) {
                    // $10k+ format: "$50.0k" (always 6 chars)
                    formattedUSD = `$${(thresholdUSD / 1000).toFixed(1)}k`;
                } else if (thresholdUSD >= 1000) {
                    // $1k-$10k format: "$5.0k " (6 chars with space)
                    formattedUSD = `$${(thresholdUSD / 1000).toFixed(1)}k `;
                } else if (thresholdUSD >= 100) {
                    // $100-$999 format: "$500 " (5 chars padded)
                    formattedUSD = `$${thresholdUSD.toFixed(0).padStart(3, ' ')} `;
                } else {
                    // <$100 format: "$50  " (5 chars padded)
                    formattedUSD = `$${thresholdUSD.toFixed(0).padStart(2, ' ')}  `;
                }
                
                // Show 2 decimal places for values < 1, 1 decimal for >= 1
                const btcDisplay = this.tradeThreshold < 1 
                    ? this.tradeThreshold.toFixed(2)
                    : this.tradeThreshold.toFixed(1);
                
                thresholdValue.textContent = `${btcDisplay} BTC (${formattedUSD})`;
                thresholdValue.style.fontFamily = 'monospace'; // Use monospace for consistent width
                
                console.log(`💰 Threshold updated: ${this.tradeThreshold} BTC = ${formattedUSD.trim()}`);
                
                if (this.chart) {
                    this.chart.update('none');
                }
            });
        }

        if (showTradesCheckbox) {
            showTradesCheckbox.addEventListener('change', (e) => {
                this.showTrades = e.target.checked;
                if (this.chart) {
                    this.chart.update('none');
                }
            });
        }
        
        // Max bubbles per candle slider
        const maxBubblesSlider = document.getElementById('max-bubbles');
        const maxBubblesValue = document.getElementById('max-bubbles-value');
        
        if (maxBubblesSlider && maxBubblesValue) {
            maxBubblesSlider.addEventListener('input', (e) => {
                this.maxBubblesPerCandle = parseInt(e.target.value);
                maxBubblesValue.textContent = this.maxBubblesPerCandle;
                
                console.log(`🎯 Max bubbles per candle: ${this.maxBubblesPerCandle}`);
                
                if (this.chart) {
                    this.chart.update('none');
                }
            });
        }
        
        // Footprint mode controls
        const footprintModeCheckbox = document.getElementById('footprint-mode');
        const footprintLayersSlider = document.getElementById('footprint-layers');
        const footprintLayersValue = document.getElementById('footprint-layers-value');
        const volumeDeltaCheckbox = document.getElementById('show-volume-delta');
        
        if (footprintModeCheckbox) {
            footprintModeCheckbox.addEventListener('change', async (e) => {
                this.footprintMode = e.target.checked;
                console.log(`📊 Footprint mode: ${this.footprintMode ? 'ON' : 'OFF'}`);
                
                if (this.footprintMode) {
                    // First, fetch trades for visible candles if not already loaded
                    console.log('📥 Fetching trades for footprint mode...');
                    await this.fetchTradesForVisibleCandles();
                    
                    // Build footprint data for all visible candles
                    console.log('🔨 Building footprint data for visible candles...');
                    this.chartData.forEach(candle => {
                        if (this.tradesData[candle.x] && !this.footprintData[candle.x]) {
                            this.buildFootprintData(candle.x);
                        }
                    });
                    
                    // Auto-zoom to show footprint (zoom until candles are 80px wide)
                    console.log('🔍 Auto-zooming to footprint view...');
                    const targetCandleWidth = 80; // Target 80px per candle
                    const chartArea = this.chart.chartArea;
                    const currentVisibleCandles = this.visibleChartData ? this.visibleChartData.length : this.chartData.length;
                    const currentCandleWidth = chartArea.width / currentVisibleCandles * 0.6;
                    
                    // Calculate how many candles we need to show to get 80px width
                    const targetVisibleCandles = Math.floor(chartArea.width / (targetCandleWidth / 0.6));
                    
                    // Set visible range to show fewer candles (zoom in)
                    const endIndex = this.visibleEndIndex || this.chartData.length - 1;
                    const startIndex = Math.max(0, endIndex - targetVisibleCandles + 1);
                    
                    this.visibleCount = Math.max(this.minVisibleCount, targetVisibleCandles);
                    this.visibleEndIndex = endIndex;
                    this.setVisibleStartIndex(startIndex);
                    this.updateVisibleChart();
                    
                    console.log(`✅ Zoomed to show ${targetVisibleCandles} candles (${currentCandleWidth.toFixed(1)}px → ${targetCandleWidth}px)`);
                }
                
                if (this.chart) {
                    this.chart.update('none');
                }
            });
        }
        
        if (footprintLayersSlider && footprintLayersValue) {
            footprintLayersSlider.value = this.footprintLayers;
            footprintLayersValue.textContent = `${this.footprintLayers}`;

            footprintLayersSlider.addEventListener('input', (e) => {
                this.footprintLayers = parseInt(e.target.value, 10);
                footprintLayersValue.textContent = `${this.footprintLayers}`;

                console.log(`📊 Footprint max price levels: ${this.footprintLayers}`);

                if (this.footprintMode) {
                    this.footprintData = {};
                    this.volumeDeltaData = {};

                    this.chartData.forEach(candle => {
                        if (this.tradesData[candle.x]) {
                            this.buildFootprintData(candle.x);
                        }
                    });
                }

                if (this.chart) {
                    this.chart.update('none');
                }
            });
        }
        
        if (volumeDeltaCheckbox) {
            volumeDeltaCheckbox.addEventListener('change', (e) => {
                this.showVolumeDelta = e.target.checked;
                console.log(`💹 Volume Delta: ${this.showVolumeDelta ? 'ON' : 'OFF'}`);
                
                if (this.chart) {
                    this.chart.update('none');
                }
            });
        }
    }

    async loadRealData() {
        try {
            this.setLoadingState(true, `Loading ${this.currentSymbol} ${this.currentInterval} data...`);
            console.log(`Loading real data for ${this.currentSymbol} ${this.currentInterval}`);
            
            // Fetch current BTC price for threshold calculation
            await this.fetchCurrentBTCPrice();
            
            // Update threshold display with actual BTC price
            const thresholdValue = document.getElementById('threshold-value');
            if (thresholdValue) {
                const thresholdUSD = this.tradeThreshold * this.btcPrice;
                
                // Format with FIXED WIDTH to prevent jumping
                let formattedUSD;
                if (thresholdUSD >= 10000) {
                    formattedUSD = `$${(thresholdUSD / 1000).toFixed(1)}k`;
                } else if (thresholdUSD >= 1000) {
                    formattedUSD = `$${(thresholdUSD / 1000).toFixed(1)}k `;
                } else if (thresholdUSD >= 100) {
                    formattedUSD = `$${thresholdUSD.toFixed(0).padStart(3, ' ')} `;
                } else {
                    formattedUSD = `$${thresholdUSD.toFixed(0).padStart(2, ' ')}  `;
                }
                
                // Show 2 decimal places for values < 1, 1 decimal for >= 1
                const btcDisplay = this.tradeThreshold < 1 
                    ? this.tradeThreshold.toFixed(2)
                    : this.tradeThreshold.toFixed(1);
                    
                thresholdValue.textContent = `${btcDisplay} BTC (${formattedUSD})`;
                thresholdValue.style.fontFamily = 'monospace'; // Use monospace for consistent width
            }
            
            // Disconnect existing WebSocket
            this.disconnectWebSocket();
            
            // Load initial data (100 candles)
            this.chartData = await this.fetchBinanceData(this.currentSymbol, this.currentInterval, 100);
            
            // Reset historical data flags
            this.hasMoreData = true;
            
            this.updateChart();
            this.updatePriceInfo();
            this.setLoadingState(false);
            
            // Fetch trade data for short timeframes: 1m, 5m, 15m, 1h
            if (['1m', '5m', '15m', '1h'].includes(this.currentInterval)) {
                setTimeout(async () => {
                    this.setLoadingState(true, 'Loading trade data...');
                    await this.fetchTradesForVisibleCandles();
                    this.setLoadingState(false);
                }, 200);
            }
            
            // Load 30 candles behind current view for drag-back functionality
            setTimeout(() => {
                this.loadBackBuffer();
            }, 500);
            
            // Start real-time WebSocket updates
            setTimeout(() => {
                this.initWebSocket();
            }, 1000);
            
            // Also start polling as fallback (every 10 seconds for short timeframes)
            if (['1m', '5m', '15m'].includes(this.currentInterval)) {
                this.startPolling();
            }
            
            // Update BTC price every 30 seconds for accurate threshold calculation
            setInterval(async () => {
                await this.fetchCurrentBTCPrice();
            }, 30000);
            
        } catch (error) {
            console.error('Failed to load data:', error);
            this.setLoadingState(false, 'Error loading data');
        }
    }

    async refreshData() {
        console.log(`Refreshing data for ${this.currentSymbol} ${this.currentInterval}`);
        // Stop polling and WebSocket before refreshing
        this.stopPolling();
        this.disconnectWebSocket();
        await this.loadRealData();
    }

    setLoadingState(isLoading, message = 'Loading...') {
        this.isLoading = isLoading;
        const statusBar = document.querySelector('.status-bar');
        
        if (isLoading) {
            statusBar.style.backgroundColor = '#2a4d3a';
            document.getElementById('current-price').textContent = message;
        } else {
            statusBar.style.backgroundColor = '#2a2a2a';
        }
    }

    initWebSocket() {
        if (this.websocket) {
            this.websocket.close();
        }

        const symbol = this.currentSymbol.toLowerCase();
        const interval = this.currentInterval;
        
        // Subscribe to BOTH kline AND trade streams for live updates
        const klineStream = `${symbol}@kline_${interval}`;
        const tradeStream = `${symbol}@aggTrade`;
        const combinedStreams = `/stream?streams=${klineStream}/${tradeStream}`;
        const wsUrl = `wss://stream.binance.com:9443${combinedStreams}`;

        console.log(`🔌 Connecting to WebSocket: ${wsUrl}`);

        this.websocket = new WebSocket(wsUrl);

        this.websocket.onopen = () => {
            console.log('✅ WebSocket connected for real-time updates');
            this.updateConnectionStatus(true);
            // Clear current candle trades when connection opens
            this.currentCandleTrades = [];
        };

        this.websocket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                
                // Handle kline (candle) updates
                if (message.stream && message.stream.includes('@kline')) {
                    this.handleRealtimeKline(message.data.k);
                }
                
                // Handle individual trade updates (NEW!)
                if (message.stream && message.stream.includes('@aggTrade')) {
                    this.handleRealtimeTrade(message.data);
                }
            } catch (error) {
                console.error('❌ WebSocket message parsing error:', error);
            }
        };

        this.websocket.onclose = () => {
            console.log('🔌 WebSocket disconnected');
            this.updateConnectionStatus(false);
            
            // Reconnect after 3 seconds
            setTimeout(() => {
                if (!this.websocket || this.websocket.readyState === WebSocket.CLOSED) {
                    console.log('🔄 Attempting to reconnect WebSocket...');
                    this.initWebSocket();
                }
            }, 3000);
        };

        this.websocket.onerror = (error) => {
            console.error('❌ WebSocket error:', error);
            this.updateConnectionStatus(false);
        };
    }

    handleRealtimeKline(klineData) {
        const {
            t: openTime,
            o: open,
            h: high,
            l: low,
            c: close,
            v: volume,
            x: isClosed // true if this kline is closed
        } = klineData;

        const newCandle = {
            x: parseInt(openTime),
            o: parseFloat(open),
            h: parseFloat(high),
            l: parseFloat(low),
            c: parseFloat(close),
            v: parseFloat(volume),
            isLive: !isClosed
        };

        if (this.chartData.length > 0) {
            const lastCandle = this.chartData[this.chartData.length - 1];
            
            if (lastCandle.x === newCandle.x) {
                // Update the existing candle (same time period)
                this.chartData[this.chartData.length - 1] = newCandle;
                console.log('🔄 Updated live candle:', newCandle.c);
            } else if (newCandle.x > lastCandle.x) {
                // New candle period started
                console.log('✨ New candle started! Clearing live trades...');
                
                // Save current candle's live trades to permanent storage
                if (this.currentCandleTrades.length > 0) {
                    this.tradesData[lastCandle.x] = [...this.currentCandleTrades];
                    console.log(`💾 Saved ${this.currentCandleTrades.length} trades for closed candle`);
                }
                
                // Clear live trades for new candle
                this.currentCandleTrades = [];
                
                // Add the new candle
                this.chartData.push(newCandle);
                console.log('✨ Added new live candle:', newCandle.c);
                
                // If this is a new candle on short timeframes, fetch trade data for the previous candle
                if (['1m', '5m', '15m', '1h'].includes(this.currentInterval) && isClosed) {
                    this.fetchTradeDataForCandle(lastCandle.x);
                }
            }

            // Only update if we're showing the latest data (not scrolled back in history)
            const isShowingLatest = this.visibleStartIndex + this.visibleCount >= this.chartData.length;
            
            if (isShowingLatest) {
                // Auto-scroll to keep showing the latest data
                this.visibleStartIndex = Math.max(0, this.chartData.length - this.visibleCount);
                this.updateVisibleChart();
            }
            
            this.updatePriceInfo();
            this.updateRealtimePriceInfo(newCandle);
        }
    }

    handleRealtimeTrade(tradeData) {
        // Handle live trade data from aggTrade stream
        const {
            p: price,
            q: quantity,
            T: tradeTime,
            m: isBuyerMaker // true = sell, false = buy
        } = tradeData;

        const trade = {
            price: parseFloat(price),
            quantity: parseFloat(quantity),
            time: parseInt(tradeTime),
            isBuyerMaker: isBuyerMaker,
            isBuy: !isBuyerMaker
        };

        // Add to current candle's live trades
        this.currentCandleTrades.push(trade);

        // Keep only recent trades (last 1000 to prevent memory issues)
        if (this.currentCandleTrades.length > 1000) {
            this.currentCandleTrades.shift();
        }

        // Update the chart to show new trade bubble (throttled for performance)
        if (this.showTrades && ['1m', '5m', '15m', '1h'].includes(this.currentInterval)) {
            // Throttle updates to every 50ms (was 200ms - now 4x faster!)
            if (!this.tradeUpdateTimeout) {
                this.tradeUpdateTimeout = setTimeout(() => {
                    this.tradeUpdateTimeout = null;
                    
                    // Add live trades to the last candle
                    if (this.chartData.length > 0) {
                        const currentCandleTime = this.chartData[this.chartData.length - 1].x;
                        this.tradesData[currentCandleTime] = [...this.currentCandleTrades];
                        
                        // Rebuild footprint data immediately if in footprint mode
                        if (this.footprintMode) {
                            this.buildFootprintData(currentCandleTime);
                        }
                    }
                    
                    // Update chart if showing latest data
                    const isShowingLatest = this.visibleStartIndex + this.visibleCount >= this.chartData.length;
                    if (isShowingLatest && this.chart) {
                        this.chart.update('none');
                    }
                }, 50); // Reduced from 200ms to 50ms for faster updates
            }
        }
    }

    updateConnectionStatus(isConnected) {
        const statusIndicator = document.getElementById('current-price');
        if (isConnected) {
            statusIndicator.style.borderLeft = '3px solid #26a69a';
        } else {
            statusIndicator.style.borderLeft = '3px solid #ef5350';
        }
    }

    updateRealtimePriceInfo(candle) {
        // Update with live data
        document.getElementById('current-price').textContent = `$${candle.c.toFixed(candle.c < 1 ? 6 : 2)}`;
        
        if (this.chartData.length > 1) {
            const prevCandle = this.chartData[this.chartData.length - 2];
            const change = candle.c - prevCandle.c;
            const changePercent = ((change / prevCandle.c) * 100).toFixed(2);
            
            const priceChange = document.getElementById('price-change');
            priceChange.textContent = `${change >= 0 ? '+' : ''}$${change.toFixed(candle.c < 1 ? 6 : 2)} (${changePercent}%)`;
            priceChange.className = change >= 0 ? 'positive' : 'negative';
        }

        document.getElementById('volume').textContent = `Volume: ${candle.v.toFixed(2)}`;
        
        // Add live indicator
        if (candle.isLive) {
            document.getElementById('volume').textContent += ' 🔴 LIVE';
        }
    }

    disconnectWebSocket() {
        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
            console.log('🔌 WebSocket disconnected manually');
        }
    }

    startPolling() {
        // Stop any existing polling
        this.stopPolling();
        
        // Poll for updates every 10 seconds for short timeframes
        const pollInterval = this.currentInterval === '1m' ? 5000 : 10000;
        
        this.pollingInterval = setInterval(async () => {
            try {
                // Fetch the latest candle
                const latestData = await this.fetchBinanceData(this.currentSymbol, this.currentInterval, 1);
                
                if (latestData && latestData.length > 0 && this.chartData.length > 0) {
                    const newCandle = latestData[0];
                    const lastCandle = this.chartData[this.chartData.length - 1];
                    
                    if (newCandle.x === lastCandle.x) {
                        // Update existing candle
                        this.chartData[this.chartData.length - 1] = {
                            ...newCandle,
                            isLive: true
                        };
                        console.log('🔄 Polling: Updated candle');
                    } else if (newCandle.x > lastCandle.x) {
                        // New candle started
                        this.chartData.push({
                            ...newCandle,
                            isLive: true
                        });
                        console.log('✨ Polling: New candle added');
                        
                        // Fetch trades for the closed candle
                        if (['1m', '5m', '15m', '1h'].includes(this.currentInterval)) {
                            this.fetchTradeDataForCandle(lastCandle.x);
                        }
                    }
                    
                    // Update the chart
                    const isShowingLatest = this.visibleStartIndex + this.visibleCount >= this.chartData.length;
                    if (isShowingLatest) {
                        this.visibleStartIndex = Math.max(0, this.chartData.length - this.visibleCount);
                        this.updateVisibleChart();
                    }
                    
                    this.updatePriceInfo();
                }
            } catch (error) {
                console.error('Polling error:', error);
            }
        }, pollInterval);
        
        console.log(`📊 Started polling every ${pollInterval/1000} seconds`);
    }

    stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
            console.log('⏸️ Stopped polling');
        }
    }

    zoom(factor) {
        const currentZoom = this.chart.getZoomLevel();
        this.chart.zoom(factor);
    }

    updateChart() {
        if (!this.chart || this.chartData.length === 0) return;

        console.log('Updating chart with', this.chartData.length, 'candles');

        // Reset to show the latest data (rightmost)
        this.visibleStartIndex = Math.max(0, this.chartData.length - this.visibleCount);
        
        // Update visible chart
        this.updateVisibleChart();
        
        // Update chart label
        this.chart.data.datasets[0].label = `${this.currentSymbol} ${this.currentInterval}`;
    }

    updatePriceInfo() {
        if (this.chartData.length === 0) return;

        const latest = this.chartData[this.chartData.length - 1];
        const previous = this.chartData[this.chartData.length - 2];

        document.getElementById('current-price').textContent = `$${latest.c.toFixed(2)}`;

        if (previous) {
            const change = latest.c - previous.c;
            const changePercent = ((change / previous.c) * 100).toFixed(2);
            
            const priceChange = document.getElementById('price-change');
            priceChange.textContent = `${change >= 0 ? '+' : ''}$${change.toFixed(2)} (${changePercent}%)`;
            priceChange.className = change >= 0 ? 'positive' : 'negative';
        }

        document.getElementById('volume').textContent = `Volume: ${latest.v.toFixed(2)}`;
    }
}

// Test API connectivity on page load
async function testAPI() {
    console.log('🔍 Testing API connectivity...');
    
    try {
        // Test Binance ping
        const response = await fetch('https://api.binance.com/api/v3/ping');
        if (response.ok) {
            console.log('✅ Binance API is reachable');
        } else {
            console.log('❌ Binance API ping failed');
        }
    } catch (error) {
        console.log('❌ Binance API connection blocked (CORS):', error.message);
    }
    
    try {
        // Test a simple klines call
        const response = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=5');
        if (response.ok) {
            const data = await response.json();
            console.log('✅ Direct Binance API works! Sample data:', data[0]);
        } else {
            console.log('❌ Binance klines API failed');
        }
    } catch (error) {
        console.log('❌ Binance klines blocked (CORS):', error.message);
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM ready, testing APIs and creating chart...');
    
    // Test API first
    await testAPI();
    
    // Create chart
    new WorkingCandlestickChart();
});