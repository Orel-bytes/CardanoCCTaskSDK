
const CoinSelection = require('./util/coinSelection');
const CCTxBuilder = require('./plutusTxBuilder');
const CCTxBuilderV2 = require('./plutusTxBuilderV2');
const NftCCTxBuilder = require('./plutusNftTxBuilder');
const MsgCCTxBuilder = require('./plutusMsgTxBuilder');
const UtxosManager = require('./utxosManager');


class PlutusTxService {

    constructor(chainConnector, scriptRefOwnerAddr, logger, bMainnet) {
        this.chainConnector = chainConnector;
        this.coinSelectionInst = new CoinSelection();
        this.scriptRefOwnerAddr = scriptRefOwnerAddr;
        this.logger = logger;
        this.bMainnet = bMainnet;
        this.bReConstructedTxBuilder = false;
        this.logger.debug("..PlutusTxService...", "...sdk instance has been created...", parseInt(new Date().getTime()));
    }

    async init() {
        /* Modify By NFT Program: 
            add nft tx builder object
        */
        this.utxosManagerObj = new UtxosManager(this.chainConnector,
            this.logger,
            this.bMainnet);
        let ret = await this.utxosManagerObj.init();
        if (false === ret) {
            return false;
        }

        /* Modify By NFT Program: 
            add nft tx builder object
        */
        this.nftCCTxBuilderObj = new NftCCTxBuilder(this.chainConnector,
            this.scriptRefOwnerAddr,
            this.utxosManagerObj,
            this.logger,
            this.bMainnet);
        
        ret = this.nftCCTxBuilderObj.init();
        if (false === ret) {
            return false;
        }

        if (this.bReConstructedTxBuilder) {
            this.ccTxBuilderObj = new CCTxBuilderV2(this.chainConnector,
                this.scriptRefOwnerAddr,
                this.utxosManagerObj,
                this.logger,
                this.bMainnet);
            
            ret = this.ccTxBuilderObj.init();
            if (false === ret) {
                return false;
            }

        } else {
            this.ccTxBuilderObj = new CCTxBuilder(this.chainConnector,
                this.coinSelectionInst,
                this.scriptRefOwnerAddr,
                this.logger,
                this.bMainnet);
            
            ret = this.ccTxBuilderObj.init();
            if (false === ret) {
                return false;
            }
        }

        this.msgCCTxBuilderObj = new MsgCCTxBuilder(this.chainConnector,
                this.coinSelectionInst,
                this.scriptRefOwnerAddr,
                this.logger,
                this.bMainnet);
        ret = this.msgCCTxBuilderObj.init();
        if (false === ret) {
            return false;
        }

        this.logger.debug("..PlutusTxService...", "...sdk instance has been initialied...", parseInt(new Date().getTime()));
        return true;
    }

    // to get cardano-side cross-chain locker address
    getLockerScAddress(bNftTask = false) {
        /* Modify By NFT Program: 
            add nft tx builder object
        */
        if (bNftTask) {
            return this.nftCCTxBuilderObj.getLockerScAddress();
        }

        return this.ccTxBuilderObj.getLockerScAddress();
    }

    // to get treasury group address
    getNFTRefHolderScript() {
        return this.nftCCTxBuilderObj.getNFTRefHolderScript();
    }

    // Part 1: cross-chain process
    // to build cross-chain tx
    async buildSignedTx(basicArgs, internalSignFunc, partialRedeemerArgs, bNftTask = false) {
        /* Modify By NFT Program: 
        need to add bNftCCTx? or add txType to justify?
        */
        if (bNftTask) {
            let ret = await this.nftCCTxBuilderObj.buildSignedTx(basicArgs, internalSignFunc, partialRedeemerArgs);
            return ret;
        }

        await this._hydrateCheckTokenUtxo(this.ccTxBuilderObj, basicArgs);
        let ret = await this.ccTxBuilderObj.buildSignedTx(basicArgs, internalSignFunc, partialRedeemerArgs);
        return ret;
    }

    async buildMsgSignedTx(basicArgs, internalSignFunc, partialRedeemerArgs){

        let ret = await this.msgCCTxBuilderObj.buildSignedTx(basicArgs, internalSignFunc, partialRedeemerArgs);
        return ret;
    }

