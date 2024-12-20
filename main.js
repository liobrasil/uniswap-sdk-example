const JSBI = require('jsbi');
const { TickMath, v3Swap } = require('@uniswap/v3-sdk');
const { ethers } = require('ethers');

// Example TickDataProvider implementation
class ExampleTickDataProvider {
    constructor(ticks) {
        this.ticks = ticks;
    }

    async getTick(tick) {
        return {
            liquidityNet: this.ticks[tick]?.liquidityNet || '0',
            liquidityGross: this.ticks[tick]?.liquidityGross || '0'
        };
    }

    async nextInitializedTickWithinOneWord(tick, zeroForOne, tickSpacing) {
        // Simple implementation - find next initialized tick
        const step = zeroForOne ? -tickSpacing : tickSpacing;
        let nextTick = tick + step;
        
        while (nextTick >= TickMath.MIN_TICK && nextTick <= TickMath.MAX_TICK) {
            if (this.ticks[nextTick]) {
                return [nextTick, true];
            }
            nextTick += step;
        }
        
        return [zeroForOne ? TickMath.MIN_TICK : TickMath.MAX_TICK, false];
    }
}

async function computeQuote(amountIn, poolData) {
    // Convert inputs to JSBI
    const fee = JSBI.BigInt(poolData.fee);
    const sqrtPriceX96 = JSBI.BigInt(poolData.sqrtPriceX96);
    const tickCurrent = poolData.tickCurrent;
    const liquidity = JSBI.BigInt(poolData.liquidity);
    const tickSpacing = poolData.tickSpacing;
    const zeroForOne = poolData.zeroForOne;
    const amountSpecified = JSBI.BigInt(amountIn);

    // Create tick data provider with pool's initialized ticks
    const tickDataProvider = new ExampleTickDataProvider(poolData.ticks);

    try {
        const quote = await v3Swap(
            fee,
            sqrtPriceX96,
            tickCurrent,
            liquidity,
            tickSpacing,
            tickDataProvider,
            zeroForOne,
            amountSpecified
        );

        return {
            amountOut: JSBI.toNumber(JSBI.multiply(quote.amountCalculated, JSBI.BigInt(-1))),
            sqrtPriceAfter: JSBI.toNumber(quote.sqrtRatioX96),
            tickAfter: quote.tickCurrent,
            liquidityAfter: JSBI.toNumber(quote.liquidity)
        };
    } catch (error) {
        console.error('Quote computation failed:', error);
        throw error;
    }
}

// Pool and token addresses
const POOL_ADDRESS = '0x36696169C63e42cd08ce11f5deeBbCeBae652050';  // USDT/WBNB 0.05% pool

const POOL_ABI = [
    'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
    'function liquidity() external view returns (uint128)',
    'function tickSpacing() external view returns (int24)',
    'function fee() external view returns (uint24)',
    'function ticks(int24 tick) external view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)'
];

async function fetchPoolData(provider, poolAddress, zeroForOne, tickRange = 10) {
    const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);

    try {
        console.log('Fetching pool data...');

        // Fetch basic pool data
        const [fee, slot0Data, liquidity, tickSpacing] = await Promise.all([
            pool.fee(),
            pool.slot0(),
            pool.liquidity(),
            pool.tickSpacing()
        ]);

        const currentTick = slot0Data.tick;
        console.log('Current tick:', currentTick);
        console.log('Current liquidity:', liquidity.toString());
        console.log('Tick spacing:', tickSpacing);

        // Calculate tick range
        const startTick = Math.floor(currentTick / tickSpacing) * tickSpacing - (tickRange * tickSpacing);
        const endTick = Math.floor(currentTick / tickSpacing) * tickSpacing + (tickRange * tickSpacing);

        console.log(`Fetching ticks from ${startTick} to ${endTick}`);

        // Fetch initialized ticks
        const tickPromises = [];
        for (let tick = startTick; tick <= endTick; tick += tickSpacing) {
            tickPromises.push(
                pool.ticks(tick).then(tickData => ({
                    tick,
                    liquidityNet: tickData.liquidityNet.toString(),
                    initialized: tickData.initialized
                })).catch(() => null)
            );
        }

        const tickResults = await Promise.all(tickPromises);
        const initializedTicks = {};

        for (const tickData of tickResults) {
            if (tickData && tickData.initialized) {
                initializedTicks[tickData.tick] = {
                    liquidityNet: tickData.liquidityNet
                };
            }
        }

        return {
            fee: fee,
            sqrtPriceX96: slot0Data.sqrtPriceX96.toString(),
            tickCurrent: currentTick,
            liquidity: liquidity.toString(),
            tickSpacing: tickSpacing,
            zeroForOne,
            ticks: initializedTicks
        };
    } catch (error) {
        console.error('Error fetching pool data:', error);
        throw error;
    }
}

// Example usage
async function main() {

    let poolDataSmall, poolDataLarge;
    const poolAddress = POOL_ADDRESS;
    
    // Connect to BSC
    const provider = new ethers.providers.JsonRpcProvider('https://bsc-dataseed.binance.org/');
    
    try {
        // Fetch with different tick ranges
        console.log('Fetching pool data with 5 tick range...');
        poolDataSmall = await fetchPoolData(provider,poolAddress, true, 1);
        console.log('Pool data (small range):', JSON.stringify(poolDataSmall, null, 2));

        console.log('\nFetching pool data with 50 tick range...');
        poolDataLarge = await fetchPoolData(provider, poolAddress,true, 10);
        console.log('Pool data (large range):', JSON.stringify(poolDataLarge, null, 2));
    } catch (error) {
        console.error('Failed to fetch pool data:', error);
    }

    // const poolData = {
    //     fee: 3000, // 0.3%
    //     sqrtPriceX96: '1829744519839346889661884864', // Example sqrt price
    //     tickCurrent: -74959,
    //     liquidity: '3161000000',
    //     tickSpacing: 60,
    //     zeroForOne: true, // true if token0 -> token1, false if token1 -> token0
    //     ticks: {
    //         // Example initialized ticks with their liquidityNet
    //         '-74960': { liquidityNet: '1000000', liquidityGross: '1000000' },
    //         '-74900': { liquidityNet: '-500000', liquidityGross: '500000' },
    //         '-74840': { liquidityNet: '-500000', liquidityGross: '500000' }
    //     }
    // };

    // Compute quote for 1 (with 18 decimals)
    const amountIn = '1000000000000000000';
    
    try {
        const quoteSmall = await computeQuote(amountIn, poolDataSmall);
        const quoteLarge = await computeQuote(amountIn, poolDataLarge);
        console.log('Quote Small result:', quoteSmall);
        console.log('Quote Large result:', quoteLarge);
    } catch (error) {
        console.error('Failed to compute quote:', error);
    }
}

main().catch(console.error);