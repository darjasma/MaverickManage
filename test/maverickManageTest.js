const {expect, assert} = require("chai")
const {loadFixture} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const helpers = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const {ethers} = require("hardhat");
const {LiFi} = require("@lifi/sdk");

const lifi = new LiFi({
    integrator: "maverickManage"
})

const forkingUrl = require('../hardhat.config').networks.hardhat.forking.url;
const wETHTokenAddress = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const wETHTokenABI = require("../scripts/ABIs/wETH.json");
const IERC20ABI = require('../scripts/ABIs/IERC20.json');
const veMAVTokenABI = require('../scripts/ABIs/veMAV.json')
const IPoolABI = require('../scripts/ABIs/IPool.json')
const IMaverickRouterABI = require('../scripts/ABIs/IRouter.json')
const IMaverickRewardABI = require('../scripts/ABIs/IMaverickReward.json')
const IPositionInspectorABI = require('../scripts/ABIs/IPositionInspectorABI.json')
const veMAVTokenAddress = '0x4949Ac21d5b2A0cCd303C20425eeb29DCcba66D8';
const MAVTokenAddress = '0x7448c7456a97769F6cD04F1E83A4a23cCdC46aBD';
const maverickRouterAddress = '0xbBF1EE38152E9D8e3470Dc47947eAa65DcA94913';


const getQuote = async (fromChain, toChain, fromToken, toToken, fromAmount, fromAddress, toAddress) => {
    const routeOptions = {
        slippage: 10 / 100
    }
    const RoutesRequest = {
        fromChain: fromChain,
        fromToken: fromToken,
        fromAmount: fromAmount,
        fromAddress: fromAddress,
        toChain: toChain,
        toToken: toToken,
        toAddress: toAddress,
    }
    const result = await lifi.getQuote(RoutesRequest, routeOptions)
    return result.transactionRequest.data;
}


async function deployMaverickManageFixture() {
    const [addr1, addr2] = await ethers.getSigners();
    const swapHelperFactory = await ethers.getContractFactory("SwapHelper");
    const swapHelperInstance = await swapHelperFactory.deploy();
    await swapHelperInstance.waitForDeployment();
    const maverickManageFactory = await ethers.getContractFactory("maverickManage");
    const maverickManage = await maverickManageFactory.deploy('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', addr1);
    await maverickManage.waitForDeployment();
    return {addr1, addr2, maverickManage};
}