    // Official token builder consumes basicArgs.checkTokenUtxo as a full UTXO object.
    // Agent only keeps {txHash, index}; resolve it against the check-script address before build.
    async _hydrateCheckTokenUtxo(builder, basicArgs) {
        const specified = basicArgs && basicArgs.checkTokenUtxo;
        if (!specified || specified.address != null) {
            return;
        }
        const wantHash = specified.txHash != null ? specified.txHash : specified.txId;
        if (wantHash == null || specified.index == null) {
            return;
        }
        const scriptCheckRefAddress = await builder.getTreasuryCheckAddress(!!basicArgs.bMint);
        const utxos = await builder.getUtxo(scriptCheckRefAddress, false);
        const hash = String(wantHash).toLowerCase();
        const index = Number(specified.index);
        let matched = undefined;
        for (let i = 0; i < utxos.length; i++) {
            if (String(utxos[i].txHash).toLowerCase() === hash && Number(utxos[i].index) === index) {
                matched = utxos[i];
                break;
            }
        }
        if (!matched) {
            throw "specified checkTokenUtxo not found: " + hash + "#" + index;
        }
        basicArgs.checkTokenUtxo = matched;
    }

    // to generate hash by redeem proof info
    genMsgRedeemProofHash(proofInfo) {

        let ret = this.msgCCTxBuilderObj.genRedeemProofHash(proofInfo);
        return ret;
    }

    // to generate hash by redeem proof info
    genRedeemProofHash(proofInfo, bNftTask = false) {
        /* Modify By NFT Program: 
            add nft tx builder object
        */
        if (bNftTask) {
            let ret = this.nftCCTxBuilderObj.genRedeemProofHash(proofInfo);
            return ret;
        }

        let ret = this.ccTxBuilderObj.genRedeemProofHash(proofInfo);
        return ret;
    }

    async convertSlotToTimestamp(slot) {
        return this.ccTxBuilderObj.convertSlotToTimestamp(slot);
    }

    // to generate hash by token redeem proof info
    genTokenRedeemProofHash(proofInfo, bNftTask = false) {
        /* Modify By NFT Program: 
            add nft tx builder object
        */
        if (bNftTask) {
            let ret = this.nftCCTxBuilderObj.genTokenRedeemProofHash(proofInfo);
            return ret;
        }

        let ret = this.ccTxBuilderObj.genTokenRedeemProofHash(proofInfo);
        return ret;
    }

    // Part 2: utxos balanced process
    // to mark asset type that needs balanced 
    async markPendingBalancedAsset(address, assetUnit, curSlot) {
        await this.ccTxBuilderObj.markBalancedAsset(address, assetUnit, curSlot);
        return;
    }

    // to build, sign and submit utxos-balanced tx 
    async tryUtxosBalanced(internalSignFunc, paymentInfo, address) {
        return await this.ccTxBuilderObj.tryUtxosBalanced(internalSignFunc, paymentInfo, address);
    }

    //  Part 3: manual process
    // to get&decode tx redeemers based on txInfo
    async getMsgRedeemerFromCBOR(txInfo) {
        if (undefined === txInfo.redeemers) {
            return undefined;
        }
        
        let redeemerData = await this.msgCCTxBuilderObj.deCodeTxRedeemersCbor(txInfo); 
        console.log("\n\n getMsgRedeemerFromCBOR: ", redeemerData);
        return redeemerData;
    }
    
    async getRedeemerFromCBOR(txInfo, bNftTask = false) {
        if (undefined === txInfo.redeemers) {
            return undefined;
        }

        /* Modify By NFT Program: 
            add nft tx builder object
        */
        if (bNftTask) {
            let redeemerData = await this.nftCCTxBuilderObj.deCodeTxRedeemersCbor(txInfo, false);
            console.log("\n\ngetRedeemerFromCBOR...nft: ", redeemerData);
            return redeemerData;
        }

        let redeemerData = undefined;
        if (this.bReConstructedTxBuilder) {
            redeemerData = await this.ccTxBuilderObj.deCodeTxRedeemersCbor(txInfo, false);
        } else {
            redeemerData = await this.ccTxBuilderObj.deCodeTxRedeemersCbor(txInfo);
        }


        console.log("\n\ngetRedeemerFromCBOR: ", redeemerData);
        return redeemerData;
    }

