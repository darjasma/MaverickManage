const {ethers} = require("hardhat")

async function main() {
    const maverickManageFactory = await ethers.getContractFactory("maverickManage")
    const maverickManage = await maverickManageFactory.deploy();
    await maverickManage.waitForDeployment();
    console.log(`Deployed maverickManage on ${await maverickManage.getAddress()}`)
}

main().then(()=>process.exit(0)).catch((error)=>{console.error(error);process.exit(0)})