describe("maverickManage test for deposit(stake) and withdraw(unstake) Mav/veMav", function(){
    it("is able to deposit 100MAV and withdraw it after it's duration", async()=>{
        // load fixture
        const {addr1, addr2, maverickManage} = await loadFixture(deployMaverickManageFixture);
        const maverickManageAddress = await maverickManage.getAddress();
        //supply wETH
        const wETH = await ethers.getContractAt(wETHTokenABI, wETHTokenAddress);
        await expect(
            wETH.connect(addr1).deposit({value: ethers.parseEther('1')})
        ).to.changeTokenBalance(
            wETH, addr1, ethers.parseUnits('1')
        )
        await wETH.connect(addr1).transfer(maverickManage, ethers.parseEther('1'));
        //deposit wETH on maverickManage and increase the veMAV balance of the contract
        const depositDuration = 20*24*60*60; //20 days(min is one week)
        const doDelegation = false;
        let swapData = await getQuote('ETH', 'ETH', 'WETH', 'MAV',
            ethers.parseEther('0.1'), await maverickManage.getAddress(),await maverickManage.getAddress());
        let swapSendsEth = [false];
        let swapsData = ['0x'+swapData.slice(10)];
        let swapSendingTokens = [wETHTokenAddress];
        await maverickManage.connect(addr1).swap(swapSendsEth, swapSendingTokens, swapsData);
        const veMAV = await ethers.getContractAt(IERC20ABI, veMAVTokenAddress);
        const veMAVBalanceBeforeDeposit = await veMAV.balanceOf(maverickManage);
        await maverickManage.connect(addr1).deposit(depositDuration, doDelegation, BigInt(100e18))
        const veMAVBalanceAfterDeposit = await veMAV.balanceOf(maverickManage);
        expect(veMAVBalanceAfterDeposit-veMAVBalanceBeforeDeposit).to.be.above(BigInt(90e18));
        //withdraw
        const MAV = await ethers.getContractAt(IERC20ABI, MAVTokenAddress);
        await helpers.time.increase(depositDuration+3600);
        await expect(
            maverickManage.connect(addr1).withdraw(0)
        ).to.changeTokenBalance(MAV, maverickManage, BigInt(100e18));
        swapSendsEth = [false];
        swapData = await getQuote('ETH', 'ETH', 'MAV', 'WETH',
            BigInt(100e18),await maverickManage.getAddress(), await maverickManage.getAddress());
        swapsData = ['0x'+swapData.slice(10)];
        swapSendingTokens = [MAVTokenAddress];
        await expect(maverickManage.connect(addr1).swap(swapSendsEth, swapSendingTokens, swapsData)).to
            .changeTokenBalance(MAV, maverickManage, BigInt(-100e18));
    }).timeout(200e3)
})
describe("maverickManage test for addLiquidity to pools and removing from them", function () {
    it("is able to addLiquidity to an erc20-erc20 pool and remove a part of it", async () => {
        const {addr1, addr2, maverickManage} = await deployMaverickManageFixture();
        //supply WETH
        const wETH = await ethers.getContractAt(wETHTokenABI, wETHTokenAddress);
        let wETHSupplyAmount = ethers.parseEther('2');
        await wETH.connect(addr1).deposit({value: wETHSupplyAmount})
        await wETH.connect(addr1).approve(maverickManage, wETHSupplyAmount);
        expect(await maverickManage.connect(addr1).sendUtil(wETHSupplyAmount)).to.changeTokenBalances(
            wETH,[addr1, maverickManage], [-wETHSupplyAmount, wETHSupplyAmount])
        //addLiquidity parameters
        let poolAddress = '0x53dc703B78794b61281812f3a901918253BeeFee'; //dai-usdc
        let tokenId = 0;
        let params = [[1, 0, true, ethers.parseUnits('100', 18), ethers.parseUnits('100', 6)]];
        let minTokenAAmount = 0;
        let minTokenBAmount = 0;
        let deadline = (await ethers.provider.getBlock('latest')).timestamp+3600;
        const daiAddress = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
        const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
        let swapDataA = await getQuote('ETH', 'ETH', 'WETH',daiAddress, ethers.parseEther('1'), await maverickManage.getAddress(),await  maverickManage.getAddress());
        let swapDataB = await getQuote('ETH', 'ETH', 'WETH',usdcAddress, ethers.parseEther('1'), await maverickManage.getAddress(), await maverickManage.getAddress());
        const positionInspector = await ethers.getContractAt(IPositionInspectorABI, '0x456A37144162900799f405be34f815dE7C3DA53C');
        const pool = await ethers.getContractAt(IPoolABI, poolAddress);
        const wethBeforeAddLiquidity = await wETH.balanceOf(maverickManage);
        let swapSendsEth = [false, false];
        let swapData = ['0x'+swapDataA.slice(10), '0x'+swapDataB.slice(10)];
        let swapSendingTokens = [wETHTokenAddress, wETHTokenAddress];
        await maverickManage.connect(addr1).swap(swapSendsEth, swapSendingTokens, swapData);
        await maverickManage.connect(addr1).addLiquidity(
            poolAddress, tokenId, params, minTokenAAmount, minTokenBAmount, deadline
        )
        let filter = maverickManage.filters.AddLiquidity
        let events = await maverickManage.queryFilter(filter, -1)
        let binId;
        tokenId = events[0].args.receivingTokenId;
        binId = events[0].args.binDeltas[0][3];
        let firstReserve, secondReserve;
        firstReserve = await positionInspector.addressBinReservesAllKindsAllTokenIds(maverickManage, pool);
        const wethAfterAddLiquidity = await wETH.balanceOf(maverickManage);
        await maverickManage.connect(addr1).removeLiquidity(
            poolAddress,
            await addr1.getAddress(),
            tokenId,
            [{binId: binId, amount:ethers.parseUnits('70', 18)}],
            0,
            0,
            BigInt(1e20),
        )
        swapDataA = await getQuote('ETH', 'ETH',daiAddress, 'WETH', BigInt(30e18), await maverickManage.getAddress(),await  maverickManage.getAddress());
        swapDataB = await getQuote('ETH', 'ETH', usdcAddress,'WETH', BigInt(30e6), await maverickManage.getAddress(),await  maverickManage.getAddress());
        swapSendsEth = [false, false];
        swapData = ['0x'+swapDataA.slice(10), '0x'+swapDataB.slice(10)];
        swapSendingTokens = [daiAddress, usdcAddress]
        await maverickManage.connect(addr1).swap(swapSendsEth, swapSendingTokens, swapData)
        const wethAfterRemoveLiquidity = await wETH.balanceOf(maverickManage);
        secondReserve = await positionInspector.addressBinReservesAllKindsAllTokenIds(maverickManage, pool);
        expect(firstReserve[1]-secondReserve[1]).to.be.greaterThan(BigInt(5e6));
        expect(firstReserve[0]-secondReserve[0]).to.be.greaterThan(0);
        expect(wethBeforeAddLiquidity-wethAfterAddLiquidity).equals(BigInt(2e18));
        expect(wethAfterRemoveLiquidity-wethAfterAddLiquidity).to.be.greaterThan(0);
        const contractBalanceBeforeWithdrawal = await wETH.balanceOf(maverickManage);
        expect(
            await maverickManage.connect(addr1).receiveUtil(contractBalanceBeforeWithdrawal)
        )
        const contractBalanceAfterWithdrawal = await wETH.balanceOf(maverickManage);
        expect(contractBalanceBeforeWithdrawal-contractBalanceAfterWithdrawal).equals(contractBalanceBeforeWithdrawal);
    }).timeout(2000 * 1000)
    it('is able to addLiquidity to eth-erc20 pool and remove a part of it', async()=>{
        const {addr1, addr2, maverickManage} = await loadFixture(deployMaverickManageFixture);
        //supply WETH
        const wETH = await ethers.getContractAt(wETHTokenABI, wETHTokenAddress);
        let wETHSupplyAmount = ethers.parseEther('5');
        await wETH.connect(addr1).deposit({value: wETHSupplyAmount})
        await wETH.connect(addr1).approve(maverickManage, wETHSupplyAmount);
        expect(await maverickManage.connect(addr1).sendUtil(wETHSupplyAmount)).to.changeTokenBalances(
            wETH,[addr1, maverickManage], [-wETHSupplyAmount, wETHSupplyAmount])
        //addLiquidity parameters
        let poolAddress = '0x7e3f8a54f93471BFbD37641B230920fa1c8B27C3'; //mav-eth
        let tokenId = 0;
        let params = [[1, 0, true, BigInt(1e18), BigInt(0.000887357578149888e18)]];
        let minTokenAAmount = 0;
        let minTokenBAmount = 0;
        let deadline = (await ethers.provider.getBlock('latest')).timestamp+3600;
        const wethBeforeAddLiquidity = await wETH.balanceOf(maverickManage);
        let swapDataB = await getQuote('ETH', 'ETH', 'WETH','MAV', ethers.parseEther('0.01'), await maverickManage.getAddress(), await maverickManage.getAddress());
        let swapSendsEth = [false];
        let swapData = ['0x'+swapDataB.slice(10)];
        let swapSendingTokens = [wETHTokenAddress]
        await maverickManage.connect(addr1).swap(swapSendsEth, swapSendingTokens, swapData);
        await maverickManage.connect(addr1).addLiquidity(
            poolAddress, tokenId, params, minTokenAAmount, minTokenBAmount, deadline
        )
        const wethAfterAddLiquidity = await wETH.balanceOf(maverickManage);
        const pool = await ethers.getContractAt(IPoolABI, poolAddress);
        let firstReserve, secondReserve;
        const positionInspector = await ethers.getContractAt(IPositionInspectorABI, '0x456A37144162900799f405be34f815dE7C3DA53C');
        firstReserve = await positionInspector.addressBinReservesAllKindsAllTokenIds(maverickManage, pool);
        let filter = maverickManage.filters.AddLiquidity
        let events = await maverickManage.queryFilter(filter, -1)
        let binId;
        tokenId = events[0].args.receivingTokenId;
        binId = events[0].args.binDeltas[0][3];
        await maverickManage.connect(addr1).removeLiquidity(
            poolAddress,
            await addr1.getAddress(),
            tokenId,
            [{binId: binId, amount:ethers.parseUnits('0.0008', 18)}],
            0,
            0,
            BigInt(1e20)
        )
        let swapDataA = await getQuote('ETH', 'ETH', 'MAV','WETH', ethers.parseEther('0.00002'), await maverickManage.getAddress(), await maverickManage.getAddress());
        swapData = ['0x'+swapDataA.slice(10)]
        swapSendsEth = [false];
        swapSendingTokens = [MAVTokenAddress];
        await maverickManage.connect(addr1).swap(swapSendsEth, swapSendingTokens, swapData);
        const wethAfterRemoveLiquidity = await wETH.balanceOf(maverickManage);
        secondReserve = await positionInspector.addressBinReservesAllKindsAllTokenIds(maverickManage, pool);
        expect(firstReserve[1]-secondReserve[1]).to.be.greaterThan(0);
        expect(firstReserve[0]-secondReserve[0]).to.equal(BigInt(0.000800000000000001e18));
        expect(wethBeforeAddLiquidity-wethAfterAddLiquidity).within(BigInt(0.010e18), BigInt(1e18))
        expect(wethAfterRemoveLiquidity-wethAfterAddLiquidity).within(BigInt(0.0000000005e18),BigInt(0.00000051e18))
        const contractBalanceBeforeWithdrawal = await wETH.balanceOf(maverickManage);
        await maverickManage.connect(addr1).receiveUtil(contractBalanceBeforeWithdrawal)
        const contractBalanceAfterWithdrawal = await wETH.balanceOf(maverickManage);
        expect(contractBalanceBeforeWithdrawal-contractBalanceAfterWithdrawal).equals(contractBalanceBeforeWithdrawal);
    })
    it('is able to addLiquidity to boosted erc20-erc20 pool and remove a part of it', async () => {
        const {addr1, addr2, maverickManage} = await loadFixture(deployMaverickManageFixture);
        //supply WETH
        const wETH = await ethers.getContractAt(wETHTokenABI, wETHTokenAddress);
        let wETHSupplyAmount = ethers.parseEther('10');
        await wETH.connect(addr1).deposit({value: wETHSupplyAmount})
        await wETH.connect(addr1).approve(maverickManage, wETHSupplyAmount);
        expect(await maverickManage.connect(addr1).sendUtil(wETHSupplyAmount)).to.changeTokenBalances(
            wETH,[addr1, maverickManage], [-wETHSupplyAmount, wETHSupplyAmount])
        //addLiquidity parameters
        let poolAddress = '0x050EbE3dbB4B3a3526735B04Cc3D96C80609ee7E'; //gho-usdc
        let tokenId = 0;
        let params = [[1, tokenId, true, ethers.parseUnits('4000', 18), ethers.parseUnits('4000', 6)]];
        let minTokenAAmount = 0;
        let minTokenBAmount = 0;
        const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
        const ghoAddress = '0x40D16FC0246aD3160Ccc09B8D0D3A2cD28aE6C2f';
        let deadline = (await ethers.provider.getBlock('latest')).timestamp+3600;
        let swapDataA = await getQuote('ETH', 'ETH', 'WETH', ghoAddress, ethers.parseEther('3'), await maverickManage.getAddress(), await maverickManage.getAddress());
        let swapDataB = await getQuote('ETH', 'ETH', 'WETH', usdcAddress, ethers.parseEther('3'), await maverickManage.getAddress(), await maverickManage.getAddress());
        const wethBeforeAddLiquidity = await wETH.balanceOf(maverickManage);
        let swapSendsEth = [false, false];
        let swapData = ['0x'+swapDataA.slice(10), '0x'+swapDataB.slice(10)];
        let swapSendingTokens = [wETHTokenAddress, wETHTokenAddress];
        await maverickManage.connect(addr1).swap(swapSendsEth, swapSendingTokens, swapData);
        await maverickManage.connect(addr1).addLiquidity(
            poolAddress,
            tokenId,
            params,
            minTokenAAmount,
            minTokenBAmount,
            deadline
        )
        const wethAfterAddLiquidity = await wETH.balanceOf(maverickManage);
        const pool = await ethers.getContractAt(IPoolABI, poolAddress);
        const positionInspector = await ethers.getContractAt(IPositionInspectorABI, '0x456A37144162900799f405be34f815dE7C3DA53C');
        let firstReserve, secondReserve;
        firstReserve = await positionInspector.addressBinReservesAllKindsAllTokenIds(maverickManage, pool);
        let filter = maverickManage.filters.AddLiquidity
        let events = await maverickManage.queryFilter(filter, -1)
        let binId;

        tokenId = events[0].args.receivingTokenId;
        binId = events[0].args.binDeltas[0][3];
        await maverickManage.connect(addr1).claimBoostedPositionRewards(
            '0x3bF6412b7e8A4DF2795B5ac3a6283262Fec1FEc1'
        )
        await maverickManage.connect(addr1).removeLiquidity(
            poolAddress,
            await addr1.getAddress(),
            tokenId,
            [{binId: binId, amount: ethers.parseUnits('100', 18)}],
            0,
            0,
            BigInt(1e20)
        )
        swapDataA = await getQuote('ETH', 'ETH', ghoAddress, 'WETH', ethers.parseUnits('10', 18), await maverickManage.getAddress(), await maverickManage.getAddress());
        swapDataB = await getQuote('ETH', 'ETH', usdcAddress, 'WETH', ethers.parseUnits('10', 6), await maverickManage.getAddress(), await maverickManage.getAddress())
        swapSendsEth = [false, false];
        swapData = ['0x'+swapDataA.slice(10), '0x'+swapDataB.slice(10)];
        swapSendingTokens = [ghoAddress, usdcAddress];
        await maverickManage.connect(addr1).swap(swapSendsEth, swapSendingTokens, swapData);
        const wethAfterRemoveLiquidity = await wETH.balanceOf(maverickManage);
        secondReserve = await positionInspector.addressBinReservesAllKindsAllTokenIds(maverickManage, pool);
        expect(firstReserve[1]-secondReserve[1]).to.be.greaterThan(0);
        expect(firstReserve[0]-secondReserve[0]).to.be.greaterThan(0);
        expect(wethBeforeAddLiquidity-wethAfterAddLiquidity).equals(BigInt(6e18))
        expect(wethAfterRemoveLiquidity-wethAfterAddLiquidity).to.be.greaterThan(0)
        const contractBalanceBeforeWithdrawal = await wETH.balanceOf(maverickManage);
        expect(
            await maverickManage.connect(addr1).receiveUtil(contractBalanceBeforeWithdrawal)
        )
        const contractBalanceAfterWithdrawal = await wETH.balanceOf(maverickManage);
        expect(contractBalanceBeforeWithdrawal-contractBalanceAfterWithdrawal).equals(contractBalanceBeforeWithdrawal);
    });
    it('is able to addLiquidity to a boosted erc20-eth pool, swap on it so the fee rewards get added to the position', async()=>{
        //init
        const {addr1, addr2, maverickManage} = await loadFixture(deployMaverickManageFixture);
        let maverickManageAddress = await maverickManage.getAddress()
        let swapDataA = await getQuote('ETH', 'ETH', 'WETH', 'wstETH',
            ethers.parseEther('1'), maverickManageAddress, maverickManageAddress)
        let swapDataAFirstSwap = await getQuote('ETH', 'ETH', 'WETH', 'wstETH',
            ethers.parseEther('1'), maverickManageAddress, await addr1.getAddress())
        const positionInspector = await ethers.getContractAt(IPositionInspectorABI, '0x456A37144162900799f405be34f815dE7C3DA53C');
        const wETH = await ethers.getContractAt(wETHTokenABI, wETHTokenAddress);
        const maverickRouter = await ethers.getContractAt(IMaverickRouterABI, maverickRouterAddress)
        let poolAddress = '0x0eB1C92f9f5EC9D817968AfDdB4B46c564cdeDBe'; //wstETH-ETH
        let wstETHAddress = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0'
        let rewardAddress = '0x78Af919881dc219aFbDD39Ecb7A7b9F840C61797'
        let wstETH = await ethers.getContractAt(IERC20ABI, wstETHAddress)
        let reward = await ethers.getContractAt(IMaverickRewardABI, rewardAddress)
        async function balances(address){
            let eth = await ethers.provider.getBalance(address);
            let weth = await wETH.balanceOf(address);
            let wsteth = await wstETH.balanceOf(address)
            return {eth: eth, weth: weth, wsteh: wsteth}
        }
        //Supply Weth
        const wETHSupplyAmount = ethers.parseEther('5');
        await expect(wETH.connect(addr1).deposit({value: wETHSupplyAmount})).to.changeTokenBalance(
            wETH, addr1, wETHSupplyAmount
        );
        await wETH.connect(addr1).approve(maverickManage, wETHSupplyAmount);
        expect(await maverickManage.connect(addr1).sendUtil(wETHSupplyAmount)).to.changeTokenBalances(
            wETH,[addr1, maverickManage], [-wETHSupplyAmount, wETHSupplyAmount])
        //addLiquidity
        let tokenId = 0, kind = 1, isDelta = true, minTokenAAMount = 0, minTokenBAMount = 0;
        let deltaA = ethers.parseEther('0.5'), deltaB = ethers.parseEther('0.5');
        let params = [[kind, tokenId, isDelta, deltaA, deltaB]]
        let deadline = (await ethers.provider.getBlock('latest')).timestamp+3600;
        let swapSendsEth = [false];
        let swapData = ['0x'+swapDataA.slice(10)];
        let swapSendingTokens = [wETHTokenAddress];
        await maverickManage.connect(addr1).swap(swapSendsEth, swapSendingTokens, swapData);
        await maverickManage.connect(addr1).addLiquidity(
            poolAddress,
            tokenId,
            params,
            minTokenAAMount,
            minTokenBAMount,
            deadline
        )
        const afterAddLiquidityReserve = await positionInspector.addressBinReservesAllKindsAllTokenIds(maverickManage, poolAddress)
        expect(afterAddLiquidityReserve[0]).within(BigInt(0), BigInt(5e18));
        expect(afterAddLiquidityReserve[1]).within(BigInt(0), BigInt(5e18));
        // Making some swaps on the position
        const wstETHSwapAmount = ethers.parseEther('0.1')
        await wstETH.connect(addr1).approve(maverickRouter, wstETHSwapAmount);
        let beforeFirstSwapBalances = await balances(addr1)
        swapSendsEth = [false];
        swapData = ['0x'+swapDataAFirstSwap.slice(10)];
        swapSendingTokens = [wETHTokenAddress];
        await maverickManage.connect(addr1).swap(swapSendsEth, swapSendingTokens, swapData);
        await expect(maverickRouter.connect(addr1).exactInputSingle(
            [
                wstETHAddress,
                wETHTokenAddress,
                poolAddress,
                addr1,
                deadline,
                wstETHSwapAmount,
                0, //minAIn
                0, //minBIn
            ]
        )).to.changeTokenBalance(wstETH, addr1, -wstETHSwapAmount)
        let afterFirstSwapBalances = await balances(addr1)
        expect(afterFirstSwapBalances.weth-beforeFirstSwapBalances.weth).within(BigInt(1), BigInt(1e18))
        await maverickRouter.connect(addr1).exactInputSingle(
            [
                wETHTokenAddress,
                wstETHAddress,
                poolAddress,
                addr1,
                deadline,
                wstETHSwapAmount,
                0, //minAIn
                0, //minBIn
            ],
            {value: wstETHSwapAmount}
        )
        let afterSecondSwapBalances = await balances(addr1)
        expect(afterFirstSwapBalances.eth-afterSecondSwapBalances.eth).be.within(wstETHSwapAmount, wstETHSwapAmount+BigInt(1e18));
        expect(afterSecondSwapBalances.wsteh-afterFirstSwapBalances.wsteh).within(BigInt(1), BigInt(1e18))
        let afterSecondSwapReserve = await positionInspector.addressBinReservesAllKindsAllTokenIds(
            maverickManage,
            poolAddress
        )
        let rewardContract = '0x78Af919881dc219aFbDD39Ecb7A7b9F840C61797'
        await maverickManage.connect(addr1).claimBoostedPositionRewards(
            rewardContract
        )
        expect(Math.abs(Number(afterSecondSwapReserve[0]-afterAddLiquidityReserve[0]))).be.greaterThan(0)
        expect(Math.abs(Number(afterSecondSwapReserve[1]-afterAddLiquidityReserve[1]))).be.greaterThan(0)
        const contractBalanceBeforeWithdrawal = await balances(maverickManage);
        await maverickManage.connect(addr1).receiveUtil(contractBalanceBeforeWithdrawal.weth)
        const contractBalanceAfterWithdrawal = await balances(maverickManage);
        expect(contractBalanceBeforeWithdrawal.weth-contractBalanceAfterWithdrawal.weth).equals(contractBalanceBeforeWithdrawal.weth);
    }).timeout(200*1e3)
})