    // to get&decode mint-tx redeemers based on txInfo 
    async getTokenRedeemerFromCBOR(txInfo, bNftTask = false) {
        if (undefined === txInfo.redeemers) {
            return undefined;
        }

        /* Modify By NFT Program: 
            add nft tx builder object
        */
        if (bNftTask) {
            let redeemerData = await this.nftCCTxBuilderObj.deCodeTxRedeemersCbor(txInfo, true);
            console.log("\n\ngetRedeemerFromCBOR...nft: ", redeemerData);
            return redeemerData;
        }

        let redeemerData = undefined;
        if (this.bReConstructedTxBuilder) {
            redeemerData = await this.ccTxBuilderObj.deCodeTxRedeemersCbor(txInfo, true);
        } else {
            redeemerData = await this.ccTxBuilderObj.deCodeTokenRedeemersCbor(txInfo);
        }

        console.log("\n\ngetTokenRedeemerFromCBOR: ", redeemerData);
        return redeemerData;
    }

    checkIfContainTreasuryUtxo(txInputUtxos) {
        /* Modify By NFT Program: 
            add nft tx builder object
        */
        const ContainNftTreasuryUtxo = 2;
        const ContainTreasuryUtxo = 1;
        const ContainNonRelatedUtxo = 0;

        let bRet = this.nftCCTxBuilderObj.checkIfContainTreasuryUtxo(txInputUtxos);
        if (bRet) {
            return ContainNftTreasuryUtxo
        }

        bRet = this.ccTxBuilderObj.checkIfContainTreasuryUtxo(txInputUtxos);
        if (bRet) {
            return ContainTreasuryUtxo
        }

        return ContainNonRelatedUtxo;
    }

    getValidPolicyId(bNftTask = false) {
        /* Modify By NFT Program: 
            add nft tx builder object
        */
        if (bNftTask) {
            let policyId = this.nftCCTxBuilderObj.getValidPolicyId();
            return policyId;
        }

        let policyId = this.ccTxBuilderObj.getValidPolicyId();
        return policyId;
    }

    getMsgInboundCheckTokenPolicyId() {

        let policyId = this.msgCCTxBuilderObj.getValidCheckTokenPolicyId();
        return policyId;
    }

    getCheckTokenPolicyId(bNft = false) {

        if (bNft) {
            let pkh = this.nftCCTxBuilderObj.getCheckTokenPolicyId();
            return pkh;
        }

        let pkh = this.ccTxBuilderObj.getCheckTokenPolicyId();
        return pkh;
    }

    getMintCheckTokenPolicyId(bNft = false) {

        if (bNft) {
            let pkh = this.nftCCTxBuilderObj.getMintCheckTokenPolicyId(address);
            return pkh;
        }

        let pkh = this.ccTxBuilderObj.getMintCheckTokenPolicyId(address);
        return pkh;
    }

    addressToPkhOrScriptHash(address, bNftTask = false) {
        /* Modify By NFT Program: 
            add nft tx builder object
        */
        if (bNftTask) {
            let pkh = this.nftCCTxBuilderObj.addressToPkhOrScriptHash(address);
            return pkh;
        }

        let pkh = this.ccTxBuilderObj.addressToPkhOrScriptHash(address);
        return pkh;
    }

    async confirmTx(txHash) {
        await this.nftCCTxBuilderObj.confirmTx(txHash);
        await this.ccTxBuilderObj.confirmTx(txHash);
    }

    revertUtxoPendingComsumedStatus(inputUtxos) {

        try{
            this.ccTxBuilderObj.revertUtxoPendingComsumedStatus(inputUtxos);
        }catch(e){            
            this.logger.debug("..PlutusTxService...", "...ccTxBuilderObj...revertUtxoPendingComsumedStatus exception", e);
            throw e;
        }

        // /* Modify By NFT Program: 
        //     add nft tx builder object
        // */
        try{
            this.nftCCTxBuilderObj.revertUtxoPendingComsumedStatus(inputUtxos);
        }catch(e){            
            this.logger.debug("..PlutusTxService...", "...nftCCTxBuilderObj...revertUtxoPendingComsumedStatus exception", e);
            throw e;
        }

        try{
            this.msgCCTxBuilderObj.revertUtxoPendingComsumedStatus(inputUtxos);
        }catch(e){            
            this.logger.debug("..PlutusTxService...", "...msgCCTxBuilderObj...revertUtxoPendingComsumedStatus exception", e);
            throw e;
        }
    }

    // 
    async getInboundCheckUtxosTotalNum() {

        let utxoNum = await this.msgCCTxBuilderObj.getInboundCheckUtxosTotalNum();
        console.log("\n\n getInboundCheckUtxosTotalNum: ", utxoNum);
        return utxoNum;
    }
    
    // 
    async getTreasuryCheckUtxosTotalNum(bNftTask = false) {
        let bMintCheck = false;
        /* Modify By NFT Program: 
            add nft tx builder object
        */
        if (bNftTask) {
            let utxoNum = await this.nftCCTxBuilderObj.getTreasuryCheckUtxosTotalNum(bMintCheck);
            return utxoNum;
        }

        let utxoNum = await this.ccTxBuilderObj.getTreasuryCheckUtxosTotalNum(bMintCheck);
        console.log("\n\n getTreasuryCheckUtxosTotalNum: ", utxoNum);
        return utxoNum;
    }

    // 
    async getMintTreasuryCheckUtxosTotalNum(bNftTask = false) {
        let bMintCheck = true;
        /* Modify By NFT Program: 
            add nft tx builder object
        */
        if (bNftTask) {
            let utxoNum = await this.nftCCTxBuilderObj.getTreasuryCheckUtxosTotalNum(bMintCheck);
            return utxoNum;
        }

        let utxoNum = await this.ccTxBuilderObj.getTreasuryCheckUtxosTotalNum(bMintCheck);
        console.log("\n\n getMintTreasuryCheckUtxosTotalNum: ", utxoNum);
        return utxoNum;
    }


    async checkNFTRefAssets(refAssetHolder, refAssets) {

        let ret = this.nftCCTxBuilderObj.checkNFTRefAssets(refAssetHolder, refAssets);

        // true: available and no need to mint; 
        // false: need to mint this kind ref assets
        return ret;
    }

    genNFTAssetName(name, typeCode) {

        let nftAssetName = this.nftCCTxBuilderObj.genNFTAssetName(name, typeCode);
        return nftAssetName;
    }

    genNFTIdFromAssetName(assetNameHex) {

        let nftId = this.nftCCTxBuilderObj.genNFTIdFromAssetName(assetNameHex);
        return nftId;
    }

    convertMetadata2TxDatum(nftMetaData) {
        if (undefined === nftMetaData) {
            return undefined;
        }

        let txDatum = this.nftCCTxBuilderObj.convertMetadata2TxDatum(nftMetaData);
        return txDatum;
    }
    
    crossMsgDataFromCbor(inboundDataCbor){

        if (undefined === inboundDataCbor) {
            return undefined;
        }

        let txDatum = this.msgCCTxBuilderObj.crossMsgDataFromCbor(inboundDataCbor);
        return txDatum;
    }

    getInboundTokenPolicyId(){
        let txDatum = this.msgCCTxBuilderObj.getInboundTokenPolicyId();
        return txDatum;
    }

    getOutboundTokenPolicyId(){
        let txDatum = this.msgCCTxBuilderObj.getOutboundTokenPolicyId();
        return txDatum;
    }

    async getTreasuryCheckAddress(){
        return await this.ccTxBuilderObj.getTreasuryCheckAddress(false);
    }

    async getMintCheckAddress(){
        return await this.ccTxBuilderObj.getTreasuryCheckAddress(true);
    }

    async getNFTTreasuryCheckAddress(){
        return await this.nftCCTxBuilderObj.getTreasuryCheckAddress(false);
    }
    
    async getNFTMintCheckAddress(){
        return await this.nftCCTxBuilderObj.getTreasuryCheckAddress(true);
    }

    async getInboundCheckAddress(){
        return await this.msgCCTxBuilderObj.getInboundCheckAddress();
    }

}


module.exports = PlutusTxService;