describe("maverickManage security test", function(){
    it('is able to reverts when the caller doesn\'t have the the proper role', async()=>{
        const {addr1, addr2, maverickManage} = await deployMaverickManageFixture();
        await expect(maverickManage.connect(addr2).sendUtil(100)).to.be.revertedWithCustomError(
            maverickManage,
            `AccessControlUnauthorizedAccount`
        );
        await expect(maverickManage.connect(addr2).receiveUtil(100)).to.be.revertedWithCustomError(
            maverickManage,
            `AccessControlUnauthorizedAccount`
        );
    });
});

describe("maverickManage read methods test", function(){
    it("is able to getTVL and revert when PriceFeed is not added", async()=>{
        const {addr1, addr2, maverickManage} = await loadFixture(deployMaverickManageFixture);
        const maverickManageAddress = await maverickManage.getAddress();
        //supply WETH
        const wETH = await ethers.getContractAt(wETHTokenABI, wETHTokenAddress);
        let wETHSupplyAmount = ethers.parseEther('1.75');
        await wETH.connect(addr1).deposit({value: wETHSupplyAmount})
        await wETH.connect(addr1).approve(maverickManage, wETHSupplyAmount);
        await maverickManage.connect(addr1).sendUtil(wETHSupplyAmount);
        expect(await maverickManage.getTVL()).equals(BigInt(1.75e18));
        const factory = "0x1F98431c8aD98523631AE4a59f267346ea31F984"
        const usdtAddress = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
        const usdt = await ethers.getContractAt(IERC20ABI, usdtAddress);
        const swapData1 = await getQuote('ETH','ETH','WETH', 'USDT',
            BigInt(0.1e18), maverickManageAddress, maverickManageAddress)
        await maverickManage.connect(addr1).swap([false], [wETHTokenAddress], ['0x'+swapData1.slice(10)])
        expect(await usdt.balanceOf(maverickManageAddress)).to.not.equal(0);
        await maverickManage.connect(addr1).addLiquidTokenTracker(usdtAddress);
        await expect(maverickManage.getTVL()).to.be.revertedWith("PriceFeed contract doesn't exist");
        await maverickManage.connect(addr1).addPriceFeed(factory, usdtAddress, 3000);
        expect(await maverickManage.getTVL()).to.be.within(BigInt(1.6e18), BigInt(1.9e18));
        //addLiquidity parameters
        let poolAddress = '0x53dc703B78794b61281812f3a901918253BeeFee'; //dai-usdc
        let tokenId = 0;
        let params = [[1, 0, true, ethers.parseUnits('100', 18), ethers.parseUnits('100', 6)]];
        let minTokenAAmount = 0;
        let minTokenBAmount = 0;
        let deadline = (await ethers.provider.getBlock('latest')).timestamp+3600;
        const daiAddress = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
        const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
        let swapData2 = await getQuote('ETH', 'ETH', 'WETH',daiAddress, ethers.parseEther('0.1'), await maverickManage.getAddress(),await  maverickManage.getAddress());
        let swapData3 = await getQuote('ETH', 'ETH', 'WETH',usdcAddress, ethers.parseEther('0.1'), await maverickManage.getAddress(), await maverickManage.getAddress());
        await maverickManage.connect(addr1).addLiquidTokenTracker(daiAddress)
        await maverickManage.connect(addr1).addLiquidTokenTracker(usdcAddress)
        await maverickManage.connect(addr1).addPoolTracker(poolAddress)
        await maverickManage.connect(addr1).addPriceFeed(factory, usdcAddress, 3000);
        await maverickManage.connect(addr1).addPriceFeed(factory, daiAddress, 3000);
        let swapSendsEth = [false, false];
        let swapData = ['0x'+swapData2.slice(10), '0x'+swapData3.slice(10)];
        let swapSendingTokens = [wETHTokenAddress, wETHTokenAddress];
        await maverickManage.connect(addr1).swap(swapSendsEth, swapSendingTokens, swapData);
        expect(await maverickManage.getTVL()).to.be.within(BigInt(1.6e18), BigInt(1.9e18));
        await maverickManage.connect(addr1).addLiquidity(
            poolAddress, tokenId, params, minTokenAAmount, minTokenBAmount, deadline
        )
        expect(await maverickManage.getTVL()).to.be.within(BigInt(1.6e18), BigInt(1.9e18));
        await maverickManage.connect(addr1).removeLiquidTokenTracker(daiAddress)
        await maverickManage.connect(addr1).removeLiquidTokenTracker(usdcAddress)
        await maverickManage.connect(addr1).removePoolTracker(poolAddress)
        await maverickManage.connect(addr1).removePriceFeed(usdcAddress);
        await maverickManage.connect(addr1).removePriceFeed(daiAddress);
        expect(await maverickManage.getTVL()).to.be.within(BigInt(1.4e18), BigInt(1.7e18));
    }).timeout(2000e3);
});
